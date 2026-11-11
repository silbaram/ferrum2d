import { test } from "node:test";
import { equal } from "node:assert/strict";
import { SpatialShadowCache } from "../src/spatialShadowCache.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

function dualWithSun(): SpatialRenderBufferView {
  const values = compileSpatialEnvironment({ lighting: {
    lights: [0, 1].map(x => ({ position: { x, y: 0, elevation: 20 }, radius: 100 })),
    pointShadows: [{ lightIndex: 0 }, { lightIndex: 1 }],
    directional: { direction: { x: 1, y: -1, elevation: 2 }, shadows: { resolution: 128 } },
  } });
  return { version: 2, vertexStride: 11, terrainRevision: 1, camera: new Float32Array(28),
    terrain: new Float32Array(33), terrainVertexCount: 3, terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(), billboardVertexCount: 0,
    environment: { version: 10, values, shadowMatrices: new Float32Array(208), shadowCasters: new Float32Array(),
      shadowCasterVertexCount: 0, shadowSubmission: { version: 1, revision: 1, ranges: new Uint32Array() } } };
}

test("each owner tracks its light, native matrices and readiness independently, including retries", () => {
  const f = dualWithSun(), c = new SpatialShadowCache(), t = { textureRevision: () => 1 };
  equal(c.prepare(f, t, 0), 7); c.commit(f, 7); equal(c.prepare(f, t, 7), 0);
  for (const [offset, mask] of [[12, 1], [24, 2]] as const) {
    f.environment!.values[offset]++;
    equal(c.prepare(f, t, 7), mask); equal(c.prepare(f, t, 7), mask, "uncommitted work stays dirty");
    c.commit(f, mask); equal(c.prepare(f, t, 7), 0);
  }
  for (const [offset, mask] of [[0, 1], [96, 2], [192, 4]] as const) {
    f.environment!.shadowMatrices[offset]++;
    equal(c.prepare(f, t, 7), mask); c.commit(f, mask); equal(c.prepare(f, t, 7), 0);
  }
  equal(c.prepare(f, t, 5), 2, "secondary target replacement cannot invalidate primary/sun");
  equal(c.prepare(f, t, 7), 2, "allocated but failed target still needs drawing"); c.commit(f, 2);
  // Sampling-only changes do not alter stored depth.
  for (const offset of [4, 5, 95, 586, 587, 124]) f.environment!.values[offset]++;
  equal(c.prepare(f, t, 7), 0);
});

test("shared geometry/alpha revisions invalidate every map, even if a prior redraw was abandoned", () => {
  const f = dualWithSun(), c = new SpatialShadowCache(); let revision = 1;
  const t = { textureRevision: () => revision };
  c.prepare(f, t, 0); c.commit(f, 7);
  for (const change of [() => f.terrainRevision++, () => f.environment!.shadowSubmission!.revision++, () => revision++]) {
    change(); equal(c.prepare(f, t, 7), 7); equal(c.prepare(f, t, 7), 7);
    c.commit(f, 1); equal(c.prepare(f, t, 7), 6, "committing only primary cannot publish secondary/sun");
    c.commit(f, 6); equal(c.prepare(f, t, 7), 0);
  }
  f.environment!.shadowSubmission = undefined; equal(c.prepare(f, t, 7), 7);
  c.commit(f, 7); equal(c.prepare(f, t, 7), 7, "untracked legacy geometry is never cached");
});

test("sun PCSS enable, angle and cap changes reuse every depth map", () => {
  const f = dualWithSun(), c = new SpatialShadowCache(), t = { textureRevision: () => 1 };
  c.prepare(f, t, 0); c.commit(f, 7);
  const values = new Float32Array(600); values.set(f.environment!.values);
  f.environment!.version = 11; f.environment!.values = values;
  values.set([1, .5, 16], 592);
  equal(c.prepare(f, t, 7), 0);
  values[593] = 5; values[594] = 32; equal(c.prepare(f, t, 7), 0);
  values.fill(0, 592); equal(c.prepare(f, t, 7), 0);
});

test("point PCSS owner controls never dirty depth maps", () => {
  const f = dualWithSun(), c = new SpatialShadowCache(), t = { textureRevision: () => 1 };
  c.prepare(f, t, 0); c.commit(f, 7);
  const values = new Float32Array(608); values.set(f.environment!.values);
  f.environment!.version = 12; f.environment!.values = values;
  for (const at of [600, 604]) {
    values.set([1, 1, 16, 0], at); equal(c.prepare(f, t, 7), 0);
    values[at + 1] = 1000; values[at + 2] = 32; equal(c.prepare(f, t, 7), 0);
    values[at + 1] = 0; equal(c.prepare(f, t, 7), 0);
    values.fill(0, at, at + 4); equal(c.prepare(f, t, 7), 0);
  }
});

