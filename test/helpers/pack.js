// Builds ZIP and CRX3 packages in memory for tests.
import { deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const enc = new TextEncoder();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * @param {Array<{name: string, data: string|Uint8Array, method?: 0|8, declaredSize?: number, flags?: number}>} files
 */
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const method = f.method ?? 8;
    const body = method === 8 ? new Uint8Array(deflateRawSync(data)) : data;
    const name = enc.encode(f.name);
    const size = f.declaredSize ?? data.length;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(f.flags ?? 0x800, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(f.flags ?? 0x800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function field(num, bytes) {
  return Buffer.concat([varint(num * 8 + 2), varint(bytes.length), bytes]);
}

export function idToBytes(id) {
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = ((id.charCodeAt(2 * i) - 97) << 4) | (id.charCodeAt(2 * i + 1) - 97);
  return out;
}

/** Wraps a ZIP in a CRX3 header whose signed data names `id`. Signatures are dummies. */
export function makeCrx3(zip, id) {
  const signed = field(1, idToBytes(id));
  const proof = field(1, Buffer.alloc(32, 7)); // AsymmetricKeyProof.public_key (dummy)
  const header = Buffer.concat([field(2, proof), field(10000, signed)]);
  const pre = Buffer.alloc(12);
  pre.write('Cr24', 0, 'latin1');
  pre.writeUInt32LE(3, 4);
  pre.writeUInt32LE(header.length, 8);
  return new Uint8Array(Buffer.concat([pre, header, Buffer.from(zip)]));
}

/** An ID derived from a name, the way Chrome derives IDs from keys. */
export function fakeId(seed) {
  const h = createHash('sha256').update(seed).digest();
  let id = '';
  for (let i = 0; i < 16; i++) id += String.fromCharCode(97 + (h[i] >> 4)) + String.fromCharCode(97 + (h[i] & 15));
  return id;
}

export function zipDir(dir, extra = []) {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else files.push({ name: relative(dir, p).split(sep).join('/'), data: new Uint8Array(readFileSync(p)) });
    }
  };
  walk(dir);
  return makeZip([...files, ...extra]);
}
