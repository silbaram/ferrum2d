import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

type Volumes = NonNullable<RenderCommandBufferView["groundShadowVolumes"]>;
type Exports = {
  configure_data_scene_ground_shadow_volume?: unknown;
  ground_shadow_volume_abi_version():number;
  ground_shadow_volume_vertex_stride():number;
  ground_shadow_volume_ptr():number;
  ground_shadow_volume_len():number;
  ground_shadow_volume_caster_count():number;
};
const names = ["configure_data_scene_ground_shadow_volume","ground_shadow_volume_abi_version","ground_shadow_volume_vertex_stride","ground_shadow_volume_ptr","ground_shadow_volume_len","ground_shadow_volume_caster_count"] as const;

/** Optional v1 bulk output. Old cores without these exports retain their existing path. */
export function readGroundShadowVolumes(engine: Partial<Exports>, memory: WebAssembly.Memory): Volumes | undefined {
  if(names.every(name=>engine[name]===undefined))return undefined;
  if(!names.every(name=>typeof engine[name]==="function"))throw Error("Incomplete ground shadow volume ABI");
  // All exports above were checked before invoking the complete numeric contract.
  const e=engine as Exports;
  if(e.ground_shadow_volume_abi_version()!==1||e.ground_shadow_volume_vertex_stride()!==3)throw Error("Unsupported ground shadow volume ABI");
  const vertexCount=e.ground_shadow_volume_len(),casterCount=e.ground_shadow_volume_caster_count(),pointer=e.ground_shadow_volume_ptr();
  if(!validCounts(vertexCount,casterCount)||!Number.isSafeInteger(pointer)||pointer<0||pointer%4||pointer+vertexCount*12>memory.buffer.byteLength)
    throw Error("Ground shadow volume buffer is outside Wasm memory or exceeds its budget");
  return vertexCount?{version:1,stride:3,vertexCount,casterCount,buffer:new Float32Array(memory.buffer,pointer,vertexCount*3)}:undefined;
}

/** Validate custom/owned views as well as native views before submitting any GPU work. */
export function validateGroundShadowVolumes(commands: RenderCommandBufferView, flatSunConfigured: boolean): number {
  const volumes=commands.groundShadowVolumes;
  if(!volumes)return 0;
  if(!(volumes.buffer instanceof Float32Array)||volumes.version!==1||volumes.stride!==3||!validCounts(volumes.vertexCount,volumes.casterCount)
    ||volumes.buffer.length!==volumes.vertexCount*3)throw Error("Invalid ground shadow volume sidecar");
  for(let i=0;i<volumes.buffer.length;i++){
    const value=volumes.buffer[i];
    if(!Number.isFinite(value)||(i%3===2&&(value<0||value>1)))throw Error("Invalid ground shadow volume vertex");
  }
  if(volumes.vertexCount>0&&(commands.spatial||!flatSunConfigured))
    throw Error("Ground shadow volumes require flat LightingScene2D.directionalLight; sprite-only RenderTexture is unsupported");
  return volumes.casterCount;
}

function validCounts(vertices:number,casters:number):boolean {
  return Number.isSafeInteger(vertices)&&Number.isSafeInteger(casters)&&casters>=0&&casters<=10000
    &&vertices>=casters*3&&vertices<=casters*24&&vertices%3===0;
}
