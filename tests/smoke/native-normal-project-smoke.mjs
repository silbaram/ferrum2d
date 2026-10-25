import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";

/** Uses the real Rust writer and optional normal Worker; only native IPC transport is substituted. */
export async function smokeNativeNormals({
  getPage,
  paired = false,
  project,
  scene,
  initial,
  run,
  fixture,
  stage,
  reveal,
  action,
  tool,
  imported,
  pixels,
  origin,
  restart,
  close,
  setCorrupt,
  holdSave,
  waitHeld,
  releaseSave,
}) {
  const idle = () =>
    getPage().waitForFunction(
      () =>
        document.querySelector("[data-placement-aseprite-tool]").dataset
          .asepriteBusy === "false",
    );
  const click = async (name) => {
    await action(name).click();
    await idle();
  };
  const status = () => tool().locator("[data-aseprite-status]").textContent();
  const bindings = () =>
    getPage().evaluate(() =>
      structuredClone(
        window.ferrumPlacementViewerAgentHandoff.normalBindings ?? [],
      ),
    );
  await getPage().locator('[data-placement-mode="spatial"]').click();
  await reveal();
  if (paired) {
    await tool().getByRole("tab", { name: "Preview", exact: true }).click();
    await tool()
      .getByLabel("Aseprite initial animation", { exact: true })
      .selectOption("run");
    await tool()
      .getByLabel("Aseprite loop new clips", { exact: true })
      .uncheck();
  }
  await click(paired ? "paired" : "normals");
  assert.match(await status(), /^Applied normals/);
  const first = (await bindings())[0],
    root = join(project, "public/assets/.ferrum-normals"),
    normalId = first.binding.textures.normal.asset;
  assert(first);
  await mkdir(root, { recursive: true });
  const conflict = join(
    root,
    "normal-" + first.binding.textures.normal.sha256 + ".png",
  );
  await writeFile(conflict, "competing normal");
  await click("save");
  assert.match(await status(), /Project save failed/);
  assert.equal(await readFile(conflict, "utf8"), "competing normal");
  assert.deepEqual(JSON.parse(await readFile(scene, "utf8")), initial);
  await unlink(conflict);
  setCorrupt(true);
  await click("save-normals");
  assert.match(await status(), /failed/i);
  assert.deepEqual(JSON.parse(await readFile(scene, "utf8")), initial);
  setCorrupt(false);
  holdSave();
  await action("save").click();
  await waitHeld();
  await action("cancel").click();
  releaseSave();
  await getPage().waitForTimeout(100);
  assert.deepEqual(JSON.parse(await readFile(scene, "utf8")), initial);
  await click("save");
  assert.match(await status(), /^Project saved/);
  const saved = JSON.parse(await readFile(scene, "utf8"));
  assert.equal(saved.spatial.billboards.sprite.normalTexture, normalId);
  assert.equal((await imported())[0].persisted, true);
  const catalog = JSON.parse(
    await readFile(join(root, "catalog.json"), "utf8"),
  );
  assert.equal(catalog.manifest.textureOptions[normalId].colorSpace, "none");
  assert.equal(
    catalog.manifest.textureOptions[first.binding.textures.color.asset]
      .colorSpace,
    "srgb",
  );
  assert.equal(catalog.entries.length, 1);
  assert(!(await readdir(root)).some((name) => name.endsWith(".tmp")));
  await restart();
  assert.deepEqual((await bindings())[0], first);
  assert((await pixels()).red > 100);
  const before = await getPage().evaluate(() =>
    structuredClone(window.ferrumPlacementViewerHistory),
  );
  await getPage().locator('[data-placement-mode="spatial"]').click();
  await reveal();
  await stage(fixture(true));
  await click(paired ? "reimport-paired" : "reimport-normals");
  assert.match(await status(), /^Applied normals/);
  const second = (await bindings())[0];
  assert.notEqual(second.binding.textures.normal.asset, normalId);
  if (paired) {
    assert.deepEqual(
      second.binding.animationSet.clips.map((c) => [c.id, c.loop]),
      [
        [1, false],
        [0, false],
      ],
    );
    assert.equal(
      second.binding.animationSet.initialClip,
      first.binding.animationSet.initialClip,
    );
  }
  assert.equal(
    await getPage().evaluate(
      () => window.ferrumPlacementViewerHistory.undoCount,
    ),
    before.undoCount + 1,
  );
  await getPage()
    .locator('[data-placement-action="undo"]:visible')
    .first()
    .click();
  await getPage().waitForFunction(
    (id) =>
      window.ferrumPlacementViewerAgentHandoff.normalBindings?.[0]?.binding
        .textures.normal.asset === id,
    normalId,
  );
  await getPage()
    .locator('[data-placement-action="redo"]:visible')
    .first()
    .click();
  await getPage().waitForFunction(
    (id) =>
      window.ferrumPlacementViewerAgentHandoff.normalBindings?.[0]?.binding
        .textures.normal.asset === id,
    second.binding.textures.normal.asset,
  );
  await reveal();
  await click("save");
  assert.match(await status(), /^Project saved/);
  await restart();
  assert.equal(
    (await bindings())[0].binding.textures.normal.asset,
    second.binding.textures.normal.asset,
  );
  assert.deepEqual((await bindings())[0], second);
  assert((await pixels()).blue > 100);
  // Reopened exports retain measured normal assets and current instance evidence.
  await reveal();
  const download = getPage().waitForEvent("download");
  await action("export").click();
  const bundle = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  assert.equal(bundle.normalAssets.length, 1);
  assert.equal(
    bundle.normalBindings[0].binding.textures.normal.asset,
    second.binding.textures.normal.asset,
  );
  await writeFile(
    join(run, "reopened-export.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  const fresh = await getPage().context().newPage();
  await fresh.goto(origin + "/game.html");
  await fresh.waitForFunction(
    () => window.savedGameReport || window.savedGameFailure,
  );
  const game = await fresh.evaluate(() => ({
    report: window.savedGameReport,
    failure: window.savedGameFailure,
  }));
  await fresh.close();
  assert(!game.failure, game.failure);
  assert(game.report.normalLighting.changedPixels > 100);
  if (paired) {
    assert.equal(game.report.animation.uvMatches, 2);
    assert(game.report.animation.finished);
  }
  // Exercise the shared host with the ordinary PNG tool, including its animation descriptor.
  const generic = [];
  for (const animated of paired ? [] : [false, true]) {
    await getPage().locator('[data-placement-mode="spatial"]').click();
    await reveal();
    const normalTool = getPage().locator('[data-placement-normal-tool="true"]');
    await normalTool.locator("summary").click();
    await normalTool
      .getByRole("tab", { name: "Settings", exact: true })
      .click();
    const width = animated ? 32 : 16,
      data = new Uint8Array(width * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < width; x++)
        if (
          Math.hypot(((x % 16) + 0.5) / 16 - 0.5, (y + 0.5) / 16 - 0.5) < 0.44
        )
          data.set(
            x < 16 ? [20, 70, 220, 255] : [30, 220, 50, 255],
            (y * width + x) * 4,
          );
    await normalTool.getByLabel("Normal source image").setInputFiles({
      name: animated ? "native-animation.png" : "native-static.png",
      mimeType: "image/png",
      buffer: encodePngRgba(width, 16, data),
    });
    await getPage().waitForFunction(
      () =>
        document.querySelector('[data-placement-normal-tool="true"]').dataset
          .normalBusy === "false" &&
        document
          .querySelector("[data-normal-source]")
          .textContent.includes("KiB"),
    );
    await normalTool
      .getByLabel("Generated asset name", { exact: true })
      .fill(animated ? "native-animation" : "native-static");
    if (animated) {
      await normalTool.getByLabel("PNG frame grid").check();
      await normalTool.getByLabel("Frame Width", { exact: true }).fill("16");
      await normalTool
        .getByLabel("Frame Width", { exact: true })
        .dispatchEvent("change");
      await normalTool.getByLabel("Frame Height", { exact: true }).fill("16");
      await normalTool
        .getByLabel("Frame Height", { exact: true })
        .dispatchEvent("change");
      await normalTool.getByLabel("Export animation", { exact: true }).check();
    }
    const normalAction = (name) =>
      normalTool.locator(`[data-normal-action="${name}"]`);
    await normalAction("generate").click();
    await getPage().waitForFunction(
      () =>
        document.querySelector('[data-placement-normal-tool="true"]').dataset
          .normalBusy === "false",
    );
    assert.equal(
      await normalTool.getAttribute("data-normal-ready"),
      "true",
      await normalTool.locator("[data-normal-status]").textContent(),
    );
    await normalAction("apply").click();
    await getPage().waitForFunction(() =>
      document
        .querySelector("[data-normal-status]")
        .textContent.includes("Applied"),
    );
    await normalAction("save").click();
    await getPage().waitForFunction(
      () =>
        document.querySelector('[data-placement-normal-tool="true"]').dataset
          .normalBusy === "false",
    );
    assert.match(
      await normalTool.locator("[data-normal-status]").textContent(),
      /Assets saved and registered/,
    );
    const binding = (await bindings())[0].binding;
    assert.equal(!!binding.animationSet, animated);
    await normalTool.locator("summary").click();
    await reveal();
    await click("save");
    assert.match(await status(), /^Project saved/);
    await restart();
    const recovered = (await bindings())[0].binding;
    assert.deepEqual(recovered, binding);
    generic.push({
      animated,
      descriptorPreserved: !animated || !!recovered.generation.descriptorSha256,
      restored: true,
    });
  }
  // Durable protocol and bootstrap reject changed PNG bytes; scene bytes remain untouched.
  const currentCatalog = JSON.parse(
    await readFile(join(root, "catalog.json"), "utf8"),
  );
  const normalPath = join(
    root,
    currentCatalog.manifest.textures[second.binding.textures.normal.asset],
  );
  const original = await readFile(normalPath),
    sceneBytes = await readFile(scene);
  await writeFile(normalPath, "tampered normal PNG");
  const response = await getPage().evaluate(async (project) => {
    try {
      await window.__TAURI__.core.invoke("load_placement_normal_assets", {
        projectPath: project,
      });
      return "accepted";
    } catch (error) {
      return String(error);
    }
  }, project);
  assert.notEqual(response, "accepted");
  assert.deepEqual(await readFile(scene), sceneBytes);
  await writeFile(normalPath, original);
  await getPage().screenshot({
    path: join(run, "native-normal-reopened.png"),
    fullPage: true,
  });
  await close();
  return {
    mode: "hd2d",
    paired,
    realWorker: true,
    realRustStorageAndProtocol: true,
    conflictPreserved: true,
    malformedReplyRejected: true,
    cancelBlocksScene: true,
    savedAndReopened: true,
    normalEvidenceRestored: true,
    reimportUndoRedo: true,
    reopenedExport: true,
    tamperRejected: true,
    savedManifestGame: game.report,
    genericNormalTool: generic,
    released: { urls: 0, textures: 0 },
  };
}
