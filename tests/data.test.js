import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupParcel } from '../src/data.js';
test('known IDs resolve to their individual slots', () => {
  assert.equal(lookupParcel('SP1024').slot, 'A-04');
  assert.equal(lookupParcel('SP2048').slot, 'B-12');
  assert.equal(lookupParcel('SP4096').slot, 'C-02');
});
test('lookup normalizes manual entry', () => {
  assert.equal(lookupParcel('  sp1024 ').status, 'FOUND');
});
test('unknown valid registration produces NOT_FOUND', () => {
  assert.deepEqual(lookupParcel('SP0000'), { id: 'SP0000', status: 'NOT_FOUND' });
});
test('empty and malformed registration is rejected', () => {
  for (const id of ['', 'ab', '<script>', 'A'.repeat(31)]) assert.throws(() => lookupParcel(id));
});
test('manual entry gives actionable validation errors', () => {
  assert.throws(() => lookupParcel('   '), /Enter your registration number/);
  assert.throws(() => lookupParcel('AB'), /3–30 characters/);
  assert.throws(() => lookupParcel('SP 1024'), /Remove spaces and special characters/);
  assert.equal(lookupParcel(' sp2048 ').slot, 'B-12');
});
