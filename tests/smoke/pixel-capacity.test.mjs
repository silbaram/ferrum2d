import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pixelDocument as d, documentUrl, pixelModuleUrl, checkedPixelImport } from './pixel-editing-modules.mjs';
import { pixelCapacitySource } from './pixel-capacity-fixture.mjs';

const png = await checkedPixelImport(await pixelModuleUrl('placementPixelPng', { './placementPixelDocument': documentUrl }));
const animation = await checkedPixelImport(await pixelModuleUrl('placementPixelAnimation', {
  './placementPixelDocument': documentUrl,
  '@ferrum2d/ferrum-web/authoring': new URL('../../packages/ferrum-web/dist/authoring.js', import.meta.url).href,
}));
const recovery = await checkedPixelImport(await pixelModuleUrl('placementPixelRecovery', { './placementPixelDocument': documentUrl }));

test('v6 roundtrips 64 original frames, eight directional tags and untagged sheets', () => {
  for (const tagged of [false, true]) {
    const source = pixelCapacitySource({ tagged });
    const restored = d.readPixelDocument(JSON.stringify(source));
    assert.deepEqual(restored, source);
    assert.deepEqual(d.createPixelEditor(restored).document(), source);
    assert.equal(d.pixelFrames(restored).length, 64);
  }
});

test('legacy frame limits and complete v6 tag metadata remain strict', () => {
  const source = pixelCapacitySource({ count: 17 });
  for (const version of [3, 5]) assert.throws(() => d.readPixelDocument(JSON.stringify(pixelCapacitySource({ count: 17, version, tagged: version === 5 }))), /16/);
  for (const invalid of [
    pixelCapacitySource({ count: 65 }), { ...source, version: 7 },
    { ...source, tags: undefined }, { ...source, initialTag: undefined }, { ...source, nextClipId: undefined },
    { ...source, tags: null }, { ...source, atlas: {} },
  ]) assert.throws(() => d.readPixelDocument(JSON.stringify(invalid)));
  const all = pixelCapacitySource();
  all.tags[0].frameIds = all.frames.map(frame => frame.id);
  assert.equal(d.readPixelDocument(JSON.stringify(all)).tags[0].frameIds.length, 64);
});

test('the seventeenth frame upgrades v3/v5 atomically and Undo restores the exact old document', () => {
  for (const version of [3, 5]) {
    const source = pixelCapacitySource({ count: 16, version, tagged: version === 5 });
    const editor = d.createPixelEditor(source);
    const added = editor.addFrame(), next = editor.document();
    assert.equal(next.version, 6); assert.equal(next.frames.length, 17);
    if (version === 5) { assert.deepEqual(next.tags, source.tags); assert.equal(next.nextClipId, source.nextClipId); }
    editor.undo(); assert.deepEqual(editor.document(), source);
    editor.redo(); assert.deepEqual(editor.document(), next);
    editor.removeFrame(added); assert.equal(editor.document().version, 6);
    assert.equal(editor.frames().length, 16);
    assert.deepEqual(d.readPixelDocument(JSON.stringify(editor.document())), editor.document());
  }
});

test('64-frame growth and aggregate pixel budgets reject before changing source or history', () => {
  const editor = d.createPixelEditor(pixelCapacitySource());
  const before = editor.document(), history = editor.history();
  for (const change of [() => editor.addFrame(), () => editor.duplicateFrame()]) {
    assert.throws(change, /limit/); assert.deepEqual(editor.document(), before); assert.deepEqual(editor.history(), history);
  }
  const full = d.createPixelEditor(pixelCapacitySource({ side: 64, count: 64, layers: 8 }));
  assert.equal(full.frames().length, 64);
  assert.throws(() => full.previewResize(65, 64, 'top-left'), /budget/);
  assert.throws(() => d.readPixelDocument(JSON.stringify(pixelCapacitySource({ side: 65, count: 64, layers: 8 }))), /budget/);
});

test('large sheets keep 16MiB history, selected cels, no-op, and Undo/Redo semantics', () => {
  const editor = d.createPixelEditor(pixelCapacitySource({ layers: 8 }));
  editor.selectFrame('frame-63'); editor.selectLayer('layer-0');
  for (let i = 0; i < 10; i++) {
    editor.begin(); editor.line(1, 1, 1, 1, [i, 7, 9, 255]); editor.commit();
    assert(editor.history().bytes <= d.PIXEL_LIMITS.historyBytes);
    assert(editor.history().undo <= d.PIXEL_LIMITS.historySteps);
  }
  const after = editor.document(), history = editor.history();
  assert.equal(history.undo, 4);
  assert.equal(history.bytes, 16 * 1024 * 1024);
  editor.begin(); editor.line(1, 1, 1, 1, [9, 7, 9, 255]); assert.equal(editor.commit(), false);
  assert.deepEqual(editor.history(), history);
  editor.undo(); assert.deepEqual(editor.sample(1, 1), [8, 7, 9, 255]);
  editor.redo(); assert.deepEqual(editor.document(), after);
});

