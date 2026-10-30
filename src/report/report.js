import { applyI18n, t, h, versions, levelChip, extIcon, fmtAgo, fmtDate, fmtBytes, fmtNum, reportUrl, findingTitle, findingWhy, send } from '../shared/ui.js';
import { getReport, getReportIndex, getRecords, patchReport } from '../lib/state.js';

applyI18n();

const main = document.getElementById('main');
const rid = new URLSearchParams(location.search).get('r');
const LEVELS = ['high', 'medium', 'low', 'none'];
const lvl = (l) => (LEVELS.includes(l) ? l : 'none');
const SEV_GLYPH = { high: '▲', medium: '◆', low: '●', info: '○' };

let secCount = 0;
function section(titleKey, ...content) {
  secCount++;
  const id = 'sec-' + secCount;
  return h('section', { class: 'sec', 'aria-labelledby': id }, h('div', { class: 'sec-head' }, h('span', { class: 'sec-num', 'aria-hidden': 'true' }, String(secCount).padStart(2, '0')), h('h2', { id }, t(titleKey))), ...content);
}

function chips(list, cls = '', limit = 12) {
  const shown = list.slice(0, limit);
  const wrap = h('div', { class: 'items' }, shown.map((x) => h('span', { class: `chip ${cls}` }, x)));
  if (list.length > limit) {
    const btn = h('button', { class: 'btn', type: 'button' }, t('report_show_all', fmtNum(list.length)));
    btn.addEventListener('click', () => {
      btn.remove();
      wrap.append(...list.slice(limit).map((x) => h('span', { class: `chip ${cls}` }, x)));
    });
    wrap.append(' ', btn);
  }
  return wrap;
}

/* ---------------- Single report ---------------- */

