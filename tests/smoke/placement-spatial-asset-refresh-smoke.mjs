import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Real app/runtime with the public desktop host contract and revisioned PNGs. */
export async function smokePlacementSpatialAssetRefresh(parent, source, timeoutMs) {
  const directory = "artifacts/spatial-asset-refresh";
  await mkdir(directory, { recursive: true });
  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 960 } });
  const images = await Promise.all([
    readFile("apps/placement-viewer/public/assets/rpg-village/grass.png"),
    readFile("apps/placement-viewer/public/assets/rpg-village/hero.png"),
  ]);
  const document = structuredClone(source);
  delete document.spatial.models;
  const errors = [], requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const paint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.route("**/__ferrum-refresh-*.png*", async (route) => {
    const url = new URL(route.request().url());
    requests.push({ url: url.href, type: route.request().resourceType() });
    await route.fulfill({ body: images[url.searchParams.get("revision") === "v2" ? 1 : 0],
      contentType: "image/png", headers: { "Cache-Control": "no-store" } });
  });
  await page.addInitScript(({ document }) => {
    window.refreshRevision = "v1";
    window.otherRevision = "v1";
    window.__TAURI__ = { core: { async invoke(command, args) {
      if (command === "load_placement_scene_document")
        return { path: "/tmp/ferrum-refresh/scene.json", document: structuredClone(document) };
      if (command === "inspect_placement_asset_folder")
        return { assetFolderPath: args.assetFolderPath, exists: true, imageCount: 2,
          images: ["refresh", "other"].map((name) => ({ id: name + "_sprite", fileName: name + "_sprite.png",
            path: "/tmp/ferrum-refresh/assets/" + name + "_sprite.png",
            runtimeUrl: new URL("/__ferrum-refresh-" + name + ".png", location.href).href,
            contentRevision: name === "refresh" ? window.refreshRevision : window.otherRevision })), diagnostics: [] };
      if (command === "save_placement_agent_handoff")
        return { path: "/tmp/ferrum-refresh/handoff.json", handoff: args.handoff };
      throw new Error("Unexpected asset refresh command: " + command);
    } } };
  }, { document });
  const snapshot = () => page.evaluate(() => JSON.stringify({
    document: window.ferrumPlacementSpatialExportDocument(), history: window.ferrumPlacementViewerHistory,
    camera: window.ferrumPlacementSpatialCamera,
  }));
  const pending = () => page.locator(".placement-tool-readout").getAttribute("data-active");
  const refresh = async (selectedRevision, otherRevision) => {
    await page.evaluate(({ selectedRevision, otherRevision }) => {
      window.refreshRevision = selectedRevision;
      window.otherRevision = otherRevision;
      return window.ferrumPlacementViewerOpenAssetFolder("/tmp/ferrum-refresh/assets");
    }, { selectedRevision, otherRevision });
    await wait(() => window.ferrumPlacementViewerDesktop.assetFolderRuntimeStatus === "ready");
    await paint();
  };
  try {
    await page.goto(new URL(parent.url()).origin, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementSpatialCamera);
    await page.locator("[data-placement-language]").selectOption("en");
    await refresh("v1", "v1");
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-spatial-add-asset]").selectOption("refresh_sprite");
    await page.locator("[data-placement-spatial-basis]").selectOption("plane");
    const place = page.locator("[data-placement-spatial-place]");
    const preview = page.locator("[data-placement-spatial-asset-preview]");
    const image = preview.locator("img");
    const canvas = page.locator("canvas.demo-canvas");
    const count = await page.evaluate(() => window.ferrumPlacementViewerState.instances.length);
    const before = await snapshot();
    await place.click();
    assert.equal(await pending(), "true");
    await refresh("v1", "v2");
    assert.equal(await pending(), "true", "An unrelated image update cancelled placement");
    await refresh("v2", "v2");
    assert.equal(await pending(), "false", "Selected image revision must invalidate placement");
    assert.match(await image.getAttribute("src"), /revision=v2/);
    assert.equal(await snapshot(), before, "Asset refresh changed authored data, history or camera");
    assert(await page.locator("[data-placement-spatial-add-preview]").isHidden());

    const point = await page.evaluate(() => window.ferrumPlacementSpatialProject({ x: 0, y: 0, elevation: 0 }));
    assert(point?.visible);
    await page.mouse.click(point.x, point.y);
    await paint();
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.instances.length), count,
      "An invalidated placement still added an object");
    await place.click();
    await page.mouse.click(point.x, point.y);
    await wait((count) => window.ferrumPlacementViewerState.instances.length === count + 1, count);
    const placed = await page.evaluate(() => {
      const selected = window.ferrumPlacementViewerState.selected;
      return { width: selected.visual.width, height: selected.visual.height,
        asset: selected.visual.texture.name, undo: window.ferrumPlacementViewerHistory.undoCount };
    });
    assert.deepEqual(placed, { width: 128, height: 192, asset: "refresh_sprite", undo: 1 });
    await page.locator('[data-placement-action="undo"]').click();
    await wait((count) => window.ferrumPlacementViewerState.instances.length === count, count);

    // A drag owns a frozen asset too. Its old token must not place after reload.
    await preview.evaluate((element) => {
      window.refreshDrag = new DataTransfer();
      element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: window.refreshDrag }));
    });
    assert.equal(await pending(), "true");
    await refresh("v3", "v2");
    assert.equal(await pending(), "false");
    await canvas.evaluate((element, point) => element.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, dataTransfer: window.refreshDrag,
    })), point);
    await paint();
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.instances.length), count,
      "A stale drag token placed the old image");
    const after = await page.evaluate(() => ({
      document: JSON.stringify(window.ferrumPlacementSpatialExportDocument()),
      entities: window.ferrumPlacementViewerRuntimeFrame.entityCount,
      stats: window.ferrumRuntime.renderer.stats(),
    }));
    assert.equal(after.document, JSON.stringify(JSON.parse(before).document));
    assert.equal(after.entities, count);
    assert(after.stats.drawCalls > 0 && after.stats.drawCalls <= 160);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${directory}/refreshed.png`, fullPage: true });
    await writeFile(`${directory}/verification.json`, JSON.stringify({ ok: true, placed, requests, entities: after.entities,
      stats: after.stats, checks: ["selected revision cancels placement", "unrelated revision preserves placement", "thumbnail updated",
        "cancelled click adds nothing", "rearmed placement uses 128x192", "Undo restores document", "stale drag cancelled", "native entity/draw evidence"],
    }, null, 2) + "\n");
    return { selectedRevisionInvalidates: true, unrelatedRevisionPreserved: true, currentSize: [128, 192], staleDragCancelled: true };
  } catch (error) {
    await page.screenshot({ path: `${directory}/failure.png`, fullPage: true });
    throw error;
  } finally { await page.close(); }
}
