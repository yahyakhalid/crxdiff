import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createMonitor, notCheckedReason } from '../src/lib/monitor.js';
import { PackageError } from '../src/lib/crx.js';
import { zipDir, makeCrx3, fakeId } from './helpers/pack.js';

const STORE = 'https://clients2.google.com/service/update2/crx';
const SELF = fakeId('crxdiff');
const ID = fakeId('page-notes');
const fx = (v) => fileURLToPath(new URL(`./fixtures/page-notes-${v}`, import.meta.url));
const pkg = (v) => makeCrx3(zipDir(fx(v)), ID);

function fakeStorage() {
  const data = new Map();
  return {
    data,
    async get(keys) {
      if (keys === null) return Object.fromEntries(data);
      const out = {};
      for (const k of [].concat(keys)) if (data.has(k)) out[k] = structuredClone(data.get(k));
      return out;
    },
    async set(obj) {
      for (const [k, v] of Object.entries(obj)) data.set(k, structuredClone(v));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) data.delete(k);
    },
  };
}

function setup({ installed = '4.1.2', store = '4.1.2', settings, extra = {} } = {}) {
  const storage = fakeStorage();
  if (settings) storage.data.set('settings', settings);
  const state = { installed, store, enabled: true, disabledCalls: [], downloads: 0, downloadError: null };
  const ext = () => ({
    id: ID,
    name: 'Page Notes',
    version: state.installed,
    type: 'extension',
    installType: 'normal',
    updateUrl: STORE,
    enabled: state.enabled,
    mayDisable: true,
    permissions: state.installed === '4.2.0' ? ['storage', 'scripting'] : ['storage'],
    hostPermissions: ['https://*/*'],
    ...extra,
  });
  const reports = [];
  const monitor = createMonitor({
    storage,
    selfId: SELF,
    now: () => 1_800_000_000_000,
    management: {
      getAll: async () => [ext(), { id: SELF, name: 'crxdiff', type: 'extension', installType: 'development', version: '0.1.0' }],
      setEnabled: async (id, on) => {
        state.disabledCalls.push([id, on]);
        state.enabled = on;
      },
    },
    download: async (id) => {
      assert.equal(id, ID);
      state.downloads++;
      if (state.downloadError) throw new PackageError(state.downloadError);
      return pkg(state.store);
    },
    onReport: (r) => reports.push(r),
  });
  return { storage, state, monitor, reports };
}

test('first run takes a baseline that matches the installed version', async () => {
  const { storage, monitor, reports } = setup();
  await monitor.checkAll();
  const rec = storage.data.get('ext:' + ID);
  assert.equal(rec.status, 'watching');
  assert.equal(rec.baselineVersion, '4.1.2');
  assert.equal(storage.data.get('snap:' + ID).version, '4.1.2');
  assert.equal(reports.length, 0);
  assert.ok(!storage.data.has('ext:' + SELF), 'crxdiff does not watch itself');
  assert.ok(storage.data.get('meta').lastRunOk);
});

test('an update produces a full report and moves the baseline', async () => {
  const { storage, state, monitor, reports } = setup();
  await monitor.checkAll();
  state.installed = '4.2.0';
  state.store = '4.2.0';
  await monitor.checkAll();
  assert.equal(reports.length, 1);
  const r = reports[0];
  assert.equal(r.kind, 'full');
  assert.equal(r.level, 'high');
  assert.equal(r.fromVersion, '4.1.2');
  assert.equal(r.toVersion, '4.2.0');
  assert.equal(storage.data.get('snap:' + ID).version, '4.2.0');
  assert.equal(storage.data.get('reportIndex').length, 1);
  assert.equal(state.disabledCalls.length, 0, 'auto-disable is off by default');
  // No second report for the same version.
  await monitor.checkAll();
  assert.equal(reports.length, 1);
});

