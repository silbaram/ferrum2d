import {
  captureGameStateSnapshot,
  createEngine,
  createRenderer,
  decodeRenderCommands,
  parseGameStateSnapshot,
  resolveDataSceneSpriteAnimationSet,
  restoreGameStateSnapshot,
  stringifyGameStateSnapshot,
} from '@ferrum2d/ferrum-web/core';
import {
  applyDataSceneAuthoringDocument,
  createSceneInstanceHandleRegistry,
} from '@ferrum2d/ferrum-web/authoring';
import { pixels } from './flat-pixel-perfect-fixture.mjs';

const check = (ok, label, evidence) => {
  if (!ok) throw Error(`${label}${evidence === undefined ? '' : ': ' + JSON.stringify(evidence)}`);
};
const same = (actual, expected, label) => check(JSON.stringify(actual) === JSON.stringify(expected), label, { actual, expected });
const animationKinds = new Set(['spriteAnimationFrame', 'spriteAnimationCompleted', 'spriteAnimationOverflow']);
const CELL = 4, FRAMES = 48, DIRECTIONS = 8;
const uv = (frame, direction = 0) => ({ u0: frame / FRAMES, v0: direction / DIRECTIONS, u1: (frame + 1) / FRAMES, v1: (direction + 1) / DIRECTIONS });
const color = (frame, direction) => [32 + (frame * 37 + direction * 23) % 192, 32 + (frame * 19 + direction * 67) % 192, 32 + (frame * 71 + direction * 13) % 192, 255];

function atlasImage() {
  const atlas = document.createElement('canvas');
  atlas.width = FRAMES * CELL;
  atlas.height = DIRECTIONS * CELL;
  const context = atlas.getContext('2d');
  for (let direction = 0; direction < DIRECTIONS; direction++) {
    for (let frame = 0; frame < FRAMES; frame++) {
      context.fillStyle = `rgb(${color(frame, direction).slice(0, 3).join(',')})`;
      context.fillRect(frame * CELL, direction * CELL, CELL, CELL);
    }
  }
  return atlas.toDataURL();
}

function animationSet() {
  const frames = [uv(0), uv(1), uv(2)];
  return {
    initialClip: 100,
    clips: [
      ...Array.from({ length: DIRECTIONS }, (_, id) => ({
        id, fps: 1000, loop: true, emitEvents: true,
        frames: Array.from({ length: FRAMES }, (_, frame) => uv(frame, id)),
      })),
      { id: 100, frames: frames.slice(0, 2), frameDurationsMs: [90, 180], loop: true, emitEvents: true },
      { id: 101, frames: frames.slice(0, 2), frameDurationsMs: [90, 180], direction: 'reverse', loop: false, emitEvents: true },
      { id: 102, frames, frameDurationsMs: [90, 180, 90], direction: 'pingpong', loop: true, emitEvents: true },
      { id: 103, frames, frameDurationsMs: [90, 180, 90], direction: 'pingpong', loop: false, emitEvents: true },
      { id: 104, frames: [frames[0]], frameDurationsMs: [90], direction: 'pingpong', loop: false, emitEvents: true },
      { id: 105, frames: [frames[0]], frameDurationsMs: [90], direction: 'reverse', loop: true, emitEvents: true },
      { id: 106, frames, fps: 1000, loop: true, emitEvents: true },
      { id: 107, frames: frames.slice(0, 2), frameDurationsMs: [90, 180], loop: false, emitEvents: true },
    ],
  };
}

function sceneDocument(set) {
  return {
    format: 'ferrum2d.consumer.scene-authoring', version: 1,
    sceneComposition: {
      initialFragment: 'main',
      prefabs: { actor: { props: { components: {
        visual: { kind: 'sprite', texture: 1, width: 48, height: 48, originX: 0.5, originY: 0.5, animationSet: set },
        collider: 'none', layer: 'player',
      } } } },
      fragments: { main: { instances: [{ id: 'actor', prefab: 'actor', x: 0, y: 0 }] } },
    },
    behaviorRecipes: { entities: {} },
  };
}

