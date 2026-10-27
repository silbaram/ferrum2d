import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementMenu, clickPlacementControl } from "./placement-panel-navigation.mjs";
import { smokePlacementGameCameraRegressions } from "./placement-game-camera-regressions-smoke.mjs";
import { smokePlacementGameCameraSave } from "./placement-game-camera-save-smoke.mjs";

/** Camera authoring uses the actual app, native projection and existing export/reopen path. */
export async function smokePlacementGameCamera(parent, timeoutMs = 30000) {
  const artifact = "artifacts/game-camera-authoring";
  await mkdir(artifact, { recursive: true });
  const results = [];
  for (const projection of ["orthographic", "perspective"]) for (const dpr of [1, 2]) {
    console.log(`Game camera authoring: ${projection}, DPR ${dpr}`);
    const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: dpr });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
    const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
    const editor = () => page.evaluate(() => window.ferrumPlacementSpatialCamera);
    const open = () => showPlacementMenu(page, "camera-spatial");
    const field = name => page.locator(`[data-placement-game-camera-field="${name}"]`);
    const edit = async (name, value) => {
      await open(); assert(await field(name).isVisible() && await field(name).isEnabled());
      await field(name).fill(String(value)); await field(name).press("Tab"); await paint();
    };
    const undo = async () => { await page.locator("[data-placement-action=undo]").click(); await paint(); };
    const redo = async () => { await page.locator("[data-placement-action=redo]").click(); await paint(); };
    const pausedView = async expected => {
      await open(); await page.locator("[data-placement-game-camera-preview]").click();
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game", undefined, { timeout: timeoutMs });
      await paint();
      assert.equal(await page.locator("[data-placement-playback=pause]").textContent(), "Resume");
      assert(await page.locator("[data-placement-game-camera-frame]").isVisible());
      const actual = await page.evaluate(() => ({ camera: window.__gameCameraApplied, frame: window.__gameCameraFrame,
        stats: window.ferrumRuntime.renderer.stats(), runtime: window.ferrumPlacementViewerRuntimeFrame,
        box: (() => { const b = document.querySelector('[data-placement-game-camera-frame]').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })(),
        canvas: (() => { const b = document.querySelector('canvas.demo-canvas').getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; })() }));
      assert.deepEqual(actual.camera, expected, "Paused framing must use the saved game camera");
      assert.equal(actual.runtime.entityCount, 3);
      assert.equal(actual.runtime.spatial.billboardVertices, 18);
      assert(actual.stats.drawCalls > 0 && actual.stats.drawCalls <= 32);
      const p = actual.frame.presentation;
      assert(p && p[4] === 320 && p[5] === 180, "Game framing must preserve the scene's pixel presentation");
      for (const [key, value] of Object.entries({ x: actual.canvas.x + actual.canvas.width * p[0], y: actual.canvas.y + actual.canvas.height * p[1],
        width: actual.canvas.width * p[2], height: actual.canvas.height * p[3] }))
        assert(Math.abs(actual.box[key] - value) < 1, "Frame outline must match the native viewport in CSS pixels");
      await page.screenshot({ path: `${artifact}/frame-${projection}-dpr${dpr}.png`, fullPage: true });
      await page.locator("[data-placement-playback=stop]").click();
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial"); await paint();
      assert(await page.locator("[data-placement-game-camera-frame]").isHidden());
      return actual;
    };
    try {
      const url = new URL(parent.url()); url.search = "?scene=hd2d";
      await page.goto(url.href, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerRuntimeFrame?.entityCount === 3,
        undefined, { timeout: timeoutMs });
      await page.locator("[data-placement-language]").selectOption("en");
      const document = await source();
      document.spatial.environment = { pixelArt: { width: 320, height: 180, snapCamera: false } };
      if (projection === "perspective") {
        document.spatial.camera.projection = projection; document.spatial.camera.fovDegrees = 55;
        delete document.spatial.camera.height;
      }
      await page.locator("[data-placement-document-file]").setInputFiles({ name: `game-camera-${projection}-${dpr}.json`,
        mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
      await page.waitForFunction(projection => window.ferrumPlacementWorkspaceMode === "spatial" &&
        window.ferrumPlacementSpatialExportDocument().spatial.camera.projection === projection && !window.document.querySelector('.demo-shell').inert,
        projection, { timeout: timeoutMs });
      await page.evaluate(() => {
        const renderer = window.ferrumRuntime.renderer, render = renderer.renderCommands;
        renderer.renderCommands = function (...args) {
          const frame = (args[1] ?? args[0]).spatial;
          if (frame) window.__gameCameraFrame = { matrix: Array.from(frame.camera), presentation: frame.presentation ? Array.from(frame.presentation) : undefined };
          return render.apply(this, args);
        };
        const engine = window.ferrumEngine, configure = engine.configureDataSceneSpatial, set = engine.setDataSceneSpatialCamera;
        engine.configureDataSceneSpatial = function (...args) { const ok = configure.apply(this, args); if (ok) window.__gameCameraApplied = structuredClone(args[0].camera); return ok; };
        engine.setDataSceneSpatialCamera = function (...args) { const ok = set.apply(this, args); if (ok) window.__gameCameraApplied = structuredClone(args[0]); return ok; };
      });
      await paint();
      const baseline = await source();
      const initialEditor = await editor();
      await clickPlacementControl(page, "[data-placement-spatial-camera=up]");
      await clickPlacementControl(page, "[data-placement-spatial-camera=left]");
      await clickPlacementControl(page, "[data-placement-spatial-camera=in]");
      const navigation = await editor();
      assert.notDeepEqual(navigation, initialEditor);
      assert.deepEqual(await source(), baseline);
      assert.equal((await history()).undoCount, 0);
      await open(); await page.locator("[data-placement-game-camera-apply]").click(); await paint();
      const applied = await source();
      assert.deepEqual(applied.spatial.camera, navigation, "Apply must use the navigation camera, without editor-only depth compensation");
      const patch = await page.evaluate(() => window.ferrumPlacementViewerExportPatch());
      assert.equal(patch.spatial.version, 5);
      assert.equal(patch.spatial.operations[0].kind, "setCamera");
      assert.equal("id" in patch.spatial.operations[0], false);
      assert.equal((await history()).undoCount, 1);
      await undo(); assert.deepEqual(await source(), baseline); assert.deepEqual(await editor(), navigation);
      await redo(); assert.deepEqual(await source(), applied);
      const firstGame = await pausedView(applied.spatial.camera);
      assert.deepEqual(await editor(), navigation);
      await edit("pitch", 45); await edit("yaw", 90); await edit("targetX", 12);
      const lens = projection === "orthographic" ? "height" : "fov";
      await edit(lens, projection === "orthographic" ? 180 : 65);
      const changed = await source();
      assert.notDeepEqual(changed.spatial.camera, applied.spatial.camera);
      const secondGame = await pausedView(changed.spatial.camera);
      assert.notDeepEqual(secondGame.frame.matrix, firstGame.frame.matrix, "Authored game camera edits must change the native projection");
      assert.deepEqual(await editor(), navigation, "Game camera input must preserve editor navigation");
      const beforeZoom = await source(), count = (await history()).undoCount;
      await open(); await page.locator('[data-placement-game-camera-zoom="in"]').click(); await paint();
      assert.notDeepEqual((await source()).spatial.camera, beforeZoom.spatial.camera);
      assert.equal((await history()).undoCount, count + 1);
      await undo(); assert.deepEqual(await source(), beforeZoom);
      const invalidHistory = await history();
      await edit(lens, 0); assert.deepEqual(await source(), beforeZoom); assert.deepEqual(await history(), invalidHistory);
      await page.evaluate(() => {
        const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial;
        let injected = false;
        engine.configureDataSceneSpatial = function (...args) {
          if (!injected) { injected = true; return false; }
          return original.apply(this, args);
        };
        window.__restoreCameraConfigure = () => { engine.configureDataSceneSpatial = original; };
      });
      await edit(lens, projection === "orthographic" ? 190 : 66);
      await page.evaluate(() => window.__restoreCameraConfigure());
      assert.deepEqual(await source(), beforeZoom); assert.deepEqual(await history(), invalidHistory);
      assert(await field(lens).isEnabled(), "A rejected native camera edit must not strand input ownership");
      if (projection === "orthographic" && dpr === 1) {
        const activeDocument = await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument);
        const originalTab = page.getByRole("tab", { name: "placement.hd2d.scene-authoring.json", exact: true });
        await page.evaluate(() => {
          const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial;
          engine.configureDataSceneSpatial = () => false;
          window.__restoreCameraConfigure = () => { engine.configureDataSceneSpatial = original; };
        });
        await edit(lens, 190);
        const pending = await page.evaluate(() => window.__ferrumPlacementViewer.historyState());
        assert.equal(pending.transactionLabel, "Game Camera");
        assert.equal(pending.undoCount, invalidHistory.undoCount);
        assert(await field(lens).isDisabled(), "Failed cancellation must retain camera input ownership");
        const assertPending = async () => {
          assert.deepEqual(await source(), beforeZoom);
          assert.deepEqual(await page.evaluate(() => window.__ferrumPlacementViewer.historyState()), pending);
          assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceMode), "spatial");
          assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument), activeDocument);
        };
        await page.locator('[data-placement-mode="2d"]').evaluate(button => button.click());
        await assertPending();
        await originalTab.evaluate(button => button.click()); await assertPending();
        await page.evaluate(() => window.ferrumPlacementViewerUndo()); await assertPending();
        await page.setViewportSize({ width: 1440, height: 960 }); await paint(); await assertPending();
        await page.evaluate(() => window.__restoreCameraConfigure());
        await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("Escape"); await paint();
        assert.deepEqual(await page.evaluate(() => window.__ferrumPlacementViewer.historyState()), invalidHistory);
        assert.deepEqual(await source(), beforeZoom);
        await page.setViewportSize({ width: 1440, height: 1000 }); await paint();
        await open(); assert(await field(lens).isEnabled());
        await pausedView(beforeZoom.spatial.camera);
      }
      const beforeSwitch = await source();
      await open(); await page.locator("[data-placement-game-camera-projection]").selectOption(projection === "orthographic" ? "perspective" : "orthographic"); await paint();
      assert.notEqual((await source()).spatial.camera.projection, projection);
      await undo(); assert.deepEqual(await source(), beforeSwitch);
      const exported = await source();
      await page.locator("[data-placement-document-file]").setInputFiles({ name: `saved-camera-${projection}-${dpr}.json`,
        mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
      await page.waitForFunction(() => !window.document.querySelector('.demo-shell').inert && window.ferrumPlacementViewerHistory.undoCount === 0);
      assert.deepEqual((await source()).spatial.camera, exported.spatial.camera);
      await pausedView(exported.spatial.camera);
      await page.locator("[data-placement-language]").selectOption("ko"); await open();
      assert.equal(await page.locator("[data-placement-game-camera-apply]").textContent(), "현재 시점 적용");
      assert.equal(await page.locator("[data-placement-game-camera-preview]").textContent(), "게임 카메라 보기");
      await page.screenshot({ path: `${artifact}/controls-${projection}-dpr${dpr}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      results.push({ projection, dpr, navigationSeparated: true, applyViewPatchV5: true, oneUndoAndRedo: true,
        nativeGameCameraChanged: true, pausedPreviewAndFrame: true, zoomAndLens: true, invalidAndNativeFailureRollback: true,
        ...(projection === "orthographic" && dpr === 1 ? { persistentFailureOwnershipAndRetry: true } : {}),
        projectionSwitch: true, reopen: true, localized: true, entityCount: 3, maxDraws: Math.max(firstGame.stats.drawCalls, secondGame.stats.drawCalls) });
    } catch (error) {
      await page.screenshot({ path: `${artifact}/failure-${projection}-dpr${dpr}.png`, fullPage: true });
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${artifact}/browser-verification.json`, JSON.stringify(results, null, 2) + "\n");
  await smokePlacementGameCameraRegressions(parent, timeoutMs);
  await smokePlacementGameCameraSave(parent, timeoutMs);
  return results;
}
