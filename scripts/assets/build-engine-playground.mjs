#!/usr/bin/env node
// Original, deterministic demo art and authored scene. No downloaded assets/dependencies.
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {encodePngRgba} from '../tools/pack-textures.mjs';

const root=fileURLToPath(new URL('../../examples/starter-runtime/public/playground/',import.meta.url));
await mkdir(root,{recursive:true});
function image(width,height) {
  const pixels=new Uint8Array(width*height*4);
  const color=value=>typeof value==='string'?[...value.matchAll(/[0-9a-f]{2}/gi)].map(v=>parseInt(v[0],16)).concat(255).slice(0,4):value;
  const point=(x,y,c)=>{if(x>=0&&y>=0&&x<width&&y<height)pixels.set(color(c),(y*width+x)*4);};
  const rect=(x,y,w,h,c)=>{for(let j=y;j<y+h;j++)for(let i=x;i<x+w;i++)point(i,j,c);};
  const ellipse=(x,y,rx,ry,c)=>{for(let j=Math.floor(y-ry);j<=y+ry;j++)for(let i=Math.floor(x-rx);i<=x+rx;i++)if(((i-x)/rx)**2+((j-y)/ry)**2<=1)point(i,j,c);};
  return {width,height,pixels,point,rect,ellipse,save:name=>writeFile(root+name+'.png',encodePngRgba(width,height,pixels))};
}
const floor=image(32,32);floor.rect(0,0,32,32,'253e49');floor.rect(1,1,30,30,'304e58');floor.rect(2,2,28,1,'3a5c64');
floor.rect(29,2,1,28,'1d343e');floor.point(4,4,'52727a');floor.point(27,27,'1c333c');await floor.save('floor');
const panel=image(24,24);panel.rect(0,0,24,24,'162732');panel.rect(1,1,22,22,'6a9ba4');panel.rect(3,3,18,18,'2c4854');panel.rect(4,4,16,16,'1b303d');
for(const x of [2,20])for(const y of [2,20])panel.rect(x,y,2,2,'bde2d5');await panel.save('panel');
const wall=image(32,16);wall.rect(0,0,32,16,'152c38');wall.rect(0,1,32,11,'4a6d77');wall.rect(1,2,30,3,'6b8c90');wall.rect(1,13,30,2,'102532');wall.rect(14,4,3,8,'2c4a59');await wall.save('wall');
const water=image(32,32);water.rect(0,0,32,32,'173f54');for(let y=4;y<32;y+=8)for(let x=(y%16?2:10);x<32;x+=16)water.rect(x,y,8,1,'37697a');await water.save('water');
const robot=image(128,40);
for(let frame=0;frame<4;frame++) {
  const x=frame*32,bob=frame%2,foot=frame===1?2:frame===3?-2:0;
  robot.ellipse(x+16,36,10,2,[0,0,0,60]);
  robot.rect(x+8,29+foot,6,7,'182b39');robot.rect(x+19,29-foot,6,7,'182b39');
  robot.rect(x+7,35+foot,8,2,'9bd9d3');robot.rect(x+18,35-foot,8,2,'9bd9d3');
  robot.rect(x+6,15+bob,21,15,'1a394a');robot.rect(x+8,16+bob,17,12,'46768b');robot.rect(x+9,17+bob,15,3,'77adbb');
  robot.rect(x+3,18+bob,4,10,'b6c3bd');robot.rect(x+26,18+bob,4,10,'b6c3bd');
  robot.rect(x+7,4+bob,19,13,'233846');robot.rect(x+8,3+bob,17,12,'d5ddd0');
  robot.rect(x+10,7+bob,13,6,'183645');robot.rect(x+11,8+bob,3,3,'8bf4dd');robot.rect(x+19,8+bob,3,3,'8bf4dd');
  robot.rect(x+15,0+bob,2,4,'648c95');robot.rect(x+14,0+bob,4,2,'ffc678');
  robot.rect(x+13,23+bob,8,3,'ffc678');
}
await robot.save('robot');
const normal=image(128,40);
// OpenGL tangent-space normals use +Y up; PNG row coordinates increase down.
for(let y=0;y<40;y++)for(let x=0;x<128;x++) {
  const nx=((x%32)-16)/23,ny=(18-y)/30,nz=Math.sqrt(Math.max(.1,1-nx*nx-ny*ny));
  normal.point(x,y,[Math.round(128+nx*96),Math.round(128+ny*96),Math.round(128+nz*127),robot.pixels[(y*128+x)*4+3]]);
}
await normal.save('robot-normal');
const ball=image(32,32),ballNormal=image(32,32);
for(let y=0;y<32;y++)for(let x=0;x<32;x++) {
  const nx=(x-15.5)/15,ny=(15.5-y)/15,d=nx*nx+ny*ny;if(d>1)continue;
  const light=.55+.45*Math.sqrt(1-d);ball.point(x,y,[Math.round(244*light),Math.round(180*light),Math.round(86*light),255]);
  ballNormal.point(x,y,[Math.round(128+nx*127),Math.round(128+ny*127),Math.round(128+Math.sqrt(1-d)*127),255]);
}
ball.rect(10,9,4,3,'ffe2a6');await ball.save('ball');await ballNormal.save('ball-normal');
const energy=image(24,24);for(let y=1;y<23;y++)for(let x=1;x<23;x++){const d=Math.abs(x-12)+Math.abs(y-12);if(d<10)energy.point(x,y,d<6?'b0ffe4':'3cbbba');}energy.rect(11,7,2,10,'e5fff1');await energy.save('energy');

