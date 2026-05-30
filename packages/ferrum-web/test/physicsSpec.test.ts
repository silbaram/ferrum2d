import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { diagnosticReport } from "../src/diagnostics.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

test("resolvePhysicsSpec defaults HD-2D authoring to disabled without changing body height", () => {
  const spec = resolvePhysicsSpec({
    bodies: {
      actor: {
        collider: { shape: "box", size: [16, 16] },
      },
    },
  });

  equal(spec.hd2d.enabled, false);
  equal(spec.hd2d.defaultHeight, 0);
  equal(spec.hd2d.maxStepHeight, 0);
  equal(spec.hd2d.maxDropHeight, 0);
  equal(spec.bodies.actor.floor, "default");
  equal(spec.bodies.actor.elevation, 0);
  equal(spec.bodies.actor.height, 0);
});

test("resolvePhysicsSpec resolves HD-2D defaults and body floor spans", () => {
  const spec = resolvePhysicsSpec({
    hd2d: {
      enabled: true,
      defaultHeight: 32,
      maxStepHeight: 8,
      maxDropHeight: 16,
    },
    bodies: {
      actor: {
        type: "kinematic",
        floor: "ground",
        elevation: 4,
        height: 40,
        collider: { shape: "capsule", start: [0, -8], end: [0, 8], radius: 8 },
      },
      crate: {
        collider: { shape: "box", size: [12, 12] },
      },
    },
  });

  equal(spec.hd2d.enabled, true);
  equal(spec.hd2d.defaultHeight, 32);
  equal(spec.hd2d.maxStepHeight, 8);
  equal(spec.hd2d.maxDropHeight, 16);
  equal(spec.bodies.actor.floor, "ground");
  equal(spec.bodies.actor.elevation, 4);
  equal(spec.bodies.actor.height, 40);
  equal(spec.bodies.crate.floor, "default");
  equal(spec.bodies.crate.elevation, 0);
  equal(spec.bodies.crate.height, 32);
});

test("resolvePhysicsSpec computes layer masks from declared layer order", () => {
  const spec = resolvePhysicsSpec({
    layers: {
      player: { mask: ["enemy", "bullet"] },
      enemy: { mask: ["player"] },
      bullet: { mask: ["enemy"] },
    },
  });

  equal(spec.layers.player.categoryBits, 1);
  equal(spec.layers.enemy.categoryBits, 2);
  equal(spec.layers.bullet.categoryBits, 4);
  equal(spec.layers.player.maskBits, 6);
  equal(spec.layers.enemy.maskBits, 1);
  equal(spec.layers.bullet.maskBits, 2);
});

test("resolvePhysicsSpec rejects inherited object keys as references", () => {
  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {
          material: "toString",
        },
      },
    }),
    /path='physics\.bodies\.actor\.material'/,
  );

  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {},
      },
      joints: {
        bad: {
          type: "distance",
          bodyA: "constructor",
          bodyB: "actor",
        },
      },
    }),
    /path='physics\.joints\.bad\.bodyA'/,
  );
});

test("resolvePhysicsSpec preserves __proto__ ids as own resolved entries", () => {
  const spec = resolvePhysicsSpec({
    materials: Object.fromEntries([
      ["__proto__", { friction: 0.5 }],
    ]),
    layers: Object.fromEntries([
      ["__proto__", { mask: ["player"] }],
      ["player", { mask: ["__proto__"] }],
    ]),
    bodies: Object.fromEntries([
      ["__proto__", { material: "__proto__", layer: "__proto__" }],
      ["player", { layer: "player" }],
    ]),
    joints: Object.fromEntries([
      ["__proto__", { type: "distance", bodyA: "__proto__", bodyB: "player" }],
    ]),
  });

  ok(Object.prototype.hasOwnProperty.call(spec.materials, "__proto__"));
  ok(Object.prototype.hasOwnProperty.call(spec.layers, "__proto__"));
  ok(Object.prototype.hasOwnProperty.call(spec.bodies, "__proto__"));
  ok(Object.prototype.hasOwnProperty.call(spec.joints, "__proto__"));
  equal(spec.materials["__proto__"]?.friction, 0.5);
  equal(spec.layers["__proto__"]?.maskBits, 2);
  equal(spec.layers.player.maskBits, 1);
  equal(spec.bodies["__proto__"]?.material, "__proto__");
  equal(spec.joints["__proto__"]?.bodyA, "__proto__");
});

test("resolvePhysicsSpec rejects world to world joints before runtime authoring", () => {
  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      joints: {
        bad: {
          type: "distance",
          bodyA: "world",
          bodyB: "world",
        },
      },
    }),
    /path='physics\.joints\.bad\.bodyB'/,
  );
});

test("resolvePhysicsSpec rejects ignored box collider rotation", () => {
  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {
          collider: {
            shape: "box",
            size: [16, 16],
            rotationRadians: 0.25,
          },
        },
      },
    }),
    /path='physics\.bodies\.actor\.collider\.rotationRadians'/,
  );
});

test("resolvePhysicsSpec reports non-array colliders as physics diagnostics", () => {
  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {
          colliders: {
            shape: "circle",
            radius: 4,
          },
        },
      },
    }),
    /path='physics\.bodies\.actor\.colliders'/,
  );
});

test("resolvePhysicsSpec rejects invalid HD-2D values", () => {
  const hd2dCases: Array<[unknown, RegExp]> = [
    [{ enabled: "true" }, /path='physics\.hd2d\.enabled'/],
    [{ defaultHeight: -1 }, /path='physics\.hd2d\.defaultHeight'/],
    [{ maxStepHeight: -1 }, /path='physics\.hd2d\.maxStepHeight'/],
    [{ maxDropHeight: Number.NaN }, /path='physics\.hd2d\.maxDropHeight'/],
  ];
  for (const [hd2d, pattern] of hd2dCases) {
    expectPhysicsSpecDiagnostic(
      () => resolvePhysicsSpec({ hd2d }),
      pattern,
    );
  }

  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {
          elevation: Number.POSITIVE_INFINITY,
          collider: { shape: "box", size: [16, 16] },
        },
      },
    }),
    /path='physics\.bodies\.actor\.elevation'/,
  );

  expectPhysicsSpecDiagnostic(
    () => resolvePhysicsSpec({
      bodies: {
        actor: {
          height: -0.5,
          collider: { shape: "box", size: [16, 16] },
        },
      },
    }),
    /path='physics\.bodies\.actor\.height'/,
  );
});

function expectPhysicsSpecDiagnostic(action: () => void, messagePattern: RegExp): void {
  try {
    action();
  } catch (error) {
    const report = diagnosticReport(error);
    equal(report.code, "FERRUM_PHYSICS_SPEC_INVALID");
    ok(messagePattern.test(report.message), report.message);
    return;
  }
  throw new Error("expected physics spec diagnostic");
}
