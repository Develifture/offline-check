import { test, expect, devices } from '@playwright/test';
import { runScenario, deviceOptions } from '../src/index.js';
import { diagnose } from '../src/diagnose.js';
import { sampleSpec } from './samples.js';

// Phone emulation in Chromium runs every scenario, on a phone-sized touch screen.
test('Pixel 7 emulation: healthy sample passes on a mobile viewport', async ({ browser }) => {
  const opts = deviceOptions(devices['Pixel 7'] as unknown as Record<string, unknown>);
  let width = 0;
  const spec = sampleSpec('healthy', { view: async (page) => { width = await page.evaluate(() => screen.width); await expect(page.locator('#new-note')).toBeVisible(); } });
  for (const s of ['warm-disconnect', 'offline-navigation', 'offline-write-reload', 'reconnect'] as const) {
    const r = await runScenario(browser, spec, s, opts);
    expect(r.status, s).toBe('passed');
    expect(r.device).toMatch(/^\d+x\d+ mobile touch$/);
  }
  expect(width).toBeLessThan(500);
});

test.describe('WebKit (Safari engine)', () => {
  test('open page works; offline reload of a service-worker page is skipped as a tool limit, not failed', async ({ playwright }) => {
    const browser = await playwright.webkit.launch();
    try {
      const opts = deviceOptions(devices['iPhone 15'] as unknown as Record<string, unknown>);
      expect((await runScenario(browser, sampleSpec('healthy'), 'warm-disconnect', opts)).status).toBe('passed');
      const nav = await runScenario(browser, sampleSpec('healthy'), 'offline-navigation', opts);
      expect(nav.status).toBe('skipped');
      expect(nav.limitation).toBe('webkit-offline-sw');
      expect(diagnose(nav)?.severity).toBe('info');
      expect((await runScenario(browser, sampleSpec('healthy'), 'offline-write-reload', opts)).status).toBe('skipped');
      // no service worker at all: the offline load really fails, in WebKit too
      const bad = await runScenario(browser, sampleSpec('broken-no-shell'), 'offline-navigation', opts);
      expect(bad.status).toBe('failed');
      expect(bad.limitation).toBeUndefined();
    } finally {
      await browser.close();
    }
  });
});
