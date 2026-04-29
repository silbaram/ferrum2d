---
name: web-game-engine-platform
description: "Apply TypeScript/JavaScript web platform-layer conventions for Rust/Wasm-based browser game engines. Use whenever working on the JS/TS side of a browser game engine with a Rust/Wasm core — wasm-bindgen wrappers, WasmBridge classes, render command buffer consumers, WebGL2 sprite batchers, AssetLoader, AudioManager, GameLoop, InputManager, canvas resize/DPR handling, ImageBitmap pipelines, Vite + wasm-pack build setup, or the public engine API surface. Trigger for .ts/.js files in a browser engine context, wasm-bindgen, wasm-pack, WebGL2, WebGPU, requestAnimationFrame, OffscreenCanvas, AudioContext, ImageBitmap, render command, sprite batch, devicePixelRatio, canvas resize, Wasm linear memory, TypedArray view, or ptr/len bridging. Combine with rust-game-engine-conventions when both sides are involved. Err on the side of triggering — pitfalls here are easy to fall into and expensive to fix."
---

# Web Platform Layer for Rust/Wasm Game Engines

이 스킬은 **Rust/Wasm 코어 + TypeScript 브라우저 레이어** 구조의 웹 게임엔진에서 **TS 측을 작성/리뷰**할 때 적용. 자매 스킬 `rust-game-engine-conventions` (Rust 측)와 함께 활성화돼 있으면 양쪽 일관성을 갖추고 짠다.

## 사용 원칙

이 스킬을 **읽었으면 적용해.** TS/JS 코드를 생성/수정할 때 (특히 게임엔진 / Wasm interop / WebGL2 / 브라우저 게임 루프 맥락) 이 문서의 관례를 기본값으로 따른다. 일반 TypeScript 스타일은 `typescript` 스킬에 위임 — 여기서는 **웹 게임엔진 플랫폼 레이어 특화 결정**만 다룬다.

긴 코드 패턴 / 구현 예제는 `references/` 안에 있다. SKILL.md는 결정 기준과 핵심 규칙만 유지.

---

## 0. 핵심 의사결정 원칙

충돌 시 우선순위 순:

1. **책임 분리를 깨지 마라.** Rust = 게임 상태 / 계산, TS = 브라우저 API 호출. Rust에서 DOM/WebGL/AudioContext를 직접 만지지 않는다. TS에서 게임 로직을 구현하지 않는다.
2. **Wasm 경계 비용을 모든 결정의 기준으로.** 한 호출은 싸도, 매 프레임 60Hz × 엔티티 수 곱하면 폭발. **호출 횟수를 줄이고 데이터 묶음을 키워라.**
3. **메모리 view는 일회용.** Wasm linear memory가 grow되면 view가 detach된다. 매 프레임 새로 만든다.
4. **렌더 명령은 Rust가 만들고 TS가 소비.** 양쪽이 같은 메모리 레이아웃 — `repr(C)` + 빌드 타임 size assert.
5. **MVP는 단순함이 정답.** 추상화는 두 번째 구현체가 등장할 때 정당화. Renderer interface는 분리하되, 구현은 WebGL2 하나부터.

---

## 1. 책임 분리 — Rust vs TS 경계

| Rust (Wasm) | TypeScript |
|---|---|
| 게임 상태, 엔티티, Transform, Sprite 메타 | DOM, Canvas, `WebGL2RenderingContext` |
| Collider, 충돌 판정, 게임 로직 | 셰이더 컴파일, 텍스처 생성 |
| 시간 누적, 시뮬레이션 | `AudioContext`, 사운드 재생 |
| **render command 생성** | **render command 해석 → WebGL2 호출** |
| **audio event 생성** | Keyboard/Mouse/Pointer 이벤트 캡처 |
| | `fetch`, Image/JSON/Audio 로딩 |
| | `requestAnimationFrame`, Wasm 모듈 로드 |

### 경계가 깨지는 신호

- Rust에서 `web_sys::HtmlCanvasElement`, `web_sys::WebGl2RenderingContext` 직접 호출 — 거의 항상 잘못. 예외: `web_sys::console::log_1` 디버그 출력 정도.
- TS에서 entity 좌표 / 충돌 판정 / 게임 로직 — Rust로 옮긴다.
- 양쪽이 같은 데이터를 따로 보관 — single source of truth 원칙 위반.

### 권장 모듈 구조 (`engine-web` 패키지)

