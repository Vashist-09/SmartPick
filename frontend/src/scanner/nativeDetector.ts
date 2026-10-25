// Optional second decoder: the browser's built-in BarcodeDetector (Shape Detection API).
// Chrome on macOS backs it with Apple's Vision framework and Chrome on Android with ML Kit, which
// cope noticeably better with soft focus than any WebAssembly decoder. It is feature-detected and
// used *in addition to* zxing-wasm, never instead of it (Firefox, Safari and Windows/Linux Chrome lack it).

type NativeFormat = 'code_128' | 'code_39' | 'code_93' | 'codabar' | 'itf' | 'ean_13' | 'ean_8' | 'upc_a' | 'upc_e' | 'qr_code' | 'pdf417' | 'data_matrix' | 'aztec';
type NativeResult = { rawValue: string; format: string };
type NativeDetectorCtor = {
  new (opts: { formats: string[] }): { detect(source: CanvasImageSource | ImageBitmap | ImageData): Promise<NativeResult[]> };
  getSupportedFormats(): Promise<string[]>;
};

/** Native format name -> the zxing-wasm name used everywhere else (acceptor rules, labels). */
const TO_ZXING: Record<NativeFormat, string> = {
  code_128: 'Code128', code_39: 'Code39', code_93: 'Code93', codabar: 'Codabar', itf: 'ITF',
  ean_13: 'EAN13', ean_8: 'EAN8', upc_a: 'UPCA', upc_e: 'UPCE',
  qr_code: 'QRCode', pdf417: 'PDF417', data_matrix: 'DataMatrix', aztec: 'Aztec',
};

export type NativeDetector = { formats: string[]; detect(source: CanvasImageSource | ImageBitmap): Promise<{ text: string; format: string } | null> };

let cached: Promise<NativeDetector | null> | null = null;

export function getNativeDetector(): Promise<NativeDetector | null> {
  cached ??= (async () => {
    const Ctor = (globalThis as unknown as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
    if (!Ctor) return null;
    try {
      const supported = (await Ctor.getSupportedFormats()).filter((f): f is NativeFormat => f in TO_ZXING);
      if (!supported.length) return null;
      const detector = new Ctor({ formats: supported });
      return {
        formats: supported.map(f => TO_ZXING[f]),
        async detect(source) {
          const hits = await detector.detect(source);
          const hit = hits.find(h => h.rawValue && h.format in TO_ZXING);
          return hit ? { text: hit.rawValue, format: TO_ZXING[hit.format as NativeFormat] } : null;
        },
      };
    } catch {
      return null; // present but unusable (e.g. platform service missing): fall back to zxing-wasm only
    }
  })();
  return cached;
}
