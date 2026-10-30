// Downloads consecutive real releases of popular open-source extensions from their
// GitHub releases, for the routine-update noise check (scripts/noise.mjs).
// Usage: node scripts/fetch-real-releases.mjs <outDir>
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const SOURCES = [
  { name: 'ublock-origin-lite', repo: 'uBlockOrigin/uBOL-home', asset: /^uBOLite_.*\.chromium\.zip$/, count: 6 },
  { name: 'dark-reader', repo: 'darkreader/darkreader', asset: /^darkreader-chrome-mv3\.zip$/, count: 6 },
  { name: 'violentmonkey', repo: 'violentmonkey/violentmonkey', asset: /^Violentmonkey-(beta-)?mv3-v[\d.]+\.zip$/, count: 6 },
  { name: 'sponsorblock', repo: 'ajayyy/SponsorBlock', asset: /^ChromeExtension\.zip$/, count: 6 },
  { name: 'stylus', repo: 'openstyles/stylus', asset: /^stylus-chrome-mv3-v[\d.]+-id\.zip$/, count: 6 },
  { name: 'bitwarden', repo: 'bitwarden/clients', asset: /^dist-chrome-[\d.]+\.zip$/, count: 2 },
];

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/fetch-real-releases.mjs <outDir>');
  process.exit(2);
}
for (const s of SOURCES) {
  const dir = join(out, s.name);
  mkdirSync(dir, { recursive: true });
  const rel = await (await fetch(`https://api.github.com/repos/${s.repo}/releases?per_page=30`)).json();
  if (!Array.isArray(rel)) throw new Error(`${s.repo}: ${rel.message}`);
  const picked = [];
  for (const r of rel) {
    const a = r.assets.find((x) => s.asset.test(x.name));
    if (a) picked.push({ tag: r.tag_name, url: a.browser_download_url, date: r.published_at });
    if (picked.length === s.count) break;
  }
  for (const p of picked) {
    const file = join(dir, `${p.date.slice(0, 10)}_${p.tag.replace(/[^\w.-]/g, '_')}.zip`);
    if (existsSync(file)) continue;
    const buf = new Uint8Array(await (await fetch(p.url)).arrayBuffer());
    writeFileSync(file, buf);
    console.log(s.name, p.tag, buf.length);
  }
}
