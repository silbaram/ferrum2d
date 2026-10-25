import { mkdir } from "node:fs/promises";

/** Navigation must move actual rendered content and preserve the authored draft. */
export async function smokePlacementNavigation(page, timeoutMs) {
  const wait = async (predicate, arg) => {
    try {
      return await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    } catch (error) {
      const state = await page.evaluate(() => ({
        camera: globalThis.ferrumPlacementEditCamera,
        history: globalThis.ferrumPlacementViewerHistory,
        message: document.querySelector(".placement-workspace-message")
          ?.textContent,
      }));
      throw new Error(
        `Navigation check failed: ${predicate}\n${JSON.stringify({ expected: arg, state })}\n${error.message}`,
      );
    }
  };
  const camera = () =>
    page.evaluate(() => globalThis.ferrumPlacementEditCamera);
  const history = () =>
    page.evaluate(() =>
      JSON.stringify([
        globalThis.ferrumPlacementViewerExportPatch(),
        globalThis.ferrumPlacementViewerHistory,
      ]),
    );
  await page.click("[data-placement-view-action=reset-view]");
  const original = await camera();
  const originalHistory = await history();
  const canvas = await page.locator("canvas.demo-canvas").boundingBox();
  if (!canvas) throw new Error("Navigation canvas missing");
  const cssScale = await page.locator("canvas.demo-canvas").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: element.clientWidth / rect.width,
      y: element.clientHeight / rect.height,
    };
  });
  const start = {
    x: canvas.x + canvas.width / 2,
    y: canvas.y + canvas.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + 64, start.y + 32, { steps: 4 });
  await page.mouse.up({ button: "middle" });
  await wait(
    (origin) =>
      Math.abs(
        globalThis.ferrumPlacementEditCamera.x - (origin.x - origin.dx),
      ) < 0.01 &&
      Math.abs(
        globalThis.ferrumPlacementEditCamera.y - (origin.y - origin.dy),
      ) < 0.01,
    { ...original, dx: 64 * cssScale.x, dy: 32 * cssScale.y },
  );
  await assertRenderedObject(page, "crate_left", timeoutMs);
  const anchor = await objectPoint(page, "crate_left");
  // Chromium quantizes WheelEvent client coordinates to whole CSS pixels.
  anchor.x = Math.floor(anchor.x);
  anchor.y = Math.floor(anchor.y);
  anchor.screen = {
    x: (anchor.x - canvas.x) * cssScale.x,
    y: (anchor.y - canvas.y) * cssScale.y,
  };
  const worldBefore = await page.evaluate(({ x, y }) => {
    const viewport = globalThis.ferrumPlacementViewerState.viewport;
    return {
      x: viewport.worldMinX + x / viewport.zoom,
      y: viewport.worldMinY + y / viewport.zoom,
    };
  }, anchor.screen);
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -200);
  await wait(
    (world) => {
      const viewport = globalThis.ferrumPlacementViewerState.viewport;
      return (
        viewport.zoom > 1.4 &&
        Math.abs(
          viewport.worldMinX + world.screen.x / viewport.zoom - world.x,
        ) < 0.02 &&
        Math.abs(
          viewport.worldMinY + world.screen.y / viewport.zoom - world.y,
        ) < 0.02
      );
    },
    { ...worldBefore, screen: anchor.screen },
  );
  await assertRenderedObject(page, "crate_left", timeoutMs);
  await page.mouse.click(anchor.x, anchor.y);
  await wait(
    () =>
      globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "crate_left" &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  const editingCamera = await camera();
  await page.mouse.down();
  await page.mouse.wheel(0, -200);
  await page.keyboard.press("Space");
  if (JSON.stringify(await camera()) !== JSON.stringify(editingCamera))
    throw new Error(
      "Navigation must not change camera during an object gesture",
    );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await wait(() => !globalThis.ferrumPlacementViewerHistory.transactionLabel);

  const beforeCancel = await camera();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(start.x + 42, start.y + 28, { steps: 3 });
  await wait(
    (before) => globalThis.ferrumPlacementEditCamera.x !== before.x,
    beforeCancel,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up({ button: "middle" });
  await wait(
    (before) =>
      Math.abs(globalThis.ferrumPlacementEditCamera.x - before.x) < 0.01 &&
      Math.abs(globalThis.ferrumPlacementEditCamera.y - before.y) < 0.01,
    beforeCancel,
  );
  await page.keyboard.down("Space");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 24, start.y + 16, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await wait(
    () =>
      document.querySelector(".demo-stage").dataset.navigationTool === "select",
  );
  if (JSON.stringify(await camera()) === JSON.stringify(beforeCancel))
    throw new Error("Space drag did not pan");
  await page.click("[data-placement-view-action=pan]");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 16, start.y + 8, { steps: 3 });
  await page.mouse.up();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("KeyV");
  if ((await history()) !== originalHistory)
    throw new Error("Pan/zoom/cancel changed document draft or history");
  const tabCamera = await camera();
  await page.click("[data-placement-dock-toggle=inspector]");
  await wait(
    (zoom) =>
      globalThis.ferrumPlacementViewerState.viewport.zoom === zoom &&
      globalThis.ferrumPlacementViewerState.viewport.cssWidth ===
        document.querySelector("canvas").clientWidth,
    tabCamera.zoom,
  );
  await assertRenderedObject(page, "crate_left", timeoutMs);
  await page.click("[data-placement-dock-toggle=inspector]");

  const source = await (
    await page.request.get(
      new URL("placement.scene-authoring.json", page.url()).href,
    )
  ).json();
  const missingTexture = structuredClone(source);
  missingTexture.sceneComposition.prefabs.crate.props.components.sprite.texture =
    "navigation_missing_texture";
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "failed.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(missingTexture)),
  });
  await wait(
    () =>
      document
        .querySelector(".placement-workspace-message")
        .textContent.includes("navigation_missing_texture") &&
      !document.querySelector(".demo-shell").inert,
  );
  const afterFailure = await camera();
  if (
    Math.abs(afterFailure.x - tabCamera.x) > 0.02 ||
    Math.abs(afterFailure.y - tabCamera.y) > 0.02 ||
    afterFailure.zoom !== tabCamera.zoom ||
    (await history()) !== originalHistory
  )
    throw new Error(
      "Failed document activation did not restore the edit camera and history",
    );
  delete source.sceneComposition.prefabs.crate.props.components.sprite;
  source.sceneComposition.prefabs.crate.props.components.visual = {
    kind: "sprite",
    asset: "crate",
    width: 80,
    height: 20,
    originX: 0,
    originY: 0,
  };
  source.sceneComposition.fragments.main.instances = [
    {
      id: "pivot_object",
      prefab: "crate",
      x: 9000,
      y: -5000,
      scale: 2,
      rotationRadians: Math.PI / 2,
    },
    { id: "nearby_object", prefab: "crate", x: 9300, y: -4900 },
  ];
  source.behaviorRecipes = { entities: {} };
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "navigation.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      !document.querySelector(".demo-shell").inert,
  );
  await page.evaluate(() =>
    globalThis.ferrumPlacementViewerSelect("pivot_object"),
  );
  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("KeyF");
  await wait(
    () =>
      Math.abs(globalThis.ferrumPlacementEditCamera.x - 8980) < 0.02 &&
      Math.abs(globalThis.ferrumPlacementEditCamera.y + 4920) < 0.02,
  );
  await assertRenderedObject(page, "pivot_object", timeoutMs);
  const framed = await camera();
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .first()
    .click();
  await wait(
    (saved) =>
      Math.abs(globalThis.ferrumPlacementEditCamera.x - saved.x) < 0.02 &&
      globalThis.ferrumPlacementEditCamera.zoom === saved.zoom,
    tabCamera,
  );
  await page
    .getByRole("tablist", { name: "Scene documents" })
    .getByRole("tab")
    .nth(1)
    .click();
  await wait(
    (saved) =>
      Math.abs(globalThis.ferrumPlacementEditCamera.x - saved.x) < 0.02 &&
      globalThis.ferrumPlacementEditCamera.zoom === saved.zoom,
    framed,
  );

  // At a non-unit zoom, pointer, numeric input, and keyboard must produce one world-space move.
  const pivot = await objectPoint(page, "pivot_object");
  await page.mouse.move(pivot.x, pivot.y);
  await page.mouse.down();
  await page.mouse.move(pivot.x + 10 * framed.zoom, pivot.y, { steps: 4 });
  await page.mouse.up();
  await wait(
    () =>
      Math.abs(
        globalThis.ferrumPlacementViewerState.selected.transform.x - 9010,
      ) < 0.01 &&
      globalThis.ferrumPlacementViewerHistory.undoCount === 1 &&
      !globalThis.ferrumPlacementViewerHistory.transactionLabel,
  );
  const moveOperation = () =>
    page.evaluate(() =>
      globalThis
        .ferrumPlacementViewerExportPatch()
        .operations.find((operation) => operation.kind === "updateTransform"),
    );
  const pointerMove = await moveOperation();
  await page.click("[data-placement-action=undo]");
  await page
    .locator("input[data-placement-transform-field=x]:visible")
    .fill("9010");
  await page.keyboard.press("Home");
  if (JSON.stringify(await camera()) !== JSON.stringify(framed))
    throw new Error("Form Home key changed the edit camera");
  await page.locator("canvas.demo-canvas").focus();
  const numericMove = await moveOperation();
  await page.click("[data-placement-action=undo]");
  await page.locator("canvas.demo-canvas").focus();
  await page.keyboard.press("Shift+ArrowRight");
  const keyboardMove = await moveOperation();
  for (const operation of [pointerMove, numericMove, keyboardMove]) {
    if (
      operation?.instanceId !== "pivot_object" ||
      !Number.isFinite(operation.transform?.x) ||
      Math.abs(operation.transform.x - 9010) > 0.01
    )
      throw new Error(
        `Zoomed world-space move mismatch: ${JSON.stringify(operation)}`,
      );
  }
  await page.click("[data-placement-action=undo]");
  await page.click("[data-placement-view-action=fit-scene]");
  const fits = await page.evaluate(() => {
    const viewport = globalThis.ferrumPlacementViewerState.viewport;
    return (
      viewport.worldMinX <= 8960 &&
      viewport.worldMaxX >= 9380 &&
      viewport.worldMinY <= -5000 &&
      viewport.worldMaxY >= -4840 &&
      !globalThis.ferrumPlacementViewerExportPatch()
    );
  });
  if (!fits)
    throw new Error(
      "Fit Scene did not include rotated/pivoted visuals or changed the draft",
    );
  await mkdir("artifacts/placement-navigation", { recursive: true });
  await page.screenshot({
    path: "artifacts/placement-navigation/fit-scene.png",
    fullPage: true,
  });
  await page.locator("[data-placement-close-document]").nth(1).click();
  await wait(
    (saved) =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 1 &&
      globalThis.ferrumPlacementEditCamera.zoom === saved.zoom,
    tabCamera,
  );
  source.sceneComposition.fragments.main.instances = [];
  await page.locator("input[data-placement-document-file]").setInputFiles({
    name: "empty.scene.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await wait(
    () =>
      globalThis.ferrumPlacementWorkspaceDocuments.length === 2 &&
      !document.querySelector(".demo-shell").inert,
  );
  const emptyCamera = await camera();
  await page.click("[data-placement-view-action=fit-scene]");
  if (JSON.stringify(await camera()) !== JSON.stringify(emptyCamera))
    throw new Error("Empty scene fit should preserve the view");
  const limits = await page.evaluate(() => {
    for (let index = 0; index < 24; index++)
      document.querySelector("[data-placement-view-action=zoom-out]").click();
    const min = globalThis.ferrumPlacementEditCamera.zoom;
    for (let index = 0; index < 40; index++)
      document.querySelector("[data-placement-view-action=zoom-in]").click();
    return {
      min,
      max: globalThis.ferrumPlacementEditCamera.zoom,
      dirty: Boolean(globalThis.ferrumPlacementViewerExportPatch()),
      undo: globalThis.ferrumPlacementViewerHistory.undoCount,
    };
  });
  if (
    limits.min !== 0.125 ||
    limits.max !== 8 ||
    limits.dirty ||
    limits.undo !== 0
  )
    throw new Error(
      `Navigation zoom limits mismatch: ${JSON.stringify(limits)}`,
    );
  await page.locator("[data-placement-close-document]").nth(1).click();
  await page.click("[data-placement-view-action=reset-view]");
  await page.evaluate(() => globalThis.ferrumPlacementViewerSelect());
  if (
    !(await page
      .locator("[data-placement-view-action=frame-selection]")
      .isDisabled())
  )
    throw new Error("Frame must be disabled without a selection");
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
    await highDpr.click("[data-placement-view-action=fit-scene]");
    const target = await objectPoint(highDpr, "crate_left");
    await highDpr.mouse.move(target.x, target.y);
    await highDpr.mouse.wheel(0, -160);
    await highDpr.waitForFunction(
      () =>
        globalThis.ferrumPlacementViewerState.viewport.zoom > 1 &&
        globalThis.ferrumPlacementViewerState.viewport.dpr === 2,
      undefined,
      { timeout: timeoutMs },
    );
    await assertRenderedObject(highDpr, "crate_left", timeoutMs);
    await highDpr.mouse.click(target.x, target.y);
    await highDpr.waitForFunction(
      () =>
        globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "crate_left",
      undefined,
      { timeout: timeoutMs },
    );
    const aligned = await highDpr.evaluate(() => {
      const viewport = globalThis.ferrumPlacementViewerState.viewport;
      const canvas = document.querySelector("canvas").getBoundingClientRect();
      const selection = document
        .querySelector(".placement-selection")
        .getBoundingClientRect();
      return (
        Math.abs(
          selection.x +
            selection.width / 2 -
            canvas.x -
            (692 - viewport.worldMinX) * viewport.zoom,
        ) < 1 &&
        Math.abs(
          selection.y +
            selection.height / 2 -
            canvas.y -
            (478 - viewport.worldMinY) * viewport.zoom,
        ) < 1 &&
        Math.abs(selection.width - 40 * viewport.zoom) < 1 &&
        Math.abs(selection.height - 40 * viewport.zoom) < 1
      );
    });
    if (!aligned)
      throw new Error(
        "DPR 2 selection overlay does not align with the rendered object",
      );
    await highDpr.screenshot({
      path: "artifacts/placement-navigation/dpr-2.png",
      fullPage: true,
    });
    if (errors.length)
      throw new Error(`DPR navigation page errors: ${errors.join(", ")}`);
  } finally {
    await highDpr.close();
  }
  return {
    zoomLimits: limits,
    framedCamera: framed,
    pointerMove,
    numericMove,
    keyboardMove,
    dpr: 2,
    renderAndOverlayAligned: true,
  };
}

