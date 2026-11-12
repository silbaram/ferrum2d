import { test } from "node:test";
import assert from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { PROBE_CASES } from "./spatial-light-probes-cases.mjs";
import { auditLightProbePixels, probeReference, probePixelReference } from "./spatial-light-probes-report.mjs";
const read = async image => image;
function fixture() {
  const width=96,height=72,rows=[];
  for(const c of PROBE_CASES){
    const active=c.environment.lighting.enabled!==false,probes=c.environment.lighting.probes;
    const environment=Array(700).fill(0);if(probes&&active){environment[632]=1;environment[633]=probes.length;}
    const row={name:c.name,width,height,camera:Array(16).fill(0).concat([0,0,150,160,0,0,-20,180,.1,800,width,height]),environment,
      environmentVersion:probes?15:6,warm:{terrainTriangleCount:24,shadowPassCount:0,shadowUploadBytes:0,drawCalls:active?2:1,effectDrawCalls:active?1:0,effectTextureBytes:active?width*height*12:0},resources:{textureCount:active?2:0,renderTargetCount:active?1:0,bufferCount:8,programCount:7,bufferBytes:6144}};
    const pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const expected=probePixelReference(row,c.environment,x,y)??[0,0,0];
      pixels.set([...expected.map(v=>Math.round(c.ao?v*.7:v)),255],(y*width+x)*4);
    }
    row.image=encodePngRgba(width,height,pixels);rows.push(row);
  }
  for(const name of ["saved","fresh-restore","off","re-enabled"])rows.push({...rows.find(r=>r.name===(name==="off"?"plain":"overlap")),name});
  return rows;
}
test("probe reference honors centers, boundaries, dark fill and duplicate coverage",()=>{
  const probe={position:{x:0,y:0,elevation:0},radius:10,color:[1,0,0],intensity:1};
  const env={lighting:{ambient:[0,0,1],probes:[probe]}};
  assert.deepEqual(probeReference([0,0,0],[0,1,0],env),[1,0,0]);
  assert.deepEqual(probeReference([5,0,0],[0,1,0],env),[.5,0,.5]);
  assert.deepEqual(probeReference([10,0,0],[0,1,0],env),[0,0,1]);
  assert.deepEqual(probeReference([5,0,0],[0,1,0],{lighting:{...env.lighting,probes:[probe,probe]}}),[.5,0,.5]);
  assert.deepEqual(probeReference([5,0,0],[0,1,0],{lighting:{...env.lighting,probes:[{...probe,intensity:0}]}}),[0,0,.5]);
});
test("probe oracle accepts controlled independently computed pixels",async()=>{
  const r=await auditLightProbePixels(fixture(),read);assert(r.metrics.overlap.samples>=50);assert(r.aoDarkened>20);
  const rows=fixture(),overlap=rows.find(r=>r.name==="overlap");
  rows.push({...overlap,name:"recovered",resources:{...overlap.resources,programCount:overlap.resources.programCount-1}});
  await auditLightProbePixels(rows,read);
  rows.at(-1).resources.programCount=overlap.resources.programCount+1;
  await assert.rejects(auditLightProbePixels(rows,read),/resource/);
});
test("probe oracle rejects missing effect, swapped colors, stale restore and blank rendering",async()=>{
  for(const [target,source]of [["single","plain"],["eight","single"],["fresh-restore","plain"],["ao","overlap"]]){
    const rows=fixture();rows.find(r=>r.name===target).image=rows.find(r=>r.name===source).image;await assert.rejects(auditLightProbePixels(rows,read));
  }
  const rows=fixture();for(const r of rows)r.image=encodePngRgba(r.width,r.height,new Uint8Array(r.width*r.height*4));await assert.rejects(auditLightProbePixels(rows,read));
});
test("probe oracle rejects missing states, cost metrics, count bounds and extra passes/targets",async()=>{
  await assert.rejects(auditLightProbePixels(fixture().slice(1),read),/states/);
  for(const mutate of [r=>delete r.warm.effectDrawCalls,r=>r.warm.drawCalls++,r=>r.resources.textureCount++,r=>r.warm.shadowPassCount=1,r=>r.environment[633]=9,r=>r.environmentVersion=14]){
    const rows=fixture();mutate(rows.find(r=>r.name==="eight"));await assert.rejects(auditLightProbePixels(rows,read));
  }
});

test("probe oracle rejects an isolated black or brightened AO image", async () => {
  for (const value of [0, 255]) {
    const rows = fixture(), row = rows.find(r => r.name === "ao");
    const data = new Uint8Array(row.width * row.height * 4).fill(value);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    row.image = encodePngRgba(row.width, row.height, data);
    await assert.rejects(auditLightProbePixels(rows, read));
  }
});

test("probe oracle rejects uniformly missing resource counters and buffer growth", async () => {
  for (const field of ["textureCount", "renderTargetCount", "bufferCount", "programCount", "bufferBytes"]) {
    const rows = fixture();
    for (const row of rows) delete row.resources[field];
    await assert.rejects(auditLightProbePixels(rows, read), /resource/);
  }
  for (const name of ["eight", "ao", "saved", "fresh-restore", "off", "re-enabled", "recovered"]) {
    const rows = fixture();
    if (name === "recovered") rows.push({...rows.find(r => r.name === "overlap"), name});
    const row = rows.find(r => r.name === name);
    row.resources = {...row.resources, bufferCount: row.resources.bufferCount + 1};
    await assert.rejects(auditLightProbePixels(rows, read), /resource/);
  }
});
