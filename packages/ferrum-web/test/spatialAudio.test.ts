import { test } from "node:test";
import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { AudioManager } from "../src/audioManager.js";
import { createSpatialAudioScene } from "../src/spatialAudioScene.js";
import type { SpatialAudioOptions } from "../src/spatialAudio.js";
import type { SpatialRenderBufferView } from "../src/dataSceneSpatial.js";
class Param { value = 0; setValueAtTime(v: number) { this.value = v; } }
class Node { disconnected = false; connect() {} disconnect() { this.disconnected = true; } }
class Gain extends Node { gain = new Param(); }
class Source extends Node { buffer?: AudioBuffer; playbackRate = new Param(); loop = false; started = false; stopped = false; onended: (() => void) | null = null; start() { this.started = true; } stop() { this.stopped = true; this.onended?.(); } }
class Panner extends Node {
  positionX = new Param(); positionY = new Param(); positionZ = new Param();
  orientationX = new Param(); orientationY = new Param(); orientationZ = new Param();
  distanceModel = "inverse"; panningModel = "equalpower"; refDistance = 1; maxDistance = 10000; rolloffFactor = 1;
  coneInnerAngle = 360; coneOuterAngle = 360; coneOuterGain = 0;
}
class Context {
  currentTime = 0; state = "running"; destination = new Node();
  sources: Source[] = []; gains: Gain[] = []; panners: Panner[] = []; failPanner = false;
  listener = { positionX: new Param(), positionY: new Param(), positionZ: new Param(), forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(), upX: new Param(), upY: new Param(), upZ: new Param() };
  decodeAudioData = async () => ({} as AudioBuffer);
  createBufferSource() { const v = new Source(); this.sources.push(v); return v; }
  createGain() { const v = new Gain(); this.gains.push(v); return v; }
  createPanner() { if (this.failPanner) throw new Error("panner allocation failure"); const v = new Panner(); this.panners.push(v); return v; }
  resume = async () => {}; close = async () => {};
}
async function setup(run: (audio: AudioManager, context: Context) => void | Promise<void>) {
  const w = globalThis as unknown as { window?: { AudioContext?: unknown } }, oldWindow = w.window, fetch = globalThis.fetch;
  const context = new Context(); w.window = { AudioContext: class { constructor() { return context; } } };
  globalThis.fetch = async () => new Response(new ArrayBuffer(8));
  const audio = new AudioManager();
  try { await audio.loadSound(1, "/sound.wav"); await run(audio, context); }
  finally { audio.destroy(); w.window = oldWindow; globalThis.fetch = fetch; }
}
test("spatial voices reuse nodes, route through SFX, preserve orientation and release on eviction/end", async () => {
  await setup((audio, c) => {
    const voice = audio.playSpatial(1, { x: 1, y: 2, z: 3, refDistance: 4, maxDistance: 100, distanceModel: "linear", rolloffFactor: .5,
      direction: { x: 1, y: 0, z: 0 }, coneInnerAngle: 30, coneOuterAngle: 90, coneOuterGain: .2, loop: true }, .7, 1.25)!;
    ok(voice.active && voice.spatialized); equal(audio.state().spatialVoiceCount, 1);
    const p = c.panners[0]; deepEqual([p.positionX.value,p.positionY.value,p.positionZ.value], [1,2,3]);
    deepEqual([p.refDistance,p.maxDistance,p.distanceModel,p.rolloffFactor,p.coneInnerAngle,p.coneOuterAngle,p.coneOuterGain], [4,100,"linear",.5,30,90,.2]);
    equal(c.sources[0].loop, true); equal(c.sources[0].playbackRate.value, 1.25);
    const counts = [c.sources.length,c.gains.length,c.panners.length];
    for (let i=0;i<100;i++) voice.setPose(i,64,-i,0,0,-1);
    deepEqual([c.sources.length,c.gains.length,c.panners.length], counts);
    audio.setListenerPose(10,64,-20,1,0,0); audio.setListenerPosition(12,70,-24);
    equal(c.listener.forwardX.value,1); equal(c.listener.positionY.value,70);
    throws(()=>audio.setListenerPose(0,0,0,0,1,0,0,1,0), /parallel/); equal(c.listener.positionX.value,12);
    equal(audio.evictSound(1),true); equal(voice.active,false); equal(voice.spatialized,true); voice.stop();
    equal(c.sources[0].stopped,true); equal(p.disconnected,true); equal(audio.state().spatialVoiceCount,0);
  });
  await setup((audio,c)=>{const v=audio.playSpatial(1,{x:0,y:0})!;c.sources[0].onended?.();equal(v.active,false);equal(audio.state().spatialVoiceCount,0);});
});
test("spatial input validation is atomic and node allocation failures release partial graphs", async () => {
  await setup((audio,c)=>{
    for(const edit of [{x:NaN},{y:Infinity},{z:null},{refDistance:0},{maxDistance:1},{rolloffFactor:-1},{direction:null},{direction:{x:0,y:0,z:0}},{coneInnerAngle:90,coneOuterAngle:30},{loop:"yes"},{distanceModel:"bad"}]) {
      const options={x:0,y:0,...edit} as unknown as SpatialAudioOptions;
      throws(()=>audio.playSpatial(1,options));
    }
    equal(c.sources.length,0); equal(c.gains.length,0);
    c.failPanner=true; throws(()=>audio.playSpatial(1,{x:0,y:0}),/allocation failure/);
    equal(c.sources[0].disconnected,true); equal(c.gains[c.gains.length-1].disconnected,true); equal(audio.state().spatialVoiceCount,0);
  });
});
test("spatial voice capacity, mute bus, fallback and destroy preserve bounded ownership", async () => {
  await setup((audio,c)=>{
    Object.defineProperty(c,"createPanner",{value:undefined});
    const voices=Array.from({length:64},()=>audio.playSpatial(1,{x:1,y:0,loop:true})!);
    equal(voices.every(v=>!v.spatialized),true);const count=c.sources.length;
    throws(()=>audio.playSpatial(1,{x:0,y:0}),/limit 64/);equal(c.sources.length,count);
    audio.setBusVolume("sfx",0);equal(c.gains[2].gain.value,0);
    voices[0].stop();equal(audio.state().spatialVoiceCount,63);
    audio.destroy();equal(voices.every(v=>!v.active),true);equal(c.sources.every(s=>s.stopped),true);
  });
});
test("scene binding uses one bulk query, native height/yaw, stale handles, rebind and camera listener", async () => {
  await setup((audio,c)=>{
    let generation=1, valid=true, queries=0, lastHandles:Uint32Array|undefined;
    const engine={queryAudioPoseBuffer(handles:Uint32Array){
      queries++;lastHandles=handles;
      const floats=new Float32Array(handles.length/2*8),words=new Uint32Array(floats.buffer);
      for(let i=0;i<handles.length/2;i++){words.set([Number(valid&&handles[i*2+1]===generation),handles[i*2],handles[i*2+1],2],i*8);floats.set([12,20,64,Math.PI/2],i*8+4);}
      return {count:handles.length/2,stride:8 as const,floats,words};
    }};
    throws(()=>createSpatialAudioScene(engine,audio,{listener:"camera",sources:[{id:"huge",sound:"water",position:{x:1e9,y:0,elevation:0},offset:{x:1,y:0,elevation:0}}]},
      {handles:{},soundId:()=>1}),/source.x/);
    equal(c.sources.length,0);
    const scene=createSpatialAudioScene(engine,audio,{listener:{instanceId:"actor"},sources:[
      {id:"torch",sound:"fire",instanceId:"torch",offset:{x:4,y:0,elevation:8},volume:.5},
      {id:"water",sound:"water",position:{x:40,y:80,elevation:0}},
    ]},{handles:{actor:{entityId:1,entityGeneration:1},torch:{entityId:2,entityGeneration:1}},soundId:()=>1});
    scene.update();equal(queries,1);equal(lastHandles?.length,4);equal(c.listener.positionY.value,64);
    ok(Math.abs(c.panners[0].positionX.value-12)<1e-5);equal(c.panners[0].positionY.value,72);ok(Math.abs(c.panners[0].positionZ.value+24)<1e-5);
    equal(c.panners[1].positionZ.value,-80);
    const count=c.sources.length;scene.update();equal(c.sources.length,count);equal(queries,2);
    scene.setEnabled(false);scene.update();equal(queries,2);equal(c.gains[c.gains.length-1].gain.value,0);
    scene.setEnabled(true);valid=false;scene.update();equal(c.gains[c.gains.length-1].gain.value,0);
    valid=true;generation=2;scene.rebind({actor:{entityId:1,entityGeneration:2},torch:{entityId:2,entityGeneration:2}});scene.update();equal(c.gains[c.gains.length-1].gain.value,1);
    throws(()=>scene.setListener({instanceId:"missing"}),/Missing/);scene.update();
    scene.setListener("camera");const camera=new Float32Array(28);camera.set([100,80,-120,100,0,-100],17);
    scene.update({camera} as SpatialRenderBufferView);equal(c.listener.positionX.value,100);equal(c.listener.positionY.value,80);equal(lastHandles?.length,2);
    ok(Number.isFinite(c.listener.upZ.value));scene.destroy();scene.destroy();equal(audio.state().spatialVoiceCount,0);
    throws(()=>scene.update(),/destroyed/);
  });
});

