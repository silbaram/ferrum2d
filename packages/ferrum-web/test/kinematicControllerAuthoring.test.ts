import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { resolveDataSceneComponentsSpec } from "../src/dataSceneComponents.js";
import { resolveDataSceneKinematicControllerOptions } from "../src/dataSceneKinematicController.js";
import { diagnosticReport } from "../src/diagnostics.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

const defaults = { solidMaskBits: 0xffffffff, maxIterations: 4, maxStepHeight: 0,
  maxDropHeight: 0, allowLedgeDrop: false };
const collider = { shape: "box", size: [8, 8] };
const body = { type: "kinematic", collider, kinematicController: {} };
const components = {
  visual: { kind: "primitive", shape: "rect", width: 8, height: 8 },
  collider: { type: "aabb", halfWidth: 4, halfHeight: 4, isTrigger: false },
  layer: "player",
};

test("controller authoring resolves owned defaults and preserves zero, false and f32 heights", () => {
  const options = { solidMaskBits: 0, maxIterations: 1, maxStepHeight: 0.1,
    maxDropHeight: 0, allowLedgeDrop: false };
  const resolved = resolvePhysicsSpec({ bodies: { actor: { ...body, kinematicController: options } } });
  deepEqual(resolved.bodies.actor.kinematicController, { ...options, maxStepHeight: Math.fround(0.1) });
  equal(resolved.bodies.actor.kinematicController === options, false);
  options.maxStepHeight = 12;
  equal(resolved.bodies.actor.kinematicController?.maxStepHeight, Math.fround(0.1));
  const empty = resolvePhysicsSpec({ bodies: { actor: body } }).bodies.actor.kinematicController;
  deepEqual(empty, defaults);
  equal(empty === resolvePhysicsSpec({ bodies: { actor: body } }).bodies.actor.kinematicController, false);
  equal(resolvePhysicsSpec({ bodies: { actor: { type: "kinematic", collider } } })
    .bodies.actor.kinematicController, undefined);
});

test("Physics Spec controller authoring requires explicit enabled kinematic solid convex sources", () => {
  for (const actor of [
    { collider, kinematicController: {} },
    { ...body, type: "dynamic" }, { ...body, type: "static" }, { ...body, enabled: false },
    { type: "kinematic", kinematicController: {} },
    { ...body, collider: { ...collider, trigger: true } },
    { ...body, collider: { ...collider, enabled: false } },
    { ...body, collider: { shape: "edge", start: [-1, 0], end: [1, 0] } },
    { ...body, collider: { shape: "chain", vertices: [[-1, 0], [1, 0]] } },
    { type: "kinematic", kinematicController: {}, colliders: [collider,
      { shape: "edge", start: [-1, 0], end: [1, 0] }] },
  ]) {
    throws(() => resolvePhysicsSpec({ bodies: { actor } }), /physics.bodies.actor.kinematicController/);
  }
});

test("Physics Spec controller source checks skip disabled and trigger colliders", () => {
  const spec = resolvePhysicsSpec({ bodies: { actor: {
    type: "kinematic", kinematicController: {}, colliders: [collider,
      { shape: "edge", start: [-1, 0], end: [1, 0], enabled: false },
      { shape: "chain", vertices: [[-1, 0], [1, 0]], trigger: true }],
  } } });
  deepEqual(spec.bodies.actor.kinematicController, defaults);
});

test("controller authoring rejects none and preserves controller settings for either native clock", () => {
  throws(() => resolvePhysicsSpec({ mode: "none", bodies: { actor: body } }), /native|none/);
  for (const mode of ["arcade", "rigid"] as const) for (const fixedTimestep of [false, true]) {
    const spec = resolvePhysicsSpec({ mode, solver: { fixedTimestep }, bodies: { actor: body } });
    equal(spec.solver.fixedTimestep, fixedTimestep);
    deepEqual(spec.bodies.actor.kinematicController, defaults);
  }
  throws(() => resolvePhysicsSpec({ bodies: { actor: body } }, { modeOverride: "none" }), /native|none/);
});

