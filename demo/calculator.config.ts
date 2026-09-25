import { defineConfig, devices } from '@playwright/test';

// Real-app run against ../scientific-calculator (static, service worker in src/sw.js). Run: npm run demo:calculator
// CALC_SRC checks another copy (e.g. an old commit); OC_OUT picks the report folder.
const src = process.env.CALC_SRC ?? '../scientific-calculator/src';
export default defineConfig({
  testDir: '.',
  testMatch: ['calculator.spec.ts'],
  reporter: [['list'], ['../src/reporter.ts', { outputDir: process.env.OC_OUT ?? 'offline-check-results/calculator' }]],
  // never reuse a running server: it could be serving a different copy of the app
  webServer: { command: `node samples/serve.mjs 4175 "${src}"`, cwd: '..', url: 'http://127.0.0.1:4175/', reuseExistingServer: false },
  // one desktop browser plus two emulated phones; the iPhone profile runs WebKit, Safari's engine
  projects: [
    { name: 'Desktop Chrome', use: { browserName: 'chromium' } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } },
    { name: 'iPhone 15', use: { ...devices['iPhone 15'] } },
  ],
});
