// chrome.storage.local layout, shared by the service worker and the pages.
//
//   settings          {autoDisable, notify, intervalHours, ignored[]}
//   meta              {lastRunAt, lastRunOk, running}
//   ext:<id>          per-extension record (status, versions, management info)
//   snap:<id>         baseline snapshot (manifest, file hashes, hosts, patterns)
//   report:<rid>      full update report
//   reportIndex       newest-first list of report summaries

export const DEFAULT_SETTINGS = Object.freeze({
  autoDisable: false,
  notify: true,
  intervalHours: 6,
  ignored: [],
});

export const INTERVALS = [1, 3, 6, 12, 24];
export const MAX_REPORTS = 100;

const area = () => chrome.storage.local;

export async function getSettings() {
  const { settings } = await area().get('settings');
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  if (!INTERVALS.includes(s.intervalHours)) s.intervalHours = DEFAULT_SETTINGS.intervalHours;
  s.ignored = Array.isArray(s.ignored) ? s.ignored.filter((x) => typeof x === 'string') : [];
  s.autoDisable = s.autoDisable === true;
  s.notify = s.notify !== false;
  return s;
}

export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await area().set({ settings: s });
  return s;
}

export async function getMeta() {
  const { meta } = await area().get('meta');
  return meta || { lastRunAt: 0, lastRunOk: null };
}

export async function getRecords() {
  const all = await area().get(null);
  return Object.keys(all)
    .filter((k) => k.startsWith('ext:'))
    .map((k) => all[k]);
}

export async function getRecord(id) {
  const k = 'ext:' + id;
  return (await area().get(k))[k] || null;
}

export async function getSnapshot(id) {
  const k = 'snap:' + id;
  return (await area().get(k))[k] || null;
}

export async function getReportIndex() {
  const { reportIndex } = await area().get('reportIndex');
  return Array.isArray(reportIndex) ? reportIndex : [];
}

export async function getReport(rid) {
  if (typeof rid !== 'string' || !/^[a-z0-9-]{1,80}$/.test(rid)) return null;
  const k = 'report:' + rid;
  return (await area().get(k))[k] || null;
}

/** Updates one report and its index entry. */
export async function patchReport(rid, patch) {
  const report = await getReport(rid);
  if (!report) return null;
  Object.assign(report, patch);
  const index = (await getReportIndex()).map((r) => (r.rid === rid ? { ...r, ...patch } : r));
  await area().set({ ['report:' + rid]: report, reportIndex: index });
  return report;
}

export function summarize(report) {
  return {
    rid: report.rid,
    id: report.id,
    name: report.name,
    fromVersion: report.fromVersion,
    toVersion: report.toVersion,
    level: report.level,
    score: report.score,
    kind: report.kind,
    createdAt: report.createdAt,
    reviewed: !!report.reviewed,
    autoDisabled: !!report.autoDisabled,
    reenabled: !!report.reenabled,
    top: (report.findings || []).filter((f) => f.points > 0).slice(0, 2),
  };
}

export async function addReport(report) {
  const index = await getReportIndex();
  index.unshift(summarize(report));
  const keep = index.slice(0, MAX_REPORTS);
  const drop = index.slice(MAX_REPORTS).map((r) => 'report:' + r.rid);
  await area().set({ ['report:' + report.rid]: report, reportIndex: keep });
  if (drop.length) await area().remove(drop);
}

export function unreviewedCount(index) {
  return index.filter((r) => !r.reviewed && (r.level === 'high' || r.level === 'medium')).length;
}
