import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePng } from '../../scripts/tools/pack-textures.mjs';
import { clickPlacementToolAction, showPlacementBottom } from './placement-panel-navigation.mjs';
import { pixelCapacitySource } from './pixel-capacity-fixture.mjs';

/** Official UI only: legacy upgrade, long-sheet navigation, pixels, exported runtime and native save. */
export async function smokePixelCapacity(page, mode, run, verify) {
  await showPlacementBottom(page, 'assets');
  const workspace = page.locator('#placement-pixel-workspace'), frames = workspace.locator('.placement-pixel-frames');
  const action = name => workspace.locator(`[data-pixel-action="${name}"]`);
  let serial = 0;
  const times = {};
  async function open(source) {
    const start = performance.now();
    await page.locator('[data-pixel-file]').setInputFiles({ name: 'capacity.pixel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
    await workspace.waitFor({ state: 'visible' });
    await page.waitForFunction(({count,tags}) => document.querySelectorAll('[data-pixel-frame-select]').length === count && document.querySelector('[data-pixel-tag-select]').options.length === tags + 1, {count:source.frames.length,tags:source.tags?.length??0});
    return performance.now() - start;
  }
  async function exported(kind, extension) {
    const menu = workspace.locator('.placement-pixel-export-menu');
    if (!await menu.evaluate(e => e.open)) await menu.locator('summary').click();
    const waiting = page.waitForEvent('download');
    await clickPlacementToolAction(action(kind));
    const file = await waiting, path = join(run, `${mode}-capacity-${serial++}.${extension}`);
    await file.saveAs(path);
    if (await menu.evaluate(e => e.open)) await menu.locator('summary').click();
    return readFile(path);
  }
  const source = async () => JSON.parse(await exported('export-source', 'pixel.json'));
  const legacy = pixelCapacitySource({ count: 16, tagged: false, version: 3 });
  await open(legacy);
  await frames.locator('[data-pixel-frame-action="add"]').click();
  assert.equal((await source()).version, 6);
  await clickPlacementToolAction(action('undo')); assert.deepEqual(await source(), legacy);
  await clickPlacementToolAction(action('redo')); assert.equal((await source()).frames.length, 17);

  // A v6 sheet stays timed even below the legacy 16-frame boundary. Exercise
  // the real UI and bundle paths, then reapply without a false migration dialog.
  const small = pixelCapacitySource({ count: 8, side: 2, layers: 1 });
  small.frames.forEach(frame => frame.durationMs = 100);
  small.tags = small.frames.map((frame, i) => ({ id: `direction-${i}`, name: `Direction ${i}`, clipId: i, frameIds: [frame.id], loop: true }));
  small.nextClipId = small.tags.length;
  await open(small);
  await clickPlacementToolAction(action('apply'));
  await page.waitForFunction(() => document.querySelector('#placement-pixel-workspace').dataset.pixelBusy === 'false');
  const smallBundle = JSON.parse(await exported('export-assets', 'assets.json'));
  const smallVisual = smallBundle.sceneDocument.sceneComposition.fragments.main.instances[0].props.components.visual;
  const smallAsset = smallBundle.assets.find(asset => asset.id === smallVisual.texture);
  assert.deepEqual(smallVisual.animationSet, smallAsset.animationSet);
  assert(smallVisual.animationSet.clips.every(clip => clip.fps === undefined && clip.frameDurationsMs[0] === 100));
  await clickPlacementToolAction(action('apply'));
  assert.equal(await page.locator('dialog[open] [data-pixel-action="confirm-migrate"]').count(), 0);
  await page.waitForFunction(() => document.querySelector('#placement-pixel-workspace').dataset.pixelBusy === 'false');
  assert.match(await workspace.locator('[data-pixel-status]').textContent(), /animation applied/);

  const original = pixelCapacitySource();
  await open({...original,tags:original.tags.slice(0,1)});
  assert(await action('normal-generate').isEnabled(), 'Unused cels must not consume the normal binding UV budget');
  times.open64Ms = await open(original);
  assert(await frames.locator('[data-pixel-frame-action="add"]').isDisabled());
  assert(await frames.locator('[data-pixel-frame-action="duplicate"]').isDisabled());
  assert(await action('normal-generate').isDisabled());
  assert.match(await action('normal-generate').getAttribute('title'), /32 animation frames/);
  const first = frames.locator('[data-pixel-frame-select="frame-0"]');
  await first.focus(); await first.press('End');
  assert.equal(await frames.locator('[data-pixel-frame-select][aria-pressed="true"]').getAttribute('data-pixel-frame-select'), 'frame-63');
  assert(await frames.locator('.placement-pixel-frame-list').evaluate(list => {
    const row = list.querySelector('[aria-pressed="true"]'), a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
    return list.scrollLeft > 0 && a.left >= b.left - 1 && a.right <= b.right + 1;
  }));
  await page.keyboard.press('Home');
  assert.equal(await first.getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('End');
  await clickPlacementToolAction(action('tool-pencil'));
  await workspace.locator('[data-pixel-color]').fill('#ff0000');
  await workspace.locator('[data-pixel-alpha]').fill('255');
  await workspace.locator('[data-pixel-alpha]').dispatchEvent('input');
  const canvas = workspace.locator('[data-pixel-canvas]');
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const point = await canvas.evaluate(c => { const r = c.getBoundingClientRect(), z = Number(c.dataset.pixelZoom); return { x: r.x + Number(c.dataset.pixelOriginX) + 2.5 * z, y: r.y + Number(c.dataset.pixelOriginY) + 2.5 * z }; });
  const paintStart = performance.now();
  await page.mouse.click(point.x, point.y);
  times.paint64Ms = performance.now() - paintStart;
  const painted = await source(), expected = structuredClone(original), bytes = Buffer.from(expected.frames[63].cels[0].rgba, 'base64');
  bytes.set([255, 0, 0, 255], (2 * 32 + 2) * 4); expected.frames[63].cels[0].rgba = bytes.toString('base64');
  assert.deepEqual(painted, expected);
  await clickPlacementToolAction(action('undo')); assert.deepEqual(await source(), original);
  await clickPlacementToolAction(action('redo')); assert.deepEqual(await source(), expected);
  await clickPlacementToolAction(action('undo')); assert.deepEqual(await source(), original);
  const pngStart = performance.now(), png = decodePng(await exported('export-png', 'png'));
  times.exportPng64Ms = performance.now() - pngStart;
  assert.equal(png.width, 256); assert.equal(png.height, 256);
  const offset = (224 * png.width + 224) * 4;
  assert.deepEqual([...png.pixels.subarray(offset, offset + 4)], [...Buffer.from(original.frames[63].cels[0].rgba, 'base64').subarray(0, 4)]);

  await page.setViewportSize({ width: 390, height: 840 });
  const selectionVisible=()=>page.waitForFunction(()=>{
    const list=document.querySelector('.placement-pixel-frame-list'),row=list.querySelector('[aria-pressed="true"]'),a=row.getBoundingClientRect(),b=list.getBoundingClientRect();
    return a.left>=b.left-1&&a.right<=b.right+1;
  });
  await selectionVisible();
  assert(await workspace.evaluate(e => e.scrollWidth <= e.clientWidth + 1));
  await page.screenshot({ path: join(run, mode + '-capacity-64-compact.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await selectionVisible();
  await page.screenshot({ path: join(run, mode + '-capacity-64.png'), fullPage: true });
  await clickPlacementToolAction(action('apply'));
  // Replacing the earlier small source changes real clip UVs, so review is expected.
  await clickPlacementToolAction(page.locator('dialog[open] [data-pixel-action="confirm-migrate"]'));
  await page.waitForFunction(() => document.querySelector('#placement-pixel-workspace').dataset.pixelBusy === 'false');
  assert.match(await workspace.locator('[data-pixel-status]').textContent(), /animation applied/);
  const bundle = JSON.parse(await exported('export-assets', 'assets.json'));
  const asset = bundle.assets.find(asset => asset.source?.version === 6 && asset.source.frames.length === 64);
  assert(asset); assert.deepEqual(asset.source, original);
  const game = await verify(bundle);
  assert.equal(game.capacityPlayback.visitedOriginalFrames, 64);
  assert.equal(game.capacityPlayback.pixelChecks, 64);
  return { id: asset.id, source: original, frames: 64, clips: 8, upgradeUndo: true, smallV6TimingMatchesExport: true, unchangedReapplyNeedsNoMigration: true, capEnforced: true, unusedCelsDoNotBlockNormals: true, keyboardSelectionVisible: true, lateCelUndoRedo: true, pngLateCelVerified: true, compact: true, times, game };
}
