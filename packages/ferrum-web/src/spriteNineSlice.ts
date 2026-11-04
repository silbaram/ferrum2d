import type { Engine } from "../pkg/ferrum_core";
import type { GameplayEntityHandle } from "./gameplayAuthoring.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

/** Pixel dimensions refer to the selected UV frame, not the full atlas. */
export interface SpriteNineSliceSpec {
  sourceWidth: number;
  sourceHeight: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** World units per border pixel; multiplied by the authored instance scale. */
  borderScale?: number;
  flipX?: boolean;
  flipY?: boolean;
}
export interface SpriteNineSliceUpdate {
  entity: GameplayEntityHandle;
  /** Omit to restore ordinary sprite stretching. */
  nineSlice?: SpriteNineSliceSpec;
}
export const MAX_SPRITE_NINE_SLICE_UPDATES = 65_536;
const dimensions = ["sourceWidth", "sourceHeight", "left", "right", "top", "bottom"] as const;

export function resolveSpriteNineSlice(value: unknown, path = "nineSlice"): Required<SpriteNineSliceSpec> {
  const fail = (key: string, reason: string): never => { throw sceneCompositionDiagnosticError(`${path}${key ? "." + key : ""}`, reason); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("", "must be a 9-slice descriptor");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (![...dimensions, "borderScale", "flipX", "flipY"].includes(key)) fail(key, "unknown 9-slice property");
  for (const key of dimensions) {
    const n = input[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < (key.startsWith("source") ? 1 : 0) || n > 16_384) fail(key, "must be an integer source pixel value within 0..16384 (dimensions at least 1)");
  }
  const spec = input as unknown as SpriteNineSliceSpec;
  if (spec.left + spec.right >= spec.sourceWidth || spec.top + spec.bottom >= spec.sourceHeight) fail("", "borders must leave a positive source center");
  const scale = spec.borderScale === undefined ? 1 : spec.borderScale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || Math.fround(scale) <= 0 || scale > 65_536) fail("borderScale", "must fit a positive f32 at most 65536");
  for (const key of ["flipX", "flipY"] as const) if (input[key] !== undefined && typeof input[key] !== "boolean") fail(key, "must be boolean");
  return { sourceWidth: spec.sourceWidth, sourceHeight: spec.sourceHeight, left: spec.left, right: spec.right, top: spec.top, bottom: spec.bottom,
    borderScale: scale, flipX: spec.flipX ?? false, flipY: spec.flipY ?? false };
}

type NineSliceExports = {
  sprite_nine_slice_abi_version(): number;
  configure_sprite_nine_slices(handles: Uint32Array, values: Float32Array): boolean;
};
export function supportsSpriteNineSlices(engine: Engine): engine is Engine & NineSliceExports {
  const e = engine as Engine & Partial<NineSliceExports>;
  return typeof e.sprite_nine_slice_abi_version === "function" && e.sprite_nine_slice_abi_version() === 1 && typeof e.configure_sprite_nine_slices === "function";
}
export function configureSpriteNineSlices(engine: Engine, updates: readonly SpriteNineSliceUpdate[]): boolean {
  if (!supportsSpriteNineSlices(engine) || updates.length > MAX_SPRITE_NINE_SLICE_UPDATES) return false;
  const handles = new Uint32Array(updates.length * 2), values = new Float32Array(updates.length * 9), seen = new Set<number>();
  for (const [i, update] of updates.entries()) {
    const { entityId, entityGeneration } = update.entity;
    if (![entityId, entityGeneration].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff) || seen.has(entityId)) return false;
    seen.add(entityId); handles.set([entityId, entityGeneration], i * 2);
    if (update.nineSlice !== undefined) {
      let s: Required<SpriteNineSliceSpec>;
      try { s = resolveSpriteNineSlice(update.nineSlice); } catch { return false; }
      values.set([s.sourceWidth, s.sourceHeight, s.left, s.right, s.top, s.bottom, s.borderScale, +s.flipX, +s.flipY], i * 9);
    }
  }
  return engine.configure_sprite_nine_slices(handles, values);
}
