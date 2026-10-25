import {
  instantiateSceneFragment,
  resolveDataSceneSpriteAnimationSet,
  type DataSceneSpriteAnimationSetSpec,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { PlacementAsepriteAsset } from "./placementAsepriteAssets";

function fail(message: string): never {
  throw new Error("Aseprite animation: " + message);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("expected an object");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number, label: string) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return fail(`${label} must be an integer in [${min}, ${max}]`);
  return value;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

type Catalog = ReturnType<typeof parseCatalog>;
const catalogs = new WeakMap<PlacementAsepriteAsset, Catalog | Error>();
/** Atlas source bytes/frames are immutable; status changes never invalidate this bounded cache. */
export function asepriteAnimationCatalog(
  asset: PlacementAsepriteAsset,
): Catalog {
  const cached = catalogs.get(asset);
  if (cached instanceof Error) throw cached;
  if (cached) return cached;
  try {
    const catalog = parseCatalog(asset);
    catalogs.set(asset, catalog);
    return catalog;
  } catch (error) {
    const diagnostic =
      error instanceof Error ? error : new Error(String(error));
    catalogs.set(asset, diagnostic);
    throw diagnostic;
  }
}
/** Raw source order is authoritative, including JSON hash export order. */
function parseCatalog(asset: PlacementAsepriteAsset) {
  const raw = record(JSON.parse(asset.jsonText.replace(/^\uFEFF/, ""))),
    meta = record(raw.meta),
    tags = meta.frameTags;
  if (!Array.isArray(tags) || !tags.length || tags.length > 64)
    fail("export 1..64 frameTags to import animations");
  const frames = Array.isArray(raw.frames)
    ? raw.frames.map((value) => {
        const frame = record(value);
        return { name: frame.filename, duration: frame.duration };
      })
    : Object.entries(record(raw.frames)).map(([name, value]) => ({
        name,
        duration: record(value).duration,
      }));
  if (frames.length !== asset.frames.length) fail("source frame count changed");
  const seen = new Set<string>();
  return tags.map((value, id) => {
    const tag = record(value),
      name = tag.name;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 256 ||
      seen.has(name)
    )
      fail("tag names must be unique, nonempty strings (max 256 characters)");
    seen.add(name);
    const from = integer(tag.from, 0, frames.length - 1, "tag.from"),
      to = integer(tag.to, from, frames.length - 1, "tag.to"),
      direction = tag.direction ?? "forward";
    // A finite Aseprite repeat count has no equivalent in the native loop boolean.
    if (tag.repeat !== undefined && tag.repeat !== 0 && tag.repeat !== "0")
      fail(`tag ${name}: finite repeat counts are unsupported`);
    if (
      !["forward", "reverse", "pingpong", "pingpong_reverse"].includes(
        String(direction),
      )
    )
      fail(`tag ${name}: unsupported direction`);
    let order = Array.from(
      { length: to - from + 1 },
      (_, index) => from + index,
    );
    if (direction === "reverse" || direction === "pingpong_reverse")
      order.reverse();
    if (direction === "pingpong" || direction === "pingpong_reverse")
      order = [...order, ...order.slice(1, -1).reverse()];
    const durations = order.map((index) =>
        integer(
          frames[index].duration,
          1,
          0xffffffff,
          `frame ${index} duration`,
        ),
      ),
      tickMs = durations.reduce(gcd),
      repeats = durations.map((ms) => ms / tickMs),
      count = repeats.reduce((a, b) => a + b, 0),
      fps = 1000 / tickMs,
      nativeFps = Math.fround(fps);
    if (count > 32)
      fail(
        `tag ${name}: exact timing requires ${count} native frames (max 32)`,
      );
    if (fps < 0.001 || nativeFps < 0.001 || nativeFps > 1000)
      fail(`tag ${name}: duration exceeds native FPS limits`);
    const sourceFrames = order.map((index) => {
        const frame = asset.frames[index];
        if (frame.id !== frames[index].name)
          fail("source frame order differs from the inspected atlas");
        return frame;
      }),
      nativeFrames = sourceFrames.flatMap((frame, index) =>
        Array.from({ length: repeats[index] }, () => ({ ...frame.uv })),
      ),
      sourceCycleMs = durations.reduce((a, b) => a + b, 0),
      nativeCycleMs = (count * 1000) / nativeFps;
    return {
      name,
      from,
      to,
      direction: String(direction),
      frameNames: sourceFrames.map((frame) => frame.id),
      durations,
      tickMs,
      repeats,
      sourceCycleMs,
      nativeFps,
      nativeCycleMs,
      nativeCycleErrorMs: nativeCycleMs - sourceCycleMs,
      clip: { id, frames: nativeFrames, fps, loop: true },
    };
  });
}
type AnimationSet = DataSceneSpriteAnimationSetSpec;
/** Native UV equality; repeated timing ticks share one normal layout entry. */
export function asepriteUvKey(frame: {
  u0?: number;
  v0?: number;
  u1?: number;
  v1?: number;
}) {
  return JSON.stringify(
    [frame.u0 ?? 0, frame.v0 ?? 0, frame.u1 ?? 1, frame.v1 ?? 1].map(
      Math.fround,
    ),
  );
}
/** The existing normal binding contract permits at most 32 distinct atlas rects. */
export function asepriteNormalLayout(visual: Record<string, unknown>) {
  const animationSet =
    visual.animationSet === undefined
      ? undefined
      : resolveDataSceneSpriteAnimationSet(visual.animationSet);
  const frames = animationSet
    ? [
        ...new Map(
          animationSet.clips
            .flatMap((clip) => clip.frames)
            .map((frame) => [asepriteUvKey(frame), frame]),
        ).values(),
      ]
    : resolveDataSceneSpriteAnimationSet({
        clips: [{ id: 0, frames: [visual.frame ?? {}], fps: 1, loop: true }],
      }).clips[0].frames;
  if (frames.length > 32)
    fail("paired normals require at most 32 unique frame UVs");
  return { frames, ...(animationSet ? { animationSet } : {}) };
}
// Compare values as consumed by the native Float32 ABI, without loop/ID policy.
function signature(clip: AnimationSet["clips"][number]) {
  return JSON.stringify([
    Math.fround(clip.fps),
    clip.frames.map((f) =>
      [f.u0 ?? 0, f.v0 ?? 0, f.u1 ?? 1, f.v1 ?? 1].map(Math.fround),
    ),
  ]);
}
function identify(catalog: Catalog, input: unknown) {
  const set = resolveDataSceneSpriteAnimationSet(input),
    seen = new Set<string>();
  const matched = set.clips.map((clip) => {
    const matches = catalog.filter(
      (tag) => signature(tag.clip) === signature(clip),
    );
    if (matches.length !== 1 || seen.has(matches[0].name))
      fail(
        "existing clips are ambiguous or manually edited; restore the source animation before reimporting",
      );
    seen.add(matches[0].name);
    return { name: matches[0].name, clip };
  });
  return { set, matched };
}
function migrate(
  old: PlacementAsepriteAsset,
  next: Catalog,
  input: unknown,
  newLoop: boolean,
) {
  const { set, matched } = identify(asepriteAnimationCatalog(old), input),
    used = new Set(matched.map(({ clip }) => clip.id));
  for (const { name } of matched)
    if (!next.some((tag) => tag.name === name))
      fail(
        `missing tag ${name}; rename/removal requires an explicit game-spec change`,
      );
  let available = 0;
  const clips = next.map((tag) => {
    const previous = matched.find((match) => match.name === tag.name);
    if (previous)
      return { ...tag.clip, id: previous.clip.id, loop: previous.clip.loop };
    while (used.has(available)) available++;
    const id = available++;
    used.add(id);
    return { ...tag.clip, id, loop: newLoop };
  });
  return resolveDataSceneSpriteAnimationSet({
    clips,
    initialClip: set.initialClip,
  });
}

