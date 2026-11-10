import {
  AssetLoader, BrowserPlatformHost, createDataSceneView, createFerrumRuntime, createRenderer, decodeRenderCommands, resolvePhysicsSpec, VirtualControls,
  type DataSceneView, type FerrumRuntime, type PhysicsJointHandle,
} from "@ferrum2d/ferrum-web/core";
import { resolveSceneAuthoringDocument } from "@ferrum2d/ferrum-web/authoring";
import catalog from "../../shared/featureCatalog.json";
import { cleanupRuntimeDemoResources, createRuntimeDemoShell } from "../../shared/runtimeDemoShell";
import "./featureLab.css";
import { createFeatureExtra, extraControls, extraHelp, shooterFeatures, type FeatureExtra, type FeatureContext } from "./featureExtras";

import { createGameplayFeature, gameplayControls, gameplayHelp } from "./featureGameplay";
import { createContentFeature, contentControls, contentHelp } from "./featureContent";
import { createFeatureNavigation } from "./featureNavigation";
import { createProjectileFeature, projectileControls } from "./featureProjectiles";
import { createSystemFeature, systemControls } from "./featureSystems";
import { createTerrainFeature, terrainControls } from "./featureTerrain";
import { createAnimationFeature, animationControls } from "./featureAnimation";
import { createNineSliceFeature, nineSliceControls } from "./featureNineSlice";
import { spatialFeatureIds } from "./featureSpatialScenes";
import { createFeatureLesson } from "./featureLesson";
import { sampleLessonPoses } from "./featureLessonGeometry";
import { createDisplayFeature, displayControls, displayPostProcess, postProcessControls } from "./featureDisplay";
import { createCameraFeature } from "./featureCamera";
import { createQueryFeature, queryControls } from "./featureQueries";

const controls: Record<string, string> = {
  ...displayControls, "physics-queries": queryControls,
  ...extraControls, ...gameplayControls, ...contentControls, ...systemControls, projectiles: projectileControls,
  animation: animationControls,
  "destructible-terrain": terrainControls,
  navigation: `<div class="feature-buttons"><button data-target="128">왼쪽 목적지</button><button data-target="512">오른쪽 목적지</button></div>
    <output data-value="destination" role="status">바닥을 클릭해 목적지를 정하세요.</output>`,
  physics: `<label>재질<select data-control="material"><option value="rubber">고무 · 높은 반발</option><option value="clay">점토 · 높은 감쇠</option></select></label>
    <label>물리 갱신<select data-control="physics-rate"><option value="30">30 Hz</option><option value="60" selected>60 Hz</option><option value="120">120 Hz</option></select></label>
    <label class="feature-check"><input data-control="interpolate" type="checkbox"> 표시 보간 · 이동을 부드럽게</label>
    <label class="feature-check"><input data-control="fixed-rotation" type="checkbox"> 회전 고정</label>
    <label class="feature-check"><input data-control="impact-feedback" type="checkbox" checked> 충돌 소리·입자</label>
    <button data-control="break-joint">왼쪽 벽에 파손 관절 연결</button>
    <button data-control="launch">같은 힘으로 던지기</button>`,
  lighting: `<label>합성<select data-control="composition"><option value="legacy">기존 · 빛 더하기</option><option value="lit">표면 조명 · 원본 색 × 빛</option></select></label><label>조명<select data-control="lighting"><option value="lit">점광원</option><option value="off">원본 색상</option></select></label>
    <label class="feature-check"><input data-control="normal" type="checkbox" checked> 노멀맵 적용</label>
    <div class="feature-buttons"><button data-light="160">왼쪽 광원</button><button data-light="480">오른쪽 광원</button><button data-light="432" data-light-y="64">위쪽 광원</button><button data-light="432" data-light-y="320">아래쪽 광원</button></div>`,
  postprocess: postProcessControls,
  camera: `<label>카메라<select data-control="camera"><option value="fixed">중앙 고정</option><option value="follow">로봇 추적</option></select></label>
    <label>확대 <output data-value="zoom">100%</output><input data-control="zoom" type="range" min="100" max="250" value="100" step="5"></label>
    <div class="feature-buttons"><button data-target="128">왼쪽으로 이동</button><button data-target="512">오른쪽으로 이동</button></div>
    <button data-control="camera-shake">화면 흔들기</button>
    <label class="feature-check"><input data-control="camera-bounds" type="checkbox"> 월드 경계 안에 제한</label>
    <output data-value="destination" role="status">확대 후 추적 모드와 비교하세요.</output>`,
  "nine-slice": nineSliceControls,
};

