import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
const { spatialCameraPitch, tiltSpatialCamera, orbitSpatialCameraPitch, spatialEditorRenderCamera, panSpatialCamera, orbitSpatialCamera, zoomSpatialCamera, MIN_VIEW_PITCH, MAX_VIEW_PITCH } = await import(
  "data:text/javascript;base64," + Buffer.from(ts.transpileModule(
    await readFile("apps/placement-viewer/src/placementSpatialCamera.ts", "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText).toString("base64")
);
const distance = c => Math.hypot(c.position.x-c.target.x,c.position.y-c.target.y,c.position.elevation-c.target.elevation);
const yaw = c => Math.atan2(c.position.y-c.target.y,c.position.x-c.target.x);
const near = (a,b) => assert(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test("direct orbit/pan/zoom preserve camera framing invariants without mutating authored values", () => {
  for (const projection of ["orthographic", "perspective"]) for (const angle of [-45,0,45,89]) {
    const c=orbitSpatialCameraPitch({projection, position:{x:120,y:-200,elevation:180}, target:{x:10,y:15,elevation:20}, height:300,fovDegrees:55,near:.1,far:2000},angle);
    const copy=structuredClone(c), panned=panSpatialCamera(c,24,-16,600), orbited=orbitSpatialCamera(c,60,-30), zoomed=zoomSpatialCamera(c,.8);
    near(distance(panned),distance(c)); near(yaw(panned),yaw(c)); near(spatialCameraPitch(panned),angle);
    for (const axis of ["x","y","elevation"]) near(panned.position[axis]-c.position[axis],panned.target[axis]-c.target[axis]);
    assert.deepEqual(orbited.target,c.target); near(distance(orbited),distance(c));
    assert(spatialCameraPitch(orbited)<90 && spatialCameraPitch(orbited)>-90);
    assert.deepEqual(zoomed.target,c.target);
    if(projection==="orthographic") { near(zoomed.height,c.height*.8); assert.deepEqual(zoomed.position,c.position); }
    else near(distance(zoomed),distance(c)*.8);
    assert.deepEqual(c,copy);
    assert.throws(()=>panSpatialCamera(c,1,1,0)); assert.throws(()=>zoomSpatialCamera(c,0)); assert.throws(()=>orbitSpatialCamera(c,NaN,0));
  }
});
for (const projection of ["orthographic", "perspective"])
  test(`${projection} pitch preserves target, distance, yaw and lens without mutating input`, () => {
    const c={projection,position:{x:-150,y:230,elevation:340},target:{x:17,y:-38,elevation:27},height:660,fovDegrees:55,near:.1,far:2200};
    const copy=structuredClone(c);
    for(const degrees of [1,15,45,70,89]) {
      const next=tiltSpatialCamera(c,degrees);
      near(spatialCameraPitch(next),degrees); near(distance(next),distance(c)); near(yaw(next),yaw(c));
      assert.deepEqual(next.target,c.target);
      for(const key of ["projection","height","fovDegrees","near","far"]) assert.equal(next[key],c[key]);
      assert.notEqual(next,c); assert.notEqual(next.target,c.target); assert.notEqual(next.position,c.position);
    }
    assert.deepEqual(c,copy);
  });
test("angle limits avoid horizontal and vertical singularities, including repeated orbits", () => {
  let c={projection:"orthographic",position:{x:120,y:-300,elevation:270},target:{x:0,y:0,elevation:10},height:500};
  const radius=distance(c), direction=yaw(c);
  for(let n=0;n<200;n++) {
    c=tiltSpatialCamera(c,-1000); near(spatialCameraPitch(c),MIN_VIEW_PITCH);
    c=tiltSpatialCamera(c,1000); near(spatialCameraPitch(c),MAX_VIEW_PITCH);
    near(distance(c),radius); near(yaw(c),direction);
    assert(Math.hypot(c.position.x-c.target.x,c.position.y-c.target.y)>0);
  }
});
test("nonfinite angles or zero-length cameras are rejected", () => {
  const c={projection:"perspective",position:{x:0,y:-100,elevation:100},target:{x:0,y:0,elevation:0}};
  for(const value of [NaN,Infinity,-Infinity]) assert.throws(()=>tiltSpatialCamera(c,value),/finite/);
  assert.throws(()=>tiltSpatialCamera({...c,position:{...c.target}},45),/finite/);
  assert.throws(()=>tiltSpatialCamera({...c,position:{...c.position,x:NaN}},45),/finite/);
});
test("authored signed pitch preserves framing while editor navigation retains its bounds", () => {
  const c={projection:"perspective",position:{x:20,y:-200,elevation:200},target:{x:20,y:0,elevation:0},fovDegrees:55,near:.1,far:2000};
  const original=structuredClone(c);
  for(const degrees of [-89.9,-45,-0.5,0,0.5,45,89.9]) {
    const next=orbitSpatialCameraPitch(c,degrees);
    near(spatialCameraPitch(next),degrees);near(distance(next),distance(c));near(yaw(next),yaw(c));
    assert.deepEqual(next.target,c.target);
    for(const key of ["projection","fovDegrees","near","far"]) assert.equal(next[key],c[key]);
  }
  for(const degrees of [-90,90,-100,100,NaN,Infinity]) assert.throws(()=>orbitSpatialCameraPitch(c,degrees));
  near(spatialCameraPitch(tiltSpatialCamera(c,-45)),MIN_VIEW_PITCH);
  assert.deepEqual(c,original);
});
test("translated targets and an authored vertical camera produce a finite, reversible view", () => {
  const c={projection:"orthographic",position:{x:27,y:-54,elevation:300},target:{x:27,y:-54,elevation:100}};
  near(spatialCameraPitch(c),90);
  const next=tiltSpatialCamera(c,35);
  near(distance(next),200); near(spatialCameraPitch(next),35);
  assert(Object.values(next.position).every(Number.isFinite));
  const back=tiltSpatialCamera(next,60), again=tiltSpatialCamera(back,35);
  for(const key of ["x","y","elevation"]) near(next.position[key],again.position[key]);
});

test("orthographic working plane stays between near and far across the entire view after zoom and pitch", () => {
  for (const degrees of [1, 7, 20, 45, 89]) for (const height of [40, 660, 2400, 20000])
    for (const elevation of [-300, 0, 80, 10000]) {
      const c=tiltSpatialCamera({projection:"orthographic",position:{x:410,y:-610,elevation:580},
        target:{x:25,y:10,elevation:15},height,near:.1,far:2200},degrees), original=structuredClone(c);
      const render=spatialEditorRenderCamera(c,elevation), radius=distance(render),
        sine=(render.position.elevation-render.target.elevation)/radius,
        half=height/2*Math.cos(degrees*Math.PI/180)/sine,
        middle=radius+(render.target.elevation-elevation)/sine;
      assert(middle-half>render.near,`Near clip at pitch ${degrees}, height ${height}, elevation ${elevation}`);
      assert(middle+half<render.far,`Far clip at pitch ${degrees}, height ${height}, elevation ${elevation}`);
      near(spatialCameraPitch(render),degrees); near(yaw(render),yaw(c));
      assert.deepEqual(render.target,c.target); assert.equal(render.height,c.height);
      // Orthographic screen coordinates are dot products with right/up. The eye
      // displacement must be perpendicular to both, so visible landmarks never move.
      const delta=[render.position.x-c.position.x,render.position.y-c.position.y,render.position.elevation-c.position.elevation],
        d=[c.position.x-c.target.x,c.position.y-c.target.y,c.position.elevation-c.target.elevation],
        horizontal=Math.hypot(d[0],d[1]), r=distance(c),
        right=[-d[1]/horizontal,d[0]/horizontal,0],
        up=[-d[0]*d[2]/horizontal/r,-d[1]*d[2]/horizontal/r,horizontal/r];
      assert(Math.abs(delta.reduce((n,v,i)=>n+v*right[i],0))<1e-7);
      assert(Math.abs(delta.reduce((n,v,i)=>n+v*up[i],0))<1e-7);
      assert.deepEqual(c,original); assert.deepEqual(spatialEditorRenderCamera(c,elevation),render);
    }
});

test("perspective and horizontal cameras retain their authored projection and valid clipping", () => {
  const c={projection:"perspective",position:{x:410,y:-610,elevation:580},target:{x:0,y:10,elevation:15},near:.1,far:2200,fovDegrees:55};
  assert.deepEqual(spatialEditorRenderCamera(c,24),c);
  const horizontal={...c,projection:"orthographic",position:{...c.position,elevation:15},height:660};
  assert.deepEqual(spatialEditorRenderCamera(horizontal,24),horizontal);
});
