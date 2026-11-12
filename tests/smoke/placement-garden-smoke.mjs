import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { showPlacementMenu } from "./placement-panel-navigation.mjs";

/** Featured flat example: real native movement, animation, collision, pickups and renderer cost. */
export async function smokePlacementGarden(parent, timeoutMs = 30000) {
  const output = "artifacts/2d-showcase";
  await mkdir(output, { recursive: true });
  const assets = "apps/studio/public/assets/lantern-garden/";
  const manifest = JSON.parse(await readFile(assets + "manifest.json", "utf8"));
  const png = await readFile(assets + "atlas.png");
  assert.equal(createHash("sha256").update(png).digest("hex"), manifest.texture.sha256);
  assert.equal(png.readUInt32BE(16), 512); assert.equal(png.readUInt32BE(20), 512);
  assert.equal(Object.keys(manifest.frames).length, 43);
  const source = JSON.parse(await readFile("apps/studio/public/placement.garden.scene-authoring.json", "utf8"));
  const nav = source.navigation;
  assert.equal(nav.costs.length, 432); assert.equal(nav.obstacles.length, 28);
  assert.equal(nav.costs[8 * 24 + 18], 0, "Canal must be blocked");
  assert(nav.costs[10 * 24 + 18] > 0, "Bridge must permit crossing");
  const hero = source.sceneComposition.prefabs["garden-hero"].props.components;
  assert.equal(hero.collider.isTrigger, false); assert.equal(hero.visual.animationSet.clips.length, 8);
  assert(hero.visual.frame.u1 - hero.visual.frame.u0 < 0.1, "Sprite must use an atlas crop");
  for(const id of ["garden_cottage","garden_workshop","garden_east_cottage","garden_storage"]){
    const visual=source.sceneComposition.fragments.garden.instances.find(i=>i.id===id).props.components.visual;
    assert.equal(visual.shadow.shape,"volume","Buildings must cast an anchored volume");
    assert.equal(visual.shadow.width,86);assert.equal(visual.shadow.depth,30);assert.equal(visual.shadow.height,52);assert.equal(visual.shadow.roofHeight,44);
    assert.equal((visual.frame.v1-visual.frame.v0)*manifest.texture.height,125,"Building foot must exclude transparent bottom padding");
  }

  const page = await parent.context().browser().newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const wait = (fn, arg) => page.waitForFunction(fn, arg, { timeout: timeoutMs });
  const paint = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  const authored = () => page.evaluate(() => window.ferrumPlacementSpatialExportDocument());
  const state = () => page.evaluate(() => {
    const engine = window.ferrumEngine;
    const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "garden_hero");
    return { body: engine.getPhysicsEntity(actor.entity), animation: engine.dataSceneSpriteAnimationState(actor.entity),
      move: engine.dataSceneMoveStatus(), game: engine.dataSceneState(), entities: window.ferrumPlacementViewerRuntimeFrame.entityCount };
  });
  const clickWorld = async target => {
    const point = await page.evaluate(target => {
      const canvas = document.querySelector("canvas.demo-canvas"), rect = canvas.getBoundingClientRect();
      const zoom = window.ferrumPlacementEditCamera.zoom;
      return { x: rect.left + canvas.clientWidth / 2 + (target.x - window.ferrumEngine.cameraX()) * zoom,
        y: rect.top + canvas.clientHeight / 2 + (target.y - window.ferrumEngine.cameraY()) * zoom };
    }, target);
    await page.mouse.click(point.x, point.y);
  };
  try {
    await page.goto(new URL("/", parent.url()).href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 6);
    await page.locator("[data-placement-language]").selectOption("en");
    const firstKey = await page.evaluate(() => {
      window.ferrumPlacementViewerUpdateTransform("crate_left", { x: 752 });
      return window.ferrumPlacementWorkspaceActiveDocument;
    });
    await showPlacementMenu(page, "file"); await showPlacementMenu(page, "examples");
    await page.locator('[data-placement-example="garden"]').click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465 && !document.querySelector(".demo-shell").inert);
    assert.equal(await page.evaluate(() => window.ferrumPlacementWorkspaceMode), "2d");
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.lockedInstanceIds.length), 432);
    assert.equal((await state()).game, "paused", "Authoring must not advance gameplay");
    const gardenKey = await page.evaluate(() => window.ferrumPlacementWorkspaceActiveDocument);
    const baseline = await authored();
    await page.locator(`[data-placement-document-key=${JSON.stringify(firstKey)}]`).click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.entityCount === 6);
    assert.equal(await page.evaluate(() => window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "crate_left").transform.x), 752);
    await page.locator(`[data-placement-document-key=${JSON.stringify(gardenKey)}]`).click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.entityCount === 465);
    await paint(); assert.deepEqual(await authored(), baseline);
    const projectionCommands=await page.evaluate(()=>new Promise(resolve=>{
      const renderer=window.ferrumRuntime.renderer,draw=renderer.renderCommands;
      renderer.renderCommands=function(commands){
        this.renderCommands=draw;
        const flags={ground:0,upright:0,casters:0,volumes:commands.groundShadowVolumes?.casterCount??0};
        for(let i=0;i<commands.commandCount;i++){
          const value=commands.buffer[i*commands.floatsPerCommand+13];
          if((value&4)!==0&&(value&56)!==0)flags.casters++;
          else if((value&4)!==0)flags.ground++;else flags.upright++;
        }
        const result=draw.call(this,commands);resolve(flags);return result;
      };
    }));
    assert.deepEqual(projectionCommands,{ground:433,upright:32,casters:28,volumes:4},"Floor/bridge commands must remain ground receivers, with separate native building volumes");
    const stats = await page.evaluate(() => window.ferrumRuntime.renderer.stats());
    assert(stats.spriteCount >= 465); assert(stats.drawCalls > 0 && stats.drawCalls <= 64);
    assert(stats.textureSwitchCount <= 4); assert.equal(stats.pointLightCount, 4); assert(stats.shadowDrawCalls > 0);
    await page.screenshot({ path: `${output}/editor.png`, fullPage: true });
    await page.locator("[data-placement-playback=play]").click();
    await wait(() => window.ferrumEngine.dataSceneState() === "playing");
    await page.screenshot({ path: `${output}/game.png`, fullPage: true });
    await clickWorld({ x: 688, y: 546 });
    const walkingHandle = await wait(() => {
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "garden_hero");
      const engine = window.ferrumEngine, body = engine.getPhysicsEntity(actor.entity), animation = engine.dataSceneSpriteAnimationState(actor.entity);
      return animation?.clip === 6 && body.x < 799 && body.x > 688 ? { body, animation } : false;
    });
    const walking = await walkingHandle.jsonValue();
    await page.locator("[data-placement-playback=pause]").click();
    await wait(() => window.ferrumEngine.dataSceneState() === "paused");
    const paused = await state(); await paint(); await paint();
    const still = await state(); assert.deepEqual(still.body, paused.body); assert.deepEqual(still.animation, paused.animation);
    await page.locator("[data-placement-playback=pause]").click();
    await wait(() => window.ferrumEngine.dataSceneMoveStatus() === "arrived");
    const left = await state(); assert(Math.abs(left.body.x - 688) < 1); assert(left.animation.clip >= 0 && left.animation.clip < 4);
    await clickWorld({ x: 752, y: 546 });
    await wait(() => window.ferrumEngine.dataSceneMoveStatus() === "arrived");
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.entityCount === 464);
    for (const [target, count] of [[{ x: 976, y: 482 }, 463], [{ x: 1104, y: 546 }, 462]]) {
      await clickWorld(target);
      await wait(() => window.ferrumEngine.dataSceneMoveStatus() === "arrived");
      await wait(count => window.ferrumPlacementViewerRuntimeFrame.entityCount === count, count);
      const arrived = await state(); assert(Math.hypot(arrived.body.x - target.x, arrived.body.y - target.y) < 1);
    }
    await clickWorld({ x: 560, y: 386 });
    assert.match(await page.locator("[data-placement-garden-hint]").textContent(), /walkable/);
    await page.locator("[data-placement-playback=stop]").click();
    await wait(() => window.ferrumPlacementViewerRuntimeFrame.entityCount === 465 && window.ferrumPlacementWorkspaceMode === "2d");
    const stopped = await state(); assert.equal(stopped.body.x, 800); assert.equal(stopped.body.y, 546);
    assert.deepEqual(await authored(), baseline); assert.equal(await page.evaluate(() => window.ferrumPlacementViewerHistory.undoCount), 0);
    // Cold native collision probe: place the actor below a house and ask the engine to cross its solid base.
    const collision = await page.evaluate(() => {
      const engine = window.ferrumEngine;
      const actor = window.ferrumPlacementViewerState.instances.find(i => i.instanceId === "garden_hero");
      if (!engine.setPhysicsBodyPosition(actor.entity, 560, 420)) throw new Error("Collision setup rejected");
      const result = engine.moveHd2dKinematicBodyWithTilemap(actor.entity, { displacementX: 0, displacementY: -80, solidMaskBits: 8, maxStepHeight: 0, maxDropHeight: 0 });
      return { result, body: engine.getPhysicsEntity(actor.entity) };
    });
    assert(collision.result.blockedY && collision.result.hitCount > 0); assert(collision.body.y >= 406);
    // Undo remains a document operation after native gameplay.
    await page.evaluate(() => { window.ferrumPlacementViewerSelect("garden_flowers_0"); window.ferrumPlacementViewerUpdateTransform("garden_flowers_0", { x: 624 }); });
    await page.locator('[data-placement-action="undo"]').click(); await paint();
    assert.deepEqual(await authored(), baseline);
    for (const locale of ["ko", "en"]) {
      await page.locator("[data-placement-language]").selectOption(locale);
      await showPlacementMenu(page, "file"); await showPlacementMenu(page, "examples");
      assert.match(await page.locator('[data-placement-example="garden"]').getAttribute("aria-label"), locale === "ko" ? /등불/ : /Lantern/);
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 390, height: 600 }); await paint();
    const canvas = await page.locator("canvas.demo-canvas").boundingBox();
    assert(canvas.width > 100 && canvas.x >= 0 && canvas.x + canvas.width <= 391);
    await page.screenshot({ path: `${output}/compact.png`, fullPage: true });
    await page.goto(new URL("/?scene=garden", parent.url()).href, { waitUntil: "networkidle" });
    await wait(() => window.ferrumPlacementViewerRuntimeFrame?.entityCount === 465);
    assert.equal((await state()).game, "paused"); assert.deepEqual(errors, []);
    const result = { ok: true, entities: 465, tiles: 432, atlasFrames: 43, projectionCommands, stats, walking, left, stopped, collision,
      checks: ["asset SHA and crops", "navigation canal and bridge", "in-app examples and draft isolation", "465 live entities and bounded renderer cost", "paused authoring", "click movement and native animation", "pause resume", "three native pickups and canal crossing", "blocked destination", "solid collision", "Stop restores authored scene", "Undo", "both locales", "compact viewport", "direct route"], errors };
    await writeFile(`${output}/report.json`, JSON.stringify(result, null, 2) + "\n");
    return result;
  } catch (error) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }); throw error; }
  finally { await page.close(); }
}
