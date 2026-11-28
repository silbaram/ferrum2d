import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { test } from "node:test";
import { ONE_PIXEL_PNG as PNG, withRenderer } from "./fakeWebGL2TestHelper.js";
import { SPRITE_RENDER_COMMAND_FLOATS } from "../src/spriteMaterial.js";
import type { RenderCommandBufferView } from "../src/renderCommandDecoder.js";

// Logic half of smoke:render-texture. Pixels, FBO orientation and blending stay in the browser
// smoke; this file checks validation, caller state restoration, stats and resource ownership.

const WHITE_ASSET = 1;
const ATLAS_ASSET = 2;
const TARGET_ID = 100;
function commands(
  rectangles: readonly { texture: number; color?: readonly number[]; flags?: number }[],
  floatsPerCommand = SPRITE_RENDER_COMMAND_FLOATS,
): RenderCommandBufferView {
  const buffer = new Float32Array(rectangles.length * floatsPerCommand);
  rectangles.forEach(({ texture, color = [1, 1, 1, 1], flags = 0 }, index) => {
    buffer.set([index % 32 * 4, Math.floor(index / 32) * 4, 4, 4, 0, 0, 1, 1, ...color, texture], index * floatsPerCommand);
    if (floatsPerCommand > 13) buffer[index * floatsPerCommand + 13] = flags;
  });
  return { buffer, commandCount: rectangles.length, floatsPerCommand };
}

const sprites = (count: number, texture = ATLAS_ASSET) => commands(Array.from({ length: count }, () => ({ texture })));

test("RenderTexture ids stay separate from pending, loaded and evicted asset textures", async () => {
  await withRenderer(async ({ renderer }) => {
    const loading = renderer.loadTexture(WHITE_ASSET, PNG);
    throws(() => renderer.createRenderTexture(WHITE_ASSET, { width: 8, height: 8 }), /pending load/);
    await loading;
    throws(() => renderer.createRenderTexture(WHITE_ASSET, { width: 8, height: 8 }), /already used/);
    renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    await rejects(renderer.loadTexture(TARGET_ID, PNG), /owned by a RenderTexture/);
    throws(() => renderer.evictTexture(TARGET_ID), /owned by a RenderTexture/);
    renderer.destroy();
  });
});

test("rejected offscreen passes keep stats, bindings and the target image untouched", async () => {
  await withRenderer(async ({ renderer, record, callerState, setCallerState }) => {
    await renderer.loadTexture(WHITE_ASSET, PNG);
    await renderer.loadTexture(ATLAS_ASSET, PNG);
    const target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    const source = sprites(1024);
    renderer.render();
    setCallerState();
    const before = { stats: JSON.stringify(renderer.stats()), state: callerState(), clears: record.clears, draws: record.draws };
    const alpha = commands([{ texture: WHITE_ASSET, flags: 32 }]);
    const cases: readonly [() => unknown, RegExp][] = [
      [() => renderer.renderToTexture(target, commands([{ texture: TARGET_ID }])), /feedback/],
      [() => renderer.renderToTexture(target, commands([{ texture: 9999 }])), /Texture lookup/],
      [() => renderer.renderToTexture(target, source, { viewport: { width: 0, height: 1 } }), /viewport/],
      [() => renderer.renderToTexture(target, source, { viewport: { width: 1, height: Number.NaN } }), /viewport/],
      [() => renderer.renderToTexture(target, source, { clearColor: [0, 0, 0, 0] as unknown as [number, number, number] }), /clearColor/],
      [() => renderer.renderToTexture(target, source, { clearColor: new Array(3) as [number, number, number] }), /clearColor/],
      [() => renderer.renderToTexture(target, source, { clearColor: [0, 1.5, 0] }), /clearColor/],
      [() => renderer.renderToTexture(target, { ...source, commandCount: 1025 }), /command buffer layout/],
      [() => renderer.renderToTexture(target, { ...source, floatsPerCommand: 12 }), /command buffer layout/],
      [() => renderer.renderToTexture(target, alpha), /groundShadowProjection/],
      ...[[0, 0, 1], [0, 1, 0], [0, 1]].map((projection): [() => unknown, RegExp] => [
        () => renderer.renderToTexture(target, { ...alpha, groundShadowProjection: new Float32Array(projection) }),
        /groundShadowProjection/,
      ]),
    ];
    for (const [action, pattern] of cases) {
      throws(action, pattern);
      equal(JSON.stringify(renderer.stats()), before.stats);
      deepEqual(callerState(), before.state);
      equal(record.clears, before.clears, "a rejected pass must not clear the existing image");
      equal(record.draws, before.draws);
    }
    renderer.destroy();
  });
});

