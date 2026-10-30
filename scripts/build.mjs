// Builds dist/crxdiff-<version>.zip from src/, ready for Chrome Web Store upload.
// Deterministic: files sorted, fixed timestamps (1980-01-01), fixed compression level,
// so the same source always gives the same bytes. Usage: node scripts/build.mjs
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const SRC = 'src';
const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));
const out = join('dist', `crxdiff-${manifest.version}.zip`);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.version !== manifest.version) {
  console.error(`package.json version ${pkg.version} != manifest version ${manifest.version}`);
  process.exit(1);
}

const EXCLUDE = /(^|\/)(\.|Thumbs\.db$|.*\.map$|.*\.test\.js$)/;
const files = [];
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const rel = relative(SRC, p).split(sep).join('/');
    if (EXCLUDE.test(rel)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else files.push(rel);
  }
})(SRC);
files.sort();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const parts = [];
const central = [];
let offset = 0;
for (const name of files) {
  let data = readFileSync(join(SRC, name));
  // Text files are normalised to LF so a Windows checkout builds the same bytes.
  if (/\.(js|json|html|css|svg|md|txt)$/.test(name)) data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const deflated = deflateRawSync(data, { level: 9 });
  const method = deflated.length < data.length ? 8 : 0;
  const body = method === 8 ? deflated : data;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(0x800, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nameBuf.length, 26);
  parts.push(lh, nameBuf, body);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);
  ch.writeUInt16LE(20, 6);
  ch.writeUInt16LE(0x800, 8);
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);
  offset += 30 + nameBuf.length + body.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, cd, end]);
mkdirSync('dist', { recursive: true });
writeFileSync(out, zip);
const sha = createHash('sha256').update(zip).digest('hex');
console.log(`${out}  ${files.length} files  ${zip.length} bytes  sha256 ${sha}`);
