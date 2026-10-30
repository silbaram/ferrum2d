import { test } from "node:test";
import { deepEqual, equal, throws } from "node:assert/strict";
import { MODEL_INSTANCE_BUFFER_BYTES, WebGL2SpatialModels } from "../src/webgl2SpatialModels.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
import { createSpatialModelAsset, type SpatialModelResource } from "../src/spatialModel.js";
import type { SpatialRendererStats } from "../src/webgl2SpatialPass.js";

type Frame = NonNullable<SpatialRenderBufferView["models"]>;
function asset():SpatialModelResource {
  return {contentId:"a".repeat(64),bounds:[0,0,0,1,1,0],diagnostics:[],images:[{width:1,height:1,pixels:new Uint8ClampedArray([255,255,255,255])}],
    primitives:[{vertices:Float32Array.from([0,0,0,0,0,0,0,1,1,0,0,1,0,0,0,1,0,1,0,0,1,0,0,1]),indices:Uint32Array.from([0,1,2]),color:[1,1,1,1],sampler:[9728,9728,10497,10497],image:0,alphaCutoff:0,doubleSided:false,emissiveFactor:[0,0,0]}]};
}
function frame(source=asset(),count=1):Frame {
  const values=new Float32Array(20*count),words=new Uint32Array(values.buffer);
  for(let i=0;i<count;i++){words.set([1,3,1,0],i*20);values.set([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],i*20+4);}
  return {version:1,stride:20,values,words,assets:new Map([[1,createSpatialModelAsset(source)]])};
}
function counters():SpatialRendererStats {
  // Resource preparation only touches these two counters; draw counters belong to the enclosing pass.
  return {modelUploadBytes:0,uploadBytes:0} as SpatialRendererStats;
}
function backend() {
  const names=["UNPACK_ALIGNMENT","UNPACK_FLIP_Y_WEBGL","UNPACK_PREMULTIPLY_ALPHA_WEBGL","PIXEL_UNPACK_BUFFER_BINDING","PIXEL_UNPACK_BUFFER",
    "UNPACK_ROW_LENGTH","UNPACK_IMAGE_HEIGHT","UNPACK_SKIP_PIXELS","UNPACK_SKIP_ROWS","UNPACK_SKIP_IMAGES","TEXTURE0","TEXTURE_2D","SRGB8_ALPHA8","RGBA8","RGBA","UNSIGNED_BYTE",
    "ARRAY_BUFFER_BINDING","ELEMENT_ARRAY_BUFFER_BINDING","ACTIVE_TEXTURE","TEXTURE_BINDING_2D","ARRAY_BUFFER","ELEMENT_ARRAY_BUFFER","STATIC_DRAW","TEXTURE_MIN_FILTER","TEXTURE_MAG_FILTER","TEXTURE_WRAP_S","TEXTURE_WRAP_T"];
  const constants=Object.fromEntries(names.map((name,i)=>[name,i+1]));
  const state=new Map<number,unknown>(),buffers=new Set<object>(),textures=new Set<object>(),samplers=new Set<object>();
  const originalPbo={external:true};state.set(constants.PIXEL_UNPACK_BUFFER_BINDING,originalPbo);
  const rows=names.filter(n=>n.startsWith("UNPACK_"));rows.forEach((name,i)=>state.set(constants[name],i+1));
  let error=0, nextError=0, failure="",uploads=0,samplerAttempts=0,textureAttempts=0;
  state.set(constants.ARRAY_BUFFER_BINDING,{externalBuffer:true});
  state.set(constants.ELEMENT_ARRAY_BUFFER_BINDING,{externalIndex:true});
  state.set(constants.ACTIVE_TEXTURE,constants.TEXTURE0);
  state.set(constants.TEXTURE_BINDING_2D,{externalTexture:true});
  const formats:number[]=[];
  const create=(set:Set<object>)=>{const value={};set.add(value);return value;};
  const context={...constants,NO_ERROR:0,
    getParameter:(p:number)=>state.get(p),pixelStorei:(p:number,v:number)=>state.set(p,v),
    bindBuffer:(target:number,value:object|null)=>{if(target===constants.PIXEL_UNPACK_BUFFER)state.set(constants.PIXEL_UNPACK_BUFFER_BINDING,value);if(target===constants.ARRAY_BUFFER)state.set(constants.ARRAY_BUFFER_BINDING,value);if(target===constants.ELEMENT_ARRAY_BUFFER)state.set(constants.ELEMENT_ARRAY_BUFFER_BINDING,value);},
    activeTexture:(unit:number)=>state.set(constants.ACTIVE_TEXTURE,unit),bindTexture:(_target:number,value:object|null)=>state.set(constants.TEXTURE_BINDING_2D,value),samplerParameteri:()=>{},
    createTexture:()=>{textureAttempts++;if(failure==="texture-allocation"||failure===`texture-allocation${textureAttempts}`){error=1285;return null;}return create(textures);},deleteTexture:(value:object)=>textures.delete(value),
    createBuffer:()=>{if(failure==="buffer-allocation"&&buffers.size===1){error=1285;return null;}return create(buffers);},deleteBuffer:(value:object)=>buffers.delete(value),
    createSampler:()=>{samplerAttempts++;if(failure==="sampler" || failure===`sampler${samplerAttempts}`){error=1285;return null;}return create(samplers);},deleteSampler:(value:object)=>samplers.delete(value),
    texImage2D:(_target:number,_level:number,format:number)=>{
      formats.push(format);
      equal(state.get(constants.PIXEL_UNPACK_BUFFER_BINDING),null);
      for(const name of ["UNPACK_ROW_LENGTH","UNPACK_IMAGE_HEIGHT","UNPACK_SKIP_PIXELS","UNPACK_SKIP_ROWS","UNPACK_SKIP_IMAGES"])equal(state.get(constants[name]),0);
      uploads++;if(failure==="texture")error=1285;
    },generateMipmap:()=>{if(failure==="texture")nextError=1282;},bufferData:()=>{if(failure==="buffer")error=1285;},
    getError:()=>{const value=error;error=nextError;nextError=0;return value;},isContextLost:()=>false,
  };
  // The fake implements precisely the allocation/pixel-transfer boundary exercised by prepare.
  return {gl:context as unknown as WebGL2RenderingContext,state,original:new Map(state),buffers,textures,samplers,
    formats,fail:(phase:string)=>{failure=phase;samplerAttempts=0;textureAttempts=0;},uploads:()=>uploads};
}
test("model uploads isolate unpack/PBO state and reuse shared GPU resources",()=>{
  const b=backend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(),stats=counters();
  pass.validate(packet);pass.prepare(packet,stats);
  deepEqual(b.state,b.original);equal(b.uploads(),1);equal(stats.modelUploadBytes,112);
  deepEqual(pass.resources(),{buffers:2,bytes:108,textures:1,textureBytes:4});
  pass.prepare(packet,stats);equal(b.uploads(),1);equal(stats.modelUploadBytes,112);
  pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
});
test("model texture/buffer/storage allocation failures clear staging and allow a clean retry",()=>{
  for(const phase of ["texture","buffer","sampler","texture-allocation","buffer-allocation"]) {
    const b=backend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(),stats=counters();
    b.fail(phase);throws(()=>pass.prepare(packet,stats),/Model .*failed/);
    deepEqual(b.state,b.original);equal(b.buffers.size+b.textures.size+b.samplers.size,0);
    equal(pass.resources().buffers,0);equal(stats.modelUploadBytes,0);
    equal(b.gl.getError(),b.gl.NO_ERROR);
    b.fail("");pass.prepare(packet,stats);equal(stats.modelUploadBytes,112);
    pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
  }
});
test("model packet types and actual primitive/triangle budgets are checked before GPU work",()=>{
  const pass=new WebGL2SpatialModels({} as WebGL2RenderingContext),source=asset();
  throws(()=>pass.validate({...frame(),words:[1,3,1,0]} as never),/Invalid spatial model/);
  for(const cutoff of [NaN,-1,Infinity,1e-50,1+1e-8])throws(()=>pass.validate(frame({...source,primitives:[{...source.primitives[0],alphaCutoff:cutoff}]})),/alpha\/cull/);
  const many={...source,primitives:Array.from({length:32},()=>source.primitives[0])};
  pass.validate(frame(many,128));throws(()=>pass.validate(frame(many,129)),/submission budget/);
  const large={...source,primitives:[{...source.primitives[0],indices:new Uint32Array(196608)}]};
  pass.validate(frame(large,4));throws(()=>pass.validate(frame(large,5)),/submission budget/);
});

