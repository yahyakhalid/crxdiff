// The update-watching logic, with every browser API injected so it can be tested in
// Node with fakes. background.js wires it to chrome.*.

import { buildSnapshot, baselineStatus, compareVersions } from './snapshot.js';
import { compareSnapshots, compareManagementInfo, managementAccess, isStoreUpdateUrl } from './diff.js';
import { levelFor } from './risk.js';
import { isExtensionId } from './crx.js';

const MAX_REPORTS = 100;

/** Why an installed item is not checked, or null if it is. */
export function notCheckedReason(ext, { selfId, ignored = [] } = {}) {
  if (ext.id === selfId) return { code: 'self' };
  if (!isExtensionId(ext.id)) return { code: 'r_other' };
  if (ext.type !== 'extension') return { code: 'r_not_extension' };
  if (ext.installType === 'development') return { code: 'r_unpacked' };
  if (ext.installType === 'admin') return { code: 'r_policy' };
  if (ext.installType === 'sideload') return { code: 'r_sideload' };
  if (ext.installType && ext.installType !== 'normal') return { code: 'r_other' };
  if (ext.updateUrl && !isStoreUpdateUrl(ext.updateUrl)) {
    let host = '';
    try {
      host = new URL(ext.updateUrl).host;
    } catch {
      host = '?';
    }
    if (/(^|\.)edge\.microsoft\.com$/i.test(host)) return { code: 'r_edge_store' };
    return { code: 'r_self_hosted', params: [host] };
  }
  if (ignored.includes(ext.id)) return { code: 'r_ignored' };
  return null;
}

export function managementInfo(ext) {
  return {
    version: ext.version,
    permissions: Array.isArray(ext.permissions) ? ext.permissions.slice(0, 200) : [],
    hostPermissions: Array.isArray(ext.hostPermissions) ? ext.hostPermissions.slice(0, 500) : [],
  };
}

function newRid(now, id) {
  return `${now.toString(36)}-${id.slice(0, 8)}`;
}

/**
 * @param {object} deps
 * @param {{get: Function, set: Function, remove: Function}} deps.storage chrome.storage.local-like
 * @param {{getAll: Function, setEnabled: Function}} deps.management
 * @param {(id: string) => Promise<Uint8Array>} deps.download
 * @param {string} deps.selfId
 * @param {() => number} [deps.now]
 * @param {(report: object, ext: object, settings: object) => Promise<void>|void} [deps.onReport]
 */
