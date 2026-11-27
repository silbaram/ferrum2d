// Node-only checks that used to run only inside browser smokes removed from CI
// (docs/planning/ci-and-studio-distribution-plan.md, S2 table rows 11, 14 and 19).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { checkFlatLightingReferenceVectors } from './flat-lighting-reference-vectors.mjs';
import { checkNineSliceFixtureGeneration } from './feature-nine-slice-checks.mjs';
import { validatePixelArtProfile } from '../../packages/create-game/templates/_shared/scripts/ferrum-pixel-assets.mjs';

test('flat lighting reference vectors follow the documented sRGB lighting math', async () => {
  const reference = JSON.parse(await readFile(new URL('./flat-lighting-reference-vectors.json', import.meta.url), 'utf8'));
  const result = checkFlatLightingReferenceVectors(reference);
  assert.equal(result.count, 6);
  assert.equal(result.renderedByEngine, false);
});

test('feature example scenes and shadow assets regenerate byte-for-byte', async () => {
  const result = await checkNineSliceFixtureGeneration();
  assert.equal(result.regenerationMatches, true);
  assert.equal(result.isolated, true);
});

test('the pixel art showcase satisfies its pixel art profile', async () => {
  const profile = await validatePixelArtProfile({ root: resolve('examples/pixel-art'), required: true });
  assert.equal(profile.ok, true, JSON.stringify(profile.reports));
});
