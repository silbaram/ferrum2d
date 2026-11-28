import "./nativeRuntimeTestHelper.js";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createFerrumRuntime, type FerrumRuntimeFrame } from "../src/createFerrumRuntime.js";
import { createRenderer, type RendererFallbackInfo } from "../src/createRenderer.js";
import { srgbToLinear } from "../src/colorManagement.js";
import type { ColorManagementMode } from "../src/colorManagement.js";
import type { InputManager } from "../src/inputManager.js";
import { SPRITE_RENDER_COMMAND_FLOATS } from "../src/spriteMaterial.js";
import { WebGL2Renderer } from "../src/webgl2Renderer.js";
import { fakeWebGL2, installRendererGlobals, ONE_PIXEL_PNG, withRenderer } from "./fakeWebGL2TestHelper.js";

// Logic half of smoke:color-management. Encoded pixels, shader sRGB accuracy and premultiplied
// canvas output stay in the browser smoke.

const TEXTURE = 71;
const sceneDocument = {
  format: "ferrum2d.consumer.scene-authoring", version: 1,
  sceneComposition: { initialFragment: "main", prefabs: { gray: { props: { components: {
    visual: { kind: "sprite", texture: TEXTURE, width: 64, height: 64, tint: "#808080" },
    collider: "none", layer: "player",
  } } } }, fragments: { main: { instances: [{ id: "gray", prefab: "gray", x: 100, y: 100 }] } } },
  behaviorRecipes: { entities: {} },
} as const;

type Source = "default" | "top-level" | "webgl2" | "injected";
const idleSnapshot = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
const idleInput = { snapshot: () => ({ ...idleSnapshot }) } as unknown as InputManager;

test("runtime Data Scene working colors follow the resolved renderer mode across apply, reapply and transition", async () => {
  const restoreGlobals = installRendererGlobals();
  const request = globalThis.requestAnimationFrame;
  const cancel = globalThis.cancelAnimationFrame;
  const pending = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  let clock = 0;
  try {
    for (const source of ["default", "top-level", "webgl2", "injected"] as const satisfies readonly Source[]) {
      const mode: ColorManagementMode = source === "default" ? "legacy" : "linear-srgb";
      const fake = fakeWebGL2();
      const canvas = fake.canvas as unknown as HTMLCanvasElement;
      const injected = source === "injected" ? new WebGL2Renderer(canvas, { colorManagement: mode }) : undefined;
      const seen: { frame?: FerrumRuntimeFrame } = {};
      const runtime = await createFerrumRuntime({
        canvas, ui: false, debug: false, autostart: false, input: idleInput,
        ...(source === "top-level" ? { colorManagement: mode } : {}),
        ...(injected ? { renderer: injected } : {}),
        webgl2: source === "webgl2" ? { colorManagement: mode } : {},
        dataScene: injected ? { document: sceneDocument, colorManagement: mode } : sceneDocument,
        onFrame: frame => { seen.frame = frame; },
      });
      try {
        const renderer = runtime.renderer as WebGL2Renderer;
        equal(renderer.colorManagement, mode, `${source} renderer mode`);
        await renderer.loadTexture(TEXTURE, ONE_PIXEL_PNG);
        const scene = runtime.dataScene;
        if (!scene) throw new Error("Missing runtime Data Scene");
        const expected = mode === "legacy" ? 128 / 255 : Math.fround(srgbToLinear(128 / 255));
        const nextFrameRgb = () => {
          seen.frame = undefined;
          // The loop's first callback only records its start time.
          for (let tick = 0; tick < 3 && !seen.frame; tick += 1) {
            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) callback(clock += 16);
          }
          const frame = seen.frame as FerrumRuntimeFrame | undefined;
          if (!frame) throw new Error(`${source}: no frame`);
          const buffer = frame.frame.renderCommandBuffer.buffer;
          return [...buffer.slice(8, 11)];
        };
        for (const operation of ["initial", "reapply", "transition"] as const) {
          if (operation !== "initial") scene[operation](sceneDocument);
          runtime.engine.setDataSceneCamera({ x: 100, y: 100 });
          if (operation === "initial") runtime.start();
          const rgb = nextFrameRgb();
          ok(rgb.every(value => Math.abs(value - expected) < 1e-6), `${source} ${operation}: ${rgb} expected ${expected}`);
          equal(scene.state(), "playing");
        }
        if (!injected) {
          const conflict = mode === "legacy" ? "linear-srgb" : "legacy";
          for (const operation of ["reapply", "transition"] as const) {
            throws(() => scene[operation](sceneDocument, { colorManagement: conflict }), /must match the runtime renderer/);
            equal(scene.state(), "playing", `${source} ${operation}: rejected mode must not stop the scene`);
          }
          const rgb = nextFrameRgb();
          ok(rgb.every(value => Math.abs(value - expected) < 1e-6), `${source}: rejected mode changed the working color`);
        }
      } finally {
        runtime.destroy();
        injected?.destroy();
      }
    }
  } finally {
    globalThis.requestAnimationFrame = request;
    globalThis.cancelAnimationFrame = cancel;
    restoreGlobals();
  }
});

