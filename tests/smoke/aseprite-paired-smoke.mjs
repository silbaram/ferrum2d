import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";
import { sha256 } from "../../scripts/tools/sprite-normals-tool.mjs";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";

export async function smokeAsepritePaired({
  page,
  active,
  fixture,
  stage,
  tool,
  action,
  snapshot,
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
      ),
    click = async (name) => {
      await action(name).click();
      await idle();
    },
    status = () => tool.locator("[data-aseprite-status]").textContent(),
    bindings = () =>
      page.evaluate(() =>
        structuredClone(
          window.ferrumPlacementViewerAgentHandoff.normalBindings ?? [],
        ),
      ),
    current = async () =>
      mergeScenePlacementPatch(active, (await snapshot()).state.draftPatch)
        .document,
    visual = (doc) =>
      doc.sceneComposition.fragments.main.instances[0].props.components.visual;
  const source = (version) => {
    const data = fixture(version);
    data.json.frames["hero-idle.png"].duration = version ? 90 : 100;
    data.json.frames["hero-walk.png"].duration = version ? 180 : 200;
    const run = { name: "run", from: 0, to: 1 },
      rest = { name: "rest", from: 0, to: 0 };
    data.json.meta.frameTags = version ? [rest, run] : [run, rest];
    return data;
  };
  await page.evaluate(() => {
    window.pairedWorkerOutputs = [];
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.ok && data.result?.normalPng)
            window.pairedWorkerOutputs.push({
              report: structuredClone(data.result.report),
              png: Array.from(new Uint8Array(data.result.normalPng)),
            });
        });
      }
    };
  });
  await stage(source(0));
  await tool.getByLabel("Aseprite loop new clips", { exact: true }).uncheck();
  await tool
    .getByLabel("Aseprite initial animation", { exact: true })
    .selectOption("run");
  const baseline = await snapshot(),
    baseResources = await resources();
  setGeneratorAvailable(false);
  await click("paired");
  assert.match(await status(), /failed/);
  assert.deepEqual(await snapshot(), baseline);
  assert.deepEqual(await resources(), baseResources);
  setGeneratorAvailable(true);
  await click("paired");
  assert.match(await status(), /^Applied normals/);
  const first = await snapshot(),
    firstDoc = await current(),
    firstBinding = (await bindings())[0];
  assert.equal(first.history.undoCount, baseline.history.undoCount + 1);
  assert.deepEqual(
    firstBinding.binding.animationSet,
    visual(firstDoc).animationSet,
  );
  assert.equal(firstBinding.binding.frames.length, 2);
  assert.equal(firstBinding.binding.animationSet.clips[0].frames.length, 3);
  assert(await action("animation").isDisabled());
  assert(await action("normals").isDisabled());
  await undo();
  await idle();
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    baseline.state.draftPatch,
  );
  assert.deepEqual(await bindings(), []);
  await redo();
  await idle();
  assert.deepEqual((await bindings())[0], firstBinding);
  // Starting again from a static draft reuses generated assets with the requested loop policy.
  await undo();
  await idle();
  await tool.getByLabel("Aseprite loop new clips", { exact: true }).check();
  await click("paired");
  assert((await bindings())[0].binding.animationSet.clips.every((c) => c.loop));
  await undo();
  await idle();
  await tool.getByLabel("Aseprite loop new clips", { exact: true }).uncheck();
  await click("paired");
  assert.deepEqual((await bindings())[0], firstBinding);
  const stable = await snapshot(),
    stableResources = await resources();
  const invalid = source(1);
  invalid.json.meta.frameTags = [{ name: "rest", from: 0, to: 0 }];
  await stage(invalid);
  assert(await action("reimport-paired").isDisabled());
  assert.match(
    await action("reimport-paired").getAttribute("title"),
    /missing tag run/,
  );
  await stage(source(1));
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
        throw Error("paired upload failure");
    };
    window.restorePairedUpload = () => {
      engine.loadAssets = load;
    };
  });
  await click("reimport-paired");
  assert.match(await status(), /paired upload failure/);
  assert.deepEqual(await snapshot(), stable);
  assert.deepEqual(await resources(), stableResources);
  assert.deepEqual((await bindings())[0], firstBinding);
  await page.evaluate(() => window.restorePairedUpload());
  // Hold actual normal upload; final lock validation must reject the whole edit.
  const hold = async () =>
    page.evaluate(() => {
      const engine = window.ferrumEngine,
        load = engine.loadAssets.bind(engine);
      engine.loadAssets = async (manifest) => {
        await load(manifest);
        if (
          Object.keys(manifest.textures).some((id) =>
            id.startsWith("aseprite-normal."),
          )
        )
          await new Promise((resolve) => {
            window.releasePairedUpload = resolve;
          });
      };
      window.restorePairedUpload = () => {
        engine.loadAssets = load;
        delete window.releasePairedUpload;
      };
    });
  await hold();
  await action("reimport-paired").click();
  await wait(() => !!window.releasePairedUpload);
  await page.locator('button[data-placement-lock-instance="sprite"]').click();
  await page.evaluate(() => window.releasePairedUpload());
  await idle();
  assert.match(await status(), /unlock/);
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    stable.state.draftPatch,
  );
  await page.locator('button[data-placement-lock-instance="sprite"]').click();
  assert.deepEqual(await resources(), stableResources);
  await page.evaluate(() => window.restorePairedUpload());
  // Cancel + immediate retry serializes resource ownership across the old upload.
  await hold();
  await action("reimport-paired").click();
  await wait(() => !!window.releasePairedUpload);
  await click("cancel");
  await page.evaluate(() => {
    const release = window.releasePairedUpload;
    window.restorePairedUpload();
    release();
  });
  await click("reimport-paired");
  assert.match(await status(), /^Applied normals/);
  const changed = await snapshot(),
    changedDoc = await current(),
    changedBindings = await bindings(),
    set = visual(changedDoc).animationSet;
  assert.equal(changed.history.undoCount, stable.history.undoCount + 1);
  assert.deepEqual(
    set.clips.map((c) => [c.id, c.loop]),
    [
      [1, false],
      [0, false],
    ],
  );
  assert.equal(set.initialClip, 0);
  assert.notEqual(
    changedBindings[0].binding.textures.normal.asset,
    firstBinding.binding.textures.normal.asset,
  );
  assert.deepEqual(changedBindings[0].binding.animationSet, set);
  for (const key of ["body", "collider", "layer"])
    assert.deepEqual(
      changedDoc.sceneComposition.fragments.main.instances[0].props.components[
        key
      ],
      firstDoc.sceneComposition.fragments.main.instances[0].props.components[
        key
      ],
    );
  assert.deepEqual(changedDoc.spatial.billboards.sprite, {
    ...firstDoc.spatial.billboards.sprite,
    normalTexture: changedBindings[0].binding.textures.normal.asset,
  });
  await undo();
  await idle();
  assert.deepEqual((await bindings())[0], firstBinding);
  await redo();
  await idle();
  assert.deepEqual(await bindings(), changedBindings);
  const downloading = page.waitForEvent("download");
  await action("export").click();
  const bundle = JSON.parse(
      await readFile(await (await downloading).path(), "utf8"),
    ),
    normal = bundle.normalAssets[0];
  assert.equal(bundle.normalAssets.length, 1);
  assert.deepEqual(bundle.normalBindings, changedBindings);
  assert.deepEqual(
    bundle.animations[0].tags.map((t) => [t.name, t.id]),
    [
      ["rest", 1],
      ["run", 0],
    ],
  );
  for (const file of normal.files)
    assert.equal(sha256(Buffer.from(file.base64, "base64")), file.sha256);
  const pixels = decodePng(
      Buffer.from(
        normal.files.find(
          (f) => f.sha256 === normal.binding.textures.normal.sha256,
        ).base64,
        "base64",
      ),
    ),
    outputs = await page.evaluate(() => window.pairedWorkerOutputs);
  for (const {
    rect: [x, y, w, h],
    report,
  } of normal.report.frames) {
    const output = outputs.find(
      (o) => JSON.stringify(o.report) === JSON.stringify(report),
    );
    assert(output, "Normal report must come from actual Worker output");
    const crop = decodePng(Buffer.from(output.png));
    for (let row = 0; row < h; row++)
      assert.deepEqual(
        pixels.pixels.slice(
          ((y + row) * pixels.width + x) * 4,
          ((y + row) * pixels.width + x + w) * 4,
        ),
        crop.pixels.slice(row * w * 4, (row + 1) * w * 4),
      );
  }
  setResume({ bundle: normal, document: changedDoc, animation: true });
  const fresh = await page.context().newPage();
  await fresh.goto(origin + "/resume.html");
  await fresh.waitForFunction(() => window.report || window.failure);
  const resumed = await fresh.evaluate(() => ({
    report: window.report,
    failure: window.failure,
  }));
  await fresh.close();
  assert(!resumed.failure, resumed.failure);
  assert.equal(resumed.report.animation.uvMatches, 2);
  assert(resumed.report.lightingDifference > 100);
  await writeFile(
    join(run, "paired-export.json"),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  await page.locator('[data-placement-dock-resize="runtime"]').focus();
  await page.keyboard.press("End");
  await action("paired").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(run, "paired-authoring.png") });
  return {
    pairedImport: true,
    clipIdsAndLoopPreserved: true,
    singleUndo: true,
    missingTagRejected: true,
    uploadRollback: true,
    lockRevalidated: true,
    cancelRetry: true,
    workerPixelsMatch: true,
    freshSession: resumed.report,
  };
}
