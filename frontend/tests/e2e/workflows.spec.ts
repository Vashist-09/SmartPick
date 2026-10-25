// Every visible control outside the scanner, exercised against the real backend + database.
import { test, expect, type Page } from '@playwright/test';
import { apiAs, PASSWORD, signIn } from './helpers';

const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();
function trackConsole(page: Page) {
  const errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|401/.test(m.text() + (m.location().url ?? ''))) errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

test('sign-in: wrong password shows an error; correct password opens the desk; refresh keeps the session', async ({ page }) => {
  const errors = trackConsole(page);
  await page.goto('/');
  await page.getByLabel('Operator password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid password');
  await page.getByLabel('Operator password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('SYSTEM ONLINE')).toBeVisible();
  await page.reload();
  await expect(page.getByText('SYSTEM ONLINE')).toBeVisible();
  await expect(page.locator('.slot-card:not(.skeleton)')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('register -> assign storage -> map -> lookup -> light compartment -> device collects -> lookup shows COLLECTED', async ({ page }) => {
  const errors = trackConsole(page);
  await signIn(page);
  const reg = `E2E${uniq()}`, trk = `TRK-${uniq()}`;
  const register = page.locator('form.form-grid').first();
  await register.getByLabel('Student name').fill('Test Student');
  await register.getByLabel('Registration number').fill(reg);
  await register.getByLabel('Tracking ID').fill(trk);
  await register.getByLabel('Payment type').selectOption('COD');
  const posts: string[] = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/parcels')) posts.push(r.url()); });
  await register.getByRole('button', { name: /Add to parcel queue/ }).dblclick();
  await expect(page.getByRole('status').filter({ hasText: `Parcel ${trk} registered for ${reg}` })).toBeVisible();
  expect(posts).toHaveLength(1);
  await expect(register.getByLabel('Tracking ID')).toHaveValue('');

  // Assign storage
  await page.locator('#storage-registration').fill(reg);
  await page.getByRole('button', { name: 'Find parcels' }).click();
  await page.getByLabel('Registered parcel').selectOption({ label: trk });
  const compartment = page.getByLabel('Available compartment');
  const firstOption = await compartment.locator('option').nth(1).textContent();
  await compartment.selectOption({ index: 1 });
  await page.getByRole('button', { name: /Assign parcel to compartment/ }).click();
  await expect(page.getByText(`Parcel stored in ${firstOption}`)).toBeVisible();
  await expect(page.locator('.compartment.occupied small', { hasText: trk })).toBeVisible();
  await expect(page.getByText(`${reg} has no parcels waiting to be stored.`)).toBeVisible();

  // Lookup + light
  await page.locator('#lookup-registration').fill(reg);
  await page.getByRole('button', { name: 'Look up' }).click();
  const row = page.locator('.parcel-row', { hasText: trk });
  await expect(row.locator('.pill')).toHaveText('STORED');
  await row.getByRole('button', { name: 'Light compartment' }).click();
  await expect(page.getByText(/^✓?\s*Light command queued for/)).toBeVisible();
  await row.getByRole('button', { name: 'Light compartment' }).click();
  await expect(page.getByText('A light command was already queued')).toBeVisible();

  // ESP32 side (device API) collects the parcel
  const device = await page.evaluate(async () => {
    const h = { 'x-device-key': 'e2e-device-key', 'content-type': 'application/json' };
    const poll = await (await fetch('/api/device/commands/next', { headers: h })).json();
    const c = poll.command;
    await fetch(`/api/device/commands/${c.command_id}/result`, { method: 'POST', headers: h, body: JSON.stringify({ result: 'EXECUTED' }) });
    const ev = await fetch('/api/device/events', { method: 'POST', headers: h, body: JSON.stringify({ sourceEventKey: `e2e-${c.command_id}`, slotNo: c.slot_no, compartmentNo: c.compartment_no }) });
    return { status: ev.status, body: await ev.json() };
  });
  expect(device).toEqual({ status: 200, body: { processed: true } });
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(row.locator('.pill')).toHaveText('COLLECTED');
  await expect(row.getByRole('button', { name: 'Light compartment' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('registration validation: bad registration number and duplicate tracking ID are reported', async ({ page }) => {
  await signIn(page);
  const register = page.locator('form.form-grid').first();
  await register.getByLabel('Student name').fill('Test Student');
  await register.getByLabel('Registration number').fill('24CS104;DROP');
  await register.getByLabel('Tracking ID').fill(`TRK-${uniq()}`);
  await register.getByRole('button', { name: /Add to parcel queue/ }).click();
  await expect(page.getByRole('alert')).toContainText('may only contain letters');
  const trk = `TRK-${uniq()}`;
  expect((await apiAs(page, 'POST', '/api/parcels', { registrationNo: 'DUP1', studentName: 'X', trackingId: trk, paymentType: 'PREPAID' })).status).toBe(201);
  await register.getByLabel('Registration number').fill('DUP1');
  await register.getByLabel('Tracking ID').fill(trk);
  await register.getByRole('button', { name: /Add to parcel queue/ }).click();
  await expect(page.getByRole('alert')).toContainText('already registered');
});

test('lookup: empty input and unknown student are reported distinctly in both lookup panels', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a registration number');
  await page.locator('#lookup-registration').fill('NOBODY999');
  await page.getByRole('button', { name: 'Look up' }).click();
  await expect(page.getByRole('alert')).toContainText('No student with registration number NOBODY999');
  await page.locator('#storage-registration').fill('NOBODY999');
  await page.getByRole('button', { name: 'Find parcels' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No student with registration number NOBODY999 is on record.' }).first()).toBeVisible();
});

test('sign out returns to the sign-in screen and protected data is no longer reachable', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Operator password')).toBeVisible();
  expect((await apiAs(page, 'GET', '/api/slots')).status).toBe(401);
});

for (const vp of [{ name: 'mobile', width: 375, height: 812 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }]) {
  test(`layout has no horizontal overflow on ${vp.name}, scanner dialog fits`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await signIn(page);
    await page.locator('#lookup-registration').fill('A'.repeat(64));
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'Scan ID card' }).click();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(vp.width);
    await page.getByRole('button', { name: 'Close scanner' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Scan ID card' })).toBeFocused();
  });
}
