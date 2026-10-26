import assert from "node:assert/strict";
import { showPlacementViewOptions } from "./placement-panel-navigation.mjs";

/** Native disclosure state may settle before its deferred accessibility update. */
export async function smokePlacementPanelNavigation(parent) {
  const page = await parent.context().browser().newPage();
  page.setDefaultTimeout(2000);
  try {
    await page.setContent(`<details><summary data-placement-view-options aria-expanded="false">View</summary><p>Settings</p></details>`);
    const immediate = await page.evaluate(() => {
      const details = document.querySelector("details");
      const summary = document.querySelector("summary");
      window.disclosureClicks = 0;
      summary.addEventListener("click", () => window.disclosureClicks++);
      details.addEventListener("toggle", () => {
        setTimeout(() => summary.setAttribute("aria-expanded", String(details.open)), 200);
      });
      summary.click();
      return { open: details.open, expanded: summary.getAttribute("aria-expanded") };
    });
    assert.deepEqual(immediate, { open: true, expanded: "false" });
    await showPlacementViewOptions(page);
    await showPlacementViewOptions(page);
    assert.deepEqual(await page.evaluate(() => ({
      open: document.querySelector("details").open,
      expanded: document.querySelector("summary").getAttribute("aria-expanded"),
      clicks: window.disclosureClicks,
    })), { open: true, expanded: "true", clicks: 1 });
  } finally {
    await page.close();
  }
}
