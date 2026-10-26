/** Navigate the actual panel controls; tests must not expose hidden content through DOM edits. */
export async function showPlacementMenu(page, id) {
  const menu = page.locator(`[data-placement-menu="${id}"]`);
  const summary = menu.locator(":scope > summary");
  if (!(await menu.evaluate((element) => element.open))) await summary.click();
  await page.waitForFunction((id) => {
    const menu = document.querySelector(`[data-placement-menu="${id}"]`);
    return menu.open && menu.querySelector("summary").getAttribute("aria-expanded") === "true";
  }, id);
}

export async function showPlacementCameraOptions(page) {
  const spatial = await page.evaluate(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
  await showPlacementMenu(page, spatial ? "camera-spatial" : "camera-2d");
}

export async function clickPlacementControl(page, selector) {
  const control = typeof selector === "string" ? page.locator(selector) : selector;
  const menu = await control.evaluate((element) => element.closest("[data-placement-menu]")?.dataset.placementMenu);
  if (menu) await showPlacementMenu(page, menu);
  await control.click();
  if (menu && await page.locator(`[data-placement-menu="${menu}"]`).evaluate((element) => element.open))
    await page.keyboard.press("Escape");
}

export async function showPlacementViewOptions(page) {
  const toggle = page.locator("[data-placement-view-options]");
  if (!(await toggle.evaluate((element) => element.closest("details")?.open)))
    await toggle.click();
  await page.waitForFunction(() => {
    const toggle = document.querySelector("[data-placement-view-options]");
    return toggle.closest("details")?.open && toggle.getAttribute("aria-expanded") === "true";
  });
}

export async function showPlacementDock(page, dock) {
  const root = page.locator(".demo-shell");
  const compact = (await root.getAttribute("data-compact")) === "true";
  const toggle = page.locator(`[data-placement-dock-toggle="${dock}"]`);
  if (
    compact
      ? (await root.getAttribute("data-compact-panel")) !== dock
      : (await toggle.getAttribute("aria-pressed")) === "false"
  )
    await clickPlacementControl(page, toggle);
}
export async function showPlacementInspector(page, tab = "properties") {
  await showPlacementDock(page, "inspector");
  await page
    .locator(".placement-panel:not([hidden])")
    .getByRole("tablist", { name: "Inspector sections" })
    .locator(`[data-placement-panel-tab="${tab}"]`)
    .click();
}
export async function showPlacementBottom(page, tab = "assets") {
  await showPlacementDock(page, "runtime");
  await page
    .getByRole("tablist", { name: "Bottom panels" })
    .locator(`[data-placement-panel-tab="${tab}"]`)
    .click();
}
