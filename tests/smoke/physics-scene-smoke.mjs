import {
  applyPhysicsSceneProfile,
} from "../../packages/ferrum-web/dist/index.js";

const autoStepOptions = [];
const spawnedBodies = [];
const despawnedBodies = [];

const engine = {
  configurePhysicsRuntime: (spec) => spec,
  configureAutoRigidBodyStep: (options) => {
    autoStepOptions.push(options);
  },
  spawnRigidBody: (options) => {
    spawnedBodies.push(options);
    return { entityId: spawnedBodies.length, entityGeneration: 1 };
  },
  despawnPhysicsEntity: (handle) => {
    despawnedBodies.push(handle);
    return true;
  },
  clearPhysicsJoint: () => true,
};

const scene = applyPhysicsSceneProfile(engine, {
  profile: "runtime",
  physics: {
    mode: "rigid",
    gravity: [0, 720],
    solver: {
      stepSeconds: 1 / 120,
      velocityIterations: 5,
      positionIterations: 3,
    },
    bodies: {
      ground: { type: "static", collider: { shape: "box", size: [320, 24] } },
      crate: { type: "dynamic", position: [40, 12], collider: { shape: "box", size: [16, 16] } },
    },
  },
});

const autoStep = autoStepOptions.at(-1);
if (!scene.autoStep || scene.bodyCount !== 2 || scene.stepSeconds !== 1 / 120) {
  throw new Error("physics scene profile did not apply the expected runtime world.");
}
if (typeof autoStep !== "object" || autoStep.gravityY !== 720 || autoStep.velocityIterations !== 5) {
  throw new Error("physics scene profile did not configure runtime auto-step from Physics Spec.");
}
if (spawnedBodies.length !== 2) {
  throw new Error("physics scene profile did not spawn spec bodies.");
}

scene.clear();
if (autoStepOptions.at(-1) !== false || despawnedBodies.length !== 2) {
  throw new Error("physics scene profile clear did not disable auto-step and clear bodies.");
}

console.log(JSON.stringify({
  physicsSceneSmoke: {
    profile: scene.profile,
    autoStep: scene.autoStep,
    bodyCount: scene.bodyCount,
    stepSeconds: scene.stepSeconds,
  },
}, null, 2));