async function renderReport(id) {
  const r = await getReport(id);
  document.title = t('report_doc_title');
  if (!r) {
    main.replaceChildren(h('p', { class: 'crumb' }, h('a', { href: 'report.html' }, t('report_back'))), h('p', { class: 'empty' }, t('report_not_found')));
    return;
  }
  const level = lvl(r.level);
  const findings = Array.isArray(r.findings) ? r.findings : [];

  const head = [
    h('p', { class: 'crumb' }, h('a', { href: 'report.html' }, (document.dir === 'rtl' ? '→ ' : '← ') + t('report_back'))),
    h('div', { class: 'subject' }, extIcon(r.id, 48, r.name), h('h1', null, r.name)),
    h('div', { class: 'subject-meta' }, versions(r.fromVersion, r.toVersion), h('span', null, t('report_detected', fmtDate(r.createdAt))), h('span', { class: 'ext-id' }, r.id), r.kind === 'partial' ? h('span', { class: 'tag' }, t('partial_report')) : null),
  ];

  // Verdict: the stamp, the plain-language hint, and the score on a scale.
  const pct = Math.min(100, Math.max(0, r.score || 0));
  const actions = h('div', { class: 'verdict-actions' });
  const verdict = h(
    'div',
    { class: 'verdict' },
    h('div', null, h('span', { class: `stamp ${level}` }, t('level_' + level)), h('p', { class: 'verdict-hint' }, t(`level_${level}_hint`)), ...(r.notes || []).map((n) => h('p', { class: `callout${n.code === 'n_auto_disabled' ? ' high' : ''}` }, t(n.code, ...(n.params || [])))), actions),
    h(
      'div',
      { class: 'score' },
      h('span', { class: 'score-num' }, fmtNum(r.score || 0)),
      h('span', { class: 'score-unit' }, t('points', '').trim()),
      h('div', { class: 'meter', role: 'img', 'aria-label': `${fmtNum(r.score || 0)} / 100` }, (() => {
        const m = h('span', { class: 'meter-fill' });
        m.style.insetInlineStart = `calc(${pct}% - 2px)`;
        return m;
      })()),
      h('div', { class: 'meter-scale', 'aria-hidden': 'true' }, [0, 20, 50, 100].map((v) => {
        const s = h('span', null, v === 100 ? '100+' : String(v));
        s.style.insetInlineStart = v + '%';
        return s;
      })),
      h('p', { class: 'scale-note' }, t('report_scale')),
    ),
  );

  const reviewBtn = h('button', { class: 'btn primary', type: 'button' }, r.reviewed ? '✓ ' + t('reviewed') : t('mark_reviewed'));
  reviewBtn.disabled = !!r.reviewed;
  reviewBtn.addEventListener('click', async () => {
    await patchReport(r.rid, { reviewed: true });
    await send('refresh-badge').catch(() => {});
    reviewBtn.textContent = '✓ ' + t('reviewed');
    reviewBtn.disabled = true;
  });
  actions.append(reviewBtn);

  if (r.autoDisabled) {
    let enabled = false;
    try {
      enabled = (await chrome.management.get(r.id)).enabled;
    } catch {
      enabled = true; // uninstalled: nothing to turn back on
    }
    if (!enabled) {
      const status = h('span', { class: 'small', role: 'status' });
      const btn = h('button', { class: 'btn', type: 'button' }, t('reenable'));
      btn.addEventListener('click', async () => {
        try {
          await chrome.management.setEnabled(r.id, true);
          await patchReport(r.rid, { reenabled: true });
          btn.remove();
          status.textContent = '✓ ' + t('reenabled');
        } catch (e) {
          status.textContent = t('report_reenable_failed', String((e && e.message) || e));
        }
      });
      actions.append(btn, status);
    }
  }

  // 01: the ledger of reasons.
  const scored = findings.filter((f) => f.points > 0);
  const info = findings.filter((f) => !(f.points > 0));
  const ledger = h(
    'ol',
    { class: 'ledger' },
    [...scored, ...info].map((f) =>
      h(
        'li',
        null,
        h('span', { class: `glyph ${f.severity}`, 'aria-hidden': 'true' }, SEV_GLYPH[f.severity] || '○'),
        h('div', null, h('div', { class: 'what' }, findingTitle(f)), findingWhy(f) ? h('p', { class: 'why' }, findingWhy(f)) : null, f.items && f.items.length ? chips(f.items) : null),
        h('span', { class: 'pts' }, '+' + fmtNum(f.points)),
      ),
    ),
    h('li', { class: 'total' }, h('span'), h('div', { class: 'what' }, t('report_total')), h('span', { class: 'pts' }, fmtNum(r.score || 0))),
  );
  const sections = [section('report_why', findings.length ? ledger : h('p', { class: 'empty' }, t('report_why_none')))];

  // 02: permissions and access, before and after.
  if (r.access) sections.push(section('report_access', accessTable(r.access)));

  if (r.kind !== 'partial') {
    sections.push(section('report_sites', h('p', { class: 'sec-help' }, t('report_sites_help')), sitesTable(r.hosts)));
    const patterns = findings.filter((f) => f.code === 'f_pattern_new');
    sections.push(
      section(
        'report_code',
        patterns.length
          ? h('ul', { class: 'ledger' }, patterns.map((f) => h('li', null, h('span', { class: `glyph ${f.severity}`, 'aria-hidden': 'true' }, SEV_GLYPH[f.severity]), h('div', null, h('div', { class: 'what' }, t(f.params[0])), h('p', { class: 'why' }, t(f.params[0] + '_why')), f.items ? chips(f.items, '', 8) : null), h('span', { class: 'pts' }, '+' + f.points))))
          : h('p', { class: 'empty' }, t('report_code_none')),
      ),
    );
    sections.push(section('report_files', filesTable(r.files, r.totals)));
    sections.push(section('report_manifest', manifestDiff(r.manifestDiff)));
  }

  main.replaceChildren(...head, verdict, ...sections);
}