const component=(visual,collider='none',layer='wall',body)=>({visual,collider,layer,...(body?{body}:{})});
const sprite=(texture,width,height,extra={})=>({kind:'sprite',texture,width,height,...extra});
const box=(w,h)=>({type:'aabb',halfWidth:w/2,halfHeight:h/2,isTrigger:false});
const clips=[{id:0,frames:[{u0:0,v0:0,u1:.25,v1:1}],fps:1,loop:true},{id:1,frames:Array.from({length:4},(_,i)=>({u0:i/4,v0:0,u1:(i+1)/4,v1:1})),frameDurationsMs:[140,100,140,100],loop:true}];
const scene={format:'ferrum2d.consumer.scene-authoring',version:1,gameplay:{primaryActor:'robot'},ids:{items:{cell:1}},variables:[{name:'cells',scope:'scene',type:'integer',default:0}],
  navigation:{columns:40,rows:24,cellWidth:16,cellHeight:16,costs:Array(960).fill(1)},
  sceneComposition:{initialFragment:'playground',prefabs:{
    object:{},floor:{props:{components:component(sprite('floor',32,32,{layer:-100}))}},
    robot:{props:{components:component(sprite('robot',32,40,{originY:.85,normalTexture:'robotNormal',animationSet:{initialClip:0,clips}}),box(12,12),'player',{type:'kinematic',heightSpan:{floorId:0,elevation:0,height:1}}),behaviorRecipes:['robot']}},
    energy:{props:{components:component(sprite('energy',24,24),{type:'circle',radius:10,isTrigger:true},'pickup'),behaviorRecipes:['energy']}},
  },fragments:{playground:{instances:[]}}},
  behaviorRecipes:{entities:{robot:{recipes:[{kind:'collisionPickup',target:'other'},{kind:'incrementVariable',variable:'cells',amount:1,when:{type:'gameplayEvent',event:'pickupCollected',item:'cell'}}]},energy:{recipes:[{kind:'pickup',item:'cell',count:1,despawn:true}]}}},
};
const instances=scene.sceneComposition.fragments.playground.instances;
const add=(id,x,y,components)=>instances.push({id,prefab:'object',x,y,props:{components}});
for(let y=0;y<12;y++)for(let x=0;x<20;x++)instances.push({id:`floor_${x}_${y}`,prefab:'floor',x:x*32+16,y:y*32+16});
function blocked(cx,cy,w,h) {for(let y=0;y<24;y++)for(let x=0;x<40;x++)if(Math.abs(x*16+8-cx)<w/2+8&&Math.abs(y*16+8-cy)<h/2+8)scene.navigation.costs[y*40+x]=0;}
function barrier(id,x,y,w,h) {add(id,x,y,component(sprite('wall',w,h),box(w,h),'wall',{type:'static'}));blocked(x,y,w,h);}
barrier('north',320,8,640,16);barrier('south',320,376,640,16);barrier('west',8,192,16,384);barrier('east',632,192,16,384);
barrier('garden_gate',144,192,144,16);barrier('east_gate',536,160,160,16);
add('pool',320,120,component(sprite('water',128,80,{layer:-80}),box(128,80),'wall',{type:'static'}));blocked(320,120,128,80);
const nineSlice={sourceWidth:24,sourceHeight:24,left:4,right:4,top:4,bottom:4,borderScale:1};
add('pool_edge',320,120,component(sprite('panel',144,96,{layer:-90,nineSlice})));
add('physics_bay',520,280,component(sprite('panel',176,144,{layer:-90,nineSlice})));blocked(520,280,176,144);
barrier('bay_north',520,216,160,8);barrier('bay_south',520,344,160,8);barrier('bay_west',440,280,8,136);barrier('bay_east',600,280,8,136);
add('ball',488,280,component(sprite('ball',28,28,{normalTexture:'ballNormal'}),{type:'circle',radius:14,isTrigger:false},'wall',{type:'dynamic',mass:1,gravityScale:0,linearDamping:.1,angularDamping:.2,material:{friction:0,restitution:.9}}));
for(const [i,x,y]of [[0,144,96],[1,304,296],[2,552,88]])instances.push({id:`cell_${i}`,prefab:'energy',x,y});
instances.push({id:'robot',prefab:'robot',x:64,y:296});
await writeFile(root+'scene.json',JSON.stringify(scene,null,2)+'\n');
await writeFile(root+'README.md','# Engine Playground assets\n\nOriginal Ferrum2D demo art. Rebuild with `node scripts/assets/build-engine-playground.mjs`. PNGs and authored scene are deterministic; no external images are used. The UI reuses the local Noto Sans KR subset; its OFL notice and provenance ship in ../fonts.\n');
console.log(`Engine Playground: ${instances.length} authored instances, ${scene.navigation.costs.length} navigation cells, original PNG textures.`);
