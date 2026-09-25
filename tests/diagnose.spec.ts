import { test, expect } from '@playwright/test';
import { diagnose, missingAssets } from '../src/diagnose.js';
import { issues } from '../src/render.js';

const row = (over: object) => ({
  schemaVersion: 1 as const, scenario: 'offline-navigation' as const, status: 'failed' as const, phase: 'offline-navigation',
  exercised: ['warmed page online'], url: 'http://127.0.0.1:4175/', browser: 'chromium', consoleErrors: [], pageErrors: [],
  failedRequests: [], project: 'chromium', retry: 0, file: 'x.spec.ts', ...over,
});

test('each failing phase maps to its own diagnosis', () => {
  const title = (over: object) => diagnose(row(over))?.title;
  expect(title({ error: 'page.goto: net::ERR_INTERNET_DISCONNECTED' })).toBe('Nothing can serve the app without a network');
  expect(title({ error: 'no service worker controlled the offline load' })).toBe('The page loaded, but not from a service worker');
  expect(title({ scenario: 'offline-write-reload', phase: 'offline-reload' })).toBe('Nothing can serve the app without a network');
  expect(title({ scenario: 'offline-write-reload', phase: 'persisted-after-reload' })).toBe('Data entered offline was lost on reload');
  expect(title({ scenario: 'reconnect', phase: 'reconnect' })).toBe('The app went wrong when the network came back');
  expect(title({ phase: 'warm', error: 'phase "warm" timed out after 8000ms' })).toBe('The app never became ready, even online');
  // the old calculator: loaded fine, never registered a service worker, spec waits for one
  const noSw = diagnose(row({ phase: 'warm', error: 'phase "warm" timed out after 8000ms', swRegistered: false, appFiles: ['/', '/app.js', '/vendor/math.js'] }));
  expect(noSw?.title).toBe('The app has no service worker, so nothing is cached for offline use');
  expect(noSw?.snippet?.code).toContain('["/","/app.js","/vendor/math.js"]');
  expect(title({ status: 'passed', serviceWorker: 'none' })).toBe('Passed, but only thanks to the HTTP cache');
  expect(diagnose(row({ status: 'passed', serviceWorker: 'controlled' }))).toBeUndefined();
});

test('the service worker snippet lists same-origin files that failed offline', () => {
  const r = row({ failedRequests: ['GET http://127.0.0.1:4175/app.js net::ERR_INTERNET_DISCONNECTED', 'GET https://cdn.example/x.js net::ERR', 'POST http://127.0.0.1:4175/api net::ERR'] });
  expect(missingAssets(r)).toEqual(['/app.js']);
  expect(diagnose(r)?.snippet?.code).toContain('["/app.js"]');
});

test('scenarios with the same cause become one issue', () => {
  const list = issues([
    row({}), row({ scenario: 'offline-write-reload', phase: 'offline-reload' }), row({ scenario: 'reconnect', phase: 'offline-reload' }),
    row({ scenario: 'warm-disconnect', status: 'passed', phase: 'view-usable' }),
  ]);
  expect(list).toHaveLength(1);
  expect(list[0].rows.map((r) => r.scenario)).toEqual(['offline-navigation', 'offline-write-reload', 'reconnect']);
});
