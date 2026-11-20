import { sceneCompositionDiagnosticError as error } from "./diagnostics.js";
import { encodeUnifiedPhysicsWorld, type UnifiedPhysicsOptions } from "./unifiedPhysics.js";
import { encodeUnifiedPhysicsBody, type UnifiedPhysicsBodyOptions, type UnifiedPhysicsShape,
  type UnifiedPhysicsVector3, type UnifiedPhysicsPose } from "./unifiedPhysicsAuthoring.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";
import { encodeUnifiedPhysicsCharacter, type UnifiedPhysicsCharacterOptions } from "./unifiedPhysicsCharacters.js";
import { resolveDataScenePhysicsJoints, type DataScenePhysicsJointSpec } from "./dataScenePhysicsJoints.js";
import { validateDataSceneCollisionTilemap, type DataSceneCollisionTilemapOptions } from "./dataSceneCollisionTilemap.js";

export interface DataScenePhysicsSpec extends UnifiedPhysicsOptions {
  /** Named constraints referencing body-bearing instances in the applied fragment. */
  joints?: Readonly<Record<string, DataScenePhysicsJointSpec>>;
  /** Planar authored grid; definitions may opt into cell-sized background graphics. */
  collisionTilemap?: Omit<DataSceneCollisionTilemapOptions, "tiles"> & { tiles: readonly number[] };
}

/** A body on an authored entity. Position comes from placement, elevation and renderOffset.
 * Shape lengths and visual offset follow instance scale; velocities remain world units. */
export interface DataScenePhysicsBodySpec extends Omit<UnifiedPhysicsBodyOptions, "pose"> {
  /** Initial height in spatial worlds. Planar worlds require zero. */
  elevation?: number;
  /** Local body orientation relative to placement rotation; XYZW unit quaternion. */
  rotation?: readonly [number, number, number, number];
  /** Position-kinematic capsule controller. Distances remain world units under instance scaling. */
  character?: UnifiedPhysicsCharacterOptions;
  // The older component encoding owns these fields. They cannot be mixed.
  type?: never;
  heightSpan?: never;
}
const worldKeys = ["space", "gravity", "lengthUnit", "stepSeconds", "velocityIterations", "positionIterations",
  "restitutionVelocityThreshold", "continuous", "maxBodies", "maxColliders", "maxEvents", "maxCharacters", "maxJoints", "joints", "collisionTilemap"];
const bodyKeys = ["kind", "elevation", "rotation", "linearVelocity", "angularVelocity", "gravityScale", "linearDamping", "angularDamping",
  "ccd", "canSleep", "collider", "renderOffset", "character"];
