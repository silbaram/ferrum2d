import { test } from "node:test";
import { equal, deepEqual, ok, throws } from "node:assert/strict";
import { raycastSpatialModel } from "../src/core.js";
import { createSpatialModelAsset, type SpatialModelPrimitive } from "../src/spatialModel.js";
import { createSpatialApi } from "../src/dataSceneSpatial.js";
import type { Engine } from "../pkg/ferrum_core.js";

const primitive = (changes: Partial<SpatialModelPrimitive> = {}): SpatialModelPrimitive => ({
  vertices: new Float32Array([-1,-1,0,0,0,0,0,1, 1,-1,0,1,0,0,0,1, -1,1,0,0,1,0,0,1]),
  indices: new Uint32Array([0,1,2]), color:[1,1,1,1], alphaCutoff:0, doubleSided:false,
  sampler:[9728,9728,33071,33071], emissiveFactor:[0,0,0], ...changes,
});
const asset = (primitives = [primitive()], pixels?: Uint8ClampedArray) => createSpatialModelAsset({
  contentId:"test",bounds:[-1,-1,0,1,1,0],primitives,images:pixels ? [{width:2,height:1,pixels}] : [],diagnostics:[],
});
test("mesh picking excludes empty bounding-box corners and returns nearest deterministic triangle",()=>{
  const a=asset(),ray={origin:[-0.5,-0.5,2] as const,direction:[0,0,-4] as const},copy=structuredClone(ray);
  const hit=raycastSpatialModel(a,ray);if(!hit)throw new Error("Expected a triangle hit");equal(hit.distance,2);deepEqual(hit.point,[-0.5,-0.5,0]);equal(hit.primitiveIndex,0);equal(hit.triangleIndex,0);
  equal(raycastSpatialModel(a,{origin:[0.8,0.8,2],direction:[0,0,-1]}),undefined);
  equal(raycastSpatialModel(a,{origin:[3,0,2],direction:[0,0,-1]}),undefined);
  equal(raycastSpatialModel(a,{origin:[0,0,2],direction:[1,0,0]}),undefined);
  equal(raycastSpatialModel(asset([primitive(),primitive()]),ray)?.primitiveIndex,0);deepEqual(ray,copy);
});
test("mesh picking respects face culling, double sided materials and a forward-only ray",()=>{
  const ray={origin:[-0.5,-0.5,-2] as const,direction:[0,0,1] as const};
  equal(raycastSpatialModel(asset(),ray),undefined);ok(raycastSpatialModel(asset([primitive({doubleSided:true})]),ray));
  equal(raycastSpatialModel(asset(),{origin:[0,0,2],direction:[0,0,1]}),undefined);
});
test("clip distances skip a near surface without hiding a further visible triangle",()=>{
  const farPrimitive=primitive();const vertices=farPrimitive.vertices.slice();for(let i=2;i<vertices.length;i+=8)vertices[i]=-2;
  const a=createSpatialModelAsset({contentId:"clip",bounds:[-1,-1,-2,1,1,0],primitives:[primitive(),{...farPrimitive,vertices}],images:[],diagnostics:[]});
  const ray={origin:[-0.5,-0.5,2] as const,direction:[0,0,-2] as const};
  equal(raycastSpatialModel(a,{...ray,near:3,far:5})?.primitiveIndex,1);
  equal(raycastSpatialModel(a,{...ray,near:3,far:3.5}),undefined);
  throws(()=>raycastSpatialModel(a,{...ray,near:-1}));throws(()=>raycastSpatialModel(a,{...ray,near:4,far:2}));
});
test("mesh picking samples alpha MASK holes and leaves OPAQUE geometry selectable",()=>{
  const pixels=new Uint8ClampedArray([255,255,255,0,255,255,255,255]),p=primitive({image:0,alphaCutoff:0.5});
  equal(raycastSpatialModel(asset([p],pixels),{origin:[-0.5,-0.5,2],direction:[0,0,-1]}),undefined);
  ok(raycastSpatialModel(asset([p],pixels),{origin:[0.5,-0.8,2],direction:[0,0,-1]}));
  ok(raycastSpatialModel(asset([primitive({image:0})],pixels),{origin:[-0.5,-0.5,2],direction:[0,0,-1]}));
});
test("normal-mapped vertex stride, tiny geometry and invalid inputs are handled explicitly",()=>{
  const p=primitive(),v=new Float32Array(36);
  for(let i=0;i<3;i++)v.set(p.vertices.subarray(i*8,i*8+8),i*12);
  const normal=primitive({vertices:v,normal:{image:0,sampler:[9728,9728,33071,33071],scale:1}});
  ok(raycastSpatialModel(asset([normal]),{origin:[0,0,1],direction:[0,0,-1]}));
  for(const direction of [[0,0,0],[NaN,0,1],[Infinity,0,1]] as const) throws(()=>raycastSpatialModel(asset(),{origin:[0,0,1],direction}));
});
test("valid tiny meshes and near-parallel rays are not rejected by absolute epsilons",()=>{
  for(const size of [1e-6,1e-20]) {
    const p=primitive(),vertices=p.vertices.slice();
    for(let i=0;i<vertices.length;i+=8)for(let axis=0;axis<3;axis++)vertices[i+axis]*=size;
    const a=createSpatialModelAsset({contentId:"tiny",bounds:[-size,-size,0,size,size,0],primitives:[{...p,vertices}],images:[],diagnostics:[]});
    ok(raycastSpatialModel(a,{origin:[0,0,1],direction:[0,0,-1]}));
  }
  const p=primitive(),vertices=p.vertices.slice();
  for(let i=0;i<vertices.length;i+=8)vertices[i]=vertices[i]<0 ? 5e-17 : 2e-16;
  const a=createSpatialModelAsset({contentId:"slab",bounds:[5e-17,-1,0,2e-16,1,0],primitives:[{...p,vertices}],images:[],diagnostics:[]});
  ok(raycastSpatialModel(a,{origin:[0,0,1],direction:[1e-16,0,-1]}));
  ok(raycastSpatialModel(asset(),{origin:[-1.5,-.5,1e-12],direction:[1,0,-1e-12]}));
});
test("cold model snapshots use native selected LOD, visibility, generation and owned transforms",()=>{
  const base=asset(),lod=asset([primitive({doubleSided:true})]),handle={entityId:7,entityGeneration:3};
  let words=new Uint32Array(),last: number[]=[];
  const native={configure_spatial_scene_models:()=>true,spatial_model_draw_snapshot:(id:number,generation:number)=>{last=[id,generation];return words.slice();}},
    api=createSpatialApi(native as unknown as Engine,()=>{},()=>({width:800,height:600}));
  ok(api.registerDataSceneSpatialModel("base",base));ok(api.registerDataSceneSpatialModel("lod",lod));
  equal(api.dataSceneSpatialModelDrawSnapshot(handle),undefined);
  words=new Uint32Array(20);words.set([2,0,1,0]);new Float32Array(words.buffer).set([2,0,0,0,0,2,0,0,0,0,2,0,40,50,-60,1],4);
  const snapshot=api.dataSceneSpatialModelDrawSnapshot(handle)!;
  equal(snapshot.asset,lod);equal(snapshot.cameraVisible,true);deepEqual(last,[7,3]);equal(snapshot.transform[12],40);
  words[2]=128;new Float32Array(words.buffer)[16]=99;
  equal(api.dataSceneSpatialModelDrawSnapshot(handle)?.cameraVisible,false);equal(snapshot.transform[12],40);
  words[3]=9;throws(()=>api.dataSceneSpatialModelDrawSnapshot(handle),/Invalid/);
  throws(()=>api.dataSceneSpatialModelDrawSnapshot({...handle,entityId:NaN}));
  const old=createSpatialApi({} as Engine,()=>{},()=>({width:800,height:600}));equal(old.dataSceneSpatialModelDrawSnapshot(handle),undefined);
});
