# Browser Runtime 패턴

게임 루프, 입력 캡처, 자산 / 오디오 로딩, canvas resize/DPR 처리의 구체 패턴. SKILL.md §3, §5-7의 결정 기준을 코드 레벨로 풀어둔다.

## 목차

1. Game loop — RAF 변형 / fixed timestep
2. Input — keyboard / mouse / pointer lock / gamepad
3. Asset loading 파이프라인
4. AudioContext lifecycle
5. Canvas / DPR / ResizeObserver
6. Visibility / focus 처리
7. 성능 측정 — `performance.now()`, DevTools

---

## 1. Game loop — RAF 변형 / fixed timestep

### 1.1 기본 RAF (variable timestep)

MVP에 권장. 단순하고 충분.

```ts
class GameLoop {
  private rafId = 0;
  private previous = 0;
  private running = false;

  start(tick: (delta: number, now: number) => void): void {
    this.running = true;
    this.previous = performance.now();

    const loop = (now: number): void => {
      if (!this.running) return;
      const delta = Math.min((now - this.previous) / 1000, 0.05);
      this.previous = now;
      tick(delta, now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}
```

### 1.2 Fixed timestep (accumulator)

물리 결정성 / 네트워크 lockstep / 리플레이 필요 시. variable timestep만 쓰면 같은 입력이라도 frame_dt 변동에 따라 결과가 달라져 결정성 깨짐.

```ts
class FixedTimestepLoop {
  private accumulator = 0;
  private readonly fixedDt = 1 / 60;  // 60Hz simulation
  private previous = 0;

  start(
    fixedUpdate: (dt: number) => void,
    render: (alpha: number) => void,
  ): void {
    const loop = (now: number): void => {
      if (!this.running) return;
      const frameDt = Math.min((now - this.previous) / 1000, 0.25);
      this.previous = now;
      this.accumulator += frameDt;

      while (this.accumulator >= this.fixedDt) {
        fixedUpdate(this.fixedDt);
        this.accumulator -= this.fixedDt;
      }

      const alpha = this.accumulator / this.fixedDt;  // 0..1
      render(alpha);

      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
```

`alpha`로 보간 — 마지막 두 시뮬레이션 상태 사이를 lerp해서 부드럽게.

`frameDt`를 0.25s로 클램프 — 디버거 stop / 탭 hide 후 복귀 시 accumulator 폭주 ("spiral of death") 방지.

MVP는 variable로 충분. 적이 일정 속도로 움직이는 슈터에서 0.5Hz 차이는 체감 안 됨. v0.2부터 fixed 검토.

### 1.3 RAF 콜백 timestamp

```ts
const loop = (now: number) => { /* ... */ };
requestAnimationFrame(loop);
```

`now`는 `performance.now()`와 같은 단위 (ms, fractional). **콜백 안에서 다시 `performance.now()` 부르지 마** — `now`는 이미 그 프레임 시작 직전의 정확한 값이고, 한 번 더 호출하면 다른 값이 나와 두 부분이 다른 시간을 본다.

### 1.4 RAF 첫 호출의 `previous` 초기화

위 코드에서 `start()` 안에서 `this.previous = performance.now()` 한 후 RAF 등록. 첫 콜백의 `now - previous` 차이가 이론적으로 매우 작거나 음수 (렌더 단계 시작 직전) — `Math.min(..., 0.05)`로 클램프되니 문제 없지만, 첫 프레임이 `delta = 0`에 가까울 수 있다는 점 인지.

대안: 첫 프레임은 `delta = 1/60` 가정해서 zero-delta case를 우회.

---

## 2. Input — keyboard / mouse / pointer lock / gamepad

### 2.1 InputManager 기본

