// Hypotheses 1 and 2 in a real browser (Chrome for Testing, not branded Chrome).
// Usage: CHROME=/path/to/chrome-for-testing node scripts/experiment/browser-run.mjs
import puppeteer from 'puppeteer-core';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const IDS = [
  'ddkjiahejlhfcafbddmgiahcphecmpfh', // uBlock Origin Lite
  'eimadpbcbfnmbkopoojfekhnkhdbieeh', // Dark Reader
  'nngceckbapebfimnlniiiahkandclblb', // Bitwarden
  'fmkadmapgofadopljbjfkapdkoienihi', // React Developer Tools
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeDir = mkdtempSync(join(tmpdir(), 'crxdiff-probe-'));
const writeProbe = (version) => {
  mkdirSync(probeDir, { recursive: true });
  writeFileSync(join(probeDir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'crxdiff probe', version, permissions: version === '1.0.0' ? ['storage'] : ['storage', 'scripting'] }));
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  headless: true,
  pipe: true,
  enableExtensions: true,
  args: ['--no-first-run', '--no-default-browser-check'],
});
const result = { browser: await browser.version() };
try {
  const crxdiffId = await browser.installExtension(resolve('src'));
  result.crxdiffId = crxdiffId;
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${crxdiffId}/`));
  const sw = await swTarget.worker();
  // The worker target appears before its script has run; wait for the module.
  for (let i = 0; i < 100; i++) {
    if (await sw.evaluate(() => typeof globalThis.crxdiffDebug !== 'undefined').catch(() => false)) break;
    await sleep(100);
  }

  // Hypothesis 1: download + parse inside the extension service worker.
  result.h1 = [];
  for (const id of IDS) {
    try {
      result.h1.push(await sw.evaluate((x) => globalThis.crxdiffDebug.snapshot(x), id));
    } catch (e) {
      result.h1.push({ id, error: String(e.message || e).slice(0, 300) });
    }
  }
  // Same thing from a page with no host permission would be a CORS failure; show that
  // the permission is what makes it work by fetching a host the manifest does not list.
  result.h1_control = await sw.evaluate(async () => {
    try {
      await fetch('https://www.google.com/robots.txt');
      return 'fetched (unexpected)';
    } catch (e) {
      return 'blocked: ' + e.message;
    }
  });

  // Hypothesis 2: does management.onInstalled fire when another extension updates?
  writeProbe('1.0.0');
  const probeId = await browser.installExtension(probeDir);
  await sleep(1500);
  await sw.evaluate(() => chrome.storage.session.set({ events: [] }));
  writeProbe('1.1.0');
  const t0 = Date.now();
  await browser.installExtension(probeDir); // same path: Chrome reloads it as an update
  let events = [];
  while (Date.now() - t0 < 5000) {
    events = (await sw.evaluate(() => chrome.storage.session.get('events'))).events || [];
    if (events.some((e) => e.id === probeId && e.version === '1.1.0')) break;
    await sleep(100);
  }
  const hit = events.find((e) => e.id === probeId && e.version === '1.1.0');
  result.h2 = { probeId, eventSeen: !!hit, latencyMs: hit ? hit.at - t0 : null, events };
  // Polling path: what management.getAll() reports right after.
  result.h2_poll = await sw.evaluate(async (pid) => {
    const all = await chrome.management.getAll();
    const p = all.find((e) => e.id === pid);
    return p && { version: p.version, installType: p.installType, updateUrl: p.updateUrl ?? null, permissions: p.permissions };
  }, probeId);
  const rec = await sw.evaluate((pid) => chrome.storage.local.get('ext:' + pid), probeId);
  result.h2_record = rec['ext:' + probeId] || null;
} finally {
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