export async function smokePlacementNavigationMass(page, timeoutMs) {
  const before = await page.evaluate(() => {
    const draft = JSON.stringify(globalThis.ferrumPlacementViewerExportPatch());
    const history = JSON.stringify(globalThis.ferrumPlacementViewerHistory);
    const started = performance.now();
    document.querySelector("[data-placement-view-action=fit-scene]").click();
    return { draft, history, fitMs: performance.now() - started };
  });
  await page.waitForFunction(
    () => {
      const frame = globalThis.ferrumPlacementViewerRuntimeFrame;
      return (
        frame?.entityCount >= 1030 &&
        frame.renderCommandCount >= 1030 &&
        frame.drawCalls >= 1 &&
        frame.drawCalls <= 16
      );
    },
    undefined,
    { timeout: timeoutMs },
  );
  const after = await page.evaluate(() => ({
    draft: JSON.stringify(globalThis.ferrumPlacementViewerExportPatch()),
    history: JSON.stringify(globalThis.ferrumPlacementViewerHistory),
    frame: globalThis.ferrumPlacementViewerRuntimeFrame,
  }));
  if (
    before.draft !== after.draft ||
    before.history !== after.history ||
    before.fitMs > 500
  )
    throw new Error(
      `Mass navigation state/cost mismatch: ${JSON.stringify({ before, after })}`,
    );
  return { fitMs: before.fitMs, maxFitMs: 500, frame: after.frame };
}

