// Real-decoder tests: synthetic fixtures are decoded by the same zxing-wasm build and the same
// multi-pass logic the browser worker uses. Nothing here is mocked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadPng, nodeDecoder } from './zxingNode';
import { LIVE_PASSES } from '../../src/scanner/decodeCore';

const FIX = join(import.meta.dirname, '..', 'fixtures');
const decoder = nodeDecoder();

/** Simulates the live loop: runs passes round-robin over the same frame, like consecutive camera frames. */
async function liveScan(file: string, maxFrames = LIVE_PASSES.length) {
  const img = loadPng(file);
  for (let i = 0; i < maxFrames; i++) {
    const hit = await decoder.decodePass({ ...img, data: img.data.slice() }, i);
    if (hit) return { ...hit, frames: i + 1 };
  }
  return null;
}

const supportedCards: [string, string, string][] = [
  ['code128-24CS104', 'Code128', '24CS104'],
  ['code128-0012345', 'Code128', '0012345'],
  ['code39-24CS104', 'Code39', '24CS104'],
  ['qr-24CS104', 'QRCode', '24CS104'],
  ['pdf417-24CS104', 'PDF417', '24CS104'],
  ['aztec-24CS104', 'Aztec', '24CS104'],
  ['code128-lower-24cs104', 'Code128', '24cs104'],
];
for (const [name, format, text] of supportedCards) {
  test(`decodes ${name} card as ${format}`, async () => {
    const hit = await decoder.decodeStill(loadPng(join(FIX, 'cards', name + '.png')));
    assert.ok(hit, 'expected a decode');
    assert.equal(hit.format, format);
    assert.equal(hit.text, text);
  });
}

test('preserves leading zeros exactly (string, not number)', async () => {
  const hit = await decoder.decodeStill(loadPng(join(FIX, 'cards', 'code128-0012345.png')));
  assert.equal(hit?.text, '0012345');
  assert.equal(typeof hit?.text, 'string');
});

test('an unsupported symbology (MaxiCode) is not decoded', async () => {
  assert.equal(await decoder.decodeStill(loadPng(join(FIX, 'cards', 'maxicode-24CS104.png'))), null);
});

const liveFrames = ['straight', 'off-center-low', 'angled-12deg', 'angled-minus-12deg', 'angled-25deg', 'perspective', 'far-small', 'blurred', 'low-contrast', 'low-light', 'glare', 'upside-down'];
for (const name of liveFrames) {
  test(`live loop decodes camera frame: ${name}`, async () => {
    const hit = await liveScan(join(FIX, 'frames', name + '.png'));
    assert.ok(hit, `no decode within ${LIVE_PASSES.length} frames`);
    assert.equal(hit.text, '24CS104');
    assert.equal(hit.format, 'Code128');
  });
}

for (const name of ['no-barcode', 'heavily-damaged']) {
  test(`returns nothing (no false positive) for ${name}`, async () => {
    assert.equal(await liveScan(join(FIX, 'frames', name + '.png')), null);
    assert.equal(await decoder.decodeStill(loadPng(join(FIX, 'frames', name + '.png'))), null);
  });
}

test('a malformed / non-image buffer does not crash the decoder', async () => {
  const junk = { data: new Uint8ClampedArray(64 * 48 * 4).map(() => Math.random() * 255), width: 64, height: 48 };
  assert.equal(await decoder.decodeStill(junk), null);
});
