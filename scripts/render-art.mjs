// Renders docs/design/art.html into the README banners, the social preview and the
// Chrome Web Store promo images. Serves docs/ over a local HTTP server while it runs.
// Usage: CHROME=/path/to/chrome node scripts/render-art.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve('docs');
const port = Number(process.argv[2] || 8807);
const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const jobs = [
  ['banner', 'en', 1280, 640, 2, 'docs/images/banner.png'],
  ['banner', 'ar', 1280, 640, 2, 'docs/images/banner-ar.png'],
  ['banner', 'en', 1280, 640, 1, 'docs/images/social-preview.png'],
  ['store-popup', 'en', 1280, 800, 1, 'store/screenshots/en/02-popup.png'],
  ['store-popup', 'ar', 1280, 800, 1, 'store/screenshots/ar/02-popup.png'],
  ['tile', 'en', 440, 280, 1, 'store/promo-tile-440x280.png'],
  ['tile', 'ar', 440, 280, 1, 'store/promo-tile-440x280-ar.png'],
  ['marquee', 'en', 1400, 560, 1, 'store/marquee-1400x560.png'],
  ['marquee', 'ar', 1400, 560, 1, 'store/marquee-1400x560-ar.png'],
];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true });
try {
  const page = await browser.newPage();
  for (const [kind, lang, w, h, dsf, out] of jobs) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf });
    await page.goto(`http://127.0.0.1:${port}/design/art.html?kind=${kind}&lang=${lang}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(out, await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
    console.log(out);
  }
} finally {
  await browser.close();
  server.close();
}
