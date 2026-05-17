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
- camera preset 기반 2D camera와 viewport 상태 관리
- MVP 2D physics 처리: velocity integration, collider 기반 world bounds clamp
- AABB 충돌 판정과 entity despawn 처리
- enemy spawn, chase, bullet lifetime, game over, restart 처리
- render command와 audio event 생성

`Engine`은 Wasm API, 입력 snapshot, world/camera 소유권, render/audio buffer 생성을 조정한다. Top-down Shooter 전용 규칙은 `ShooterScene`이 소유하며 scene state, score, 발사/스폰/충돌 결과, texture/sound id 적용을 처리한다.

Rust core는 DOM, Canvas, WebGL, Web Audio, fetch 같은 브라우저 API를 직접 호출하지 않는다.

### WebAssembly 경계

Rust는 wasm-bindgen으로 브라우저에서 호출 가능한 `Engine`을 노출한다. 프레임 hot path에서는 entity별 JS/Wasm 왕복 호출을 만들지 않고 다음 형태를 사용한다.

- 입력: TypeScript가 프레임마다 snapshot 값을 `set_input(...)`으로 한 번 전달한다.
- viewport: TypeScript가 canvas logical size를 `set_viewport_size(...)`로 전달한다.
- scene config: TypeScript가 Game Spec JSON을 검증한 뒤 기본 수치와 short-form animation은 `set_shooter_resolved_config(...)`, idle/move state animation은 `set_shooter_animations(...)`, camera preset은 `set_shooter_camera_preset(...)`, atlas frame은 `set_shooter_atlas_frame(...)`으로 숫자형 설정만 전달한다.
- 업데이트: `update(delta_seconds)` 한 번으로 Rust 내부 루프를 실행한다.
- 렌더링: `render_command_ptr()`와 `render_command_len()`으로 bulk buffer를 노출한다.
- 오디오: `audio_event_ptr()`와 `audio_event_len()`으로 bulk buffer를 노출한다.
- 이벤트 정리: TypeScript가 오디오 이벤트를 읽고 재생한 뒤 `clear_events()`를 호출한다.

TypeScript 프레임 상태는 `renderCommandBuffer`를 기본 렌더링 경로로 사용한다. object 배열 형태의 `renderCommands`는 deprecated 호환 API이며, 매 프레임 allocation을 만들지 않도록 명시 옵션을 켠 경우에만 decode한다.

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

Public API 계약은 [Public API](public-api.md)에 고정한다. 애플리케이션 코드는 `@ferrum2d/ferrum-web` entrypoint에서 import하고 generated wasm-bindgen API나 package 내부 경로에 직접 의존하지 않는다.

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

MVP의 `SpriteRenderCommand` 좌표는 camera가 적용된 screen-space 좌표다. Rust core에서 HUD나 overlay용 screen-space command를 추가하려면 world-space sprite command와 구분되는 별도 command type 또는 layer 정책을 먼저 정의한다.

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
3. `createEngine`이 canvas logical viewport를 Rust `Engine.set_viewport_size(...)`로 전달한다.
4. Rust `Engine.update(delta)`가 scene/game/camera/physics/collision/audio/render 상태를 갱신한다.
5. TypeScript가 audio event buffer를 읽고 `BrowserPlatformHost`를 통해 `AudioManager`로 재생한다.
6. TypeScript가 `clear_events()`를 호출해 중복 재생을 방지한다.
7. TypeScript가 render command buffer를 읽는다.
8. `WebGL2Renderer`가 화면을 clear하고 command buffer를 draw한다.
9. 예제가 DebugOverlay와 HUD를 갱신한다.

## 에셋 로딩

`FerrumEngine.loadAssets(manifest)`는 texture, sound, JSON manifest를 명시적으로 로드한다.

- texture: `TextureRegistry`가 이름별 numeric `texture_id`를 발급한다.
- sound: `SoundRegistry`가 이름별 numeric `sound_id`를 발급한다.
- JSON: platform layer는 JSON을 로드하고 보관한다. Top-down Shooter 예제가 `json.game`을 Game Spec으로 검증한 뒤 Rust scene config, prefab template, enemy behavior preset에 적용한다.
- 오류 진단: asset/audio/Game Spec 오류는 `kind`, `name` 또는 `id`, `url` 또는 `path`, `detail`을 포함하는 메시지 형식으로 보고한다.

