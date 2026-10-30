// Static checks on the extension package itself: permissions, CSP, locales, files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERMISSIONS, PATTERN_POINTS } from '../src/lib/risk.js';
import { PATTERNS } from '../src/lib/scan.js';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const en = JSON.parse(readFileSync(join(root, '_locales/en/messages.json'), 'utf8'));
const ar = JSON.parse(readFileSync(join(root, '_locales/ar/messages.json'), 'utf8'));

function walk(d, out = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const files = walk(root);
const code = files.filter((f) => /\.(js|html)$/.test(f) && !f.includes('vendor'));

test('permissions are exactly the four documented ones, hosts only the update servers', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'management', 'notifications', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['https://clients2.google.com/*', 'https://clients2.googleusercontent.com/*']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.manifest_version, 3);
});

test('CSP allows only local scripts and connects only to the update servers', () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src https:\/\/clients2\.google\.com https:\/\/clients2\.googleusercontent\.com;/);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline|wasm-unsafe-eval/);
});

test('no remote code, no inline scripts, no HTML injection sinks', () => {
  for (const f of code) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /<script(?![^>]*\bsrc="[./a-z-]+\.js")[^>]*>/i, `${f}: inline or remote <script>`);
    assert.doesNotMatch(s, /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write\(|\beval\(|new Function\(/, `${f}: unsafe sink`);
    assert.doesNotMatch(s, /\bon[a-z]+="/i, `${f}: inline event handler`);
    assert.doesNotMatch(s, /https?:\/\/(?!clients2\.google(usercontent)?\.com|github\.com\/yahyakhalid|developer\.chrome\.com)[a-z]/i, `${f}: unexpected URL`);
  }
});

test('every file the manifest and pages reference exists', () => {
  const refs = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)];
  for (const r of refs) assert.ok(existsSync(join(root, r)), r);
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/(?:src|href)="([^"#?:]+)"/g)) assert.ok(existsSync(join(dirname(f), m[1])), `${f} -> ${m[1]}`);
  }
});

test('English and Arabic have the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const k of Object.keys(en)) {
    const ph = (s) => [...s.matchAll(/\{\d\}/g)].map((m) => m[0]).sort().join();
    assert.equal(ph(ar[k].message), ph(en[k].message), k);
    assert.ok(!en[k].message.includes('$') && !ar[k].message.includes('$'), `${k}: "$" is special in chrome.i18n`);
    assert.ok(ar[k].message.trim().length > 0, k);
  }
  assert.ok(en.extName.message.length <= 75 && ar.extName.message.length <= 75);
  assert.ok(en.extDescription.message.length <= 132 && ar.extDescription.message.length <= 132);
});

test('every message key the code uses exists', () => {
  const used = new Set();
  for (const f of files.filter((x) => x.endsWith('.js'))) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\b(f_[a-z_]+|n_[a-z_]+|r_[a-z_]+|status_[a-z_]+|level_[a-z_]+|report_[a-zA-Z_]+|ov_[a-z_]+|opt_[a-zA-Z0-9_]+|popup_[a-zA-Z_]+|notif_[a-z_]+|col_[a-z]+)\b/g)) used.add(m[1]);
  }
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.add(m[1]);
  }
  // Keys built at run time.
  for (const id of Object.keys(PATTERN_POINTS)) {
    used.add('pattern_' + id.replace(/-/g, '_'));
    used.add('pattern_' + id.replace(/-/g, '_') + '_why');
  }
  for (const l of ['high', 'medium', 'low', 'none']) used.add('level_' + l + '_hint');
  assert.deepEqual([...used].filter((k) => !en[k]), []);
  // Each scored finding code has an explanation.
  for (const k of Object.keys(en).filter((x) => /^f_[a-z_]+$/.test(x) && !x.endsWith('_why') && x !== 'f_pattern_new')) assert.ok(en[k + '_why'], k + '_why');
});

test('every scanner pattern has points, and the permission table is well formed', () => {
  assert.deepEqual(PATTERNS.map((p) => p.id).sort(), Object.keys(PATTERN_POINTS).sort());
  for (const [name, v] of Object.entries(PERMISSIONS)) {
    assert.equal(typeof v.warns, 'boolean', name);
    assert.ok(Number.isInteger(v.points) && v.points >= 0, name);
  }
});
