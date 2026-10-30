// Renders docs/design/icon.svg (and icon-small.svg for 16 px) to the PNG icons.
// Usage: CHROME=/path/to/chrome node scripts/render-icons.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const big = readFileSync('docs/design/icon.svg', 'utf8');
const small = readFileSync('docs/design/icon-small.svg', 'utf8');
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, headless: true });
const page = await browser.newPage();
const targets = [
  [16, small, 'src/icons/icon-16.png'],
  [32, big, 'src/icons/icon-32.png'],
  [48, big, 'src/icons/icon-48.png'],
  [128, big, 'src/icons/icon-128.png'],
  [128, big, 'store/icon-128.png'],
];
for (const [size, svg, out] of targets) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`);
  writeFileSync(out, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log(out);
}
await browser.close();