```ts
export class InputManager {
  private keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private mouseButtons = 0;  // bitmask
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;

  attach(canvas: HTMLCanvasElement): void {
    // Keyboard — window에 등록 (canvas는 기본 포커스 못 받음)
    window.addEventListener("keydown", (e) => {
      if (this.shouldPreventDefault(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
    });

    // Mouse — canvas에 등록
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      // CSS px → canvas backbuffer px
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      this.mouseX = (e.clientX - rect.left) * scaleX;
      this.mouseY = (e.clientY - rect.top) * scaleY;
      this.mouseDeltaX += e.movementX * scaleX;
      this.mouseDeltaY += e.movementY * scaleY;
    });
    canvas.addEventListener("mousedown", (e) => {
      this.mouseButtons |= 1 << e.button;
      canvas.focus();  // canvas tabindex="0" 필요
    });
    canvas.addEventListener("mouseup", (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Focus 잃을 때 키 상태 리셋 (stuck key 방지)
    window.addEventListener("blur", () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
  }

  private shouldPreventDefault(code: string): boolean {
    // 게임 키만 — 모든 키 막으면 DevTools 단축키 (F12 등) 차단
    return ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code);
  }

  snapshot(): InputSnapshot {
    const snap: InputSnapshot = {
      keys: new Set(this.keys),
      mouseX: this.mouseX,
      mouseY: this.mouseY,
      mouseButtons: this.mouseButtons,
      mouseDeltaX: this.mouseDeltaX,
      mouseDeltaY: this.mouseDeltaY,
    };
    // delta는 한 프레임에만 누적, 읽고 나면 0으로
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return snap;
  }
}
```

핵심:
- **`e.code`** (`"KeyW"`, `"Space"`) — 물리 키. `e.key`는 `"w"` / `"W"` 레이아웃 변동.
- **`e.button`** — 0=좌, 1=중, 2=우.
- **`e.movementX/Y`** — 누적 이동량 (pointer lock에서 특히 유용).
- **`window.blur` 시 리셋** — 게임 도중 Alt+Tab하면 keyup이 안 와서 key가 stuck. blur에서 강제 clear.
- **`canvas.tabindex`** — HTML에서 `<canvas tabindex="0">`이어야 focus 가능. 그래야 keyup/keydown이 canvas 기준으로 작동 (혹은 위처럼 window-level 등록).

### 2.2 Pointer lock — FPS / mouselook

```ts
canvas.addEventListener("click", () => {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock();
  }
});

document.addEventListener("pointerlockchange", () => {
  this.isLocked = document.pointerLockElement === canvas;
});
```

lock 상태에서는 `mousemove`의 `clientX/Y`는 동결, `movementX/Y`만 의미 있음. 마우스 룩 / 무한 회전 게임에 필수.

### 2.3 Gamepad

```ts
function pollGamepad(): GamepadState | null {
  const pads = navigator.getGamepads();
  for (const pad of pads) {
    if (pad?.connected) {
      return {
        leftStickX: pad.axes[0],
        leftStickY: pad.axes[1],
        buttonA: pad.buttons[0].pressed,
        // ...
      };
    }
  }
  return null;
}
```

매 프레임 polling. 이벤트 모델 아님 (`gamepadconnected` 이벤트는 연결/해제만).

MVP 범위 외. v0.2 이후.

### 2.4 Touch

모바일 지원 시. `pointerdown/move/up`이 마우스/터치 통합 — 첫 구현이라면 pointer events 우선.

```ts
canvas.addEventListener("pointerdown", (e) => {
  // e.pointerType: "mouse" | "pen" | "touch"
});
```

멀티터치는 pointerId로 구분. MVP 외.

---

## 3. Asset loading 파이프라인

### 3.1 매니페스트 기반 병렬 로딩

```ts
type AssetManifest = {
  textures?: Record<string, string>;
  sounds?: Record<string, string>;
  json?: Record<string, string>;
};

export async function loadAssets(
  manifest: AssetManifest,
  textureManager: TextureManager,
  audioManager: AudioManager,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const tasks: Promise<void>[] = [];
  let loaded = 0;
  const total =
    Object.keys(manifest.textures ?? {}).length +
    Object.keys(manifest.sounds ?? {}).length +
    Object.keys(manifest.json ?? {}).length;

  const tick = () => onProgress?.(++loaded, total);

  for (const [name, url] of Object.entries(manifest.textures ?? {})) {
    tasks.push(textureManager.load(name, url).then(tick));
  }
  for (const [name, url] of Object.entries(manifest.sounds ?? {})) {
    tasks.push(audioManager.load(name, url).then(tick));
  }
  for (const [name, url] of Object.entries(manifest.json ?? {})) {
    tasks.push(loadJson(name, url).then(tick));
  }

  await Promise.all(tasks);
}
```

`Promise.all` — 한 자산 실패하면 전체 거부 (fail-fast). 부분 실패 허용은 `Promise.allSettled` + 결과 검사.

### 3.2 Fetch 에러 처리

