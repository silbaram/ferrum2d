import { deepEqual, equal, ok, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine, captureGameStateSnapshot, restoreGameStateSnapshot, hashGameStateSnapshot, parseGameStateSnapshot, stringifyGameStateSnapshot, type FerrumEngine } from "../src/core.js";
import type { FrameState } from "../src/engineTypes.js";
import { applyDataSceneAuthoringDocument } from "../src/authoring.js";

test("real Wasm saves and clears moving platforms in exploration and combat; invalid sidecars preserve scene", async () => {
  const original = { fetch: globalThis.fetch, raf: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const pending = new Map<number, FrameRequestCallback>();
  let next = 1, time = 0;
  globalThis.fetch = (async (input, options) => String(input).startsWith("file:") ? new Response(Uint8Array.from(await readFile(new URL(String(input)))).buffer, { headers: { "Content-Type": "application/wasm" } }) : original.fetch(input, options)) as typeof fetch;
  globalThis.requestAnimationFrame = cb => { const id=next++;pending.set(id,cb);return id; };
  globalThis.cancelAnimationFrame = id => { pending.delete(id); };
  const engines: FerrumEngine[] = [];
  try {
    for (const combat of [false,true]) {
      const source = await createEngine(()=>{},undefined,undefined,()=>({width:800,height:480}));
      const frames: FrameState[] = [];
      const destination = await createEngine(frame=>{frames.push(frame);},undefined,undefined,()=>({width:800,height:480}));
      engines.push(source,destination);
      const document = {
        format:"ferrum2d.consumer.scene-authoring",version:1,
        gameplay:{primaryActor:"rider",...(combat?{combat:true}:{})},
        sceneComposition:{initialFragment:"lab",prefabs:{body:{}},fragments:{lab:{instances:[{id:"rider",prefab:"body",x:10,y:10,props:{components:{visual:{kind:"sprite",texture:0,width:4,height:8},collider:{type:"aabb",halfWidth:1,halfHeight:1,isTrigger:false},layer:"player",body:{type:"kinematic",heightSpan:{floorId:0,elevation:0,height:8}}}}}]}}},
        behaviorRecipes:{entities:{}},
        spatial:{camera:{projection:"orthographic",position:{x:20,y:-100,elevation:100},target:{x:20,y:20,elevation:0},height:100,near:.1,far:1000},terrain:[{id:"lift",x:0,y:0,width:40,depth:40,elevation:0}],billboards:{},movingPlatforms:[{surfaceId:"lift",offsetElevation:32,durationSeconds:2}]},
      };
      const handle = applyDataSceneAuthoringDocument(source,document).entityHandles.rider!;
      source.start();
      for(let i=0;i<8;i++){const callbacks=[...pending.values()];pending.clear();time+=17;for(const cb of callbacks)cb(time);}
      source.pauseDataScene();
      ok(source.getPhysicsEntity(handle)!.heightSpan!.elevation>0);
      const options={includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:document} as const;
      const saved=captureGameStateSnapshot(source,options);
      equal(saved.dataScene!.version,10);
      ok(saved.dataScene!.progress!.instances[0]!.spatialPose);
      ok(restoreGameStateSnapshot(destination,JSON.parse(JSON.stringify(saved))).dataSceneStateApplied);
      const restored=captureGameStateSnapshot(destination,options);
      equal(restored.dataScene!.progress!.instances[0]!.spatialPose!.heightSpan!.elevation,saved.dataScene!.progress!.instances[0]!.spatialPose!.heightSpan!.elevation);
      const bad=JSON.parse(JSON.stringify(saved));bad.dataScene.progress.spatial.movingPlatforms.lift=99;bad.snapshotHash=hashGameStateSnapshot(bad);
      const before=destination.entityCount();
      throws(()=>restoreGameStateSnapshot(destination,bad),/period|platform/);
      equal(destination.entityCount(),before);
      equal(captureGameStateSnapshot(destination,options).dataScene!.progress!.spatial!.movingPlatforms!.lift,restored.dataScene!.progress!.spatial!.movingPlatforms!.lift);
      const missingPhase = JSON.parse(JSON.stringify(saved));
      delete missingPhase.dataScene.progress.spatial.movingPlatforms;
      missingPhase.snapshotHash = hashGameStateSnapshot(missingPhase);
      throws(() => restoreGameStateSnapshot(destination, missingPhase), /complete platform progress/);
      deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, restored.dataScene!.progress);

      source.clearDataSceneSpatial();
      const cleared = captureGameStateSnapshot(source, options);
      equal(cleared.dataScene!.version, combat ? 9 : 6);
      equal(cleared.dataScene!.progress!.spatial!.camera, null);
      equal(cleared.dataScene!.progress!.spatial!.movingPlatforms, undefined);
      ok(cleared.dataScene!.progress!.instances.every(instance => instance.spatialPose === undefined));
      for (const phases of [{ lift: 0 }, {}, { missing: 0 }]) {
        const invalid = JSON.parse(JSON.stringify(cleared));
        invalid.dataScene.version = 10;
        invalid.dataScene.progress.spatial.movingPlatforms = phases;
        invalid.snapshotHash = hashGameStateSnapshot(invalid);
        throws(() => restoreGameStateSnapshot(destination, invalid), /Disabled spatial progress/);
        deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, restored.dataScene!.progress);
      }
      const parsed = parseGameStateSnapshot(stringifyGameStateSnapshot(cleared));
      ok(restoreGameStateSnapshot(destination, parsed).dataSceneStateApplied);
      deepEqual(captureGameStateSnapshot(destination, options).dataScene!.progress, cleared.dataScene!.progress);
      destination.start();
      // The first RAF initializes GameLoop's clock; the second emits a frame.
      for (let i = 0; i < 2; i++) {
        const callbacks = [...pending.values()];
        pending.clear();
        time += 17;
        for (const callback of callbacks) callback(time);
      }
      ok(frames.length > 0);
      equal(frames[frames.length - 1]!.renderCommandBuffer.spatial, undefined);
      source.stop();destination.stop();
    }
  } finally { for(const e of engines)e.destroy();globalThis.fetch=original.fetch;globalThis.requestAnimationFrame=original.raf;globalThis.cancelAnimationFrame=original.cancel; }
});
