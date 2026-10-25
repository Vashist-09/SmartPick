import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page, expect } from '@playwright/test';
import { loadPng } from '../unit/zxingNode';

export const FIX = join(import.meta.dirname, '..', 'fixtures');
export const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5091';
export const PASSWORD = process.env.E2E_OPERATOR_PASSWORD ?? 'e2e-local-operator-password';
const VIDEO_DIR = join(import.meta.dirname, '..', '..', 'test-results', 'fake-camera');

/**
 * Converts a PNG fixture into a Y4M (YUV 4:2:0) clip for Chromium's fake camera
 * (--use-file-for-fake-video-capture). Pure JS, so no ffmpeg is needed.
 */
export function y4mFromPng(name: string, dir = 'frames'): string {
  mkdirSync(VIDEO_DIR, { recursive: true });
  const out = join(VIDEO_DIR, `${dir}-${name}.y4m`);
  if (existsSync(out)) return out;
  const img = loadPng(join(FIX, dir, name + '.png'));
  const w = img.width & ~1, h = img.height & ~1;
  const Y = Buffer.alloc(w * h), U = Buffer.alloc((w / 2) * (h / 2)), V = Buffer.alloc((w / 2) * (h / 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * img.width + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    Y[y * w + x] = Math.max(0, Math.min(255, Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16)));
    if (y % 2 === 0 && x % 2 === 0) {
      const j = (y / 2) * (w / 2) + x / 2;
      U[j] = Math.max(0, Math.min(255, Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128)));
      V[j] = Math.max(0, Math.min(255, Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128)));
    }
  }
  const frame = Buffer.concat([Buffer.from('FRAME\n'), Y, U, V]);
  writeFileSync(out, Buffer.concat([Buffer.from(`YUV4MPEG2 W${w} H${h} F15:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));
  return out;
}

export async function launchWithCamera(video: string): Promise<Browser> {
  return chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
}

export async function signIn(page: Page) {
  await page.goto(BASE);
  await page.getByLabel('Operator password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Find a student' })).toBeVisible();
}

/** Seeds data through the real API (same code paths as the UI). */
export async function apiAs(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(async ([m, p, b]) => {
    const r = await fetch(p as string, { method: m as string, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, path, body] as const);
}

/** Counts live camera tracks, to prove the scanner releases the camera. */
export const TRACK_COUNTER = `(() => {
  const live = new Set();
  const orig = navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (!orig) return;
  navigator.mediaDevices.getUserMedia = async (c) => { const s = await orig(c); s.getTracks().forEach(t => { live.add(t); const stop = t.stop.bind(t); t.stop = () => { live.delete(t); stop(); }; }); window.__gumCalls = (window.__gumCalls || 0) + 1; return s; };
  window.__liveTracks = () => [...live].filter(t => t.readyState === 'live').length;
})();`;
