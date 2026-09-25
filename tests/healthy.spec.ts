import { test } from '@playwright/test';
import { offlineChecks } from '../src/index.js';
import { sampleSpec } from './samples.js';

// Healthy sample must pass all four version 1 scenarios, with a service worker controlling the offline load.
for (const c of offlineChecks(sampleSpec('healthy', { requireServiceWorker: true }))) test(c.name, c.run);
