import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { diagnosticReport } from "../src/diagnostics.js";
import {
  compilePhysicsAuthoringDocument,
  isPhysicsAuthoringDocument,
  PHYSICS_AUTHORING_SCHEMA_VERSION,
  validatePhysicsAuthoringDocument,
  type PhysicsAuthoringDocument,
} from "../src/physicsAuthoringSchema.js";

test("physics authoring schema strips editor metadata during runtime export", () => {
  const document: PhysicsAuthoringDocument = {
    physics: {
      mode: "rigid",
      bodies: {
        crate: {
          type: "dynamic",
          mass: 2,
          collider: { shape: "box", size: [32, 32] },
        },
      },
    },
    physicsEditor: {
      version: PHYSICS_AUTHORING_SCHEMA_VERSION,
      displayName: "Crate scene",
      lockedFields: ["physics.bodies.crate.collider.shape"],
      agentEditableFields: ["physics.bodies.crate.mass"],
      bodies: {
        crate: {
          displayName: "Crate",
          gizmo: "box",
          preset: "wood-crate",
        },
      },
    },
  };

  ok(isPhysicsAuthoringDocument(document));
  validatePhysicsAuthoringDocument(document);
  const runtimeSpec = compilePhysicsAuthoringDocument(document);

  deepEqual(runtimeSpec, document.physics);
  ok(!("physicsEditor" in runtimeSpec));
});

test("physics authoring schema rejects editor paths that target metadata", () => {
  const error = captureError(() => compilePhysicsAuthoringDocument({
    physics: {
      bodies: {
        crate: {
          collider: { shape: "box", size: [32, 32] },
        },
      },
    },
    physicsEditor: {
      lockedFields: ["physicsEditor.bodies.crate.gizmo"],
    },
  }));

  const report = diagnosticReport(error);
  equal(report.code, "FERRUM_PHYSICS_SPEC_INVALID");
  ok(/path='physicsAuthoring\.physicsEditor\.lockedFields\.0'/.test(report.message));
  ok(/runtime physics path/.test(report.message));
});

test("physics authoring schema rejects metadata for unknown runtime body", () => {
  const error = captureError(() => validatePhysicsAuthoringDocument({
    physics: {
      bodies: {
        crate: {
          collider: { shape: "box", size: [32, 32] },
        },
      },
    },
    physicsEditor: {
      bodies: {
        missing: {
          displayName: "Missing",
        },
      },
    },
  }));

  const report = diagnosticReport(error);
  equal(report.code, "FERRUM_PHYSICS_SPEC_INVALID");
  ok(/path='physicsAuthoring\.physicsEditor\.bodies\.missing'/.test(report.message));
  ok(/unknown body/.test(report.message));
});

test("physics authoring schema rejects non-object metadata entries", () => {
  const error = captureError(() => validatePhysicsAuthoringDocument({
    physics: {
      bodies: {
        crate: {
          collider: { shape: "box", size: [32, 32] },
        },
      },
    },
    physicsEditor: {
      bodies: {
        crate: "crate metadata",
      } as never,
    },
  }));

  const report = diagnosticReport(error);
  equal(report.code, "FERRUM_PHYSICS_SPEC_INVALID");
  ok(/path='physicsAuthoring\.physicsEditor\.bodies\.crate'/.test(report.message));
  ok(/body metadata must be an object/.test(report.message));
});

function captureError(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error("expected action to throw");
}
