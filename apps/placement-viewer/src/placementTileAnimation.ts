import {
  resolveDataSceneSpriteAnimationSet,
  type DataSceneSpriteAnimationSetSpec,
} from "@ferrum2d/ferrum-web/authoring";
import type { PlacementTileAsset } from "./placementTileAssets";
import { resolveTileDependencies, tileJson } from "./placementTileDependencies";
import { selectTileSource } from "./placementTileSelection";
import { tileRulePalette } from "./placementTileRulePalette";

export interface TileMapAnimation {
  frames: readonly { frame: string; durationMs: number }[];
  loop?: boolean;
}
export type TileMapAnimations = "source" | Readonly<Record<string, TileMapAnimation>>;
export const TILE_ANIMATION_LIMITS = { clips: 64, frames: 256, totalFrames: 1024, placedFrames: 8192 } as const;
type Frame = PlacementTileAsset["frames"][number];
interface CompiledAnimation { animationSet: DataSceneSpriteAnimationSetSpec; frames: readonly Frame[] }
const cache = new WeakMap<PlacementTileAsset, { signature: string; result: ReadonlyMap<string, CompiledAnimation> }>();

function fail(message: string): never { throw Error("Tile animation: " + message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail("unknown field " + key);
}
function duration(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1_000_000)
    fail("durationMs must be an integer in [1, 1000000]");
  return value;
}

/** Cold conversion only. Playback uses the existing native animationSet clock. */
export function compileTileMapAnimations(asset: PlacementTileAsset, value: unknown, baseFrames: readonly Frame[]): ReadonlyMap<string, CompiledAnimation> {
  const signature = JSON.stringify({ defined: value !== undefined, value, frames: baseFrames.map(frame => frame.id) });
  const old = cache.get(asset);
  if (old?.signature === signature) return old.result;
  const raw = resolveTileDependencies(tileJson(asset.json), asset.kind, asset.dependencies ?? []).input;
  const { set } = selectTileSource(raw, asset.kind, asset.selection?.key, asset.levelIndex);
  const source = new Map<string, unknown>();
  if (asset.kind === "tiled") {
    const tiles = set.tiles ?? [];
    if (!Array.isArray(tiles)) fail("source tiles must be an array");
    for (const input of tiles) {
      const tile = record(input);
      if (tile.animation === undefined) continue;
      if (typeof tile.id !== "number" || !Number.isSafeInteger(tile.id) || tile.id < 0 || source.has(`${set.name}.${tile.id}`))
        fail("invalid or duplicate source animation tile id");
      source.set(`${set.name}.${tile.id}`, tile.animation);
    }
  }
  const definitions = new Map<string, TileMapAnimation>();
  let total = 0;
  const add = (name: string, steps: unknown, loop: unknown, fromSource: boolean) => {
    if (!name || name.length > 256 || definitions.size >= TILE_ANIMATION_LIMITS.clips) fail("at most 64 named clips");
    if (loop !== undefined && typeof loop !== "boolean") fail("loop must be boolean");
    if (!Array.isArray(steps) || !steps.length || steps.length > TILE_ANIMATION_LIMITS.frames) fail("clip requires 1..256 frames");
    total += steps.length;
    if (total > TILE_ANIMATION_LIMITS.totalFrames) fail("clips exceed 1024 frames in total");
    const frames = steps.map(value => {
      const step = record(value);
      keys(step, fromSource ? ["tileid", "duration"] : ["frame", "durationMs"]);
      if (fromSource && (typeof step.tileid !== "number" || !Number.isSafeInteger(step.tileid) || step.tileid < 0)) fail("invalid tileset-local tileid");
      const frame = fromSource ? `${set.name}.${step.tileid}` : step.frame;
      if (typeof frame !== "string" || !frame || frame.length > 256) fail("invalid frame name");
      return { frame, durationMs: duration(fromSource ? step.duration : step.durationMs) };
    });
    definitions.set(name, { frames, loop: loop !== false });
  };
  if (value === "source") {
    if (asset.kind !== "tiled") fail('animations: "source" requires Tiled; define named clips for LDtk');
    if (!source.size) fail("source tileset has no animations");
    for (const [name, frames] of source) add(name, frames, true, true);
  } else if (value !== undefined) {
    for (const [name, input] of Object.entries(record(value))) {
      const spec = record(input); keys(spec, ["frames", "loop"]);
      add(name, spec.frames, spec.loop, false);
    }
  }
  for (const name of source.keys()) if (!definitions.has(name))
    fail('animated Tiled tiles require animations: "source" or an explicit clip for ' + name);
  const names = new Set(baseFrames.map(frame => frame.id));
  for (const [name, clip] of definitions) { names.add(name); for (const step of clip.frames) names.add(step.frame); }
  const frames = new Map(tileRulePalette(asset, names).frames.map(frame => [frame.id, frame]));
  const result = new Map<string, CompiledAnimation>();
  for (const [name, clip] of definitions) {
    const base = frames.get(name)!;
    const resolved = clip.frames.map(step => {
      const frame = frames.get(step.frame)!;
      if (frame.width !== base.width || frame.height !== base.height) fail("frames must match the base tile size");
      return frame;
    });
    const animationSet = resolveDataSceneSpriteAnimationSet({ initialClip: 0, clips: [{
      id: 0, frames: resolved.map(frame => frame.uv), frameDurationsMs: clip.frames.map(step => step.durationMs),
      loop: clip.loop, emitEvents: false,
    }] });
    result.set(name, { animationSet, frames: resolved });
  }
  cache.set(asset, { signature, result });
  return result;
}
