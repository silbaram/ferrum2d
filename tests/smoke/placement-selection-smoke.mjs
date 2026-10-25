import { mkdir } from "node:fs/promises";

export async function smokePlacementSelection(page, timeoutMs) {
  const wait = async (predicate, arg) => {
    try {
      return await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    } catch (error) {
      throw new Error(
        `Selection check failed: ${predicate}\n${JSON.stringify(await page.evaluate(() => ({ ids: globalThis.ferrumPlacementViewerState.selectedInstanceIds, locks: globalThis.ferrumPlacementViewerState.lockedInstanceIds, history: globalThis.ferrumPlacementViewerHistory })))}\n${error.message}`,
      );
    }
  };
  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  source.sceneComposition.fragments.main.instances = [
    { id: "group_a", prefab: "crate", x: 700, y: 480 },
    { id: "group_b", prefab: "crate", x: 883, y: 491 },
    { id: "group_c", prefab: "crate", x: 700, y: 600 },
  ];
  source.behaviorRecipes = { entities: {} };
  await openFixture(page, source, timeoutMs);
  const selectPair = async () => {
    await page.click("button[data-instance-id=group_a]:visible");
    await page
      .locator("button[data-instance-id=group_b]:visible")
      .click({ modifiers: ["Control"] });
    await wait(
      () =>
        globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
        "group_a,group_b",
    );
  };
  const clean = () =>
    wait(
      () =>
        !globalThis.ferrumPlacementViewerExportPatch() &&
        !globalThis.ferrumPlacementViewerHistory.transactionLabel,
    );
  const assertPair = async (x, y) => {
    await wait(
      ({ x, y }) => {
        const state = globalThis.ferrumPlacementViewerState,
          a = state.instances.find(
            (instance) => instance.instanceId === "group_a",
          ),
          b = state.instances.find(
            (instance) => instance.instanceId === "group_b",
          );
        return (
          Math.abs(a.transform.x - x) < 0.01 &&
          Math.abs(a.transform.y - y) < 0.01 &&
          Math.abs(b.transform.x - a.transform.x - 183) < 0.001 &&
          Math.abs(b.transform.y - a.transform.y - 11) < 0.001
        );
      },
      { x, y },
    );
  };
  await page.click("button[data-instance-id=group_a]:visible");
  await page
    .locator("button[data-instance-id=group_c]:visible")
    .click({ modifiers: ["Shift"] });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
      "group_a,group_b,group_c",
  );
  await selectPair();
  if (
    (await page
      .locator("input[data-placement-transform-field=scale]:visible")
      .isDisabled()) ||
    !(await page
      .locator("[data-placement-action=apply-components]:visible")
      .isDisabled())
  )
    throw new Error(
      "Multi-selection must not edit only the primary object's individual properties",
    );
  await page.click("[data-placement-view-action=frame-selection]");
  await wait(
    () =>
      Math.abs(globalThis.ferrumPlacementEditCamera.x - 791.5) < 0.02 &&
      Math.abs(globalThis.ferrumPlacementEditCamera.y - 485.5) < 0.02,
  );
  if ((await page.locator(".placement-secondary-selection").count()) !== 1)
    throw new Error("Secondary selection outline missing");
  const anchor = await point(page, 883, 491);
  await selectPair();
  await page.keyboard.down("Control");
  await page.mouse.click(anchor.x, anchor.y);
  await page.keyboard.up("Control");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
      "group_a",
  );
  await page.keyboard.down("Shift");
  await page.mouse.click(anchor.x, anchor.y);
  await page.keyboard.up("Shift");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 2,
  );
  const zoom = await page.evaluate(
    () => globalThis.ferrumPlacementViewerState.viewport.zoom,
  );
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 20 * zoom, anchor.y + 10 * zoom, {
    steps: 5,
  });
  await page.mouse.up();
  await assertPair(720, 490);
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel &&
      globalThis.ferrumPlacementViewerExportPatch().operations.length === 2,
  );
  await page.click("[data-placement-action=undo]");
  await clean();
  await page.click("[data-placement-action=redo]");
  await assertPair(720, 490);
  await page.click("[data-placement-action=undo]");
  await clean();
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.down();
  await page.mouse.move(anchor.x + 48, anchor.y + 20, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await clean();
  await assertPair(700, 480);

  await selectPair();
  await page
    .locator("input[data-placement-transform-field=x]:visible")
    .fill("903");
  await page.locator("canvas.demo-canvas").focus();
  await assertPair(720, 480);
  await page.click("[data-placement-action=undo]");
  await clean();
  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await assertPair(710, 480);
  await page.click("[data-placement-action=undo]");
  await clean();
  await page.locator("input[data-placement-snap-toggle]:visible").check();
  await assertPair(697, 485);
  await page.locator("input[data-placement-snap-toggle]:visible").uncheck();
  await page.click("[data-placement-action=undo]");
  await clean();

  await page.click("[data-placement-view-action=pan]");
  await page.click("[data-placement-selection-action=lock]");
  await wait(
    () => globalThis.ferrumPlacementViewerState.lockedInstanceIds.length === 2,
  );
  await page.click("[data-placement-view-action=select]");
  if (
    !(await page
      .locator("input[data-placement-transform-field=x]:visible")
      .isDisabled()) ||
    !(await page
      .locator("[data-placement-action=remove-selected]:visible")
      .isDisabled())
  )
    throw new Error("Locked selection must block move and remove controls");
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await wait(
    () => globalThis.ferrumPlacementViewerState.lockedInstanceIds.length === 0,
  );
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .nth(1)
    .click();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.lockedInstanceIds.length === 2 &&
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 2,
  );
  const lockedPoint = await point(page, 700, 480);
  await page.mouse.click(lockedPoint.x, lockedPoint.y);
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 0,
  );
  await page.click("button[data-instance-id=group_a]:visible");
  await page.click("button[data-placement-lock-instance=group_a]:visible");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.lockedInstanceIds.join(",") ===
      "group_b",
  );
  await page.click("[data-placement-selection-action=all]");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
      "group_a,group_c",
  );
  await page.click("button[data-placement-lock-instance=group_b]:visible");
  await selectPair();
  const noEdits = await page.evaluate(
    () =>
      !globalThis.ferrumPlacementViewerExportPatch() &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 0,
  );
  if (!noEdits) throw new Error("Selection or lock toggles created history");

  await page.click("[data-placement-view-action=reset-view]");
  await boxSelect(page, { x: 670, y: 450 }, { x: 700, y: 480 });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 0,
  );
  await boxSelect(page, { x: 670, y: 450 }, { x: 913, y: 521 });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
      "group_a,group_b",
  );
  const boxStart = await point(page, 665, 560),
    boxEnd = await point(page, 730, 635);
  await page.mouse.move(boxStart.x, boxStart.y);
  await page.mouse.down();
  await page.mouse.move(boxEnd.x, boxEnd.y, { steps: 3 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
        "group_a,group_b" &&
      document.querySelector(".placement-marquee").hidden,
  );
  await page.evaluate(() =>
    window.addEventListener(
      "pointerdown",
      (event) => {
        globalThis.__selectionBoxPointer = event.pointerId;
      },
      { once: true, capture: true },
    ),
  );
  await page.mouse.move(boxStart.x, boxStart.y);
  await page.mouse.down();
  await page.mouse.move(boxEnd.x, boxEnd.y, { steps: 3 });
  await page.evaluate(() =>
    document.querySelector("canvas").dispatchEvent(
      new PointerEvent("lostpointercapture", {
        pointerId: globalThis.__selectionBoxPointer,
      }),
    ),
  );
  await page.mouse.up();
  await wait(
    () =>
      !globalThis.ferrumPlacementViewerHistory.transactionLabel &&
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.join(",") ===
        "group_a,group_b",
  );
  await page.keyboard.down("Shift");
  await boxSelect(page, { x: 665, y: 560 }, { x: 730, y: 635 });
  await page.keyboard.up("Shift");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 3,
  );
  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("Control+a");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 3,
  );
  await mkdir("artifacts/placement-selection", { recursive: true });
  await page.screenshot({
    path: "artifacts/placement-selection/group-selected.png",
    fullPage: true,
  });
  await page.keyboard.press("Delete");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.instances.length === 0 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 1,
  );
  await page.click("[data-placement-action=undo]");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.instances.length === 3 &&
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length === 3,
  );
  await clean();
  await page.locator("[data-placement-close-document]").nth(1).click();
  await wait(() => globalThis.ferrumPlacementWorkspaceDocuments.length === 1);
  await page.reload({ waitUntil: "networkidle" });
  await wait(
    () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
  );

  const highDpr = await page
    .context()
    .browser()
    .newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errors = [];
  highDpr.on("pageerror", (error) => errors.push(error.message));
  highDpr.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await highDpr.goto(page.url(), { waitUntil: "networkidle" });
    await highDpr.waitForFunction(
      () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
      undefined,
      { timeout: timeoutMs },
    );
    await openFixture(highDpr, source, timeoutMs);
    await highDpr.locator("canvas.demo-canvas").focus();
    await highDpr.keyboard.press("Control+a");
    await highDpr.click("[data-placement-view-action=frame-selection]");
    const from = await point(highDpr, 700, 480);
    const dprZoom = await highDpr.evaluate(
      () => globalThis.ferrumPlacementViewerState.viewport.zoom,
    );
    await highDpr.mouse.move(from.x, from.y);
    await highDpr.mouse.down();
    await highDpr.mouse.move(from.x + 16 * dprZoom, from.y, { steps: 4 });
    await highDpr.mouse.up();
    await highDpr.waitForFunction(
      () =>
        globalThis.ferrumPlacementViewerState.viewport.dpr === 2 &&
        globalThis.ferrumPlacementViewerExportPatch()?.operations.length ===
          3 &&
        globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
        !globalThis.ferrumPlacementViewerHistory.transactionLabel,
      undefined,
      { timeout: timeoutMs },
    );
    if ((await highDpr.locator(".placement-secondary-selection").count()) !== 2)
      throw new Error("DPR 2 group outlines missing");
    await highDpr.screenshot({
      path: "artifacts/placement-selection/dpr-2.png",
      fullPage: true,
    });
    if (errors.length)
      throw new Error(`DPR selection page errors: ${errors.join(", ")}`);
  } finally {
    await highDpr.close();
  }
  return {
    groupSize: 3,
    atomicMoveAndRemove: true,
    undoAndCancel: true,
    locksAndTabs: true,
    marquee: "fully-contained",
    dpr: 2,
  };
}

