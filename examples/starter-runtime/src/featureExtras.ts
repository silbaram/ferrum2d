import {
  AudioManager, type FerrumRuntime, type FrameState, type SpatialAudioVoice,
} from "@ferrum2d/ferrum-web/core";
import { ParticleVfxEmitter, particleVfxPreset } from "@ferrum2d/ferrum-web/labs";
import { type SceneAuthoringDocumentSpec, type GameplayEntityHandle } from "@ferrum2d/ferrum-web/authoring";
type ShooterGameSpec = Parameters<FerrumRuntime["engine"]["setGameSpec"]>[0];

export const shooterFeatures = new Set(["tilemap", "input", "projectiles"]);
export const extraControls: Record<string, string> = {
  tilemap: `<label>타일 브러시<select data-control="brush"><option value="wall">벽 · 충돌 있음</option><option value="floor">바닥 · 통과</option></select></label>
    <div class="feature-buttons"><button data-control="open-gate">통로 열기</button><button data-control="close-gate">통로 닫기</button></div>
    <button data-control="return-left">왼쪽 출발</button><output data-value="edit" role="status">중앙 벽의 통로를 열어 보세요.</output>`,
  layers: `<label>로봇 그리기 순서<select data-control="order"><option value="front">맨 앞 · 2</option><option value="middle">공 뒤 · 0</option><option value="back">맨 뒤 · -2</option></select></label>
    <p>로봇·공·패널의 위치는 고정됩니다. 그리기 레이어와 충돌 분류는 별개입니다.</p>`,
  particles: `<label>효과<select data-control="vfx"><option value="hit-spark">불꽃 · 한 번</option><option value="dust-loop">먼지 · 반복</option><option value="motion-trail">포인터 잔상</option></select></label>
    <label>방출 수량 <output data-value="count">24</output><input data-control="count" type="range" min="1" max="64" value="24"></label>
    <label>수명 <output data-value="life">0.8초</output><input data-control="life" type="range" min="2" max="20" value="8"></label>
    <label>속도 <output data-value="speed">160</output><input data-control="speed" type="range" min="20" max="300" value="160" step="10"></label>
    <div class="feature-buttons"><button data-control="emit">방출</button><button data-control="stop-emitter">방출 정지</button></div>`,
  audio: `<div class="feature-buttons"><button data-control="audio-play">소리 재생</button><button data-control="audio-stop">소리 정지</button></div>
    <label>좌우 위치 <output data-value="pan">-160</output><input data-control="pan" type="range" min="-224" max="224" value="-160" step="8"></label>
    <label>앞쪽 거리 <output data-value="distance">128</output><input data-control="distance" type="range" min="32" max="240" value="128" step="8"></label>
    <label>볼륨 <output data-value="volume">40%</output><input data-control="volume" type="range" min="0" max="100" value="40"></label>
    <output data-value="audio-status" role="status">재생 버튼으로 시작하세요. 헤드폰으로 좌우 차이를 비교할 수 있습니다.</output>`,
  input: `<button data-control="menu">메뉴 열기</button><p>WASD / 방향키, 게임패드 왼쪽 스틱, 아래 가상 조이스틱으로 이동하세요. 메뉴의 입력란에서는 게임이 움직이지 않습니다.</p>
    <output data-value="devices" role="status">게임패드를 연결하고 버튼을 누르면 감지됩니다.</output>`,
};
export const extraHelp: Record<string, string> = {
  tilemap: "WASD / 방향키로 이동 · 캔버스 클릭으로 타일 수정 · 바깥 테두리와 캐릭터가 있는 칸은 보호됩니다.",
  layers: "큰 숫자의 레이어가 앞에 그려집니다. 가운데 겹치는 부분을 비교하세요.",
  particles: "캔버스를 눌러 방출 · 잔상 모드에서 포인터를 움직이세요. 정지하면 남은 입자는 수명이 끝날 때 사라집니다.",
  audio: "로봇은 듣는 위치, 빛나는 표식은 소리가 나는 위치입니다. 좌우와 거리를 바꿔 비교하세요.",
  input: "캔버스 클릭 후 이동 · 메뉴에서는 입력만 차단하며 엔진 시간은 계속 흐릅니다.",
};

