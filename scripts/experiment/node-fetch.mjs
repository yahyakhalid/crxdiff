// Hypothesis 1, Node part: download real Web Store packages through the update
// server, parse the CRX header and list the ZIP. Prints one JSON line per ID.
// Usage: node scripts/experiment/node-fetch.mjs [id ...]
import { parseCrx } from '../../src/lib/crx.js';
import { listZip, readEntry } from '../../src/lib/zip.js';
import { updateUrl } from '../../src/lib/fetch.js';

const ids = process.argv.slice(2);
if (ids.length === 0) {
  ids.push(
    'ddkjiahejlhfcafbddmgiahcphecmpfh', // uBlock Origin Lite
    'eimadpbcbfnmbkopoojfekhnkhdbieeh', // Dark Reader
    'nngceckbapebfimnlniiiahkandclblb', // Bitwarden
    'fmkadmapgofadopljbjfkapdkoienihi', // React Developer Tools
  );
}
for (const id of ids) {
  const t0 = Date.now();
  const res = await fetch(updateUrl(id, '156.0.0.0'), { redirect: 'follow' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const crx = parseCrx(bytes, { expectedId: id });
  const { entries } = listZip(crx.zip);
  const m = entries.find((e) => e.name === 'manifest.json');
  const manifest = JSON.parse(new TextDecoder().decode(readEntry(crx.zip, m).data).replace(/^\uFEFF/, ''));
  console.log(JSON.stringify({
    id, status: res.status, finalHost: new URL(res.url).host, bytes: bytes.length,
    format: crx.format, crxIdMatches: crx.crxId === id, files: entries.length,
    version: manifest.version, ms: Date.now() - t0,
  }));
}
