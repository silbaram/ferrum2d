import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { normalizeLightingScene } from "../src/lighting.js";
import { WebGL2LightingPass } from "../src/webgl2LightingPass.js";

class FakeWebGL2Context {
  readonly DEPTH_TEST = 0x0b71;
  readonly CULL_FACE = 0x0b44;
  readonly BLEND = 0x0be2;
  readonly SRC_ALPHA = 0x0302;
  readonly ONE_MINUS_SRC_ALPHA = 0x0303;
  readonly ONE = 1;
  readonly ARRAY_BUFFER = 0x8892;
  readonly DYNAMIC_DRAW = 0x88e8;
  readonly FLOAT = 0x1406;
  readonly TRIANGLES = 0x0004;
  readonly VERTEX_SHADER = 0x8b31;
  readonly FRAGMENT_SHADER = 0x8b30;
  readonly LINK_STATUS = 0x8b82;
  readonly COMPILE_STATUS = 0x8b81;

  readonly bufferDataCalls: Array<{ byteLength: number }> = [];
  readonly bufferSubDataCalls: Array<{ length: number; values: number[] }> = [];
  readonly drawArraysCalls: Array<{ mode: number; first: number; count: number }> = [];

  readonly FUNC_ADD=0x8006; readonly MAX=0x8008; readonly FRAMEBUFFER=0x8d40;
  readonly FRAMEBUFFER_COMPLETE=0x8cd5; readonly SCISSOR_TEST=0xc11; readonly COLOR_WRITEMASK=0xc23;
  readonly MAX_TEXTURE_SIZE=0xd33; readonly TEXTURE0=0x84c0; readonly TEXTURE3=0x84c3;
  textureCount=0; deletedTextures=0; framebufferCount=0; failFramebuffer=false;
  failUpload = false;
  failAllocation = false;
  readonly equations:number[]=[];
  blendEquation(value:number):void {this.equations.push(value);}
  uniform3f():void {}
  uniform2i():void {}
  activeTexture():void {}
  bindTexture():void {}
  texParameteri():void {}
  texImage2D():void {}
  framebufferTexture2D():void {}
  viewport():void {}
  colorMask():void {}
  clearBufferfv():void {}
  isEnabled():boolean{return false;}
  getParameter(name:number):unknown {return name===this.COLOR_WRITEMASK?[true,true,true,true]:8192;}
  createFramebuffer():WebGLFramebuffer {this.framebufferCount++;return {} as WebGLFramebuffer;}
  createTexture():WebGLTexture {this.textureCount++;return {} as WebGLTexture;}
  bindFramebuffer():void {}
  checkFramebufferStatus():number {return this.failFramebuffer?0:this.FRAMEBUFFER_COMPLETE;}
  deleteTexture():void {this.deletedTextures++;}
  deleteFramebuffer():void {}
  private nextId = 1;

  createProgram(): WebGLProgram {
    return { id: this.nextId++ } as unknown as WebGLProgram;
  }

  createShader(): WebGLShader {
    return { id: this.nextId++ } as unknown as WebGLShader;
  }

  shaderSource(): void {}

  compileShader(): void {}

  getShaderParameter(): boolean {
    return true;
  }

  getShaderInfoLog(): string | null {
    return null;
  }

  attachShader(): void {}

  linkProgram(): void {}

  getProgramParameter(): boolean {
    return true;
  }

  getProgramInfoLog(): string | null {
    return null;
  }

  deleteShader(): void {}

  createVertexArray(): WebGLVertexArrayObject {
    return { id: this.nextId++ } as unknown as WebGLVertexArrayObject;
  }

  createBuffer(): WebGLBuffer {
    return { id: this.nextId++ } as unknown as WebGLBuffer;
  }

  getUniformLocation(_program: WebGLProgram, name: string): WebGLUniformLocation {
    return { name } as unknown as WebGLUniformLocation;
  }

  bindVertexArray(): void {}

  bindBuffer(): void {}

  bufferData(_target: number, sizeOrData: number | ArrayBufferView, _usage: number): void {
    if (this.failAllocation) throw Error("injected shadow allocation failure");
    const byteLength = typeof sizeOrData === "number" ? sizeOrData : sizeOrData.byteLength;
    this.bufferDataCalls.push({ byteLength });
  }

  enableVertexAttribArray(): void {}

  vertexAttribPointer(): void {}

