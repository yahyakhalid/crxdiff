// Compare two extension packages (.crx or .zip) from the command line with the same
// engine the extension uses. Prints the report as JSON, or a short summary.
// Usage: node scripts/compare.mjs old.crx new.crx [--json]
//        node scripts/compare.mjs --snapshot pkg.crx
import { readFileSync } from 'node:fs';
import { buildSnapshot } from '../src/lib/snapshot.js';
import { compareSnapshots } from '../src/lib/diff.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
const load = (p) => buildSnapshot(new Uint8Array(readFileSync(p)));

if (args.includes('--snapshot')) {
  const s = await load(files[0]);
  const { manifestText: _m, manifest: _n, ...rest } = s;
  console.log(JSON.stringify(rest, null, 2));
} else if (files.length === 2) {
  const [a, b] = await Promise.all(files.map(load));
  const r = compareSnapshots(a, b);
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`${r.fromVersion} -> ${r.toVersion}: score ${r.score}, level ${r.level}`);
    for (const f of r.findings) console.log(`  +${String(f.points).padStart(2)} ${f.code} ${f.params.join(' | ')}${f.items ? ' :: ' + f.items.slice(0, 6).join(', ') : ''}`);
    const c = r.files.counts;
    console.log(`  files: +${c.added} -${c.removed} ~${c.changed} =${c.unchanged}; new hosts: ${r.hosts.added.length}`);
  }
} else {
  console.error('Usage: node scripts/compare.mjs old.crx new.crx [--json] | --snapshot pkg.crx');
  process.exit(2);
}
