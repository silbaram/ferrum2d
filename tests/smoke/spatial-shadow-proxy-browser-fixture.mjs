import { createEngine, initializeFerrumWasm, createRenderer, createDataSceneSpatialView, loadSpatialGlb,
  captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
import { check, pixels, difference, png } from "/fixture.mjs";

// Copy each view rather than cloning the entire Wasm backing memory.
const owned = value => ArrayBuffer.isView(value) ? value.slice() : Array.isArray(value) ? value.map(owned)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,owned(v)])) : value;

async function probe(canvas, backend, projection) {
  await initializeFerrumWasm();
  if (backend === "webgpu") canvas.dataset.spatialGpuTarget = "true";
  const renderer = await createRenderer(canvas, { preferred: backend, fallbackBehavior: "silent", webgl2: { preserveDrawingBuffer: true } });
  check((typeof renderer.gpuDevice === "function") === (backend === "webgpu"), "proxy renderer fell back", { backend });
  const device = backend === "webgpu" ? renderer.gpuDevice() : undefined, errors = [], rows = [];
  device?.addEventListener("uncapturederror", event => errors.push(event.error.message));
  const registry = createSceneInstanceHandleRegistry(), applyOptions = { instanceHandleRegistry: registry, spatialModelPreparer: renderer };
  let engine, handles, pending, frames = 0;
  const read = () => new Promise((resolve, reject) => {
    check(!pending, "overlapping proxy capture");
    const timer = setTimeout(() => reject(Error("proxy capture timed out: " + JSON.stringify(errors))), 15000);
    pending = { resolve: row => { clearTimeout(timer); resolve(row); }, reject: error => { clearTimeout(timer); reject(error); } };
    engine.start();
  });
  try {
    const asset = await loadSpatialGlb(await (await fetch("/rock.glb")).arrayBuffer(), { materialProfile: "diffuse" });
    if (device) await renderer.preloadSpatialModels([asset]);
    const image = document.createElement("canvas"); image.width = image.height = 16;
    const ctx = image.getContext("2d"); ctx.fillStyle = "#ff4040"; ctx.fillRect(0,0,16,16);
    await renderer.loadTexture(1, image.toDataURL());
    engine = await createEngine(state => {
      if (!handles || !pending) return;
      const request = pending; pending = undefined;
      try {
        renderer.render(); const stats = renderer.renderCommands(state.renderCommandBuffer); renderer.renderPostProcess();
        check(++frames < 80 && state.rustUpdateTimeMs < 250 && !errors.length, "proxy work/error budget", { stats, errors });
        engine.stop();
        const frame = owned(state.renderCommandBuffer.spatial), model = engine.dataSceneSpatialModelDrawSnapshot(handles.proxy);
        pixels(renderer, canvas).then(data => request.resolve({ frame, model, stats: { ...stats.spatial }, data }), request.reject);
      } catch (error) { engine.stop(); request.reject(error); }
    }, undefined, undefined, () => renderer.viewportSize());
    renderer.resize(); const size = renderer.viewportSize(); engine.setViewportSize(size.width, size.height);
    check(engine.registerDataSceneSpatialModel("proxy", asset), "proxy asset registration failed");
    const view = createDataSceneSpatialView(engine, canvas);
    const camera = { projection, position: { x: 120, y: -160, elevation: projection === "perspective" ? 600 : 240 },
      target: { x: 0, y: 0, elevation: 0 }, height: Math.max(240,240*canvas.clientHeight/canvas.clientWidth), fovDegrees: 70, near: .1, far: 2000 };
    const sun = { lighting: { ambient: [.03,.03,.03], lights: [], directional: { direction: { x: -1, y: -1, elevation: 2 },
      intensity: 2, shadows: { resolution: 512, extent: 128, distance: 512, bias: .05 } } } };
    const point = { lighting: { ambient: [.03,.03,.03], lights: [{ position: { x: 80, y: -80, elevation: 100 }, radius: 400, intensity: 3 }],
      shadows: { lightIndex: 0, resolution: 512, bias: .05 } } };
    const makeDoc = (shadowOnly, castShadow, environment = sun) => ({
      format: "ferrum2d.consumer.scene-authoring", version: 1, behaviorRecipes: { entities: {} },
      sceneComposition: { initialFragment: "proxy", prefabs: { object: {} }, fragments: { proxy: { instances: [
        { id: "actor", prefab: "object", x: 0, y: 0, props: { components: {
          visual: { kind: "sprite", texture: 1, width: 20, height: 32, originX: .5, originY: 1 }, layer: "player",
          collider: { type: "aabb", halfWidth: 2, halfHeight: 2, isTrigger: false },
          body: { type: "kinematic", heightSpan: { floorId: 0, elevation: 0, height: 32 } },
        } } },
        { id: "proxy", prefab: "object", x: 0, y: 0, props: { components: {
          visual: { kind: "sprite", texture: 0, width: 1, height: 1, color: "#ffffff00" }, layer: "wall", collider: "none",
        } } },
      ] } } },
      spatial: { camera, terrain: [{ id: "ground", x: -240, y: -240, width: 480, depth: 480, elevation: 0, baseElevation: -2,
        color: [.5,.5,.5,1], castShadow: false }], billboards: { actor: { castShadow: false } }, actor: { instanceId: "actor", speed: 64 },
        models: { proxy: { asset: "proxy", contentId: asset.contentId, shadowOnly, castShadow } },
        attachments: { proxy: { parent: "actor", x: 0, y: 0, elevation: 0, yawDegrees: 0, inheritFloor: true } }, environment },
    });
    const record = (name, row) => {
      rows.push({ name, stats: row.stats, pose: Array.from(row.model.transform), cameraVisible: row.model.cameraVisible,
        image: png(row.data, canvas.width, canvas.height) }); return row;
    };
    const configure = async (name, doc) => {
      handles = applyDataSceneAuthoringDocument(engine, doc, applyOptions).entityHandles; engine.pauseDataScene();
      await read(); const warm = await read();
      check(warm.stats.modelCount === 1 && warm.stats.visibleModelCount === (doc.spatial.models.proxy.shadowOnly ? 0 : 1), "proxy visibility counters", warm.stats);
      check(warm.stats.modelUploadBytes === 0 && warm.stats.shadowCacheHit && warm.stats.shadowDrawCalls === 0 && warm.stats.shadowUploadBytes === 0,
        "proxy warm resources or shadows were rebuilt", warm.stats);
      check(!engine.getPhysicsEntity(handles.proxy), "proxy silently introduced a physics body");
      return record(name, warm);
    };
    const sample = (row, point) => {
      const p = view.project(point, row.frame); check(p?.visible, "proxy receiver outside view", { point, p });
      const x = Math.round(p.x*canvas.width/canvas.clientWidth), y = Math.round(p.y*canvas.height/canvas.clientHeight);
      return Array.from(row.data.subarray((y*canvas.width+x)*4,(y*canvas.width+x)*4+3));
    };
    const body = () => { const p = engine.getPhysicsEntity(handles.actor); return JSON.stringify({ bodyType:p.bodyType, colliderType:p.colliderType,
      colliderEnabled:p.colliderEnabled, colliderIsTrigger:p.colliderIsTrigger, heightSpan:p.heightSpan, mass:p.mass, friction:p.friction }); };
    const visible = await configure("visible-control", makeDoc(false,false)), physical = body();
    const off = await configure("shadow-only-no-cast", makeDoc(true,false));
    check(difference(visible.data,off.data,3)>50 && off.stats.modelDrawCalls===0 && !off.model.cameraVisible,
      "shadow-only model still drew visible geometry", off.stats);
    check(body()===physical, "render-only selection changed parent physics");
    const doc = makeDoc(true,true), on = await configure("sun-proxy",doc);
    const candidates = new Map();
    for(let x= -4;x<=28;x+=2)for(let y= -4;y<=28;y+=2){
      const at={x,y,elevation:0}, lit=sample(off,at), shaded=sample(on,at);
      if(Math.max(...lit)-Math.min(...lit)<=3 && lit[0]>shaded[0]+50)candidates.set(x+","+y,at);
    }
    const core=[...candidates.values()].filter(p=>[-2,0,2].every(x=>[-2,0,2].every(y=>candidates.has((p.x+x)+","+(p.y+y)))));
    check(core.length>=3, "proxy did not cast a measurable sun shadow onto the floor", { candidates:candidates.size, core:core.length });
    const orbitCamera={...camera,position:{...camera.position,y:160}};
    check(engine.setDataSceneSpatialCamera(orbitCamera,renderer.viewportSize()),"proxy camera orbit rejected");
    const orbit=record("sun-proxy-orbit",await read());
    check(orbit.stats.shadowCacheHit && orbit.stats.shadowDrawCalls===0 && orbit.stats.modelUploadBytes===0,
      "camera orbit invalidated camera-independent proxy shadows",orbit.stats);
    check(Array.from(on.model.transform).every((v,i)=>v===orbit.model.transform[i]),"camera orbit changed proxy world geometry");
    const noSunShadow=structuredClone(sun);delete noSunShadow.lighting.directional.shadows;
    check(engine.setDataSceneSpatialEnvironment(noSunShadow),"proxy no-shadow environment rejected");
    const orbitOff=record("sun-proxy-orbit-no-cast",await read());
    const common=core.filter(p=>{const c=sample(orbitOff,p);return Math.max(...c)-Math.min(...c)<=3;});
    check(common.length>=3 && common.every(p=>sample(orbitOff,p)[0]>sample(orbit,p)[0]+30),
      "camera orbit lost the proxy's world-space shadow",{core:core.length,common:common.length});
    check(engine.setDataSceneSpatialCamera(camera,renderer.viewportSize()) && engine.setDataSceneSpatialEnvironment(sun),"proxy environment restore rejected");
    check(engine.setPhysicsBodyRotation(handles.actor,Math.PI/6),"proxy parent yaw rejected");
    const rotated=record("sun-proxy-rotated",await read());
    const saved=JSON.parse(JSON.stringify(captureGameStateSnapshot(engine,{includeDataSceneState:true,includeDataSceneProgress:true,dataSceneAuthoringDocument:doc})));
    const yaw=saved.dataScene.progress.instances.find(i=>i.id==="actor").spatialPose.rotationRadians;
    check(Math.abs(yaw-Math.PI/6)<1e-6,"billboard parent yaw missing from progress",yaw);
    restoreGameStateSnapshot(engine,saved,{dataSceneAuthoringApplyOptions:applyOptions});
    handles=Object.fromEntries(registry.entries().map(e=>[e.instanceId,e.handle]));
    const restored=record("sun-proxy-restored",await read());
    check(difference(rotated.data,restored.data)===0 && !restored.model.cameraVisible,"proxy fresh restore changed pixels or visibility");
    check(engine.moveDataSceneSpatialBody(handles.actor,8,4),"proxy parent movement rejected");
    const moved=record("sun-proxy-moved",await read());
    check(Math.abs(moved.model.transform[12]-restored.model.transform[12]-8)<.001 &&
      Math.abs(moved.model.transform[14]-restored.model.transform[14]+4)<.001,"native proxy did not follow its parent",{before:Array.from(restored.model.transform),after:Array.from(moved.model.transform)});
    const pointOff=await configure("point-proxy-no-cast",makeDoc(true,false,point));
    const pointOn=await configure("point-proxy",makeDoc(true,true,point));
    check(difference(pointOff.data,pointOn.data,3)>50 && pointOn.stats.modelDrawCalls===0,"shadow-only point caster missing",pointOn.stats);
    check(!errors.length,"proxy GPU errors",errors);
    return {backend,projection,rows,core:core.length,common:common.length,restored:true,moved:true,errors};
  } finally { engine?.destroy(); renderer.destroy(); window.disposeSpatialGpuTarget?.(canvas); device?.destroy(); }
}

export async function probeSpatialShadowProxy(){
  const cases=[];
  for(const projection of ["orthographic","perspective"]){
    const backends=[];
    for(const backend of ["webgl2","webgpu"]){const canvas=document.createElement("canvas");document.body.replaceChildren(canvas);backends.push(await probe(canvas,backend,projection));}
    const comparisons=[];
    for(let i=0;i<backends[0].rows.length;i++){
      const a=backends[0].rows[i],b=backends[1].rows[i];
      const decode=async url=>{const bitmap=await createImageBitmap(await(await fetch(url)).blob(),{colorSpaceConversion:"none",premultiplyAlpha:"none"});
        try{const c=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=c.getContext("2d");ctx.drawImage(bitmap,0,0);return ctx.getImageData(0,0,c.width,c.height).data;}finally{bitmap.close();}};
      const ap=await decode(a.image),bp=await decode(b.image),changed=difference(ap,bp,3);
      check(a.name===b.name && changed<ap.length/4*.01,"proxy backend pixel parity",{projection,name:a.name,changed});
      comparisons.push({name:a.name,differentPixels:changed,pixelCount:ap.length/4});
    }
    cases.push({projection,backends,comparisons});
  }
  return cases;
}
