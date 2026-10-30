import { AudioManager } from '@ferrum2d/ferrum-web/core';
import { startSpatialScene } from '/spatial.mjs';
const check=(value,message,details)=>{if(!value)throw new Error(message+': '+JSON.stringify(details));};
const NativeContext=window.AudioContext;
function measure(buffer){
  const energy=[0,0];
  for(let channel=0;channel<2;channel++){
    const data=buffer.getChannelData(channel);
    for(let i=1024;i<data.length;i++)energy[channel]+=data[i]*data[i];
    energy[channel]=Math.sqrt(energy[channel]/(data.length-1024));
  }
  return {left:energy[0],right:energy[1],rms:Math.hypot(...energy)};
}
async function offline(name,source,configure=()=>{},fallback=false){
  const context=new OfflineAudioContext(2,8192,48000),counts={source:0,gain:0,panner:0};
  for(const [method,key] of [['createBufferSource','source'],['createGain','gain'],['createPanner','panner']]){
    const original=context[method].bind(context);
    context[method]=(...args)=>{counts[key]++;return original(...args);};
  }
  context.close=async()=>{};
  if(fallback)context.createPanner=undefined;
  window.AudioContext=class{constructor(){return context;}};
  const audio=new AudioManager();
  try{
    await audio.loadSound(1,'/assets/audio/water.wav');
    const voice=audio.playSpatial(1,{refDistance:1,maxDistance:1000,loop:true,...source});
    const before={...counts};configure(audio,voice);
    check(JSON.stringify(before)===JSON.stringify(counts),'pose update allocated AudioNodes',counts);
    const samples=await context.startRendering(),energy=measure(samples);
    check(voice.spatialized===!fallback,'incorrect fallback mode');
    voice.stop();check(audio.state().spatialVoiceCount===0&&!voice.active,'offline voice cleanup');
    return {name,...energy,nodes:counts,fallback};
  }finally{audio.destroy();window.AudioContext=NativeContext;}
}
async function offlineMatrix(){
  const rows=[];
  const run=async(...args)=>{const row=await offline(...args);rows.push(row);return row;};
  const left=await run('left',{x:-10,y:0,z:0}),right=await run('right',{x:10,y:0,z:0});
  check(left.left>left.right*20&&right.right>right.left*20,'spatial left/right panning', {left,right});
  const near=await run('near',{x:0,y:0,z:-1}),far=await run('far',{x:0,y:0,z:-10});
  check(Math.abs(far.rms/near.rms-.1)<.005,'inverse distance attenuation',{near,far});
  const high=await run('elevation',{x:0,y:10,z:-1});
  check(Math.abs(high.rms/near.rms-1/Math.sqrt(101))<.005,'elevation attenuation',{near,high});
  const cone={x:0,y:0,z:-10,coneInnerAngle:30,coneOuterAngle:60,coneOuterGain:.1};
  const facing=await run('cone-facing',{...cone,direction:{x:0,y:0,z:1}}),away=await run('cone-away',{...cone,direction:{x:0,y:0,z:-1}});
  check(Math.abs(away.rms/facing.rms-.1)<.005,'directional cone response',{facing,away});
  const turned=await run('listener-turned',{x:10,y:0,z:0},a=>{a.setListenerPose(0,0,0,0,0,1);a.setListenerPosition(0,0,0);});
  check(turned.left>turned.right*20,'listener orientation ignored/reset',turned);
  const moved=await run('source-moved',{x:10,y:0,z:0},(_a,v)=>{for(let i=0;i<100;i++)v.setPose(-10,0,0);});
  check(moved.left>moved.right*20,'source pose update ignored',moved);
  const mute=await run('sfx-muted',{x:0,y:0,z:-1},a=>a.setBusVolume('sfx',0));
  const stop=await run('stopped',{x:0,y:0,z:-1},(_a,v)=>v.stop());
  check(mute.rms<1e-8&&stop.rms<1e-8,'mute/stop left audible output',{mute,stop});
  const fallback=await run('fallback',{x:100,y:0,z:0},()=>{},true);
  check(fallback.rms>near.rms*.9&&Math.abs(fallback.left-fallback.right)<1e-6,'nonpositional fallback',fallback);
  return rows;
}
async function waitFor(predicate){const deadline=performance.now()+10000;while(!predicate()){check(performance.now()<deadline,'native audio state timed out');await new Promise(r=>requestAnimationFrame(r));}}
async function nativeScene(){
  const contexts=[],panners=[],gains=[],counts={source:0,gain:0,panner:0};
  window.AudioContext=class{constructor(){
    const c=new NativeContext();contexts.push(c);
    for(const [method,key,list]of[['createBufferSource','source',null],['createGain','gain',gains],['createPanner','panner',panners]]){
      const original=c[method].bind(c);c[method]=(...args)=>{counts[key]++;const node=original(...args);list?.push(node);return node;};
    }return c;
  }};
  const canvas=document.querySelector('canvas');let demo;
  try{
    demo=await startSpatialScene(canvas,{audio:true});
    window.nativeAudioUnlock=()=>demo.audio.unlock();
    document.querySelector('button').onclick=window.nativeAudioUnlock;
    window.nativeAudioNeedsUnlock=true;
    await waitFor(()=>contexts[0].state==='running');
    await waitFor(()=>demo.frame&&demo.audio.state().spatialVoiceCount===2);
    demo.engine.stop();
    check(demo.engine.dataSceneState()==='playing'&&demo.errors.length===0&&demo.frame.stats.spatial.billboardCount>=3&&demo.frame.stats.drawCalls<32&&demo.frame.state.rustUpdateTimeMs<250,'actual native scene not rendered',demo.frame.stats);
    const listener=contexts[0].listener;
    await new Promise(resolve=>setTimeout(resolve,80));
    check(Math.abs(listener.positionY.value-12)<1e-4&&Math.abs(panners[1].positionY.value-84)<1e-4,'initial native elevation/offset',{listener:listener.positionY.value,torch:panners[1].positionY.value,now:contexts[0].currentTime,poseWords:Array.from(demo.engine.queryAudioPoseBuffer(new Uint32Array([demo.handles.actor.entityId,demo.handles.actor.entityGeneration,demo.handles.above.entityId,demo.handles.above.entityGeneration])).words),poseFloats:Array.from(demo.engine.queryAudioPoseBuffer(new Uint32Array([demo.handles.actor.entityId,demo.handles.actor.entityGeneration,demo.handles.above.entityId,demo.handles.above.entityGeneration])).floats)});
    const saved=demo.save();
    let queries=0,perEntityCalls=0,lastCount=0;
    const query=demo.engine.queryAudioPoseBuffer.bind(demo.engine),single=demo.engine.getPhysicsEntity.bind(demo.engine);
    demo.engine.queryAudioPoseBuffer=handles=>{queries++;const result=query(handles);lastCount=result.count;return result;};
    demo.engine.getPhysicsEntity=(...args)=>{perEntityCalls++;return single(...args);};
    const before={...counts},actor=demo.handles.actor,above=demo.handles.above;
    for(let i=0;i<20;i++)demo.audioScene.update(demo.frame.spatial);
    check(queries===20&&perEntityCalls===0&&lastCount===2,'per-entity Wasm traffic or incorrect bulk size',{queries,perEntityCalls,lastCount});
    check(JSON.stringify(before)===JSON.stringify(counts),'warm native binding allocated nodes',counts);
    check(demo.engine.setPhysicsBodyPosition(actor,10,20),'native actor move rejected');
    check(demo.engine.setPhysicsBodyHeightSpan(actor,{floorId:2,elevation:80,height:8}),'native floor change rejected');
    demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>Math.abs(listener.positionY.value-92)<1e-4);
    check(Math.abs(listener.positionX.value-10)<1e-4&&Math.abs(listener.positionY.value-92)<1e-4&&Math.abs(listener.positionZ.value+20)<1e-4,'native movement/floor not reflected');
    demo.audioScene.setEnabled(false);const mutedQuery=queries;demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>gains.slice(-2).every(g=>g.gain.value===0));
    check(queries===mutedQuery&&gains.slice(-2).every(g=>g.gain.value===0),'disabled scene not muted');
    demo.audioScene.setEnabled(true);
    check(demo.engine.setPhysicsBodyEnabled(above,false),'physics disable rejected');demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>gains[gains.length-1].gain.value>0);
    check(demo.engine.setPhysicsBodyEnabled(above,true),'physics enable rejected');
    check(demo.engine.despawnPhysicsEntity(above),'native source despawn rejected');demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>gains[gains.length-1].gain.value===0);
    check(gains[gains.length-1].gain.value===0,'stale source generation remained audible');
    const deletedSaved=demo.save(),beforeDeletedRestore=demo.frame;
    demo.restore(deletedSaved);demo.engine.start();
    await waitFor(()=>demo.frame!==beforeDeletedRestore);demo.engine.stop();
    demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>gains[gains.length-1].gain.value===0&&gains[gains.length-2].gain.value>0);
    check(!demo.handles.above,'deleted source returned in live restored handles');
    const replacement=demo.engine.spawnRigidBody({x:80,y:108,bodyType:'kinematic',collider:{type:'aabb',halfWidth:1,halfHeight:1}});
    demo.engine.setPhysicsBodyHeightSpan(replacement,{floorId:3,elevation:120,height:8});
    demo.audioScene.rebind({...demo.handles,above:replacement});demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>Math.abs(panners[1].positionY.value-140)<1e-4);
    check(Math.abs(panners[1].positionY.value-140)<1e-4&&gains[gains.length-1].gain.value>0,'rebound source generation/height');
    const oldActor=demo.handles.actor;
    const previousFrame=demo.frame;demo.restore(saved);demo.engine.start();
    await waitFor(()=>demo.frame!==previousFrame);demo.engine.stop();
    demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>Math.abs(listener.positionY.value-12)<1e-4&&Math.abs(panners[1].positionY.value-84)<1e-4);
    check(oldActor.entityId!==demo.handles.actor.entityId||oldActor.entityGeneration!==demo.handles.actor.entityGeneration,'restore reused stale handles');
    check(JSON.stringify(before)===JSON.stringify(counts),'restore allocated audio nodes');
    demo.audioScene.setListener('camera');demo.audioScene.update(demo.frame.spatial);
    await waitFor(()=>Math.abs(listener.positionX.value-demo.frame.spatial.camera[17])<1e-4);
    check(Math.abs(listener.positionX.value-demo.frame.spatial.camera[17])<1e-4&&lastCount===1,'camera listener or bulk size');
    demo.audio.setBusVolume('sfx',0);await waitFor(()=>gains[2].gain.value===0);check(gains[2].gain.value===0,'SFX bus bypassed');demo.audio.setBusVolume('sfx',1);
    const audio=demo.audio,voices=audio.state().spatialVoiceCount;
    window.nativeAudioUnlock=()=>audio.unlock();
    window.nativeAudioCleanup=async()=>{demo.destroy();demo=undefined;await waitFor(()=>contexts.every(context=>context.state==='closed'));return {closed:true};};
    return {playing:true,voices,warmNodeAllocations:0,bulkQueries:queries,perEntityCalls,staleSourceMuted:true,rebound:true,restored:true,deletedSourceRestored:true,physicsDisableKeepsAudio:true,cameraListener:true,nodes:counts};
  }catch(error){demo?.destroy();throw error;}finally{window.AudioContext=NativeContext;}
}
window.spatialAudioReady=(async()=>({offline:await offlineMatrix(),native:await nativeScene()}))();

window.spatialAudioReady.catch(error=>{window.spatialAudioFailure=String(error);});
