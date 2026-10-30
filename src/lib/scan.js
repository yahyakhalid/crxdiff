// Text scanners used on files from untrusted packages. Every regular expression here
// is linear: no nested or overlapping quantifiers, and long runs are measured with
// plain loops instead of regexes, so a crafted file cannot cause catastrophic
// backtracking. Each file is also truncated to MAX_SCAN_CHARS before scanning.

export const MAX_SCAN_CHARS = 8 * 1024 * 1024;
export const MAX_HOSTS_PER_FILE = 2000;
export const MAX_HITS_PER_PATTERN = 10000;

// Hosts that appear in code as identifiers, not as network destinations.
const NAMESPACE_HOSTS = new Set([
  'www.w3.org',
  'w3.org',
  'ns.adobe.com',
  'purl.org',
  'xmlns.com',
  'schemas.xmlsoap.org',
  'schemas.microsoft.com',
  'schema.org',
  'example.com',
  'example.org',
  'example.net',
  'www.example.com',
  'localhost',
]);

// Second-level public suffixes common enough to matter when grouping hosts by site.
// This is a deliberately small approximation of the Public Suffix List.
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.jp', 'ne.jp', 'or.jp',
  'co.kr', 'co.nz', 'co.in', 'co.za', 'com.br', 'com.cn', 'com.tr', 'com.mx', 'com.ar', 'com.sa',
  'com.eg', 'com.iq', 'com.tw', 'com.hk', 'com.sg', 'co.id', 'co.il', 'com.ua', 'com.pl', 'com.vn',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'herokuapp.com',
  'appspot.com', 'web.app', 'firebaseapp.com', 'blogspot.com', 'cloudfront.net', 'azurewebsites.net',
  'amazonaws.com', 's3.amazonaws.com', 'r2.dev', 'glitch.me', 'repl.co', 'onrender.com', 'fly.dev',
]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Returns a cleaned hostname, or null if `raw` is not a plausible public host. */
export function cleanHost(raw) {
  let h = raw.toLowerCase();
  while (h.endsWith('.') || h.endsWith('-')) h = h.slice(0, -1);
  if (h.length < 4 || h.length > 253) return null;
  if (IPV4.test(h)) {
    const parts = h.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    if (parts[0] === 127 || parts[0] === 0) return null;
    return h;
  }
  const labels = h.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => l.length <= 63 && LABEL.test(l))) return null;
  if (!TLD.test(labels[labels.length - 1])) return null;
  if (NAMESPACE_HOSTS.has(h)) return null;
  return h;
}