`BrowserPlatformHost`는 asset loading과 audio playback을 소유하고, `WebGL2Renderer`는 render command drawing과 texture resource만 소유한다.

Rust에는 URL, ImageBitmap, WebGLTexture, AudioBuffer를 전달하지 않는다. Rust는 `set_texture_ids(...)`, `set_sound_ids(...)`로 받은 numeric id만 command/event에 기록한다.

Game Spec도 Rust에 원본 JSON이나 문자열 object를 넘기지 않는다. TypeScript가 `world.width`, `player.speed`, `enemies.spawnInterval`, `enemies.behavior`, `enemies.spawnPattern`, `enemies.health`, `enemies.scoreReward`, `weapons.damage`, `weapons.cooldown`, `prefabs.enemy.width`, `prefabs.*.animation.states.move.row`, `prefabs.*.frame`, `atlas.frames.*.texture`, `atlas.frames.*.uv.u1`, `camera.preset`, `camera.lookAhead.distance` 같은 필드를 검증하고 기본값을 채운 뒤 `set_shooter_resolved_config(...)`, `set_shooter_animations(...)`, `set_shooter_camera_preset(...)`, `set_shooter_atlas_frame(...)`로 숫자만 전달한다. 이 경로는 게임 시작 전 설정용이며 프레임 hot path가 아니다.

## Texture atlas metadata

Game Spec `atlas.frames`는 frame name을 texture name/id, normalized UV rect, frame size로 매핑한다. `prefabs.*.frame`이 이 frame을 참조하면 TypeScript가 frame 존재 여부와 수치 범위를 검증한다.

Runtime에서 frame texture가 string이면 `AssetHost.textureId(name)`으로 numeric id를 해석한 뒤 Rust에 전달한다. Rust `EntityTemplate`은 frame UV와 sprite/collider size를 보관하고, `ShooterScene`은 prefab별 `set_shooter_atlas_frame(...)` 호출로 현재 texture id와 template을 갱신한다. `SpriteRenderCommand`는 이미 `u0/v0/u1/v1/texture_id`를 포함하므로 atlas frame 추가로 render command ABI를 바꾸지 않았다.

현재 atlas frame binding은 static frame용이다. 기존 horizontal sprite sheet animation은 계속 `SpriteAnimation`이 Rust에서 UV를 갱신하고, TypeScript 검증은 같은 prefab에 `frame`과 `animation`이 동시에 지정되는 것을 막는다.

## Camera preset

Rust `Camera2D`는 camera center, viewport size, world/screen 변환을 소유한다. `ShooterScene`은 player transform과 velocity를 읽어 camera preset을 적용한다.

지원 preset:

- `follow`: player 위치를 바로 따른다.
- `dead-zone`: player가 camera 중심 주변 dead-zone을 벗어났을 때만 camera를 이동한다.
- `look-ahead`: player velocity 방향으로 설정 거리만큼 앞을 본다.
- `shake`: elapsed time 기반 sine/cosine offset을 player-follow 위치에 더한다.

TypeScript는 preset 이름과 수치를 검증하고 numeric code만 Rust에 전달한다. Rust/TypeScript hot path에서 camera 관련 entity별 왕복 호출은 없다.

CLI 검증은 `pnpm validate:game-spec`로 실행한다. 이 명령은 `@ferrum2d/ferrum-web`을 빌드한 뒤 같은 `resolveShooterGameSpec(...)` 검증 함수를 사용해 예제 `game.json`을 확인한다.

## Lifecycle cleanup

브라우저 reload, dev reload, bootstrap 실패 경로에서는 생성된 플랫폼 resource를 반드시 정리한다.

- `FerrumEngine.destroy()`는 `GameLoop`를 멈춘 뒤 Rust/Wasm `Engine.free()`를 한 번만 호출한다.
- `WebGL2Renderer.destroy()`는 sprite batch buffer/program과 texture resource를 해제한다.
- `BrowserPlatformHost.destroy()`는 audio playback host를 정리하고 `AudioManager.destroy()`는 buffer registry와 `AudioContext`를 정리한다.
- `InputManager.destroy()`는 window/canvas event listener를 제거한다.
- `DebugOverlay.destroy()`는 DOM node를 제거한다.

