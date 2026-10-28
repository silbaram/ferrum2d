import assert from "node:assert/strict";

/** Real mouse gestures in the existing native camera fixture; return a clean draft. */
export async function smokePlacementGameCameraGestures(page) {
  const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
  const applied = () => page.evaluate(() => window.__liveCamera);
  const canvas = page.locator("canvas.demo-canvas");
  const baseline = await source(), initial = await history();
  const center = async () => {
    const rect = await page.locator("[data-placement-game-camera-frame]").boundingBox();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const down = async (button = "left") => { const point = await center(); await page.mouse.move(point.x, point.y); await page.mouse.down({ button }); return point; };
  const field = name => page.locator(`[data-placement-game-camera-field="${name}"]`);
  const originalCamera = baseline.spatial.camera;
  await page.evaluate(() => document.querySelector("canvas.demo-canvas").addEventListener("pointerdown", event => { window.__cameraGesturePointerId = event.pointerId; }, { capture: true }));

  let point = await down();
  await page.mouse.move(point.x + 48, point.y - 20, { steps: 6 }); await paint();
  assert.deepEqual(await source(), baseline); assert.equal((await history()).undoCount, initial.undoCount);
  assert.notDeepEqual(await applied(), originalCamera);
  assert(await field("pitch").isDisabled());
  const pendingPitch = await field("pitch").inputValue();
  await page.keyboard.press("Shift"); assert.equal(await field("pitch").inputValue(), pendingPitch);
  await page.mouse.up(); await paint();
  assert.equal((await history()).undoCount, initial.undoCount + 1);
  const orbited = await source(); assert.deepEqual((await applied()).target, originalCamera.target);
  assert.deepEqual(orbited.sceneComposition, baseline.sceneComposition);

  point = await down(); await page.mouse.move(point.x - 35, point.y + 18); await paint();
  await page.keyboard.press("Escape"); await page.mouse.up(); await paint();
  assert.deepEqual(await source(), orbited); assert.deepEqual(await applied(), orbited.spatial.camera);
  assert(await field("pitch").isEnabled());

  // Native matrix + actual letterboxed frame prove pan tracks CSS pixels at either DPR.
  const project = world => page.evaluate(world => {
    const m = window.__liveMatrix, rect = document.querySelector("[data-placement-game-camera-frame]").getBoundingClientRect();
    const x = m[0] * world.x + m[4] * world.elevation - m[8] * world.y + m[12];
    const y = m[1] * world.x + m[5] * world.elevation - m[9] * world.y + m[13];
    const w = m[3] * world.x + m[7] * world.elevation - m[11] * world.y + m[15];
    return { x: rect.x + (x / w + 1) * rect.width / 2, y: rect.y + (1 - y / w) * rect.height / 2 };
  }, world);
  const anchor = orbited.spatial.camera.target, beforePan = await project(anchor);
  await canvas.focus(); await page.keyboard.down("Space"); point = await down();
  await page.mouse.move(point.x + 24, point.y + 16, { steps: 4 }); await paint();
  const afterPan = await project(anchor);
  assert(Math.abs(afterPan.x - beforePan.x - 24) < 1 && Math.abs(afterPan.y - beforePan.y - 16) < 1, "Pan must track screen pixels through native projection");
  await page.mouse.up(); await page.keyboard.up("Space"); await paint();
  assert.equal((await history()).undoCount, initial.undoCount + 2);
  const panned = await source();
  point = await down("middle"); await page.mouse.move(point.x + 20, point.y - 8); await paint();
  await page.evaluate(() => document.querySelector("canvas.demo-canvas").releasePointerCapture(window.__cameraGesturePointerId));
  await page.mouse.move(point.x + 21, point.y - 8); await page.mouse.up({ button: "middle" }); await paint();
  assert.deepEqual(await source(), panned); assert.deepEqual(await applied(), panned.spatial.camera);

  point = await center(); await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 30); await page.mouse.wheel(0, 30);
  await page.waitForFunction(count => window.ferrumPlacementViewerHistory.undoCount === count, initial.undoCount + 3);
  const zoomed = await source(); assert.notDeepEqual(zoomed.spatial.camera, panned.spatial.camera);
  const label = page.locator('[data-placement-camera-scrub="targetX"]'), box = await label.boundingBox();
  const oldX = zoomed.spatial.camera.target.x;
  await page.keyboard.down("Shift"); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 }); await paint();
  assert.deepEqual(await source(), zoomed);
  assert(Math.abs((await applied()).target.x - oldX - 3) < 1e-8);
  await page.mouse.up(); await page.keyboard.up("Shift"); await paint();
  assert.equal((await history()).undoCount, initial.undoCount + 4);
  const scrubbed = await source();
  await page.keyboard.down("Control"); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2); await paint();
  assert(Math.abs((await applied()).target.x - scrubbed.spatial.camera.target.x - 60) < 1e-8);
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Control"); await paint();
  assert.deepEqual(await source(), scrubbed);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2); await paint();
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2); await paint();
  assert(Math.abs((await applied()).target.x - scrubbed.spatial.camera.target.x - 11) < 1e-8, "Changing precision during a drag must preserve prior movement");
  await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Shift"); await paint();
  assert.deepEqual(await source(), scrubbed);

  // Failed native previews restore the last authored camera; recovery remains editable.
  await page.evaluate(() => { window.__rejectLiveCamera = true; });
  point = await down(); await page.mouse.move(point.x + 30, point.y + 10); await page.mouse.up(); await paint();
  assert.deepEqual(await source(), scrubbed); assert.deepEqual(await applied(), scrubbed.spatial.camera);

  const advanced = page.locator(".placement-game-camera > details"), summary = advanced.locator(":scope > summary");
  await summary.focus(); await page.keyboard.press("Space"); assert(await advanced.evaluate(element => element.open));
  await page.keyboard.press("Space"); assert.equal(await advanced.evaluate(element => element.open), false);
  await page.locator("[data-placement-playback=pause]").focus(); await page.keyboard.press("Space"); await paint();
  assert.equal(await page.evaluate(() => window.ferrumEngine.dataSceneState()), "playing", "Space must activate focused playback buttons");
  await page.locator("[data-placement-game-camera-edit]").click(); await paint();
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector("canvas.demo-canvas")), true);
  assert(await field("pitch").isEnabled());
  point = await down(); await page.mouse.move(point.x - 25, point.y); await paint();
  await page.evaluate(() => {
    const engine = window.ferrumEngine, set = engine.setDataSceneSpatialCamera;
    window.__restoreGestureCamera = () => { engine.setDataSceneSpatialCamera = set; };
    engine.setDataSceneSpatialCamera = () => false;
  });
  await page.keyboard.press("Escape");
  assert(await field("pitch").isDisabled());
  await page.locator('[data-placement-mode="spatial"]').evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceMode), "game", "Rejected cancellation must retain ownership");
  await page.evaluate(() => window.__restoreGestureCamera());
  await page.keyboard.press("Escape"); await page.mouse.up(); await paint();
  assert.deepEqual(await source(), scrubbed); assert.deepEqual(await applied(), scrubbed.spatial.camera);
  assert(await field("pitch").isEnabled());
  point = await down(); await page.mouse.move(point.x - 25, point.y); await paint();
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up(); await paint();
  assert.deepEqual(await source(), scrubbed); assert.deepEqual(await applied(), scrubbed.spatial.camera);

  // Stop cancels an unfinished drag, then regular UI history restores all four edits.
  point = await down(); await page.mouse.move(point.x + 20, point.y); await paint();
  await page.locator('[data-placement-mode="spatial"]').evaluate(button => button.click()); await page.mouse.up(); await paint();
  assert.deepEqual(await source(), scrubbed);
  for (let n = 0; n < 4; n++) { await page.locator("[data-placement-action=undo]").click(); await paint(); }
  assert.deepEqual(await source(), baseline); assert.equal((await history()).undoCount, initial.undoCount);
  await page.locator("[data-placement-game-camera-edit]").click(); await paint();
  assert.deepEqual(await applied(), originalCamera);
  return { orbit: true, cssPixelPan: true, wheelBurstOneUndo: true, fineNumberScrub: true,
    escapeCaptureLossAndBlur: true, nativeFailureRestored: true, persistentFailureOwnership: true, fastNumberScrub: true, continuousModifiers: true, keyboardActivation: true, modeChangeCancels: true };
}
