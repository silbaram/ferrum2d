import type { Engine } from "../pkg/ferrum_core.js";
import type { ColorManagementMode } from "./colorManagement.js";
import type { DataSceneSpriteFrameSpec, DataSceneTextureRefSpec } from "./dataSceneComponents.js";
import { dataSceneVisualColor } from "./dataSceneVisualColor.js";

export interface DataSceneCollisionTileVisual {
  /** Loaded texture name or an exact float32 texture ID (0..16777215). */
  texture: DataSceneTextureRefSpec;
  frame?: DataSceneSpriteFrameSpec;
  /** sRGB hex color, compiled into the renderer working space. */
  tint?: string;
}

export interface DataSceneCollisionTileDefinition {
  id: number;
  floorId?: number;
  elevation?: number;
  height?: number;
  kind?: "flat" | "stair" | "ramp" | "bridge" | "ledge";
  blocksMovement?: boolean;
  blocksProjectile?: boolean;
  blocksVision?: boolean;
  occluderHeight?: number;
  ramp?: { axis: "x" | "y"; startElevation: number; endElevation: number };
  /** Opt-in cell-sized graphic in the existing planar tile background layer. */
  visual?: DataSceneCollisionTileVisual;
}

/** One bounded planar grid. Definitions without visual stay collision-only. */
export interface DataSceneCollisionTilemapOptions {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  originX?: number;
  originY?: number;
  tiles: readonly number[] | Uint32Array;
  definitions: readonly DataSceneCollisionTileDefinition[];
}

export interface DataSceneCollisionTilemapCompileOptions {
  /** Cold texture name resolution; required when a visual uses a name. */
  textureId?: (name: string) => number;
  colorManagement?: ColorManagementMode;
}

export interface EncodedDataSceneCollisionTilemap {
  version: 1 | 2;
  /** Original v1 collision packet; its layout is unchanged by visuals. */
  metadata: Uint32Array;
  values: Float32Array;
  cells: Uint32Array;
  /** v2: [2, count, tileId, textureId, ...], with 8 float values per entry. */
  visualMetadata: Uint32Array;
  visualValues: Float32Array;
}

interface GraphicalTilemapNative extends Pick<Engine, "configure_data_scene_collision_tilemap"> {
  data_scene_collision_tilemap_version?(): number;
  configure_data_scene_collision_tilemap_v2?(metadata: Uint32Array, values: Float32Array,
    cells: Uint32Array, visualMetadata: Uint32Array, visualValues: Float32Array): boolean;
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`${path}.${key} is not supported`);
  return value as Record<string, unknown>;
}
function integer(value: unknown, max: number, path: string, min = 0): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${path} must be an integer in ${min}..${max}`);
  return value;
}
function number(value: unknown, path: string, min = -1e6): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)) || value < min || value > 1e6) throw new Error(`${path} is outside the finite float32 range`);
  return Math.fround(value);
}
function flag(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${path} must be boolean`);
  return value;
}

