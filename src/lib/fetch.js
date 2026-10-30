// Downloads a package from the Chrome Web Store update server. Works in an extension
// service worker (with host permissions for the two hosts below) and in Node 20+.

import { PackageError, isExtensionId } from './crx.js';

export const UPDATE_HOST = 'clients2.google.com';
export const BLOB_HOST = 'clients2.googleusercontent.com';
export const STORE_UPDATE_URL = 'https://clients2.google.com/service/update2/crx';
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export function updateUrl(id, prodversion) {
  if (!isExtensionId(id)) throw new PackageError('bad-id', 'Not an extension ID');
  const v = /^\d+(\.\d+){0,3}$/.test(prodversion) ? prodversion : '120.0.0.0';
  const x = encodeURIComponent(`id=${id}&installsource=ondemand&uc`);
  return `${STORE_UPDATE_URL}?response=redirect&prodversion=${v}&acceptformat=crx2,crx3&x=${x}`;
}

/**
 * @param {string} id
 * @param {{prodversion: string, fetchImpl?: typeof fetch, maxBytes?: number, signal?: AbortSignal}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function downloadPackage(id, opts) {
  const fetchImpl = opts.fetchImpl || fetch;
  const maxBytes = opts.maxBytes || MAX_DOWNLOAD_BYTES;
  const res = await fetchImpl(updateUrl(id, opts.prodversion), {
    redirect: 'follow',
    credentials: 'omit',
    cache: 'no-store',
    signal: opts.signal,
  });
  let host = '';
  try {
    host = new URL(res.url).host;
  } catch {
    /* empty */
  }
  if (host && host !== UPDATE_HOST && host !== BLOB_HOST) {
    throw new PackageError('unexpected-host', 'Download was redirected to an unexpected host');
  }
  if (res.status === 204 || res.status === 404) throw new PackageError('not-in-store', 'Not available in the Chrome Web Store');
  if (!res.ok) throw new PackageError('http-' + res.status, 'Download failed with HTTP ' + res.status);
  const declared = Number(res.headers.get('content-length'));
  if (declared > maxBytes) throw new PackageError('too-large', 'Package is larger than the download limit');
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new PackageError('too-large', 'Package is larger than the download limit');
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PackageError('too-large', 'Package is larger than the download limit');
    }
    chunks.push(value);
  }
  if (total === 0) throw new PackageError('not-in-store', 'Empty response from the update server');
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
