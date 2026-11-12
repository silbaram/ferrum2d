import assert from "node:assert/strict";
import { decodePng } from "../../scripts/tools/pack-textures.mjs";

export const POINT_PCSS_PASSES=Object.freeze({ambient:0,plain:0,"contact-hard":6,"contact-pcf3":0,"contact-zero":0,"contact-pcss":0,
  "mid-pcss":6,"far-pcss":6,"far-hard":0,"far-pcf3":0,"far-limited":0,"far-small-source":0,
  "resolution-128":6,"resolution-256":6,"resolution-1024":6,"camera-base":6,"camera-shift":0,"camera-return":0,
  "thin-contact":6,"thin-far":6,"slope-plain":0,"slope-pcss":6,"curve-plain":0,"curve-pcss":6,
  "seam-plain":0,"seam-hard":6,"seam-zero":0,"seam-pcss":0,"corner-plain":0,"corner-hard":6,"corner-zero":0,"corner-pcss":0,
  "dual-pcf3":13,"dual-first":0,"dual-second":0,"dual-pcss":0,"fresh-restore":13,off:0,"re-enabled":13});

export async function auditSpatialPointPcssPixels(rows,readImage){
  const byName=new Map(rows.map(r=>[r.name,r]));
  assert.equal(byName.size,rows.length,"Duplicate PCSS states");
  for(const name of byName.keys())assert(name in POINT_PCSS_PASSES||name==="recovered",`Unexpected PCSS state ${name}`);
  for(const [name,passes]of Object.entries({...POINT_PCSS_PASSES,...(byName.has("recovered")?{recovered:13}:{})})){
    const r=byName.get(name);assert(r,`Missing PCSS state ${name}`);
    assert.equal(r.stats.shadowPassCount,passes,`PCSS face budget ${name}`);
    assert.equal(r.warm.shadowPassCount,0,`PCSS warm redraw ${name}`);assert.equal(r.warm.shadowUploadBytes,0);
    assert.equal(r.stats.modelCount,1);assert(r.stats.triangleCount>0,"Missing receiver geometry");
    if(passes>0)assert(r.stats.shadowTriangleCount>0&&r.stats.shadowDrawCalls>0,"Missing caster geometry");
  }
  const images=new Map();for(const r of rows){const image=decodePng(await readImage(r.image));assert.equal(image.width,r.width);assert.equal(image.height,r.height);images.set(r.name,image);}
  const equalImages=(a,b,channels=[0,1,2,3])=>{
    const x=images.get(a),y=images.get(b);assert.equal(x.pixels.length,y.pixels.length);
    let changed=0;for(let i=0;i<x.pixels.length;i+=4)if(channels.some(c=>Math.abs(x.pixels[i+c]-y.pixels[i+c])>1))changed++;
    assert.equal(changed,0,`PCSS unexpected pixel difference ${a}/${b}`);
  };
  equalImages("contact-hard","contact-zero");equalImages("far-pcss","camera-base");equalImages("camera-base","camera-return");
  equalImages("dual-pcss","fresh-restore");equalImages("dual-pcss","re-enabled");equalImages("dual-pcf3","dual-first",[1,2,3]);equalImages("dual-pcf3","dual-second",[0,2,3]);
  equalImages("dual-first","dual-pcss",[0,2,3]);equalImages("dual-second","dual-pcss",[1,2,3]);
  for(const [name,channel]of [["dual-first",0],["dual-second",1]]){
    const a=images.get("dual-pcf3"),b=images.get(name);let changed=0;
    for(let i=channel;i<a.pixels.length;i+=4)if(Math.abs(a.pixels[i]-b.pixels[i])>4)changed++;
    assert(changed>20,`Missing independent owner PCSS signal: ${name}`);
  }
  equalImages("seam-hard","seam-zero");equalImages("corner-hard","corner-zero");
  if(byName.has("recovered")){equalImages("re-enabled","recovered");assert.equal(byName.get("recovered").stats.shadowPassCount,13);}
  // These low, single-valued surfaces face the overhead point light.
  // Green material identifies model pixels independently of red shadowing and the gray floor.
  const floor=images.get("plain"),point=byName.get("plain").points[288];
  const floorGreen=floor.pixels[(point[1]*floor.width+point[0])*4+1];
  const modelReceivers={};
  for(const kind of ["slope","curve"]){
    const a=images.get(`${kind}-plain`),b=images.get(`${kind}-pcss`);let changed=0,receiver=0;
    for(let i=0;i<a.pixels.length;i+=4)if(a.pixels[i+1]>floorGreen+8){receiver++;if(a.pixels[i]-b.pixels[i]>8)changed++;}
    assert(receiver>100,"Missing model receiver signal");
    assert(changed<=receiver*.005,`PCSS model receiver acne: ${kind} ${changed}/${receiver}`);
    modelReceivers[kind]={receiverPixels:receiver,shadowAcnePixels:changed};
  }
  const sample=(name,point)=>{const img=images.get(name);const [x,y]=point;assert(Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<img.width&&y>=0&&y<img.height,"Invalid profile point");return img.pixels[(y*img.width+x)*4];};
  const middle=byName.get("plain").points[Math.floor(byName.get("plain").points.length/2)];
  const lit=sample("plain",middle),dark=sample("ambient",middle);assert(lit-dark>50,"Missing PCSS lighting signal");
  const profiles={};for(const name of ["contact-hard","contact-zero","contact-pcss","mid-pcss","far-pcss","far-hard","far-pcf3","far-limited","far-small-source","resolution-128","resolution-256","resolution-1024","camera-base","camera-shift","thin-contact","thin-far","seam-hard","seam-pcss","corner-hard","corner-pcss"]){
    const r=byName.get(name);assert(r.points.length===577,"Incomplete PCSS receiver profile");
    const baseline=name.startsWith("seam-")?"seam-plain":name.startsWith("corner-")?"corner-plain":"plain";
    const values=r.points.map((p,i)=>{
      const lit=sample(baseline,byName.get(baseline).points[i]),dark=sample("ambient",byName.get("ambient").points[i]);
      assert(lit-dark>20,"Missing local point lighting signal");return (sample(name,p)-dark)/(lit-dark);
    });
    profiles[name]={partial:values.filter(v=>v>.1&&v<.9).length,shadow:values.filter(v=>v<.9).length,min:Math.min(...values),max:Math.max(...values)};
    assert(profiles[name].shadow>0,"Missing PCSS shadow signal: "+name);assert(profiles[name].max>.95,"Receiver never becomes lit: "+name);
  }
  assert(profiles["far-pcss"].partial>profiles["mid-pcss"].partial+8,"PCSS does not widen with receiver separation");
  assert(profiles["mid-pcss"].partial>profiles["contact-pcss"].partial+4,"PCSS contact is not sharper than detached shadow");
  assert(profiles["far-pcss"].partial>profiles["far-pcf3"].partial+8,"PCSS behaves like fixed PCF");
  assert(profiles["far-pcss"].partial>profiles["far-limited"].partial+8,"PCSS texel radius cap has no effect");
  assert(profiles["far-pcss"].partial>profiles["far-small-source"].partial+8,"PCSS source radius has no effect");
  for(const resolution of [128,256,1024])assert(Math.abs(profiles[`resolution-${resolution}`].partial-profiles["far-pcss"].partial)<=48,"PCSS world penumbra changed with map resolution");
  assert(Math.abs(profiles["camera-base"].partial-profiles["camera-shift"].partial)<=16,"PCSS unstable across subtexel camera motion");
  assert(profiles["thin-contact"].min<.4&&profiles["thin-far"].min<.8,"PCSS lost the thin caster");
  for(const name of ["seam","corner"]){
    assert(profiles[`${name}-pcss`].partial>profiles[`${name}-hard`].partial+8,`Missing cube ${name} softening`);
    const r=byName.get(`${name}-pcss`),baseline=byName.get(`${name}-plain`);
    for(let i=280;i<=296;i++)assert((sample(r.name,r.points[i])-dark)/(sample(baseline.name,baseline.points[i])-dark)<.4,`Light leak on cube ${name}`);
  }
  return {lit,dark,profiles,modelReceivers,maxBlockerFetches:16,maxFilterFetches:32,maxDepthFetchesPerPointQuery:48};
}