/** Approximate registrable domain ("site") of a host, used to group subdomains. */
export function siteOf(host) {
  if (IPV4.test(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const last2 = labels.slice(-2).join('.');
  const last3 = labels.slice(-3).join('.');
  if (MULTI_PART_SUFFIXES.has(last3) && labels.length >= 4) return labels.slice(-4).join('.');
  if (MULTI_PART_SUFFIXES.has(last2)) return last3;
  return last2;
}

// Scheme, optional JSON-escaped slashes, then a run of host characters.
const URL_RE = /\b(?:https?|wss?):\\?\/\\?\/([a-z0-9.-]{1,253})/gi;

/** Hosts referenced by absolute http(s)/ws(s) URLs in `text`. */
export function extractHosts(text) {
  const out = new Set();
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    const h = cleanHost(m[1]);
    if (h) {
      out.add(h);
      if (out.size >= MAX_HOSTS_PER_FILE) break;
    }
  }
  return out;
}

/**
 * Code patterns worth knowing about when they appear for the first time.
 * `points` is what a first appearance adds to an update's score (see risk.js).
 */
export const PATTERNS = [
  { id: 'eval', re: /(?:^|[^\w$.])eval\s*\(|\b(?:window|self|globalThis)\.eval\s*\(/g },
  { id: 'function-constructor', re: /\bnew\s+Function\s*\(|(?:^|[^\w$.])Function\s*\(\s*["'`]/g },
  { id: 'string-timer', re: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/g },
  { id: 'document-write', re: /\bdocument\.write(?:ln)?\s*\(/g },
  { id: 'script-element', re: /createElement\s*\(\s*["'`]script["'`]\s*\)/gi },
  { id: 'remote-import-scripts', re: /\bimportScripts\s*\(\s*["'`](?:https?:)?\/\//g },
  { id: 'remote-dynamic-import', re: /\bimport\s*\(\s*["'`](?:https?:)?\/\//g },
  { id: 'execute-script', re: /\b(?:chrome|browser)\.(?:scripting\.executeScript|tabs\.executeScript)\b/g },
  { id: 'execute-script-code', re: /\bexecuteScript\s*\(\s*(?:\d+\s*,\s*)?\{[^{}]{0,300}\bcode\s*:/g },
  { id: 'dynamic-header-rules', re: /\b(?:updateDynamicRules|updateSessionRules)\b/g },
  { id: 'websocket', re: /\bnew\s+WebSocket\s*\(/g },
];

const SECURITY_HEADER_RE = /\b(?:content-security-policy|x-frame-options|strict-transport-security|x-content-type-options|cross-origin-(?:opener|embedder|resource)-policy)\b/i;

/** Counts pattern hits in one code file. Returns {patternId: count} for hits > 0. */
export function scanPatterns(text) {
  const hits = {};
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let n = 0;
    while (p.re.exec(text) !== null && n < MAX_HITS_PER_PATTERN) n++;
    if (n > 0) hits[p.id] = n;
  }
  // Dynamic DNR rules only matter here when the same file also names a security header.
  if (hits['dynamic-header-rules']) {
    if (/\bmodifyHeaders\b/.test(text) && SECURITY_HEADER_RE.test(text)) hits['dynamic-header-rules'] = 1;
    else delete hits['dynamic-header-rules'];
  }
  return hits;
}

/**
 * Shape metrics for one JS file, computed with plain loops.
 * - minified: long average line length (normal for bundled code)
 * - obfuscated: patterns typical of obfuscators (`_0x1a2b` identifiers, walls of
 *   `\x41` escapes, or very long base64 runs)
 */
export function codeShape(text) {
  const len = text.length;
  let lines = 1;
  let longestLine = 0;
  let cur = 0;
  let b64Run = 0;
  let longestB64 = 0;
  let hexEscapes = 0;
  let ox = 0;
  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      lines++;
      if (cur > longestLine) longestLine = cur;
      cur = 0;
    } else cur++;
    const isB64 = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61;
    if (isB64) {
      b64Run++;
      if (b64Run > longestB64) longestB64 = b64Run;
    } else b64Run = 0;
    if (c === 92 && text.charCodeAt(i + 1) === 120) hexEscapes++; // \x
    if (c === 95 && text.charCodeAt(i + 1) === 48 && text.charCodeAt(i + 2) === 120) {
      // _0x followed by 4-6 hex digits
      let j = i + 3;
      while (j < len && j < i + 9 && isHex(text.charCodeAt(j))) j++;
      if (j - (i + 3) >= 4) ox++;
    }
  }
  if (cur > longestLine) longestLine = cur;
  const avgLine = len / lines;
  const minified = len > 20000 && avgLine > 500;
  const obfuscated = ox >= 30 || (hexEscapes >= 300 && hexEscapes * 4 > len * 0.05) || longestB64 >= 20000;
  return { minified, obfuscated, longestLine, obfuscationHints: { ox, hexEscapes, longestB64 } };
}

function isHex(c) {
  return (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}

export const SECURITY_HEADERS = new Set([
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'x-content-type-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'permissions-policy',
  'x-xss-protection',
]);

/**
 * Finds static declarativeNetRequest rules that remove or overwrite security response
 * headers (what QuickLens did in February 2026). Returns {header: count}.
 */
export function scanDnrRules(rules, maxRules = 500000) {
  const found = {};
  if (!Array.isArray(rules)) return found;
  const n = Math.min(rules.length, maxRules);
  for (let i = 0; i < n; i++) {
    const action = rules[i] && rules[i].action;
    if (!action || action.type !== 'modifyHeaders' || !Array.isArray(action.responseHeaders)) continue;
    for (const h of action.responseHeaders) {
      if (!h || typeof h.header !== 'string') continue;
      const name = h.header.toLowerCase();
      if (SECURITY_HEADERS.has(name) && (h.operation === 'remove' || h.operation === 'set')) {
        const key = `${name}:${h.operation}`;
        found[key] = (found[key] || 0) + 1;
      }
    }
  }
  return found;
}
