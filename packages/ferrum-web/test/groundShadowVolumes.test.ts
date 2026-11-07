import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { readGroundShadowVolumes, validateGroundShadowVolumes } from "../src/groundShadowVolumes.js";

const empty={commandCount:0,floatsPerCommand:15,buffer:new Float32Array(0)};
test("volume sidecar is optional, versioned, aligned, bounded and reacquired after memory growth",()=>{
  const memory=new WebAssembly.Memory({initial:1}),values=new Float32Array(memory.buffer,16,9);values.set([0,0,.5,10,0,.5,0,10,.5]);
  const exports={configure_data_scene_ground_shadow_volume:()=>true,ground_shadow_volume_abi_version:()=>1,ground_shadow_volume_vertex_stride:()=>3,
    ground_shadow_volume_ptr:()=>16,ground_shadow_volume_len:()=>3,ground_shadow_volume_caster_count:()=>1};
  equal(readGroundShadowVolumes({},memory),undefined);
  throws(()=>readGroundShadowVolumes({ground_shadow_volume_len:()=>0},memory),/Incomplete/);
  throws(()=>readGroundShadowVolumes({configure_data_scene_ground_shadow_volume:()=>true},memory),/Incomplete/);
  throws(()=>readGroundShadowVolumes({...exports,ground_shadow_volume_vertex_stride:()=>4},memory),/Unsupported/);
  for(const patch of [{ground_shadow_volume_ptr:()=>17},{ground_shadow_volume_ptr:()=>65532},{ground_shadow_volume_len:()=>4},
    {ground_shadow_volume_caster_count:()=>10001},{ground_shadow_volume_len:()=>27}])
    throws(()=>readGroundShadowVolumes({...exports,...patch},memory),/outside Wasm/);
  const first=readGroundShadowVolumes(exports,memory)!;equal(validateGroundShadowVolumes({...empty,groundShadowVolumes:first},true),1);
  throws(()=>validateGroundShadowVolumes({...empty,groundShadowVolumes:first},false),/require flat/);
  memory.grow(1);equal(first.buffer.length,0);
  const next=readGroundShadowVolumes(exports,memory)!;equal(next.buffer[2],.5);equal(next.buffer.length,9);
  next.buffer[2]=NaN;throws(()=>validateGroundShadowVolumes({...empty,groundShadowVolumes:next},true),/vertex/);
  next.buffer[2]=1.1;throws(()=>validateGroundShadowVolumes({...empty,groundShadowVolumes:next},true),/vertex/);
  throws(()=>validateGroundShadowVolumes({...empty,groundShadowVolumes:{...next,buffer:new Float32Array(6)}},true),/sidecar/);
  throws(()=>validateGroundShadowVolumes({...empty,groundShadowVolumes:{...next,buffer:new Float64Array(9) as unknown as Float32Array}},true),/sidecar/);
});
