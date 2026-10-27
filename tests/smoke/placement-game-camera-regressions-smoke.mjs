import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementMenu } from "./placement-panel-navigation.mjs";

/** Reproduce camera review findings using actual document controls and native frames. */
export async function smokePlacementGameCameraRegressions(parent, timeoutMs = 30000) {
  const artifact = "artifacts/game-camera-review-fixes";
  await mkdir(artifact, { recursive: true });
  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
  const navigation = () => page.evaluate(() => window.ferrumPlacementSpatialCamera);
  const open = () => showPlacementMenu(page, "camera-spatial");
  const field = name => page.locator(`[data-placement-game-camera-field="${name}"]`);
  const edit = async (name, value) => {
    await open(); assert(await field(name).isEnabled());
    await field(name).fill(String(value)); await field(name).press("Tab"); await paint();
  };
  const undo = async () => { await page.locator("[data-placement-action=undo]").click(); await paint(); };
  const redo = async () => { await page.locator("[data-placement-action=redo]").click(); await paint(); };
  const load = async (document, name) => {
    const expendable = await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length >= 7
      ? window.ferrumPlacementWorkspaceDocuments.find(tab => tab.key !== window.ferrumPlacementWorkspaceActiveDocument && !tab.dirty)?.key : undefined);
    if (expendable) await page.locator(`[data-placement-close-document=${JSON.stringify(expendable)}]`).click();
    await page.locator("[data-placement-document-file]").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
    await page.waitForFunction(name => !document.querySelector(".demo-shell").inert &&
      window.ferrumPlacementWorkspaceDocuments.some(tab => tab.label === name && tab.key === window.ferrumPlacementWorkspaceActiveDocument), name, { timeout: timeoutMs });
    await paint(); await open();
    assert(await field("pitch").isEnabled(), "Opening a document must restore camera inputs without a navigation or resize workaround");
    assert(await page.locator("[data-placement-game-camera-preview]").isEnabled());
    assert(await page.locator("[data-placement-game-camera-apply]").isEnabled());
  };
  const preview = async camera => {
    await open(); await page.locator("[data-placement-game-camera-preview]").click(); await paint();
    const actual = await page.evaluate(() => {
      const { camera: m } = window.__cameraRegressionFrame,
        camera = window.ferrumPlacementSpatialExportDocument().spatial.camera, t = camera.target, p = [t.x, t.elevation, -t.y, 1],
        clip = Array.from({ length: 4 }, (_, row) => p.reduce((sum, v, col) => sum + m[col * 4 + row] * v, 0));
      return { applied: window.__cameraRegressionApplied, state: window.ferrumEngine.dataSceneState(),
        runtime: window.ferrumPlacementViewerRuntimeFrame, stats: window.ferrumRuntime.renderer.stats(),
        depth: clip[2] / clip[3], targetVisible: clip[3] > 0 && Math.abs(clip[2]) < clip[3] && Math.abs(clip[0]) <= clip[3] && Math.abs(clip[1]) <= clip[3] };
    });
    assert.deepEqual(actual.applied, camera);
    assert.equal(actual.state, "paused"); assert.equal(actual.runtime.entityCount, 3);
    assert.equal(actual.runtime.spatial.billboardVertices, 18);
    assert(actual.stats.drawCalls > 0 && actual.stats.drawCalls <= 32);
    assert(actual.targetVisible, "Projection conversion must keep the target inside the actual native clip volume");
    assert(await page.locator("[data-placement-game-camera-frame]").isVisible());
    return { depth: actual.depth, draws: actual.stats.drawCalls };
  };
  const stop = async () => { await page.locator("[data-placement-playback=stop]").click(); await paint(); };
  const checks = {};
  try {
    console.log("Game camera regressions: document lifecycle, clipping, signed pitch and small values");
    const url = new URL(parent.url()); url.search = "?scene=hd2d";
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerRuntimeFrame?.entityCount === 3, undefined, { timeout: timeoutMs });
    await page.locator("[data-placement-language]").selectOption("en");
    await page.evaluate(() => {
      const engine = window.ferrumEngine;
      for (const method of ["configureDataSceneSpatial", "setDataSceneSpatialCamera"]) {
        const original = engine[method];
        engine[method] = function (...args) {
          const accepted = original.apply(this, args);
          if (accepted) window.__cameraRegressionApplied = structuredClone(method === "configureDataSceneSpatial" ? args[0].camera : args[0]);
          return accepted;
        };
      }
      const renderer = window.ferrumRuntime.renderer, render = renderer.renderCommands;
      renderer.renderCommands = function (...args) {
        const frame = (args[1] ?? args[0]).spatial;
        if (frame) window.__cameraRegressionFrame = { camera: Array.from(frame.camera) };
        return render.apply(this, args);
      };
    });
    const fixture = await source();
    fixture.spatial.environment = { pixelArt: { width: 320, height: 180, snapCamera: false } };
    // Keep three small markers around the target even in the narrow near-clip
    // case. Offscreen billboards are correctly culled by the native renderer.
    for (const [index, instance] of fixture.sceneComposition.fragments.main.instances.entries()) {
      const components = structuredClone(instance.props?.components ?? fixture.sceneComposition.prefabs.object.props.components);
      components.visual.width = components.visual.height = 1;
      components.body.heightSpan.elevation = 0;
      instance.x = (index - 1) * 0.5; instance.y = 0;
      instance.props = { ...instance.props, components };
    }
    const first = structuredClone(fixture); first.spatial.camera.height = 300;
    await load(first, "camera-review-A.json"); await edit("height", 320);
    const documentA = await source(), historyA = await history(), navigationA = await navigation();
    const second = structuredClone(fixture); second.spatial.camera.height = 420;
    const sizeBefore = await page.locator("canvas.demo-canvas").boundingBox();
    await load(second, "camera-review-B.json");
    const sizeAfter = await page.locator("canvas.demo-canvas").boundingBox();
    assert.equal(sizeAfter.width, sizeBefore.width); assert.equal(sizeAfter.height, sizeBefore.height);
    await page.locator("[data-placement-document-key]").filter({ hasText: "camera-review-A.json" }).click(); await paint();
    assert.deepEqual(await source(), documentA); assert.deepEqual(await history(), historyA); assert.deepEqual(await navigation(), navigationA);
    checks.documentUnlockWithoutResize = true;
    checks.tabIsolation = true;

    const clipCases = [
      { id: "far", height: 1000, position: { x: 0, y: -100, elevation: 100 }, near: 0.1, far: 1000 },
      { id: "near", height: 10, position: { x: 0, y: -200, elevation: 200 }, near: 100, far: 1000 },
      { id: "valid", height: 180, position: { x: 0, y: -100, elevation: 100 }, near: 0.1, far: 2000 },
    ];
    checks.clipping = [];
    for (const { id, ...settings } of clipCases) {
      const document = structuredClone(fixture);
      document.spatial.camera = { projection: "orthographic", target: { x: 0, y: 0, elevation: 0 }, ...settings };
      await load(document, `camera-clip-${id}.json`);
      const original = await source(), originalNavigation = await navigation();
      await page.locator("[data-placement-game-camera-projection]").selectOption("perspective"); await paint();
      const changed = await source(), camera = changed.spatial.camera, d = Math.hypot(camera.position.x, camera.position.y, camera.position.elevation);
      assert(Math.abs(2 * d * Math.tan(camera.fovDegrees * Math.PI / 360) - settings.height) < 1e-7);
      assert(camera.near < d && camera.far > d);
      if (id !== "near") assert.equal(camera.near, settings.near);
      if (id !== "far") assert.equal(camera.far, settings.far);
      assert.equal((await history()).undoCount, 1);
      const native = await preview(camera);
      if (id === "far") {
        await page.screenshot({ path: `${artifact}/projection-fixed.png`, fullPage: true });
        await page.locator("[data-placement-playback=pause]").click(); await paint();
        assert.equal(await page.evaluate(() => window.ferrumEngine.dataSceneState()), "playing");
        assert(await page.locator("[data-placement-game-camera-frame]").isHidden());
      }
      await stop(); assert.deepEqual(await navigation(), originalNavigation);
      await undo(); assert.deepEqual(await source(), original);
      await redo(); assert.deepEqual(await source(), changed);
      await load(changed, `camera-clip-${id}-saved.json`);
      assert.deepEqual((await source()).spatial.camera, camera);
      assert.equal((await history()).undoCount, 0);
      checks.clipping.push({ id, ...native, oneUndoAndRedo: true, reopened: true });
    }

    const below = structuredClone(fixture);
    below.spatial.camera = { projection: "orthographic", position: { x: 0, y: -200, elevation: 200 }, target: { x: 0, y: 0, elevation: 0 }, height: 240, near: 0.1, far: 2000 };
    await load(below, "camera-signed-pitch.json");
    const advanced = page.locator(".placement-game-camera > details");
    if (!(await advanced.evaluate(element => element.open))) await advanced.locator(":scope > summary").click();
    await edit("positionElevation", -200);
    assert.equal(await field("pitch").inputValue(), "-45");
    assert(await field("pitch").evaluate(element => element.validity.valid));
    const cameraBelow = await source(); await edit("pitch", -44);
    assert(Math.abs(Number(await field("pitch").inputValue()) + 44) < 1e-8);
    await undo(); assert.deepEqual(await source(), cameraBelow); await redo();
    for (const angle of [0, 0.5, 89.5, -89.5]) {
      await edit("pitch", angle);
      assert(Math.abs(Number(await field("pitch").inputValue()) - angle) < 1e-8);
    }
    const validAngle = await source(), angleHistory = await history();
    for (const angle of [-90, 90]) {
      await edit("pitch", angle);
      assert.deepEqual(await source(), validAngle); assert.deepEqual(await history(), angleHistory);
    }
    await preview(validAngle.spatial.camera); await stop();
    checks.signedPitchAndVerticalRejection = true;

    await edit("height", 0.001); const beforeZoom = await source();
    await open(); await page.locator('[data-placement-game-camera-zoom="in"]').click(); await paint();
    assert.equal((await source()).spatial.camera.height, 0.0008);
    assert(await field("height").evaluate(element => element.validity.valid));
    await undo(); assert.deepEqual(await source(), beforeZoom); await redo();
    await edit("height", 4e-7);
    assert.equal(await field("height").inputValue(), "4e-7");
    assert.equal(await field("height").evaluate(element => element.valueAsNumber), 4e-7);
    const tiny = await source(), tinyHistory = await history();
    await edit("height", 0); assert.deepEqual(await source(), tiny); assert.deepEqual(await history(), tinyHistory);
    await load(tiny, "camera-tiny-saved.json");
    assert.equal(await field("height").evaluate(element => element.valueAsNumber), 4e-7);
    checks.smallPositiveValuesAndZeroRollback = true;
    await page.screenshot({ path: `${artifact}/controls-fixed.png`, fullPage: true });
    assert.deepEqual(errors, []);
    const report = { status: "passed", dpr: 2, checks, entityCount: 3, billboardVertices: 18, browserErrors: errors.length };
    await writeFile(`${artifact}/regressions.json`, JSON.stringify(report, null, 2) + "\n");
    return report;
  } catch (error) {
    await page.screenshot({ path: `${artifact}/failure.png`, fullPage: true }); throw error;
  } finally { await page.close(); }
}
