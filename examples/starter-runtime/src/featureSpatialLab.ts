import {
  AssetLoader, createEngine, createRenderer, InputManager, loadSpatialGlb, VirtualControls,
  type FerrumEngine, type PhysicsEntityHandle, type InputSnapshot,
} from "@ferrum2d/ferrum-web/core";
import { applyDataSceneAuthoringDocument, type SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import catalog from "../../shared/featureCatalog.json";
import { cleanupRuntimeDemoResources, createRuntimeDemoShell } from "../../shared/runtimeDemoShell";
import { createFeatureNavigation } from "./featureNavigation";
import { spatialControls, spatialFeatureScene } from "./featureSpatialScenes";
import "./featureLab.css";
import { environmentEffects, spatialEnvironmentCamera, spatialEnvironmentSettings } from "./featureSpatialEnvironment";
import { shadowComparisonSettings, shadowComparisonScene } from "./featureSpatialShadows";
import { createFeatureLesson } from "./featureLesson";
import { lessonSpatialProjector } from "./featureLessonGeometry";

/** A small native spatial scene per topic; JS owns only controls and presentation. */
export async function startSpatialFeatureLab(id: string): Promise<void> {
  const feature = catalog.find(item => item.id === id)!;
  const shadowComparison=id==="hd2d-shadow-proxy";
  const shell = createRuntimeDemoShell({ title: "엔진 기능 실험실", exampleId: "starter-runtime", controls: false, metrics: [] });
  const { canvas, stage } = shell;
  const root = stage.closest<HTMLElement>(".demo-shell")!;
  root.classList.add("feature-lab");
  document.title = `${feature.title} · Ferrum2D`;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", `${feature.title} 실험 화면`);
  const toolbar = root.querySelector(".demo-toolbar")!;
  const top = document.createElement("div");
  top.className = "feature-top-actions";
  top.innerHTML = `<label>렌더러 <select data-control="renderer"><option value="webgl2">WebGL2</option><option value="webgpu">WebGPU</option></select></label>
    <span data-value="backend" role="status">준비 중…</span><button data-control="pause">일시정지</button><button data-control="reset">실험 초기화</button>`;
  toolbar.append(top);
  const navigation = createFeatureNavigation(id);
  toolbar.after(navigation.element);
  const panel = document.createElement("aside");
  panel.className = "feature-panel";
  panel.setAttribute("aria-label", "실험 설명과 설정");
  panel.innerHTML = `<p class="feature-kicker">한 번에 한 기능</p><h2>${feature.title}</h2><p>${feature.summary}</p>
    <h3>직접 해보기</h3><p>${feature.action}</p><form class="feature-controls">${spatialControls[id]}</form>
    <h3>관찰할 결과</h3><p>${feature.observe}</p><output class="feature-observation" data-value="observation">엔진 준비 중…</output>
    <details><summary>구현 위치 · 씬 파일</summary><code>${feature.api}</code><a data-control="download" download="${id}.json">이 실험의 설정 JSON</a>
    <p>src/featureSpatialLab.ts · featureSpatialScenes.ts</p></details>`;
  root.querySelector(".demo-metrics")!.replaceWith(panel);
  const help = document.createElement("p"); help.className = "feature-canvas-help";
  help.textContent = shadowComparison ? "그림자 원본을 바꾸고 카메라만 돌려 같은 지면의 그림자를 비교하세요." : id === "hd2d-environment" ? "광원과 그림자·안개 설정을 바꿔 같은 장면을 비교하세요." : id === "attachments" ? "부모 위치·회전을 바꾼 뒤 연결을 해제하고 다시 비교하세요." : "WASD / 방향키 · 아래 조이스틱으로 이동";
  const statistics = document.createElement("p"); statistics.className = "feature-statistics";
  statistics.textContent = "오브젝트 — · 공간 그리기 —";
  stage.append(help, statistics);
  for (const button of root.querySelectorAll("button")) button.type = "button";
  const control = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const output = (name: string, value: string) => { root.querySelector(`[data-value="${name}"]`)!.textContent = value; };
  const lifetime = new AbortController(), { signal } = lifetime;
  const lesson = createFeatureLesson(root, canvas, id, feature.lesson);
  const cleanups: Array<() => void> = [() => shell.destroy(), () => navigation.destroy(), () => lesson.destroy()];
  let destroyed = false, ready = false, failed: string | undefined, downloadUrl: string | undefined;
  let engine: FerrumEngine | undefined;
  let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
  let project: ReturnType<typeof lessonSpatialProjector> | undefined;
  const own = (dispose: () => void) => { if (destroyed) dispose(); else cleanups.push(dispose); };
  const cleanup = () => {
    if (!destroyed) {
      destroyed = true; lifetime.abort(); engine?.stop();
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      cleanupRuntimeDemoResources(cleanups);
    }
    return renderer?.resourceStats?.();
  };
  window.addEventListener("pagehide", event => {
    if (event.persisted) {
      const restore = (shown: PageTransitionEvent) => {
        if (!shown.persisted) return;
        window.removeEventListener("pageshow", restore); location.reload();
      };
      window.addEventListener("pageshow", restore);
    }
    cleanup();
  }, { signal });
  const settings = [...root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input,select,button")];
  settings.forEach(element => { element.disabled = true; });
  const requested = new URLSearchParams(location.search).get("renderer") === "webgpu" ? "webgpu" : "webgl2";
  control<HTMLSelectElement>("renderer").value = requested;
  try {
    const r = await createRenderer(canvas, { preferred: requested,
      webgl2: { preserveDrawingBuffer: true, clearColor: [0.043, 0.063, 0.086, 1] },
      webgpu: { clearColor: [0.043, 0.063, 0.086, 1] } });
    renderer = r; own(() => r.destroy()); if (destroyed) return;
    const backend = "gpuDevice" in r ? "webgpu" : "webgl2";
    output("backend", `${backend}${backend === requested ? "" : " · 호환 렌더러"}`);
    const loader = new AssetLoader(r);
    const response = await fetch(new URL(`./features/${id}.json`, document.baseURI), { signal });
    if (!response.ok) throw Error(`실험 씬 로드 실패: ${response.status}`);
    const source = await response.json() as SceneAuthoringDocumentSpec;
    await loader.loadAssets({ textures: Object.fromEntries(["robot", "wall", "energy"].map(name =>
      [name, new URL(`./playground/${name}.png`, document.baseURI).href])) }, undefined, { signal });
    if(shadowComparison)await loader.loadAssets({textures:{"shadow-garden":new URL("./features/spatial/shadow-garden.png",document.baseURI).href}},undefined,{signal});
    if (destroyed) return;
    const virtual = (id === "hd2d-movement" || id === "ai-combat") ? new VirtualControls(lesson.controlsHost, { className: "feature-virtual-controls", joystick: { label: "캐릭터 이동" }, buttons: [] }) : undefined;
    own(() => virtual?.destroy());
    const input = new InputManager(canvas, { pointerGestures: false, virtualControls: virtual,
      keyBindings: { w: ["KeyW", "ArrowUp"], a: ["KeyA", "ArrowLeft"], s: ["KeyS", "ArrowDown"], d: ["KeyD", "ArrowRight"] } });
    own(() => input.destroy());
    let handles: Readonly<Record<string, PhysicsEntityHandle>> = {};
    let physicalNames: string[] = [];
    let scene = source, mode = id === "ai-combat" ? "chase" : "ramp", linked = true;
    let frame = { nativeState: 0, entities: 0, commands: 0, drawCalls: 0, models: 0, visibleModels:0, billboards: 0, time: 0, shadowPasses: 0, shadowCacheHit: false, effectPasses: 0, renderedFrames: 0 };
    let lastUi = -Infinity, needsRender = true;
    let shadowSettings=shadowComparison?shadowComparisonSettings(root):undefined;
    const neutral: InputSnapshot = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    const e: FerrumEngine = await createEngine(state => {
      if (!ready || destroyed || failed) return;
      // This lighting comparison has no moving simulation. Submit only changed frames,
      // so software GPUs do not accumulate identical full-screen shadow work.
      if (id === "hd2d-environment" && !needsRender) return;
      if(shadowComparison&&!needsRender&&(!shadowSettings?.animate||state.gameState!==1))return;
      needsRender = false;
      try {
        r.render(); const stats = r.renderCommands(state.renderCommandBuffer); r.renderPostProcess();
        frame = { renderedFrames: frame.renderedFrames + 1, nativeState: state.gameState, entities: state.entityCount,
          commands: stats.renderCommandCount + (stats.spatial?.billboardCount ?? 0) + (stats.spatial?.modelCount ?? 0),
          drawCalls: stats.drawCalls, models: stats.spatial?.modelCount ?? 0, visibleModels:stats.spatial?.visibleModelCount??0, billboards: stats.spatial?.billboardCount ?? 0, time: state.timeSeconds, shadowPasses: stats.spatial?.shadowPassCount ?? 0, shadowCacheHit: stats.spatial?.shadowCacheHit ?? false, effectPasses: stats.spatial?.effectDrawCalls ?? 0 };
        if (id === "hd2d-environment" || (shadowComparison&&!shadowSettings?.animate) || performance.now() - lastUi > 200) {
          // Copy the displayed camera before native diagnostics can grow memory.
          if (state.renderCommandBuffer.spatial) project = lessonSpatialProjector(canvas, state.renderCommandBuffer.spatial);
          lastUi = performance.now(); updateObservation();
        }
      } catch (error) {
        failed = String(error); e.stop(); input.setEnabled(false);
        output("observation", `렌더링 오류: ${failed}`);
      }
    }, () => e?.dataSceneState() === "playing" && id !== "attachments" && !shadowComparison ? { ...input.snapshot(), space: false, enter: false, mouseLeft: false } : neutral,
    undefined, () => r.viewportSize());
    engine = e; own(() => e.destroy()); if (destroyed) return;
    const models: Awaited<ReturnType<typeof loadSpatialGlb>>[] = [];
    for (const name of new Set(Object.values(source.spatial?.models ?? {}).map(model => model.asset))) {
      const asset = await loadSpatialGlb(new URL(`./features/spatial/${name}.glb`, document.baseURI).href, { materialProfile: "diffuse", signal });
      if (destroyed) return;
      if (!e.registerDataSceneSpatialModel(name, asset)) throw Error(`모델 등록 실패: ${name}`);
      models.push(asset);
    }
    if (models.length && "preloadSpatialModels" in r) await r.preloadSpatialModels(models);
    if (destroyed) return;
    const poses = () => {
      const names = physicalNames;
      // Body snapshots omit spatial height. The public pose packet supplies floor/elevation
      // and liveness in bulk. Copy before another Wasm call; normal combat despawns are valid.
      const packet = e.queryAudioPoseBuffer(new Uint32Array(names.flatMap(name => [handles[name]!.entityId, handles[name]!.entityGeneration])));
      const live = names.flatMap((name, index) => {
        const offset = index * packet.stride;
        return packet.words[offset] ? [{ name, heightSpan: { floorId: packet.words[offset + 3]!, elevation: packet.floats[offset + 6]! } }] : [];
      });
      const states = e.capturePhysicsBodyStateBuffer(live.map(({ name }) => handles[name]!)).states;
      return Object.fromEntries(live.map(({ name, heightSpan }, index) => [name, { ...states[index]!, heightSpan }]));
    };
    const snapshot = () => {
      const current = poses(), emitter = current.emitter;
      return { id, backend, ...frame, entities: e.entityCount(),
      ...(shadowComparison?{shadowComparison:{...shadowSettings,camera:structuredClone(scene.spatial!.camera),animation:e.dataSceneSpriteAnimationState(handles.actor!)}}:{}),
      state: e.dataSceneState(), mode, linked, ...(id === "hd2d-environment" ? { environment: spatialEnvironmentSettings(root), camera: structuredClone(scene.spatial!.camera),
        emissiveSample: emitter && project?.({ x: emitter.x, y: emitter.y, elevation: emitter.heightSpan.elevation + 20 }) } : {}), poses: current, input: input.snapshot(),
      health: handles.actor ? e.gameplayEntityDiagnostics(handles.actor)?.health ?? 0 : undefined,
      combat: e.dataSceneCombatStats(), platforms: e.dataSceneMovingPlatformStats(), failed, resources: r.resourceStats?.() };
    };
    function updateObservation() {
      const s = snapshot(), actor = s.poses.actor, cart = s.poses.cart;
      const shadowFrame=shadowSettings?.animate?s.shadowComparison?.animation?.frame:shadowSettings?.frame;
      output("observation", shadowComparison?`${shadowSettings?.mode==="proxy"?"부피 그림자":shadowSettings?.mode==="billboard"?"표시 평면 그림자":"그림자 OFF"} · 고도 ${shadowSettings?.elevation}° · 캐릭터 높이 ${shadowSettings?.height} · 프레임 ${shadowFrame??0} · 표시 모델 ${s.visibleModels}/${s.models}`:id === "hd2d-environment" ? `${s.environment?.mode === "point" ? "점광원" : s.environment?.mode === "sun" ? "태양광" : "점광원 + 태양광"} · 방위 ${s.environment?.azimuth}° / 고도 ${s.environment?.elevation}° · 그림자 새로 그리기 ${s.shadowPasses}${s.shadowCacheHit ? " (캐시 재사용)" : ""} · 효과 ${s.environment?.effect}` : id === "attachments" ? `연결 ${linked ? "켬" : "끔"} · 부모 X ${cart?.x.toFixed(0)} · 회전 ${((cart?.rotationRadians ?? 0) * 180 / Math.PI).toFixed(0)}° · 상자 높이 ${s.poses.box?.heightSpan?.elevation.toFixed(0)}` :
        id === "ai-combat" ? `${s.health === 0 ? "전투 종료 · 초기화로 다시 시작 · " : ""}체력 ${s.health ?? 0} · 발사 ${s.combat?.spawned ?? 0} · 적중 ${s.combat?.hits ?? 0} · 적 X ${s.poses.enemy?.x.toFixed(0)}` :
          `${actor?.heightSpan?.floorId ?? 0}층 · 높이 ${(actor?.heightSpan?.elevation ?? 0).toFixed(1)} · X ${actor?.x.toFixed(1)} / Y ${actor?.y.toFixed(1)} · 탑승 ${s.platforms.carriedBodies}`);
      statistics.textContent = `오브젝트 ${s.entities} · 공간 모델 ${s.models} · 빌보드 ${s.billboards} · 드로우 콜 ${s.drawCalls}`;
      lesson.update({ observation: root.querySelector('[data-value="observation"]')!.textContent ?? feature.observe, state: s, input: s.input, project,
        poses: Object.fromEntries(Object.entries(s.poses).map(([name, pose]) => [name, { x: pose.x, y: pose.y, elevation: pose.heightSpan.elevation }])) });
    }
    const download = () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      // These two static experiments author poses through controls. Export those
      // poses too, including children whose world pose is retained after detaching.
      const current = id === "attachments" || id === "hd2d-environment" ? poses() : {};
      const lab = scene.sceneComposition.fragments!.lab!;
      const document = { ...scene, sceneComposition: { ...scene.sceneComposition,
        fragments: { ...scene.sceneComposition.fragments, lab: { ...lab,
          instances: lab.instances!.map(instance => {
            const pose = instance.id ? current[instance.id] : undefined;
            return pose ? { ...instance, x: pose.x, y: pose.y, rotationRadians: pose.rotationRadians } : instance;
          }),
        } },
      } };
      downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }));
      control<HTMLAnchorElement>("download").href = downloadUrl;
    };
    const resize = () => {
      if (destroyed) return;
      needsRender = true;
      lastUi = -Infinity;
      r.resize(); const size = r.viewportSize(); e.setViewportSize(size.width, size.height);
      if (scene.spatial) {
        const camera = id === "hd2d-environment"||shadowComparison ? spatialEnvironmentCamera(root, source.spatial!.camera, size)
          : { ...scene.spatial.camera, height: Math.max(250, 360 * size.height / Math.max(1, size.width)) };
        if (!e.setDataSceneSpatialCamera(camera, size)) throw Error("공간 카메라 설정을 적용하지 못했습니다.");
        scene = { ...scene, spatial: { ...scene.spatial, camera } };
      }
      download();
    };
    const updateEnvironment = () => {
      needsRender = true;
      const settings = spatialEnvironmentSettings(root);
      if (!e.setDataSceneSpatialEnvironment(settings.environment) || !e.setPhysicsBodyPosition(handles.light!, settings.lightX, -60)) throw Error("공간 조명 설정을 적용하지 못했습니다.");
      scene = { ...scene, spatial: { ...scene.spatial!, environment: settings.environment } };
      output("light-x", String(settings.lightX));
      output("sun-azimuth", `${settings.azimuth}°`); output("sun-elevation", `${settings.elevation}°`);
      output("camera-angle", `${control<HTMLInputElement>("camera-angle").value}°`);
      output("camera-pan", control<HTMLInputElement>("camera-pan").value);
      for (const key of ["sun-azimuth", "sun-elevation"]) control<HTMLInputElement>(key).disabled = settings.mode === "point";
      control<HTMLInputElement>("light-x").disabled = settings.mode === "sun";
      control<HTMLInputElement>("environment-shadows").disabled = !settings.lighting;
      resize();
    };
    const apply = (reset=true) => {
      const paused=shadowComparison&&!reset&&ready&&e.dataSceneState()==="paused";
      if(shadowComparison){if(reset)root.querySelector<HTMLFormElement>("form")!.reset();shadowSettings=shadowComparisonSettings(root);}
      scene = shadowComparison?shadowComparisonScene(source,shadowSettings!):spatialFeatureScene(source, id, mode);
      handles = applyDataSceneAuthoringDocument(e, scene, { textureId: name => loader.textureId(name), spatialModelPreparer: r }).entityHandles;
      // Cold setup: shadow-only composition entities intentionally have no physics body.
      // Keep per-entity existence checks out of the observation/frame loop.
      physicalNames=Object.keys(handles).filter(name=>!!e.getPhysicsEntity(handles[name]!));
      needsRender=true;
      input.clear(); input.setEnabled(true); linked = true;
      if(paused){e.pauseDataScene();input.setEnabled(false);}
      if (id === "hd2d-environment") {
        root.querySelector<HTMLFormElement>("form")!.reset(); updateEnvironment();
      }
      control("pause").textContent = paused?"계속하기":"일시정지";
      if(shadowComparison){output("camera-angle",`${control<HTMLInputElement>("camera-angle").value}°`);output("shadow-elevation",`${shadowSettings!.elevation}°`);control<HTMLInputElement>("actor-frame").disabled=shadowSettings!.animate;}
      if (id === "attachments") {
        control<HTMLInputElement>("attached").checked = true;
        control<HTMLInputElement>("position").value = control<HTMLInputElement>("rotation").value = "0";
      }
      if (id === "hd2d-movement") for (const key of ["go", "back"]) control<HTMLButtonElement>(key).disabled = mode !== "ramp";
      resize(); download(); updateObservation();
      failed = undefined;
      if (ready) e.start();
    };
    const on = (name: string, event: string, callback: () => void) => control(name).addEventListener(event, callback, { signal });
    on("pause", "click", () => {
      needsRender=true;
      if (e.dataSceneState() === "playing") { e.pauseDataScene(); input.setEnabled(false); }
      else { e.resumeDataScene(); input.setEnabled(true); }
      control("pause").textContent = e.dataSceneState() === "playing" ? "일시정지" : "계속하기";
    });
    on("reset", "click", ()=>apply());
    on("renderer", "change", () => { const url = new URL(location.href); url.searchParams.set("renderer", control<HTMLSelectElement>("renderer").value); location.assign(url); });
    if (id === "hd2d-movement" || id === "ai-combat") on("mode", "change", () => { mode = control<HTMLSelectElement>("mode").value; apply(); });
    if (id === "hd2d-movement") for (const [key, y, floorId] of [["go", 64, 1], ["back", -64, 0]] as const) on(key, "click", () => {
      if (!e.moveDataSceneSpatialActorTo({ x: 0, y, floorId, speed: 72 })) output("observation", "이동 경로를 찾지 못했습니다. 초기화 후 다시 시도하세요.");
    });
    if (id === "attachments") {
      on("position", "input", () => { e.setPhysicsBodyPosition(handles.cart!, Number(control<HTMLInputElement>("position").value), 0); download(); });
      on("rotation", "input", () => { e.setPhysicsBodyRotation(handles.cart!, Number(control<HTMLInputElement>("rotation").value) * Math.PI / 180); download(); });
      on("attached", "change", () => {
        const next = control<HTMLInputElement>("attached").checked;
        const spatial = { ...scene.spatial!, attachments: next ? source.spatial!.attachments : {} };
        if (!e.configureDataSceneSpatial(spatial, handles)) { control<HTMLInputElement>("attached").checked = linked; return; }
        linked = next; scene = { ...scene, spatial }; resize(); download();
      });
    }
    if (id === "hd2d-environment") {
      for (const key of ["light-x", "sun-azimuth", "sun-elevation", "camera-angle", "camera-pan"]) on(key, "input", updateEnvironment);
      for (const key of ["light-mode", "shadow-filter", "environment-lighting", "environment-shadows", "environment-fog", ...environmentEffects.map(effect => `environment-${effect}`)]) on(key, "change", updateEnvironment);
    }
    if(shadowComparison){
      for(const key of ["actor-x","actor-height","actor-yaw","actor-frame","shadow-elevation"])on(key,"input",()=>apply(false));
      for(const key of ["shadow-mode","proxy-visible","actor-animate"])on(key,"change",()=>apply(false));
      for(const key of ["camera-angle","camera-pan"])on(key,"input",()=>{needsRender=true;resize();output("camera-angle",`${control<HTMLInputElement>("camera-angle").value}°`);});
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); own(() => observer.disconnect());
    settings.forEach(element => { element.disabled = false; });
    apply(); ready = true; e.start();
    const hooks = { snapshot, destroy: cleanup, ...(shadowComparison?{
      projectGround:(points:readonly {x:number;y:number}[])=>points.map(point=>project?.(point)),
      shadowModels:()=>Object.fromEntries(["actor_shadow","tree_shadow"].map(id=>{const model=e.dataSceneSpatialModelDrawSnapshot(handles[id]!);return [id,model?{transform:Array.from(model.transform),cameraVisible:model.cameraVisible,hasPhysicsBody:!!e.getPhysicsEntity(handles[id]!)}:undefined];})),
    }:{}) };
    Object.assign(window, { ferrumFeatureLab: hooks });
    own(() => {
      const target = window as Window & { ferrumFeatureLab?: typeof hooks };
      if (target.ferrumFeatureLab === hooks) delete target.ferrumFeatureLab;
    });
  } catch (error) { const cancelled = signal.aborted; cleanup(); if (!cancelled) throw error; }
}