/** One independent native scene per topic. The browser owns controls, not simulation. */
export async function startFeatureLab(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const feature = catalog.find(item => item.id === params.get("feature")) ?? catalog[0];
  const id = feature.id;
  if (spatialFeatureIds.has(id)) {
    const { startSpatialFeatureLab } = await import("./featureSpatialLab");
    return startSpatialFeatureLab(id);
  }
  const shooter = shooterFeatures.has(id);
  const shell = createRuntimeDemoShell({ title: "엔진 기능 실험실", exampleId: "starter-runtime", controls: false, metrics: [] });
  const { canvas, stage } = shell;
  const root = stage.closest<HTMLElement>(".demo-shell")!;
  root.classList.add("feature-lab");
  document.title = `${feature.title} · Ferrum2D`;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", `${feature.title} 실험 화면`);
  const toolbar = root.querySelector(".demo-toolbar")!;
  toolbar.querySelector("h1")!.textContent = feature.title;
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
  panel.innerHTML = `<h2>설정</h2><form class="feature-controls">${controls[id]}</form>
    <output class="feature-observation" data-value="observation">엔진 준비 중…</output>
    <details><summary>구현 위치 · 씬 파일</summary><code>${feature.api}</code>
    <a href="./features/${id}.json" download>이 실험의 씬 JSON</a>
    <p>설정 적용 코드는 ${id === "camera" ? "src/featureCamera.ts" : id in displayControls ? "src/featureDisplay.ts" : id === "physics-queries" ? "src/featureQueries.ts" : id === "postprocess" ? "src/featureDisplay.ts" : id === "nine-slice" ? "src/featureNineSlice.ts" : "src/featureLab.ts · featureExtras.ts · featureGameplay.ts · featureContent.ts · featureSystems.ts · featureProjectiles.ts"}에 있습니다.</p></details>`;
  root.querySelector(".demo-metrics")!.replaceWith(panel);
  // Buttons in the settings form must never submit/reload the page.
  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) button.type = "button";
  const help = document.createElement("p");
  help.className = "feature-canvas-help";
  help.textContent = (id === "animation" ? "이동과 대기: 바닥 클릭 · WASD/방향키로 목적지 지정 · 방향 전환은 좌우 반전으로 표현합니다." : undefined) ?? extraHelp[id] ?? gameplayHelp[id] ?? contentHelp[id] ?? (id === "nine-slice" ? "대화창·가방을 고른 뒤 너비를 늘려보세요. 같은 원본에서 모서리와 테두리가 어떻게 달라지는지 비교합니다." :
    id === "navigation" || id === "camera" ? "바닥 클릭 · 방향키 / WASD: 32 단위 이동 명령" :
    id === "lighting" ? "화면 위에서 포인터를 움직이거나 광원 위치 버튼을 사용하세요." : "설정을 바꾸며 같은 장면의 변화를 비교하세요.");
  stage.append(help);
  const stats = document.createElement("p");
  stats.className = "feature-statistics";
  // Reserve the diagnostics row before controls mount; delayed text must not shift touch targets.
  stats.textContent = "오브젝트 — · 그리기 명령 — · 드로우 콜 —";
  stage.append(stats);
  const control = <T extends HTMLElement>(key: string) => root.querySelector<T>(`[data-control="${key}"]`)!;
  const choice = (key: string) => control<HTMLSelectElement>(key).value;
  const input = (key: string) => control<HTMLInputElement>(key);
  const output = (key: string, text: string) => { root.querySelector(`[data-value="${key}"]`)!.textContent = text; };
  const lifetime = new AbortController(), { signal } = lifetime;
  const lesson = createFeatureLesson(root, canvas, id, feature.lesson, feature.observe);
  const requested = params.get("renderer") === "webgpu" ? "webgpu" : "webgl2";
  control<HTMLSelectElement>("renderer").value = requested;
  let extra: FeatureExtra | undefined, shooterPaused = false;
  let runtime: FerrumRuntime | undefined, view: DataSceneView | undefined, resize: ResizeObserver | undefined;
  const playing = () => shooter ? !shooterPaused : runtime?.dataScene?.state() === "playing";
  let demoJoint: PhysicsJointHandle | undefined, brokenJointCount = 0;
  let light = { x: 160, y: 96 }, lastUi = -Infinity, destroyed = false, ready = false, launches = 0, collisions = 0, impactCount = 0, lastImpulse = 0;
  let lastFrame = { entities: 0, commands: 0, drawCalls: 0, normalDrawCalls: 0, postProcessPassCount: 0, cameraX: 320, cameraY: 192, nativeState: 0 };
  let physicsSample = 0;
  let physicsPresentation: { sample: number; displayX: number; displayY: number; nativeX: number; nativeY: number; alpha: number } | undefined;
  let physicsObservation: { speed: number; launches: number; contacts: number } | undefined;
  let resources: (() => ReturnType<NonNullable<FerrumRuntime["renderer"]["resourceStats"]>>) | undefined;
  const cleanups: Array<() => void> = [() => shell.destroy(), () => navigation.destroy(), () => lesson.destroy()];
  // Async initialization may finish after navigation. Adopt late resources by disposing immediately.
  const own = (dispose: () => void) => { if (destroyed) dispose(); else cleanups.push(dispose); };
  const cleanup = () => {
    if (!destroyed) {
      destroyed = true;
      lifetime.abort();
      cleanupRuntimeDemoResources(cleanups);
    }
    return resources?.();
  };
  window.addEventListener("pagehide", event => {
    if (!event.persisted || !ready) {
      cleanup();
      // A cached page whose startup was cancelled needs a fresh bootstrap when restored.
      if (event.persisted) {
        const restore = (shown: PageTransitionEvent) => {
          if (!shown.persisted) return;
          window.removeEventListener("pageshow", restore);
          location.reload();
        };
        window.addEventListener("pageshow", restore);
      }
    }
  }, { signal });
  const settings = root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select");
  for (const element of settings) element.disabled = true;
  try {
    const renderer = await createRenderer(canvas, { preferred: requested,
      webgl2: { preserveDrawingBuffer: true, clearColor: [.043, .063, .086, 1] },
      webgpu: { clearColor: [.043, .063, .086, 1] } });
    own(() => renderer.destroy());
    resources = () => renderer.resourceStats?.();
    if (destroyed) return;
    const backend = "gpuDevice" in renderer ? "webgpu" : "webgl2";
    output("backend", backend === requested ? "" : `${backend} · 호환 렌더러`);
    const loader = id === "physics" ? new BrowserPlatformHost(renderer) : new AssetLoader(renderer);
    if (loader instanceof BrowserPlatformHost) own(() => loader.destroy());
    const virtual = id === "input" ? new VirtualControls(lesson.controlsHost, { className: "feature-virtual-controls", joystick: { label: "캐릭터 이동" }, buttons: [] }) : undefined;
    own(() => virtual?.destroy());
    // Load only the textures used by this topic, including matching normal data where needed.
    const response = await fetch(new URL(`./features/${id}.json`, document.baseURI), { signal });
    if (!response.ok) throw Error(`실험 씬을 불러오지 못했습니다: ${response.status}`);
    const source = await response.json();
    // Keep the authored input for apply/reset/save; validation resolves a separate inspection value.
    const scene = shooter ? undefined : source;
    if (scene) resolveSceneAuthoringDocument(scene, { validateBindings: true, validateComponents: true });
    const textures: Record<string, string> = {};
    if (shooter) Object.assign(textures, { robot: "robot", floor: "floor", wall: "wall", energy: "energy" });
    else for (const fragment of Object.values(source.sceneComposition.fragments) as Array<{ instances: Array<{ props: { components: { visual: { texture: string } } } }> }>) for (const instance of fragment.instances) {
      const texture: string = instance.props.components.visual.texture;
      textures[texture] = texture;
    }
    if (id === "particles" || id === "physics") textures.energy = "energy";
    if (id === "particles") Object.assign(textures, { particleSpark: "particle-spark", particleDust: "particle-dust", particleTrail: "particle-trail" });
    if (id === "lighting") Object.assign(textures, { robotNormal: "robot-normal", ballNormal: "ball-normal" });
    await loader.loadAssets({ ...(id === "physics" ? {sounds:{impact:new URL("./features/beacon.wav",document.baseURI).href}} : {}), textures: Object.fromEntries(Object.entries(textures).map(([key, file]) => [key, new URL(`./playground/${file}.png`, document.baseURI).href])),
      textureOptions: Object.fromEntries(Object.keys(textures).map(key => [key, { colorSpace: id === "lighting" && !key.endsWith("Normal") ? "srgb" as const : "none" as const, ...(id === "lighting" ? {alphaMode:"straight" as const}: {}) }])) }, undefined, { signal });
    const physicsBallTexture = id === "physics" ? loader.textureId("ball") : undefined;
    const handles = () => runtime!.dataScene?.result.entityHandles ?? {};
    runtime = await createFerrumRuntime({ canvas, renderer, assetHost: loader, dataScene: scene, autostart: false,
      inputOptions: { pointerGestures: false, virtualControls: virtual,
        keyBindings: shooter ? { w: ["KeyW", "ArrowUp"], a: ["KeyA", "ArrowLeft"], s: ["KeyS", "ArrowDown"], d: ["KeyD", "ArrowRight"] } : undefined },
      // Only the projectile experiment supplies fire input; the other Shooter fixtures use movement alone.
      inputTransform: snapshot => shooter ? shell.inputTransform(id === "projectiles" ? extra?.input?.(snapshot) ?? snapshot : { ...snapshot, space: false, enter: false, mouseLeft: false }) : extra?.input?.(snapshot) ?? snapshot,
      engine: { includeCollisionEvents: true, includeGameplayEvents: true },
      lighting: frame => id !== "lighting" || choice("lighting") === "off" || !view ? false : view.lighting({
        enabled: true, ...(choice("composition")==="lit" ? {profile:"lit" as const,ambientIrradiance:[.18,.18,.18] as const}:{ambient:[.3,.35,.4,.55] as const}),
        pointLights: [{ ...light, radius: 420, height: 60, intensity: .8, falloff: 1.2, color: [1, .86, .65, 1] }],
      }, view.snapshot(frame)),
      postProcess: () => id === "postprocess" ? displayPostProcess(root) : extra?.postProcess?.() ?? false,
      onFrame: ({ frame: f, rendererStats: s }) => {
        // Copy the displayed command before diagnostic Wasm calls can grow memory.
        // This small experiment samples at the same 5 Hz rate as its observation UI.
        const ballCommand = id === "physics" && performance.now() - lastUi >= 200
          ? decodeRenderCommands(f.renderCommandBuffer).find(command => command.textureId === physicsBallTexture) : undefined;
        lastFrame = { entities: f.entityCount, commands: s.renderCommandCount, drawCalls: s.drawCalls,
          normalDrawCalls: s.normalDrawCalls ?? 0, postProcessPassCount: s.postProcessPassCount ?? 0, cameraX: f.cameraX, cameraY: f.cameraY, nativeState: f.gameState };
        extra?.frame(f);
        // This scene has exactly one dynamic body; CCD hits are its swept wall contacts.
        if (id === "physics") brokenJointCount += runtime?.engine.drainPhysicsJointBreaks().events.length ?? 0;
        if (id === "physics" && launches) {
          collisions += f.physics.ccdHits + f.collisionEvents.filter(e => e.kind === "enter" || e.kind === "hit").length;
          const impacts = runtime?.engine.queryPhysicsContactImpacts() ?? [];
          impactCount += impacts.length;
          if (impacts.length) lastImpulse = Math.max(...impacts.map(hit => hit.normalImpulse));
        }
        if (!runtime || performance.now() - lastUi < 200) return;
        lastUi = performance.now();
        stats.textContent = `오브젝트 ${lastFrame.entities} · 그리기 명령 ${lastFrame.commands} · 드로우 콜 ${lastFrame.drawCalls}`;
        // Diagnostic sampling at 5 Hz, not an entity-by-entity simulation/frame loop.
        if (extra) output("observation", extra.observation());
        else if (id === "animation") {
          const state = runtime.engine.dataSceneSpriteAnimationState(handles().robot);
          output("observation", `현재 프레임 ${(state?.frame ?? 0) + 1} / 4 · ${input("fps").value} fps`);
        } else if (id === "physics") {
          const ball = runtime.engine.getPhysicsEntity(handles().ball);
          if (ballCommand && ball) {
            const viewport = renderer.viewportSize();
            physicsPresentation = { sample: ++physicsSample,
              displayX: ballCommand.x + ballCommand.width / 2 + f.cameraX - viewport.width / 2,
              displayY: ballCommand.y + ballCommand.height / 2 + f.cameraY - viewport.height / 2,
              nativeX: ball.x, nativeY: ball.y, alpha: f.physics.fixedAlpha };
          }
          const queries = runtime.engine.batchCastBodies([[1,0],[-1,0],[0,1],[0,-1]].map(([x,y]) => ({kind:"ray" as const,originX:ball?.x??200,originY:ball?.y??192,directionX:x!,directionY:y!,maxDistance:800,maxHits:8})));
          const d = f.physicsDiagnostics;
          physicsObservation = { speed: Math.hypot(ball?.velocityX ?? 0, ball?.velocityY ?? 0), launches, contacts: collisions };
          output("observation", `관절 파손 ${brokenJointCount} · CCD 상한 ${d?.ccdLimits.length??0} · 4방향 일괄 탐색 ${queries.reduce((n,q)=>n+q.totalHits,0)}건 · 속력 ${physicsObservation.speed.toFixed(1)} · 접촉 감지 ${collisions} · 충격 ${impactCount}회 / ${lastImpulse.toFixed(1)} · 던지기 ${launches}회`);
        } else if (id === "camera") output("observation", `카메라 중심 ${f.cameraX.toFixed(0)}, ${f.cameraY.toFixed(0)} · ${input("zoom").value}%`);
        else if (id === "lighting") output("observation", `노멀 렌더링 ${lastFrame.normalDrawCalls}회 · 광원 ${light.x.toFixed(0)}, ${light.y.toFixed(0)}`);
        else if (id === "postprocess") output("observation", `후처리 패스 ${lastFrame.postProcessPassCount} · ${choice("effect")}`);
        else output("observation", "이동·충돌·애니메이션은 Rust 런타임에서 처리합니다.");
        // Rendering and borrowed-buffer consumers are finished. Sample roles in one
        // native packet, then project the owned observations without per-entity calls.
        const markerHandles = { ...handles() };
        if (shooter && lesson.entityIds.includes("$player")) {
          const player = runtime.engine.builtInShooterPlayerHandle();
          if (player) markerHandles.$player = player;
        }
        const sampleState = { ...extra?.snapshot(), ...(id === "animation" ? { spriteAnimation: runtime.engine.dataSceneSpriteAnimationState(handles().robot) } : {}),
          ...(id === "physics" ? { physicsObservation } : {}), ...(id === "navigation" ? { navigationStatus: runtime.engine.dataSceneMoveStatus() } : {}) };
        const poses = sampleLessonPoses(runtime.engine, markerHandles, lesson.entityIds);
        const viewport = view?.snapshot(f);
        lesson.update({ observation: root.querySelector('[data-value="observation"]')!.textContent ?? feature.observe,
          state: sampleState, poses, input: runtime.input.snapshot(), viewport,
          project: point => view && viewport ? view.worldToScreen(point, viewport) : context.screenPoint(point) });
      },
    });
    const createdRuntime = runtime;
    own(() => createdRuntime.destroy());
    if (destroyed) return;
    const engine = runtime.engine;
    const check = (accepted: boolean, label: string) => { if (!accepted) throw Error(`${label} 설정을 적용하지 못했습니다.`); };
    const camera = () => {
      const scale = id === "camera" ? Number(input("zoom").value) / 100 : 1;
      if (shooter) {
        renderer.setViewportZoom?.(Math.min(canvas.clientWidth / 640, canvas.clientHeight / 384));
        const viewport = renderer.viewportSize(); engine.setViewportSize(viewport.width, viewport.height);
        return;
      }
      if (!view) return;
      const size = extra?.viewport?.() ?? { width: 640, height: 384 };
      const presentation = renderer.pixelPerfectPresentation?.();
      view.setZoom(Math.min((presentation?.sourceWidth ?? canvas.clientWidth) / size.width, (presentation?.sourceHeight ?? canvas.clientHeight) / size.height) * scale);
      view!.setCamera(extra?.camera?.() ?? { x: 320, y: 192, ...(id === "camera" && choice("camera") === "follow" ? { follow: handles().robot } : {}), ...(id === "camera" && input("camera-bounds").checked ? { bounds: { minX: 0, minY: 0, maxX: 640, maxY: 384 } } : {}), smoothTimeSeconds: .12 });
      if (id === "camera") output("zoom", `${input("zoom").value}%`);
    };
    const normals = () => check(engine.configureSpriteNormalMaterials(["robot", "ball"].map(key => ({ entity: handles()[key],
      ...(input("normal").checked ? { normalTextureId: engine.textureId(key + "Normal") } : {}) }))), "노멀맵");
    const material = () => {
      const rubber = choice("material") === "rubber";
      for (const key of ["ball", "north", "south", "west", "east"]) check(engine.setPhysicsBodyMaterial(handles()[key], { restitution: rubber ? .92 : .08, friction: rubber ? .02 : .6 }), "재질");
      engine.setParticlePreset(23,{texture:"energy",burstCount:8,lifetime:[.15,.35],speed:[20,65],startSize:[3,7],endSize:0,startColor:rubber?[.4,.8,1,1]:[.8,.5,.2,1],endColor:[1,1,1,0]});
      engine.configurePhysicsImpactFeedback(input("impact-feedback").checked?[{categoryBits:0xffffffff,minImpulse:15,cooldownSeconds:.12,soundId:loader.soundId("impact"),particlePresetId:23,volume:rubber?.12:.05}]:[]);
      check(engine.setPhysicsBodyFixedRotation(handles().ball,input("fixed-rotation").checked),"회전 고정");
      check(engine.setPhysicsBodyTuning(handles().ball, { gravityScale: 0, linearDamping: rubber ? .08 : 2.4, angularDamping: .2 }), "감쇠");
    };
    const configure = () => {
      if (shooter) { if (engine.gameState() === 0) shell.queueStart(); camera(); return; }
      view = createDataSceneView(engine, renderer, canvas, { x: 320, y: 192 });
      camera();
      if (id === "lighting") normals();
      if (id === "physics") {
        engine.configurePhysicsRuntime(resolvePhysicsSpec({ mode: "rigid", gravity: [0, 0], continuous: true, solver: { fixedTimestep: true, stepSeconds: 1 / 60, velocityIterations: 8, positionIterations: 6 } }));
        engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0, continuous: true, velocityIterations: 8, positionIterations: 6 });
        engine.configureFixedTimestep({ enabled: true, stepSeconds: 1 / Number(choice("physics-rate")), interpolate: input("interpolate").checked });
        engine.configurePhysicsContactImpacts({ minApproachSpeed: 10 });
        engine.configurePhysicsDiagnostics(true);
        demoJoint=undefined; brokenJointCount=0;
        material();
      }
      if (id === "navigation" || id === "camera") {
        const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
        const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
        check(engine.configureDataSceneMovementAnimation({ idle, walk }), "이동 애니메이션");
      }
    };
    const context: FeatureContext = { id, root, canvas, runtime, assets: loader, source, signal, playing, configureView: camera,
      screenPoint: point => {
        if (view) return view.worldToScreen(point);
        const viewport = renderer.viewportSize();
        return { x: ((point.x - lastFrame.cameraX) / viewport.width + .5) * canvas.clientWidth,
          y: ((point.y - lastFrame.cameraY) / viewport.height + .5) * canvas.clientHeight };
      },
      worldPoint: event => {
        if (view) return view.pointerToWorld({ x: event.clientX, y: event.clientY });
        const rect = canvas.getBoundingClientRect(), viewport = renderer.viewportSize();
        return { x: lastFrame.cameraX + ((event.clientX - rect.left) / rect.width - .5) * viewport.width,
          y: lastFrame.cameraY + ((event.clientY - rect.top) / rect.height - .5) * viewport.height };
      },
      reapply: document => {
        const paused = !playing();
        runtime!.dataScene!.reapply(document); configure();
        if (paused) runtime!.dataScene!.pause();
      },
    };
    extra = (id === "camera" ? createCameraFeature(context) : undefined) ?? createDisplayFeature(context) ?? (id === "physics-queries" ? createQueryFeature(context) : undefined) ?? (id === "nine-slice" ? createNineSliceFeature(context) : id === "destructible-terrain" ? createTerrainFeature(context) : id === "animation" ? createAnimationFeature(context) : id === "projectiles" ? createProjectileFeature(context) : createFeatureExtra(context) ?? createGameplayFeature(context) ?? createContentFeature(context) ?? createSystemFeature(context));
    own(() => extra?.destroy());
    for (const element of settings) element.disabled = false;
    extra?.reset();
    configure();
    resize = new ResizeObserver(() => { if (!destroyed) { camera(); lastUi = -Infinity; } });
    resize.observe(canvas);
    own(() => resize?.disconnect());
    const on = (key: string, event: string, fn: () => void) => control(key)?.addEventListener(event, fn, { signal });
    on("normal", "change", normals);
    on("material", "change", material);
    on("zoom", "input", camera);
    on("camera", "change", camera);
    on("camera-bounds", "change", camera);
    on("effect-strength", "input", () => output("effect-strength", `${input("effect-strength").value}%`));
    on("launch", "click", () => {
      if (runtime!.dataScene!.state() !== "playing") return;
      material();
      if (loader instanceof BrowserPlatformHost) void loader.unlockAudio();
      check(engine.applyPhysicsBodyAngularImpulse(handles().ball,180),"회전 충격");
      check(engine.setPhysicsBodyPosition(handles().ball, 200, 192) && engine.setPhysicsBodyVelocity(handles().ball, 0, 0) && engine.applyPhysicsBodyImpulse(handles().ball, 360, -170), "공 던지기");
      launches++;
      collisions = 0; impactCount = 0; lastImpulse = 0;
    });
    const move = (target: { x: number; y: number }) => {
      if (runtime!.dataScene!.state() !== "playing") { output("destination", "계속하기를 누른 뒤 이동하세요."); return; }
      const ok = engine.moveDataSceneActorTo({ ...target, speed: 128, arrivalRadius: 1, cancelOnInput: false });
      output("destination", ok ? `목적지 ${target.x.toFixed(0)}, ${target.y.toFixed(0)}로 이동합니다.` : "이동할 수 없는 목적지입니다.");
    };
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-target]")) button.addEventListener("click", () => move({ x: Number(button.dataset.target), y: 192 }), { signal });
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-light]")) button.addEventListener("click", () => { light = { x: Number(button.dataset.light), y: Number(button.dataset.lightY ?? 96) }; }, { signal });
    if (id === "navigation" || id === "camera") {
      canvas.addEventListener("pointerdown", event => { if (event.button !== 0) return; canvas.focus(); move(view!.pointerToWorld({ x: event.clientX, y: event.clientY })); }, { signal });
      canvas.addEventListener("keydown", event => {
        const direction: Record<string, [number, number]> = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
        const d = direction[event.code];
        if (!d) return;
        event.preventDefault();
        const actor = engine.getPhysicsEntity(handles().robot);
        if (actor) move({ x: actor.x + d[0] * 32, y: actor.y + d[1] * 32 });
      }, { signal });
    }
    if (id === "lighting") canvas.addEventListener("pointermove", event => { light = view!.pointerToWorld({ x: event.clientX, y: event.clientY }); }, { signal });
    if (id === "physics") {
      const refreshPhysicsDisplay = () => engine.configureFixedTimestep({ enabled: true, stepSeconds: 1 / Number(choice("physics-rate")), interpolate: input("interpolate").checked });
      on("fixed-rotation", "change", material);
      on("impact-feedback", "change", material);
      on("break-joint", "click", () => {
        if (!playing()) return;
        if (demoJoint) engine.clearPhysicsJoint(demoJoint);
        const a=engine.getPhysicsEntity(handles().west)!, b=engine.getPhysicsEntity(handles().ball)!;
        demoJoint=engine.spawnPhysicsJoint({type:"distance",entityA:handles().west,entityB:handles().ball,restLength:Math.hypot(a.x-b.x,a.y-b.y),stiffness:1,damping:1,breakForce:500});
      });
      on("physics-rate", "change", refreshPhysicsDisplay);
      on("interpolate", "change", refreshPhysicsDisplay);
    }
    on("pause", "click", () => {
      if (shooter) { shooterPaused = !shooterPaused; if (shooterPaused) runtime!.pause(); else runtime!.resume(); }
      else { const scene = runtime!.dataScene!; if (playing()) scene.pause(); else scene.resume(); }
      extra?.pause(!playing());
      control("pause").textContent = playing() ? "일시정지" : "계속하기";
    });
    on("reset", "click", () => {
      extra?.beforeReset?.();
      panel.querySelector<HTMLFormElement>("form")!.reset();
      if (id === "postprocess") output("effect-strength", "100%");
      if (scene) runtime!.dataScene!.reapply(scene);
      if (shooterPaused) { shooterPaused = false; runtime!.resume(); }
      extra?.reset();
      extra?.pause(false);
      launches = 0; collisions = 0; impactCount = 0; lastImpulse = 0; light = { x: 160, y: 96 };
      physicsPresentation = undefined;
      configure();
      if (extra) output("observation", extra.observation());
      control("pause").textContent = "일시정지";
      if (id === "navigation" || id === "camera") output("destination", "바닥을 클릭해 목적지를 정하세요.");
    });
    on("renderer", "change", () => {
      const url = new URL(location.href);
      url.searchParams.set("renderer", choice("renderer"));
      location.assign(url);
    });
    Object.assign(window, { ferrumFeatureLab: {
      snapshot: () => ({ id, backend, ...lastFrame, state: playing() ? "playing" : "paused", launches, collisions, impactCount, lastImpulse, brokenJointCount,
        ...(id === "physics" ? { feedback: engine.physicsImpactFeedbackStats(), particleCount: engine.particleCount(), physicsPresentation } : {}),
        actor: handles().robot && engine.getPhysicsEntity(handles().robot), ball: handles().ball && engine.getPhysicsEntity(handles().ball),
        animation: handles().robot && engine.dataSceneSpriteAnimationState(handles().robot), resources: renderer.resourceStats?.(), ...extra?.snapshot(), ...(id === "postprocess" ? { postprocess: { effect: choice("effect"), strength: Number(input("effect-strength").value) } } : {}) }),
      destroy: cleanup,
    } });
    ready = true;
    runtime.start();
  } catch (error) { const cancelled = signal.aborted; cleanup(); if (!cancelled) throw error; }
}
