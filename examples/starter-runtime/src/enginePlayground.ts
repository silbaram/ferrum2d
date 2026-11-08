import { AssetLoader, createDataSceneView, createFerrumRuntime, createRenderer, resolvePhysicsSpec, type DataSceneView, type FerrumRuntime, } from "@ferrum2d/ferrum-web/core";
import { resolveSceneAuthoringDocument, type PostProcessStackInput } from "@ferrum2d/ferrum-web/authoring";
import type { LightingScene2D } from "@ferrum2d/ferrum-web/labs";
import { createRuntimeDemoShell } from "../../shared/runtimeDemoShell";
import { createExampleLifetime } from "../../shared/exampleLifetime";
import "./enginePlayground.css";
const destinations = [{ x: 144, y: 96 }, { x: 304, y: 296 }, { x: 552, y: 88 }];
const effects: Record<string, PostProcessStackInput> = {
    clean: false,
    glow: [{ kind: "bloom", threshold: .5, intensity: .3, radius: 1 }, { kind: "vignette", intensity: .18 }],
    crt: [{ kind: "crt", curvature: .025, scanlineIntensity: .15 }],
};
/** UI/input adapter only. Scene movement, collision, collection and body integration live in Rust. */
export async function startEnginePlayground(): Promise<void> {
    const lifetime = createExampleLifetime(), { signal } = lifetime;
    const shell = createRuntimeDemoShell({ title: "Engine Playground · 참고·검증", exampleId: "engine-playground", controls: false, metrics: [] });
    lifetime.own(() => shell.destroy());
    const { canvas, stage } = shell;
    const root = stage.closest<HTMLElement>(".demo-shell")!;
    root.classList.add("engine-playground");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "엔진 체험실. 클릭하거나 WASD와 방향키로 로봇을 이동하세요.");
    const toolbar = root.querySelector(".demo-toolbar")!;
    const top = document.createElement("div");
    top.className = "playground-top-actions";
    top.innerHTML = '<span class="playground-backend" role="status">불러오는 중…</span><button data-lab="pause">일시정지</button><button data-lab="reset">다시 시작</button>';
    toolbar.append(top);
    const panel = document.createElement("aside");
    panel.className = "playground-controls";
    panel.setAttribute("aria-label", "엔진 기능 체험");
    panel.innerHTML = `
    <p class="playground-eyebrow">PLAY · CHANGE · DISCOVER</p>
    <h2>작은 발전소를 켜보세요</h2>
    <p class="playground-intro">로봇을 움직여 전지 3개를 모으세요. 벽을 돌아가는 움직임부터 공의 반사와 빛까지 직접 바꿔 볼 수 있습니다.</p>
    <output class="playground-progress" aria-live="polite">전지 0 / 3</output>
    <section><h3><span>01</span> 이동과 충돌</h3>
      <p>바닥을 클릭하면 장애물을 돌아갑니다. WASD·방향키로 조금씩 움직일 수도 있어요.</p>
      <div class="playground-destinations"><button data-destination="0">서쪽 전지</button><button data-destination="1">중앙 전지</button><button data-destination="2">동쪽 전지</button></div>
      <output data-lab="move-status" role="status">길을 찾아 전지를 모아보세요.</output>
    </section>
    <section><h3><span>02</span> 튀는 공 실험</h3>
      <p>오른쪽 아래 실험장의 공을 던져보세요. 재질을 바꾸면 벽에 닿은 뒤의 움직임이 달라집니다.</p>
      <label>공의 재질<select data-lab="material"><option value="rubber">고무 · 잘 튀어요</option><option value="clay">점토 · 금방 멈춰요</option></select></label>
      <button data-lab="launch" class="playground-accent">공 던지기</button>
      <output data-lab="physics-status" role="status">공을 던지면 실험이 시작됩니다.</output>
    </section>
    <section><h3><span>03</span> 빛과 화면</h3>
      <label>조명<select data-lab="lighting"><option value="lit">작업등 켜기</option><option value="off">원본 색상 보기</option></select></label>
      <label class="playground-check"><input data-lab="normal" type="checkbox" checked> 표면에 입체적인 빛 표현</label>
      <p>화면 위로 포인터를 움직여 작업등을 비춰보세요.</p>
      <label>화면 효과<select data-lab="effect"><option value="clean">기본</option><option value="glow">은은한 빛</option><option value="crt">레트로 화면</option></select></label>
      <label>카메라<select data-lab="camera"><option value="overview">전체 보기</option><option value="follow">로봇 따라가기</option><option value="physics">공 실험장 보기</option></select></label>
      <label>확대 <output data-lab="zoom-label">100%</output><input data-lab="zoom" type="range" min="75" max="250" value="100" step="5"></label>
    </section>
    <details><summary>더 살펴보기</summary>
      <label>렌더러<select data-lab="renderer"><option value="webgl2">WebGL2</option><option value="webgpu">WebGPU</option></select></label>
      <p>렌더러를 변경하면 처음부터 시작합니다.</p>
      <a href="?mode=starter">사격 프로필·리플레이 예제</a>
      <a href="./playground/scene.json" download>이 씬의 구성 파일 내려받기</a>
    </details>`;
    root.querySelector(".demo-metrics")!.replaceWith(panel);
    const help = document.createElement("p");
    help.className = "playground-canvas-help";
    help.textContent = "클릭하여 이동 · WASD / 방향키 · 빛을 움직여 표면 비교";
    stage.append(help);
    const select = (name: string) => root.querySelector<HTMLSelectElement>(`[data-lab="${name}"]`)!;
    const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-lab="${name}"]`)!;
    const output = (name: string) => root.querySelector<HTMLOutputElement>(`[data-lab="${name}"]`)!;
    const normal = root.querySelector<HTMLInputElement>('[data-lab="normal"]')!, zoom = root.querySelector<HTMLInputElement>('[data-lab="zoom"]')!;
    const progress = root.querySelector<HTMLOutputElement>(".playground-progress")!;
    const requested = new URL(location.href).searchParams.get("renderer") === "webgpu" ? "webgpu" : "webgl2";
    select("renderer").value = requested;
    try {
        const renderer = await createRenderer(canvas, { preferred: requested, webgl2: { preserveDrawingBuffer: true, clearColor: [.035, .065, .09, 1] }, webgpu: { clearColor: [.035, .065, .09, 1] } });
        lifetime.own(() => renderer.destroy());
        const backend = "gpuDevice" in renderer ? "webgpu" : "webgl2";
        root.querySelector(".playground-backend")!.textContent = `${backend === "webgpu" ? "WebGPU" : "WebGL2"}${backend !== requested ? " · 호환 모드" : ""}`;
        const loader = new AssetLoader(renderer);
        let runtime: FerrumRuntime | undefined, view: DataSceneView | undefined, resize: ResizeObserver | undefined;
        let light = { x: 144, y: 96 }, lastCells = -1, lastUi = 0, launches = 0, collisions = 0;
        let lastFrame: {
            state: number;
            entities: number;
            commands: number;
            drawCalls: number;
            normalDrawCalls: number;
            postProcessPassCount: number;
            cameraX: number;
            cameraY: number;
            collisionPairs: number;
        } | undefined;
        const cleanup = () => { lifetime.dispose(); return renderer.resourceStats?.(); };
        const textures = { floor: "floor", panel: "panel", wall: "wall", water: "water", robot: "robot", robotNormal: "robot-normal", ball: "ball", ballNormal: "ball-normal", energy: "energy" };
        await loader.loadAssets({ textures: Object.fromEntries(Object.entries(textures).map(([key, file]) => [key, new URL(`./playground/${file}.png`, document.baseURI).href])), textureOptions: Object.fromEntries(Object.keys(textures).map(key => [key, { colorSpace: "none" as const }])) }, undefined, { signal });
        lifetime.check();
        const response = await fetch(new URL("./playground/scene.json", document.baseURI), { signal });
        if (!response.ok)
            throw Error(`씬을 불러오지 못했습니다: ${response.status}`);
        const scene = resolveSceneAuthoringDocument(await response.json(), { validateBindings: true, validateComponents: true });
        lifetime.check();
        runtime = await createFerrumRuntime({ canvas, renderer, assetHost: loader, dataScene: scene, autostart: false, inputOptions: { pointerGestures: false }, engine: { includeCollisionEvents: true },
            lighting: frame => {
                if (select("lighting").value === "off" || !view)
                    return false;
                const lighting: LightingScene2D = { enabled: true, ambient: [.36, .46, .56, .55], pointLights: [
                        { ...light, radius: 180, height: 38, intensity: .5, falloff: 1.2, color: [1, .86, .65, 1] },
                        { x: 520, y: 280, radius: 140, height: 36, intensity: .25, falloff: 1, color: [.45, .85, 1, 1] },
                    ] };
                return view.lighting(lighting, view.snapshot(frame));
            }, postProcess: () => effects[select("effect").value],
            onFrame: frame => {
                const f = frame.frame, s = frame.rendererStats;
                lastFrame = { state: f.gameState, entities: f.entityCount, commands: f.renderCommandBuffer.commandCount, drawCalls: s.drawCalls, normalDrawCalls: s.normalDrawCalls ?? 0, postProcessPassCount: s.postProcessPassCount ?? 0, cameraX: f.cameraX, cameraY: f.cameraY, collisionPairs: f.physics.collisionSolidPairs };
                const ball = runtime?.dataScene?.result.entityHandles.ball;
                // CCD resolves a bounce before overlap lifecycle events are collected. This scene
                // has one dynamic body, so native swept-hit telemetry also identifies the ball.
                if (launches && ball)
                    collisions += f.physics.ccdHits + f.collisionEvents.filter(e => (e.kind === "enter" || e.kind === "hit") &&
                        ((e.aId === ball.entityId && e.aGeneration === ball.entityGeneration) || (e.bId === ball.entityId && e.bGeneration === ball.entityGeneration))).length;
                const now = performance.now();
                if (now - lastUi < 150)
                    return;
                lastUi = now;
                const cells = Number(runtime?.dataScene?.variables.get("cells") ?? 0);
                if (cells !== lastCells) {
                    lastCells = cells;
                    progress.textContent = cells === 3 ? "전지 3 / 3 · 발전소 가동 완료! 계속 실험해보세요." : `전지 ${cells} / 3`;
                    progress.dataset.complete = String(cells === 3);
                }
                if (launches)
                    output("physics-status").textContent = collisions > 0 ? `벽과의 충돌을 확인했어요 · ${select("material").value === "rubber" ? "반사하며 움직이는 고무공" : "에너지를 잃는 점토공"}` : "공이 움직이고 있어요…";
            },
        });
        lifetime.own(() => runtime?.destroy());
        const handles = () => runtime!.dataScene!.result.entityHandles;
        const camera = () => {
            const fit = Math.min(canvas.clientWidth / 640, canvas.clientHeight / 384);
            view!.setZoom(fit * Number(zoom.value) / 100);
            const mode = select("camera").value;
            view!.setCamera({ x: mode === "physics" ? 520 : 320, y: mode === "physics" ? 280 : 192,
                ...(mode === "follow" ? { follow: handles().robot } : {}), smoothTimeSeconds: .15, bounds: { minX: 0, minY: 0, maxX: 640, maxY: 384 } });
            output("zoom-label").textContent = zoom.value + "%";
        };
        const normals = () => { if (!runtime!.engine.configureSpriteNormalMaterials(["robot", "ball"].map(id => ({ entity: handles()[id], ...(normal.checked ? { normalTextureId: runtime!.engine.textureId(id + "Normal") } : {}) }))))
            throw Error("표면 조명 설정 실패"); };
        const material = () => {
            const rubber = select("material").value === "rubber";
            for (const id of ["ball", "bay_north", "bay_south", "bay_west", "bay_east"])
                if (!runtime!.engine.setPhysicsBodyMaterial(handles()[id], { restitution: rubber ? .92 : .08, friction: rubber ? .02 : .6 }))
                    throw Error("공의 재질 설정 실패");
            if (!runtime!.engine.setPhysicsBodyTuning(handles().ball, { gravityScale: 0, linearDamping: rubber ? .08 : 2.4, angularDamping: .2 }))
                throw Error("공의 감속 설정 실패");
        };
        const configure = () => {
            runtime!.engine.configurePhysicsRuntime(resolvePhysicsSpec({ mode: "rigid", gravity: [0, 0], continuous: true, solver: { fixedTimestep: true, stepSeconds: 1 / 60, velocityIterations: 8, positionIterations: 6 } }));
            runtime!.engine.configureAutoRigidBodyStep({ gravityX: 0, gravityY: 0, continuous: true, velocityIterations: 8, positionIterations: 6 });
            view = createDataSceneView(runtime!.engine, renderer, canvas, { x: 320, y: 192 });
            const idle = { up: { clip: 0 }, down: { clip: 0 }, left: { clip: 0, flipX: true }, right: { clip: 0 } };
            const walk = { up: { clip: 1 }, down: { clip: 1 }, left: { clip: 1, flipX: true }, right: { clip: 1 } };
            if (!runtime!.engine.configureDataSceneMovementAnimation({ idle, walk }))
                throw Error("이동 애니메이션 설정 실패");
            camera();
            normals();
            material();
            button("pause").textContent = "일시정지";
        };
        configure();
        resize = new ResizeObserver(() => { if (view && !lifetime.disposed)
            camera(); });
        lifetime.own(() => resize?.disconnect());
        resize.observe(canvas);
        const move = (target: {
            x: number;
            y: number;
        }) => {
            if (runtime!.dataScene!.state() !== "playing")
                return;
            const accepted = runtime!.engine.moveDataSceneActorTo({ ...target, speed: 96, arrivalRadius: 1, cancelOnInput: false });
            output("move-status").textContent = accepted ? "로봇이 길을 찾아 이동합니다." : "갈 수 없는 곳이에요. 다른 바닥을 선택하세요.";
        };
        canvas.addEventListener("pointerdown", event => { if (event.button !== 0)
            return; canvas.focus(); move(view!.pointerToWorld({ x: event.clientX, y: event.clientY })); }, { signal });
        canvas.addEventListener("pointermove", event => { light = view!.pointerToWorld({ x: event.clientX, y: event.clientY }); }, { signal });
        canvas.addEventListener("keydown", event => {
            const direction: Record<string, [
                number,
                number
            ]> = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
            const d = direction[event.code];
            if (!d)
                return;
            event.preventDefault();
            // A key press issues one navigation command. No TS-side movement integration.
            const actor = runtime!.engine.getPhysicsEntity(handles().robot);
            if (actor)
                move({ x: actor.x + d[0] * 32, y: actor.y + d[1] * 32 });
        }, { signal });
        for (const target of panel.querySelectorAll<HTMLButtonElement>("[data-destination]"))
            target.addEventListener("click", () => move(destinations[Number(target.dataset.destination)]), { signal });
        button("launch").addEventListener("click", () => {
            if (runtime!.dataScene!.state() !== "playing") {
                output("physics-status").textContent = "계속하기를 누른 뒤 공을 던져보세요.";
                return;
            }
            const ball = handles().ball;
            material();
            if (!runtime!.engine.setPhysicsBodyPosition(ball, 488, 280) || !runtime!.engine.setPhysicsBodyVelocity(ball, 0, 0) || !runtime!.engine.applyPhysicsBodyImpulse(ball, 180, -110))
                throw Error("공을 던지지 못했습니다.");
            launches++;
            collisions = 0;
            output("physics-status").textContent = "공이 움직이고 있어요…";
        }, { signal });
        select("material").addEventListener("change", material, { signal });
        normal.addEventListener("change", normals, { signal });
        select("camera").addEventListener("change", () => { zoom.value = select("camera").value === "overview" ? "100" : "180"; camera(); }, { signal });
        zoom.addEventListener("input", camera, { signal });
        button("pause").addEventListener("click", () => { const state = runtime!.dataScene!; if (state.state() === "playing") {
            state.pause();
            button("pause").textContent = "계속하기";
        }
        else {
            state.resume();
            button("pause").textContent = "일시정지";
        } }, { signal });
        button("reset").addEventListener("click", () => { runtime!.dataScene!.reapply(scene); launches = 0; collisions = 0; lastCells = -1; configure(); output("move-status").textContent = "길을 찾아 전지를 모아보세요."; output("physics-status").textContent = "공을 던지면 실험이 시작됩니다."; }, { signal });
        select("renderer").addEventListener("change", () => { const url = new URL(location.href); url.searchParams.set("renderer", select("renderer").value); location.assign(url); }, { signal });
        const diagnostics = { snapshot: () => ({ backend, ...lastFrame, cells: runtime!.dataScene!.variables.get("cells"),
                    actor: runtime!.engine.getPhysicsEntity(handles().robot), ball: runtime!.engine.getPhysicsEntity(handles().ball), animation: runtime!.engine.dataSceneSpriteAnimationState(handles().robot),
                    launches, collisions, normal: normal.checked, effect: select("effect").value, lighting: select("lighting").value, zoom: Number(zoom.value), resources: renderer.resourceStats?.() }), destroy: cleanup };
        Object.assign(window, { ferrumEnginePlayground: diagnostics });
        lifetime.own(() => {
            const target = window as Window & { ferrumEnginePlayground?: typeof diagnostics };
            if (target.ferrumEnginePlayground === diagnostics) delete target.ferrumEnginePlayground;
        });
        lifetime.ready();
        runtime.start();
    }
    catch (error) {
        const cancelled = lifetime.disposed;
        lifetime.dispose();
        if (!cancelled) throw error;
    }
}
