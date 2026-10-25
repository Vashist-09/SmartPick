/// <reference lib="webworker" />
// Decoder worker: keeps barcode decoding off the UI thread.
// The zxing-wasm binary is bundled and served from this app's own origin (no CDN dependency).
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createDecoder, type ReadFn } from './decodeCore';
import type { RgbaImage, Rect } from './imageOps';

export type WorkerRequest =
  | { id: number; kind: 'init' }
  | { id: number; kind: 'frame'; image: RgbaImage; pass: number; guide?: Rect }
  | { id: number; kind: 'still'; image: RgbaImage };
export type WorkerResponse =
  | { id: number; ok: true; result: { text: string; format: string; pass: string } | null; ms: number }
  | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let ready: Promise<unknown> | null = null;
function init() {
  ready ??= prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? new URL(wasmUrl, scope.location.href).href : prefix + path) }, fireImmediately: true });
  return ready;
}

const read: ReadFn = async (img, opts) => {
  await init();
  const data = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  return readBarcodes(data, opts as Parameters<typeof readBarcodes>[1]);
};
const decoder = createDecoder(read);

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  const started = performance.now();
  try {
    if (msg.kind === 'init') { await init(); scope.postMessage({ id: msg.id, ok: true, result: null, ms: performance.now() - started } satisfies WorkerResponse); return; }
    const result = msg.kind === 'frame' ? await decoder.decodePass(msg.image, msg.pass, msg.guide) : await decoder.decodeStill(msg.image);
    scope.postMessage({ id: msg.id, ok: true, result, ms: performance.now() - started } satisfies WorkerResponse);
  } catch (error) {
    scope.postMessage({ id: msg.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse);
  }
};
