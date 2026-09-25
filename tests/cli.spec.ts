import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';

// Runs the built CLI (npm test builds first), the same file users get from the package.
const run = (...args: string[]) => spawnSync(process.execPath, ['dist/cli.js', ...args], { encoding: 'utf8' });

test('cli url: healthy sample passes, no-shell sample fails with exit 1', () => {
  const ok = run('url', 'http://127.0.0.1:4173/healthy/');
  expect(ok.stdout).toContain('PASSED     offline-navigation (service worker: controlled)');
  expect(ok.status).toBe(0);
  const bad = run('url', 'http://127.0.0.1:4173/broken-no-shell/');
  expect(bad.stdout).toMatch(/FAILED\s+offline-navigation/);
  expect(bad.status).toBe(1);
});

test('cli url: rejects a non-http argument', () => {
  expect(run('url', 'file:///etc/passwd').status).toBe(1);
});
