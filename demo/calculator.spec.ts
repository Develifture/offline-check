import { test, expect } from '@playwright/test';
import { offlineChecks, type OfflineSpec } from '../src/index.js';

// A "write" here is a calculation: it lands in History and is persisted in localStorage.
const expr = (token: string) => `${parseInt(token.slice(3, 7), 16)}+1`;

const spec: OfflineSpec = {
  url: 'http://127.0.0.1:4175/',
  ready: async (page) => {
    await expect(page.locator('#keys button').first()).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker?.controller != null); // shell cached and in control
  },
  view: async (page) => { await expect(page.locator('#expr')).toBeVisible(); },
  write: {
    action: async (page, token) => { await page.fill('#expr', expr(token)); await page.press('#expr', 'Enter'); },
    assert: async (page, token) => { await expect(page.locator('#history li', { hasText: expr(token) })).toBeVisible({ timeout: 3000 }); },
  },
  reconnect: {
    assert: async (page, token) => { await expect(page.locator('#history li', { hasText: expr(token) })).toBeVisible(); },
  },
  timeout: 8000,
  requireServiceWorker: true,
};
for (const c of offlineChecks(spec)) test(c.name, c.run);
