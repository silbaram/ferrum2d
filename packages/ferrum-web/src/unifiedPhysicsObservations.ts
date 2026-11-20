import type { Engine } from "../pkg/ferrum_core.js";
import { uint32Number } from "./particlePreset.js";

export const UNIFIED_PHYSICS_CONTACT_LAYOUT = {
  stride: 27, first: 0, second: 10, subshapes: 20, normal: 22, pointOffset: 25, pointCount: 26,
  pointStride: 7, firstPoint: 0, secondPoint: 3, penetration: 6,
  participantFlags: 0, entity: 1, body: 3, collider: 5, terrainKind: 7, terrainId: 8, terrainTileIndex: 9,
  entityPresentFlag: 1, sensorFlag: 2, tileTerrain: 1, spatialSurfaceTerrain: 2,
} as const;
export const UNIFIED_PHYSICS_OBSERVATION_LAYOUT = {
  impulseStride: 32, ccdStride: 28, first: 0, second: 10,
  categories: 20, impulsePoint: 21, impulseNormal: 24, normalImpulse: 27, tangentImpulse: 28, approachSpeed: 31,
  fraction: 20, sweepSeconds: 21, ccdPoint: 22, ccdNormal: 25,
  participantFlags: 0, entity: 1, body: 3, collider: 5, terrainKind: 7, terrainId: 8, terrainTileIndex: 9,
  entityPresentFlag: 1, sensorFlag: 2, tileTerrain: 1, spatialSurfaceTerrain: 2,
} as const;

export interface UnifiedPhysicsContactQuery {
  categoryA?: number;
  categoryB?: number;
  includeSensors?: boolean;
  /** Output bounds, each in 1..65536. Geometry preparation is not bounded by these values. */
  maxManifolds?: number;
  maxPoints?: number;
}
export interface UnifiedPhysicsNumericRows {
  readonly count: number;
  readonly stride: number;
  readonly words: Uint32Array;
  readonly floats: Float32Array;
}
/** Borrowed until the next contact query, memory growth or destruction. */
export interface UnifiedPhysicsContactBufferView {
  readonly manifolds: UnifiedPhysicsNumericRows;
  readonly points: UnifiedPhysicsNumericRows;
  readonly truncated: boolean;
  readonly totalManifolds: number;
  readonly totalPoints: number;
}
export interface UnifiedPhysicsObservationBufferView {
  /** Last completed fixed tick. Borrowed until next observation read, memory growth or destruction. */
  readonly impulses: UnifiedPhysicsNumericRows;
  /** Current Engine frame, including manual steps; same buffer lifetime as impulses. */
  readonly ccd: UnifiedPhysicsNumericRows;
  /** Owned statistics, independent of Wasm buffer lifetime. */
  readonly diagnostics: UnifiedPhysicsDiagnostics;
}
export interface FerrumUnifiedPhysicsObservationApi {
  queryUnifiedPhysicsContactManifolds(options?: UnifiedPhysicsContactQuery): UnifiedPhysicsContactBufferView;
  queryUnifiedPhysicsObservations(): UnifiedPhysicsObservationBufferView;
  /** Undefined for a legacy/unconfigured world; never substitutes legacy row-operation metrics. */
  queryUnifiedPhysicsDiagnostics(): UnifiedPhysicsDiagnostics | undefined;
}

type Native = Pick<Engine, "unified_physics_observations_version" | "query_unified_physics_contacts"
  | "query_unified_physics_observations" | "query_unified_physics_diagnostics"
  | "unified_physics_observation_stride_words" | "unified_physics_observation_count" | "unified_physics_observation_ptr"
  | "unified_physics_contacts_truncated" | "unified_physics_contacts_total_manifolds" | "unified_physics_contacts_total_points">
  & Partial<Pick<Engine, "unified_physics_debug_version" | "unified_physics_debug_state_ptr">>;
