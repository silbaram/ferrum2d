import type { FerrumEngine, PhysicsEntityHandle } from "./engineTypes.js";
import type { PhysicsWorldApplyResult } from "./physicsAuthoring.js";
import type { PhysicsWorldSnapshot, PhysicsWorldSolverState } from "./physicsSnapshotTypes.js";

function logicalHandles(world: Pick<PhysicsWorldApplyResult, "bodies" | "worldAnchors">): [string, PhysicsEntityHandle][] {
  return [
    ...Object.entries(world.bodies).map(([id, handle]): [string, PhysicsEntityHandle] => [`body:${id}`, handle]),
    ...world.worldAnchors.map((handle, index): [string, PhysicsEntityHandle] => [`anchor:${index}`, handle]),
  ];
}

export function captureWorldSolverState(engine: FerrumEngine, world: PhysicsWorldApplyResult): PhysicsWorldSolverState | undefined {
  if (typeof engine.capturePhysicsSolverState !== "function") return undefined;
  const entries = logicalHandles(world);
  const bulk = engine.capturePhysicsSolverState(entries.map(([, h]) => h));
  const ids = new Map(entries.map(([id, h]) => [`${h.entityId}:${h.entityGeneration}`, id]));
  const bodies = Object.fromEntries(entries.map(([id], index) => {
    const v = bulk.values.subarray(index * 8, index * 8 + 8);
    return [id, { forceX: v[0]!, forceY: v[1]!, impulseX: v[2]!, impulseY: v[3]!, torque: v[4]!, angularImpulse: v[5]!, sleepTimerSeconds: v[6]!, canSleep: v[7] === 1 }];
  }));
  const contacts: PhysicsWorldSolverState["contacts"][number][] = [];
  for (let i = 0; i < bulk.contactHandles.length / 4; i++) {
    const h = bulk.contactHandles.subarray(i * 4, i * 4 + 4);
    const v = bulk.contacts.subarray(i * 6, i * 6 + 6);
    const bodyA = ids.get(`${h[0]}:${h[1]}`);
    const bodyB = ids.get(`${h[2]}:${h[3]}`);
    if (bodyA === undefined || bodyB === undefined) throw new Error("Unresolved physics contact endpoint");
    contacts.push({ bodyA, bodyB, pointX: v[0]!, pointY: v[1]!, normalX: v[2]!, normalY: v[3]!, normalImpulse: v[4]!, tangentImpulse: v[5]! });
  }
  return { bodies, contacts };
}

export function restoreWorldSolverState(engine: FerrumEngine, world: PhysicsWorldApplyResult, state: PhysicsWorldSolverState): void {
  const entries = logicalHandles(world);
  const lookup = new Map(entries);
  const handles = new Uint32Array(entries.flatMap(([, h]) => [h.entityId, h.entityGeneration]));
  const values = new Float32Array(entries.flatMap(([id]) => {
    const b = state.bodies[id]!;
    return [b.forceX, b.forceY, b.impulseX, b.impulseY, b.torque, b.angularImpulse, b.sleepTimerSeconds, Number(b.canSleep)];
  }));
  const contactHandles = new Uint32Array(state.contacts.flatMap(c => {
    const a = lookup.get(c.bodyA)!;
    const b = lookup.get(c.bodyB)!;
    return [a.entityId, a.entityGeneration, b.entityId, b.entityGeneration];
  }));
  const contacts = new Float32Array(state.contacts.flatMap(c => [c.pointX, c.pointY, c.normalX, c.normalY, c.normalImpulse, c.tangentImpulse]));
  if (!engine.restorePhysicsSolverState({ handles, values, contactHandles, contacts })) throw new Error("Runtime rejected physics solver state");
}

/** Validate before allocation, including logical endpoint resolution and f32 range. */
export function validateWorldSolverState(snapshot: PhysicsWorldSnapshot): void {
  if (snapshot.version === 1) {
    if (snapshot.solverState !== undefined) throw new Error("Version 1 physics snapshot cannot contain solverState");
    return;
  }
  const expectedAnchors = Object.values(snapshot.spec.joints).reduce((count, joint) => count + Number(joint.bodyA === "world") + Number(joint.bodyB === "world"), 0);
  if (snapshot.worldAnchors.length !== expectedAnchors) throw new Error("Physics snapshot anchor count does not match joint endpoints");
  const state = snapshot.solverState;
  if (!state || typeof state.bodies !== "object" || state.bodies === null || Array.isArray(state.bodies) || !Array.isArray(state.contacts)) throw new Error("Version 2 physics snapshot requires solverState");
  const expected = new Set([...Object.keys(snapshot.bodies).map(id => `body:${id}`), ...snapshot.worldAnchors.map((_, i) => `anchor:${i}`)]);
  if (Object.keys(state.bodies).length !== expected.size) throw new Error("Physics solver body keys mismatch");
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Number.isFinite(Math.fround(v));
  for (const [id, body] of Object.entries(state.bodies)) {
    if (!expected.has(id) || body === null || typeof body !== "object" || typeof body.canSleep !== "boolean"
      || ![body.forceX, body.forceY, body.impulseX, body.impulseY, body.torque, body.angularImpulse, body.sleepTimerSeconds].every(finite)
      || body.sleepTimerSeconds < 0) throw new Error(`Invalid physics solver body ${id}`);
  }
  for (const c of state.contacts) {
    if (!c || !expected.has(c.bodyA) || !expected.has(c.bodyB) || c.bodyA === c.bodyB
      || ![c.pointX, c.pointY, c.normalX, c.normalY, c.normalImpulse, c.tangentImpulse].every(finite)
      || c.normalImpulse < 0 || Math.abs(Math.hypot(c.normalX, c.normalY) - 1) > 0.01) throw new Error("Invalid physics solver contact");
  }
}