test("model textures share color roles and isolate normal data from sRGB GPU decoding",()=>{
    const source=asset(),base=source.primitives[0],sampler=base.sampler;
    const resource={...source,primitives:[{...base,vertices:new Float32Array(36),normal:{image:0,sampler,scale:1},emissive:{image:0,sampler},emissiveFactor:[1,.5,.25]}]};
    const b=backend(),pass=new WebGL2SpatialModels(b.gl),stats=counters(),packet=frame(resource);
    pass.validate(packet);pass.prepare(packet,stats);
    equal(b.uploads(),2);equal(b.samplers.size,3);
    deepEqual(b.formats,[b.gl.SRGB8_ALPHA8,b.gl.RGBA8]);
    equal(stats.modelUploadBytes,164);equal(pass.resources().textureBytes,8);
    pass.prepare(packet,stats);equal(b.uploads(),2);
    pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
});

test("multi-map sampler failures release previously staged images/buffers/samplers before retry",()=>{
  const source=asset(),base=source.primitives[0],sampler=base.sampler;
  const resource={...source,primitives:[{...base,vertices:new Float32Array(36),normal:{image:0,sampler,scale:1},emissive:{image:0,sampler}}]};
  for(const phase of ["sampler2","sampler3"]) {
    const b=backend(),pass=new WebGL2SpatialModels(b.gl),stats=counters(),packet=frame(resource);
    b.fail(phase);throws(()=>pass.prepare(packet,stats),/sampler allocation failed/);
    equal(b.buffers.size+b.textures.size+b.samplers.size,0);equal(stats.modelUploadBytes,0);deepEqual(b.state,b.original);
    b.fail("");pass.prepare(packet,stats);equal(b.samplers.size,3);pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
  }
});


