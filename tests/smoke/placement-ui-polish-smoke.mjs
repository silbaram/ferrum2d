import {
  showPlacementInspector,
  showPlacementBottom,
} from "./placement-panel-navigation.mjs";
import { strict as assert } from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/** UI contracts against the actual app and Wasm, including compact canvas coordinates. */
export async function smokePlacementUiPolish(parent, source, timeoutMs) {
  const page = await parent
    .context()
    .browser()
    .newPage({
      viewport: { width: 1280, height: 900 },
    });
  const directory = "artifacts/authoring-ui-polish";
  await mkdir(directory, { recursive: true });
  const errors = [],
    measurements = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
      patch: JSON.stringify(
        globalThis.ferrumPlacementViewerExportPatch() ?? null,
      ),
      undo: globalThis.ferrumPlacementViewerHistory.undoCount,
      redo: globalThis.ferrumPlacementViewerHistory.redoCount,
    }));
  const card = '[data-placement-browser-asset="sprite:crate"]';
  const tool = "[data-placement-tool-status]";
  const dock = (name) => page.locator(`[data-placement-dock-toggle="${name}"]`);
  async function idle() {
    await wait(
      () => document.querySelector("[data-placement-tool-cancel]").hidden,
    );
    assert.equal(
      await page
        .locator('[data-placement-browser-asset][aria-pressed="true"]')
        .count(),
      0,
    );
  }
  async function arm() {
    await showPlacementBottom(page, "assets");
    await page.locator(card).click();
    assert.equal(await page.locator(card).getAttribute("aria-pressed"), "true");
    assert.match(await page.locator(tool).textContent(), /Place:.*crate/i);
  }
  async function measure(name) {
    await paint();
    const bounds = await page.evaluate(() => {
      const rect = (element) => element.getBoundingClientRect().toJSON();
      const canvas = rect(document.querySelector("canvas"));
      const tools = rect(document.querySelector(".placement-viewport-toolbar"));
      return {
        width: innerWidth,
        height: innerHeight,
        activeDock: document.querySelector(".demo-shell").dataset.compactPanel,
        canvas,
        tools,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        visibleDocks: ["scene", "inspector", "runtime"].filter(
          (name) =>
            document
              .querySelector("#placement-" + name + "-dock")
              .getBoundingClientRect().height > 0,
        ),
        visibleInspectors: [
          ...document.querySelectorAll(".placement-inspector"),
        ].filter((element) => element.getBoundingClientRect().height > 0)
          .length,
      };
    });
    assert(
      bounds.canvas.width > 200 && bounds.canvas.height > 100,
      JSON.stringify(bounds),
    );
    assert(
      bounds.canvas.y >= bounds.tools.bottom - 1,
      "Camera tools overlap canvas",
    );
    assert(
      bounds.canvas.bottom <= bounds.height + 1,
      "Canvas extends below window",
    );
    assert(
      bounds.scrollWidth <= bounds.width + 1 &&
        bounds.scrollHeight <= bounds.height + 1,
      "Workspace requires page scrolling: " + JSON.stringify(bounds),
    );
    if (bounds.width <= 860)
      assert.deepEqual(
        bounds.visibleDocks,
        bounds.activeDock === "none" ? [] : [bounds.activeDock],
      );
    assert(
      bounds.visibleInspectors <= 1,
      "Inactive document Inspector became visible",
    );
    measurements.push({ name, ...bounds });
    await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
  }
  try {
    await page.goto(new URL(parent.url()).origin + "/", {
      waitUntil: "networkidle",
    });
    await wait(
      () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
    );
    const original = await snapshot();
    const documentSection = page.locator('[data-section="document"]');
    assert.equal(await documentSection.getAttribute("open"), null);
    const order = await page
      .locator(
        '.placement-inspector [data-placement-panel-body="properties"] > details',
      )
      .evaluateAll((elements) =>
        elements.map((element) => element.dataset.section),
      );
    assert(order.indexOf("identity") < order.indexOf("document"));
    assert(order.indexOf("transform") < order.indexOf("document"));
    assert(
      await page
        .locator(".placement-runtime-dock .placement-model-import")
        .count(),
    );
    assert(
      await page
        .locator(".placement-viewport-toolbar .placement-viewport-controls")
        .count(),
    );
    assert.equal(
      await page
        .locator('.placement-file-strip [data-status="readonly"]')
        .textContent(),
      "Export Only",
    );
    assert.match(
      await page
        .locator('.placement-file-strip [data-status="readonly"]')
        .getAttribute("title"),
      /Copy Patch or Handoff/,
    );

    // Buttons must fit their own cells at the default and minimum supported Inspector widths.
    for (const width of [320, 240]) {
      if (width === 240) {
        await page.locator('[data-placement-dock-resize="inspector"]').focus();
        await page.keyboard.press("Home");
      }
      await showPlacementInspector(page, "properties");
      await page
        .locator('[data-section="handoff"]')
        .evaluate((element) => (element.open = true));
      await page.locator(".placement-handoff-actions").scrollIntoViewIfNeeded();
      const buttons = await page
        .locator(".placement-handoff-actions button")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const text = range.getBoundingClientRect(),
              box = element.getBoundingClientRect();
            return {
              label: element.textContent,
              width: box.width,
              textWidth: text.width,
              fits:
                text.left >= box.left &&
                text.right <= box.right + 1 &&
                text.bottom <= box.bottom + 1,
            };
          }),
        );
      assert.equal(buttons.length, 4);
      assert(
        buttons.every((button) => button.fits),
        JSON.stringify({ width, buttons }),
      );
    }
    await page.locator('[data-placement-action="reset-layout"]').click();
    for (const field of ["rotation", "scale"]) {
      const input = page.locator(`[data-placement-add-${field}]`);
      assert.match(
        await input.evaluate((element) => element.labels[0]?.textContent),
        field === "rotation" ? /Rotation.*°/ : /Scale.*×/,
      );
    }
    const favorite = page.getByRole("button", {
      name: "Favorite Crate",
      exact: true,
    });
    assert.equal(await favorite.locator("svg").count(), 1);
    await favorite.click();
    assert.equal(await favorite.getAttribute("aria-pressed"), "true");
    assert.equal((await favorite.textContent()).trim(), "");
    await arm();
    await page.locator("canvas.demo-canvas").focus();
    await page.keyboard.press("Escape");
    await idle();
    await arm();
    await page.locator("[data-placement-tool-cancel]").click();
    await idle();
    // HTML drag must retain its source element and clear its selection after cancellation.
    await page.locator(card).evaluate((element) => {
      globalThis.__polishDragSource = element;
      globalThis.__polishDragTransfer = new DataTransfer();
      element.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
          dataTransfer: globalThis.__polishDragTransfer,
        }),
      );
    });
    assert(
      await page.evaluate(() => globalThis.__polishDragSource.isConnected),
    );
    assert.match(await page.locator(tool).textContent(), /Drag:/);
    await page
      .locator(card)
      .evaluate((element) =>
        element.dispatchEvent(new DragEvent("dragend", { bubbles: true })),
      );
    await idle();
    assert.deepEqual(await snapshot(), original);

    // Load a real GLB and spatial authoring document using the public file inputs.
    await page.locator("[data-placement-model-key]").fill("rock");
    await page.evaluate(() =>
      window.addEventListener(
        "ferrum-placement-model-import",
        () => (globalThis.__polishImported = true),
        { once: true },
      ),
    );
    await page.locator("[data-placement-model-file]").setInputFiles({
      name: "rock.glb",
      mimeType: "model/gltf-binary",
      buffer: await readFile("examples/data-scene-native/assets/rock.glb"),
    });
    await wait(() => globalThis.__polishImported);
    await arm();
    await page.locator("[data-placement-document-file]").setInputFiles({
      name: "ui-polish.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        !document.querySelector(".demo-shell").inert,
    );
    await idle();
    assert.equal(await page.locator("#placement-inspector-dock").count(), 1);
    assert.equal(
      await page.locator("#placement-inspector-dock[hidden]").count(),
      0,
    );
    assert(
      await page
        .locator(".placement-viewport-toolbar .placement-spatial-camera")
        .count(),
    );
    for (const field of ["rotation", "scale"]) {
      assert.match(
        await page
          .locator(`[data-placement-spatial-add-${field}]`)
          .evaluate((element) => element.labels[0]?.textContent),
        field === "rotation" ? /Rotation.*°/ : /Scale.*×/,
      );
    }
    await showPlacementInspector(page, "placement");
    const checkbox = await page
      .locator("[data-placement-spatial-repeat]")
      .boundingBox();
    assert(
      checkbox.width <= 16 && checkbox.height <= 16,
      JSON.stringify(checkbox),
    );
    const spatialBaseline = await snapshot();
    await arm();
    await page.locator('[data-placement-mode="2d"]').click();
    await idle();
    await arm();
    await page.locator('[data-placement-mode="spatial"]').click();
    await idle();
    assert.deepEqual(await snapshot(), spatialBaseline);

    await showPlacementBottom(page, "runtime");
    await wait(
      () => globalThis.ferrumPlacementSelectedRuntime?.mode === "spatial",
    );
    assert.match(
      await page.locator("[data-placement-runtime-summary]").innerText(),
      /Read-only[\s\S]*FSM[\s\S]*Health[\s\S]*Timer/,
    );
    assert.equal(
      await page.locator("[data-placement-runtime-raw]").getAttribute("open"),
      null,
    );
    await showPlacementBottom(page, "assets");

    for (const mode of ["2d", "spatial"]) {
      await page.locator(`[data-placement-mode="${mode}"]`).click();
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 720 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await measure(`${mode}-${viewport.width}x${viewport.height}`);
        if (viewport.width <= 860) {
          for (const name of ["scene", "inspector", "runtime"]) {
            await dock(name).click();
            assert.equal(
              await page
                .locator(".demo-shell")
                .getAttribute("data-compact-panel"),
              name,
            );
            await measure(`${mode}-${viewport.width}-${name}`);
            if (name === "scene") {
              await page
                .getByRole("searchbox", { name: "Search scene" })
                .focus();
              await page.keyboard.press("Escape");
              assert.equal(
                await page
                  .locator(".demo-shell")
                  .getAttribute("data-compact-panel"),
                "scene",
              );
            }
            await page.locator("[data-placement-drawer-close]").click();
            assert.equal(
              await dock(name).evaluate(
                (element) => element === document.activeElement,
              ),
              true,
            );
          }
        }
      }
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    // Compact layout is transient; preserve saved desktop preferences and all authored data.
    await page.locator('[data-placement-dock-resize="inspector"]').focus();
    await page.keyboard.press("Home");
    const layout = await page.evaluate(() =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(localStorage).filter(([key]) =>
            key.startsWith("ferrum.placement.layout.v1:"),
          ),
        ),
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("[data-placement-compact-viewport]").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(".demo-shell").getAttribute("data-compact-panel"),
      "scene",
    );
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator(".demo-shell").getAttribute("data-compact-panel"),
      "inspector",
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator(".demo-shell").getAttribute("data-compact-panel"),
      "none",
    );
    assert.equal(
      await dock("inspector").evaluate(
        (element) => element === document.activeElement,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(localStorage).filter(([key]) =>
              key.startsWith("ferrum.placement.layout.v1:"),
            ),
          ),
        ),
      ),
      layout,
    );
    assert.deepEqual(await snapshot(), spatialBaseline);

    // Drawer close changes canvas dimensions: verify real terrain projection and native placement.
    await dock("scene").click();
    await arm();
    await page.locator("[data-placement-drawer-close]").click();
    await paint();
    const point = await page.evaluate(() =>
      globalThis.ferrumPlacementSpatialProject({ x: 40, y: 80, elevation: 40 }),
    );
    assert(point?.visible);
    await page.mouse.click(point.x, point.y);
    await wait(
      () => globalThis.ferrumPlacementViewerState.instances.length === 3,
    );
    const placed = await page.evaluate(
      () => globalThis.ferrumPlacementViewerState.selected,
    );
    assert.equal(placed.body.heightSpan.floorId, 1);
    assert(
      Math.abs(placed.transform.x - 40) < 1 &&
        Math.abs(placed.transform.y - 80) < 1,
    );
    assert.equal((await snapshot()).undo, spatialBaseline.undo + 1);
    assert.equal(
      await page
        .locator('.placement-file-strip [data-status="readonly"]')
        .textContent(),
      "Export Only",
    );
    assert.equal(
      await page.locator('.placement-file-strip [data-status="dirty"]').count(),
      1,
    );
    const dirty = await snapshot();
    await showPlacementInspector(page, "properties");
    const x = page.locator('[data-placement-spatial-field="x"]');
    await x.fill("35");
    await x.press("Tab");
    await wait(
      () => globalThis.ferrumPlacementViewerState.selected.transform.x === 35,
    );
    await page.locator("[data-placement-drawer-close]").click();
    await page.locator('[data-placement-action="undo"]').click();
    assert.equal((await snapshot()).document, dirty.document);
    for (const name of ["scene", "runtime"]) {
      await dock(name).click();
      await page.locator("[data-placement-drawer-close]").click();
    }
    assert.equal((await snapshot()).document, dirty.document);
    await page.locator('[data-placement-action="undo"]').click();
    assert.equal((await snapshot()).document, spatialBaseline.document);
    await page.setViewportSize({ width: 1280, height: 900 });
    await paint();
    assert.equal(
      Math.round(
        (await page.locator(".placement-inspector:visible").boundingBox())
          .width,
      ),
      240,
    );
    assert.deepEqual(errors, []);
    const report = {
      sevenItems: true,
      handoffAt320And240: true,
      labelledInputs: true,
      inspectorOrderAndFixedTools: true,
      exportOnlyAndFavorites: true,
      compactDrawersAndFocus: true,
      desktopPreferencesPreserved: true,
      assetToolLifecycle: true,
      compactNativePlacementAndUndo: true,
      runtimeSummaryBeforeCollapsedJson: true,
      measurements,
      errors,
    };
    await writeFile(
      `${directory}/ui-smoke.json`,
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
