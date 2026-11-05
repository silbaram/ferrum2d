import type { DataSceneSpatialSpec, SpatialSurfaceConnection, SpatialTerrainSurface } from "./dataSceneSpatial.js";
export interface SpatialMovingPlatformSpec {
  surfaceId: string;
  offsetX?: number;
  offsetY?: number;
  offsetElevation?: number;
  /** One-way travel time. Motion repeats outward/backward, retaining the authored floor. */
  durationSeconds: number;
}
export function resolveMovingPlatforms(value: unknown, terrain: readonly SpatialTerrainSurface[], connections: readonly SpatialSurfaceConnection[], path: string): readonly SpatialMovingPlatformSpec[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${path} requires at most 16 platforms`);
  const used = new Set<string>();
  return value.map((v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${path} platform must be an object`);
    const p = v as Record<string, unknown>;
    if (Object.keys(p).some(k => !["surfaceId", "offsetX", "offsetY", "offsetElevation", "durationSeconds"].includes(k))) throw new Error(`${path} unknown platform field`);
    const surface = terrain.find(s => s.id === p.surfaceId);
    if (!surface || used.has(surface.id) || surface.walkable === false || surface.kind === "ramp" || connections.some(c => c.from === surface.id || c.to === surface.id)) throw new Error(`${path} requires a unique flat walkable surface without floor connections`);
    used.add(surface.id);
    const durationSeconds = number(p.durationSeconds, 0.05, 3600);
    return { surfaceId: surface.id, offsetX: number(p.offsetX ?? 0, -1e6, 1e6), offsetY: number(p.offsetY ?? 0, -1e6, 1e6), offsetElevation: number(p.offsetElevation ?? 0, -1e6, 1e6), durationSeconds };
  });
}
export function compileMovingPlatforms(spec: DataSceneSpatialSpec, phases?: Readonly<Record<string, number>>): Float64Array {
  const platforms = spec.movingPlatforms ?? [];
  if (phases !== undefined && (Object.keys(phases).length !== platforms.length || platforms.some(p => !Object.prototype.hasOwnProperty.call(phases, p.surfaceId)))) throw new Error("moving platform progress IDs must match authored platforms");
  return Float64Array.from(platforms.flatMap(p => {
    const phase = phases?.[p.surfaceId] ?? 0;
    number(phase, 0, p.durationSeconds * 2);
    if (phase >= p.durationSeconds * 2) throw new Error("moving platform phase exceeds period");
    return [2, spec.terrain.findIndex(s => s.id === p.surfaceId) + 1, p.offsetX ?? 0, p.offsetY ?? 0, p.offsetElevation ?? 0, p.durationSeconds, phase, 0];
  }));
}
export function decodeMovingPlatforms(values: Float64Array | undefined, spec: DataSceneSpatialSpec | undefined): Readonly<Record<string, number>> | undefined {
  if (!spec?.movingPlatforms?.length) {
    if (values?.length) throw new Error("runtime platforms differ from authoring");
    return undefined;
  }
  const expected = compileMovingPlatforms(spec);
  if (!values || expected.length !== values.length) throw new Error("missing moving platform runtime state");
  const phases: Record<string, number> = Object.create(null);
  for (let i = 0; i < expected.length; i += 8) {
    for (let j = 0; j < 8; j++) if (j !== 6 && Math.fround(values[i + j]!) !== Math.fround(expected[i + j]!)) throw new Error("runtime platform configuration differs from authoring");
    phases[spec.terrain[values[i + 1]! - 1]!.id] = values[i + 6]!;
  }
  compileMovingPlatforms(spec, phases);
  return phases;
}
export function resolveMovingPlatformPhases(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 16) throw new Error("invalid moving platform progress");
  return Object.fromEntries(Object.entries(value).map(([id,phase]) => [id, number(phase, 0, 7200)]));
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new RangeError("invalid moving platform number");
  return value;
}
