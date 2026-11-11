// Shared inputs only. The Node pixel oracle integrates these scenes numerically.
export const HEIGHT_FOG_TERRAIN = [
  {id:"floor",x:-150,y:-80,width:300,depth:260,elevation:0,baseElevation:-4,color:[.2,.3,.4,1]},
  {id:"wall",floorId:1,x:-120,y:100,width:240,depth:10,elevation:120,baseElevation:-4,color:[.2,.3,.4,1]},
  {id:"platform",floorId:2,x:30,y:-20,width:30,depth:70,elevation:40,baseElevation:0,color:[.2,.3,.4,1]},
];
export function heightFogCamera(projection, direction="down") {
  return {projection,position:{x:0,y:-150,elevation:direction==="down"?100:20},target:{x:0,y:0,elevation:direction==="up"?65:20},
    ...(projection==="orthographic"?{height:160}:{fovDegrees:50}),near:.1,far:1000};
}
const fog=(height={},start=0,end=500)=>({color:[.7,.5,.2],start,end,height});
export const HEIGHT_FOG_CASES=[];
for(const route of ["legacy","separated","ao"]){
  const base={composition:route==="legacy"?"legacy":"separated",...(route==="ao"?{ambientOcclusion:{strength:1,radius:4,bias:.1}}:{})};
  for(const [name,value]of Object.entries({plain:{color:[.7,.5,.2],start:600,end:800},default:fog(),zero:fog({density:0}),uniform:fog({falloff:0}),thin:fog({falloff:1e-7,density:.00001}),steep:fog({baseHeight:25,falloff:10}),below:fog({baseHeight:200,density:.003}),clipped:fog({baseHeight:30,density:.02},100,140),beyond:fog({},600,800),linear:{color:[.7,.5,.2],start:100,end:300}}))
    HEIGHT_FOG_CASES.push({name:`${route}-${name}`,direction:"down",baseline:`${route}-plain`,environment:{...base,...(value?{fog:value}:{})}});
}
for(const direction of ["horizontal","up"]){
  for(const [name,value]of Object.entries({plain:{color:[.7,.5,.2],start:600,end:800},default:fog({baseHeight:25,density:.007}),uniform:fog({falloff:0}),steep:fog({baseHeight:25,falloff:10}),clipped:fog({baseHeight:25},40,120)}))
    HEIGHT_FOG_CASES.push({name:`${direction}-${name}`,direction,baseline:`${direction}-plain`,environment:{composition:"separated",ambientOcclusion:{strength:1,radius:4,bias:.1},...(value?{fog:value}:{})}});
}
for(const [name,value]of Object.entries({plain:{color:[.7,.5,.2],start:600,end:800},default:fog(),zero:fog({density:0})}))
  HEIGHT_FOG_CASES.push({name:`pixel-${name}`,direction:"down",baseline:"pixel-plain",environment:{composition:"separated",ambientOcclusion:{strength:1,radius:4,bias:.1},pixelArt:{width:160,height:120,snapCamera:true},...(value?{fog:value}:{})}});
for(const [name,value]of Object.entries({plain:{color:[.7,.5,.2],start:600,end:800},default:fog(),clipped:fog({baseHeight:30,density:.02},100,140)}))
  HEIGHT_FOG_CASES.push({name:`lit-${name}`,direction:"down",baseline:"lit-plain",environment:{composition:"separated",fog:value,
    lighting:{ambient:[.2,.2,.2],lights:[-50,50].map(x=>({position:{x,y:0,elevation:100},radius:300,intensity:1})),
      pointShadows:[{lightIndex:0,resolution:128,pcss:{sourceRadius:4}},{lightIndex:1,resolution:128,pcss:{sourceRadius:2}}],
      directional:{direction:{x:0,y:-1,elevation:2},intensity:.4,shadows:{resolution:128,extent:200,distance:300,pcss:{}}}}}});
export const HEIGHT_FOG_STATES=[...HEIGHT_FOG_CASES.map(c=>c.name),"saved","fresh-restore","off","re-enabled"];
