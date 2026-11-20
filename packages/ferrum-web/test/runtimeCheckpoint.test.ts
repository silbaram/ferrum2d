import { deepEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeCheckpointApi } from "../src/runtimeCheckpoint.js";
import { resolvePhysicsSpec } from "../src/physicsSpec.js";

function setup() {
  let state = 3, revision = 0, captures = 0, restores = 0, frees = 0;
  let alive = true, running = false, accepted = true, version = 1;
  const host = { physicsSpec: resolvePhysicsSpec({ gravity: [0, 1] }), physicsSpecScene: undefined as number | undefined };
  const packets = new WeakMap<object, number>();
  const native = {
    runtime_checkpoint_version: () => version,
    runtime_checkpoint_revision: () => revision,
    capture_runtime_checkpoint() {
      captures++;
      const free = () => { frees++; };
      const packet = { free, [Symbol.dispose]: free };
      packets.set(packet, state);
      return packet;
    },
    restore_runtime_checkpoint(packet: object) {
      restores++;
      if (!accepted || !packets.has(packet)) return false;
      state = packets.get(packet)!; revision++; return true;
    },
  };
  const api = createRuntimeCheckpointApi(native, () => { if (!alive) throw new Error("destroyed"); }, () => running, host);
  return { api, native, host, counts: () => ({ state, revision, captures, restores, frees }),
    setState: (v: number) => { state = v; }, setAlive: (v: boolean) => { alive = v; },
    setRunning: (v: boolean) => { running = v; }, setAccepted: (v: boolean) => { accepted = v; },
    setVersion: (v: number) => { version = v; } };
}
test("runtime checkpoint rewinds Rust state and owned physics metadata, and disposes once", () => {
  const c = setup(); equal(c.api.supportsRuntimeCheckpoints(), true);
  const expected = structuredClone(c.host.physicsSpec);
  c.host.physicsSpecScene = 4;
  const p = c.api.captureRuntimeCheckpoint(); equal(p.capturedRevision, 0);
  c.setState(10); c.host.physicsSpec = resolvePhysicsSpec({ gravity: [0, 9] }); c.host.physicsSpecScene = 1;
  c.api.restoreRuntimeCheckpoint(p); deepEqual(c.host.physicsSpec, expected);
  equal(c.host.physicsSpecScene, 4);
  equal(c.counts().state, 3); equal(c.api.runtimeCheckpointRevision(), 1);
  c.setState(20); c.api.restoreRuntimeCheckpoint(p); equal(c.api.runtimeCheckpointRevision(), 2);
  throws(() => JSON.stringify(p), /cannot be serialized/);
  p.dispose(); p.dispose(); equal(c.counts().frees, 1);
  throws(() => c.api.restoreRuntimeCheckpoint(p), /disposed/); equal(c.counts().restores, 2);
});
test("runtime checkpoint rejects running, foreign, forged and old-core operations before mutation", () => {
  const a = setup(), b = setup(); const packet = a.api.captureRuntimeCheckpoint();
  throws(() => b.api.restoreRuntimeCheckpoint(packet), /different Engine/); equal(b.counts().restores, 0);
  throws(() => a.api.restoreRuntimeCheckpoint({ capturedRevision: 0, dispose() {} }), /different Engine/);
  a.setRunning(true); throws(() => a.api.captureRuntimeCheckpoint(), /Pause or stop/);
  throws(() => a.api.restoreRuntimeCheckpoint(packet), /Pause or stop/); equal(a.counts().captures, 1); equal(a.counts().restores, 0);
  a.setRunning(false); a.setVersion(2); equal(a.api.supportsRuntimeCheckpoints(), false);
  throws(() => a.api.restoreRuntimeCheckpoint(packet), /version 1/); equal(a.counts().restores, 0);
  const old = createRuntimeCheckpointApi({}, () => {}, () => false, a.host);
  equal(old.supportsRuntimeCheckpoints(), false); throws(() => old.captureRuntimeCheckpoint(), /version 1/);
  packet.dispose();
});
test("runtime checkpoint native rejection preserves host metadata and disposal survives Engine destruction", () => {
  const c = setup(); const p = c.api.captureRuntimeCheckpoint();
  c.setState(99); c.host.physicsSpec = resolvePhysicsSpec({ gravity: [0, 9] });
  const before = structuredClone(c.host.physicsSpec); c.setAccepted(false);
  throws(() => c.api.restoreRuntimeCheckpoint(p), /live state was preserved/);
  deepEqual(c.host.physicsSpec, before); equal(c.counts().state, 99); equal(c.counts().revision, 0);
  c.setAlive(false); throws(() => c.api.captureRuntimeCheckpoint(), /destroyed/);
  throws(() => c.api.restoreRuntimeCheckpoint(p), /destroyed/); p.dispose(); equal(c.counts().frees, 1);
});

test("runtime checkpoint synchronizes implicit scene metadata before capture", () => {
  const c = setup();
  const api = createRuntimeCheckpointApi(c.native, () => {}, () => false, c.host, () => {
    c.host.physicsSpecScene = 1;
    c.host.physicsSpec = resolvePhysicsSpec({ gravity: [0, 0] });
  });
  const packet = api.captureRuntimeCheckpoint();
  c.host.physicsSpecScene = 4; c.host.physicsSpec = resolvePhysicsSpec({ gravity: [0, 99] });
  api.restoreRuntimeCheckpoint(packet);
  equal(c.host.physicsSpecScene, 1); equal(c.host.physicsSpec.gravityY, 0);
  packet.dispose();
});
