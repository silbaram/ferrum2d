import { clickPlacementControl, showPlacementBottom } from "./placement-panel-navigation.mjs";
import { smokePlacementSixPanels } from "./placement-six-panels-smoke.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { smokeAuthoringUpgrades } from "./placement-authoring-upgrades-smoke.mjs";
import { smokeSpatialObjectPlacement } from "./placement-spatial-placement-smoke.mjs";
import { smokePlacementUiPolish } from "./placement-ui-polish-smoke.mjs";
import { smokePlacementUiReviewFixes } from "./placement-ui-review-fixes-smoke.mjs";
import { smokePlacementViewportSizing } from "./placement-viewport-sizing-smoke.mjs";
import { smokePlacementSpatialAssetRefresh } from "./placement-spatial-asset-refresh-smoke.mjs";

export async function smokePlacementSpatialWorkspace(page, timeoutMs) {
  const wait = async (fn, arg) => {
    try {
      return await page.waitForFunction(fn, arg, { timeout: timeoutMs });
    } catch (error) {
      await mkdir("artifacts/authoring-workspace-upgrades", {
        recursive: true,
      });
      await page.screenshot({
        path: "artifacts/authoring-workspace-upgrades/failure-spatial.png",
        fullPage: true,
      });
      throw new Error(
        "Spatial workspace check failed: " +
          fn +
          "\n" +
          JSON.stringify(
            await page.evaluate(() => ({
              mode: globalThis.ferrumPlacementWorkspaceMode,
              target: globalThis.ferrumPlacementSpatialTarget,
              history: globalThis.ferrumPlacementViewerHistory,
              errors: document.querySelector(".placement-workspace-message")
                ?.textContent,
            })),
          ) +
          "\n" +
          error.stack,
      );
    }
  };
  const bytes = await readFile("examples/data-scene-native/assets/rock.glb");
  const contentId = createHash("sha256").update(bytes).digest("hex");
  async function importModel(targetPage, id = "rock", modelBytes = bytes) {
    await showPlacementBottom(targetPage, "assets");
    await targetPage.locator("[data-placement-model-key]:visible").fill(id);
    await targetPage.evaluate(() => {
      globalThis.__modelImported = false;
      window.addEventListener(
        "ferrum-placement-model-import",
        () => {
          globalThis.__modelImported = true;
        },
        { once: true },
      );
    });
    await targetPage
      .locator("[data-placement-model-file]:visible")
      .setInputFiles({
        name: id + ".glb",
        mimeType: "model/gltf-binary",
        buffer: modelBytes,
      });
    await targetPage.waitForFunction(
      () => globalThis.__modelImported,
      undefined,
      { timeout: timeoutMs },
    );
  }
  await importModel(page);
  const components = {
    visual: {
      kind: "sprite",
      asset: "crate",
      width: 20,
      height: 32,
      originX: 0.5,
      originY: 1,
    },
    collider: { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: false },
    layer: "wall",
    body: {
      type: "static",
      heightSpan: { elevation: 0, height: 32, floorId: 0 },
    },
  };
  const source = {
    format: "ferrum2d.consumer.scene-authoring",
    version: 1,
    behaviorRecipes: { entities: {} },
    sceneComposition: {
      initialFragment: "main",
      prefabs: { object: { props: { components } } },
      fragments: {
        main: {
          instances: [
            { id: "sprite", prefab: "object", x: -40, y: 0 },
            { id: "rock", prefab: "object", x: 40, y: 0 },
          ],
        },
      },
    },
    spatial: {
      camera: {
        projection: "orthographic",
        position: { x: 160, y: -240, elevation: 220 },
        target: { x: 0, y: 25, elevation: 0 },
        height: 240,
        near: 0.1,
        far: 2000,
      },
      terrain: [
        {
          id: "ground",
          x: -100,
          y: -80,
          width: 200,
          depth: 220,
          elevation: 0,
          color: [0.12, 0.3, 0.2, 1],
        },
        {
          id: "bridge",
          x: 0,
          y: 50,
          width: 80,
          depth: 60,
          elevation: 40,
          baseElevation: 32,
          floorId: 1,
          kind: "bridge",
          color: [0.5, 0.4, 0.2, 1],
        },
        {
          id: "ramp",
          x: -80,
          y: 20,
          width: 40,
          depth: 80,
          elevation: 0,
          endElevation: 40,
          floorId: 2,
          kind: "ramp",
          color: [0.2, 0.35, 0.6, 1],
        },
      ],
      billboards: { sprite: {} },
      models: { rock: { asset: "rock", contentId, scale: 1 } },
    },
  };
  const open = async (doc, name = "spatial.scene.json") => {
    await page.locator("[data-placement-document-file]").setInputFiles({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(doc)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        !document.querySelector(".demo-shell").inert,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  };
  await open(source);
  await smokePlacementViewportSizing(page, timeoutMs, "spatial");
  const project = (point) =>
    page.evaluate(
      (point) => globalThis.ferrumPlacementSpatialProject(point),
      point,
    );
  for (const [surfaceId, point] of [
    ["bridge", { x: 40, y: 80, elevation: 40 }],
    ["ramp", { x: -60, y: 60, elevation: 20 }],
    ["ground", { x: -20, y: -40, elevation: 0 }],
  ]) {
    await wait(
      (point) => globalThis.ferrumPlacementSpatialProject(point)?.visible,
      point,
    );
    const screen = await project(point);
    await page.mouse.click(screen.x, screen.y);
    await wait(
      (id) => globalThis.ferrumPlacementSpatialTarget?.id === id,
      surfaceId,
    );
  }
  const dragRamp = async (steps) => {
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const start = await project({ x: -60, y: 60, elevation: 20 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 12, start.y + 6, { steps });
    await page.mouse.up();
    await wait(
      () =>
        globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
        !globalThis.ferrumPlacementViewerHistory.transactionLabel,
    );
    const result = await page.evaluate((start) => {
      const ramp = globalThis
          .ferrumPlacementSpatialExportDocument()
          .spatial.terrain.find((surface) => surface.id === "ramp"),
        end = globalThis.ferrumPlacementSpatialProject({
          x: ramp.x + 20,
          y: ramp.y + 40,
          elevation: 20,
        });
      return {
        delta: { x: end.x - start.x, y: end.y - start.y },
        patch: JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
      };
    }, start);
    if (Math.hypot(result.delta.x - 12, result.delta.y - 6) > 0.1)
      throw new Error(
        "Moving a ramp must follow the final pointer on its original elevation plane: " +
          JSON.stringify(result),
      );
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    await wait(() => !globalThis.ferrumPlacementViewerExportPatch());
    return result.patch;
  };
  if ((await dragRamp(1)) !== (await dragRamp(6)))
    throw new Error(
      "Moving ramp JSON must be independent of pointer event frequency",
    );
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "billboard:sprite",
  );
  await wait(
    () => globalThis.ferrumPlacementSpatialSelection?.target?.id === "sprite",
  );
  const spriteScreen = await project({ x: -40, y: 0, elevation: 16 });
  await page.mouse.click(spriteScreen.x, spriteScreen.y);
  await wait(
    () => globalThis.ferrumPlacementSpatialTarget?.kind === "billboard",
  );
  const startAnchor = await project({ x: -40, y: 0, elevation: 0 });
  await page.mouse.move(spriteScreen.x, spriteScreen.y);
  await page.mouse.down();
  await page.mouse.move(spriteScreen.x + 12, spriteScreen.y + 6, { steps: 6 });
  await page.mouse.up();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  const moved = await page.evaluate(
    () => globalThis.ferrumPlacementViewerState.selected.transform,
  );
  const endAnchor = await project({ x: moved.x, y: moved.y, elevation: 0 });
  if (
    Math.abs(endAnchor.x - startAnchor.x - 12) > 1 ||
    Math.abs(endAnchor.y - startAnchor.y - 6) > 1
  )
    throw new Error("Spatial XY drag did not apply its final pointer position");
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  const numeric = async (name, value) => {
    await page
      .locator('[data-placement-spatial-field="' + name + '"]:visible')
      .fill(String(value));
    await page.locator("canvas.demo-canvas").focus();
  };
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "model:rock",
  );
  await numeric("yaw", 10);
  await wait(() => {
    const patch = globalThis.ferrumPlacementViewerExportPatch();
    return (
      patch?.operations.length === 0 && patch.spatial?.operations.length === 1
    );
  });
  if (
    (await page
      .locator(".placement-state-badge[data-status=dirty]")
      .count()) !== 1 ||
    !(await page
      .locator(".placement-state-badge")
      .filter({ hasText: "1 Change" })
      .isVisible()) ||
    (await page.locator("[data-draft-count='1']").count()) === 0 ||
    (await page
      .locator("[data-placement-action=copy-patch]:visible")
      .isDisabled())
  )
    throw new Error("Spatial-only draft must update dirty/count/copy controls");
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  await wait(() => !globalThis.ferrumPlacementViewerExportPatch());
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "billboard:sprite",
  );
  await numeric("x", -36);
  await numeric("elevation", 12);
  await numeric("floorId", 1);
  await numeric("offset", 3);
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selected.body.heightSpan
        .elevation === 12 &&
      globalThis.ferrumPlacementViewerState.selected.body.heightSpan.floorId ===
        1,
  );
  const beforeHeight = await page.evaluate(() =>
    JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
  );
  const undoBefore = await page.evaluate(
    () => globalThis.ferrumPlacementViewerHistory.undoCount,
  );
  const handle = page.locator("[data-placement-spatial-height]:visible"),
    h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y - 24, { steps: 4 });
  await page.mouse.up();
  await wait(
    (count) => globalThis.ferrumPlacementViewerHistory.undoCount === count + 1,
    undoBefore,
  );
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  if (
    (await page.evaluate(() =>
      JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
    )) !== beforeHeight
  )
    throw new Error(
      "Spatial height undo did not restore the entire authored patch",
    );
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "model:rock",
  );
  await numeric("yaw", 30);
  await numeric("scale", 1.5);
  await numeric("offset", 2);
  await wait(
    () => globalThis.ferrumPlacementSpatialSelection?.target?.kind === "model",
  );
  const modelBounds = await page.evaluate(
    () => globalThis.ferrumPlacementSpatialSelection.bounds,
  );
  await page.mouse.click(
    modelBounds.reduce((n, p) => n + p.x, 0) / modelBounds.length,
    modelBounds.reduce((n, p) => n + p.y, 0) / modelBounds.length,
  );
  await wait(() => globalThis.ferrumPlacementSpatialTarget?.kind === "model");
  const documentBefore = await page.evaluate(() =>
    globalThis.ferrumPlacementSpatialExportDocument(),
  );
  const historyBefore = await page.evaluate(
    () => globalThis.ferrumPlacementViewerHistory.undoCount,
  );
  await clickPlacementControl(page, "[data-placement-spatial-camera=left]");
  await clickPlacementControl(page, "[data-placement-spatial-camera=in]");
  const camera = await page.evaluate(
    () => globalThis.ferrumPlacementSpatialCamera,
  );
  if (
    JSON.stringify(
      await page.evaluate(() =>
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
    ) !== JSON.stringify(documentBefore)
  )
    throw new Error("Edit camera changed authored document");
  await page.click("[data-placement-mode=game]");
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "game");
  if (!(await page.locator("[data-placement-action=undo]").isDisabled()))
    throw new Error("Game Preview must disable authoring Undo");
  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("ArrowRight");
  await page.click("[data-placement-mode=spatial]");
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
  if (await page.locator("[data-placement-action=undo]").isDisabled())
    throw new Error("Stopping Preview must restore authoring Undo");
  if (
    JSON.stringify(
      await page.evaluate(() =>
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
    ) !== JSON.stringify(documentBefore) ||
    (await page.evaluate(
      () => globalThis.ferrumPlacementViewerHistory.undoCount,
    )) !== historyBefore
  )
    throw new Error("Game Preview stop changed draft or history");
  if (
    JSON.stringify(
      await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera),
    ) !== JSON.stringify(camera)
  )
    throw new Error("Game Preview stop lost edit camera");
  const evidence = await page.evaluate(
    () => globalThis.ferrumPlacementViewerAgentHandoff.authoringEvidence,
  );
  if (
    !evidence?.selectedSourcePaths.some((path) =>
      path.includes("/spatial/models/rock"),
    ) ||
    !evidence.changes.some(
      (change) =>
        change.path === "/spatial/models/rock/yawDegrees" &&
        change.after === 30,
    ) ||
    !evidence.changes.some(
      (change) =>
        (change.path.includes("/heightSpan/floorId") && change.after === 1) ||
        (change.path.endsWith("/props") &&
          change.after?.components?.body?.heightSpan?.floorId === 1),
    )
  )
    throw new Error(
      "Agent source/diff evidence missing " + JSON.stringify(evidence),
    );
  for (const label of ["Problems", "Selected Runtime", "Agent Changes"]) {
    await showPlacementBottom(
      page,
      label === "Problems"
        ? "problems"
        : label === "Selected Runtime"
          ? "runtime"
          : "changes",
    );
    if (
      !(await page
        .locator(`details[data-placement-diagnostic-section="${label}"] > div`)
        .isVisible())
    )
      throw new Error(`${label} must be visible in its selected bottom tab`);
  }
  await showPlacementBottom(page, "runtime");
  await wait(
    () =>
      globalThis.ferrumPlacementSelectedRuntime?.instanceId === "rock" &&
      globalThis.ferrumPlacementSelectedRuntime.runtime?.x === 40,
  );
  if (!(await page.locator("[data-placement-runtime-summary]").isVisible()))
    throw new Error("Selected native runtime values must be visible");
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "surface:bridge",
  );
  await numeric("elevation", 48);
  await wait(() =>
    globalThis.ferrumPlacementWorkspaceEvidence.selectedSourcePaths.some(
      (path) => path.includes("/spatial/terrain/1"),
    ),
  );
  const raised = await page.evaluate(() =>
    globalThis
      .ferrumPlacementSpatialExportDocument()
      .spatial.terrain.find((s) => s.id === "bridge"),
  );
  if (
    raised.elevation !== 48 ||
    raised.endElevation !== 48 ||
    raised.baseElevation !== 40
  )
    throw new Error("Surface height did not move top/end/base together");
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  await mkdir("artifacts/placement-spatial-workspace", { recursive: true });
  await page.screenshot({
    path: "artifacts/placement-spatial-workspace/hd2d.png",
    fullPage: true,
  });
  await open(documentBefore, "reopened-spatial.scene.json");
  await wait(() => globalThis.ferrumPlacementWorkspaceDocuments.length === 3);
  const reopened = await page.evaluate(() =>
    globalThis.ferrumPlacementSpatialExportDocument(),
  );
  if (JSON.stringify(reopened) !== JSON.stringify(documentBefore))
    throw new Error("Spatial reopen changed authored document");
  const nextPaint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const assertCameraPan = async (gesture = "middle") => {
    await nextPaint();
    const selectionBefore = await page.evaluate(() => JSON.stringify([
      globalThis.ferrumPlacementSpatialTarget,
      globalThis.ferrumPlacementViewerState.selectedInstanceIds,
    ]));
    const before = await page.evaluate(
      () => globalThis.ferrumPlacementSpatialCamera,
    );
    const before2d = await page.evaluate(() => ({
      ui: globalThis.ferrumPlacementEditCamera,
      x: globalThis.ferrumEngine.cameraX(),
      y: globalThis.ferrumEngine.cameraY(),
    }));
    const anchor = { ...before.target },
      start = await project(anchor);
    if (gesture === "pan")
      await page.click("[data-placement-spatial-navigation=pan]");
    if (gesture === "h") {
      await page.locator("canvas.demo-canvas").focus();
      await page.keyboard.press("h");
    }
    if (gesture === "space") {
      await page.locator("canvas.demo-canvas").focus();
      await page.keyboard.press("v");
      await page.keyboard.down("Space");
    }
    await page.mouse.move(start.x, start.y);
    const button = gesture === "middle" ? "middle" : "left";
    await page.mouse.down({ button });
    await page.mouse.move(start.x + 24, start.y + 12, { steps: 4 });
    await page.mouse.up({ button });
    if (gesture === "space") await page.keyboard.up("Space");
    if (gesture === "pan" || gesture === "h") {
      await page.keyboard.press("v");
      if (await page.getAttribute("[data-placement-spatial-navigation=select]", "aria-pressed") !== "true")
        throw new Error("V did not restore spatial selection");
    }
    await nextPaint();
    const end = await project(anchor),
      after = await page.evaluate(
        () => globalThis.ferrumPlacementSpatialCamera,
      );
    const after2d = await page.evaluate(() => ({
      ui: globalThis.ferrumPlacementEditCamera,
      x: globalThis.ferrumEngine.cameraX(),
      y: globalThis.ferrumEngine.cameraY(),
    }));
    if (JSON.stringify(before2d) !== JSON.stringify(after2d))
      throw new Error(
        "HD-2D pan was intercepted by the inactive 2D navigation tool: " +
          JSON.stringify({ before2d, after2d }),
      );
    if (await page.evaluate(() => JSON.stringify([
      globalThis.ferrumPlacementSpatialTarget,
      globalThis.ferrumPlacementViewerState.selectedInstanceIds,
    ])) !== selectionBefore)
      throw new Error("Spatial camera pan changed object selection");
    if (Math.hypot(end.x - start.x - 24, end.y - start.y - 12) > 0.25)
      throw new Error(
        "Camera pan must track screen motion after orbit/zoom: " +
          JSON.stringify({ before, after, start, end }),
      );
    return Math.hypot(
      after.target.x - before.target.x,
      after.target.y - before.target.y,
    );
  };
  const orthographicBeforePan = await page.evaluate(() => ({
    document: JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
    history: JSON.stringify(globalThis.ferrumPlacementViewerHistory),
  }));
  for (let i = 0; i < 6; i++)
    await clickPlacementControl(page, "[data-placement-spatial-camera=right]");
  await assertCameraPan();
  await assertCameraPan("pan");
  await assertCameraPan("space");
  await assertCameraPan("h");
  const cancelCamera = await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera);
  const cancelStart = await project(cancelCamera.target);
  await page.keyboard.press("h");
  await page.mouse.move(cancelStart.x, cancelStart.y);
  await page.mouse.down();
  await page.mouse.move(cancelStart.x + 36, cancelStart.y + 18, { steps: 3 });
  const duringPan = await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera);
  await page.mouse.wheel(0, -100);
  await nextPaint();
  if (JSON.stringify(await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera)) !== JSON.stringify(duringPan))
    throw new Error("Wheel changed the spatial camera during a drag");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  if (JSON.stringify(await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera)) !== JSON.stringify(cancelCamera))
    throw new Error("Escape did not restore the spatial pan camera");
  await page.keyboard.press("v");
  const assertWheel = async () => {
    const before = await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera),
      start = await project(before.target);
    await page.mouse.move(start.x, start.y);
    await page.mouse.wheel(0, -100);
    await wait((camera) => JSON.stringify(globalThis.ferrumPlacementSpatialCamera) !== JSON.stringify(camera), before);
    const after = await page.evaluate(() => globalThis.ferrumPlacementSpatialCamera);
    if (before.projection === "orthographic") {
      if (!(after.height < before.height)) throw new Error("Orthographic wheel did not zoom in");
    } else {
      const distance = (c) => Math.hypot(c.position.x-c.target.x, c.position.y-c.target.y, c.position.elevation-c.target.elevation);
      if (!(distance(after) < distance(before))) throw new Error("Perspective wheel did not zoom in");
    }
    await page.mouse.wheel(0, 100);
    await wait((camera) => {
      const after = globalThis.ferrumPlacementSpatialCamera;
      return Math.abs(after.position.x-camera.position.x) < 1e-6 && Math.abs((after.height ?? 0)-(camera.height ?? 0)) < 1e-6;
    }, before);
  };
  await assertWheel();
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        JSON.stringify(globalThis.ferrumPlacementViewerHistory) !==
          before.history,
      orthographicBeforePan,
    )
  )
    throw new Error("Orthographic edit camera changed authored data/history");
  const perspective = structuredClone(source);
  perspective.spatial.camera.projection = "perspective";
  perspective.spatial.camera.fovDegrees = 55;
  await open(perspective, "perspective.scene.json");
  await wait(() => globalThis.ferrumPlacementWorkspaceDocuments.length === 4);
  const perspectivePoint = await project({ x: 40, y: 80, elevation: 40 });
  if (!perspectivePoint?.visible)
    throw new Error("Perspective camera did not render the bridge");
  await page.mouse.click(perspectivePoint.x, perspectivePoint.y);
  await wait(() => globalThis.ferrumPlacementSpatialTarget?.id === "bridge");
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "billboard:sprite",
  );
  await nextPaint();
  const perspectiveHeightHandle = page.locator(
      "[data-placement-spatial-height]:visible",
    ),
    perspectiveHeightBefore = await perspectiveHeightHandle.boundingBox(),
    cameraBeforeHeight = await page.evaluate(() =>
      JSON.stringify(globalThis.ferrumPlacementSpatialCamera),
    );
  await page.mouse.move(
    perspectiveHeightBefore.x + perspectiveHeightBefore.width / 2,
    perspectiveHeightBefore.y + perspectiveHeightBefore.height / 2,
  );
  await page.mouse.down();
  await page
    .locator("[data-placement-spatial-camera=left]")
    .evaluate((button) => button.click());
  if (
    (await page.evaluate(() =>
      JSON.stringify(globalThis.ferrumPlacementSpatialCamera),
    )) !== cameraBeforeHeight
  )
    throw new Error(
      "Camera controls must preserve the coordinate system of an active object gesture",
    );
  await page.mouse.move(
    perspectiveHeightBefore.x + perspectiveHeightBefore.width / 2,
    perspectiveHeightBefore.y + perspectiveHeightBefore.height / 2 - 60,
    { steps: 6 },
  );
  await page.mouse.up();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  await nextPaint();
  const perspectiveHeightAfter = await perspectiveHeightHandle.boundingBox();
  if (Math.abs(perspectiveHeightAfter.y - perspectiveHeightBefore.y + 60) > 0.1)
    throw new Error(
      "Perspective Height handle must follow the exact screen Y: " +
        JSON.stringify({
          before: perspectiveHeightBefore,
          after: perspectiveHeightAfter,
        }),
    );
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  await wait(() => !globalThis.ferrumPlacementViewerExportPatch());
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "surface:bridge",
  );
  const perspectiveBeforePan = await page.evaluate(() => ({
    document: JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
    history: JSON.stringify(globalThis.ferrumPlacementViewerHistory),
  }));
  for (let i = 0; i < 6; i++)
    await clickPlacementControl(page, "[data-placement-spatial-camera=right]");
  const nearPanDistance = await assertCameraPan();
  await clickPlacementControl(page, "[data-placement-spatial-camera=out]");
  const farPanDistance = await assertCameraPan();
  await assertCameraPan("pan");
  await assertCameraPan("space");
  await assertCameraPan("h");
  await assertWheel();
  if (Math.abs(farPanDistance / nearPanDistance - 1.25) > 0.01)
    throw new Error(
      "Perspective pan speed must follow camera distance: " +
        JSON.stringify({ nearPanDistance, farPanDistance }),
    );
  const zoomBounds = await page.evaluate(() => {
    const zoomIn = document.querySelector("[data-placement-spatial-camera=in]"),
      zoomOut = document.querySelector("[data-placement-spatial-camera=out]");
    for (let i = 0; i < 200; i++) zoomIn.click();
    const near = structuredClone(globalThis.ferrumPlacementSpatialCamera);
    for (let i = 0; i < 200; i++) zoomOut.click();
    const far = structuredClone(globalThis.ferrumPlacementSpatialCamera);
    document.querySelector("[data-placement-spatial-camera=reset]").click();
    const distance = (camera) =>
      Math.hypot(
        camera.position.x - camera.target.x,
        camera.position.y - camera.target.y,
        camera.position.elevation - camera.target.elevation,
      );
    return {
      near: distance(near),
      far: distance(far),
      error: document.querySelector(".placement-spatial-message").textContent,
    };
  });
  if (
    !Number.isFinite(zoomBounds.near) ||
    zoomBounds.near < 0.999 ||
    !Number.isFinite(zoomBounds.far) ||
    zoomBounds.far > 1800.001 ||
    zoomBounds.error
  )
    throw new Error(
      "Repeated perspective zoom must remain valid and recoverable: " +
        JSON.stringify(zoomBounds),
    );
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        JSON.stringify(globalThis.ferrumPlacementViewerHistory) !==
          before.history,
      perspectiveBeforePan,
    )
  )
    throw new Error(
      "Perspective camera controls changed authored data/history",
    );

  // Authored sprite rotation and model style yaw are separate from native body
  // yaw. Attachment-local yaw accumulates in body space; root model scale/yaw
  // must not rotate or scale attachment offsets.
  const attached = structuredClone(source);
  attached.spatial.terrain = [attached.spatial.terrain[0]];
  // Surface IDs and instance IDs have independent namespaces.
  attached.spatial.terrain[0].id = "sprite";
  attached.sceneComposition.fragments.main.instances = [
    {
      id: "rock",
      prefab: "object",
      x: -55,
      y: -20,
      rotationRadians: Math.PI / 4,
    },
    { id: "arm", prefab: "object", x: 0, y: 0 },
    { id: "sprite", prefab: "object", x: 0, y: 0, rotationRadians: 0.25 },
  ];
  attached.spatial.models = {
    rock: {
      asset: "rock",
      contentId,
      yawDegrees: 60,
      scale: 1.3,
      elevation: 3,
    },
    arm: { asset: "rock", contentId, yawDegrees: 30, scale: 0.5, elevation: 4 },
  };
  attached.spatial.attachments = {
    arm: { parent: "rock", x: 40, elevation: 15, yawDegrees: 90 },
    sprite: { parent: "arm", x: 30, elevation: 7, yawDegrees: -30 },
  };
  await open(attached, "attached.scene.json");
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "model:rock",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const rootBounds = await page.evaluate(() => {
    const angle = Math.PI / 3,
      scale = 1.3,
      points = [];
    for (const x of [-14, 18])
      for (const y of [0, 24])
        for (const z of [-13, 15])
          points.push(
            globalThis.ferrumPlacementSpatialProject({
              x: -55 + scale * (x * Math.cos(angle) + z * Math.sin(angle)),
              y: -20 + scale * (x * Math.sin(angle) - z * Math.cos(angle)),
              elevation: 3 + scale * y,
            }),
          );
    const actual = globalThis.ferrumPlacementSpatialSelection.bounds;
    const native = globalThis.ferrumEngine.getPhysicsEntity(
      globalThis.ferrumPlacementViewerState.selected.entity,
    );
    return {
      nativeRotation: native.rotationRadians,
      expected: [
        Math.min(...points.map((p) => p.x)),
        Math.min(...points.map((p) => p.y)),
        Math.max(...points.map((p) => p.x)),
        Math.max(...points.map((p) => p.y)),
      ],
      actual: [
        Math.min(...actual.map((p) => p.x)),
        Math.min(...actual.map((p) => p.y)),
        Math.max(...actual.map((p) => p.x)),
        Math.max(...actual.map((p) => p.y)),
      ],
    };
  });
  if (
    rootBounds.nativeRotation !== 0 ||
    rootBounds.actual.some(
      (value, index) => Math.abs(value - rootBounds.expected[index]) > 0.1,
    )
  )
    throw new Error(
      "Model bounds must use style yaw/scale independently of authored sprite rotation: " +
        JSON.stringify(rootBounds),
    );
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "billboard:sprite",
  );
  await wait(
    () => globalThis.ferrumPlacementSpatialSelection?.target?.id === "sprite",
  );
  const attachedGeometry = await page.evaluate(() => {
    const state = globalThis.ferrumPlacementViewerState;
    const native = globalThis.ferrumEngine.getPhysicsEntity(
      state.selected.entity,
    );
    const camera = globalThis.ferrumPlacementSpatialCamera;
    const dx = camera.target.x - camera.position.x;
    const dy = camera.target.y - camera.position.y;
    const len = Math.hypot(dx, dy);
    const angle =
      native.rotationRadians + state.selected.transform.rotationRadians;
    const points = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([u, v]) => {
      const x = (u - 0.5) * 20;
      const y = (1 - v) * 32;
      const width = x * Math.cos(angle) - y * Math.sin(angle);
      return globalThis.ferrumPlacementSpatialProject({
        x: native.x + (dy / len) * width,
        y: native.y - (dx / len) * width,
        elevation:
          native.heightSpan.elevation +
          x * Math.sin(angle) +
          y * Math.cos(angle),
      });
    });
    return {
      native,
      points,
      actual: globalThis.ferrumPlacementSpatialSelection.bounds,
    };
  });
  if (
    Math.abs(attachedGeometry.native.x + 15) > 0.001 ||
    Math.abs(attachedGeometry.native.y - 10) > 0.001 ||
    Math.abs(attachedGeometry.native.heightSpan.elevation - 22) > 0.001 ||
    attachedGeometry.actual.some(
      (point, index) =>
        Math.hypot(
          point.x - attachedGeometry.points[index].x,
          point.y - attachedGeometry.points[index].y,
        ) > 0.1,
    )
  )
    throw new Error(
      "Attached billboard bounds disagree with native pose and sprite angle: " +
        JSON.stringify(attachedGeometry),
    );
  const center = attachedGeometry.points.reduce(
    (sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }),
    { x: 0, y: 0 },
  );
  await page.mouse.click(center.x, center.y);
  await wait(() => globalThis.ferrumPlacementSpatialTarget?.id === "sprite");
  for (const field of ["x", "y", "elevation", "floorId"]) {
    if (
      !(await page
        .locator('[data-placement-spatial-field="' + field + '"]:visible')
        .isDisabled())
    )
      throw new Error("Attachment-owned field must be disabled: " + field);
  }
  if (await page.locator("[data-placement-spatial-height]").isVisible())
    throw new Error(
      "Attachment-owned physical height must not have a drag handle",
    );
  const attachedBefore = await page.evaluate(() => ({
    document: JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
    history: globalThis.ferrumPlacementViewerHistory,
  }));
  await page.evaluate(() => {
    document.querySelector("[data-placement-spatial-height]").dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        pointerId: 991,
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        pointerId: 991,
        buttons: 1,
        clientX: 100,
        clientY: 70,
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, pointerId: 991 }),
    );
  });
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !==
          before.history.undoCount ||
        globalThis.ferrumPlacementViewerHistory.transactionLabel !== undefined,
      attachedBefore,
    )
  )
    throw new Error(
      "Rejected attachment Height input changed the document or history",
    );

  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "surface:sprite",
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  if (
    (await page
      .locator('[data-placement-spatial-field="elevation"]:visible')
      .isDisabled()) ||
    !(await page.locator("[data-placement-spatial-height]").isVisible())
  )
    throw new Error(
      "A surface must not inherit an unrelated instance attachment's edit ownership",
    );

  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "model:rock",
  );
  const beforeRejectedInput = await page.evaluate(() => ({
    document: JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
    undo: globalThis.ferrumPlacementViewerHistory.undoCount,
    redo: globalThis.ferrumPlacementViewerHistory.redoCount,
  }));
  // The JSON is finite, but native attachments reject roots outside +/-1M.
  await numeric("x", 10000000);
  await wait(
    () =>
      !!document.querySelector(".placement-spatial-message").textContent &&
      globalThis.ferrumPlacementViewerState.selected.transform.x === -55 &&
      globalThis.ferrumEngine.gameplayEntityExists(
        globalThis.ferrumPlacementViewerState.selected.entity,
      ),
  );
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !== before.undo ||
        globalThis.ferrumPlacementViewerHistory.redoCount !== before.redo ||
        globalThis.ferrumPlacementViewerHistory.transactionLabel !==
          undefined ||
        globalThis.ferrumEngine.getPhysicsEntity(
          globalThis.ferrumPlacementViewerState.selected.entity,
        ).x !== -55,
      beforeRejectedInput,
    )
  )
    throw new Error(
      "Native-rejected numeric edit must restore draft, history, registry and runtime",
    );

  const startHeightDrag = async () => {
    const box = await page
      .locator("[data-placement-spatial-height]:visible")
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 12, { steps: 3 });
    await wait(
      () =>
        !!globalThis.ferrumPlacementViewerExportPatch() &&
        globalThis.ferrumPlacementViewerHistory.transactionLabel ===
          "Spatial Height",
    );
  };
  const acceptedGesture = () =>
    page.evaluate(() => ({
      patch: JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
      document: JSON.stringify(
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
      active: globalThis.ferrumPlacementWorkspaceActiveDocument,
      history: globalThis.__ferrumPlacementViewer.historyState(),
      native: globalThis.ferrumEngine.getPhysicsEntity(
        globalThis.ferrumPlacementViewerState.selected.entity,
      ),
    }));
  const rejectNextCancellation = () =>
    page.evaluate(() => {
      const engine = globalThis.ferrumEngine,
        original = engine.configureDataSceneSpatial;
      globalThis.__placementCancelFailure = { injected: false };
      engine.configureDataSceneSpatial = (...args) => {
        if (!globalThis.__placementCancelFailure.injected) {
          globalThis.__placementCancelFailure.injected = true;
          return false;
        }
        return original(...args);
      };
      globalThis.__placementCancelRestore = () => {
        engine.configureDataSceneSpatial = original;
        delete globalThis.__placementCancelFailure;
        delete globalThis.__placementCancelRestore;
      };
    });
  const assertCancellationKeptGesture = async (accepted) => {
    if (
      !(await page.evaluate((accepted) => {
        const history = globalThis.__ferrumPlacementViewer.historyState(),
          state = globalThis.ferrumPlacementViewerState,
          native = globalThis.ferrumEngine.getPhysicsEntity(
            state.selected.entity,
          );
        return (
          globalThis.__placementCancelFailure.injected &&
          globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
          globalThis.ferrumPlacementWorkspaceActiveDocument ===
            accepted.active &&
          JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()) ===
            accepted.patch &&
          JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) ===
            accepted.document &&
          history.transactionLabel === "Spatial Height" &&
          history.undoCount === accepted.history.undoCount &&
          history.redoCount === accepted.history.redoCount &&
          native?.x === accepted.native.x &&
          native?.y === accepted.native.y &&
          native?.heightSpan.elevation ===
            accepted.native.heightSpan.elevation &&
          !!document.querySelector(".placement-spatial-message").textContent
        );
      }, accepted))
    )
      throw new Error(
        "Rejected cancellation must retain the accepted gesture, history, active document and live native pose",
      );
  };
  const restoreCancellationFault = () =>
    page.evaluate(() => globalThis.__placementCancelRestore());

  await startHeightDrag();
  await page.locator("canvas.demo-canvas").focus();
  const acceptedEscapeGesture = await acceptedGesture();
  await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
  if (
    JSON.stringify(await acceptedGesture()) !==
    JSON.stringify(acceptedEscapeGesture)
  )
    throw new Error(
      "Programmatic history controls must preserve an externally owned gesture",
    );
  await rejectNextCancellation();
  await page.keyboard.press("Escape");
  await assertCancellationKeptGesture(acceptedEscapeGesture);
  // A mouse release after failed Escape must retry cancellation, never commit.
  await page.mouse.up();
  await wait(
    () =>
      !globalThis.ferrumPlacementViewerExportPatch() &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  await restoreCancellationFault();
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !== before.undo ||
        globalThis.ferrumPlacementViewerHistory.redoCount !== before.redo,
      beforeRejectedInput,
    )
  )
    throw new Error(
      "Pointer release committed a gesture whose cancellation had failed",
    );

  await startHeightDrag();
  const acceptedModeGesture = await acceptedGesture();
  await rejectNextCancellation();
  await page
    .locator('[data-placement-mode="2d"]')
    .evaluate((button) => button.click());
  await assertCancellationKeptGesture(acceptedModeGesture);
  await restoreCancellationFault();
  // Keyboard activation can change mode while the mouse still owns capture.
  await page
    .locator('[data-placement-mode="2d"]')
    .evaluate((button) => button.click());
  await page.mouse.up();
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "2d");
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !== before.undo ||
        globalThis.ferrumPlacementViewerHistory.redoCount !== before.redo ||
        globalThis.ferrumPlacementViewerHistory.transactionLabel !== undefined,
      beforeRejectedInput,
    )
  )
    throw new Error("Mode change must cancel an unfinished spatial gesture");
  await page
    .locator("input[data-placement-transform-field=x]:visible")
    .fill("10000000");
  await page.locator("canvas.demo-canvas").focus();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selected.transform.x === -55 &&
      globalThis.ferrumPlacementViewerHistory.transactionLabel === undefined &&
      globalThis.ferrumEngine.gameplayEntityExists(
        globalThis.ferrumPlacementViewerState.selected.entity,
      ),
  );
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !== before.undo ||
        globalThis.ferrumPlacementViewerHistory.redoCount !== before.redo ||
        globalThis.ferrumEngine.getPhysicsEntity(
          globalThis.ferrumPlacementViewerState.selected.entity,
        ).x !== -55,
      beforeRejectedInput,
    )
  )
    throw new Error(
      "2D Transform must also roll back native-rejected spatial edits",
    );
  // The old 2D Pan tool must not capture HD-2D Height/placement gestures.
  await page.click("[data-placement-view-action=pan]:visible");
  await page.click("[data-placement-mode=spatial]");
  await wait(() => globalThis.ferrumPlacementWorkspaceMode === "spatial");
  await startHeightDrag();
  const acceptedTabGesture = await acceptedGesture();
  await rejectNextCancellation();
  await page
    .getByRole("tab", { name: "perspective.scene.json", exact: true })
    .evaluate((button) => button.click());
  await assertCancellationKeptGesture(acceptedTabGesture);
  await restoreCancellationFault();
  await page
    .getByRole("tab", { name: "perspective.scene.json", exact: true })
    .evaluate((button) => button.click());
  await page.mouse.up();
  await page
    .getByRole("tab", { name: "attached.scene.json", exact: true })
    .click();
  await wait(() => globalThis.ferrumPlacementSpatialTarget?.id === "rock");
  if (
    await page.evaluate(
      (before) =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()) !==
          before.document ||
        globalThis.ferrumPlacementViewerHistory.undoCount !== before.undo ||
        globalThis.ferrumPlacementViewerHistory.redoCount !== before.redo ||
        globalThis.ferrumPlacementViewerHistory.transactionLabel !== undefined,
      beforeRejectedInput,
    )
  )
    throw new Error("Tab change must cancel an unfinished spatial gesture");

  const treeBytes = await readFile(
    "examples/data-scene-native/assets/tree.glb",
  );
  const treeContentId = createHash("sha256").update(treeBytes).digest("hex");
  await importModel(page, "tree", treeBytes);
  const lod = structuredClone(source);
  lod.spatial.models.rock.lods = [
    { asset: "tree", contentId: treeContentId, minDistance: 1 },
  ];
  await open(lod, "lod.scene.json");
  await page.selectOption(
    "[data-placement-spatial-target]:visible",
    "model:rock",
  );
  await wait(
    () => globalThis.ferrumPlacementSpatialSelection?.target?.id === "rock",
  );
  const lodBounds = await page.evaluate(() => {
    // Fixture union: rock translated (+2,0,+1) and tree canopy at Y=32..96.
    const points = [];
    for (const x of [-32, 32])
      for (const y of [0, 96])
        for (const z of [-13, 15])
          points.push(
            globalThis.ferrumPlacementSpatialProject({
              x: 40 + x,
              y: -z,
              elevation: y,
            }),
          );
    const actual = globalThis.ferrumPlacementSpatialSelection.bounds;
    return {
      expected: [
        Math.min(...points.map((p) => p.x)),
        Math.min(...points.map((p) => p.y)),
        Math.max(...points.map((p) => p.x)),
        Math.max(...points.map((p) => p.y)),
      ],
      actual: [
        Math.min(...actual.map((p) => p.x)),
        Math.min(...actual.map((p) => p.y)),
        Math.max(...actual.map((p) => p.x)),
        Math.max(...actual.map((p) => p.y)),
      ],
    };
  });
  if (
    lodBounds.actual.some(
      (value, index) => Math.abs(value - lodBounds.expected[index]) > 0.1,
    )
  )
    throw new Error(
      "Model selection must include every authored LOD's bounds: " +
        JSON.stringify(lodBounds),
    );
  const dpr = await page
    .context()
    .browser()
    .newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  try {
    await dpr.goto(page.url(), { waitUntil: "networkidle" });
    await dpr.waitForFunction(
      () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
      undefined,
      { timeout: timeoutMs },
    );
    await importModel(dpr);
    await dpr.locator("[data-placement-document-file]").setInputFiles({
      name: "dpr.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await dpr.waitForFunction(
      () => globalThis.ferrumPlacementWorkspaceMode === "spatial",
      undefined,
      { timeout: timeoutMs },
    );
    await dpr.waitForFunction(
      () =>
        globalThis.ferrumPlacementSpatialProject({
          x: 40,
          y: 80,
          elevation: 40,
        })?.visible,
      undefined,
      { timeout: timeoutMs },
    );
    const p = await dpr.evaluate(() =>
      globalThis.ferrumPlacementSpatialProject({ x: 40, y: 80, elevation: 40 }),
    );
    await dpr.mouse.click(p.x, p.y);
    await dpr.waitForFunction(
      () => globalThis.ferrumPlacementSpatialTarget?.id === "bridge",
      undefined,
      { timeout: timeoutMs },
    );
    const alignment = await dpr.evaluate(() => {
      const poly = document
          .querySelector(".placement-spatial-selection polygon")
          .getBoundingClientRect(),
        points = globalThis.ferrumPlacementSpatialSelection.bounds;
      return {
        left: poly.left,
        top: poly.top,
        expectedLeft: Math.min(...points.map((p) => p.x)),
        expectedTop: Math.min(...points.map((p) => p.y)),
        dpr: devicePixelRatio,
      };
    });
    if (
      alignment.dpr !== 2 ||
      Math.abs(alignment.left - alignment.expectedLeft) > 1 ||
      Math.abs(alignment.top - alignment.expectedTop) > 1
    )
      throw new Error(
        "DPR overlay alignment failed " + JSON.stringify(alignment),
      );
    await dpr.screenshot({
      path: "artifacts/placement-spatial-workspace/dpr-2.png",
      fullPage: true,
    });
  } finally {
    await dpr.close();
  }
  const objectPlacement = await smokeSpatialObjectPlacement(
    page,
    source,
    timeoutMs,
  );
  const authoringUpgrades = await smokeAuthoringUpgrades(
    page,
    source,
    timeoutMs,
  );
  const uiPolish = await smokePlacementUiPolish(page, source, timeoutMs);
  const uiReviewFixes = await smokePlacementUiReviewFixes(
    page,
    source,
    timeoutMs,
  );
  return {
    assetRefresh: await smokePlacementSpatialAssetRefresh(page, source, timeoutMs),
    sixPanels: await smokePlacementSixPanels(page, source, timeoutMs),
    uiReviewFixes,
    uiPolish,
    authoringUpgrades,
    objectPlacement,
    spatialWorkspace: {
      terrainRampAndLayers: true,
      modelBoundsAndBillboardPick: true,
      attachmentPoseAndOwnership: true,
      nativeRejectedInputRollback: true,
      modeAndTabGestureCancellation: true,
      modelLodBounds: true,
      cameraPanProjectionAndZoomBounds: true,
      rampDragEventFrequencyIndependent: true,
      perspectiveHeightProjection: true,
      nativeCancellationFailureOwnership: true,
      xyHeightFloorOffset: true,
      previewStopPreservesDraft: true,
      reopenPreservesDocument: true,
      dpr: 2,
      modelContentId: contentId,
    },
  };
}
