// Package smoke test: install the packed tarball into a clean project and run the documented quick start.
// Proves exports, the reporter path, `init`, shipped samples and test discovery work from node_modules.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
// Run npm's own JS entry with node: no shell, so no Windows .cmd quoting or Node shell-args deprecation.
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('run this through npm: npm run smoke');
const run = (cmd, args, cwd, opts = {}) => execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8', ...opts });
const npm = (args, cwd) => run(process.execPath, [npmCli, ...args], cwd);

npm(['run', 'build'], root);
const packDir = mkdtempSync(join(tmpdir(), 'oc-pack-'));
const tgz = join(packDir, npm(['pack', '--pack-destination', packDir, '--silent'], root).trim().split('\n').pop());
const pw = JSON.parse(readFileSync(join(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version;

const proj = mkdtempSync(join(tmpdir(), 'oc-proj-'));
writeFileSync(join(proj, 'package.json'), JSON.stringify({ name: 'smoke', private: true, type: 'module' }));
npm(['i', '--no-audit', '--no-fund', tgz, `@playwright/test@${pw}`], proj);

const bin = join(proj, 'node_modules/offline-check/dist/cli.js');
run(process.execPath, [bin, 'init'], proj);
assert.ok(existsSync(join(proj, 'offline-check.spec.ts')), 'init wrote the spec');

// Point the generated spec at the shipped healthy sample (same selectors as the template use #new-note/#add-note).
const port = 4179;
const spec = readFileSync(join(proj, 'offline-check.spec.ts'), 'utf8')
  .replace('http://localhost:3000/', `http://127.0.0.1:${port}/healthy/`)
  .replace(/ready: .*\n/, "ready: async (page) => { await expect(page.locator('#app[data-ready]')).toBeAttached(); },\n")
  .replace(/view: .*\n/, "view: async (page) => { await expect(page.locator('#new-note')).toBeVisible(); },\n")
  .replace(/getByText\(token\)/g, "locator('#notes li', { hasText: token })");
writeFileSync(join(proj, 'offline-check.spec.ts'), spec);
writeFileSync(join(proj, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({
  reporter: [['list'], ['offline-check/reporter']],
  webServer: { command: 'node node_modules/offline-check/samples/serve.mjs ${port}', url: 'http://127.0.0.1:${port}/healthy/' },
});
`);

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PW_|PLAYWRIGHT)/.test(k)));
const cli = join(proj, 'node_modules/@playwright/test/cli.js');
const out = run(process.execPath, [cli, 'test', 'offline-check.spec.ts'], proj, { env });
const res = JSON.parse(readFileSync(join(proj, 'offline-check-results/results.json'), 'utf8')).results;
assert.equal(res.length, 4, out);
assert.deepEqual(res.map((r) => r.status), ['passed', 'passed', 'passed', 'passed'].map(() => 'passed'), out);
assert.ok(readdirSync(join(proj, 'offline-check-results')).includes('report.html'));
console.log('package smoke test passed');
