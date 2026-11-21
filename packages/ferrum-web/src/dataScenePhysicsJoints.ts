import { sceneCompositionDiagnosticError as error } from "./diagnostics.js";
import { encodeUnifiedPhysicsJoint, type UnifiedPhysicsJointOptions } from "./unifiedPhysicsJoints.js";
import { physicsFloats, type UnifiedPhysicsPose } from "./unifiedPhysicsAuthoring.js";
import type { ResolvedSceneCompositionInstance } from "./sceneComposition.js";

/** Body names are authored instance IDs. Frame positions follow each endpoint's scale;
 * lengths, limits, pulley grounds and actuator settings remain in world units. */
export interface DataScenePhysicsJointSpec extends Omit<UnifiedPhysicsJointOptions, "bodyA" | "bodyB"> {
  bodyA: string;
  bodyB: string;
}
export interface CompiledDataScenePhysicsJoint { name: string; options: DataScenePhysicsJointSpec; }

function object(input: unknown, path: string, keys?: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error(path, "must be an object");
  const value = input as Record<string, unknown>;
  if (keys) for (const key of Object.keys(value)) if (!keys.includes(key)) throw error(`${path}.${key}`, "is not supported");
  return value;
}
const kindKeys: Record<string, readonly string[]> = {
  fixed: [], spherical: [], revolute: ["limits", "motor"], prismatic: ["limits", "motor"], continuousRevolute: ["limits", "motor"],
  distance: ["length"], rope: ["maxLength"], frequencySpring: ["restLength", "frequencyHz", "dampingRatio"],
  accelerationSpring: ["restLength", "stiffness", "damping"], spring: ["restLength", "stiffness", "damping"],
  elasticRope: ["maxLength", "spring"], gear: ["ratio", "referenceAngle", "spring"],
  pulley: ["groundA", "groundB", "length", "ratio", "slack", "spring"],
};
export function resolveDataScenePhysicsJoints(input: unknown, path: string): void {
  for (const [name, inputJoint] of Object.entries(object(input, path))) {
    const p = `${path}.${name}`;
    if (!name.trim()) throw error(p, "joint name must be nonempty");
    const joint = object(inputJoint, p, ["bodyA", "bodyB", "kind", "localFrameA", "localFrameB", "linearSpring", "angularSpring", "enabled", "contactsEnabled", "breakForce", "breakTorque"]);
    for (const endpoint of ["bodyA", "bodyB"])
      if (typeof joint[endpoint] !== "string" || !(joint[endpoint] as string).trim()) throw error(`${p}.${endpoint}`, "must be an instance ID");
    if (joint.bodyA === joint.bodyB) throw error(p, "joint endpoints must be different instances");
    const kind = object(joint.kind, `${p}.kind`);
    if (typeof kind.type !== "string" || !Object.prototype.hasOwnProperty.call(kindKeys, kind.type)) throw error(`${p}.kind.type`, "must be a supported joint kind");
    object(kind, `${p}.kind`, ["type", ...kindKeys[kind.type]]);
    if (kind.motor !== undefined) object(kind.motor, `${p}.kind.motor`, ["targetPosition", "targetVelocity", "stiffness", "damping", "maxForce"]);
    if (kind.spring !== undefined) object(kind.spring, `${p}.kind.spring`, ["stiffness", "damping"]);
    for (const field of ["linearSpring", "angularSpring"]) if (joint[field] !== undefined) object(joint[field], `${p}.${field}`, ["stiffness", "damping"]);
    for (const field of ["localFrameA", "localFrameB"]) if (joint[field] !== undefined) {
      const pose = object(joint[field], `${p}.${field}`, ["position", "rotation"]);
      for (const [key, count] of [["position", 3], ["rotation", 4]] as const) if (pose[key] !== undefined) {
        try { physicsFloats(pose[key] as readonly number[], count); }
        catch (e) { throw error(`${p}.${field}.${key}`, e instanceof Error ? e.message : String(e)); }
      }
    }
    try {
      // Only the codec runs here. Native preflight later checks real geometry and handles.
      encodeUnifiedPhysicsJoint({ ...joint, bodyA: {entityId: 0, entityGeneration: 0}, bodyB: {entityId: 1, entityGeneration: 0} } as UnifiedPhysicsJointOptions);
    } catch (e) { throw error(p, e instanceof Error ? e.message : String(e)); }
  }
}
export function validateDataScenePhysicsJointReferences(joints: Readonly<Record<string, DataScenePhysicsJointSpec>> | undefined,
  bodies: ReadonlySet<string>, path: string): void {
  for (const [name, joint] of Object.entries(joints ?? {})) for (const endpoint of ["bodyA", "bodyB"] as const)
    if (!bodies.has(joint[endpoint])) throw error(`${path}.${name}.${endpoint}`, "must reference an instance with a physics body in the applied fragment");
}
export function compileDataScenePhysicsJoints(joints: Readonly<Record<string, DataScenePhysicsJointSpec>> | undefined,
  instances: readonly ResolvedSceneCompositionInstance[]): CompiledDataScenePhysicsJoint[] {
  const byId = new Map(instances.map(i => [i.id, i]));
  const frame = (pose: UnifiedPhysicsPose | undefined, scale: number): UnifiedPhysicsPose | undefined => pose && {
    ...pose, ...(pose.position ? {position: [pose.position[0] * scale, pose.position[1] * scale, pose.position[2] * scale] as const} : {}),
  };
  return Object.entries(joints ?? {}).map(([name, options]) => ({ name, options: { ...options,
    localFrameA: frame(options.localFrameA, byId.get(options.bodyA)!.scale),
    localFrameB: frame(options.localFrameB, byId.get(options.bodyB)!.scale),
  } }));
}
