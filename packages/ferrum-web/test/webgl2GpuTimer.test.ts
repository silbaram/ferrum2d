import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { WebGL2GpuTimer } from "../src/webgl2GpuTimer.js";

class FakeGl {
  readonly QUERY_RESULT_AVAILABLE = 1;
  readonly QUERY_RESULT = 2;
  readonly CURRENT_QUERY = 3;
  readonly ext = { TIME_ELAPSED_EXT: 4, GPU_DISJOINT_EXT: 5 };
  readonly queries: Array<{ available: boolean; nanos: number }> = [];
  readonly deleted = new Set<unknown>();
  supported = true;
  lost = false;
  disjoint = false;
  active: unknown = null;
  resultReads = 0;
  endCount = 0;
  getExtension() { return this.supported ? this.ext : null; }
  isContextLost() { return this.lost; }
  getParameter() { return this.disjoint; }
  getQuery() { return this.active; }
  createQuery() {
    const query = { available: false, nanos: 2_500_000 };
    this.queries.push(query);
    return query;
  }
  deleteQuery(query: unknown) { this.deleted.add(query); }
  beginQuery(_target: number, query: { available: boolean }) {
    equal(this.active, null, "timer must never nest an active query");
    query.available = false;
    this.active = query;
  }
  endQuery() { this.active = null; this.endCount += 1; }
  getQueryParameter(query: { available: boolean; nanos: number }, field: number) {
    if (field === this.QUERY_RESULT_AVAILABLE) return query.available;
    ok(query.available, "unavailable result must never be read");
    this.resultReads += 1;
    return query.nanos;
  }
  timer() {
    // Test double implements exactly the GL timer operations used by the helper.
    return new WebGL2GpuTimer(this as unknown as WebGL2RenderingContext);
  }
}

test("GPU timing is asynchronous, converts nanoseconds, reuses queries, and clears stale results", () => {
  const gl = new FakeGl();
  const timer = gl.timer();
  timer.beginFrame(); timer.endFrame();
  equal(timer.stats().status, "pending");
  equal(timer.stats().elapsedMs, undefined);
  equal(gl.resultReads, 0);
  gl.queries[0].available = true;
  timer.beginFrame(); timer.endFrame();
  deepEqual(timer.stats(), { status: "ready", currentFrameId: 2, frameId: 1, elapsedMs: 2.5, pendingQueryCount: 1 });
  equal(gl.queries.length, 1);
  timer.beginFrame(); timer.endFrame();
  equal(timer.stats().elapsedMs, undefined);
  equal(timer.stats().frameId, undefined);
  timer.destroy(); timer.destroy();
  equal(gl.deleted.size, gl.queries.length);
});

test("slow GPU keeps at most four queries without blocking or fabricated times", () => {
  const gl = new FakeGl();
  const timer = gl.timer();
  for (let i = 0; i < 20; i++) { timer.beginFrame(); timer.endFrame(); }
  equal(gl.queries.length, 4);
  equal(timer.stats().pendingQueryCount, 4);
  equal(gl.resultReads, 0);
  equal(timer.stats().elapsedMs, undefined);
  timer.destroy();
  equal(gl.deleted.size, 4);
});

test("unsupported extension and external timer do not issue queries", () => {
  const gl = new FakeGl(); gl.supported = false;
  const timer = gl.timer();
  timer.beginFrame(); timer.endFrame();
  deepEqual(timer.stats(), { status: "unsupported", currentFrameId: 1, pendingQueryCount: 0 });
  equal(gl.queries.length, 0);
  const externalGl = new FakeGl(); externalGl.active = {};
  const externalTimer = externalGl.timer();
  externalTimer.beginFrame(); externalTimer.endFrame();
  equal(externalGl.queries.length, 0);
  equal(externalGl.endCount, 0);
});

test("disjoint invalidates pending and newly completed results", () => {
  const gl = new FakeGl();
  const timer = gl.timer();
  timer.beginFrame(); timer.endFrame();
  gl.queries[0].available = true;
  timer.beginFrame();
  equal(timer.stats().status, "ready");
  gl.disjoint = true;
  timer.endFrame();
  deepEqual(timer.stats(), { status: "disjoint", currentFrameId: 2, pendingQueryCount: 0 });
  equal(gl.deleted.size, 1);
  equal(timer.stats().elapsedMs, undefined);
  gl.disjoint = false;
  timer.beginFrame(); timer.endFrame();
  equal(timer.stats().status, "pending");
});

test("context loss during a query discards handles and recovery creates fresh queries", () => {
  const gl = new FakeGl();
  const timer = gl.timer();
  timer.beginFrame();
  gl.lost = true; gl.active = null;
  timer.endFrame();
  deepEqual(timer.stats(), { status: "context-lost", currentFrameId: 1, pendingQueryCount: 0 });
  equal(gl.endCount, 0);
  timer.beginFrame();
  gl.lost = false;
  timer.beginFrame(); timer.endFrame();
  equal(gl.queries.length, 2);
  equal(timer.stats().status, "pending");
  timer.destroy();
  equal(gl.deleted.size, 1);
});

test("destroy ends and deletes the active owned query", () => {
  const gl = new FakeGl(); const timer = gl.timer();
  timer.beginFrame(); timer.destroy(); timer.endFrame(); timer.beginFrame();
  equal(gl.endCount, 1);
  equal(gl.deleted.size, 1);
  equal(timer.stats().status, "disabled");
});

test("nonfinite or negative driver results never become GPU time samples", () => {
  for (const nanos of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const gl = new FakeGl(); const timer = gl.timer();
    timer.beginFrame(); timer.endFrame();
    gl.queries[0].nanos = nanos; gl.queries[0].available = true;
    timer.beginFrame(); timer.endFrame();
    equal(timer.stats().status, "pending");
    equal(timer.stats().elapsedMs, undefined);
    timer.destroy();
  }
});

test("failed-frame discard closes its GL query without publishing partial time", () => {
  const gl = new FakeGl(), timer = gl.timer();
  timer.beginFrame(); timer.endFrame(true);
  equal(gl.active, null); equal(timer.stats().pendingQueryCount, 0);
  gl.queries[0].available = true;
  timer.beginFrame(); equal(timer.stats().elapsedMs, undefined); timer.endFrame();
  equal(gl.queries.length, 1); equal(timer.stats().pendingQueryCount, 1); timer.destroy();
});
