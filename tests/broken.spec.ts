import { test, expect } from '@playwright/test';
import { runScenario, toJson, redact, sanitizeUrl, type ScenarioName } from '../src/index.js';
import { sampleSpec } from './samples.js';

const cases: [string, ScenarioName, string, object?][] = [
  ['broken-no-shell', 'offline-navigation', 'offline-navigation'],
  ['broken-memory-only', 'offline-write-reload', 'persisted-after-reload'],
  ['broken-reconnect', 'reconnect', 'reconnect'],
  // HTTP-cache-only shell passes by default (reported as no service worker) but fails when one is required.
  ['broken-http-cache', 'offline-navigation', 'offline-navigation', { requireServiceWorker: true }],
];

for (const [dir, scenario, phase, extra] of cases) {
  test(`${dir} fails ${scenario} at phase ${phase}`, async ({ browser }) => {
    const r = await runScenario(browser, sampleSpec(dir, extra), scenario);
    expect(r.status).toBe('failed');
    expect(r.phase).toBe(phase);
    expect(JSON.stringify(toJson(r))).not.toMatch(/oc-[0-9a-f]{12}/);
  });
}

test('a failure lists the steps that completed before it', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('broken-memory-only'), 'offline-write-reload');
  expect(r.exercised).toEqual(['warmed page online', 'write while offline', 'reload while still offline']);
});

test('broken-no-shell still passes warm-disconnect (open page keeps working)', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('broken-no-shell'), 'warm-disconnect');
  expect(r.status).toBe('passed');
  expect(r.exercised.join()).toContain('no reload');
});

test('http-cache shell passes offline-navigation but is reported as having no service worker', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('broken-http-cache'), 'offline-navigation');
  expect(r.status).toBe('passed');
  expect(r.serviceWorker).toBe('none');
  expect(r.exercised.join()).toContain('NO service worker');
});

test('healthy sample reports service worker control', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('healthy'), 'offline-navigation');
  expect(r.serviceWorker).toBe('controlled');
});

test('unconfigured write scenario is unverified, not passed', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('healthy', { write: undefined }), 'offline-write-reload');
  expect(r.status).toBe('unverified');
});

test('a never-ready app fails at phase warm and leaves no open contexts', async ({ browser }) => {
  const r = await runScenario(browser, sampleSpec('healthy', { ready: () => new Promise(() => {}), timeout: 800 }), 'warm-disconnect');
  expect(r.status).toBe('failed');
  expect(r.phase).toBe('warm');
  expect(browser.contexts()).toHaveLength(0);
});

test('planted secrets in errors, URLs and app values never reach the serialised result', async ({ browser }) => {
  const spec = sampleSpec('healthy', {
    secrets: ['APPSECRET42'],
    url: 'http://localhost:4173/healthy/?api_key=QUERYSECRET#access_token=HASHSECRET',
    view: async (page) => {
      await page.evaluate(() => {
        console.error('login failed Bearer BEARERSECRET password=hunter2 for APPSECRET42 at http://u:USERPW@x.test/p?k=QSECRET#FRAG');
        throw new Error('boom appsecret42 C:\\Users\\SomeName\\file.js');
      }).catch(() => {});
      throw new Error('view failed api_key=sk-live-123 http://u:USERPW@x.test/#HASHSECRET2');
    },
  });
  const r = await runScenario(browser, spec, 'warm-disconnect');
  expect(r.status).toBe('failed');
  const json = JSON.stringify(toJson(r));
  for (const s of ['QUERYSECRET', 'HASHSECRET', 'BEARERSECRET', 'hunter2', 'APPSECRET42', 'appsecret42', 'USERPW', 'QSECRET', 'FRAG', 'sk-live-123', 'SomeName'])
    expect(json, s).not.toContain(s);
});

test('redact and sanitizeUrl', () => {
  expect(redact('bad OC-ABC at http://a/b?token=s3cret#h', ['oc-abc'])).toBe('bad [redacted] at http://a/b');
  expect(redact('x=1 password: hunter2 Bearer abc', [])).toBe('x=1 password: [redacted] Bearer [redacted]');
  expect(redact('see http://u:p@h/#tok')).toBe('see http://h/');
  expect(sanitizeUrl('http://localhost:1/x?key=s#h')).toBe('http://localhost:1/x');
  expect(sanitizeUrl('blob:http://h/uuid')).toBe('blob:[omitted]');
  expect(redact('at C:/Users/SomeName/app.js and C:\\Users\\Other\\x')).toBe('at ~/app.js and ~\\x');
});
