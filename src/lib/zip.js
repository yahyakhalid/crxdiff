// A small, defensive ZIP reader. It parses the central directory itself and uses
// fflate only to inflate raw DEFLATE data, so every limit below is enforced before
// any memory is allocated for a file. Nothing is ever written to disk.

import { inflateSync } from '../vendor/fflate.js';
import { PackageError } from './crx.js';

export const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 20000, // files in one package
  maxFileBytes: 64 * 1024 * 1024, // larger files are listed but not unpacked
  maxTotalBytes: 768 * 1024 * 1024, // sum of declared uncompressed sizes
  maxRatio: 200, // uncompressed / compressed, above which a file is not unpacked
  ratioMinBytes: 4 * 1024 * 1024, // the ratio check applies only to files at least this large
  maxNameBytes: 1024,
});

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function u16(b, o) {
  return b[o] | (b[o + 1] << 8);
}
function u32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

// Normalises a name for comparison and reports anything that would be a path trick
// if someone extracted this archive to disk.
export function inspectName(raw) {
  const issues = [];
  let name = raw.replace(/\\/g, '/');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) issues.push('control-chars');
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) issues.push('absolute-path');
  const parts = name.split('/');
  if (parts.some((p) => p === '..')) issues.push('parent-path');
  // Collapse "./" and empty segments so "./a.js" and "a.js" compare equal.
  name = parts.filter((p) => p !== '' && p !== '.').join('/');
  if (raw.endsWith('/') || raw.endsWith('\\')) name += '/';
  return { name, issues };
}

function findEocd(b) {
  const min = Math.max(0, b.length - 22 - 0xffff);
  for (let i = b.length - 22; i >= min; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && u32(b, i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Lists the entries of a ZIP archive without unpacking anything.
 * @returns {{entries: Array<object>, warnings: string[]}}
 */
export function listZip(zip, limits = DEFAULT_LIMITS) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  if (!(zip instanceof Uint8Array) || zip.length < 22) throw new PackageError('bad-zip', 'Archive is too small');
  const eocd = findEocd(zip);
  if (eocd < 0) throw new PackageError('bad-zip', 'End of central directory not found');
  const count = u16(zip, eocd + 10);
  const cdSize = u32(zip, eocd + 12);
  const cdOffset = u32(zip, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new PackageError('zip64', 'ZIP64 archives are not supported');
  }
  if (count > lim.maxEntries) throw new PackageError('too-many-files', 'Package has too many files');
  if (cdOffset + cdSize > eocd) throw new PackageError('bad-zip', 'Central directory is out of range');

  const entries = [];
  const warnings = [];
  const seen = new Set();
  let total = 0;
  let off = cdOffset;
  for (let i = 0; i < count; i++) {
    if (off + 46 > eocd || u32(zip, off) !== SIG_CEN) throw new PackageError('bad-zip', 'Corrupt central directory');
    const flags = u16(zip, off + 8);
    const method = u16(zip, off + 10);
    const compressedSize = u32(zip, off + 20);
    const size = u32(zip, off + 24);
    const nameLen = u16(zip, off + 28);
    const extraLen = u16(zip, off + 30);
    const commentLen = u16(zip, off + 32);
    const localOffset = u32(zip, off + 42);
    if (nameLen > lim.maxNameBytes) throw new PackageError('bad-zip', 'File name too long');
    if (off + 46 + nameLen > eocd) throw new PackageError('bad-zip', 'Corrupt central directory');
    const raw = utf8.decode(zip.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commentLen;

    const { name, issues } = inspectName(raw);
    if (name.endsWith('/') || name === '') continue; // directory
    for (const issue of issues) warnings.push(`path:${issue}:${name}`);
    if (seen.has(name)) {
      warnings.push(`path:duplicate:${name}`);
      continue;
    }
    seen.add(name);
    total += size;
    if (total > lim.maxTotalBytes) throw new PackageError('too-large', 'Package unpacks to more than the size limit');
    entries.push({ name, size, compressedSize, method, encrypted: (flags & 1) === 1, localOffset });
  }
  return { entries, warnings };
}

/**
 * Unpacks one entry. Returns {data} or {data: null, skipped: reason}.
 */
export function readEntry(zip, entry, limits = DEFAULT_LIMITS) {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  if (entry.encrypted) return { data: null, skipped: 'encrypted' };
  if (entry.size > lim.maxFileBytes) return { data: null, skipped: 'too-large' };
  if (entry.size >= lim.ratioMinBytes && entry.size > Math.max(1, entry.compressedSize) * lim.maxRatio) {
    return { data: null, skipped: 'compression-ratio' };
  }
  const lo = entry.localOffset;
  if (lo + 30 > zip.length || u32(zip, lo) !== SIG_LOC) return { data: null, skipped: 'corrupt' };
  const start = lo + 30 + u16(zip, lo + 26) + u16(zip, lo + 28);
  const end = start + entry.compressedSize;
  if (end > zip.length) return { data: null, skipped: 'corrupt' };
  const raw = zip.subarray(start, end);
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) return { data: null, skipped: 'corrupt' };
    return { data: raw };
  }
  if (entry.method !== 8) return { data: null, skipped: 'unsupported-method' };
  try {
    // With a fixed output buffer fflate never grows it, so memory stays at the declared
    // size whatever the compressed stream contains. One spare byte reveals a stream that
    // inflates to more than it declared.
    const out = inflateSync(raw, { out: new Uint8Array(entry.size + 1) });
    if (out.length !== entry.size) return { data: null, skipped: 'size-mismatch' };
    return { data: out };
  } catch {
    return { data: null, skipped: 'corrupt' };
  }
}