const STRIDES = [27, 7, 32, 28, 71] as const;
function capability(native: Native): void {
  const methods = ["unified_physics_observations_version", "query_unified_physics_contacts", "query_unified_physics_observations",
    "query_unified_physics_diagnostics", "unified_physics_observation_stride_words", "unified_physics_observation_count",
    "unified_physics_observation_ptr", "unified_physics_contacts_truncated", "unified_physics_contacts_total_manifolds",
    "unified_physics_contacts_total_points"] as const;
  if (methods.some(name => typeof native[name] !== "function") || native.unified_physics_observations_version() !== 1
    || STRIDES.some((stride, kind) => native.unified_physics_observation_stride_words(kind) !== stride)) {
    throw new Error("This Wasm core does not support unified physics observations version 1.");
  }
}
function rows(native: Native, memory: WebAssembly.Memory, kind: number): UnifiedPhysicsNumericRows {
  const count = native.unified_physics_observation_count(kind);
  const pointer = native.unified_physics_observation_ptr(kind);
  const stride = STRIDES[kind], buffer = memory.buffer;
  if (!Number.isSafeInteger(count) || count < 0 || count > 0xffffffff
    || !Number.isSafeInteger(pointer) || pointer < 0 || pointer % 4 !== 0 || pointer + count * stride * 4 > buffer.byteLength) {
    throw new Error("Invalid unified physics observation buffer.");
  }
  return {count, stride, words: new Uint32Array(buffer, pointer, count * stride), floats: new Float32Array(buffer, pointer, count * stride)};
}
export function queryUnifiedPhysicsContactManifolds(native: Native, memory: WebAssembly.Memory, options: UnifiedPhysicsContactQuery = {}): UnifiedPhysicsContactBufferView {
  capability(native);
  const categoryA = uint32Number(options.categoryA ?? 0xffffffff, "contact category A");
  const categoryB = uint32Number(options.categoryB ?? 0xffffffff, "contact category B");
  const includeSensors = options.includeSensors ?? false;
  const maxManifolds = uint32Number(options.maxManifolds ?? 4096, "manifold capacity", 65536);
  const maxPoints = uint32Number(options.maxPoints ?? 16384, "point capacity", 65536);
  if (typeof includeSensors !== "boolean" || maxManifolds === 0 || maxPoints === 0) throw new Error("Invalid contact query options.");
  native.query_unified_physics_contacts(categoryA, categoryB, includeSensors, maxManifolds, maxPoints);
  const manifolds = rows(native, memory, 0), points = rows(native, memory, 1);
  const truncated = native.unified_physics_contacts_truncated();
  const totalManifolds = uint32Number(native.unified_physics_contacts_total_manifolds(), "total manifolds");
  const totalPoints = uint32Number(native.unified_physics_contacts_total_points(), "total points");
  if (typeof truncated !== "boolean" || manifolds.count > maxManifolds || points.count > maxPoints
    || totalManifolds < manifolds.count || totalPoints < points.count
    || truncated !== (manifolds.count < totalManifolds) || (!truncated && totalPoints !== points.count)) {
    throw new Error("Invalid contact query summary.");
  }
  let end = 0;
  for (let i = 0; i < manifolds.count; i++) {
    const offset = manifolds.words[i * 27 + 25], count = manifolds.words[i * 27 + 26];
    if (offset !== end || count === 0 || offset + count > points.count) throw new Error("Invalid contact point range.");
    end += count;
  }
  if (end !== points.count) throw new Error("Incomplete contact point ranges.");
  return {manifolds, points, truncated, totalManifolds, totalPoints};
}
export function queryUnifiedPhysicsObservations(native: Native, memory: WebAssembly.Memory): UnifiedPhysicsObservationBufferView {
  capability(native); native.query_unified_physics_observations();
  return {impulses: rows(native, memory, 2), ccd: rows(native, memory, 3), diagnostics: readDiagnostics(native, memory)};
}
export function queryUnifiedPhysicsDiagnostics(native: Native, memory: WebAssembly.Memory): UnifiedPhysicsDiagnostics | undefined {
  capability(native);
  const configured = native.query_unified_physics_diagnostics();
  if (typeof configured !== "boolean") throw new Error("Invalid unified physics diagnostics status.");
  return configured ? readDiagnostics(native, memory) : undefined;
}
function readDiagnostics(native: Native, memory: WebAssembly.Memory): UnifiedPhysicsDiagnostics {
  const debug = readDebugStatistics(native, memory);
  const data = rows(native, memory, 4);
  if (data.count !== 1 || data.words[0] !== 1 || data.words[1] !== 1) throw new Error("Invalid native physics diagnostics capability.");
  const w = data.words;
  return {backend: "rapier3d", legacySolverRowMetricsAvailable: false, fixedSteps: w[2], authoredJointBreaks: w[3],
    ccdObservationsDropped: w[4], solvedContacts: w[5], impulsesDropped: w[6], step: decodeCounters(w, 7), frame: decodeCounters(w, 39),
    ...(debug === undefined ? {} : { debug }) };
}

