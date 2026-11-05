import { AudioManager, type SpatialAudioVoice } from "@ferrum2d/ferrum-web/core";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const animationControls = `<label>실험<select data-control="animation-mode"><option value="sheet">시트 재생</option><option value="movement">이동과 대기</option><option value="once">한 번 재생과 완료</option></select></label>
  <label>재생 속도 <output data-value="fps">6 fps</output><input data-control="fps" type="range" min="1" max="16" value="6"></label>
  <label>재생 순서<select data-control="direction"><option value="forward">정방향</option><option value="reverse">역방향</option><option value="pingpong">왕복</option></select></label>
  <label class="feature-check"><input data-control="flip" type="checkbox"> 좌우 반전</label>
  <div class="feature-buttons"><button data-control="walk-left">왼쪽 걷기</button><button data-control="walk-right">오른쪽 걷기</button><button data-control="animation-stop">멈추기</button><button data-control="animation-replay">다시 재생</button></div>
  <button data-control="footstep-audio">발소리 켜기</button><output data-value="footstep-status" role="status">소리는 버튼으로 켭니다.</output>
  <output class="feature-animation-cue" data-value="animation-cue" aria-live="off">프레임 이벤트 대기</output>`;

/** Native clips/movement and their events drive this UI and optional audio. */
export function createAnimationFeature(ctx: FeatureContext): FeatureExtra {
  const { runtime, root, canvas, signal } = ctx, engine = runtime.engine;
  const audio = new AudioManager();
  let voice: SpatialAudioVoice | undefined, request: AbortController | undefined;
  let generation = 0, sound = false, destroyed = false, steps = 0, completions = 0, events = 0, overflow = 0, cues = 0;
  const handle = () => runtime.dataScene!.result.entityHandles.robot!;
  const control = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-control="${name}"]`)!;
  const value = (name: string) => control<HTMLSelectElement>(name).value;
  const output = (name: string, text: string) => { root.querySelector(`[data-value="${name}"]`)!.textContent = text; };
  const check = (ok: boolean) => { if (!ok) throw Error("애니메이션 설정을 적용하지 못했습니다."); };
  const frames = Array.from({ length: 4 }, (_, i) => ({ u0: i / 4, v0: 0, u1: (i + 1) / 4, v1: 1 }));
  const stopAudio = () => {
    generation++; request?.abort(); request = undefined; sound = false; voice?.stop(); voice = undefined;
    control("footstep-audio").textContent = "발소리 켜기"; output("footstep-status", "소리는 버튼으로 켭니다.");
  };
  const configure = () => {
    engine.cancelDataSceneMove();
    check(engine.configureDataSceneMovementAnimation(false));
    const mode = value("animation-mode"), fps = Number(value("fps"));
    check(engine.configureDataSceneSpriteAnimation(handle(), { initialClip: mode === "movement" ? 0 : mode === "once" ? 2 : 1,
      clips: [{ id: 0, frames: [frames[0]!], fps: 1 }, ...[1, 2].map(id => ({ id, frames, fps,
        loop: id === 1, direction: value("direction") as "forward" | "reverse" | "pingpong", emitEvents: true }))] }));
    if (mode === "movement") {
      const poses = (clip: number) => ({ up: { clip }, down: { clip }, left: { clip, flipX: true }, right: { clip } });
      check(engine.configureDataSceneMovementAnimation({ idle: poses(0), walk: poses(1), initialDirection: "right" }));
    } else check(engine.updateDataSceneSpriteAnimations([{ entity: handle(), flipX: control<HTMLInputElement>("flip").checked }]));
    control<HTMLInputElement>("flip").disabled = mode === "movement";
    for (const key of ["walk-left", "walk-right", "animation-stop"]) control<HTMLButtonElement>(key).disabled = mode !== "movement";
    control<HTMLButtonElement>("animation-replay").disabled = mode !== "once";
    output("fps", `${fps} fps`);
  };
  const move = (x: number, y = 192) => {
    if (!ctx.playing() || value("animation-mode") !== "movement") return;
    check(engine.moveDataSceneActorTo({ x, y, speed: 100, arrivalRadius: 1, cancelOnInput: false }));
  };
  const on = (name: string, event: string, callback: () => void) => control(name).addEventListener(event, callback, { signal });
  for (const name of ["animation-mode", "direction", "flip"]) on(name, "change", configure);
  on("fps", "input", configure);
  on("walk-left", "click", () => move(144)); on("walk-right", "click", () => move(496));
  on("animation-stop", "click", () => { if (ctx.playing()) engine.cancelDataSceneMove(); });
  on("animation-replay", "click", () => { if (ctx.playing()) check(engine.updateDataSceneSpriteAnimations([{ entity: handle(), clip: 2, restart: true }])); });
  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    canvas.focus(); const p = ctx.worldPoint(event);
    move(Math.max(80, Math.min(560, p.x)), Math.max(80, Math.min(304, p.y)));
  }, { signal });
  canvas.addEventListener("keydown", event => {
    const delta: Record<string, [number, number]> = { KeyA: [-64, 0], ArrowLeft: [-64, 0], KeyD: [64, 0], ArrowRight: [64, 0], KeyW: [0, -64], ArrowUp: [0, -64], KeyS: [0, 64], ArrowDown: [0, 64] };
    const d = delta[event.code]; if (!d || value("animation-mode") !== "movement") return;
    event.preventDefault(); const p = engine.getPhysicsEntity(handle());
    if (p) move(Math.max(80, Math.min(560, p.x + d[0])), Math.max(80, Math.min(304, p.y + d[1])));
  }, { signal });
  on("footstep-audio", "click", () => {
    if (sound || request) { stopAudio(); return; }
    if (!ctx.playing()) return;
    const token = ++generation, pending = new AbortController(); request = pending;
    output("footstep-status", "소리 준비 중…");
    void (async () => {
      if (!await audio.unlock()) throw Error("소리 권한을 확인하세요. 시각 이벤트는 계속 표시합니다.");
      if (destroyed || token !== generation) return;
      await audio.loadSound(1, new URL("./features/beacon.wav", document.baseURI).href, { signal: pending.signal });
      if (destroyed || token !== generation || !ctx.playing()) return;
      request = undefined; sound = true; control("footstep-audio").textContent = "발소리 끄기";
      output("footstep-status", "프레임 2·4에서 합성 발소리가 납니다.");
    })().catch(error => { if (!destroyed && token === generation) { request = undefined; output("footstep-status", String(error)); } });
  });
  window.addEventListener("pagehide", stopAudio, { signal });
  return {
    reset() { stopAudio(); steps = completions = events = overflow = cues = 0; configure(); output("animation-cue", "프레임 이벤트 대기"); root.querySelector<HTMLElement>('[data-value="animation-cue"]')!.dataset.phase = "0"; },
    frame(frame) {
      let footstep = false;
      for (const event of frame.gameplayEvents) {
        if (event.kind === "spriteAnimationOverflow") { overflow += event.payloadBits; continue; }
        if (event.actorId !== handle().entityId || event.actorGeneration !== handle().entityGeneration) continue;
        if (event.kind === "spriteAnimationFrame") {
          events++; output("animation-cue", `프레임 ${event.payloadBits + 1} 진입 · 이벤트 ${events}회`);
          if (event.tokenId === 1 && (event.payloadBits === 1 || event.payloadBits === 3)) { steps++; footstep = true; root.querySelector<HTMLElement>('[data-value="animation-cue"]')!.dataset.phase = String(steps % 2); }
        } else if (event.kind === "spriteAnimationCompleted") { completions++; output("animation-cue", `재생 완료 · ${completions}회`); }
      }
      if (footstep && sound && ctx.playing()) { voice?.stop(); voice = audio.playSpatial(1, { x: 0, y: 0, z: 0, panningModel: "equalpower" }, .14, .8); if (voice) cues++; }
    },
    observation() {
      const state = engine.dataSceneSpriteAnimationState(handle());
      return `클립 ${state?.clip ?? 0} · 프레임 ${(state?.frame ?? 0) + 1} · 발걸음 ${steps} · 완료 ${completions} · 누락 ${overflow}`;
    },
    snapshot: () => ({ animationEvents: { mode: value("animation-mode"), steps, completions, events, overflow, cues, sound, loading: !!request }, move: engine.dataSceneMoveStatus() }),
    pause(paused) { if (paused) stopAudio(); },
    destroy() { destroyed = true; stopAudio(); audio.destroy(); },
  };
}
