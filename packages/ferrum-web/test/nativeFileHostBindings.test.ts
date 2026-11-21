import { deepEqual, equal, throws as throwsMatch } from "node:assert/strict";
import { test } from "node:test";
import {
  NativeFileHostBindingError,
  captureNativeFileHostBinding,
  captureNativeFileHostBindingFence,
  consumePreparedNativeFileHostBindings,
  defineNativeFileHostBindingType,
  discardPreparedNativeFileHostBindings,
  forgetNativeFileHostBindings,
  nativeFileHostBindingFenceUnchanged,
  prepareNativeFileHostBindings,
  registerNativeFileHostBinding,
  resolveNativeFileHostBinding,
  resolvePreparedNativeFileHostBinding,
  unregisterNativeFileHostBinding,
} from "../src/nativeFileHostBindings.js";
import type { NativeFileHostBindingReference } from "../src/nativeFileHostBindings.js";
import { readNativeFileJson } from "../src/nativeFileJson.js";

class Budget {
  workUsed = 0;
  unitsUsed = 0;
  constructor(private readonly maxWork = 100_000, private readonly maxUnits = 100_000) {}
  work(n: number): void {
    if (n > this.maxWork - this.workUsed) throw new Error("work quota");
    this.workUsed += n;
  }
  metadata(s: string): void {
    if (s.length > this.maxUnits - this.unitsUsed) throw new Error("metadata quota");
    this.unitsUsed += s.length;
  }
}
interface Adapter { texture: object; capture(): Uint8Array; dispose(): void }
let guardCalls = 0;
const texture = defineNativeFileHostBindingType<Adapter>("test.external-texture", 1, (value, identity): value is Adapter => {
  guardCalls++;
  return value !== null && typeof value === "object" && "texture" in value && value.texture === identity
    && "capture" in value && typeof value.capture === "function" && "dispose" in value && typeof value.dispose === "function";
});
const textureV2 = defineNativeFileHostBindingType<Adapter>("test.external-texture", 2, (value, identity): value is Adapter =>
  value !== null && typeof value === "object" && "texture" in value && value.texture === identity
  && "capture" in value && typeof value.capture === "function" && "dispose" in value && typeof value.dispose === "function");
function fixture() {
  const identity = {}, calls = { capture: 0, dispose: 0 };
  const adapter: Adapter = {
    texture: identity,
    capture() { calls.capture++; return new Uint8Array([1, 2, 3, 4]); },
    dispose() { calls.dispose++; },
  };
  return { identity, adapter, calls };
}
function code(expected: string) {
  return (error: unknown) => error instanceof NativeFileHostBindingError && error.code === expected;
}
// The repository intentionally declares only the RegExp overload of Node's
// assert.throws. Check typed errors locally without widening its shared shim.
function throws(operation: () => unknown, matcher: RegExp | ((error: unknown) => boolean)): void {
  if (matcher instanceof RegExp) { throwsMatch(operation, matcher); return; }
  let thrown = false, caught: unknown;
  try { operation(); } catch (error) { thrown = true; caught = error; }
  equal(thrown, true);
  equal(matcher(caught), true);
}

test("host file references resolve the same symbol to a new host's actual adapter without executing code", () => {
  const source = {}, target = {}, a = fixture(), b = fixture();
  registerNativeFileHostBinding(source, texture, "scene.외부🙂", a.adapter, a.identity);
  registerNativeFileHostBinding(target, texture, "scene.외부🙂", b.adapter, b.identity);
  const ref = captureNativeFileHostBinding(source, texture, a.identity);
  deepEqual(ref, { kind: texture.kind, version: 1, symbol: "scene.외부🙂" });
  const packet = new TextEncoder().encode(JSON.stringify(ref));
  // Only the bounded owned JSON projection crosses the file boundary. The
  // expected trusted type comes from SDK code, never from this parsed object.
  const parsed = readNativeFileJson(packet).value as NativeFileHostBindingReference;
  const before = guardCalls;
  const plan = prepareNativeFileHostBindings(target, [{ type: texture, reference: parsed }], new Budget());
  equal(resolveNativeFileHostBinding(target, texture, parsed), b.adapter);
  equal(resolvePreparedNativeFileHostBinding(target, plan, texture, ref.symbol), b.adapter);
  equal(resolveNativeFileHostBinding(target, texture, parsed) === a.adapter, false);
  consumePreparedNativeFileHostBindings(target, plan);
  equal(guardCalls, before);
  deepEqual(a.calls, { capture: 0, dispose: 0 });
  deepEqual(b.calls, { capture: 0, dispose: 0 });
  throws(() => resolvePreparedNativeFileHostBinding(target, plan, texture, ref.symbol), code("TOKEN"));
  forgetNativeFileHostBindings(source); forgetNativeFileHostBindings(target);
});