export interface FeatureContext {
  id: string;
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  runtime: FerrumRuntime;
  assets: Pick<import("@ferrum2d/ferrum-web/core").AssetLoader, "loadAssets" | "releaseAssets" | "textureId" | "soundId">;
  source: SceneAuthoringDocumentSpec | ShooterGameSpec;
  signal: AbortSignal;
  worldPoint(event: PointerEvent): { x: number; y: number };
  reapply(scene: SceneAuthoringDocumentSpec): void;
  playing(): boolean;
  configureView(): void;
}
export interface FeatureExtra {
  beforeReset?(): void;
  reset(): void;
  frame(frame: FrameState): void;
  observation(): string;
  snapshot(): object;
  pause(paused: boolean): void;
  destroy(): void;
  postProcess?(): import("@ferrum2d/ferrum-web/authoring").PostProcessStackInput;
  input?(snapshot: ReturnType<FerrumRuntime["input"]["snapshot"]>): ReturnType<FerrumRuntime["input"]["snapshot"]>;
  camera?(): { x: number; y: number; smoothTimeSeconds: number };
}
export function nativePosition(runtime: FerrumRuntime, handle?: GameplayEntityHandle) {
  if (!handle) return undefined;
  // Cold UI/diagnostic query. Copy the view before another call can grow Wasm memory.
  const pose = runtime.engine.queryAudioPoseBuffer(new Uint32Array([handle.entityId, handle.entityGeneration]));
  return pose.words[0] ? { x: pose.floats[4], y: pose.floats[5] } : undefined;
}

