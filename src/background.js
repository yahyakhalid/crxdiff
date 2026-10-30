// Service worker: wires the monitor to chrome.* APIs, schedules checks, and keeps the
// badge and notifications in sync. No remote code, no content scripts.

import { createMonitor } from './lib/monitor.js';
import { downloadPackage } from './lib/fetch.js';
import { buildSnapshot } from './lib/snapshot.js';
import { getSettings, getReportIndex, unreviewedCount, patchReport, getReport } from './lib/state.js';

const ALARM = 'crxdiff-check';

function chromeVersion() {
  const m = /Chrome\/(\d+(?:\.\d+){0,3})/.exec(navigator.userAgent);
  return m ? m[1] : '120.0.0.0';
}

const monitor = createMonitor({
  storage: chrome.storage.local,
  management: chrome.management,
  selfId: chrome.runtime.id,
  download: (id) => downloadPackage(id, { prodversion: chromeVersion() }),
  onReport: async (report, ext, settings) => {
    await refreshBadge();
    const worth = report.level === 'high' || report.level === 'medium';
    if (!settings.notify || !worth) return;
    const t = chrome.i18n.getMessage(report.level === 'high' ? 'notif_title_high' : 'notif_title_medium').replace('{1}', report.name);
    const first = report.findings.find((f) => f.points > 0);
    let body = `${report.fromVersion} → ${report.toVersion}`;
    if (first) body += ` · ${chrome.i18n.getMessage(first.code).replace('{1}', first.params[0] || '')}`;
    if (report.autoDisabled) body += ` · ${chrome.i18n.getMessage('notif_disabled')}`;
    const buttons = [{ title: chrome.i18n.getMessage('notif_open') }];
    if (report.autoDisabled) buttons.push({ title: chrome.i18n.getMessage('notif_reenable') });
    chrome.notifications.create('report:' + report.rid, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: t,
      message: body.slice(0, 300),
      buttons,
      priority: report.level === 'high' ? 2 : 0,
      requireInteraction: report.level === 'high',
    });
  },
});

// For inspection from DevTools (and the experiment in docs/experiment.md): downloads
// and summarises one Web Store package exactly as a real check would.
globalThis.crxdiffDebug = {
  chromeVersion,
  async snapshot(id) {
    const bytes = await downloadPackage(id, { prodversion: chromeVersion() });
    const snap = await buildSnapshot(bytes, { id });
    return { id: snap.id, version: snap.version, format: snap.format, files: snap.files.length, bytes: bytes.length, totalSize: snap.totalSize, ms: snap.ms };
  },
};

async function refreshBadge() {
  const index = await getReportIndex();
  const n = unreviewedCount(index);
  const high = index.some((r) => !r.reviewed && r.level === 'high');
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: high ? '#b3261e' : '#8a5300' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
}

async function schedule() {
  const { intervalHours } = await getSettings();
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== intervalHours * 60) {
    await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: intervalHours * 60 });
  }
}

async function logEvent(kind, info) {
  // A short in-memory log (cleared when the browser closes), shown nowhere by default;
  // used to verify which event noticed an update.
  const { events = [] } = await chrome.storage.session.get('events');
  events.unshift({ kind, id: info.id, version: info.version, at: Date.now() });
  await chrome.storage.session.set({ events: events.slice(0, 50) });
}

chrome.runtime.onInstalled.addListener(async () => {
  await schedule();
  await monitor.checkAll();
  await refreshBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  await schedule();
  await monitor.checkAll();
  await refreshBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM) await monitor.checkAll();
});

// Fires when another extension is installed or updated (see docs/experiment.md).
chrome.management.onInstalled.addListener(async (info) => {
  await logEvent('management.onInstalled', info);
  await monitor.checkAll({ onlyId: info.id });
});

chrome.management.onUninstalled.addListener(async (id) => {
  await chrome.storage.local.remove(['ext:' + id, 'snap:' + id]);
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.settings) await schedule();
  if (changes.reportIndex) await refreshBadge();
});

async function openReport(rid) {
  await chrome.tabs.create({ url: chrome.runtime.getURL('report/report.html?r=' + encodeURIComponent(rid)) });
}

chrome.notifications.onClicked.addListener(async (nid) => {
  if (nid.startsWith('report:')) await openReport(nid.slice(7));
  chrome.notifications.clear(nid);
});

chrome.notifications.onButtonClicked.addListener(async (nid, button) => {
  if (!nid.startsWith('report:')) return;
  const rid = nid.slice(7);
  if (button === 0) await openReport(rid);
  if (button === 1) {
    const report = await getReport(rid);
    if (report) {
      try {
        await chrome.management.setEnabled(report.id, true);
        await patchReport(rid, { reenabled: true });
      } catch {
        await openReport(rid);
      }
    }
  }
  chrome.notifications.clear(nid);
});

// Messages from crxdiff's own pages only.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) return false;
  if (msg && msg.type === 'check-now') {
    monitor
      .checkAll()
      .then((reports) => sendResponse({ ok: true, reports: reports.length }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'refresh-badge') {
    refreshBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
