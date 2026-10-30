import { applyI18n, t, h, versions, levelChip, extIcon, fmtAgo, reportUrl, findingTitle, send, fmtNum } from '../shared/ui.js';
import { getReportIndex, getRecords, getMeta, unreviewedCount } from '../lib/state.js';

applyI18n();

const $ = (id) => document.getElementById(id);

async function render() {
  const [index, records, meta] = await Promise.all([getReportIndex(), getRecords(), getMeta()]);
  const watching = records.filter((r) => r.status !== 'skipped').length;
  const skipped = records.filter((r) => r.status === 'skipped').length;
  const toReview = unreviewedCount(index);

  $('status').textContent = meta.lastRunAt ? t('popup_lastCheck', fmtAgo(meta.lastRunAt)) : t('popup_never');

  const tally = $('tally');
  tally.replaceChildren(
    h('li', { class: toReview ? 'hot' : null }, tallyText('popup_toReview', toReview)),
    h('li', null, tallyText('popup_watching', watching)),
    h('li', null, tallyText('popup_notChecked', skipped)),
  );

  const cards = $('cards');
  const recent = index.slice(0, 5);
  $('empty').hidden = recent.length > 0;
  cards.replaceChildren(...recent.map(card));
}

// Puts the number in <b> while keeping the translated sentence order.
function tallyText(key, n) {
  const [before, after = ''] = t(key, '\u0000').split('\u0000');
  return [before, h('b', null, fmtNum(n)), after];
}

function card(r) {
  const reason = r.top && r.top[0];
  return h(
    'li',
    { class: `card ${r.level}${r.reviewed ? ' reviewed' : ''}` },
    extIcon(r.id, 32, r.name),
    h('div', { class: 'card-head' }, h('span', { class: 'card-name', title: r.name }, r.name), levelChip(r.level)),
    h('div', { class: 'card-meta' }, versions(r.fromVersion, r.toVersion), h('span', { class: 'muted' }, fmtAgo(r.createdAt)), r.autoDisabled && !r.reenabled ? h('span', { class: 'off' }, t('auto_disabled')) : null, r.reviewed ? h('span', { class: 'muted' }, '✓ ' + t('reviewed')) : null),
    h('p', { class: 'card-reason' }, reason ? [findingTitle(reason), ' ', h('span', { class: 'pts' }, '+' + reason.points)] : t('level_' + r.level + '_hint'), ' ', h('a', { href: reportUrl(r.rid), target: '_blank' }, t('open_report'))),
  );
}

$('check').addEventListener('click', async () => {
  const btn = $('check');
  btn.disabled = true;
  btn.textContent = t('popup_checking');
  $('status').textContent = t('popup_checking');
  try {
    await send('check-now');
  } finally {
    btn.disabled = false;
    btn.textContent = t('popup_checkNow');
    await render();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.reportIndex || changes.meta)) render();
});

render();