/** One existing component transaction; no preview-only runtime animation state. */
export function asepriteAnimationPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  revisions: readonly PlacementAsepriteAsset[],
  next: PlacementAsepriteAsset,
  policy: { initial: string; loop: boolean; instance?: string },
  normalTexture?: string,
): ScenePlacementPatch {
  const catalog = asepriteAnimationCatalog(next),
    selected = policy.instance !== undefined,
    byAsset = new Map(
      revisions.filter((a) => a.name === next.name).map((a) => [a.id, a]),
    );
  const operations: Extract<
    ScenePlacementPatch["operations"][number],
    { kind: "updateComponents" }
  >[] = [];
  for (const instance of instantiateSceneFragment(document.sceneComposition, {
    fragment: state.fragment,
  })) {
    const value = instance.props.components;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const components = record(value),
      visualValue = components.visual;
    if (!visualValue || typeof visualValue !== "object") continue;
    const visual = record(visualValue),
      old = byAsset.get(String(visual.texture ?? visual.asset));
    if (
      selected
        ? instance.id !== policy.instance
        : !old ||
          old.id === next.id ||
          (!visual.animationSet && !visual.animation)
    )
      continue;
    if (visual.kind !== "sprite") fail("choose a sprite instance");
    if (state.lockedInstanceIds.includes(instance.id))
      fail("unlock affected instances before importing");
    if (visual.animation || components.sprite)
      fail("legacy animation requires an explicit game-spec migration");
    const billboard = document.spatial?.billboards?.[instance.id];
    if (normalTexture !== undefined && !billboard)
      fail("paired normals require HD-2D billboard targets");
    if (
      normalTexture === undefined &&
      (billboard?.normalTexture !== undefined ||
        (billboard?.normalTextureId ?? 0) !== 0)
    )
      fail("detach the normal binding or use Apply Paired/Reimport Paired");
    let animationSet: AnimationSet;
    if (visual.animationSet) {
      if (!old)
        fail(
          "existing animation is not bound to this atlas; detach it in the game spec first",
        );
      animationSet = migrate(old, catalog, visual.animationSet, policy.loop);
    } else {
      const initial = catalog.find((tag) => tag.name === policy.initial);
      if (!initial) fail("choose an initial animation tag");
      animationSet = resolveDataSceneSpriteAnimationSet({
        clips: catalog.map((tag) => ({ ...tag.clip, loop: policy.loop })),
        initialClip: initial.clip.id,
      });
    }
    identify(catalog, animationSet);
    if (normalTexture !== undefined) asepriteNormalLayout({ animationSet });
    const initial = animationSet.clips.find(
      (clip) => clip.id === animationSet.initialClip,
    )!;
    operations.push({
      kind: "updateComponents",
      instanceId: instance.id,
      components: {
        ...components,
        visual: {
          ...visual,
          texture: next.id,
          asset: next.id,
          frame: { ...initial.frames[0] },
          animationSet,
        },
      } as unknown as Extract<
        ScenePlacementPatch["operations"][number],
        { kind: "updateComponents" }
      >["components"],
    });
  }
  if (!operations.length)
    fail(
      selected
        ? "choose a sprite instance in the active fragment"
        : "no previous animated atlas references in the active fragment",
    );
  return {
    format: "ferrum2d.scene-placement.patch",
    version: normalTexture !== undefined ? 3 : 2,
    operations,
    ...(normalTexture !== undefined
      ? {
          spatial: {
            format: "ferrum2d.scene-spatial.patch" as const,
            version: 4 as const,
            operations: operations.map((op) => ({
              kind: "setBillboardNormalTexture" as const,
              id: op.instanceId,
              changes: { normalTexture },
            })),
          },
        }
      : {}),
  };
}