export function encodeDataSceneCollisionTilemap(options: DataSceneCollisionTilemapOptions | false,
  compile: DataSceneCollisionTilemapCompileOptions = {}): EncodedDataSceneCollisionTilemap {
  if (options === false) return { version: 1, metadata: new Uint32Array(), values: new Float32Array(), cells: new Uint32Array(),
    visualMetadata: new Uint32Array(), visualValues: new Float32Array() };
  const s = record(options, ["columns", "rows", "tileWidth", "tileHeight", "originX", "originY", "tiles", "definitions"], "collisionTilemap");
  const columns = integer(s.columns, 256, "columns", 1), rows = integer(s.rows, 256, "rows", 1);
  const width = number(s.tileWidth, "tileWidth", 0), height = number(s.tileHeight, "tileHeight", 0);
  const x = number(s.originX ?? 0, "originX"), y = number(s.originY ?? 0, "originY");
  if (width <= 0 || height <= 0 || Math.abs(Math.fround(x + columns * width)) > 1e6 || Math.abs(Math.fround(y + rows * height)) > 1e6) throw new Error("collisionTilemap bounds are invalid");
  if (!Array.isArray(s.definitions) || s.definitions.length > 256) throw new Error("definitions must contain at most256 entries");
  const metadata = [columns, rows, s.definitions.length], values = [width, height, x, y];
  const visualMetadata: number[] = [], visualValues: number[] = [];
  const ids = new Set<number>();
  for (const definition of s.definitions) {
    const d = record(definition, ["id", "floorId", "elevation", "height", "kind", "blocksMovement", "blocksProjectile", "blocksVision", "occluderHeight", "ramp", "visual"], "definition");
    const id = integer(d.id, 256, "tile id", 1);
    if (ids.has(id)) throw new Error("duplicate collision tile id"); ids.add(id);
    const elevation = number(d.elevation ?? 0, "elevation"), bodyHeight = number(d.height ?? 0, "height", 0);
    if (Math.abs(Math.fround(elevation + bodyHeight)) > 1e6) throw new Error("tile height span exceeds native bounds");
    const kind = d.kind ?? "flat", kinds = ["flat", "stair", "ramp", "ledge", "bridge"];
    if (typeof kind !== "string") throw new Error("tile kind must be a string");
    const code = kinds.indexOf(kind);
    if (code < 0 || (kind === "ramp") !== (d.ramp !== undefined)) throw new Error("ramp metadata requires kind ramp");
    const ramp = d.ramp === undefined ? undefined : record(d.ramp, ["axis", "startElevation", "endElevation"], "ramp");
    if (ramp && ramp.axis !== "x" && ramp.axis !== "y") throw new Error("ramp.axis must be x or y");
    const movement = flag(d.blocksMovement, true, "blocksMovement");
    const flags = Number(movement) | (Number(flag(d.blocksProjectile, movement, "blocksProjectile")) << 1)
      | (Number(flag(d.blocksVision, movement, "blocksVision")) << 2) | (Number(ramp !== undefined) << 3);
    metadata.push(id, integer(d.floorId ?? 0, 0xffffffff, "floorId"), code, flags, ramp?.axis === "y" ? 1 : 0);
    values.push(elevation, bodyHeight, number(d.occluderHeight ?? bodyHeight, "occluderHeight", 0),
      ramp ? number(ramp.startElevation, "ramp.startElevation") : 0, ramp ? number(ramp.endElevation, "ramp.endElevation") : 0);
    if (d.visual !== undefined) {
      const path = `definition.${id}.visual`, visual = record(d.visual, ["texture", "frame", "tint"], path);
      let texture: unknown = visual.texture;
      if (typeof texture === "string") {
        if (texture.length === 0) throw new Error(`${path}.texture requires a non-empty asset name`);
        if (!compile.textureId) throw new Error(`${path}.texture requires a textureId resolver`);
        texture = compile.textureId(texture);
      }
      const textureId = integer(texture, 0xffffff, `${path}.texture`);
      const frame = visual.frame === undefined ? {} : record(visual.frame, ["u0", "v0", "u1", "v1"], `${path}.frame`);
      const uv = [frame.u0 ?? 0, frame.v0 ?? 0, frame.u1 ?? 1, frame.v1 ?? 1].map((v, i) => {
        const n = number(v, `${path}.frame.${["u0", "v0", "u1", "v1"][i]}`, 0);
        if (n > 1) throw new Error(`${path}.frame must contain normalized UVs`);
        return n;
      });
      if (uv[2] <= uv[0] || uv[3] <= uv[1]) throw new Error(`${path}.frame must have positive UV extents after float32 conversion`);
      if (visual.tint !== undefined && typeof visual.tint !== "string") throw new Error(`${path}.tint must be a hex color`);
      const color = dataSceneVisualColor(visual.tint, `${path}.tint`, compile.colorManagement);
      visualMetadata.push(id, textureId);
      visualValues.push(...uv, ...color);
    }
  }
  if ((!Array.isArray(s.tiles) && !(s.tiles instanceof Uint32Array)) || s.tiles.length !== columns * rows) throw new Error("tiles must match columns*rows");
  const cells = Uint32Array.from(s.tiles, value => {
    const id = integer(value, 256, "tile reference");
    if (id !== 0 && !ids.has(id)) throw new Error("tile references an undefined definition");
    return id;
  });
  const version = visualMetadata.length ? 2 : 1;
  return { version, metadata: new Uint32Array(metadata), values: new Float32Array(values), cells,
    visualMetadata: new Uint32Array(version === 2 ? [2, visualMetadata.length / 2, ...visualMetadata] : []),
    visualValues: new Float32Array(visualValues) };
}

/** Syntax/bounds validation only. Asset availability is checked by the cold compiler. */
export function validateDataSceneCollisionTilemap(options: DataSceneCollisionTilemapOptions): void {
  encodeDataSceneCollisionTilemap(options, { textureId: () => 0 });
}

/** Applies the exact preflighted packet without resolving names again during publication. */
export function configureEncodedDataSceneCollisionTilemap(native: Engine, packet: EncodedDataSceneCollisionTilemap): boolean {
  if (packet.version !== 1 && packet.version !== 2) throw new Error("Unsupported Data Scene tilemap packet version");
  if (packet.version === 1 && (packet.visualMetadata.length || packet.visualValues.length))
    throw new Error("Data Scene tile graphics require packet version 2");
  if (packet.version === 2) {
    const graphics: GraphicalTilemapNative = native;
    if (graphics.data_scene_collision_tilemap_version?.() !== 2 || typeof graphics.configure_data_scene_collision_tilemap_v2 !== "function")
      throw new Error("This Wasm core does not support Data Scene graphical tilemaps v2");
    return graphics.configure_data_scene_collision_tilemap_v2(packet.metadata, packet.values, packet.cells, packet.visualMetadata, packet.visualValues);
  }
  if (typeof native.configure_data_scene_collision_tilemap !== "function") throw new Error("This Wasm core does not support Data Scene collision tilemaps");
  return native.configure_data_scene_collision_tilemap(packet.metadata, packet.values, packet.cells);
}

export function configureDataSceneCollisionTilemap(native: Engine, options: DataSceneCollisionTilemapOptions | false,
  compile: DataSceneCollisionTilemapCompileOptions = {}): boolean {
  return configureEncodedDataSceneCollisionTilemap(native, encodeDataSceneCollisionTilemap(options, compile));
}
