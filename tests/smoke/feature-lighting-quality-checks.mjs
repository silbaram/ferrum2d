import assert from "node:assert/strict";

/** Legacy quality baseline, not a claim of indirect-only AO or physically correct Bloom. */
export async function checkLightingQuality({ page, control, snapshot, pixelHash, artifactDir }) {
  const render = async action => {
    const before = (await snapshot()).renderedFrames;
    await action();
    await page.waitForFunction(before => window.ferrumFeatureLab.snapshot().renderedFrames > before, before);
    return page.evaluate(pixelHash);
  };
  const range = (name, value) => render(async () => { await control(name).fill(String(value)); await control(name).dispatchEvent("input"); });
  const effects = ["bloom", "ao", "dof", "aces"];
  await render(() => control("light-mode").selectOption("sun"));
  const initial = await snapshot();
  assert(initial.shadowPasses > 0 && initial.models === 1, "sun shadow and emissive model must actually render");
  const low = await range("sun-elevation", 10), high = await range("sun-elevation", 80);
  assert.notEqual(low.hash, high.hash, "sun altitude sweep must change actual pixels");
  await range("sun-elevation", 35);
  const before = await page.evaluate(pixelHash), turned = await range("sun-azimuth", 90);
  assert.notEqual(before.hash, turned.hash, "sun azimuth changes actual light and shadows");
  assert.equal((await snapshot()).environment.environment.lighting.lights.length, 0);
  await render(() => control("light-mode").selectOption("mixed"));
  const mixed = await snapshot();
  assert.equal(mixed.environment.environment.lighting.lights.length, 1);
  assert.equal(mixed.shadowPasses, 7, "cold mixed scene draws one cube shadow and one sun map");
  const clean = await render(() => control("environment-fog").check());
  const individual = {};
  for (const effect of effects) {
    individual[effect] = await render(() => control(`environment-${effect}`).check());
    assert.notEqual(individual[effect].hash, clean.hash, `${effect} changes real spatial output`);
    assert.equal((await render(() => control(`environment-${effect}`).uncheck())).hash, clean.hash, `${effect} removal restores the exact legacy baseline`);
  }
  let combined;
  for (const effect of effects) combined = await render(() => control(`environment-${effect}`).check());
  const all = await snapshot(), environment = all.environment.environment;
  assert.deepEqual(all.environment.effects, effects);
  for (const key of ["bloom", "ambientOcclusion", "depthOfField", "colorGrading", "fog"]) assert(environment[key], `${key} must coexist in native scene settings`);
  assert.equal(all.shadowPasses, 0, "effect edits must reuse the unchanged mixed shadow maps");
  assert.equal(all.shadowCacheHit, true);
  assert.equal(all.effectPasses, 1, "legacy composite stays a single effect draw");
  assert(all.drawCalls <= 64);
  if (artifactDir) await page.screenshot({ path: `${artifactDir}/${all.backend}-lighting-combined.png`, fullPage: true });
  for (const effect of effects) {
    const without = await render(() => control(`environment-${effect}`).uncheck());
    assert.notEqual(without.hash, combined.hash, `${effect} must still contribute when effects are combined`);
    assert.equal((await render(() => control(`environment-${effect}`).check())).hash, combined.hash, `${effect} re-enable restores the combined framebuffer exactly`);
  }
  await control("camera-angle").locator("xpath=ancestor::details").evaluate(details => { details.open = true; });
  const light = structuredClone(environment.lighting), camera = all.camera;
  const orbit = await range("camera-angle", 90);
  assert.notEqual(orbit.hash, combined.hash);
  await range("camera-pan", 32);
  const panned = await snapshot();
  assert.deepEqual(panned.environment.environment.lighting, light, "camera orbit/pan must not rotate or move the authored lights");
  assert.equal(panned.camera.target.x, camera.target.x + 32);
  const downloaded = await page.locator('[data-control="download"]').evaluate(async link => (await fetch(link.href)).json());
  assert.deepEqual(downloaded.spatial.camera, panned.camera, "export must use the displayed camera");
  assert.deepEqual(downloaded.spatial.environment, panned.environment.environment);
  await range("camera-angle", 0); await range("camera-pan", 0);
  assert.equal((await page.evaluate(pixelHash)).hash, combined.hash, "restoring the camera restores the same world lighting");
  for (const effect of effects) await render(() => control(`environment-${effect}`).uncheck());
  assert.equal((await page.evaluate(pixelHash)).hash, clean.hash);
  const unlit = await render(() => control("environment-lighting").uncheck());
  assert(unlit.emissiveRgb && unlit.emissiveRgb[0] > 180 && unlit.emissiveRgb[0] > unlit.emissiveRgb[1] * 1.2 && unlit.emissiveRgb[1] > unlit.emissiveRgb[2], `emissive window remains bright without scene lights: ${unlit.emissiveRgb}`);
  assert.equal((await render(() => control("environment-lighting").check())).hash, clean.hash);
  await render(() => control("reset").click());
  assert.deepEqual((await snapshot()).environment.effects, []);
  return { profile: "legacy-screen-space", altitudeSweep: [10, 80], individual, combined,
    effects: effects.length, exactRestoration: true, authoredWorldSunPreserved: true, exportedCamera: true, emissiveWithoutLights: unlit.emissiveRgb };
}
