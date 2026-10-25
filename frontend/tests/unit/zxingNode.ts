// Loads the real zxing-wasm reader in Node from the installed package (no network, no mocks).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { createDecoder, type ReadFn } from '../../src/scanner/decodeCore';
import type { RgbaImage } from '../../src/scanner/imageOps';

const require = createRequire(import.meta.url);

let ready: Promise<unknown> | null = null;
export function nodeDecoder() {
  if (!ready) {
    const bin = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    ready = prepareZXingModule({ overrides: { wasmBinary: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer }, fireImmediately: true });
  }
  const read: ReadFn = async (img, opts) => {
    await ready;
    const data = { data: img.data, width: img.width, height: img.height, colorSpace: 'srgb' as const } as ImageData;
    return readBarcodes(data, opts as Parameters<typeof readBarcodes>[1]);
  };
  return createDecoder(read);
}

export function loadPng(path: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(path));
  return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength), width: png.width, height: png.height };
}
