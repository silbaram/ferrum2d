import { createRenderer } from '@ferrum2d/ferrum-web/core';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check = (condition, message) => { if (!condition) throw Error('atlas extrusion: ' + message); };
const delta = (a, b) => a.reduce((m, value, i) => Math.max(m, Math.abs(value - b[i])), 0);
export async function probeAtlasExtrusion(preferred, fixture, textureColorSpace = 'none') {
  const canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:192px;height:160px';
  canvas.dataset.spatialGpuTarget = 'true'; document.body.append(canvas);
  const renderer = await createRenderer(canvas, { preferred, pixelPerfect: { width: 96, height: 80 },
    webgl2: { preserveDrawingBuffer: true, clearColor: [0, 0, 0, 1] }, webgpu: { clearColor: [0, 0, 0, 1] } });
  const device = renderer.gpuDevice?.(), errors = [], normalCases = [], edgeProbes = [];
  async function draw(textureId, uv, width, height, rotation = 0) {
    renderer.render();
    renderer.renderCommands({ commandCount: 1, floatsPerCommand: 15,
      buffer: new Float32Array([24.137, 18.271, width, height, ...uv, 1, 1, 1, 1, textureId, 0, rotation]) });
    const stats = renderer.renderPostProcess(); await device?.queue.onSubmittedWorkDone();
    check(stats.spriteCount === 1 && stats.drawCalls === 2, 'sprite/presentation batching');
    const raw = await pixels(renderer, canvas), p = renderer.pixelPerfectPresentation(), result = new Uint8Array(96 * 80 * 4);
    for (let y = 0; y < 80; y++) for (let x = 0; x < 96; x++) {
      const offset = ((p.y + Math.floor((y + .5) * p.height / 80)) * p.canvasWidth + p.x + Math.floor((x + .5) * p.width / 96)) * 4;
      result.set(raw.subarray(offset, offset + 4), (y * 96 + x) * 4);
    }
    return result;
  }
  try {
    check((device ? 'webgpu' : 'webgl2') === preferred, 'unexpected fallback');
    device?.addEventListener('uncapturederror', e => errors.push(e.error.message));
    // Test byte-preserving PNG data independently of legacy sRGB ImageBitmap
    // premultiplication differences between the two upload APIs.
    for (const [i, source] of fixture.sources.entries()) await renderer.loadTexture(10 + i, '/assets/' + source.referenceImage, { colorSpace: textureColorSpace });
    for (const [i, atlas] of fixture.atlases.entries()) await renderer.loadTexture(20 + i, '/assets/' + atlas.image, { colorSpace: textureColorSpace });
    const transforms = [[.75, 0, false], [1.37, 0, false], [2.4, .37, false], [1.13, -.63, true], [2.1, Math.PI / 2, false], [1.9, Math.PI, true]];
    // Normal runtime geometry always uses the original frame UV rectangle.
    for (const [i, source] of fixture.sources.entries()) {
      if (source.name === 'tiny') continue;
      for (const [scale, rotation, flip] of transforms) {
        const original = fixture.atlases[0].frames[source.name].uv;
        const full = flip ? [original.u1, original.v1, original.u0, original.v0] : [original.u0, original.v0, original.u1, original.v1];
        const expected = await draw(10 + i, full, source.width * scale, source.height * scale, rotation);
        check(expected.some((v, i) => i % 4 !== 3 && v > 0), 'empty reference');
        for (const [j, atlas] of fixture.atlases.entries()) {
          const { u0, v0, u1, v1 } = atlas.frames[source.name].uv;
          const uv = flip ? [u1, v1, u0, v0] : [u0, v0, u1, v1];
          const actual = await draw(20 + j, uv, source.width * scale, source.height * scale, rotation);
          const maxChannelDelta = delta(actual, expected);
          if (maxChannelDelta > 1) {
            const differences = [];
            for (let at = 0; at < actual.length; at += 4) if (delta(actual.subarray(at, at + 4), expected.subarray(at, at + 4)) > 1)
              differences.push({ x: at / 4 % 96, y: Math.floor(at / 4 / 96), actual: [...actual.subarray(at, at + 4)], expected: [...expected.subarray(at, at + 4)] });
            window.atlasExtrusionFailure = { preferred, source: source.name, atlas, scale, rotation, flip, differences };
          }
          check(atlas.extrude < 2 || maxChannelDelta <= 1, `protected runtime pixels differ (${preferred}, ${source.name}, ${atlas.name}, ${scale}, ${rotation}): ${maxChannelDelta}`);
          normalCases.push({ source: source.name, extrude: atlas.extrude, scale, rotation, flip, maxChannelDelta });
        }
      }
    }
    // Diagnostic only: place UVs on/past an edge to measure the protection band.
    // This is NOT evidence that ordinary nearest sampling bleeds on this GPU.
    const sourceIndex = fixture.sources.findIndex(s => s.name === 'hero');
    const hero = fixture.sources[sourceIndex], row = 2;
    for (const [i, atlas] of fixture.atlases.entries()) {
      const placement = atlas.placements.find(p => p.name === 'hero');
      for (const offsetTexels of [0, .25, .75, 1.25, 1.75]) {
        const u = (placement.x + hero.width + offsetTexels) / atlas.width, v = (placement.y + row + .5) / atlas.height;
        const expected = await draw(10 + sourceIndex, [u, v, u, v], 8, 8);
        const actual = await draw(20 + i, [u, v, u, v], 8, 8);
        const changedPixels = actual.reduce((n, _, j) => n + (j % 4 === 0 && delta(actual.subarray(j, j + 4), expected.subarray(j, j + 4)) > 1 ? 1 : 0), 0);
        const protectedEdge = offsetTexels < atlas.extrude;
        check(protectedEdge ? changedPixels === 0 : changedPixels > 0, `edge sensitivity/protection ${atlas.extrude}/${offsetTexels}`);
        edgeProbes.push({ extrude: atlas.extrude, offsetTexels, changedPixels });
      }
    }
    const heroAtlas = fixture.atlases.find(a => a.extrude === 2), heroUv = heroAtlas.frames.hero.uv;
    const reference = await draw(20 + fixture.atlases.indexOf(heroAtlas), [heroUv.u0, heroUv.v0, heroUv.u1, heroUv.v1], 14, 10);
    check(!errors.length, errors.join('\n'));
    return { ok: true, backend: preferred, textureColorSpace, normalCases, edgeProbes, errors, reference: btoa(String.fromCharCode(...reference)) };
  } finally {
    renderer.destroy(); const remaining = renderer.resourceStats();
    check(remaining.textureCount === 0 && remaining.bufferCount === 0 && remaining.programCount === 0, 'resource leak');
    window.disposeSpatialGpuTarget?.(canvas); canvas.remove();
  }
}
