// Not an assertion suite: captures screenshots for visual review (run with SCREENSHOTS=1).
import { test, expect } from '@playwright/test';
import { launchWithCamera, signIn, y4mFromPng } from './helpers';
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture review screenshots');
const out = process.env.SCREENSHOT_DIR ?? 'test-results/screenshots';
test('capture', async () => {
  const browser = await launchWithCamera(y4mFromPng('heavily-damaged'));
  for (const [name, w, h] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
    const ctx = await browser.newContext({ permissions: ['camera'], viewport: { width: w, height: h }, deviceScaleFactor: name === 'mobile' ? 2 : 1 });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.screenshot({ path: `${out}/${name}-login.png` });
    await signIn(page);
    await page.locator('#lookup-registration').fill('24CS104');
    await page.getByRole('button', { name: 'Look up' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${name}-desk.png`, fullPage: true });
    await page.getByRole('button', { name: 'Scan ID card' }).click();
    await expect(page.getByTestId('scanner-phase')).toHaveText('scanning', { timeout: 15000 }); await page.waitForTimeout(800);
    await page.locator('.scanner-diagnostics summary').click({ timeout: 5000 });
    await page.screenshot({ path: `${out}/${name}-scanner.png`, timeout: 10000, animations: 'disabled', caret: 'hide' });
    await ctx.close();
  }
  await browser.close();
});
