// Parses CRX2/CRX3 package headers and returns the ZIP payload.
// Pure module: no chrome.* or DOM APIs, so it runs in Node tests too.

export const CRX_MAGIC = 0x34327243; // "Cr24" little-endian
const MAX_HEADER_BYTES = 1024 * 1024;

export class PackageError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PackageError';
    this.code = code;
  }
}

function u32(bytes, off) {
  if (off + 4 > bytes.length) throw new PackageError('truncated', 'Unexpected end of package');
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

// Reads a protobuf varint. Returns [value, nextOffset]. Values above 2^53 are rejected.
function varint(bytes, off, end) {
  let result = 0;
  let mul = 1;
  for (let i = 0; i < 8; i++) {
    if (off >= end) throw new PackageError('bad-header', 'Truncated varint');
    const b = bytes[off++];
    result += (b & 0x7f) * mul;
    if ((b & 0x80) === 0) return [result, off];
    mul *= 128;
  }
  throw new PackageError('bad-header', 'Varint too long');
}

// Iterates the top-level fields of a protobuf message. Only wire types 0, 1, 2 and 5 are
// accepted; that is all CRX headers use.
function* protoFields(bytes, start, end) {
  let off = start;
  while (off < end) {
    let key;
    [key, off] = varint(bytes, off, end);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) {
      [, off] = varint(bytes, off, end);
    } else if (wire === 2) {
      let len;
      [len, off] = varint(bytes, off, end);
      if (off + len > end) throw new PackageError('bad-header', 'Field runs past header');
      yield { field, start: off, end: off + len };
      off += len;
    } else if (wire === 1) {
      off += 8;
    } else if (wire === 5) {
      off += 4;
    } else {
      throw new PackageError('bad-header', 'Unsupported protobuf wire type');
    }
    if (off > end) throw new PackageError('bad-header', 'Field runs past header');
  }
}

// Chrome extension IDs are the first 16 bytes of a SHA-256, written with the letters a-p.
export function idFromBytes(bytes) {
  let id = '';
  for (const b of bytes) id += String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15));
  return id;
}

export function isExtensionId(id) {
  return typeof id === 'string' && /^[a-p]{32}$/.test(id);
}

// CRX3 header: CrxFileHeader { ... bytes signed_header_data = 10000; }
// SignedData { bytes crx_id = 1; }
function crx3Id(bytes, start, end) {
  for (const f of protoFields(bytes, start, end)) {
    if (f.field !== 10000) continue;
    for (const g of protoFields(bytes, f.start, f.end)) {
      if (g.field === 1 && g.end - g.start === 16) return idFromBytes(bytes.subarray(g.start, g.end));
    }
  }
  return null;
}

/**
 * @param {Uint8Array} bytes  the downloaded file
 * @param {{expectedId?: string}} [opts]
 * @returns {{format: 'crx3'|'crx2'|'zip', crxId: string|null, zip: Uint8Array}}
 */
export function parseCrx(bytes, opts = {}) {
  if (!(bytes instanceof Uint8Array)) throw new PackageError('bad-input', 'Expected bytes');
  if (bytes.length < 4) throw new PackageError('truncated', 'Package is empty');
  // A bare ZIP is accepted for local fixtures and tests.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return { format: 'zip', crxId: null, zip: bytes };
  }
  if (u32(bytes, 0) !== CRX_MAGIC) throw new PackageError('not-crx', 'Not a CRX package');
  const version = u32(bytes, 4);
  let result;
  if (version === 3) {
    const headerSize = u32(bytes, 8);
    if (headerSize > MAX_HEADER_BYTES || 12 + headerSize > bytes.length) {
      throw new PackageError('bad-header', 'CRX3 header size is out of range');
    }
    const crxId = crx3Id(bytes, 12, 12 + headerSize);
    result = { format: 'crx3', crxId, zip: bytes.subarray(12 + headerSize) };
  } else if (version === 2) {
    const keyLen = u32(bytes, 8);
    const sigLen = u32(bytes, 12);
    const start = 16 + keyLen + sigLen;
    if (keyLen > MAX_HEADER_BYTES || sigLen > MAX_HEADER_BYTES || start > bytes.length) {
      throw new PackageError('bad-header', 'CRX2 header size is out of range');
    }
    result = { format: 'crx2', crxId: null, zip: bytes.subarray(start) };
  } else {
    throw new PackageError('unsupported-crx', 'Unsupported CRX version ' + version);
  }
  if (opts.expectedId && result.crxId && result.crxId !== opts.expectedId) {
    throw new PackageError('id-mismatch', 'Package ID does not match the requested extension');
  }
  return result;
}
