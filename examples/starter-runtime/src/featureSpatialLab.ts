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
import { spatialEnvironmentSettings } from "./featureSpatialEnvironment";

/** A small native spatial scene per topic; JS owns only controls and presentation. */
export async function startSpatialFeatureLab(id: string): Promise<void> {
  const feature = catalog.find(item => item.id === id)!;
  const shell = createRuntimeDemoShell({ title: "Ferrum2D · 엔진 기능 실험실", controls: false, metrics: [] });
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
  help.textContent = id === "hd2d-environment" ? "광원과 그림자·안개 설정을 바꿔 같은 장면을 비교하세요." : id === "attachments" ? "부모 위치·회전을 바꾼 뒤 연결을 해제하고 다시 비교하세요." : "WASD / 방향키 · 아래 조이스틱으로 이동";
  const statistics = document.createElement("p"); statistics.className = "feature-statistics";
  statistics.textContent = "오브젝트 — · 공간 그리기 —";
  stage.append(help, statistics);
  for (const button of root.querySelectorAll("button")) button.type = "button";
  const control = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const output = (name: string, value: string) => { root.querySelector(`[data-value="${name}"]`)!.textContent = value; };
  const lifetime = new AbortController(), { signal } = lifetime;
  const cleanups: Array<() => void> = [() => shell.destroy(), () => navigation.destroy()];
  let destroyed = false, ready = false, failed: string | undefined, downloadUrl: string | undefined;
  let engine: FerrumEngine | undefined;
  let renderer: Awaited<ReturnType<typeof createRenderer>> | undefined;
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
    if (destroyed) return;
    const virtual = (id === "hd2d-movement" || id === "ai-combat") ? new VirtualControls(stage, { className: "feature-virtual-controls", joystick: { label: "캐릭터 이동" }, buttons: [] }) : undefined;
    own(() => virtual?.destroy());
    const input = new InputManager(canvas, { pointerGestures: false, virtualControls: virtual,
      keyBindings: { w: ["KeyW", "ArrowUp"], a: ["KeyA", "ArrowLeft"], s: ["KeyS", "ArrowDown"], d: ["KeyD", "ArrowRight"] } });
    own(() => input.destroy());
    let handles: Readonly<Record<string, PhysicsEntityHandle>> = {};
    let scene = source, mode = id === "ai-combat" ? "chase" : "ramp", linked = true;
    let frame = { nativeState: 0, entities: 0, commands: 0, drawCalls: 0, models: 0, billboards: 0, time: 0, shadowPasses: 0, effectPasses: 0, renderedFrames: 0 };
    let lastUi = -Infinity, needsRender = true;
    const neutral: InputSnapshot = { w: false, a: false, s: false, d: false, space: false, enter: false, mouseLeft: false, mouseX: 0, mouseY: 0 };
    const e: FerrumEngine = await createEngine(state => {
      if (!ready || destroyed || failed) return;
      // This lighting comparison has no moving simulation. Submit only changed frames,
      // so software GPUs do not accumulate identical full-screen shadow work.
      if (id === "hd2d-environment" && !needsRender) return;
      needsRender = false;
      try {
        r.render(); const stats = r.renderCommands(state.renderCommandBuffer); r.renderPostProcess();
        frame = { renderedFrames: frame.renderedFrames + 1, nativeState: state.gameState, entities: state.entityCount,
          commands: stats.renderCommandCount + (stats.spatial?.billboardCount ?? 0) + (stats.spatial?.modelCount ?? 0),
          drawCalls: stats.drawCalls, models: stats.spatial?.modelCount ?? 0, billboards: stats.spatial?.billboardCount ?? 0, time: state.timeSeconds, shadowPasses: stats.spatial?.shadowPassCount ?? 0, effectPasses: stats.spatial?.effectDrawCalls ?? 0 };
        if (id === "hd2d-environment" || performance.now() - lastUi > 200) { lastUi = performance.now(); updateObservation(); }
      } catch (error) {
        failed = String(error); e.stop(); input.setEnabled(false);
        output("observation", `렌더링 오류: ${failed}`);
      }
    }, () => e?.dataSceneState() === "playing" && id !== "attachments" ? { ...input.snapshot(), space: false, enter: false, mouseLeft: false } : neutral,
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
      const names = Object.keys(handles);
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
    const snapshot = () => ({ id, backend, ...frame, entities: e.entityCount(),
      state: e.dataSceneState(), mode, linked, ...(id === "hd2d-environment" ? { environment: spatialEnvironmentSettings(root) } : {}), poses: poses(), input: input.snapshot(),
      health: handles.actor ? e.gameplayEntityDiagnostics(handles.actor)?.health ?? 0 : undefined,
      combat: e.dataSceneCombatStats(), platforms: e.dataSceneMovingPlatformStats(), failed, resources: r.resourceStats?.() });
    function updateObservation() {
      const s = snapshot(), actor = s.poses.actor, cart = s.poses.cart;
      output("observation", id === "hd2d-environment" ? `광원 X ${s.environment?.lightX} · 그림자 패스 ${s.shadowPasses} · 안개 ${s.environment?.fog ? "켬" : "끔"}` : id === "attachments" ? `연결 ${linked ? "켬" : "끔"} · 부모 X ${cart?.x.toFixed(0)} · 회전 ${((cart?.rotationRadians ?? 0) * 180 / Math.PI).toFixed(0)}° · 상자 높이 ${s.poses.box?.heightSpan?.elevation.toFixed(0)}` :
        id === "ai-combat" ? `${s.health === 0 ? "전투 종료 · 초기화로 다시 시작 · " : ""}체력 ${s.health ?? 0} · 발사 ${s.combat?.spawned ?? 0} · 적중 ${s.combat?.hits ?? 0} · 적 X ${s.poses.enemy?.x.toFixed(0)}` :
          `${actor?.heightSpan?.floorId ?? 0}층 · 높이 ${(actor?.heightSpan?.elevation ?? 0).toFixed(1)} · X ${actor?.x.toFixed(1)} / Y ${actor?.y.toFixed(1)} · 탑승 ${s.platforms.carriedBodies}`);
      statistics.textContent = `오브젝트 ${s.entities} · 공간 모델 ${s.models} · 빌보드 ${s.billboards} · 드로우 콜 ${s.drawCalls}`;
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
      r.resize(); const size = r.viewportSize(); e.setViewportSize(size.width, size.height);
      if (scene.spatial) e.setDataSceneSpatialCamera({ ...scene.spatial.camera,
        height: Math.max(250, 360 * size.height / Math.max(1, size.width)) }, size);
    };
    const updateEnvironment = () => {
      needsRender = true;
      const settings = spatialEnvironmentSettings(root);
      if (!e.setDataSceneSpatialEnvironment(settings.environment) || !e.setPhysicsBodyPosition(handles.light!, settings.lightX, -60)) throw Error("공간 조명 설정을 적용하지 못했습니다.");
      scene = { ...scene, spatial: { ...scene.spatial!, environment: settings.environment } };
      output("light-x", String(settings.lightX));
      control<HTMLInputElement>("environment-shadows").disabled = !settings.lighting;
      download();
    };
    const apply = () => {
      scene = spatialFeatureScene(source, id, mode);
      handles = applyDataSceneAuthoringDocument(e, scene, { textureId: name => loader.textureId(name), spatialModelPreparer: r }).entityHandles;
      input.clear(); input.setEnabled(true); linked = true;
      if (id === "hd2d-environment") {
        root.querySelector<HTMLFormElement>("form")!.reset(); updateEnvironment();
      }
      control("pause").textContent = "일시정지";
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
      if (e.dataSceneState() === "playing") { e.pauseDataScene(); input.setEnabled(false); }
      else { e.resumeDataScene(); input.setEnabled(true); }
      control("pause").textContent = e.dataSceneState() === "playing" ? "일시정지" : "계속하기";
    });
    on("reset", "click", apply);
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
      on("light-x", "input", updateEnvironment);
      for (const key of ["environment-lighting", "environment-shadows", "environment-fog"]) on(key, "change", updateEnvironment);
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); own(() => observer.disconnect());
    settings.forEach(element => { element.disabled = false; });
    apply(); ready = true; e.start();
    const hooks = { snapshot, destroy: cleanup };
    Object.assign(window, { ferrumFeatureLab: hooks });
    own(() => {
      const target = window as Window & { ferrumFeatureLab?: typeof hooks };
      if (target.ferrumFeatureLab === hooks) delete target.ferrumFeatureLab;
    });
  } catch (error) { const cancelled = signal.aborted; cleanup(); if (!cancelled) throw error; }
}
