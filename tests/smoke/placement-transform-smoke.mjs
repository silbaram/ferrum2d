import {
  showPlacementInspector,
  showPlacementBottom,
  clickPlacementControl,
} from "./placement-panel-navigation.mjs";
import { mkdir } from "node:fs/promises";

export async function smokePlacementTransforms(page, timeoutMs) {
  const wait = async (fn, arg) => {
    try {
      return await page.waitForFunction(fn, arg, { timeout: timeoutMs });
    } catch (error) {
      throw new Error(
        `Transform check failed: ${fn}\n${JSON.stringify(await page.evaluate(() => ({ state: globalThis.ferrumPlacementViewerState, history: globalThis.ferrumPlacementViewerHistory })))}\n${error.stack}`,
      );
    }
  };
  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  source.sceneComposition.fragments.main.instances = [
    { id: "pivot_a", prefab: "crate", x: 700, y: 480 },
    { id: "pivot_b", prefab: "crate", x: 883, y: 491 },
  ];
  source.behaviorRecipes = { entities: {} };
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "transforms.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState?.instances[0]?.instanceId ===
      "pivot_a",
  );
  await page.click("button[data-instance-id=pivot_a]:visible");
  await page
    .locator("button[data-instance-id=pivot_b]:visible")
    .click({ modifiers: ["Control"] });
  await clickPlacementControl(page, "[data-placement-view-action=frame-selection]");
  const patch = () =>
    page.evaluate(() => globalThis.ferrumPlacementViewerExportPatch());
  const undo = async () => {
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    await wait(
      () =>
        !globalThis.ferrumPlacementViewerExportPatch() &&
        !globalThis.ferrumPlacementViewerHistory.transactionLabel,
    );
  };
  const numeric = async (field, value) => {
    await page
      .locator(`input[data-placement-transform-field=${field}]:visible`)
      .fill(String(value));
    await page.locator("canvas.demo-canvas").focus();
    await wait(
      () =>
        globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
        !globalThis.ferrumPlacementViewerHistory.transactionLabel,
    );
    return patch();
  };
  const numericRotation = await numeric("rotationRadians", Math.PI / 2);
  await wait(() => {
    const [a, b] = globalThis.ferrumPlacementViewerState.instances;
    return (
      Math.abs(a.transform.x - 894) < 1e-6 &&
      Math.abs(a.transform.y - 308) < 1e-6 &&
      b.transform.x === 883 &&
      b.transform.y === 491
    );
  });
  await undo();
  const pivot = await page.evaluate(() => {
    const s = globalThis.ferrumPlacementViewerState,
      r = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: r.left + (883 - s.viewport.worldMinX) * s.viewport.zoom,
      y: r.top + (491 - s.viewport.worldMinY) * s.viewport.zoom,
    };
  });
  const rotate = page.locator("[data-placement-transform-gizmo=rotate]");
  const r = await rotate.boundingBox();
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(r.x + r.width / 2 + 90, r.y + r.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  if (JSON.stringify(await patch()) !== JSON.stringify(numericRotation))
    throw new Error("Pointer/numeric rotation patches differ");
  await undo();
  const numericScale = await numeric("scale", 2);
  await undo();
  const scale = page.locator("[data-placement-transform-gizmo=scale]");
  const s = await scale.boundingBox(),
    x = s.x + s.width / 2,
    y = s.y + s.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(
    x + 120,
    y,
    { steps: 8 },
  );
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  if (JSON.stringify(await patch()) !== JSON.stringify(numericScale))
    throw new Error("Pointer/numeric scale patches differ");
  await undo();
  const keyboardRotation = await numeric("rotationRadians", Math.PI / 12);
  await undo();
  await rotate.focus();
  await page.keyboard.press("ArrowRight");
  if (JSON.stringify(await patch()) !== JSON.stringify(keyboardRotation))
    throw new Error("Keyboard/numeric rotation patches differ");
  await undo();
  const keyboardScale = await numeric("scale", 1.1);
  await undo();
  await scale.focus();
  await page.keyboard.press("ArrowRight");
  if (JSON.stringify(await patch()) !== JSON.stringify(keyboardScale))
    throw new Error("Keyboard/numeric scale patches differ");
  await undo();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 30, y + 20, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await wait(
    () =>
      !globalThis.ferrumPlacementViewerExportPatch() &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  await page.click("[data-placement-selection-action=lock]");
  if (await scale.isVisible())
    throw new Error("Locked transform gizmo must be hidden");
  await page.click("[data-placement-selection-action=unlock]");

  // The release position can be newer than the last delivered pointermove.
  await page.evaluate(() => {
    globalThis.ferrumPlacementViewerSetSnap({ enabled: false });
    document.querySelector("canvas").addEventListener(
      "pointerdown",
      (event) => {
        globalThis.__placementReleasePointerId = event.pointerId;
      },
      { once: true },
    );
  });
  const releaseZoom = await page.evaluate(
    () => globalThis.ferrumPlacementViewerState.viewport.zoom,
  );
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.locator("canvas.demo-canvas").dispatchEvent("pointerup", {
    pointerId: await page.evaluate(
      () => globalThis.__placementReleasePointerId,
    ),
    button: 0,
    buttons: 0,
    clientX: pivot.x + 24,
    clientY: pivot.y + 12,
  });
  await page.mouse.up();
  await wait(() => !globalThis.ferrumPlacementViewerHistory.transactionLabel);
  const releasePosition = await page.evaluate(
    () => globalThis.ferrumPlacementViewerState.selected.transform,
  );
  if (
    // Browser pointer coordinates can round fractional CSS pixels.
    Math.abs((releasePosition.x - 883) * releaseZoom - 24) > 0.01 ||
    Math.abs((releasePosition.y - 491) * releaseZoom - 12) > 0.01
  )
    throw new Error(
      "2D drag discarded its final pointerup position: " +
        JSON.stringify({ releasePosition, releaseZoom, pivot }),
    );
  await undo();

  const asset = page.locator("[data-placement-sprite-preview]:visible");
  await showPlacementInspector(page, "placement");
  await asset.scrollIntoViewIfNeeded();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await asset.dispatchEvent("dragstart", { dataTransfer: transfer });
  await page.locator("canvas.demo-canvas").dispatchEvent("dragover", {
    dataTransfer: transfer,
    clientX: pivot.x,
    clientY: pivot.y,
  });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerInteraction.pendingAdd === "add-sprite",
  );
  // DragEvent client coordinates are integer CSS pixels. Derive the expected
  // point from the emitted event and current viewport, rather than a cached
  // fractional object projection from before the asset toolbar changed.
  const expectedDrop = await page.evaluate((point) => {
    const event = new DragEvent("drop", { clientX: point.x, clientY: point.y }),
      rect = document.querySelector("canvas").getBoundingClientRect(),
      viewport = globalThis.ferrumPlacementViewerState.viewport;
    return {
      x: Math.round(viewport.worldMinX + (event.clientX - rect.left) / viewport.zoom),
      y: Math.round(viewport.worldMinY + (event.clientY - rect.top) / viewport.zoom),
    };
  }, pivot);
  await page.locator("canvas.demo-canvas").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: pivot.x,
    clientY: pivot.y,
  });
  await wait(
    () =>
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      globalThis.ferrumPlacementViewerState.instances.length === 3,
  );
  const added = await page.evaluate(
    () => globalThis.ferrumPlacementViewerState.selected,
  );
  if (
    added.visual.kind !== "sprite" ||
    added.collider.type !== "aabb" ||
    added.transform.x !== expectedDrop.x ||
    added.transform.y !== expectedDrop.y
  )
    throw new Error(
      `Sprite drop normalization failed: ${JSON.stringify(added)}`,
    );
  await undo();
  // An untrusted external payload cannot add an instance.
  await page.locator("canvas.demo-canvas").dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: pivot.x,
    clientY: pivot.y,
  });
  await wait(
    () => globalThis.ferrumPlacementViewerState.instances.length === 2,
  );
  await mkdir("artifacts/placement-transforms", { recursive: true });
  await page.evaluate(() =>
    globalThis.ferrumPlacementViewerUpdateComponents("pivot_a", {
      visual: {
        kind: "sprite",
        asset: "missing-fixture",
        width: 20,
        height: 20,
      },
      collider: "none",
      layer: "wall",
    }),
  );
  await wait(() =>
    document
      .querySelector("[data-placement-problem-path]")
      ?.textContent.includes("missing-fixture"),
  );
  await showPlacementBottom(page, "problems");
  await page.locator("[data-placement-problem-path]").first().click();
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceId === "pivot_a" &&
      globalThis.ferrumPlacementWorkspaceEvidence.selectedSourcePaths.some(
        (path) => path.includes("/instances/0"),
      ),
  );
  await undo();
  await page.screenshot({
    path: "artifacts/placement-transforms/group-gizmo.png",
    fullPage: true,
  });
  await page.locator("[data-placement-close-document]").nth(1).click();
  await page.reload({ waitUntil: "networkidle" });
  await wait(
    () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
  );
  return {
    groupPivot: "primary",
    pointerNumericKeyboardPatchMatch: true,
    undoCancel: true,
    assetDrop: true,
  };
}