test("invalid listener input must not initialize the browser audio context", () => {
  const w = globalThis as unknown as { window?: { AudioContext?: unknown } }, previous = w.window;
  let created = 0;
  w.window = { AudioContext: class { constructor() { created++; return new Context(); } } };
  const audio = new AudioManager();
  try {
    throws(() => audio.setListenerPosition(NaN, 0, 0), /listener.x/);
    equal(created, 0);
    throws(() => audio.setListenerPose(0, 0, 0, 0, 1, 0, 0, 1, 0), /parallel/);
    equal(created, 0);
  } finally { audio.destroy(); w.window = previous; }
});

test("scene direction magnitude remains irrelevant when native yaw rotates a source", async () => {
  await setup((audio, c) => {
    const engine = { queryAudioPoseBuffer(handles: Uint32Array) {
      const floats = new Float32Array(8), words = new Uint32Array(floats.buffer);
      words.set([1, handles[0], handles[1], 0]); floats.set([0, 0, 0, Math.PI / 4], 4);
      return { count: 1, stride: 8 as const, floats, words };
    } };
    const scene = createSpatialAudioScene(engine, audio, { listener: "camera", sources: [
      { id: "torch", sound: "fire", instanceId: "torch", options: { direction: { x: 1e9, y: 0, z: 1e9 } } },
    ] }, { handles: { torch: { entityId: 1, entityGeneration: 1 } }, soundId: () => 1 });
    const camera = new Float32Array(28); camera.set([0, 10, 10, 0, 0, 0], 17);
    try {
      scene.update({ camera } as SpatialRenderBufferView);
      const p = c.panners[0];
      ok(Math.abs(p.orientationX.value - 1) < 1e-6);
      ok(Math.abs(p.orientationY.value) < 1e-6 && Math.abs(p.orientationZ.value) < 1e-6);
    } finally { scene.destroy(); }
  });
});