function sprites(count: number, texture: number) {
  const buffer = new Float32Array(count * SPRITE_RENDER_COMMAND_FLOATS);
  for (let i = 0; i < count; i += 1) {
    buffer.set([i % 32 * 4, Math.floor(i / 32) * 4, 4, 4, 0, 0, 1, 1, 1, 1, 1, 1, texture], i * SPRITE_RENDER_COMMAND_FLOATS);
  }
  return { buffer, commandCount: count, floatsPerCommand: SPRITE_RENDER_COMMAND_FLOATS };
}

for (const mode of ["legacy", "linear-srgb"] as const) {
  test(`${mode} output keeps one sprite batch, shows its conversion draw and allocates nothing per frame`, async () => {
    const managed = mode === "linear-srgb";
    await withRenderer(async ({ renderer, live, record }) => {
      await renderer.loadTexture(1, ONE_PIXEL_PNG);
      const many = sprites(1024, 1);
      const draw = () => {
        renderer.setPostProcess([]);
        renderer.setLighting(false);
        renderer.render();
        renderer.renderCommands(many);
        return renderer.renderPostProcess();
      };
      draw();
      equal(live.Framebuffer.size, managed ? 1 : 0, "simple output allocated unused scratch targets");
      const allocations = record.allocations;
      let stats = draw();
      for (let i = 0; i < 40; i += 1) stats = draw();
      equal(stats.renderCommandCount, 1024);
      equal(stats.drawCalls, managed ? 2 : 1);
      equal(stats.postProcessDrawCalls, managed ? 1 : 0, "output conversion cost is visible");
      equal(stats.batchCount, 1);
      equal(stats.textureSwitchCount, 0);
      equal(record.allocations, allocations, "frame loop allocated GPU textures or framebuffers");
      renderer.destroy();
      deepEqual([live.Texture.size, live.Framebuffer.size], [0, 0], "GPU texture/framebuffer leak");
    }, { colorManagement: mode, clearColor: [0, 0, 0, 1] });
  });
}

test("a failed WebGPU adapter falls back to managed WebGL2 with an explicit diagnostic", async () => {
  const restoreGlobals = installRendererGlobals();
  const navigatorGlobal = globalThis as unknown as { navigator?: unknown };
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { gpu: { requestAdapter: async () => { throw new Error("injected managed adapter failure"); } } },
  });
  try {
    const fake = fakeWebGL2();
    let fallback: RendererFallbackInfo | undefined;
    const renderer = await createRenderer(fake.canvas as unknown as HTMLCanvasElement, {
      preferred: "webgpu", colorManagement: "linear-srgb", fallbackBehavior: "silent",
      onFallback: info => { fallback = info; },
      webgl2: { clearColor: [0.25, 0.25, 0.25, 1] },
    });
    try {
      if (!(renderer instanceof WebGL2Renderer)) throw new Error("managed WebGL2 fallback");
      equal(renderer.colorManagement, "linear-srgb");
      ok(String(fallback?.reason).includes("injected managed adapter failure"), "explicit fallback diagnostic");
    } finally {
      renderer.destroy();
    }
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete navigatorGlobal.navigator;
    restoreGlobals();
  }
});
