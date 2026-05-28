import type {
  FerrumEngine,
  PhysicsRigidBodyStepStats,
} from "./engineTypes.js";
import { physicsSpecDiagnosticError } from "./diagnostics.js";
import type { PhysicsWorldApplyResult } from "./physicsAuthoring.js";
import {
  PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
  PHYSICS_REPLAY_INPUT_STREAM_VERSION,
  type PhysicsReplayFrameSnapshot,
  type PhysicsReplayInputEvent,
  type PhysicsReplayInputRollbackOptions,
  type PhysicsReplayInputRollbackResult,
  type PhysicsReplayInputRunOptions,
  type PhysicsReplayInputRunResult,
  type PhysicsReplayInputStream,
} from "./physicsSnapshotTypes.js";
import {
  hashPhysicsReplayRun,
} from "./physicsSnapshotHash.js";
import {
  capturePhysicsWorldSnapshot,
  restorePhysicsWorldSnapshot,
} from "./physicsWorldSnapshot.js";
import {
  ensureRuntimeAccepted,
  finitePositiveNumber,
  nonNegativeInteger,
  positiveInteger,
  validatePhysicsReplayEventPayload,
  validatePhysicsReplayInputStream,
} from "./physicsSnapshotValidation.js";

export function createPhysicsReplayInputStream(
  options: Omit<PhysicsReplayInputStream, "format" | "version">,
): PhysicsReplayInputStream {
  const stream: PhysicsReplayInputStream = {
    format: PHYSICS_REPLAY_INPUT_STREAM_FORMAT,
    version: PHYSICS_REPLAY_INPUT_STREAM_VERSION,
    frameCount: nonNegativeInteger(options.frameCount, "physics replay frameCount"),
    ...(options.fixedStepSeconds === undefined
      ? {}
      : { fixedStepSeconds: finitePositiveNumber(options.fixedStepSeconds, "physics replay fixedStepSeconds") }),
    ...(options.seed === undefined ? {} : { seed: nonNegativeInteger(options.seed, "physics replay seed") }),
    ...(options.snapshotIntervalFrames === undefined
      ? {}
      : {
          snapshotIntervalFrames: positiveInteger(
            options.snapshotIntervalFrames,
            "physics replay snapshotIntervalFrames",
          ),
        }),
    events: [...replayInputEventsFromOptions(options.events)],
  };
  validatePhysicsReplayInputStream(stream, "physics.replay");
  return stream;
}

export function runPhysicsReplayInputStream(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  inputStream: PhysicsReplayInputStream,
  options: PhysicsReplayInputRunOptions = {},
): PhysicsReplayInputRunResult {
  const path = options.path ?? "physics.replay";
  validatePhysicsReplayInputStream(inputStream, path);
  const frameCount = inputStream.frameCount;
  const deltaSeconds = finitePositiveNumber(
    inputStream.fixedStepSeconds ?? world.stepSeconds,
    `${path}.fixedStepSeconds`,
  );
  const eventsByFrame = replayEventsByFrame(inputStream, path);
  const stepOptions = options.stepOptions ?? world.stepOptions;
  const stepStats: PhysicsRigidBodyStepStats[] = [];
  const snapshots: PhysicsReplayFrameSnapshot[] = [];
  const snapshotIntervalFrames = inputStream.snapshotIntervalFrames;

  appendReplaySnapshot(engine, world, 0, snapshots);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const event of eventsByFrame.get(frame) ?? []) {
      applyPhysicsReplayInputEvent(engine, world, event, path);
    }
    stepStats.push(engine.stepRigidBodies(deltaSeconds, stepOptions));
    const nextFrame = frame + 1;
    if (
      nextFrame === frameCount ||
      (snapshotIntervalFrames !== undefined && nextFrame % snapshotIntervalFrames === 0)
    ) {
      appendReplaySnapshot(engine, world, nextFrame, snapshots);
    }
  }

  const finalSnapshot = snapshots[snapshots.length - 1]?.snapshot
    ?? capturePhysicsWorldSnapshot(engine, world, { frame: frameCount });
  const resultHash = hashPhysicsReplayRun(inputStream, snapshots);
  return {
    inputStream,
    frameCount,
    deltaSeconds,
    ...(inputStream.seed === undefined ? {} : { seed: inputStream.seed }),
    replayHash: resultHash,
    snapshots,
    finalSnapshot,
    stepStats,
  };
}