function readDebugStatistics(native: Native, memory: WebAssembly.Memory): UnifiedPhysicsDiagnostics["debug"] {
  if (native.unified_physics_debug_version === undefined && native.unified_physics_debug_state_ptr === undefined) return undefined;
  if (typeof native.unified_physics_debug_version !== "function" || native.unified_physics_debug_version() !== 1
    || typeof native.unified_physics_debug_state_ptr !== "function") throw new Error("Unsupported native physics debug statistics version.");
  const ptr = native.unified_physics_debug_state_ptr();
  const buffer = memory.buffer;
  if (!Number.isSafeInteger(ptr) || ptr < 0 || ptr % 4 || ptr + 16 > buffer.byteLength) throw new Error("Invalid native physics debug statistics buffer.");
  const [lineCount, workUnits, flags, unsupportedShapes] = new Uint32Array(buffer, ptr, 4);
  if ((flags & ~31) !== 0 || (flags & 24) === 24 || lineCount > 16_384 || workUnits > 65_536
    || unsupportedShapes > workUnits || ((flags & 4) !== 0 && (flags & 2) === 0)
    || ((flags & 1) === 0 && (lineCount !== 0 || workUnits !== 0 || flags !== 0 || unsupportedShapes !== 0))) {
    throw new Error("Invalid native physics debug statistics.");
  }
  if ((flags & 1) === 0) return undefined;
  return { lineCount, workUnits, truncated: (flags & 2) !== 0, rejected: (flags & 4) !== 0, unsupportedShapes,
    projection: (flags & 8) !== 0 ? "xyz" : (flags & 16) !== 0 ? "xz" : "xy" };
}

