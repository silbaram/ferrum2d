import assert from "node:assert/strict";

export const spatialFeatureIds = new Set(["hd2d-movement", "ai-combat", "attachments", "hd2d-environment"]);
export async function checkSpatialFeature(page, id) {
  if (!spatialFeatureIds.has(id) || id === "hd2d-environment") return;
  const control = name => page.locator(`[data-control="${name}"]`);
  const snapshot = () => page.evaluate(() => window.ferrumFeatureLab.snapshot());
  const frozen = async () => {
    await control("pause").click();
    const before = await snapshot();
    await page.waitForTimeout(250);
    assert.deepEqual((await snapshot()).poses, before.poses, `${id} moved while paused`);
    assert.equal((await snapshot()).health, before.health);
    await control("pause").click();
  };
  if (id === "hd2d-movement") {
    await control("go").click();
    await page.waitForFunction(() => { const p = window.ferrumFeatureLab.snapshot().poses.actor; return p.y > 60 && p.heightSpan.floorId === 1 && p.heightSpan.elevation === 48; });
    await frozen();
    await control("back").click();
    await page.waitForFunction(() => { const p = window.ferrumFeatureLab.snapshot().poses.actor; return p.y < -60 && p.heightSpan.floorId === 0; });
    await control("mode").selectOption("lift");
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().poses.actor.heightSpan.elevation > 12);
    assert((await snapshot()).platforms.carriedBodies > 0);
    await frozen();
    await control("mode").selectOption("bridge");
    assert(await control("go").isDisabled());
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().poses.actor.x > 28);
    await frozen();
    await control("reset").click();
    assert((await snapshot()).poses.actor.x < 10);
  } else if (id === "ai-combat") {
    await page.evaluate(() => {
      window.featureAiTrace = [];
      window.featureAiTimer = setInterval(() => {
        const p = window.ferrumFeatureLab.snapshot().poses.enemy;
        window.featureAiTrace.push([p.x, p.y]);
      }, 40);
    });
    let trace;
    try {
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().poses.enemy.x > 40, undefined, { timeout: 15000 });
      trace = await page.evaluate(() => window.featureAiTrace);
    } finally { await page.evaluate(() => clearInterval(window.featureAiTimer)); }
    assert(trace.some(([, y]) => Math.abs(y) >= 33.99), `enemy did not detour around obstacle: max |y|=${Math.max(...trace.map(([, y]) => Math.abs(y)))}`);
    assert(!trace.some(([x, y]) => Math.abs(x) < 15 && Math.abs(y) < 33), "enemy passed through wall");
    assert.equal((await snapshot()).health, 1000);
    assert.equal((await snapshot()).combat.spawned, 0);
    await control("mode").selectOption("melee");
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().health < 1000, undefined, { timeout: 15000 });
    assert.equal((await snapshot()).combat.spawned, 0, "melee spawned projectiles");
    await frozen();
    await control("mode").selectOption("ranged");
    await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot(); return s.combat.spawned > 0 && s.health < 1000; }, undefined, { timeout: 15000 });
    await frozen();
    await control("reset").click();
    assert.equal((await snapshot()).health, 1000);
  } else {
    assert.equal((await snapshot()).models, 2);
    await control("position").fill("40"); await control("position").dispatchEvent("input");
    await page.waitForFunction(() => Math.abs(window.ferrumFeatureLab.snapshot().poses.lamp.x - 70) < 0.01);
    await control("rotation").fill("90"); await control("rotation").dispatchEvent("input");
    await page.waitForFunction(() => { const p = window.ferrumFeatureLab.snapshot().poses.lamp; return Math.abs(p.x - 40) < 0.01 && Math.abs(Math.abs(p.y) - 30) < 0.01; });
    assert.equal((await snapshot()).poses.box.heightSpan.elevation, 24);
    const linkedExport = await control("download").evaluate(async link => (await fetch(link.href)).json());
    const parent = linkedExport.sceneComposition.fragments.lab.instances.find(i => i.id === "cart");
    assert.equal(parent.x, 40);
    assert(Math.abs(parent.rotationRadians - Math.PI / 2) < 1e-6);
    await control("attached").uncheck();
    const detached = (await snapshot()).poses;
    await control("position").fill("-40"); await control("position").dispatchEvent("input");
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().poses.cart.x === -40);
    assert.deepEqual((await snapshot()).poses.lamp, detached.lamp, "detached child followed parent");
    const detachedExport = await control("download").evaluate(async link => (await fetch(link.href)).json());
    assert.deepEqual(detachedExport.spatial.attachments, {});
    for (const instance of detachedExport.sceneComposition.fragments.lab.instances) {
      const pose = (await snapshot()).poses[instance.id];
      assert.equal(instance.x, pose.x, `exported ${instance.id} x differs`);
      assert.equal(instance.y, pose.y, `exported ${instance.id} y differs`);
      assert.equal(instance.rotationRadians, pose.rotationRadians, `exported ${instance.id} rotation differs`);
    }
    await control("attached").check();
    await page.waitForFunction(() => Math.abs(window.ferrumFeatureLab.snapshot().poses.lamp.x + 40) < 0.01);
    await frozen();
    await control("reset").click();
    assert.equal((await snapshot()).poses.cart.x, 0);
    assert((await snapshot()).linked);
  }
  assert.equal((await snapshot()).failed, undefined);
}