test("controller option validation is object-only, bounded and shared by both authoring paths", () => {
  const invalid: unknown[] = [false, true, null, 1, "auto", [], { maxStepHeigth: 4 },
    { solidMaskBits: -1 }, { solidMaskBits: 0x100000000 }, { solidMaskBits: 1.5 },
    { solidMaskBits: NaN }, { solidMaskBits: Infinity }, { solidMaskBits: null },
    { maxIterations: 0 }, { maxIterations: 9 }, { maxIterations: 1.5 }, { maxIterations: "4" },
    { maxStepHeight: -1 }, { maxStepHeight: 65536.001 }, { maxStepHeight: Number.MAX_VALUE },
    { maxStepHeight: Infinity }, { maxStepHeight: NaN }, { maxStepHeight: null },
    { maxDropHeight: -1 }, { maxDropHeight: 65536.001 }, { maxDropHeight: Infinity },
    { allowLedgeDrop: 0 }, { allowLedgeDrop: "false" }, { allowLedgeDrop: null }];
  for (const kinematicController of invalid) {
    expectDiagnostic(() => resolvePhysicsSpec({ bodies: { actor: { ...body, kinematicController } } }),
      "FERRUM_PHYSICS_SPEC_INVALID", "physics.bodies.actor.kinematicController");
    expectDiagnostic(() => resolveDataSceneComponentsSpec({ ...components,
      body: { type: "kinematic", kinematicController } }),
    "FERRUM_SCENE_COMPOSITION_INVALID", "components.body.kinematicController");
  }
});

test("controller options accept inclusive boundaries and ignore inherited fields", () => {
  deepEqual(resolveDataSceneKinematicControllerOptions({ solidMaskBits: 0xffffffff, maxIterations: 8,
    maxStepHeight: 65536, maxDropHeight: 65536, allowLedgeDrop: true }),
  { ...defaults, maxIterations: 8, maxStepHeight: 65536, maxDropHeight: 65536, allowLedgeDrop: true });
  deepEqual(resolveDataSceneKinematicControllerOptions(Object.create({ maxIterations: 0, maxStepHeight: Infinity })), defaults);
});

test("Data Scene legacy kinematic bodies carry owned controller defaults and authored values", () => {
  const kinematicController = { solidMaskBits: 0, maxDropHeight: 3, allowLedgeDrop: false };
  const result = resolveDataSceneComponentsSpec({ ...components, body: { type: "kinematic", kinematicController } });
  equal(result.mode, "inline");
  if (result.mode !== "inline" || result.body?.type !== "kinematic") throw new Error("expected legacy kinematic body");
  deepEqual(result.body.kinematicController, { ...defaults, ...kinematicController });
  equal(result.body.kinematicController === kinematicController, false);
  kinematicController.maxDropHeight = 99;
  equal(result.body.kinematicController?.maxDropHeight, 3);
  const omitted = resolveDataSceneComponentsSpec({ ...components, body: { type: "kinematic" } });
  if (omitted.mode !== "inline" || omitted.body?.type !== "kinematic") throw new Error("expected legacy kinematic body");
  equal(omitted.body.kinematicController, undefined);
});

test("Data Scene rejects controller options on other bodies and unavailable collider sources", () => {
  for (const type of ["static", "dynamic"]) {
    throws(() => resolveDataSceneComponentsSpec({ ...components, body: { type, kinematicController: {} } }),
      /components.body.kinematicController/);
  }
  for (const source of ["none", { ...components.collider, enabled: false },
    { ...components.collider, isTrigger: true }, { type: "aabb", halfWidth: 4, halfHeight: 4 }]) {
    throws(() => resolveDataSceneComponentsSpec({ ...components, collider: source,
      body: { type: "kinematic", kinematicController: {} } }), /components.body/);
  }
});

function expectDiagnostic(action: () => unknown, code: string, pathPrefix: string): void {
  let reported = false;
  try { action(); } catch (error) {
    const report = diagnosticReport(error);
    equal(report.code, code);
    equal(report.context?.path?.startsWith(pathPrefix), true);
    reported = true;
  }
  equal(reported, true);
}
