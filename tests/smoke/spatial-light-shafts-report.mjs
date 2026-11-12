import assert from "node:assert/strict";
import {decodePng} from "../../scripts/tools/pack-textures.mjs";
import {SHAFT_TERRAIN,SHAFT_CASES,SHAFT_STATES} from "./spatial-light-shafts-cases.mjs";
export {SHAFT_STATES};
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),add=(a,b,s=1)=>a.map((v,i)=>v+s*b[i]),normalize=v=>v.map(x=>x/Math.hypot(...v));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const boxes=SHAFT_TERRAIN.map(t=>({lo:[t.x,t.baseElevation,-t.y-t.depth],hi:[t.x+t.width,t.elevation,-t.y]}));
const decode=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4,encode=x=>255*(x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055);
function intersect(origin,ray,box){let a=-Infinity,b=Infinity;for(let i=0;i<3;i++){if(Math.abs(ray[i])<1e-12){if(origin[i]<box.lo[i]||origin[i]>box.hi[i])return;continue;}const x=(box.lo[i]-origin[i])/ray[i],y=(box.hi[i]-origin[i])/ray[i];a=Math.max(a,Math.min(x,y));b=Math.min(b,Math.max(x,y));}return b>=Math.max(a,0)?Math.max(a,0):undefined;}
function cameraRay(c,u,v){const eye=c.slice(17,20),f=normalize(add(c.slice(20,23),eye,-1)),r=normalize(cross(f,[0,1,0])),up=cross(r,f),h=c[16]?Math.tan(c[23]/2):c[23]/2,offset=add(r.map(n=>n*(2*u-1)*h*c[26]/c[27]),up,(1-2*v)*h);return{origin:c[16]?eye:add(eye,offset),ray:c[16]?normalize(add(f,offset)):f,f};}
export function shaftReference(row,x,y){
 const e=row.environment,c=row.camera,p=row.presentation??[0,0,1,1,0,0],left=Math.round(row.width*p[0]),top=Math.round(row.height*p[1]),dw=Math.round(row.width*p[2]),dh=Math.round(row.height*p[3]);
 if(x<left||y<top||x>=left+dw||y>=top+dh)return;
 const w=e[0]&16?e[80]:dw,h=e[0]&16?e[81]:dh,scale=e[624],lw=Math.ceil(w/scale),lh=Math.ceil(h/scale),u=(Math.floor((x-left+.5)*w/dw)+.5)/w,v=(Math.floor((y-top+.5)*h/dh)+.5)/h;
 const px=u*lw-.5,py=v*lh-.5,ax=Math.floor(px),ay=Math.floor(py),wx=px-ax,wy=py-ay;
 const sample=(ix,iy)=>{
  const uv=[(Math.max(0,Math.min(lw-1,ix))+.5)/lw,(Math.max(0,Math.min(lh-1,iy))+.5)/lh];
  const depthRay=cameraRay(c,(Math.floor(uv[0]*w)+.5)/w,(Math.floor(uv[1]*h)+.5)/h),hits=boxes.map(b=>intersect(depthRay.origin,depthRay.ray,b)).filter(d=>d!==undefined);
  const z=hits.length?Math.min(...hits)*dot(depthRay.ray,depthRay.f):c[25],{origin,ray,f}=cameraRay(c,...uv),start=c[24]/dot(ray,f),stop=Math.min(z/dot(ray,f),e[619]);
  if(stop<=start)return{amount:0,safe:true};
  let amount=0,safe=true;const step=(stop-start)/e[625],sun=normalize(e.slice(84,87)),m=row.sunMatrix;
  for(let i=0;i<e[625];i++){
   const a=start+i*step,b=a+step,point=add(origin,ray,(a+b)/2),q=[0,1,2].map(k=>(m[k]*point[0]+m[k+4]*point[1]+m[k+8]*point[2]+m[k+12])*.5+.5);
   if(q.some(x=>x<=0||x>=1))continue;
   const edge=Math.min(Math.min(q[0],1-q[0],q[1],1-q[1])*2*e[94],Math.min(q[2],1-q[2])*2*e[91]),t=Math.max(0,Math.min(1,edge/(8*e[94]/e[92]))),fade=t*t*(3-2*t);
   let blocked=false;
   for(const box of boxes){
    const d=intersect(point,sun,box);if(d!==undefined&&d>1e-4)blocked=true;
    // Reject numerical reference samples at rasterized caster edges.
    if(point[1]<box.hi[1]){const hit=add(point,sun,(box.hi[1]-point[1])/sun[1]),margin=Math.min(Math.abs(hit[0]-box.lo[0]),Math.abs(hit[0]-box.hi[0]),Math.abs(hit[2]-box.lo[2]),Math.abs(hit[2]-box.hi[2]));if(margin<2*e[94]/e[92])safe=false;}
   }
   if(!blocked)amount+=(Math.exp(-e[618]*a)-Math.exp(-e[618]*b))*fade;
  }
  const g=e[623],phase=((1-g)**2/(1+g*g-2*g*dot(ray,sun)))**1.5;return{amount:amount*phase,safe};
 };
 const values=[sample(ax,ay),sample(ax+1,ay),sample(ax,ay+1),sample(ax+1,ay+1)];
 if(values.some(v=>!v.safe))return;
 const amount=values[0].amount*(1-wx)*(1-wy)+values[1].amount*wx*(1-wy)+values[2].amount*(1-wx)*wy+values[3].amount*wx*wy;
 const result=e.slice(88,91).map((color,i)=>amount*color*e[87]*e[617]*e[620+i]);
 const fullRay=cameraRay(c,u,v);result.background=!boxes.some(box=>{const hit=intersect(fullRay.origin,fullRay.ray,box);return hit!==undefined&&hit*dot(fullRay.ray,fullRay.f)<c[25];});
 if(result.background)result.fill(0);
 return result;
}
export async function auditLightShaftPixels(rows,readImage){
 const names=rows.map(r=>r.name);assert.deepEqual(names,[...SHAFT_STATES,...(names.includes("recovered")?["recovered"]:[])],"Missing/duplicate light shafts states");
 const byName=new Map(rows.map(r=>[r.name,r])),images=new Map();
 for(const row of rows){const image=decodePng(await readImage(row.image));assert.equal(image.width,row.width);assert.equal(image.height,row.height);images.set(row.name,image);
  assert(row.warm.terrainTriangleCount>0);assert.equal(row.warm.shadowPassCount,0);assert.equal(row.warm.shadowUploadBytes,0);assert(row.camera.every(Number.isFinite));
  for(const key of ["lightShaftDrawCalls","lightShaftTextureBytes","lightShaftTexelFetchBudget","lightShaftSampleBudget"])assert(Number.isInteger(row.warm[key])&&row.warm[key]>=0,`Missing light shafts metric ${key}`);
 }
 const equal=(a,b)=>{const x=images.get(a).pixels,y=images.get(b).pixels;assert.equal(x.length,y.length);assert(x.every((v,i)=>Math.abs(v-y[i])<=1),`Light shafts identity ${a}/${b}`);};
 for(const name of ["zero","density-zero","off"])equal("plain",name);equal("lighting-off-plain","lighting-off");
 for(const name of ["saved","fresh-restore","re-enabled",...(names.includes("recovered")?["recovered"]:[])])equal("balanced",name);
 const metrics={};
 for(const c of SHAFT_CASES){const row=byName.get(c.name),v=row.environment,active=v[616]===1&&v[617]>0&&v[618]>0&&(v[0]&1)&&v[87]>0;
  if(c.environment.lightShafts)assert.equal(row.environmentVersion,14);
  if(!active){for(const key of ["lightShaftDrawCalls","lightShaftTextureBytes","lightShaftTexelFetchBudget","lightShaftSampleBudget"])assert.equal(row.warm[key],0);continue;}
  const p=row.presentation??[0,0,1,1,0,0],w=v[0]&16?v[80]:Math.round(row.width*p[2]),h=v[0]&16?v[81]:Math.round(row.height*p[3]),lw=Math.ceil(w/v[624]),lh=Math.ceil(h/v[624]),resolve=!(v[132]===1&&v[133]>0);
  assert.equal(row.warm.lightShaftDrawCalls,1+Number(resolve));assert.equal(row.warm.lightShaftTextureBytes,(lw*lh+Number(resolve)*w*h)*8);assert.equal(row.warm.lightShaftTexelFetchBudget,lw*lh*(v[625]+1)+w*h*(4+2*Number(resolve)));assert.equal(row.warm.lightShaftSampleBudget,v[625]+1);
  const base=byName.get(c.baseline),image=images.get(c.name),plain=images.get(c.baseline);assert.equal(row.warm.effectDrawCalls-base.warm.effectDrawCalls,row.warm.lightShaftDrawCalls);
  assert.equal(row.warm.effectTextureBytes-base.warm.effectTextureBytes,row.warm.lightShaftTextureBytes);
  let samples=0,maxError=0,signal=0;
  for(let gy=3;gy<=17;gy++)for(let gx=3;gx<=17;gx++){
   const x=Math.floor(row.width*gx/20),y=Math.floor(row.height*gy/20),expected=shaftReference(row,x,y);if(!expected)continue;const at=(y*row.width+x)*4;
   for(let k=0;k<3;k++){const actual=image.pixels[at+k],reference=Math.min(255,encode(decode(plain.pixels[at+k]/255)+expected[k])),error=Math.abs(actual-reference);maxError=Math.max(maxError,error);signal=Math.max(signal,Math.abs(actual-plain.pixels[at+k]));assert(error<=3,`Light shafts integral ${c.name} (${x},${y}) channel${k}: ${actual} vs ${reference}, error${error}`);}samples++;
  }
  assert(samples>=20,`Insufficient independent light shafts samples ${c.name}: ${samples}`);if(!["forward","thin"].includes(c.name))assert(signal>8,`Missing light shafts response ${c.name}`);
  metrics[c.name]={samples,maxError,signal};
 }
 return{states:rows.length,metrics};
}