  disable(): void {}

  enable(): void {}

  blendFunc(): void {}

  useProgram(): void {}

  uniform2f(): void {}

  uniform4f(): void {}

  uniform1i(): void {}

  uniform1f(): void {}

  bufferSubData(
    _target: number,
    _dstByteOffset: number,
    srcData: Float32Array,
    srcOffset = 0,
    length?: number,
  ): void {
    if (this.failUpload) throw Error("injected shadow upload failure");
    const floatCount = length ?? srcData.length - srcOffset;
    this.bufferSubDataCalls.push({
      length: floatCount,
      values: Array.from(srcData.slice(srcOffset, srcOffset + floatCount)),
    });
  }

  drawArrays(mode: number, first: number, count: number): void {
    this.drawArraysCalls.push({ mode, first, count });
  }

  deleteBuffer(): void {}

  deleteVertexArray(): void {}

  deleteProgram(): void {}
}

test("WebGL2LightingPass batches tile occluder shadows per light", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 120 }],
    tileOccluders: [
      { x: 24, y: 24, width: 16, height: 16 },
      { x: 112, y: 24, width: 16, height: 16 },
    ],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });

  const stats = pass.draw(scene, [200, 120], undefined, target());

  deepEqual(stats, {
    drawCalls: 2,
    pointLightCount: 1,
    tileOccluderCount: 0,
    shadowDrawCalls: 1,
    shadowCasterCount: 2,
    shadowGeometryUploadBytes: 120,
    shadowGeometryVertexCount: 15,
    shadowGeometryCacheHit: false,
  });
  equal(gl.bufferSubDataCalls.length, 1);
  equal(gl.drawArraysCalls.length, 2);
  ok(gl.bufferSubDataCalls[0]!.length > 0);
  equal(gl.bufferSubDataCalls[0]!.length / 2, gl.drawArraysCalls[0]!.count);
});

test("WebGL2LightingPass keeps shadow draw and caster counts distinct across lights", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [
      { x: 80, y: 48, radius: 120 },
      { x: 160, y: 48, radius: 120 },
    ],
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });

  const stats = pass.draw(scene, [240, 120], undefined, target());

  equal(stats.shadowDrawCalls, 2);
  equal(stats.shadowCasterCount, 2);
  equal(gl.bufferSubDataCalls.length, 1);
  equal(gl.drawArraysCalls[2].first, gl.drawArraysCalls[0].count);
});

test("packed WebGL shadow geometry stays uploaded across lights and uniform-only edits, invalidates on geometry, and retries failed writes", () => {
  const gl = new FakeWebGL2Context(), pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({ pointLights: [{ x: 80, y: 48, radius: 120 }, { x: 160, y: 48, radius: 120 }],
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }], shadows: true });
  const draw = (s = scene) => pass.draw(s, [240, 120], undefined, target());
  const first = draw(); ok(first.shadowGeometryUploadBytes! > 0); equal(first.shadowDrawCalls, 2);
  const warm = draw(); equal(warm.shadowGeometryUploadBytes, 0); equal(warm.shadowGeometryCacheHit, true);
  equal(warm.shadowGeometryVertexCount, first.shadowGeometryVertexCount); equal(gl.bufferSubDataCalls.length, 1);
  const larger = normalizeLightingScene({ ...scene, pointLights: [...scene.pointLights, ...scene.pointLights] });
  gl.failUpload = true; throws(() => draw(larger), /injected/); gl.failUpload = false;
  ok(draw().shadowGeometryUploadBytes! > 0); equal(draw().shadowGeometryUploadBytes, 0);
  const tint = normalizeLightingScene({ ...scene, shadows: { ...scene.shadows, color: [.2, .1, .3, .25] } });
  equal(draw(tint).shadowGeometryUploadBytes, 0);
  const moved = normalizeLightingScene({ ...scene, pointLights: scene.pointLights.map((light, i) => ({ ...light, x: light.x + i + 1 })) });
  gl.failUpload = true; throws(() => draw(moved), /injected/); gl.failUpload = false;
  ok(draw(moved).shadowGeometryUploadBytes! > 0); equal(draw(moved).shadowGeometryUploadBytes, 0);
  const edited = normalizeLightingScene({ ...moved, tileOccluders: [{ ...scene.tileOccluders[0], x: 110 }] });
  ok(draw(edited).shadowGeometryUploadBytes! > 0);
  ok(draw(normalizeLightingScene({ ...edited, pointLights: [...edited.pointLights].reverse() })).shadowGeometryUploadBytes! > 0);
});

