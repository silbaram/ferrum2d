import assert from "node:assert/strict";
import { showPlacementAssetPanel, showPlacementDock } from "./placement-panel-navigation.mjs";

const drawer = (page) => page.evaluate(() => globalThis.ferrumPlacementWorkspaceLayout.runtimeDrawer);
const canvasSize = (page) => page.locator("canvas.demo-canvas").evaluate((canvas) => {
  const box = canvas.getBoundingClientRect();
  return [box.width, box.height];
});
const assetsTab = (page) => page.locator('.placement-runtime-dock [role=tablist] > [data-placement-panel-tab="assets"]');

/** Real pointer and keyboard checks: the drawer never resizes the viewport and never blocks a drop. */
export async function smokePlacementAssetDrawer(page, timeoutMs) {
  const wait = (predicate, arg) => page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  const pin = page.locator("[data-placement-dock-pin]");
  await showPlacementDock(page, "runtime");
  if ((await pin.getAttribute("aria-pressed")) === "true") await pin.click();
  assert.equal(await drawer(page), "closed");
  assert.equal(await page.locator("[data-placement-asset-search]").isVisible(), false);
  const closedSize = await canvasSize(page);

  await assetsTab(page).click();
  assert.equal(await drawer(page), "open");
  const grid = page.locator(".placement-asset-grid");
  assert(await grid.isVisible());
  const body = page.locator(".placement-asset-body");
  assert((await body.evaluate((node) => node.getBoundingClientRect().height)) > 240, "the drawer gives assets more than the docked height");
  assert.deepEqual(await canvasSize(page), closedSize, "opening the drawer must not resize the viewport");

  await assetsTab(page).click();
  assert.equal(await drawer(page), "closed", "the active tab toggles the drawer");
  await assetsTab(page).click();
  await page.mouse.click(...await viewportPoint(page));
  assert.equal(await drawer(page), "closed", "pointer input outside the drawer dismisses it");

  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("Control+Space");
  await wait(() => document.activeElement?.dataset.placementAssetSearch === "true");
  assert.equal(await drawer(page), "open");
  await page.keyboard.type("crate");
  await page.keyboard.press("Escape");
  assert.equal(await drawer(page), "open", "Escape first clears a filled search");
  await page.locator("[data-placement-asset-search]").fill("");
  await page.keyboard.press("Escape");
  assert.equal(await drawer(page), "closed");

  // Tools replace the grid, one at a time, and keep their own disclosure state.
  await assetsTab(page).click();
  await page.locator('[data-placement-menu="asset-import"] > summary').click();
  await page.locator('[data-placement-asset-open="aseprite"]').click();
  const aseprite = page.locator("[data-placement-aseprite-tool]");
  assert(await aseprite.locator('[data-aseprite-action="inspect"]').isVisible());
  assert.equal(await grid.isVisible(), false);
  await page.locator("[data-placement-asset-view-back]").click();
  assert(await grid.isVisible());
  assert.equal(await aseprite.evaluate((node) => node.open), false);

  // A real drag fades the drawer so the drop lands on the viewport, then dismisses it.
  await assetsTab(page).click();
  if ((await drawer(page)) !== "open") await assetsTab(page).click();
  const source = await page.locator('[data-placement-browser-asset="sprite:crate"]').boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  const [x, y] = await viewportPoint(page);
  await page.mouse.move(x, y + 40, { steps: 6 });
  await wait(() => document.querySelector(".demo-shell").dataset.runtimeDrawer === "dragging");
  await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  await wait(() => document.querySelector(".demo-shell").dataset.runtimeDrawer === "closed");
  await wait(() => globalThis.ferrumPlacementViewerHistory.undoCount === 1);
  await page.locator("button[data-placement-action=undo]").click();
  await wait(() => globalThis.ferrumPlacementViewerHistory.undoCount === 0 && !globalThis.ferrumPlacementViewerExportPatch());

  // Docking returns the previous fixed panel, and that choice survives as a preference.
  await showPlacementAssetPanel(page, "usage");
  assert.equal(await pin.getAttribute("aria-pressed"), "true");
  assert.equal(await drawer(page), "pinned");
  assert((await canvasSize(page))[1] < closedSize[1], "a docked panel takes layout space");
  await page.mouse.click(...await viewportPoint(page));
  assert.equal(await drawer(page), "pinned", "a docked panel ignores outside clicks");
  await page.locator("[data-placement-asset-view-back]").click();
}

async function viewportPoint(page) {
  const box = await page.locator("canvas.demo-canvas").boundingBox();
  return [box.x + box.width / 2, box.y + 48];
}
