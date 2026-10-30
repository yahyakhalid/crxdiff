import { applyI18n, t, h, extIcon, fmtBytes } from '../shared/ui.js';
import { getSettings, saveSettings, getRecords } from '../lib/state.js';

applyI18n();

const $ = (id) => document.getElementById(id);
let savedTimer;

function saved() {
  $('saved').textContent = '✓ ' + t('opt_saved');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 2500);
}

async function render() {
  const s = await getSettings();
  $('autoDisable').checked = s.autoDisable;
  $('notify').checked = s.notify;
  $('interval').value = String(s.intervalHours);

  // Ignore list: every installed extension crxdiff could check, plus anything already ignored.
  const all = (await chrome.management.getAll()).filter((e) => e.id !== chrome.runtime.id && e.type === 'extension');
  all.sort((a, b) => a.name.localeCompare(b.name));
  $('ignore').replaceChildren(
    ...all.map((e) => {
      const box = h('input', { type: 'checkbox', id: 'ig-' + e.id });
      box.checked = s.ignored.includes(e.id);
      box.addEventListener('change', async () => {
        const cur = await getSettings();
        const set = new Set(cur.ignored);
        if (box.checked) set.add(e.id);
        else set.delete(e.id);
        await saveSettings({ ignored: [...set] });
        saved();
      });
      return h('li', null, box, h('label', { for: 'ig-' + e.id }, extIcon(e.id, 24, e.name), h('span', null, e.name)));
    }),
  );

  const used = await chrome.storage.local.getBytesInUse(null);
  $('usage').textContent = t('opt_storage', fmtBytes(used));
}

$('autoDisable').addEventListener('change', async (e) => {
  await saveSettings({ autoDisable: e.target.checked });
  saved();
});
$('notify').addEventListener('change', async (e) => {
  await saveSettings({ notify: e.target.checked });
  saved();
});
$('interval').addEventListener('change', async (e) => {
  await saveSettings({ intervalHours: Number(e.target.value) });
  saved();
});

$('export').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const out = { exportedAt: new Date().toISOString(), tool: 'crxdiff', version: chrome.runtime.getManifest().version, extensions: [] };
  for (const rec of await getRecords()) {
    out.extensions.push({ record: rec, baseline: all['snap:' + rec.id] || null });
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: '#' });
  a.href = url; // blob: URL of our own data, set directly
  a.download = `crxdiff-baselines-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

$('reset').addEventListener('click', async () => {
  if (!confirm(t('opt_reset_confirm'))) return;
  const s = await getSettings();
  await chrome.storage.local.clear();
  await saveSettings(s);
  await chrome.runtime.sendMessage({ type: 'refresh-badge' }).catch(() => {});
  $('saved').textContent = t('opt_reset_done');
  render();
});

render();
