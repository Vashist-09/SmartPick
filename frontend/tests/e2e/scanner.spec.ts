// Camera-integration tests: Chromium's fake camera streams a synthetic ID-card video into the real
// app; the real worker + zxing-wasm decoder reads it and the real backend answers the lookup.
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { apiAs, BASE, launchWithCamera, signIn, TRACK_COUNTER, y4mFromPng, FIX } from './helpers';
import { join } from 'node:path';



let seedBrowser: Browser;
test.beforeAll(async () => {
  seedBrowser = await chromium.launch();
  const page = await seedBrowser.newPage();
  await signIn(page);
  for (const [reg, trk] of [['24CS104', 'SCAN-TRK-1'], ['0012345', 'SCAN-TRK-0']]) {
    const r = await apiAs(page, 'POST', '/api/parcels', { registrationNo: reg, studentName: 'Test Student', trackingId: trk, paymentType: 'PREPAID' });
    expect([201, 409]).toContain(r.status);
  }
  const slots = (await apiAs(page, 'GET', '/api/slots')).body;
  const parcels = (await apiAs(page, 'GET', '/api/students/24CS104/parcels')).body.parcels;
  const p = parcels.find((x: { tracking_id: string }) => x.tracking_id === 'SCAN-TRK-1');
  if (p.parcel_status === 'REGISTERED') expect((await apiAs(page, 'POST', `/api/parcels/${p.parcel_id}/store`, { compartmentId: slots[0].compartments[0].compartmentId })).status).toBe(200);
});
test.afterAll(async () => { await seedBrowser?.close(); });

async function openScannerWith(video: string, opts: { initScript?: string } = {}) {
  const browser = await launchWithCamera(video);
  const context = await browser.newContext({ permissions: ['camera'] });
  if (opts.initScript) await context.addInitScript(opts.initScript);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME/.test(m.text() + (m.location().url ?? ''))) consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push(e.message));
  const lookups: string[] = [];
  page.on('request', r => { if (r.url().includes('/api/students/')) lookups.push(decodeURIComponent(r.url())); });
  await signIn(page);
  await page.getByRole('button', { name: 'Scan ID card' }).click();
  await expect(page.getByRole('dialog', { name: 'Scan student ID card' })).toBeVisible();
  return { browser, page, lookups, consoleErrors };
}

const phase = (page: Page) => page.getByTestId('scanner-phase');

const detectCases: [string, string][] = [
  ['straight', 'level card'], ['angled-12deg', 'tilted 12°'], ['angled-minus-12deg', 'tilted −12°'], ['angled-25deg', 'tilted 25°'],
  ['perspective', 'perspective skew'], ['far-small', 'held far away'], ['off-center-low', 'held low in frame'],
  ['blurred', 'out of focus'], ['low-light', 'low light + noise'], ['glare', 'glare'], ['low-contrast', 'low contrast'], ['upside-down', 'upside down'],
];
for (const [frame, label] of detectCases) {
  test(`camera scan detects the card: ${label}`, async () => {
    const { browser, page, lookups, consoleErrors } = await openScannerWith(y4mFromPng(frame));
    try {
      await expect(page.getByText('Showing parcels for')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.result-meta')).toContainText('24CS104');
      await expect(page.locator('.result-meta')).toContainText('Code 128');
      await expect(page.locator('.parcel-list').getByText('SCAN-TRK-1')).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(lookups.filter(u => u.includes('/api/students/24CS104/parcels'))).toHaveLength(1);
      expect(consoleErrors).toEqual([]);
    } finally { await browser.close(); }
  });
}

test('no barcode in view: keeps scanning, shows no false error, decodes frames continuously', async () => {
  const { browser, page, lookups } = await openScannerWith(y4mFromPng('no-barcode'));
  try {
    await expect(phase(page)).toHaveText('scanning', { timeout: 15000 });
    await page.waitForTimeout(4000);
    await expect(phase(page)).toHaveText('scanning');
    await expect(page.locator('.scanner-status')).not.toHaveClass(/is-error/);
    const frames = Number((await page.getByTestId('frames-decoded').textContent())!.split(' ')[0]);
    expect(frames).toBeGreaterThan(10);
    expect(lookups).toHaveLength(0);
  } finally { await browser.close(); }
});

test('decoded value with no matching student shows "not on record" (no invented record)', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('code128-UNKNOWN99', 'cards'));
  try {
    await expect(page.getByRole('alert')).toContainText('No student with registration number 99ZZ999', { timeout: 15000 });
    await expect(page.locator('.parcel-list')).toHaveCount(0);
  } finally { await browser.close(); }
});

