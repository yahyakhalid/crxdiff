import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildSnapshot, baselineStatus, compareVersions } from '../src/lib/snapshot.js';
import { compareSnapshots, manifestFacts, isBroadPattern, lineDiff, compareManagementInfo, isStoreUpdateUrl } from '../src/lib/diff.js';
import { levelFor, permissionInfo } from '../src/lib/risk.js';
import { zipDir, makeZip, makeCrx3, fakeId } from './helpers/pack.js';

const fx = (v) => fileURLToPath(new URL(`./fixtures/page-notes-${v}`, import.meta.url));
const snap = (v, extra) => buildSnapshot(zipDir(fx(v), extra));
const codes = (r) => r.findings.map((f) => f.code);

test('routine update (4.1.2 -> 4.1.3) stays quiet', async () => {
  const r = compareSnapshots(await snap('4.1.2'), await snap('4.1.3'));
  assert.equal(r.fromVersion, '4.1.2');
  assert.equal(r.toVersion, '4.1.3');
  assert.equal(r.level, 'none');
  assert.equal(r.score, 0);
  assert.deepEqual(r.files.counts, { added: 1, removed: 0, changed: 2, unchanged: 4 });
  assert.ok(r.manifestDiff.some((l) => l.op === '+' && l.text.includes('4.1.3')));
});

test('QuickLens-style update (4.1.2 -> 4.2.0) is high risk, with a reason for every point', async () => {
  const r = compareSnapshots(await snap('4.1.2'), await snap('4.2.0'));
  assert.equal(r.level, 'high');
  const c = codes(r);
  for (const expected of ['f_dnr_header', 'f_perm_added_silent', 'f_sites_new', 'f_pattern_new', 'f_remote_combo']) {
    assert.ok(c.includes(expected), `missing ${expected} in ${c}`);
  }
  const silent = r.findings.filter((f) => f.code === 'f_perm_added_silent').map((f) => f.params[0]).sort();
  assert.deepEqual(silent, ['alarms', 'declarativeNetRequestWithHostAccess', 'scripting']);
  assert.deepEqual(r.findings.find((f) => f.code === 'f_dnr_header').items.sort(), ['content-security-policy:remove', 'x-frame-options:remove']);
  assert.deepEqual(r.findings.find((f) => f.code === 'f_sites_new').items, ['lens-sync.test']);
  assert.equal(r.score, r.findings.reduce((s, f) => s + f.points, 0));
  assert.ok(r.findings.every((f) => typeof f.points === 'number' && f.points >= 0));
  // Findings are sorted by weight, so the first one is the strongest reason.
  assert.equal(r.findings[0].points, Math.max(...r.findings.map((f) => f.points)));
});

test('identical packages produce no findings', async () => {
  const a = await snap('4.1.2');
  const r = compareSnapshots(a, a);
  assert.deepEqual(r.findings, []);
  assert.equal(r.level, 'none');
});

test('store-generated files and the store update_url are not reported as risks', async () => {
  const id = fakeId('store');
  const plain = await buildSnapshot(zipDir(fx('4.1.2')));
  const manifest = JSON.parse(plain.manifestText);
  manifest.update_url = 'https://clients2.google.com/service/update2/crx';
  // The Web Store copy: same manifest plus update_url, and a _metadata folder.
  const files = [{ name: 'manifest.json', data: JSON.stringify(manifest) }, { name: '_metadata/verified_contents.json', data: '[]' }];
  const store = await buildSnapshot(makeCrx3(makeZip(files), id), { id });
  const r = compareSnapshots({ ...plain, files: plain.files.filter((f) => f.path === 'manifest.json') }, store);
  assert.equal(r.score, 0);
  assert.equal(r.files.counts.added, 0);
});