test("model face membership and poses invalidate only the maps using that model", async () => {
  const { createSpatialModelAsset } = await import('../src/spatialModel.js');
  const asset = createSpatialModelAsset({contentId:'a'.repeat(64),bounds:[-1,0,-1,1,2,1],primitives:[],images:[],diagnostics:[]});
  const f = dualWithSun(), c = new SpatialShadowCache(), t = { textureRevision: () => 1 };
  const values = new Float32Array(40), words = new Uint32Array(values.buffer);
  words[0] = words[20] = 1; words[2] = 3; words[22] = 257;
  f.models = { version: 2, stride: 20, values, words, assets: new Map([[1, asset]]) };
  c.prepare(f, t, 0); c.commit(f, 7);
  words[2] |= 4; equal(c.prepare(f, t, 7), 1); c.commit(f, 1);
  words[22] |= 512; equal(c.prepare(f, t, 7), 2); c.commit(f, 2);
  values[16]++; equal(c.prepare(f, t, 7), 1); c.commit(f, 1);
  values[36]++; equal(c.prepare(f, t, 7), 2); c.commit(f, 2);
  words[2] |= 128; equal(c.prepare(f, t, 7), 4); c.commit(f, 4);
  values[16]++; equal(c.prepare(f, t, 7), 5); c.commit(f, 5);
  words[2] ^= 1; words[1] ^= 2; equal(c.prepare(f, t, 7), 0, "camera and receiver state do not change depth");
});

test("shadow cache invalidates native geometry, light, atlas/alpha texture and stream changes", () => {
  const cache = new SpatialShadowCache();
  const frame: SpatialRenderBufferView = {
    version: 2, vertexStride: 11, terrainRevision: 3, camera: new Float32Array(28),
    terrain: new Float32Array(33), terrainVertexCount: 3, terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(), billboardVertexCount: 0,
    environment: {
      version: 1, values: compileSpatialEnvironment({ lighting: { lights: [{ position: { x: 0, y: 0, elevation: 20 }, radius: 100 }], shadows: { lightIndex: 0 } } }),
      shadowMatrices: new Float32Array(96), shadowCasters: new Float32Array(), shadowCasterVertexCount: 0,
      shadowSubmission: { version: 1, revision: 2, ranges: new Uint32Array() },
    },
  };
  let revision = 0;
  const textures = { texture: () => ({}), textureRevision: () => revision };
  equal(cache.prepare(frame, textures, 7), 1); cache.commit(frame, 7);
  equal(cache.prepare(frame, textures, 7), 0);
  equal(cache.prepare(frame, textures, 0), 1); cache.commit(frame, 7);
  equal(cache.prepare(frame, textures, 7), 0, "invalidating a redraw retains the texture revisions prepared for its commit");
  frame.environment!.values[60] += 50;
  equal(cache.prepare(frame, textures, 7), 0, "focus does not change the shadow map");
  frame.environment!.values[12] += 5;
  equal(cache.prepare(frame, textures, 7), 1, "point-light radial depth changes even in manually supplied packets");
  cache.commit(frame, 7);
  frame.terrainRevision++; equal(cache.prepare(frame, textures, 7), 1); cache.commit(frame, 7);
  frame.environment!.shadowSubmission!.revision++; equal(cache.prepare(frame, textures, 7), 1); cache.commit(frame, 7);
  frame.environment!.shadowMatrices[0]++; equal(cache.prepare(frame, textures, 7), 1); cache.commit(frame, 7);
  revision++; equal(cache.prepare(frame, textures, 7), 1); cache.commit(frame, 7);
  equal(cache.prepare(frame, textures, 7), 0);
  equal(cache.prepare(frame, { texture: () => ({}) }, 7), 1, "untracked mutable texture must redraw");
  frame.terrain = frame.terrain.slice(); equal(cache.prepare(frame, textures, 7), 1);
  frame.environment!.shadowSubmission = undefined;
  equal(cache.prepare(frame, textures, 7), 1, "legacy/deferred packets cannot reuse untracked geometry");
});