function record(input: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error(path, "must be an object");
  const value = input as Record<string, unknown>;
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw error(`${path}.${key}`, "is not supported");
  return value;
}
function checked<T>(path: string, operation: () => T): T {
  try { return operation(); } catch (e) { throw error(path, e instanceof Error ? e.message : String(e)); }
}
function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(Math.fround(value))) throw error(path, "must be finite f32");
  return value;
}
export function resolveDataScenePhysics(input: unknown, path = "sceneAuthoring.physics"): DataScenePhysicsSpec {
  const value = record(input, path, worldKeys);
  checked(path, () => encodeUnifiedPhysicsWorld(value as unknown as UnifiedPhysicsOptions));
  if (value.joints !== undefined) resolveDataScenePhysicsJoints(value.joints, `${path}.joints`);
  if (value.collisionTilemap !== undefined) {
    if (value.space !== "planar-xy") throw error(`${path}.collisionTilemap`, "requires a planar-xy world");
    if (!value.collisionTilemap || typeof value.collisionTilemap !== "object" || Array.isArray(value.collisionTilemap))
      throw error(`${path}.collisionTilemap`, "must be an object");
    if (!Array.isArray((value.collisionTilemap as DataSceneCollisionTilemapOptions).tiles))
      throw error(`${path}.collisionTilemap.tiles`, "authoring requires a JSON array");
    checked(`${path}.collisionTilemap`, () => validateDataSceneCollisionTilemap(value.collisionTilemap as DataSceneCollisionTilemapOptions));
  }
  return structuredClone(value) as unknown as DataScenePhysicsSpec;
}
function pose(input: unknown, path: string): void {
  if (input !== undefined) record(input, path, ["position", "rotation"]);
}
function shape(input: unknown, path: string, depth = 0): void {
  const types: Record<string, readonly string[]> = {
    box: ["halfExtents"], sphere: ["radius"], capsule: ["halfHeight", "radius"], convexHull: ["points"],
    triangleMesh: ["vertices", "triangles"], heightfield: ["rows", "columns", "heights", "size"], compound: ["parts"],
  };
  const kind = (input as { type?: unknown } | null)?.type;
  if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(types, kind)) throw error(`${path}.type`, "must be a supported physics shape");
  const value = record(input, path, ["type", ...types[kind]]);
  if (kind === "compound") {
    if (depth || !Array.isArray(value.parts) || value.parts.length > 64) throw error(`${path}.parts`, "requires 1–64 non-nested convex parts");
    value.parts.forEach((input, i) => {
      const p = `${path}.parts.${i}`, part = record(input, p, ["pose", "shape"]);
      pose(part.pose, `${p}.pose`); shape(part.shape, `${p}.shape`, depth + 1);
    });
  }
}
export function resolveDataScenePhysicsBody(input: unknown, path: string): DataScenePhysicsBodySpec {
  const value = record(input, path, bodyKeys);
  if (value.elevation !== undefined) finite(value.elevation, `${path}.elevation`);
  if (value.character !== undefined) {
    const character = record(value.character, `${path}.character`, ["up", "skinWidth", "maxSlopeAngle", "slideAngle", "stepHeight", "stepMinWidth", "snapDistance", "maxVerticalSpeed", "pushMass"]);
    for (const [key, setting] of Object.entries(character)) {
      if (key === "up") {
        if (!Array.isArray(setting) || setting.length !== 3) throw error(`${path}.character.up`, "requires XYZ");
        setting.forEach((n, i) => finite(n, `${path}.character.up.${i}`));
      } else finite(setting, `${path}.character.${key}`);
    }
    checked(`${path}.character`, () => encodeUnifiedPhysicsCharacter(character as UnifiedPhysicsCharacterOptions));
  }
  const c = record(value.collider, `${path}.collider`, ["shape", "pose", "density", "friction", "restitution", "surfaceVelocity", "contactCorrection", "sensor", "category", "mask"]);
  pose(c.pose, `${path}.collider.pose`); shape(c.shape, `${path}.collider.shape`);
  if (c.contactCorrection !== undefined) record(c.contactCorrection, `${path}.collider.contactCorrection`,
    ["velocityRate", "maxVelocity", "positionRate", "positionSlop", "velocitySlop", "splitImpulse"]);
  checked(path, () => encodeUnifiedPhysicsBody({ ...value, pose: { rotation: value.rotation } } as unknown as UnifiedPhysicsBodyOptions));
  return structuredClone(value) as unknown as DataScenePhysicsBodySpec;
}
function scaledShape(shape: UnifiedPhysicsShape, scale: number): UnifiedPhysicsShape {
  const v = (p: UnifiedPhysicsVector3): UnifiedPhysicsVector3 => [p[0] * scale, p[1] * scale, p[2] * scale];
  switch (shape.type) {
    case "box": return { ...shape, halfExtents: v(shape.halfExtents) };
    case "sphere": return { ...shape, radius: shape.radius * scale };
    case "capsule": return { ...shape, radius: shape.radius * scale, halfHeight: shape.halfHeight * scale };
    case "convexHull": return { ...shape, points: shape.points.map(v) };
    case "triangleMesh": return { ...shape, vertices: Array.from(shape.vertices, n => n * scale) };
    case "heightfield": return { ...shape, heights: Array.from(shape.heights, n => n * scale), size: [shape.size[0] * scale, shape.size[1] * scale] };
    case "compound": return { ...shape, parts: shape.parts.map(p => ({
      pose: p.pose && { ...p.pose, position: v(p.pose.position ?? [0, 0, 0]) },
      shape: scaledShape(p.shape, scale) as typeof p.shape,
    })) };
  }
}
export function compileDataScenePhysicsBody(body: DataScenePhysicsBodySpec, instance: ResolvedSceneCompositionInstance,
  world: UnifiedPhysicsOptions, path: string, collisionLayer = 0): UnifiedPhysicsBodyOptions {
  if (world.space === "planar-xy" && (body.elevation ?? 0) !== 0) throw error(`${path}.elevation`, "must be zero in a planar world");
  if (!(instance.scale > 0)) throw error(`${path}.scale`, "physics bodies require a positive instance scale");
  const scale = instance.scale, q = body.rotation ?? [0, 0, 0, 1];
  const half = instance.rotationRadians * 0.5, sn = Math.sin(half), cs = Math.cos(half);
  // Placement rotates around planar Z or spatial Y. This is authoring transform composition,
  // never a per-frame simulation or a second runtime pose.
  const rotation: NonNullable<UnifiedPhysicsPose["rotation"]> = world.space === "planar-xy"
    ? [cs*q[0]-sn*q[1], cs*q[1]+sn*q[0], cs*q[2]+sn*q[3], cs*q[3]-sn*q[2]]
    : [cs*q[0]+sn*q[2], cs*q[1]+sn*q[3], cs*q[2]-sn*q[0], cs*q[3]-sn*q[1]];
  const offset = body.renderOffset ?? [0, 0, 0];
  const renderOffset: UnifiedPhysicsVector3 = [offset[0]*scale, offset[1]*scale, offset[2]*scale];
  const anchor = world.space === "planar-xy" ? [instance.x, instance.y, 0] : [instance.x, body.elevation ?? 0, -instance.y];
  const position: UnifiedPhysicsVector3 = [anchor[0]-renderOffset[0], anchor[1]-renderOffset[1], anchor[2]-renderOffset[2]];
  const colliderPose = body.collider.pose;
  const { elevation: _height, rotation: _rotation, character: _character, ...options } = body;
  const result: UnifiedPhysicsBodyOptions = { ...options, pose: { position, rotation }, renderOffset, collider: {
    ...body.collider, category: body.collider.category ?? (1 << collisionLayer),
    shape: scaledShape(body.collider.shape, scale),
    ...(colliderPose ? { pose: { ...colliderPose, position: (colliderPose.position ?? [0,0,0]).map(n => n*scale) as unknown as UnifiedPhysicsVector3 } } : {}),
  } };
  checked(path, () => encodeUnifiedPhysicsBody(result));
  return result;
}