export function createMonitor(deps) {
  const now = deps.now || (() => Date.now());
  const st = deps.storage;

  const getOne = async (k) => (await st.get(k))[k];

  async function getSettings() {
    const s = (await getOne('settings')) || {};
    return {
      autoDisable: s.autoDisable === true,
      notify: s.notify !== false,
      ignored: Array.isArray(s.ignored) ? s.ignored : [],
    };
  }

  async function saveRecord(rec) {
    await st.set({ ['ext:' + rec.id]: rec });
  }

  async function addReport(report) {
    const index = (await getOne('reportIndex')) || [];
    index.unshift({
      rid: report.rid,
      id: report.id,
      name: report.name,
      fromVersion: report.fromVersion,
      toVersion: report.toVersion,
      level: report.level,
      score: report.score,
      kind: report.kind,
      createdAt: report.createdAt,
      reviewed: false,
      autoDisabled: !!report.autoDisabled,
      top: report.findings.filter((f) => f.points > 0).slice(0, 2),
    });
    const drop = index.slice(MAX_REPORTS).map((r) => 'report:' + r.rid);
    await st.set({ ['report:' + report.rid]: report, reportIndex: index.slice(0, MAX_REPORTS) });
    if (drop.length) await st.remove(drop);
  }

  async function snapshotOf(ext) {
    const bytes = await deps.download(ext.id);
    return buildSnapshot(bytes, { id: ext.id, now: now() });
  }

  async function finishReport(report, ext, settings) {
    if (settings.autoDisable && report.level === 'high' && ext.enabled) {
      if (ext.mayDisable === false) {
        report.notes.push({ code: 'n_auto_disable_failed' });
      } else {
        try {
          await deps.management.setEnabled(ext.id, false);
          report.autoDisabled = true;
          report.notes.push({ code: 'n_auto_disabled' });
        } catch {
          report.notes.push({ code: 'n_auto_disable_failed' });
        }
      }
    }
    await addReport(report);
    if (deps.onReport) await deps.onReport(report, ext, settings);
    return report;
  }

  function baseReport(ext, fromVersion, toVersion, kind) {
    return {
      rid: newRid(now(), ext.id),
      id: ext.id,
      name: String(ext.name || ext.id).slice(0, 200),
      createdAt: now(),
      kind,
      fromVersion,
      toVersion,
      notes: [],
      reviewed: false,
      autoDisabled: false,
    };
  }

  function partialReport(ext, rec, noteCode, noteParams) {
    const findings = compareManagementInfo(rec.mgmt || {}, managementInfo(ext));
    const score = findings.reduce((s, f) => s + f.points, 0);
    const report = baseReport(ext, rec.installedVersion, ext.version, 'partial');
    Object.assign(report, { findings, score, level: levelFor(score), access: managementAccess(rec.mgmt || {}, managementInfo(ext)) });
    report.notes.push({ code: noteCode, params: noteParams });
    return report;
  }

  /**
   * Handles one installed extension. Returns the new report, if any.
   */
  async function processExtension(ext, settings) {
    const reason = notCheckedReason(ext, { selfId: deps.selfId, ignored: settings.ignored });
    if (reason && reason.code === 'self') return null;
    const rec = (await getOne('ext:' + ext.id)) || { id: ext.id };
    rec.name = String(ext.name || ext.id).slice(0, 200);
    rec.enabled = !!ext.enabled;
    rec.lastCheckedAt = now();
    if (reason) {
      Object.assign(rec, { status: 'skipped', reason, installedVersion: ext.version });
      await saveRecord(rec);
      return null;
    }

    const baseline = await getOne('snap:' + ext.id);

    // 1. No baseline yet: take one and check that it matches the installed version.
    if (!baseline) {
      let snap;
      try {
        snap = await snapshotOf(ext);
      } catch (e) {
        rec.status = e && e.code === 'not-in-store' ? 'unavailable' : 'error';
        rec.lastError = (e && e.code) || 'error';
        rec.installedVersion = ext.version;
        rec.mgmt = managementInfo(ext);
        await saveRecord(rec);
        return null;
      }
      const status = baselineStatus(snap.version, ext.version);
      rec.installedVersion = ext.version;
      rec.mgmt = managementInfo(ext);
      rec.storeVersion = snap.version;
      delete rec.lastError;
      if (status === 'store-behind') {
        // Older than what is installed: comparing with it later would report changes
        // that were already there. Keep nothing and try again next time.
        rec.status = 'baseline-behind';
        await saveRecord(rec);
        return null;
      }
      rec.status = status === 'matched' ? 'watching' : 'baseline-ahead';
      rec.baselineVersion = snap.version;
      rec.baselineAt = snap.takenAt;
      await st.set({ ['ext:' + ext.id]: rec, ['snap:' + ext.id]: snap });
      return null;
    }

    // 2. Nothing changed since the last check.
    if (ext.version === rec.installedVersion) {
      await saveRecord(rec);
      return null;
    }

    // 3. Chrome caught up with a baseline that was taken ahead of the install.
    if (compareVersions(ext.version, baseline.version) === 0) {
      const report = partialReport(ext, rec, 'n_no_old_package', [rec.installedVersion]);
      Object.assign(rec, { installedVersion: ext.version, mgmt: managementInfo(ext), status: 'watching' });
      await saveRecord(rec);
      return finishReport(report, ext, settings);
    }

    // 4. A real update: download the new package and compare it with the baseline.
    let snap;
    try {
      snap = await snapshotOf(ext);
    } catch (e) {
      rec.status = e && e.code === 'not-in-store' ? 'unavailable' : 'error';
      rec.lastError = (e && e.code) || 'error';
      await saveRecord(rec);
      return null; // installedVersion is left alone so the next run retries.
    }
    const status = baselineStatus(snap.version, ext.version);
    if (status === 'store-behind') {
      const report = partialReport(ext, rec, 'n_store_behind', [snap.version, ext.version]);
      Object.assign(rec, { installedVersion: ext.version, mgmt: managementInfo(ext), status: 'baseline-behind', storeVersion: snap.version });
      await saveRecord(rec);
      return finishReport(report, ext, settings);
    }
    const diff = compareSnapshots(baseline, snap);
    const report = baseReport(ext, baseline.version, snap.version, 'full');
    Object.assign(report, diff, { rid: report.rid, id: ext.id });
    if (status === 'store-ahead') report.notes.push({ code: 'n_store_ahead', params: [snap.version, ext.version] });
    if (snap.warnings && snap.warnings.length) {
      const pathIssues = snap.warnings.filter((w) => w.startsWith('path:'));
      if (pathIssues.length) report.notes.push({ code: 'n_warnings', params: [pathIssues.slice(0, 5).join(', ')] });
    }
    Object.assign(rec, {
      installedVersion: ext.version,
      mgmt: managementInfo(ext),
      status: status === 'matched' ? 'watching' : 'baseline-ahead',
      baselineVersion: snap.version,
      baselineAt: snap.takenAt,
      storeVersion: snap.version,
    });
    delete rec.lastError;
    await st.set({ ['ext:' + ext.id]: rec, ['snap:' + ext.id]: snap });
    return finishReport(report, ext, settings);
  }

  let running = null;
  let again = false;

  /**
   * Checks every installed extension (or only one). A call made while a run is in
   * progress schedules one more full run afterwards, so no event is lost.
   */
  function checkAll({ onlyId } = {}) {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      const settings = await getSettings();
      const all = await deps.management.getAll();
      const present = new Set(all.map((e) => e.id));
      const reports = [];
      let ok = true;
      for (const ext of all) {
        if (onlyId && ext.id !== onlyId) continue;
        try {
          const r = await processExtension(ext, settings);
          if (r) reports.push(r);
        } catch {
          ok = false;
        }
      }
      if (!onlyId) {
        // Forget extensions that were uninstalled.
        const keys = Object.keys(await st.get(null)).filter((k) => (k.startsWith('ext:') || k.startsWith('snap:')) && !present.has(k.slice(k.indexOf(':') + 1)));
        if (keys.length) await st.remove(keys);
      }
      await st.set({ meta: { lastRunAt: now(), lastRunOk: ok } });
      return reports;
    })().finally(() => {
      running = null;
      if (again) {
        again = false;
        checkAll();
      }
    });
    return running;
  }

  return { checkAll, processExtension };
}
