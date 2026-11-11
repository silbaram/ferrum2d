import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import type { Engine } from "../pkg/ferrum_core.js";
import { configureSpriteSurface, readSpriteSurface, resolveSpriteSurfaceMaterial, supportsSpriteSurface, validateSpriteSurface, SPRITE_SURFACE_TEXTURE_NONE as NONE } from "../src/spriteSurface.js";
import { snapshotRenderFrameBuffers } from "../src/frameBufferSnapshot.js";
import type { SpriteLightingBufferView } from "../src/spriteLighting.js";
import { expandLitSpriteCommands } from "../src/spriteLighting.js";
import { configureSpriteLighting, readSpriteLighting } from "../src/spriteLighting.js";
import { readFile } from "node:fs/promises";
import { WebGpuSpriteSurfaceTextures } from "../src/webgpuSpriteSurface.js";

function setup() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const words = new Uint32Array(memory.buffer, 512, 10), values = new Float32Array(memory.buffer, 512, 10);
  words.set([NONE, NONE, NONE, 1]);values.set([4, 2, 1, .5, .3], 4);
  const receiver = new Uint32Array([1, 0]);
  const lighting: SpriteLightingBufferView = { version: 1, stride: 2, words: receiver, values: new Float32Array(receiver.buffer) };
  let captured: Uint32Array | undefined;
  const native = {
    sprite_surface_material_abi_version: () => 1,
    sprite_surface_material_size: () => 40,
    sprite_surface_material_ptr: () => 512,
    sprite_surface_material_len: () => 1,
    configure_sprite_surface_materials: (records: Uint32Array) => { captured = records.slice();return true; },
  };
  const read = () => readSpriteSurface(native as unknown as Engine, memory, 1, lighting)!;
  return { memory, words, values, lighting, native, read, captured: () => captured! };
}
test("surface factors preserve explicit zeros and reject invalid values/IDs before native writes", () => {
  deepEqual(resolveSpriteSurfaceMaterial({ emission: [0, 2, 64], specular: 0, roughness: 0, emissionTextureId: 0 }, "surface"), { emission: [0, 2, 64], specular: 0, roughness: 0, emissionTextureId: 0 });
  for (const value of [null, [], { unknown: 1 }, { emission: [1, 2] }, { emission: [1, null, 1] }, { emission: new Array(3) },
    { emission: [1, 2, 65] }, { emission: [1, 2, NaN] }, { emission: null }, { specular: null }, { specular: -1 }, { roughness: Infinity },
    { roughness: "1" }, { roughness: 1.1 }, { emissionTextureId: NONE }, { specularTextureId: -1 }, { roughnessTextureId: .5 }])
    throws(() => resolveSpriteSurfaceMaterial(value, "surface"), /surface/);
  const b = setup(), entity = { entityId: 7, entityGeneration: 2 };
  equal(configureSpriteSurface(b.native as unknown as Engine, [{ entity, surface: { specular: NaN } }]), false);
  equal(b.captured(), undefined);
});
test("surface bulk encoding keeps integer texture IDs and f32 factors with canonical detach records", () => {
  const b = setup(), entity = { entityId: 7, entityGeneration: 2 };
  ok(configureSpriteSurface(b.native as unknown as Engine, [{ entity, surface: { emission: [4, 2, 1], emissionTextureId: 0, specularTextureId: 42, specular: .5, roughness: .3 } }]));
  const words = b.captured(), values = new Float32Array(words.buffer);
  deepEqual([...words.subarray(0, 6)], [7, 2, 0, 42, NONE, 1]);
  deepEqual([...values.subarray(6, 11)], [...Float32Array.from([4, 2, 1, .5, .3])]);equal(words[11], 0);
  ok(configureSpriteSurface(b.native as unknown as Engine, [{ entity }]));
  deepEqual([...b.captured()], [7, 2, NONE, NONE, NONE, 0, 0, 0, 0, 0, 1065353216, 0]);
  equal(configureSpriteSurface(b.native as unknown as Engine, [{ entity }, { entity }]), false);
  equal(configureSpriteSurface(b.native as unknown as Engine, [{ entity: { entityId: -1, entityGeneration: 0 } }]), false);
});
test("surface ABI rejects partial/unsupported native and invalid pointer/count before exposing aliases", () => {
  const b = setup();equal(supportsSpriteSurface({} as Engine), false);equal(readSpriteSurface({} as Engine, b.memory, 1), undefined);
  for (const change of [{ sprite_surface_material_size: undefined }, { sprite_surface_material_abi_version: () => 2 }, { sprite_surface_material_size: () => 36 }])
    throws(() => readSpriteSurface({ ...b.native, ...change } as unknown as Engine, b.memory, 1, b.lighting), /Unsupported/);
  for (const ptr of [-1, 2, b.memory.buffer.byteLength - 36])
    throws(() => readSpriteSurface({ ...b.native, sprite_surface_material_ptr: () => ptr } as unknown as Engine, b.memory, 1, b.lighting), /Misaligned/);
  throws(() => readSpriteSurface(b.native as unknown as Engine, b.memory, 2, b.lighting), /Misaligned/);
  const view = b.read();equal(view.words.buffer, view.values.buffer);equal(view.words.byteOffset, view.values.byteOffset);
  equal(view.values[4], 4);equal(view.words[0], NONE);
});
test("surface packets validate both aliases, disabled canonical records, receiver mode and value bounds", () => {
  const b = setup(), valid = b.words.slice(), view = b.read();
  const commands = { commandCount: 1, spriteSurfaceMaterials: view, spriteLightingMaterials: b.lighting };
  ok(validateSpriteSurface(commands));
  for (const [index, bits] of [[0, NONE + 1], [3, 2], [9, 1], [4, 0x7fc00000], [5, 0x42820000], [7, 0x40000000], [8, 0xbf800000]]) {
    b.words.set(valid);b.words[index] = bits;throws(() => validateSpriteSurface(commands), /record/);
  }
  b.words.set(valid);throws(() => validateSpriteSurface({ ...commands, spriteLightingMaterials: undefined }), /opaque/);
  b.lighting.words[0] = 0;throws(() => validateSpriteSurface(commands), /opaque/);b.lighting.words[0] = 1;
  throws(() => validateSpriteSurface({ ...commands, spriteSurfaceMaterials: { ...view, values: view.values.slice() } }), /sidecar/);
  throws(() => validateSpriteSurface({ ...commands, spriteSurfaceMaterials: { ...view, version: 2 } as never }), /sidecar/);
  b.words.fill(0);b.words.set([NONE, NONE, NONE]);b.values[8] = 1;
  equal(validateSpriteSurface(commands), false);b.values[4] = 1;throws(() => validateSpriteSurface(commands), /Noncanonical/);
  b.values[4]=0;b.words[3]=1;equal(validateSpriteSurface(commands),false);
});
test("generated Wasm exposes the same surface ABI and clears sorted metadata while retaining native state",async()=>{
  const core=await import("../pkg/ferrum_core.js");
  const wasm=core.initSync({module:await readFile(new URL("../pkg/ferrum_core_bg.wasm",import.meta.url))});
  const engine=new core.Engine();
  try{
    engine.use_data_scene();engine.set_viewport_size(100,100);
    ok(engine.configure_data_scene_camera(20,20,0xffffffff,0,false,0,0,0,0,0));
    ok(engine.spawn_data_scene_entity(20,20,0,0,7,32,64,0,0,1,1,0,0,0,1,0,0,true,true,8,8,0,0,0,0,0,0,new Float32Array()));
    const entity={entityId:engine.data_scene_entity_id(),entityGeneration:engine.data_scene_entity_generation()};
    ok(supportsSpriteSurface(engine));ok(configureSpriteLighting(engine,[{entity,lighting:{mode:"cutout",alphaCutoff:.5}}]));
    ok(configureSpriteSurface(engine,[{entity,surface:{emission:[4,2,1],specular:.5,roughness:.3}}]));
    engine.update(0);equal(engine.render_command_len(),1);
    const lighting=readSpriteLighting(engine,wasm.memory,1)!;
    const surface=readSpriteSurface(engine,wasm.memory,1,lighting)!;
    deepEqual([...surface.values.subarray(4,9)],[...Float32Array.from([4,2,1,.5,.3])]);
    equal(configureSpriteSurface(engine,[{entity:{...entity,entityGeneration:entity.entityGeneration+1},surface:{emission:[1,0,0]}}]),false);
    engine.update_frame(0,false,false,false);equal(engine.sprite_surface_material_len(),0);
    engine.update(0);equal(readSpriteSurface(engine,wasm.memory,1,readSpriteLighting(engine,wasm.memory,1))!.values[4],4);
    ok(configureSpriteLighting(engine,[{entity}]));engine.update(0);
    equal(readSpriteSurface(engine,wasm.memory,1),undefined);
  }finally{engine.free();}
});
test("surface borrowed views are reacquired after memory growth and deferred snapshots own both aliases", () => {
  const b = setup(), borrowed = b.read();
  const frame = snapshotRenderFrameBuffers({ renderCommandBuffer: { commandCount: 1, floatsPerCommand: 15, buffer: new Float32Array(15), spriteSurfaceMaterials: borrowed, spriteLightingMaterials: b.lighting }, cameraX: 0, cameraY: 0 });
  b.memory.grow(1);equal(borrowed.words.length, 0);
  const next = b.read();equal(next.values[4], 4);
  const copy = frame.renderCommandBuffer.spriteSurfaceMaterials!;
  equal(copy.values[4], 4);equal(copy.words[0], NONE);equal(copy.words.buffer, copy.values.buffer);
  next.values[4] = 8;equal(copy.values[4], 4);
});
test("private surface staging expands backwards without changing native commands or mixing map roles",()=>{
  const b=setup();b.words.set([1,2,3]);
  const surface=b.read(),words=new Uint32Array(20),values=new Float32Array(words.buffer);
  words.set([NONE,NONE,NONE]);values[8]=1;words.set(surface.words,10);
  const data=new Float32Array(48);for(let i=0;i<30;i++)data[i]=i+1;
  const commands={commandCount:2,floatsPerCommand:15,buffer:data.slice(0,30),spriteSurfaceMaterials:{...surface,words,values}};
  const original=commands.buffer.slice();
  expandLitSpriteCommands(data,commands,0,2,{textureInfo:()=>({colorSpace:"srgb"}),textureFlipY:id=>id===2},false,true,true);
  deepEqual([...data.subarray(0,15)],[...original.subarray(0,15)]);deepEqual([...data.subarray(24,39)],[...original.subarray(15,30)]);
  deepEqual([...data.subarray(17,24)],[0,0,0,0,1,0,0]);
  deepEqual([...data.subarray(41,46)],[...Float32Array.from([4,2,1,.5,.3])]);
  equal(data[46],128+64+1+4+8+16);equal(data[47],0);deepEqual(commands.buffer,original);
  data.set(original);
  expandLitSpriteCommands(data,commands,0,2,{textureInfo:()=>({colorSpace:"srgb"})},true,true,true,true);
  equal(data[46],128+1+4+16); // Managed GL samples an sRGB texture; raw GPU views still decode in shader.
});
test("surface GPU groups reuse warm views and invalidate any replaced map without retaining old textures",()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,"GPUShaderStage");
  Object.defineProperty(globalThis,"GPUShaderStage",{value:{FRAGMENT:2},configurable:true});
  let created=0;
  const device={createBindGroupLayout:()=>({}),createBindGroup:(descriptor:unknown)=>({id:++created,descriptor})} as unknown as GPUDevice;
  try{
    const cache=new WebGpuSpriteSurfaceTextures(device),views=[{},{},{}] as GPUTextureView[];
    const first=cache.group(views[0],views[1],views[2]);equal(cache.group(views[0],views[1],views[2]),first);equal(created,1);
    for(let map=0;map<3;map++){const next=[...views];next[map]={} as GPUTextureView;const replacement=cache.group(next[0],next[1],next[2]);ok(replacement!==first);equal(cache.group(next[0],next[1],next[2]),replacement);}
    equal(created,4);cache.destroy();ok(cache.group(views[0],views[1],views[2])!==first);equal(created,5);
  }finally{if(previous)Object.defineProperty(globalThis,"GPUShaderStage",previous);else Reflect.deleteProperty(globalThis,"GPUShaderStage");}
});