function multiFrame(sources: SpatialModelResource[]): Frame {
  const packet=frame(sources[0],sources.length);
  packet.assets=new Map(sources.map((source,i)=>[i+1,createSpatialModelAsset(source)]));
  for(let i=0;i<sources.length;i++)packet.words[i*20]=i+1;
  return packet;
}

test("failed multi-asset replacement preserves old resources and rolls back every new upload",()=>{
  for(const staged of [false,true]) {
    const b=backend(),pass=new WebGL2SpatialModels(b.gl),old=asset(),next=[asset(),asset()];
    pass.prepare(frame(old),counters());const before=pass.resources();
    b.fail("texture-allocation2");const stats=counters();
    throws(()=>staged?pass.stage(next):pass.prepare(multiFrame(next),stats),/allocation failed/);
    deepEqual(pass.resources(),before);equal(b.buffers.size,2);equal(b.textures.size,1);equal(b.samplers.size,1);
    equal(stats.modelUploadBytes,0);deepEqual(b.state,b.original);equal(b.gl.getError(),b.gl.NO_ERROR);
    b.fail("");const warm=counters();pass.prepare(frame(old),warm);equal(warm.modelUploadBytes,0);
    const ready=pass.stage(next);equal(ready.uploadBytes,224);ready.commit();ready.dispose();
    equal(pass.resources().buffers,4);const activated=counters();pass.prepare(multiFrame(next),activated);equal(activated.modelUploadBytes,0);
    pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
  }
});

test("pending model preparation survives old frames, rejects overlapping leases, and disposes idempotently",()=>{
  const b=backend(),pass=new WebGL2SpatialModels(b.gl),old=asset(),next=asset();
  pass.prepare(frame(old),counters());const before=pass.resources();
  const ready=pass.stage([old,next]);equal(ready.uploadBytes,112);equal(pass.resources().buffers,4);
  throws(()=>pass.stage([next]),/already pending/);
  pass.clear();equal(pass.resources().buffers,4);
  pass.prepare(frame(old),counters());equal(pass.resources().buffers,4);
  ready.dispose();ready.dispose();deepEqual(pass.resources(),before);deepEqual(b.state,b.original);
  throws(()=>ready.commit(),/no longer pending/);
  pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
});

