import assert from "node:assert/strict";
const row=(name,z,length,origin,receiver,base,density,falloff,start,end)=>({name,values:[z,length,origin,receiver,1,base,density,falloff,start,end,0,0].map(Math.fround)});
export const HEIGHT_FOG_PRECISION_CASES=[
 row("thin-far-interval",524367.6875,524367.6875,0,0,0,10,0,500000,500000.03125),
 row("translated-positive",1,1,999999.875,1000000,999999.9375,1,10,.25,.75),
 row("translated-negative",1,1,-1000000,-999999.875,-999999.9375,1,10,.25,.75),
 row("translated-origin",1,1,-.0625,.0625,0,1,10,.25,.75),
 row("thin-below-base",1e6,1e6,-.025,1e6,0,1,10,0,1e6),
 row("far-clipped-rise",1e6,2e6,-1e6,1e6,0,10,10,500000,500000.03125),
 row("far-clipped-fall",1e6,2e6,1e6,-1e6,0,10,10,499999.96875,500000),
 row("far-clipped-diagonal-rise",1e6,2e6,-650000,650000,0,10,10,500000,500000.03125),
 row("far-clipped-diagonal-fall",1e6,2e6,650000,-650000,0,10,10,499999.96875,500000),
];
for(const origin of [-20,0,20])for(const receiver of [-20,0,20])for(const falloff of [0,1e-8,.02,10])
 HEIGHT_FOG_PRECISION_CASES.push(row(`ordinary-${origin}-${receiver}-${falloff}`,200,220,origin,receiver,0,.01,falloff,20,160));
for(const z of [524367.6875,650000,800000,999000])for(const density of [0,.1,1,10])
 HEIGHT_FOG_PRECISION_CASES.push(row(`far-${z}-${density}`,z,z*1.25,0,0,0,density,0,500000,500000.03125));
// Independent adaptive Simpson quadrature resolves a thin boundary layer without
// reproducing the production shader's closed-form exponential mean.
export function heightFogPrecisionReference(values){
 const [z,length,origin,receiver,,base,density,falloff,start,end]=values;
 if(density===0||z<=start)return 0;
 const a=start/z,b=Math.min(end/z,1),f=t=>density*length*Math.exp(-falloff*Math.max((origin-base)+(receiver-origin)*t,0));
 const integrate=(a,b,fa,fm,fb,whole,epsilon,depth)=>{
  const m=(a+b)/2,l=(a+m)/2,r=(m+b)/2,fl=f(l),fr=f(r),left=(m-a)*(fa+4*fl+fm)/6,right=(b-m)*(fm+4*fr+fb)/6,delta=left+right-whole;
  if(depth===0||Math.abs(delta)<=15*epsilon)return left+right+delta/15;
  return integrate(a,m,fa,fl,fm,left,epsilon/2,depth-1)+integrate(m,b,fm,fr,fb,right,epsilon/2,depth-1);
 };
 const fa=f(a),fm=f((a+b)/2),fb=f(b),tau=integrate(a,b,fa,fm,fb,(b-a)*(fa+4*fm+fb)/6,1e-10,48);
 return -Math.expm1(-tau);
}
export function auditHeightFogPrecision(result){
 const metrics={};
 for(const backend of ["webgl2","webgpu"]){
  assert.deepEqual(result[backend]?.map(r=>r.name),HEIGHT_FOG_PRECISION_CASES.map(c=>c.name),"Missing height fog precision cases");let maxError=0;
  for(let i=0;i<HEIGHT_FOG_PRECISION_CASES.length;i++){
   const expected=heightFogPrecisionReference(HEIGHT_FOG_PRECISION_CASES[i].values),actual=result[backend][i].amount,error=Math.abs(actual-expected);assert(Number.isFinite(actual)&&actual>=0&&actual<=1,"Invalid height fog amount");
   assert(error<=.00002,`Height fog precision ${backend}/${result[backend][i].name}: expected ${expected}, got ${actual}`);maxError=Math.max(maxError,error);
  }metrics[backend]={cases:result[backend].length,maxError};
 }
 return metrics;
}
