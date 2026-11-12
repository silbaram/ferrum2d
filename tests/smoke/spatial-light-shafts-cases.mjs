// Fixture inputs, not the shader implementation. The Node oracle ray-casts these boxes.
export const SHAFT_TERRAIN=[
 {id:"floor",x:-160,y:-100,width:320,depth:280,elevation:0,baseElevation:-4,color:[.12,.16,.2,1]},
 {id:"canopy",floorId:1,x:-50,y:0,width:35,depth:70,elevation:60,baseElevation:56,color:[.12,.16,.2,1]},
 {id:"pillar",floorId:2,x:35,y:20,width:12,depth:18,elevation:70,baseElevation:0,color:[.12,.16,.2,1]},
];
export const shaftCamera=projection=>({projection,position:{x:0,y:-150,elevation:90},target:{x:0,y:20,elevation:20},...(projection==="orthographic"?{height:150}:{fovDegrees:48}),near:.1,far:800});
export const SHAFT_BASE={composition:"separated",lighting:{ambient:[.5,.5,.5],lights:[],directional:{direction:{x:0,y:0,elevation:1},color:[1,.9,.7],intensity:1,shadows:{resolution:512,extent:400,distance:500,bias:0}}}};
export const SHAFT_CASES=[{name:"plain",environment:SHAFT_BASE}];
const add=(name,lightShafts,extra={},baseline="plain")=>SHAFT_CASES.push({name,environment:{...SHAFT_BASE,...extra,lightShafts},baseline});
for(const quality of ["low","balanced","high"])add(quality,{quality});
add("zero",{intensity:0});add("density-zero",{density:0});add("thin",{density:.0001});add("dense",{density:.08});
add("short",{maxDistance:20});add("long",{maxDistance:500});add("forward",{anisotropy:.8});add("tinted",{color:[.1,.4,1]});add("strong",{intensity:1.2});
for(const [name,extra]of Object.entries({fog:{fog:{color:[.2,.3,.4],start:0,end:350,height:{density:.006}}},ao:{ambientOcclusion:{strength:1,radius:16,bias:.1}},pixel:{pixelArt:{width:160,height:120,snapCamera:true}}})){
 SHAFT_CASES.push({name:`${name}-plain`,environment:{...SHAFT_BASE,...extra}});add(name,{},extra,`${name}-plain`);
}
const angled={...SHAFT_BASE.lighting,directional:{...SHAFT_BASE.lighting.directional,direction:{x:.4,y:-.2,elevation:1}}};
SHAFT_CASES.push({name:"angled-plain",environment:{...SHAFT_BASE,lighting:angled}});add("angled",{},{lighting:angled},"angled-plain");
const dark={...SHAFT_BASE.lighting,enabled:false};SHAFT_CASES.push({name:"lighting-off-plain",environment:{...SHAFT_BASE,lighting:dark}});add("lighting-off",{}, {lighting:dark},"lighting-off-plain");
export const SHAFT_STATES=[...SHAFT_CASES.map(c=>c.name),"saved","fresh-restore","off","re-enabled"];