test("WebGL shadow cache retries capacity growth after a failed GPU allocation", () => {
  const gl = new FakeWebGL2Context(), pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const small = normalizeLightingScene({ pointLights: [{ x: 80, y: 48, radius: 120 }],
    tileOccluders: [{ x: 112, y: 24, width: 16, height: 16 }], shadows: true });
  const larger = normalizeLightingScene({ ...small, pointLights: Array.from({ length: 8 }, () => small.pointLights[0]) });
  const draw = (scene = small) => pass.draw(scene, [240, 120], undefined, target());
  draw();
  const allocations = gl.bufferDataCalls.length;
  gl.failAllocation = true; throws(() => draw(larger), /injected shadow allocation failure/); gl.failAllocation = false;
  equal(gl.bufferDataCalls.length, allocations);
  ok(draw(larger).shadowGeometryUploadBytes! > 0);
  equal(gl.bufferDataCalls.length, allocations + 1);
  equal(draw(larger).shadowGeometryUploadBytes, 0);
});

test("WebGL shadow cache falls back without losing lights above32 sources or2MiB packed coordinates", () => {
  for (const [count, casters] of [[33, 1], [32, 2048]]) {
    const gl = new FakeWebGL2Context(), pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
    const scene = normalizeLightingScene({ pointLights: Array.from({ length: count }, () => ({ x: 80, y: 48, radius: 200 })),
      tileOccluders: Array.from({ length: casters }, () => ({ x: 24, y: 24, width: 16, height: 16 })), shadows: true });
    const draw = () => pass.draw(scene, [240, 120], undefined, target());
    draw(); const warm = draw(); equal(warm.shadowDrawCalls, count); equal(warm.shadowGeometryCacheHit, false);
    ok(warm.shadowGeometryUploadBytes! > 0); equal(gl.bufferSubDataCalls.length, count * 2);
    if (casters > 1) ok(warm.shadowGeometryUploadBytes! > 2 * 1024 * 1024);
    ok(pass.resourceStats().bufferBytes <= 2 * 1024 * 1024);
    const small = normalizeLightingScene({ ...scene, pointLights: scene.pointLights.slice(0, 1), tileOccluders: scene.tileOccluders.slice(0, 1) });
    ok(pass.draw(small, [240, 120], undefined, target()).shadowGeometryUploadBytes! > 0);
    equal(pass.draw(small, [240, 120], undefined, target()).shadowGeometryUploadBytes, 0);
  }
});

test("WebGL2LightingPass skips culled shadow casters without uploads", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 0, y: 0, radius: 40 }],
    tileOccluders: [{ x: 180, y: 80, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 120, maxDistance: 32 },
  });

  const stats = pass.draw(scene, [240, 120], undefined, target());

  equal(stats.shadowDrawCalls, 0);
  equal(stats.shadowCasterCount, 0);
  equal(gl.bufferSubDataCalls.length, 0);
  equal(gl.drawArraysCalls.length, 1);
});

test("WebGL2LightingPass grows shadow buffer only when written shadow geometry exceeds capacity", () => {
  const gl = new FakeWebGL2Context();
  const pass = new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const smallScene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 140 }],
    tileOccluders: [{ x: 24, y: 24, width: 16, height: 16 }],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 180 },
  });
  const largeScene = normalizeLightingScene({
    ambient: [0, 0, 0, 0],
    pointLights: [{ x: 80, y: 48, radius: 160 }],
    tileOccluders: [
      { x: 16, y: 16, width: 16, height: 16 },
      { x: 48, y: 16, width: 16, height: 16 },
      { x: 112, y: 16, width: 16, height: 16 },
      { x: 144, y: 16, width: 16, height: 16 },
    ],
    shadows: { enabled: true, color: [0, 0, 0, 0.5], projectionLength: 220 },
  });

  equal(gl.bufferDataCalls.length, 1);
  pass.draw(smallScene, [240, 120], undefined, target());
  equal(gl.bufferDataCalls.length, 1);
  pass.draw(largeScene, [240, 120], undefined, target());
  equal(gl.bufferDataCalls.length, 2);
  const grownCapacityFloats =
    gl.bufferDataCalls[gl.bufferDataCalls.length - 1]!.byteLength / Float32Array.BYTES_PER_ELEMENT;
  const uploadedFloats = gl.bufferSubDataCalls[gl.bufferSubDataCalls.length - 1]!.length;
  ok(uploadedFloats > 0);
  ok(uploadedFloats < grownCapacityFloats);

  pass.draw(smallScene, [240, 120], undefined, target());
  equal(gl.bufferDataCalls.length, 2);
});