export function verifyPhysicsReplayInputStreamRollback(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  inputStream: PhysicsReplayInputStream,
  options: PhysicsReplayInputRollbackOptions = {},
): PhysicsReplayInputRollbackResult {
  const initialSnapshot = capturePhysicsWorldSnapshot(engine, world, { frame: 0 });
  const expectedRun = runPhysicsReplayInputStream(engine, world, inputStream, options);
  const restoredWorld = restorePhysicsWorldSnapshot(engine, initialSnapshot, {
    replace: world,
    path: options.restorePath ?? options.path,
  });
  const actualRun = runPhysicsReplayInputStream(engine, restoredWorld, inputStream, options);
  return {
    passed: expectedRun.replayHash === actualRun.replayHash,
    initialHash: initialSnapshot.replayHash,
    expectedHash: expectedRun.replayHash,
    actualHash: actualRun.replayHash,
    expectedRun,
    actualRun,
    restoredWorld,
  };
}

function replayEventsByFrame(
  inputStream: PhysicsReplayInputStream,
  path: string,
): Map<number, PhysicsReplayInputEvent[]> {
  const eventsByFrame = new Map<number, PhysicsReplayInputEvent[]>();
  (inputStream.events ?? []).forEach((event, index) => {
    const eventPath = `${path}.events.${index}`;
    const bodyEvents = eventsByFrame.get(event.frame) ?? [];
    bodyEvents.push(event);
    eventsByFrame.set(event.frame, bodyEvents);
    validatePhysicsReplayEventPayload(event, eventPath);
  });
  return eventsByFrame;
}

function applyPhysicsReplayInputEvent(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  event: PhysicsReplayInputEvent,
  path: string,
): void {
  const handle = world.bodies[event.body];
  if (!handle) {
    throw physicsSpecDiagnosticError(`${path}.events.${event.frame}.body`, `references unknown body '${event.body}'`);
  }
  switch (event.type) {
    case "setPosition":
      ensureRuntimeAccepted(engine.setPhysicsBodyPosition(handle, event.x, event.y), `${path}.events.${event.frame}`);
      break;
    case "setVelocity":
      ensureRuntimeAccepted(
        engine.setPhysicsBodyVelocity(handle, event.velocityX, event.velocityY),
        `${path}.events.${event.frame}`,
      );
      break;
    case "setEnabled":
      ensureRuntimeAccepted(engine.setPhysicsBodyEnabled(handle, event.enabled), `${path}.events.${event.frame}`);
      break;
    case "applyForce":
      ensureRuntimeAccepted(
        engine.applyPhysicsBodyForce(handle, event.forceX, event.forceY),
        `${path}.events.${event.frame}`,
      );
      break;
    case "applyImpulse":
      ensureRuntimeAccepted(
        engine.applyPhysicsBodyImpulse(handle, event.impulseX, event.impulseY),
        `${path}.events.${event.frame}`,
      );
      break;
  }
}

function appendReplaySnapshot(
  engine: FerrumEngine,
  world: PhysicsWorldApplyResult,
  frame: number,
  snapshots: PhysicsReplayFrameSnapshot[],
): void {
  const snapshot = capturePhysicsWorldSnapshot(engine, world, { frame });
  snapshots.push({
    frame,
    snapshot,
    replayHash: snapshot.replayHash,
  });
}

function replayInputEventsFromOptions(
  events: readonly PhysicsReplayInputEvent[] | undefined,
): readonly PhysicsReplayInputEvent[] {
  if (events === undefined) {
    return [];
  }
  if (Array.isArray(events)) {
    return events;
  }
  throw physicsSpecDiagnosticError("physics replay events", "must be an array");
}
