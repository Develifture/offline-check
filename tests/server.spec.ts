import { test, expect } from '@playwright/test';

// The sample server must survive bad requests (it once crashed on any 404).
test('sample server survives 404, bad escape and traversal', async ({ request }) => {
  const base = 'http://127.0.0.1:4173';
  expect((await request.get(`${base}/nope.js`)).status()).toBe(404);
  expect((await request.get(`${base}/%E0%A4%A`)).status()).toBe(400);
  expect((await request.get(`${base}/..%5c..%5cpackage.json`)).status()).toBe(404);
  expect((await request.get(`${base}/healthy/`)).status()).toBe(200);
});