test('64-frame and wider-than-1024 atlases retain late cels, source order and transparent RGB through PNG', async () => {
  for (const options of [{}, { side: 256, count: 17, layers: 1, tagged: false }]) {
    const source = pixelCapacitySource(options), atlas = d.pixelAtlas(source);
    const last = source.frames.length - 1, x = last % atlas.columns * source.width, y = Math.floor(last / atlas.columns) * source.height;
    const offset = (y * atlas.width + x) * 4;
    assert.deepEqual(atlas.pixels.slice(offset, offset + 4), d.pixelBytes(source, last).slice(0, 4));
    const data = await png.pixelPng(source);
    await png.verifyPixelPng(data, source);
    const changed = structuredClone(source);
    changed.frames[last].cels[0].rgba = changed.frames[0].cels[0].rgba;
    await assert.rejects(png.verifyPixelPng(data, changed), /editable source/);
    if (source.width === 256) assert(atlas.width > 1024);
  }
});

test('v6 native clips preserve each original frame and duration without GCD expansion', () => {
  const source = pixelCapacitySource(), result = animation.pixelAnimation(animation.pixelAnimationInput(source));
  assert.equal(result.set.clips.length, 8);
  assert.equal(result.set.clips.reduce((n, clip) => n + clip.frames.length, 0), 64);
  for (const [i, clip] of result.set.clips.entries()) {
    assert.equal(clip.fps, undefined);
    assert.deepEqual(clip.frameDurationsMs, source.frames.slice(i * 8, i * 8 + 8).map(frame => frame.durationMs));
    assert.deepEqual(clip.frames, result.layout.frames.slice(i * 8, i * 8 + 8));
    assert.deepEqual(result.timings[i].repeats, Array(8).fill(1));
  }
  const untagged = animation.pixelAnimation(animation.pixelAnimationInput(pixelCapacitySource({ tagged: false })));
  assert.equal(untagged.set.clips[0].frames.length, 64);
  assert.equal(untagged.set.clips[0].frameDurationsMs.length, 64);
});

test('editor animation metadata matches source exports for small v6 and legacy sheets without serializing pixels', () => {
  for (const count of [1, 8, 16, 64]) for (const tagged of [false, true]) {
    const source = pixelCapacitySource({ side: 2, layers: 1, count, tagged });
    source.frames.forEach(frame => frame.durationMs = 100);
    const editor = d.createPixelEditor(source);
    editor.document = () => assert.fail('UI metadata must not serialize cel pixels');
    const input = animation.pixelEditorAnimationInput(editor);
    assert.deepEqual(input, animation.pixelAnimationInput(source));
    assert.deepEqual(animation.pixelAnimation(input).set, animation.pixelAnimation(animation.pixelAnimationInput(source)).set);
  }
  for (const version of [3, 5]) {
    const source = pixelCapacitySource({ side: 2, layers: 1, count: 8, version, tagged: version === 5 });
    source.frames.forEach(frame => frame.durationMs = 100);
    assert.deepEqual(animation.pixelEditorAnimationInput(d.createPixelEditor(source)), animation.pixelAnimationInput(source));
  }
});

test('animation metadata follows v6 upgrade, retained version after deletion, and legacy Undo', () => {
  const source = pixelCapacitySource({ side: 2, layers: 1, count: 16, version: 3, tagged: false });
  source.frames.forEach(frame => frame.durationMs = 100);
  const editor = d.createPixelEditor(source), added = editor.addFrame();
  assert.equal(editor.version, 6);
  assert.equal(animation.pixelEditorAnimationInput(editor).originalTiming, true);
  editor.removeFrame(added);
  assert.equal(editor.frames().length, 16);
  assert.equal(animation.pixelAnimation(animation.pixelEditorAnimationInput(editor)).set.clips[0].fps, undefined);
  editor.undo(); editor.undo();
  assert.equal(editor.version, 3);
  assert.equal(animation.pixelEditorAnimationInput(editor).originalTiming, undefined);
  assert.equal(animation.pixelAnimation(animation.pixelEditorAnimationInput(editor)).set.clips[0].fps, 10);
  editor.redo();
  assert.equal(animation.pixelEditorAnimationInput(editor).originalTiming, true);
});

test('v6 recovery preserves exact source bytes and 64 stable frame IDs', () => {
  const source = JSON.stringify(pixelCapacitySource());
  const row = { id: crypto.randomUUID(), session: crypto.randomUUID(), scope: 'capacity', name: 'capacity-sheet', source, bytes: new TextEncoder().encode(source).length, updatedAt: Date.now() };
  // Use the same recovery format and scope contract as the official session.
  const saved = recovery.readPixelCheckpoint(row);
  assert.equal(saved.source, source);
  assert.equal(JSON.parse(saved.source).frames.at(-1).id, 'frame-63');
});
