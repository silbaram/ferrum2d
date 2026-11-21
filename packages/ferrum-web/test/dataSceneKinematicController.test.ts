import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import type { Engine } from "../pkg/ferrum_core.js";
import { configureDataSceneKinematicController } from "../src/dataSceneKinematicController.js";
import { createPhysicsBodyApi, type PhysicsBodyApiContext } from "../src/physicsBodyApi.js";
import type { PhysicsKinematicControllerOptions } from "../src/engineTypes/physicsBodies.js";

const handle = { entityId: 12, entityGeneration: 34 };
function fixture(accepted = true) {
  const calls: unknown[][] = [];
  const native = {
    configure_data_scene_kinematic_controller(...args: unknown[]) { calls.push(args); return accepted; },
  } as unknown as Engine;
  return { native, calls };
}

test("automatic controller forwards replacement defaults and resets per-body overrides", () => {
  const { native, calls } = fixture();
  equal(configureDataSceneKinematicController(native, handle, {}), true);
  equal(configureDataSceneKinematicController(native, handle, false), true);
  deepEqual(calls, [
    [12, 34, false, 0xffffffff, 4, 0, 0, false],
    [12, 34, true, 0xffffffff, 4, 0, 0, false],
  ]);
});

test("automatic controller forwards bounded mask, sweep and f32 height values without changing input", () => {
  const { native, calls } = fixture();
  const options = Object.freeze({ solidMaskBits: 0, maxIterations: 8, maxStepHeight: 0.1,
    maxDropHeight: 65536, allowLedgeDrop: true });
  equal(configureDataSceneKinematicController(native, handle, options), true);
  deepEqual(calls[0], [12, 34, false, 0, 8, Math.fround(0.1), 65536, true]);
  equal(options.maxStepHeight, 0.1);
  configureDataSceneKinematicController(native, handle, { maxIterations: 1 });
  deepEqual(calls[1], [12, 34, false, 0xffffffff, 1, 0, 0, false]);
});

test("automatic controller rejects invalid option records and unknown fields before native mutation", () => {
  const { native, calls } = fixture();
  for (const options of [null, true, 0, "auto", [], undefined, { maxStepHeigth: 3 }, { enabled: false }]) {
    throws(() => configureDataSceneKinematicController(native, handle, options as never));
  }
  equal(calls.length, 0);
});

test("automatic controller rejects invalid masks and iteration bounds before native mutation", () => {
  const { native, calls } = fixture();
  for (const solidMaskBits of [-1, 0x100000000, 1.5, NaN, Infinity, null, "8"]) {
    throws(() => configureDataSceneKinematicController(native, handle, { solidMaskBits } as never));
  }
  for (const maxIterations of [0, 9, -1, 1.5, NaN, Infinity, null, "4"]) {
    throws(() => configureDataSceneKinematicController(native, handle, { maxIterations } as never));
  }
  equal(calls.length, 0);
});

test("automatic controller rejects invalid heights and ledge flags before native mutation", () => {
  const { native, calls } = fixture();
  for (const name of ["maxStepHeight", "maxDropHeight"] as const) {
    for (const value of [-1, 65536.001, Number.MAX_VALUE, NaN, Infinity, -Infinity, null, "1"]) {
      throws(() => configureDataSceneKinematicController(native, handle, { [name]: value } as never));
    }
  }
  for (const allowLedgeDrop of [null, 0, 1, "true"]) {
    throws(() => configureDataSceneKinematicController(native, handle, { allowLedgeDrop } as never));
  }
  equal(calls.length, 0);
});

test("automatic controller validates handle generations and does not read inherited options", () => {
  const { native, calls } = fixture();
  for (const invalid of [{ entityId: -1, entityGeneration: 0 }, { entityId: 1, entityGeneration: 0x100000000 },
    { entityId: 1.5, entityGeneration: 1 }, { entityId: 1, entityGeneration: NaN }]) {
    throws(() => configureDataSceneKinematicController(native, invalid, false));
  }
  equal(calls.length, 0);
  const inherited = Object.create({ maxStepHeight: 12, allowLedgeDrop: true }) as PhysicsKinematicControllerOptions;
  configureDataSceneKinematicController(native, handle, inherited);
  deepEqual(calls[0], [12, 34, false, 0xffffffff, 4, 0, 0, false]);
});

test("automatic controller propagates native rejection and refuses missing Wasm support", () => {
  const { native, calls } = fixture(false);
  equal(configureDataSceneKinematicController(native, handle, {}), false);
  equal(calls.length, 1);
  throws(() => configureDataSceneKinematicController({} as Engine, handle, {}), /does not support/);
  throws(() => configureDataSceneKinematicController({} as Engine, handle, false), /does not support/);
});

test("physics body facade checks lifecycle before configuring controller settings", () => {
  const { native, calls } = fixture();
  let alive = true, aliveChecks = 0;
  const api = createPhysicsBodyApi({
    rustEngine: native, bridge: {} as PhysicsBodyApiContext["bridge"],
    requireAlive() { aliveChecks++; if (!alive) throw new Error("Engine has been destroyed"); },
  });
  equal(api.configureDataSceneKinematicController(handle, { maxDropHeight: 4 }), true);
  equal(aliveChecks, 1); equal(calls.length, 1);
  alive = false;
  throws(() => api.configureDataSceneKinematicController(handle, false), /destroyed/);
  equal(aliveChecks, 2); equal(calls.length, 1);
});
