import { test } from "node:test";
import { equal } from "node:assert/strict";
import { SpatialShadowCache } from "../src/spatialShadowCache.js";
import { compileSpatialEnvironment } from "../src/spatialEnvironment.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";

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
  equal(cache.matches(frame, textures), false); cache.commit(frame);
  equal(cache.matches(frame, textures), true);
  frame.environment!.values[60] += 50;
  equal(cache.matches(frame, textures), true, "focus does not change the shadow map");
  frame.environment!.values[12] += 5;
  equal(cache.matches(frame, textures), false, "point-light radial depth changes even in manually supplied packets");
  cache.commit(frame);
  frame.terrainRevision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  frame.environment!.shadowSubmission!.revision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  frame.environment!.shadowMatrices[0]++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  revision++; equal(cache.matches(frame, textures), false); cache.commit(frame);
  equal(cache.matches(frame, textures), true);
  equal(cache.matches(frame, { texture: () => ({}) }), false, "untracked mutable texture must redraw");
  frame.terrain = frame.terrain.slice(); equal(cache.matches(frame, textures), false);
  frame.environment!.shadowSubmission = undefined;
  equal(cache.matches(frame, textures), false, "legacy/deferred packets cannot reuse untracked geometry");
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
  equal(cache.matches(frame,textures),false);cache.commit(frame);equal(cache.matches(frame,textures),true);
  words[2]&=~1;words[1]&=~2;frame.models!.assets=new Map([[1,a],[2,b]]);
  equal(cache.matches(frame,textures),true,'camera visibility, receive flag and unused registered assets cannot invalidate shadow maps');
  words[22]=1;
  equal(cache.matches(frame,textures),false,'removing a shadow caster invalidates');cache.commit(frame);
  values[36]=200;
  equal(cache.matches(frame,textures),true,'movement of a camera-only model does not invalidate');
  words[20]=2;
  equal(cache.matches(frame,textures),true,'camera-only LOD does not invalidate');
  words[2]^=2;equal(cache.matches(frame,textures),false,'point face membership changes');cache.commit(frame);
  values[16]=5;equal(cache.matches(frame,textures),false,'caster native pose changes');cache.commit(frame);
  words[0]=2;equal(cache.matches(frame,textures),false,'caster selected LOD changes');cache.commit(frame);
  frame.models!.assets=new Map([[1,a],[2,a]]);equal(cache.matches(frame,textures),false,'replaced caster content changes');cache.commit(frame);
  frame.models=undefined;equal(cache.matches(frame,textures),false,'last caster removal changes');cache.commit(frame);
  equal(cache.matches(frame,textures),true);
});