test("an offscreen pass restores caller state, reports its own stats and adds them to the frame", async () => {
  await withRenderer(async ({ renderer, record, callerState, setCallerState }) => {
    await renderer.loadTexture(ATLAS_ASSET, PNG);
    const target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    const source = sprites(1024);
    renderer.render();
    const frame = renderer.stats();
    setCallerState();
    const state = callerState();
    const pass = renderer.renderToTexture(target, source, { viewport: { width: 128, height: 128 } });
    equal(pass.drawCalls, 1);
    equal(pass.renderCommandCount, 1024);
    equal(pass.textureSwitchCount, 0);
    deepEqual(callerState(), state);
    ok(record.uploads.includes(source.buffer), "matching command stride uploads directly");
    const combined = renderer.stats();
    equal(combined.drawCalls, frame.drawCalls + 1);
    equal(combined.renderCommandCount, frame.renderCommandCount + 1024);

    const padded = sprites(1024, ATLAS_ASSET);
    const compatibility = commands(Array.from({ length: 1024 }, () => ({ texture: ATLAS_ASSET })), SPRITE_RENDER_COMMAND_FLOATS + 1);
    record.uploads.length = 0;
    equal(renderer.renderToTexture(target, compatibility).renderCommandCount, 1024);
    ok(!record.uploads.includes(compatibility.buffer), "a padded stride uses the staging copy");
    record.uploads.length = 0;
    renderer.setSpriteMaterial({ colorMix: { color: [0.5, 0.5, 0.5, 1], amount: 1 } });
    renderer.renderToTexture(target, padded);
    ok(!record.uploads.includes(padded.buffer), "a material pass uses the staging copy");
    renderer.setSpriteMaterial("unlit");
    deepEqual(callerState(), state);

    // An empty pass still clears the image and draws nothing.
    const clears = record.clears;
    const empty = renderer.renderToTexture(target, commands([]), { clearColor: [1, 0, 0] });
    equal(empty.drawCalls, 0);
    equal(record.clears, clears + 1);
    deepEqual(callerState(), state);
    renderer.destroy();
  });
});

test("a draw failure inside an offscreen pass still restores the caller's framebuffer and viewport", async () => {
  await withRenderer(async ({ renderer, record, callerState, setCallerState }) => {
    await renderer.loadTexture(ATLAS_ASSET, PNG);
    const target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    renderer.render();
    setCallerState();
    const state = callerState();
    record.failDraw = true;
    throws(() => renderer.renderToTexture(target, sprites(4)), /injected draw failure/);
    record.failDraw = false;
    deepEqual(callerState(), state);
    equal(renderer.renderToTexture(target, sprites(4)).drawCalls, 1);
    renderer.destroy();
  });
});

test("sampling a RenderTexture flips its rows once per draw while assets keep their orientation", async () => {
  await withRenderer(async ({ renderer, record }) => {
    await renderer.loadTexture(ATLAS_ASSET, PNG);
    const target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    renderer.render();
    renderer.renderToTexture(target, sprites(16));
    record.flipY.length = 0;
    renderer.renderCommands(commands([{ texture: TARGET_ID }, { texture: ATLAS_ASSET }, { texture: TARGET_ID }]));
    deepEqual(record.flipY, [1, 0, 1]);
    renderer.destroy();
  });
});

test("resize, release and id reuse keep handles honest and never leak GPU targets", async () => {
  await withRenderer(async ({ renderer, live }) => {
    await renderer.loadTexture(ATLAS_ASSET, PNG);
    let target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32 });
    const baseline = [live.Texture.size, live.Framebuffer.size];
    for (let i = 0; i < 8; i += 1) {
      renderer.resizeRenderTexture(target, 32 + i * 4, 40 + i * 4);
      deepEqual([target.width, target.height], [32 + i * 4, 40 + i * 4]);
      throws(() => renderer.resizeRenderTexture(target, 0, 1), /dimensions/);
      renderer.render();
      equal(renderer.renderToTexture(target, sprites(8)).renderCommandCount, 8);
      const retired = target;
      equal(renderer.destroyRenderTexture(retired), true);
      equal(renderer.destroyRenderTexture(retired), false);
      target = renderer.createRenderTexture(TARGET_ID, { width: 32, height: 32, filter: "linear" });
      throws(() => renderer.renderToTexture(retired, sprites(1)), /destroyed/);
      equal(renderer.destroyRenderTexture(retired), false, "a stale handle must not release the reused id");
      deepEqual([live.Texture.size, live.Framebuffer.size], baseline);
    }
    renderer.destroy();
    renderer.destroy();
    throws(() => renderer.renderToTexture(target, sprites(1)), /destroyed/);
    equal(live.Framebuffer.size, 0);
    equal(live.Texture.size, 0);
  });
});
