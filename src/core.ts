import type { Browser, BrowserContext, BrowserContextOptions, Page, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { redact, sanitizeUrl } from './redact.js';

export type Status = 'passed' | 'failed' | 'skipped' | 'unverified';
export type ScenarioName = 'warm-disconnect' | 'offline-navigation' | 'offline-write-reload' | 'reconnect';
export const SCENARIOS: ScenarioName[] = ['warm-disconnect', 'offline-navigation', 'offline-write-reload', 'reconnect'];

/** App-owned actions and assertions. OfflineCheck never guesses what "data" means. */
export interface OfflineSpec {
  /** Local app URL. */
  url: string;
  /** Resolves when the app is ready to use. Must throw or time out otherwise. */
  ready: (page: Page) => Promise<void>;
  /** Asserts the current view is usable (throws if not). */
  view: (page: Page) => Promise<void>;
  /** Create/edit action and its assertion. `token` is a unique value for this run. */
  write?: {
    action: (page: Page, token: string) => Promise<void>;
    assert: (page: Page, token: string) => Promise<void>;
  };
  /** App-defined final state after the network returns. Not a server-sync claim. */
  reconnect?: { assert: (page: Page, token: string) => Promise<void> };
  /** Per-phase time bound in ms. Default 10000. */
  timeout?: number;
  /** Fail offline-navigation unless a service worker controlled the offline load. Default false. */
  requireServiceWorker?: boolean;
  /** Your own sensitive values to scrub from error text, in addition to the per-run token. */
  secrets?: string[];
  /** CSS selectors to mask in the failure screenshot (the run token and form fields are always masked). */
  maskSelectors?: string[];
  /** Capture unredacted evidence. Artifacts may contain sensitive data. */
  debug?: boolean;
}

export interface ScenarioResult {
  schemaVersion: 1;
  scenario: ScenarioName;
  status: Status;
  /** Failing phase, or last phase reached when passed. */
  phase: string;
  /** Plain statement of what was exercised. */
  exercised: string[];
  /** What controlled the offline-navigation load: a service worker or nothing (HTTP cache or other). */
  serviceWorker?: 'controlled' | 'none';
  /** On failure: whether the page had registered any service worker (undefined when the page never loaded). */
  swRegistered?: boolean;
  /** On failure: same-origin paths the page had loaded, capped at 50. Paths only, no query strings. */
  appFiles?: string[];
  /** Why skipped/unverified. */
  reason?: string;
  /** Set when a known browser-automation limit, not the app, stopped the scenario. */
  limitation?: 'webkit-offline-sw';
  /** Emulated device or viewport, e.g. "390x664 mobile touch". Absent for the default desktop context. */
  device?: string;
  url: string;
  browser: string;
  error?: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  /** Not serialised; attached by the caller. */
  screenshot?: Buffer;
}

const bound = <T>(p: Promise<T>, ms: number, phase: string): Promise<T> => {
  let t: NodeJS.Timeout;
  const timer = new Promise<never>((_, rej) => {
    t = setTimeout(() => rej(new Error(`phase "${phase}" timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};

/** Run one scenario in a clean browser context. Never throws for app failures; returns a result. */
export async function runScenario(browser: Browser, spec: OfflineSpec, scenario: ScenarioName, contextOptions: BrowserContextOptions = {}): Promise<ScenarioResult> {
  const token = 'oc-' + randomBytes(6).toString('hex');
  const secrets = spec.debug ? [] : [token, ...(spec.secrets ?? [])];
  const clean = (s: string) => (spec.debug ? s : redact(s, secrets));
  const ms = spec.timeout ?? 10_000;
  const result: ScenarioResult = {
    schemaVersion: 1, scenario, status: 'passed', phase: 'start', exercised: [],
    url: sanitizeUrl(spec.url), browser: `${browser.browserType().name()} ${browser.version()}`,
    consoleErrors: [], pageErrors: [], failedRequests: [],
  };
  const vp = contextOptions.viewport;
  if (vp) result.device = `${vp.width}x${vp.height}${contextOptions.isMobile ? ' mobile' : ''}${contextOptions.hasTouch ? ' touch' : ''}`;
  let controlledAtCut = false;

  const needsWrite = scenario === 'offline-write-reload' || scenario === 'reconnect';
  if (needsWrite && !spec.write) return { ...result, status: 'unverified', phase: 'configure', reason: 'spec.write not configured; no data assertion was made' };
  if (scenario === 'reconnect' && !spec.reconnect) return { ...result, status: 'unverified', phase: 'configure', reason: 'spec.reconnect not configured; reconnect state not checked' };

  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const step = async (phase: string, fn: () => Promise<unknown>) => {
    result.phase = phase;
    await bound(fn(), ms, phase);
  };
  try {
    context = await browser.newContext(contextOptions); // clean state; service workers stay enabled
    page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(clean(m.text().split('\n')[0])); });
    page.on('pageerror', (e) => result.pageErrors.push(clean(String(e.message).split('\n')[0])));
    page.on('requestfailed', (r) => result.failedRequests.push(`${r.method()} ${sanitizeUrl(r.url())} ${clean(r.failure()?.errorText ?? '')}`.trim()));
    const p = page, ctx = context;
    const goOffline = async () => {
      await ctx.setOffline(true);
      await p.waitForFunction(() => !navigator.onLine); // confirm the cut took effect
    };

    await step('warm', async () => { await p.goto(spec.url); await spec.ready(p); });
    result.exercised.push('warmed page online');
    controlledAtCut = await p.evaluate(() => !!navigator.serviceWorker?.controller).catch(() => false);
    await step('disconnect', goOffline);

    if (scenario === 'warm-disconnect') {
      await step('view-usable', () => spec.view(p));
      result.exercised.push('same already-open page, no reload, no fresh navigation');
    } else if (scenario === 'offline-navigation') {
      await step('offline-navigation', async () => {
        await p.goto(spec.url);
        await spec.ready(p);
        const sw = await p.evaluate(() => !!navigator.serviceWorker?.controller);
        result.serviceWorker = sw ? 'controlled' : 'none';
        if (!sw && spec.requireServiceWorker) throw new Error('no service worker controlled the offline load');
      });
      await step('view-usable', () => spec.view(p));
      result.exercised.push(result.serviceWorker === 'controlled'
        ? 'fresh navigation while offline, served under a service worker'
        : 'fresh navigation while offline, NO service worker (HTTP cache or other); shell may depend on cache headers');
    } else {
      const w = spec.write!;
      // record each step as it completes, so a failure report shows exactly how far the run got
      await step('offline-write', () => w.action(p, token));
      await step('offline-write-visible', () => w.assert(p, token));
      result.exercised.push('write while offline');
      await step('offline-reload', async () => { await p.reload(); await spec.ready(p); });
      result.exercised.push('reload while still offline');
      await step('persisted-after-reload', () => w.assert(p, token));
      result.exercised.push('data assertion after reload');
      if (scenario === 'reconnect') {
        await step('reconnect', async () => {
          await ctx.setOffline(false);
          await p.waitForFunction(() => navigator.onLine); // confirm the network is back
          await spec.reconnect!.assert(p, token);
        });
        result.exercised.push('network restored', 'app-defined final state (no server sync claimed)');
      }
    }
  } catch (e) {
    result.status = 'failed';
    const msg = (e instanceof Error ? e.message : String(e)).replace(/\u001b\[[0-9;]*m/g, '');
    result.error = clean(spec.debug ? msg : msg.split('\n')[0]);
    // WebKit under Playwright rejects every offline navigation of a service-worker page (microsoft/playwright#42775).
    // That says nothing about the app, so report it as skipped. Without a service worker the failure is real.
    if (browser.browserType().name() === 'webkit' && controlledAtCut && (result.phase === 'offline-navigation' || result.phase === 'offline-reload')
      && /WebKit encountered an internal error/.test(msg)) {
      return { ...result, status: 'skipped', limitation: 'webkit-offline-sw', reason: WEBKIT_REASON };
    }
    // a browser error page (the load itself failed) shows nothing about the app, so no screenshot
    if (page && !page.url().startsWith('chrome-error:')) {
      // lets the diagnosis tell "no service worker at all" from "one that never took control"
      result.swRegistered = await page.evaluate(async () => !!(await navigator.serviceWorker?.getRegistration()))
        .then((b) => b, () => undefined);
      // same-origin files the page loaded (paths only): the list a service worker would need to cache
      result.appFiles = await page.evaluate(() => [...new Set([location.pathname, ...performance.getEntriesByType('resource')
        .map((e) => new URL(e.name)).filter((u) => u.origin === location.origin).map((u) => u.pathname)])])
        .then((xs) => xs.slice(0, 50), () => undefined);
      const mask = spec.debug ? [] : [page.getByText(token), page.locator('input, textarea'), ...(spec.maskSelectors ?? []).map((s) => page!.locator(s))];
      result.screenshot = await page.screenshot({ timeout: 3000, mask }).catch(() => undefined);
    }
  } finally {
    await context?.close().catch(() => undefined);
  }
  return result;
}

export const WEBKIT_REASON = 'WebKit in Playwright cannot load a service-worker page while offline (microsoft/playwright#42775). This is a test-tool limit, not an app failure. Chromium covers this scenario.';

/** Device settings from a Playwright project (`use: { ...devices['iPhone 15'] }`) that a new context accepts. */
const DEVICE_KEYS = ['viewport', 'screen', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'locale', 'timezoneId', 'colorScheme'] as const;
export const deviceOptions = (use: Record<string, unknown>): BrowserContextOptions =>
  Object.fromEntries(DEVICE_KEYS.filter((k) => use[k] !== undefined).map((k) => [k, use[k]]));

/** JSON-safe copy (drops the screenshot buffer). */
export const toJson = ({ screenshot: _s, ...r }: ScenarioResult) => r;

/**
 * Definitions to register from YOUR spec file (Playwright ties tests to the file that calls test()):
 *   for (const c of offlineChecks(spec)) test(c.name, c.run);
 */
export function offlineChecks(spec: OfflineSpec, opts: { scenarios?: ScenarioName[] } = {}) {
  if (spec.debug || ['1', 'true'].includes(process.env.OFFLINE_CHECK_DEBUG ?? '')) {
    spec = { ...spec, debug: true };
    if (!(globalThis as { __ocWarned?: boolean }).__ocWarned) {
      (globalThis as { __ocWarned?: boolean }).__ocWarned = true;
      console.warn('offline-check: DEBUG mode. Reports and screenshots may contain sensitive data.');
    }
  }
  return (opts.scenarios ?? SCENARIOS).map((name) => ({
    name: `offline-check: ${name}`,
    run: async ({ browser }: { browser: Browser }, info: TestInfo) => {
      // room for every phase plus screenshot and cleanup, so a timeout still yields a row
      info.setTimeout((spec.timeout ?? 10_000) * 9 + 15_000);
      const r = await runScenario(browser, spec, name, deviceOptions(info.project.use as Record<string, unknown>));
      await info.attach('offline-check-result', { body: JSON.stringify(toJson(r)), contentType: 'application/json' });
      if (r.screenshot) await info.attach('failure-screenshot', { body: r.screenshot, contentType: 'image/png' });
      info.skip(r.status === 'unverified' || r.status === 'skipped', r.reason ?? r.status);
      if (r.status === 'failed') throw new Error(`[${r.scenario}] failed in phase "${r.phase}": ${r.error}`);
    },
  }));
}
