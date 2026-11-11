import { test } from "node:test";
import assert from "node:assert/strict";
import { HEIGHT_FOG_PRECISION_CASES as cases, heightFogPrecisionReference as reference, auditHeightFogPrecision } from "./spatial-height-fog-precision-report.mjs";
const fixture=()=>Object.fromEntries(["webgl2","webgpu"].map(b=>[b,cases.map(c=>({name:c.name,amount:reference(c.values)}))]));
test("adaptive height fog quadrature preserves thin intervals and translation",()=>{
 assert(Math.abs(reference(cases[0].values)+Math.expm1(-.3125))<1e-8);
 for(const c of cases.slice(1,3))assert(Math.abs(reference(c.values)-reference(cases[3].values))<1e-10);
 assert(Math.abs(reference(cases[4].values)+Math.expm1(-.125))<1e-8);
 for(const c of cases.slice(5,7))assert(Math.abs(reference(c.values)+Math.expm1(-(1-Math.exp(-.625))))<1e-8);
 auditHeightFogPrecision(fixture());
});
test("height fog precision audit rejects cancellation, translation drift, missing or invalid output",()=>{
 for(const index of [0,1,2,4,5,6]){const r=fixture();r.webgpu[index].amount=0;assert.throws(()=>auditHeightFogPrecision(r),/precision/);}
 const missing=fixture();missing.webgl2.pop();assert.throws(()=>auditHeightFogPrecision(missing),/Missing/);
 for(const amount of [NaN,Infinity,-.1,1.1]){const r=fixture();r.webgl2[0].amount=amount;assert.throws(()=>auditHeightFogPrecision(r),/Invalid/);}
});
