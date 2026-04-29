# Ferrum2D 아키텍처 (MVP)

## 개요

Ferrum2D MVP는 Rust core가 시뮬레이션을 소유하고, TypeScript 플랫폼 레이어가 브라우저 API를 다루며, WebGL2 렌더러가 Rust의 render command buffer를 소비하는 구조다.

현재 구현은 Top-down Shooter MVP를 기준으로 검증한다.

```text
Input DOM events
  -> TypeScript InputManager snapshot
  -> Wasm Engine.set_input(...)
  -> Rust Engine.update(delta)
  -> RenderCommand buffer + AudioEvent buffer
  -> TypeScript WasmBridge typed array view
  -> WebGL2Renderer + AudioManager
  -> DebugOverlay
```

## 레이어

### Rust core

위치: `crates/ferrum-core`

역할:

- 게임 시간, scene state, score, player/enemy/bullet 상태 관리
- entity id, transform, velocity, sprite, collider 저장
- AABB 충돌 판정과 entity despawn 처리
- enemy spawn, chase, bullet lifetime, game over, restart 처리
- render command와 audio event 생성

Rust core는 DOM, Canvas, WebGL, Web Audio, fetch 같은 브라우저 API를 직접 호출하지 않는다.

### WebAssembly 경계

Rust는 wasm-bindgen으로 브라우저에서 호출 가능한 `Engine`을 노출한다. 프레임 hot path에서는 entity별 JS/Wasm 왕복 호출을 만들지 않고 다음 형태를 사용한다.

- 입력: TypeScript가 프레임마다 snapshot 값을 `set_input(...)`으로 한 번 전달한다.
- 업데이트: `update(delta_seconds)` 한 번으로 Rust 내부 루프를 실행한다.
- 렌더링: `render_command_ptr()`와 `render_command_len()`으로 bulk buffer를 노출한다.
- 오디오: `audio_event_ptr()`와 `audio_event_len()`으로 bulk buffer를 노출한다.
- 이벤트 정리: TypeScript가 오디오 이벤트를 읽고 재생한 뒤 `clear_events()`를 호출한다.

### TypeScript 플랫폼 레이어

위치: `packages/ferrum-web`

역할:

- Wasm module 초기화와 Rust `Engine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer 입력 수집
- texture, sound, JSON manifest 로딩
- `texture_id`와 `WebGLTexture` 매핑
- `sound_id`와 `AudioBuffer` 매핑
- render/audio buffer를 typed array view로 읽기
- DebugOverlay DOM 갱신

TypeScript는 플랫폼 상태를 다루지만 게임 규칙의 single source of truth를 소유하지 않는다. 플레이어 이동 규칙, 충돌, 점수, game over는 Rust core에 둔다.

### WebGL2 렌더러

위치: `packages/ferrum-web/src/webgl2Renderer.ts`, `spriteBatch.ts`, `textureManager.ts`

역할:

- WebGL2 context와 GPU resource 관리
- `SpriteRenderCommand` buffer를 sprite draw call로 변환
- texture_id별 batch 처리와 renderer stats 집계
- placeholder texture 제공
- `destroy()`에서 WebGL resource 정리

MVP 구현체는 WebGL2 하나다. WebGPU는 MVP 범위가 아니며 현재 구현하지 않는다.

## 데이터 포맷

### SpriteRenderCommand

Rust shared struct:

```rust
#[repr(C)]
pub struct SpriteRenderCommand {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
    pub texture_id: f32,
}
```

현재 크기는 `f32` 13개, 총 52 bytes다. TypeScript는 Rust가 export하는 `sprite_render_command_floats()`와 `sprite_render_command_bytes()`로 ABI를 검증한다.

### AudioEvent

Rust shared struct:

```rust
#[repr(C)]
pub struct AudioEvent {
    pub sound_id: f32,
    pub volume: f32,
    pub pitch: f32,
}
```

현재 크기는 `f32` 3개, 총 12 bytes다. TypeScript는 Rust가 export하는 `audio_event_floats()`와 `audio_event_bytes()`로 ABI를 검증한다.

## 프레임 순서

1. `InputManager`가 현재 keyboard/mouse snapshot을 반환한다.
2. `createEngine`이 Rust `Engine.set_input(...)`을 호출한다.
3. Rust `Engine.update(delta)`가 scene/game/world/collision/audio/render 상태를 갱신한다.
4. TypeScript가 audio event buffer를 읽고 `AudioManager`로 재생한다.
5. TypeScript가 `clear_events()`를 호출해 중복 재생을 방지한다.
6. TypeScript가 render command buffer를 읽는다.
7. `WebGL2Renderer`가 화면을 clear하고 command buffer를 draw한다.
8. 예제가 DebugOverlay와 HUD를 갱신한다.

## 에셋 로딩

`FerrumEngine.loadAssets(manifest)`는 texture, sound, JSON manifest를 명시적으로 로드한다.

- texture: `TextureRegistry`가 이름별 numeric `texture_id`를 발급한다.
- sound: `SoundRegistry`가 이름별 numeric `sound_id`를 발급한다.
- JSON: MVP에서는 명시 로드와 조회만 제공한다.

Rust에는 URL, ImageBitmap, WebGLTexture, AudioBuffer를 전달하지 않는다. Rust는 `set_texture_ids(...)`, `set_sound_ids(...)`로 받은 numeric id만 command/event에 기록한다.

## DebugOverlay와 stats

DebugOverlay는 DOM 기반이며 `debug: false` 또는 예제 URL의 `?debug=false`에서 표시하지 않는다.

현재 표시 항목:

- FPS
- frame time
- entity count
- sprite count
- draw call count
- batch count
- Rust update time
- render time
- mouse position
- game state
- score

## 테스트 경계

Rust 테스트:

- entity id generation
- transform update
- AABB collision
- bullet lifetime
- game state transition
- render command generation
- audio event generation

TypeScript 테스트:

- GameLoop start/stop
- InputManager snapshot
- Asset manifest parsing
- render command parsing

WebGL2 실제 렌더링은 Node 테스트에서 다루지 않고 예제 실행 기반 smoke/manual check로 확인한다.

## MVP 제외 범위

- WebGPU
- Worker/멀티스레딩
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 physics engine
- IndexedDB cache
- 자동 texture atlas pipeline
- spatial audio와 복잡한 mixer
