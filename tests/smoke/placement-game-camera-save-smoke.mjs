import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { showPlacementMenu } from "./placement-panel-navigation.mjs";
import { placementSpatialRegressionFixture } from "./placement-test-build.mjs";

/** Actual frontend save/locking and native renderer; the desktop bridge stores fixture JSON in memory only. */
export async function smokePlacementGameCameraSave(parent, timeoutMs = 30000) {
  const artifact = "artifacts/game-camera-pending-save-fix";
  await mkdir(artifact, { recursive: true });
  const fixture = JSON.parse(await readFile(placementSpatialRegressionFixture, "utf8"));
  const results = [];
  for (const projection of ["orthographic", "perspective"]) {
    console.log(`Game camera pending save: ${projection}`);
    const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
    const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
    const count = () => page.evaluate(() => window.__cameraSaveRequests.length);
    const open = () => showPlacementMenu(page, "camera-spatial");
    const field = name => page.locator(`[data-placement-game-camera-field="${name}"]`);
    const pending = async (name, value) => { await open(); await field(name).fill(String(value)); };
    const save = () => page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
    const clean = async () => {
      await paint();
      assert.equal(await page.evaluate(() => window.ferrumPlacementViewerExportPatch()), undefined);
      assert.equal((await history()).undoCount, 0);
      assert.equal(await page.locator(".demo-shell").evaluate(element => element.inert), false);
      assert(await field(lens).isEnabled());
    };
    const lens = projection === "orthographic" ? "height" : "fov";
    const specKey = projection === "orthographic" ? "height" : "fovDegrees";
    const values = projection === "orthographic" ? [260, 333, 444, 555, 666, 777] : [60, 66, 72, 80, 85, 90];
    try {
      const document = structuredClone(fixture);
      if (projection === "perspective") {
        document.spatial.camera.projection = projection; document.spatial.camera.fovDegrees = 55; delete document.spatial.camera.height;
      }
      await page.addInitScript(document => {
        let saved = JSON.parse(sessionStorage.getItem("camera-save-fixture") ?? "null") ?? structuredClone(document);
        window.__cameraSaveRequests = []; window.__cameraSaveHold = false; window.__cameraSaveReject = false;
        window.__TAURI__ = { core: { async invoke(command, args) {
          if (command === "load_placement_scene_document") return { path: "/tmp/camera-save-fixture.json", document: structuredClone(saved) };
          if (command !== "save_placement_scene_document") throw new Error("Unexpected save fixture command: " + command);
          assertExpected(args.expectedDocument);
          window.__cameraSaveRequests.push(structuredClone(args));
          if (window.__cameraSaveHold) await new Promise(resolve => { window.__cameraSaveRelease = resolve; });
          if (window.__cameraSaveReject) throw new Error("Injected camera save rejection");
          saved = structuredClone(args.document); sessionStorage.setItem("camera-save-fixture", JSON.stringify(saved));
          return { path: "/tmp/camera-save-fixture.json", document: structuredClone(saved) };
        } } };
        function assertExpected(expected) {
          if (JSON.stringify(expected) !== JSON.stringify(saved)) throw new Error("Camera save fixture conflict");
        }
      }, document);
      const url = new URL(parent.url()); url.search = "?scene=hd2d";
      await page.goto(url.href, { waitUntil: "networkidle" });
      const ready = () => page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerSaveEnabled === true && window.ferrumPlacementViewerRuntimeFrame?.entityCount === 3, undefined, { timeout: timeoutMs });
      await ready(); await page.locator("[data-placement-language]").selectOption("en");
      await pending(lens, values[0]); await field(lens).press("Tab"); await paint();
      assert.equal((await history()).undoCount, 1);

      // Keep focus in the dirty input: the save command itself must flush it.
      await pending(lens, values[1]);
      assert.equal((await source()).spatial.camera[specKey], values[0]);
      await page.evaluate(() => { window.__cameraSaveHold = true; window.__cameraSavePromise = window.ferrumPlacementViewerSaveDraft(); });
      await page.waitForFunction(() => document.querySelector(".demo-shell").inert, undefined, { timeout: timeoutMs }); await paint();
      assert.equal((await source()).spatial.camera[specKey], values[1]);
      assert.equal((await history()).undoCount, 2);
      assert.equal(await page.evaluate(key => window.__cameraSaveRequests[0].document.spatial.camera[key], specKey), values[1]);
      assert(await field(lens).isDisabled());
      await save(); assert.equal(await count(), 1, "A second command must not duplicate an in-flight save");
      await page.evaluate(() => window.__cameraSaveRelease());
      assert.equal((await page.evaluate(() => window.__cameraSavePromise)).saved, true);
      await clean();
      await page.evaluate(() => { window.__cameraSaveHold = false; });

      // A clean document has no patch until its pending input is validated.
      await pending(lens, values[2]); assert.equal((await history()).undoCount, 0);
      assert.equal((await save()).saved, true); await clean();
      assert.equal((await source()).spatial.camera[specKey], values[2]);
      const beforeNoop = await count();
      await pending(lens, values[2]); await save(); await clean();
      assert.equal(await count(), beforeNoop, "Unchanged focused input must not create a patch or save request");

      const accepted = await source(), acceptedHistory = await history();
      for (const invalid of [projection === "orthographic" ? 0 : 171, ""]) {
        await pending(lens, invalid); await save(); await paint();
        assert.deepEqual(await source(), accepted); assert.deepEqual(await history(), acceptedHistory);
        assert.equal(await count(), beforeNoop); assert.equal(await field(lens).inputValue(), String(invalid));
        assert(await field(lens).evaluate(element => element === document.activeElement && !element.disabled));
        assert.equal(await page.locator(".demo-shell").evaluate(element => element.inert), false);
      }
      // Number inputs expose incomplete text as value="" plus badInput=true.
      await pending(lens, ""); await page.keyboard.type("1e");
      assert(await field(lens).evaluate(element => element.validity.badInput));
      await save(); await paint();
      assert(await field(lens).evaluate(element => element.validity.badInput && element === document.activeElement));
      assert.equal(await count(), beforeNoop); assert.deepEqual(await source(), accepted);

      // A rejected native candidate may re-enter sync while recovering the old scene.
      await pending(lens, values[3]);
      await page.evaluate(() => {
        const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial; let rejected = false;
        engine.configureDataSceneSpatial = function (...args) { if (!rejected) { rejected = true; return false; } return original.apply(this, args); };
        window.__restoreCameraSaveNative = () => { engine.configureDataSceneSpatial = original; };
      });
      await save(); await page.evaluate(() => window.__restoreCameraSaveNative()); await paint();
      assert.equal(await count(), beforeNoop); assert.deepEqual(await source(), accepted); assert.deepEqual(await history(), acceptedHistory);
      assert.equal(await field(lens).inputValue(), String(values[3]));
      assert(await field(lens).evaluate(element => element === document.activeElement && !element.disabled));
      assert.equal((await save()).saved, true); await clean();
      assert.equal((await source()).spatial.camera[specKey], values[3]);

      // Backend rejection keeps the newly validated draft available for retry/Undo.
      await pending(lens, values[4]); await page.evaluate(() => { window.__cameraSaveReject = true; });
      await save(); await paint();
      assert.equal((await source()).spatial.camera[specKey], values[4]); assert.equal((await history()).undoCount, 1);
      assert.equal(await page.locator(".demo-shell").evaluate(element => element.inert), false); assert(await field(lens).isEnabled());
      await pending(lens, values[5]); await page.evaluate(() => { window.__cameraSaveReject = false; });
      assert.equal((await save()).saved, true); await clean();

      if (projection === "orthographic") {
        const beforeFailure = await source(), requests = await count();
        await pending(lens, 888);
        await page.evaluate(() => {
          const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial;
          engine.configureDataSceneSpatial = () => false;
          window.__restoreCameraSaveNative = () => { engine.configureDataSceneSpatial = original; };
        });
        await save(); await paint();
        assert.equal(await count(), requests); assert.deepEqual(await source(), beforeFailure);
        assert.equal(await page.evaluate(() => window.__ferrumPlacementViewer.historyState().transactionLabel), "Game Camera");
        assert(await field(lens).isDisabled()); await save(); assert.equal(await count(), requests);
        await page.evaluate(() => window.__restoreCameraSaveNative());
        await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("Escape"); await paint();
        assert.equal(await page.evaluate(() => window.__ferrumPlacementViewer.historyState().transactionLabel), undefined);
        assert.deepEqual(await source(), beforeFailure); assert(await field(lens).isEnabled());
      }

      // A deferred blur after a successful signed-angle flush must stay clean.
      await pending("pitch", -35); assert.equal((await save()).saved, true);
      await page.locator("canvas.demo-canvas").focus(); await clean();
      const savedCamera = (await source()).spatial.camera, requestCount = await count();
      await page.screenshot({ path: `${artifact}/saved-${projection}.png`, fullPage: true });
      await page.reload({ waitUntil: "networkidle" }); await ready();
      assert.deepEqual((await source()).spatial.camera, savedCamera); await clean();
      await page.evaluate(() => {
        const engine = window.ferrumEngine, original = engine.configureDataSceneSpatial;
        engine.configureDataSceneSpatial = function (...args) { const result = original.apply(this, args); if (result) window.__savedCameraApplied = structuredClone(args[0].camera); return result; };
      });
      await open(); await page.locator("[data-placement-game-camera-preview]").click(); await paint();
      const native = await page.evaluate(() => ({ state: window.ferrumEngine.dataSceneState(), camera: window.__savedCameraApplied,
        runtime: window.ferrumPlacementViewerRuntimeFrame, draws: window.ferrumRuntime.renderer.stats().drawCalls }));
      assert.equal(native.state, "paused"); assert.deepEqual(native.camera, savedCamera);
      assert.equal(native.runtime.entityCount, 3); assert.equal(native.runtime.spatial.billboardVertices, 18);
      assert(native.draws > 0 && native.draws <= 32);
      // The persistent paused panel uses the same focused-input save boundary.
      assert(await page.locator("[data-placement-game-camera-dock]").isVisible());
      const previewRequests = await count();
      const frameBox = await page.locator("[data-placement-game-camera-frame]").boundingBox();
      const anchor = { x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2 };
      await page.mouse.move(anchor.x, anchor.y); await page.mouse.down();
      await page.mouse.move(anchor.x + 30, anchor.y - 15, { steps: 4 }); await paint();
      assert(await field(lens).isDisabled());
      await save(); assert.equal(await count(), previewRequests);
      assert.deepEqual((await source()).spatial.camera, savedCamera);
      await page.keyboard.press("Escape"); await page.mouse.up(); await paint(); await clean();
      await field("targetX").fill(String(savedCamera.target.x + 1)); await paint();
      assert.deepEqual((await source()).spatial.camera, savedCamera);
      assert.equal((await save()).saved, true); await clean();
      assert.equal(await count(), previewRequests + 1);
      assert.equal((await source()).spatial.camera.target.x, savedCamera.target.x + 1);
      assert.equal(await page.evaluate(() => window.ferrumEngine.dataSceneState()), "paused");
      await page.locator("canvas.demo-canvas").focus(); await clean();
      const range = page.locator('[data-placement-game-camera-range="pitch"]'), rangeBox = await range.boundingBox();
      const beforeRange = await source();
      await page.mouse.move(rangeBox.x + rangeBox.width * 0.7, rangeBox.y + rangeBox.height / 2); await page.mouse.down();
      await page.mouse.move(rangeBox.x + rangeBox.width * 0.75, rangeBox.y + rangeBox.height / 2, { steps: 3 }); await paint();
      assert.deepEqual(await source(), beforeRange);
      assert.equal((await save()).saved, true); await clean();
      const savedRange = await source(); assert.notDeepEqual(savedRange.spatial.camera, beforeRange.spatial.camera);
      await page.mouse.up(); await paint(); await clean();
      assert.deepEqual(await source(), savedRange, "Deferred range change after save must not create a second edit");
      assert.deepEqual(errors, []);
      results.push({ projection, focusedDirtyAndCleanSaved: true, oneCameraUndoBeforeSave: true, duplicateSaveBlocked: true,
        invalidEmptyAndBadInputPreserved: true, nativeRejectionAndRetry: true, backendRejectionAndRetry: true,
        ...(projection === "orthographic" ? { persistentFailureOwnership: true } : {}), noopAndDeferredBlurClean: true,
        reloadAndNativePreview: true, liveGestureSaveBlocked: true, liveFocusedSave: true, liveSliderSave: true, requestCount: requestCount + 2, entities: 3, billboardVertices: 18, draws: native.draws });
    } catch (error) {
      await page.screenshot({ path: `${artifact}/failure-${projection}.png`, fullPage: true });
      const state = await page.evaluate(() => ({
        history: window.__ferrumPlacementViewer.historyState(), document: window.ferrumPlacementSpatialExportDocument(),
        input: document.activeElement?.getAttribute("data-placement-game-camera-field"),
        requests: window.__cameraSaveRequests.map(request => request.document.spatial.camera),
      })).catch(() => undefined);
      await writeFile(`${artifact}/failure-${projection}.json`, JSON.stringify({ error: error.stack, state, errors }, null, 2) + "\n");
      throw error;
    } finally { await page.close(); }
  }

  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 } });
  const exportErrors = [];
  page.on("pageerror", error => exportErrors.push(error.message));
  try {
    const url = new URL(parent.url()); url.search = "?scene=hd2d";
    await page.goto(url.href, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerRuntimeFrame?.entityCount === 3, undefined, { timeout: timeoutMs });
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerSaveEnabled), false);
    await showPlacementMenu(page, "camera-spatial");
    const original = await page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
    await page.locator('[data-placement-game-camera-field="height"]').fill("333");
    await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
    assert.deepEqual(await page.evaluate(() => window.ferrumPlacementSpatialExportDocument()), original);
    assert.equal(await page.locator('[data-placement-game-camera-field="height"]').inputValue(), "333");
    assert.deepEqual(exportErrors, []);
    results.push({ exportOnlySaveHasNoSideEffects: true });
  } finally { await page.close(); }
  await writeFile(`${artifact}/save-regressions.json`, JSON.stringify({ status: "passed", results, desktopBridge: "test memory/sessionStorage only" }, null, 2) + "\n");
  return results;
}
