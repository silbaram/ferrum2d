/** @internal Saved facade configuration, not a rebuild/native synchronization. */
import { ResourceBudget, resourceFinite, resourceInteger, resourceKeys } from "./nativeFileResourceBudget.js";

export type HostRecord = Record<string, unknown>;
export function hostRecord(v: unknown, keys: readonly string[], b: ResourceBudget, path: string): HostRecord {
  if (!v || typeof v !== "object" || Array.isArray(v)) b.fail("DATA", path);
  resourceKeys(v, keys, b); return v as HostRecord;
}
export function hostBool(v: unknown, b: ResourceBudget, path: string): void {
  b.work(1); if (typeof v !== "boolean") b.fail("DATA", path);
}
export function hostEnum(v: unknown, choices: readonly string[], b: ResourceBudget, path: string): void {
  b.work(choices.length); if (typeof v !== "string" || !choices.includes(v)) b.fail("DATA", path);
}
export function hostName(v: unknown, b: ResourceBudget, path: string): string {
  if (typeof v !== "string" || !v.trim()) b.fail("DATA", path); b.metadata(v); return v;
}
export function hostNonNegativeInteger(v: unknown, b: ResourceBudget, p: string): void {
  b.work(1); if (typeof v !== "number" || !Number.isInteger(v) || v < 0) b.fail("DATA", p);
}
export function hostArray(v: unknown, b: ResourceBudget, path: string, min = 0, max = 262144): unknown[] {
  if (!Array.isArray(v) || Object.getPrototypeOf(v) !== Array.prototype || v.length < min || v.length > max) b.fail("DATA", path);
  b.work(v.length); return v;
}
export function hostEntries(v: unknown, b: ResourceBudget, path: string): [string, unknown][] {
  if (!v || typeof v !== "object" || Array.isArray(v)) b.fail("DATA", path);
  const keys = Reflect.ownKeys(v); b.work(keys.length); b.charge("decodedBytes", keys.length * 24);
  resourceKeys(v, keys.filter((k): k is string => typeof k === "string"), b);
  return Object.entries(v);
}
function nums(r: HostRecord, keys: readonly string[], p: string, min = -Number.MAX_VALUE): void {
  for (const k of keys) resourceFinite(r[k], `${p}.${k}`, min);
}
function bools(r: HostRecord, keys: readonly string[], b: ResourceBudget, p: string): void {
  for (const k of keys) hostBool(r[k], b, `${p}.${k}`);
}
function positive(v: unknown, b: ResourceBudget, p: string): void {
  if (resourceFinite(v, p) <= 0) b.fail("DATA", p);
}
function ref(v: unknown, targets: HostRecord, b: ResourceBudget, p: string): void {
  if (v !== undefined && !Object.prototype.hasOwnProperty.call(targets, hostName(v, b, p))) b.fail("DATA", p);
}
const DEBUG = ["colliders", "contacts", "manifolds", "broadphase", "joints", "sleeping", "layers", "ccd"];
export function validateHostDebug(v: unknown, b: ResourceBudget, p: string, resolved = false): void {
  const r = hostRecord(v, resolved ? ["enabled", ...DEBUG] : DEBUG, b, p);
  for (const k of resolved ? ["enabled", ...DEBUG] : DEBUG) if (resolved || r[k] !== undefined) hostBool(r[k], b, `${p}.${k}`);
}
const BODY_NUM = ["positionX", "positionY", "rotationRadians", "velocityX", "velocityY", "angularVelocityRadiansPerSecond", "elevation", "gravityScale"];
const BODY_NONNEG = ["height", "linearDamping", "angularDamping"];
const COLLIDER_BASE = ["shape", "offsetX", "offsetY", "material", "layer", "trigger", "enabled"];
function collider(v: unknown, materials: HostRecord, layers: HostRecord, b: ResourceBudget, p: string): HostRecord {
  const shape = v && typeof v === "object" ? Object.getOwnPropertyDescriptor(v, "shape")?.value : undefined;
  hostEnum(shape, ["aabb", "box", "circle", "capsule", "orientedBox", "convexPolygon", "edge", "chain"], b, p);
  const extra = shape === "aabb" || shape === "box" ? ["halfWidth", "halfHeight"] : shape === "circle" ? ["radius"]
    : shape === "capsule" ? ["startX", "startY", "endX", "endY", "radius"] : shape === "orientedBox" ? ["halfWidth", "halfHeight", "rotationRadians"]
    : shape === "convexPolygon" ? ["vertices", "rotationRadians"] : shape === "edge" ? ["startX", "startY", "endX", "endY"] : ["vertices", "loop"];
  const r = hostRecord(v, [...COLLIDER_BASE, ...extra], b, p);
  nums(r, ["offsetX", "offsetY"], p); bools(r, ["trigger", "enabled"], b, p);
  ref(r.material, materials, b, `${p}.material`); ref(r.layer, layers, b, `${p}.layer`);
  if (["aabb", "box", "orientedBox"].includes(shape)) { positive(r.halfWidth, b, p); positive(r.halfHeight, b, p); }
  if (shape === "circle" || shape === "capsule") positive(r.radius, b, p);
  if (shape === "orientedBox" || shape === "convexPolygon") nums(r, ["rotationRadians"], p);
  if (shape === "edge" || shape === "capsule") {
    nums(r, ["startX", "startY", "endX", "endY"], p);
    if (r.startX === r.endX && r.startY === r.endY) b.fail("DATA", `${p}.distinct endpoints`);
  }
  if (shape === "chain" || shape === "convexPolygon") {
    const vertices = hostArray(r.vertices, b, p, shape === "chain" ? 2 : 3, shape === "chain" ? 64 : 16);
    const points: HostRecord[] = []; b.charge("decodedBytes", vertices.length * 8);
    for (const v of vertices) { const q = hostRecord(v, ["x", "y"], b, p); nums(q, ["x", "y"], p); points.push(q); }
    for (let i = 1; i < points.length; i++) if (points[i].x === points[i - 1].x && points[i].y === points[i - 1].y) b.fail("DATA", p);
    if (shape === "chain") hostBool(r.loop, b, p);
    else {
      let sign = 0;
      for (let i = 0; i < points.length; i++) {
        const a = points[i], c = points[(i + 2) % points.length], d = points[(i + 1) % points.length];
        const cross = ((d.x as number) - (a.x as number)) * ((c.y as number) - (d.y as number))
          - ((d.y as number) - (a.y as number)) * ((c.x as number) - (d.x as number));
        if (cross === 0 || (sign !== 0 && Math.sign(cross) !== sign)) b.fail("DATA", p); sign = Math.sign(cross);
      }
    }
  }
  return r;
}
const JOINT_NUM = ["anchorX", "anchorY", "localAnchorAX", "localAnchorAY", "localAnchorBX", "localAnchorBY", "localAxisAX", "localAxisAY", "groundAnchorAX", "groundAnchorAY", "groundAnchorBX", "groundAnchorBY", "lowerLimit", "upperLimit", "motorSpeed", "ratio", "referenceAngle"];
const JOINT_NONNEG = ["restLength", "maxLength", "maxMotorForce", "maxMotorTorque", "breakDistance", "breakAngle"];
const JOINT_BOOL = ["enabled", "limitEnabled", "continuousLimit", "motorEnabled", "slack"];
/** Matches resolved producer contracts; does not compare history to the current World. */
export function validateHostPhysics(v: unknown, b: ResourceBudget, p: string): void {
  const r = hostRecord(v, ["mode", "gravityX", "gravityY", "continuous", "hd2d", "solver", "materials", "layers", "bodies", "joints", "debug"], b, p);
  hostEnum(r.mode, ["none", "arcade", "rigid"], b, p); nums(r, ["gravityX", "gravityY"], p); hostBool(r.continuous, b, p);
  const hd = hostRecord(r.hd2d, ["enabled", "defaultHeight", "maxStepHeight", "maxDropHeight"], b, p);
  hostBool(hd.enabled, b, p); nums(hd, ["defaultHeight", "maxStepHeight", "maxDropHeight"], p, 0);
  const solver = hostRecord(r.solver, ["fixedTimestep", "stepSeconds", "velocityIterations", "positionIterations", "sleep"], b, p);
  bools(solver, ["fixedTimestep", "sleep"], b, p);
  resourceFinite(solver.stepSeconds, p); // Legacy creation/current metadata retain the raw finite clock option.
  hostNonNegativeInteger(solver.velocityIterations, b, p); hostNonNegativeInteger(solver.positionIterations, b, p);
  const materialEntries = hostEntries(r.materials, b, p), materials = r.materials as HostRecord;
  for (const [id, value] of materialEntries) {
    hostName(id, b, p); const m = hostRecord(value, ["friction", "restitution", "density"], b, p); nums(m, ["friction", "restitution"], p, 0); positive(m.density, b, p);
  }
  const layerEntries = hostEntries(r.layers, b, p), layers = r.layers as HostRecord;
  if (layerEntries.length > 31) b.fail("DATA", p);
  for (let i = 0; i < layerEntries.length; i++) {
    const [id, value] = layerEntries[i]; hostName(id, b, p);
    const l = hostRecord(value, ["name", "categoryBits", "mask", "maskBits"], b, p);
    if (l.name !== id || l.categoryBits !== 1 << i) b.fail("DATA", p);
    let maskBits = 0;
    for (const target of hostArray(l.mask, b, p)) {
      const name = hostName(target, b, p); if (!Object.prototype.hasOwnProperty.call(layers, name)) b.fail("DATA", p);
      maskBits |= (layers[name] as HostRecord).categoryBits as number;
    }
    if (l.maskBits !== maskBits) b.fail("DATA", p);
  }
  const bodyEntries = hostEntries(r.bodies, b, p), bodies = r.bodies as HostRecord;
  for (const [id, value] of bodyEntries) {
    hostName(id, b, p);
    const body = hostRecord(value, ["id", "type", ...BODY_NUM, ...BODY_NONNEG, "floor", "mass", "inertia", "material", "layer", "colliders", "enabled", "canSleep", "fixedRotation", "kinematicController"], b, p);
    if (body.id !== id) b.fail("DATA", p); hostEnum(body.type, ["static", "kinematic", "dynamic"], b, p);
    nums(body, BODY_NUM, p); nums(body, BODY_NONNEG, p, 0); hostName(body.floor, b, p); bools(body, ["enabled", "canSleep"], b, p);
    if (body.fixedRotation !== undefined) hostBool(body.fixedRotation, b, p);
    for (const k of ["mass", "inertia"]) if (body[k] !== undefined) positive(body[k], b, p);
    ref(body.material, materials, b, p); ref(body.layer, layers, b, p);
    let solidCount = 0, unsupported = false;
    for (const c of hostArray(body.colliders, b, p)) {
      const q = collider(c, materials, layers, b, p);
      if (q.enabled && !q.trigger) { solidCount++; unsupported ||= q.shape === "edge" || q.shape === "chain"; }
    }
    if (body.kinematicController !== undefined) {
      const c = hostRecord(body.kinematicController, ["solidMaskBits", "maxIterations", "maxStepHeight", "maxDropHeight", "allowLedgeDrop"], b, p);
      if (body.type !== "kinematic" || !body.enabled || !solidCount || unsupported) b.fail("DATA", p);
      if (c.solidMaskBits !== undefined) resourceInteger(c.solidMaskBits, p);
      if (c.maxIterations !== undefined) resourceInteger(c.maxIterations, p, 1, 8);
      for (const k of ["maxStepHeight", "maxDropHeight"]) if (c[k] !== undefined) resourceFinite(c[k], p, 0, 65536);
      if (c.allowLedgeDrop !== undefined) hostBool(c.allowLedgeDrop, b, p);
    }
  }
  for (const [id, value] of hostEntries(r.joints, b, p)) {
    hostName(id, b, p);
    const j = hostRecord(value, ["id", "type", "bodyA", "bodyB", ...JOINT_NUM, ...JOINT_NONNEG, ...JOINT_BOOL, "stiffness", "damping", "frequencyHz", "dampingRatio", "breakForce", "breakTorque"], b, p);
    if (j.id !== id || j.bodyA === j.bodyB) b.fail("DATA", p);
    hostEnum(j.type, ["distance", "rope", "spring", "pulley", "revolute", "prismatic", "weld", "gear"], b, p);
    for (const k of ["bodyA", "bodyB"]) { hostName(j[k], b, p); if (j[k] !== "world" && !Object.prototype.hasOwnProperty.call(bodies, j[k] as string)) b.fail("DATA", p); }
    nums(j, JOINT_NUM, p); nums(j, JOINT_NONNEG, p, 0); bools(j, JOINT_BOOL, b, p);
    resourceFinite(j.stiffness, p, 0, 1); resourceFinite(j.damping, p, 0, 1);
    if (j.type === "pulley") positive(j.ratio, b, p);
    if (j.type !== "revolute" && j.continuousLimit) b.fail("DATA", p);
    if (j.frequencyHz !== undefined) { if (j.type !== "spring") b.fail("DATA", p); resourceFinite(j.frequencyHz, p, 0, 1000); }
    if (j.dampingRatio !== undefined) { if (j.frequencyHz === undefined) b.fail("DATA", p); resourceFinite(j.dampingRatio, p, 0, 10); }
    for (const k of ["breakForce", "breakTorque"]) if (j[k] !== undefined) resourceFinite(j[k], p, 0);
  }
  validateHostDebug(r.debug, b, p, true);
}
