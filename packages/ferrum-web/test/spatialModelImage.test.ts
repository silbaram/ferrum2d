import { test } from "node:test";
import { deepEqual, equal, throws } from "node:assert/strict";
import { SpatialModelImageReader } from "../src/spatialModelImage.js";

function backend(failure = "") {
  const textures = new Set<object>(), framebuffers = new Set<object>();
  let contexts = 0, losses = 0;
  const create = (set: Set<object>, phase: string) => {
    if (failure === phase) return null;
    const value = {}; set.add(value); return value;
  };
  const gl = {
    TEXTURE_2D: 1, RGBA8: 2, RGBA: 3, UNSIGNED_BYTE: 4, FRAMEBUFFER: 5, COLOR_ATTACHMENT0: 6, FRAMEBUFFER_COMPLETE: 7, NO_ERROR: 0,
    createTexture: () => create(textures, "texture"), createFramebuffer: () => create(framebuffers, "framebuffer"),
    deleteTexture: (value: object) => textures.delete(value), deleteFramebuffer: (value: object) => framebuffers.delete(value),
    bindTexture: () => {}, texImage2D: () => {}, bindFramebuffer: () => {}, framebufferTexture2D: () => {}, readBuffer: () => {},
    checkFramebufferStatus: () => failure === "attachment" ? 0 : 7,
    readPixels: (_x: number, _y: number, _w: number, _h: number, _format: number, _type: number, rgba: Uint8ClampedArray) => rgba.set([32,180,48,0]),
    getError: () => failure === "read" ? 1285 : 0, isContextLost: () => failure === "lost",
    getExtension: () => ({ loseContext: () => { losses++; } }),
  };
  class Canvas { getContext() { contexts++; return failure === "context" ? null : gl; } }
  // The fake exposes the owned readback API; bitmap decoding itself is covered in the browser gate.
  return { Canvas: Canvas as unknown as typeof OffscreenCanvas, textures, framebuffers, counts: () => ({ contexts, losses }) };
}
function bitmap(): ImageBitmap {
  // read() borrows a decoded bitmap; the GLB loader owns/cleans its actual browser bitmap.
  return {width:1,height:1} as ImageBitmap;
}
test("model image readback reuses one isolated context and returns independent straight RGBA", () => {
  const previous = globalThis.OffscreenCanvas, b = backend(); globalThis.OffscreenCanvas = b.Canvas;
  const reader = new SpatialModelImageReader();
  try {
    const first = reader.read(bitmap()), second = reader.read(bitmap());
    deepEqual([...first], [32,180,48,0]); first[0] = 255; equal(second[0],32);
    deepEqual(b.counts(),{contexts:1,losses:0});equal(b.textures.size,1);equal(b.framebuffers.size,1);
  } finally { reader.destroy(); reader.destroy(); globalThis.OffscreenCanvas = previous; }
  equal(b.textures.size+b.framebuffers.size,0);deepEqual(b.counts(),{contexts:1,losses:1});
});
test("model image partial allocation, framebuffer/read failure and context loss release owned resources", () => {
  const previous = globalThis.OffscreenCanvas;
  try {
    for (const phase of ["texture","framebuffer","attachment","read","lost"]) {
      const b = backend(phase);globalThis.OffscreenCanvas = b.Canvas;const reader = new SpatialModelImageReader();
      try { throws(() => reader.read(bitmap()), /Spatial GLB: image readback/); }
      finally { reader.destroy(); }
      equal(b.textures.size+b.framebuffers.size,0);equal(b.counts().losses,1);
    }
  } finally {globalThis.OffscreenCanvas = previous;}
});
test("model image unavailable WebGL2 fails without retaining a context or resources", () => {
  const previous = globalThis.OffscreenCanvas, b = backend("context");globalThis.OffscreenCanvas = b.Canvas;
  const reader = new SpatialModelImageReader();
  try {throws(() => reader.read(bitmap()), /WebGL2 image readback unavailable/);}
  finally {reader.destroy();globalThis.OffscreenCanvas = previous;}
  equal(b.textures.size+b.framebuffers.size,0);equal(b.counts().losses,0);
});
test("model image readback falls back to an HTML canvas when Offscreen WebGL2 is unavailable", () => {
  const previousCanvas=globalThis.OffscreenCanvas,previousDocument=globalThis.document;
  const offscreen=backend("context"),html=backend();globalThis.OffscreenCanvas=offscreen.Canvas;
  // Only the browser canvas factory is substituted; the reader still validates the WebGL2 API.
  globalThis.document={createElement:()=>new html.Canvas(1,1)} as unknown as Document;
  const reader=new SpatialModelImageReader();
  try{deepEqual([...reader.read(bitmap())],[32,180,48,0]);}
  finally{reader.destroy();globalThis.OffscreenCanvas=previousCanvas;globalThis.document=previousDocument;}
  equal(offscreen.counts().contexts,1);equal(html.counts().losses,1);equal(html.textures.size+html.framebuffers.size,0);
});