function accessTable(a) {
  const rows = [
    ['f_perm_added_warn', 'apiPermissions'],
    ['f_host_added', 'hostPermissions'],
    ['f_match_added', 'contentScriptMatches'],
    ['f_optional_added', 'optional'],
  ];
  const labels = {
    apiPermissions: 'API',
    hostPermissions: 'host_permissions',
    contentScriptMatches: 'content_scripts',
    optional: 'optional_permissions',
  };
  const anyChange = rows.some(([, k]) => a[k] && (a[k].added.length || a[k].removed.length));
  const table = h(
    'table',
    { class: 'access' },
    h(
      'tbody',
      null,
      rows
        .filter(([, k]) => a[k] && (a[k].added.length || a[k].removed.length || a[k].kept.length))
        .map(([, k]) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, h('code', null, labels[k])),
            h('td', null, a[k].added.map((x) => h('span', { class: 'chip added' }, '+ ' + x)), a[k].removed.map((x) => h('span', { class: 'chip removed' }, x)), a[k].kept.map((x) => h('span', { class: 'chip' }, x))),
          ),
        ),
    ),
  );
  return anyChange ? table : [h('p', { class: 'empty' }, t('report_access_none')), table];
}

function sitesTable(hosts) {
  const added = (hosts && hosts.added) || [];
  if (!added.length) return h('p', { class: 'empty' }, t('report_sites_none'));
  const sorted = [...added].sort((x, y) => (y.newSite && !y.inData) - (x.newSite && !x.inData) || (x.host < y.host ? -1 : 1));
  const rows = sorted.slice(0, 300).map((x) => h('tr', null, h('td', { class: 'host' }, x.host), h('td', { class: 'path' }, x.file || ''), h('td', null, h('span', { class: `tag ${x.newSite && !x.inData ? 'new' : ''}` }, t(x.inData ? 'report_site_data' : x.newSite ? 'report_site_new' : 'report_site_known')))));
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('col_host')), h('th', { scope: 'col' }, t('col_file')), h('th', { scope: 'col' }))), h('tbody', null, rows)));
}

function filesTable(files, totals) {
  if (!files) return h('p', { class: 'empty' }, '—');
  const c = files.counts || {};
  const summary = h('p', { class: 'file-summary' }, h('span', null, t('report_files_summary', fmtNum(c.added || 0), fmtNum(c.removed || 0), fmtNum(c.changed || 0), fmtNum(c.unchanged || 0))), totals ? h('span', { class: 'muted' }, `${t('report_size')}: `, h('span', { dir: 'ltr' }, `${fmtBytes(totals.oldSize)} → ${fmtBytes(totals.newSize)}`)) : null);
  const all = [...(files.added || []).map((f) => ['added', f]), ...(files.changed || []).map((f) => ['changed', f]), ...(files.removed || []).map((f) => ['removed', f])];
  if (!all.length) return summary;
  const row = ([kind, f]) =>
    h(
      'tr',
      null,
      h('td', null, h('span', { class: `tag ${kind === 'added' ? 'new' : ''}` }, t('file_' + kind))),
      h('td', { class: 'path' }, f.path),
      h('td', { class: 'num', dir: 'ltr' }, kind === 'changed' && f.oldSize !== undefined ? `${fmtBytes(f.oldSize)} → ${fmtBytes(f.size)}` : fmtBytes(f.size)),
      h('td', null, f.obfuscated ? h('span', { class: 'tag warn' }, t('file_obfuscated')) : null, f.minified ? h('span', { class: 'tag' }, t('file_minified')) : null),
    );
  const LIMIT = 60;
  const tbody = h('tbody', null, all.slice(0, LIMIT).map(row));
  const out = [summary, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, tbody))];
  if (all.length > LIMIT) {
    const btn = h('button', { class: 'btn more', type: 'button' }, t('report_show_all', fmtNum(all.length)));
    btn.addEventListener('click', () => {
      tbody.append(...all.slice(LIMIT).map(row));
      btn.remove();
    });
    out.push(btn);
  }
  return out;
}