/** Reconstructed from durable raw sources + current scene, so Undo/reopen cannot leave stale evidence. */
export function asepriteAnimationEvidence(
  document: SceneAuthoringDocumentSpec,
  state: Pick<ScenePlacementViewerState, "fragment">,
  revisions: readonly PlacementAsepriteAsset[],
) {
  return instantiateSceneFragment(document.sceneComposition, {
    fragment: state.fragment,
  }).flatMap((instance) => {
    const components = instance.props.components as
        | Record<string, unknown>
        | undefined,
      visual = components?.visual as Record<string, unknown> | undefined,
      asset = revisions.find(
        (a) => a.id === (visual?.texture ?? visual?.asset),
      );
    if (!asset || !visual?.animationSet) return [];
    try {
      const catalog = asepriteAnimationCatalog(asset),
        { set, matched } = identify(catalog, visual.animationSet);
      return [
        {
          instance: instance.id,
          fragment: state.fragment,
          assetId: asset.id,
          jsonSha256: asset.jsonSha256,
          initialClip: set.initialClip,
          tags: matched.map(({ name, clip }) => {
            const { clip: _source, ...timing } = catalog.find(
              (tag) => tag.name === name,
            )!;
            return { ...timing, id: clip.id, loop: clip.loop };
          }),
        },
      ];
    } catch {
      return [];
    } // User-edited specs are not claimed as verified imported animations.
  });
}
