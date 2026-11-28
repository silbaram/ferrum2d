import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { SPRITE_RENDER_COMMAND_FLOATS } from "../src/spriteMaterial.js";
import { ONE_PIXEL_PNG, withRenderer } from "./fakeWebGL2TestHelper.js";

// Logic half of smoke:flat-pixel-perfect on WebGL2. Block uniformity, letterbox color and
// WebGL2/WebGPU parity stay in the browser smoke; WebGPU device recovery is browser-only.

const config = { width: 32, height: 24 } as const;

function sprites(count: number) {
  const buffer = new Float32Array(count * SPRITE_RENDER_COMMAND_FLOATS);
  for (let i = 0; i < count; i += 1) buffer.set([i * 8, 4, 8, 8, 0, 0, 1, 1, 1, 1, 1, 1, 1], i * SPRITE_RENDER_COMMAND_FLOATS);
  return { buffer, commandCount: count, floatsPerCommand: SPRITE_RENDER_COMMAND_FLOATS };
}

for (const colorManagement of ["legacy", "linear-srgb"] as const) {
  test(`${colorManagement} pixel-perfect frames present once at an integer scale and keep virtual memory fixed`, async () => {
    await withRenderer(async ({ renderer, canvas, live }) => {
      await renderer.loadTexture(1, ONE_PIXEL_PNG);
      renderer.setPixelPerfect(config);
      const draw = (post?: Parameters<typeof renderer.setPostProcess>[0]) => {
        renderer.setLighting(false);
        renderer.setPostProcess(post);
        renderer.render();
        // A mid-frame display change must reject before touching targets.
        throws(() => renderer.setPixelPerfect(config), /between frames/);
        renderer.renderCommands(sprites(2));
        return renderer.renderPostProcess();
      };
      const presentation = renderer.pixelPerfectPresentation();
      if (!presentation) throw new Error("Missing pixel-perfect presentation");
      ok(presentation.integerScale && Number.isInteger(presentation.scale), "integer presentation");
      equal(presentation.scale, 4);
      deepEqual(renderer.viewportSize(), { width: 32, height: 24 });
      for (const post of [undefined, [{ kind: "fade", color: [1, 0, 0, 0.25] }] as const]) {
        const stats = draw(post);
        equal(stats.presentationPassCount, 1);
        equal(stats.spriteCount, 2);
        ok(stats.drawCalls <= 20);
      }

      // Offscreen captures use their own resolution and leave the presentation untouched.
      const before = JSON.stringify(renderer.pixelPerfectPresentation());
      renderer.render();
      const target = renderer.createRenderTexture(50, { width: 8, height: 8, filter: "nearest" });
      renderer.renderToTexture(target, sprites(2), { viewport: { width: 32, height: 24 } });
      renderer.renderCommands(sprites(2));
      renderer.renderPostProcess();
      equal(JSON.stringify(renderer.pixelPerfectPresentation()), before, "capture isolation");
      renderer.destroyRenderTexture(target);

      draw();
      const memory = renderer.resourceStats().textureBytes;
      canvas.clientWidth = 333;
      canvas.clientHeight = 255;
      renderer.resize();
      draw();
      equal(renderer.resourceStats().textureBytes, memory, "virtual targets must not scale with the CSS size");

      const prior = JSON.stringify(renderer.pixelPerfectPresentation());
      const targets = live.Texture.size;
      throws(() => renderer.setPixelPerfect({ width: 0, height: 1 }));
      equal(JSON.stringify(renderer.pixelPerfectPresentation()), prior, "invalid options changed the presentation");
      equal(live.Texture.size, targets, "invalid options allocated targets");

      canvas.clientWidth = 11;
      canvas.clientHeight = 9;
      renderer.resize();
      equal(renderer.pixelPerfectPresentation()?.integerScale, false, "small viewport falls back to nearest scaling");
      draw();
      renderer.setPixelPerfect(false);
      equal(renderer.pixelPerfectPresentation(), undefined);
      equal(renderer.viewportSize().width, 11, "legacy CSS viewport restored");
      renderer.destroy();
      const remaining = renderer.resourceStats();
      deepEqual([remaining.textureCount, remaining.bufferCount, remaining.programCount], [0, 0, 0], "renderer resources leaked");
    }, { colorManagement, clearColor: [0.03, 0.06, 0.09, 1] });
  });
}