test("prepared resources share immutable source identity across native IDs and become warm on activation",()=>{
  const b=backend(),pass=new WebGL2SpatialModels(b.gl),source=asset();
  const ready=pass.stage([source,source]);equal(ready.uploadBytes,112);equal(pass.resources().buffers,2);
  ready.commit();const stats=counters();pass.prepare(multiFrame([source,source]),stats);
  equal(stats.modelUploadBytes,0);equal(pass.resources().buffers,2);
  pass.clear();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
  const pending=pass.stage([source]);pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
  throws(()=>pending.commit(),/destroyed/);pending.dispose();pending.dispose();
  throws(()=>pass.stage([source]),/destroyed/);
});

test("public model frame assets expose opaque immutable handles and reject forged copies",()=>{
  const b=backend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(),handle=packet.assets.get(1)!;
  equal(Object.prototype.hasOwnProperty.call(handle,"primitives"),false);
  equal(Object.prototype.hasOwnProperty.call(handle,"images"),false);
  equal(Object.isFrozen(handle),true); equal(Object.isFrozen(handle.bounds),true);
  pass.validate(packet);
  const forged={...packet,assets:new Map([[1,{...handle}]])};
  throws(()=>pass.validate(forged), /opaque spatial model asset/);
  equal(b.buffers.size+b.textures.size+b.samplers.size,0);
});

