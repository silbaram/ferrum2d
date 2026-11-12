import assert from "node:assert/strict";
import { showPlacementMenu, openPlacementLightingAdvanced } from "./placement-panel-navigation.mjs";

/** Exercise the official controls against authored history and the real Wasm frame. */
export async function smokePlacementPointShadows(page) {
  const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const open = () => showPlacementMenu(page, "lighting");
  const light = async () => (await source()).spatial.environment.lighting;
  const select = async index => { await open(); await page.locator('[data-placement-lighting-point-index]').selectOption(String(index)); await paint(); };
  const toggle = page.locator('[data-placement-lighting-toggle="point-shadows"]');
  const undo = async () => { await page.locator('[data-placement-action="undo"]').click(); await paint(); };
  const document = await source();
  delete document.spatial.lightBindings;
  document.spatial.environment = { composition: "separated", lighting: { enabled: true, maxActiveLights: 3,
    lights: [0, 1, 2].map(i => ({ position: { x: i * 40, y: 0, elevation: 90 }, radius: 300, intensity: 1 })),
    pointShadows: [{ lightIndex: 2, resolution: 128, bias: .05, normalBias: .15 }, { lightIndex: 0, resolution: 256, bias: .05, normalBias: .25 }],
  } };
  await page.locator('[data-placement-document-file]').setInputFiles({ name: "dual-point-shadows.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
  await page.waitForFunction(() => window.ferrumPlacementSpatialExportDocument().spatial?.environment?.lighting?.pointShadows?.length === 2 && !globalThis.document.querySelector('.demo-shell').inert);
  await page.evaluate(() => {
    const renderer = window.ferrumRuntime.renderer, draw = renderer.renderCommands;
    renderer.renderCommands = function (...args) {
      const environment = (args[1] ?? args[0]).spatial?.environment;
      window.__pointShadowEnvironment = environment && { version: environment.version, values: Array.from(environment.values) };
      return draw.apply(this, args);
    };
  });
  await select(2);
  assert(await toggle.isChecked());
  const offset = page.locator('[data-placement-lighting-field="point-normal-bias"]');
  await openPlacementLightingAdvanced(offset);
  assert.equal(Number(await offset.inputValue()), .15);
  await offset.fill(".65"); await offset.press("Enter"); await paint();
  assert.deepEqual((await light()).pointShadows, [{ lightIndex: 2, resolution: 128, bias: .05, normalBias: .65 }, { lightIndex: 0, resolution: 256, bias: .05, normalBias: .25 }]);
  assert.equal((await light()).shadows, undefined);
  await select(1); assert(await toggle.isDisabled());
  await select(2); await toggle.uncheck(); await paint();
  await select(1); await toggle.check(); await paint();
  assert.deepEqual((await light()).pointShadows.map(owner => owner.lightIndex), [0, 1]);
  const quality = page.locator('[data-placement-lighting-preset="Lighting Quality"]');
  await openPlacementLightingAdvanced(quality); await quality.selectOption("Low"); await paint();
  const low = await source();
  assert.equal(low.spatial.environment.lighting.maxActiveLights, 2);
  assert.deepEqual(low.spatial.environment.lighting.pointShadows.map(owner => owner.resolution), [128, 128]);
  await undo(); await page.locator('[data-placement-action="redo"]').click(); await paint();
  assert.deepEqual(await source(), low);
  for (const [index, expected] of [[1, [0]], [0, [0]], [2, [0, 1]]]) {
    await select(index); await page.locator('[data-placement-lighting-action="remove-point"]').click(); await paint();
    assert.deepEqual((await light()).pointShadows.map(owner => owner.lightIndex), expected);
    await undo(); assert.deepEqual(await source(), low);
  }
  await select(1); await toggle.uncheck(); await paint();
  await select(0); await toggle.uncheck(); await paint();
  assert.equal((await light()).pointShadows, undefined);
  const cleared = await source();
  await toggle.check(); await paint();
  assert.equal((await light()).shadows.lightIndex, 0);
  await select(1); await toggle.check(); await paint();
  assert.deepEqual((await light()).pointShadows.map(owner => owner.lightIndex), [0, 1]);
  assert.equal((await light()).shadows, undefined);
  await undo(); await undo(); assert.deepEqual(await source(), cleared);
  await undo(); await undo(); assert.deepEqual(await source(), low);
  await page.waitForFunction(() => {
    const environment = window.__pointShadowEnvironment;
    return environment?.version === 10 && environment.values.length === 592 && environment.values[588] === 1;
  });
  return { owners: 2, independentBias: true, ownerLimit: true, lowQuality: true, deleteRemap: true, undoRedo: true, runtimeEnvironmentFloats: 592 };
}
