import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import {
  showPlacementInspector,
  showPlacementBottom,
  showPlacementViewOptions,
} from "./placement-panel-navigation.mjs";

/** Six layout improvements, through real tabs and native preview controls. */
export async function smokePlacementSixPanels(parent, source, timeoutMs) {
  const page = await parent
    .context()
    .browser()
    .newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [],
    measurements = [],
    directory = "artifacts/authoring-workspace-six-panels";
  page.on("pageerror", (error) => errors.push(error.message));
  const wait = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const snapshot = () =>
    page.evaluate(() => ({
      document: JSON.stringify(
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
      history: globalThis.ferrumPlacementViewerHistory,
    }));
  await mkdir(directory, { recursive: true });
  try {
    await page.goto(new URL(parent.url()).origin, { waitUntil: "networkidle" });
    await wait(() => globalThis.ferrumPlacementViewerState);
    const fixture = structuredClone(source);
    delete fixture.spatial.models;
    await page.locator("[data-placement-document-file]").setInputFiles({
      name: "six-panels.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        !document.querySelector(".demo-shell").inert,
    );
    const clean = await snapshot();
    await showPlacementInspector(page);
    const inspector = page.locator(
      ".placement-panel:not([hidden]) .placement-inspector",
    );
    const language = page.locator("[data-placement-language]");
    for (const locale of ["ko", "en", "ko"]) {
      await language.selectOption(locale);
      for (const mode of ["2d", "spatial", "game", "spatial"]) {
        await page.locator(`[data-placement-mode="${mode}"]`).click();
        const sections = inspector.locator(
          '[data-section="transform"], [data-section="object"], [data-section="visual"], [data-section="collider"], [data-section="behavior-binding"]',
        );
        assert.equal(await sections.count(), 5);
        assert.deepEqual(await sections.evaluateAll((elements) => elements.map((element) => element.hidden)),
          Array(5).fill(mode !== "2d"), `${locale}/${mode}: Inspector visibility must use stable section IDs`);
        if (mode === "2d")
          assert(await inspector.locator('[data-placement-transform-field="x"]').isVisible());
      }
    }
    await language.selectOption("en");
    assert.deepEqual(await snapshot(), clean, "Locale/mode transitions changed the document or history");
    assert.match(
      await inspector
        .locator("[data-placement-selection-header]")
        .textContent(),
      /Sprite|Model|No selection/,
    );
    await inspector
      .getByRole("tab", { name: "Properties", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await inspector
        .getByRole("tab", { name: "Placement", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    assert(
      await inspector.locator("[data-placement-spatial-place]").isVisible(),
    );
    assert(
      await inspector.locator("[data-placement-spatial-field=x]").isHidden(),
    );
    await page.keyboard.press("Home");
    assert(
      await inspector.locator("[data-placement-spatial-target]").isVisible(),
    );
    assert(
      await inspector.locator("[data-placement-spatial-add-kind]").isHidden(),
    );

    const search = page.getByRole("searchbox", { name: "Search scene" });
    await search.fill("sprite");
    assert.equal(
      await page
        .locator(".placement-list .placement-instance-row:visible")
        .count(),
      1,
    );
    await search.fill("no-such-object");
    assert.equal(
      await page.locator(".placement-list [data-scene-type]:visible").count(),
      0,
    );
    await search.fill("");
    await page
      .locator(".placement-panel:not([hidden])")
      .getByLabel("Scene type", { exact: true })
      .selectOption("Terrain");
    assert.equal(
      await page
        .locator(".placement-list .placement-terrain-row:visible")
        .count(),
      fixture.spatial.terrain.length,
    );
    assert.equal(
      await page
        .locator(".placement-list .placement-instance-row:visible")
        .count(),
      0,
    );
    await page.locator('[data-placement-scene-surface="bridge"]').click();
    assert.match(
      await inspector
        .locator("[data-placement-selection-header]")
        .textContent(),
      /bridge · Terrain/,
    );
    assert(
      await inspector.locator("[data-placement-spatial-field=yaw]").isHidden(),
    );
    await page.locator("[data-placement-scene-frame]:visible").click();
    await page
      .locator(".placement-panel:not([hidden])")
      .getByLabel("Scene type", { exact: true })
      .selectOption("All Types");
    const layer = page
      .locator(".placement-panel:not([hidden])")
      .getByLabel("Scene layer", { exact: true });
    await layer.selectOption("terrain");
    assert.equal(
      await page
        .locator(".placement-list .placement-instance-row:visible")
        .count(),
      0,
    );
    await layer.selectOption("all");
    assert(
      await page.locator(".placement-list [data-placement-fragment]").count(),
    );
    assert.deepEqual(
      await snapshot(),
      clean,
      "Scene navigation changed authored data or history",
    );

    await page.locator("[data-placement-focus-floor]").selectOption("1");
    assert.match(
      await page.locator("[data-placement-spatial-info]").textContent(),
      /View: Floor 1.*Selected: bridge.*Floor 1/,
    );
    await page.locator("[data-placement-floor-controls]").click();
    assert(
      (await inspector
        .locator("details", {
          has: page.locator("summary", { hasText: /^Floor Visibility$/ }),
        })
        .getAttribute("open")) !== null,
    );
    await showPlacementViewOptions(page);
    await page.locator("[data-placement-proxy-overlay]").check();
    await page.locator("[data-placement-proxy-overlay]").uncheck();
    await page.locator("[data-placement-focus-floor]").selectOption("all");
    await showPlacementInspector(page, "placement");
    await page
      .locator("[data-placement-spatial-add-asset]")
      .selectOption("crate");
    await page.locator("[data-placement-spatial-place]").click();
    const placementPoint = await page.evaluate(() =>
      globalThis.ferrumPlacementSpatialProject({ x: 40, y: 80, elevation: 40 }),
    );
    assert(placementPoint?.visible);
    await page.mouse.move(placementPoint.x, placementPoint.y);
    await wait(() =>
      document
        .querySelector("[data-placement-spatial-info]")
        .textContent.includes("Placement: Floor 1 / H 40"),
    );
    await page.locator("[data-placement-tool-cancel]").click();
    assert.deepEqual(
      await snapshot(),
      clean,
      "Placement support preview changed authored data",
    );
    await showPlacementInspector(page, "properties");
    await page.locator('button[data-instance-id="sprite"]').click();
    const x = inspector.locator('[data-placement-spatial-field="x"]');
    await x.fill("-48");
    await x.press("Tab");
    await wait(() => !!globalThis.ferrumPlacementViewerState.draftPatch);
    const edited = await snapshot();
    await page.evaluate(() => {
      globalThis.__sixPlaybackCalls = [];
      for (const name of ["pauseDataScene", "resumeDataScene"]) {
        const original = globalThis.ferrumEngine[name];
        globalThis.ferrumEngine[name] = (...args) => {
          globalThis.__sixPlaybackCalls.push(name);
          return original(...args);
        };
      }
    });
    assert(await page.locator('[data-placement-playback="pause"]').isHidden());
    assert(await page.locator('[data-placement-playback="stop"]').isHidden());
    await page.locator('[data-placement-playback="play"]').click();
    await wait(() => globalThis.ferrumPlacementWorkspaceMode === "game");
    assert(await page.locator('[data-placement-playback="play"]').isHidden());
    assert(await page.locator('[data-placement-playback="stop"]').isVisible());
    await page.locator('[data-placement-playback="pause"]').click();
    assert.equal(
      await page.locator('[data-placement-playback="pause"]').textContent(),
      "Resume",
    );
    assert.equal(
      await page.evaluate(() => globalThis.ferrumEngine.dataSceneState()),
      "paused",
    );
    await page.evaluate(() => {
      globalThis.__sixPausedFrame =
        globalThis.ferrumPlacementViewerRuntimeFrame;
    });
    await paint();
    assert(
      await page.evaluate(
        () =>
          globalThis.ferrumPlacementViewerRuntimeFrame.drawCalls > 0 &&
          globalThis.__sixPausedFrame !==
            globalThis.ferrumPlacementViewerRuntimeFrame,
      ),
    );
    await page.locator('[data-placement-playback="pause"]').click();
    assert.equal(
      await page.locator('[data-placement-playback="pause"]').textContent(),
      "Pause",
    );
    assert.equal(
      await page.evaluate(() => globalThis.ferrumEngine.dataSceneState()),
      "playing",
    );
    await page.locator('[data-placement-playback="stop"]').click();
    await wait(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
    assert(await page.locator('[data-placement-playback="play"]').isVisible());
    assert(await page.locator('[data-placement-playback="pause"]').isHidden());
    assert(await page.locator('[data-placement-playback="stop"]').isHidden());
    assert.deepEqual(
      await snapshot(),
      edited,
      "Preview stop changed draft or edit history",
    );
    const calls = await page.evaluate(() => globalThis.__sixPlaybackCalls);
    assert(calls.filter((name) => name === "resumeDataScene").length >= 2);
    assert(calls.filter((name) => name === "pauseDataScene").length >= 2);

    await page.locator("[data-placement-review]").click();
    assert(
      await page.locator('[data-placement-panel-body="changes"]').isVisible(),
    );
    assert(
      await page.locator('[data-placement-panel-body="assets"]').isHidden(),
    );
    assert(await page.locator("[data-placement-changed-path]").count());
    assert.match(
      await page.locator("[data-placement-review-summary]").textContent(),
      /[1-9]\d* changes/,
    );
    for (const tab of ["problems", "runtime", "assets"]) {
      await showPlacementBottom(page, tab);
      assert.equal(
        await page
          .getByRole("tablist", { name: "Bottom panels" })
          .locator('[aria-selected="true"]')
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator(
            ".placement-runtime-dock > .placement-panel-tabs > .placement-panel-tabbody:visible",
          )
          .count(),
        1,
      );
    }
    await page.locator("[data-placement-export]").click();
    assert(
      (await inspector
        .locator('[data-section="handoff"]')
        .getAttribute("open")) !== null,
    );
    assert(
      await inspector
        .locator('[data-placement-action="copy-patch"]')
        .isEnabled(),
    );
    assert(
      await inspector
        .locator(
          '.placement-handoff-actions [data-placement-action="save-draft"]',
        )
        .isDisabled(),
    );
    await page.screenshot({ path: directory + "/desktop.png" });
    for (const viewport of [
      { width: 844, height: 390 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await showPlacementInspector(page, "placement");
      await paint();
      const bounds = await page.evaluate(() => ({
        canvas: document
          .querySelector("canvas")
          .getBoundingClientRect()
          .toJSON(),
        height: innerHeight,
        scroll: document.documentElement.scrollHeight,
        inspectorHeaders: [
          ...document.querySelectorAll(".placement-inspector > h2"),
        ].filter((e) => e.getBoundingClientRect().height > 0).length,
      }));
      assert(bounds.canvas.height >= 128, JSON.stringify(bounds));
      assert(bounds.scroll <= bounds.height + 1, JSON.stringify(bounds));
      assert.equal(bounds.inspectorHeaders, 0);
      assert(await page.locator("[data-placement-drawer-close]").isVisible());
      measurements.push({ viewport, ...bounds });
      await page.screenshot({
        path: `${directory}/${viewport.width}x${viewport.height}.png`,
      });
      await page.locator("[data-placement-drawer-close]").click();
    }
    assert.deepEqual(errors, []);
    const result = {
      inspectorTabs: true,
      localizedModeSections: true,
      bottomTabs: true,
      sceneNavigation: true,
      previewControls: calls,
      spatialInfo: true,
      reviewExportGates: true,
      compact: measurements,
    };
    await writeFile(
      directory + "/browser.json",
      JSON.stringify(result, null, 2),
    );
    return result;
  } finally {
    await page.close();
  }
}
