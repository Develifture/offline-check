import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { SCENARIOS } from './core.js';
import { renderHtml, renderMarkdown, type Row } from './render.js';

const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'default';
const rel = (p: string) => relative(process.cwd(), p).split(sep).join('/');
// Files this reporter writes. Anything else in outputDir (your own images, notes) is never deleted.
const OWNED = new RegExp(`-(${SCENARIOS.join('|')})[.]png$|^results[.]json$|^report[.]html$|^fix-plan[.]md$`);

/**
 * Writes offline-check-results/results.json, report.html (a view over the JSON with a diagnosis per failure)
 * and fix-plan.md (the same diagnosis as instructions for a coding agent).
 * Options: outputDir; allowUnverified (default false: an unconfigured scenario makes the run fail).
 * Retries: only the last attempt of each test is reported. An empty run leaves earlier results untouched.
 */
export default class OfflineCheckReporter implements Reporter {
  private rows = new Map<string, Row>();
  private cleaned = false;
  private dir: string;
  private allowUnverified: boolean;
  private configFile?: string;
  constructor(opts: { outputDir?: string; allowUnverified?: boolean } = {}) {
    this.dir = opts.outputDir ?? 'offline-check-results';
    this.allowUnverified = opts.allowUnverified ?? false;
  }
  onBegin(config: FullConfig) {
    this.configFile = config.configFile;
  }
  private clean() {
    if (this.cleaned) return;
    this.cleaned = true;
    mkdirSync(this.dir, { recursive: true });
    // remove only files this reporter owns, so stale screenshots never outlive their results
    for (const f of readdirSync(this.dir)) if (OWNED.test(f)) rmSync(join(this.dir, f), { force: true });
  }
  onTestEnd(t: TestCase, res: TestResult) {
    const a = res.attachments.find((x) => x.name === 'offline-check-result');
    if (!a?.body) return;
    this.clean();
    const project = t.parent.project()?.name ?? 'default';
    const file = rel(t.location.file);
    const row: Row = { ...JSON.parse(a.body.toString()), project, retry: res.retry, file };
    const shot = res.attachments.find((x) => x.name === 'failure-screenshot');
    if (shot?.body) {
      // spec file in the name, so two apps checked in one run never overwrite each other's screenshot
      const png = `${slug(project)}-${slug(basename(file))}-${row.scenario}.png`;
      writeFileSync(join(this.dir, png), shot.body);
      row.screenshot = png;
    }
    this.rows.set(t.id, row); // last attempt wins
    const where = row.status === 'passed' ? '' : ` [${row.phase}]`;
    console.log(`offline-check ${row.status.toUpperCase().padEnd(10)} ${row.scenario} (${project})${where}${row.reason ? ' - ' + row.reason : ''}`);
  }
  onEnd(_r: FullResult) {
    const rows = [...this.rows.values()];
    if (!rows.length) {
      console.log('offline-check: no scenarios ran; existing results left untouched.');
      return;
    }
    const generatedAt = new Date().toISOString();
    writeFileSync(join(this.dir, 'results.json'), JSON.stringify({ schemaVersion: 1, generatedAt, results: rows }, null, 2));
    const cfg = this.configFile && !/^playwright\.config\.[cm]?[jt]s$/.test(basename(this.configFile)) ? ` -c ${rel(this.configFile)}` : '';
    const input = {
      rows, generatedAt,
      rerun: (file: string) => `npx playwright test${cfg} ${file}`,
      // embedded, so report.html is one file that still shows screenshots when shared or opened from CI
      image: (png: string) => `data:image/png;base64,${readFileSync(join(this.dir, png)).toString('base64')}`,
    };
    writeFileSync(join(this.dir, 'report.html'), renderHtml(input));
    writeFileSync(join(this.dir, 'fix-plan.md'), renderMarkdown(input));
    console.log(`offline-check: report ${join(this.dir, 'report.html')}, agent fix plan ${join(this.dir, 'fix-plan.md')}`);
    if (!this.allowUnverified && rows.some((r) => r.status === 'unverified')) {
      console.log('offline-check: unverified scenarios present; failing the run (set allowUnverified to permit).');
      return Promise.resolve({ status: 'failed' as const });
    }
  }
}
