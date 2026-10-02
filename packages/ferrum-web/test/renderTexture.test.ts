import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2RenderTextureStore } from "../src/webgl2RenderTextureStore.js";

/** GPU allocation fault injection; real rendering is covered by smoke:render-texture. */
class TargetContext {
  readonly MAX_TEXTURE_SIZE = 1;
  readonly TEXTURE_BINDING_2D = 2;
  readonly DRAW_FRAMEBUFFER_BINDING = 3;
  readonly FRAMEBUFFER_COMPLETE = 4;
  readonly DRAW_FRAMEBUFFER = 5;
  readonly TEXTURE_2D = 6;
  readonly TEXTURE_MIN_FILTER = 7;
  readonly TEXTURE_MAG_FILTER = 8;
  readonly TEXTURE_WRAP_S = 9;
  readonly TEXTURE_WRAP_T = 10;
  readonly CLAMP_TO_EDGE = 11;
  readonly NEAREST = 12;
  readonly LINEAR = 13;
  readonly RGBA8 = 14;
  readonly RGBA = 15;
  readonly UNSIGNED_BYTE = 16;
  readonly COLOR_ATTACHMENT0 = 17;
  texture: WebGLTexture | null = { external: "texture" } as WebGLTexture;
  framebuffer: WebGLFramebuffer | null = { external: "draw" } as WebGLFramebuffer;
  readonly deletedTextures: WebGLTexture[] = [];
  readonly deletedFramebuffers: WebGLFramebuffer[] = [];
  allocationCount = 0;
  complete = true;
  failFramebuffer = false;

  getParameter(parameter: number): unknown {
    if (parameter === this.MAX_TEXTURE_SIZE) return 2048;
    if (parameter === this.TEXTURE_BINDING_2D) return this.texture;
    if (parameter === this.DRAW_FRAMEBUFFER_BINDING) return this.framebuffer;
    throw new Error(`Unexpected parameter ${parameter}`);
  }
  createTexture(): WebGLTexture { return { id: ++this.allocationCount } as WebGLTexture; }
  createFramebuffer(): WebGLFramebuffer | null { return this.failFramebuffer ? null : {}; }
  bindTexture(_target: number, texture: WebGLTexture | null): void { this.texture = texture; }
  bindFramebuffer(_target: number, framebuffer: WebGLFramebuffer | null): void { this.framebuffer = framebuffer; }
  texParameteri(): void {}
  texImage2D(): void {}
  framebufferTexture2D(): void {}
  checkFramebufferStatus(): number { return this.complete ? this.FRAMEBUFFER_COMPLETE : -1; }
  deleteTexture(texture: WebGLTexture): void { this.deletedTextures.push(texture); }
  deleteFramebuffer(framebuffer: WebGLFramebuffer): void { this.deletedFramebuffers.push(framebuffer); }
}

function fixture() {
  const gl = new TargetContext();
  // Only the allocation methods are used by the store; rasterization uses real WebGL in smoke.
  return { gl, store: new WebGL2RenderTextureStore(gl as unknown as WebGL2RenderingContext) };
}

test("RenderTexture owns its resources, restores bindings, and preserves handle identity on resize", () => {
  const { gl, store } = fixture();
  const priorTexture = gl.texture;
  const priorFramebuffer = gl.framebuffer;
  const target = store.create(10, { width: 32, height: 16 });
  deepEqual(target.uv, [0, 0, 1, 1]);
  equal(Object.isFrozen(target), true);
  equal(Object.isFrozen(target.uv), true);
  equal(gl.texture, priorTexture);
  equal(gl.framebuffer, priorFramebuffer);
  const texture = store.texture(10);
  store.resize(target, 32, 16);
  equal(gl.allocationCount, 1);
  store.resize(target, 64, 48);
  deepEqual([target.width, target.height], [64, 48]);
  equal(store.texture(10) === texture, false);
  deepEqual(gl.deletedTextures, [texture]);
  equal(gl.texture, priorTexture);
  equal(gl.framebuffer, priorFramebuffer);
  equal(store.release(target), true);
  equal(store.release(target), false);
  equal(store.texture(10), undefined);
  const replacement = store.create(10, { width: 8, height: 8 });
  throws(() => store.resize(target, 1, 1), /destroyed/);
  equal(store.release(target), false);
  equal(store.has(replacement.textureId), true);
  store.destroy();
  store.destroy();
  equal(gl.deletedTextures.length, 3);
  equal(gl.deletedFramebuffers.length, 3);
});

test("failed RenderTexture allocation and resize release partial resources without losing the old image", () => {
  const { gl, store } = fixture();
  const target = store.create(12, { width: 32, height: 16 });
  const original = store.texture(12);
  gl.complete = false;
  throws(() => store.resize(target, 64, 64), /incomplete/);
  equal(store.texture(12), original);
  deepEqual([target.width, target.height], [32, 16]);
  equal(gl.deletedTextures.length, 1);
  equal(gl.deletedFramebuffers.length, 1);
  throws(() => store.create(13, { width: 8, height: 8 }), /incomplete/);
  equal(store.has(13), false);
  gl.failFramebuffer = true;
  throws(() => store.create(14, { width: 8, height: 8 }), /allocation failed/);
  equal(gl.deletedTextures.length, 3);
  equal(gl.deletedFramebuffers.length, 2);
  store.destroy();
  equal(gl.deletedTextures.length, 4);
});

test("RenderTexture rejects invalid dimensions, ids, filters and foreign handles before allocation", () => {
  const { gl, store } = fixture();
  for (const id of [0, -1, 1.5, NaN, Infinity, 0x1000000]) {
    throws(() => store.create(id, { width: 1, height: 1 }), /textureId/);
  }
  for (const width of [0, -1, 1.5, NaN, Infinity, 2049]) {
    throws(() => store.create(2, { width, height: 1 }), /dimensions/);
    throws(() => store.create(2, { width: 1, height: width }), /dimensions/);
  }
  // Invalid untyped input can originate from JSON/JavaScript consumers.
  throws(() => store.create(2, { width: 1, height: 1, filter: "bad" as "nearest" }), /filter/);
  equal(gl.allocationCount, 0);
  const own = store.create(2, { width: 1, height: 1 });
  throws(() => store.create(2, { width: 1, height: 1 }), /unique/);
  const other = fixture();
  throws(() => other.store.target(own), /another renderer/);
  throws(() => other.store.release(own), /another renderer/);
  equal(other.gl.allocationCount, 0);
  store.destroy();
});

test("RenderTexture statistics follow successful resize and remain stable after rollback", () => {
  const { gl, store } = fixture();
  const first = store.create(1, { width: 8, height: 4 });
  store.create(2, { width: 2, height: 2 });
  deepEqual(store.resourceStats(), { renderTargetCount: 2, textureBytes: 144 });
  store.resize(first, 16, 8);
  deepEqual(store.resourceStats(), { renderTargetCount: 2, textureBytes: 528 });
  gl.complete = false;
  throws(() => store.resize(first, 32, 16), /incomplete/);
  throws(() => store.create(3, { width: 8, height: 8 }), /incomplete/);
  deepEqual(store.resourceStats(), { renderTargetCount: 2, textureBytes: 528 });
  store.release(first);
  store.release(first);
  deepEqual(store.resourceStats(), { renderTargetCount: 1, textureBytes: 16 });
  store.destroy();
  deepEqual(store.resourceStats(), { renderTargetCount: 0, textureBytes: 0 });
});
