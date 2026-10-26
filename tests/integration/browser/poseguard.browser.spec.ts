import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import { installCamera } from '../fixtures/camera';
import { openSelfieRequest } from '../fixtures/request';

async function openSelfie(page: Page, query = '') {
  await openSelfieRequest(page, query);
  await expect(page.getByRole('region', { name: 'Movement check' })).toBeVisible();
}
if (!("bun" in process.versions)) {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/consent', route => route.fulfill({ json: { analytics: 'denied' } }));
  });
  test('direct visits and recovery never load movement detection or create a challenge', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', request => { if (/mediapipe|pose\.worker|api\/poseguard/.test(request.url())) requests.push(request.url()); });
    await page.goto('/verify');
    await expect(page.getByRole('heading', { name: 'This request can’t be verified' })).toBeVisible();
    await page.goto('/recover');
    await page.getByRole('button', { name: 'Go to authenticator' }).click();
    await expect(page.getByRole('heading', { name: 'Your authenticator' })).toBeVisible();
    await expect(page.locator('video')).toHaveCount(0);
    expect(requests).toEqual([]);
  });
  test.describe('server-checked PoseGuard', () => {
    test.beforeEach(async ({ page }) => { await installCamera(page); });

    test('four movements submit measurements, wait for the verdict, then stop the camera', async ({ page }) => {
      let submitted: Record<string, unknown> | undefined;
      let finish!: () => void;
      const waiting = new Promise<void>(resolve => { finish = resolve; });
      await page.route('**/api/poseguard/verify', async route => {
        submitted = route.request().postDataJSON();
        await waiting;
        await route.fallback();
      });
      await openSelfie(page);
      await expect(page.getByRole('heading', { name: 'Checking your movements' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save with passkey' })).toHaveCount(0);
      expect(Object.keys(submitted!).sort()).toEqual(['capability', 'evidence', 'id']);
      expect(JSON.stringify(submitted)).not.toMatch(/image|landmarks|embedding|base64|signature|rp_id/);
      finish();
      await expect(page.getByRole('button', { name: 'Save with passkey' })).toBeVisible();
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      await expect(page.locator('video')).toHaveCount(0);
      await page.getByRole('button', { name: 'Not now' }).click();
      expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    });

    test('an API rejection cannot show completion or saving', async ({ page }) => {
      await page.route('**/api/poseguard/verify', route => route.fulfill({ json: { profile: 'facepad-poseguard-v8', status: 'failed', outcome: 'did_not_follow', reason: 'The movements could not be verified. Try again.' } }));
      await openSelfie(page);
      await expect(page.getByText('The movements could not be verified. Try again.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save with passkey' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Selfie captured' })).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
    });

    test('closing and backgrounding stop the camera and invalidate the attempt', async ({ page }) => {
      let cancelled = 0;
      page.on('request', request => { if (request.url().endsWith('/api/poseguard/cancel')) cancelled++; });
      await openSelfie(page, '?unaligned');
      await expect(page.getByRole('heading', { name: 'Look straight at the camera' })).toBeVisible();
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.getByRole('heading', { name: 'Your camera is off' })).toBeVisible();
      await expect.poll(() => cancelled).toBe(1);
      expect(await page.evaluate(() => (window as any).cameraTest.stopped)).toBeGreaterThan(0);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.getByRole('heading', { name: 'Look straight at the camera' })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel check' }).click();
      await expect(page.getByRole('heading', { name: 'Check cancelled' })).toBeVisible();
      await expect.poll(() => cancelled).toBe(2);
    });

    test('permission denial can retry with a fresh challenge', async ({ page }) => {
      let created = 0;
      page.on('request', request => { if (request.url().endsWith('/api/poseguard/challenge')) created++; });
      await openSelfie(page, '?deny');
      await expect(page.getByRole('heading', { name: 'Allow camera access' })).toBeVisible();
      await page.evaluate(() => { (window as any).cameraTest.deny = false; });
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('button', { name: 'Save with passkey' })).toBeVisible();
      expect(created).toBe(2);
    });

    test('real MediaPipe does not accept the faceless fixture', async ({ page }) => {
      await openSelfie(page, '?real-worker');
      await expect(page.getByRole('heading', { name: 'Look straight at the camera' })).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole('button', { name: 'Save with passkey' })).toHaveCount(0);
      await page.getByRole('button', { name: 'Cancel check' }).click();
    });

    test('movement guidance and retry screens fit phones and desktops', async ({ page }, info) => {
      await page.addInitScript({ content: axe.source });
      await openSelfie(page, '?unaligned');
      await expect(page.getByRole('heading', { name: 'Look straight at the camera' })).toBeVisible();
      for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const footer = (await page.getByRole('contentinfo').boundingBox())!;
        for (const control of [page.locator('.selfie-camera-stage'), page.locator('.selfie-hint'), page.locator('.selfie-about summary')]) {
          const box = (await control.boundingBox())!;
          expect(box.y + box.height).toBeLessThanOrEqual(footer.y + 1);
        }
        await page.screenshot({ path: `test-results/screenshots/${info.project.name}-poseguard-${viewport.width}.png`, fullPage: true });
      }
      await page.evaluate(() => { (window as any).cameraTest.aligned = true; });
      await expect(page.locator('.poseguard-target')).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${info.project.name}-poseguard-target.png`, fullPage: true });
      await page.getByRole('button', { name: 'Cancel check' }).click();
      await openSelfie(page, '?deny');
      await expect(page.getByRole('heading', { name: 'Allow camera access' })).toBeVisible();
      const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations);
      expect(violations).toEqual([]);
      for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        const footer = (await page.getByRole('contentinfo').boundingBox())!;
        const button = (await page.getByRole('button', { name: 'Try again' }).boundingBox())!;
        const hint = (await page.locator('.selfie-hint').boundingBox())!;
        expect(hint.y + hint.height).toBeLessThanOrEqual(button.y);
        expect(button.y + button.height).toBeLessThanOrEqual(footer.y);
        await page.screenshot({ path: `test-results/screenshots/${info.project.name}-poseguard-retry-${viewport.width}.png`, fullPage: true });
      }
    });
  });
}
