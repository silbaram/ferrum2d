import assert from "node:assert/strict";
import { smokePlacementSunElevation } from "./placement-sun-elevation-smoke.mjs";

export async function smokePlacementSunGizmo({page, mode, source, history, paint, open, edit, pixels}) {
  const root=page.locator('[data-placement-sun-gizmo]'),sun=page.locator('[data-placement-sun-handle="both"]');
  const axis=name=>page.locator(`[data-placement-sun-handle="${name}"]`);
  const original=await source(),baselineHistory=await history();
  await sun.waitFor({state:"visible"});await sun.click();await paint();
  assert.equal(await root.getAttribute("data-selected"),"true");
  assert(await page.locator('[data-placement-lighting-field="sun-intensity"]').isVisible(),"Selecting the sun must expose its lighting inspector");
  assert.deepEqual(await source(),original,"Selecting the editor-only sun must not create a scene object or patch");
  assert.equal((await history()).undoCount,baselineHistory.undoCount);
  assert.equal(await root.locator("button").count(),0,"Sun controls must be drawn as direct SVG arrows, without toolbar buttons");
  const hitPoint=target=>target.evaluate(path=>{
    const matrix=path.getScreenCTM(),length=path.getTotalLength();
    for(let i=1;i<40;i++){
      const p=path.getPointAtLength(length*i/40),point=new DOMPoint(p.x,p.y).matrixTransform(matrix);
      if(document.elementFromPoint(point.x,point.y)===path)return{x:point.x,y:point.y};
    }
  });
  const bounds=await root.boundingBox();
  for(const name of ["both","azimuth","elevation"]){
    const box=await axis(name).boundingBox();assert(box);
    assert(box.x>=bounds.x&&box.x+box.width<=bounds.x+bounds.width+1);
    assert(box.y>=bounds.y&&box.y+box.height<=bounds.y+bounds.height+1);
    assert.equal(await axis(name).getAttribute("role"),name==="both"?"button":"slider");
    if(name!=="both")assert((await root.locator(`[data-placement-sun-arrow="${name}"]`).getAttribute("d")).length>0,"The rotation line must carry a visible arrowhead");
  }
  const getSun=doc=>mode==="spatial"?doc.spatial.environment.lighting.directional:doc.lighting.directionalLight;
  const azimuth=doc=>{const s=getSun(doc);return Math.atan2(mode==="spatial"?s.direction.y:s.directionY,mode==="spatial"?s.direction.x:s.directionX)*180/Math.PI;};
  const wrap=value=>((value+180)%360+360)%360-180;
  const elevation=doc=>{const s=getSun(doc);return mode==="spatial"?Math.atan2(s.direction.elevation,Math.hypot(s.direction.x,s.direction.y))*180/Math.PI:(s.elevationRadians??Math.PI/4)*180/Math.PI;};
  for(const name of ["both","azimuth","elevation"]){
    await sun.press("Escape");await paint();
    assert.equal(await root.getAttribute("data-selected"),"false");
    const control=axis(name),key=name==="elevation"?"ArrowUp":"ArrowRight";
    await control.focus();
    // Use the keyboard directly: Locator.press would refocus and hide an escaped focus.
    for(let i=0;i<2;i++){
      await page.keyboard.press(key);await paint();
      assert(await control.evaluate(node=>document.activeElement===node),"The first selection and following edit must retain focus on the sun handle");
    }
    const repeated=await source();
    assert(Math.abs(name==="elevation"?elevation(repeated)-elevation(original)-2:wrap(azimuth(repeated)-azimuth(original))-2)<1e-6);
    for(let i=0;i<2;i++){await page.locator('[data-placement-action="undo"]').click();await paint();}
    assert.deepEqual(await source(),original);
  }
  await sun.click();
  await axis("azimuth").press("Shift+ArrowRight");await paint();
  const keyboard=await source();assert(Math.abs(wrap(azimuth(keyboard)-azimuth(original))-15)<1e-6);
  assert.deepEqual(keyboard.spatial?.camera,original.spatial?.camera);
  if(mode==="spatial")assert.equal(getSun(keyboard).direction.elevation,getSun(original).direction.elevation);
  else assert.equal(getSun(keyboard).elevationRadians,getSun(original).elevationRadians);
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),original);
  await page.locator('[data-placement-action="redo"]').click();await paint();assert.deepEqual(await source(),keyboard);
  await page.locator('[data-placement-action="undo"]').click();await paint();
  for(const selector of ['[data-placement-sun-ring="azimuth"]','[data-placement-sun-arrow-hit="azimuth"]','[data-placement-sun-arrow-hit="elevation"]','[data-placement-sun-ray-hit]']){
    const target=page.locator(selector);
    const point=await hitPoint(target);
    assert(point,`The rotation line/arrow must have a reachable drag target: ${selector}`);
    const beforeHistory=await history();
    await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+20,point.y+12,{steps:3});await paint();
    assert.notDeepEqual(await source(),original,"Dragging the actual line/arrow must edit sunlight");
    const highlighted=await axis(selector.includes("elevation")?"elevation":selector.includes("sun-ray-hit")?"both":"azimuth").getAttribute("data-active");
    assert.equal(highlighted,"true","The grabbed axis must highlight while dragging");
    await page.mouse.move(point.x,point.y,{steps:3});await paint();
    assert.deepEqual(await source(),original,"Returning a line/arrow drag to its origin must restore the exact draft");
    assert.deepEqual(await history(),beforeHistory,"Returning to the origin must preserve Undo and Redo");
    await page.mouse.move(point.x+20,point.y+12,{steps:3});await paint();
    assert.notDeepEqual(await source(),original,"The same captured drag must remain editable after returning to its origin");
    await page.keyboard.press("Escape");await page.mouse.up();await paint();assert.deepEqual(await source(),original);await sun.click();
  }
  await sun.click();
  const roundTripHistory=await history(),roundTripBox=await sun.boundingBox(),roundX=roundTripBox.x+roundTripBox.width/2,roundY=roundTripBox.y+roundTripBox.height/2;
  await page.mouse.move(roundX,roundY);await page.mouse.down();await page.mouse.move(roundX+32,roundY-20,{steps:4});await paint();
  if(mode==="2d"){
    await page.mouse.move(roundX,roundY-20,{steps:4});await paint();
    const yawRestored=await source();
    assert(Math.abs(wrap(azimuth(yawRestored)-azimuth(original)))<1e-6,"One axis must return to its initial value while the other stays edited");
    assert(Math.abs(elevation(yawRestored)-elevation(original)-10)<1e-6);
    await page.mouse.move(roundX+32,roundY,{steps:4});await paint();
    const pitchRestored=await source();
    assert(Math.abs(elevation(pitchRestored)-elevation(original))<1e-6);
    assert(Math.abs(wrap(azimuth(pitchRestored)-azimuth(original))-16)<1e-6);
    assert.equal(getSun(pitchRestored).shadowLengthScale,getSun(original).shadowLengthScale);
  }
  await page.mouse.move(roundX,roundY,{steps:4});await paint();
  assert.deepEqual(await source(),original,"Returning the sun disc to its origin must restore omitted defaults and original vectors");
  assert.deepEqual(await history(),roundTripHistory);
  await page.mouse.up();await paint();
  assert.deepEqual(await source(),original);assert.deepEqual(await history(),roundTripHistory,"A completed round trip must not create an Undo entry");
  const drag=async({cancel=false,loseCapture=false}={})=>{
    const box=await sun.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(x+32,y-20,{steps:4});await paint();
    if(cancel)await page.keyboard.press("Escape");
    if(loseCapture)await sun.evaluate(node=>node.releasePointerCapture(1));
    await page.mouse.up();await paint();
  };
  const beforePixels=await pixels(),beforeHistory=await history();
  await drag();const rotated=await source();
  assert.notDeepEqual(rotated,original);assert.equal((await history()).undoCount,beforeHistory.undoCount+1,"One sun drag is one Undo entry");
  assert(Math.abs(wrap(azimuth(rotated)-azimuth(original))-16)<1e-6);
  assert.deepEqual(rotated.spatial?.camera,original.spatial?.camera);
  if(mode==="spatial")assert.notEqual((await pixels()).hash,beforePixels.hash,"Sun dragging must change the actual native spatial framebuffer");
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),original);
  const cancelledHistory=await history();
  await drag({cancel:true});assert.deepEqual(await source(),original);assert.deepEqual(await history(),cancelledHistory);
  await sun.click();await drag({loseCapture:true});assert.deepEqual(await source(),original);assert.deepEqual(await history(),cancelledHistory);
  await sun.click();await axis("elevation").press("ArrowUp");await paint();
  const elevated=await source();assert.notDeepEqual(elevated,original);
  if(mode==="2d"){
    assert.equal(getSun(elevated).directionX,getSun(original).directionX);assert.equal(getSun(elevated).directionY,getSun(original).directionY);
    assert.equal(getSun(elevated).shadowLengthScale,getSun(original).shadowLengthScale,"Normal elevation must not change 2D shadow length");
  }
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),original);
  const elevationContinuity=mode==="spatial"?await smokePlacementSunElevation({page,source,history,paint,edit}):undefined;
  await edit(mode==="spatial"?"sun-height":"sun-normal-elevation",75);
  const highSun=await source(),highArrow=await hitPoint(page.locator('[data-placement-sun-arrow-hit="elevation"]'));
  assert(highArrow,"The elevation arrow must remain reachable at 75°, outside the sun disc");
  await page.mouse.move(highArrow.x,highArrow.y);await page.mouse.down();await page.mouse.move(highArrow.x+20,highArrow.y+12,{steps:3});await paint();
  assert.notDeepEqual(await source(),highSun);await page.keyboard.press("Escape");await page.mouse.up();await paint();assert.deepEqual(await source(),highSun);
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),original);
  await edit(mode==="spatial"?"sun-height":"sun-normal-elevation",90);
  const limit=await source(),limitHistory=await history();
  await sun.press("ArrowUp");if(mode==="spatial")await sun.press("ArrowLeft");await paint();
  assert.deepEqual(await source(),limit,"Clamped or undefined polar rotations must not modify the source");
  assert.deepEqual(await history(),limitHistory,"A clamped key must not create an Undo entry");
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),original);
  await open();const helpers=page.locator('[data-placement-lighting-toggle="helpers"]');
  await helpers.uncheck();await paint();assert(await root.isHidden());assert.deepEqual(await source(),original);
  await helpers.check();await paint();await sun.click();await paint();
  await page.screenshot({path:`artifacts/viewer-lighting/sun-gizmo-${mode}.png`,fullPage:true});
  await sun.press("Escape");await paint();assert.equal(await root.getAttribute("data-selected"),"false");
  return {directionOnly:true,handles:3,noToolbarButtons:true,arrowDrag:true,ringDrag:true,keyboard:true,keyboardFocus:true,roundTrip:true,partialAxisReturn:mode==="2d",...(elevationContinuity?{elevationContinuity}:{}),oneUndoPerDrag:true,cancel:true,lostCapture:true,helperToggle:true,nativePixels:mode==="spatial"};
}
