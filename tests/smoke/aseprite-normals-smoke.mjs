import { strict as assert } from "node:assert";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";
import { sha256 } from "../../scripts/tools/sprite-normals-tool.mjs";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";
import { showPlacementInspector } from "./placement-panel-navigation.mjs";

/** Runs through the real app, real optional Worker/Wasm and native HD-2D renderer. */
export async function smokeAsepriteNormals({
  page,
  active,
  fixture,
  stage,
  tool,
  action,
  snapshot,
  native,
  undo,
  redo,
  wait,
  run,
  resources,
  origin,
  setGeneratorAvailable,
  setResume,
}) {
  const idle = () =>
    wait(
      () =>
        document.querySelector("[data-placement-aseprite-tool]").dataset
          .asepriteBusy === "false",
    );
  const status = () => tool.locator("[data-aseprite-status]").textContent();
  const normals = () =>
    page.evaluate(() =>
      structuredClone(
        window.ferrumPlacementViewerAgentHandoff.normalBindings ?? [],
      ),
    );
  const currentDocument = async () =>
    mergeScenePlacementPatch(active, (await snapshot()).state.draftPatch)
      .document;
  const click = async (name) => {
    await action(name).click();
    await idle();
  };
  await page.evaluate(() => {
    window.normalWorkerInputs = [];
    window.normalWorkerOutputs = [];
    window.normalWorkers = new Set();
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        window.normalWorkers.add(this);
        this.addEventListener("message", (event) => {
          if (event.data.ok && event.data.result?.normalPng)
            window.normalWorkerOutputs.push({
              report: structuredClone(event.data.result.report),
              png: Array.from(new Uint8Array(event.data.result.normalPng)),
            });
        });
      }
      postMessage(message, ...args) {
        if (message.buffer)
          window.normalWorkerInputs.push({
            name: message.job.name,
            bytes: Array.from(new Uint8Array(message.buffer)),
          });
        return super.postMessage(message, ...args);
      }
      terminate() {
        window.normalWorkers.delete(this);
        super.terminate();
      }
    };
  });
  const baseline = await snapshot(),
    baselineResources = await resources();
  setGeneratorAvailable(false);
  await click("normals");
  assert.match(await status(), /failed/);
  assert.deepEqual(await snapshot(), baseline);
  assert.deepEqual(await resources(), baselineResources);
  setGeneratorAvailable(true);
  // Read settings from the existing tool without generating an unrelated image.
  const settingsTool = page.locator('[data-placement-normal-tool="true"]');
  await settingsTool.evaluate((element) => {
    element.open = true;
  });
  await settingsTool.getByLabel("Normal Strength", { exact: true }).fill("3");
  await settingsTool
    .getByLabel("Normal Strength", { exact: true })
    .dispatchEvent("change");
  await settingsTool.evaluate((element) => {
    element.open = false;
  });
  await click("normals");
  assert.match(await status(), /^Applied normals/);
  const initial = await snapshot(),
    firstBindings = await normals();
  assert.equal(initial.history.undoCount, baseline.history.undoCount + 1);
  assert.equal(firstBindings.length, 1);
  const firstNormal = firstBindings[0].binding.textures.normal.asset;
  assert.equal(firstBindings[0].binding.generation.settings.normalStrength, 3);
  assert.equal(
    firstBindings[0].binding.textures.color.asset,
    initial.imports[0].assetId,
  );
  assert(
    await action("apply").isDisabled(),
    "Ordinary color replacement must still reject normal bindings",
  );
  assert((await native()).red > 100);
  await undo();
  await idle();
  assert.deepEqual(await normals(), []);
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    baseline.state.draftPatch,
  );
  await redo();
  await idle();
  assert.equal((await normals())[0].binding.textures.normal.asset, firstNormal);
  // A second instance uses another named frame; reimport must replace both in one edit.
  await showPlacementInspector(page, "properties");
  await page.locator('[data-placement-spatial-action="duplicate"]').click();
  await wait(() => window.ferrumPlacementViewerState.instances.length === 2);
  await tool.getByRole("tab", { name: "Preview", exact: true }).click();
  await tool
    .getByLabel("Aseprite frame", { exact: true })
    .selectOption("hero-walk.png");
  await click("normals");
  assert.match(await status(), /^Applied normals/);
  const beforeReimport = await snapshot(),
    beforeDocument = await currentDocument();
  const next = fixture(1);
  await stage(next);
  assert(await action("reimport").isDisabled());
  await click("reimport-normals");
  assert.match(await status(), /^Applied normals · 2 references/);
  const changed = await snapshot(),
    changedBindings = await normals(),
    changedDocument = await currentDocument();
  assert.equal(changed.history.undoCount, beforeReimport.history.undoCount + 1);
  assert.equal(changedBindings.length, 2);
  assert.equal(
    new Set(changedBindings.map((b) => b.binding.textures.normal.asset)).size,
    1,
  );
  assert.notEqual(
    changedBindings[0].binding.textures.normal.asset,
    firstNormal,
  );
  for (const [
    index,
    item,
  ] of changedDocument.sceneComposition.fragments.main.instances.entries()) {
    const before =
      beforeDocument.sceneComposition.fragments.main.instances[index];
    for (const key of ["x", "y", "rotationRadians", "scale"])
      assert.equal(item[key], before[key]);
    for (const key of ["collider", "body", "layer"])
      assert.deepEqual(
        item.props.components[key],
        before.props.components[key],
      );
    for (const key of ["width", "height", "originX", "originY"])
      assert.equal(
        item.props.components.visual[key],
        before.props.components.visual[key],
      );
    assert.equal(
      item.props.components.visual.texture,
      changed.imports[0].assetId,
    );
  }
  assert.deepEqual(
    changedDocument.sceneComposition.fragments.main.instances[0].props
      .components.visual.frame,
    { u0: 0.75, v0: 0.625, u1: 1, v1: 1 },
  );
  assert.deepEqual(
    changedDocument.sceneComposition.fragments.main.instances[1].props
      .components.visual.frame,
    { u0: 0, v0: 0, u1: 0.5, v1: 0.5 },
  );
  const changedPixels = await native();
  assert(changedPixels.blue > 100);
  await undo();
  await idle();
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    beforeReimport.state.draftPatch,
  );
  assert((await native()).red > 100);
  await redo();
  await idle();
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    changed.state.draftPatch,
  );
  assert.deepEqual(await normals(), changedBindings);
  const downloadPromise = page.waitForEvent("download");
  await action("export").click();
  const download = await downloadPromise,
    exportPath = resolve(run, "aseprite-normal-assets.json");
  await download.saveAs(exportPath);
  const bundle = JSON.parse(await readFile(exportPath, "utf8"));
  assert.equal(bundle.normalAssets.length, 1);
  assert.deepEqual(bundle.normalBindings, changedBindings);
  const normalBundle = bundle.normalAssets[0],
    report = normalBundle.report;
  assert.equal(report.pipeline, "aseprite-rects-v1");
  assert.equal(report.frames.length, 2);
  assert.equal(report.source.jsonSha256, changed.imports[0].jsonSha256);
  assert.equal(report.settings.normalStrength, 3);
  assert.equal(
    normalBundle.binding.generation.configSha256,
    report.config.sha256,
  );
  const normalFile = normalBundle.files.find(
    (file) => file.sha256 === normalBundle.binding.textures.normal.sha256,
  );
  const colorFile = normalBundle.files.find(
    (file) => file.sha256 === normalBundle.binding.textures.color.sha256,
  );
  for (const file of normalBundle.files)
    assert.equal(sha256(Buffer.from(file.base64, "base64")), file.sha256);
  assert.equal(sha256(next.png), colorFile.sha256);
  const combined = decodePng(Buffer.from(normalFile.base64, "base64"));
  assert.equal(combined.width, 32);
  assert.equal(combined.height, 32);
  const worker = await page.evaluate(() => ({
    inputs: window.normalWorkerInputs,
    outputs: window.normalWorkerOutputs,
  }));
  const frames = report.frames;
  for (const frame of frames) {
    const crop = worker.outputs.find(
      (value) => JSON.stringify(value.report) === JSON.stringify(frame.report),
    );
    assert(crop, "Provenance must come from a real Worker result");
    const input = worker.inputs.find(
      (value) =>
        sha256(Buffer.from(value.bytes)) ===
        frame.report.results[0].input.sha256,
    );
    assert(input, "Frame provenance must describe actual Worker input bytes");
    const image = decodePng(Buffer.from(crop.png)),
      [x, y, w, h] = frame.rect;
    assert.equal(image.width, w);
    assert.equal(image.height, h);
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++)
        assert.deepEqual(
          combined.pixels.slice(
            ((y + row) * 32 + x + col) * 4,
            ((y + row) * 32 + x + col) * 4 + 4,
          ),
          image.pixels.slice((row * w + col) * 4, (row * w + col) * 4 + 4),
        );
  }
  setResume({ bundle: normalBundle, document: changedDocument });
  const resumed = await page.context().newPage();
  await resumed.goto(origin + "/resume.html");
  await resumed.waitForFunction(() => window.report || window.failure);
  const resume = await resumed.evaluate(() => ({
    report: window.report,
    failure: window.failure,
  }));
  assert.equal(resume.failure, undefined);
  assert(resume.report.lightingDifference > 100);
  await resumed.close();
  const stable = await snapshot(),
    stableResources = await resources(),
    stableBindings = await normals();
  const overlap = fixture(2);
  overlap.json.frames["hero-walk.png"].frame = { x: 22, y: 18, w: 8, h: 12 };
  overlap.json.frames["hero-walk.png"].sourceSize = { w: 8, h: 12 };
  overlap.json.frames["hero-walk.png"].spriteSourceSize = {
    x: 0,
    y: 0,
    w: 8,
    h: 12,
  };
  await stage(overlap);
  await click("reimport-normals");
  assert.match(await status(), /Overlapping/);
  assert.deepEqual(await snapshot(), stable);
  assert.deepEqual(await resources(), stableResources);
  const third = fixture(2);
  await stage(third);
  // A real normal GPU upload followed by failure must roll back both provisional resources.
  await page.evaluate(() => {
    const engine = window.ferrumEngine,
      load = engine.loadAssets.bind(engine);
    engine.loadAssets = async (manifest) => {
      await load(manifest);
      if (
        Object.keys(manifest.textures).some((id) =>
          id.startsWith("aseprite-normal."),
        )
      )
        throw Error("Injected normal upload failure");
    };
    window.restoreNormalUpload = () => {
      engine.loadAssets = load;
    };
  });
  await click("reimport-normals");
  assert.match(await status(), /Injected normal upload failure/);
  assert.deepEqual(await snapshot(), stable);
  assert.deepEqual(await normals(), stableBindings);
  assert.deepEqual(await resources(), stableResources);
  await page.evaluate(() => window.restoreNormalUpload());
  const imageBeforeNativeFailure = (await native()).image;
  await page.evaluate(() => {
    const engine = window.ferrumEngine,
      original = engine.configureDataSceneSpatial.bind(engine);
    let fail = true;
    engine.configureDataSceneSpatial = (...args) => {
      const result = original(...args);
      if (fail) {
        fail = false;
        throw Error("Injected normals native preview failure");
      }
      return result;
    };
    window.restoreNormalPreview = () => {
      engine.configureDataSceneSpatial = original;
    };
  });
  await click("reimport-normals");
  assert.match(await status(), /Injected normals native preview failure/);
  assert.deepEqual(await snapshot(), stable);
  assert.deepEqual(await normals(), stableBindings);
  assert.deepEqual(await resources(), stableResources);
  assert.equal((await native()).image, imageBeforeNativeFailure);
  await page.evaluate(() => window.restoreNormalPreview());
  // Pause after actual normal upload; change locks before final patch validation.
  async function pauseUpload() {
    await page.evaluate(() => {
      const engine = window.ferrumEngine,
        load = engine.loadAssets.bind(engine);
      engine.loadAssets = async (manifest) => {
        await load(manifest);
        if (
          Object.keys(manifest.textures).some((id) =>
            id.startsWith("aseprite-normal."),
          )
        ) {
          window.normalUploadPaused = true;
          await new Promise((resolve) => {
            window.resumeNormalUpload = resolve;
          });
        }
      };
      window.restoreNormalUpload = () => {
        engine.loadAssets = load;
        window.normalUploadPaused = false;
      };
    });
  }
  await pauseUpload();
  await action("reimport-normals").click();
  await wait(() => window.normalUploadPaused);
  await page.locator('button[data-placement-lock-instance="sprite"]').click();
  await page.evaluate(() => window.resumeNormalUpload());
  await idle();
  assert.match(await status(), /Unlock affected/);
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    stable.state.draftPatch,
  );
  await page.locator('button[data-placement-lock-instance="sprite"]').click();
  assert.deepEqual(await resources(), stableResources);
  await page.evaluate(() => window.restoreNormalUpload());
  await pauseUpload();
  await action("reimport-normals").click();
  await wait(() => window.normalUploadPaused);
  await page.evaluate(() =>
    window.ferrumPlacementViewerUpdateTransform("sprite", { x: 5 }),
  );
  const externallyChanged = await snapshot();
  await page.evaluate(() => window.resumeNormalUpload());
  await idle();
  assert.match(await status(), /Document or selection changed/);
  assert.deepEqual(await snapshot(), externallyChanged);
  assert.deepEqual(await resources(), stableResources);
  await page.evaluate(() => window.restoreNormalUpload());
  await pauseUpload();
  await action("reimport-normals").click();
  await wait(() => window.normalUploadPaused);
  await action("cancel").click();
  await page.evaluate(() => {
    window.restoreNormalUpload();
    window.resumeNormalUpload();
  });
  await action("reimport-normals").click();
  await idle();
  assert.match(await status(), /^Applied normals/);
  assert((await native()).magenta > 100);
  const finalDocument = await currentDocument();
  assert(
    await page.evaluate(
      async () => !(await window.ferrumPlacementViewerSaveDraft())?.saved,
    ),
    "Scene-only Save must reject unsaved generated files",
  );
  assert.match(
    await page.evaluate(() => window.ferrumPlacementViewerLastSaveError),
    /generated assets and imported atlases/,
  );
  assert(await action("save-normals").isDisabled());
  // Optional existing host contract: bad bytes must not clear the save guard; verified bytes must.
  await page.route("**/__normal-saved/*", async (route) => {
    const files = await page.evaluate(() => window.normalSavedFiles);
    const name = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").pop(),
    );
    const file = files.find((value) => value.path === name);
    const corrupt = await page.evaluate(() => window.corruptNormalSaved);
    const color = files.find(
      (value) => !value.path.startsWith("aseprite-normal."),
    );
    await route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        corrupt && name.startsWith("aseprite-normal.")
          ? color.base64
          : file.base64,
        "base64",
      ),
    });
  });
  await page.evaluate(() => {
    window.corruptNormalSaved = true;
    window.ferrumPlacementNormalAssetHost = {
      saveAssets: async (bundle) => {
        window.normalSavedFiles = structuredClone(bundle.files);
        return {
          registered: true,
          textures: Object.fromEntries(
            Object.entries(bundle.manifest.textures).map(([id, path]) => [
              id,
              "/__normal-saved/" + path,
            ]),
          ),
        };
      },
    };
    window.ferrumPlacementViewerSelect("sprite");
  });
  await wait(
    () =>
      !document.querySelector('[data-aseprite-action="save-normals"]').disabled,
  );
  await click("save-normals");
  assert.match(await status(), /Saved normal asset differs/);
  assert(!(await action("save-normals").isDisabled()));
  await page.evaluate(() => {
    window.corruptNormalSaved = false;
  });
  await click("save-normals");
  assert.match(await status(), /saved and verified/);
  assert(await action("save-normals").isDisabled());
  await page.screenshot({
    path: resolve(run, "aseprite-normals-hd2d.png"),
    fullPage: true,
  });
  assert.equal(await page.evaluate(() => window.normalWorkers.size), 0);
  await writeFile(
    resolve(run, "normal.scene.json"),
    JSON.stringify(finalDocument, null, 2) + "\n",
  );
  return {
    realWorker: true,
    isolatedFrameComposite: true,
    reusedSettings: true,
    multiFrameSingleUndo: true,
    frameUvAndComponentsPreserved: true,
    reimportUndoRedo: true,
    realNativePixels: true,
    exportFreshRuntime: resume.report,
    unavailableAndOverlapPreserveScene: true,
    partialUploadRollback: true,
    nativePreviewRollback: true,
    concurrentDocumentEditPreserved: true,
    locksRevalidated: true,
    cancelRetry: true,
    optionalSaveHostVerified: true,
    workersReleased: true,
  };
}
