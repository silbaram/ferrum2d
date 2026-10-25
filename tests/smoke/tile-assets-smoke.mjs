import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";
import {
  showPlacementBottom,
  showPlacementInspector,
} from "./placement-panel-navigation.mjs";
import { tileFixture } from "./tile-import-fixtures.mjs";

export async function smokeTileAssets({
  page,
  mode,
  active,
  wait,
  snapshot,
  native,
  undo,
  redo,
  resources,
  run,
  origin,
  getSaves,
  setResume,
}) {
  const tool = page.locator("[data-placement-tile-tool]"),
    action = (name) => tool.locator(`[data-tile-action="${name}"]`),
    idle = () =>
      wait(
        () =>
          document.querySelector("[data-placement-tile-tool]").dataset
            .tileBusy === "false",
      ),
    status = () => tool.locator("[data-tile-status]").textContent(),
    click = async (name) => {
      await action(name).click();
      await idle();
    },
    document = async () =>
      mergeScenePlacementPatch(active, (await snapshot()).state.draftPatch)
        .document,
    imports = () =>
      page.evaluate(() =>
        structuredClone(
          window.ferrumPlacementViewerAgentHandoff.tileImports ?? [],
        ),
      );
  const reveal = async () => {
    await showPlacementBottom(page, "assets");
    if ((await tool.getAttribute("open")) === null)
      await tool.locator("summary").click();
  };
  const select = async (id) => {
    await page.evaluate((id) => window.ferrumPlacementViewerSelect(id), id);
    await reveal();
  };
  const stage = async (
    kind,
    updated = false,
    data = tileFixture(kind, updated),
  ) => {
    await reveal();
    await tool.getByRole("tab", { name: "Source", exact: true }).click();
    await tool
      .getByLabel("Tile source format", { exact: true })
      .selectOption(kind);
    await tool.getByLabel("Tile asset name", { exact: true }).fill("terrain");
    await tool.getByLabel("Tile JSON", { exact: true }).setInputFiles({
      name: kind + ".json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(data.json)),
    });
    await tool.getByLabel("Tileset PNG", { exact: true }).setInputFiles({
      name: "tiles.png",
      mimeType: "image/png",
      buffer: data.png,
    });
    await click("inspect");
  };
  const results = [];
  await reveal();
  for (const kind of ["tiled", "ldtk"]) {
    await select("sprite");
    await stage(kind);
    assert.equal(
      await tool.getAttribute("data-tile-ready"),
      "true",
      await status(),
    );
    const original = await snapshot();
    await click("register");
    assert.match(await status(), /^Registered/);
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      original.state.draftPatch,
    );
    assert.equal(
      (await page
        .locator("[data-placement-browser-asset]")
        .filter({ hasText: kind + "" })
        .count()) > 0,
      true,
    );
    await tool.getByRole("tab", { name: "Preview", exact: true }).click();
    await tool
      .getByLabel("Tile frame", { exact: true })
      .selectOption("terrain.0");
    await click("apply");
    assert.match(await status(), /^Applied/);
    const first = await snapshot(),
      firstImports = await imports();
    assert(firstImports.some((a) => a.kind === kind));
    assert.equal(first.history.undoCount, original.history.undoCount + 1);
    assert((await native()).red > 100);
    await undo();
    await idle();
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      original.state.draftPatch,
    );
    await redo();
    await idle();
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      first.state.draftPatch,
    );
    // Actual catalog frame placement uses the normal 2D/HD-2D placement workflow.
    await reveal();
    await page
      .locator("[data-placement-browser-asset]")
      .filter({ hasText: `(${kind})` })
      .filter({ hasText: "terrain.1" })
      .first()
      .click();
    const beforePlacement = await snapshot();
    if (mode === "hd2d") {
      await showPlacementInspector(page, "placement");
      await page.locator("[data-placement-spatial-place]").click();
    }
    const point = await page.evaluate((mode) => {
      if (mode === "hd2d")
        return window.ferrumPlacementSpatialProject({
          x: -35,
          y: -20,
          elevation: 0,
        });
      const rect = document
        .querySelector("canvas.demo-canvas")
        .getBoundingClientRect();
      return { x: rect.x + rect.width * 0.3, y: rect.y + rect.height * 0.5 };
    }, mode);
    await page.mouse.click(point.x, point.y);
    await wait(
      (n) => window.ferrumPlacementViewerState.instances.length === n,
      beforePlacement.state.instances.length + 1,
    );
    const placed = (
      await document()
    ).sceneComposition.fragments.main.instances.find(
      (i) =>
        !beforePlacement.state.instances.some((p) => p.instanceId === i.id),
    );
    assert(placed);
    assert.match(
      placed.props.components.visual.texture ??
        placed.props.components.visual.asset,
      /^tile\./,
    );
    await undo();
    await wait(
      (n) => window.ferrumPlacementViewerState.instances.length === n,
      beforePlacement.state.instances.length,
    );
    // Two instances reference different named frames; migrate them together.
    let second = (await snapshot()).state.instances.find(
      (i) => i.instanceId !== "sprite",
    )?.instanceId;
    if (!second) {
      await select("sprite");
      await showPlacementInspector(page, "properties");
      await page
        .locator(
          mode === "hd2d"
            ? '[data-placement-spatial-action="duplicate"]'
            : '[data-placement-action="duplicate-selected"]:visible',
        )
        .first()
        .click();
      await wait(
        () => window.ferrumPlacementViewerState.instances.length === 2,
      );
      second = (await snapshot()).state.instances.find(
        (i) => i.instanceId !== "sprite",
      ).instanceId;
    }
    await select(second);
    await tool.getByRole("tab", { name: "Preview", exact: true }).click();
    await tool
      .getByLabel("Tile frame", { exact: true })
      .selectOption("terrain.1");
    await click("apply");
    await select("sprite");
    await stage(kind, true);
    const stable = await snapshot(),
      stableDoc = await document(),
      stableResources = await resources();
    // A real GPU upload that then fails must not change accepted state or resources.
    await page.evaluate(() => {
      const engine = window.ferrumEngine,
        load = engine.loadAssets.bind(engine);
      engine.loadAssets = async (manifest) => {
        engine.loadAssets = load;
        await load(manifest);
        throw Error("tile upload failure");
      };
    });
    await click("reimport");
    assert.match(await status(), /tile upload failure/);
    assert.deepEqual(await snapshot(), stable);
    assert.deepEqual(await resources(), stableResources);
    const pauseUpload = async () =>
      page.evaluate(() => {
        delete window.releaseTileUpload;
        const engine = window.ferrumEngine,
          load = engine.loadAssets.bind(engine);
        engine.loadAssets = async (manifest) => {
          engine.loadAssets = load;
          await load(manifest);
          await new Promise((done) => {
            window.releaseTileUpload = done;
          });
        };
      });
    await pauseUpload();
    await action("reimport").click();
    await wait(() => !!window.releaseTileUpload);
    await page.locator('button[data-placement-lock-instance="sprite"]').click();
    await page.evaluate(() => window.releaseTileUpload());
    await idle();
    assert.match(await status(), /unlock/);
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      stable.state.draftPatch,
    );
    await page.locator('button[data-placement-lock-instance="sprite"]').click();
    assert.deepEqual(await snapshot(), stable);
    assert.deepEqual(await resources(), stableResources);
    await pauseUpload();
    await action("reimport").click();
    await wait(() => !!window.releaseTileUpload);
    await click("cancel");
    await action("reimport").click();
    await page.evaluate(() => window.releaseTileUpload());
    await idle();
    assert.match(await status(), /^Applied/);
    const changed = await snapshot(),
      changedDoc = await document(),
      current = (await imports()).filter((a) => a.kind === kind);
    assert.equal(changed.history.undoCount, stable.history.undoCount + 1);
    assert.equal(current.length, 1);
    for (const instance of changedDoc.sceneComposition.fragments.main
      .instances) {
      const old = stableDoc.sceneComposition.fragments.main.instances.find(
        (i) => i.id === instance.id,
      );
      for (const key of ["x", "y", "scale", "rotationRadians"])
        assert.equal(instance[key], old[key]);
      for (const key of ["body", "collider", "layer"])
        assert.deepEqual(
          instance.props.components[key],
          old.props.components[key],
        );
      assert.equal(
        instance.props.components.visual.texture,
        current[0].assetId,
      );
    }
    assert((await native()).blue > 100);
    await undo();
    await idle();
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      stable.state.draftPatch,
    );
    await redo();
    await idle();
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      changed.state.draftPatch,
    );
    const beforeSave = getSaves();
    await page.evaluate(() => window.ferrumPlacementViewerSaveDraft());
    assert.match(
      await page.evaluate(() => window.ferrumPlacementViewerLastSaveError),
      /Save tile sources.*Save Project.*Export Assets/,
    );
    assert.equal(
      getSaves(),
      beforeSave,
      "Scene save must require durable tile assets",
    );
    const missing = tileFixture(kind, true);
    if (kind === "tiled") missing.json.layers[0].data = [22, 22];
    else
      missing.json.levels[0].layerInstances[0].gridTiles = [
        { px: [0, 0], src: [16, 0], t: 1, f: 0 },
      ];
    // Change raw bytes to stage a distinct revision with a removed used frame.
    await stage(kind, true, missing);
    assert(await action("reimport").isDisabled());
    assert.match(
      await action("reimport").getAttribute("title"),
      /missing frame/,
    );
    assert.deepEqual(
      (await snapshot()).state.draftPatch,
      changed.state.draftPatch,
    );
    await stage(kind, true);
    const downloading = page.waitForEvent("download");
    await action("export").click();
    const exported = JSON.parse(
      await readFile(await (await downloading).path(), "utf8"),
    );
    for (const file of exported.files)
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(file.base64, "base64"))
          .digest("hex"),
        file.sha256,
      );
    setResume({ bundle: exported });
    const fresh = await page.context().newPage(),
      freshErrors = [];
    fresh.on("pageerror", (error) =>
      freshErrors.push(error.stack ?? String(error)),
    );
    fresh.on("requestfailed", (request) =>
      freshErrors.push(request.url() + ": " + request.failure()?.errorText),
    );
    fresh.on("console", (message) => {
      if (message.type() === "error") freshErrors.push(message.text());
    });
    await fresh.goto(origin + "/resume.html");
    try {
      await fresh.waitForFunction(() => window.report || window.failure);
    } catch (error) {
      throw Error(
        String(error) + "\nFresh bootstrap: " + freshErrors.join("\n"),
      );
    }
    const resumed = await fresh.evaluate(() => ({
      report: window.report,
      failure: window.failure,
    }));
    await fresh.close();
    assert(!resumed.failure, resumed.failure);
    await writeFile(
      join(run, mode + "-" + kind + "-export.json"),
      JSON.stringify(exported, null, 2) + "\n",
    );
    results.push({
      kind,
      registered: true,
      placement: true,
      multiTargetReimport: true,
      oneUndo: true,
      uploadRollback: true,
      lockRevalidated: true,
      cancelRetry: true,
      missingFrameRejected: true,
      saveGuard: true,
      freshSession: resumed.report,
    });
  }
  await reveal();
  await page.locator('[data-placement-dock-resize="runtime"]').focus();
  await page.keyboard.press("End");
  await tool.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(run, mode + "-tile-assets.png") });
  return { formats: results };
}