function drawingBackend() {
  const b=backend(),calls:{count:number;matrices:number[];instanced:boolean;receive:number}[]=[],divisors=new Map<number,number>(),enabled=new Set<number>();
  let uploaded:number[]=[],instanced=false,receive=0,matrix:number[]=[],matrixOffset=0;
  const uploads:{offset:number;bytes:number}[]=[],pointers:number[]=[],modelColors:number[][]=[],modelCutoffs:number[]=[];
  Object.assign(b.gl,{
    uniform1i:(u:unknown,value:number)=>{if(u==="instanced")instanced=!!value;if(u==="receive")receive=value;},
    uniformMatrix3fv:()=>{},
    uniformMatrix4fv:(_u:unknown,_transpose:boolean,value:Float32Array)=>{matrix=Array.from(value);},
    bufferSubData:(_target:number,offset:number,value:Float32Array)=>{uploaded=Array.from(value);uploads.push({offset,bytes:value.byteLength});},
    enableVertexAttribArray:(at:number)=>enabled.add(at),disableVertexAttribArray:(at:number)=>enabled.delete(at),
    vertexAttribDivisor:(at:number,value:number)=>divisors.set(at,value),vertexAttribPointer:(at:number,_size:number,_type:number,_normalized:boolean,_stride:number,offset:number)=>{if(at===6){matrixOffset=offset;pointers.push(offset);}},
    vertexAttrib4fv:()=>{throw Error("Model draw changed generic vertex attributes");},vertexAttrib1f:()=>{throw Error("Model draw changed generic vertex attributes");},
    uniform4fv:(_u:unknown,value:readonly number[])=>modelColors.push(Array.from(value)),uniform1f:(_u:unknown,value:number)=>modelCutoffs.push(value),
    bindSampler:()=>{},disable:()=>{},enable:()=>{},cullFace:()=>{},frontFace:()=>{},
    drawElements:()=>calls.push({count:1,matrices:matrix,instanced,receive}),
    drawElementsInstanced:(_mode:number,_indices:number,_type:number,_offset:number,count:number)=>calls.push({count,matrices:uploaded.slice(matrixOffset/4,matrixOffset/4+count*16),instanced,receive}),
  });
  return {...b,calls,divisors,enabled,uploads,pointers,modelColors,modelCutoffs};
}
const drawUniforms={model:"model",mesh:"mesh",instanced:"instanced",modelColor:"modelColor",modelCutoff:"modelCutoff",textured:"textured",flip:"flip"} as never;
function drawCounters():SpatialRendererStats {
  return {modelUploadBytes:0,modelInstanceUploadBytes:0,modelInstancedDrawCalls:0,uploadBytes:0,visibleModelCount:0,drawCalls:0,textureBindCount:0,modelDrawCalls:0,modelTriangleCount:0,triangleCount:0,shadowTriangleCount:0} as SpatialRendererStats;
}
test("100/500/1000 shared models keep one geometry allocation and one instanced draw",()=>{
  const b=drawingBackend(),pass=new WebGL2SpatialModels(b.gl),resource=asset(),instanceBuffer={} as WebGLBuffer;
  for(const count of [100,500,1000]) {
    const packet=frame(resource,count),stats=drawCounters();
    for(let i=0;i<count;i++){
      const scale=i%2?.75:1.25;packet.values.set([0,0,-scale,0,0,scale,0,0,scale,0,0,0,i*.25,i%7,-i*.5,1],i*20+4);
    }
    pass.validate(packet);pass.prepare(packet,stats);b.calls.length=0;b.uploads.length=0;
    pass.prepareDraws(packet,1,instanceBuffer,stats);
    pass.draw(packet,0,drawUniforms,stats,instanceBuffer);
    equal(b.calls.length,1);equal(b.calls[0].count,count);equal(b.calls[0].instanced,true);
    deepEqual(b.uploads,[{offset:0,bytes:count*64}]);
    for(let i=0;i<count;i++)deepEqual(b.calls[0].matrices.slice(i*16,i*16+16),Array.from(packet.values.subarray(i*20+4,i*20+20)));
    equal(stats.visibleModelCount,count);equal(stats.modelTriangleCount,count);equal(stats.modelDrawCalls,1);equal(stats.modelInstancedDrawCalls,1);
    equal(stats.modelInstanceUploadBytes,count*64);equal(stats.modelUploadBytes,count===100?112:0);
    equal(stats.uploadBytes,count*64+stats.modelUploadBytes);equal(pass.resources().buffers,2);
    for(let at=6;at<10;at++){equal(b.divisors.get(at),0);equal(b.enabled.has(at),false);}
    equal(b.state.get(b.gl.ELEMENT_ARRAY_BUFFER_BINDING),null);
  }
  pass.destroy();equal(b.buffers.size+b.textures.size+b.samplers.size,0);
});
test("model main and shadow colors/cutouts use uniforms without changing generic attributes",()=>{
  const b=drawingBackend(),pass=new WebGL2SpatialModels(b.gl),source=asset();
  const packet=frame({...source,primitives:[{...source.primitives[0],color:[.25,.5,.75,1],alphaCutoff:.5}]},2),stats=drawCounters(),instanceBuffer={} as WebGLBuffer;
  packet.words[2]=packet.words[22]=129;
  pass.prepare(packet,stats);pass.prepareDraws(packet,129,instanceBuffer,stats);
  pass.draw(packet,0,drawUniforms,stats,instanceBuffer);pass.draw(packet,7,drawUniforms,stats,instanceBuffer);
  deepEqual(b.modelColors,[[.25,.5,.75,1],[.25,.5,.75,1]]);deepEqual(b.modelCutoffs,[.5,.5]);
  equal(b.enabled.has(2),false);equal(b.enabled.has(3),false);
  pass.destroy();
});
test("instancing respects native masks, receive flags and visible resource order in main/shadows",()=>{
  const b=drawingBackend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(asset(),7),other=asset();
  packet.assets=new Map([...packet.assets,[2,createSpatialModelAsset(other)]]);
  // Visible order: shared, shared (one culled gap), receive=false singleton, other, shared.
  packet.words[2*20+2]=0;packet.words[3*20+1]=1;packet.words[4*20]=2;
  packet.words[6*20+2]=128; // sun-only
  for(let i=0;i<7;i++)packet.values[i*20+16]=i;
  pass.prepare(packet,drawCounters());
  const stats=drawCounters();pass.prepareDraws(packet,1,{} as WebGLBuffer,stats);pass.draw(packet,0,drawUniforms,stats,{} as WebGLBuffer,"receive" as never);
  deepEqual(b.calls.map(c=>[c.count,c.receive,c.matrices[12]]),[[2,1,0],[1,0,3],[1,1,4],[1,1,5]]);
  equal(stats.visibleModelCount,5);equal(stats.modelTriangleCount,5);equal(stats.modelInstanceUploadBytes,128);
  b.calls.length=0;const sun=drawCounters();pass.prepareDraws(packet,128,{} as WebGLBuffer,sun);pass.draw(packet,7,drawUniforms,sun,{} as WebGLBuffer);
  equal(b.calls.length,1);equal(b.calls[0].count,1);equal(b.calls[0].matrices[12],6);equal(sun.shadowTriangleCount,1);equal(sun.modelInstanceUploadBytes,0);
  b.calls.length=0;for(let i=0;i<7;i++)packet.words[i*20+2]=2;
  const point=drawCounters();pass.prepareDraws(packet,2,{} as WebGLBuffer,point);pass.draw(packet,1,drawUniforms,point,{} as WebGLBuffer);
  deepEqual(b.calls.map(c=>c.count),[4,1,2]);equal(point.shadowTriangleCount,7);equal(point.modelInstanceUploadBytes,6*64);
  pass.destroy();
});

