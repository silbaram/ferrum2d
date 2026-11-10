import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { test } from "node:test";
import { createLightingSceneResolveCache, createResolvedLightingScene, normalizeLightingScene, resolveLightingSceneInto } from "../src/lightingNormalize.js";
import { resolveSceneLighting } from "../src/sceneLighting.js";
import { LightingShadowGeometryCache } from "../src/lightingShadowGeometryCache.js";
import { createPolygonShadowScratch, MAX_POLYGON_SHADOW_FLOATS, writePolygonShadowTrianglesInto } from "../src/lightingPolygonShadows.js";
import type { PolygonOccluder2D } from "../src/lightingTypes.js";

const triangle = (): PolygonOccluder2D => ({ vertices: [{ x: 30, y: -12 }, { x: 50, y: 0 }, { x: 30, y: 12 }] });
const input = () => ({ profile: "lit" as const, enabled: false, polygonOccluders: [triangle()] });
test("polygon source accepts both windings and JSON/OFF, owns vertices and warm cache rejects shape mutations", () => {
  const source = input(), normalized = resolveSceneLighting(source);
  deepEqual(normalized.polygonOccluders, source.polygonOccluders);
  deepEqual(resolveSceneLighting(JSON.parse(JSON.stringify(normalized))), normalized);
  source.polygonOccluders[0].vertices[0].x = 31;
  equal(normalized.polygonOccluders![0].vertices[0].x, 30);
  deepEqual(resolveSceneLighting({ ...source, polygonOccluders: [{ vertices: [...source.polygonOccluders[0].vertices].reverse() }] }).polygonOccluders![0].vertices,
    [...source.polygonOccluders[0].vertices].reverse());
  throws(() => normalizeLightingScene({ enabled: false, polygonOccluders: [] }), /lit profile/);
  const target = createResolvedLightingScene(), cache = createLightingSceneResolveCache();
  resolveLightingSceneInto(target, source, cache); const previous = target.polygonOccluders;
  resolveLightingSceneInto(target, structuredClone(source), cache); equal(target.polygonOccluders, previous);
  const malformed = structuredClone(source); Object.assign(malformed.polygonOccluders[0].vertices[0], { unsupported: 1 });
  throws(() => resolveLightingSceneInto(target, malformed, cache), /vertices/);
  deepEqual(previous![0].vertices, source.polygonOccluders[0].vertices);
  resolveLightingSceneInto(target, { profile: "lit" }, cache); equal(target.polygonOccluders, undefined);
});

test("polygon validation rejects sparse, concave, crossed, repeated, collinear and float32-degenerate vertices even OFF", () => {
  const p = (vertices: unknown) => ({ ...input(), polygonOccluders: [{ vertices }] });
  for (const invalid of [null, [], new Array(3), [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 2, y: 0 }],
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: .5 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
    [{ x: 1e8, y: 0 }, { x: 1e8 + 1, y: 0 }, { x: 1e8, y: 1 }],
    [{ x: Infinity, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 1e9 + 1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]])
    throws(() => resolveSceneLighting(p(invalid)), /polygon|vertices|convex/);
  for (const polygonOccluders of [new Array(1), Array(257).fill(triangle()), null])
    throws(() => resolveSceneLighting({ ...input(), polygonOccluders }), /polygon|vertices|convex/);
  throws(() => normalizeLightingScene({ ...input(), shadows: { projectionLength: 1e6 + 1 } }), /projectionLength/);
  throws(() => normalizeLightingScene({ ...input(), shadows: { enabled: false, projectionLength: 1e6 + 1 } }), /projectionLength/);
  throws(() => normalizeLightingScene({ ...input(), tileOccluders: Array(1025).fill({ x: 0, y: 0, width: 1, height: 1 }) }), /1024/);
  throws(() => normalizeLightingScene({ ...input(), pointLights: [{ x: 0, y: 0, radius: 1e-40, radiusY: 1e6 }] }), /aspect/);
});

