// Routine-update noise check: runs the diff engine on consecutive real releases of
// popular extensions and prints the level each update would get.
// Usage: node scripts/noise.mjs <dir>   (layout from scripts/fetch-real-releases.mjs)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildSnapshot } from '../src/lib/snapshot.js';
import { compareSnapshots } from '../src/lib/diff.js';

const root = process.argv[2];
const rows = [];
for (const name of readdirSync(root).sort()) {
  const dir = join(root, name);
  if (!statSync(dir).isDirectory()) continue;
  const files = readdirSync(dir).filter((f) => /\.(zip|crx)$/.test(f)).sort();
  let prev = null;
  for (const f of files) {
    const snap = await buildSnapshot(new Uint8Array(readFileSync(join(dir, f))));
    if (prev) {
      const r = compareSnapshots(prev, snap);
      rows.push({ name, from: r.fromVersion, to: r.toVersion, score: r.score, level: r.level, reasons: r.findings.filter((x) => x.points > 0).map((x) => `${x.code}(+${x.points}${x.params[0] ? ' ' + x.params[0] : ''})`).join(' '), changed: r.files.counts.changed + r.files.counts.added + r.files.counts.removed, ms: snap.ms });
    }
    prev = snap;
  }
}
for (const r of rows) console.log(`${r.name.padEnd(20)} ${String(r.from).padEnd(15)} -> ${String(r.to).padEnd(15)} ${r.level.padEnd(6)} ${String(r.score).padStart(3)}  files±${String(r.changed).padStart(4)}  ${r.reasons}`);
const by = rows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {});
console.log(JSON.stringify({ updates: rows.length, ...by }));
