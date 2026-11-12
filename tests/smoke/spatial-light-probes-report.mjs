import assert from "node:assert/strict";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";
import { PROBE_CASES, PROBE_STATES, PROBE_TERRAIN } from "./spatial-light-probes-cases.mjs";
export { PROBE_STATES };
const normalize = v => v.map(x => x / Math.hypot(...v));
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const add = (a,b,s=1) => a.map((v,i) => v + s*b[i]);
const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
const encode = x => Math.min(255,255*(x<=.0031308 ? 12.92*x : 1.055*x**(1/2.4)-.055));
const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
const resourceFields = ["textureCount", "renderTargetCount", "bufferCount", "programCount", "bufferBytes"];
const boxes = PROBE_TERRAIN.map(t => ({lo:[t.x,t.baseElevation,-t.y-t.depth],hi:[t.x+t.width,t.elevation,-t.y]}));

// Independent double-precision CPU reference from authored world-space spheres.
export function probeReference(position, normal, environment) {
  const l = environment.lighting;
  if (l.enabled === false) return [1,1,1];
  let fill = [...l.ambient];
  if (l.hemisphere) {
    const h=l.hemisphere, d=h.direction??{x:0,y:0,elevation:1}, n=normalize([d.x,d.elevation,-d.y]);
    const a=Math.max(0,Math.min(1,(dot(normal,n)+1)/2));
    fill=fill.map((v,i)=>v+((h.groundColor[i]*(1-a)+h.skyColor[i]*a)*h.intensity));
  }
  const influences=(l.probes??[]).map(p=>{
    const d=Math.hypot(position[0]-p.position.x,position[1]-p.position.elevation,position[2]+p.position.y)/p.radius;
    const w=d>=1?0:1-3*d*d+2*d*d*d;
    return { w:Math.max(0,w), color:p.color.map(x=>x*p.intensity) };
  });
  const total=influences.reduce((sum,p)=>sum+p.w,0);
  if(total===0)return fill;
  const coverage=Math.max(...influences.map(p=>p.w));
  return fill.map((v,i)=>v*(1-coverage)+coverage*influences.reduce((sum,p)=>sum+p.w*p.color[i],0)/total);
}
export function probePixelReference(row, environment, x, y) {
  const c=row.camera, eye=c.slice(17,20), f=normalize(add(c.slice(20,23),eye,-1)), right=normalize(cross(f,[0,1,0])), up=cross(right,f);
  const h=c[16]?Math.tan(c[23]/2):c[23]/2;
  const offset=add(right.map(v=>v*(2*(x+.5)/row.width-1)*h*c[26]/c[27]),up,(1-2*(y+.5)/row.height)*h);
  const ray=c[16]?normalize(add(f,offset)):f, origin=c[16]?eye:add(eye,offset);
  let nearest=Infinity, hit;
  for(const box of boxes){
    let enter=-Infinity,exit=Infinity,axis=-1,sign=0;
    for(let k=0;k<3;k++){
      if(Math.abs(ray[k])<1e-12){if(origin[k]<box.lo[k]||origin[k]>box.hi[k]){exit=-Infinity;break;}continue;}
      const a=(box.lo[k]-origin[k])/ray[k], b=(box.hi[k]-origin[k])/ray[k];
      const t=Math.min(a,b);if(t>enter){enter=t;axis=k;sign=a<b?-1:1;}exit=Math.min(exit,Math.max(a,b));
    }
    if(exit<Math.max(enter,0)||enter>=nearest||enter<0)continue;
    const position=add(origin,ray,enter),normal=[0,0,0];normal[axis]=sign;
    // Exclude silhouette pixels; the CPU does not emulate rasterization edge rules.
    const safe=position.every((v,k)=>k===axis||Math.min(v-box.lo[k],box.hi[k]-v)>1);
    hit={position,normal,safe};nearest=enter;
  }
  if(!hit?.safe)return;
  // Native terrain uses 65% vertex color on vertical faces/bottom, before the color-space conversion.
  const shade=hit.normal[1]===1?1:.65;
  if(environment.lighting.enabled===false)return [0,1,2].map(()=>row.colorManagement==="linear-srgb"?encode(shade):255*shade);
  const albedo=row.colorManagement==="linear-srgb"?shade:((shade+.055)/1.055)**2.4;
  return probeReference(hit.position,hit.normal,environment).map(v=>encode(v*albedo));
}
export async function auditLightProbePixels(rows,readImage){
  const names=rows.map(r=>r.name);assert.deepEqual(names,[...PROBE_STATES,...(names.includes("recovered")?["recovered"]:[])],"Missing/duplicate probe states");
  const images=new Map(),byName=new Map(rows.map(r=>[r.name,r]));
  for(const row of rows){const image=decodePng(await readImage(row.image));assert.equal(image.width,row.width);assert.equal(image.height,row.height);images.set(row.name,image);
    assert(row.warm.terrainTriangleCount>0);assert.equal(row.warm.shadowPassCount,0);assert.equal(row.warm.shadowUploadBytes,0);
    for(const field of ["drawCalls","effectDrawCalls","effectTextureBytes"])assert(Number.isInteger(row.warm[field])&&row.warm[field]>=0,`Missing probe cost ${field}`);
    for (const field of resourceFields) assert(Number.isInteger(row.resources?.[field]) && row.resources[field] >= 0, `Missing/invalid probe resource ${field}`);
    assert(row.camera.length===28&&row.camera.every(Number.isFinite));
  }
  const identity=(a,b)=>{const x=images.get(a).pixels,y=images.get(b).pixels;assert.equal(x.length,y.length);assert(x.every((v,i)=>Math.abs(v-y[i])<=1),`Probe identity ${a}/${b}`);};
  for(const name of ["empty","outside","off"])identity("plain",name);
  for(const name of ["reverse","legacy","ao-zero","saved","fresh-restore","re-enabled",...(names.includes("recovered")?["recovered"]:[])])identity("overlap",name);
  identity("single","duplicate");identity("lighting-off-plain","lighting-off");
  const baseline=byName.get("plain"),metrics={};
  for (const row of rows) {
    const costBase = row.name.startsWith("lighting-off") ? byName.get("lighting-off-plain") : baseline;
    // AO may allocate its indirect target, but not extra geometry/uniform buffers.
    const fields = row.name === "ao" ? ["bufferCount", "programCount", "bufferBytes"] : resourceFields;
    for (const field of fields) {
      // Device recovery clears the lazily cached AO pipelines; no growth is allowed.
      if (row.name === "recovered" && field === "programCount")
        assert(row.resources[field] > 0 && row.resources[field] <= costBase.resources[field], `Probe resource growth ${row.name}/${field}`);
      else assert.equal(row.resources[field], costBase.resources[field], `Probe resource growth ${row.name}/${field}`);
    }
    if (row.name !== "ao") for (const field of ["drawCalls", "effectDrawCalls", "effectTextureBytes"])
      assert.equal(row.warm[field], costBase.warm[field], `Probe added work ${row.name}/${field}`);
  }
  for(const c of PROBE_CASES){const row=byName.get(c.name),image=images.get(c.name);
    if(c.environment.lighting.probes!==undefined)assert.equal(row.environmentVersion,15);
    const active=c.environment.lighting.enabled!==false;
    if(row.environmentVersion===15){assert.equal(row.environment[633],active?c.environment.lighting.probes.length:0);assert.equal(row.environment[632],active?1:0);}
    if(!c.ao){
      let samples=0,maxError=0;
      for(let gy=2;gy<=18;gy++)for(let gx=2;gx<=18;gx++){
        const x=Math.floor(row.width*gx/20),y=Math.floor(row.height*gy/20),expected=probePixelReference(row,c.environment,x,y);if(!expected)continue;
        const at=(y*row.width+x)*4;
        expected.forEach((v,k)=>{const error=Math.abs(image.pixels[at+k]-v);maxError=Math.max(maxError,error);assert(error<=2.5,`Probe reference ${c.name} (${x},${y}) channel ${k}: ${image.pixels[at+k]} vs ${v}`);});samples++;
      }
      assert(samples>=50,`Insufficient independent probe samples ${c.name}`);metrics[c.name]={samples,maxError};
    }
  }
  const a=images.get("overlap").pixels,b=images.get("ao").pixels;
  // This fixture contains only indirect diffuse. AO visibility is bounded to 0.1..1;
  // requiring both bounds rejects clears/black output as well as accidental brightening.
  let darkened=0;
  for(let i=0;i<a.length;i+=4){
    for(let k=0;k<3;k++){
      const minimum=encode(decode(a[i+k]/255)*.1);
      assert(b[i+k]>=minimum-2.5 && b[i+k]<=a[i+k]+2.5, `Probe AO radiance bounds at pixel ${i/4}, channel ${k}`);
    }
    if(a[i]+a[i+1]+a[i+2]>b[i]+b[i+1]+b[i+2]+8)darkened++;
  }
  assert(darkened>20,"AO must darken probe indirect light near contacts");
  return {states:rows.length,metrics,aoDarkened:darkened};
}
