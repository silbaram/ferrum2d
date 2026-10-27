import {
  showPlacementInspector,
  showPlacementBottom,
  showPlacementViewOptions,
  clickPlacementControl,
} from "./placement-panel-navigation.mjs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";

/** Real UI/Wasm, with the desktop file bridge simulated at its public boundary. */
export async function smokeAuthoringUpgrades(parent, source, timeoutMs) {
  const page = await parent
    .context()
    .browser()
    .newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let modelBytes = await readFile("examples/data-scene-native/assets/rock.glb");
  const nextBytes = await readFile(
    "examples/data-scene-native/assets/tree.glb",
  );
  const nextHash = createHash("sha256").update(nextBytes).digest("hex");
  await mkdir("artifacts/authoring-workspace-upgrades", { recursive: true });
  await writeFile(
    "artifacts/authoring-workspace-upgrades/browser-fixture.json",
    JSON.stringify(source),
  );
  const document = structuredClone(source);
  document.variables = [
    { name: "scene.count", scope: "scene", type: "integer", default: 3 },
    { name: "campaign.ready", scope: "global", type: "bool", default: true },
  ];
  const origin = new URL(parent.url()).origin;
  await page.route("**/__upgrades/rock.glb*", (route) =>
    route.fulfill({ body: modelBytes, contentType: "model/gltf-binary" }),
  );
  await page.addInitScript(
    ({ document, origin }) => {
      let saved =
        JSON.parse(localStorage.getItem("ferrum.upgrades.saved") ?? "null") ??
        structuredClone(document);
      globalThis.__upgradeRevision = "file-revision-1"; // A file fingerprint is deliberately NOT a GLB SHA.
      const projectPath = "/tmp/ferrum-upgrades",
        sceneDocumentPath = projectPath + "/public/scene-authoring.json",
        handoffPath = projectPath + "/.ferrum-placement-handoff.json";
      const folder = () => ({
        assetFolderPath: projectPath + "/public/assets",
        exists: true,
        imageCount: globalThis.__upgradeTextureDataURL ? 1 : 0,
        images: globalThis.__upgradeTextureDataURL
          ? [
              {
                id: "texture-check",
                fileName: "texture-check.png",
                path: projectPath + "/public/assets/texture-check.png",
                runtimeUrl: globalThis.__upgradeTextureDataURL,
                contentRevision: "texture-revision-1",
              },
            ]
          : [],
        models: [
          {
            id: "rock",
            fileName: "rock.glb",
            path: projectPath + "/public/assets/rock.glb",
            runtimeUrl: origin + "/__upgrades/rock.glb",
            contentRevision: globalThis.__upgradeRevision,
          },
        ],
        diagnostics: [],
      });
      globalThis.__upgradeCommands = [];
      globalThis.__TAURI__ = {
        core: {
          async invoke(command, args) {
            globalThis.__upgradeCommands.push(command);
            if (command === "load_placement_tile_assets") {
              return {
                format: "ferrum2d.tile-import.project",
                version: 1,
                assets: [],
              };
            }
            if (command === "load_placement_aseprite_assets")
              return {
                format: "ferrum2d.aseprite.project",
                version: 1,
                assets: [],
              };
            if (command === "load_placement_normal_assets")
              return {
                format: "ferrum2d.sprite-normal.project",
                version: 1,
                registered: true,
                entries: [],
                textures: {},
              };
            if (command === "load_placement_project_folder")
              return {
                projectPath,
                sceneDocumentPath,
                handoffPath,
                assetFolder: folder(),
                document: saved,
              };
            if (command === "load_placement_scene_document")
              return { path: sceneDocumentPath, document: saved };
            if (command === "inspect_placement_asset_folder") return folder();
            if (command === "save_placement_agent_handoff")
              return { path: handoffPath, handoff: args.handoff };
            if (command === "save_placement_scene_document") {
              if (
                JSON.stringify(saved) !== JSON.stringify(args.expectedDocument)
              )
                throw new Error("CAS source changed");
              saved = structuredClone(args.document);
              localStorage.setItem(
                "ferrum.upgrades.saved",
                JSON.stringify(saved),
              );
              globalThis.__upgradeSaved = saved;
              return { path: sceneDocumentPath, document: saved };
            }
            throw new Error("Unsupported upgrade bridge command: " + command);
          },
        },
      };
    },
    { document, origin },
  );
  const wait = async (fn, arg) => {
    try {
      return await page.waitForFunction(fn, arg, { timeout: timeoutMs });
    } catch (error) {
      throw new Error(
        String(fn) +
          "\n" +
          JSON.stringify(
            await page.evaluate(() => ({
              state: globalThis.ferrumPlacementViewerState?.selectedInstanceId,
              mode: globalThis.ferrumPlacementWorkspaceMode,
              message: document.querySelector(".placement-spatial-message")
                ?.textContent,
              asset: document.querySelector(".placement-asset-changes")
                ?.textContent,
              workspace: document.querySelector(".placement-workspace-message")
                ?.textContent,
              frame: globalThis.ferrumPlacementViewerRuntimeFrame,
              camera: globalThis.ferrumPlacementSpatialCamera,
              point: globalThis.ferrumPlacementSpatialProject?.({
                x: 70,
                y: -40,
                elevation: 0,
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
  const snapshot = () =>
    page.evaluate(() => ({
      document: JSON.stringify(
        globalThis.ferrumPlacementSpatialExportDocument(),
      ),
      patch: JSON.stringify(
        globalThis.ferrumPlacementViewerExportPatch() ?? null,
      ),
      history: globalThis.ferrumPlacementViewerHistory,
    }));
  const project = (point) =>
    page.evaluate(
      (point) => globalThis.ferrumPlacementSpatialProject(point),
      point,
    );
  const target = async (value) => {
    await showPlacementInspector(page, "properties");
    await page.selectOption("[data-placement-spatial-target]", value);
  };
  const count = () =>
    page.evaluate(() => globalThis.ferrumPlacementViewerState.instances.length);
  async function place(point) {
    const screen = await project(point);
    assert(screen, "Projection missing");
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.click(screen.x, screen.y);
    await paint();
  }
  async function detail(label) {
    if (label === "Asset Changes") {
      await showPlacementBottom(page, "assets");
    }
    if (label === "Selected Runtime") {
      await showPlacementBottom(page, "runtime");
      return;
    }
    if (label === "Agent Changes") {
      await showPlacementBottom(page, "changes");
      return;
    }
    if (label === "Problems") {
      await showPlacementBottom(page, "problems");
      return;
    }
    await showPlacementInspector(page, "properties");
    const locator = page
      .locator("details")
      .filter({
        has: page.locator("summary", {
          hasText: new RegExp("^" + label + "$"),
        }),
      })
      .first();
    await locator.evaluate((el) => (el.open = true));
    await paint();
  }
  try {
    await page.goto(origin + "/?projectPath=/tmp/ferrum-upgrades", {
      waitUntil: "networkidle",
    });
    await wait(
      () =>
        globalThis.ferrumPlacementWorkspaceMode === "spatial" &&
        globalThis.ferrumPlacementViewerState?.instances.length === 2 &&
        !document.querySelector(".demo-shell").inert,
    );
    const baseline = await snapshot();
    await showPlacementBottom(page, "assets");
    await page.locator("[data-placement-asset-search]").fill("crate");
    assert(
      await page
        .locator('[data-placement-browser-asset="sprite:crate"]')
        .count(),
    );
    await page
      .getByRole("button", { name: "Favorite Crate", exact: true })
      .click();
    await page.selectOption("[data-placement-asset-filter]", "favorite");
    assert(
      await page
        .locator('[data-placement-browser-asset="sprite:crate"]')
        .count(),
    );
    await page.selectOption("[data-placement-asset-filter]", "all");
    await page.locator('[data-placement-browser-asset="sprite:crate"]').click();
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-spatial-repeat]").check();
    await page.locator("[data-placement-spatial-add-rotation]").fill("30");
    await page.locator("[data-placement-spatial-add-scale]").fill("1.5");
    // Re-arm after changing placement settings: no authored/history mutation before a click.
    await page.keyboard.press("Escape");
    await page.locator("[data-placement-spatial-place]").click();
    assert.deepEqual(await snapshot(), baseline);
    await place({ x: 30, y: 80, elevation: 40 });
    await wait(
      () => globalThis.ferrumPlacementViewerState.instances.length === 3,
    );
    const sprite = await page.evaluate(
      () => globalThis.ferrumPlacementViewerState.selected,
    );
    assert.equal(sprite.transform.scale, 1.5);
    assert(Math.abs(sprite.transform.rotationRadians - Math.PI / 6) < 1e-8);
    assert.equal(sprite.body.heightSpan.floorId, 1);
    assert.equal(
      await page
        .locator('[data-placement-browser-asset="sprite:crate"]')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      await page.locator("[data-placement-tool-status]").textContent(),
      /Place: crate/,
    );
    const once = (await snapshot()).history.undoCount;
    await place({ x: -75, y: -45, elevation: 0 });
    await wait(
      () => globalThis.ferrumPlacementViewerState.instances.length === 4,
    );
    assert.equal((await snapshot()).history.undoCount, once + 1);
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("[data-placement-tool-cancel]").isHidden(),
      true,
    );
    assert.equal(
      await page.locator("[data-placement-spatial-add-preview]").isHidden(),
      true,
    );
    await target("billboard:" + sprite.instanceId);
    await page
      .locator("[data-placement-spatial-rename]")
      .fill("renamed_sprite");
    await page.locator('[data-placement-spatial-action="rename"]').click();
    await wait(
      () =>
        !!globalThis.ferrumPlacementViewerState.spatial?.billboards
          .renamed_sprite,
    );
    await page.locator('[data-placement-spatial-action="duplicate"]').click();
    await wait(
      () =>
        globalThis.ferrumPlacementViewerState.selectedInstanceId ===
        "renamed_sprite_copy_1",
    );
    await page.locator('[data-placement-spatial-action="remove"]').click();
    assert.equal(await count(), 4);
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    assert.equal(await count(), 5);
    await page.evaluate(() => globalThis.ferrumPlacementViewerRedo());
    assert.equal(await count(), 4);
    // Actual cold GLB thumbnails from public geometry, followed by a visual-only placement.
    await page.selectOption("[data-placement-asset-filter]", "recent");
    assert(
      await page
        .locator('[data-placement-browser-asset="sprite:crate"]')
        .count(),
    );
    await page.locator("[data-placement-asset-search]").fill("rock");
    await page.selectOption("[data-placement-asset-filter]", "model");
    const modelButton = page
      .locator('[data-placement-browser-asset^="model-file:"]')
      .first();
    assert(
      (
        await modelButton
          .locator(".placement-browser-thumbnail")
          .getAttribute("style")
      ).includes("image/svg"),
    );
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-spatial-repeat]").uncheck();
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-spatial-new-id]").fill("new_model");
    await modelButton.click();
    await paint();

    await place({ x: 70, y: -40, elevation: 0 });
    await wait(
      () => !!globalThis.ferrumPlacementViewerState.spatial?.models.new_model,
    );
    await detail("Collision Proxy");
    const visualElevation = await page.evaluate(
      () =>
        globalThis.ferrumPlacementViewerState.spatial.models.new_model
          .elevation ?? 0,
    );
    for (const [field, value] of Object.entries({
      width: 24,
      depth: 12,
      height: 20,
      elevation: 8,
      floorId: 3,
      yaw: 35,
    }))
      await page
        .locator(`[data-placement-proxy-field="${field}"]`)
        .fill(String(value));
    await page.selectOption("[data-placement-proxy-shape]", "orientedBox");
    const beforeProxy = (await snapshot()).history.undoCount;
    await page.locator("[data-placement-proxy-apply]").click();
    await wait(
      () =>
        globalThis.ferrumPlacementViewerState.selected?.collider?.type ===
        "orientedBox",
    );
    const proxy = await page.evaluate(
      () => globalThis.ferrumPlacementViewerState.selected,
    );
    assert.equal(proxy.collider.halfWidth, 12);
    assert.equal(proxy.body.heightSpan.floorId, 3);
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.ferrumPlacementViewerState.spatial.models.new_model
            .elevation +
          globalThis.ferrumPlacementViewerState.selected.body.heightSpan
            .elevation,
      ),
      visualElevation,
    );
    assert.equal((await snapshot()).history.undoCount, beforeProxy + 1);
    await showPlacementViewOptions(page);
    await page.locator("[data-placement-proxy-overlay]").check();
    await wait(
      () =>
        globalThis.ferrumPlacementViewerRuntimeFrame.spatial.debugVertices > 0,
    );
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerState.selected.body,
      ),
      undefined,
    );
    await page.evaluate(() => globalThis.ferrumPlacementViewerRedo());
    const proxyField = (field) => page.locator(`[data-placement-proxy-field="${field}"]`);
    const proxyDocument = () => page.evaluate(() => JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()));
    const assertProxyWidth = async (width) => {
      assert.equal(Number(await proxyField("width").inputValue()), width);
      assert.equal(await page.evaluate(() => globalThis.ferrumPlacementViewerState.selected.collider.halfWidth * 2), width);
    };
    await assertProxyWidth(24);
    // Same-instance edits and history must refresh the actual field values.
    await proxyField("width").fill("48");
    await page.locator("[data-placement-proxy-apply]").click();
    await assertProxyWidth(48);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await assertProxyWidth(24);
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await assertProxyWidth(48);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await assertProxyWidth(24);
    // Lock-state refresh must not discard an unapplied input draft.
    await proxyField("width").fill("37");
    const lock = page.locator('[data-placement-lock-instance="new_model"]');
    await lock.click();
    assert(await proxyField("width").isDisabled());
    assert(await page.locator("[data-placement-proxy-apply]").isDisabled());
    assert(await page.locator("[data-placement-proxy-remove]").isDisabled());
    assert.equal(await proxyField("width").inputValue(), "37");
    await lock.click();
    assert.equal(await proxyField("width").inputValue(), "37");
    await proxyField("width").fill("24");
    const proxyBeforeRemoval = await proxyDocument();
    for (const [field, value] of [["width", "0"], ["floorId", "-1"], ["offsetX", ""]]) {
      await proxyField(field).fill(value);
      await page.locator("[data-placement-proxy-apply]").click();
      assert.equal(await proxyDocument(), proxyBeforeRemoval, "Invalid Apply changed the proxy");
      const beforeRemove = (await snapshot()).history.undoCount;
      await page.locator("[data-placement-proxy-remove]").click();
      assert.equal(await page.evaluate(() => globalThis.ferrumPlacementViewerState.selected.body), undefined);
      assert.equal((await snapshot()).history.undoCount, beforeRemove + 1);
      assert.equal(await page.evaluate(() => globalThis.ferrumPlacementViewerState.spatial.models.new_model.elevation), visualElevation);
      await page.getByRole("button", { name: "Undo", exact: true }).click();
      assert.equal(await proxyDocument(), proxyBeforeRemoval);
      await assertProxyWidth(24);
      assert.equal(Number(await proxyField("floorId").inputValue()), 3);
      assert.equal(Number(await proxyField("offsetX").inputValue()), 0);
    }
    // Floor filtering is presentation-only, including native rendering/picking.
    await detail("Floor Visibility");
    const beforeFilter = await snapshot();
    const entities = await page.evaluate(
      () => globalThis.ferrumPlacementViewerRuntimeFrame.entityCount,
    );
    await showPlacementViewOptions(page);
    await page.selectOption("[data-placement-focus-floor]", "1");
    await page.keyboard.press("Escape");
    await page.locator("[data-placement-ghost-floors]").check();
    await wait(
      () =>
        document.querySelectorAll(".placement-floor-ghosts polygon").length >
          0 &&
        globalThis.ferrumPlacementViewerRuntimeFrame.spatial.modelDraws === 0,
    );
    assert.deepEqual(await snapshot(), beforeFilter);
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerRuntimeFrame.entityCount,
      ),
      entities,
    );
    const hiddenPoint = await project({ x: -40, y: 0, elevation: 16 });
    await page.mouse.click(hiddenPoint.x, hiddenPoint.y);
    assert.notEqual(
      await page.evaluate(() => globalThis.ferrumPlacementSpatialTarget?.id),
      "sprite",
    );
    await showPlacementViewOptions(page);
    await page.selectOption("[data-placement-focus-floor]", "all");
    await page.keyboard.press("Escape");
    await page.locator("[data-placement-ghost-floors]").uncheck();
    const overlap = await project({ x: 40, y: 80, elevation: 40 });
    await page.mouse.click(overlap.x, overlap.y, { button: "right" });
    await wait(
      () =>
        document.querySelectorAll("[data-placement-pick-candidate]").length >=
        2,
    );
    assert(
      await page.locator('[data-placement-pick-candidate="ground"]').count(),
    );
    await page.locator('[data-placement-pick-candidate="bridge"]').click();
    assert.equal(
      await page.evaluate(() => globalThis.ferrumPlacementSpatialTarget.id),
      "bridge",
    );
    const beforeCamera = await snapshot();
    await clickPlacementControl(page, '[data-placement-spatial-frame="true"]');
    await clickPlacementControl(page, '[data-placement-spatial-frame="false"]');
    assert.deepEqual(await snapshot(), beforeCamera);
    await target("model:new_model");
    await detail("Selected Runtime");
    await wait(() =>
      globalThis.ferrumPlacementSelectedRuntime?.variables?.some(
        (v) => v.name === "scene.count" && v.value === 3,
      ),
    );
    assert.equal(
      await page.evaluate(() => globalThis.ferrumPlacementSelectedRuntime.mode),
      "spatial",
    );
    await page.locator('[data-placement-mode="game"]').click();
    await wait(
      () =>
        globalThis.ferrumPlacementSelectedRuntime?.mode === "game" &&
        globalThis.ferrumPlacementSelectedRuntime.gameplay,
    );
    await page.evaluate(() => {
      const id = globalThis.ferrumPlacementSelectedRuntime.instanceId,
        handle = globalThis.ferrumPlacementSelectedRuntime.entity;
      globalThis.ferrumEngine.applyGameplayBehaviorCommands(
        [
          {
            entity: id,
            recipe: "runtime-diagnostics",
            tags: [],
            type: "configureHealth",
            max: 12,
            current: 12,
            onZero: "despawn",
          },
          {
            entity: id,
            recipe: "runtime-diagnostics",
            tags: [],
            type: "configureTimerTrigger",
            timer: "diagnostic",
            timerId: 51,
            seconds: 0.05,
          },
        ],
        { [id]: handle },
      );
    });
    await wait(
      () => globalThis.ferrumPlacementSelectedRuntime.recentEvents.length > 0,
    );
    const summary = page.locator("[data-placement-runtime-summary]");
    assert.match(
      await summary.textContent(),
      /new_model.*Game Preview.*Read-only.*4 Hz/,
    );
    assert.match(await summary.textContent(), /Health12/);
    assert.match(await summary.textContent(), /Timer51.*Fired/);
    assert.match(await summary.textContent(), /FSMNot configured/);
    assert.equal(
      await page.locator("[data-placement-runtime-raw]").getAttribute("open"),
      null,
    );
    await summary.locator("summary", { hasText: /^Variables/ }).click();
    assert.match(await summary.innerText(), /scene.count.*scene[\s\S]*3/);
    assert.match(
      await summary.innerText(),
      /campaign.ready.*global[\s\S]*true/,
    );
    await summary.locator("summary", { hasText: /^Recent Events/ }).click();
    assert.match(await summary.innerText(), /Kind timer · Actor/);
    await page.evaluate(() => globalThis.ferrumPlacementViewerSelect("rock"));
    await wait(
      () =>
        globalThis.ferrumPlacementSelectedRuntime?.instanceId === "rock" &&
        globalThis.ferrumPlacementSelectedRuntime.recentEvents.length === 0,
    );
    assert.match(await summary.innerText(), /rock.*Game Preview/);
    assert.match(await summary.innerText(), /No events recorded/);
    assert.doesNotMatch(await summary.innerText(), /Kind \w+ · Actor/);
    await page.evaluate(() =>
      globalThis.ferrumPlacementViewerSelect("new_model"),
    );
    await page.locator('[data-placement-mode="spatial"]').click();
    await wait(
      () => globalThis.ferrumPlacementSelectedRuntime?.mode === "spatial",
    );
    // Explicit reimport: detect only, fail safely, retry new bytes, then one history entry.
    await detail("Asset Changes");
    const beforeImport = await snapshot();
    await page.evaluate(
      () => (globalThis.__upgradeRevision = "file-revision-2"),
    );
    modelBytes = Buffer.from("invalid GLB");
    await page.locator("[data-placement-check-assets]").click();
    await wait(() =>
      document
        .querySelector(".placement-asset-changes")
        .textContent.includes("changes detected"),
    );
    assert.deepEqual(await snapshot(), beforeImport);
    await modelButton.click();
    await page.locator("[data-placement-apply-assets]").click();
    await wait(
      () =>
        !document.querySelector(".demo-shell").inert &&
        !document.querySelector("[data-placement-apply-assets]").disabled,
    );
    assert.deepEqual(await snapshot(), beforeImport);
    assert.equal(
      await page.locator("[data-placement-tool-cancel]").isHidden(),
      true,
    );
    modelBytes = nextBytes;
    await page.locator("[data-placement-apply-assets]").click();
    await wait(
      (hash) =>
        globalThis.ferrumPlacementViewerState.spatial.models.rock.contentId ===
          hash && !document.querySelector(".demo-shell").inert,
      nextHash,
    );
    assert.equal(
      (await snapshot()).history.undoCount,
      beforeImport.history.undoCount + 1,
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerState.spatial.models.rock.asset,
      ),
      "rock",
    );
    await page.evaluate(() => globalThis.ferrumPlacementViewerUndo());
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.ferrumPlacementViewerState.spatial.models.rock.contentId,
      ),
      source.spatial.models.rock.contentId,
    );
    await page.evaluate(() => globalThis.ferrumPlacementViewerRedo());
    await page.evaluate(() => globalThis.ferrumPlacementViewerSaveDraft());
    await wait(
      () =>
        !!globalThis.__upgradeSaved &&
        !globalThis.ferrumPlacementViewerExportPatch(),
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.__upgradeSaved.spatial.models.rock.contentId,
      ),
      nextHash,
    );
    assert.equal(
      await page.evaluate(
        () =>
          globalThis.__upgradeSaved.spatial.billboards.renamed_sprite !==
          undefined,
      ),
      true,
    );
    const savedDocument = await page.evaluate(() =>
      JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
    );
    await page.reload({ waitUntil: "networkidle" });
    await wait(
      (hash) =>
        globalThis.ferrumPlacementViewerState?.spatial?.models.rock
          .contentId === hash && !globalThis.ferrumPlacementViewerExportPatch(),
      nextHash,
    );
    assert.equal(
      await page.evaluate(() =>
        JSON.stringify(globalThis.ferrumPlacementSpatialExportDocument()),
      ),
      savedDocument,
    );
    // Shared 2D browser and pre-placement transform remain usable in the same session.
    await page.locator('[data-placement-mode="2d"]').click();
    await showPlacementBottom(page, "assets");
    await page.locator("[data-placement-asset-search]").fill("crate");
    await page.selectOption("[data-placement-asset-filter]", "sprite");
    await showPlacementInspector(page, "placement");
    await page.locator("[data-placement-add-rotation]").fill("45");
    await page.locator("[data-placement-add-scale]").fill("2");
    await page.locator("[data-placement-repeat]").check();
    await page.locator('[data-placement-browser-asset="sprite:crate"]').click();
    const canvas = await page.locator("canvas.demo-canvas").boundingBox();
    const previousCount = await count();
    await page.mouse.click(
      canvas.x + canvas.width * 0.4,
      canvas.y + canvas.height * 0.6,
    );
    await page.mouse.click(
      canvas.x + canvas.width * 0.5,
      canvas.y + canvas.height * 0.6,
    );
    await wait(
      (n) => globalThis.ferrumPlacementViewerState.instances.length === n,
      previousCount + 2,
    );
    assert.equal(
      await page.evaluate(
        () => globalThis.ferrumPlacementViewerState.selected.transform.scale,
      ),
      2,
    );
    await page.keyboard.press("Escape");
    await detail("Asset Changes");
    await page.locator("[data-placement-watch-assets]").check();
    await wait(() =>
      document
        .querySelector(".placement-asset-changes")
        .textContent.includes("Assets are current"),
    );
    const beforeTexture = await snapshot();
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const c = canvas.getContext("2d");
      c.fillStyle = "#2266cc";
      c.fillRect(0, 0, 2, 2);
      globalThis.__upgradeTextureDataURL = canvas.toDataURL();
    });
    await wait(() =>
      document
        .querySelector(".placement-asset-changes")
        .textContent.includes("Added · texture-check"),
    );
    assert.deepEqual(await snapshot(), beforeTexture);
    await page.locator("[data-placement-watch-assets]").uncheck();
    await page.locator('[data-placement-browser-asset="sprite:crate"]').click();
    await page.locator("[data-placement-apply-assets]").click();
    await wait(
      () =>
        document
          .querySelector(".placement-asset-changes")
          .textContent.includes("Assets applied") &&
        Number.isInteger(
          globalThis.ferrumPlacementViewerRuntimeAssets.textureIds[
            "texture-check"
          ],
        ),
    );
    assert.deepEqual(await snapshot(), beforeTexture);
    assert.equal(
      await page.locator("[data-placement-tool-cancel]").isHidden(),
      true,
    );
    assert.equal(
      await page
        .locator('[data-placement-browser-asset="sprite:crate"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    assert.deepEqual(errors, []);
    await mkdir("artifacts/authoring-workspace-upgrades", { recursive: true });
    await page.screenshot({
      path: "artifacts/authoring-workspace-upgrades/workspace-2d.png",
      fullPage: true,
    });
    await page.locator('[data-placement-mode="spatial"]').click();
    await paint();
    await page.screenshot({
      path: "artifacts/authoring-workspace-upgrades/workspace-spatial.png",
      fullPage: true,
    });
    const costs = await page.evaluate(
      () => globalThis.ferrumPlacementViewerRuntimeFrame,
    );
    assert(
      costs.drawCalls <= 32 &&
        costs.entityCount <= 16 &&
        costs.spatial.modelDraws <= 16,
      "Small authoring scene exceeded render/work bounds",
    );
    const result = {
      costs,
      assetBrowser: true,
      repeatAndTransform: true,
      identityMigration: true,
      explicitProxyAndOverlay: true,
      floorFilteringAndGhosts: true,
      overlapCandidates: true,
      cameraAndInspector: true,
      readOnlyDiagnostics: true,
      nativeTimerEventsAndSelectionIsolation: true,
      explicitReimportFailureRetryUndoSave: true,
      reopenSavedGlb: true,
      shared2d: true,
      automaticDetectionAndExplicitTextureUpload: true,
      desktopHost: "simulated",
      nativeRuntime: "real Wasm",
      modelContentId: nextHash,
    };
    await writeFile(
      "artifacts/authoring-workspace-upgrades/browser-upgrades.json",
      JSON.stringify(result, null, 2),
    );
    return result;
  } catch (error) {
    await mkdir("artifacts/authoring-workspace-upgrades", { recursive: true });
    await page.screenshot({
      path: "artifacts/authoring-workspace-upgrades/failure-upgrades.png",
      fullPage: true,
    });
    throw error;
  } finally {
    await page.close();
  }
}
