import assert from "node:assert/strict";

// Depth is an exact float32 texture sample. The independent reference uses f64
// rational inversion and the closed integral for a completely visible sun map.
export const SHAFT_PRECISION_CASES = [];
for (const samples of [16, 32, 48]) {
  for (const [name, near, far, depth, density, maxDistance, projection] of [
    ["ordinary", .1, 800, .99, .01, 200, 1],
    ["distant", .001, 10000, 1 - 2 ** -24, .0001, 10000, 1],
    ["small-near", .000001, 1000, 1 - 2 ** -22, .1, 200, 1],
    ["far-plane", .001, 10000, 1, .0001, 10000, 1],
    ["clipped", .1, 10000, .999999, .01, 20, 1],
    ["thin", .1, 800, .99, .0000001, 200, 1],
    ["opaque", .1, 800, .99, 1, 200, 1],
    ["before-near", 10, 800, .99, .01, 1, 1],
    ["orthographic", .1, 800, .25, .01, 200, 0],
  ]) SHAFT_PRECISION_CASES.push({name:`${name}-${samples}`, near, far, depth, density, maxDistance, projection, samples, sunMagnitude:1, anisotropy:0});
  SHAFT_PRECISION_CASES.push({name:`sun-normalization-${samples}`, near:.1, far:800, depth:.99, density:.01, maxDistance:200, projection:1, samples, sunMagnitude:.25, anisotropy:.8});
}
export function shaftPrecisionReference(c) {
  const n=Math.fround(c.near), f=Math.fround(c.far), d=Math.fround(c.depth), density=Math.fround(c.density);
  const z=c.projection ? n/(1-d+d*n/f) : n+(f-n)*d;
  const stop=Math.min(z,Math.fround(c.maxDistance));
  return stop<=n ? 0 : Math.exp(-density*n)*(-Math.expm1(-density*(stop-n)));
}
export function auditShaftPrecision(result) {
  const summary={};
  for (const backend of ["webgl2","webgpu"]) {
    const rows=result[backend];assert.deepEqual(rows.map(r=>r.name),SHAFT_PRECISION_CASES.map(c=>c.name));
    let maxError=0;
    for(let i=0;i<rows.length;i++) {
      const expected=shaftPrecisionReference(SHAFT_PRECISION_CASES[i]),actual=rows[i].amount,error=Math.abs(actual-expected);
      // Relative tolerance keeps optically thin contributions observable too.
      const tolerance=Math.max(2e-8,Math.abs(expected)*2e-5);
      assert(Number.isFinite(actual)&&error<=tolerance,`Light shaft precision ${backend} ${rows[i].name}: ${actual} vs ${expected} (error ${error}, tolerance ${tolerance})`);
      maxError=Math.max(maxError,error);
    }
    summary[backend]={cases:rows.length,maxError};
  }
  return summary;
}
