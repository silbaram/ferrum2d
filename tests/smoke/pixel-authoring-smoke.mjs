import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { showPlacementBottom, showPlacementMenu } from "./placement-panel-navigation.mjs";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";

export async function smokePixelAuthoring({ page, mode, active, native, snapshot, undo, redo, run, origin, getSaves, setResume }) {
  await showPlacementBottom(page, "assets");
  await page.locator('[data-pixel-action="new"]').click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Pixel Name", { exact: true }).fill("my-sprite");
  await dialog.getByLabel("Pixel Width", { exact: true }).fill("8");
  await dialog.getByLabel("Pixel Height", { exact: true }).fill("8");
  await dialog.locator('[data-pixel-action="create"]').click();
  const workspace = page.locator("#placement-pixel-workspace"), canvas = workspace.locator("canvas");
  await workspace.waitFor({ state: "visible" });
  await page.waitForFunction(() => Number(document.querySelector("[data-pixel-canvas]").dataset.pixelZoom) >= 1);
  const original = await snapshot();
  const action = name => workspace.locator('[data-pixel-action="' + name + '"]');
  const color = async value => workspace.locator("[data-pixel-color]").fill(value);
  async function point(x, y) {
    await page.evaluate(() => new Promise(requestAnimationFrame));
    return canvas.evaluate((element, p) => {
      const rect = element.getBoundingClientRect(), zoom = Number(element.dataset.pixelZoom);
      return { x: rect.x + Number(element.dataset.pixelOriginX) + (p.x + 0.5) * zoom,
        y: rect.y + Number(element.dataset.pixelOriginY) + (p.y + 0.5) * zoom };
    }, { x, y });
  }
  async function click(x, y) {
    const p = await point(x, y); await page.mouse.click(p.x, p.y);
  }
  async function exportFile(kind, suffix) {
    const menu = workspace.locator(".placement-pixel-export-menu");
    if (!await menu.evaluate(e => e.open)) await menu.locator("summary").click();
    const pending = page.waitForEvent("download"); await action(kind).click();
    const download = await pending, path = resolve(run, mode + suffix);
    await download.saveAs(path);
    if (await menu.evaluate(e => e.open)) await menu.locator("summary").click();
    return { path, bytes: await readFile(path) };
  }
  await color("#ff0000");
  for (const invalidAlpha of ["", "300", "1.5"]) {
    await workspace.locator("[data-pixel-alpha]").fill(invalidAlpha);
    await canvas.focus();
    assert.equal(await workspace.locator("[data-pixel-alpha]").inputValue(), "255");
  }
  const start = await point(0, 0), end = await point(7, 7);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 2 }); await page.mouse.up();
  const first = JSON.parse((await exportFile("export-source", "-line.pixel.json")).bytes);
  const bytes = Buffer.from(first.rgba, "base64");
  for (let i = 0; i < 8; i++) assert.deepEqual([...bytes.subarray((i * 8 + i) * 4, (i * 8 + i) * 4 + 4)], [255, 0, 0, 255]);
  assert.deepEqual(await snapshot(), original, "Pixel drawing must not mutate the scene or scene Undo");
  const cancelStart = await point(0, 5), cancelEnd = await point(7, 5);
  await page.mouse.move(cancelStart.x, cancelStart.y); await page.mouse.down();
  await page.mouse.move(cancelEnd.x, cancelEnd.y); await page.keyboard.press("Escape"); await page.mouse.up();
  const cancelled = JSON.parse((await exportFile("export-source", "-cancelled.pixel.json")).bytes);
  assert.equal(cancelled.rgba, first.rgba, "Esc must roll back the whole stroke");
  // Some devices deliver a final release coordinate without an intervening move.
  const releaseStart = await point(1, 6), releaseEnd = await point(6, 1);
  await canvas.evaluate(element => element.addEventListener("pointerdown", event => {
    window.pixelReviewPointer = event.pointerId;
  }, { once: true }));
  await page.mouse.move(releaseStart.x, releaseStart.y); await page.mouse.down();
  await canvas.evaluate((element, p) => element.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true, pointerId: window.pixelReviewPointer, clientX: p.x, clientY: p.y, button: 0,
  })), releaseEnd);
  await page.mouse.up();
  const releasedStroke = JSON.parse((await exportFile("export-source", "-release-end.pixel.json")).bytes);
  assert.deepEqual([...Buffer.from(releasedStroke.rgba, "base64").subarray((1 * 8 + 6) * 4, (1 * 8 + 6) * 4 + 4)], [255, 0, 0, 255]);
  await action("undo").click();
  await canvas.focus(); await page.keyboard.down("Space");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  // The real keyup may happen outside the window; synthetic blur must reset Space.
  await click(1, 5);
  const afterBlur = JSON.parse((await exportFile("export-source", "-after-blur.pixel.json")).bytes);
  assert.deepEqual([...Buffer.from(afterBlur.rgba, "base64").subarray((5 * 8 + 1) * 4, (5 * 8 + 1) * 4 + 4)], [255, 0, 0, 255]);
  await page.keyboard.up("Space"); await action("undo").click();
  const blurStart = await point(1, 4), blurEnd = await point(5, 4);
  await page.mouse.move(blurStart.x, blurStart.y); await page.mouse.down(); await page.mouse.move(blurEnd.x, blurEnd.y);
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
  assert.equal(JSON.parse((await exportFile("export-source", "-blur-cancel.pixel.json")).bytes).rgba, first.rgba);
  await color("#0000ff"); await action("tool-eyedropper").click(); await click(0, 0);
  assert.equal(await workspace.locator("[data-pixel-color]").inputValue(), "#ff0000");
  await action("tool-eraser").click(); await click(0, 0);
  await canvas.focus(); await page.keyboard.press("Control+z");
  assert.equal(JSON.parse((await exportFile("export-source", "-eraser-undo.pixel.json")).bytes).rgba, first.rgba);
  const beforeNavigation = await canvas.evaluate(e => ({ x: Number(e.dataset.pixelOriginX), zoom: Number(e.dataset.pixelZoom) }));
  await action("tool-pan").click();
  const pan = await point(3, 3);
  await page.mouse.move(pan.x, pan.y); await page.mouse.down(); await page.mouse.move(pan.x + 40, pan.y + 24); await page.mouse.up();
  await page.waitForFunction(x => Number(document.querySelector("[data-pixel-canvas]").dataset.pixelOriginX) > x, beforeNavigation.x);
  await canvas.hover(); await page.mouse.wheel(0, -100);
  await page.waitForFunction(zoom => Number(document.querySelector("[data-pixel-canvas]").dataset.pixelZoom) > zoom, beforeNavigation.zoom);
  await action("fit").click();
  await page.locator("[data-pixel-file]").setInputFiles({
    name: "invalid.pixel.json", mimeType: "application/json", buffer: Buffer.from('{"format":"wrong"}'),
  });
  await page.waitForFunction(() => document.querySelector("[data-pixel-status]").textContent.includes("Unsupported pixel document"));
  assert.equal(JSON.parse((await exportFile("export-source", "-after-invalid.pixel.json")).bytes).rgba, first.rgba);
  await action("tool-fill").click(); await click(0, 7); await click(7, 0);
  await canvas.focus(); await page.keyboard.press("Control+z"); await page.keyboard.press("Control+Shift+z");
  assert.deepEqual(await snapshot(), original, "Pixel shortcuts must not reach scene history");
  // A native app update must also protect pixel-only edits, with a clean scene.
  const releaseRoute = route => route.fulfill({ json: [{
    draft: false, tag_name: "ferrum-web-v0.1.0-beta.10",
    assets: [{ name: "viewer-updater-linux-x64.json", state: "uploaded" }],
  }] });
  await page.route("https://api.github.com/**", releaseRoute);
  await page.evaluate(() => {
    window.pixelPreviousTauri = window.__TAURI__;
    window.pixelUpdateCommands = [];
    window.__TAURI__ = { core: { async invoke(command) {
      window.pixelUpdateCommands.push(command);
      if (command === "placement_update_info") return {
        viewerVersion: "0.1.0-beta.9", bundledEngineVersion: "0.1.0-beta.9", repository: "silbaram/ferrum2d",
        os: "linux", arch: "x64", configured: true, canInstall: true,
      };
      if (command === "check_placement_viewer_update") return { available: true, version: "0.1.0-beta.10", token: "pixel-fixture" };
      if (command === "apply_placement_viewer_update") return { installed: true, restartRequired: true };
      throw Error("Unexpected pixel update command: " + command);
    } } };
  });
  try {
    await showPlacementMenu(page, "file");
    await page.locator("[data-placement-action=updates]").click();
    await page.waitForFunction(() => !document.querySelector("[data-update-action=viewer]").disabled);
    await page.locator("[data-update-action=viewer]").click();
    await page.waitForFunction(() => document.querySelector("[data-update-section=viewer] [role=status]")
      .textContent.includes("Export pixel changes"));
    assert(!(await page.evaluate(() => window.pixelUpdateCommands)).some(command => command.startsWith("apply_") || command.startsWith("restart_")));
    await page.locator("[data-update-action=close]").click();
  } finally {
    await page.unroute("https://api.github.com/**", releaseRoute);
    await page.evaluate(() => { window.__TAURI__ = window.pixelPreviousTauri; });
  }
  await page.evaluate(() => {
    const previous = File.prototype.text;
    File.prototype.text = function () {
      if (this.name !== "late.pixel.json") return previous.call(this);
      const file = this;
      return new Promise(resolve => {
        window.finishPixelRead = async () => {
          File.prototype.text = previous;
          resolve(await previous.call(file));
        };
      });
    };
  });
  await page.locator("[data-pixel-file]").setInputFiles({
    name: "late.pixel.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...first, name: "late-import" })),
  });
  await page.waitForFunction(() => typeof window.finishPixelRead === "function");
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
  await page.locator('dialog[open] [data-pixel-action="confirm-cancel"]').waitFor();
  await page.evaluate(async () => {
    await window.finishPixelRead();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  assert.equal(await page.locator("dialog[open]").count(), 1, "Late file reads must not stack another confirmation");
  await page.locator('dialog[open] [data-pixel-action="confirm-cancel"]').click();
  const intact = JSON.parse((await exportFile("export-source", "-after-close-race.pixel.json")).bytes);
  assert.equal(intact.name, "my-sprite");
  for (let i = 0, rgba = Buffer.from(intact.rgba, "base64"); i < rgba.length; i += 4)
    assert.deepEqual([...rgba.subarray(i, i + 4)], [255, 0, 0, 255]);
  // Delay a completed upload, change selection, and require provisional rollback.
  const beforeUpload = await page.evaluate(() => window.resources.textures.size);
  await page.evaluate(() => {
    const engine = window.ferrumEngine, previous = engine.loadAssets;
    engine.loadAssets = async function (...args) {
      const result = await previous.apply(this, args);
      if (Object.keys(args[0].textures ?? {}).some(id => id.startsWith("pixel."))) {
        await new Promise(resolve => { window.finishPixelUpload = resolve; });
        engine.loadAssets = previous;
      }
      return result;
    };
  });
  await action("apply").click();
  await page.waitForFunction(() => typeof window.finishPixelUpload === "function");
  assert(await page.locator('[data-placement-close-document="ferrum:pixel-document"]').isDisabled());
  await page.evaluate(() => { window.ferrumPlacementViewerSelect(); window.finishPixelUpload(); });
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelBusy === "false" &&
    document.querySelector("[data-pixel-status]").textContent.startsWith("Scene or selection changed"));
  assert.equal(await page.evaluate(() => window.resources.textures.size), beforeUpload);
  assert.equal(await page.locator('[data-placement-browser-asset^="sprite:pixel."]').count(), 0);
  await page.evaluate(() => window.ferrumPlacementViewerSelect("sprite"));
  assert.deepEqual(await snapshot(), original);
  await page.screenshot({ path: resolve(run, mode + "-pixel-editor.png"), fullPage: true });
  await action("apply").click();
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelBusy === "false" &&
    document.querySelector("[data-pixel-status]").textContent.startsWith("Pixel sprite applied"));
  const redState = await snapshot();
  assert.equal(redState.history.undoCount, original.history.undoCount + 1);
  const redScene = mergeScenePlacementPatch(active, redState.state.draftPatch).document;
  const redTexture = redScene.sceneComposition.fragments.main.instances[0].props.components.visual.texture;
  assert(redTexture.startsWith("pixel."));
  for (const field of ["x", "y", "rotationRadians", "scale"])
    assert.equal(redScene.sceneComposition.fragments.main.instances[0][field], active.sceneComposition.fragments.main.instances[0][field]);
  for (const field of ["collider", "body", "layer"])
    assert.deepEqual(redScene.sceneComposition.fragments.main.instances[0].props.components[field],
      active.sceneComposition.fragments.main.instances[0].props.components[field]);
  await color("#0000ff"); await click(0, 0); await action("apply").click();
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelBusy === "false" &&
    window.ferrumPlacementViewerHistory.undoCount >= 2);
  const blueState = await snapshot(), blueScene = mergeScenePlacementPatch(active, blueState.state.draftPatch).document;
  const blueTexture = blueScene.sceneComposition.fragments.main.instances[0].props.components.visual.texture;
  assert.notEqual(blueTexture, redTexture);
  await color("#ff00ff"); await click(0, 0); await action("register").click();
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelBusy === "false" &&
    document.querySelector("[data-pixel-status]").textContent.startsWith("Pixel asset registered"));
  await action("cleanup").click();
  await page.waitForFunction(() => document.querySelector("[data-pixel-status]").textContent.startsWith("Removed 1 revisions"));
  assert.deepEqual(await snapshot(), blueState, "Cleanup must retain both scene/history revisions");
  await action("back").click();
  assert((await native()).blue > 100, "The authored PNG must render in the game");
  await undo(); assert((await native()).red > 100);
  await redo(); assert((await native()).blue > 100);
  const numericScene = structuredClone(blueScene);
  const numericId = await page.evaluate(id => window.ferrumEngine.textureId(id), blueTexture);
  const numericVisual = numericScene.sceneComposition.fragments.main.instances[0].props.components.visual;
  numericVisual.texture = numericId; delete numericVisual.asset;
  assert(!JSON.stringify(numericScene).includes(blueTexture));
  await page.evaluate(components => window.ferrumPlacementViewerUpdateComponents("sprite", components),
    numericScene.sceneComposition.fragments.main.instances[0].props.components);
  const saves = getSaves();
  await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
  assert.equal(getSaves(), saves, "Do not save a scene with session-only textures");
  assert.match(await page.evaluate(() => window.ferrumPlacementViewerLastSaveError), /pixel/i);
  const tabsBefore = await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length);
  await page.locator("[data-placement-document-file]").setInputFiles({
    name: "numeric-other-scene.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(numericScene)),
  });
  await page.waitForFunction(() => document.querySelector(".placement-workspace-message").textContent.includes("another scene"));
  assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), tabsBefore);
  await page.locator('[data-placement-document-key="ferrum:pixel-document"]').click();
  const exported = JSON.parse((await exportFile("export-assets", "-assets.json")).bytes);
  assert.equal(exported.format, "ferrum2d.pixel-assets");
  assert.equal(exported.assets.length, 2);
  assert.equal(exported.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual.texture, blueTexture);
  const png = await exportFile("export-png", "-sprite.png");
  assert(png.bytes.length > 24);
  const source = await exportFile("export-source", "-source.pixel.json");
  await color("#00ff00"); await click(0, 0);
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelDirty === "true");
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
  await page.locator('dialog[open] [data-pixel-action="confirm-cancel"]').click();
  assert(await workspace.isVisible());
  await page.locator('[data-placement-close-document="ferrum:pixel-document"]').click();
  await page.locator('dialog[open] [data-pixel-action="confirm-discard"]').click();
  await page.locator("[data-pixel-file]").setInputFiles(source.path);
  await workspace.waitFor({ state: "visible" });
  assert.equal(JSON.parse((await exportFile("export-source", "-reopened.pixel.json")).bytes).rgba, JSON.parse(source.bytes).rgba);
  await page.locator('[data-placement-edit-pixels="' + blueTexture + '"]').click();
  await page.waitForFunction(() => document.querySelector("#placement-pixel-workspace").dataset.pixelDirty === "true");
  const pngSource = JSON.parse((await exportFile("export-source", "-edited-png.pixel.json")).bytes);
  const pngPixels = Buffer.from(pngSource.rgba, "base64");
  for (let i = 0; i < pngPixels.length; i += 4) assert.deepEqual([...pngPixels.subarray(i, i + 4)], [0, 0, 255, 255]);
  await page.locator("[data-placement-language]").selectOption("ko");
  assert.equal(await action("tool-pencil").textContent(), "연필 (B)");
  await page.setViewportSize({ width: 720, height: 840 });
  await page.waitForFunction(() => document.querySelector(".demo-shell").dataset.compact === "true");
  assert(await workspace.evaluate(e => e.scrollWidth <= e.clientWidth + 1), "Pixel editor must fit compact widths");
  await page.screenshot({ path: resolve(run, mode + "-pixel-editor-ko-compact.png"), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-placement-language]").selectOption("en");
  setResume(exported);
  const fresh = await page.context().newPage();
  const failures = [];
  fresh.on("pageerror", error => failures.push(error.stack ?? String(error)));
  fresh.on("requestfailed", request => failures.push(request.url() + " " + request.failure()?.errorText));
  let report;
  try {
    await fresh.goto(origin + "/resume.html");
    await fresh.waitForFunction(() => window.report || window.failure, undefined, { polling: 50 }).catch(async error => {
      throw Error(String(error) + "\nFresh runtime: " + JSON.stringify(failures) + "\nStage: " +
        await fresh.evaluate(() => window.pixelResumeStage ?? document.body.innerHTML));
    });
    report = await fresh.evaluate(() => { if (window.failure) throw Error(window.failure); return window.report; });
    assert(report.bluePixels > 100, "Fresh runtime must show the exported blue sprite");
    assert.equal(report.state, 3); assert.equal(report.entities, 1);
    assert(report.drawCalls > 0 && report.drawCalls <= 16);
    const bad = structuredClone(exported);
    bad.manifest.textures[bad.assets[0].id] = "wrong.png"; setResume(bad);
    const invalid = await page.context().newPage();
    try {
      await invalid.goto(origin + "/resume.html");
      await invalid.waitForFunction(() => window.failure, undefined, { polling: 50 });
      assert.match(await invalid.evaluate(() => window.failure), /Pixel manifest differs/);
    } finally { await invalid.close(); setResume(exported); }
  } finally { await fresh.close(); }
  return {
    createdWithoutExternalTool: true, continuousStroke: true, cancellation: true,
    independentUndo: true, sceneUndoRedo: true, sourceReopen: true, locale: true,
    eyedropper: true, eraserUndo: true, panZoom: true, invalidSourcePreserved: true, editAssetPng: true, compact: true,
    releaseEndpoint: true, blurCancelsStroke: true, blurResetsPan: true,
    staleReadCloseRace: true, provisionalRollback: true,
    numericSaveGuard: true, numericCrossSceneGuard: true, numericPortableExport: true, manifestNegative: true,
    pixelDirtyUpdateGuard: true,
    alphaInputGuard: true,
    revisionsPreserved: 2, sessionSaveGuard: true, freshRuntime: report,
  };
}
