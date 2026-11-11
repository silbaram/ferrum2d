import { hasSpatialSelectionSource } from "./spatialBloom.js";
import type { Engine } from "../pkg/ferrum_core.js";
import type { SpatialEnvironmentSpec, SpatialEnvironmentBufferView } from "./spatialEnvironment.js";
import type { SpatialRendererStats } from "./renderer.js";
import { sceneCompositionDiagnosticError } from "./diagnostics.js";

/** Opt-in native temporal selection. Omit to preserve the legacy rank-only policy. */
export interface SpatialLightSelectionSpec {
  enabled?: boolean;
  /** Incumbent score multiplier is 1 + hysteresis. Default 0.15, range 0..1. */
  hysteresis?: number;
  /** Seconds for each fade-out/fade-in leg. Default 0.15, range 0..5; zero swaps immediately. */
  fadeSeconds?: number;
  /** Camera target movement per update that resets history. Default/zero disables automatic cuts. */
  resetDistance?: number;
}

/** Six 4-byte fields per authored source: source, signed slot, reason, flags, score, weight. */
export interface SpatialLightSelectionBufferView {
  version: 1;
  stride: 6;
  /** slot -1 is encoded as 0xffffffff. Flags: pinned1, retained2, preview4, pending8. */
  words: Uint32Array;
  /** Reasons: active1, in2, out3, retained4, budget5, missing6, zero7, OFF8, position9, pending10. */
  values: Float32Array;
}

const nativeNames = [
  "spatial_light_selection_abi_version", "spatial_light_selection_progress_abi_version",
  "spatial_light_selection_diagnostic_size_bytes", "spatial_light_selection_diagnostics_ptr",
  "spatial_light_selection_diagnostics_len", "capture_spatial_light_selection_state",
  "preflight_spatial_light_selection_state", "restore_spatial_light_selection_state",
  "restore_data_scene_progress_with_spatial_light_selection", "reset_spatial_light_selection",
] as const;
type NativeSelection = Pick<Engine, typeof nativeNames[number]>;

export function supportsSpatialLightSelection(engine: unknown): engine is NativeSelection {
  // Wasm extensions are optional at runtime even though the generated current-core type includes them.
  const native = engine as Partial<NativeSelection> | undefined;
  return !!native && nativeNames.every(name => typeof native[name] === "function")
    && native.spatial_light_selection_abi_version!() === 1
    && native.spatial_light_selection_progress_abi_version!() === 1
    && native.spatial_light_selection_diagnostic_size_bytes!() === 24;
}
export function requestsSpatialLightSelection(spec?: SpatialEnvironmentSpec | null): boolean {
  return spec?.lighting?.selection !== undefined;
}

/** Counts emitted rows/reasons only. Selection/scoring/temporal state remain native-owned. */
type LightCounts = Pick<SpatialRendererStats, "authoredLightCount" | "lightCount" | "contributingLightCount" | "pendingLightCount" | "retainedLightCount" | "fadingLightCount" | "culledLightCount" | "droppedLightCount" | "disabledLightCount">;
export function writeSpatialLightSelectionStats(stats: LightCounts, environment?: SpatialEnvironmentBufferView): void {
  const v = environment?.values, diagnostics = environment?.lightSelection;
  stats.authoredLightCount = v?.[137] ?? v?.[1] ?? 0;
  stats.lightCount = v && v[0] & 1 ? v[1] : 0;
  stats.contributingLightCount = 0;
  for (let i = 0; i < stats.lightCount; i++) {
    const p = 12 + i * 12;
    if (v![p + 7] > 0 && (v![p + 4] > 0 || v![p + 5] > 0 || v![p + 6] > 0)
        && (v!.length < 576 || (v![545 + i] & 255) !== 0)) stats.contributingLightCount++;
  }
  stats.pendingLightCount = stats.retainedLightCount = stats.fadingLightCount = stats.culledLightCount
    = stats.droppedLightCount = stats.disabledLightCount = diagnostics ? 0 : undefined;
  if (!diagnostics) return;
  for (let at = 0; at < diagnostics.words.length; at += 6) {
    const reason = diagnostics.words[at + 2], flags = diagnostics.words[at + 3];
    if (flags & 8) stats.pendingLightCount!++;
    if (flags & 2) stats.retainedLightCount!++;
    if (reason === 2 || reason === 3) stats.fadingLightCount!++;
    if (reason === 6 || reason === 7 || reason === 9) stats.culledLightCount!++;
    if (reason === 5) stats.droppedLightCount!++;
    if (reason === 8) stats.disabledLightCount!++;
  }
}
export function resolveSpatialLightSelectionSpec(value: unknown, path: string): SpatialLightSelectionSpec {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw sceneCompositionDiagnosticError(path, "must be a selection object");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["enabled", "hysteresis", "fadeSeconds", "resetDistance"].includes(key)))
    throw sceneCompositionDiagnosticError(path, "contains an unknown selection field");
  if (input.enabled !== undefined && typeof input.enabled !== "boolean")
    throw sceneCompositionDiagnosticError(`${path}.enabled`, "must be a boolean");
  const number = (key: string, fallback: number, max: number): number => {
    const n = input[key] === undefined ? fallback : input[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max)
      throw sceneCompositionDiagnosticError(`${path}.${key}`, `must be finite in 0..${max}`);
    return n;
  };
  return { enabled: input.enabled !== false, hysteresis: number("hysteresis", .15, 1),
    fadeSeconds: number("fadeSeconds", .15, 5), resetDistance: number("resetDistance", 0, 1e6) };
}
export function validSpatialLightSelectionValues(v: Float32Array): boolean {
  return [0, 1].includes(v[576]) && v[577] >= 0 && v[577] <= 1
    && v[578] >= 0 && v[578] <= 5 && v[579] >= 0 && v[579] <= 1e6;
}

