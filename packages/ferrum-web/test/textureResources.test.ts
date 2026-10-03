import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { TextureManager } from "../src/textureManager.js";

function fixture() {
  const deleted: WebGLTexture[] = [];
  let failUpload = false;
  // Allocation-only fake; actual WebGL storage is independently checked by browser smoke.
  const gl = {
    createTexture: () => ({}),
    deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
    bindTexture: () => {}, texParameteri: () => {}, pixelStorei: () => {},
    texImage2D: () => { if (failUpload) throw new Error("upload failed"); },
  } as unknown as WebGL2RenderingContext;
  return { manager: new TextureManager(gl), deleted, fail: () => { failUpload = true; } };
}

function image(width: number, height: number): TexImageSource {
  return { width, height } as ImageBitmap;
}

test("texture statistics count objects once and aliases retain shared ownership", () => {
  const { manager, deleted } = fixture();
  const texture = manager.createTextureFromSource(image(8, 4));
  manager.setTexture(1, texture);
  manager.setTexture(2, texture);
  deepEqual(manager.resourceStats(), { textureCount: 1, textureBytes: 128, unmeasuredTextureCount: 0 });
  manager.evictTexture(1);
  equal(deleted.length, 0);
  equal(manager.texture(2), texture);
  const replacement = manager.createTextureFromSource(image(2, 2));
  manager.setTexture(2, replacement);
  deepEqual(deleted, [texture]);
  equal(manager.resourceStats().textureBytes, 16);
  equal(manager.evictTexture(2), true);
  equal(manager.evictTexture(2), false);
  manager.destroy();
  manager.destroy();
  deepEqual(deleted, [texture, replacement]);
  deepEqual(manager.resourceStats(), { textureCount: 0, textureBytes: 0, unmeasuredTextureCount: 0 });
});

test("replacing an alias preserves the other id and reserved placeholder", () => {
  const { manager, deleted } = fixture();
  const shared = manager.createTextureFromSource(image(1, 1));
  manager.setTexture(0, shared);
  manager.setTexture(2, shared);
  manager.setTexture(2, manager.createTextureFromSource(image(2, 2)));
  equal(deleted.length, 0);
  equal(manager.evictTexture(0), false);
  equal(manager.texture(0), shared);
  equal(manager.resourceStats().textureBytes, 20);
  manager.destroy();
  equal(deleted.length, 2);
});

test("unmeasured adopted textures never report zero bytes as a complete estimate", () => {
  const { manager } = fixture();
  const external = {};
  manager.setTexture(1, external);
  manager.setTexture(2, external);
  deepEqual(manager.resourceStats(), { textureCount: 1, textureBytes: undefined, unmeasuredTextureCount: 1 });
  manager.setTexture(2, external, { width: 3, height: 5 });
  equal(manager.resourceStats().textureBytes, 60);
  equal(manager.resourceStats().unmeasuredTextureCount, 0);
  manager.evictTexture(1);
  equal(manager.resourceStats().textureBytes, 60);
  manager.destroy();
});

test("ambiguous DOM image sizes remain unmeasured and failed uploads release allocations", () => {
  const { manager, deleted, fail } = fixture();
  // HTMLImageElement dimensions can be density-corrected or SVG display dimensions.
  manager.createTextureFromSource({ width: 1, height: 1, naturalWidth: 8, naturalHeight: 4 } as HTMLImageElement);
  equal(manager.resourceStats().textureBytes, undefined);
  equal(manager.resourceStats().unmeasuredTextureCount, 1);
  fail();
  throws(() => manager.createTextureFromSource(image(2, 2)), /upload failed/);
  equal(deleted.length, 1);
  equal(manager.resourceStats().textureCount, 1);
  equal(manager.resourceStats().textureBytes, undefined);
  manager.destroy();
  equal(deleted.length, 2);
});