test("one packed upload keeps main/point/sun batches in independent ranges and native order",()=>{
  const b=drawingBackend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(asset(),10),stats=drawCounters();
  packet.assets=new Map([...packet.assets,[2,createSpatialModelAsset(asset())]]);
  const masks=[255,131,65,255,2,255,128,255,255,0];
  for(let i=0;i<10;i++){
    packet.words[i*20+2]=masks[i];
    if(i===4||i===8)packet.words[i*20]=2;
    if(i===2||i===6)packet.words[i*20+1]=1;
    packet.values.set([i*1.25,i+3,-i],i*20+16);
  }
  pass.prepare(packet,stats);
  pass.prepareDraws(packet,255,{} as WebGLBuffer,stats);
  equal(b.uploads.length,1);
  let expectedBytes=0,mainBytes=0;
  for(const bit of [1,2,3,4,5,6,7,0]){
    const groups:number[][]=[];
    for(let i=0;i<10;i++){
      if(!(masks[i]&(1<<bit)))continue;
      const previous=groups[groups.length-1],first=previous?.[0];
      if(first!==undefined&&packet.words[first*20]===packet.words[i*20]&&(bit!==0||(packet.words[first*20+1]&2)===(packet.words[i*20+1]&2)))previous!.push(i);
      else groups.push([i]);
    }
    b.calls.length=0;
    pass.draw(packet,bit,drawUniforms,stats,{} as WebGLBuffer,bit===0?"receive" as never:undefined);
    equal(b.calls.length,groups.length);
    for(let i=0;i<groups.length;i++){
      const group=groups[i],call=b.calls[i];
      equal(call.count,group.length);equal(call.instanced,group.length>1);
      for(let j=0;j<group.length;j++)deepEqual(call.matrices.slice(j*16,j*16+16),Array.from(packet.values.subarray(group[j]*20+4,group[j]*20+20)));
      if(group.length>1){expectedBytes+=group.length*64;if(bit===0)mainBytes+=group.length*64;}
    }
    equal(b.uploads.length,1,"drawing must not overwrite an already submitted matrix range");
  }
  equal(stats.modelInstanceUploadBytes,expectedBytes);equal(b.uploads[0].bytes,expectedBytes);
  equal(new Set(b.pointers).size,b.pointers.length,"every instanced batch/face uses its own range");
  const warm=drawCounters();b.uploads.length=0;
  pass.prepareDraws(packet,1,{} as WebGLBuffer,warm);
  equal(warm.modelInstanceUploadBytes,mainBytes,"cached shadows must not prepare shadow matrices");
  equal(b.uploads.length,1);
  throws(()=>pass.draw(packet,1,drawUniforms,warm,{} as WebGLBuffer),/not prepared/);
  pass.finishDraws();throws(()=>pass.draw(packet,0,drawUniforms,warm,{} as WebGLBuffer),/not prepared/);
  pass.destroy();
});