function target(width=240,height=120){return {width,height,restore(){}};}

test("WebGL2 masks reuse one R8 target, union with MAX, resize and release",()=>{
  const gl=new FakeWebGL2Context(),pass=new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene=normalizeLightingScene({pointLights:[{x:80,y:48,radius:120},{x:160,y:48,radius:120}],tileOccluders:[{x:112,y:24,width:16,height:16}],shadows:true});
  let restored=0;const output={...target(),restore(){restored++;}};
  pass.draw(scene,[240,120],undefined,output);
  equal(gl.textureCount,1);equal(restored,2);equal(gl.equations.filter(x=>x===gl.MAX).length,2);
  equal(gl.equations[gl.equations.length-1],gl.FUNC_ADD);equal(pass.resourceStats().textureBytes,240*120);
  pass.draw(scene,[240,120],undefined,output);equal(gl.textureCount,1);
  pass.draw(scene,[240,120],undefined,target(480,240));equal(gl.textureCount,2);equal(gl.deletedTextures,1);
  pass.draw(normalizeLightingScene(false),[240,120]);equal(gl.deletedTextures,2);equal(pass.resourceStats().textureCount,0);
  pass.destroy();pass.destroy();equal(gl.deletedTextures,2);
});

test("WebGL2 mask allocation failure restores destination and retains a valid previous mask",()=>{
  const gl=new FakeWebGL2Context(),pass=new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext);
  const scene=normalizeLightingScene({pointLights:[{x:80,y:48,radius:120}],tileOccluders:[{x:112,y:24,width:16,height:16}],shadows:true});
  pass.draw(scene,[240,120],undefined,target());gl.failFramebuffer=true;let restored=0;
  throws(()=>pass.draw(scene,[240,120],undefined,{width:480,height:240,restore(){restored++;}}),/incomplete/);
  equal(restored,1);equal(gl.deletedTextures,1);equal(pass.resourceStats().textureBytes,240*120);
  gl.failFramebuffer=false;pass.draw(scene,[240,120],undefined,target());equal(gl.textureCount,2);
  pass.destroy();equal(gl.deletedTextures,2);
});

test("Flat receiver masks restore the additional texture unit even when a light draw fails",()=>{
 const gl=Object.assign(new FakeWebGL2Context(),{TEXTURE_2D:0x0de1,TEXTURE_BINDING_2D:0x8069,TEXTURE1:0x84c1,TEXTURE2:0x84c2,TEXTURE4:0x84c4,TEXTURE5:0x84c5});
 const prior=gl.getParameter.bind(gl),bindings=new Map<number,WebGLTexture|null>();let active:number=gl.TEXTURE0;
 gl.activeTexture=(value?:number)=>{if(value!==undefined)active=value;};
 gl.bindTexture=(_target?:number,texture?:WebGLTexture|null)=>{bindings.set(active,texture??null);};
 gl.getParameter=(name:number)=>name===gl.TEXTURE_BINDING_2D?bindings.get(active)??null:prior(name);
 const sentinel={} as WebGLTexture;bindings.set(gl.TEXTURE5,sentinel);
 const pass=new WebGL2LightingPass(gl as unknown as WebGL2RenderingContext,false,true);
 const scene=normalizeLightingScene({profile:'lit',ambientIrradiance:[0,0,0],pointLights:[{x:0,y:0,radius:10,lightMask:1,shadowMask:0}]});
 const buffers={normal:{} as WebGLTexture,coverage:{} as WebGLTexture,receiverMasks:{} as WebGLTexture};
 pass.draw(scene,[100,100],buffers);equal(bindings.get(gl.TEXTURE5),sentinel);equal(active,gl.TEXTURE0);
 gl.drawArrays=()=>{throw Error('injected draw failure');};throws(()=>pass.draw(scene,[100,100],buffers),/injected draw/);
 equal(bindings.get(gl.TEXTURE5),sentinel);equal(active,gl.TEXTURE0);pass.destroy();
});
