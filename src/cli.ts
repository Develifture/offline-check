#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { OfflineSpec } from './core.js';

const TEMPLATE = `import { test, expect } from '@playwright/test';
import { offlineChecks, type OfflineSpec } from 'offline-check';

// Edit URL and selectors. OfflineCheck supplies the network transitions and evidence;
// you supply what "ready", "usable" and "saved" mean in your app.
const spec: OfflineSpec = {
  url: 'http://localhost:3000/',
  ready: async (page) => { await expect(page.locator('#app')).toBeVisible(); },
  view: async (page) => { await expect(page.locator('#app')).toBeVisible(); },
  write: {
    action: async (page, token) => {
      await page.fill('#new-note', token);
      await page.click('#add-note');
    },
    assert: async (page, token) => { await expect(page.getByText(token)).toBeVisible(); },
  },
  reconnect: {
    assert: async (page, token) => { await expect(page.getByText(token)).toBeVisible(); },
  },
  // secrets: ['my-api-key'],          // your own values to scrub from error text
  // maskSelectors: ['.user-email'],   // hide in failure screenshots
  // requireServiceWorker: true,       // fail offline-navigation unless a service worker served it
};

// Register from THIS file: Playwright ties tests to the file that calls test().
for (const c of offlineChecks(spec)) test(c.name, c.run);
`;

const USAGE = `usage:
  offline-check init         write an editable offline-check.spec.ts (full check: writes, reload, reconnect)
  offline-check url <url> [--device "iPhone 15"] [--browser chromium|webkit|firefox]
                             quick check, no spec: does the page stay usable and load fresh while offline?
                             --device uses a Playwright device profile (screen, touch, user agent, its browser).`;

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'url') {
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { device: { type: 'string' }, browser: { type: 'string' } } });
  await quick(positionals[0], values.device, values.browser);
}
else if (cmd !== 'init') {
  console.log(USAGE);
  process.exit(cmd && cmd !== '--help' && cmd !== '-h' ? 1 : 0);
}

/** Zero-config check of the two scenarios that need no app knowledge. Data scenarios need a spec (init). */
async function quick(url?: string, device?: string, browserName?: string): Promise<never> {
  if (!url || !/^https?:\/\//i.test(url)) { console.error('offline-check url: give a full http(s) URL, e.g. http://localhost:3000/'); process.exit(1); }
  const pw = await import('@playwright/test');
  const { runScenario, deviceOptions } = await import('./core.js');
  const profile = device ? pw.devices[device] : undefined;
  if (device && !profile) {
    const near = Object.keys(pw.devices).filter((d) => d.toLowerCase().includes(device.toLowerCase().split(' ')[0])).slice(0, 8);
    console.error(`offline-check: unknown device "${device}".${near.length ? ` Try: ${near.join(', ')}` : ''}`);
    process.exit(1);
  }
  const engine = browserName ?? profile?.defaultBrowserType ?? 'chromium';
  if (engine !== 'chromium' && engine !== 'webkit' && engine !== 'firefox') { console.error('offline-check: --browser must be chromium, webkit or firefox'); process.exit(1); }
  const spec: OfflineSpec = {
    url,
    // ponytail: "settled" = load + network idle + any registered service worker active. Apps that register later need a spec.
    ready: async (page) => {
      await page.waitForLoadState('load');
      await page.waitForLoadState('networkidle');
      await page.evaluate(async () => { if (await navigator.serviceWorker?.getRegistration()) await navigator.serviceWorker.ready; });
    },
    view: async (page) => { if (!(await page.locator('body').innerText()).trim()) throw new Error('page body is empty'); },
  };
  const browser = await pw[engine].launch().catch((e: Error) => {
    console.error(`offline-check: could not start ${engine} (${e.message.split('\n')[0]}). Run: npx playwright install ${engine}`);
    process.exit(1);
  });
  let failed = false;
  for (const name of ['warm-disconnect', 'offline-navigation'] as const) {
    const r = await runScenario(browser, spec, name, profile ? deviceOptions(profile as unknown as Record<string, unknown>) : {});
    failed ||= r.status === 'failed';
    const sw = r.serviceWorker ? ` (service worker: ${r.serviceWorker})` : '';
    const detail = r.status === 'passed' ? sw : r.status === 'skipped' ? ` - ${r.reason}` : ` [${r.phase}] ${r.error ?? ''}`;
    console.log(`offline-check ${r.status.toUpperCase().padEnd(10)} ${name}${detail}`);
  }
  await browser.close();
  console.log(`Ran in ${engine}${device ? ` as ${device}` : ''}. Emulation is not a real device.`);
  console.log('Quick check covers only open-page and fresh-load offline. For saved data, reload and reconnect: offline-check init');
  process.exit(failed ? 1 : 0);
}
if (existsSync('offline-check.spec.ts')) {
  console.error('offline-check.spec.ts exists; not overwriting.');
  process.exit(1);
}
writeFileSync('offline-check.spec.ts', TEMPLATE);
console.log(`Created offline-check.spec.ts. Next:
  1. Edit the URL and selectors.
  2. In playwright.config.ts add: reporter: [['list'], ['offline-check/reporter']]
     and your webServer (or start the app yourself).
  3. Run: npx playwright test offline-check.spec.ts
Reports: offline-check-results/report.html (diagnosis and fixes), fix-plan.md (for coding agents), results.json. Keep them out of Git.`);
