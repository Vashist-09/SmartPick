// Pure RGBA image helpers used by the decoder worker (and by Node tests).
// They avoid OffscreenCanvas so the same code runs in every browser worker and in Node.

export type RgbaImage = { data: Uint8ClampedArray; width: number; height: number };
export type Rect = { x: number; y: number; width: number; height: number };

export function crop(src: RgbaImage, rect: Rect): RgbaImage {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(src.width - x0, Math.floor(rect.width)));
  const h = Math.max(1, Math.min(src.height - y0, Math.floor(rect.height)));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y0 + y) * src.width + x0) * 4;
    out.set(src.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data: out, width: w, height: h };
}

/** Bilinear resize by a factor (used to enlarge small, distant barcodes). */
export function scale(src: RgbaImage, factor: number): RgbaImage {
  const w = Math.max(1, Math.round(src.width * factor));
  const h = Math.max(1, Math.round(src.height * factor));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y1 = Math.floor(fy), y2 = Math.min(src.height - 1, y1 + 1), wy = fy - y1;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x1 = Math.floor(fx), x2 = Math.min(src.width - 1, x1 + 1), wx = fx - x1;
      const a = (y1 * src.width + x1) * 4, b = (y1 * src.width + x2) * 4, c = (y2 * src.width + x1) * 4, d = (y2 * src.width + x2) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src.data[a + k] + (src.data[b + k] - src.data[a + k]) * wx;
        const bottom = src.data[c + k] + (src.data[d + k] - src.data[c + k]) * wx;
        out[o + k] = top + (bottom - top) * wy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Rotate around the centre by `degrees` (bilinear), keeping the same canvas size.
 * Uncovered corners are filled with white so they read as quiet zone, not as bars.
 */
export function rotate(src: RgbaImage, degrees: number): RgbaImage {
  const { width: w, height: h } = src;
  const out = new Uint8ClampedArray(w * h * 4);
  const rad = (degrees * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    const dy = y - cy;
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      // Inverse mapping: destination pixel -> source coordinate.
      const fx = cos * dx + sin * dy + cx;
      const fy = -sin * dx + cos * dy + cy;
      const o = (y * w + x) * 4;
      if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255; continue; }
      const x1 = Math.floor(fx), y1 = Math.floor(fy), x2 = Math.min(w - 1, x1 + 1), y2 = Math.min(h - 1, y1 + 1);
      const wx = fx - x1, wy = fy - y1;
      const a = (y1 * w + x1) * 4, b = (y1 * w + x2) * 4, c = (y2 * w + x1) * 4, d = (y2 * w + x2) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src.data[a + k] + (src.data[b + k] - src.data[a + k]) * wx;
        const bottom = src.data[c + k] + (src.data[d + k] - src.data[c + k]) * wx;
        out[o + k] = top + (bottom - top) * wy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Clamp a rectangle into the image bounds. */
export function clampRect(img: { width: number; height: number }, r: Rect): Rect {
  const x = Math.max(0, Math.min(img.width - 1, r.x));
  const y = Math.max(0, Math.min(img.height - 1, r.y));
  return { x, y, width: Math.max(1, Math.min(img.width - x, r.width)), height: Math.max(1, Math.min(img.height - y, r.height)) };
}

/** The region of the frame inside the on-screen scan guide; defaults to a centred band. */
export function defaultGuide(img: { width: number; height: number }): Rect {
  return clampRect(img, { x: img.width * 0.08, y: img.height * 0.18, width: img.width * 0.84, height: img.height * 0.64 });
}
