import { test } from "node:test";
import { rejects, ok } from "node:assert/strict";
import { encodePngRgba, decodePng } from "../../scripts/tools/pack-textures.mjs";
import { auditSpatialPointPcssPixels, POINT_PCSS_PASSES } from "./spatial-point-pcss-report.mjs";
const read=async bytes=>bytes;
function fixture(){
  const image=(partial=0,litOnly=false,darkOnly=false,receiver=false,greenPartial)=>{
    const data=new Uint8Array(577*4);
    for(let i=0;i<577;i++){
      const d=Math.abs(i-288),shade=p=>p?Math.max(0,Math.min(1,(d-160)/p+.5)):Number(d>=160);
      const v=darkOnly?0:litOnly?1:shade(partial),g=greenPartial===undefined?10:10+Math.round(shade(greenPartial)*200);
      data.set([10+Math.round(v*200),receiver?30:g,10,255],i*4);
    }return encodePngRgba(577,1,data);
  };
  const partial={"contact-pcf3":8,"mid-pcss":24,"far-pcf3":8,"far-limited":8,"far-small-source":16};
  const dual={"dual-pcf3":[8,8],"dual-first":[80,8],"dual-second":[8,80],"dual-pcss":[80,80],"fresh-restore":[80,80],"re-enabled":[80,80]};
  return Object.entries(POINT_PCSS_PASSES).map(([name,passes])=>({name,width:577,height:1,points:Array.from({length:577},(_,i)=>[i,0]),
    stats:{shadowPassCount:passes,shadowDrawCalls:passes,shadowTriangleCount:passes*2,modelCount:1,triangleCount:12},warm:{shadowPassCount:0,shadowUploadBytes:0},
    image:name.startsWith("slope-")||name.startsWith("curve-")?image(0,true,false,true):name==="ambient"?image(0,false,true):["plain","seam-plain","corner-plain"].includes(name)?image(0,true)
      :name in dual?image(dual[name][0],false,false,false,dual[name][1]):name in partial?image(partial[name])
      :["contact-hard","contact-zero","contact-pcss","far-hard","thin-contact","thin-far","seam-hard","seam-zero","corner-hard","corner-zero"].includes(name)?image():image(80)}));
}
test("point PCSS PNG audit measures contact hardening, cube seams and independent owners",async()=>{
  const result=await auditSpatialPointPcssPixels(fixture(),read);ok(result.profiles["far-pcss"].partial>result.profiles["mid-pcss"].partial);
});
test("point PCSS audit rejects missing signal, fixed blur and ineffective controls",async()=>{
  const blank=encodePngRgba(577,1,new Uint8Array(577*4));await rejects(auditSpatialPointPcssPixels(fixture().map(r=>({...r,image:blank})),read),/signal/);
  for(const name of ["mid-pcss","far-limited","far-small-source"]){
    const rows=fixture();rows.find(r=>r.name===name).image=rows.find(r=>r.name==="far-pcss").image;
    await rejects(auditSpatialPointPcssPixels(rows,read),/widen|cap has no effect|source radius has no effect/);
  }
});
test("point PCSS audit rejects coupled owners and a silently ignored second filter",async()=>{
  for(const replacement of ["dual-first","dual-pcf3"]){
    const rows=fixture();rows.find(r=>r.name==="dual-second").image=rows.find(r=>r.name===replacement).image;
    await rejects(auditSpatialPointPcssPixels(rows,read),/pixel difference|owner PCSS signal/);
  }
});
test("point PCSS audit rejects seam light leaks, missing cases and warm redraws",async()=>{
  await rejects(auditSpatialPointPcssPixels(fixture().slice(1),read),/Missing PCSS state/);
  const warm=fixture();warm.find(r=>r.name==="far-pcss").warm.shadowPassCount=6;await rejects(auditSpatialPointPcssPixels(warm,read),/warm redraw/);
  for(const name of ["seam-pcss","corner-pcss"]){
    const rows=fixture(),row=rows.find(r=>r.name===name),img=decodePng(row.image);
    for(let i=280;i<=296;i++)img.pixels[i*4]=210;row.image=encodePngRgba(577,1,img.pixels);
    await rejects(auditSpatialPointPcssPixels(rows,read),/Light leak/);
  }
});
test("point PCSS audit rejects model acne and source-zero changes",async()=>{
  const rows=fixture(),data=new Uint8Array(577*4);for(let i=0;i<577;i++)data.set([20,30,10,255],i*4);
  rows.find(r=>r.name==="curve-pcss").image=encodePngRgba(577,1,data);
  await rejects(auditSpatialPointPcssPixels(rows,read),/model receiver acne/);
  const zero=fixture();zero.find(r=>r.name==="contact-zero").image=zero.find(r=>r.name==="far-pcss").image;
  await rejects(auditSpatialPointPcssPixels(zero,read),/pixel difference/);
});
