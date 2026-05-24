# Ferrum2D 아키텍처

Ferrum2D는 Rust core가 게임 상태와 시뮬레이션을 소유하고, TypeScript platform layer가 브라우저 API를 다루며, renderer가 Rust에서 만든 command buffer를 소비하는 2D 웹 게임 엔진이다.

현재 단계는 **MVP 개발 완료, 상용제품 기능 개발**이다. 기준 예제는 `examples/minimal-game`, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`다.

## 기준 소스

| 영역 | 코드 기준 |
| --- | --- |
| Rust crate export | `crates/ferrum-core/src/lib.rs` |
| Engine/Wasm API | `crates/ferrum-core/src/engine.rs` |
| World/component/physics | `crates/ferrum-core/src/world.rs`, `components.rs`, `collision.rs`, `physics.rs`, `tilemap.rs` |
| Render/audio/ABI layout | `render_command.rs`, `audio_event.rs`, `collision_event.rs`, `packages/ferrum-web/src/wasmBridge.ts` |
| Web public entrypoint | `packages/ferrum-web/src/index.ts` |
| Runtime/API wrapper | `packages/ferrum-web/src/createEngine.ts`, `createFerrumRuntime.ts` |
| Renderer | `packages/ferrum-web/src/createRenderer.ts`, `webgl2Renderer.ts`, `renderer.ts` |
| Game Spec | `packages/ferrum-web/src/gameSpec.ts`, `schemas/shooter-game-spec.schema.json` |

문서와 코드가 충돌하면 위 코드 기준을 먼저 따른다.

## 책임 경계

### Rust core

Rust core는 플랫폼 독립적인 상태와 계산을 소유한다.

- scene state, score, game over/restart, entity lifecycle
- `World` component 저장소: transform, velocity, sprite, collider, rigid body, joint
- collision/physics/tilemap query, kinematic movement, opt-in rigid body solver
- camera preset, particle/tween system, shooter/breakout/platformer scene logic
- render command, audio event, collision event, physics debug/query buffer 생성

Rust core는 DOM, Canvas, WebGL, Web Audio, `fetch`를 호출하지 않는다.

### Wasm boundary

프레임 hot path는 entity별 JS/Wasm 왕복 호출을 만들지 않는다.

```text
input snapshot -> Engine.set_input(...)
viewport       -> Engine.set_viewport_size(...)
frame update   -> Engine.update(delta_seconds)
render         -> render_command_ptr()/render_command_len()
audio          -> audio_event_ptr()/audio_event_len()
events/debug   -> collision/physics buffer ptr + len
```

Game Spec, asset metadata, physics authoring 같은 낮은 빈도의 설정은 TypeScript에서 검증한 뒤 숫자형 값이나 bulk buffer 형태로 Rust에 전달한다.

### TypeScript platform layer

TypeScript는 브라우저와 package-facing API를 담당한다.

- Wasm module 초기화와 `FerrumEngine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer/touch/gamepad 입력 snapshot 생성
- texture/sound/JSON asset 로딩, Aseprite/Tiled/LDtk import helper
- WebGL2 texture/audio registry, `AudioManager`, `UiOverlay`, `DebugOverlay`
- Wasm buffer를 typed array/DataView로 읽고 필요한 경우에만 object view로 decode

TypeScript는 게임 규칙의 source of truth를 소유하지 않는다.

### Renderer

제품 기준 renderer는 WebGL2다. `createRenderer(...)`는 `preferred: "webgpu"`가 들어와도 WebGL2로 fallback한다. `WebGPURenderer` export와 관련 option은 호환/진단용으로 남아 있으며 현재 제품 범위의 구현 기준이 아니다.

## 프레임 순서

```text
Browser input events
  -> InputManager.snapshot()
  -> Engine.set_input(...)
  -> Engine.update(delta_seconds)
  -> WasmBridge reads render/audio/collision/debug buffers
  -> WebGL2Renderer.render()
  -> AudioManager.play()
  -> UiOverlay / DebugOverlay update
  -> Engine.clear_audio_events()
```

`FrameState`는 렌더링, HUD, debug에 필요한 snapshot이다. 게임 상태를 장기 보관하거나 TypeScript에서 별도 simulation state로 복제하지 않는다.

## ABI와 데이터 포맷

Rust/TypeScript 공유 buffer는 `#[repr(C)]` Rust struct와 TypeScript decoder가 함께 맞아야 한다.

| Buffer | Rust 기준 | TypeScript 기준 | 용도 |
| --- | --- | --- | --- |
| Sprite render command | `render_command.rs` | `renderCommandDecoder.ts`, `wasmBridge.ts` | WebGL2 sprite batch 입력 |
| Audio event | `audio_event.rs` | `wasmBridge.ts`, `audioManager.ts` | frame 단위 sound playback |
| Collision event | `collision_event.rs` | `collisionEventDecoder.ts`, `wasmBridge.ts` | enter/stay/exit/hit/trigger event |
| Physics debug line | `collision.rs` | `physicsDebugLineDecoder.ts` | opt-in physics debug rendering |
| Physics query results | `engine.rs`, `collision.rs`, `tilemap.rs` | `physicsQueryDecoder.ts`, `createEngine.ts` | body/tile query, shape cast, contact/manifold |

공유 layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.

## Runtime/API 구성

`@ferrum2d/ferrum-web`의 public entrypoint는 `packages/ferrum-web/src/index.ts`다. 주요 runtime API는 [Public API](../../engine/public-api.md)에 둔다.

- `createEngine(...)`: Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶는다.
- `createFerrumRuntime(...)`: browser canvas, WebGL2 renderer, input, asset/audio host, UI/debug overlay를 포함한 제품용 runtime을 만든다.
- `createRenderer(...)`: WebGL2 renderer를 생성한다. WebGPU 선호 옵션은 WebGL2 fallback 진단용이다.
- `applyShooterGameSpec(...)` / `resolveShooterGameSpec(...)`: Top-down Shooter Game Spec 검증과 Rust 적용 계약을 담당한다.

## 주요 기능 경계

| 영역 | 현재 기준 |
| --- | --- |
| Scene | Shooter, Breakout, Platformer, Minimal starter 예제 |
| Input | keyboard/mouse/pointer/touch/gamepad snapshot |
| Rendering | Rust render command buffer + WebGL2 sprite/debug line pass |
| Assets | texture/sound/JSON manifest, Aseprite/Tiled/LDtk import helper |
| UI | DOM 기반 `UiOverlay`, 개발용 `DebugOverlay` |
| Physics | 자세한 범위는 [2D 물리엔진 기능 맵](physics-engine.md) |
| Effects | Rust particle/tween primitive와 Web runtime 연결 |
| Packaging | npm package/release 검증은 [npm 베타 패키징](../operations/npm-release.md) |

## 현재 제품 범위 밖

다음은 별도 설계/승인 전 제품 기능으로 확장하지 않는다.

- WebGPU renderer 활성화
- Web Worker/멀티스레드 frame loop
- editor
- multiplayer
- 3D rendering
- skeletal animation
- 외부 physics engine 의존성
- frame hot path의 entity별 JS/Wasm callback

## 검증 경계

문서만 바뀌면 Markdown 링크 검사와 `pnpm build:pages`를 우선 실행한다. 코드나 public API가 바뀌면 범위에 맞춰 다음을 추가한다.

- Rust core: `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- Wasm/API: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`
- Game Spec: `pnpm validate:game-spec`
- 예제 회귀: [Smoke Check](../quality/smoke-check.md), [Top-down Shooter 수동 체크리스트](../quality/topdown-shooter-smoke-checklist.md)