test('update_url moving off the Web Store is high risk on its own', () => {
  const base = { version: '1', manifest: { update_url: 'https://clients2.google.com/service/update2/crx' }, files: [], hosts: [], patterns: {} };
  const next = { ...base, version: '2', manifest: { update_url: 'https://updates.some-vendor.test/crx.xml' } };
  const r = compareSnapshots(base, next);
  assert.equal(r.level, 'high');
  assert.equal(r.findings[0].code, 'f_update_url_changed');
  assert.ok(isStoreUpdateUrl('https://clients2.google.com/service/update2/crx'));
  assert.ok(!isStoreUpdateUrl('https://clients2.google.com.evil.test/service/update2/crx'));
});

test('broad host access, all-pages content scripts and CSP weakening are scored', () => {
  const base = { version: '1', manifest: { manifest_version: 3, host_permissions: ['https://a.test/*'], content_scripts: [{ matches: ['https://a.test/*'] }], content_security_policy: { extension_pages: "script-src 'self'" } }, files: [], hosts: [], patterns: {} };
  const next = { ...base, version: '2', manifest: { manifest_version: 3, host_permissions: ['https://a.test/*', '<all_urls>'], content_scripts: [{ matches: ['*://*/*'], world: 'MAIN' }], content_security_policy: { extension_pages: "script-src 'self' 'unsafe-eval' https://cdn.test" } } };
  const c = codes(compareSnapshots(base, next));
  for (const x of ['f_host_added_broad', 'f_match_added_broad', 'f_main_world', 'f_csp_unsafe_eval', 'f_csp_remote', 'f_csp_changed']) assert.ok(c.includes(x), x);
});

test('manifest facts tolerate hostile or malformed manifests', () => {
  const f = manifestFacts({ permissions: ['tabs', 5, null, 'https://*/*', { x: 1 }], content_scripts: 'nope', author: { email: 'a@b.test' }, background: { scripts: ['a.js', 7] }, web_accessible_resources: [null, { matches: ['<all_urls>'] }] });
  assert.deepEqual(f.apiPermissions, ['tabs']);
  assert.deepEqual(f.hostPermissions, ['https://*/*']);
  assert.equal(f.author, 'a@b.test');
  assert.equal(f.background, 'a.js');
  assert.deepEqual(f.webAccessibleMatches, ['<all_urls>']);
  assert.deepEqual(manifestFacts(null).apiPermissions, []);
  // Prototype-ish permission names are just unknown permissions.
  assert.deepEqual(permissionInfo('constructor'), { warns: null, points: 5 });
  assert.deepEqual(permissionInfo('__proto__'), { warns: null, points: 5 });
});

test('broad pattern detection', () => {
  for (const p of ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/', 'file:///*', 'https://*.com/*']) assert.ok(isBroadPattern(p), p);
  for (const p of ['https://*.google.com/*', 'https://mail.test/*', 'not a pattern']) assert.ok(!isBroadPattern(p), p);
});

test('line diff keeps order and marks additions and removals', () => {
  const d = lineDiff('a\nb\nc\nd', 'a\nc\nx\nd');
  assert.deepEqual(d.map((l) => l.op + l.text), [' a', '-b', ' c', '+x', ' d']);
  assert.deepEqual(lineDiff('same', 'same'), [{ op: ' ', text: 'same' }]);
});

test('permission-only comparison from chrome.management data', () => {
  const f = compareManagementInfo({ permissions: ['storage'], hostPermissions: [] }, { permissions: ['storage', 'cookies'], hostPermissions: ['<all_urls>'] });
  assert.deepEqual(f.map((x) => x.code).sort(), ['f_host_added_broad', 'f_perm_added_silent']);
});

test('baseline version check (hypothesis 3)', () => {
  assert.equal(baselineStatus('1.2.0', '1.2'), 'matched');
  assert.equal(baselineStatus('1.3', '1.2.9'), 'store-ahead');
  assert.equal(baselineStatus('1.2', '1.10'), 'store-behind');
  assert.equal(compareVersions('2026.1026.1812', '2026.930.1227'), 1);
});

test('levels', () => {
  assert.deepEqual([0, 1, 19, 20, 49, 50].map(levelFor), ['none', 'low', 'low', 'medium', 'medium', 'high']);
});
