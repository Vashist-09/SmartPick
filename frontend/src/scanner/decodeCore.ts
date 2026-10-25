// Engine-agnostic multi-pass decoding. The worker plugs in zxing-wasm; Node tests plug in the
// same zxing-wasm build loaded from disk, so tests exercise the real decoder, not a mock.
import { crop, defaultGuide, rotate, scale, type Rect, type RgbaImage } from './imageOps';

/** Symbologies enabled for student ID cards. Mirrors the set the previous ZXing reader tried by default. */
export const ENABLED_FORMATS = [
  'Code128', 'Code39', 'Code93', 'Codabar', 'ITF',
  'EAN13', 'EAN8', 'UPCA', 'UPCE', 'DataBar', 'DataBarExp',
  'QRCode', 'PDF417', 'DataMatrix', 'Aztec',
] as const;

/** Formats without a mandatory check digit need two identical consecutive reads before we accept them. */
export const WEAK_CHECKSUM_FORMATS = new Set(['Code39', 'Codabar', 'ITF']);

export type Detection = { text: string; format: string; pass: string };

export type RawResult = { isValid: boolean; text: string; format: string };
export type ReadFn = (img: RgbaImage, opts: { formats: string[]; tryHarder: boolean; tryRotate: boolean; tryInvert: boolean; tryDownscale: boolean; maxNumberOfSymbols: number }) => Promise<RawResult[]>;

type Pass = { name: string; build: (frame: RgbaImage, guide: Rect) => RgbaImage };

const inGuide = (fn: (img: RgbaImage) => RgbaImage) => (frame: RgbaImage, guide: Rect) => fn(crop(frame, guide));
const enlarge = (img: RgbaImage) => scale(img, Math.min(2, 1600 / img.width));

/**
 * Live-camera passes. One pass runs per frame, round-robin, so each decode stays short
 * (~10–40 ms) while the full set (tilt, distance) is covered every few hundred milliseconds.
 */
export const LIVE_PASSES: Pass[] = [
  { name: 'full', build: f => f },
  { name: 'guide+10', build: inGuide(i => rotate(i, 10)) },
  { name: 'guide-zoom', build: inGuide(enlarge) },
  { name: 'guide-10', build: inGuide(i => rotate(i, -10)) },
  { name: 'guide', build: inGuide(i => i) },
  { name: 'guide+20', build: inGuide(i => rotate(i, 20)) },
  { name: 'guide-20', build: inGuide(i => rotate(i, -20)) },
  { name: 'guide-zoom+10', build: inGuide(i => rotate(enlarge(i), 10)) },
  { name: 'guide-zoom-10', build: inGuide(i => rotate(enlarge(i), -10)) },
];

/** Still-image passes (uploaded photos): try everything, in order of cost. */
const STILL_ANGLES = [8, -8, 16, -16, 24, -24, 32, -32, 45, -45];

const OPTIONS = { formats: [...ENABLED_FORMATS], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 1 };

function first(results: RawResult[], pass: string): Detection | null {
  const hit = results.find(r => r.isValid && r.text.length > 0);
  return hit ? { text: hit.text, format: hit.format, pass } : null;
}

export function createDecoder(read: ReadFn) {
  return {
    async decodePass(frame: RgbaImage, passIndex: number, guide: Rect = defaultGuide(frame)): Promise<Detection | null> {
      const pass = LIVE_PASSES[passIndex % LIVE_PASSES.length];
      return first(await read(pass.build(frame, guide), OPTIONS), pass.name);
    },
    async decodeStill(image: RgbaImage): Promise<Detection | null> {
      const full = first(await read(image, OPTIONS), 'full');
      if (full) return full;
      const guide = defaultGuide(image);
      for (const pass of LIVE_PASSES.slice(1)) {
        const hit = first(await read(pass.build(image, guide), OPTIONS), pass.name);
        if (hit) return hit;
      }
      for (const angle of STILL_ANGLES) {
        const hit = first(await read(rotate(image, angle), OPTIONS), `full${angle > 0 ? '+' : ''}${angle}`);
        if (hit) return hit;
      }
      return null;
    },
  };
}

/** Readable label for a zxing-wasm format name. */
export function formatLabel(format: string) {
  const labels: Record<string, string> = { Code128: 'Code 128', Code39: 'Code 39', Code93: 'Code 93', QRCode: 'QR code', PDF417: 'PDF417', DataMatrix: 'Data Matrix', EAN13: 'EAN-13', EAN8: 'EAN-8', UPCA: 'UPC-A', UPCE: 'UPC-E', DataBar: 'DataBar', DataBarExp: 'DataBar Expanded' };
  return labels[format] ?? format;
}