```ts
async function loadJson(name: string, url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to load ${url}: ${r.status} ${r.statusText}`);
  return r.json();
}
```

`fetch`는 4xx/5xx에서도 reject 안 함 — `r.ok` 체크 필수. `r.json()`은 invalid JSON 시 reject.

### 3.3 Progressive loading

큰 게임에서는 씬별로 자산 분할:

```ts
class AssetGroup {
  private loaded = false;
  constructor(private manifest: AssetManifest) {}

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await loadAssets(this.manifest, /* ... */);
    this.loaded = true;
  }
}

const sceneAssets = new AssetGroup({
  textures: { /* 이 씬 전용 */ },
});

await sceneAssets.ensureLoaded();
engine.loadScene("level1");
```

### 3.4 캐싱 — 브라우저에 위임

`fetch`는 HTTP 캐시 자동 활용. Cache-Control 헤더가 적절하면 두 번째 로드는 디스크 캐시 즉시 반환. 별도 IndexedDB 캐시는 MVP 단계에서 불필요 — 측정 후 도입.

---

## 4. AudioContext lifecycle

### 4.1 생성 + unlock

```ts
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<number, AudioBuffer>();

  ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // user gesture 핸들러에서 호출 (버튼 클릭 등)
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state === "suspended") await ctx.resume();
  }

  async load(name: string, url: string): Promise<SoundId> {
    const ctx = this.ensureContext();
    const ab = await fetch(url).then((r) => {
      if (!r.ok) throw new Error(`audio load failed: ${url}`);
      return r.arrayBuffer();
    });
    const buf = await ctx.decodeAudioData(ab);
    const id = this.nextId++;
    this.buffers.set(id, buf);
    this.nameToId.set(name, id);
    return id as SoundId;
  }

  play(id: SoundId, opts: { volume?: number; pitch?: number; loop?: boolean } = {}): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;  // unlock 전에는 무음
    const buf = this.buffers.get(id);
    if (!buf) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop ?? false;
    src.playbackRate.value = opts.pitch ?? 1.0;

    const gain = ctx.createGain();
    gain.gain.value = opts.volume ?? 1.0;

    src.connect(gain).connect(this.master!);
    src.start();
  }
}
```

### 4.2 자동재생 정책

브라우저는 user gesture 전 `AudioContext` 생성을 허용하지만 `suspended` 상태로 시작. `resume()`은 user gesture 안에서 호출해야 promise resolve. user gesture: click, keydown, touchstart.

자연스러운 unlock 지점: 게임 시작 버튼, 첫 클릭/키 입력. 디테일:

```ts
// 첫 입력으로 한 번만 unlock
const onFirstInput = async () => {
  await audio.unlock();
  window.removeEventListener("click", onFirstInput);
  window.removeEventListener("keydown", onFirstInput);
};
window.addEventListener("click", onFirstInput);
window.addEventListener("keydown", onFirstInput);
```

### 4.3 BGM — looping + crossfade

```ts
class MusicPlayer {
  private current: AudioBufferSourceNode | null = null;
  private currentGain: GainNode | null = null;

  async play(id: SoundId, fadeMs = 500): Promise<void> {
    const ctx = this.audio.ensureContext();
    const now = ctx.currentTime;

    // 이전 곡 페이드아웃
    if (this.currentGain && this.current) {
      this.currentGain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
      this.current.stop(now + fadeMs / 1000);
    }

    // 새 곡 페이드인
    const buf = this.audio.bufferOf(id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeMs / 1000);
    src.connect(gain).connect(this.audio.bgmGroup);
    src.start();

    this.current = src;
    this.currentGain = gain;
  }
}
```

`AudioParam.linearRampToValueAtTime`은 시간 기반 자동화 — JS에서 매 프레임 volume 조절보다 정확하고 효율적.

### 4.4 Volume groups

```ts
class AudioManager {
  bgmGroup: GainNode;
  sfxGroup: GainNode;
  master: GainNode;

  constructor(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.bgmGroup = ctx.createGain();
    this.sfxGroup = ctx.createGain();
    this.bgmGroup.connect(this.master);
    this.sfxGroup.connect(this.master);
    this.master.connect(ctx.destination);
  }
}
```

설정 화면에서 `bgmGroup.gain.value = 0.3` 같은 식으로 그룹별 음량 조절.

---

## 5. Canvas / DPR / ResizeObserver

### 5.1 Backbuffer 크기 = CSS 크기 × DPR

```ts
export class CanvasController {
  private observer?: ResizeObserver;

