import assert from "node:assert/strict";

/** Exercise the actual projected SVG handle across half/full turns in both directions. */
export async function smokePlacementSunElevation({page, source, history, paint, edit}) {
  const original=await source(),originalUndo=(await history()).undoCount;
  await edit("sun-direction",90);await edit("sun-height",45);
  const baseline=await source(),sun=page.locator('[data-placement-sun-handle="both"]');
  const pitch=doc=>{const v=doc.spatial.environment.lighting.directional.direction;return Math.atan2(v.elevation,Math.hypot(v.x,v.y))*180/Math.PI;};
  const begin=async()=>{
    await sun.click();await paint();
    const geometry=await page.locator('[data-placement-sun-ring="elevation"]').evaluate(path=>{
      const points=[...path.getAttribute("d").matchAll(/[ML](-?[\d.]+),(-?[\d.]+)/g)].map(p=>({x:Number(p[1]),y:Number(p[2])}));
      const c={x:(points[0].x+points[36].x)/2,y:(points[0].y+points[36].y)/2};
      const u={x:points[18].x-c.x,y:points[18].y-c.y},v={x:(points[36].x-points[0].x)/2,y:(points[36].y-points[0].y)/2};
      const m=path.getScreenCTM();
      for(let i=0;i<points.length;i++){
        const p=new DOMPoint(points[i].x,points[i].y).matrixTransform(m);
        if(document.elementFromPoint(p.x,p.y)?.closest('[data-placement-sun-handle]')?.getAttribute("data-placement-sun-handle")==="elevation")
          return {c,u,v,m:{a:m.a,b:m.b,c:m.c,d:m.d,e:m.e,f:m.f},start:{x:p.x,y:p.y},angle:i*5-90};
      }
    });
    assert(geometry,"The elevation arc must have a reachable pointer target");
    assert(Math.abs(geometry.u.x*geometry.v.y-geometry.u.y*geometry.v.x)>100,"Use a camera where the elevation plane is not edge-on");
    await page.mouse.move(geometry.start.x,geometry.start.y);await page.mouse.down();
    let previous=0;
    return async offset=>{
      // Sample the ellipse continuously; a single jump cannot identify a turn direction.
      const steps=Math.max(1,Math.ceil(Math.abs(offset-previous)/15));
      for(let i=1;i<=steps;i++){
        const a=(geometry.angle+previous+(offset-previous)*i/steps)*Math.PI/180;
        const x=geometry.c.x+geometry.u.x*Math.cos(a)+geometry.v.x*Math.sin(a),y=geometry.c.y+geometry.u.y*Math.cos(a)+geometry.v.y*Math.sin(a),m=geometry.m;
        await page.mouse.move(m.a*x+m.c*y+m.e,m.b*x+m.d*y+m.f);
      }
      previous=offset;await paint();
    };
  };
  for(const sign of [1,-1]){
    const beforeHistory=await history(),move=await begin();
    for(const offset of [30,90,150,179,181,270,359,361,540,361,181,179,90,30,0]){
      await move(sign*offset);
      assert(Math.abs(pitch(await source())-Math.max(-90,Math.min(90,45+sign*offset)))<.05,
        `Elevation must remain continuous and clamped through ${sign*offset} degrees of pointer rotation`);
    }
    assert.deepEqual(await source(),baseline,"Reversing to the drag origin must restore the exact source after multiple seams");
    assert.deepEqual(await history(),beforeHistory);
    await move(sign*181);
    if(sign===1)await page.keyboard.press("Escape");
    else await page.locator('[data-placement-sun-handle="elevation"]').evaluate(node=>node.releasePointerCapture(1));
    await page.mouse.up();await paint();
    assert.deepEqual(await source(),baseline,"Escape/lost capture after a seam must restore the draft");
    assert.deepEqual(await history(),beforeHistory);
  }
  const beforeCommit=await history(),move=await begin();
  await move(90);await move(179);await move(181);await move(270);await move(361);
  await page.mouse.up();await paint();
  const committed=await source();assert(Math.abs(pitch(committed)-90)<1e-6);
  assert.deepEqual(committed.spatial.camera,baseline.spatial.camera);
  assert.equal((await history()).undoCount,beforeCommit.undoCount+1,"A drag across multiple seams is one Undo entry");
  await page.locator('[data-placement-action="undo"]').click();await paint();assert.deepEqual(await source(),baseline);
  await page.locator('[data-placement-action="redo"]').click();await paint();assert.deepEqual(await source(),committed);
  await page.locator('[data-placement-action="undo"]').click();await paint();
  const setupEdits=(await history()).undoCount-originalUndo;
  for(let i=0;i<setupEdits;i++){await page.locator('[data-placement-action="undo"]').click();await paint();}
  assert.deepEqual(await source(),original);
  return {bothDirections:true,halfTurn:true,fullTurn:true,reverse:true,origin:true,cancel:true,lostCapture:true,oneUndoPerDrag:true};
}
