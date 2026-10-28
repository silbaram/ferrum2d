import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { showPlacementViewOptions, showPlacementMenu } from "./placement-panel-navigation.mjs";
import { smokePlacementMenuRegressions } from "./placement-menu-regressions-smoke.mjs";

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
    await smokePlacementMenuRegressions(page, mode);
    for (const locale of ["ko", "en"]) {
      await language.selectOption(locale);
      const cameraMenu = page.locator(`[data-placement-menu="camera-${mode === "spatial" ? "spatial" : "2d"}"]`);
      const cameraToggle = cameraMenu.locator(":scope > summary");
      const helpToggle = page.locator('[data-placement-menu="help"] > summary');
      assert.equal(await cameraToggle.getAttribute("aria-label"), locale === "ko" ? "편집 시점" : "Editor View");
      assert.equal(await helpToggle.getAttribute("aria-label"), locale === "ko" ? "사용 안내" : "Controls");
      assert(await cameraMenu.locator("button").first().isHidden(), "Secondary camera actions must start collapsed");
      await showPlacementViewOptions(page);
      assert.equal(await cameraToggle.locator(".placement-disclosure-caret").evaluate(element => getComputedStyle(element).transform), "none", "Opening View must not rotate a closed submenu caret");
      await cameraToggle.focus();
      await page.keyboard.press("Enter");
      assert.equal(await cameraToggle.getAttribute("aria-expanded"), "true");
      assert(await cameraMenu.locator("button").first().isVisible());
      assert.equal(await cameraMenu.locator("button .placement-visually-hidden").count(), 0, "Camera commands need visible names");
      await page.keyboard.press("Escape");
      assert(await cameraToggle.evaluate((b) => b === document.activeElement));
      await page.keyboard.press("ArrowDown");
      assert(await cameraMenu.locator("button").first().evaluate((b) => b === document.activeElement));
      await page.keyboard.press("Escape");
      await page.keyboard.press("Space");
      await showPlacementMenu(page, "help");
      assert.equal(await cameraToggle.getAttribute("aria-expanded"), "false", "Opening another menu must dismiss Camera");
      assert.match(await page.locator(".placement-controls-guide").innerText(), /Space/);
      await page.keyboard.press("Escape");
      assert(await helpToggle.evaluate((b) => b === document.activeElement));
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
    const header = await page.locator(".demo-toolbar").boundingBox(), strip = await page.locator(".placement-workspace-strip").boundingBox();
    assert(header.height <= 36 && strip.height <= 36, "Desktop chrome must fit two compact rows");
    assert(await page.locator('.placement-file-strip').isHidden(), "Duplicate file metadata belongs in File");
    await showPlacementMenu(page, "file");
    assert(await page.locator('[data-placement-action="open-json-document"]').isVisible());
    assert(await page.locator('.placement-file-strip').isVisible());
    await page.keyboard.press("Escape");
    const visibleButtons = await page.locator(".placement-viewport-primary button:visible").count();
    assert(visibleButtons <= 6, `Secondary controls leaked into the primary row: ${visibleButtons}`);
    await showPlacementMenu(page, "layout");
    assert(await page.locator('[data-placement-action="reset-layout"]').isVisible());
    await page.keyboard.press("Escape");
    await language.selectOption("ko");
    await page.screenshot({ path: `${artifact}/${mode}-ko.png`, fullPage: true });
    await showPlacementViewOptions(page);
    await page.screenshot({ path: `${artifact}/${mode}-view-ko.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 500 });
    await showPlacementViewOptions(page);
    const compact = await summary.boundingBox();
    assert(compact.x >= 0 && compact.x + compact.width <= 391, "View must remain reachable on narrow screens");
    const panel = await page.locator(".placement-view-panel").boundingBox();
    assert(panel.x >= 0 && panel.x + panel.width <= 391 && panel.y + panel.height <= 501);
    await page.screenshot({ path: `${artifact}/${mode}-compact-ko.png`, fullPage: true });
    // Full-page capture may resize the viewport, which intentionally dismisses menus.
    // Reopen through the actual control before testing the explicit close action.
    await showPlacementViewOptions(page);
    await page.getByRole("button", { name: "보기 설정 닫기", exact: true }).click();
    for (const id of [mode === "spatial" ? "camera-spatial" : "camera-2d", "layout", "help"]) {
      await showPlacementMenu(page, id);
      const bounds = await page.locator(`[data-placement-menu="${id}"] .placement-control-panel`).boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y >= 0 && bounds.y + bounds.height <= 501, `${id} must fit the narrow viewport`);
      await page.keyboard.press("Escape");
    }
    await showPlacementMenu(page, "help");
    await page.setViewportSize({ width: 400, height: 500 });
    await wait(() => !document.querySelector('[data-placement-menu="help"]').open);
    const responsive = [];
    for (const [width, height] of [[320, 360], [420, 360], [680, 480], [860, 600], [861, 600], [1125, 800]]) {
      await page.setViewportSize({ width, height });
      await wait(() => document.querySelector('[data-placement-viewport-size]').textContent ===
        `${document.querySelector('canvas').clientWidth} × ${document.querySelector('canvas').clientHeight}`);
      const box = await page.locator('canvas.demo-canvas').boundingBox();
      assert(box.height >= 128 && box.width > 0, `${width}px must retain a drawable viewport`);
      for (const control of [select, pan, summary, page.locator('.placement-workspace-modes')]) {
        const bounds = await control.boundingBox();
        assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${width}px primary control overflow`);
      }
      await showPlacementViewOptions(page);
      const bounds = await page.locator('.placement-view-panel').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, `${width}px View popup overflow`);
      await page.keyboard.press('Escape');
      responsive.push({width,height,canvas:box});
    }
    await page.setViewportSize(viewport);
    await wait(() => globalThis.ferrumPlacementGrid.lineCount > 0);
    assert.equal(await state(), before, "Toolbar UX changed camera, selection, document or history");
    await writeFile(`${artifact}/${mode}.json`, JSON.stringify({
      ok: true, desktop, header, strip, compact, responsive, visibleButtons, checks: ["two 36px desktop rows", "File metadata and Open reachable", "localized icons and shortcuts", "labeled collapsed editor-view commands", "menu Enter/Space/Escape and focus restoration", "one menu at a time", "layout reset and controls guide reachable", "at most six primary buttons", "arrow focus without activation", "temporary Space state", "display toggles and shared spacing", "invalid spacing rejected", "Escape/outside dismissal", "320-1125px bounds and minimum canvas", "camera/document/history/selection preserved"],
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
