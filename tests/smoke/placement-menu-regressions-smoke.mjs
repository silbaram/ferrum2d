import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import {
  showPlacementBottom,
  showPlacementInspector,
  showPlacementMenu,
  showPlacementViewOptions,
} from "./placement-panel-navigation.mjs";

/** Menus must not consume placement state or outlive their visible anchor. */
export async function smokePlacementMenuRegressions(page, mode) {
  const artifact = "artifacts/viewer-menu-regressions";
  await mkdir(artifact, { recursive: true });
  const viewport = page.viewportSize();
  const language = page.locator("[data-placement-language]");
  const originalLocale = await language.inputValue();
  const originalInspector = await page.locator('.placement-panel:not([hidden]) [role="tablist"]').first()
    .locator('[aria-selected="true"]').getAttribute("data-placement-panel-tab");
  const originalBottom = await page.locator('.placement-runtime-dock [role="tablist"]').first()
    .locator('[aria-selected="true"]').getAttribute("data-placement-panel-tab");
  const snapshot = () => page.evaluate(() => JSON.stringify({
    document: globalThis.ferrumPlacementSpatialExportDocument(),
    history: globalThis.ferrumPlacementViewerHistory,
    selected: globalThis.ferrumPlacementViewerState.selectedInstanceIds,
    camera: globalThis.ferrumPlacementWorkspaceMode === "spatial"
      ? globalThis.ferrumPlacementSpatialCamera : globalThis.ferrumPlacementEditCamera,
  }));
  const before = await snapshot();
  const camera = mode === "spatial" ? "camera-spatial" : "camera-2d";
  const tool = page.locator(".placement-tool-readout");
  const pending = async (value) => assert.equal(await tool.getAttribute("data-active"), String(value));
  const menu = (id) => page.locator(`[data-placement-menu="${id}"]`);
  const paint = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await language.selectOption("en");
    for (const id of [camera, "layout", "help", "view"]) {
      if (mode === "spatial") {
        await showPlacementInspector(page, "placement");
        await page.locator("[data-placement-spatial-add-asset]").selectOption("crate");
        await page.locator("[data-placement-spatial-place]").click();
      } else {
        await showPlacementBottom(page, "assets");
        await page.locator('[data-placement-browser-asset="sprite:crate"]').click();
      }
      await pending(true);
      if (id === "view") await showPlacementViewOptions(page);
      else await showPlacementMenu(page, id);
      const disclosure = id === "view" ? page.locator(".placement-view-options") : menu(id);
      const toggle = disclosure.locator(":scope > summary");
      // Include a focused form control, not just the summary key handler.
      if (id === camera) await disclosure.locator("button").first().focus();
      else if (id === "view") await disclosure.locator('input[type="number"]').first().focus();
      await page.keyboard.press("Escape");
      assert.equal(await disclosure.evaluate((element) => element.open), false, `${id}: Escape must close the menu first`);
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      assert(await toggle.evaluate((element) => element === document.activeElement));
      await pending(true);
      assert.equal(await snapshot(), before, "Closing a menu changed authored state or edit history");
      await page.keyboard.press("Escape");
      await pending(false);
    }

    await page.setViewportSize({ width: 390, height: 500 });
    await showPlacementMenu(page, camera);
    const mount = page.locator(mode === "spatial" ? ".placement-camera-mount" : ".placement-navigation-mount");
    const start = await mount.evaluate((element) => element.scrollLeft);
    const dimensions = await mount.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
    assert(dimensions.scroll > dimensions.client + 20, "Fixture must actually overflow horizontally");
    const delta = start < (dimensions.scroll - dimensions.client) / 2 ? 500 : -500;
    await mount.hover();
    await page.mouse.wheel(delta, 0);
    await page.waitForFunction(({ mode, start }) => document.querySelector(mode === "spatial" ? ".placement-camera-mount" : ".placement-navigation-mount").scrollLeft !== start, { mode, start });
    await page.waitForFunction((id) => !document.querySelector(`[data-placement-menu="${id}"]`).open, camera);
    assert.equal(await menu(camera).locator(":scope > summary").getAttribute("aria-expanded"), "false");

    // The explanatory menu scrolls independently and must stay open while read.
    await showPlacementMenu(page, "help");
    const helpPanel = menu("help").locator(".placement-control-panel");
    assert(await helpPanel.evaluate((element) => element.scrollHeight > element.clientHeight));
    await helpPanel.hover();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction(() => document.querySelector('[data-placement-menu="help"] .placement-control-panel').scrollTop > 0);
    await paint();
    assert(await menu("help").evaluate((element) => element.open), "Reading a scrolling menu must not dismiss it");
    await page.screenshot({ path: `${artifact}/${mode}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await page.setViewportSize(viewport);
    await paint();
    assert.equal(await snapshot(), before, "Menu scrolling changed camera, selection, document or history");
    await writeFile(`${artifact}/${mode}.json`, JSON.stringify({ ok: true, mode, dimensions,
      checks: ["Escape closes Camera/Layout/Controls/View before placement cancellation", "next Escape cancels placement", "focus returns to summary", "real horizontal wheel dismisses orphan popup", "panel scrolling remains open", "document/history/selection/camera preserved"],
    }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: `${artifact}/${mode}-failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.setViewportSize(viewport);
    if (originalInspector) await showPlacementInspector(page, originalInspector);
    if (originalBottom) await showPlacementBottom(page, originalBottom);
    await language.selectOption(originalLocale);
  }
}