```
src/
├── index.ts                # public API
├── engine.ts               # Engine 클래스 — lifecycle 조정자
├── wasm/                   # Wasm 모듈 로드, 메모리 view, command 디코더
├── loop/                   # GameLoop, frame phase
├── renderer/
│   ├── Renderer.ts         # interface
│   └── webgl2/             # 구체 구현
├── input/                  # InputManager, keyMap
├── assets/                 # AssetLoader, TextureManager
├── audio/                  # AudioManager
├── canvas/                 # CanvasController (resize + DPR)
└── debug/                  # DebugOverlay
```

기능 기반 폴더링. `utils`, `helpers`, `common`은 안티패턴.

---

## 2. Wasm Interop — 핵심 규칙

### 2.1 호출 횟수 ≪ 데이터 크기

```ts
// ❌ 매 엔티티 호출 — 1000개면 프레임당 1000회 boundary crossing
for (const e of entities) engine.update_entity(e.id, e.x, e.y);

// ✅ 한 번에 묶어서 — boundary 1회
engine.update_all(delta);  // 모든 엔티티 처리는 Rust 안에서
```

원칙: **루프는 Rust 안에서.** TS는 한 번 부르고 결과 묶음을 받는다.

### 2.2 ptr / len 패턴

Rust가 `Vec<T>`의 ptr과 len을 노출, TS가 `TypedArray` view로 읽는다. **매 프레임 view를 새로 만든다** — Wasm memory가 grow하면 `wasmMemory.buffer`가 detach되어 보관된 view는 모두 무효 (`TypeError: detached ArrayBuffer`).

```ts
// 매 프레임
const ptr = engine.render_command_ptr();
const len = engine.render_command_len();
const view = new Float32Array(wasmMemory.buffer, ptr, len * FIELDS_PER_CMD);
renderer.consume(view, len);
```

상세 패턴 (grow 감지, 멤버 보관 vs 매번 생성 트레이드오프, generation handle): `references/wasm-interop.md` §1-2.

### 2.3 struct 레이아웃 — `#[repr(C)]` + 크기 검증

```rust
#[repr(C)]
pub struct SpriteRenderCommand { /* ... */ }
const _: () = assert!(std::mem::size_of::<SpriteRenderCommand>() == 48);
```

```ts
// init 첫 호출에 검증
console.assert(
  engine.sprite_command_size_bytes() === BYTES_PER_COMMAND,
  "SpriteRenderCommand size mismatch — Rust struct 변경됨?",
);
```

크기 상수를 양쪽에 박지 말고 Rust가 노출하는 size 함수로 init 시 검증. 한 번 어긋나면 스프라이트가 우주로 날아간다.

### 2.4 입력 — TS → Rust 한 번에

키별 setter 호출 (`set_key_w`, `set_mouse_x`, ...) 안 됨. `InputState` 단일 struct ptr을 받아 TS가 한 번에 채운다. 상세는 `references/wasm-interop.md` §3.

### 2.5 wasm-bindgen — 어디까지 쓸 것인가

| 상황 | 선택 |
|---|---|
| 한 번 호출되는 init / load_scene | wasm-bindgen 풀 활용 (String, struct) |
| 매 프레임 호출되는 update / 렌더 명령 | raw ptr/len + TypedArray view |
| 가끔 발생하는 이벤트 (씬 전환) | wasm-bindgen으로 OK |

`engine.update(delta)` 한 번 호출은 충분히 싸다 — **그 안에서 1000번 호출되는 게** 문제다.

---

## 3. 게임 루프

### 3.1 RAF + delta clamp

```ts
const loop = (now: number) => {
  if (!this.running) return;
  const delta = Math.min((now - this.previous) / 1000, 0.05);  // 50ms 상한
  this.previous = now;
  tick(delta, now);
  this.rafId = requestAnimationFrame(loop);
};
this.rafId = requestAnimationFrame(loop);
```

**필수 요소**:
- `requestAnimationFrame`은 한 프레임만 예약 — 콜백 안에서 다시 호출해야 계속 돈다.
- delta 단위는 **초** (`(ms) / 1000`). Rust 측이 `f32` 초로 받는 게 자연스럽다.
- delta clamp 50ms — 디버거 stop / tab hide 후 폭주 방지.
- `now`는 콜백 인자 사용 — `performance.now()` 다시 부르지 마.
- `cancelAnimationFrame`을 `stop()`에서 호출.

### 3.2 한 프레임 phase 순서

