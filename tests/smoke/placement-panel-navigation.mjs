/** Navigate the actual panel controls; tests must not expose hidden content through DOM edits. */
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
    await toggle.click();
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
