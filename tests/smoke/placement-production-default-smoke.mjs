import assert from "node:assert/strict";
import { showPlacementMenu } from "./placement-panel-navigation.mjs";

/** Always exercise the real production bundle/assets, independently of private regression builds. */
export async function smokePlacementProductionDefault(browser, origin, timeoutMs) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    assert.equal((await page.request.get(origin + "/placement.scene-authoring.json")).status(), 404);
    assert.equal((await page.request.get(origin + "/placement.hd2d.scene-authoring.json")).status(), 404);
    const catalog = await (await page.request.get(origin + "/placement-scenes.json")).json();
    assert.deepEqual(catalog.scenes.map(scene => scene.relativePath).sort(), ["placement.garden.scene-authoring.json", "placement.village.scene-authoring.json"]);
    for (const route of ["/", "/?scene=default", "/?scene=2d"]) {
      await page.goto(origin + route, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465, undefined, { timeout: timeoutMs });
      assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.instances.some(i => i.instanceId === "garden_hero")), true);
    }
    await page.locator("[data-placement-language]").selectOption("en");
    const sceneTabs = page.getByRole("tablist", { name: "Scene dock sections" });
    const tabGeometry = await sceneTabs.evaluate(element => {
      const area = element.getBoundingClientRect();
      return { height: area.height, fullyVisible: [...element.querySelectorAll("button")].every(button => {
        const rect = button.getBoundingClientRect();
        return rect.top >= area.top && rect.bottom <= area.bottom && rect.left >= area.left && rect.right <= area.right;
      }) };
    });
    assert(tabGeometry.height >= 32 && tabGeometry.fullyVisible, "A populated object tree must not shrink or clip scene tabs");
    await sceneTabs.getByRole("tab", { name: "Project scenes", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".placement-scene-explorer [role=option]").length === 2, undefined, { timeout: timeoutMs });
    await page.keyboard.press("ArrowLeft");
    assert.equal(await sceneTabs.getByRole("tab", { name: "Objects", exact: true }).getAttribute("aria-selected"), "true");
    assert(await page.getByRole("searchbox", { name: "Search scene", exact: true }).isVisible());
    await showPlacementMenu(page, "file"); await showPlacementMenu(page, "examples");
    assert.deepEqual(await page.locator("[data-placement-example]").evaluateAll(elements => elements.map(element => element.dataset.placementExample)), ["garden", "village"]);
    await page.locator('[data-placement-example="garden"]').click();
    await page.waitForFunction(() => !document.querySelector(".demo-shell").inert, undefined, { timeout: timeoutMs });
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceDocuments.length), 1);
    await page.locator('[data-placement-playback="play"]').click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "game", undefined, { timeout: timeoutMs });
    await page.locator('[data-placement-playback="stop"]').click();
    await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "2d", undefined, { timeout: timeoutMs });
    for (const route of ["/?scene=hd2d", "/?scene=village"]) {
      await page.goto(origin + route, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.ferrumPlacementWorkspaceMode === "spatial" && window.ferrumPlacementViewerState?.instances.some(i => i.instanceId === "village_hero") && !!window.ferrumPlacementViewerRuntimeFrame, undefined, { timeout: timeoutMs });
      assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.instances.some(i => i.instanceId === "crate_ground")), false);
    }
    assert.deepEqual(errors, []);
    return { realProductionBundle: true, defaultScene: "garden", instances: 465, publicScenes: 2, basicExampleAbsent: true, basicHd2dExampleAbsent: true, hd2dAlias: "village", aliases: true, sceneTabsUnclipped: true, exampleDeduplication: true, playStop: true };
  } finally { await page.close(); }
}
