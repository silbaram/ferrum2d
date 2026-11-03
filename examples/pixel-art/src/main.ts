import {
  AssetLoader, createDataSceneView, createFerrumRuntime, createRenderer,
  type DataSceneView, type FerrumRuntime,
} from "@ferrum2d/ferrum-web/core";
import { resolveSceneAuthoringDocument, type PostProcessStackInput } from "@ferrum2d/ferrum-web/authoring";
import type { LightingScene2D, SpriteMaterialPresetInput } from "@ferrum2d/ferrum-web/labs";
import { diagnosticReport } from "@ferrum2d/ferrum-web/quality";
import { createRuntimeDemoShell, renderRuntimeDemoError } from "../../shared/runtimeDemoShell";
import "../../shared/runtimeDemoShell.css";
import "./styles.css";

const seeds = [{ x: 72, y: 72 }, { x: 248, y: 120 }, { x: 168, y: 40 }];
const effects: Record<string, PostProcessStackInput> = {
  clean: false,
  dusk: [{ kind: "bloom", threshold: .55, intensity: .3, radius: 1 }, { kind: "vignette", intensity: .25 }],
  pixel: [{ kind: "pixelArt", levels: 8, dither: .35, scanlineIntensity: .12 }],
  crt: [{ kind: "crt", curvature: .04, scanlineIntensity: .15 }, { kind: "vignette", intensity: .25 }],
  glitch: [{ kind: "glitch", intensity: .025, seed: 7, chromaticAberration: .002 }],
};
const colors: Record<string, string[]> = {
  mint: ["#53b89a", "#97dfb4", "#347768"],
  rose: ["#cd7088", "#f3b8ba", "#86455f"],
  sky: ["#669fc8", "#b4dded", "#3c647e"],
};

