import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/*.spec.ts', 'demo/*.spec.ts'],
  reporter: [['list'], ['./src/reporter.ts', { outputDir: process.env.OC_OUT }]],
  webServer: { command: 'node samples/serve.mjs 4173', url: 'http://127.0.0.1:4173/healthy/', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
