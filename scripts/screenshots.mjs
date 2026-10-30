// Loads the unpacked extension in Chrome for Testing, fills its storage with the demo
// state from scripts/demo-state.mjs and screenshots the real pages.
// Usage: CHROME=/path/to/chrome-for-testing node scripts/screenshots.mjs <outDir> [realReleasesDir] [--lang=en|ar] [--dark]
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { demoState } from './demo-state.mjs';

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [outDir, realDir] = args.filter((a) => !a.startsWith('--'));
const lang = flags.lang || 'en';
const scale = Number(flags.scale || 1);
mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  headless: true,
  pipe: true,
  enableExtensions: true,
  args: [`--lang=${lang}`, `--accept-lang=${lang}`, '--no-first-run', '--hide-scrollbars', '--font-render-hinting=none'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  const id = await browser.installExtension(resolve('src'));
  const swt = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`));
  const sw = await swt.worker();
  for (let i = 0; i < 100; i++) {
    if (await sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage).catch(() => false)) break;
    await sleep(100);
  }
  await sleep(1500); // let the first-run check finish before replacing its state
  const { state, reports } = await demoState({ realDir });
  await sw.evaluate(async (s) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(s);
  }, state);

  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: flags.dark ? 'dark' : 'light' }]);
  const base = `chrome-extension://${id}/`;
  const shot = async (name, url, vp, opts = {}) => {
    await page.setViewport({ ...vp, deviceScaleFactor: scale });
    await page.goto(base + url, { waitUntil: 'networkidle0' });
    await sleep(300);
    if (opts.before) await opts.before(page);
    const file = join(outDir, `${name}.png`);
    if (opts.fit) {
      const hgt = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewport({ ...vp, height: hgt, deviceScaleFactor: scale });
    }
    writeFileSync(file, await page.screenshot({ fullPage: !!opts.full }));
    console.log(file);
  };
  const high = reports.find((r) => r.level === 'high');
  const W = Number(flags.width || 1280);
  const H = Number(flags.height || 800);
  await shot('popup', 'popup/popup.html', { width: 390, height: 600 }, { fit: true });
  await shot('report-high', `report/report.html?r=${high.rid}`, { width: W, height: H });
  await shot('report-high-full', `report/report.html?r=${high.rid}`, { width: W, height: H }, { full: true });
  await shot('report-ledger', `report/report.html?r=${high.rid}`, { width: W, height: H }, { before: (p) => p.evaluate(() => document.querySelector('.sec').scrollIntoView()) });
  await shot('report-files', `report/report.html?r=${high.rid}`, { width: W, height: H }, { before: (p) => p.evaluate(() => [...document.querySelectorAll('.sec')].at(-3).scrollIntoView()) });
  const low = reports.find((r) => r.level !== 'high');
  if (low) await shot('report-routine', `report/report.html?r=${low.rid}`, { width: W, height: H });
  await shot('overview', 'report/report.html', { width: W, height: H });
  await shot('options', 'options/options.html', { width: W, height: H });
  // Accessibility spot check: the report at 200% zoom on a 1280px window.
  await shot('report-zoom200', `report/report.html?r=${high.rid}`, { width: 640, height: 800 });
} finally {
  await browser.close();
}