/** Topic adapters own controls and presentation. All movement/collision/particle integration is native. */
export function createFeatureExtra(ctx: FeatureContext): FeatureExtra | undefined {
  if (!(ctx.id in extraControls)) return undefined;
  const { id, root, canvas, runtime, signal } = ctx, engine = runtime.engine;
  const control = <T extends HTMLElement>(key: string) => root.querySelector<T>(`[data-control="${key}"]`)!;
  const value = (key: string) => control<HTMLInputElement>(key).value;
  const number = (key: string) => Number(value(key));
  const output = (key: string, text: string) => { root.querySelector(`[data-value="${key}"]`)!.textContent = text; };
  const on = (key: string, event: string, fn: () => void) => control(key).addEventListener(event, fn, { signal });
  const check = (ok: boolean) => { if (!ok) throw Error(`${id} 실험 명령을 엔진이 거절했습니다.`); };
  const extra: FeatureExtra = { reset() {}, frame() {}, observation: () => "", snapshot: () => ({}), pause() {}, destroy() {} };
  const handle = (key: string) => runtime.dataScene!.result.entityHandles[key];

  if (shooterFeatures.has(id)) {
    const spec = ctx.source as ShooterGameSpec; // File kind is selected by the fixed catalog id.
    const initial = spec.tilemap!.layers![1].data!;
    let cells = [...initial], edits = 0;
    const actor = () => engine.builtInShooterPlayerHandle();
    const teleportLeft = () => { check(engine.setBuiltInSceneEntityPosition(actor()!, 160, 192)); runtime.input.clear(); };
    extra.reset = () => {
      engine.setTextureIds({ player: engine.textureId("robot"), enemy: engine.textureId("robot"), bullet: engine.textureId("energy") });
      engine.setGameSpec(spec); engine.resetGame(); teleportLeft(); cells = [...initial]; edits = 0;
      if (id === "tilemap") output("edit", "중앙 벽의 통로를 열어 보세요.");
    };
    if (id === "tilemap") {
      extra.pause = paused => runtime.input.setEnabled(!paused);
      const editable = () => {
        if (ctx.playing()) return true;
        output("edit", "계속하기를 누른 뒤 수정하세요."); return false;
      };
      const overlapsActor = (column: number, row: number) => {
        const p = nativePosition(runtime, actor());
        return !!p && Math.abs(p.x - (column * 32 + 16)) < 30 && Math.abs(p.y - (row * 32 + 16)) < 32;
      };
      const edit = (column: number, row: number, tile: number) => {
        if (!editable()) return;
        if (column < 1 || column > 18 || row < 1 || row > 10) { output("edit", "바깥 테두리는 수정하지 않습니다."); return; }
        if (tile && overlapsActor(column, row)) {
          output("edit", "캐릭터와 겹치는 칸에는 벽을 놓을 수 없습니다."); return;
        }
        check(engine.setShooterTilemapTile(1, column, row, tile));
        cells[row * 20 + column] = tile; edits++;
        output("edit", `${column}, ${row} → ${tile ? "벽 · 충돌" : "바닥 · 통과"}`);
      };
      const gate = (tile: number) => {
        if (!editable()) return;
        if (tile && (overlapsActor(10, 5) || overlapsActor(10, 6))) {
          output("edit", "캐릭터가 통로에 있어 닫을 수 없습니다."); return;
        }
        check(engine.setShooterTilemapTilesRect(1, 10, 5, 1, 2, tile));
        cells[110] = tile; cells[130] = tile; edits += 2;
        output("edit", tile ? "통로를 닫았습니다." : "통로를 열었습니다.");
      };
      on("open-gate", "click", () => gate(0));
      on("close-gate", "click", () => gate(2));
      on("return-left", "click", () => {
        if (!editable()) return;
        // The 24×30 player at (160,192) overlaps these four editable cells.
        if ([104, 105, 124, 125].some(index => cells[index] !== 0)) {
          output("edit", "출발 위치가 벽으로 막혀 있습니다. 바닥 브러시로 지운 뒤 돌아가세요."); return;
        }
        teleportLeft(); output("edit", "왼쪽 출발 위치로 돌아왔습니다.");
      });
      canvas.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        canvas.focus(); const p = ctx.worldPoint(event);
        edit(Math.floor(p.x / 32), Math.floor(p.y / 32), value("brush") === "wall" ? 2 : 0);
      }, { signal });
      extra.observation = () => `20 × 12칸 · 32 단위 · 수정 ${edits}회 · 벽은 실제 타일 충돌을 사용합니다.`;
      extra.snapshot = () => ({ tilemap: { edits, gateOpen: cells[110] === 0 && cells[130] === 0 }, actor: nativePosition(runtime, actor()) });
    } else {
      const dialog = document.createElement("dialog");
      dialog.className = "feature-input-menu";
      dialog.setAttribute("aria-labelledby", "feature-menu-title");
      dialog.innerHTML = `<h2 id="feature-menu-title">입력 전환 실험</h2><p>게임 입력이 차단되었습니다. WASD를 입력해 보세요.</p><form method="dialog"><label>이름<input name="name" autocomplete="off"></label><button>게임으로 돌아가기</button></form>`;
      root.append(dialog);
      let presses = 0, lastInput = { w: false, a: false, s: false, d: false, space: false }, lastTime = 0;
      const reset = extra.reset;
      const restore = () => { runtime.input.clear(); runtime.input.setEnabled(ctx.playing()); canvas.focus(); };
      on("menu", "click", () => { runtime.input.setEnabled(false); dialog.showModal(); });
      dialog.addEventListener("close", restore, { signal });
      extra.reset = () => { if (dialog.open) dialog.close(); reset(); presses = 0; lastTime = 0; restore(); };
      extra.pause = paused => { runtime.input.setEnabled(!paused && !dialog.open); };
      extra.frame = frame => {
        lastTime = frame.timeSeconds;
        const state = runtime.input.actionSnapshot();
        lastInput = state.input;
        presses += state.justPressedActions.length;
      };
      extra.observation = () => {
        const pads = Array.from(navigator.getGamepads?.() ?? []).filter(p => p?.connected);
        output("devices", pads.length ? `게임패드 ${pads.length}개 연결 · 왼쪽 스틱으로 이동` : "게임패드 미연결 · 키보드와 가상 조이스틱 사용 가능");
        return `${dialog.open ? "메뉴 · 게임 입력 차단" : "게임 입력 활성"} · 이동 ${[lastInput.w && "위", lastInput.a && "왼쪽", lastInput.s && "아래", lastInput.d && "오른쪽"].filter(Boolean).join(" / ") || "없음"} · 누름 ${presses}회`;
      };
      extra.snapshot = () => ({ actor: nativePosition(runtime, actor()), input: { ...lastInput, menu: dialog.open, presses, time: lastTime } });
      extra.destroy = () => dialog.remove();
    }
  }

  if (id === "layers") {
    let order = 2;
    const apply = () => {
      const doc = structuredClone(ctx.source as SceneAuthoringDocumentSpec);
      order = value("order") === "front" ? 2 : value("order") === "middle" ? 0 : -2;
      const instances = doc.sceneComposition.fragments!.lab.instances!;
      instances.find(item => item.id === "robot")!.layer = order;
      instances.find(item => item.id === "panel")!.layer = -1;
      ctx.reapply(doc);
      output("observation", extra.observation());
    };
    on("order", "change", apply); extra.reset = apply;
    extra.observation = () => `로봇 ${order} · 공 1 · 패널 -1 · 배경 -100. 위치·크기는 동일합니다.`;
    extra.snapshot = () => ({ layers: { robot: order, orb: 1, panel: -1 } });
  }

  if (id === "particles") {
    let emitter: ParticleVfxEmitter | undefined, pointer = { x: 320, y: 192 }, lastTime: number | undefined;
    const setup = () => {
      emitter?.stop(); engine.clearParticles();
      const name = value("vfx") as "hit-spark" | "dust-loop" | "motion-trail";
      const preset = particleVfxPreset(name, "energy");
      const life = number("life") / 10, speed = number("speed");
      emitter = ParticleVfxEmitter.create({ target: engine, presetId: 30, preset: { ...preset,
        particle: { ...preset.particle, burstCount: number("count"), lifetime: [life, life], speed: [speed * .5, speed] },
        emitter: { ...preset.emitter, autostart: false, intervalSeconds: .12, maxBurstsPerUpdate: 1 },
      } });
      output("count", value("count")); output("life", `${life.toFixed(1)}초`); output("speed", value("speed"));
      lastTime = undefined;
      output("observation", extra.observation());
    };
    const emit = () => { if (!ctx.playing()) return; if (value("vfx") === "hit-spark") emitter!.trigger(pointer.x, pointer.y); else emitter!.start(pointer.x, pointer.y); output("observation", extra.observation()); };
    on("vfx", "change", setup);
    for (const key of ["count", "life", "speed"]) on(key, "input", setup);
    on("emit", "click", emit); on("stop-emitter", "click", () => { emitter?.stop(); output("observation", extra.observation()); });
    canvas.addEventListener("pointermove", event => { pointer = ctx.worldPoint(event); }, { signal });
    canvas.addEventListener("pointerdown", event => { if (event.button === 0) { pointer = ctx.worldPoint(event); emit(); } }, { signal });
    extra.reset = () => { pointer = { x: 320, y: 192 }; setup(); };
    extra.frame = frame => {
      const dt = lastTime === undefined ? 0 : Math.max(0, Math.min(.05, frame.timeSeconds - lastTime)); lastTime = frame.timeSeconds;
      if (ctx.playing()) emitter?.update(dt, pointer.x, pointer.y);
    };
    extra.pause = () => { lastTime = undefined; };
    extra.observation = () => `현재 입자 ${engine.particleCount()}개 · 누적 방출 ${emitter?.snapshot().spawnedParticleCount ?? 0}개 · ${emitter?.snapshot().active ? "반복 방출 중" : "방출 대기/정지"}`;
    extra.snapshot = () => ({ particles: { count: engine.particleCount(), ...emitter?.snapshot() } });
    extra.destroy = () => emitter?.stop();
  }

  if (id === "audio") {
    const audio = new AudioManager();
    let voice: SpatialAudioVoice | undefined, generation = 0, loading: Promise<unknown> | undefined;
    const pose = () => ({ x: 320 + number("pan"), y: 304 - number("distance") });
    const update = () => {
      const p = pose();
      check(engine.setPhysicsBodyPosition(handle("source"), p.x, p.y));
      voice?.setPose(p.x, -p.y, 0); voice?.setVolume(number("volume") / 100);
      for (const key of ["pan", "distance", "volume"]) output(key, `${value(key)}${key === "volume" ? "%" : ""}`);
    };
    const stop = () => { generation++; voice?.stop(); voice = undefined; output("audio-status", "정지됨 · 소리 재생을 눌러 다시 시작하세요."); output("observation", extra.observation()); };
    on("audio-play", "click", () => {
      if (!ctx.playing()) { output("audio-status", "계속하기를 누른 뒤 재생하세요."); return; }
      const request = ++generation;
      voice?.stop(); voice = undefined;
      output("audio-status", "소리 준비 중…");
      void (async () => {
        const unlocked = await audio.unlock();
        if (signal.aborted || request !== generation) return;
        if (!unlocked) throw Error("오디오를 시작할 수 없습니다. 브라우저 소리 권한을 확인하세요.");
        loading ??= audio.loadSound(1, new URL("./features/beacon.wav", document.baseURI).href, { signal }).catch(error => { loading = undefined; throw error; });
        await loading;
        if (signal.aborted || request !== generation || !ctx.playing()) return;
        audio.setListenerPose(320, -304, 0, 0, 1, 0, 0, 0, 1);
        const p = pose();
        voice = audio.playSpatial(1, { x: p.x, y: -p.y, z: 0, refDistance: 48, maxDistance: 640, distanceModel: "inverse", panningModel: "equalpower", loop: true }, number("volume") / 100);
        output("audio-status", voice?.spatialized ? "공간 오디오 재생 중" : "공간 처리 미지원 · 일반 오디오로 재생");
        output("observation", extra.observation());
      })().catch(error => { if (!signal.aborted && request === generation) output("audio-status", error instanceof Error ? error.message : String(error)); });
    });
    on("audio-stop", "click", stop);
    // Back/forward-cache pages may keep their runtime. Never leave a looping cue behind.
    window.addEventListener("pagehide", stop, { signal });
    for (const key of ["pan", "distance", "volume"]) on(key, "input", update);
    extra.reset = () => { stop(); update(); };
    extra.pause = paused => { if (paused) stop(); };
    extra.observation = () => `음원 거리 ${Math.hypot(number("pan"), number("distance")).toFixed(0)} · 활성 음원 ${audio.state().spatialVoiceCount ?? 0}개`;
    extra.snapshot = () => ({ audio: { ...audio.state(), active: voice?.active ?? false, spatialized: voice?.spatialized ?? false, position: pose() } });
    extra.destroy = () => { generation++; voice?.stop(); audio.destroy(); };
  }
  return extra;
}
