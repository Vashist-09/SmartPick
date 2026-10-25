import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRegistration, redact } from '../../src/scanner/identifier';
import { createAcceptor } from '../../src/scanner/acceptor';
import { crop, rotate, scale } from '../../src/scanner/imageOps';

test('normalizeRegistration keeps case and leading zeros, trims noise', () => {
  assert.deepEqual(normalizeRegistration('  0012345 \r\n'), { ok: true, value: '0012345' });
  assert.deepEqual(normalizeRegistration('24cs104'), { ok: true, value: '24cs104' });
  assert.deepEqual(normalizeRegistration('\u001d24CS104\u0000'), { ok: true, value: '24CS104' });
  assert.deepEqual(normalizeRegistration('*24CS104*'), { ok: true, value: '24CS104' });
  assert.deepEqual(normalizeRegistration('21 BCE   1234'), { ok: true, value: '21 BCE 1234' });
  assert.deepEqual(normalizeRegistration('2021/CS-07.b'), { ok: true, value: '2021/CS-07.b' });
});

test('normalizeRegistration rejects empty, too long and unsafe values', () => {
  assert.equal(normalizeRegistration('   ').ok, false);
  assert.equal(normalizeRegistration('A'.repeat(65)).ok, false);
  for (const bad of ['24CS104;DROP', '<script>', 'https://example.edu/id?x=1', '{"id":1}', '-24CS', '24CS-']) {
    const r = normalizeRegistration(bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.equal(r.reason, 'invalid-characters');
  }
});

test('redact never reveals more than the last two characters', () => {
  assert.equal(redact('24CS104'), '•••••04');
  assert.equal(redact('7'), '•');
});

test('acceptor: strong-checksum formats accept once, then ignore duplicates', () => {
  const a = createAcceptor();
  assert.deepEqual(a.feed({ text: '24CS104', format: 'Code128' }, 0), { text: '24CS104', format: 'Code128' });
  assert.equal(a.feed({ text: '24CS104', format: 'Code128' }, 10), null);
  assert.equal(a.feed({ text: 'OTHER', format: 'QRCode' }, 20), null);
  a.reset();
  assert.ok(a.feed({ text: 'X1', format: 'QRCode' }, 30));
});

test('acceptor: weak formats (Code 39) need two identical reads inside the window', () => {
  const a = createAcceptor(1000);
  assert.equal(a.feed({ text: '24CS104', format: 'Code39' }, 0), null);
  assert.equal(a.feed({ text: '24CS1O4', format: 'Code39' }, 100), null); // misread breaks the streak
  assert.equal(a.feed({ text: '24CS104', format: 'Code39' }, 200), null);
  assert.ok(a.feed({ text: '24CS104', format: 'Code39' }, 300));
  const b = createAcceptor(1000);
  b.feed({ text: '24CS104', format: 'Code39' }, 0);
  assert.equal(b.feed({ text: '24CS104', format: 'Code39' }, 5000), null, 'stale first read does not count');
});

test('imageOps keep dimensions consistent', () => {
  const img = { data: new Uint8ClampedArray(10 * 8 * 4).fill(128), width: 10, height: 8 };
  assert.deepEqual([crop(img, { x: 2, y: 2, width: 100, height: 3 }).width, crop(img, { x: 2, y: 2, width: 100, height: 3 }).height], [8, 3]);
  const s = scale(img, 2); assert.deepEqual([s.width, s.height, s.data.length], [20, 16, 20 * 16 * 4]);
  const r = rotate(img, 30); assert.deepEqual([r.width, r.height], [10, 8]);
  assert.equal(r.data[3], 255);
});