function blocked(point: { x: number; y: number }, polygon: PolygonOccluder2D): boolean {
  const vertices = polygon.vertices;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length], dx = b.x - a.x, dy = b.y - a.y;
    const determinant = point.x * dy - point.y * dx;
    if (!determinant) continue;
    const t = (a.x * dy - a.y * dx) / determinant, u = (a.x * point.y - a.y * point.x) / determinant;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
  }
  return false;
}
function inTriangles(x: number, y: number, positions: Float32Array, count: number): boolean {
  for (let i = 0; i < count; i += 6) {
    const sides = [0, 2, 4].map(j => {
      const k = (j + 2) % 6;
      return (positions[i + k] - positions[i + j]) * (y - positions[i + j + 1]) - (positions[i + k + 1] - positions[i + j + 1]) * (x - positions[i + j]);
    });
    if (sides.every(v => v >= 0) || sides.every(v => v <= 0)) return true;
  }
  return false;
}
test("convex shadow geometry matches an independent ray/edge oracle inside projection range, both windings and ellipses", () => {
  for (const scale of [1, .5]) for (const reversed of [false, true]) {
    const polygon = triangle(); polygon.vertices = polygon.vertices.map(p => ({ x: p.x, y: p.y * scale }));
    if (reversed) polygon.vertices = [...polygon.vertices].reverse();
    const light = normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 150, radiusY: 150 * scale }] }).pointLights[0];
    const data = new Float32Array(MAX_POLYGON_SHADOW_FLOATS), scratch = createPolygonShadowScratch();
    const count = writePolygonShadowTrianglesInto(data, 0, polygon, light, 512, scratch, { x: -100, y: -100, width: 200, height: 200 });
    ok(count > 0 && count <= 72); ok([...data.subarray(0, count)].every(Number.isFinite));
    for (let y = -40.5; y < 40; y += 3) for (let x = -10.5; x < 100; x += 3)
      equal(inTriangles(x, y, data, count), blocked({ x, y }, polygon), `oracle (${x},${y}) ellipse${scale} reverse${reversed}`);
    equal(writePolygonShadowTrianglesInto(data, 0, polygon, { ...light, x: 35, y: 0 }, 512, scratch, { x: -100, y: -100, width: 200, height: 200 }), 0);
    throws(() => writePolygonShadowTrianglesInto(new Float32Array(1), 0, polygon, light, 512, scratch, { x: -100, y: -100, width: 200, height: 200 }), /budget/);
  }
});

test("polygon shadow cache reuses warm staging, detects in-place edits and drops culled/removed casters", () => {
  const cache = new LightingShadowGeometryCache(), polygons = [triangle()];
  const scene = normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 150 }], shadows: true });
  let version = cache.syncOccluders([], polygons);
  const clip = { x: -100, y: -100, width: 200, height: 200 };
  const first = cache.resolveLightGeometry(0, version, [], scene.pointLights[0], scene.shadows, clip, polygons), revision = first.revision, positions = first.positions;
  equal(first.casterCount, 1); ok(first.floatCount > 0);
  equal(cache.syncOccluders([], structuredClone(polygons)), version);
  equal(cache.resolveLightGeometry(0, version, [], scene.pointLights[0], scene.shadows, clip, polygons).revision, revision);
  polygons[0].vertices[0].x++;
  version = cache.syncOccluders([], polygons);
  const changed = cache.resolveLightGeometry(0, version, [], scene.pointLights[0], scene.shadows, clip, polygons);
  ok(changed.revision > revision); equal(changed.positions, positions);
  const away = polygons.map(p => ({ vertices: p.vertices.map(v => ({ x: v.x + 1000, y: v.y })) }));
  version = cache.syncOccluders([], away); equal(cache.resolveLightGeometry(0, version, [], scene.pointLights[0], scene.shadows, clip, away).casterCount, 0);
  version = cache.syncOccluders([]); equal(cache.resolveLightGeometry(0, version, [], scene.pointLights[0], scene.shadows, clip).floatCount, 0);
});

test("aligned tangent edges choose the farthest endpoint independently of winding and atan2 wrap", () => {
  for (const sign of [1, -1]) {
    const polygon = { vertices: [{ x: sign, y: 0 }, { x: 2 * sign, y: 0 }, { x: 2 * sign, y: 1 }, { x: sign, y: 1 }] };
    const light = normalizeLightingScene({ profile: "lit", pointLights: [{ x: 0, y: 0, radius: 10 }] }).pointLights[0];
    const a = new Float32Array(72), b = new Float32Array(72), clip = { x: -5, y: -1, width: 10, height: 5 };
    const count = writePolygonShadowTrianglesInto(a, 0, polygon, light, 1, createPolygonShadowScratch(), clip);
    const reverseCount = writePolygonShadowTrianglesInto(b, 0, { vertices: [...polygon.vertices].reverse().map(p => ({ ...p, y: p.y === 0 ? -0 : p.y })) }, light, 1, createPolygonShadowScratch(), clip);
    equal(count, reverseCount); deepEqual(Array.from(a, v => v === 0 ? 0 : v), Array.from(b, v => v === 0 ? 0 : v));
    equal(inTriangles(2.5 * sign, .1, a, count), true);
  }
});
