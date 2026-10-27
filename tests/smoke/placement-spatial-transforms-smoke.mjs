import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Actual village background overlap and public transform controls, with native rendering. */
export async function smokePlacementSpatialTransforms(parent, timeoutMs) {
  const artifact = "artifacts/spatial-transform-fix";
  await mkdir(artifact, { recursive: true });
  const results = [];
  for (const [projection, dpr] of [["orthographic", 1], ["perspective", 2]]) {
    console.log(`Spatial transforms: ${projection}, DPR ${dpr}`);
    const page = await parent.context().browser().newPage({
      viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr,
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const paint = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const source = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
    const history = () => page.evaluate(() => window.ferrumPlacementViewerHistory);
    const camera = () => page.evaluate(() => window.ferrumPlacementSpatialCamera);
    const field = name => page.locator(`[data-placement-spatial-field="${name}"]`);
    const heightIcon = page.locator("[data-placement-spatial-height]"),
      rotateIcon = page.locator("[data-placement-spatial-rotate]"),
      tools = page.locator(".placement-spatial-transform-tools");
    const dragIcon = async (icon, dx, dy, { shift = false, cancel = false, loseCapture = false, clearsPlacement = false } = {}) => {
      const original = clearsPlacement ? await source() : undefined;
      const box = await icon.boundingBox();
      assert(box, "The transform icon must be visible");
      if (shift) await page.keyboard.down("Shift");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      if (clearsPlacement) {
        assert.equal(await page.locator(".placement-tool-readout").getAttribute("data-active"), "false",
          "Starting an object transform must exit pending asset placement");
        assert.equal(await page.locator("[data-placement-spatial-place]").getAttribute("aria-pressed"), "false");
        assert(await page.locator("[data-placement-spatial-add-preview]").isHidden());
      }
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 6 });
      await paint();
      if (clearsPlacement) {
        assert.notDeepEqual(await source(), original, "The pending-placement transform must actually modify the draft before cancellation");
        assert.equal((await history()).transactionLabel,
          await icon.getAttribute("data-placement-spatial-rotate") ? "Spatial Rotation" : "Spatial Height");
      }
      if (cancel) await page.keyboard.press("Escape");
      if (loseCapture) await icon.evaluate(node => node.releasePointerCapture(1));
      await paint();
      await page.mouse.up();
      if (shift) await page.keyboard.up("Shift");
      await paint();
    };
    const select = async target => {
      await page.locator("[data-placement-spatial-target]").selectOption(target);
      await paint();
    };
    const numeric = async (name, value) => {
      assert(await field(name).isVisible() && await field(name).isEnabled(), `${name} must be editable`);
      await field(name).fill(String(value)); await field(name).press("Tab"); await paint();
    };
    try {
      const url = new URL(parent.url()); url.search = "?scene=village";
      await page.goto(url.href, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.spatial?.modelDraws === 42, undefined, { timeout: timeoutMs });
      await page.locator("[data-placement-language]").selectOption("en");
      const document = await source();
      document.spatial.camera.projection = projection;
      if (projection === "perspective") {
        delete document.spatial.camera.height;
        document.spatial.camera.fovDegrees = 55;
      }
      // Optional model fields must remain editable at their native defaults.
      for (const name of ["yawDegrees", "scale", "elevation"]) delete document.spatial.models.west_cottage[name];
      await page.locator("[data-placement-document-file]").setInputFiles({
        name: `village-transforms-${projection}.json`, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(document)),
      });
      await page.waitForFunction(projection => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementSpatialCamera?.projection === projection && !window.document.querySelector(".demo-shell").inert, projection, { timeout: timeoutMs });
      await showPlacementInspector(page);
      await select("model:west_cottage");
      assert.equal(await field("yaw").inputValue(), "0");
      assert.equal(await field("scale").inputValue(), "1");
      assert.equal(await field("offset").inputValue(), "0");
      const beforeDeselect = JSON.stringify({ document: await source(), history: await history(), camera: await camera() });
      const blank = await page.locator("canvas.demo-canvas").boundingBox();
      const empty = { x: blank.x + 24, y: blank.y + blank.height - 24 };
      for (const target of ["model:west_cottage", "billboard:village_hero", "surface:west_bank"]) {
        await select(target);
        await page.mouse.click(empty.x, empty.y);
        await page.waitForFunction(() => !window.ferrumPlacementSpatialTarget && !window.ferrumPlacementSpatialSelection && window.ferrumPlacementViewerState.selectedInstanceIds.length === 0, undefined, { timeout: timeoutMs });
        assert(await page.locator(".placement-spatial-selection").isHidden());
        assert(await page.locator(".placement-spatial-height").isHidden());
        assert(await tools.isHidden());
        assert.equal(await page.locator("[data-placement-spatial-field]:visible").count(), 0);
        assert.equal(await page.locator("[data-placement-spatial-target]").inputValue(), "");
        assert.equal(await page.locator("[data-placement-spatial-target] option:checked").textContent(), "No selection");
        assert(await page.locator(".placement-spatial-object-actions").isHidden());
        assert.equal(await page.locator("button[data-instance-id][data-selected=true]:visible").count(), 0);
        assert.equal(JSON.stringify({ document: await source(), history: await history(), camera: await camera() }), beforeDeselect);
      }
      await page.screenshot({ path: `${artifact}/empty-${projection}-dpr${dpr}.png`, fullPage: true });
      await select("model:west_cottage");
      await page.locator("[data-placement-spatial-navigation=pan]").click();
      assert(await tools.isHidden(), "Pan hides both transform icons");
      await page.mouse.click(empty.x, empty.y);
      assert.equal(await page.evaluate(() => window.ferrumPlacementSpatialTarget?.id), "west_cottage", "Pan must preserve object selection");
      await page.locator("[data-placement-spatial-navigation=select]").click();
      const beforeVisibility = JSON.stringify({ document: await source(), history: await history() });
      const selectionBounds = () => page.evaluate(() => {
        const { bounds, canvas } = window.ferrumPlacementSpatialSelection;
        return { left: Math.min(...bounds.map(p => p.x)), right: Math.max(...bounds.map(p => p.x)),
          top: Math.min(...bounds.map(p => p.y)), bottom: Math.max(...bounds.map(p => p.y)), canvas };
      });
      const pan = async (dx, dy) => {
        await page.locator("[data-placement-spatial-navigation=pan]").click();
        const box = await page.locator("canvas.demo-canvas").boundingBox(),
          x = box.x + box.width / 2, y = box.y + box.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
        await page.locator("[data-placement-spatial-navigation=select]").click();
        await paint();
        assert.equal(await page.evaluate(() => window.ferrumPlacementSpatialTarget?.id), "west_cottage");
        assert.equal(JSON.stringify({ document: await source(), history: await history() }), beforeVisibility);
      };
      const initialBounds = await selectionBounds(),
        partialShift = initialBounds.canvas.left - (initialBounds.left + initialBounds.right) / 2;
      await pan(partialShift, 0);
      const partialBounds = await selectionBounds();
      assert(partialBounds.left < partialBounds.canvas.left && partialBounds.right > partialBounds.canvas.left,
        "The selected house must straddle the viewport edge");
      assert(await tools.isVisible(), "A partially visible selection retains its transform icons");
      const partialTools = await tools.boundingBox();
      assert(partialTools.x >= partialBounds.canvas.left &&
        partialTools.x + partialTools.width <= partialBounds.canvas.left + partialBounds.canvas.width,
        "Partially clipped selection icons remain inside the viewport");
      await page.screenshot({ path: `${artifact}/partial-icons-${projection}-dpr${dpr}.png`, fullPage: true });
      await pan(-2 * initialBounds.canvas.width, 0);
      const outsideLeft = await selectionBounds();
      assert(outsideLeft.right < outsideLeft.canvas.left, "The house must be entirely outside the left edge");
      assert(await tools.isHidden(), "An offscreen selection must not leave floating edit icons");
      await page.screenshot({ path: `${artifact}/offscreen-icons-${projection}-dpr${dpr}.png`, fullPage: true });
      await pan(2 * initialBounds.canvas.width - partialShift, 0);
      assert(await tools.isVisible(), "Icons return when the selected house re-enters the viewport");
      await pan(2 * initialBounds.canvas.width, 0);
      const outsideRight = await selectionBounds();
      assert(outsideRight.left > outsideRight.canvas.left + outsideRight.canvas.width,
        "The house must be entirely outside the right edge");
      assert(await tools.isHidden(), "Panning beyond either edge must hide selection icons");
      await pan(-2 * initialBounds.canvas.width, 0);
      assert(await tools.isVisible());
      const restoredBounds = await selectionBounds();
      for (const axis of ["left", "right", "top", "bottom"])
        assert(Math.abs(restoredBounds[axis] - initialBounds[axis]) < 0.1, "Reverse panning restores the selected house on screen");
      for (const [icon, dx, dy] of [[rotateIcon, 30, 0], [heightIcon, 0, -24]]) {
        const beforePlacementTransform = JSON.stringify({ document: await source(), history: await history(), camera: await camera(),
          selected: await page.evaluate(() => window.ferrumPlacementSpatialTarget) });
        await showPlacementInspector(page, "placement");
        await page.locator("[data-placement-spatial-place]").click();
        assert.equal(await page.locator(".placement-tool-readout").getAttribute("data-active"), "true");
        await showPlacementInspector(page, "properties");
        await dragIcon(icon, dx, dy, { cancel: true, clearsPlacement: true });
        assert.equal(JSON.stringify({ document: await source(), history: await history(), camera: await camera(),
          selected: await page.evaluate(() => window.ferrumPlacementSpatialTarget) }), beforePlacementTransform,
          "One Escape must restore the whole transform after replacing pending placement");
        assert.equal(await page.locator(".placement-tool-readout").getAttribute("data-active"), "false");
      }
      const baseline = await source(), originalCamera = await camera();
      const point = await page.evaluate(() => {
        const instance = window.ferrumPlacementViewerState.selected;
        return window.ferrumPlacementSpatialProject({ x: instance.transform.x, y: instance.transform.y, elevation: 35 });
      });
      await page.mouse.click(point.x, point.y, { button: "right" });
      const candidates = await page.locator("[data-placement-pick-candidate]").evaluateAll(nodes => nodes.map(node => node.dataset.placementPickCandidate));
      assert.equal(candidates[0], "west_cottage", "Background bounds must not win over the foreground house");
      assert(candidates.includes("village_landscape"), "Background remains available in overlap candidates");
      await page.locator("[data-placement-pick-candidate=west_cottage]").click();
      await page.mouse.move(point.x, point.y); await page.mouse.down();
      await page.mouse.move(point.x + 40, point.y + 12, { steps: 6 }); await page.mouse.up();
      await page.waitForFunction(() => window.ferrumPlacementViewerHistory.undoCount === 1 && !window.ferrumPlacementViewerHistory.transactionLabel, undefined, { timeout: timeoutMs });
      assert.equal(await page.evaluate(() => window.ferrumPlacementSpatialTarget.id), "west_cottage");
      const moved = await source();
      const instances = doc => doc.sceneComposition.fragments.village.instances;
      const instance = (doc, id) => instances(doc).find(item => item.id === id);
      assert.deepEqual(instance(moved, "village_landscape"), instance(baseline, "village_landscape"));
      assert.notDeepEqual(instance(moved, "west_cottage"), instance(baseline, "west_cottage"));
      assert.deepEqual(await camera(), originalCamera);
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), baseline);
      await page.locator("[data-placement-action=redo]").click(); await paint();
      assert.deepEqual(await source(), moved);
      await numeric("yaw", 35); await numeric("scale", 1.25);
      const modelEdited = await source();
      assert.equal(modelEdited.spatial.models.west_cottage.yawDegrees, 35);
      assert.equal(modelEdited.spatial.models.west_cottage.scale, 1.25);
      assert.deepEqual(instance(modelEdited, "west_cottage").props, instance(moved, "west_cottage").props, "Model style rotation/scale must preserve collision components");
      assert(await heightIcon.isEnabled() && await rotateIcon.isEnabled());
      for (const icon of [heightIcon, rotateIcon]) {
        assert.equal(await icon.locator("svg[aria-hidden=true]").count(), 1);
        assert(await icon.getAttribute("aria-label"));
        const box = await icon.boundingBox(), viewport = await page.locator("canvas.demo-canvas").boundingBox();
        assert(box.x >= viewport.x && box.x + box.width <= viewport.x + viewport.width);
        assert(box.y >= viewport.y && box.y + box.height <= viewport.y + viewport.height);
      }
      const iconHistory = await history();
      await dragIcon(rotateIcon, 37, 0, { shift: true });
      const iconRotated = await source();
      assert.equal(iconRotated.spatial.models.west_cottage.yawDegrees, 75, "Shift snaps model yaw to 15 degrees");
      assert.equal((await history()).undoCount, iconHistory.undoCount + 1, "A rotation drag makes exactly one Undo entry");
      assert.deepEqual(instance(iconRotated, "west_cottage"), instance(modelEdited, "west_cottage"), "Model yaw must preserve authored transform and collision components");
      assert.deepEqual(await camera(), originalCamera);
      assert(await page.evaluate(() => window.ferrumRuntime.renderer.stats().drawCalls > 0), "Native scene rendering must continue after rotation");
      await page.screenshot({ path: `${artifact}/rotation-icons-${projection}-dpr${dpr}.png`, fullPage: true });
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), modelEdited);
      await page.locator("[data-placement-action=redo]").click(); await paint();
      assert.deepEqual(await source(), iconRotated);
      const beforeCancel = await history();
      await dragIcon(rotateIcon, -43, 0, { cancel: true });
      assert.deepEqual(await source(), iconRotated);
      assert.deepEqual(await history(), beforeCancel, "Escape must restore the draft and history");
      await dragIcon(rotateIcon, 28, 0, { loseCapture: true });
      assert.deepEqual(await source(), iconRotated);
      assert.deepEqual(await history(), beforeCancel, "Lost pointer capture must cancel rotation");
      await rotateIcon.press("Shift+ArrowRight"); await paint();
      assert.equal((await source()).spatial.models.west_cottage.yawDegrees, 90);
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), iconRotated);
      const beforeHeight = await source();
      await heightIcon.press("ArrowUp"); await paint();
      assert.equal(instance(await source(), "west_cottage").props.components.body.heightSpan.elevation,
        instance(beforeHeight, "west_cottage").props.components.body.heightSpan.elevation + 1);
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), beforeHeight);
      await dragIcon(heightIcon, 0, -24);
      assert.notEqual(instance(await source(), "west_cottage").props.components.body.heightSpan.elevation,
        instance(beforeHeight, "west_cottage").props.components.body.heightSpan.elevation);
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), beforeHeight);
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), modelEdited);
      await select("surface:west_bank");
      assert(await rotateIcon.isDisabled());
      assert.match(await rotateIcon.getAttribute("title"), /cannot rotate/);
      assert(await heightIcon.isEnabled());
      await select("billboard:village_hero");
      assert(await field("yaw").isDisabled(), "The WASD controller requires an unrotated player AABB");
      assert(await rotateIcon.isDisabled());
      assert.match(await rotateIcon.getAttribute("title"), /unrotated AABB/);
      assert(await field("x").isEnabled() && await field("scale").isEnabled());
      assert.match(await page.locator(".placement-spatial-edit-hint").textContent(), /unrotated AABB/);
      await select("billboard:shopkeeper");
      await page.evaluate(() => {
        const renderer = window.ferrumRuntime.renderer, original = renderer.renderCommands;
        renderer.renderCommands = function (...args) {
          const spatial = (args[1] ?? args[0]).spatial;
          if (spatial) window.__transformBillboardVertices = Array.from(spatial.billboards).filter((_, i) => i % 11 < 3);
          return original.apply(this, args);
        };
      });
      await paint();
      // Both locales expose the same live, accessible fields after target changes.
      await page.locator("[data-placement-language]").selectOption("ko");
      assert.match(await field("yaw").getAttribute("type"), /number/);
      assert.match(await field("yaw").locator("..").textContent(), /스프라이트 회전/);
      const originalVertices = await page.evaluate(() => window.__transformBillboardVertices);
      const beforeSprite = await source();
      const beforeHistory = (await history()).undoCount;
      await numeric("yaw", 45); await numeric("scale", 1.5);
      const spriteEdited = await source();
      assert.equal(instance(spriteEdited, "shopkeeper").rotationRadians, Math.PI / 4);
      assert.equal(instance(spriteEdited, "shopkeeper").scale, 1.5);
      assert.deepEqual(spriteEdited.spatial.billboards, beforeSprite.spatial.billboards);
      assert.equal((await history()).undoCount, beforeHistory + 2);
      const editedVertices = await page.evaluate(() => window.__transformBillboardVertices);
      assert.notDeepEqual(editedVertices, originalVertices, "Authored sprite edits must reach native billboard vertices");
      assert.equal(await rotateIcon.getAttribute("aria-label"), "오브젝트 회전");
      assert.equal(await heightIcon.getAttribute("aria-label"), "높이");
      await dragIcon(rotateIcon, 30, 0);
      assert(Math.abs(instance(await source(), "shopkeeper").rotationRadians - 75 * Math.PI / 180) < 1e-10);
      assert.equal((await history()).undoCount, beforeHistory + 3);
      assert.notDeepEqual(await page.evaluate(() => window.__transformBillboardVertices), editedVertices, "The rotation icon must change actual native billboard geometry");
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), spriteEdited);
      await page.locator("[data-placement-action=undo]").click();
      await page.locator("[data-placement-action=undo]").click(); await paint();
      assert.deepEqual(await source(), beforeSprite);
      await page.locator("[data-placement-action=redo]").click();
      await page.locator("[data-placement-action=redo]").click(); await paint();
      assert.deepEqual(await source(), spriteEdited);
      await page.screenshot({ path: `${artifact}/${projection}-dpr${dpr}.png`, fullPage: true });
      await numeric("scale", 0);
      assert.deepEqual(await source(), spriteEdited, "Invalid scale must restore the draft");
      assert.equal((await history()).undoCount, beforeHistory + 2);
      await page.locator('[data-placement-lock-instance="shopkeeper"]:visible').click();
      assert(await tools.isHidden());
      for (const name of ["x", "y", "yaw", "scale"]) assert(await field(name).isDisabled());
      await page.locator('[data-placement-lock-instance="shopkeeper"]:visible').click();
      for (const name of ["x", "y", "yaw", "scale"]) assert(await field(name).isEnabled());
      await page.locator("[data-placement-mode=game]").click(); await paint();
      assert(await tools.isHidden());
      await page.locator("[data-placement-playback=stop]").click(); await paint();
      assert.deepEqual(await source(), spriteEdited);
      assert.deepEqual(await camera(), originalCamera);
      assert.equal(await field("yaw").inputValue(), "45");
      assert.equal(await field("scale").inputValue(), "1.5");
      assert.deepEqual(errors, []);
      results.push({ projection, dpr, emptyClickClearsObjectAndSurface: true, deselectPreservesDocumentHistoryCamera: true, panPreservesSelection: true, partialSelectionToolsClamp: true, offscreenToolsHideAndRestore: true, offscreenPanPreservesDocumentHistorySelection: true, transformsReplacePendingPlacement: true, singleEscapeRestoresPlacementTransform: true, foregroundDrag: true, overlapDepth: true, optionalDefaults: true, modelAndSpriteTransforms: true, iconModelAndSpriteRotation: true, iconHeightDrag: true, shiftAngleSnap: true, keyboardIcons: true, escapeAndLostCaptureRollback: true, constrainedRotationDisabled: true, nativeVerticesChanged: true, undoRedo: true, invalidScaleRollback: true, lock: true, previewRestore: true });
    } catch (error) {
      await writeFile(`${artifact}/failure-${projection}.json`, JSON.stringify(await page.evaluate(() => ({ document: window.ferrumPlacementSpatialExportDocument(), selected: window.ferrumPlacementViewerState.selected, target: window.ferrumPlacementSpatialTarget, history: window.ferrumPlacementViewerHistory, message: window.document.querySelector('.placement-spatial-message')?.textContent })), null, 2));
      await page.screenshot({ path: `${artifact}/failure-${projection}.png`, fullPage: true });
      throw error;
    } finally { await page.close(); }
  }
  await writeFile(`${artifact}/verification.json`, JSON.stringify(results, null, 2) + "\n");
  return results;
}
