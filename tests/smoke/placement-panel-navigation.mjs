/** Navigate the actual panel controls; tests must not expose hidden content through DOM edits. */
export async function showPlacementMenu(page, id) {
  const menu = page.locator(`[data-placement-menu="${id}"]`);
  if (await menu.evaluate(element => !!element.closest(".placement-view-options"))) await showPlacementViewOptions(page);
  else if (await page.locator(".placement-view-options").evaluate(element => element.open)) await page.locator("[data-placement-view-options]").click();
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
  if (await control.evaluate(element => !!element.closest(".placement-view-options"))) await showPlacementViewOptions(page);
  else if (await page.locator(".placement-view-options").evaluate(element => element.open)) await page.locator("[data-placement-view-options]").click();
  const menu = await control.evaluate((element) => element.closest("[data-placement-menu]")?.dataset.placementMenu);
  if (menu) await showPlacementMenu(page, menu);
  await control.click();
  if (menu && await page.locator(`[data-placement-menu="${menu}"]`).evaluate((element) => element.open))
    await page.keyboard.press("Escape");
  if (await control.evaluate(element => !!element.closest(".placement-view-options")) &&
      await page.locator(".placement-view-options").evaluate(element => element.open)) await page.keyboard.press("Escape");
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
  if (await page.locator(".placement-view-options").evaluate(element => element.open))
    await page.locator("[data-placement-view-options]").click();
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
    .locator(".placement-inspector-header [role=tablist]")
    .locator(`[data-placement-panel-tab="${tab}"]`)
    .click();
}
export async function showPlacementBottom(page, tab = "assets") {
  await showPlacementDock(page, "runtime");
  await page
    .locator(`.placement-runtime-dock [role=tablist] > [data-placement-panel-tab="${tab}"]`)
    .click();
}

/** Follow the same action overflow a user sees; never expose controls through DOM edits. */
export async function clickPlacementToolAction(page, control) {
  if (control === undefined) { control = page; page = control.page(); }
  const menu = await control.evaluate(node => node.closest("[data-placement-tool-action-menu]")?.dataset.placementToolActionMenu);
  if (menu) await showPlacementMenu(page, `tool-${menu}`);
  await control.click();
}

export async function inspectPlacementAsset(page, control) {
  await showPlacementBottom(page, "assets");
  const back = page.locator(".placement-asset-back:visible");
  if (!await control.isVisible() && await back.count()) await back.click();
  await control.click();
}

export async function choosePlacementAsset(page, control) {
  if (control === undefined) { control = page; page = control.page(); }
  await inspectPlacementAsset(page, control);
  await page.locator("[data-placement-asset-place]:visible").click();
}

export async function openPlacementLightingAdvanced(control) {
  const group=control.locator('xpath=ancestor::details[@data-placement-lighting-advanced]');
  if(await group.count()&&!await group.evaluate(node=>node.open))await group.locator(':scope > summary').click();
}