test("maximum packet fits the fixed eight-pass capacity and singletons require no upload",()=>{
  const b=drawingBackend(),pass=new WebGL2SpatialModels(b.gl),packet=frame(asset(),1024),stats=drawCounters();
  for(let i=0;i<1024;i++){packet.words[i*20+2]=255;packet.values[i*20+16]=i;}
  pass.validate(packet);pass.prepare(packet,stats);pass.prepareDraws(packet,255,{} as WebGLBuffer,stats);
  equal(stats.modelInstanceUploadBytes,MODEL_INSTANCE_BUFFER_BYTES);
  deepEqual(b.uploads,[{offset:0,bytes:MODEL_INSTANCE_BUFFER_BYTES}]);
  for(let bit=0;bit<8;bit++)pass.draw(packet,bit,drawUniforms,stats,{} as WebGLBuffer);
  deepEqual(b.pointers,Array.from({length:8},(_,i)=>i*1024*64));
  for(const call of b.calls){equal(call.count,1024);equal(call.matrices.length,1024*16);equal(call.matrices[1023*16+12],1023);}
  const single=frame(asset()),warm=drawCounters();pass.prepare(single,warm);b.uploads.length=0;b.calls.length=0;
  pass.prepareDraws(single,1,{} as WebGLBuffer,warm);pass.draw(single,0,drawUniforms,warm,{} as WebGLBuffer);
  equal(b.uploads.length,0);equal(warm.modelInstanceUploadBytes,0);equal(b.calls[0].instanced,false);
  pass.destroy();
});

test("shared validation checks materials once per resource but budgets and matrices for every row",()=>{
  const pass=new WebGL2SpatialModels({} as WebGL2RenderingContext),source=asset(),base=source.primitives[0];
  let reads=0,cutoff=0;
  const primitive={...base,get alphaCutoff(){reads++;return cutoff;}};
  const shared={...source,primitives:Array(32).fill(primitive)};
  pass.validate(frame(shared));const once=reads;
  reads=0;const packet=frame(shared,128);pass.validate(packet);equal(reads,once);
  // A second opaque handle to the same resource must not repeat immutable material work.
  packet.assets=new Map([...packet.assets,[2,createSpatialModelAsset(shared)]]);packet.words[20]=2;
  reads=0;pass.validate(packet);equal(reads,once);
  throws(()=>pass.validate(frame(shared,129)),/submission budget/);
  packet.values[127*20+19]=NaN;
  throws(()=>pass.validate(packet),/Invalid model instance/);
  packet.values[127*20+19]=1;packet.words[127*20+1]=4;
  throws(()=>pass.validate(packet),/Invalid model instance/);
  packet.words[127*20+1]=3;packet.words[127*20+3]=1;
  throws(()=>pass.validate(packet),/Invalid model instance/);
  packet.words[127*20+3]=0;packet.words[127*20+2]=256;
  throws(()=>pass.validate(packet),/Invalid model instance/);
  packet.words[127*20+2]=1;cutoff=NaN;
  throws(()=>pass.validate(packet),/alpha\/cull/); // A new frame revalidates its resources.
});

test("direct model packets enforce used asset count/bytes before any GPU allocation",()=>{
  const pass=new WebGL2SpatialModels({} as WebGL2RenderingContext);
  pass.validate(multiFrame(Array.from({length:16},()=>asset())));
  throws(()=>pass.validate(multiFrame(Array.from({length:17},()=>asset()))),/resource budget/);
  const pixels=new Uint8ClampedArray(2048*2048*4),images=[{width:2048,height:2048,pixels},{width:2048,height:2048,pixels}];
  pass.validate(multiFrame(Array.from({length:3},()=>({...asset(),images}))));
  throws(()=>pass.validate(multiFrame(Array.from({length:4},()=>({...asset(),images})))),/resource budget/);
  // Unused handles cannot allocate GPU data; numeric aliases of one CPU resource share the limit.
  const shared=asset(),packet=multiFrame(Array(32).fill(shared));pass.validate(packet);
  packet.assets=new Map([...packet.assets,...Array.from({length:32},(_,i)=>[i+100,createSpatialModelAsset(asset())] as const)]);
  pass.validate(packet);
});
