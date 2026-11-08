import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decodePng} from '../../scripts/tools/pack-textures.mjs';

// The fixture uses OpenGL tangent normals: +Y points up, while image rows go down.
export async function checkDemoNormalAssets() {
  const results = [];
  for (const [path, frameWidth, frameHeight, centerY] of [
    ['examples/starter-runtime/public/playground/ball-normal.png', 32, 32, 15.5],
    ['examples/starter-runtime/public/playground/robot-normal.png', 32, 40, 18],
    ['examples/pixel-art/public/assets/keeper-normal.png', 24, 24, 12],
  ]) {
    const image = decodePng(await readFile(path));
    let upper = 0, lower = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4;
      if (!image.pixels[offset + 3]) continue;
      const localY = y % frameHeight, green = image.pixels[offset + 1];
      if (localY < centerY - 1) { assert(green > 128, `${path}: upper normal must point up (+Y)`); upper++; }
      if (localY > centerY + 1) { assert(green < 128, `${path}: lower normal must point down (-Y)`); lower++; }
    }
    assert(upper > 0 && lower > 0 && image.width % frameWidth === 0);
    results.push({path, upper, lower});
  }
  return results;
}

// Read actual light response at fixed surface points. Comparing the same pixels
// between opposite lights cancels the albedo's painted highlight and ambient light.
export async function sampleFeatureLightingDirections(page) {
  const control = key => page.locator(`[data-control="${key}"]`);
  if (await page.evaluate(() => window.ferrumFeatureLab.snapshot().state === 'playing')) await control('pause').click();
  await control('lighting').selectOption('lit');
  await control('normal').check();
  const directions = {top: [432, 64], bottom: [432, 320], left: [304, 192], right: [560, 192]};
  const samples = {};
  for (const [name, [x, y]] of Object.entries(directions)) {
    const pointer = await page.locator('canvas').evaluate((canvas, {x, y}) => {
      const rect = canvas.getBoundingClientRect(), scale = Math.min(canvas.clientWidth / 640, canvas.clientHeight / 384);
      const state = window.ferrumFeatureLab.snapshot();
      return {x: rect.x + canvas.clientLeft + canvas.clientWidth / 2 + (x - state.cameraX) * scale,
        y: rect.y + canvas.clientTop + canvas.clientHeight / 2 + (y - state.cameraY) * scale};
    }, {x, y});
    await page.mouse.move(pointer.x, pointer.y);
    await page.waitForFunction(({x, y}) => {
      const coordinates = /광원\s+(-?\d+),\s*(-?\d+)/.exec(document.querySelector('[data-value="observation"]').textContent);
      return coordinates && Math.abs(Number(coordinates[1]) - x) <= 1 && Math.abs(Number(coordinates[2]) - y) <= 1;
    }, {x, y});
    samples[name] = await page.evaluate(async () => {
      const canvas = document.querySelector('canvas'), device = window.playgroundGpuDevice;
      const state = window.ferrumFeatureLab.snapshot();
      const scale = Math.min(canvas.clientWidth / 640, canvas.clientHeight / 384);
      const points = {top: [432, 160], bottom: [432, 224], left: [400, 192], right: [464, 192]};
      let bytes, stride;
      if (device) {
        await device.queue.onSubmittedWorkDone();
        stride = Math.ceil(canvas.width * 4 / 256) * 256;
        const buffer = device.createBuffer({size: stride * canvas.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer({texture: canvas.getContext('webgpu').getCurrentTexture()}, {buffer, bytesPerRow: stride, rowsPerImage: canvas.height}, [canvas.width, canvas.height]);
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          bytes = new Uint8Array(buffer.getMappedRange()).slice();
          buffer.unmap();
        } finally { buffer.destroy(); }
      } else {
        const gl = canvas.getContext('webgl2');
        stride = canvas.width * 4;
        bytes = new Uint8Array(stride * canvas.height);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        if (gl.getError()) throw Error('Lighting readback failed');
      }
      return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
        const px = Math.round((canvas.clientWidth / 2 + (x - state.cameraX) * scale) * canvas.width / canvas.clientWidth);
        const py = Math.round((canvas.clientHeight / 2 + (y - state.cameraY) * scale) * canvas.height / canvas.clientHeight);
        let sum = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const row = device ? py + dy : canvas.height - 1 - (py + dy);
          const offset = row * stride + (px + dx) * 4;
          sum += (bytes[offset] + bytes[offset + 1] + bytes[offset + 2]) / 3;
        }
        return [name, sum / 25];
      }));
    });
  }
  return samples;
}

export async function checkFeatureLightingDirections(page) {
  await checkDemoNormalAssets();
  const samples = await sampleFeatureLightingDirections(page);
  for (const [near, far] of [['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left']]) {
    assert(samples[near][near] > samples[far][near] + 8,
      `${near} light must brighten the ${near} hemisphere: ${JSON.stringify(samples)}`);
  }
  const state = await page.evaluate(() => window.ferrumFeatureLab.snapshot());
  assert.equal(state.state, 'paused');
  assert.equal(state.nativeState, 3, 'native scene stays paused while lighting is inspected');
  assert.equal(state.entities, 2);
  assert.equal(state.commands, 2);
  assert(state.normalDrawCalls > 0 && state.drawCalls > 0 && state.drawCalls <= 8);
  await page.locator('[data-light="160"]').click();
  await page.waitForFunction(() => document.querySelector('[data-value="observation"]').textContent.includes('광원 160, 96'));
  return samples;
}