위 `destroy()` 계열 메서드는 모두 중복 호출을 no-op으로 처리한다. `destroy()` 이후 객체는 active runtime에 재사용하지 않고, 새 세션에는 새 instance를 만든다. Top-down Shooter 예제는 cleanup stack을 사용해 partial bootstrap 실패와 `beforeunload` 모두에서 같은 정리 경로를 탄다.

## DebugOverlay와 stats

DebugOverlay는 DOM 기반이며 `DebugOverlayOptions.enabled`가 `false`이면 생성하지 않는다. Top-down Shooter 예제는 URL의 `?debug=false`를 이 옵션으로 변환해 overlay를 숨긴다.

DebugOverlay 표시명, 단위, 순서는 `DEBUG_OVERLAY_ROW_CONTRACT`와 `formatDebugOverlayMetrics(...)` 테스트로 고정한다.

| 표시명 | 단위 | 의미 |
| --- | --- | --- |
| `fps` | fps | 현재 frame time 기반 추정 frame rate |
| `frame time` | ms | `GameLoop` delta seconds를 ms로 변환한 값 |
| `rust update` | ms | Rust `Engine.update(delta)` 실행 시간 |
| `render` | ms | TypeScript renderer clear/draw/stats 처리 시간 |
| `entities` | count | Rust world의 현재 entity 수 |
| `sprites` | count | Rust가 현재 frame에 렌더링 대상으로 보는 sprite 수 |
| `draw calls` | count | WebGL draw call 수 |
| `batches` | count | texture-contiguous sprite batch 수 |
| `render commands` | count | Wasm render command buffer의 command 수 |
| `texture binds` | count | batch 렌더링에 따른 texture bind 수 |
| `texture switches` | count | texture-id batching 경로에서 인접 `texture_id`가 바뀐 횟수. 명시적 단일 texture 렌더 경로는 0 |
| `audio events` | events/s | 최근 1초 창에서 관측한 초당 audio event 수 |
| `mouse` | px | canvas 기준 mouse position |
| `camera` | world | camera origin의 world position |
| `state` | state | Top-down Shooter scene state |
| `score` | score | 현재 score |

`RendererStats` 필드 계약:

| 필드 | 표시명 | 단위 | 의미 |
| --- | --- | --- | --- |
| `drawCalls` | `draw calls` | count | WebGL draw call 수 |
| `batchCount` | `batches` | count | texture-contiguous sprite batch 수 |
| `spriteCount` | `sprites` | count | renderer가 소비한 sprite command 수 |
| `renderCommandCount` | `render commands` | count | Wasm render command buffer의 command 수 |
| `textureBindCount` | `texture binds` | count | batch 렌더링에 따른 texture bind 수 |
| `textureSwitchCount` | `texture switches` | count | texture-id batching 경로에서 인접 `texture_id`가 바뀐 횟수. 명시적 단일 texture 렌더 경로는 0 |

## 테스트 경계

Rust 테스트:

- entity id generation
- physics velocity integration과 bounds clamp
- camera follow와 render command offset
- AABB collision
- bullet lifetime
- game state transition
- render command generation
- audio event generation

TypeScript 테스트:

- GameLoop start/stop
- InputManager snapshot과 listener cleanup
- DebugOverlay DOM cleanup
- Asset manifest parsing
- BrowserPlatformHost/AudioManager destroy idempotency
- Shooter Game Spec validation/apply
- render command parsing
- renderer stats derivation

WebGL2 실제 렌더링은 Node 테스트에서 다루지 않고 예제 실행 기반 smoke/manual check로 확인한다.

Public API 테스트:

- package entrypoint type export
- `FrameHandler`, `InputProvider`, `ViewportProvider` callback type
- `FerrumEngine`, `FrameState`, `Renderer`, `RendererStats`, `AssetManifest`, `ShooterGameSpec` import 경로

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
