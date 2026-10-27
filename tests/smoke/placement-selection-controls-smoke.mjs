import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** Small sprites must have legible, attached controls rather than unexplained collision marks. */
export async function smokePlacementSelectionControls(parent, timeoutMs = 30000) {
  const output = "artifacts/2d-selection-controls";
  await mkdir(output, { recursive: true });
  const results = [];
  for (const dpr of [1, 2]) {
    const page = await parent.context().browser().newPage({ viewport: { width: 1110, height: 920 }, deviceScaleFactor: dpr });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
    const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const snapshot = () => page.evaluate(() => {
      const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const root = document.querySelector(".placement-transform-gizmo");
      return { canvas: rect(document.querySelector("canvas.demo-canvas")), visual: rect(document.querySelector(".placement-selection")), tools: rect(root),
        hidden: root.hidden, caption: root.querySelector(".placement-transform-caption").textContent,
        collider: document.querySelector(".placement-collider-overlay").dataset.visible,
        history: window.ferrumPlacementViewerHistory, selected: window.ferrumPlacementViewerState.selectedInstanceId,
        patch: window.ferrumPlacementViewerExportPatch() ?? null };
    });
    const inside = sample => {
      assert(!sample.hidden);
      assert(sample.tools.left >= sample.canvas.left && sample.tools.top >= sample.canvas.top);
      assert(sample.tools.right <= sample.canvas.right + 1 && sample.tools.bottom <= sample.canvas.bottom + 1);
    };
    const undo = async () => { await page.locator('[data-placement-action="undo"]').click(); await wait(() => !window.ferrumPlacementViewerHistory.transactionLabel && !window.ferrumPlacementViewerExportPatch()); };
    try {
      await page.goto(new URL("?scene=garden", parent.url()).href, { waitUntil: "networkidle" });
      await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465);
      await page.locator("[data-placement-language]").selectOption("ko");
      await page.locator("[data-placement-viewport-expand]").click(); await paint();
      await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("Home"); await paint();
      const point = await page.evaluate(() => {
        const state = window.ferrumPlacementViewerState, actor = state.instances.find(i => i.instanceId === "garden_lantern_3");
        const r = document.querySelector("canvas.demo-canvas").getBoundingClientRect();
        return { x: r.left + (actor.transform.x - state.viewport.worldMinX) * state.viewport.zoom,
          y: r.top + (actor.transform.y - actor.visual.height / 2 - state.viewport.worldMinY) * state.viewport.zoom };
      });
      await page.mouse.click(point.x, point.y);
      await wait(() => window.ferrumPlacementViewerState.selectedInstanceId === "garden_lantern_3");
      await wait(() => !window.ferrumPlacementViewerHistory.transactionLabel);
      const initial = await snapshot(); inside(initial);
      assert.equal(initial.collider, "false"); assert.equal(initial.patch, null);
      assert(initial.caption.includes("garden_lantern_3"));
      assert(initial.tools.bottom <= initial.visual.top || initial.tools.top >= initial.visual.bottom, "Controls should sit outside a small sprite");
      const rotate = page.locator('[data-placement-transform-gizmo="rotate"]'), scale = page.locator('[data-placement-transform-gizmo="scale"]');
      assert.match(await rotate.textContent(), /회전.*0°/); assert.match(await scale.textContent(), /크기.*100%/);
      await page.screenshot({ path: `${output}/lantern-ko-dpr${dpr}.png`, fullPage: true });
      await showPlacementViewOptions(page);
      await page.locator("[data-placement-collider-bounds]").check(); await page.keyboard.press("Escape");
      const collision = await snapshot(); assert.equal(collision.collider, "true"); assert.deepEqual(collision.history, initial.history); assert.equal(collision.patch, null);
      assert.equal(await page.locator(".placement-collider-caption").textContent(), "충돌 영역");
      assert(await page.locator("[data-placement-collider-offset-handle] svg").isVisible());
      await page.screenshot({ path: `${output}/collision-ko-dpr${dpr}.png`, fullPage: true });
      await showPlacementViewOptions(page); await page.locator("[data-placement-collider-bounds]").uncheck(); await page.keyboard.press("Escape");
      const handle = await rotate.boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 + 30, handle.y + handle.height / 2, { steps: 4 }); await page.mouse.up();
      await wait(() => Math.abs(window.ferrumPlacementViewerState.selected.transform.rotationRadians - Math.PI / 6) < 1e-6);
      await wait(() => window.ferrumPlacementViewerHistory.undoCount === 1 && !window.ferrumPlacementViewerHistory.transactionLabel); await undo();
      await rotate.focus(); await page.keyboard.press("ArrowRight");
      await wait(() => Math.abs(window.ferrumPlacementViewerState.selected.transform.rotationRadians - Math.PI / 12) < 1e-6);
      inside(await snapshot());
      assert.equal(await page.locator(".placement-transform-caption").evaluate(element => getComputedStyle(element).transform), "none");
      await undo(); await scale.focus(); await page.keyboard.press("ArrowRight");
      await wait(() => Math.abs(window.ferrumPlacementViewerState.selected.transform.scale - 1.1) < 1e-6); await undo();
      await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("h");
      assert((await snapshot()).hidden, "Pan must hide editing actions"); await page.keyboard.press("v"); inside(await snapshot());
      await page.keyboard.down("Space"); assert((await snapshot()).hidden); await page.keyboard.up("Space"); inside(await snapshot());
      await page.locator('[data-placement-selection-action="lock"]').click();
      assert(!await rotate.isVisible() && !await scale.isVisible()); assert.match(await page.locator(".placement-transform-hint").textContent(), /잠금/);
      await page.locator('[data-placement-selection-action="unlock"]').click();
      // Real pan moves the sprite against and then outside the right canvas edge.
      await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("h");
      const beforePan = await snapshot(), x = (beforePan.canvas.left + beforePan.canvas.right) / 2, y = beforePan.canvas.top + 40;
      const dx = beforePan.canvas.right - beforePan.visual.left - 6;
      await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 5 }); await page.mouse.up(); await page.keyboard.press("v");
      const edge = await snapshot(); inside(edge);
      const edgeRotate = await rotate.boundingBox();
      await page.mouse.move(edgeRotate.x + edgeRotate.width / 2, edgeRotate.y + edgeRotate.height / 2);
      await page.mouse.down(); await page.mouse.move(edgeRotate.x + edgeRotate.width / 2 + 90, edgeRotate.y + edgeRotate.height / 2, { steps: 4 });
      const captured = await snapshot();
      assert(captured.visual.left >= captured.canvas.right, "Probe must rotate the clipped sprite fully offscreen");
      inside(captured); // Pointer capture must survive until release or cancellation.
      await page.keyboard.press("Escape"); await page.mouse.up(); await paint(); inside(await snapshot());
      assert.equal((await snapshot()).patch, null);
      await page.keyboard.press("h"); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y, { steps: 4 }); await page.mouse.up(); await page.keyboard.press("v");
      assert((await snapshot()).hidden, "Fully offscreen objects must not leave floating controls");
      await page.keyboard.press("Home"); await paint(); inside(await snapshot());
      await page.locator("[data-placement-language]").selectOption("en"); await paint();
      assert.match(await rotate.textContent(), /Rotate/); assert.match(await scale.textContent(), /Scale/);
      await page.screenshot({ path: `${output}/lantern-en-dpr${dpr}.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 500 }); await paint();
      await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("f"); await paint(); inside(await snapshot());
      await page.screenshot({ path: `${output}/compact-dpr${dpr}.png`, fullPage: true });
      await page.locator("[data-placement-playback=play]").click(); assert(!await rotate.isVisible());
      await page.locator("[data-placement-playback=stop]").click(); await paint(); inside(await snapshot());
      const canvas = await page.locator("canvas.demo-canvas").boundingBox(); await page.mouse.click(canvas.x + 2, canvas.y + 2);
      await wait(() => window.ferrumPlacementViewerState.selectedInstanceIds.length === 0); assert((await snapshot()).hidden);
      const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
      assert.equal(await page.evaluate(() => window.ferrumPlacementViewerRuntimeFrame.entityCount), 465);
      assert(stats.drawCalls > 0 && stats.drawCalls <= 64); assert.equal(stats.pointLightCount, 4);
      if (dpr === 1) {
        await page.locator("[data-placement-language]").selectOption("ko");
        const source = { format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
          sceneComposition: { initialFragment: "main", prefabs: { item: { props: { components: {
            visual: { kind: "primitive", shape: "rect", width: 24, height: 24 }, collider: "none", layer: "wall" } } } },
            fragments: { main: { instances: [{ id: "Rotate", prefab: "item", x: 800, y: 450 }] } } } };
        await page.locator("[data-placement-document-file]").setInputFiles({ name: "raw-name.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(source)) });
        await wait(() => window.ferrumPlacementViewerState.selectedInstanceId === "Rotate");
        await page.locator("canvas.demo-canvas").focus(); await page.keyboard.press("Home"); await paint();
        assert.equal(await page.locator(".placement-transform-caption").textContent(), "Rotate", "Object IDs must never be translated as UI messages");
      }
      assert.deepEqual(errors, []);
      results.push({ dpr, initial, collision, edge, captured, stats, checks: ["small sprite bounds and legible actions", "explicit collider display without document edits", "trusted horizontal rotation drag and one Undo", "keyboard rotation and scale with Undo", "horizontal caption", "pan and Space", "locks", "edge clamp and offscreen hiding", "active offscreen drag and Escape restore", "both locales and raw object IDs", "compact bounds", "Play/Stop", "blank deselection"], errors });
    } catch (error) { await page.screenshot({ path: `${output}/failure-dpr${dpr}.png`, fullPage: true }); throw error; }
    finally { await page.close(); }
  }
  await writeFile(`${output}/report.json`, JSON.stringify({ ok: true, results }, null, 2) + "\n");
  return results;
}