async function bootstrap(): Promise<void> {
  const shell = createRuntimeDemoShell({ title: "작은 빛의 정원", controls: false, metrics: [] });
  const { canvas, stage } = shell;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "도트 정원. 바닥을 클릭하거나 Tab으로 씨앗 찾아가기 버튼을 선택하세요.");
  const panel = document.createElement("aside");
  panel.className = "pixel-controls";
  panel.setAttribute("aria-label", "정원과 화면 설정");
  panel.innerHTML = `
    <p class="pixel-eyebrow">FERRUM2D · PIXEL ART</p>
    <h2>빛의 씨앗을 찾아요</h2>
    <p>바닥을 클릭하면 정원지기가 걸어갑니다. 연못을 돌아 씨앗 세 개를 모아 보세요.</p>
    <output class="pixel-progress" aria-live="polite">씨앗 0 / 3</output>
    <div class="pixel-seeds" aria-label="키보드로 씨앗 찾아가기">
      <button data-seed="0">서쪽 씨앗</button><button data-seed="1">동쪽 씨앗</button><button data-seed="2">북쪽 씨앗</button>
    </div>
    <fieldset><legend>화면 분위기</legend>
      <label>조명<select id="pixel-light"><option value="night">밤 · 노멀 조명</option><option value="day">낮 · 원본 색상</option></select></label>
      <p class="pixel-help">정원 위로 포인터를 움직이면 빛의 방향이 바뀝니다.</p>
      <label>캐릭터 팔레트<select id="pixel-palette"><option value="mint">민트</option><option value="rose">장미</option><option value="sky">하늘</option></select></label>
      <label>화면 효과<select id="pixel-effect"><option value="clean">원본</option><option value="dusk">은은한 빛</option><option value="pixel">디더 · 스캔라인</option><option value="crt">곡면 CRT</option><option value="glitch">글리치</option></select></label>
    </fieldset>
    <div class="pixel-actions"><button id="pixel-pause">일시정지</button><button id="pixel-reset">다시 시작</button></div>
    <details><summary>도트 제작 과정 보기</summary>
      <p>24×24 원본 → 4프레임 PNG 시트 → 핑퐁 걷기 → 노멀 조명. 정원지기 원본을 내장 도트 편집기에서 열어 수정할 수 있습니다.</p>
      <a href="./assets/keeper.pixel.json" download>편집 가능한 도트 원본</a>
      <a href="./assets/keeper.png" download>색상 PNG 시트</a>
      <a href="./assets/keeper-normal.png" download>노멀 PNG 시트</a>
      <a href="./assets/pixel-art.profile.json" download>도트 검증 프로필</a>
    </details>
    <label class="pixel-renderer-label">렌더러<select id="pixel-renderer"><option value="webgl2">WebGL2</option><option value="webgpu">WebGPU</option></select></label>
    <p class="pixel-help">렌더러를 바꾸면 정원을 다시 시작합니다.</p>
    <output class="pixel-backend" role="status">불러오는 중…</output>`;
  stage.parentElement!.querySelector(".demo-metrics")!.replaceWith(panel);
  const subtitle = document.createElement("p");
  subtitle.className = "pixel-subtitle";
  subtitle.textContent = "도트 원본에서 플레이까지 · 320 × 192 픽셀의 작은 정원";
  document.querySelector(".demo-toolbar")!.append(subtitle);
  const progress = panel.querySelector<HTMLOutputElement>(".pixel-progress")!;
  const backendStatus = panel.querySelector<HTMLOutputElement>(".pixel-backend")!;
  const lightChoice = panel.querySelector<HTMLSelectElement>("#pixel-light")!;
  const paletteChoice = panel.querySelector<HTMLSelectElement>("#pixel-palette")!;
  const effectChoice = panel.querySelector<HTMLSelectElement>("#pixel-effect")!;
  const rendererChoice = panel.querySelector<HTMLSelectElement>("#pixel-renderer")!;
  const pause = panel.querySelector<HTMLButtonElement>("#pixel-pause")!;
  const requested = new URL(location.href).searchParams.get("renderer") === "webgpu" ? "webgpu" : "webgl2";
  rendererChoice.value = requested;
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  const renderer = await createRenderer(canvas, {
    preferred: requested,
    webgl2: { preserveDrawingBuffer: true, clearColor: [.035, .055, .075, 1] },
    webgpu: { clearColor: [.035, .055, .075, 1] },
  });
  const backend = "gpuDevice" in renderer ? "webgpu" : "webgl2";
  backendStatus.textContent = `${backend === "webgpu" ? "WebGPU" : "WebGL2"}${backend !== requested ? " · 사용 가능한 렌더러로 전환" : ""} · 정수 배율`;
  const loader = new AssetLoader(renderer);
  let runtime: FerrumRuntime | undefined;
  let view: DataSceneView | undefined;
  let material: SpriteMaterialPresetInput = false;
  let lastSeeds = -1;
  let lastFrame: { state: number; entities: number; commands: number; drawCalls: number; normalDrawCalls: number; postProcessPassCount: number } | undefined;
  let light = { x: 160, y: 80 };
  const cleanup = () => { lifetime.abort(); runtime?.destroy(); renderer.destroy(); shell.destroy(); return renderer.resourceStats?.(); };
  try {
    const assetUrl = (file: string) => new URL("./assets/" + file + ".png", document.baseURI).href;
    await loader.loadAssets({
      textures: { keeper: assetUrl("keeper"), keeperNormal: assetUrl("keeper-normal"), tiles: assetUrl("tiles"), star: assetUrl("star"), flower: assetUrl("flower") },
      textureOptions: Object.fromEntries(["keeper", "keeperNormal", "tiles", "star", "flower"].map(name => [name, { colorSpace: "none" as const }])),
    });
    const response = await fetch(new URL("./scene.json", document.baseURI));
    if (!response.ok) throw Error(`정원을 읽지 못했습니다: ${response.status}`);
    const scene = resolveSceneAuthoringDocument(await response.json());
    runtime = await createFerrumRuntime({
      canvas, renderer, assetHost: loader, dataScene: scene, autostart: false,
      inputOptions: { pointerGestures: false },
      lighting: frame => {
        if (lightChoice.value === "day" || !view) return false;
        const lighting: LightingScene2D = {
          enabled: true, ambient: [.28, .34, .43, .5],
          pointLights: [{ ...light, radius: 110, height: 32, intensity: .28, falloff: 1.3, color: [1, .82, .55, 1] },
            { x: 248, y: 96, radius: 80, height: 28, intensity: .16, falloff: 1, color: [.45, .8, 1, 1] }],
        };
        return view.lighting(lighting, view.snapshot(frame));
      },
      postProcess: () => effects[effectChoice.value],
      spriteMaterial: () => material,
      onFrame: frame => {
        lastFrame = { state: frame.frame.gameState, entities: frame.frame.entityCount,
          commands: frame.frame.renderCommandBuffer.commandCount, drawCalls: frame.rendererStats.drawCalls,
          normalDrawCalls: frame.rendererStats.normalDrawCalls ?? 0, postProcessPassCount: frame.rendererStats.postProcessPassCount ?? 0 };
        const count = Number(runtime?.dataScene?.variables.get("seeds") ?? 0);
        if (count !== lastSeeds) {
          lastSeeds = count;
          progress.textContent = count === 3 ? "씨앗 3 / 3 · 정원에 빛이 돌아왔어요!" : `씨앗 ${count} / 3`;
        }
      },
    });
    const configure = () => {
      view = createDataSceneView(runtime!.engine, renderer, canvas, { x: 160, y: 96 });
      const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
      const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
      if (!runtime!.engine.configureDataSceneMovementAnimation({ idle, walk })) throw Error("걷기 애니메이션을 설정하지 못했습니다.");
      pause.textContent = "일시정지";
    };
    configure();
    const move = (target: { x: number; y: number }) => {
      if (runtime!.dataScene!.state() === "playing") runtime!.engine.moveDataSceneActorTo({ ...target, speed: 65, arrivalRadius: .5 });
    };
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      canvas.focus();
      const target = view!.pointerToWorld({ x: event.clientX, y: event.clientY });
      if (target.x >= 16 && target.x < 304 && target.y >= 16 && target.y < 176) move(target);
    }, { signal });
    canvas.addEventListener("pointermove", event => { light = view!.pointerToWorld({ x: event.clientX, y: event.clientY }); }, { signal });
    for (const button of panel.querySelectorAll<HTMLButtonElement>("[data-seed]")) button.addEventListener("click", () => move(seeds[Number(button.dataset.seed)]), { signal });
    paletteChoice.addEventListener("change", () => {
      material = paletteChoice.value === "mint" ? false : { paletteSwap: [{ textureId: runtime!.engine.textureId("keeper"),
        colors: colors.mint.map((from, i) => ({ from, to: colors[paletteChoice.value][i] })) }] };
    }, { signal });
    pause.addEventListener("click", () => {
      const scene = runtime!.dataScene!;
      if (scene.state() === "playing") { scene.pause(); pause.textContent = "계속하기"; }
      else { scene.resume(); pause.textContent = "일시정지"; }
    }, { signal });
    panel.querySelector("#pixel-reset")!.addEventListener("click", () => { runtime!.dataScene!.reapply(scene); configure(); }, { signal });
    rendererChoice.addEventListener("change", () => { const url = new URL(location.href); url.searchParams.set("renderer", rendererChoice.value); location.assign(url); }, { signal });
    window.addEventListener("pagehide", event => { if (!event.persisted) cleanup(); }, { signal });
    // Read-only evidence for the example browser smoke; simulation remains in Rust.
    Object.assign(window, { ferrumPixelShowcase: { snapshot: () => {
      const handle = runtime!.dataScene!.result.entityHandles.keeper;
      return { backend, ...lastFrame, seeds: runtime!.dataScene!.variables.get("seeds"),
        actor: runtime!.engine.getPhysicsEntity(handle), animation: runtime!.engine.dataSceneSpriteAnimationState(handle),
        presentation: renderer.pixelPerfectPresentation?.(), resources: renderer.resourceStats?.() };
    }, destroy: cleanup } });
    runtime.start();
  } catch (error) { cleanup(); throw error; }
}

void bootstrap().catch(error => renderRuntimeDemoError(error, { title: "작은 빛의 정원", diagnosticReport }));