test("second point-light radial depth invalidates even when supplied matrices and caster revisions match", () => {
  const frame: SpatialRenderBufferView = {
    version: 2, vertexStride: 11, terrainRevision: 1, camera: new Float32Array(28),
    terrain: new Float32Array(), terrainVertexCount: 0, terrainDrawRanges: new Uint32Array(),
    billboards: new Float32Array(), billboardVertexCount: 0,
    environment: { version: 10, values: compileSpatialEnvironment({ lighting: {
      lights: [0, 1].map(x => ({ position: { x, y: 0, elevation: 20 }, radius: 100 })), pointShadows: [{ lightIndex: 0 }, { lightIndex: 1 }],
    } }), shadowMatrices: new Float32Array(192), shadowCasters: new Float32Array(), shadowCasterVertexCount: 0,
      shadowSubmission: { version: 1, revision: 1, ranges: new Uint32Array() } },
  };
  const cache = new SpatialShadowCache(), textures = { texture: () => ({}) };
  equal(cache.prepare(frame, textures, 7), 3); cache.commit(frame, 7);
  equal(cache.prepare(frame, textures, 7), 0);
  for (const offset of [24, 25, 26, 27]) {
    frame.environment!.values[offset]++;
    equal(cache.prepare(frame, textures, 7), 2, `second light field ${offset} must invalidate radial depth`);
    cache.commit(frame, 7); equal(cache.prepare(frame, textures, 7), 0);
  }
});

test("model shadow cache ignores camera/receive state and unused assets but tracks shadow geometry and LOD", async()=>{
  const {createSpatialModelAsset}=await import('../src/spatialModel.js');
  const makeAsset=(id:string)=>createSpatialModelAsset({contentId:id.repeat(64),bounds:[-1,0,-1,1,2,1],primitives:[],images:[],diagnostics:[]});
  const a=makeAsset('a'),b=makeAsset('b');
  const values=new Float32Array(40),words=new Uint32Array(values.buffer);
  for(let i=0;i<40;i+=20){words[i]=1;words[i+1]=3;words[i+2]=255;values[i+4]=values[i+9]=values[i+14]=values[i+19]=1;}
  const frame:SpatialRenderBufferView={version:2,vertexStride:11,terrainRevision:1,camera:new Float32Array(28),terrain:new Float32Array(),terrainVertexCount:0,terrainDrawRanges:new Uint32Array(),billboards:new Float32Array(),billboardVertexCount:0,
    models:{version:1,stride:20,words,values,assets:new Map([[1,a]])},
    environment:{version:1,values:compileSpatialEnvironment({lighting:{lights:[{position:{x:0,y:0,elevation:10},radius:100}],shadows:{lightIndex:0}}}),shadowMatrices:new Float32Array(96),shadowCasters:new Float32Array(),shadowCasterVertexCount:0,shadowSubmission:{version:1,revision:1,ranges:new Uint32Array()}}};
  const cache=new SpatialShadowCache(),textures={texture:()=>({})};
  equal(cache.prepare(frame,textures,7),1);cache.commit(frame, 7);equal(cache.prepare(frame,textures,7),0);
  words[2]&=~1;words[1]&=~2;frame.models!.assets=new Map([[1,a],[2,b]]);
  equal(cache.prepare(frame,textures,7),0,'camera visibility, receive flag and unused registered assets cannot invalidate shadow maps');
  words[22]=1;
  equal(cache.prepare(frame,textures,7),1,'removing a shadow caster invalidates');cache.commit(frame, 7);
  values[36]=200;
  equal(cache.prepare(frame,textures,7),0,'movement of a camera-only model does not invalidate');
  words[20]=2;
  equal(cache.prepare(frame,textures,7),0,'camera-only LOD does not invalidate');
  words[2]^=2;equal(cache.prepare(frame,textures,7),1,'point face membership changes');cache.commit(frame, 7);
  values[16]=5;equal(cache.prepare(frame,textures,7),1,'caster native pose changes');cache.commit(frame, 7);
  words[0]=2;equal(cache.prepare(frame,textures,7),1,'caster selected LOD changes');cache.commit(frame, 7);
  frame.models!.assets=new Map([[1,a],[2,a]]);equal(cache.prepare(frame,textures,7),1,'replaced caster content changes');cache.commit(frame, 7);
  frame.models=undefined;equal(cache.prepare(frame,textures,7),1,'last caster removal changes');cache.commit(frame, 7);
  equal(cache.prepare(frame,textures,7),0);
});
