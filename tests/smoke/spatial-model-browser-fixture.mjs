import { loadSpatialGlb, createEngine, captureGameStateSnapshot, restoreGameStateSnapshot } from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, createSceneInstanceHandleRegistry } from "@ferrum2d/ferrum-web/authoring";
export async function probeSpatialModel(scene, canvas) {
    const { engine, renderer, view } = scene, gl = canvas.getContext("webgl2");
    const check = (ok, message, evidence) => { if (!ok)
        throw Error(`${message}: ${JSON.stringify(evidence)}`); };
    const wait = async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); };
    const image = () => { const p = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, p); return p; };
    const difference = (a, b) => a.reduce((n, v, i) => n + Number(Math.abs(v - b[i]) > 3), 0);
    const asset = await loadSpatialGlb("/rock.glb", { materialProfile: "diffuse" });
    check(engine.registerDataSceneSpatialModel("rock", asset), "model registration failed");
    const components = (rock = false) => ({ visual: { kind: "sprite", texture: 1, width: 16, height: 32, originY: 1 },
        collider: { type: "aabb", halfWidth: rock ? 12 : 2, halfHeight: rock ? 10 : 2, offsetX: rock ? 2 : 0, offsetY: rock ? -1 : 0, isTrigger: false },
        body: { type: rock ? "static" : "kinematic", heightSpan: { floorId: 0, elevation: 0, height: rock ? 24 : 8 } }, layer: rock ? "wall" : "player" });
    const document = { format: "ferrum2d.consumer.scene-authoring", version: 1, gameplay: { primaryActor: "actor" },
        sceneComposition: { initialFragment: "model", prefabs: { blank: {} }, fragments: { model: { instances: [
                        { id: "actor", prefab: "blank", x: -48, y: 0, props: { components: components() } },
                        { id: "rock", prefab: "blank", x: 0, y: 0, props: { components: components(true) } },
                    ] } } }, behaviorRecipes: { entities: {} }, spatial: {
            camera: { projection: "orthographic", position: { x: 0, y: -160, elevation: 160 }, target: { x: 0, y: 0, elevation: 12 }, height: 180, near: .1, far: 1200 },
            terrain: [{ id: "ground", x: -200, y: -200, width: 400, depth: 400, elevation: 0, color: [.35, .4, .45, 1], castShadow: false }],
            billboards: { actor: { castShadow: false } }, models: { rock: { asset: "rock", contentId: asset.contentId } },
            actor: { instanceId: "actor", speed: 100, maxStepHeight: 8, maxDropHeight: 8 },
            environment: { lighting: { ambient: [.2, .2, .2], directional: { direction: { x: -1, y: -1, elevation: 2 }, intensity: 1, shadows: { resolution: 128, bias: .05 } },
                    lights: [{ position: { x: -30, y: -30, elevation: 60 }, radius: 200 }], shadows: { lightIndex: 0, resolution: 128, bias: .05 } } },
        } };
    // Warm the existing environment targets before isolating the model's first upload.
    const staged = structuredClone(document);
    staged.spatial.models = {};
    let handles = applyDataSceneAuthoringDocument(engine, staged).entityHandles;
    engine.pauseDataScene();
    await wait();
    const unpackParameters = [gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS, gl.UNPACK_SKIP_IMAGES];
    const previousUnpack = unpackParameters.map(p => gl.getParameter(p));
    const previousPbo = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    const callerPbo = gl.createBuffer();
    check(callerPbo, "caller PBO allocation failed");
    let unpackStateRestored = false;
    try {
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, callerPbo);
        gl.bufferData(gl.PIXEL_UNPACK_BUFFER, 4096, gl.STATIC_DRAW);
        unpackParameters.forEach((p, i) => gl.pixelStorei(p, [16, 16, 1, 1, 1][i]));
        check(engine.configureDataSceneSpatial(document.spatial, handles), "model upload configuration rejected");
        await wait();
        unpackStateRestored = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING) === callerPbo && unpackParameters.every((p, i) => gl.getParameter(p) === [16, 16, 1, 1, 1][i]);
        check(unpackStateRestored && gl.getError() === gl.NO_ERROR, "model upload damaged caller unpack state");
    }
    finally {
        gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, previousPbo);
        unpackParameters.forEach((p, i) => gl.pixelStorei(p, previousUnpack[i]));
        gl.deleteBuffer(callerPbo);
    }
    check(scene.frame.stats.spatial.modelCount === 1 && scene.frame.stats.spatial.modelTriangleCount === 8, "model did not reach existing spatial pass", scene.frame.stats.spatial);
    const warm = { ...scene.frame.stats.spatial };
    check(warm.modelUploadBytes === 0 && warm.modelDrawCalls === 1 && warm.shadowCacheHit, "static mesh/shadow resource cache failed", warm);
    const cameraHits=[];
    for(const projection of ["orthographic","perspective"]) {
        check(engine.setDataSceneSpatialCamera({...document.spatial.camera,projection,fovDegrees:45,height:220,position:{x:30,y:-180,elevation:200}},renderer.viewportSize()),"model camera rejected");
        await wait();
        const point={x:20,y:-20,elevation:0},screen=view.project(point,scene.frame.spatial),rect=canvas.getBoundingClientRect();
        const hit=view.pick({x:rect.left+screen.x,y:rect.top+screen.y},scene.frame.spatial);
        check(hit?.surfaceId==="ground"&&Math.abs(hit.x-point.x)<.02&&Math.abs(hit.y-point.y)<.02&&scene.frame.stats.spatial.visibleModelCount===1,"model camera/picking diverged",{projection,hit});
        cameraHits.push(projection);
    }
    engine.setDataSceneSpatialCamera(document.spatial.camera,renderer.viewportSize());await wait();
    const ordinary=image();
    check(engine.setDataSceneSpatialEnvironment({...document.spatial.environment,fog:{color:[0,0,1],start:0,end:1}}),"model fog rejected");await wait();
    const fogDifference=difference(ordinary,image());check(fogDifference>100&&scene.frame.stats.spatial.modelDrawCalls===1,"model fog path was bypassed");
    check(engine.setDataSceneSpatialEnvironment({...document.spatial.environment,depthOfField:{focusDistance:1,focusRange:0,aperture:32,maxBlurRadius:12}}),"model DOF rejected");await wait();
    const dofDifference=difference(ordinary,image());check(dofDifference>10&&scene.frame.stats.spatial.dofSampleBudget===13,"model DOF path was bypassed");
    check(engine.setDataSceneSpatialEnvironment(null),"model unlit path rejected");await wait();
    check(scene.frame.stats.spatial.modelTriangleCount===8&&gl.getError()===gl.NO_ERROR,"model without environment failed");
    engine.setDataSceneSpatialEnvironment(document.spatial.environment);await wait();
    await window.spatialDebugScreenshot("model-rock",canvas.toDataURL());
    const withModel = image();
    check(engine.moveDataSceneSpatialBody(handles.actor, 96, 0), "native rock sweep rejected");
    const blocked = engine.getPhysicsEntity(handles.actor);
    check(blocked.x < -9, "native AABB proxy did not block actor", blocked);
    engine.setPhysicsBodyPosition(handles.actor, 2, 8);
    await wait();
    const occluded = image(), foot = view.project({ x: 2, y: 8, elevation: 6 }, scene.frame.spatial);
    const sample = (pixels, p) => { const x = Math.round(p.x * canvas.width / canvas.clientWidth), y = canvas.height - 1 - Math.round(p.y * canvas.height / canvas.clientHeight); return [...pixels.subarray((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3)]; };
    const noModel = structuredClone(document);
    delete noModel.spatial.models;
    noModel.sceneComposition.fragments.model.instances.pop();
    handles = applyDataSceneAuthoringDocument(engine, noModel).entityHandles;
    engine.pauseDataScene();
    engine.setPhysicsBodyPosition(handles.actor, 2, 8);
    await wait();
    const withoutModel = image(), modelPixel = sample(occluded, foot), spritePixel = sample(withoutModel, foot);
    check(difference(withModel, withoutModel) > 100, "GLB made no visible pixels");
    check(spritePixel[0] > modelPixel[0] + 20, "model depth did not occlude the character", { modelPixel, spritePixel });
    handles = applyDataSceneAuthoringDocument(engine, document).entityHandles;
    engine.pauseDataScene();
    await wait();
    const lit = image();
    const noCast = structuredClone(document.spatial);
    noCast.models.rock.castShadow = false;
    check(engine.configureDataSceneSpatial(noCast, handles), "model cast flag rejected");
    await wait();
    const shadowDifference = difference(lit, image());
    check(shadowDifference > 10, "model cast no point/sun shadow", shadowDifference);
    handles = applyDataSceneAuthoringDocument(engine, document).entityHandles;
    engine.pauseDataScene();
    engine.setPhysicsBodyHeightSpan(handles.rock, { floorId: 1, elevation: 48, height: 24 });
    check(engine.moveDataSceneSpatialBody(handles.actor, 96, 0), "under-model movement failed");
    check(engine.getPhysicsEntity(handles.actor).x === 48, "height-separated model proxy blocked actor");
    await wait();
    check(scene.frame.spatial.models.values[17] === 48, "native physical height and mesh matrix diverged");
    const saved = JSON.parse(JSON.stringify(captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: document })));
    const beforeRestore = image();
    const registry = createSceneInstanceHandleRegistry();
    let freshFrame;
    const fresh = await createEngine(state => { freshFrame = state; }, undefined, undefined, () => renderer.viewportSize());
    try {
        fresh.setViewportSize(renderer.viewportSize().width, renderer.viewportSize().height);
        let rejected = false;
        try {
            restoreGameStateSnapshot(fresh, saved);
        }
        catch {
            rejected = true;
        }
        check(rejected, "fresh restore accepted missing model resource");
        check(fresh.registerDataSceneSpatialModel("rock", asset), "fresh model registration failed");
        const restored = restoreGameStateSnapshot(fresh, saved, { dataSceneAuthoringApplyOptions: { instanceHandleRegistry: registry } });
        check(restored.dataSceneStateApplied, "fresh model restore failed");
        fresh.start();
        await wait();
        renderer.render();
        const restoredStats = renderer.renderCommands(freshFrame.renderCommandBuffer);
        renderer.renderPostProcess();
        await window.spatialDebugScreenshot("model-rock-restored",canvas.toDataURL());
        const restoredRock = fresh.getPhysicsEntity(registry.get("rock"));
        check(restoredRock.heightSpan.elevation === 48 && freshFrame.renderCommandBuffer.spatial.models.values[17] === 48, "fresh model pose was not restored", restoredRock);
        check(difference(beforeRestore, image()) === 0, "fresh model restore changed pixels");
        check(restoredStats.spatial.modelCount === 1, "fresh restore lost model geometry");
    }
    finally {
        fresh.destroy();
    }
    engine.setPhysicsBodyPosition(handles.rock, 3e38, 3e38);
    let invalidCaptureRejected = false;
    try {
        captureGameStateSnapshot(engine, { includeDataSceneState: true, includeDataSceneProgress: true, dataSceneAuthoringDocument: document });
    }
    catch {
        invalidCaptureRejected = true;
    }
    finally {
        engine.setPhysicsBodyPosition(handles.rock, 0, 0);
    }
    check(invalidCaptureRejected, "capture emitted an unrestorable model pose");
    let malformed = false;
    try {
        await loadSpatialGlb(new ArrayBuffer(28), { materialProfile: "diffuse" });
    }
    catch {
        malformed = true;
    }
    const oldRock = engine.getPhysicsEntity(handles.rock);
    const badDoc = structuredClone(document);
    badDoc.spatial.models.rock.contentId = "0".repeat(64);
    let rejected = false;
    try {
        applyDataSceneAuthoringDocument(engine, badDoc);
    }
    catch {
        rejected = true;
    }
    check(malformed && rejected && engine.getPhysicsEntity(handles.rock).heightSpan.elevation === oldRock.heightSpan.elevation, "model failure damaged active scene");
    const overflow=structuredClone(document);
    overflow.sceneComposition.fragments.model.instances[1].x=3e38;
    overflow.sceneComposition.fragments.model.instances[1].y=3e38;
    let overflowRejected=false;try{applyDataSceneAuthoringDocument(engine,overflow);}catch{overflowRejected=true;}
    check(overflowRejected&&engine.gameplayEntityExists(handles.rock),"overflowing model transform destroyed current scene");
    const resources = renderer.resourceStats();
    applyDataSceneAuthoringDocument(engine, noModel);
    engine.pauseDataScene();
    await wait();
    const released = renderer.resourceStats();
    check(released.bufferCount === resources.bufferCount - 2 && released.textureCount === resources.textureCount - 1, "model GPU resources leaked", { resources, released });
    check(engine.releaseDataSceneSpatialModel("rock"), "unused model CPU resource release failed");
    check(gl.getError() === gl.NO_ERROR, "model WebGL error");
    return { contentId: asset.contentId, triangles: asset.triangleCount, blockedX: blocked.x, modelPixel, spritePixel, shadowDifference, cameraHits,fogDifference,dofDifference,overflowRejected,invalidCaptureRejected,unpackStateRestored,warm, freshRestore: true, resourceRelease: true };
}
