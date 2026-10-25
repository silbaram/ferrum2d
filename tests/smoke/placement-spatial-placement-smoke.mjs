import { showPlacementInspector } from "./placement-panel-navigation.mjs";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";

/** Real UI + Wasm creation; preview must remain outside the authored/native scene. */
export async function smokeSpatialObjectPlacement(parent, source, timeoutMs) {
  const page = await parent
    .context()
    .browser()
    .newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const wait = async (predicate, arg) => {
    try {
      return await page.waitForFunction(predicate, arg, { timeout: timeoutMs });
    } catch (error) {
      throw new Error(
        String(predicate) +
          "\n" +
          JSON.stringify(
            await page.evaluate(() => ({
              message: document.querySelector(".placement-workspace-message")
                ?.textContent,
              spatialMessage: document.querySelector(
                ".placement-spatial-message",
              )?.textContent,
              preview: document.querySelector(
                "[data-placement-spatial-add-preview]",
              )?.outerHTML,
              armed: document.querySelector("[data-placement-spatial-place]")
                ?.outerHTML,
              bridge: globalThis.ferrumPlacementSpatialProject?.({
                x: 40,
                y: 80,
                elevation: 40,
              }),
              canvas: document
                .querySelector("canvas")
                ?.getBoundingClientRect()
                .toJSON(),
            })),
          ) +
          "\n" +
          error.stack,
      );
    }
  };
  const paint = () =>
    page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  const project = (point) =>
    page.evaluate(
      (point) => globalThis.ferrumPlacementSpatialProject(point),
      point,
    );
  const snapshot = () =>
    page.evaluate(() => ({
      document: JSON.stringify(
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
      patch: JSON.stringify(
        globalThis.ferrumPlacementViewerExportPatch() ?? null,
      ),
      history: globalThis.ferrumPlacementViewerHistory,
      count: globalThis.ferrumPlacementViewerState.instances.length,
    }));
  const arm = async () => {
    await showPlacementInspector(page, "placement");
    await page.click("[data-placement-spatial-place]");
    await paint();
  };
  try {
    await page.goto(parent.url(), { waitUntil: "networkidle" });
    await wait(
      () => globalThis.ferrumPlacementViewerState?.instances.length === 6,
    );
    const conflictingModel = await readFile(
      "examples/data-scene-native/assets/tree.glb",
    );
    const conflictingContentId = createHash("sha256")
      .update(conflictingModel)
      .digest("hex");
    for (const [name, buffer] of [
      [
        "rock.glb",
        await readFile("examples/data-scene-native/assets/rock.glb"),
      ],
      ["tree.glb", conflictingModel],
    ]) {
      await page.locator("[data-placement-model-key]").fill("rock");
      await page.evaluate(() => {
        globalThis.__placementImport = false;
        window.addEventListener(
          "ferrum-placement-model-import",
          () => {
            globalThis.__placementImport = true;
          },
          { once: true },
        );
      });
      await page.locator("[data-placement-model-file]").setInputFiles({
        name,
        mimeType: "model/gltf-binary",
        buffer,
      });
      await wait(() => globalThis.__placementImport);
    }
    await page.locator("[data-placement-document-file]").setInputFiles({
      name: "placement.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        !document.querySelector(".demo-shell").inert,
    );
    await paint();
    await showPlacementInspector(page, "placement");
    await page.selectOption("[data-placement-spatial-add-asset]", "crate");
    const baseline = await snapshot();
    const ground = await project({ x: -65, y: -20, elevation: 0 });
    await arm();
    await page.mouse.move(ground.x, ground.y);
    await wait(
      () =>
        !document.querySelector("[data-placement-spatial-add-preview]").hidden,
    );
    if (JSON.stringify(await snapshot()) !== JSON.stringify(baseline))
      throw new Error(
        "Spatial placement preview created a draft/history entry",
      );
    await page.keyboard.press("Escape");
    if (
      !(await page.locator("[data-placement-spatial-add-preview]").isHidden())
    )
      throw new Error("Escape did not clear placement preview");

    // ID collision must not create half an instance or half a spatial reference.
    await page.locator("[data-placement-spatial-new-id]").fill("sprite");
    await arm();
    await page.mouse.click(ground.x, ground.y);
    if (JSON.stringify(await snapshot()) !== JSON.stringify(baseline))
      throw new Error("Duplicate placement ID changed the document");
    if (
      !(
        await page.locator(".placement-spatial-message").textContent()
      ).includes("already exists")
    )
      throw new Error("Duplicate placement did not reach ID validation");
    await page.keyboard.press("Escape");
    await page.locator("[data-placement-spatial-new-id]").fill("");
    await arm();
    const bridge = await project({ x: 40, y: 80, elevation: 40 });
    await page.mouse.move(bridge.x, bridge.y);
    await wait(
      () =>
        document.querySelector("[data-placement-spatial-add-preview]").dataset
          .surface === "bridge",
    );
    const preview = await page
      .locator("[data-placement-spatial-add-preview]")
      .evaluate((element) => ({
        elevation: +element.dataset.elevation,
        floor: +element.dataset.floor,
      }));
    if (preview.elevation !== 40 || preview.floor !== 1)
      throw new Error("Bridge preview lost its height/floor");
    await page.mouse.click(bridge.x, bridge.y);
    await wait(
      (count) =>
        globalThis.ferrumPlacementViewerState.instances.length === count + 1,
      baseline.count,
    );
    const sprite = await page.evaluate(() => {
      const state = globalThis.ferrumPlacementViewerState;
      return {
        id: state.selectedInstanceId,
        instance: state.selected,
        spatial: state.spatial.billboards[state.selectedInstanceId],
        native: globalThis.ferrumEngine.getPhysicsEntity(state.selected.entity),
        history: globalThis.ferrumPlacementViewerHistory,
        patch: globalThis.ferrumPlacementViewerExportPatch(),
      };
    });
    if (
      sprite.history.undoCount !== baseline.history.undoCount + 1 ||
      sprite.patch.spatial.version !== 2 ||
      !sprite.spatial ||
      sprite.native.heightSpan.elevation !== 40 ||
      sprite.native.heightSpan.floorId !== 1 ||
      sprite.instance.visual.originY !== 1
    )
      throw new Error(
        "Sprite creation was not one atomic supported placement: " +
          JSON.stringify(sprite),
      );
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    if ((await snapshot()).document !== baseline.document)
      throw new Error("Undo did not remove the complete spatial addition");
    await page.evaluate(() => globalThis.ferrumPlacementViewerRedo());
    await wait(
      (id) =>
        globalThis.ferrumEngine.gameplayEntityExists(
          globalThis.ferrumPlacementViewerState.instances.find(
            (instance) => instance.instanceId === id,
          ).entity,
        ),
      sprite.id,
    );

    // Configure the existing snap control, then drag an imported GLB onto a ramp.
    await page.click('[data-placement-mode="2d"]');
    await showPlacementInspector(page, "properties");
    await page.locator("[data-placement-snap-toggle]:visible").check();
    await page.locator("[data-placement-snap-grid]:visible").fill("16");
    await page.locator("canvas.demo-canvas").focus();
    await page.click("[data-placement-mode=spatial]");
    await paint();
    await showPlacementInspector(page, "placement");
    await page.selectOption("[data-placement-spatial-add-kind]", "model");
    await page.selectOption(
      "[data-placement-spatial-add-asset]",
      source.spatial.models.rock.contentId,
    );
    const beforeModel = await snapshot();
    const ramp = await project({ x: -61, y: 61, elevation: 20.5 });
    const canvas = await page.locator("canvas.demo-canvas").boundingBox();
    await page
      .locator("[data-placement-spatial-asset-preview]")
      .dragTo(page.locator("canvas.demo-canvas"), {
        targetPosition: { x: ramp.x - canvas.x, y: ramp.y - canvas.y },
      });
    await wait(
      (count) =>
        globalThis.ferrumPlacementViewerState.instances.length === count + 1,
      beforeModel.count,
    );
    const model = await page.evaluate(() => {
      const state = globalThis.ferrumPlacementViewerState;
      return {
        id: state.selectedInstanceId,
        reference: state.spatial.models[state.selectedInstanceId],
        instance: state.selected,
        live: globalThis.ferrumEngine.gameplayEntityExists(
          state.selected.entity,
        ),
        history: globalThis.ferrumPlacementViewerHistory,
      };
    });
    if (
      model.instance.transform.x !== -64 ||
      model.instance.transform.y !== 64 ||
      model.reference.elevation !== 22 ||
      model.instance.body !== undefined ||
      model.instance.collider.type !== "none" ||
      !model.live ||
      model.reference.asset !== "rock" ||
      model.reference.contentId !== source.spatial.models.rock.contentId ||
      model.history.undoCount !== beforeModel.history.undoCount + 1
    )
      throw new Error(
        "Dragged model lost snapped ramp support or authored identity: " +
          JSON.stringify(model),
      );
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    if ((await snapshot()).document !== beforeModel.document)
      throw new Error("Model Undo changed prior additions");
    await page.evaluate(() => globalThis.ferrumPlacementViewerRedo());

    // Cached assets from another document must not create conflicting authored URLs.
    await page.selectOption(
      "[data-placement-spatial-add-asset]",
      conflictingContentId,
    );
    await arm();
    const beforeConflict = await snapshot();
    const conflictPoint = await project({ x: 0, y: -40, elevation: 0 });
    await page.mouse.click(conflictPoint.x, conflictPoint.y);
    if (
      JSON.stringify(await snapshot()) !== JSON.stringify(beforeConflict) ||
      !(
        await page.locator(".placement-spatial-message").textContent()
      ).includes("different content")
    )
      throw new Error(
        "Conflicting model asset ID validation failed: " +
          JSON.stringify({
            before: beforeConflict,
            after: await snapshot(),
            message: await page
              .locator(".placement-spatial-message")
              .textContent(),
            point: conflictPoint,
          }),
      );
    await page.keyboard.press("Escape");

    // A native apply failure must leave all accepted edits and handles intact.
    await showPlacementInspector(page, "placement");
    await page.selectOption("[data-placement-spatial-add-kind]", "sprite");
    await page
      .locator("[data-placement-spatial-new-id]")
      .fill("native_failure");
    await arm();
    const beforeFailure = await snapshot();
    await page.evaluate(() => {
      const engine = globalThis.ferrumEngine,
        original = engine.configureDataSceneSpatial;
      let reject = true;
      globalThis.__placementRejectedConfigurations = 0;
      engine.configureDataSceneSpatial = (...args) => {
        if (reject) {
          reject = false;
          globalThis.__placementRejectedConfigurations++;
          return false;
        }
        return original(...args);
      };
      globalThis.__restorePlacementConfiguration = () => {
        engine.configureDataSceneSpatial = original;
      };
    });
    try {
      const point = await project({ x: 0, y: -40, elevation: 0 });
      await page.mouse.click(point.x, point.y);
      if (
        (await page.evaluate(
          () => globalThis.__placementRejectedConfigurations,
        )) !== 1
      )
        throw new Error("Placement did not reach native failure injection");
      if (JSON.stringify(await snapshot()) !== JSON.stringify(beforeFailure))
        throw new Error(
          "Native placement rejection left a partial draft/history",
        );
      const live = await page.evaluate(() =>
        globalThis.ferrumPlacementViewerState.instances.every((instance) =>
          globalThis.ferrumEngine.gameplayEntityExists(instance.entity),
        ),
      );
      if (!live)
        throw new Error("Rejected placement left stale native handles");
    } finally {
      await page.evaluate(() => globalThis.__restorePlacementConfiguration());
    }
    await page.keyboard.press("Escape");

    // Mode changes discard only the pending preview, never accepted authoring.
    await page.locator("[data-placement-spatial-new-id]").fill("");
    await arm();
    await page.click('[data-placement-mode="2d"]');
    await page.click("[data-placement-mode=spatial]");
    if (
      (await page
        .locator("[data-placement-spatial-place]")
        .getAttribute("aria-pressed")) !== "false"
    )
      throw new Error("Mode change retained pending placement");
    const authored = await page.evaluate(() =>
      globalThis.ferrumPlacementSpatialExportDocument(),
    );
    if (
      JSON.stringify(authored.behaviorRecipes) !==
      JSON.stringify(source.behaviorRecipes)
    )
      throw new Error("Placement modified agent-owned recipe bodies");
    await page.locator("[data-placement-document-file]").setInputFiles({
      name: "reopened-placement.scene.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(authored)),
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceDocuments.length === 3 &&
        !document.querySelector(".demo-shell").inert,
    );
    const reopened = await page.evaluate(() => ({
      document: globalThis.ferrumPlacementSpatialExportDocument(),
      patch: globalThis.ferrumPlacementViewerExportPatch(),
      history: globalThis.ferrumPlacementViewerHistory,
    }));
    if (
      JSON.stringify(reopened.document) !== JSON.stringify(authored) ||
      reopened.patch ||
      reopened.history.undoCount
    )
      throw new Error(
        "Reopened additions changed authoring or retained draft history",
      );
    await mkdir("artifacts/hd2d-object-placement", { recursive: true });
    await page.screenshot({
      path: "artifacts/hd2d-object-placement/placed-objects.png",
      fullPage: true,
    });
    if (errors.length)
      throw new Error("Spatial placement page errors: " + errors.join("; "));
    return {
      spriteBridge: true,
      modelDragRampSnap: true,
      previewIsTransient: true,
      nativeFailureRollback: true,
      duplicateIdRollback: true,
      conflictingModelAssetRollback: true,
      atomicUndoRedo: true,
      reopen: true,
      modelId: model.id,
      spriteId: sprite.id,
    };
  } catch (error) {
    await mkdir("artifacts/hd2d-object-placement", { recursive: true });
    await page.screenshot({
      path: "artifacts/hd2d-object-placement/failure.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await page.close();
  }
}
