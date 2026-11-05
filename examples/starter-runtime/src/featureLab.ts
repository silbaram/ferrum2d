import {
  AssetLoader, createDataSceneView, createFerrumRuntime, createRenderer, resolvePhysicsSpec, VirtualControls,
  type DataSceneView, type FerrumRuntime,
} from "@ferrum2d/ferrum-web/core";
import { resolveSceneAuthoringDocument, type PostProcessStackInput } from "@ferrum2d/ferrum-web/authoring";
import catalog from "../../shared/featureCatalog.json";
import { cleanupRuntimeDemoResources, createRuntimeDemoShell } from "../../shared/runtimeDemoShell";
import "./featureLab.css";
import { createFeatureExtra, extraControls, extraHelp, shooterFeatures, type FeatureExtra, type FeatureContext } from "./featureExtras";

import { createGameplayFeature, gameplayControls, gameplayHelp } from "./featureGameplay";
import { createContentFeature, contentControls, contentHelp } from "./featureContent";

const frames = Array.from({ length: 4 }, (_, i) => ({ u0: i / 4, v0: 0, u1: (i + 1) / 4, v1: 1 }));
const effects: Record<string, PostProcessStackInput> = {
  clean: false,
  bloom: [{ kind: "bloom", threshold: .4, intensity: .8, radius: 2 }],
  crt: [{ kind: "crt", curvature: .035, scanlineIntensity: .3 }],
};
const controls: Record<string, string> = {
  ...extraControls, ...gameplayControls, ...contentControls,
  animation: `<label>재생 속도 <output data-value="fps">6 fps</output><input data-control="fps" type="range" min="1" max="16" value="6"></label>
    <label>재생 순서<select data-control="direction"><option value="forward">정방향</option><option value="reverse">역방향</option><option value="pingpong">왕복</option></select></label>
    <label class="feature-check"><input data-control="flip" type="checkbox"> 좌우 반전</label>`,
  navigation: `<div class="feature-buttons"><button data-target="128">왼쪽 목적지</button><button data-target="512">오른쪽 목적지</button></div>
    <output data-value="destination" role="status">바닥을 클릭해 목적지를 정하세요.</output>`,
  physics: `<label>재질<select data-control="material"><option value="rubber">고무 · 높은 반발</option><option value="clay">점토 · 높은 감쇠</option></select></label>
    <button data-control="launch">같은 힘으로 던지기</button>`,
  lighting: `<label>조명<select data-control="lighting"><option value="lit">점광원</option><option value="off">원본 색상</option></select></label>
    <label class="feature-check"><input data-control="normal" type="checkbox" checked> 노멀맵 적용</label>
    <div class="feature-buttons"><button data-light="160">왼쪽 광원</button><button data-light="480">오른쪽 광원</button></div>`,
  postprocess: `<label>화면 효과<select data-control="effect"><option value="clean">원본</option><option value="bloom">Bloom · 빛 번짐</option><option value="crt">CRT · 곡면 / 스캔라인</option></select></label>`,
  camera: `<label>카메라<select data-control="camera"><option value="fixed">중앙 고정</option><option value="follow">로봇 추적</option></select></label>
    <label>확대 <output data-value="zoom">100%</output><input data-control="zoom" type="range" min="100" max="250" value="100" step="5"></label>
    <div class="feature-buttons"><button data-target="128">왼쪽으로 이동</button><button data-target="512">오른쪽으로 이동</button></div>
    <output data-value="destination" role="status">확대 후 추적 모드와 비교하세요.</output>`,
  "nine-slice": `<label class="feature-check"><input data-control="sliced" type="checkbox" checked> 오른쪽 패널에 9-slice 적용</label>
    <label>테두리 배율 <output data-value="border">2×</output><input data-control="border" type="range" min="1" max="4" value="2"></label>`,
};