test('decoded value with invalid characters is rejected with an edit option, not looked up', async () => {
  const { browser, page, lookups } = await openScannerWith(y4mFromPng('code128-bad-chars', 'cards'));
  try {
    await expect(phase(page)).toHaveText('invalid', { timeout: 15000 });
    await expect(page.locator('.scanner-invalid')).toContainText('24CS104;DROP');
    expect(lookups).toHaveLength(0);
    await page.getByRole('button', { name: 'Edit as registration number' }).click();
    await expect(page.locator('#lookup-registration')).toHaveValue('24CS104;DROP');
  } finally { await browser.close(); }
});

test('leading zeros survive scan -> lookup', async () => {
  const { browser, page, lookups } = await openScannerWith(y4mFromPng('code128-0012345', 'cards'));
  try {
    await expect(page.locator('.result-meta')).toContainText('0012345', { timeout: 15000 });
    expect(lookups.some(u => u.endsWith('/api/students/0012345/parcels'))).toBe(true);
  } finally { await browser.close(); }
});

test('lower-case card matches the registered upper-case student', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('code128-lower-24cs104', 'cards'));
  try {
    await expect(page.locator('.result-meta')).toContainText('24CS104', { timeout: 15000 });
    await expect(page.locator('.parcel-list').getByText('SCAN-TRK-1')).toBeVisible();
  } finally { await browser.close(); }
});

test('Code 39 card is accepted only after confirmation reads, exactly one lookup', async () => {
  const { browser, page, lookups } = await openScannerWith(y4mFromPng('code39-24CS104', 'cards'));
  try {
    await expect(page.locator('.result-meta')).toContainText('Code 39', { timeout: 15000 });
    await page.waitForTimeout(1500);
    expect(lookups).toHaveLength(1);
  } finally { await browser.close(); }
});

test('opening and closing the scanner repeatedly releases the camera every time', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('no-barcode'), { initScript: TRACK_COUNTER });
  try {
    for (let i = 0; i < 5; i++) {
      await expect(phase(page)).toHaveText('scanning', { timeout: 15000 });
      expect(await page.evaluate(() => (window as unknown as { __liveTracks: () => number }).__liveTracks())).toBe(1);
      if (i % 2) await page.keyboard.press('Escape'); else await page.getByRole('button', { name: 'Close scanner' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __liveTracks: () => number }).__liveTracks())).toBe(0);
      await page.getByRole('button', { name: 'Scan ID card' }).click();
    }
    await expect(phase(page)).toHaveText('scanning', { timeout: 15000 });
  } finally { await browser.close(); }
});

test('Scan again / retry genuinely restarts the camera after a stop', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('code128-bad-chars', 'cards'), { initScript: TRACK_COUNTER });
  try {
    await expect(phase(page)).toHaveText('invalid', { timeout: 15000 });
    expect(await page.evaluate(() => (window as unknown as { __liveTracks: () => number }).__liveTracks())).toBe(0);
    await page.getByRole('button', { name: 'Scan again' }).click();
    await expect(phase(page)).toHaveText('invalid', { timeout: 15000 }); // re-reads the same card
    expect(await page.evaluate(() => (window as unknown as { __gumCalls: number }).__gumCalls)).toBe(2);
  } finally { await browser.close(); }
});

test('camera permission denied shows actionable guidance; manual entry still works', async () => {
  const deny = `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));`;
  const { browser, page } = await openScannerWith(y4mFromPng('straight'), { initScript: deny });
  try {
    await expect(page.getByRole('alert')).toContainText('Camera access was blocked');
    await expect(page.getByRole('button', { name: 'Retry camera' })).toBeVisible();
    await page.getByRole('button', { name: 'Type it instead' }).click();
    await page.locator('#lookup-registration').fill('24CS104');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.locator('.parcel-list').getByText('SCAN-TRK-1')).toBeVisible();
  } finally { await browser.close(); }
});

test('no camera hardware shows a clear message and offers photo upload', async () => {
  const none = `navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));`;
  const { browser, page } = await openScannerWith(y4mFromPng('straight'), { initScript: none });
  try {
    await expect(page.getByRole('alert')).toContainText('No usable camera was found');
    await page.locator('input[type=file]').setInputFiles(join(FIX, 'frames', 'angled-12deg.png'));
    await expect(page.locator('.result-meta')).toContainText('photo · Code 128', { timeout: 20000 });
  } finally { await browser.close(); }
});

test('decoder that fails to load produces an error state, not a silent dead preview', async () => {
  const browser = await launchWithCamera(y4mFromPng('straight'));
  const context = await browser.newContext({ permissions: ['camera'] });
  await context.route('**/*.wasm', r => r.fulfill({ status: 404, body: 'missing' }));
  const page = await context.newPage();
  try {
    await signIn(page);
    await page.getByRole('button', { name: 'Scan ID card' }).click();
    await expect(page.getByRole('alert')).toContainText('barcode decoder could not be loaded', { timeout: 25000 });
    await context.unroute('**/*.wasm');
    await page.getByRole('button', { name: 'Retry camera' }).click();
    await expect(page.locator('.result-meta')).toContainText('24CS104', { timeout: 20000 });
  } finally { await browser.close(); }
});

