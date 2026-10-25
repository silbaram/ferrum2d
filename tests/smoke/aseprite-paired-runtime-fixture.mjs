import { applyDataSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";

const check = (value, message) => {
  if (!value) throw Error(message);
};
/** Compare real animated color/normal sampling to independently applied static UVs. */
export function verifyPairedPlayback(engine, scene, pump, read) {
  const instance = scene.sceneComposition.fragments.main.instances.find(
      (i) => i.props.components.visual.animationSet,
    ),
    set = instance.props.components.visual.animationSet,
    clip = set.clips.find((c) => c.id === set.initialClip),
    handles = applyDataSceneAuthoringDocument(engine, scene).entityHandles;
  check(!clip.loop, "Paired probe requires a finite native clip");
  engine.pauseDataScene();
  pump(0);
  pump(0);
  check(engine.resumeDataScene(), "Paired native resume failed");
  const samples = new Map(),
    visited = new Set(),
    duration = (clip.frames.length * 1000) / clip.fps;
  for (let elapsed = 10; elapsed <= duration + 50; elapsed += 10) {
    pump(elapsed);
    const state = engine.dataSceneSpriteAnimationState(handles[instance.id]),
      phase = (elapsed / 1000) * Math.fround(clip.fps),
      expected = Math.min(Math.floor(phase + 1e-5), clip.frames.length - 1);
    check(state.clip === clip.id, "Paired native clip ID differs");
    if (Math.abs(phase - Math.round(phase)) > 1e-4)
      check(state.frame === expected, `Paired timing differs at ${elapsed}ms`);
    visited.add(state.frame);
    const frame = clip.frames[state.frame],
      key = JSON.stringify(frame);
    if (!samples.has(key)) samples.set(key, { frame, pixels: read() });
  }
  check(
    engine.dataSceneSpriteAnimationState(handles[instance.id]).finished,
    "Paired animation did not finish",
  );
  check(samples.size >= 2, "Paired native probe did not visit distinct UVs");
  const lighting = [];
  for (const { frame, pixels } of samples.values()) {
    const expected = structuredClone(scene),
      visual = expected.sceneComposition.fragments.main.instances.find(
        (i) => i.id === instance.id,
      ).props.components.visual;
    delete visual.animationSet;
    visual.frame = frame;
    applyDataSceneAuthoringDocument(engine, expected);
    engine.pauseDataScene();
    pump(0);
    pump(0);
    const actual = read();
    check(
      actual.every((v, i) => v === pixels[i]),
      "Animated color/normal UV differs from static frame rendering",
    );
    delete expected.spatial.billboards[instance.id].normalTexture;
    applyDataSceneAuthoringDocument(engine, expected);
    engine.pauseDataScene();
    pump(0);
    pump(0);
    const flat = read();
    let changed = 0,
      colored = 0;
    for (let i = 0; i < flat.length; i += 4) {
      if ([0, 1, 2].some((c) => Math.abs(pixels[i + c] - flat[i + c]) > 5))
        changed++;
      if (
        Math.max(...pixels.subarray(i, i + 3)) -
          Math.min(...pixels.subarray(i, i + 3)) >
        30
      )
        colored++;
    }
    check(
      changed > 100 && colored > 100,
      "Paired frame lost visible color or normal lighting",
    );
    lighting.push({ changedPixels: changed, coloredPixels: colored });
  }
  return {
    finished: true,
    clip: clip.id,
    visitedFrames: visited.size,
    uvMatches: samples.size,
    lighting,
  };
}