```
1. 입력 수집 (TS, 이벤트 → snapshot)
2. Wasm으로 입력 push (boundary 1회)
3. engine.update(delta) (Rust 안에서 모든 시스템)
4. 명령 buffer 읽기 (ptr/len, boundary 2회)
5. 렌더 (TS / WebGL2)
6. 사운드 재생 (TS / AudioContext)
7. engine.clear_events() (Rust 측 이벤트 버퍼 비우기)
8. 디버그 오버레이 갱신
```

이 순서가 깨지면 1프레임 지연 (입력 즉시 반영 안 됨, 렌더가 어제 상태).

fixed timestep 변형 / accumulator 패턴 / 결정성 요구 시: `references/browser-runtime.md` §1, 또는 `rust-game-engine-conventions/references/game-patterns.md` §4.

---

## 4. WebGL2 Renderer 핵심 규칙

### 4.1 자원은 init에 한 번 만들고 재사용

WebGL 자원 (program, VAO, buffer, texture)은 클래스 멤버로 영속. 매 프레임 `gl.create*()` 호출은 안티패턴. CPU staging buffer (`Float32Array`)도 멤버로 보관.

### 4.2 Sprite batching — texture_id 기준 그룹

같은 텍스처를 쓰는 연속 sprite를 한 draw call로:

```ts
// Rust가 layer 정렬 + texture_id 정렬을 끝낸 명령 buffer를 줌 (정렬은 Rust 안에서!)
let cur = -1, start = 0;
for (let i = 0; i < count; i++) {
  const tex = view[i * FIELDS + TEX_FIELD];
  if (tex !== cur) {
    if (cur !== -1) flushBatch(start, i, cur);
    cur = tex; start = i;
  }
}
if (cur !== -1) flushBatch(start, count, cur);
```

`flushBatch`는 vertex 데이터를 staging buffer에 채우고 `gl.bufferSubData` (재할당 X) → `gl.drawElements` 1회. 상세: `references/webgl2-renderer.md` §3.

### 4.3 텍스처 — `ImageBitmap` 우선

`HTMLImageElement` 대신 `createImageBitmap(blob)` — 디코딩이 메인스레드를 안 막고 워커 호환. `bitmap.close()`로 명시적 해제 (GC 의존 X).

### 4.4 Renderer interface — WebGPU 대비

```ts
export interface Renderer {
  readonly type: "webgl2" | "webgpu";
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  createTexture(id: number, image: ImageBitmap): void;
  render(commands: Float32Array, count: number, camera: Camera2D): void;
  destroy(): void;
}
```

MVP에서 구현체는 `WebGL2Renderer` 하나. interface로 분리하면 (a) WebGPU 추가 시 surface 안 깨짐, (b) `NullRenderer` 헤드리스 측정 가능, (c) 게임 코드의 `gl.*` 직접 호출 누수 차단.

상세 (셰이더, VAO 설정, 텍스처 atlas, blend state, MSAA, stats): `references/webgl2-renderer.md`.

---

## 5. 입력 처리

핵심 규칙:

- **`e.code` 사용** (`e.key` 아님). 레이아웃 의존성 차단.
- 마우스 좌표는 **canvas 백버퍼 픽셀로 변환** — `getBoundingClientRect`로 CSS→pixel 환산.
- **`preventDefault()`는 게임 키에만** — 모든 키에 박으면 개발자 도구가 안 열린다.
- `contextmenu` 막기 — 우클릭이 게임 입력일 때.
- pointer lock 게임은 `requestPointerLock()` + `mousemove`의 `movementX/Y`.

MVP는 raw key 상태를 그대로 Rust로 전달. action mapping (`MoveForward → KeyW | ArrowUp`)은 v0.2.

상세: `references/browser-runtime.md` §2.

---

## 6. 자산 / 오디오

### 6.1 매니페스트 + 병렬 로딩

`Promise.all`로 병렬. fail-fast가 단순. 부분 실패 허용이 필요하면 `Promise.allSettled`.

### 6.2 텍스처 ID — Rust 와 TS의 약속

Rust `Sprite.texture_id: u32` ↔ TS `TextureManager: Map<number, WebGLTexture>`. Rust는 텍스처가 뭔지 모른다 — ID만 안다. 로드 시 ID를 발급해 양쪽이 같은 ID로 참조. ID 0은 "missing texture" sentinel로 예약.

### 6.3 `AudioContext` lifecycle

브라우저 자동재생 정책: `AudioContext`는 user gesture 전에 `suspended` — 첫 클릭/키 입력에 `await ctx.resume()`. 게임 시작 버튼이 자연스러운 unlock 지점.

상세 (디코딩 파이프라인, gain group, BGM crossfade): `references/browser-runtime.md` §3-4.

---

## 7. Canvas / Resize / DPR

