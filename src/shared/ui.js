// Shared helpers for crxdiff's pages. Untrusted strings (extension names, paths,
// hosts, manifest text) only ever reach the DOM through textContent or attributes
// set with setAttribute on a fixed allow-list; nothing here uses innerHTML.

export const uiLang = chrome.i18n.getUILanguage();
export const isRtl = chrome.i18n.getMessage('@@bidi_dir') === 'rtl';
const numLocale = uiLang.startsWith('ar') ? uiLang + '-u-nu-latn' : uiLang;

export function t(key, ...params) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_@]+$/.test(key)) return '';
  const s = chrome.i18n.getMessage(key);
  if (!s) return '';
  // One pass, so a parameter that itself contains "{2}" is never substituted again.
  return s.replace(/\{(\d)\}/g, (m, n) => (n >= 1 && n <= params.length ? String(params[n - 1]) : m));
}

/** Sets lang/dir and fills every [data-i18n] element. */
export function applyI18n(root = document) {
  document.documentElement.lang = uiLang;
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
  const title = document.querySelector('title[data-i18n]');
  if (title) document.title = t(title.dataset.i18n);
}

const ATTRS = new Set(['class', 'href', 'target', 'rel', 'src', 'alt', 'title', 'id', 'for', 'type', 'role', 'dir', 'lang', 'value', 'name', 'aria-label', 'aria-live', 'aria-expanded', 'aria-controls', 'aria-describedby', 'aria-hidden', 'tabindex', 'width', 'height', 'datetime', 'scope', 'colspan', 'hidden']);

/** Minimal element builder. Strings become text nodes; attributes are allow-listed. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k.startsWith('data-')) el.setAttribute(k, String(v));
      else if (ATTRS.has(k)) {
        if ((k === 'href' || k === 'src') && !safeUrl(String(v))) continue;
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.append(c);
    else el.append(document.createTextNode(String(c)));
  }
}

// Only our own pages, Chrome's extension icons and https links are ever used.
function safeUrl(u) {
  return u.startsWith('/') || u.startsWith('./') || u.startsWith('../') || u.startsWith('?') || u.startsWith('#') || u.startsWith(chrome.runtime.getURL('')) || u.startsWith('chrome://extension-icon/') || u.startsWith('https://');
}

export function versions(from, to) {
  return h('span', { class: 'versions' }, h('span', { class: 'ver' }, from || '?'), h('span', { class: 'arrow', 'aria-hidden': 'true' }), h('span', { class: 'visually-hidden' }, ' ', t('from_to_label', from, to)), h('span', { class: 'ver new' }, to || '?'));
}

export function levelChip(level) {
  const l = ['high', 'medium', 'low', 'none'].includes(level) ? level : 'none';
  return h('span', { class: `level ${l}` }, t('level_' + l));
}

/**
 * The extension's own icon from Chrome, or a monogram when Chrome has none (for
 * example after the extension was uninstalled).
 */
export function extIcon(id, size = 32, name = '') {
  const letter = (String(name).trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
  const box = h('span', { class: 'ext-icon mono-icon', 'aria-hidden': 'true', 'data-hue': String(hue(id)) }, letter);
  box.style.width = box.style.height = size + 'px';
  box.style.fontSize = Math.round(size * 0.5) + 'px';
  box.style.setProperty('--hue', String(hue(id)));
  if (/^[a-p]{32}$/.test(id)) {
    const img = h('img', { alt: '', width: size, height: size, src: `chrome://extension-icon/${id}/${size * 2}/0` });
    img.addEventListener('load', () => box.classList.add('has-img'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    box.append(img);
  }
  return box;
}

function hue(id) {
  let n = 0;
  for (const c of String(id)) n = (n * 31 + c.charCodeAt(0)) % 360;
  return n;
}

const nf = new Intl.NumberFormat(numLocale);
export const fmtNum = (n) => nf.format(n);

export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = Number(n) || 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(numLocale, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 }).format(v)} ${units[i]}`;
}

const rtf = new Intl.RelativeTimeFormat(numLocale, { numeric: 'auto' });
export function fmtAgo(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.round(s), 'second');
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function fmtDate(ts) {
  return new Intl.DateTimeFormat(numLocale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ts));
}

/** Title for a finding, with pattern names resolved and sizes formatted. */
export function findingTitle(f) {
  const p = (f.params || []).map((x) => (typeof x === 'string' && x.startsWith('pattern_') ? t(x) : x));
  return t(f.code, ...p);
}

export function findingWhy(f) {
  if (f.code === 'f_pattern_new') return t(f.params[0] + '_why');
  let p = f.params || [];
  if (f.code === 'f_size_jump') p = p.map((x) => fmtBytes(Number(x)));
  return t(f.code + '_why', ...p);
}

export function reportUrl(rid) {
  return chrome.runtime.getURL('report/report.html') + '?r=' + encodeURIComponent(rid);
}

export function send(type, extra = {}) {
  return chrome.runtime.sendMessage({ type, ...extra });
}
