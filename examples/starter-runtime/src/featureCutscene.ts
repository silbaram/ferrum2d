import { AudioManager } from "@ferrum2d/ferrum-web/core";
import { CutsceneSequencePlayer, applyAccessibilityToCameraRigSpec } from "@ferrum2d/ferrum-web/authoring";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const cutsceneControls = `<div class="feature-buttons"><button data-control="play-cutscene">재생</button><button data-control="skip-cutscene">건너뛰기</button></div><label class="feature-check"><input type="checkbox" data-control="reduced-motion">동작 감소</label><output data-value="cutscene-audio" role="status">재생 버튼으로 오디오를 시작합니다.</output>`;

export function createCutsceneFeature(ctx: FeatureContext): FeatureExtra {
  const { root, signal } = ctx;
  const reduced = root.querySelector<HTMLInputElement>('[data-control="reduced-motion"]')!;
  const audioStatus = root.querySelector<HTMLOutputElement>('[data-value="cutscene-audio"]')!;
  const subtitle = document.createElement("p"); subtitle.className = "feature-system-status"; subtitle.setAttribute("role", "status");
  ctx.canvas.parentElement!.append(subtitle);
  const player = CutsceneSequencePlayer.create({ id: "tour", commands: [
    { kind: "dialogue", speaker: "안내", text: "왼쪽 로봇을 살펴봅니다.", durationSeconds: 1 },
    { kind: "camera", target: { x: 240, y: 192 }, durationSeconds: 1.4 },
    { kind: "audio", sound: 1, bus: "bgm", loop: false, volume: .2, durationSeconds: .3 },
    { kind: "dialogue", speaker: "안내", text: "오른쪽 표식으로 이동합니다.", durationSeconds: 1 },
    { kind: "camera", target: { x: 416, y: 192 }, durationSeconds: 1.4 },
    { kind: "dialogue", speaker: "안내", text: "둘러보기를 마쳤습니다.", durationSeconds: .7 },
  ] });
  const audio = new AudioManager();
  let target = { x: 320, y: 192 }, running = false, loading = false, audioEnabled = false, generation = 0, emitted = 0, audioCues = 0;
  let requestController: AbortController | undefined;
  const camera = () => ({ ...target, smoothTimeSeconds: applyAccessibilityToCameraRigSpec({ smoothTimeSeconds: .3 }, { reducedMotion: reduced.checked }).smoothTimeSeconds ?? 0 });
  const stopAudio = () => audio.stopBgm();
  const cancelPreparation = () => {
    generation++;
    requestController?.abort(); requestController = undefined;
    loading = false; audioEnabled = false;
  };
  const reset = () => {
    cancelPreparation(); running = false; player.reset(); target = { x: 320, y: 192 }; emitted = audioCues = 0;
    subtitle.textContent = "재생을 눌러 둘러보기를 시작하세요.";
    audioStatus.textContent = "재생 버튼으로 오디오를 시작합니다.";
    stopAudio();
  };
  root.querySelector('[data-control="play-cutscene"]')!.addEventListener("click", () => {
    if (!ctx.playing() || loading) return;
    reset(); const request = generation, controller = new AbortController();
    requestController = controller; loading = true;
    const current = () => !signal.aborted && !controller.signal.aborted && request === generation;
    // Unlock in the user gesture, then load once. Stale continuations never start a new tour.
    void (async () => {
      try {
        const unlocked = await audio.unlock();
        // Unlock cannot be aborted. Check ownership before starting any subsequent I/O.
        if (!current()) return;
        if (unlocked && !audio.hasSound(1)) {
          await audio.loadSound(1, new URL("./features/beacon.wav", document.baseURI).href, { signal: controller.signal });
        }
        if (!current()) return;
        audioEnabled = unlocked;
        audioStatus.textContent = unlocked ? "효과음 준비 완료" : "오디오 잠김 · 화면 연출만 재생합니다.";
      } catch (error) {
        if (!current()) return;
        audioStatus.textContent = `오디오 준비 실패: ${error instanceof Error ? error.message : String(error)}`;
      }
      if (!current()) return;
      requestController = undefined; loading = false; running = true; ctx.configureView();
    })();
  }, { signal });
  root.querySelector('[data-control="skip-cutscene"]')!.addEventListener("click", () => {
    cancelPreparation(); running = false; player.skip(); target = { x: 320, y: 192 };
    stopAudio(); subtitle.textContent = "둘러보기를 건너뛰었습니다.";
    audioStatus.textContent = "재생 버튼으로 다시 시작할 수 있습니다."; ctx.configureView();
  }, { signal });
  reduced.addEventListener("change", () => ctx.configureView(), { signal });
  return {
    reset, camera,
    frame: frame => {
      if (!running || !ctx.playing()) return;
      const result = player.update(frame.frameTimeMs / 1000);
      for (const event of result.events) {
        emitted++; const command = event.command;
        if (command.kind === "camera") { target = command.target; ctx.configureView(); }
        if (command.kind === "dialogue") subtitle.textContent = `${command.speaker}: ${command.text}`;
        if (command.kind === "audio" && audioEnabled) { audio.playBgm(1, { loop: command.loop, volume: command.volume }); audioCues++; }
      }
      if (result.completed) { running = false; stopAudio(); }
    },
    observation: () => `${loading ? "오디오 준비" : running ? "연출 중" : player.snapshot().completed ? "완료" : "대기"} · 단계 ${Math.min(6, player.snapshot().commandIndex + 1)} / 6 · 동작 감소 ${reduced.checked ? "켜짐" : "꺼짐"}`,
    snapshot: () => ({ cutscene: { ...player.snapshot(), running, loading, emitted, audioCues, reduced: reduced.checked, target: { ...target }, subtitle: subtitle.textContent } }),
    pause: paused => { if (paused) stopAudio(); },
    destroy: () => { cancelPreparation(); audio.destroy(); subtitle.remove(); },
  };
}
