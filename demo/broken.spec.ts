import { test } from '@playwright/test';
import { offlineChecks } from '../src/index.js';
import { sampleSpec } from '../tests/samples.js';

// Intentionally failing demo: notes live only in memory. Run: npm run demo:broken
for (const c of offlineChecks(sampleSpec('broken-memory-only'))) test(c.name, c.run);