`devicePixelRatio` 처리는 거의 모든 게임이 한 번씩 틀린다. 핵심:

- **`canvas.width/height` (백버퍼 픽셀) ≠ `canvas.style.width/height` (CSS 픽셀)** — 다르게 두는 게 정상.
- 백버퍼: `Math.floor(rect.width * dpr)`. CSS는 그대로.
- `gl.viewport(0, 0, canvas.width, canvas.height)` — 백버퍼 크기 사용.
- 카메라 투영 행렬은 **CSS 픽셀 기준** — 모든 DPR에서 같은 게임 비율.
- **`ResizeObserver`**가 `window.resize`보다 정확 (canvas 자체 크기 변경 감지).

```ts
new ResizeObserver(() => {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width * dpr);
  const h = Math.floor(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    onResize(w, h, dpr);
  }
}).observe(canvas);
```

---

## 8. TypeScript 패턴 (엔진 레이어 특화)

`typescript` 스킬이 일반 TS를 다룬다. 여기는 **엔진 레이어에서만 자주 등장하는 패턴**.

### 8.1 핸들 — branded type

```ts
type TextureId = number & { readonly __brand: "TextureId" };
type SoundId = number & { readonly __brand: "SoundId" };
```

Rust newtype의 짝. `Sprite.texture_id`에 `SoundId`가 들어가는 사고를 컴파일러가 차단.

### 8.2 Wasm 모듈 타입 — 자동 생성에 의존

`wasm-pack`이 `.d.ts` 자동 생성. 손으로 다시 쓰지 마 — `import init, { Engine } from "../wasm/pkg/engine_core.js"`.

### 8.3 `as const` + 배열 → union

```ts
const RENDERER_TYPES = ["webgl2", "webgpu"] as const;
type RendererType = typeof RENDERER_TYPES[number];
```

런타임 값 ↔ 타입 single source. `enum`보다 단순, tree-shake도 잘 됨. **TS에서 `enum` 사용 지양**.

### 8.4 discriminated union — 명령 / 이벤트

```ts
type GameEvent =
  | { type: "score"; value: number }
  | { type: "playerDied" }
  | { type: "sceneChange"; to: SceneId };
```

`switch (e.type)` 안에서 자동 narrowing. exhaustiveness check는 `default: const _: never = e;`.

### 8.5 비동기 init — factory 패턴

생성자는 `async` 불가 (TS 제약). `await createEngine(opts)` 같은 factory 함수. 생성자 안에서는 `await` 못함을 기억.

### 8.6 `any` / `as` 사용 가이드

- **`any`는 거의 항상 잘못.** `unknown` + 타입 가드로.
- **`as`는 두 자리에서만 정당**: (1) branded type 생성 (`n as TextureId`), (2) DOM lookup (`querySelector("#game") as HTMLCanvasElement`). 그 외는 invariant 주석 필수.

상세 (extension 패턴, 모듈 export 전략, factory 변형): `references/typescript-patterns.md`.

---

## 9. 빌드 / 패키징

### 9.1 워크스페이스

`pnpm` workspace + `Cargo` workspace 병렬:

```
project/
├── Cargo.toml              # [workspace] members
├── crates/engine-core/     # Rust/Wasm
├── pnpm-workspace.yaml
├── packages/engine-web/    # TS library
└── examples/*/             # 소비자 앱
```

### 9.2 wasm-pack 통합

```bash
wasm-pack build --target web \
  --out-dir ../../packages/engine-web/wasm/pkg
```

- `--target web` — ES module, `<script type="module">`에 직접 import.
- output을 `engine-web` 안에 두면 import path 단순.
- `package.json`의 `"build:wasm"` 스크립트.

### 9.3 Vite library mode

`packages/engine-web`를 라이브러리로 publish: `vite.config.ts`에 `build.lib` 설정, format `["es"]`. `.wasm`은 `vite-plugin-wasm` 또는 `?init` import.

### 9.4 Profile

```toml
[profile.release]
opt-level = "s"      # WASM 사이즈 우선 (또는 3 — 속도)
lto = true
strip = true
```

페이지 로드 = WASM 사이즈에 직결. `wasm-pack`이 `wasm-opt`(binaryen) 후처리 자동.

---

## 10. 안티패턴

플랫폼 레이어에서 자주 등장하는 함정:

