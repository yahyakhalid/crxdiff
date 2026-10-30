// Builds a realistic chrome.storage.local state for screenshots, using the real
// diff engine:
//  - "Page Notes" 4.1.2 -> 4.2.0 is the simulated malicious update from test/fixtures.
//  - The other reports are real diffs between consecutive public releases downloaded
//    by scripts/fetch-real-releases.mjs (skipped if that folder is missing).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildSnapshot } from '../src/lib/snapshot.js';
import { compareSnapshots } from '../src/lib/diff.js';
import { zipDir, makeCrx3 } from '../test/helpers/pack.js';

const HOUR = 3600 * 1000;

// Real Chrome Web Store IDs, so Chrome would show the right icons if they were installed.
const REAL = [
  { dir: 'ublock-origin-lite', id: 'ddkjiahejlhfcafbddmgiahcphecmpfh', name: 'uBlock Origin Lite' },
  { dir: 'dark-reader', id: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', name: 'Dark Reader' },
  { dir: 'violentmonkey', id: 'jinjaccalgkegednnccohejagnlnfdag', name: 'Violentmonkey' },
];
const PAGE_NOTES_ID = 'kjgfgldnnfoeklkmfkjfagphfepbbdan'; // made up

function report(id, name, oldSnap, newSnap, createdAt, extra = {}) {
  const diff = compareSnapshots(oldSnap, newSnap);
  return { ...diff, rid: `${createdAt.toString(36)}-${id.slice(0, 8)}`, id, name, createdAt, kind: 'full', notes: [], reviewed: false, autoDisabled: false, ...extra };
}

export async function demoState({ realDir, now = Date.now() } = {}) {
  const reports = [];
  const records = [];
  const fx = (v) => join('test', 'fixtures', `page-notes-${v}`);
  const a = await buildSnapshot(makeCrx3(zipDir(fx('4.1.2')), PAGE_NOTES_ID), { id: PAGE_NOTES_ID });
  const b = await buildSnapshot(makeCrx3(zipDir(fx('4.2.0')), PAGE_NOTES_ID), { id: PAGE_NOTES_ID });
  reports.push(report(PAGE_NOTES_ID, 'Page Notes', a, b, now - 0.4 * HOUR, { autoDisabled: true, notes: [{ code: 'n_auto_disabled' }] }));
  records.push({ id: PAGE_NOTES_ID, name: 'Page Notes', installedVersion: '4.2.0', status: 'watching', enabled: false });

  if (realDir && existsSync(realDir)) {
    let age = 5;
    for (const r of REAL) {
      const dir = join(realDir, r.dir);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.zip')).sort().slice(-2);
      if (files.length < 2) continue;
      const [o, n] = await Promise.all(files.map((f) => buildSnapshot(new Uint8Array(readFileSync(join(dir, f))))));
      reports.push(report(r.id, r.name, o, n, now - age * HOUR, { reviewed: age > 20 }));
      records.push({ id: r.id, name: r.name, installedVersion: n.version, status: 'watching', enabled: true });
      age *= 3;
    }
  }
  records.push(
    { id: 'fmkadmapgofadopljbjfkapdkoienihi', name: 'React Developer Tools', installedVersion: '8.0.0', status: 'watching', enabled: true },
    { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden Password Manager', installedVersion: '2026.10.0', storeVersion: '2026.10.1', status: 'baseline-ahead', enabled: true },
    { id: 'bcjindcccaagfpapjjmafapmmgkkhgoa', name: 'JSON Formatter', installedVersion: '0.9.4', status: 'error', lastError: 'http-503', enabled: true },
    { id: 'aaaabbbbccccddddeeeeffffgggghhhh', name: 'Company SSO Helper', installedVersion: '3.4.1', status: 'skipped', reason: { code: 'r_policy' }, enabled: true },
    { id: 'hhhhggggffffeeeeddddccccbbbbaaaa', name: 'my-test-extension', installedVersion: '0.0.1', status: 'skipped', reason: { code: 'r_unpacked' }, enabled: true },
  );

  reports.sort((x, y) => y.createdAt - x.createdAt);
  const state = {
    settings: { autoDisable: true, notify: true, intervalHours: 6, ignored: [] },
    meta: { lastRunAt: now - 12 * 60 * 1000, lastRunOk: true },
    reportIndex: reports.map((r) => ({ rid: r.rid, id: r.id, name: r.name, fromVersion: r.fromVersion, toVersion: r.toVersion, level: r.level, score: r.score, kind: r.kind, createdAt: r.createdAt, reviewed: r.reviewed, autoDisabled: r.autoDisabled, top: r.findings.filter((f) => f.points > 0).slice(0, 2) })),
  };
  for (const r of reports) state['report:' + r.rid] = r;
  for (const r of records) state['ext:' + r.id] = { ...r, lastCheckedAt: now - 12 * 60 * 1000 };
  return { state, reports };
}