/** Public setup/save APIs and a controlled RAF drive the real GameLoop and Rust simulation. */
export async function probeSpriteAnimationRuntime(preferred = 'webgl2') {
  window.spriteAnimationRuntimeStage = `${preferred}:adapter`;
  if (preferred === 'webgpu' && (!navigator.gpu || !(await navigator.gpu.requestAdapter()))) {
    return { preferred, status: 'unavailable', reason: 'No WebGPU adapter; WebGL2 remains required.' };
  }
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:384px;height:256px';
  canvas.dataset.spatialGpuTarget = 'true';
  document.body.append(canvas);
  const originalRaf = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  const pending = new Map(), registry = createSceneInstanceHandleRegistry();
  const events = [], samples = [], checks = [], pixelSamples = [];
  let renderer, engine, handle, activeScene, latest, latestEvents = [], sequence = 0, timestamp = 0, renders = 0, maxDrawCalls = 0;
  globalThis.requestAnimationFrame = callback => { pending.set(++sequence, callback); return sequence; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  const stage = label => { window.spriteAnimationRuntimeStage = `${preferred}:${label}`; };
  const pump = (deltaMs = 0) => {
    check(Number.isFinite(deltaMs) && deltaMs >= 0 && deltaMs <= 50, 'Test delta exceeds the real GameLoop clamp', deltaMs);
    timestamp += deltaMs;
    const callbacks = [...pending.values()];
    pending.clear();
    check(callbacks.length === 1, 'Missing or duplicate real GameLoop RAF', callbacks.length);
    for (const callback of callbacks) callback(timestamp);
  };
  const advance = deltaMs => {
    while (deltaMs > 25) { pump(25); deltaMs -= 25; }
    if (deltaMs > 0) pump(deltaMs);
  };
  const state = () => {
    const value = engine.dataSceneSpriteAnimationState(handle);
    check(value, 'Missing native animation state');
    return value;
  };
  const expect = (clip, frame, finished = false) => {
    const value = state();
    check(value.clip === clip && value.frame === frame && value.finished === finished, 'Native clip/frame/completion differs', { expected: { clip, frame, finished }, actual: value });
    samples.push({ label: window.spriteAnimationRuntimeStage, ...value });
    return value;
  };
  const update = change => check(engine.updateDataSceneSpriteAnimations([{ entity: handle, ...change }]), 'Native animation update refused', change);
  const select = clip => {
    update({ clip, restart: true, paused: false, flipX: false, flipY: false });
    pump();
    same(latestEvents, [], 'Clip selection/restart emitted initial or historical events');
  };
  const since = mark => events.slice(mark);
  const frameIndices = mark => since(mark).filter(event => event.kind === 'spriteAnimationFrame').map(event => event.payloadBits);
  const completions = mark => since(mark).filter(event => event.kind === 'spriteAnimationCompleted');
  const apply = document => {
    activeScene = document;
    handle = applyDataSceneAuthoringDocument(engine, document, { instanceHandleRegistry: registry }).entityHandles.actor;
    check(handle, 'Authored apply did not create actor');
    engine.setDataSceneCamera({ x: 0, y: 0 });
  };
  const capture = () => parseGameStateSnapshot(stringifyGameStateSnapshot(captureGameStateSnapshot(engine, {
    includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: activeScene,
  })));
  const restore = snapshot => {
    const old = handle;
    const result = restoreGameStateSnapshot(engine, snapshot, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
    check(result.dataSceneStateApplied && result.dataSceneAuthoringDocumentApplied, 'Authored save restore refused', result);
    handle = registry.get('actor');
    check(handle && (old.entityId !== handle.entityId || old.entityGeneration !== handle.entityGeneration), 'Save restore reused a stale entity handle', { old, handle });
    pump();
    same(latestEvents, [], 'Restore emitted historical frame/completion events');
  };
  const visible = async (label, frame, direction = 0, save = false) => {
    const expected = uv(frame, direction), actual = latest.uv;
    check(actual && ['u0', 'v0', 'u1', 'v1'].every(key => Math.abs(actual[key] - expected[key]) <= 1e-6), 'Actual Rust render UV differs from original atlas frame', { label, actual, expected });
    await renderer.gpuDevice?.().queue.onSubmittedWorkDone();
    const image = await pixels(renderer, canvas), expectedColor = color(frame, direction);
    const center = (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4;
    const actualColor = [...image.subarray(center, center + 4)];
    check(actualColor.every((channel, i) => Math.abs(channel - expectedColor[i]) <= 2), 'Native animated sprite pixels differ from the selected atlas cell', { label, actualColor, expectedColor });
    let matchingPixels = 0;
    for (let i = 0; i < image.length; i += 4) {
      if (expectedColor.every((channel, c) => Math.abs(channel - image[i + c]) <= 2)) matchingPixels++;
    }
    check(matchingPixels >= 1000, 'Animated sprite is absent or too small in the actual color target', { label, matchingPixels });
    pixelSamples.push({ label, frame, direction, uv: actual, rgba: actualColor, matchingPixels });
    if (save) {
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image), canvas.width, canvas.height), 0, 0);
      await window.saveAnimationRuntimeImage(`${preferred}-${label}`, copy.toDataURL());
    }
  };

  try {
    stage('setup');
    renderer = await createRenderer(canvas, { preferred, fallbackBehavior: 'silent', webgl2: { preserveDrawingBuffer: true, clearColor: [0.02, 0.02, 0.02, 1] } });
    const backend = typeof renderer.gpuDevice === 'function' ? 'webgpu' : 'webgl2';
    check(backend === preferred, 'Available requested renderer fell back unexpectedly', { preferred, backend });
    const gpuErrors = [];
    renderer.gpuDevice?.().addEventListener('uncapturederror', event => gpuErrors.push(event.error.message));
    await renderer.loadTexture(1, atlasImage(), { filter: 'nearest' });
    engine = await createEngine(frame => {
      renderer.render();
      renderer.renderCommands(frame.renderCommandBuffer);
      const stats = renderer.renderPostProcess();
      const commands = decodeRenderCommands(frame.renderCommandBuffer).filter(command => command.textureId === 1);
      check(frame.gameState === 1 && frame.entityCount === 1 && commands.length === 1, 'Animation runtime lost its Playing scene or native sprite', { gameState: frame.gameState, entityCount: frame.entityCount, commands: commands.length });
      check(stats.spriteCount === 1 && stats.drawCalls >= 1 && stats.drawCalls <= 4 && stats.textureSwitchCount <= 1, 'Animation render budget differs', stats);
      const [u0, v0, u1, v1] = commands[0].uv;
      latest = { uv: { u0, v0, u1, v1 }, gameState: frame.gameState, entities: frame.entityCount };
      latestEvents = frame.gameplayEvents.filter(event => animationKinds.has(event.kind)).map(event => ({ ...event }));
      const currentClip = engine.dataSceneSpriteAnimationState(handle)?.clip;
      for (const event of latestEvents) {
        check(event.kind !== 'spriteAnimationOverflow', 'Single actor unexpectedly overflowed the event budget', event);
        check(event.actorId === handle.entityId && event.sourceId === handle.entityId && event.actorGeneration === handle.entityGeneration && event.sourceGeneration === handle.entityGeneration && event.tokenId === currentClip && event.flags === 0, 'Animation event identity/clip/flags differ', event);
        events.push(event);
      }
      renders++;
      maxDrawCalls = Math.max(maxDrawCalls, stats.drawCalls);
      check(gpuErrors.length === 0, 'WebGPU validation errors', gpuErrors);
    }, () => ({}), undefined, () => renderer.viewportSize(), { fixedTimestep: false });
    const viewport = renderer.viewportSize();
    engine.setViewportSize(viewport.width, viewport.height);
    const set = resolveDataSceneSpriteAnimationSet(animationSet());
    apply(sceneDocument(set));
    engine.start(); pump(); pump();
    same(latestEvents, [], 'Configure emitted an initial-frame event');

    stage('90-180ms-boundaries');
    select(100);
    const forwardMark = events.length;
    await visible('timed-frame-0', 0, 0, true);
    advance(89.99); expect(100, 0);
    advance(0.02); expect(100, 1);
    await visible('timed-frame-1', 1, 0, true);
    advance(179.98); expect(100, 1);
    advance(0.02); expect(100, 0);
    same(frameIndices(forwardMark), [1, 0], '90/180ms boundaries produced incorrect original-frame events');
    same(completions(forwardMark), [], 'Looping clip emitted completion');
    checks.push('variable90And180msBoundaryPixels');

    stage('reverse');
    select(101); expect(101, 1);
    await visible('reverse-start', 1);
    const reverseMark = events.length;
    advance(179.99); expect(101, 1);
    advance(0.02); expect(101, 0);
    advance(89.98); expect(101, 0);
    advance(0.02); expect(101, 0, true);
    same(frameIndices(reverseMark), [0], 'Reverse order differs');
    check(completions(reverseMark).length === 1 && completions(reverseMark)[0].payloadBits === 0, 'Reverse completion differs');
    checks.push('reverseOriginalFrameDurations');

    stage('pingpong-final-frame-duration');
    select(103);
    const pingpongMark = events.length;
    advance(90.01); expect(103, 1);
    advance(180); expect(103, 2);
    advance(90); expect(103, 1);
    advance(180); expect(103, 0);
    await visible('pingpong-return', 0);
    advance(89.98); expect(103, 0);
    advance(0.02); expect(103, 0, true);
    same(frameIndices(pingpongMark), [1, 2, 1, 0], 'Pingpong duplicated endpoints or skipped return frames');
    check(completions(pingpongMark).length === 1 && completions(pingpongMark)[0].payloadBits === 0, 'Pingpong completion differs');
    checks.push('pingpongReturnZeroFullDuration');

    stage('single-frame');
    select(104);
    const singleMark = events.length;
    advance(89.99); expect(104, 0);
    advance(0.02); expect(104, 0, true);
    same(frameIndices(singleMark), [], 'One-frame nonloop emitted a duplicate frame');
    check(completions(singleMark).length === 1, 'One-frame nonloop completion differs');
    select(105);
    const singleLoopMark = events.length;
    advance(180.01); expect(105, 0);
    same(frameIndices(singleLoopMark), [0, 0], 'One-frame reverse loop did not report each cycle boundary');
    same(completions(singleLoopMark), [], 'One-frame loop completed');
    checks.push('singleFrameReverseAndPingpong');

    stage('intermediate-events');
    select(106); expect(106, 0);
    const multipleMark = events.length;
    pump(3); expect(106, 0);
    same(frameIndices(multipleMark), [1, 2, 0], 'Same-frame start/end lost intermediate frame events');
    pump(); same(latestEvents, [], 'Zero time duplicated prior crossings');
    checks.push('onFrameGameplayEventsPreserveIntermediateCrossings');

    stage('eight-direction-48-original-frames');
    const longClipEvidence = [];
    for (let direction = 0; direction < DIRECTIONS; direction++) {
      select(direction);
      const mark = events.length;
      pump(37.25); expect(direction, 37);
      same(frameIndices(mark), Array.from({ length: 37 }, (_, index) => index + 1), '48-frame clip skipped native crossings');
      await visible(`direction-${direction}-automatic-37`, 37, direction);
      update({ frame: 47, paused: true }); pump();
      expect(direction, 47); same(latestEvents, [], 'Seek emitted historical frame events');
      await visible(`direction-${direction}-seek-47`, 47, direction, direction === 7);
      check(!engine.updateDataSceneSpriteAnimations([{ entity: handle, frame: 48 }]), 'Native clip accepted an expanded or out-of-range frame 48');
      expect(direction, 47);
      update({ paused: false }); pump();
      const wrapMark = events.length;
      pump(2.25); expect(direction, 1);
      same(frameIndices(wrapMark), [0, 1], '48-frame native loop wrap differs');
      longClipEvidence.push({ clip: direction, originalFrames: set.clips[direction].frames.length, automaticFrame: 37, seekFrame: 47, rejectedFrame: 48 });
    }
    check(set.clips.slice(0, DIRECTIONS).reduce((n, clip) => n + clip.frames.length, 0) === 384, 'Directional frames were duplicated by authoring');
    checks.push('eightDirectionsTimes48OriginalFramesNoUvExpansion');

    stage('save-return-leg');
    select(102); advance(400.01); expect(102, 1);
    update({ flipX: true, paused: true }); pump();
    same(latestEvents, [], 'Pause/flip emitted frames');
    const returnState = state(), returnSave = capture();
    check(returnSave.dataScene.progress.instances[0].animation.elapsedSeconds > 0.36, 'Save missed pingpong return leg');
    select(100); advance(150);
    restore(returnSave);
    same(state(), returnState, 'Authored save changed phase, pause, flip or derived frame');
    same(capture().dataScene.progress, returnSave.dataScene.progress, 'Authored progress did not roundtrip exactly');
    advance(25); same(state(), returnState, 'Paused restored animation advanced');
    update({ paused: false, flipX: false }); pump();
    const resumeMark = events.length;
    advance(139.98); expect(102, 1);
    advance(0.02); expect(102, 0);
    same(frameIndices(resumeMark), [0], 'Restored return leg did not continue from its elapsed phase');
    checks.push('authoredSaveRestoresPingpongReturnPhasePauseAndFlip');

    stage('save-finished');
    select(107);
    const completedMark = events.length;
    advance(270.01); expect(107, 1, true);
    check(completions(completedMark).length === 1 && completions(completedMark)[0].payloadBits === 1, 'Finite clip completion event differs');
    const finished = state(), completedSave = capture();
    select(100); advance(100);
    restore(completedSave);
    same(state(), finished, 'Finished save did not restore completion');
    const restoredMark = events.length;
    advance(100); expect(107, 1, true);
    same(since(restoredMark), [], 'Restored finished clip emitted completion again');
    await visible('restored-finished', 1, 0, true);
    checks.push('completedSaveDoesNotDuplicateFrameOrCompletion');

    stage('legacy-fps-save');
    const legacy = { id: 200, frames: [uv(0), uv(1)], fps: 10, loop: true };
    const normalizedLegacy = resolveDataSceneSpriteAnimationSet({ clips: [legacy] });
    same(Object.keys(normalizedLegacy.clips[0]), ['id', 'frames', 'fps', 'loop'], 'Legacy normalization added new metadata defaults');
    apply(sceneDocument(normalizedLegacy)); pump();
    advance(150); expect(200, 1);
    const legacySave = capture(), legacyState = state();
    advance(25);
    restore(legacySave); same(state(), legacyState, 'Legacy fps elapsed time changed on restore');
    advance(49.99); expect(200, 1);
    advance(0.02); expect(200, 0);
    same(latestEvents, [], 'Default-disabled legacy clip emitted animation events');
    await visible('legacy-restored', 0);
    checks.push('legacyFpsNormalizationAndSaveRemainCompatible');
    if (preferred === 'webgl2') await window.saveAnimationRuntimeCanvas('webgl2-visible-canvas');
    check(gpuErrors.length === 0, 'WebGPU reported uncaptured errors', gpuErrors);

    return {
      status: 'passed', preferred, backend,
      target: backend === 'webgpu' ? 'Real software WebGPU offscreen color target; native canvas presentation is not claimed.' : 'Real WebGL2 visible canvas and readPixels.',
      checks, renders, maxDrawCalls, eventSource: 'createEngine(onFrame).gameplayEvents',
      frameEvents: events.filter(event => event.kind === 'spriteAnimationFrame').length,
      completionEvents: events.filter(event => event.kind === 'spriteAnimationCompleted').length,
      longClips: { directions: DIRECTIONS, originalFramesPerClip: FRAMES, originalAtlasCells: 384, duplicatedUvFrames: 0, clips: longClipEvidence },
      saves: { authored: true, pingpongReturnLeg: true, finished: true, legacyFps: true, spawnedActors: 'Not exercised by this authored-actor fixture.' },
      pixelSamples, samples, gpuErrors,
    };
  } finally {
    engine?.destroy();
    renderer?.destroy();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancel;
    window.disposeSpatialGpuTarget?.(canvas);
    canvas.remove();
  }
}