async function objectPoint(page, id) {
  return page.evaluate((id) => {
    const state = globalThis.ferrumPlacementViewerState;
    const object = state.instances.find(
      (instance) => instance.instanceId === id,
    );
    const transform = object.transform,
      visual = object.visual;
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
    const screen = {
      x: (x - state.viewport.worldMinX) * state.viewport.zoom,
      y: (y - state.viewport.worldMinY) * state.viewport.zoom,
    };
    const rect = document.querySelector("canvas").getBoundingClientRect();
    return {
      x: rect.left + screen.x,
      y: rect.top + screen.y,
      screen,
      world: { x, y },
    };
  }, id);
}

async function assertRenderedObject(page, id, timeoutMs) {
  const point = await objectPoint(page, id);
  await page
    .waitForFunction(
      ({ x, y }) => {
        const canvas = document.querySelector("canvas"),
          gl = canvas.getContext("webgl2");
        const viewport = globalThis.ferrumPlacementViewerState.viewport;
        x = (x - viewport.worldMinX) * viewport.zoom;
        y = (y - viewport.worldMinY) * viewport.zoom;
        const pixel = new Uint8Array(4);
        gl.readPixels(
          Math.floor((x * canvas.width) / canvas.clientWidth),
          canvas.height -
            1 -
            Math.floor((y * canvas.height) / canvas.clientHeight),
          1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixel,
        );
        return pixel[0] > 120 && pixel[1] > 70 && pixel[2] < 140;
      },
      point.world,
      { timeout: timeoutMs },
    )
    .catch((error) => {
      throw new Error(
        `Rendered ${id} missing at ${JSON.stringify(point)}: ${error.message}`,
      );
    });
}
