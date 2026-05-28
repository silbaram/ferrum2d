import { equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { diagnosticReport } from "../src/diagnostics.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

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
