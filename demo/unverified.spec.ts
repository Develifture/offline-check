import { test } from '@playwright/test';
import { offlineChecks } from '../src/index.js';
import { sampleSpec } from '../tests/samples.js';

// Fixture for the reporter test: no `write` configured, so the scenario is unverified and the run must fail.
for (const c of offlineChecks(sampleSpec('healthy', { write: undefined }), { scenarios: ['offline-write-reload'] })) test(c.name, c.run);