- **Wasm memory view를 멤버 필드로 보관** — grow되면 detach. 매 프레임 재생성.
- **매 프레임 또는 매 엔티티 `engine.do_thing()` 호출** — boundary 폭발. 묶어서.
- **TS에서 게임 좌표 / 충돌 / 게임 로직 구현** — Rust로 옮긴다.
- **Rust에서 `web_sys::WebGl*`, `web_sys::Document` 직접 사용** — TS로.
- **WebGL 자원을 매 프레임 `gl.create*()`** — init에 한 번.
- **`bufferData` 매번 호출** (재할당) — `bufferSubData` 사용.
- **`HTMLImageElement`로 텍스처 업로드** — `ImageBitmap`이 더 빠르고 워커 호환.
- **`canvas.style.width/height`만 설정하고 `canvas.width/height`는 잊음** — 흐릿하게 그려짐.
- **`gl.viewport`를 `canvas.style.width`로 호출** — 백버퍼와 어긋남.
- **`AudioContext`를 user gesture 전에 만들고 unlock 안 함** — Chrome/Safari 묵음.
- **`e.key`로 키 매칭** — 레이아웃 의존. `e.code` 사용.
- **`requestAnimationFrame` 콜백 안에서 다음 RAF를 안 부름** — 1프레임만 그림.
- **`delta`를 클램프 안 함** — 디버거 stop / tab hide 후 폭주.
- **TS `enum` 사용** — `as const` 배열 + union 권장.
- **`any` 사용** — `unknown` + 가드로.
- **JSON 객체로 Rust에 매 프레임 데이터 전달** — 직렬화/역직렬화 비용. TypedArray + struct로.

---

## 11. 코드 리뷰 체크리스트

웹 플랫폼 레이어 PR 리뷰 시 이 순서로:

1. `tsc --noEmit` clean한가? strict 모드인가?
2. `any`가 도입됐는가? 정당한가?
3. **Rust 경계 호출 횟수가 프레임당 일정한가** (entity 수에 비례하지 않는가)?
4. Wasm memory view를 영속 보관하는 코드가 있는가?
5. WebGL 자원이 매 프레임 새로 생성되는가?
6. `gl.viewport`가 백버퍼 크기를 받는가?
7. DPR / resize 핸들링이 있는가? `canvas.width` ≠ `canvas.style.width` 이해?
8. `AudioContext` unlock 경로가 있는가?
9. delta clamp가 있는가?
10. `e.code` 사용 (`e.key` 아님)?
11. branded type / 핸들 패턴이 사용됐는가? raw `number`로 ID가 떠다니는가?
12. **TS에서 게임 로직 누출**이 있는가? Rust로 옮길 수 있는가?
13. 셰이더 컴파일이 init에서 일어나는가?
14. Renderer interface를 통해 호출하는가, `gl.*`이 다른 모듈에 노출됐는가?
15. `await fetch(url)` 등 비동기 에러 처리가 있는가?

---

## 12. 참조 파일

- **`references/wasm-interop.md`** — ptr/len 패턴, struct 레이아웃, 메모리 grow 처리, generation handle, wasm-bindgen vs raw ABI 트레이드오프, 입력/렌더/오디오 buffer 디테일.
- **`references/webgl2-renderer.md`** — 셰이더 컴파일, VAO 설정, sprite batch 구현, 텍스처 atlas, dynamic vertex buffer, draw call / batch stats, blend state.
- **`references/browser-runtime.md`** — RAF 루프 변형, fixed timestep, 입력 캡처 (pointer lock 포함), 자산 로딩 파이프라인, AudioContext lifecycle, ResizeObserver + DPR.
- **`references/typescript-patterns.md`** — 엔진 레이어 특화 TS idiom: branded types, discriminated unions, `as const`, factory 패턴, 비동기 init, 모듈 export 전략.

매번 다 읽지 않는다 — 작업이 그 영역에 깊이 들어갈 때 해당 파일을 `view`.

---

## 자매 스킬 / 외부 참조

- **`rust-game-engine-conventions`** — 짝이 되는 Rust 측 스킬. 양쪽 일관성을 위해 함께 적용.
- **`typescript`** — 일반 TypeScript 스타일은 거기 위임.
- [MDN Web APIs](https://developer.mozilla.org/en-US/docs/Web/API), [`wasm-bindgen` Guide](https://rustwasm.github.io/docs/wasm-bindgen/), [`wasm-pack` Docs](https://rustwasm.github.io/docs/wasm-pack/), [WebGL2 Fundamentals](https://webgl2fundamentals.org/).

외부 자료와 본 스킬이 충돌하면 **본 스킬이 우선** — 게임엔진 플랫폼 레이어 특화 결정이 들어 있다. 일반 WebGL2 / TS 사용은 외부 자료를 따른다.