test("rebinding live-only restored handles keeps missing sources silent and remaining ambience active", async () => {
  await setup((audio, c) => {
    const engine = { queryAudioPoseBuffer(handles: Uint32Array) {
      const floats = new Float32Array(handles.length / 2 * 8), words = new Uint32Array(floats.buffer);
      for (let row=0;row<handles.length/2;row++) words.set([1,handles[row*2],handles[row*2+1],0],row*8);
      return { count: handles.length/2, stride: 8 as const, floats, words };
    } };
    const spec = { listener: { instanceId: "actor" }, sources: [
      { id: "torch", sound: "fire", instanceId: "torch" },
      { id: "water", sound: "water", position: { x: 0, y: 0, elevation: 0 } },
    ] };
    const scene = createSpatialAudioScene(engine, audio, spec, { handles: {
      actor: { entityId: 1, entityGeneration: 1 }, torch: { entityId: 2, entityGeneration: 1 },
    }, soundId: () => 1 });
    try {
      scene.update(); equal(c.gains[4].gain.value, 1); equal(c.gains[5].gain.value, 1);
      scene.rebind({ actor: { entityId: 3, entityGeneration: 2 } }); scene.update();
      equal(c.gains[4].gain.value, 0); equal(c.gains[5].gain.value, 1);
      scene.setListener("camera"); const camera = new Float32Array(28); camera.set([0,10,10,0,0,0],17);
      scene.update({ camera } as SpatialRenderBufferView); equal(c.gains[4].gain.value, 0); equal(c.gains[5].gain.value, 1);
      throws(() => scene.setListener({ instanceId: "typo" }), /Missing/);
      scene.rebind({ actor: { entityId: 3, entityGeneration: 2 }, torch: { entityId: 4, entityGeneration: 2 } });
      scene.update({ camera } as SpatialRenderBufferView); equal(c.gains[4].gain.value, 1);
    } finally { scene.destroy(); }
  });
});

test("restored scene initialization can explicitly defer missing entities without accepting malformed handles", async () => {
  await setup((audio, c) => {
    let calls = 0;
    const engine = { queryAudioPoseBuffer(handles: Uint32Array) {
      calls++; const floats = new Float32Array(handles.length / 2 * 8), words = new Uint32Array(floats.buffer);
      for (let row=0;row<handles.length/2;row++) words.set([1,handles[row*2],handles[row*2+1],0],row*8);
      return { count: handles.length/2, stride: 8 as const, floats, words };
    } };
    const spec = { listener: { instanceId: "actor" }, sources: [{ id: "fire", sound: "fire", instanceId: "torch" }] };
    throws(() => createSpatialAudioScene(engine,audio,spec,{handles:{},soundId:()=>1}),/Missing/);
    equal(c.sources.length,0);
    const scene = createSpatialAudioScene(engine,audio,spec,{handles:{},soundId:()=>1,allowMissingEntities:true});
    try {
      scene.update();equal(calls,0);equal(c.gains[4].gain.value,0);
      throws(()=>scene.rebind({actor:{entityId:1,entityGeneration:NaN}}),/invalid/);
      scene.update();equal(calls,0);
      scene.rebind({actor:{entityId:1,entityGeneration:2},torch:{entityId:2,entityGeneration:2}});
      scene.update();equal(calls,1);equal(c.gains[4].gain.value,1);
    } finally { scene.destroy(); }
  });
});
