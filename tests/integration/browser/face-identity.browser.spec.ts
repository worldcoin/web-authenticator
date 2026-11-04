import { expect, test as base } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveFaceIdentitySeed } from '../../../web/lib/face-identity-seed';
import type { WalletSession } from '../../../web/lib/wallet-session';

// WebKit's ephemeral contexts cannot open OPFS; exercise the real worker in an
// isolated persistent profile, as a normal browser session would.
const test = base.extend({
  context: async ({ playwright, browserName, baseURL, launchOptions }, use) => {
    const profile = await mkdtemp(join(tmpdir(), 'wa-face-identity-'));
    try {
      const context = await playwright[browserName].launchPersistentContext(profile, { ...launchOptions, baseURL });
      try { await use(context); } finally { await context.close(); }
    } finally { await rm(profile, { recursive: true, force: true }); }
  },
});

if (!("bun" in process.versions)) {
  test('the PRF face seed produces the expected commitment in the real WalletKit worker', async ({ page }) => {
    // Serve the installed package, including its real WASM, without a production test entry point.
    const dist = resolve(import.meta.dirname, '../../../web/node_modules/@worldcoin/walletkit-web/dist');
    const prefix = '/__walletkit-test/';
    const assets = new Set(['index.js', 'walletkit.worker.js', 'generated/walletkit.wasm']);
    await page.route(`**${prefix}**`, async route => {
      const asset = new URL(route.request().url()).pathname.slice(prefix.length);
      if (!assets.has(asset)) { await route.abort(); return; }
      await route.fulfill({ body: await readFile(resolve(dist, asset)), contentType: asset.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' });
    });
    await page.goto('/');
    const seed = await deriveFaceIdentitySeed(new Uint8Array(32).fill(7));
    const otherSeed = await deriveFaceIdentitySeed(new Uint8Array(32).fill(8));
    try {
      const result = await page.evaluate(async ({ first, other, moduleUrl }) => {
        const { initializeWalletKit } = await import(moduleUrl) as { initializeWalletKit(): Promise<WalletSession['client']> };
        const client = await initializeWalletKit();
        const bytes = new Uint8Array(first);
        const differentBytes = new Uint8Array(other);
        first.fill(0); other.fill(0);
        try {
          const identity = await client.FaceIdentity.fromSeed(bytes);
          const reopened = await client.FaceIdentity.fromSeed(bytes);
          const different = await client.FaceIdentity.fromSeed(differentBytes);
          bytes.fill(0);
          differentBytes.fill(0);
          try {
            return { first: await identity.commitment(), reopened: await reopened.commitment(), different: await different.commitment() };
          } finally { identity.free(); reopened.free(); different.free(); }
        } finally {
          bytes.fill(0); differentBytes.fill(0);
          await client.close();
        }
      }, { first: Array.from(seed), other: Array.from(otherSeed), moduleUrl: `${prefix}index.js` });
      // Independently generated with full semaphore-rs and Oxide's face_credential nonce.
      expect(result.first).toBe('0x109f94f94dc59d443a3e23b315b9984f1f1cf3e4b531721293774f0d24985ea8');
      expect(result.reopened).toBe(result.first);
      expect(result.different).not.toBe(result.first);
    } finally { seed.fill(0); otherSeed.fill(0); }
  });
}
