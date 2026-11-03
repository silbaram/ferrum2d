import {
  instantiateSceneFragment,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementPatch,
  type ScenePlacementViewerState,
} from "@ferrum2d/ferrum-web/authoring";
import type { PlacementAsepriteAsset } from "./placementAsepriteAssets";

interface Rect { x: number; y: number; w: number; h: number }
export interface AsepriteSliceKey {
  frame: number;
  bounds: Rect;
  pivot?: { x: number; y: number };
  center?: Rect;
}
export interface AsepriteSlice { name: string; keys: AsepriteSliceKey[] }
function fail(message: string): never { throw Error("Aseprite slices: " + message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    fail("coordinates and key frames must be bounded integers");
  return value;
}
function rect(value: unknown, negative: boolean): Rect {
  const r = record(value);
  return { x: integer(r.x, negative ? -4096 : 0, 4096), y: integer(r.y, negative ? -4096 : 0, 4096), w: integer(r.w, 1, 4096), h: integer(r.h, 1, 4096) };
}
const catalogs = new WeakMap<PlacementAsepriteAsset, AsepriteSlice[] | Error>();
/** Derive from immutable source JSON; no catalog version or runtime metadata is added. */
export function asepriteSliceCatalog(asset: PlacementAsepriteAsset): readonly AsepriteSlice[] {
  const old = catalogs.get(asset);
  if (old instanceof Error) throw old;
  if (old) return old;
  try {
    const raw = record(JSON.parse(asset.jsonText.replace(/^\uFEFF/, ""))), values = record(raw.meta).slices;
    if (values === undefined) { catalogs.set(asset, []); return []; }
    if (!Array.isArray(values) || values.length > 64) fail("export at most 64 slices");
    const names = new Set<string>();
    let count = 0;
    const slices = values.map(value => {
      const slice = record(value), name = slice.name;
      if (typeof name !== "string" || !name.trim() || name.length > 256 || names.has(name))
        fail("slice names must be unique, nonempty strings (max 256 characters)");
      names.add(name);
      const keys = slice.keys === undefined ? [] : slice.keys;
      if (!Array.isArray(keys) || (count += keys.length) > 256) fail("export at most 256 slice keys in total");
      let previous = -1;
      return { name, keys: keys.map(value => {
        const key = record(value), frame = integer(key.frame, 0, 65535), bounds = rect(key.bounds, true);
        if (frame <= previous) fail("slice key frames must be strictly increasing");
        previous = frame;
        const pivot = key.pivot === undefined ? undefined : record(key.pivot);
        const center = key.center === undefined ? undefined : rect(key.center, false);
        if (center && (center.x + center.w > bounds.w || center.y + center.h > bounds.h))
          fail("nine-slice center must fit inside slice bounds");
        return { frame, bounds,
          ...(pivot ? { pivot: { x: integer(pivot.x, -4096, 4096), y: integer(pivot.y, -4096, 4096) } } : {}),
          ...(center ? { center } : {}),
        };
      }) };
    });
    catalogs.set(asset, slices);
    return slices;
  } catch (cause) {
    const error = cause instanceof Error ? cause : Error(String(cause));
    catalogs.set(asset, error); throw error;
  }
}

/** The key frame is explicitly chosen: export order is not a source timeline mapping. */
export function asepriteSliceOrigin(asset: PlacementAsepriteAsset, slice: string, keyFrame: number, frameId: string) {
  const key = asepriteSliceCatalog(asset).find(value => value.name === slice)?.keys.find(value => value.frame === keyFrame);
  const frame = asset.frames.find(value => value.id === frameId);
  if (!key || !frame) fail("choose a slice key and imported frame");
  const b = key.bounds;
  if (b.x < 0 || b.y < 0 || b.x + b.w > frame.width || b.y + b.h > frame.height)
    fail("slice bounds must fit the selected source canvas");
  const point = key.pivot ? { x: b.x + key.pivot.x, y: b.y + key.pivot.y } : undefined;
  return { ...key, canvasWidth: frame.width, canvasHeight: frame.height, point,
    ...(point ? { origin: { x: point.x / frame.width, y: point.y / frame.height } } : {}),
  };
}

/** Change only the selected sprite's origin, using the normal single-transaction patch. */
export function asepriteSlicePivotPatch(
  document: SceneAuthoringDocumentSpec,
  state: ScenePlacementViewerState,
  asset: PlacementAsepriteAsset,
  selection: { slice: string; keyFrame: number; frame: string },
): ScenePlacementPatch {
  const source = asepriteSliceOrigin(asset, selection.slice, selection.keyFrame, selection.frame);
  if (!source.origin) fail("the selected slice key has no pivot");
  const id = state.selectedInstanceId;
  if (!id || state.selectedInstanceIds.length > 1) fail("select one imported sprite");
  if (state.lockedInstanceIds.includes(id)) fail("unlock the selected sprite");
  const instance = instantiateSceneFragment(document.sceneComposition, { fragment: state.fragment }).find(value => value.id === id);
  if (!instance) fail("select a sprite in the active fragment");
  const components = record(instance.props.components), visual = record(components.visual);
  if (visual.kind !== "sprite" || components.sprite) fail("select a visual sprite without a legacy sprite component");
  if ((visual.texture ?? visual.asset) !== asset.id) fail("apply this atlas to the selected sprite first");
  const frame = asset.frames.find(value => value.id === selection.frame)!;
  const sameUv = (a: unknown, b: typeof frame.uv) => {
    const uv = a === undefined ? {} : record(a);
    return (["u0", "v0", "u1", "v1"] as const).every(key => (uv[key] ?? (key.endsWith("1") ? 1 : 0)) === b[key]);
  };
  if (visual.animationSet || visual.animation) {
    const clips = visual.animationSet ? record(visual.animationSet).clips : [visual.animation];
    if (!Array.isArray(clips) || !clips.length) fail("animation clips are missing");
    for (const clip of clips) {
      const frames = record(clip).frames;
      if (!Array.isArray(frames) || !frames.length) fail("animation frames are missing");
      for (const uv of frames) {
        const match = asset.frames.filter(value => sameUv(uv, value.uv));
        if (!match.length || match.some(value => value.width !== source.canvasWidth || value.height !== source.canvasHeight))
          fail("animated origins require known frames with the same source canvas");
      }
    }
  } else if (!sameUv(visual.frame, frame.uv)) fail("choose the frame currently used by the selected sprite");
  type Components = Extract<ScenePlacementPatch["operations"][number], {kind: "updateComponents"}>["components"];
  return { format: "ferrum2d.scene-placement.patch", version: 2, operations: [{
    kind: "updateComponents", instanceId: id,
    components: { ...components, visual: { ...visual, originX: source.origin.x, originY: source.origin.y } } as Components,
  }] };
}
