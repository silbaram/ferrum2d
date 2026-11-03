import { applyTileRules, type TileRuleSpec, type TileRuleNeighborMatch, type TileRuleCellMatch } from "@ferrum2d/ferrum-web";
import type { PlacementTileAsset } from "./placementTileAssets";
import { tileRulePalette } from "./placementTileRulePalette";

type Match = string | readonly string[];
export interface TileMapRule {
  output: string | null;
  match?: Match;
  neighbors?: Partial<Record<"n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw", Match>>;
}
export interface TileMapRuleLayer {
  rules: readonly TileMapRule[];
  preserveUnmatched?: boolean;
  emptyOutOfBounds?: boolean;
}
export type TileMapRules = Readonly<Record<string, TileMapRuleLayer>>;
export const TILE_RULE_LIMITS = { bytes: 8192, rules: 64, matches: 16, work: 2_000_000 } as const;
interface BakedRules { layers: ReadonlyMap<string, readonly number[]>; palette: ReturnType<typeof tileRulePalette> }
const cache = new WeakMap<PlacementTileAsset, { signature: string; result: BakedRules }>();
function fail(path: string, message: string): never { throw Error(`Autotile ${path}: ${message}`); }
function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path, "unknown field " + key);
}

/** Cold, deterministic bake from the original grid. No source/runtime mutation. */
export function bakeTileMapRules(asset: PlacementTileAsset, value: unknown): BakedRules {
  if (value === undefined) return {layers: new Map(), palette: {tiles: asset.imported.tilemap.tiles ?? {}, frames: asset.frames}};
  const signature = JSON.stringify(value);
  if (new TextEncoder().encode(signature).byteLength > TILE_RULE_LIMITS.bytes)
    fail("options", "rules exceed 8 KiB");
  const old = cache.get(asset);
  if (old?.signature === signature) return old.result;
  const config = record(value, "layers"), source = asset.imported.tilemap;
  const layers = source.layers ?? [], names = layers.map((layer, index) => layer.name ?? "layer-" + index);
  if (Object.keys(config).length > 16) fail("layers", "at most 16 layers");
  const referenced = new Set<string>();
  const collect = (value: unknown) => {
    for (const item of Array.isArray(value) ? value : [value])
      if (typeof item === "string" && !["any", "empty", "filled", "same"].includes(item)) referenced.add(item);
  };
  for (const value of Object.values(config)) {
    const layer = record(value, "layer");
    if (!Array.isArray(layer.rules)) fail("rules", "expected an array");
    for (const value of layer.rules) {
      const rule = record(value, "rule"); collect(rule.output); collect(rule.match);
      for (const value of Object.values(rule.neighbors === undefined ? {} : record(rule.neighbors, "neighbors"))) collect(value);
    }
  }
  const palette = tileRulePalette(asset, referenced);
  const frameIds = new Map<string, number>();
  for (const [id, tile] of Object.entries(palette.tiles)) {
    if (!tile.frame) continue;
    if (frameIds.has(tile.frame)) fail("frames", "ambiguous frame " + tile.frame);
    frameIds.set(tile.frame, Number(id));
  }
  const frameId = (value: unknown, path: string): number => {
    if (typeof value !== "string" || !frameIds.has(value) || !palette.frames.some(frame => frame.id === value))
      fail(path, "unknown frame " + String(value));
    return frameIds.get(value)!;
  };
  const match = (value: unknown, path: string, neighbor: boolean): TileRuleNeighborMatch => {
    if (value === "any" || value === "empty" || value === "filled" || neighbor && value === "same") return value;
    if (Array.isArray(value)) {
      if (!value.length || value.length > TILE_RULE_LIMITS.matches) fail(path, "match list must contain 1..16 frames");
      return value.map(item => frameId(item, path));
    }
    return frameId(value, path);
  };
  const result = new Map<string, readonly number[]>();
  let count = 0, work = 0;
  // Validate every layer and its budget before evaluating any grid.
  const jobs = Object.entries(config).map(([name, value]) => {
    const index = names.indexOf(name);
    if (index < 0) fail(name, "unknown layer");
    const layer = layers[index], settings = record(value, name);
    keys(settings, ["rules", "preserveUnmatched", "emptyOutOfBounds"], name);
    for (const key of ["preserveUnmatched", "emptyOutOfBounds"])
      if (settings[key] !== undefined && typeof settings[key] !== "boolean") fail(name, key + " must be boolean");
    if (!Array.isArray(settings.rules) || (count += settings.rules.length) > TILE_RULE_LIMITS.rules)
      fail(name, "at most 64 rules in total");
    let cost = 0;
    const rules: TileRuleSpec[] = settings.rules.map((value, index) => {
      const path = name + ".rules[" + index + "]", rule = record(value, path);
      keys(rule, ["output", "match", "neighbors"], path);
      const neighbors = rule.neighbors === undefined ? {} : record(rule.neighbors, path + ".neighbors");
      keys(neighbors, ["n", "e", "s", "w", "ne", "se", "sw", "nw"], path);
      cost += 1 + (Array.isArray(rule.match) ? rule.match.length : 1);
      const compiled: TileRuleSpec = {
        output: rule.output === null ? 0 : frameId(rule.output, path + ".output"),
        match: match(rule.match === undefined ? "filled" : rule.match, path + ".match", false) as TileRuleCellMatch,
        neighbors: {},
      };
      for (const [direction, value] of Object.entries(neighbors)) {
        cost += 1 + (Array.isArray(value) ? value.length : 1);
        // keys() above limits this to the eight directions understood by the shared helper.
        compiled.neighbors![direction as keyof NonNullable<TileRuleSpec["neighbors"]>] = match(value, path + "." + direction, true);
      }
      return compiled;
    });
    work += (layer.data?.length ?? 0) * Math.max(1, cost);
    if (work > TILE_RULE_LIMITS.work) fail(name, "rule work exceeds 2000000; simplify rules or split the map");
    return { name, layer, rules, preserveUnmatched: settings.preserveUnmatched !== false, emptyOutOfBounds: settings.emptyOutOfBounds !== false };
  });
  for (const job of jobs) result.set(job.name, applyTileRules({ columns: job.layer.columns!, rows: job.layer.rows!, data: job.layer.data! }, job.rules, {
    preserveUnmatched: job.preserveUnmatched, emptyOutOfBounds: job.emptyOutOfBounds, path: "autotile." + job.name,
  }));
  const baked = {layers: result, palette};
  cache.set(asset, { signature, result: baked });
  return baked;
}
