import { test } from "node:test";
import { rejects, ok } from "node:assert/strict";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";
import { auditSpatialSunPcssPixels, SUN_PCSS_PASSES } from "./spatial-sun-pcss-report.mjs";
const read=async bytes=>bytes;
function fixture(){
  const image=(partial=0,litOnly=false,darkOnly=false,receiver=false)=>{
    const data=new Uint8Array(577*4);
    for(let i=0;i<577;i++){
      const d=Math.abs(i-288),v=darkOnly?0:litOnly?1:partial?Math.max(0,Math.min(1,(d-160)/partial+.5)):Number(d>=160);
      data.set([10+Math.round(v*200),receiver?30:10,10,255],i*4);
    }return encodePngRgba(577,1,data);
  };
  const hard=image(),far=image(80),partial={"contact-pcf3":8,"mid-pcss":24,"far-pcf3":8,"far-limited":8,"far-small-angle":16};
  return Object.entries(SUN_PCSS_PASSES).map(([name,passes])=>({name,width:577,height:1,points:Array.from({length:577},(_,i)=>[i,0]),
    stats:{shadowPassCount:passes,shadowDrawCalls:passes,shadowTriangleCount:passes*2,modelCount:1,triangleCount:12},warm:{shadowPassCount:0,shadowUploadBytes:0},
    image:name.startsWith("slope-")||name.startsWith("curve-")?image(0,true,false,true):name==="ambient"?image(0,false,true):name==="plain"?image(0,true):name in partial?image(partial[name]):["contact-hard","contact-zero","contact-pcss","far-hard","thin-contact","thin-far"].includes(name)?hard:far}));
}
test("PCSS PNG audit measures contact hardening and bounded sampling controls",async()=>{
  const result=await auditSpatialSunPcssPixels(fixture(),read);ok(result.profiles["far-pcss"].partial>result.profiles["mid-pcss"].partial);
});
test("PCSS audit rejects successful-looking hard or missing shadows",async()=>{
  const rows=fixture();rows.find(r=>r.name==="far-pcss").image=rows.find(r=>r.name==="far-hard").image;
  await rejects(auditSpatialSunPcssPixels(rows,read),/pixel difference|widen/);
  const empty=fixture(),blank=encodePngRgba(577,1,new Uint8Array(577*4));
  await rejects(auditSpatialSunPcssPixels(empty.map(r=>({...r,image:blank})),read),/lighting signal|model receiver signal/);
});
test("PCSS audit rejects fixed blur and ineffective angle/radius controls",async()=>{
  for(const name of ["mid-pcss","far-limited","far-small-angle"]){
    const rows=fixture();rows.find(r=>r.name===name).image=rows.find(r=>r.name==="far-pcss").image;
    await rejects(auditSpatialSunPcssPixels(rows,read),/widen|cap has no effect|angular radius has no effect/);
  }
});
test("PCSS audit rejects missing semantic cases, warm redraws and unrelated channels",async()=>{
  await rejects(auditSpatialSunPcssPixels(fixture().slice(1),read),/Missing PCSS state/);
  const rows=fixture();rows.find(r=>r.name==="far-limited").warm.shadowPassCount=1;
  await rejects(auditSpatialSunPcssPixels(rows,read),/warm redraw/);
  const channels=fixture();channels.find(r=>r.name==="dual-pcf3").image=encodePngRgba(577,1,new Uint8Array(577*4));
  await rejects(auditSpatialSunPcssPixels(channels,read),/pixel difference/);
});
test("PCSS audit rejects model receiver acne without hiding it in the floor",async()=>{
  const rows=fixture(),data=new Uint8Array(577*4);for(let i=0;i<577;i++)data.set([20,30,10,255],i*4);
  rows.find(r=>r.name==="curve-pcss").image=encodePngRgba(577,1,data);
  await rejects(auditSpatialSunPcssPixels(rows,read),/model receiver acne/);
});