/** One independent native scene per topic. The browser owns controls, not simulation. */
export async function startFeatureLab(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const feature = catalog.find(item => item.id === params.get("feature")) ?? catalog[0];
  const id = feature.id;
  const shooter = shooterFeatures.has(id);
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
  const nav = document.createElement("nav");
  nav.className = "feature-topics";
  nav.setAttribute("aria-label", "엔진 기능 선택");
  for (const [index, item] of catalog.entries()) {
    const a = document.createElement("a");
    const url = new URL(location.href);
    url.search = "";
    url.searchParams.set("feature", item.id);
    if (params.get("renderer") === "webgpu") url.searchParams.set("renderer", "webgpu");
    a.href = url.href;
    a.textContent = `${String(index + 1).padStart(2, "0")} ${item.title}`;
    if (item.id === id) a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  toolbar.after(nav);
  const panel = document.createElement("aside");
  panel.className = "feature-panel";
  panel.setAttribute("aria-label", "실험 설명과 설정");
  panel.innerHTML = `<p class="feature-kicker">한 번에 한 기능</p><h2>${feature.title}</h2><p>${feature.summary}</p>
    <h3>직접 해보기</h3><p>${feature.action}</p><form class="feature-controls">${controls[id]}</form>
    <h3>관찰할 결과</h3><p>${feature.observe}</p>
    <output class="feature-observation" data-value="observation">엔진 준비 중…</output>
    <details><summary>구현 위치 · 씬 파일</summary><code>${feature.api}</code>
    <a href="./features/${id}.json" download>이 실험의 씬 JSON</a>
    <p>설정 적용 코드는 src/featureLab.ts · featureExtras.ts · featureGameplay.ts · featureContent.ts에 있습니다.</p></details>`;
  root.querySelector(".demo-metrics")!.replaceWith(panel);
  // Buttons in the settings form must never submit/reload the page.
  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) button.type = "button";
  const help = document.createElement("p");
  help.className = "feature-canvas-help";
  help.textContent = extraHelp[id] ?? gameplayHelp[id] ?? contentHelp[id] ?? (id === "nine-slice" ? "왼쪽: 단순 확대 / 오른쪽 위·아래: 서로 다른 크기의 9-slice" :
    id === "navigation" || id === "camera" ? "바닥 클릭 · 방향키 / WASD: 32 단위 이동 명령" :
    id === "lighting" ? "화면 위에서 포인터를 움직이거나 광원 위치 버튼을 사용하세요." : "설정을 바꾸며 같은 장면의 변화를 비교하세요.");
  stage.append(help);
  const stats = document.createElement("p");
  stats.className = "feature-statistics";
  // Reserve the diagnostics row before controls mount; delayed text must not shift touch targets.
  stats.textContent = "오브젝트 — · 그리기 명령 — · 드로우 콜 —";
  stage.append(stats);
  const more = document.createElement("details");
  more.className = "feature-more";
  more.innerHTML = `<summary>통합 예제도 보기</summary><a href="?mode=playground">이동·수집 통합 게임</a><a href="?mode=starter">사격 프로필·리플레이</a>`;
  panel.append(more);
  const control = <T extends HTMLElement>(key: string) => root.querySelector<T>(`[data-control="${key}"]`)!;
  const choice = (key: string) => control<HTMLSelectElement>(key).value;
  const input = (key: string) => control<HTMLInputElement>(key);
  const output = (key: string, text: string) => { root.querySelector(`[data-value="${key}"]`)!.textContent = text; };
  const lifetime = new AbortController(), { signal } = lifetime;
  const requested = params.get("renderer") === "webgpu" ? "webgpu" : "webgl2";
  control<HTMLSelectElement>("renderer").value = requested;
  let extra: FeatureExtra | undefined, shooterPaused = false;
  let runtime: FerrumRuntime | undefined, view: DataSceneView | undefined, resize: ResizeObserver | undefined;
  const playing = () => shooter ? !shooterPaused : runtime?.dataScene?.state() === "playing";
  let light = { x: 160, y: 96 }, lastUi = -Infinity, destroyed = false, ready = false, launches = 0, collisions = 0;
  let lastFrame = { entities: 0, commands: 0, drawCalls: 0, normalDrawCalls: 0, postProcessPassCount: 0, cameraX: 320, cameraY: 192, nativeState: 0 };
  let resources: (() => ReturnType<NonNullable<FerrumRuntime["renderer"]["resourceStats"]>>) | undefined;
  const cleanups: Array<() => void> = [() => shell.destroy()];
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
    output("backend", `${backend}${backend === requested ? "" : " · 호환 렌더러"}`);
    const loader = new AssetLoader(renderer);
    const virtual = id === "input" ? new VirtualControls(stage, { className: "feature-virtual-controls", joystick: { label: "캐릭터 이동" }, buttons: [] }) : undefined;
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
    if (id === "particles") textures.energy = "energy";
    if (id === "lighting") Object.assign(textures, { robotNormal: "robot-normal", ballNormal: "ball-normal" });
    await loader.loadAssets({ textures: Object.fromEntries(Object.entries(textures).map(([key, file]) => [key, new URL(`./playground/${file}.png`, document.baseURI).href])),
      textureOptions: Object.fromEntries(Object.keys(textures).map(key => [key, { colorSpace: "none" as const }])) }, undefined, { signal });
    const handles = () => runtime!.dataScene?.result.entityHandles ?? {};
    runtime = await createFerrumRuntime({ canvas, renderer, assetHost: loader, dataScene: scene, autostart: false,
      inputOptions: { pointerGestures: false, virtualControls: virtual,
        keyBindings: shooter ? { w: ["KeyW", "ArrowUp"], a: ["KeyA", "ArrowLeft"], s: ["KeyS", "ArrowDown"], d: ["KeyD", "ArrowRight"] } : undefined },
      // The Shooter controller supplies movement, but these experiments have no shooting or title/menu hotkeys.
      inputTransform: snapshot => shooter ? shell.inputTransform({ ...snapshot, space: false, enter: false, mouseLeft: false }) : extra?.input?.(snapshot) ?? snapshot,
      engine: { includeCollisionEvents: true },
      lighting: frame => id !== "lighting" || choice("lighting") === "off" || !view ? false : view.lighting({
        enabled: true, ambient: [.3, .35, .4, .55],
        pointLights: [{ ...light, radius: 420, height: 60, intensity: .8, falloff: 1.2, color: [1, .86, .65, 1] }],
      }, view.snapshot(frame)),
      postProcess: () => id === "postprocess" ? effects[choice("effect")] : extra?.postProcess?.() ?? false,
      onFrame: ({ frame: f, rendererStats: s }) => {
        lastFrame = { entities: f.entityCount, commands: s.renderCommandCount, drawCalls: s.drawCalls,
          normalDrawCalls: s.normalDrawCalls ?? 0, postProcessPassCount: s.postProcessPassCount ?? 0, cameraX: f.cameraX, cameraY: f.cameraY, nativeState: f.gameState };
        extra?.frame(f);
        // This scene has exactly one dynamic body; CCD hits are its swept wall contacts.
        if (id === "physics" && launches) collisions += f.physics.ccdHits + f.collisionEvents.filter(e => e.kind === "enter" || e.kind === "hit").length;
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
          output("observation", `속력 ${Math.hypot(ball?.velocityX ?? 0, ball?.velocityY ?? 0).toFixed(1)} · 접촉 감지 ${collisions} · 던지기 ${launches}회`);
        } else if (id === "camera") output("observation", `카메라 중심 ${f.cameraX.toFixed(0)}, ${f.cameraY.toFixed(0)} · ${input("zoom").value}%`);
        else if (id === "lighting") output("observation", `노멀 렌더링 ${lastFrame.normalDrawCalls}회 · 광원 ${light.x.toFixed(0)}, ${light.y.toFixed(0)}`);
        else if (id === "postprocess") output("observation", `후처리 패스 ${lastFrame.postProcessPassCount} · ${choice("effect")}`);
        else if (id === "nine-slice") output("observation", `오브젝트 3개 → 그리기 명령 ${lastFrame.commands}개`);
        else output("observation", "이동·충돌·애니메이션은 Rust 런타임에서 처리합니다.");
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
      view!.setZoom(Math.min(canvas.clientWidth / 640, canvas.clientHeight / 384) * scale);
      view!.setCamera({ x: 320, y: 192, ...(id === "camera" && choice("camera") === "follow" ? { follow: handles().robot } : {}), smoothTimeSeconds: .12 });
      if (id === "camera") output("zoom", `${input("zoom").value}%`);
    };
    const animation = () => {
      check(engine.configureDataSceneSpriteAnimation(handles().robot, { initialClip: 1,
        clips: [{ id: 1, frames, fps: Number(input("fps").value), loop: true, direction: choice("direction") as "forward" | "reverse" | "pingpong" }] }), "애니메이션");
      check(engine.updateDataSceneSpriteAnimations([{ entity: handles().robot, flipX: input("flip").checked }]), "반전");
      output("fps", `${input("fps").value} fps`);
    };
    const normals = () => check(engine.configureSpriteNormalMaterials(["robot", "ball"].map(key => ({ entity: handles()[key],
      ...(input("normal").checked ? { normalTextureId: engine.textureId(key + "Normal") } : {}) }))), "노멀맵");
    const material = () => {
      const rubber = choice("material") === "rubber";
      for (const key of ["ball", "north", "south", "west", "east"]) check(engine.setPhysicsBodyMaterial(handles()[key], { restitution: rubber ? .92 : .08, friction: rubber ? .02 : .6 }), "재질");
      check(engine.setPhysicsBodyTuning(handles().ball, { gravityScale: 0, linearDamping: rubber ? .08 : 2.4, angularDamping: .2 }), "감쇠");
    };
    const nineSlice = () => {
      check(engine.configureSpriteNineSlices(["sliced", "sliced_tall"].map(key => ({ entity: handles()[key], ...(input("sliced").checked ? {
        nineSlice: { sourceWidth: 24, sourceHeight: 24, left: 4, right: 4, top: 4, bottom: 4, borderScale: Number(input("border").value) },
      } : {}) }))), "9-slice");
      output("border", `${input("border").value}×`);
    };
    const configure = () => {
      if (shooter) { if (engine.gameState() === 0) shell.queueStart(); camera(); return; }
      view = createDataSceneView(engine, renderer, canvas, { x: 320, y: 192 });
      camera();
      if (id === "animation") animation();
      if (id === "lighting") normals();
      if (id === "nine-slice") nineSlice();
      if (id === "physics") {
        engine.configurePhysicsRuntime(resolvePhysicsSpec({ mode: "rigid", gravity: [0, 0], continuous: true, solver: { fixedTimestep: true, stepSeconds: 1 / 60, velocityIterations: 8, positionIterations: 6 } }));
        engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0, continuous: true, velocityIterations: 8, positionIterations: 6 });
        material();
      }
      if (id === "navigation" || id === "camera") {
        const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
        const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
        check(engine.configureDataSceneMovementAnimation({ idle, walk }), "이동 애니메이션");
      }
    };
    const context: FeatureContext = { id, root, canvas, runtime, source, signal, playing, configureView: configure,
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
    extra = createFeatureExtra(context) ?? createGameplayFeature(context) ?? createContentFeature(context);
    own(() => extra?.destroy());
    extra?.reset();
    configure();
    resize = new ResizeObserver(() => { if (!destroyed) camera(); });
    resize.observe(canvas);
    own(() => resize?.disconnect());
    const on = (key: string, event: string, fn: () => void) => control(key)?.addEventListener(event, fn, { signal });
    on("fps", "input", animation);
    on("direction", "change", animation);
    on("flip", "change", () => check(engine.updateDataSceneSpriteAnimations([{ entity: handles().robot, flipX: input("flip").checked }]), "반전"));
    on("normal", "change", normals);
    on("sliced", "change", nineSlice);
    on("border", "input", nineSlice);
    on("material", "change", material);
    on("zoom", "input", camera);
    on("camera", "change", camera);
    on("launch", "click", () => {
      if (runtime!.dataScene!.state() !== "playing") return;
      material();
      check(engine.setPhysicsBodyPosition(handles().ball, 200, 192) && engine.setPhysicsBodyVelocity(handles().ball, 0, 0) && engine.applyPhysicsBodyImpulse(handles().ball, 360, -170), "공 던지기");
      launches++;
      collisions = 0;
    });
    const move = (target: { x: number; y: number }) => {
      if (runtime!.dataScene!.state() !== "playing") { output("destination", "계속하기를 누른 뒤 이동하세요."); return; }
      const ok = engine.moveDataSceneActorTo({ ...target, speed: 128, arrivalRadius: 1, cancelOnInput: false });
      output("destination", ok ? `목적지 ${target.x.toFixed(0)}, ${target.y.toFixed(0)}로 이동합니다.` : "이동할 수 없는 목적지입니다.");
    };
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-target]")) button.addEventListener("click", () => move({ x: Number(button.dataset.target), y: 192 }), { signal });
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-light]")) button.addEventListener("click", () => { light = { x: Number(button.dataset.light), y: 96 }; }, { signal });
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
    on("pause", "click", () => {
      if (shooter) { shooterPaused = !shooterPaused; if (shooterPaused) runtime!.pause(); else runtime!.resume(); }
      else { const scene = runtime!.dataScene!; if (playing()) scene.pause(); else scene.resume(); }
      extra?.pause(!playing());
      control("pause").textContent = playing() ? "일시정지" : "계속하기";
    });
    on("reset", "click", () => {
      panel.querySelector<HTMLFormElement>("form")!.reset();
      if (scene) runtime!.dataScene!.reapply(scene);
      if (shooterPaused) { shooterPaused = false; runtime!.resume(); }
      extra?.reset();
      extra?.pause(false);
      launches = 0; collisions = 0; light = { x: 160, y: 96 };
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
      snapshot: () => ({ id, backend, ...lastFrame, state: playing() ? "playing" : "paused", launches, collisions,
        actor: handles().robot && engine.getPhysicsEntity(handles().robot), ball: handles().ball && engine.getPhysicsEntity(handles().ball),
        animation: handles().robot && engine.dataSceneSpriteAnimationState(handles().robot), resources: renderer.resourceStats?.(), ...extra?.snapshot() }),
      destroy: cleanup,
    } });
    ready = true;
    for (const element of settings) element.disabled = false;
    runtime.start();
  } catch (error) { const cancelled = signal.aborted; cleanup(); if (!cancelled) throw error; }
}
