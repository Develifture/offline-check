import type { ScenarioName, ScenarioResult } from './core.js';

/** Phases each scenario runs, in order. The report draws these as a timeline. */
export const PHASES: Record<ScenarioName, string[]> = {
  'warm-disconnect': ['warm', 'disconnect', 'view-usable'],
  'offline-navigation': ['warm', 'disconnect', 'offline-navigation', 'view-usable'],
  'offline-write-reload': ['warm', 'disconnect', 'offline-write', 'offline-write-visible', 'offline-reload', 'persisted-after-reload'],
  reconnect: ['warm', 'disconnect', 'offline-write', 'offline-write-visible', 'offline-reload', 'persisted-after-reload', 'reconnect'],
};

export const PHASE_LABEL: Record<string, string> = {
  warm: 'Open online', disconnect: 'Cut network', 'view-usable': 'Page usable', 'offline-navigation': 'Fresh load offline',
  'offline-write': 'Write offline', 'offline-write-visible': 'Write shows', 'offline-reload': 'Reload offline',
  'persisted-after-reload': 'Data kept', reconnect: 'Back online', configure: 'Configure',
};

export const PLAIN: Record<ScenarioName, string> = {
  'warm-disconnect': 'An already-open page keeps working when the network drops',
  'offline-navigation': 'The app opens fresh with no network',
  'offline-write-reload': 'Data entered offline survives a reload',
  reconnect: 'The app is in the right state after the network returns',
};

export interface Diagnosis {
  severity: 'fail' | 'warn' | 'info';
  title: string;
  /** What the run observed, in plain words. */
  happened: string;
  /** Most likely cause. A diagnosis is a lead, not proof: evidence is listed with it. */
  cause: string;
  steps: string[];
  snippet?: { lang: string; name: string; code: string };
}

type Row = Omit<ScenarioResult, 'screenshot'>;

const same = (u: string) => { try { return new URL(u).pathname; } catch { return u; } };
/** Same-origin GET paths that failed offline: the assets a service worker still needs to cache. */
export const missingAssets = (r: Row): string[] => {
  let origin = '';
  try { origin = new URL(r.url).origin; } catch { /* keep empty */ }
  return [...new Set(r.failedRequests
    .map((f) => f.split(' '))
    .filter(([m, u]) => m === 'GET' && u?.startsWith(origin))
    .map(([, u]) => same(u)))];
};
/** Files to precache: what failed offline, else what the page loaded online. */
const shellFiles = (r: Row) => { const m = missingAssets(r); return m.length ? m : r.appFiles ?? []; };

const swSnippet = (assets: string[]) => {
  const list = assets.length ? assets : ['/', '/index.html', '/app.js', '/styles.css'];
  return {
    lang: 'js',
    name: 'sw.js',
    code: `// sw.js at your site root. Register it from your main script:
//   navigator.serviceWorker?.register('/sw.js');
const VERSION = 'app-v1'; // bump when the file list changes
// Every file the page needs: HTML, scripts, styles, fonts, images, vendored libraries.
const SHELL = ${JSON.stringify(list)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Network first, cached copy when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request)
    .then((res) => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then((k) => k.put(e.request, c)); } return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});`,
  };
};

const readySnippet = {
  lang: 'ts',
  name: 'offline-check.spec.ts',
  code: `// In your spec: "ready" must wait until the service worker controls the page,
// otherwise the network is cut before the app shell is cached.
ready: async (page) => {
  await expect(page.locator('#app')).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null);
},`,
};

const persistSnippet = {
  lang: 'js',
  name: 'app.js',
  code: `// Save on every change, load on start. localStorage for small data; IndexedDB for larger data.
let items = JSON.parse(localStorage.getItem('items') || '[]');
function add(item) {
  items.push(item);
  localStorage.setItem('items', JSON.stringify(items)); // before or with the UI update, not after a server reply
  render();
}`,
};

const noShell = (r: Row, what: string): Diagnosis => {
  const assets = missingAssets(r);
  return {
    severity: 'fail',
    title: 'Nothing can serve the app without a network',
    happened: `${what} failed with the network off${r.error?.includes('ERR_INTERNET_DISCONNECTED') ? ' (net::ERR_INTERNET_DISCONNECTED)' : ''}. No service worker handled the request.`,
    cause: 'The app has no service worker (or it was not active yet), so the browser has no local copy of the page and its files.',
    steps: [
      'Add a service worker that caches the app shell: the HTML page, scripts, styles and any vendored libraries.',
      'Register it from your main script.',
      'Make the spec\'s `ready` wait until the service worker controls the page, so the check never cuts the network before caching is done.',
      ...(assets.length ? [`Requests that failed offline and must be cached: ${assets.map((a) => '`' + a + '`').join(', ')}.`] : []),
    ],
    snippet: swSnippet(shellFiles(r)),
  };
};