export async function smokePlacementSelectionMass(page, timeoutMs) {
  const result = await page.evaluate(() => {
    const before = JSON.stringify(
      globalThis.ferrumPlacementViewerExportPatch(),
    );
    const undoBefore = globalThis.ferrumPlacementViewerHistory.undoCount;
    let started = performance.now();
    document.querySelector("[data-placement-selection-action=all]").click();
    const selectAllMs = performance.now() - started;
    const selectedCount =
      globalThis.ferrumPlacementViewerState.selectedInstanceIds.length;
    started = performance.now();
    document.querySelector("canvas").dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "ArrowRight",
        shiftKey: true,
        bubbles: true,
      }),
    );
    const moveMs = performance.now() - started;
    const groupOperations =
      globalThis.ferrumPlacementViewerExportPatch()?.operations.length;
    const undoAfter = globalThis.ferrumPlacementViewerHistory.undoCount;
    document.querySelector("[data-placement-action=undo]").click();
    const restored =
      JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()) === before;
    started = performance.now();
    document.querySelector("[data-placement-selection-action=lock]").click();
    const lockMs = performance.now() - started;
    const lockedCount =
      globalThis.ferrumPlacementViewerState.lockedInstanceIds.length;
    document.querySelector("[data-placement-selection-action=unlock]").click();
    document.querySelector("[data-placement-selection-action=clear]").click();
    return {
      selectAllMs,
      moveMs,
      lockMs,
      selectedCount,
      lockedCount,
      groupOperations,
      undoBefore,
      undoAfter,
      restored,
      undoRestored: globalThis.ferrumPlacementViewerHistory.undoCount,
      maxActionMs: 500,
    };
  });
  if (
    result.selectedCount < 1030 ||
    result.lockedCount !== result.selectedCount ||
    result.groupOperations !== result.selectedCount ||
    result.undoAfter !== result.undoBefore + 1 ||
    result.undoRestored !== result.undoBefore ||
    !result.restored ||
    [result.selectAllMs, result.moveMs, result.lockMs].some(
      (value) => !Number.isFinite(value) || value > result.maxActionMs,
    )
  )
    throw new Error(`Mass group selection failed: ${JSON.stringify(result)}`);
  await page.waitForFunction(
    () => {
      const frame = globalThis.ferrumPlacementViewerRuntimeFrame;
      return (
        frame.entityCount >= 1030 &&
        frame.renderCommandCount >= 1030 &&
        frame.drawCalls >= 1 &&
        frame.drawCalls <= 16
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
  return result;
}

async function point(page, x, y) {
  return page.evaluate(
    ({ x, y }) => {
      const viewport = globalThis.ferrumPlacementViewerState.viewport,
        rect = document.querySelector("canvas").getBoundingClientRect();
      return {
        x: rect.left + (x - viewport.worldMinX) * viewport.zoom,
        y: rect.top + (y - viewport.worldMinY) * viewport.zoom,
      };
    },
    { x, y },
  );
}
async function boxSelect(page, start, end) {
  const from = await point(page, start.x, start.y),
    to = await point(page, end.x, end.y);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}
async function openFixture(page, source, timeoutMs) {
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "selection.scene.json",
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
}
