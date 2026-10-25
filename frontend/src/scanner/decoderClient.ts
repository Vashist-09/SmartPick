// Main-thread wrapper around the decoder worker: one request in flight per call site,
// per-request timeouts, and clean termination.
import type { Rect, RgbaImage } from './imageOps';
import type { WorkerRequest, WorkerResponse } from './decode.worker';

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export type DecodeResult = { text: string; format: string; pass: string } | null;

export class DecoderTimeoutError extends Error { constructor() { super('The barcode decoder did not respond in time.'); this.name = 'DecoderTimeoutError'; } }

export class DecoderClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: { result: DecodeResult; ms: number }) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private dead: Error | null = null;

  constructor() {
    this.worker = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id); if (!p) return;
      this.pending.delete(e.data.id); clearTimeout(p.timer);
      if (e.data.ok) p.resolve({ result: e.data.result, ms: e.data.ms }); else p.reject(new Error(e.data.error));
    };
    this.worker.onerror = (e) => { e.preventDefault(); this.fail(new Error(e.message || 'The barcode decoder failed to load.')); };
  }

  private fail(error: Error) {
    this.dead = error;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); }
    this.pending.clear();
  }

  private send(msg: WithoutId<WorkerRequest>, timeoutMs: number, transfer: Transferable[] = []) {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise<{ result: DecodeResult; ms: number }>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new DecoderTimeoutError()); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...msg, id } as WorkerRequest, transfer);
    });
  }

  /** Loads the WASM decoder. Rejects if the binary cannot be fetched or compiled. */
  init(timeoutMs = 20000) { return this.send({ kind: 'init' }, timeoutMs).then(() => undefined); }
  decodeFrame(image: RgbaImage, pass: number, guide?: Rect, timeoutMs = 4000) { return this.send({ kind: 'frame', image, pass, guide }, timeoutMs, [image.data.buffer]); }
  decodeStill(image: RgbaImage, timeoutMs = 20000) { return this.send({ kind: 'still', image }, timeoutMs, [image.data.buffer]); }

  terminate() { this.fail(new Error('Decoder stopped.')); this.worker.terminate(); }
}
