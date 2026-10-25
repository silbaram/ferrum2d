import { mkdir } from "node:fs/promises";
import { smokePlacementViewportSizing } from "./placement-viewport-sizing-smoke.mjs";

/** Real UI checks for dock preferences and isolated document drafts on one runtime. */
export async function smokePlacementWorkspace(page, timeoutMs) {
  const wait = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  await wait(() => globalThis.ferrumPlacementWorkspaceDocuments?.length === 1);
  await smokePlacementViewportSizing(page, timeoutMs, "2d");
  const width = () =>
    page
      .locator("canvas.demo-canvas")
      .evaluate((canvas) => canvas.getBoundingClientRect().width);
  const originalWidth = await width();
  await page.click("[data-placement-dock-toggle=inspector]");
  await wait(
    (before) =>
      document.querySelector("canvas").getBoundingClientRect().width >
      before + 200,
    originalWidth,
  );
  await page.click("[data-placement-dock-toggle=inspector]");
  await page.click("[data-placement-action=focus-viewport]");
  await wait(
    () =>
      document.querySelector("canvas").getBoundingClientRect().width >
      innerWidth - 8,
  );
  await page.click("[data-placement-action=focus-viewport]");
  const grip = await page
    .locator("[data-placement-dock-resize=scene]")
    .boundingBox();
  if (!grip) throw new Error("Scene dock separator missing");
  await page.mouse.move(grip.x + 2, grip.y + 20);
  await page.mouse.down();
  await page.mouse.move(grip.x + 42, grip.y + 20, { steps: 4 });
  await page.mouse.up();
  await wait(() => globalThis.ferrumPlacementWorkspaceLayout.scene === 280);
  const movedGrip = await page
    .locator("[data-placement-dock-resize=scene]")
    .boundingBox();
  await page.mouse.move(movedGrip.x + 2, movedGrip.y + 20);
  await page.mouse.down();
  await page.mouse.move(movedGrip.x + 30, movedGrip.y + 20);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceLayout.scene === 280 &&
      !document.querySelector(".demo-shell").dataset.resizingDock,
  );
  await page.focus("[data-placement-dock-resize=inspector]");
  await page.keyboard.press("ArrowLeft");
  await wait(() => globalThis.ferrumPlacementWorkspaceLayout.inspector === 328);
  await page.focus("[data-placement-dock-resize=runtime]");
  await page.keyboard.press("ArrowUp");
  await wait(() => globalThis.ferrumPlacementWorkspaceLayout.runtime === 176);
  const untouched = await page.evaluate(
    () =>
      !globalThis.ferrumPlacementViewerExportPatch() &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 0,
  );
  if (!untouched)
    throw new Error("Dock layout must not edit the document or history");
  await page.reload({ waitUntil: "networkidle" });
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceLayout?.scene === 280 &&
      globalThis.ferrumPlacementWorkspaceLayout.inspector === 328 &&
      globalThis.ferrumPlacementWorkspaceLayout.runtime === 176,
  );
  await page.click("[data-placement-action=reset-layout]");
  await wait(
    () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
  );

  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  const file = page.locator("input[data-placement-document-file]");
  await file.setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{bad"),
  });
  await wait(
    () =>
      document.querySelector(".placement-workspace-message").textContent
        .length > 0 && !document.querySelector(".demo-shell").inert,
  );
  if (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) !== 1
  )
    throw new Error("Invalid JSON replaced the current document");
  await file.setInputFiles({
    name: "large.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32),
  });
  await wait(() =>
    document
      .querySelector(".placement-workspace-message")
      .textContent.includes("2 MiB"),
  );
  await file.setInputFiles({
    name: "spatial.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...source, spatial: {} })),
  });
  await wait(() =>
    document
      .querySelector(".placement-workspace-message")
      .textContent.includes("spatial"),
  );
  await page.evaluate(() => {
    globalThis.__workspaceRuntime = globalThis.ferrumRuntime;
    globalThis.__workspaceCanvas = document.querySelector("canvas");
    globalThis.ferrumPlacementViewerSelect("crate_left");
    globalThis.ferrumPlacementViewerUpdateTransform("crate_left", { x: 752 });
  });
  const missingTexture = structuredClone(source);
  missingTexture.sceneComposition.prefabs.crate.props.components.sprite.texture =
    "workspace_missing_texture";
  await file.setInputFiles({
    name: "missing-texture.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(missingTexture)),
  });
  await wait(
    () =>
      document
        .querySelector(".placement-workspace-message")
        .textContent.includes("workspace_missing_texture") &&
      !document.querySelector(".demo-shell").inert,
  );
  const restored = await page.evaluate(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 1 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "crate_left" &&
      globalThis.ferrumPlacementViewerState.selected.transform.x === 752 &&
      globalThis.ferrumEngine.gameplayEntityExists(
        globalThis.ferrumPlacementViewerState.selected.entity,
      ),
  );
  if (!restored)
    throw new Error(
      "Failed runtime activation must restore the current document and live handles",
    );
  await wait(
    () => globalThis.ferrumPlacementViewerRuntimeFrame.entityCount === 6,
  );
  await file.setInputFiles({
    name: "second.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 0 &&
      !document.querySelector(".demo-shell").inert,
  );
  await page.evaluate(() => {
    globalThis.ferrumPlacementViewerSelect("crate_right");
    globalThis.ferrumPlacementViewerUpdateTransform("crate_left", { x: 620 });
  });
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .nth(1)
    .focus();
  await page.keyboard.press("ArrowLeft");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "crate_left" &&
      globalThis.ferrumPlacementViewerState.instances.find(
        (item) => item.instanceId === "crate_left",
      ).transform.x === 752 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 1,
  );
  await page.click("button[data-placement-action=undo]");
  const unloaded = await page.evaluate(() => {
    const before = globalThis.ferrumPlacementViewerRuntimeFrame;
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    globalThis.__workspaceBeforeUnloadFrame = before;
    return event.defaultPrevented;
  });
  if (!unloaded)
    throw new Error("A dirty inactive document must protect page exit");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerRuntimeFrame !==
      globalThis.__workspaceBeforeUnloadFrame,
  );
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .nth(1)
    .click();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "crate_right" &&
      globalThis.ferrumPlacementViewerState.instances.find(
        (item) => item.instanceId === "crate_left",
      ).transform.x === 620 &&
      globalThis.ferrumPlacementViewerSaveEnabled === false,
  );
  const shared = await page.evaluate(
    () =>
      globalThis.ferrumRuntime === globalThis.__workspaceRuntime &&
      document.querySelector("canvas") === globalThis.__workspaceCanvas &&
      globalThis.ferrumEngine.gameplayEntityExists(
        globalThis.ferrumPlacementViewerState.selected.entity,
      ),
  );
  if (!shared)
    throw new Error(
      "Tab switch replaced runtime/canvas or left stale entity handles",
    );

  await mkdir("artifacts/placement-workspace", { recursive: true });
  for (const width of [1280, 960, 720]) {
    await page.setViewportSize({ width, height: 800 });
    await page.screenshot({
      path: `artifacts/placement-workspace/workspace-${width}.png`,
      fullPage: true,
    });
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    );
    if (!fits) throw new Error(`Workspace overflow at ${width}px`);
    const blockedToolbarButtons = await page.evaluate(() => {
      window.scrollTo(0, 0);
      return [...document.querySelectorAll(".demo-toolbar button")]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          if (!rect.width || !rect.height) return false;
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return hit !== button && !button.contains(hit);
        })
        .map((button) => button.textContent);
    });
    if (blockedToolbarButtons.length)
      throw new Error(
        `Workspace toolbar buttons are covered at ${width}px: ${blockedToolbarButtons}`,
      );
  }
  await page.setViewportSize({ width: 960, height: 640 });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.locator("[data-placement-close-document]").nth(1).click();
  if (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) !== 2
  )
    throw new Error("Cancel closing must preserve the dirty tab");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("[data-placement-close-document]").nth(1).click();
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 1 &&
      globalThis.ferrumPlacementViewerState.draftPatch === undefined &&
      globalThis.ferrumPlacementViewerHistory.redoCount === 1,
  );
  for (let index = 0; index < 7; index++) {
    await file.setInputFiles({
      name: `bounded-${index}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await wait(
      (count) =>
        globalThis.ferrumPlacementWorkspaceDocuments.length === count &&
        !document.querySelector(".demo-shell").inert,
      index + 2,
    );
  }
  await file.setInputFiles({
    name: "too-many.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(() =>
    document
      .querySelector(".placement-workspace-message")
      .textContent.includes("8 maximum"),
  );
  if (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) !== 8
  )
    throw new Error("Document count exceeded its budget");
  while (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) > 1
  )
    await page.locator("[data-placement-close-document]").last().click();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerRuntimeFrame.entityCount === 6 &&
      globalThis.ferrumPlacementViewerRuntimeFrame.renderCommandCount >= 6 &&
      globalThis.ferrumPlacementViewerState.draftPatch === undefined,
  );
}

/** Saving must wait for both an active pointer and its final queued update. */
export async function smokePlacementSavePointerBoundary(page, timeoutMs) {
  const wait = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerSaveEnabled === true &&
      globalThis.ferrumPlacementViewerState?.instances.length === 6 &&
      globalThis.ferrumPlacementViewerHistory?.transactionLabel === undefined,
  );
  const firstDocument = await page.evaluate(
    () => globalThis.ferrumPlacementWorkspaceActiveDocument,
  );
  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "boundary.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(
    (first) =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      globalThis.ferrumPlacementWorkspaceActiveDocument !== first &&
      !document.querySelector(".demo-shell").inert,
    firstDocument,
  );
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await wait(
    (first) =>
      globalThis.ferrumPlacementWorkspaceActiveDocument === first &&
      globalThis.ferrumPlacementViewerSaveEnabled === true,
    firstDocument,
  );
  let saveRequests = 0;
  const countSave = (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/__ferrum-placement-save"
    )
      saveRequests++;
  };
  page.on("request", countSave);
  let pointerDown = false;
  let before;
  let activeBoundary;
  let finishingBoundary;
  let pendingTabBlocked = false;
  try {
    before = await page.evaluate(() => {
      const object = globalThis.ferrumPlacementViewerState.instances.find(
        (item) => item.instanceId === "crate_left",
      );
      if (!object) throw new Error("Save pointer fixture crate_left missing");
      globalThis.ferrumPlacementViewerUpdateTransform("crate_left", {
        x: object.transform.x + 1,
      });
      const state = globalThis.ferrumPlacementViewerState;
      const current = state.instances.find(
        (item) => item.instanceId === "crate_left",
      );
      const canvas = document.querySelector("canvas");
      const rect = canvas.getBoundingClientRect();
      const cssScaleX = canvas.clientWidth / rect.width;
      const cssScaleY = canvas.clientHeight / rect.height;
      const visual = current.visual;
      const transform = current.transform;
      const offsetX =
        visual.kind === "sprite"
          ? (0.5 - visual.originX) * visual.bounds.width * transform.scale
          : 0;
      const offsetY =
        visual.kind === "sprite"
          ? (0.5 - visual.originY) * visual.bounds.height * transform.scale
          : 0;
      const x =
        transform.x +
        offsetX * Math.cos(transform.rotationRadians) -
        offsetY * Math.sin(transform.rotationRadians);
      const y =
        transform.y +
        offsetX * Math.sin(transform.rotationRadians) +
        offsetY * Math.cos(transform.rotationRadians);
      const original = requestAnimationFrame.bind(window);
      const originalCancel = cancelAnimationFrame.bind(window);
      const callbacks = new Map();
      let id = 0;
      globalThis.__placementSaveBoundaryRaf = {
        original,
        originalCancel,
        callbacks,
      };
      window.requestAnimationFrame = (callback) => {
        callbacks.set(--id, callback);
        return id;
      };
      window.cancelAnimationFrame = (handle) => {
        if (handle < 0) callbacks.delete(handle);
        else originalCancel(handle);
      };
      return {
        x: transform.x,
        y: transform.y,
        expectedX: transform.x + (60 * cssScaleX) / state.viewport.zoom,
        screen: {
          x:
            rect.left +
            ((x - state.viewport.worldMinX) * state.viewport.zoom) / cssScaleX,
          y:
            rect.top +
            ((y - state.viewport.worldMinY) * state.viewport.zoom) / cssScaleY,
        },
      };
    });
    await page.mouse.move(before.screen.x, before.screen.y);
    await page.mouse.down();
    pointerDown = true;
    await page.mouse.move(before.screen.x + 60, before.screen.y);
    const checkBlocked = () =>
      page.evaluate(async () => {
        const before = JSON.stringify([
          globalThis.ferrumPlacementViewerExportPatch(),
          globalThis.ferrumPlacementViewerHistory,
        ]);
        const result = await globalThis.ferrumPlacementViewerSaveDraft();
        return {
          blocked: result === undefined,
          unchanged:
            before ===
            JSON.stringify([
              globalThis.ferrumPlacementViewerExportPatch(),
              globalThis.ferrumPlacementViewerHistory,
            ]),
          history: globalThis.ferrumPlacementViewerHistory,
          queued: globalThis.__placementSaveBoundaryRaf.callbacks.size,
          selected: globalThis.ferrumPlacementViewerState.selectedInstanceId,
          inert: document.querySelector(".demo-shell").inert,
        };
      });
    activeBoundary = await checkBlocked();
    if (
      !activeBoundary.blocked ||
      !activeBoundary.unchanged ||
      !activeBoundary.history.transactionLabel ||
      activeBoundary.selected !== "crate_left" ||
      activeBoundary.inert ||
      saveRequests !== 0
    )
      throw new Error(
        `Save during active pointer changed the document: ${JSON.stringify({ activeBoundary, saveRequests })}`,
      );
    await page.mouse.up();
    pointerDown = false;
    finishingBoundary = await checkBlocked();
    if (
      !finishingBoundary.blocked ||
      !finishingBoundary.unchanged ||
      !finishingBoundary.history.transactionLabel ||
      finishingBoundary.queued < 1 ||
      finishingBoundary.inert ||
      saveRequests !== 0
    )
      throw new Error(
        `Save before final pointer RAF changed the document: ${JSON.stringify({ finishingBoundary, saveRequests })}`,
      );
    const pendingDocument = await page.evaluate(() =>
      JSON.stringify([
        globalThis.ferrumPlacementWorkspaceActiveDocument,
        globalThis.ferrumPlacementViewerExportPatch(),
        globalThis.ferrumPlacementViewerHistory,
      ]),
    );
    // Keyboard activation bypasses pointer hit testing and must obey the same gate.
    await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .nth(1)
      .focus();
    await page.keyboard.press("Enter");
    pendingTabBlocked = await page.evaluate(
      ({ first, snapshot }) =>
        globalThis.ferrumPlacementWorkspaceActiveDocument === first &&
        globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
        JSON.stringify([
          globalThis.ferrumPlacementWorkspaceActiveDocument,
          globalThis.ferrumPlacementViewerExportPatch(),
          globalThis.ferrumPlacementViewerHistory,
        ]) === snapshot,
      { first: firstDocument, snapshot: pendingDocument },
    );
    if (!pendingTabBlocked)
      throw new Error("Tab activation discarded the final queued pointer edit");
  } finally {
    try {
      if (pointerDown) await page.mouse.up();
    } finally {
      const flushErrors = await page.evaluate(() => {
        const held = globalThis.__placementSaveBoundaryRaf;
        if (!held) return [];
        // Restore scheduling before any callback runs, even on assertion failure.
        window.requestAnimationFrame = held.original;
        window.cancelAnimationFrame = held.originalCancel;
        delete globalThis.__placementSaveBoundaryRaf;
        const errors = [];
        for (const callback of held.callbacks.values()) {
          try {
            callback(performance.now());
          } catch (error) {
            errors.push(String(error));
          }
        }
        return errors;
      });
      page.off("request", countSave);
      if (flushErrors.length)
        throw new Error(
          `Final pointer RAF failed: ${JSON.stringify(flushErrors)}`,
        );
    }
  }
  await wait(
    (expected) =>
      globalThis.ferrumPlacementViewerHistory.transactionLabel === undefined &&
      Math.abs(
        globalThis.ferrumPlacementViewerState.instances.find(
          (item) => item.instanceId === "crate_left",
        ).transform.x - expected,
      ) < 0.001,
    before.expectedX,
  );
  const result = await page.evaluate(() =>
    globalThis.ferrumPlacementViewerSaveDraft(),
  );
  if (result?.saved !== true)
    throw new Error("Save after final pointer RAF did not succeed");
  const saved = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  const persisted = saved.sceneComposition.fragments.main.instances.find(
    (item) => item.id === "crate_left",
  );
  if (Math.abs(persisted.x - before.expectedX) >= 0.001)
    throw new Error(
      `Saved document omitted final pointer update: ${JSON.stringify({ expectedX: before.expectedX, persisted })}`,
    );
  await wait(
    (expected) =>
      globalThis.ferrumPlacementViewerExportPatch() === undefined &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 0 &&
      globalThis.ferrumPlacementViewerHistory.transactionLabel === undefined &&
      Math.abs(
        globalThis.ferrumPlacementViewerState.instances.find(
          (item) => item.instanceId === "crate_left",
        ).transform.x - expected,
      ) < 0.001,
    before.expectedX,
  );
  await page.locator("[data-placement-close-document]").nth(1).click();
  await wait(
    (first) =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 1 &&
      globalThis.ferrumPlacementWorkspaceActiveDocument === first &&
      globalThis.ferrumPlacementViewerExportPatch() === undefined,
    firstDocument,
  );
  return {
    activeSaveBlocked: activeBoundary.blocked,
    finishingSaveBlocked: finishingBoundary.blocked,
    pendingTabBlocked,
    prematureSaveRequests: saveRequests,
    expectedX: before.expectedX,
    persistedX: persisted.x,
    finalPointerSaved: true,
    cleanAfterSave: true,
  };
}

export async function preparePlacementWorkspaceSave(page, timeoutMs) {
  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "background.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.waitForFunction(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      !document.querySelector(".demo-shell").inert,
    undefined,
    { timeout: timeoutMs },
  );
  await page.evaluate(() =>
    globalThis.ferrumPlacementViewerUpdateTransform("crate_left", { x: 912 }),
  );
  await page.click("button[data-instance-id=crate_left]:visible");
  await page
    .locator("button[data-instance-id=crate_right]:visible")
    .click({ modifiers: ["Control"] });
  await page.click("button[data-placement-lock-instance=floor_south]:visible");
  await page.click("[data-placement-view-action=zoom-in]");
  await page.evaluate(() => {
    globalThis.__workspaceBackgroundCamera =
      globalThis.ferrumPlacementEditCamera;
  });
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await page.click("[data-placement-view-action=zoom-out]");
  await page.click("button[data-placement-lock-instance=floor_north]:visible");
  await page.evaluate(() => {
    globalThis.__workspaceSaveCamera = globalThis.ferrumPlacementEditCamera;
  });
}

export async function assertPlacementWorkspaceSave(page, timeoutMs) {
  if (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) !== 2
  )
    throw new Error("Saving reloaded and lost the other document");
  const cameraPreserved = await page.evaluate(
    () =>
      JSON.stringify(globalThis.ferrumPlacementEditCamera) ===
      JSON.stringify(globalThis.__workspaceSaveCamera),
  );
  if (!cameraPreserved)
    throw new Error("Saving reset the active document edit camera");
  if (
    !(await page.evaluate(() =>
      globalThis.ferrumPlacementViewerState.lockedInstanceIds.includes(
        "floor_north",
      ),
    ))
  )
    throw new Error("Saving reset the active document locks");
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .nth(1)
    .click();
  await page.waitForFunction(
    () =>
      globalThis.ferrumPlacementViewerState.instances.find(
        (item) => item.instanceId === "crate_left",
      ).transform.x === 912 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      globalThis.ferrumPlacementEditCamera.zoom ===
        globalThis.__workspaceBackgroundCamera.zoom &&
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 2 &&
      globalThis.ferrumPlacementViewerState.lockedInstanceIds.includes(
        "floor_south",
      ) &&
      globalThis.ferrumPlacementViewerSaveEnabled === false,
    undefined,
    { timeout: timeoutMs },
  );
  await page.click("button[data-placement-action=undo]");
  await page.click("button[data-placement-action=redo]");
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await page.waitForFunction(
    () =>
      globalThis.ferrumPlacementViewerState.instances.length === 10 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 0 &&
      globalThis.ferrumPlacementViewerState.draftPatch === undefined,
    undefined,
    { timeout: timeoutMs },
  );
}

export async function smokePlacementDesktopWorkspace(page, timeoutMs) {
  const wait = (predicate, arg) =>
    page.waitForFunction(predicate, arg, { timeout: timeoutMs });
  await page.locator("button[data-instance-id]:visible").first().click();
  await page
    .locator("button[data-instance-id]:visible")
    .nth(1)
    .click({ modifiers: ["Control"] });
  await page
    .locator("button[data-placement-lock-instance]:visible")
    .first()
    .click();
  const before = await page.evaluate(() => ({
    source: globalThis.ferrumPlacementViewerDesktop.sceneDocumentPath,
    assetFolder: globalThis.ferrumPlacementViewerDesktop.assetFolderPath,
    patch: JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
    undoCount: globalThis.ferrumPlacementViewerHistory.undoCount,
    selection: globalThis.ferrumPlacementViewerState.selectedInstanceIds,
    locks: globalThis.ferrumPlacementViewerState.lockedInstanceIds,
  }));
  const nextPath =
    "/tmp/ferrum-placement-viewer-desktop-assets-smoke/public/second.scene.json";
  await page.evaluate(
    (path) => globalThis.ferrumPlacementViewerOpenSceneDocument(path),
    nextPath,
  );
  await wait(
    (path) =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      globalThis.ferrumPlacementViewerDesktop.sceneDocumentPath === path &&
      !document.querySelector(".demo-shell").inert,
    nextPath,
  );
  await page.evaluate(() => {
    const id = globalThis.ferrumPlacementViewerState.instances[0].instanceId;
    globalThis.ferrumPlacementViewerUpdateTransform(id, { x: 640 });
  });
  const saved = await page.evaluate(() =>
    globalThis.ferrumPlacementViewerSaveDraft(),
  );
  if (saved?.saved !== true)
    throw new Error("Desktop second document did not save");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 0 &&
      globalThis.ferrumPlacementViewerState.draftPatch === undefined,
  );
  const write = await page.evaluate(() =>
    globalThis.__placementDesktopCommands
      .filter((item) => item.command === "save_placement_scene_document")
      .at(-1),
  );
  if (
    write.args.sceneDocumentPath !== nextPath ||
    write.args.expectedDocument === undefined
  ) {
    throw new Error(
      "Desktop save used another tab's path or omitted the baseline",
    );
  }
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await wait(
    (expected) =>
      globalThis.ferrumPlacementViewerDesktop.sceneDocumentPath ===
        expected.source &&
      globalThis.ferrumPlacementViewerDesktop.assetFolderPath ===
        expected.assetFolder &&
      JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()) ===
        expected.patch &&
      globalThis.ferrumPlacementViewerHistory.undoCount ===
        expected.undoCount &&
      JSON.stringify(
        globalThis.ferrumPlacementViewerState.selectedInstanceIds,
      ) === JSON.stringify(expected.selection) &&
      JSON.stringify(
        globalThis.ferrumPlacementViewerState.lockedInstanceIds,
      ) === JSON.stringify(expected.locks),
    before,
  );
  await page.evaluate(() =>
    globalThis.ferrumPlacementViewerOpenSceneDocument(
      "/tmp/invalid.scene.json",
    ),
  );
  await wait(() =>
    document
      .querySelector(".placement-workspace-message")
      .textContent.includes("Invalid scene fixture"),
  );
  if (
    (await page
      .getByRole("tablist", { name: "Scene documents" })
      .getByRole("tab")
      .count()) !== 2
  )
    throw new Error("Failed desktop open added a tab");
  return {
    independentSavePath: true,
    baselineRequired: true,
    previousDraftAndAssetsPreserved: true,
    previousSelectionAndLocksPreserved: true,
    failedOpenPreserved: true,
  };
}
