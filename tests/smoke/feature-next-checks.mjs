import assert from 'node:assert/strict';
export const nextFeatureIds = new Set(['animation', 'hd2d-environment', 'destructible-terrain']);

export async function checkNextFeature({page, id, snapshot, control, pixelHash}) {
  if (id === 'animation') {
    await control('animation-mode').selectOption('movement');
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animation.clip === 0);
    assert(await control('flip').isDisabled());
    await control('footstep-audio').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animationEvents.sound);
    await control('walk-left').click();
    await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot(); return s.actor.x < 300 && s.animation.clip === 1 && s.animation.flipX && s.animationEvents.cues > 0; });
    await control('pause').click();
    const paused = await snapshot(); await page.waitForTimeout(250);
    assert.deepEqual((await snapshot()).actor, paused.actor);
    assert.deepEqual((await snapshot()).animationEvents, paused.animationEvents);
    assert.equal(paused.animationEvents.sound, false);
    await control('pause').click();
    await control('walk-right').click();
    await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot(); return s.animation.clip === 1 && !s.animation.flipX; });
    await page.waitForFunction(() => { const s = window.ferrumFeatureLab.snapshot(); return s.actor.x > 490 && s.animation.clip === 0; });
    await page.locator('canvas').focus(); await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().actor.y < 170);
    await control('animation-stop').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animation.clip === 0);
    await control('animation-mode').selectOption('once');
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animationEvents.completions === 1);
    assert((await snapshot()).animation.finished);
    await page.waitForTimeout(350); assert.equal((await snapshot()).animationEvents.completions, 1);
    await control('animation-replay').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().animationEvents.completions === 2);
    assert.equal((await snapshot()).animationEvents.overflow, 0);
    assert(await page.evaluate(() => window.featureAudio.starts > 0), 'frame events did not start real audio');
    await control('reset').click(); assert.equal((await snapshot()).animationEvents.mode, 'sheet');
    assert.equal((await snapshot()).actor.x, 320);
    assert.equal((await snapshot()).animationEvents.sound, false);
  }
  if (id === 'hd2d-environment') {
    await page.waitForTimeout(120);
    const baseline = await page.evaluate(pixelHash);
    const renderedFrames = (await snapshot()).renderedFrames;
    await page.waitForTimeout(250);
    assert.equal((await snapshot()).renderedFrames, renderedFrames, "static environment queued redundant GPU frames");
    await control('environment-shadows').uncheck(); await page.waitForTimeout(150);
    assert.equal((await snapshot()).shadowPasses, 0);
    const noShadow = await page.evaluate(pixelHash);
    assert.notEqual(noShadow.hash, baseline.hash, 'shadow toggle made no visible difference');
    await control('environment-shadows').check();
    await control('light-x').fill('90'); await control('light-x').dispatchEvent('input');
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().poses.light.x === 90);
    await page.waitForTimeout(150);
    const moved = await page.evaluate(pixelHash);
    assert.notEqual(moved.hash, baseline.hash, 'light position did not affect pixels');
    const exported = await control('download').evaluate(async link => (await fetch(link.href)).json());
    assert.equal(exported.spatial.environment.lighting.lights[0].position.x, 90);
    assert.equal(exported.sceneComposition.fragments.lab.instances.find(i => i.id === 'light').x, 90, 'exported light marker differs from actual light');
    await control('environment-fog').check(); await page.waitForTimeout(150);
    assert.notEqual((await page.evaluate(pixelHash)).hash, moved.hash, 'fog did not affect pixels');
    await control('pause').click(); const frozen = await snapshot();
    await page.waitForTimeout(150); assert.deepEqual((await snapshot()).poses, frozen.poses);
    await control('environment-lighting').uncheck(); assert(await control('environment-shadows').isDisabled());
    await control('reset').click(); await page.waitForTimeout(150);
    assert.equal((await snapshot()).environment.lightX, -90);
    assert.equal((await snapshot()).environment.fog, false);
    assert.equal((await page.evaluate(pixelHash)).hash, baseline.hash, 'environment reset did not restore source pixels');
  }
  if (id === 'destructible-terrain') {
    const fallingGravity = async () => {
      await control('terrain-ball').click();
      return page.evaluate(() => new Promise((resolve, reject) => {
        const start = window.ferrumFeatureLab.snapshot();
        const timer = setTimeout(() => reject(Error('No free fall sample')), 5000);
        const sample = () => {
          const s = window.ferrumFeatureLab.snapshot(), dt = s.terrain.physicsSeconds - start.terrain.physicsSeconds;
          if (dt > .02 && s.ball.velocityY > 10 && s.ball.y < 130) {
            clearTimeout(timer); resolve((s.ball.velocityY - start.ball.velocityY) / dt);
          } else if (dt < 1) requestAnimationFrame(sample);
          else { clearTimeout(timer); reject(Error('Missed free fall sample')); }
        };
        requestAnimationFrame(sample);
      }));
    };
    const initialGravity = await fallingGravity();
    assert(Math.abs(initialGravity - 300) < 1, `initial gravity differs from authored 300: ${initialGravity}`);
    assert.equal((await snapshot()).terrain.gravityY, 300);
    await page.waitForFunction(() => { const b = window.ferrumFeatureLab.snapshot().ball; return b.y > 146 && b.y < 153 && Math.abs(b.velocityY) < 3; });
    const solid = await snapshot(), pixels = await page.evaluate(pixelHash);
    assert(solid.terrain.centerSolid && solid.terrain.surfaceSolid);
    await control('pause').click(); await control('terrain-hole').click();
    await page.waitForTimeout(150); assert.deepEqual((await snapshot()).ball, solid.ball);
    assert.equal((await snapshot()).terrain.edits, 0);
    await control('pause').click(); await control('terrain-hole').click();
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().ball.y > 345);
    const carved = await snapshot();
    assert.equal(carved.terrain.centerSolid, false); assert.equal(carved.terrain.surfaceSolid, false);
    assert(carved.terrain.colliderChunksRebuilt > 0 && carved.terrain.colliderChunksRebuilt <= 8);
    assert(carved.terrain.texturePatch.width < 128, 'edit uploaded the whole terrain');
    assert.notEqual((await page.evaluate(pixelHash)).hash, pixels.hash);
    const editedGravity = await fallingGravity();
    assert(Math.abs(editedGravity - 300) < 1, `chunk edit changed runtime gravity: ${editedGravity}`);
    assert.equal((await snapshot()).terrain.gravityY, 300);
    await page.waitForFunction(() => window.ferrumFeatureLab.snapshot().ball.y > 345);
    await control('reset').click();
    await page.waitForFunction(() => { const b = window.ferrumFeatureLab.snapshot().ball; return b.y > 146 && b.y < 153 && Math.abs(b.velocityY) < 3; });
    assert((await snapshot()).terrain.surfaceSolid);
    assert.equal((await snapshot()).entities, solid.entities, 'reset leaked collider bodies');
    assert.equal((await snapshot()).resources.textureCount, solid.resources.textureCount);
    await control('pause').click();
    const rect = await page.locator('canvas').boundingBox();
    await page.mouse.click(rect.x + rect.width * 320 / 640, rect.y + rect.height * 256 / 384);
    assert.equal((await snapshot()).terrain.edits, 0);
    await control('pause').click();
    await page.mouse.click(rect.x + rect.width * 320 / 640, rect.y + rect.height * 256 / 384);
    assert.equal((await snapshot()).terrain.edits, 1);
    assert.equal((await snapshot()).terrain.centerSolid, false);
    await control('reset').click();
  }
}