test('auto-disable turns off a high-risk update, and only when allowed', async () => {
  const a = setup({ settings: { autoDisable: true } });
  await a.monitor.checkAll();
  a.state.installed = a.state.store = '4.2.0';
  await a.monitor.checkAll();
  assert.deepEqual(a.state.disabledCalls, [[ID, false]]);
  assert.ok(a.reports[0].autoDisabled);
  assert.ok(a.reports[0].notes.some((n) => n.code === 'n_auto_disabled'));

  const b = setup({ settings: { autoDisable: true }, extra: { mayDisable: false } });
  await b.monitor.checkAll();
  b.state.installed = b.state.store = '4.2.0';
  await b.monitor.checkAll();
  assert.deepEqual(b.state.disabledCalls, []);
  assert.ok(b.reports[0].notes.some((n) => n.code === 'n_auto_disable_failed'));

  const c = setup({ settings: { autoDisable: true } });
  await c.monitor.checkAll();
  c.state.installed = c.state.store = '4.1.3'; // routine
  await c.monitor.checkAll();
  assert.deepEqual(c.state.disabledCalls, []);
});

test('store ahead of the install: baseline kept, later update is permissions-only', async () => {
  const { storage, state, monitor, reports } = setup({ installed: '4.1.2', store: '4.1.3' });
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'baseline-ahead');
  state.installed = '4.1.3';
  await monitor.checkAll();
  assert.equal(reports.length, 1);
  assert.equal(reports[0].kind, 'partial');
  assert.ok(reports[0].notes.some((n) => n.code === 'n_no_old_package'));
  assert.equal(storage.data.get('ext:' + ID).status, 'watching');
});

test('store behind the install: no baseline is kept, it is retried', async () => {
  const { storage, state, monitor } = setup({ installed: '4.1.3', store: '4.1.2' });
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'baseline-behind');
  assert.ok(!storage.data.has('snap:' + ID));
  state.store = '4.1.3';
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'watching');
});

test('download failures and removal from the store are recorded and retried', async () => {
  const { storage, state, monitor, reports } = setup();
  state.downloadError = 'not-in-store';
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'unavailable');
  state.downloadError = 'http-500';
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'error');
  state.downloadError = null;
  await monitor.checkAll();
  assert.equal(storage.data.get('ext:' + ID).status, 'watching');
  // An update whose download fails is retried on the next run, not lost.
  state.installed = state.store = '4.2.0';
  state.downloadError = 'http-503';
  await monitor.checkAll();
  assert.equal(reports.length, 0);
  state.downloadError = null;
  await monitor.checkAll();
  assert.equal(reports.length, 1);
});

test('uninstalled extensions are forgotten', async () => {
  const { storage, monitor } = setup();
  await monitor.checkAll();
  storage.data.set('ext:' + fakeId('gone'), { id: fakeId('gone') });
  storage.data.set('snap:' + fakeId('gone'), {});
  await monitor.checkAll();
  assert.ok(!storage.data.has('ext:' + fakeId('gone')));
  assert.ok(!storage.data.has('snap:' + fakeId('gone')));
});

test('items that cannot be checked get a reason', () => {
  const base = { id: ID, type: 'extension', installType: 'normal', updateUrl: STORE };
  assert.equal(notCheckedReason(base), null);
  assert.equal(notCheckedReason({ ...base, updateUrl: undefined }), null);
  assert.equal(notCheckedReason({ ...base, type: 'theme' }).code, 'r_not_extension');
  assert.equal(notCheckedReason({ ...base, installType: 'development' }).code, 'r_unpacked');
  assert.equal(notCheckedReason({ ...base, installType: 'admin' }).code, 'r_policy');
  assert.equal(notCheckedReason({ ...base, installType: 'sideload' }).code, 'r_sideload');
  assert.equal(notCheckedReason({ ...base, updateUrl: 'https://edge.microsoft.com/extensionwebstorebase/v1/crx' }).code, 'r_edge_store');
  assert.deepEqual(notCheckedReason({ ...base, updateUrl: 'https://upd.vendor.test/x.xml' }), { code: 'r_self_hosted', params: ['upd.vendor.test'] });
  assert.equal(notCheckedReason(base, { ignored: [ID] }).code, 'r_ignored');
  assert.equal(notCheckedReason({ ...base, id: 'not-an-id' }).code, 'r_other');
});

test('overlapping checks share one run and schedule one more', async () => {
  const { state, monitor } = setup();
  const p1 = monitor.checkAll();
  const p2 = monitor.checkAll({ onlyId: ID });
  assert.equal(p1, p2);
  await p1;
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(state.downloads >= 1);
});
