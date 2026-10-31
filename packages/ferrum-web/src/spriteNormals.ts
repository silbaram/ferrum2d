import type { Engine } from "../pkg/ferrum_core";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import type { RenderCommandBufferView } from "./renderCommandDecoder.js";

export const SPRITE_NORMAL_NONE = 16_777_215;
export const MAX_SPRITE_NORMAL_UPDATES = 65_536;
type NormalExports = {
  sprite_normal_material_abi_version(): number;
  sprite_normal_material_size(): number;
  sprite_normal_material_ptr(): number;
  sprite_normal_material_len(): number;
  configure_sprite_normal_materials(records: Uint32Array): boolean;
};
const names = ["sprite_normal_material_abi_version", "sprite_normal_material_size", "sprite_normal_material_ptr", "sprite_normal_material_len", "configure_sprite_normal_materials"] as const;
export function supportsSpriteNormals(engine: Engine): engine is Engine & NormalExports {
  const exports=engine as Engine & Partial<NormalExports>;
  return names.every(name=>typeof exports[name] === "function") && exports.sprite_normal_material_abi_version!()===1 && exports.sprite_normal_material_size!()===8;
}
export function readSpriteNormals(engine: Engine,memory:WebAssembly.Memory,count:number):RenderCommandBufferView["spriteNormalMaterials"] {
  const e=engine as Engine & Partial<NormalExports>;
  if(names.every(name=>e[name]===undefined))return undefined;
  if(!supportsSpriteNormals(engine)||engine.sprite_normal_material_abi_version()!==1||engine.sprite_normal_material_size()!==8||engine.sprite_normal_material_len()!==count)
    throw Error("Unsupported or misaligned sprite normal material ABI");
  const ptr=engine.sprite_normal_material_ptr();
  if(!Number.isSafeInteger(count)||count<0||!Number.isSafeInteger(ptr)||ptr<0||ptr%4||ptr+count*8>memory.buffer.byteLength)
    throw Error("Sprite normal material buffer is outside Wasm memory");
  const buffer=new Uint32Array(memory.buffer,ptr,count*2);let active=false;
  for(let i=0;i<buffer.length;i+=2){if(buffer[i]>SPRITE_NORMAL_NONE||buffer[i+1]!==0)throw Error("Invalid sprite normal material record");active ||= buffer[i]!==SPRITE_NORMAL_NONE;}
  // Preserve the legacy view shape and owned color-only snapshots when no normal is visible.
  return active?{version:1,stride:2,buffer}:undefined;
}
export function configureSpriteNormals(engine:Engine,updates:readonly {entity:GameplayEntityHandle;normalTextureId?:number}[]):boolean {
  if(!supportsSpriteNormals(engine)||updates.length>MAX_SPRITE_NORMAL_UPDATES)return false;
  const records=new Uint32Array(updates.length*4),seen=new Set<number>();
  for(const [i,update] of updates.entries()) {
    const {entityId,entityGeneration}=update.entity,normal=update.normalTextureId??SPRITE_NORMAL_NONE;
    if(![entityId,entityGeneration,normal].every(Number.isSafeInteger)||entityId<0||entityId>0xffffffff||entityGeneration<0||entityGeneration>0xffffffff||normal<0||normal>SPRITE_NORMAL_NONE||seen.has(entityId))return false;
    seen.add(entityId);records.set([entityId,entityGeneration,normal,0],i*4);
  }
  return engine.configure_sprite_normal_materials(records);
}
/** Validate sidecar once before drawing; missing records mean the legacy unlit path. */
export function spriteNormalsActive(commands:RenderCommandBufferView):boolean {
  const sidecar=commands.spriteNormalMaterials;if(!sidecar)return false;
  if(sidecar.version!==1||sidecar.stride!==2||sidecar.buffer.length!==commands.commandCount*2)throw Error("Invalid sprite normal material sidecar");
  let active=false;
  for(let i=0;i<sidecar.buffer.length;i+=2){if(sidecar.buffer[i]>SPRITE_NORMAL_NONE||sidecar.buffer[i+1]!==0)throw Error("Invalid sprite normal material record");active ||= sidecar.buffer[i]!==SPRITE_NORMAL_NONE;}
  return active;
}
