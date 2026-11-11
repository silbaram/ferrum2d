import assert from 'node:assert/strict';

async function assertSettingsKeepPreview(page,id) {
  const original=await page.evaluate(()=>({x:scrollX,y:scrollY,details:[...document.querySelectorAll('.feature-panel > details')].map(e=>e.open)}));
  try {
    await page.evaluate(()=>{
      for(const details of document.querySelectorAll('.feature-panel > details'))details.open=true;
      window.scrollTo(0,document.querySelector('.feature-preview').getBoundingClientRect().top+scrollY-12);
    });
    const before=await page.evaluate(()=>({y:scrollY}));
    // Keyboard focus must reach the bottom of the inspector without losing the scene.
    await page.locator('.feature-panel a').last().focus();
    const result=await page.evaluate(()=>{
      const canvas=document.querySelector('canvas').getBoundingClientRect(),preview=document.querySelector('.feature-preview').getBoundingClientRect(),panel=document.querySelector('.feature-panel'),r=panel.getBoundingClientRect(),target=document.activeElement.getBoundingClientRect();
      return {y:scrollY,canvas:canvas.toJSON(),preview:preview.toJSON(),target:target.toJSON(),panel:r.toJSON(),height:innerHeight};
    });
    assert(result.preview.top>=-1&&result.preview.bottom<=result.height+1&&result.canvas.top<result.preview.bottom&&result.canvas.bottom>result.preview.top,`${id}: settings focus hid the preview: ${JSON.stringify(result)}`);
    assert(Math.abs(result.y-before.y)<=1,`${id}: settings focus scrolled the page instead of the inspector`);
    assert(result.target.top>=result.panel.top&&result.target.bottom<=result.panel.bottom,`${id}: lower settings must be reachable by keyboard`);
    assert(result.panel.left>=result.preview.right-1||result.panel.top>=result.preview.bottom-1,`${id}: pinned preview covered the settings`);
    // Scrolling past the end must not chain into a page scroll.
    await page.locator('.feature-panel').evaluate(panel=>{panel.scrollTop=panel.scrollHeight;});
    await page.mouse.move(result.panel.left+4,Math.min(result.height-20,Math.max(20,result.panel.top+result.panel.height/2)));
    await page.mouse.wheel(0,500);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert(Math.abs(await page.evaluate(()=>scrollY)-before.y)<=1,`${id}: inspector wheel moved the game view`);
  } finally {
    await page.evaluate(original=>{
      document.activeElement?.blur();
      document.querySelectorAll('.feature-panel > details').forEach((e,i)=>{e.open=original.details[i];});
      document.querySelector('.feature-panel').scrollTop=0;
      window.scrollTo(original.x,original.y);
    },original);
  }
}

async function assertSceneUiBounds(page, id) {
  const joystick=page.locator('[data-ferrum-virtual-joystick]');
  if(await joystick.count()) assert(await joystick.evaluate(element=>{
    const r=element.getBoundingClientRect(),c=document.querySelector('canvas').getBoundingClientRect(),scene=element.closest('.feature-scene').getBoundingClientRect();
    return r.left>=scene.left&&r.right<=scene.right&&r.top>=c.bottom&&r.bottom<=scene.bottom;
  }),`${id}: virtual joystick must stay adjacent to the game view without covering it`);
  if (!['dialogue','hud'].includes(id)) return;
  await page.evaluate(() => document.fonts.ready);
  const panel=page.locator('.feature-content-preview [data-ferrum-ui-dialog], .feature-content-preview [data-ferrum-ui-panel]').first();
  assert(await panel.isVisible(), `${id}: actual UI must be in the game view`);
  const geometry=await panel.evaluate(element=>{
    const rect=element.getBoundingClientRect(),canvas=document.querySelector('canvas').getBoundingClientRect();
    return {inside:rect.left>=canvas.left-1&&rect.right<=canvas.right+1&&rect.top>=canvas.top-1&&rect.bottom<=canvas.bottom+1,font:getComputedStyle(element).fontFamily};
  });
  assert(geometry.inside,`${id}: UI must not fall below/outside the game view`);
  assert(geometry.font.includes('Ferrum Example UI'),`${id}: Korean content must use the bundled font`);
}

async function assertRoleBounds(page,id) {
  const result=await page.locator('.feature-role-labels').evaluate(layer=>{
    const canvas=document.querySelector('canvas').getBoundingClientRect();
    const boxes=[...layer.querySelectorAll('span:not([hidden])')].map(element=>({text:element.textContent,...element.getBoundingClientRect().toJSON()}));
    return {canvas:canvas.toJSON(),boxes,visible:boxes.length,inside:boxes.every(r=>r.left>=canvas.left-1&&r.right<=canvas.right+1&&r.top>=canvas.top-1&&r.bottom<=canvas.bottom+1),overlap:boxes.some((r,i)=>boxes.slice(i+1).some(b=>r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top))};
  });
  assert(result.inside,`${id}: role labels escaped the canvas: ${JSON.stringify(result)}`);
  assert(!result.overlap,`${id}: role labels overlap: ${JSON.stringify(result)}`);
  return result.visible;
}