test("host capture requires registered actual identity and preserves explicit aliases", () => {
  const owner = {}, other = {}, a = fixture();
  registerNativeFileHostBinding(owner, texture, "a", a.adapter, a.identity);
  registerNativeFileHostBinding(owner, texture, "b", a.adapter, a.identity);
  throws(() => captureNativeFileHostBinding(owner, texture, {}), code("MISSING"));
  throws(() => captureNativeFileHostBinding(other, texture, a.identity), code("MISSING"));
  throws(() => captureNativeFileHostBinding(owner, texture, a.identity), code("AMBIGUOUS"));
  const refs = ["b", "a"].map(symbol => captureNativeFileHostBinding(owner, texture, a.identity, symbol));
  const plan = prepareNativeFileHostBindings(owner, refs.map(reference => ({ type: texture, reference })), new Budget());
  equal(resolvePreparedNativeFileHostBinding(owner, plan, texture, "a"), a.adapter);
  equal(resolvePreparedNativeFileHostBinding(owner, plan, texture, "b"), a.adapter);
  discardPreparedNativeFileHostBindings(owner, plan);
  equal(unregisterNativeFileHostBinding(owner, texture, "a"), true);
  equal(captureNativeFileHostBinding(owner, texture, a.identity).symbol, "b");
  equal(unregisterNativeFileHostBinding(owner, texture, "a"), false);
  forgetNativeFileHostBindings(owner);
});

test("file cannot forge a trusted type, version, getter or executable host binding", () => {
  const owner = {}, a = fixture();
  registerNativeFileHostBinding(owner, texture, "gpu", a.adapter, a.identity);
  const ref = captureNativeFileHostBinding(owner, texture, a.identity);
  throws(() => resolveNativeFileHostBinding(owner, { kind: texture.kind, version: 1 }, ref), code("TYPE"));
  throws(() => resolveNativeFileHostBinding(owner, textureV2, ref), code("REFERENCE"));
  let accessed = 0;
  const getter = { kind: texture.kind, version: 1, get symbol() { accessed++; return "gpu"; } };
  throws(() => resolveNativeFileHostBinding(owner, texture, getter), code("REFERENCE"));
  equal(accessed, 0);
  const injected = { ...ref, code: "() => globalThis.live.destroy()" };
  throws(() => resolveNativeFileHostBinding(owner, texture, injected), code("REFERENCE"));
  throws(() => resolveNativeFileHostBinding(owner, texture, { ...ref, symbol: "missing" }), code("MISSING"));
  deepEqual(a.calls, { capture: 0, dispose: 0 });
  forgetNativeFileHostBindings(owner);
});

test("duplicate registration never replaces a live binding or invalidates an existing preparation", () => {
  const owner = {}, a = fixture(), b = fixture();
  registerNativeFileHostBinding(owner, texture, "gpu", a.adapter, a.identity);
  const ref = captureNativeFileHostBinding(owner, texture, a.identity);
  const fence = captureNativeFileHostBindingFence(owner);
  const plan = prepareNativeFileHostBindings(owner, [{ type: texture, reference: ref }], new Budget());
  const before = guardCalls;
  throws(() => registerNativeFileHostBinding(owner, texture, "gpu", b.adapter, b.identity), code("DUPLICATE"));
  equal(guardCalls, before);
  equal(nativeFileHostBindingFenceUnchanged(owner, fence), true);
  equal(resolvePreparedNativeFileHostBinding(owner, plan, texture, "gpu"), a.adapter);
  discardPreparedNativeFileHostBindings(owner, plan);
  forgetNativeFileHostBindings(owner);
});

test("registry edits, forget and re-registration invalidate old target-bound plans", () => {
  const owner = {}, foreign = {}, a = fixture(), b = fixture();
  registerNativeFileHostBinding(owner, texture, "gpu", a.adapter, a.identity);
  const ref = captureNativeFileHostBinding(owner, texture, a.identity);
  const plan = prepareNativeFileHostBindings(owner, [{ type: texture, reference: ref }], new Budget());
  throws(() => consumePreparedNativeFileHostBindings(foreign, plan), code("OWNER"));
  throws(() => discardPreparedNativeFileHostBindings(foreign, plan), code("OWNER"));
  const fence = captureNativeFileHostBindingFence(owner);
  equal(unregisterNativeFileHostBinding(owner, texture, "gpu"), true);
  registerNativeFileHostBinding(owner, texture, "gpu", b.adapter, b.identity);
  equal(nativeFileHostBindingFenceUnchanged(owner, fence), false);
  throws(() => resolvePreparedNativeFileHostBinding(owner, plan, texture, "gpu"), code("STALE"));
  throws(() => consumePreparedNativeFileHostBindings(owner, plan), code("STALE"));
  equal(resolveNativeFileHostBinding(owner, texture, ref), b.adapter);
  discardPreparedNativeFileHostBindings(owner, plan);
  const next = prepareNativeFileHostBindings(owner, [{ type: texture, reference: ref }], new Budget());
  forgetNativeFileHostBindings(owner);
  registerNativeFileHostBinding(owner, texture, "gpu", b.adapter, b.identity);
  throws(() => consumePreparedNativeFileHostBindings(owner, next), code("STALE"));
  discardPreparedNativeFileHostBindings(owner, next);
  deepEqual(a.calls, { capture: 0, dispose: 0 });
  deepEqual(b.calls, { capture: 0, dispose: 0 });
  forgetNativeFileHostBindings(owner);
});

