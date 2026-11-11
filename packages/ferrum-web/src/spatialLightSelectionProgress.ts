import type { SpatialPoint } from "./dataSceneSpatial.js";

export interface SpatialLightSelectionProgressSnapshot {
  readonly version: 1;
  /** Native source identity guard; never recompute or reinterpret it in JS. */
  readonly sourceSignature: number;
  readonly initialized: boolean;
  readonly step: number;
  readonly anchor: SpatialPoint;
  readonly slots: readonly {
    readonly sourceIndex: number | null;
    readonly pendingSourceIndex: number | null;
    readonly weight: number;
    readonly phase: "empty" | "steady" | "fading-in" | "fading-out";
  }[];
}
const phases = ["empty", "steady", "fading-in", "fading-out"] as const;

/** Serialization validation only. Native preflight additionally checks the matching source/config. */
export function resolveSpatialLightSelectionProgress(value: unknown): SpatialLightSelectionProgressSnapshot {
  const input = object(value, ["version", "sourceSignature", "initialized", "step", "anchor", "slots"]);
  if (input.version !== 1 || !uint(input.sourceSignature) || typeof input.initialized !== "boolean" || !uint(input.step))
    throw Error("Invalid Spatial light selection progress header");
  const anchor = object(input.anchor, ["x", "y", "elevation"]);
  for (const v of [anchor.x, anchor.y, anchor.elevation]) {
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e6)
      throw Error("Invalid Spatial light selection progress anchor");
  }
  if (!Array.isArray(input.slots) || input.slots.length !== 4)
    throw Error("Spatial light selection progress requires four slots");
  const active = new Set<number>(), pending = new Set<number>();
  for (const value of input.slots) {
    const row = object(value, ["sourceIndex", "pendingSourceIndex", "weight", "phase"]);
    const index = (v: unknown): v is number | null => v === null || uint(v) && v < 16;
    if (!index(row.sourceIndex) || !index(row.pendingSourceIndex) || typeof row.weight !== "number"
        || !Number.isFinite(row.weight) || row.weight < 0 || row.weight > 1
        || !phases.some(phase => phase === row.phase)) throw Error("Invalid Spatial light selection progress slot");
    const { sourceIndex: source, pendingSourceIndex: next, weight, phase } = row;
    if (phase === "empty" ? source !== null || next !== null || weight !== 0
        : phase === "steady" ? source === null || next !== null || weight !== 1
        : phase === "fading-in" ? source === null || next !== null || weight >= 1
        : source === null || next === source || weight <= 0)
      throw Error("Inconsistent Spatial light selection progress phase");
    if (source !== null) {
      if (active.has(source)) throw Error("Duplicate Spatial light selection source");
      active.add(source);
    }
    if (next !== null) {
      if (pending.has(next)) throw Error("Duplicate Spatial light selection pending source");
      pending.add(next);
    }
  }
  if ([...pending].some(source => active.has(source))) throw Error("Overlapping Spatial light selection sources");
  if (!input.initialized && (input.step !== 0 || Object.values(anchor).some(v => v !== 0)
      || input.slots.some(row => row.phase !== "empty"))) throw Error("Uninitialized Spatial light selection progress has history");
  // Every field and phase was checked above. Return an owned JSON copy, never native frame memory.
  return structuredClone(value) as SpatialLightSelectionProgressSnapshot;
}
export function spatialLightSelectionProgressValues(input: SpatialLightSelectionProgressSnapshot): Float64Array {
  const progress = resolveSpatialLightSelectionProgress(input);
  const values = new Float64Array(23);
  values.set([1, progress.sourceSignature, progress.initialized ? 1 : 0, progress.step,
    progress.anchor.x, progress.anchor.elevation, -progress.anchor.y]);
  progress.slots.forEach((slot, i) => values.set([slot.sourceIndex ?? -1, slot.pendingSourceIndex ?? -1,
    slot.weight, phases.indexOf(slot.phase)], 7 + i * 4));
  return values;
}
export function decodeSpatialLightSelectionProgress(values: Float64Array): SpatialLightSelectionProgressSnapshot {
  if (!(values instanceof Float64Array) || values.length !== 23 || values[0] !== 1
      || ![0, 1].includes(values[2]) || values.some(v => !Number.isFinite(v)))
    throw Error("Invalid native Spatial light selection progress");
  const progress = { version: 1, sourceSignature: values[1], initialized: values[2] === 1, step: values[3],
    anchor: { x: values[4], elevation: values[5], y: -values[6] },
    slots: Array.from({ length: 4 }, (_, i) => ({ sourceIndex: values[7 + i * 4] === -1 ? null : values[7 + i * 4],
      pendingSourceIndex: values[8 + i * 4] === -1 ? null : values[8 + i * 4], weight: values[9 + i * 4], phase: phases[values[10 + i * 4]] })) };
  return resolveSpatialLightSelectionProgress(progress);
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw Error("Invalid Spatial light selection progress object");
  return value as Record<string, unknown>;
}
function uint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