/** Explain one result. Returns undefined for a clean pass. */
export function diagnose(r: Row): Diagnosis | undefined {
  if (r.limitation === 'webkit-offline-sw') {
    return {
      severity: 'info',
      title: 'WebKit could not run the offline reload, a known Playwright limit',
      happened: 'Your service worker was in control, but WebKit under Playwright refuses every offline navigation of a service-worker page.',
      cause: 'This comes from how Playwright emulates offline in WebKit (microsoft/playwright#42775), so the result says nothing about your app.',
      steps: ['There is nothing to fix in your app for this item.', 'The same scenario in Chromium or an emulated Android phone runs fully. Use that result.', 'To confirm on an iPhone, open the app in Safari, turn on Airplane Mode and reload.', 'Re-run WebKit once microsoft/playwright#42775 is fixed.'],
    };
  }
  if (r.status === 'unverified' || r.status === 'skipped') {
    return {
      severity: 'warn',
      title: 'This scenario was not checked',
      happened: r.reason ?? 'The spec does not define what to check for this scenario.',
      cause: 'The spec has no `write` (and for reconnect, no `reconnect`) section, so there is no data to verify.',
      steps: ['Add `write.action` (make a change with the given token) and `write.assert` (the change is visible) to the spec.', 'Add `reconnect.assert` for the state the app should reach when the network returns.'],
    };
  }
  if (r.status === 'passed') {
    if (r.scenario === 'offline-navigation' && r.serviceWorker === 'none') {
      return {
        severity: 'warn',
        title: 'Passed, but only thanks to the HTTP cache',
        happened: 'The page loaded offline, but no service worker served it.',
        cause: 'The browser reused files from its HTTP cache. That cache can be evicted or skipped at any time, so real users may still see an offline error.',
        steps: ['Add a service worker that caches the app shell.', 'Set `requireServiceWorker: true` in the spec so this weaker pass becomes a failure.'],
        snippet: swSnippet(shellFiles(r)),
      };
    }
    return undefined;
  }

  const err = r.error ?? '';
  const timedOut = /timed out/.test(err);
  switch (r.phase) {
    case 'configure':
      return diagnose({ ...r, status: 'unverified' });
    case 'warm':
      if (timedOut && r.swRegistered === false) {
        return {
          severity: 'fail',
          title: 'The app has no service worker, so nothing is cached for offline use',
          happened: 'The app opened online, but the `ready` check timed out waiting for a service worker. The page never registered one.',
          cause: 'Without a service worker the browser keeps no local copy of the app, so a reload or a fresh visit fails with no network. The spec waits for one because offline loading depends on it.',
          steps: [
            'Add a service worker that caches the app shell: the HTML page, scripts, styles and any vendored libraries.',
            'Register it from your main script. Keep the file at the site root so its scope covers the whole app.',
            'Call `clients.claim()` in its activate handler, so the page is controlled without a second reload.',
            'Keep the spec\'s `ready` waiting for `navigator.serviceWorker.controller`.',
          ],
          snippet: swSnippet(shellFiles(r)),
        };
      }
      return {
        severity: 'fail',
        title: 'The app never became ready, even online',
        happened: timedOut ? 'The `ready` check did not pass before the time limit, while the network was still on.' : `Opening the app online failed: ${err}`,
        cause: 'Either the app is not running at this URL, or the `ready` check waits for something that never happens (a wrong selector, or a service worker that never takes control).',
        steps: ['Open the URL in a browser and confirm the app loads.', 'Check the selector in `ready` against the real page.', 'If `ready` waits for a service worker, confirm it registers and calls `clients.claim()`.', 'Read the console and page errors below.'],
        snippet: readySnippet,
      };
    case 'disconnect':
      return {
        severity: 'fail',
        title: 'The browser did not go offline',
        happened: '`navigator.onLine` stayed true after the network was cut.',
        cause: 'A test-environment problem, not an app bug. The app or a test helper may override `navigator.onLine`.',
        steps: ['Make sure nothing in the app or test setup overrides `navigator.onLine`.', 'Re-run the check. If it repeats, update Playwright.'],
      };
    case 'view-usable':
      if (r.scenario === 'offline-navigation') {
        return {
          severity: 'fail',
          title: 'The page loaded offline but is not usable',
          happened: 'The offline load succeeded, but the `view` check failed.',
          cause: 'A file or API call the page needs was not cached, so part of the UI never rendered.',
          steps: ['Look at the failed requests below. Each same-origin file there must be in the service worker cache.', 'If the UI waits for an API response, show cached or empty data instead of waiting.'],
          snippet: swSnippet(shellFiles(r)),
        };
      }
      return {
        severity: 'fail',
        title: 'The open page broke when the network dropped',
        happened: 'The page worked online, but the `view` check failed right after going offline, with no reload.',
        cause: 'The app hides or disables its UI on the `offline` event, or a background request failed and the error was not handled.',
        steps: ['Search the code for `offline` event handlers and `navigator.onLine` checks that hide or disable the UI.', 'Wrap background fetches in try/catch and keep showing the last known data.', 'Read the page errors below for an uncaught exception.'],
      };
    case 'offline-navigation':
      if (/no service worker controlled/.test(err)) {
        return {
          severity: 'fail',
          title: 'The page loaded, but not from a service worker',
          happened: 'The offline load worked through the browser\'s HTTP cache. The spec requires a service worker.',
          cause: 'There is no service worker, or it did not control this page.',
          steps: ['Add a service worker that caches the app shell and calls `clients.claim()`.', 'Make `ready` wait for `navigator.serviceWorker.controller`.'],
          snippet: swSnippet(shellFiles(r)),
        };
      }
      if (timedOut) {
        return {
          severity: 'fail',
          title: 'The page started loading offline but never became ready',
          happened: 'The offline load did not error, but `ready` did not pass in time.',
          cause: 'The HTML came from a cache, but a script, style or data file it needs did not.',
          steps: ['Add every failed request below to the service worker cache.', 'Check that the app does not wait on a network request before it renders.'],
          snippet: swSnippet(shellFiles(r)),
        };
      }
      return noShell(r, 'Opening the app fresh');
    case 'offline-write':
      return {
        severity: 'fail',
        title: 'The app would not accept a change offline',
        happened: `The write action failed while offline: ${err}`,
        cause: 'The input or button is disabled or hidden while offline, or the action throws when its request fails.',
        steps: ['Keep inputs enabled while offline.', 'Save the change locally first, then send it to the server when possible.', 'Check the page errors below.'],
        snippet: persistSnippet,
      };
    case 'offline-write-visible':
      return {
        severity: 'fail',
        title: 'The change did not appear while offline',
        happened: 'The write action ran, but the result never showed on screen.',
        cause: 'The UI waits for a server response before showing the change. Offline, that response never comes.',
        steps: ['Update the UI immediately from local state (an optimistic update), then send to the server in the background.', 'If the server call fails, keep the change and retry later.'],
        snippet: persistSnippet,
      };
    case 'offline-reload':
      return noShell(r, 'Reloading the page');
    case 'persisted-after-reload':
      return {
        severity: 'fail',
        title: 'Data entered offline was lost on reload',
        happened: 'The change showed on screen, but after an offline reload it was gone.',
        cause: 'The data is held only in memory (a variable or component state) and is never written to browser storage.',
        steps: ['Write each change to localStorage or IndexedDB when it is made.', 'Load that stored data when the app starts.', 'If the data normally comes from a server, merge stored local changes on top of it.'],
        snippet: persistSnippet,
      };
    case 'reconnect':
      return {
        severity: 'fail',
        title: 'The app went wrong when the network came back',
        happened: 'Offline data survived a reload, but after the network returned, the `reconnect` check failed.',
        cause: 'The `online` handler or the sync step replaces local data with the server copy, clears the list, or shows an error state.',
        steps: ['Search the code for `online` event handlers and sync functions.', 'Merge local changes with server data instead of replacing them.', 'Keep the UI showing data while sync runs, and handle sync errors without clearing state.'],
      };
    default:
      return { severity: 'fail', title: `Failed in phase "${r.phase}"`, happened: err, cause: 'No specific diagnosis for this phase.', steps: ['Read the error and evidence below.'] };
  }
}