/** All native counters are direct measurements, not legacy solver-row estimates. */
export const UNIFIED_PHYSICS_COUNTER_LAYOUT = {
  kinematicCharacterStops: 0,
  kinematicPathCasts: 1,
  kinematicPathFailures: 2,
  kinematicPathStops: 3,
  characterPreviewPasses: 4,
  characterPreviewPairCasts: 5,
  characterPreviewPairContacts: 6,
  characterPreviewCouplingVisits: 7,
  characterPreviewCouplingLimits: 8,
  characterPreviewObstacleCasts: 9,
  characterPreviewObstacleContacts: 10,
  characterPreviewObstacleFailures: 11,
  backendSteps: 12,
  ccdSubsteps: 13,
  solverContacts: 14,
  solverConstraints: 15,
  trackedContactPairs: 16,
  dynamicBodies: 17,
  angularBodies: 18,
  sleepingBodies: 19,
  bodiesWoken: 20,
  bodiesPutToSleep: 21,
  islands: 22,
  islandBodies: 23,
  activeIslands: 24,
  sleepingIslands: 25,
  largestIslandBodies: 26,
  brokenJoints: 27,
  ccdPredictionChecks: 28,
  ccdClampChecks: 29,
  ccdClamps: 30,
  ccdClampsDropped: 31,
} as const;
export type UnifiedPhysicsCounters = {readonly [K in keyof typeof UNIFIED_PHYSICS_COUNTER_LAYOUT]: number};
export interface UnifiedPhysicsDiagnostics {
  readonly backend: "rapier3d";
  readonly legacySolverRowMetricsAvailable: false;
  readonly fixedSteps: number;
  readonly authoredJointBreaks: number;
  readonly ccdObservationsDropped: number;
  readonly solvedContacts: number;
  readonly impulsesDropped: number;
  readonly step: UnifiedPhysicsCounters;
  readonly frame: UnifiedPhysicsCounters;
  /** Last requested debug extraction. Cold component/terrain admission is outside workUnits.
   * XYZ uses the spatial camera; XZ is only the flat footprint of a spatial world.
   * Curves are bounded wireframe approximations of the actual native parameters.
   */
  readonly debug?: {
    readonly lineCount: number;
    readonly workUnits: number;
    readonly truncated: boolean;
    readonly unsupportedShapes: number;
    readonly rejected: boolean;
    readonly projection: "xy" | "xz" | "xyz";
  };
}
function decodeCounters(w: Uint32Array, offset: number): UnifiedPhysicsCounters {
  return {
    kinematicCharacterStops: w[offset + 0],
    kinematicPathCasts: w[offset + 1],
    kinematicPathFailures: w[offset + 2],
    kinematicPathStops: w[offset + 3],
    characterPreviewPasses: w[offset + 4],
    characterPreviewPairCasts: w[offset + 5],
    characterPreviewPairContacts: w[offset + 6],
    characterPreviewCouplingVisits: w[offset + 7],
    characterPreviewCouplingLimits: w[offset + 8],
    characterPreviewObstacleCasts: w[offset + 9],
    characterPreviewObstacleContacts: w[offset + 10],
    characterPreviewObstacleFailures: w[offset + 11],
    backendSteps: w[offset + 12],
    ccdSubsteps: w[offset + 13],
    solverContacts: w[offset + 14],
    solverConstraints: w[offset + 15],
    trackedContactPairs: w[offset + 16],
    dynamicBodies: w[offset + 17],
    angularBodies: w[offset + 18],
    sleepingBodies: w[offset + 19],
    bodiesWoken: w[offset + 20],
    bodiesPutToSleep: w[offset + 21],
    islands: w[offset + 22],
    islandBodies: w[offset + 23],
    activeIslands: w[offset + 24],
    sleepingIslands: w[offset + 25],
    largestIslandBodies: w[offset + 26],
    brokenJoints: w[offset + 27],
    ccdPredictionChecks: w[offset + 28],
    ccdClampChecks: w[offset + 29],
    ccdClamps: w[offset + 30],
    ccdClampsDropped: w[offset + 31],
  };
}
/** Validates and owns profiler input so later caller mutation cannot rewrite history. */
export function copyUnifiedPhysicsDiagnostics(value: UnifiedPhysicsDiagnostics): UnifiedPhysicsDiagnostics {
  if (value.backend !== "rapier3d" || value.legacySolverRowMetricsAvailable !== false) throw new Error("Invalid native physics diagnostics capability.");
  const copyCounters = (c: UnifiedPhysicsCounters): UnifiedPhysicsCounters => {
    const out = {} as Record<keyof UnifiedPhysicsCounters, number>;
    for (const key of Object.keys(UNIFIED_PHYSICS_COUNTER_LAYOUT) as (keyof UnifiedPhysicsCounters)[]) {
      out[key] = uint32Number(c[key], `native physics ${key}`);
    }
    return out;
  };
  const debug = value.debug;
  let ownedDebug: UnifiedPhysicsDiagnostics["debug"];
  if (debug !== undefined) {
    const lineCount = uint32Number(debug.lineCount, "native debug line count", 16_384);
    const workUnits = uint32Number(debug.workUnits, "native debug work", 65_536);
    const unsupportedShapes = uint32Number(debug.unsupportedShapes, "native debug unsupported shapes", workUnits);
    if (typeof debug.truncated !== "boolean" || typeof debug.rejected !== "boolean"
      || (debug.rejected && !debug.truncated) || !["xy", "xz", "xyz"].includes(debug.projection)) {
      throw new Error("Invalid native physics debug statistics.");
    }
    ownedDebug = Object.freeze({ lineCount, workUnits, unsupportedShapes, truncated: debug.truncated,
      rejected: debug.rejected, projection: debug.projection });
  }
  return Object.freeze({backend: "rapier3d", legacySolverRowMetricsAvailable: false,
    fixedSteps: uint32Number(value.fixedSteps, "native fixed steps"),
    authoredJointBreaks: uint32Number(value.authoredJointBreaks, "native authored breaks"),
    ccdObservationsDropped: uint32Number(value.ccdObservationsDropped, "native dropped CCD observations"),
    solvedContacts: uint32Number(value.solvedContacts, "native solved contacts"),
    impulsesDropped: uint32Number(value.impulsesDropped, "native dropped impulses"),
    step: Object.freeze(copyCounters(value.step)), frame: Object.freeze(copyCounters(value.frame)),
    ...(ownedDebug === undefined ? {} : { debug: ownedDebug }) });
}
