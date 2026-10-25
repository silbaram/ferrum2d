import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** Real toolbar controls: modes, temporary pan, display disclosure and focus. */
export async function smokePlacementToolbarUx(page, timeoutMs, mode) {
  const artifact = "artifacts/viewport-toolbar-ux";
  await mkdir(artifact, { recursive: true });
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const viewport = page.viewportSize();
  const language = page.locator("[data-placement-language]");
  const originalLocale = await language.inputValue();
  const state = () => page.evaluate(() => JSON.stringify({
    document: globalThis.ferrumPlacementSpatialExportDocument(),
    history: globalThis.ferrumPlacementViewerHistory,
    selected: globalThis.ferrumPlacementViewerState.selectedInstanceIds,
    camera: globalThis.ferrumPlacementWorkspaceMode === "spatial"
      ? globalThis.ferrumPlacementSpatialCamera : globalThis.ferrumPlacementEditCamera,
  }));
  const before = await state();
  const prefix = mode === "spatial" ? "[data-placement-spatial-navigation=" : "[data-placement-view-action=";
  const select = page.locator(prefix + "select]"), pan = page.locator(prefix + "pan]");
  const summary = page.locator("[data-placement-view-options]");
  const grid = page.locator("[data-placement-grid-toggle]");
  const spacing = page.locator(".placement-grid-controls input[type=number]");
  try {
    for (const locale of ["ko", "en"]) {
      await language.selectOption(locale);
      const name = locale === "ko" ? "화면 이동" : "Pan";
      assert.equal(await pan.getAttribute("aria-label"), name);
      assert.equal(await pan.locator("svg").count(), 1);
      await select.focus();
      await page.keyboard.press("ArrowRight");
      assert(await pan.evaluate((b) => b === document.activeElement));
      assert.equal(await select.getAttribute("aria-pressed"), "true");
      await pan.click();
      assert.equal(await pan.getAttribute("aria-pressed"), "true");
      assert.match(await page.locator("[data-placement-tool-status]").textContent(), /V/);
      await page.keyboard.press("v");
      await page.keyboard.down("Space");
      assert.equal(await pan.getAttribute("aria-pressed"), "true");
      assert.match(await page.locator("[data-placement-tool-status]").textContent(), /Space/);
      await page.keyboard.up("Space");
      assert.equal(await select.getAttribute("aria-pressed"), "true");

      await summary.focus();
      await page.keyboard.press("Enter");
      await wait(() => document.querySelector(".placement-view-options").open);
      assert(await grid.isVisible());
      const savedGrid = await grid.isChecked();
      await grid.setChecked(!savedGrid);
      await wait((visible) => globalThis.ferrumPlacementGrid.visible === visible, !savedGrid);
      await grid.setChecked(savedGrid);
      await wait((visible) => globalThis.ferrumPlacementGrid.visible === visible, savedGrid);
      await spacing.focus();
      await page.keyboard.press("Escape");
      assert.equal(await summary.getAttribute("aria-expanded"), "false");
      assert(await summary.evaluate((b) => b === document.activeElement));
      await page.keyboard.press("Space");
      await wait(() => document.querySelector(".placement-view-options").open);
      await showPlacementViewOptions(page);
      await select.click();
      assert.equal(await summary.getAttribute("aria-expanded"), "false");
    }
    await showPlacementViewOptions(page);
    const originalSpacing = await spacing.inputValue();
    await spacing.fill("32");
    await spacing.press("Tab");
    await wait(() => globalThis.ferrumPlacementViewerInteraction.gridSize === 32);
    await showPlacementViewOptions(page);
    await spacing.fill(originalSpacing);
    await spacing.press("Tab");
    await wait((size) => globalThis.ferrumPlacementViewerInteraction.gridSize === Number(size), originalSpacing);
    await showPlacementViewOptions(page);
    await spacing.fill("0");
    await spacing.press("Tab");
    assert.equal(await spacing.inputValue(), originalSpacing);
    await page.locator("canvas.demo-canvas").focus();

    const desktop = await page.locator(".placement-viewport-primary").boundingBox();
    assert(desktop.height <= 48, "Primary tools should occupy a compact row");
    await language.selectOption("ko");
    await page.screenshot({ path: `${artifact}/${mode}-ko.png`, fullPage: true });
    await showPlacementViewOptions(page);
    await page.screenshot({ path: `${artifact}/${mode}-view-ko.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 500 });
    const compact = await summary.boundingBox();
    assert(compact.x >= 0 && compact.x + compact.width <= 391, "View must remain reachable on narrow screens");
    const panel = await page.locator(".placement-view-panel").boundingBox();
    assert(panel.x >= 0 && panel.x + panel.width <= 391 && panel.y + panel.height <= 501);
    await page.screenshot({ path: `${artifact}/${mode}-compact-ko.png`, fullPage: true });
    await page.getByRole("button", { name: "보기 설정 닫기", exact: true }).click();
    await page.setViewportSize(viewport);
    await wait(() => globalThis.ferrumPlacementGrid.lineCount > 0);
    assert.equal(await state(), before, "Toolbar UX changed camera, selection, document or history");
    await writeFile(`${artifact}/${mode}.json`, JSON.stringify({
      ok: true, desktop, compact, checks: ["localized icons and shortcuts", "arrow focus without activation", "temporary Space state", "display toggles and shared spacing", "invalid spacing rejected", "Escape/outside dismissal", "390px disclosure bounds", "camera/document/history/selection preserved"],
    }, null, 2) + "\n");
  } catch (error) {
    await page.screenshot({ path: `${artifact}/${mode}-failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.keyboard.up("Space");
    await language.selectOption(originalLocale);
    await page.setViewportSize(viewport);
  }
}
