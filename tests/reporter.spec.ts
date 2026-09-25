import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs a nested Playwright run so the reporter is tested end to end.
const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/test'))), 'cli.js');
const nested = (dir: string, args: string[]) => {
  // drop Playwright's own env so the nested run starts clean
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PW_|PLAYWRIGHT)/.test(k)));
  try {
    execFileSync(process.execPath, [cli, 'test', '--config', join(process.cwd(), 'playwright.config.ts'), '--output', join(dir, 'tr'), ...args],
      { cwd: process.cwd(), env: { ...env, OC_OUT: dir }, stdio: 'pipe' });
    return 0;
  } catch (e: any) { return e.status as number; }
};

test('reporter: retries keep one row per scenario; results and html written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-rep-'));
  const code = nested(dir, ['demo/broken.spec.ts', '--retries=1', '--workers=2']);
  expect(code).not.toBe(0); // broken sample fails
  const res = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  expect(res.results).toHaveLength(4);
  expect(new Set(res.results.map((r: any) => r.scenario)).size).toBe(4);
  expect(readFileSync(join(dir, 'report.html'), 'utf8')).toContain('persisted-after-reload');
  expect(readdirSync(dir).filter((f) => f.endsWith('.png')).length).toBeGreaterThan(0);
  // the broken sample keeps notes in memory: both outputs must name that cause and the fix
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  expect(html).toContain('<h1>Data entered offline was lost on reload.</h1>');
  expect(html).toContain('data:image/png;base64,'); // screenshots embedded: one shareable file
  const plan = readFileSync(join(dir, 'fix-plan.md'), 'utf8');
  expect(plan).toContain('## 1. Data entered offline was lost on reload');
  expect(plan).toContain('- [ ] Write each change to localStorage or IndexedDB');
  expect(plan).toContain('npx playwright test demo/broken.spec.ts');
  expect(plan).not.toMatch(/oc-[0-9a-f]{12}/);
});

test('reporter: never deletes files it does not own; rows and screenshots name their spec file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-rep-'));
  writeFileSync(join(dir, 'my-diagram.png'), 'mine');
  nested(dir, ['demo/broken.spec.ts']);
  expect(readFileSync(join(dir, 'my-diagram.png'), 'utf8')).toBe('mine');
  const rows = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')).results;
  expect(rows.every((r: any) => r.file === 'demo/broken.spec.ts')).toBe(true);
  expect(rows.find((r: any) => r.screenshot)?.screenshot).toMatch(/^chromium-broken-spec-ts-.+\.png$/);
});

test('reporter: empty run leaves earlier results untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-rep-'));
  writeFileSync(join(dir, 'results.json'), '{"keep":true}');
  nested(dir, ['demo/broken.spec.ts', '--grep', 'NOMATCHXYZ']);
  expect(readFileSync(join(dir, 'results.json'), 'utf8')).toBe('{"keep":true}');
  expect(existsSync(join(dir, 'report.html'))).toBe(false);
});

test('reporter: an unverified scenario makes the run exit nonzero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-rep-'));
  expect(nested(dir, ['demo/unverified.spec.ts'])).not.toBe(0);
  expect(JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8')).results[0].status).toBe('unverified');
});
