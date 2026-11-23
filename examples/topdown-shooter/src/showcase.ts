import { createExampleHeader } from "../../shared/exampleHeader";
import { fold } from "../../shared/exampleFrame";

/** Presentation and platform controls only; gameplay and wave progression stay in Rust. */
export interface ShowcaseActions {
  start(): void;
  restart(): void;
  pause(paused: boolean): void;
  settings(): void;
}
export interface ShowcaseWave {
  index: number;
  name: string;
  elapsed: number;
  duration: number;
  spawned: number;
}
export interface ShowcaseFrame {
  gameState: number;
  score: number;
  entityCount: number;
  frameTimeMs: number;
  drawCalls: number;
}

export function createShooterShowcase(canvas: HTMLCanvasElement) {
  let activeCanvas = canvas;
  const root = document.createElement('main');
  root.className = 'shooter-shell';
  root.innerHTML = `
    <section class="demo-toolbar"><h1>Neon Outpost</h1><div class="example-run"><button type="button" data-action="restart" disabled>처음부터 다시 시작</button></div></section>
    <section class="shooter-layout demo-stage-layout">
      <div class="shooter-column">
        <div class="shooter-scoreboard" aria-label="게임 현황">
          <div><span class="shooter-status" role="status" aria-live="polite">준비 중</span><strong data-readout="score">0</strong><small>획득 점수</small></div>
          <div class="shooter-wave"><span data-readout="wave">WAVE 01</span><strong data-readout="enemy">외곽 경계</strong><div class="shooter-progress"><i></i></div><small data-readout="wave-detail">Game Spec 웨이브 불러오는 중</small></div>
          <button type="button" data-action="pause" disabled>일시정지 <kbd>P</kbd></button>
        </div>
        <div class="shooter-stage" data-state="loading">
          <div class="shooter-dialog" role="region" aria-label="플레이 안내">
            <p class="shooter-eyebrow">SECTOR 07 / DEFENSE PROTOCOL</p>
            <h2 data-readout="dialog-title">전초기지를 지켜주세요</h2>
            <p data-readout="dialog-body">엄폐물을 활용해 추적 드론을 피하고 에너지 탄환으로 격추하세요. 적과 접촉하면 방어가 종료됩니다.</p>
            <div class="shooter-dialog-controls"><span><kbd>W A S D</kbd> 이동</span><span><kbd>마우스</kbd> 조준</span><span><kbd>클릭 / Space</kbd> 발사</span></div>
            <button type="button" class="shooter-primary" data-action="start" disabled>에셋 준비 중…</button>
          </div>
        </div>
        <div class="shooter-footer"><p class="shooter-hint"></p><p class="shooter-touch-hint">패드로 이동 · 화면을 터치해 조준 · 발사 버튼으로 사격</p></div>
      </div>
      <aside class="shooter-sidebar"></aside>
    </section>`;
  root.prepend(createExampleHeader("topdown-shooter"));
  // Screen and sound settings fold inside "해 보기"; the briefing and the numbers wait in "더 보기".
  const settingsBox = document.createElement("div");
  settingsBox.className = "shooter-settings";
  settingsBox.innerHTML = `<label><input type="checkbox" data-setting="lighting" checked> 아레나 조명</label>
    <label><input type="checkbox" data-setting="effects" checked> 빛 번짐 · 비네트</label>
    <label><input type="checkbox" data-setting="motion"> 화면 흔들림 줄이기</label>
    <label><input type="checkbox" data-setting="mute"> 소리 끄기</label>
    <p class="example-hint">화면 설정은 게임 속도·충돌·점수에 영향을 주지 않습니다. 소리는 첫 입력 후 활성화됩니다.</p>`;
  const presentation = fold("화면과 소리 설정", settingsBox);
  root.querySelector(".shooter-sidebar")!.append(presentation);
  const briefing = document.createElement("section");
  briefing.className = "shooter-briefing";
  briefing.innerHTML = `<h3>작전 브리핑</h3><p>청록색 수비대와 붉은 드론을 구분하세요. 금속 엄폐물은 이동과 탄환을 막습니다.</p>
    <ol><li><strong>추적 드론</strong> 가볍고 빠른 적을 먼저 처리하세요.</li><li><strong>중장갑 드론</strong> 모서리에서 진입하며 여러 발을 견딥니다.</li><li><strong>선회 드론</strong> 주변을 맴도는 적을 미리 조준하세요.</li></ol>`;
  const telemetry = document.createElement("output");
  telemetry.className = "shooter-telemetry";
  telemetry.textContent = "Rust / Wasm · WebGL2";
  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing Shooter UI element: ${selector}`);
    return element;
  };
  const stage = get<HTMLDivElement>('.shooter-stage');
  stage.prepend(canvas);
  const overlay = get<HTMLDivElement>('.shooter-dialog');
  const start = get<HTMLButtonElement>('[data-action=start]');
  const pause = get<HTMLButtonElement>('[data-action=pause]');
  const restart = get<HTMLButtonElement>('[data-action=restart]');
  const status = get<HTMLSpanElement>('.shooter-status');
  const hint = get<HTMLParagraphElement>('.shooter-hint');
  const signal = new AbortController();
  let actions: ShowcaseActions | undefined;
  let state = 0;
  let paused = false;
  let busy = false;
  let score = 0;
  const setting = (key: string) => get<HTMLInputElement>(`[data-setting=${key}]`).checked;
  get<HTMLInputElement>('[data-setting=motion]').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const set = (key: string, value: string) => {
    const element = get<HTMLElement>(`[data-readout="${key}"]`);
    if (element.textContent !== value) element.textContent = value;
  };
  const updatePhase = () => {
    stage.dataset.state = paused ? 'paused' : state === 1 ? 'playing' : state === 2 ? 'gameover' : 'title';
    status.textContent = paused ? '일시정지' : state === 1 ? '방어 진행 중' : state === 2 ? '방어 종료' : '출격 준비';
    overlay.hidden = state === 1 && !paused;
    pause.disabled = busy || !actions || state !== 1;
    pause.textContent = paused ? '계속하기 (P)' : '일시정지 (P)';
    set('dialog-title', paused ? '잠시 작전을 멈췄습니다' : state === 2 ? '다시 도전할 준비가 됐나요?' : '전초기지를 지켜주세요');
    set('dialog-body', paused ? '계속하기를 누르면 같은 위치와 웨이브에서 이어집니다.' : state === 2 ? `최종 점수 ${score}. 엄폐물을 돌아 이동하며 붉은 드론과 거리를 유지하세요.` : '엄폐물을 활용해 추적 드론을 피하고 에너지 탄환으로 격추하세요. 적과 접촉하면 방어가 종료됩니다.');
    start.textContent = paused ? '작전 계속하기' : state === 2 ? '다시 출격' : '출격하기';
  };
  const togglePause = () => {
    if (busy || !actions || state !== 1) return;
    paused = !paused;
    actions.pause(paused);
    updatePhase();
    if (!paused) activeCanvas.focus({ preventScroll: true });
  };
  pause.addEventListener('click', togglePause, { signal: signal.signal });
  start.addEventListener('click', () => {
    if (busy || !actions) return;
    if (paused) togglePause(); else actions.start();
    activeCanvas.focus({ preventScroll: true });
  }, { signal: signal.signal });
  restart.addEventListener('click', () => {
    if (busy || !actions) return;
    if (paused) { paused = false; actions.pause(false); }
    actions.restart();
    updatePhase();
    activeCanvas.focus({ preventScroll: true });
  }, { signal: signal.signal });
  root.querySelectorAll<HTMLInputElement>('[data-setting]').forEach(input => input.addEventListener('change', () => { if (!busy) actions?.settings(); }, { signal: signal.signal }));
  window.addEventListener('keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (event.code === 'KeyP' || event.code === 'Escape') { event.preventDefault(); togglePause(); }
  }, { signal: signal.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 1 && !paused) togglePause(); }, { signal: signal.signal });
  return {
    root, stage, hint, presentation, briefing, telemetry,
    heading: get<HTMLHeadingElement>('.demo-toolbar h1'), layout: get<HTMLElement>('.shooter-layout'),
    column: get<HTMLDivElement>('.shooter-column'), sidebar: get<HTMLElement>('.shooter-sidebar'),
    setCanvas(next: HTMLCanvasElement) { activeCanvas = next; },
    setPaused(value: boolean) { paused = value; updatePhase(); },
    setBusy(value: boolean) { busy = value; start.disabled = busy || !actions; restart.disabled = busy || !actions; updatePhase(); },
    settings: () => ({ lighting: setting('lighting'), effects: setting('effects'), reducedMotion: setting('motion'), mute: setting('mute') }),
    connect(next: ShowcaseActions) { actions = next; start.disabled = false; restart.disabled = false; updatePhase(); },
    update(frame: ShowcaseFrame, wave?: ShowcaseWave) {
      const previous = state;
      state = frame.gameState; score = frame.score;
      set('score', String(score));
      telemetry.textContent = `${frame.entityCount} entities · ${frame.drawCalls} draws · ${Math.round(frame.frameTimeMs > 0 ? 1000 / frame.frameTimeMs : 0)} fps`;
      if (previous !== state) { paused = false; updatePhase(); }
      if (wave) {
        set('wave', `WAVE ${String(wave.index + 1).padStart(2, '0')}`);
        set('enemy', wave.name);
        set('wave-detail', wave.duration > 0 ? `출현 ${wave.spawned} · 경과 ${Math.floor(wave.elapsed)} / 최대 ${wave.duration}초` : `출현 ${wave.spawned} · 외곽 경계 유지`);
        get<HTMLElement>('.shooter-progress i').style.width = `${wave.duration > 0 ? Math.min(100, Math.max(0, wave.elapsed / wave.duration * 100)) : 100}%`;
      }
    },
    destroy() { signal.abort(); root.remove(); },
  };
}