  attach(
    canvas: HTMLCanvasElement,
    onResize: (backbufferW: number, backbufferH: number, dpr: number) => void,
  ): void {
    const apply = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        onResize(w, h, dpr);
      }
    };

    this.observer = new ResizeObserver(apply);
    this.observer.observe(canvas);
    apply();
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
```

### 5.2 onResize 핸들러

```ts
function onResize(backW: number, backH: number, dpr: number): void {
  gl.viewport(0, 0, backW, backH);
  // CSS 픽셀 단위로 카메라 — DPR 무관하게 같은 게임 비율
  camera.viewportWidth = backW / dpr;
  camera.viewportHeight = backH / dpr;
}
```

`gl.viewport`는 backbuffer 픽셀 (DPR 적용된 큰 값). 카메라 투영 행렬 입력은 CSS 픽셀 (DPR 무관) — 사용자가 화면을 키우면 더 많이 보이는 게 아니라 더 선명해질 뿐.

### 5.3 zoom in browser (Ctrl+/+)

브라우저 zoom은 `devicePixelRatio` 변경으로 반영됨 (Chrome 등). `ResizeObserver`가 callback을 트리거 — 자동 처리.

`window.matchMedia(\`(resolution: ${dpr}dppx)\`).addEventListener("change")`로 DPR 변경 감지도 가능 (드물게 ResizeObserver가 안 잡는 경우).

### 5.4 fullscreen API

```ts
async function enterFullscreen(canvas: HTMLCanvasElement): Promise<void> {
  if (!document.fullscreenElement) {
    await canvas.requestFullscreen();
  }
}
document.addEventListener("fullscreenchange", () => {
  // ResizeObserver가 자동으로 새 크기 반영
});
```

`requestFullscreen`은 user gesture 안에서만 호출 가능. button click 핸들러에서.

---

## 6. Visibility / focus 처리

### 6.1 탭 hide → 게임 일시정지

```ts
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    engine.pause();
  } else {
    engine.resume();
  }
});
```

탭이 백그라운드면 RAF는 1Hz로 throttle (Chrome) — 그래도 멈추는 게 정확. 또한 hide 동안 키 입력이 안 와서 stuck key 위험.

### 6.2 window blur → 키 리셋

위 InputManager §2.1에 포함.

---

## 7. 성능 측정

### 7.1 `performance.now()`

```ts
const t0 = performance.now();
doExpensiveWork();
const elapsed = performance.now() - t0;
console.log(`took ${elapsed.toFixed(2)}ms`);
```

ms 단위, fractional. 단조 증가 (시스템 시계 변경 영향 X).

### 7.2 Frame breakdown

```ts
function frame(now: number): void {
  const t0 = performance.now();
  inputManager.collect();

  const t1 = performance.now();
  bridge.writeInput(inputManager.snapshot());
  engine.update(delta);

  const t2 = performance.now();
  const cmds = bridge.readRenderCommands();
  renderer.render(cmds, camera);

  const t3 = performance.now();

  stats.inputMs = t1 - t0;
  stats.updateMs = t2 - t1;
  stats.renderMs = t3 - t2;
  stats.totalMs = t3 - t0;
}
```

매 프레임 측정 후 DebugOverlay에 표시. 60fps 목표 → 16.67ms 예산. 어디서 깨지는지 즉시 식별.

### 7.3 DevTools Performance tab

Chrome / Firefox: Performance recording → flame chart. JS 시간 / 렌더 시간 / GC pause 명확.

User Timing API로 mark/measure 추가:

```ts
performance.mark("update-start");
engine.update(delta);
performance.mark("update-end");
performance.measure("update", "update-start", "update-end");
```

Performance tab에 `update` 구간이 표시됨.

### 7.4 `requestVideoFrameCallback` (참고)

비디오 동기화용. 게임엔진에서는 거의 사용 안 함 — RAF가 표준.

---

## 참고

- [`requestAnimationFrame` (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) — fixed timestep 결정판.
- [Web Audio API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — AudioContext, AudioParam.
- [Pointer Events (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) — touch / mouse 통합.
- [HiDPI Canvas (HTML Rocks)](https://www.html5rocks.com/en/tutorials/canvas/hidpi/) — DPR 처리 표준 자료.