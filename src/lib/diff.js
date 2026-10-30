// Compares two snapshots of the same extension and explains what changed.
// Pure: the output is plain data with message keys; the UI turns keys into text.

import { siteOf } from './scan.js';
import { PATTERN_POINTS, POINTS, permissionInfo, levelFor, severityFor } from './risk.js';

const MAX_LIST = 2000;
const MAX_DIFF_LINES = 4000;

const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const str = (v) => (typeof v === 'string' ? v : null);
const isHostPattern = (p) => p === '<all_urls>' || p.includes('://');

// Files the Web Store adds or rewrites on every upload; they are not the developer's code.
const STORE_GENERATED = /^_metadata\//;

export function isStoreUpdateUrl(u) {
  return typeof u === 'string' && /^https?:\/\/clients2\.google\.com\/service\/update2\/crx\/?$/i.test(u.trim());
}

/** True for match patterns that cover every site. */
export function isBroadPattern(p) {
  if (p === '<all_urls>') return true;
  const m = /^([a-z*]+):\/\/([^/]*)/i.exec(p);
  if (!m) return false;
  const host = m[2].toLowerCase();
  if (m[1] === 'file') return true;
  if (host === '*' || host === '') return true;
  // "*.com": a wildcard over a whole top-level domain.
  if (host.startsWith('*.') && !host.slice(2).includes('.')) return true;
  return false;
}

/** The parts of a manifest that matter for security, normalised for comparison. */
export function manifestFacts(m) {
  m = m && typeof m === 'object' ? m : {};
  const perms = strs(m.permissions);
  const optional = strs(m.optional_permissions);
  const cs = Array.isArray(m.content_scripts) ? m.content_scripts.filter((c) => c && typeof c === 'object') : [];
  const war = Array.isArray(m.web_accessible_resources) ? m.web_accessible_resources : [];
  const ec = m.externally_connectable && typeof m.externally_connectable === 'object' ? m.externally_connectable : {};
  let csp = null;
  if (typeof m.content_security_policy === 'string') csp = m.content_security_policy;
  else if (m.content_security_policy && typeof m.content_security_policy === 'object') {
    const o = m.content_security_policy;
    csp = ['extension_pages', 'sandbox']
      .filter((k) => typeof o[k] === 'string')
      .map((k) => `${k}: ${o[k]}`)
      .join('\n') || null;
  }
  const bg = m.background && typeof m.background === 'object' ? m.background : {};
  const author = str(m.author) || (m.author && typeof m.author === 'object' ? str(m.author.email) : null);
  return {
    manifestVersion: typeof m.manifest_version === 'number' ? m.manifest_version : null,
    name: str(m.name),
    apiPermissions: uniq(perms.filter((p) => !isHostPattern(p))),
    hostPermissions: uniq([...strs(m.host_permissions), ...perms.filter(isHostPattern)]),
    optionalApiPermissions: uniq(optional.filter((p) => !isHostPattern(p))),
    optionalHostPermissions: uniq([...strs(m.optional_host_permissions), ...optional.filter(isHostPattern)]),
    contentScriptMatches: uniq(cs.flatMap((c) => strs(c.matches))),
    mainWorld: cs.some((c) => c.world === 'MAIN'),
    csp: csp && csp.length > 8192 ? csp.slice(0, 8192) : csp,
    updateUrl: str(m.update_url),
    homepageUrl: str(m.homepage_url),
    author,
    externallyConnectable: uniq([...strs(ec.matches), ...strs(ec.ids)]),
    webAccessibleMatches: uniq(war.flatMap((w) => (w && typeof w === 'object' ? strs(w.matches) : []))),
    background: str(bg.service_worker) || strs(bg.scripts).join(', ') || null,
  };
}

function uniq(a) {
  return [...new Set(a)].sort();
}

function added(oldList, newList) {
  const s = new Set(oldList);
  return newList.filter((x) => !s.has(x));
}

function removed(oldList, newList) {
  return added(newList, oldList);
}

function finding(code, points, params = [], items = undefined) {
  const f = { code, points, severity: severityFor(points), params: params.map((p) => String(p)) };
  if (items && items.length) f.items = items.slice(0, 200).map((x) => String(x));
  return f;
}

function cspFlags(csp) {
  const c = (csp || '').slice(0, 8192);
  return {
    unsafeEval: /'unsafe-eval'/i.test(c),
    remote: /script-src[^;]*(?:\bhttps?:|\s\*(?:\s|;|$))/i.test(c),
  };
}

function listChange(oldList, newList) {
  return { added: added(oldList, newList), removed: removed(oldList, newList), kept: newList.filter((x) => oldList.includes(x)) };
}

