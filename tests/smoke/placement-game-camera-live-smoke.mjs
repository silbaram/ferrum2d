import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { smokePlacementGameCameraGestures } from "./placement-game-camera-gestures-smoke.mjs";
import { clickPlacementControl } from "./placement-panel-navigation.mjs";

/** Exercise visible live controls against native projection, without replacing simulation. */
export async function smokePlacementGameCameraLive(parent, timeoutMs = 30000) {
  const artifact = "artifacts/game-camera-live-preview";
  await mkdir(artifact, { recursive: true });
  const results = [];
  for (const projection of ["orthographic", "perspective"]) for (const dpr of [1, 2]) {
    console.log(`Live game camera: ${projection}, DPR ${dpr}`);
    const page = await parent.context().browser().newPage({ viewport: { width: 1125, height: 1000 }, deviceScaleFactor: dpr });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
    const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
    const field = name => page.locator(`[data-placement-game-camera-field="${name}"]`);
    const native = () => page.evaluate(() => ({ camera: window.__liveCamera, matrix: window.__liveMatrix,
      state: window.ferrumEngine.dataSceneState(), runtime: window.ferrumPlacementViewerRuntimeFrame,
      draws: window.ferrumRuntime.renderer.stats().drawCalls }));
    try {
      const url = new URL(parent.url()); url.search = "?scene=hd2d";
      await page.goto(url.href, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial", undefined, { timeout: timeoutMs });
      await page.locator("[data-placement-language]").selectOption("en");
      const document = await source();
      document.spatial.environment = { pixelArt: { width: 320, height: 180, snapCamera: false } };
      if (projection === "perspective") {
        document.spatial.camera.projection = projection; document.spatial.camera.fovDegrees = 55;
        delete document.spatial.camera.height;
      }
      await page.locator("[data-placement-document-file]").setInputFiles({ name: `live-${projection}-${dpr}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)) });
      await page.waitForFunction(() => !window.document.querySelector(".demo-shell").inert && window.ferrumPlacementViewerHistory.undoCount === 0);
      // A manually composed editor view must survive live-dock and window resizes.
      await clickPlacementControl(page,"[data-placement-spatial-camera=out]");
      const baseline = await source(), editor = await page.evaluate(() => window.ferrumPlacementSpatialCamera);
      await page.evaluate(() => {
        const engine = window.ferrumEngine, set = engine.setDataSceneSpatialCamera, configure = engine.configureDataSceneSpatial;
        engine.setDataSceneSpatialCamera = function (...args) {
          if (window.__rejectLiveCamera) { window.__rejectLiveCamera = false; return false; }
          const ok = set.apply(this, args); if (ok) window.__liveCamera = structuredClone(args[0]); return ok;
        };
        engine.configureDataSceneSpatial = function (...args) {
          if (window.__rejectLiveConfigure) { window.__rejectLiveConfigure = false; return false; }
          const ok = configure.apply(this, args); if (ok) window.__liveCamera = structuredClone(args[0].camera); return ok;
        };
        const renderer = window.ferrumRuntime.renderer, render = renderer.renderCommands;
        renderer.renderCommands = function (...args) {
          const spatial = (args[1] ?? args[0]).spatial;
          if (spatial) { window.__liveMatrix = Array.from(spatial.camera); window.__livePresentation = spatial.presentation ? Array.from(spatial.presentation) : undefined; }
          return render.apply(this, args);
        };
      });
      const launch = page.locator("[data-placement-game-camera-edit]");
      const launchBox = await launch.boundingBox(), mountBox = await page.locator(".placement-camera-mount").boundingBox();
      assert(launchBox.x >= mountBox.x && launchBox.x + launchBox.width <= mountBox.x + mountBox.width + 1, "Camera entry must be visible without scrolling the compact toolbar");
      await launch.click(); await page.setViewportSize({ width: 1440, height: 1000 }); await paint();
      const dock = page.locator("[data-placement-game-camera-dock]");
      assert(await dock.isVisible()); assert(await field("targetX").isEnabled());
      assert.equal((await native()).state, "paused");
      assert.deepEqual(await source(), baseline); assert.equal((await history()).undoCount, 0);
      const gestures = await smokePlacementGameCameraGestures(page);

      const initial = await native(), x = baseline.spatial.camera.target.x + 12;
      await field("targetX").fill(String(x)); await paint();
      assert.equal((await native()).camera.target.x, x, "Focused input must immediately update the native game view");
      assert.notDeepEqual((await native()).matrix, initial.matrix);
      assert.deepEqual(await source(), baseline, "Pending input must not create a patch per keystroke");
      await field("targetX").press("Escape"); await paint();
      assert.deepEqual((await native()).camera, baseline.spatial.camera);
      assert.deepEqual(await source(), baseline); assert.equal((await history()).undoCount, 0);

      await field("targetX").fill(String(x)); await field("targetX").press("Enter"); await paint();
      assert.equal((await source()).spatial.camera.target.x, x); assert.equal((await history()).undoCount, 1);
      assert(await field("targetX").evaluate(input => input === document.activeElement));
      const range = page.locator('[data-placement-game-camera-range="pitch"]'), box = await range.boundingBox();
      const beforeDrag = await source();
      await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.77, box.y + box.height / 2, { steps: 4 }); await paint();
      await page.keyboard.press("Shift"); await paint();
      assert.deepEqual(await source(), beforeDrag, "Dragging must remain one pending edit");
      assert.notDeepEqual((await native()).camera, beforeDrag.spatial.camera);
      await page.mouse.up(); await paint(); assert.equal((await history()).undoCount, 2);

      const accepted = await source(), lens = projection === "orthographic" ? "height" : "distance";
      await field(lens).fill("0"); await paint();
      assert(await dock.locator('[role="alert"]').isVisible());
      assert.deepEqual((await native()).camera, accepted.spatial.camera);
      await field(lens).press("Escape"); assert(await dock.locator('[role="alert"]').isHidden());
      await page.evaluate(() => { window.__rejectLiveCamera = true; });
      await field("targetX").fill(String(x + 8)); await paint();
      assert.deepEqual(await source(), accepted); assert.deepEqual((await native()).camera, accepted.spatial.camera);
      await field("targetX").press("Escape");
      await page.evaluate(() => { window.__rejectLiveConfigure = true; });
      await field("targetX").fill(String(x + 8)); await field("targetX").press("Enter"); await paint();
      assert.deepEqual(await source(), accepted); assert.deepEqual((await native()).camera, accepted.spatial.camera);
      assert(await field("targetX").isEnabled()); assert(await dock.locator('[role="alert"]').isVisible());
      await field("targetX").press("Escape");
      await page.locator('[data-placement-game-camera-zoom="in"]').click(); await paint();
      const zoomed = await source(); assert.notDeepEqual(zoomed.spatial.camera, accepted.spatial.camera);
      assert.deepEqual((await native()).camera, zoomed.spatial.camera);
      assert.equal((await native()).state, "paused");

      // The dock reserves space rather than covering the actual game frame.
      const layout = await page.evaluate(() => {
        const canvas = document.querySelector("canvas.demo-canvas").getBoundingClientRect();
        const dock = document.querySelector("[data-placement-game-camera-dock]").getBoundingClientRect();
        const frame = document.querySelector("[data-placement-game-camera-frame]").getBoundingClientRect();
        return { right: canvas.right, dockLeft: dock.left, frameRight: frame.right, width: canvas.width, frameWidth: frame.width,
          ratio: frame.width / frame.height, presentation: window.__livePresentation };
      });
      assert(layout.right <= layout.dockLeft + 1 && layout.frameRight <= layout.right + 1);
      assert(layout.width > 0 && layout.frameWidth > 0 && Math.abs(layout.ratio - 16 / 9) < 0.01);
      assert.equal(layout.presentation[4], 320); assert.equal(layout.presentation[5], 180);
      await page.screenshot({ path: `${artifact}/${projection}-dpr${dpr}.png`, fullPage: true });
      await page.locator("[data-placement-playback=pause]").click(); await paint();
      assert.equal((await native()).state, "playing"); assert(await dock.isHidden());
      assert(await page.locator("[data-placement-game-camera-edit]").isVisible());
      await page.locator("[data-placement-game-camera-edit]").click(); await paint();
      assert.equal((await native()).state, "paused"); assert(await dock.isVisible());
      await page.setViewportSize({ width: 1125, height: 760 }); await paint();
      assert.deepEqual((await native()).camera, zoomed.spatial.camera);
      await page.locator("[data-placement-game-camera-close]").click(); await paint();
      assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceMode), "spatial");
      assert.deepEqual(await page.evaluate(() => window.ferrumPlacementSpatialCamera), editor);
      assert(await dock.isHidden());
      await page.locator("[data-placement-action=undo]").click(); await paint(); assert.deepEqual(await source(), accepted);
      await page.locator("[data-placement-action=redo]").click(); await paint(); assert.deepEqual(await source(), zoomed);
      await page.locator("[data-placement-document-file]").setInputFiles({ name: `live-saved-${projection}-${dpr}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(zoomed)) });
      await page.waitForFunction(() => !window.document.querySelector(".demo-shell").inert && window.ferrumPlacementViewerHistory.undoCount === 0);
      await page.locator("[data-placement-game-camera-edit]").click(); await paint();
      assert.deepEqual((await native()).camera, zoomed.spatial.camera);
      const last = await native();
      assert.equal(last.runtime.entityCount, 3); assert.equal(last.runtime.spatial.billboardVertices, 18);
      assert(last.draws > 0 && last.draws <= 32);
      await page.locator("[data-placement-language]").selectOption("ko");
      assert.equal(await page.locator("[data-placement-game-camera-close]").textContent(), "편집으로 돌아가기");
      await page.screenshot({ path: `${artifact}/compact-${projection}-dpr${dpr}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      results.push({ projection, dpr, gestures, liveInputAndSlider: true, escapeAndRejection: true, oneEditPerGesture: true,
        reservedGameFrame: true, pauseResumeAndEditorRestore: true, undoRedoAndReopen: true, entities: 3, billboardVertices: 18, draws: last.draws });
    } catch (error) {
      await page.screenshot({ path: `${artifact}/failure-${projection}-${dpr}.png`, fullPage: true }); throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${artifact}/verification.json`, JSON.stringify({ status: "passed", results }, null, 2) + "\n");
  return results;
}
