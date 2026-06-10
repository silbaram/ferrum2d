#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createPhysicsWorldFromSpec } from "../../packages/ferrum-web/dist/physicsAuthoring.js";
import {
  createPhysicsReplayInputStream,
  verifyPhysicsReplayInputStreamRollback,
} from "../../packages/ferrum-web/dist/physicsSnapshot.js";

function main() {
const args = process.argv.slice(2);
const runs = parseRuns(args);
const scenarioArgs = args.filter((arg) => !arg.startsWith("--runs="));
const reports = [];

for (let runIndex = 0; runIndex < runs; runIndex += 1) {
  const result = spawnSync("node", ["tests/smoke/physics-smoke.mjs", ...scenarioArgs], {
    encoding: "utf8",
    env: { ...process.env, CARGO_TERM_COLOR: "never" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    process.stdout.write(output);
    fail(`physics smoke run ${runIndex + 1}/${runs} failed`);
  }
  const report = parseSmokeReport(output);
  report.stateReplay = runStateReplayScenario();
  reports.push(report);
  console.log(
    `PASS physics replay run=${runIndex + 1}/${runs} seed=${report.seed} frame=${report.frame} replayHash=${report.suiteHash} stateReplayHash=${report.stateReplay.replayHash}`,
  );
}

const expected = reports[0];
const mismatch = reports.find((report) => report.suiteHash !== expected.suiteHash);
if (mismatch !== undefined) {
  reportMismatch(expected, mismatch, reports.indexOf(mismatch) + 1);
  fail(`replay hash mismatch expected=${expected.suiteHash} actual=${mismatch.suiteHash}`);
}

const stateMismatch = reports.find((report) => report.stateReplay.replayHash !== expected.stateReplay.replayHash);
if (stateMismatch !== undefined) {
  const run = reports.indexOf(stateMismatch) + 1;
  fail(
    `state replay hash mismatch run=${run} expected=${expected.stateReplay.replayHash} actual=${stateMismatch.stateReplay.replayHash}`,
  );
}

console.log(
  `physics replay rollback gate passed runs=${runs} seed=${expected.seed} frame=${expected.frame} replayHash=${expected.suiteHash} stateReplayHash=${expected.stateReplay.replayHash}`,
);
}

function parseRuns(values) {
  const entry = values.find((arg) => arg.startsWith("--runs="));
  if (entry === undefined) {
    return 2;
  }
  const value = Number(entry.slice("--runs=".length));
  if (Number.isInteger(value) && value >= 2 && value <= 10) {
    return value;
  }
  fail("--runs must be an integer between 2 and 10");
}

function parseSmokeReport(output) {
  const suiteMatch = output.match(/physics smoke suite seed=([^ ]+) frame=([^ ]+) replayHash=([a-f0-9]+)/);
  if (!suiteMatch) {
    fail("physics smoke output did not include a suite replayHash");
  }
  const scenarios = new Map();
  const scenarioPattern = /(?:PASS|FAIL) (physics:[^ ]+) tests=([0-9]+) seed=([^ ]+) frame=([^ ]+) replayHash=([a-f0-9]+)/g;
  for (const match of output.matchAll(scenarioPattern)) {
    scenarios.set(match[1], {
      testCount: Number(match[2]),
      seed: match[3],
      frame: match[4],
      replayHash: match[5],
    });
  }
  return {
    seed: suiteMatch[1],
    frame: suiteMatch[2],
    suiteHash: suiteMatch[3],
    scenarios,
  };
}

function runStateReplayScenario() {
  const engine = new ReplayStateEngine();
  const world = createPhysicsWorldFromSpec(engine, {
    mode: "rigid",
    solver: { stepSeconds: 0.25 },
    bodies: {
      mover: {
        type: "dynamic",
        collider: { shape: "circle", radius: 5 },
        mass: 2,
        velocity: [1, 0],
      },
    },
  });
  const inputStream = createPhysicsReplayInputStream({
    frameCount: 4,
    fixedStepSeconds: 0.25,
    seed: 7,
    snapshotIntervalFrames: 2,
    events: [
      { frame: 1, body: "mover", type: "setVelocity", velocityX: 2, velocityY: 0 },
      { frame: 2, body: "mover", type: "applyImpulse", impulseX: 2, impulseY: 0 },
    ],
  });
  const rollback = verifyPhysicsReplayInputStreamRollback(engine, world, inputStream);
  if (!rollback.passed) {
    fail(`state replay rollback mismatch expected=${rollback.expectedHash} actual=${rollback.actualHash}`);
  }
  return {
    replayHash: rollback.expectedHash,
    finalX: rollback.expectedRun.finalSnapshot.bodies.mover.state.x,
    snapshotCount: rollback.expectedRun.snapshots.length,
  };
}

function reportMismatch(expected, actual, run) {
  console.error("physics replay mismatch report:");
  console.error(`  run=${run}`);
  console.error(`  seed=${actual.seed}`);
  console.error(`  frame=${actual.frame}`);
  console.error(`  expectedSuiteHash=${expected.suiteHash}`);
  console.error(`  actualSuiteHash=${actual.suiteHash}`);
  for (const [scenario, actualScenario] of actual.scenarios.entries()) {
    const expectedScenario = expected.scenarios.get(scenario);
    if (expectedScenario === undefined || expectedScenario.replayHash !== actualScenario.replayHash) {
      console.error(
        `  scenario=${scenario} expectedHash=${expectedScenario?.replayHash ?? "missing"} actualHash=${actualScenario.replayHash}`,
      );
    }
  }
}

function fail(message) {
  console.error(`physics replay failed: ${message}`);
  process.exit(1);
}

class ReplayStateEngine {
  nextEntityId = 1;
  bodies = new Map();
  colliders = new Map();

  configureFixedTimestep(_options) {}

  setPhysicsDebugLinesEnabled(_options) {}

  spawnRigidBody(options) {
    const handle = { entityId: this.nextEntityId, entityGeneration: 1 };
    this.nextEntityId += 1;
    const material = materialSnapshot(options.material);
    const colliderMaterial = options.colliderMaterial === undefined
      ? material
      : materialSnapshot(options.colliderMaterial);
    const mass = options.mass ?? options.density ?? material.density;
    const inertia = mass;
    this.bodies.set(handle.entityId, {
      ...handle,
      x: options.x,
      y: options.y,
      velocityX: options.velocityX ?? 0,
      velocityY: options.velocityY ?? 0,
      rotationRadians: options.rotationRadians ?? 0,
      angularVelocityRadiansPerSecond: options.angularVelocityRadiansPerSecond ?? 0,
      bodyType: options.bodyType ?? "dynamic",
      bodyEnabled: options.bodyEnabled ?? true,
      isSleeping: false,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: options.colliderMaterial !== undefined,
      colliderMaterial,
      mass,
      inverseMass: mass > 0 ? 1 / mass : 0,
      inertia,
      inverseInertia: inertia > 0 ? 1 / inertia : 0,
      gravityScale: options.gravityScale ?? 1,
      linearDamping: options.linearDamping ?? 0,
      angularDamping: options.angularDamping ?? 0,
      ...(options.heightSpan === undefined ? {} : { heightSpan: normalizeHeightSpan(options.heightSpan) }),
      ...material,
    });
    this.colliders.set(handle.entityId, [{
      colliderIndex: 0,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: options.colliderMaterial !== undefined,
      colliderMaterial,
      categoryBits: options.categoryBits ?? 1,
      maskBits: options.maskBits ?? 0xffffffff,
    }]);
    return handle;
  }

  addPhysicsBodyCollider(handle, options) {
    const body = this.bodies.get(handle.entityId);
    const colliders = this.colliders.get(handle.entityId);
    if (!body || !colliders) return false;
    colliders.push({
      colliderIndex: colliders.length,
      colliderType: options.collider.type,
      colliderEnabled: options.colliderEnabled ?? true,
      colliderIsTrigger: options.isTrigger === true,
      colliderOffsetX: options.collider.offsetX ?? 0,
      colliderOffsetY: options.collider.offsetY ?? 0,
      colliderMaterialOverride: false,
      colliderMaterial: materialSnapshot(body),
      categoryBits: options.categoryBits ?? 1,
      maskBits: options.maskBits ?? 0xffffffff,
    });
    return true;
  }

  getPhysicsBodyColliderCount(handle) {
    return this.colliders.get(handle.entityId)?.length ?? 0;
  }

  getPhysicsBodyCollider(handle, colliderIndex) {
    const collider = this.colliders.get(handle.entityId)?.[colliderIndex];
    return collider === undefined ? undefined : {
      ...collider,
      colliderMaterial: { ...collider.colliderMaterial },
    };
  }

  getPhysicsEntity(handle) {
    return cloneBody(this.bodies.get(handle.entityId));
  }

  despawnPhysicsEntity(handle) {
    this.colliders.delete(handle.entityId);
    return this.bodies.delete(handle.entityId);
  }

  setPhysicsBodyPosition(handle, x, y) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.x = x;
    body.y = y;
    return true;
  }

  setPhysicsBodyVelocity(handle, velocityX, velocityY) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.velocityX = velocityX;
    body.velocityY = velocityY;
    return true;
  }

  setPhysicsBodyRotation(handle, rotationRadians) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.rotationRadians = rotationRadians;
    return true;
  }

  setPhysicsBodyAngularVelocity(handle, radiansPerSecond) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.angularVelocityRadiansPerSecond = radiansPerSecond;
    return true;
  }

  setPhysicsBodyHeightSpan(handle, span) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.heightSpan = normalizeHeightSpan(span);
    return true;
  }

  clearPhysicsBodyHeightSpan(handle) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    delete body.heightSpan;
    return true;
  }

  getPhysicsBodyHeightSpan(handle) {
    const body = this.bodies.get(handle.entityId);
    return body?.heightSpan === undefined ? undefined : { ...body.heightSpan };
  }

  setPhysicsBodyEnabled(handle, enabled) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.bodyEnabled = enabled;
    return true;
  }

  setPhysicsColliderOffset(handle, offsetX, offsetY) {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderOffsetX = offsetX;
    body.colliderOffsetY = offsetY;
    if (primary) {
      primary.colliderOffsetX = offsetX;
      primary.colliderOffsetY = offsetY;
    }
    return true;
  }

  setPhysicsColliderEnabled(handle, enabled) {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderEnabled = enabled;
    if (primary) {
      primary.colliderEnabled = enabled;
    }
    return true;
  }

  setPhysicsBodyMassProperties(handle, properties) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.mass = properties.mass;
    body.inverseMass = 1 / properties.mass;
    body.inertia = properties.inertia;
    body.inverseInertia = 1 / properties.inertia;
    return true;
  }

  setPhysicsBodyTuning(handle, tuning) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.gravityScale = tuning.gravityScale ?? body.gravityScale;
    body.linearDamping = tuning.linearDamping ?? body.linearDamping;
    body.angularDamping = tuning.angularDamping ?? body.angularDamping;
    return true;
  }

  setPhysicsBodyMaterial(handle, material) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    const resolved = materialSnapshot(material);
    Object.assign(body, resolved);
    if (!body.colliderMaterialOverride) {
      body.colliderMaterial = resolved;
    }
    for (const collider of this.colliders.get(handle.entityId) ?? []) {
      if (!collider.colliderMaterialOverride) {
        collider.colliderMaterial = resolved;
      }
    }
    return true;
  }

  setPhysicsColliderMaterial(handle, material) {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderMaterialOverride = true;
    body.colliderMaterial = materialSnapshot(material);
    if (primary) {
      primary.colliderMaterialOverride = true;
      primary.colliderMaterial = materialSnapshot(material);
    }
    return true;
  }

  setPhysicsBodyColliderMaterial(handle, colliderIndex, material) {
    const collider = this.colliders.get(handle.entityId)?.[colliderIndex];
    if (!collider) return false;
    collider.colliderMaterialOverride = true;
    collider.colliderMaterial = materialSnapshot(material);
    return true;
  }

  clearPhysicsColliderMaterial(handle) {
    const body = this.bodies.get(handle.entityId);
    const primary = this.colliders.get(handle.entityId)?.[0];
    if (!body) return false;
    body.colliderMaterialOverride = false;
    body.colliderMaterial = materialSnapshot(body);
    if (primary) {
      primary.colliderMaterialOverride = false;
      primary.colliderMaterial = materialSnapshot(body);
    }
    return true;
  }

  applyPhysicsBodyForce(handle, forceX, forceY) {
    return this.applyPhysicsBodyImpulse(handle, forceX, forceY);
  }

  applyPhysicsBodyImpulse(handle, impulseX, impulseY) {
    const body = this.bodies.get(handle.entityId);
    if (!body) return false;
    body.velocityX += impulseX / body.mass;
    body.velocityY += impulseY / body.mass;
    return true;
  }

  stepRigidBodies(deltaSeconds, _options) {
    for (const body of this.bodies.values()) {
      if (!body.bodyEnabled || body.bodyType === "static") {
        continue;
      }
      body.x += body.velocityX * deltaSeconds;
      body.y += body.velocityY * deltaSeconds;
      body.rotationRadians += body.angularVelocityRadiansPerSecond * deltaSeconds;
    }
    return {};
  }
}

function materialSnapshot(material) {
  return {
    restitution: material?.restitution ?? 0,
    friction: material?.friction ?? 0.4,
    surfaceVelocityX: material?.surfaceVelocityX ?? 0,
    surfaceVelocityY: material?.surfaceVelocityY ?? 0,
    density: material?.density ?? 1,
    contactBaumgarteBiasScale: material?.contactBaumgarteBiasScale ?? 1,
    maxContactBaumgarteBiasVelocityScale: material?.maxContactBaumgarteBiasVelocityScale ?? 1,
    contactPositionCorrectionScale: material?.contactPositionCorrectionScale ?? 1,
    contactPositionCorrectionSlopScale: material?.contactPositionCorrectionSlopScale ?? 1,
  };
}

function normalizeHeightSpan(span) {
  return {
    floorId: span.floorId ?? 0,
    elevation: span.elevation,
    height: span.height,
  };
}

function cloneBody(body) {
  return body === undefined
    ? undefined
    : {
        ...body,
        colliderMaterial: { ...body.colliderMaterial },
        ...(body.heightSpan === undefined ? {} : { heightSpan: { ...body.heightSpan } }),
      };
}

main();
