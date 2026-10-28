import { clickPlacementControl, showPlacementInspector } from "./placement-panel-navigation.mjs";
import { strict as assert } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";

/** Regressions reproduced during UI review: use real controls, drag events and Wasm picking. */
export async function smokePlacementUiReviewFixes(parent, source, timeoutMs) {
  const page = await parent
    .context()
    .browser()
    .newPage({ viewport: { width: 1280, height: 900 } });
  const directory = "artifacts/authoring-ui-review-fixes";
  await mkdir(directory, { recursive: true });
  const errors = [],
    measurements = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = structuredClone(source);
  // Geometry/picking only; these regressions do not require a GLB resource.
  delete fixture.spatial.models;
  const wait = (fn, arg) =>
    page.waitForFunction(fn, arg, { timeout: timeoutMs });
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
      count: globalThis.ferrumPlacementViewerState.instances.length,
    }));
  const card = '[data-placement-browser-asset="sprite:crate"]';
  async function idle() {
    assert.equal(
      await page.locator("[data-placement-tool-cancel]").isHidden(),
      true,
    );
    assert.equal(
      await page
        .locator('[data-placement-browser-asset][aria-pressed="true"]')
        .count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerInteraction.pendingAdd,
      ),
      undefined,
    );
    assert.equal(await page.locator("[data-placement-pending-add]").count(), 0);
  }
  async function open() {
    await page.goto(new URL(parent.url()).origin + "/", {
      waitUntil: "networkidle",
    });
    await wait(
      () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
    );
    await page.locator("[data-placement-document-file]").setInputFiles({
      name: "ui-review.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        !document.querySelector(".demo-shell").inert,
    );
  }
  async function clickBlank() {
    const canvas = await page.locator("canvas.demo-canvas").boundingBox();
    await page.mouse.click(
      canvas.x + canvas.width * 0.85,
      canvas.y + canvas.height * 0.2,
    );
    await paint();
  }
  try {
    await open();
    await page.locator('[data-placement-mode="2d"]').click();
    for (const mode of ["spatial", "game"]) {
      const before = await snapshot();
      await page.locator(card).click();
      await page.locator(`[data-placement-mode="${mode}"]`).click();
      await idle();
      await page.locator('[data-placement-mode="2d"]').click();
      await idle();
      await clickBlank();
      assert.deepEqual(
        await snapshot(),
        before,
        "Mode round-trip revived an old placement",
      );
    }

    await showPlacementInspector(page, "placement");
    // Changing the live asset/settings must invalidate the captured ghost/tool snapshot.
    const beforeAsset = await snapshot();
    await page.locator(card).click();
    await page.selectOption(
      ".placement-inspector:visible [data-placement-add-sprite]",
      "floor",
    );
    await idle();
    await clickBlank();
    assert.deepEqual(await snapshot(), beforeAsset);
    await page
      .locator(
        '.placement-inspector:visible [data-placement-action="add-sprite"]',
      )
      .click();
    assert.match(
      await page.locator("[data-placement-tool-status]").textContent(),
      /Place:.*Floor/i,
    );
    assert.equal(
      await page
        .locator('[data-placement-browser-asset="sprite:floor"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    const preview = await page.evaluate(
      () => globalThis.ferrumPlacementViewerInteraction.pendingAddPreview,
    );
    assert.equal(preview.assetId, "floor");
    await clickBlank();
    const visual = await page.evaluate(
      () => globalThis.ferrumPlacementViewerState.selected.visual,
    );
    assert.equal(visual.texture.value, "floor");
    assert.equal(visual.width, preview.width);
    assert.equal(visual.height, preview.height);
    assert.equal(
      (await snapshot()).history.undoCount,
      beforeAsset.history.undoCount + 1,
    );
    await page.locator('[data-placement-action="undo"]').click();
    assert.equal((await snapshot()).document, beforeAsset.document);
    await page.locator(card).click();
    const frame = await page
      .locator(
        ".placement-inspector:visible [data-placement-add-sprite-frame] option",
      )
      .evaluateAll((options) => options.find((option) => option.value)?.value);
    assert(frame, "Fixture must include a sprite frame");
    await page.selectOption(
      ".placement-inspector:visible [data-placement-add-sprite-frame]",
      frame,
    );
    await idle();
    await page
      .locator(
        '.placement-inspector:visible [data-placement-action="add-sprite"]',
      )
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.ferrumPlacementViewerInteraction.pendingAddPreview.frameId,
      ),
      frame,
    );
    assert.equal(
      await page
        .locator(`[data-placement-browser-asset="sprite:crate/${frame}"]`)
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.locator("[data-placement-tool-cancel]").click();
    for (const [field, value] of [
      ["rotation", "30"],
      ["scale", "2"],
    ]) {
      const beforeSettings = await snapshot();
      await page.locator(card).click();
      await page
        .locator(`.placement-inspector:visible [data-placement-add-${field}]`)
        .fill(value);
      await idle();
      // Pointerdown happens before input blur/change; input must already cancel.
      await clickBlank();
      assert.deepEqual(await snapshot(), beforeSettings);
    }
    // Native drag Escape does not dispatch DOM keydown; dragend must still leave no old armed tool.
    await page.locator(card).click();
    await page.evaluate(() => {
      globalThis.__reviewDragEvents = [];
      for (const type of ["dragstart", "dragend"])
        window.addEventListener(
          type,
          (event) => globalThis.__reviewDragEvents.push(event.type),
          true,
        );
    });
    const asset = await page.locator(card).boundingBox();
    await page.mouse.move(
      asset.x + asset.width / 2,
      asset.y + asset.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      asset.x + asset.width / 2 + 12,
      asset.y + asset.height / 2 + 2,
      { steps: 5 },
    );
    await page.mouse.move(
      asset.x + asset.width / 2 + 32,
      asset.y + asset.height / 2 + 6,
      { steps: 5 },
    );
    assert.match(
      await page.locator("[data-placement-tool-status]").textContent(),
      /Drag:/,
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await paint();
    await idle();
    assert.deepEqual(await page.evaluate(() => globalThis.__reviewDragEvents), [
      "dragstart",
      "dragend",
    ]);

    // A rejected native transition must preserve the old mode AND its pending tool.
    const beforeFailure = await snapshot();
    await page.locator(card).click();
    await page.evaluate(() => {
      const engine = globalThis.ferrumEngine,
        original = engine.configureDataSceneSpatial;
      globalThis.__reviewRejectedMode = false;
      engine.configureDataSceneSpatial = (...args) => {
        engine.configureDataSceneSpatial = original;
        globalThis.__reviewRejectedMode = true;
        return false;
      };
    });
    await page.locator('[data-placement-mode="spatial"]').click();
    assert(await page.evaluate(() => globalThis.__reviewRejectedMode));
    assert.equal(
      await page.evaluate(() => globalThis.ferrumPlacementWorkspaceMode),
      "2d",
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerInteraction.pendingAdd,
      ),
      "add-sprite",
    );
    assert.equal(await page.locator(card).getAttribute("aria-pressed"), "true");
    assert.deepEqual(await snapshot(), beforeFailure);
    await page.locator("[data-placement-tool-cancel]").click();

    // Clean context after the deliberately rejected native apply.
    await open();
    for (const mode of ["2d", "spatial"]) {
      await page.locator(`[data-placement-mode="${mode}"]`).click();
      for (const viewport of [
        { width: 844, height: 390 },
        { width: 768, height: 400 },
        { width: 390, height: 500 },
      ]) {
        await page.setViewportSize(viewport);
        for (const dock of ["scene", "inspector", "runtime"]) {
          await clickPlacementControl(page, `[data-placement-dock-toggle="${dock}"]`);
          await paint();
          const bounds = await page.evaluate(
            (dock) => ({
              canvas: document
                .querySelector("canvas")
                .getBoundingClientRect()
                .toJSON(),
              panel: document
                .querySelector("#placement-" + dock + "-dock")
                .getBoundingClientRect()
                .toJSON(),
              scrollWidth: document.documentElement.scrollWidth,
              scrollHeight: document.documentElement.scrollHeight,
              message: document.querySelector(".placement-spatial-message")
                ?.textContent,
            }),
            dock,
          );
          assert(bounds.canvas.height >= 120, JSON.stringify(bounds));
          assert(bounds.panel.height >= 48, JSON.stringify(bounds));
          assert(
            bounds.canvas.bottom <= bounds.panel.top + 1,
            "Drawer covers canvas",
          );
          assert(
            bounds.panel.bottom <= viewport.height,
            "Drawer is clipped below window",
          );
          assert(
            bounds.scrollWidth <= viewport.width + 1 &&
              bounds.scrollHeight <= viewport.height + 1,
            JSON.stringify({ mode, dock, viewport, ...bounds }),
          );
          assert(!bounds.message, "Native camera error: " + bounds.message);
          if (mode === "spatial") {
            await page.evaluate(() =>
              globalThis.ferrumPlacementViewerSelect("sprite"),
            );
            await wait(
              () => globalThis.ferrumPlacementSpatialTarget?.id === "sprite",
            );
            await paint();
            const point = await page.evaluate(() =>
              globalThis.ferrumPlacementSpatialProject({
                x: 40,
                y: 80,
                elevation: 40,
              }),
            );
            assert(
              point?.visible,
              "Terrain projection missing after short-window resize",
            );
            await page.mouse.click(point.x, point.y);
            await wait(
              () => globalThis.ferrumPlacementSpatialTarget?.id === "bridge",
            );
          }
          const name = `${mode}-${viewport.width}x${viewport.height}-${dock}`;
          measurements.push({ name, ...bounds });
          await page.screenshot({
            path: `${directory}/${name}.png`,
            fullPage: true,
          });
          await page.locator("[data-placement-drawer-close]").click();
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    assert.deepEqual(errors, []);
    const report = {
      modeRoundTripCancelsPlacement: true,
      rejectedTransitionRetainsTool: true,
      assetAndFrameChangeCancel: true,
      rearmedVisualMatchesPreview: true,
      rotationScaleChangeCancel: true,
      nativeDragEscape: true,
      shortWindowCanvasAndVisibleDocks: true,
      nativePickingAfterResize: true,
      measurements,
      errors,
    };
    await writeFile(
      `${directory}/regression-smoke.json`,
      JSON.stringify(report, null, 2),
    );
    return report;
  } catch (error) {
    await page.screenshot({ path: `${directory}/failure.png`, fullPage: true });
    throw error;
  } finally {
    await page.close();
  }
}