test("host batch uses shared exact and one-below work/metadata quotas without lookup callbacks", () => {
  const owner = {}, a = fixture();
  registerNativeFileHostBinding(owner, texture, "gpu", a.adapter, a.identity);
  const ref = captureNativeFileHostBinding(owner, texture, a.identity);
  const requests = [{ type: texture, reference: ref }];
  const work = 5, units = texture.kind.length + ref.symbol.length;
  const exact = new Budget(work, units), plan = prepareNativeFileHostBindings(owner, requests, exact);
  equal(exact.workUsed, work); equal(exact.unitsUsed, units);
  const before = guardCalls;
  throws(() => prepareNativeFileHostBindings(owner, requests, new Budget(work - 1, units)), /work quota/);
  throws(() => prepareNativeFileHostBindings(owner, requests, new Budget(work, units - 1)), /metadata quota/);
  throws(() => prepareNativeFileHostBindings(owner, requests, exact), /work quota/);
  const accumulated = new Budget(work, units); accumulated.work(1);
  throws(() => prepareNativeFileHostBindings(owner, requests, accumulated), /work quota/);
  throws(() => prepareNativeFileHostBindings(owner, Array.from({ length: 4097 }, () => requests[0]), new Budget()), code("LIMIT"));
  equal(guardCalls, before);
  equal(resolvePreparedNativeFileHostBinding(owner, plan, texture, "gpu"), a.adapter);
  discardPreparedNativeFileHostBindings(owner, plan);
  forgetNativeFileHostBindings(owner);
});

test("empty preparation and rejected requests preserve an absent registry fence", () => {
  const owner = {}, fence = captureNativeFileHostBindingFence(owner);
  const ref = { kind: texture.kind, version: 1, symbol: "gpu" };
  throws(() => prepareNativeFileHostBindings(owner, [{ type: texture, reference: ref }], new Budget()), code("MISSING"));
  equal(nativeFileHostBindingFenceUnchanged(owner, fence), true);
  const token = prepareNativeFileHostBindings(owner, [], new Budget());
  consumePreparedNativeFileHostBindings(owner, token);
  equal(nativeFileHostBindingFenceUnchanged(owner, fence), true);
  discardPreparedNativeFileHostBindings(owner, token);
});

test("host guard validates the actual external identity once and reentrant registration cannot overwrite it", () => {
  const owner = {}, a = fixture();
  const fence = captureNativeFileHostBindingFence(owner);
  throws(() => registerNativeFileHostBinding(owner, texture, "wrong", a.adapter, {}), code("VALUE"));
  equal(nativeFileHostBindingFenceUnchanged(owner, fence), true);
  const reentrant = defineNativeFileHostBindingType<Adapter>("test.reentrant-host", 1, (value): value is Adapter => {
    registerNativeFileHostBinding(owner, texture, "inner", a.adapter, a.identity);
    return value === a.adapter;
  });
  throws(() => registerNativeFileHostBinding(owner, reentrant, "outer", a.adapter, a.identity), code("STALE"));
  equal(captureNativeFileHostBinding(owner, texture, a.identity).symbol, "inner");
  throws(() => captureNativeFileHostBinding(owner, reentrant, a.identity), code("MISSING"));
  forgetNativeFileHostBindings(owner);
});

test("absent and empty registry fences cannot become valid again after register and forget", () => {
  const owner = {}, a = fixture();
  const absent = captureNativeFileHostBindingFence(owner);
  const first = prepareNativeFileHostBindings(owner, [], new Budget());
  registerNativeFileHostBinding(owner, texture, "a", a.adapter, a.identity);
  forgetNativeFileHostBindings(owner);
  equal(nativeFileHostBindingFenceUnchanged(owner, absent), false);
  throws(() => consumePreparedNativeFileHostBindings(owner, first), code("STALE"));
  discardPreparedNativeFileHostBindings(owner, first);
  const empty = captureNativeFileHostBindingFence(owner);
  const second = prepareNativeFileHostBindings(owner, [], new Budget());
  registerNativeFileHostBinding(owner, texture, "a", a.adapter, a.identity);
  forgetNativeFileHostBindings(owner);
  equal(nativeFileHostBindingFenceUnchanged(owner, empty), false);
  throws(() => consumePreparedNativeFileHostBindings(owner, second), code("STALE"));
  discardPreparedNativeFileHostBindings(owner, second);
  registerNativeFileHostBinding(owner, texture, "b", a.adapter, a.identity);
  equal(captureNativeFileHostBinding(owner, texture, a.identity).symbol, "b");
  deepEqual(a.calls, { capture: 0, dispose: 0 });
  forgetNativeFileHostBindings(owner);
});