test('photo upload: supported card decodes; a photo without a code and an unsupported symbology are reported', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('no-barcode'));
  const input = page.locator('input[type=file]');
  try {
    await input.setInputFiles(join(FIX, 'frames', 'no-barcode.png'));
    await expect(phase(page)).toHaveText('no-code-in-upload', { timeout: 20000 });
    await input.setInputFiles(join(FIX, 'cards', 'maxicode-24CS104.png'));
    await expect(phase(page)).toHaveText('no-code-in-upload', { timeout: 20000 });
    await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert')).toContainText('Choose an image file');
    await input.setInputFiles(join(FIX, 'cards', 'qr-24CS104.png'));
    await expect(page.locator('.result-meta')).toContainText('photo · QR code', { timeout: 20000 });
  } finally { await browser.close(); }
});

test('server error during lookup is shown; a retry by typing succeeds', async () => {
  const browser = await launchWithCamera(y4mFromPng('straight'));
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  try {
    await signIn(page);
    await page.route('**/api/students/**', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) }));
    await page.getByRole('button', { name: 'Scan ID card' }).click();
    await expect(page.getByRole('alert')).toContainText('Internal server error', { timeout: 15000 });
    await page.unroute('**/api/students/**');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.locator('.parcel-list').getByText('SCAN-TRK-1')).toBeVisible();
  } finally { await browser.close(); }
});

test('lookup that never answers times out with a clear message (no endless spinner)', async () => {
  test.setTimeout(45000);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await signIn(page);
    await page.route('**/api/students/**', () => { /* never respond */ });
    await page.locator('#lookup-registration').fill('24CS104');
    await page.getByRole('button', { name: 'Look up' }).click();
    await expect(page.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('took too long', { timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Look up' })).toBeEnabled();
  } finally { await browser.close(); }
});

test('expired session during a scan returns to sign-in with an explanation', async () => {
  const browser = await launchWithCamera(y4mFromPng('straight'));
  const context = await browser.newContext({ permissions: ['camera'] });
  const page = await context.newPage();
  try {
    await signIn(page);
    await context.clearCookies();
    await page.getByRole('button', { name: 'Scan ID card' }).click();
    await expect(page.getByText('Your session has expired')).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel('Operator password')).toBeVisible();
  } finally { await browser.close(); }
});

void BASE;

// --- Built-in BarcodeDetector path (Chrome on macOS / Android). Headless Linux Chromium has no
// native detector, so these tests SIMULATE the browser API to verify SmartPick's integration with it.
// They do not prove Apple Vision / ML Kit decoding quality; that needs a real Mac or phone.
const fakeNative = (value: string, format = 'code_128', fail = false) => `(() => {
  class BarcodeDetector {
    static async getSupportedFormats() { return ['code_128','code_39','qr_code']; }
    constructor() {}
    async detect() { if (${fail}) throw new Error('platform service unavailable'); window.__nativeCalls = (window.__nativeCalls||0)+1; return [{ rawValue: ${JSON.stringify(value)}, format: ${JSON.stringify(format)} }]; }
  }
  window.BarcodeDetector = BarcodeDetector;
})();`;

test('[simulated native API] built-in detector result goes through the same validation and lookup', async () => {
  const { browser, page, lookups } = await openScannerWith(y4mFromPng('no-barcode'), { initScript: fakeNative('24CS104') });
  try {
    await expect(page.locator('.result-meta')).toContainText('scan · Code 128', { timeout: 15000 });
    await expect(page.locator('.parcel-list').getByText('SCAN-TRK-1')).toBeVisible();
    expect(lookups).toHaveLength(1);
  } finally { await browser.close(); }
});

test('[simulated native API] Code 39 from the built-in detector still needs two matching reads', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('no-barcode'), { initScript: fakeNative('24CS104', 'code_39') });
  try {
    await expect(page.locator('.result-meta')).toContainText('Code 39', { timeout: 15000 });
    expect(await page.evaluate(() => (window as unknown as { __nativeCalls: number }).__nativeCalls)).toBeGreaterThanOrEqual(2);
  } finally { await browser.close(); }
});

test('[simulated native API] a failing built-in detector falls back to zxing-wasm', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('angled-12deg'), { initScript: fakeNative('IGNORED', 'code_128', true) });
  try {
    await expect(page.locator('.result-meta')).toContainText('24CS104', { timeout: 15000 });
  } finally { await browser.close(); }
});

test('after 8 s without a read, the scanner shows focus/distance guidance', async () => {
  const { browser, page } = await openScannerWith(y4mFromPng('heavily-damaged'));
  try {
    await expect(page.getByText('Not reading yet?')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('native-detector')).toHaveText('not available in this browser');
  } finally { await browser.close(); }
});
