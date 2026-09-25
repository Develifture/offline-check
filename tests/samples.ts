import { expect } from '@playwright/test';
import type { OfflineSpec } from '../src/index.js';

/** Spec for the sample notes app; every sample shares the same selectors. */
export const sampleSpec = (dir: string, extra: Partial<OfflineSpec> = {}): OfflineSpec => ({
  url: `http://localhost:4173/${dir}/`,
  ready: async (page) => { await expect(page.locator('#app[data-ready]')).toBeAttached(); },
  view: async (page) => { await expect(page.locator('#new-note')).toBeVisible(); },
  write: {
    action: async (page, token) => { await page.fill('#new-note', token); await page.click('#add-note'); },
    assert: async (page, token) => { await expect(page.locator('#notes li', { hasText: token })).toBeVisible({ timeout: 2000 }); },
  },
  reconnect: {
    assert: async (page, token) => {
      await expect(page.locator('#status')).toHaveText('online', { timeout: 2000 });
      await expect(page.locator('#notes li', { hasText: token })).toBeVisible({ timeout: 2000 });
    },
  },
  timeout: 8000,
  ...extra,
});
