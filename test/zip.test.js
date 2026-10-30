import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listZip, readEntry, inspectName } from '../src/lib/zip.js';
import { makeZip } from './helpers/pack.js';

test('lists and reads stored and deflated files', () => {
  const zip = makeZip([
    { name: 'a.txt', data: 'hello', method: 0 },
    { name: 'dir/b.js', data: 'x'.repeat(5000) },
  ]);
  const { entries, warnings } = listZip(zip);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['a.txt', 'dir/b.js'],
  );
  assert.deepEqual(warnings, []);
  assert.equal(new TextDecoder().decode(readEntry(zip, entries[0]).data), 'hello');
  assert.equal(readEntry(zip, entries[1]).data.length, 5000);
});

test('path tricks are reported, normalised and never used as object keys', () => {
  const zip = makeZip([
    { name: '../../evil.js', data: '1' },
    { name: '/abs.js', data: '2' },
    { name: 'C:\\win.js', data: '3' },
    { name: './a.js', data: '4' },
    { name: 'a.js', data: '5' },
    { name: '__proto__', data: '6' },
    { name: 'ctl\u0007.js', data: '7' },
  ]);
  const { entries, warnings } = listZip(zip);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('__proto__'));
  assert.ok(warnings.some((w) => w.startsWith('path:parent-path')));
  assert.ok(warnings.some((w) => w.startsWith('path:absolute-path')));
  assert.ok(warnings.some((w) => w.startsWith('path:control-chars')));
  assert.ok(warnings.some((w) => w === 'path:duplicate:a.js'));
  assert.equal(names.filter((n) => n === 'a.js').length, 1);
  assert.equal(inspectName('a\\b\\c.js').name, 'a/b/c.js');
});

test('zip bomb: a file that declares a huge size is not unpacked', () => {
  const zip = makeZip([{ name: 'big.bin', data: new Uint8Array(1000), declaredSize: 200 * 1024 * 1024 }]);
  const { entries } = listZip(zip);
  assert.equal(readEntry(zip, entries[0]).skipped, 'too-large');
});

test('zip bomb: total declared size over the limit stops the listing', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, data: 'x', declaredSize: 60 * 1024 * 1024 }));
  assert.throws(() => listZip(makeZip(files)), { code: 'too-large' });
});

test('zip bomb: an extreme compression ratio is not unpacked', () => {
  const data = new Uint8Array(8 * 1024 * 1024); // zeros compress about 1000:1
  const zip = makeZip([{ name: 'zeros.bin', data }]);
  const { entries } = listZip(zip);
  assert.equal(readEntry(zip, entries[0]).skipped, 'compression-ratio');
});

test('a stream that inflates to more than it declared is rejected, memory stays bounded', () => {
  const zip = makeZip([{ name: 'liar.js', data: 'y'.repeat(100000), declaredSize: 10 }]);
  const { entries } = listZip(zip);
  const r = readEntry(zip, entries[0]);
  assert.equal(r.data, null);
  assert.equal(r.skipped, 'size-mismatch');
});

test('a stream that inflates to less than it declared is rejected', () => {
  const zip = makeZip([{ name: 'short.js', data: 'abc', declaredSize: 50 }]);
  const { entries } = listZip(zip);
  assert.equal(readEntry(zip, entries[0]).skipped, 'size-mismatch');
});

test('corrupt data, unknown methods and encrypted entries are skipped', () => {
  const zip = makeZip([
    { name: 'raw.bin', data: new Uint8Array([0xff, 0xff, 0xff, 0xff]), method: 0 },
    { name: 'enc.js', data: 'secret', flags: 0x801 },
  ]);
  const { entries } = listZip(zip);
  // The same bytes, read as DEFLATE, are invalid.
  assert.equal(readEntry(zip, { ...entries[0], method: 8, size: 4 }).data, null);
  assert.equal(readEntry(zip, entries[1]).skipped, 'encrypted');
  assert.equal(readEntry(zip, { ...entries[0], method: 12 }).skipped, 'unsupported-method');
});

test('too many entries, a missing directory and ZIP64 are refused', () => {
  const many = makeZip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, data: '' })));
  assert.throws(() => listZip(many, { maxEntries: 10 }), { code: 'too-many-files' });
  assert.throws(() => listZip(new Uint8Array(100)), { code: 'bad-zip' });
  const z64 = makeZip([{ name: 'a', data: 'a' }]);
  z64.set([0xff, 0xff], z64.length - 22 + 10);
  assert.throws(() => listZip(z64), { code: 'zip64' });
});

test('offsets pointing outside the file are refused', () => {
  const zip = makeZip([{ name: 'a', data: 'a' }]);
  new DataView(zip.buffer, zip.byteOffset).setUint32(zip.length - 22 + 16, 0x7fffffff, true);
  assert.throws(() => listZip(zip), { code: 'bad-zip' });
  const zip2 = makeZip([{ name: 'a', data: 'a' }]);
  const { entries } = listZip(zip2);
  assert.equal(readEntry(zip2, { ...entries[0], localOffset: 0x7fffff }).skipped, 'corrupt');
});
