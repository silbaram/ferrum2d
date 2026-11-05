import type { Engine } from "../pkg/ferrum_core.js";
import type { PhysicsJointHandle, PhysicsJointType } from "./engineTypes/physicsJoints.js";
const jointTypes: PhysicsJointType[] = ["distance", "rope", "spring", "revolute", "prismatic", "gear", "weld", "pulley"];
export interface PhysicsDiagnostics {
  dropped: number;
  ccdLimits: readonly { entityId: number; entityGeneration: number; reason: "sweepBudget" | "dependencyDepth" }[];
  joints: readonly (PhysicsJointHandle & { force: number; torque: number; error: number; errorUnit: "world" | "radians" })[];
}
export interface PhysicsJointBreakEvents {
  dropped: number;
  events: readonly (PhysicsJointHandle & { reason: "force" | "torque" | "geometry"; force: number; torque: number })[];
}
export function readPhysicsDiagnostics(engine: Engine): PhysicsDiagnostics {
  const data = engine.query_physics_diagnostics();
  const ccdLimits: PhysicsDiagnostics["ccdLimits"][number][] = [];
  const joints: PhysicsDiagnostics["joints"][number][] = [];
  let offset = 3;
  for (let i = 0; i < data[1]!; i++, offset += 3) ccdLimits.push({ entityId: data[offset]!, entityGeneration: data[offset + 1]!, reason: data[offset + 2] === 1 ? "sweepBudget" : "dependencyDepth" });
  for (let i = 0; i < data[2]!; i++, offset += 6) joints.push({ ...handle(data, offset), force: data[offset + 3]!, torque: data[offset + 4]!, error: data[offset + 5]!, errorUnit: data[offset] === 5 || data[offset] === 6 ? "radians" : "world" });
  return { dropped: data[0]!, ccdLimits, joints };
}
export function drainJointBreaks(engine: Engine): PhysicsJointBreakEvents {
  const data = engine.drain_physics_joint_breaks();
  const events: PhysicsJointBreakEvents["events"][number][] = [];
  for (let offset = 1; offset < data.length; offset += 6) events.push({ ...handle(data, offset), reason: data[offset + 3] === 1 ? "force" : data[offset + 3] === 2 ? "torque" : "geometry", force: data[offset + 4]!, torque: data[offset + 5]! });
  return { dropped: data[0]!, events };
}
function handle(data: Float64Array, offset: number): PhysicsJointHandle {
  return { jointType: jointTypes[data[offset]!]!, jointIndex: data[offset + 1]!, jointGeneration: data[offset + 2]! };
}