function manifestDiff(lines) {
  if (!Array.isArray(lines) || !lines.some((l) => l.op !== ' ')) return h('p', { class: 'empty' }, t('report_manifest_same'));
  // Show changed lines with three lines of context.
  const keep = new Set();
  lines.forEach((l, i) => {
    if (l.op !== ' ') for (let j = i - 3; j <= i + 3; j++) keep.add(j);
  });
  const out = [];
  let gap = false;
  lines.forEach((l, i) => {
    if (!keep.has(i)) {
      if (!gap) out.push(h('span', { class: 'gap' }, '  …'));
      gap = true;
      return;
    }
    gap = false;
    const cls = l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'ctx';
    out.push(h('span', { class: cls }, `${l.op} ${l.text}`));
  });
  return h('pre', { class: 'diff', dir: 'ltr', tabindex: '0', 'aria-label': 'manifest.json diff' }, out);
}

/* ---------------- Overview ---------------- */

const STATUS = {
  watching: ['status_watching', () => []],
  'baseline-ahead': ['status_baseline_ahead', (r) => [t('status_baseline_ahead_help', r.storeVersion, r.installedVersion)]],
  'baseline-behind': ['status_baseline_behind', (r) => [t('status_baseline_behind_help', r.storeVersion, r.installedVersion)]],
  error: ['status_error', (r) => [t('status_error_help', r.lastError || '?')]],
  unavailable: ['status_unavailable', () => [t('status_unavailable_help')]],
  skipped: ['status_skipped', (r) => [r.reason ? t(r.reason.code, ...(r.reason.params || [])) : '']],
};

async function renderOverview() {
  document.title = t('ov_doc_title');
  const [index, records] = await Promise.all([getReportIndex(), getRecords()]);
  const reports = index.length
    ? h(
        'ol',
        { class: 'rlist' },
        index.map((r) =>
          h(
            'li',
            { class: `rrow ${lvl(r.level)}` },
            extIcon(r.id, 32, r.name),
            h('div', null, h('div', { class: 'name' }, r.name), h('div', { class: 'sub' }, versions(r.fromVersion, r.toVersion), h('span', null, fmtAgo(r.createdAt)), r.kind === 'partial' ? h('span', { class: 'tag' }, t('partial_report')) : null, r.reviewed ? h('span', null, '✓ ' + t('reviewed')) : null, r.autoDisabled && !r.reenabled ? h('span', { class: 'tag warn' }, t('auto_disabled')) : null)),
            h('div', { class: 'sub' }, levelChip(r.level), h('a', { href: reportUrl(r.rid) }, t('open_report'))),
          ),
        ),
      )
    : h('p', { class: 'empty' }, t('ov_reports_none'));

  const order = { error: 0, unavailable: 1, 'baseline-ahead': 2, 'baseline-behind': 3, watching: 4, skipped: 5 };
  const recs = [...records].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.name).localeCompare(String(b.name)));
  const exts = recs.length
    ? h(
        'div',
        { class: 'tbl-wrap' },
        h(
          'table',
          { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, t('ov_col_ext')), h('th', { scope: 'col' }, t('ov_col_version')), h('th', { scope: 'col' }, t('ov_col_status')))),
          h(
            'tbody',
            null,
            recs.map((r) => {
              const [key, help] = STATUS[r.status] || ['status_pending', () => []];
              return h('tr', null, h('td', null, h('div', { class: 'name-cell' }, extIcon(r.id, 24, r.name), h('span', null, r.name || r.id))), h('td', { class: 'num' }, h('span', { class: 'ver' }, r.installedVersion || '?')), h('td', null, h('div', { class: 'status-cell' }, h('span', { class: `status-name ${r.status || ''}` }, t(key)), help(r).filter(Boolean).map((x) => h('span', { class: 'small muted' }, x)))));
            }),
          ),
        ),
      )
    : h('p', { class: 'empty' }, t('ov_extensions_none'));

  main.replaceChildren(h('h1', { class: 'ov-title' }, t('ov_title')), section('ov_reports', reports), section('ov_extensions', exts));
}

if (rid) renderReport(rid);
else renderOverview();