/** Real native death plus a one-shot renderer API failure; neither may strand Reset. */
export async function checkSpatialRecovery(browser, address, gpuScript) {
  const results = [];
  for (const backend of ["webgl2", "webgpu"]) {
    const page = await browser.newPage();
    page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    if (backend === "webgpu") await page.addInitScript({ content: gpuScript });
    try {
      await page.route("**/features/ai-combat.json", async route => {
        const response = await route.fetch(), scene = await response.json();
        scene.behaviorRecipes.entities.actor.recipes.find(recipe => recipe.kind === "health").max = 1;
        await route.fulfill({ response, json: scene });
      });
      await page.goto(`${address}?feature=ai-combat&renderer=${backend}`);
      await page.waitForFunction(() => window.ferrumFeatureLab?.snapshot().nativeState === 1);
      await page.locator('[data-control="mode"]').selectOption("melee");
      await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().health === 0);
      await page.waitForTimeout(300); // Includes at least one observation refresh after despawn.
      const dead = await page.evaluate(() => window.ferrumFeatureLab.snapshot());
      assert.equal(dead.poses.actor, undefined);
      assert.equal(dead.failed, undefined, "normal death stopped rendering");
      await page.locator('[data-control="reset"]').click();
      await page.waitForFunction(() => !!window.ferrumFeatureLab.snapshot().poses.actor);
      results.push({ backend, scenario: "combat-death-reset", recovered: true });
      await page.locator('[data-control="mode"]').selectOption("chase");
      await page.evaluate(backend => {
        const prototype = backend === "webgl2" ? WebGL2RenderingContext.prototype : GPUQueue.prototype;
        const method = backend === "webgl2" ? "clear" : "submit", original = prototype[method];
        prototype[method] = function (...args) {
          prototype[method] = original;
          throw Error("Test one-shot render failure");
        };
      }, backend);
      await page.waitForFunction(() => !!window.ferrumFeatureLab.snapshot().failed);
      const stoppedTime = await page.evaluate(() => window.ferrumFeatureLab.snapshot().time);
      await page.locator('[data-control="reset"]').click();
      await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot(); return !s.failed && s.time > 0.1; });
      const first = await page.evaluate(() => window.ferrumFeatureLab.snapshot().time);
      await page.waitForFunction(time => window.ferrumFeatureLab.snapshot().time > time, first);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.playgroundGpuError), undefined);
      const resources = await page.evaluate(() => window.ferrumFeatureLab.destroy());
      for (const key of ["textureCount", "bufferCount", "programCount", "renderTargetCount"]) assert.equal(resources[key], 0);
      results.push({ backend, scenario: "render-failure-reset", recovered: true, stoppedTime, resources });
    } finally { await page.close(); }
  }
  return results;
}
