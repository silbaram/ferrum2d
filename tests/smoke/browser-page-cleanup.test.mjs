import { test } from 'node:test';
import { equal, rejects, ok } from 'node:assert/strict';
import { closeSmokePage } from './browser-page-cleanup.mjs';

test('browser cleanup surfaces failures and bounds an unresponsive close', async () => {
  const cleanup = new Error('protocol cleanup failure');
  await closeSmokePage({ close: async () => {} }, 15);
  await rejects(closeSmokePage({ close: async () => { throw cleanup; } }, 15), error => error === cleanup);
  await rejects(closeSmokePage({ close: () => new Promise(() => {}) }, 15), /cleanup exceeded 15ms/);
});

test('browser cleanup preserves the original assertion when close fails or stalls', async () => {
  const primary = new Error('real pixel assertion'), cleanup = new Error('protocol cleanup failure');
  await closeSmokePage({ close: async () => { throw cleanup; } }, 15, primary);
  equal(primary.cause, cleanup);equal(primary.message, 'real pixel assertion');
  const timed = new Error('real state assertion');
  await closeSmokePage({ close: () => new Promise(() => {}) }, 15, timed);
  ok(timed.cause instanceof Error);equal(timed.message, 'real state assertion');
  await closeSmokePage({ close: async () => { throw cleanup; } }, 15, Object.freeze(new Error('frozen assertion')));
});
