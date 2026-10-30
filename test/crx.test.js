import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCrx, idFromBytes, isExtensionId } from '../src/lib/crx.js';
import { makeZip, makeCrx3, fakeId, idToBytes } from './helpers/pack.js';

const zip = makeZip([{ name: 'manifest.json', data: '{"version":"1.0"}' }]);
const id = fakeId('crx-test');

test('CRX3: returns the ZIP payload and the crx_id from the signed header', () => {
  const r = parseCrx(makeCrx3(zip, id));
  assert.equal(r.format, 'crx3');
  assert.equal(r.crxId, id);
  assert.deepEqual([...r.zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test('CRX3: rejects a package whose ID is not the one requested', () => {
  assert.throws(() => parseCrx(makeCrx3(zip, id), { expectedId: fakeId('other') }), { code: 'id-mismatch' });
});

test('CRX2 and bare ZIP are accepted', () => {
  const crx2 = new Uint8Array(16 + 3 + 2 + zip.length);
  crx2.set([0x43, 0x72, 0x32, 0x34, 2, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0]);
  crx2.set(zip, 21);
  assert.equal(parseCrx(crx2).format, 'crx2');
  assert.equal(parseCrx(zip).format, 'zip');
});

test('rejects garbage, truncated and oversized headers', () => {
  assert.throws(() => parseCrx(new Uint8Array([1, 2, 3, 4, 5])), { code: 'not-crx' });
  assert.throws(() => parseCrx(new Uint8Array([0x43, 0x72])), { code: 'truncated' });
  const huge = new Uint8Array(12);
  huge.set([0x43, 0x72, 0x32, 0x34, 3, 0, 0, 0, 0xff, 0xff, 0xff, 0x7f]);
  assert.throws(() => parseCrx(huge), { code: 'bad-header' });
  const v9 = new Uint8Array(12);
  v9.set([0x43, 0x72, 0x32, 0x34, 9, 0, 0, 0]);
  assert.throws(() => parseCrx(v9), { code: 'unsupported-crx' });
  // A header whose only field claims to be longer than the header.
  const bad = new Uint8Array(12 + 3);
  bad.set([0x43, 0x72, 0x32, 0x34, 3, 0, 0, 0, 3, 0, 0, 0, 0x12, 0x7f, 0x00]);
  assert.throws(() => parseCrx(bad), { code: 'bad-header' });
});

test('extension IDs round-trip through bytes', () => {
  assert.equal(idFromBytes(idToBytes(id)), id);
  assert.ok(isExtensionId(id));
  assert.ok(!isExtensionId('ABC'));
  assert.ok(!isExtensionId('q'.repeat(32)));
});