export async function checkLearningInitial(page,feature) {
  assert.equal(await page.locator('.feature-lesson-intro h2').textContent(),feature.lesson.useCase);
  assert.equal(await page.locator('.feature-lesson-steps li').count(),feature.lesson.steps.length);
  assert.equal(await page.locator('.feature-lesson-legend li').count(),feature.lesson.legend.length);
  for(const selector of feature.lesson.actions) assert(await page.locator(selector).evaluateAll(elements=>elements.every(element=>!!element.closest('.feature-lesson-actions'))),`${feature.id}: primary actions must stay next to the scene`);
  if(feature.lesson.roles.length) await page.waitForFunction(()=>document.querySelector('.feature-role-labels span:not([hidden])'));
  const visibleRoles=await assertRoleBounds(page,feature.id);
  await assertSceneUiBounds(page,feature.id);
  assert.equal(await page.locator('.feature-lesson-diagnostics').getAttribute('open'),null,'technical statistics should be secondary');
  assert.equal(await page.locator('.feature-lesson-guide').getAttribute('open'),null,'long instructions should be folded before editing');
  await assertSettingsKeepPreview(page,feature.id);
  return {useCase:true,orderedSteps:true,legend:true,visibleRoles,primaryActions:feature.lesson.actions.length,settingsKeepPreview:true};
}

export async function checkLearningControls({page,id,control,snapshot}) {
  const visual=page.locator(`.feature-lesson-visual[data-kind="${id}"]`);
  if(id==='camera') {
    await control('zoom').fill('200');await control('zoom').dispatchEvent('input');
    await page.waitForFunction(()=>Number(document.querySelector('.lesson-camera-window').getAttribute('width'))<400);
    await control('reset').click();
    await page.waitForFunction(()=>Math.abs(Number(document.querySelector('.lesson-camera-window').getAttribute('width'))-640)<1);
  }
  if(id==='lighting') {
    // The directional rendering check intentionally leaves the light disabled.
    await control('lighting').selectOption('lit');await control('normal').check();
    for(const [y,word]of [[64,'위쪽'],[320,'아래쪽']]) {
      await page.getByRole('button',{name:`${word} 광원`,exact:true}).click();
      await page.waitForFunction(y=>document.querySelector('[data-value=observation]').textContent.includes(`광원 432, ${y}`),y);
    }
    await control('normal').uncheck();
    await page.waitForFunction(()=>document.querySelector('.feature-lesson-feedback').textContent.includes('노멀맵 끔'));
    await control('reset').click();
  }
  if(id==='projectiles') {
    for(const [index,mode]of ['despawn','passThrough','bounce'].entries()) {
      await control('projectile').selectOption(mode);
      await page.waitForFunction(index=>[...document.querySelectorAll('.feature-lesson-visual[data-kind=projectiles] .feature-lesson-cells > div')].findIndex(element=>element.dataset.active==='true')===index,index);
    }
    await control('reset').click();
  }
  if(id==='asset-loading') {
    await control('clear-cache').click();await control('load-assets').click();
    await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().loading.state==='complete');
    await page.waitForFunction(()=>document.querySelector('.feature-lesson-dashboard progress').value===3);
    await control('load-assets').click();
    await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().loading.state==='complete'&&window.ferrumFeatureLab.snapshot().loading.cached===3);
    await page.waitForFunction(()=>[...document.querySelectorAll('.feature-lesson-dashboard strong')].map(e=>e.textContent).join('|')==='3 / 3|0회|3개');
    await control('reset').click();
  }
  if(id==='streaming') {
    await page.locator('[data-chunk="2"]').click();
    await page.waitForFunction(()=>window.ferrumFeatureLab.snapshot().streaming.visible===2&&!window.ferrumFeatureLab.snapshot().streaming.pending);
    await page.waitForFunction(()=>[...document.querySelectorAll('.feature-lesson-dashboard .feature-lesson-cells > div')].findIndex(e=>e.dataset.active==='true')===2);
    assert((await snapshot()).streaming.resident.includes('stream_ground'));
    await control('reset').click();
  }
  if(id==='attachments') {
    await control('attached').uncheck();
    await page.waitForFunction(()=>document.querySelector('.feature-lesson-feedback').textContent.includes('연결 해제'));
    await control('reset').click();
  }
  return {presentationTracksControls:true,visual:await visual.count()>0};
}

export async function checkLearningNarrow(page,id) {
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await assertRoleBounds(page,id);await assertSceneUiBounds(page,id);
  assert(await page.locator('.feature-lesson-intro').evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1;}),`${id}: lesson header overflow`);
  await assertSettingsKeepPreview(page,id);
  if(id==='nine-slice') {
    const preview=page.locator('.feature-preview');
    await preview.focus();await page.keyboard.press('End');
    await page.waitForFunction(()=>document.querySelector('.feature-preview').scrollTop>0);
    assert(await preview.evaluate(element=>document.querySelector('canvas').clientHeight>element.clientHeight),'tall lessons must retain their original canvas proportions');
    await preview.evaluate(element=>{element.scrollTop=0;element.blur();});
  }
}
