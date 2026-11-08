import assert from 'node:assert/strict';

/** Verify native commands and real renderer pixels, not just selected control values. */
export async function checkFeatureParticles({page,control,snapshot,pixelHash}) {
  const set=async(key,value)=>{await control(key).fill(String(value));await control(key).dispatchEvent('input');};
  const native=kind=>page.evaluate(kind=>window.ferrumFeatureLab.snapshot().particles.native[kind],kind);
  assert.equal((await snapshot()).particles.count,0);
  assert.equal(await control('life').inputValue(),'3');
  assert.equal(await control('speed').inputValue(),'220');
  const empty=await page.evaluate(pixelHash);
  await control('emit').click();
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.native['hit-spark']?.count===24);
  await control('pause').click();
  const spark=await native('hit-spark'), frozen=await page.evaluate(pixelHash), count=(await snapshot()).particles.count;
  assert.notEqual(frozen.hash,empty.hash,'native spark particles must be visible');
  assert(spark.meanSize>0&&spark.meanAlpha>0);
  await page.waitForTimeout(250);
  assert.equal((await snapshot()).particles.count,count);
  assert.equal((await page.evaluate(pixelHash)).hash,frozen.hash,'pause must freeze actual particles');
  await control('pause').click();
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.count===0);

  await control('vfx').selectOption('dust-loop');
  assert.equal(await control('count').inputValue(),'5');
  assert.equal(await control('life').inputValue(),'14');
  assert.equal(await control('speed').inputValue(),'40');
  await control('emit').click();
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.native['dust-loop']?.count>0);
  await control('stop-emitter').click();
  const dust=await native('dust-loop'), bursts=(await snapshot()).particles.emittedBurstCount;
  assert.notEqual(dust.textureId,spark.textureId,'dust must use its own soft cloud mask');
  assert(dust.meanSize>spark.meanSize,'dust should be larger than sparks');
  await page.waitForFunction(early=>{const s=window.ferrumFeatureLab.snapshot().particles.native['dust-loop'];return s?.count>0&&s.meanSize>early.meanSize*1.45&&s.meanAlpha<early.meanAlpha;},dust);
  assert.notEqual((await page.evaluate(pixelHash)).hash,frozen.hash,'dust and sparks must render differently');
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.count===0);
  assert.equal((await snapshot()).particles.emittedBurstCount,bursts,'stop must prevent new dust bursts');

  await set('count',8);await set('life',12);await set('speed',220);await control('emit').click();
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.emittedBurstCount>=3);
  assert((await snapshot()).particles.count>=16,'custom dust settings must still work');
  await control('stop-emitter').click();await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.count===0);
  await control('vfx').selectOption('motion-trail');
  assert.equal(await control('count').inputValue(),'2');assert.equal(await control('life').inputValue(),'5');
  await control('emit').click();
  const box=await page.locator('canvas').boundingBox();
  await page.mouse.move(box.x+80,box.y+80);await page.waitForTimeout(100);
  await page.mouse.move(box.x+box.width-80,box.y+box.height-80,{steps:12});
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.emittedBurstCount>=2);

  await control('compare-particles').click();
  await page.waitForFunction(()=>{const s=window.ferrumFeatureLab.snapshot().particles;return s.comparing&&s.native['hit-spark']?.count>0&&s.native['dust-loop']?.count>0;});
  await control('pause').click();
  const comparison=(await snapshot()).particles;
  assert.equal(comparison.comparison.length,2);
  assert(comparison.native['dust-loop'].meanSize>comparison.native['hit-spark'].meanSize);
  assert(await page.locator('.feature-particle-comparison').isVisible());
  const desktop=page.viewportSize();
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    await page.waitForFunction(()=>{
      const c=document.querySelector('canvas').getBoundingClientRect(),rows=[...document.querySelectorAll('.feature-particle-comparison span')].map(e=>e.getBoundingClientRect());
      return rows.every(r=>r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom)&&rows[0].right<=rows[1].left;
    });
  }
  await page.setViewportSize(desktop);
  await control('pause').click();await control('stop-emitter').click();
  await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.count===0);
  await control('reset').click();
  assert.equal((await snapshot()).particles.comparing,false);
  assert.equal((await snapshot()).particles.count,0);
  assert.equal(await control('vfx').inputValue(),'hit-spark');
  assert.equal(await control('count').inputValue(),'24');
  assert.equal(await control('life').inputValue(),'3');
  assert.equal(await control('speed').inputValue(),'220');
  assert.equal(await page.locator('.feature-particle-comparison').isVisible(),false);
  await control('emit').click();await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().particles.count>0);await control('pause').click();
}