/** Validates native diagnostics without recomputing simulation scores or advancing history in JS. */
export function validateSpatialLightSelectionBuffer(environment: Float32Array, view?: SpatialLightSelectionBufferView): void {
  const required = hasSpatialSelectionSource(environment) && environment[576] === 1;
  const count = required ? environment[137] : 0;
  if (!view) {
    if (count) throw Error("Missing native Spatial light selection diagnostics");
    return;
  }
  if (!required || view.version !== 1 || view.stride !== 6 || !(view.words instanceof Uint32Array)
      || !(view.values instanceof Float32Array) || view.words.length !== count * 6 || view.values.length !== count * 6
      || view.words.buffer !== view.values.buffer || view.words.byteOffset !== view.values.byteOffset)
    throw Error("Invalid Spatial light selection diagnostic ABI");
  let occupied = 0;
  for (let i = 0; i < count; i++) {
    const at = i * 6, source = view.words[at], slot = view.words[at + 1], reason = view.words[at + 2], flags = view.words[at + 3];
    const score = view.values[at + 4], weight = view.values[at + 5];
    if (source !== i || (slot !== 0xffffffff && (slot >= environment[1] || occupied & 1 << slot))
        || reason < 1 || reason > 10 || flags > 15 || !Number.isFinite(score) || (score < 0 && score !== -1) || score > 64
        || !Number.isFinite(weight) || weight < 0 || weight > 1 || (slot === 0xffffffff && weight !== 0)
        || !!(flags & 1) !== (source === environment[138])
        || (reason <= 4 && slot === 0xffffffff) || ((reason === 1 || reason === 4) && weight !== 1)
        || (reason === 2 && weight >= 1) || (reason === 3 && weight <= 0)
        || (reason === 5 && slot !== 0xffffffff) || (reason === 10 && (!(flags & 8) || slot !== 0xffffffff))
        || (!(environment[0] & 1) && (reason !== 8 || slot !== 0xffffffff || weight !== 0))
        || ((environment[0] & 1) && reason === 8))
      throw Error("Invalid Spatial light selection diagnostic row");
    if (slot !== 0xffffffff) {
      occupied |= 1 << slot;
      if (environment[545 + slot] !== environment[549 + source])
        throw Error("Mismatched Spatial light selection channels");
      const from = 192 + source * 20, to = 12 + slot * 12;
      for (let offset = 3; offset <= 6; offset++)
        if (environment[to + offset] !== environment[from + offset]) throw Error("Mismatched Spatial light selection source");
      // Simulation availability can differ from interpolated render availability;
      // a zero emitted intensity is valid while either pose is unavailable.
      const expected = Math.fround(environment[from + 7] * weight);
      if (environment[to + 7] !== expected && environment[to + 7] !== 0)
        throw Error("Mismatched Spatial light selection weight");
    }
  }
  if (occupied !== (1 << environment[1]) - 1) throw Error("Incomplete Spatial light selection slots");
}

export function readSpatialLightSelection(engine: unknown, memory: WebAssembly.Memory, environment: Float32Array): SpatialLightSelectionBufferView | undefined {
  const native = engine as Partial<NativeSelection>;
  const required = hasSpatialSelectionSource(environment);
  if (nativeNames.every(name => native[name] === undefined) && !required) return undefined;
  if (!supportsSpatialLightSelection(native)) throw Error("Unsupported Spatial light selection ABI");
  const count = native.spatial_light_selection_diagnostics_len();
  if (!Number.isInteger(count) || count < 0 || count > 16) throw Error("Invalid Spatial light selection count");
  if (count === 0) {
    validateSpatialLightSelectionBuffer(environment);
    return undefined;
  }
  const ptr = native.spatial_light_selection_diagnostics_ptr();
  if (!Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 || ptr + count * 24 > memory.buffer.byteLength)
    throw Error("Invalid Spatial light selection pointer");
  const view: SpatialLightSelectionBufferView = { version: 1, stride: 6,
    words: new Uint32Array(memory.buffer, ptr, count * 6), values: new Float32Array(memory.buffer, ptr, count * 6) };
  validateSpatialLightSelectionBuffer(environment, view);
  return view;
}
