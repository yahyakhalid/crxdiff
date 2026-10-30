// Builds a compact "snapshot" of one extension package: the manifest, every file's
// size and SHA-256, the hosts its code references and the risky patterns it uses.
// Only this summary is stored, never the source code itself.

import { parseCrx, PackageError } from './crx.js';
import { listZip, readEntry, DEFAULT_LIMITS } from './zip.js';
import { extractHosts, scanPatterns, codeShape, scanDnrRules, MAX_SCAN_CHARS } from './scan.js';

export const SNAPSHOT_SCHEMA = 1;
const MAX_MANIFEST_CHARS = 256 * 1024;
const MAX_HOSTS = 5000;
const MAX_RULE_FILE_BYTES = 32 * 1024 * 1024;
const DEFAULT_TIME_BUDGET_MS = 90 * 1000;
// A file that names this many hosts is treated as data (a filter list, a bundled
// dataset), not as code that talks to those hosts. New hosts from such files are
// listed but do not add points.
export const DENSE_FILE_HOSTS = 40;

const CODE_EXT = /\.(?:m?js|cjs|html?|xhtml)$/i;
const JS_EXT = /\.(?:m?js|cjs)$/i;

const decoder = new TextDecoder('utf-8', { fatal: false });

function decode(bytes) {
  const slice = bytes.length > MAX_SCAN_CHARS ? bytes.subarray(0, MAX_SCAN_CHARS) : bytes;
  return decoder.decode(slice);
}

async function sha256(bytes) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function parseManifestText(text) {
  const clean = text.replace(/^\uFEFF/, '');
  const obj = JSON.parse(clean);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new PackageError('bad-manifest', 'manifest.json is not an object');
  return obj;
}

function ruleFilePaths(manifest) {
  const dnr = manifest.declarative_net_request;
  const res = dnr && Array.isArray(dnr.rule_resources) ? dnr.rule_resources : [];
  const out = [];
  for (const r of res) {
    if (r && typeof r.path === 'string') {
      out.push(r.path.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.').join('/'));
    }
  }
  return out;
}

/**
 * @param {Uint8Array} packageBytes CRX or ZIP bytes
 * @param {{id?: string, now?: number, limits?: object, timeBudgetMs?: number}} [opts]
 */
export async function buildSnapshot(packageBytes, opts = {}) {
  const started = Date.now();
  const budget = opts.timeBudgetMs || DEFAULT_TIME_BUDGET_MS;
  const crx = parseCrx(packageBytes, { expectedId: opts.id });
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const { entries, warnings } = listZip(crx.zip, limits);

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw new PackageError('no-manifest', 'Package has no manifest.json');
  const mRead = readEntry(crx.zip, manifestEntry, limits);
  if (!mRead.data || mRead.data.length > MAX_MANIFEST_CHARS) throw new PackageError('bad-manifest', 'manifest.json could not be read');
  const manifestText = decoder.decode(mRead.data);
  const manifest = parseManifestText(manifestText);
  const rulePaths = new Set(ruleFilePaths(manifest));

  const files = [];
  const hostFiles = new Map(); // host -> first file it was seen in
  const patterns = {}; // id -> {count, files[]}
  const dnrHeaders = {}; // "header:op" -> count
  const denseFiles = [];
  let totalSize = 0;

  for (const entry of entries) {
    if (Date.now() - started > budget) throw new PackageError('timeout', 'Analysis took too long');
    totalSize += entry.size;
    const rec = { path: entry.name, size: entry.size };
    const r = readEntry(crx.zip, entry, limits);
    if (!r.data) {
      rec.skipped = r.skipped;
      warnings.push(`file:${r.skipped}:${entry.name}`);
      files.push(rec);
      continue;
    }
    rec.sha256 = await sha256(r.data);
    if (r.data.length > MAX_SCAN_CHARS && CODE_EXT.test(entry.name)) {
      rec.truncated = true;
      warnings.push(`file:scan-truncated:${entry.name}`);
    }
    if (CODE_EXT.test(entry.name)) {
      const text = decode(r.data);
      const fileHosts = extractHosts(text);
      if (fileHosts.size >= DENSE_FILE_HOSTS) denseFiles.push(entry.name);
      for (const h of fileHosts) {
        if (!hostFiles.has(h) && hostFiles.size < MAX_HOSTS) hostFiles.set(h, entry.name);
      }
      const hits = scanPatterns(text);
      for (const id of Object.keys(hits)) {
        const p = patterns[id] || (patterns[id] = { count: 0, files: [] });
        p.count += hits[id];
        if (p.files.length < 20) p.files.push(entry.name);
      }
      if (JS_EXT.test(entry.name)) {
        const shape = codeShape(text);
        if (shape.minified) rec.minified = true;
        if (shape.obfuscated) rec.obfuscated = true;
      }
    } else if (entry.name.toLowerCase().endsWith('.wasm')) {
      rec.wasm = true;
    }
    if (rulePaths.has(entry.name) && r.data.length <= MAX_RULE_FILE_BYTES) {
      try {
        const found = scanDnrRules(JSON.parse(decoder.decode(r.data)));
        for (const k of Object.keys(found)) dnrHeaders[k] = (dnrHeaders[k] || 0) + found[k];
      } catch {
        warnings.push(`file:bad-rules-json:${entry.name}`);
      }
    }
    files.push(rec);
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hosts = [...hostFiles.keys()].sort();
  const hostSources = {};
  for (const h of hosts) hostSources[h] = hostFiles.get(h);

  return {
    schema: SNAPSHOT_SCHEMA,
    id: opts.id || crx.crxId || null,
    version: typeof manifest.version === 'string' ? manifest.version : String(manifest.version ?? ''),
    takenAt: opts.now ?? Date.now(),
    format: crx.format,
    manifest,
    manifestText: manifestText.length > MAX_MANIFEST_CHARS ? manifestText.slice(0, MAX_MANIFEST_CHARS) : manifestText,
    files,
    totalSize,
    hosts,
    hostSources,
    denseFiles: denseFiles.sort(),
    patterns,
    dnrHeaders,
    warnings: warnings.slice(0, 200),
    ms: Date.now() - started,
  };
}

/** Chrome-style version comparison: dotted integers. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Decides whether a freshly downloaded snapshot can serve as the baseline for the
 * version that is actually installed (hypothesis 3: the store serves only the latest).
 * @returns {'matched'|'store-ahead'|'store-behind'}
 */
export function baselineStatus(snapshotVersion, installedVersion) {
  const c = compareVersions(snapshotVersion, installedVersion);
  return c === 0 ? 'matched' : c > 0 ? 'store-ahead' : 'store-behind';
}
