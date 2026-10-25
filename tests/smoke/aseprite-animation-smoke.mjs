import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mergeScenePlacementPatch } from "../../packages/ferrum-web/dist/authoring.js";
import { showPlacementBottom } from "./placement-panel-navigation.mjs";

export async function smokeAsepriteAnimation({
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
  origin,
  setResume,
}) {
  const idle = () =>
    wait(
      () =>
        document.querySelector("[data-placement-aseprite-tool]").dataset
          .asepriteBusy === "false",
    );
  const click = async (name) => {
    await action(name).click();
    await idle();
  };
  const document = async () =>
    mergeScenePlacementPatch(active, (await snapshot()).state.draftPatch)
      .document;
  const component = (doc) =>
    doc.sceneComposition.fragments.main.instances[0].props.components;
  const animationFixture = (version = 0) => {
    const data = fixture(version);
    data.json.frames["hero-idle.png"].duration = version ? 90 : 100;
    data.json.frames["hero-walk.png"].duration = version ? 180 : 200;
    const run = { name: "run", from: 0, to: 1, direction: "forward" },
      rest = { name: "rest", from: 0, to: 0, direction: "forward" };
    data.json.meta.frameTags = version ? [rest, run] : [run, rest];
    return data;
  };
  const original = await snapshot(),
    before = await document();
  await stage(animationFixture());
  await tool.getByLabel("Aseprite loop new clips", { exact: true }).uncheck();
  await tool
    .getByLabel("Aseprite initial animation", { exact: true })
    .selectOption("run");
  await click("animation");
  assert.match(
    await tool.locator("[data-aseprite-status]").textContent(),
    /^Applied/,
  );
  const first = await snapshot(),
    firstDoc = await document(),
    firstSet = component(firstDoc).visual.animationSet;
  assert.equal(first.history.undoCount, original.history.undoCount + 1);
  assert.equal(firstSet.initialClip, 0);
  assert.equal(firstSet.clips[0].frames.length, 3);
  assert.equal(firstSet.clips[0].loop, false);
  assert.deepEqual(
    first.imports[0].animations[0].tags.map((t) => t.name),
    ["run", "rest"],
  );
  assert(await action("apply").isDisabled());
  await undo();
  await idle();
  assert.deepEqual(
    (await snapshot()).state.draftPatch,
    original.state.draftPatch,
  );
  assert(!(await snapshot()).imports.some((a) => a.animations.length));
  await redo();
  await idle();
  assert.deepEqual(component(await document()).visual.animationSet, firstSet);
  const invalid = animationFixture(1);
  invalid.json.frames["hero-walk.png"].duration = 1001;
  await stage(invalid);
  assert(await action("reimport-animation").isDisabled());
  assert.match(
    await action("reimport-animation").getAttribute("title"),
    /max 32/,
  );
  assert.deepEqual(component(await document()).visual.animationSet, firstSet);
  const removed = animationFixture(1);
  removed.json.meta.frameTags = removed.json.meta.frameTags.filter(
    (tag) => tag.name !== "run",
  );
  await stage(removed);
  assert(await action("reimport-animation").isDisabled());
  assert.match(
    await action("reimport-animation").getAttribute("title"),
    /missing tag run/,
  );
  await stage(animationFixture(1));
  // Actual partial GPU upload rejection must preserve the accepted scene/history.
  await page.evaluate(() => {
    const engine = window.ferrumEngine,
      load = engine.loadAssets.bind(engine);
    engine.loadAssets = async (manifest) => {
      engine.loadAssets = load;
      await load(manifest);
      throw Error("animation upload failure");
    };
  });
  const baseline = await snapshot();
  await click("reimport-animation");
  assert.match(
    await tool.locator("[data-aseprite-status]").textContent(),
    /animation upload failure/,
  );
  assert.deepEqual(await snapshot(), baseline);
  // Hold upload, cancel, then retry before the old promise settles.
  await page.evaluate(() => {
    const engine = window.ferrumEngine,
      load = engine.loadAssets.bind(engine);
    engine.loadAssets = async (manifest) => {
      engine.loadAssets = load;
      await new Promise((done) => {
        window.releaseAnimationUpload = done;
      });
      await load(manifest);
    };
  });
  await action("reimport-animation").click();
  await wait(() => !!window.releaseAnimationUpload);
  await click("cancel");
  await action("reimport-animation").click();
  await page.evaluate(() => window.releaseAnimationUpload());
  await idle();
  assert.match(
    await tool.locator("[data-aseprite-status]").textContent(),
    /^Applied/,
  );
  const changed = await snapshot(),
    changedDoc = await document(),
    nextSet = component(changedDoc).visual.animationSet;
  assert.equal(changed.history.undoCount, first.history.undoCount + 1);
  assert.deepEqual(
    nextSet.clips.map((clip) => [clip.id, clip.loop]),
    [
      [1, false],
      [0, false],
    ],
  );
  assert.equal(nextSet.initialClip, 0);
  for (const key of ["body", "collider", "layer"])
    assert.deepEqual(component(changedDoc)[key], component(before)[key]);
  for (const key of ["x", "y", "rotationRadians", "scale"])
    assert.equal(
      changedDoc.sceneComposition.fragments.main.instances[0][key],
      before.sceneComposition.fragments.main.instances[0][key],
    );
  await undo();
  await idle();
  assert.deepEqual(component(await document()).visual.animationSet, firstSet);
  await redo();
  await idle();
  assert.deepEqual(component(await document()).visual.animationSet, nextSet);
  const download = page.waitForEvent("download");
  await action("export").click();
  const bundle = JSON.parse(
    await readFile(await (await download).path(), "utf8"),
  );
  assert.equal(bundle.animations.length, 1);
  assert.deepEqual(
    bundle.animations[0].tags.map((t) => [t.name, t.id]),
    [
      ["rest", 1],
      ["run", 0],
    ],
  );
  setResume({
    bundle,
    document: changedDoc,
    instance: "sprite",
    animation: true,
  });
  const fresh = await page.context().newPage();
  await fresh.goto(origin + "/resume.html");
  await fresh.waitForFunction(() => window.report || window.failure);
  const result = await fresh.evaluate(() => ({
    report: window.report,
    failure: window.failure,
  }));
  await fresh.close();
  assert(!result.failure, result.failure);
  assert(result.report.animation.finished);
  assert(result.report.animation.visitedFrames >= 2);
  assert(result.report.animation.visibleFrames >= 2);
  await writeFile(
    resolve(
      run,
      active.spatial
        ? "hd2d-animation-export.json"
        : "2d-animation-export.json",
    ),
    JSON.stringify(bundle, null, 2) + "\n",
  );
  await showPlacementBottom(page, "assets");
  await page.locator('[data-placement-dock-resize="runtime"]').focus();
  await page.keyboard.press("End");
  await tool
    .getByLabel("Aseprite initial animation", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(
      run,
      active.spatial ? "hd2d-animation.png" : "2d-animation.png",
    ),
  });
  return {
    explicitAnimationImport: true,
    exactTiming: true,
    clipIdsPreserved: true,
    undoRedo: true,
    missingTagRejected: true,
    budgetRejected: true,
    uploadRollback: true,
    cancelRetry: true,
    freshSession: result.report,
  };
}