/** Before/after lists for the "Permissions and access" table. */
function accessChanges(of, nf) {
  return {
    apiPermissions: listChange(of.apiPermissions, nf.apiPermissions),
    hostPermissions: listChange(of.hostPermissions, nf.hostPermissions),
    contentScriptMatches: listChange(of.contentScriptMatches, nf.contentScriptMatches),
    optional: listChange([...of.optionalApiPermissions, ...of.optionalHostPermissions], [...nf.optionalApiPermissions, ...nf.optionalHostPermissions]),
  };
}

/** Line diff (LCS) between two texts. Returns [{op: ' '|'+'|'-', text}]. */
export function lineDiff(a, b) {
  const A = String(a).split(/\r?\n/);
  const B = String(b).split(/\r?\n/);
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf);
  const b2 = B.slice(pre, B.length - suf);
  const out = A.slice(0, pre).map((text) => ({ op: ' ', text }));
  const n = a2.length;
  const m = b2.length;
  if (n * m > 4_000_000) {
    for (const text of a2) out.push({ op: '-', text });
    for (const text of b2) out.push({ op: '+', text });
  } else {
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a2[i] === b2[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) {
        out.push({ op: ' ', text: a2[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        out.push({ op: '-', text: a2[i++] });
      } else {
        out.push({ op: '+', text: b2[j++] });
      }
    }
    while (i < n) out.push({ op: '-', text: a2[i++] });
    while (j < m) out.push({ op: '+', text: b2[j++] });
  }
  for (const text of A.slice(A.length - suf)) out.push({ op: ' ', text });
  return out.length > MAX_DIFF_LINES ? out.slice(0, MAX_DIFF_LINES) : out;
}

function manifestForDiff(snap) {
  const t = snap.manifestText || '';
  // A one-line (minified) manifest is pretty-printed so the diff is readable.
  if (t.split('\n').length < 3 && snap.manifest) return JSON.stringify(snap.manifest, null, 2);
  return t.replace(/^\uFEFF/, '');
}

/**
 * Permission and host changes only, from chrome.management data. Used when no full
 * baseline package exists for the old version.
 */
const mgmtManifest = (i) => ({ permissions: strs(i && i.permissions), host_permissions: strs(i && i.hostPermissions) });

export function compareManagementInfo(oldInfo, newInfo) {
  return permissionFindings(manifestFacts(mgmtManifest(oldInfo)), manifestFacts(mgmtManifest(newInfo)));
}

export function managementAccess(oldInfo, newInfo) {
  return accessChanges(manifestFacts(mgmtManifest(oldInfo)), manifestFacts(mgmtManifest(newInfo)));
}

function permissionFindings(of, nf) {
  const findings = [];
  for (const p of added(of.apiPermissions, nf.apiPermissions)) {
    const info = permissionInfo(p);
    const code = info.warns === false ? 'f_perm_added_silent' : info.warns === true ? 'f_perm_added_warn' : 'f_perm_added_unknown';
    findings.push(finding(code, info.points, [p]));
  }
  const rp = removed(of.apiPermissions, nf.apiPermissions);
  if (rp.length) findings.push(finding('f_perm_removed', 0, [rp.length], rp));

  const newHosts = added(of.hostPermissions, nf.hostPermissions);
  const broadHosts = newHosts.filter(isBroadPattern);
  if (broadHosts.length && !of.hostPermissions.some(isBroadPattern)) {
    findings.push(finding('f_host_added_broad', POINTS.hostBroad, [broadHosts[0]], broadHosts));
  }
  const narrow = newHosts.filter((h) => !isBroadPattern(h));
  if (narrow.length) {
    findings.push(finding('f_host_added', Math.min(POINTS.hostCap, narrow.length * POINTS.hostEach), [narrow.length], narrow));
  }
  const rh = removed(of.hostPermissions, nf.hostPermissions);
  if (rh.length) findings.push(finding('f_host_removed', 0, [rh.length], rh));

  const optApi = added(of.optionalApiPermissions, nf.optionalApiPermissions);
  const optHosts = added(of.optionalHostPermissions, nf.optionalHostPermissions);
  if (optApi.length + optHosts.length) {
    findings.push(finding('f_optional_added', Math.min(15, 5 * (optApi.length + optHosts.length)), [optApi.length + optHosts.length], [...optApi, ...optHosts]));
  }
  return findings;
}

/**
 * @param {object} oldSnap snapshot from buildSnapshot()
 * @param {object} newSnap
 */
export function compareSnapshots(oldSnap, newSnap) {
  const of = manifestFacts(oldSnap.manifest);
  const nf = manifestFacts(newSnap.manifest);
  const findings = permissionFindings(of, nf);

  // Content scripts: where the extension injects code.
  const newMatches = added(of.contentScriptMatches, nf.contentScriptMatches);
  const broadMatches = newMatches.filter(isBroadPattern);
  if (broadMatches.length && !of.contentScriptMatches.some(isBroadPattern)) {
    findings.push(finding('f_match_added_broad', POINTS.matchBroad, [broadMatches[0]], broadMatches));
  }
  const narrowMatches = newMatches.filter((h) => !isBroadPattern(h));
  if (narrowMatches.length) {
    findings.push(finding('f_match_added', Math.min(POINTS.matchCap, narrowMatches.length * POINTS.matchEach), [narrowMatches.length], narrowMatches));
  }
  if (nf.mainWorld && !of.mainWorld) findings.push(finding('f_main_world', POINTS.mainWorld));

  // Content Security Policy.
  if ((of.csp || '') !== (nf.csp || '')) {
    const o = cspFlags(of.csp);
    const n = cspFlags(nf.csp);
    if (n.unsafeEval && !o.unsafeEval) findings.push(finding('f_csp_unsafe_eval', POINTS.cspUnsafeEval));
    if (n.remote && !o.remote) findings.push(finding('f_csp_remote', POINTS.cspRemote));
    findings.push(finding('f_csp_changed', POINTS.cspChanged, [of.csp || '-', nf.csp || '-']));
  }

  // Identity and update channel.
  if ((of.updateUrl || '') !== (nf.updateUrl || '')) {
    // Moving updates away from the Web Store is serious; the store adding its own
    // update_url to a package (or a package dropping it) is not.
    const offStore = nf.updateUrl !== null && !isStoreUpdateUrl(nf.updateUrl);
    findings.push(finding('f_update_url_changed', offStore ? POINTS.updateUrlChanged : 0, [of.updateUrl || '-', nf.updateUrl || '-']));
  }
  if ((of.homepageUrl || '') !== (nf.homepageUrl || '')) {
    findings.push(finding('f_homepage_changed', POINTS.homepageChanged, [of.homepageUrl || '-', nf.homepageUrl || '-']));
  }
  if ((of.author || '') !== (nf.author || '')) {
    findings.push(finding('f_author_changed', POINTS.authorChanged, [of.author || '-', nf.author || '-']));
  }
  if ((of.name || '') !== (nf.name || '')) findings.push(finding('f_name_changed', 0, [of.name || '-', nf.name || '-']));
  if (of.manifestVersion !== nf.manifestVersion) {
    findings.push(finding('f_mv_changed', 0, [of.manifestVersion ?? '-', nf.manifestVersion ?? '-']));
  }
  const ec = added(of.externallyConnectable, nf.externallyConnectable);
  if (ec.length) findings.push(finding('f_externally_connectable', POINTS.externallyConnectable, [ec.length], ec));

  // Static declarativeNetRequest rules that strip security headers.
  const oldDnr = oldSnap.dnrHeaders || {};
  const newDnr = Object.keys(newSnap.dnrHeaders || {}).filter((k) => !Object.hasOwn(oldDnr, k));
  if (newDnr.length) findings.push(finding('f_dnr_header', POINTS.dnrSecurityHeader, [newDnr.length], newDnr));

  // Risky code patterns that were not in the package before.
  const oldPat = oldSnap.patterns || {};
  const newPat = newSnap.patterns || {};
  const newPatternIds = [];
  for (const id of Object.keys(newPat)) {
    if (!Object.hasOwn(PATTERN_POINTS, id)) continue;
    if (Object.hasOwn(oldPat, id) && oldPat[id].count > 0) continue;
    newPatternIds.push(id);
    findings.push(finding('f_pattern_new', PATTERN_POINTS[id], ['pattern_' + id.replace(/-/g, '_')], newPat[id].files));
  }

  // Hosts referenced by code, grouped by site so a new subdomain of a known site is quiet.
  const oldHosts = new Set(oldSnap.hosts || []);
  const oldSites = new Set((oldSnap.hosts || []).map(siteOf));
  const hostSources = newSnap.hostSources || {};
  const dense = new Set(newSnap.denseFiles || []);
  const hostsAdded = (newSnap.hosts || [])
    .filter((h) => !oldHosts.has(h))
    .map((h) => {
      const file = Object.hasOwn(hostSources, h) ? hostSources[h] : null;
      return { host: h, site: siteOf(h), file, newSite: !oldSites.has(siteOf(h)), inData: dense.has(file) };
    });
  const newHostSet = new Set(newSnap.hosts || []);
  const hostsRemoved = (oldSnap.hosts || []).filter((h) => !newHostSet.has(h));
  const newSites = [...new Set(hostsAdded.filter((h) => h.newSite && !h.inData).map((h) => h.site))];
  if (newSites.length) {
    findings.push(finding('f_sites_new', Math.min(POINTS.siteCap, newSites.length * POINTS.siteEach), [newSites.length], newSites));
  }
  const dataSites = [...new Set(hostsAdded.filter((h) => h.newSite && h.inData).map((h) => h.site))].filter((x) => !newSites.includes(x));
  if (dataSites.length) findings.push(finding('f_sites_new_data', 0, [dataSites.length], dataSites));
  const remoteCodePattern = newPatternIds.some((id) => ['eval', 'function-constructor', 'script-element', 'remote-import-scripts', 'remote-dynamic-import', 'execute-script-code', 'string-timer'].includes(id));
  if (newSites.length && remoteCodePattern) findings.push(finding('f_remote_combo', POINTS.remoteCodeCombo));

  // Files.
  const own = (f) => !STORE_GENERATED.test(f.path);
  const oldFiles = new Map((oldSnap.files || []).filter(own).map((f) => [f.path, f]));
  const newFiles = new Map((newSnap.files || []).filter(own).map((f) => [f.path, f]));
  const filesAdded = [];
  const filesRemoved = [];
  const filesChanged = [];
  let unchanged = 0;
  for (const [path, f] of newFiles) {
    const o = oldFiles.get(path);
    if (!o) filesAdded.push(f);
    else if (o.sha256 && f.sha256 ? o.sha256 !== f.sha256 : o.size !== f.size) filesChanged.push({ ...f, oldSize: o.size, wasObfuscated: !!o.obfuscated });
    else unchanged++;
  }
  for (const [path, f] of oldFiles) if (!newFiles.has(path)) filesRemoved.push(f);

  const oldObf = (oldSnap.files || []).filter((f) => f.obfuscated).length;
  const newlyObf = [...filesAdded, ...filesChanged].filter((f) => f.obfuscated && !f.wasObfuscated).map((f) => f.path);
  const obfIncrease = (newSnap.files || []).filter((f) => f.obfuscated).length - oldObf;
  if (newlyObf.length && obfIncrease > 0) {
    findings.push(finding('f_obfuscated_new', Math.min(POINTS.obfuscatedCap, obfIncrease * POINTS.obfuscatedEach), [obfIncrease], newlyObf));
  }
  const newWasm = filesAdded.filter((f) => f.wasm).map((f) => f.path);
  if (newWasm.length && !(oldSnap.files || []).some((f) => f.wasm)) findings.push(finding('f_wasm_new', POINTS.wasm, [newWasm.length], newWasm));
  const newMin = filesAdded.filter((f) => f.minified && !f.obfuscated).map((f) => f.path);
  if (newMin.length) findings.push(finding('f_minified_new', 0, [newMin.length], newMin));

  const oldTotal = oldSnap.totalSize || 0;
  const newTotal = newSnap.totalSize || 0;
  if (newTotal > oldTotal * 2 && newTotal - oldTotal > 500 * 1024) {
    findings.push(finding('f_size_jump', POINTS.sizeJump, [oldTotal, newTotal]));
  }
  if ((of.background || '') !== (nf.background || '')) findings.push(finding('f_background_changed', 0, [of.background || '-', nf.background || '-']));

  findings.sort((a, b) => b.points - a.points);
  const score = findings.reduce((s, f) => s + f.points, 0);
  const brief = (f) => ({ path: f.path, size: f.size, oldSize: f.oldSize, minified: !!f.minified, obfuscated: !!f.obfuscated });
  return {
    schema: 1,
    id: newSnap.id || oldSnap.id || null,
    fromVersion: oldSnap.version,
    toVersion: newSnap.version,
    score,
    level: levelFor(score),
    findings,
    files: {
      added: filesAdded.slice(0, MAX_LIST).map(brief),
      removed: filesRemoved.slice(0, MAX_LIST).map(brief),
      changed: filesChanged.slice(0, MAX_LIST).map(brief),
      counts: { added: filesAdded.length, removed: filesRemoved.length, changed: filesChanged.length, unchanged },
    },
    hosts: { added: hostsAdded.slice(0, MAX_LIST), removed: hostsRemoved.slice(0, MAX_LIST) },
    access: accessChanges(of, nf),
    manifestDiff: lineDiff(manifestForDiff(oldSnap), manifestForDiff(newSnap)),
    totals: { oldSize: oldTotal, newSize: newTotal, oldFiles: oldFiles.size, newFiles: newFiles.size },
  };
}
