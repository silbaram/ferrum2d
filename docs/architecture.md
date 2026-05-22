# Ferrum2D 아키텍처

## 개요

Ferrum2D는 Rust core가 시뮬레이션을 소유하고, TypeScript 플랫폼 레이어가 브라우저 API를 다루며, WebGL2 렌더러가 Rust의 render command buffer를 소비하는 구조다.

현재 개발 단계는 **MVP 개발 완료, 상용제품 기능 개발** 이다. `examples/minimal-game`은 제품용 starter runtime 흐름을 검증하고, `examples/topdown-shooter`는 게임 기능과 회귀 시나리오를 검증한다. `examples/breakout`과 `examples/platformer`는 같은 runtime/API가 shooter 전용이 아님을 검증한다.

```text
Keyboard/Mouse/Pointer/Touch/Gamepad input
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
- 2D physics 처리: velocity integration, collider 기반 world bounds clamp
- sweep-and-prune broadphase 기반 AABB 충돌 pair 생성
- swept AABB 기반 빠른 bullet/enemy 연속 충돌 판정
- AABB 충돌 결과에 따른 entity despawn 처리
- enemy spawn, chase, bullet lifetime, game over, restart 처리
- render command와 audio event 생성

`Engine`은 Wasm API, 입력 snapshot, world/camera 소유권, render/audio buffer 생성을 조정한다. Top-down Shooter 전용 규칙은 `ShooterScene`이 소유하며 scene state, score, 발사/스폰/충돌 결과, texture/sound id 적용을 처리한다.

Rust core는 DOM, Canvas, WebGL, Web Audio, fetch 같은 브라우저 API를 직접 호출하지 않는다.

### WebAssembly 경계

Rust는 wasm-bindgen으로 브라우저에서 호출 가능한 `Engine`을 노출한다. 프레임 hot path에서는 entity별 JS/Wasm 왕복 호출을 만들지 않고 다음 형태를 사용한다.

- 입력: TypeScript가 프레임마다 keyboard/mouse/pointer/touch/gamepad를 합성한 snapshot 값을 `set_input(...)`으로 한 번 전달한다.
- viewport: TypeScript가 canvas logical size를 `set_viewport_size(...)`로 전달한다.
- scene config: TypeScript가 Game Spec JSON을 검증한 뒤 기본 수치, combat, behavior code, orbit tuning, short-form animation은 `set_shooter_resolved_config(...)`, idle/move state animation은 `set_shooter_animations(...)`, camera preset은 `set_shooter_camera_preset(...)`, atlas frame은 `set_shooter_atlas_frame(...)`, wave timeline은 `set_shooter_wave(...)`, audio policy는 `set_shooter_audio_policy(...)`로 숫자형 설정만 전달한다. Shooter가 아닌 작은 장르 검증은 `use_breakout_scene(...)`, `use_platformer_scene(...)`처럼 scene mode를 한 번 선택하고 이후 프레임 hot path는 동일한 `update(...)`와 bulk buffer를 사용한다.
- 업데이트: `update(delta_seconds)` 한 번으로 Rust 내부 루프를 실행한다.
- 렌더링: `render_command_ptr()`와 `render_command_len()`으로 bulk buffer를 노출한다.
- 오디오: `audio_event_ptr()`와 `audio_event_len()`으로 bulk buffer를 노출한다.
- 충돌 이벤트: `collision_event_ptr()`와 `collision_event_len()`으로 u32 bulk buffer를 노출한다.
- 물리 디버그 라인: `physics_debug_line_ptr()`와 `physics_debug_line_len()`으로 opt-in f32 bulk buffer를 노출한다.
- 이벤트 정리: TypeScript가 오디오 이벤트를 읽고 재생한 뒤 audio 전용 `clear_audio_events()`를 호출한다. 기존 `clear_events()`는 호환 alias로 유지한다.

TypeScript 프레임 상태는 `renderCommandBuffer`를 기본 렌더링 경로로 사용한다. object 배열 형태의 `renderCommands`, `collisionEvents`, `physicsDebugLines`는 매 프레임 allocation을 만들지 않도록 명시 옵션을 켠 경우에만 decode한다.

### TypeScript 플랫폼 레이어

위치: `packages/ferrum-web`

역할:

- Wasm module 초기화와 Rust `Engine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer/touch/gamepad 입력 수집
- texture, sound, JSON manifest 로딩
- Aseprite JSON metadata, Tiled JSON tilemap, LDtk JSON tilemap을 Game Spec 조각으로 변환하는 asset pipeline helper
- `texture_id`와 `WebGLTexture` 매핑
- `sound_id`와 `AudioBuffer` 매핑
- render/audio/collision/debug line buffer를 typed array view로 읽기
- `UiOverlay` 기반 HUD/menu/dialog DOM overlay 갱신
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

현재 제품 런타임 구현체는 WebGL2 하나다. WebGPU는 별도 설계/승인 전 구현하지 않는다. `createRenderer(...)`는 WebGL2 renderer factory로 유지하고, `WebGPURenderer`는 기존 import를 깨지 않기 위한 unsupported compatibility shim일 뿐 실제 WebGPU renderer가 아니다.

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

현재 `SpriteRenderCommand` 좌표는 camera가 적용된 screen-space 좌표다. Rust core에서 HUD나 overlay용 screen-space command를 추가하려면 world-space sprite command와 구분되는 별도 command type 또는 layer 정책을 먼저 정의한다.

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

1. `InputManager`가 현재 keyboard/mouse, touch fallback, pointer gesture, gamepad 상태를 같은 `InputSnapshot`으로 합성한다.
2. `createEngine`이 Rust `Engine.set_input(...)`을 호출한다.
3. `createEngine`이 canvas logical viewport를 Rust `Engine.set_viewport_size(...)`로 전달한다.
4. Rust `Engine.update(delta)`가 scene/game/camera/physics/collision/audio/render 상태를 갱신한다.
5. TypeScript가 audio event buffer를 읽고 `BrowserPlatformHost`를 통해 `AudioManager`로 재생한다.
6. TypeScript가 `clear_audio_events()`를 호출해 audio event 중복 재생을 방지한다.
7. TypeScript가 render command buffer를 읽는다.
8. `WebGL2Renderer`가 화면을 clear하고 command buffer를 draw한다.
9. 예제가 DebugOverlay와 HUD를 갱신한다.

## 에셋 로딩

`FerrumEngine.loadAssets(manifest)`는 texture, sound, JSON manifest를 명시적으로 로드한다.

- texture: `TextureRegistry`가 이름별 numeric `texture_id`를 발급한다.
- sound: `SoundRegistry`가 이름별 numeric `sound_id`를 발급한다.
- JSON: platform layer는 JSON을 로드하고 보관한다. Top-down Shooter 예제가 `json.game`을 Game Spec으로 검증한 뒤 Rust scene config, prefab template, enemy behavior preset, orbit tuning, wave timeline, tilemap layer, audio policy에 적용한다.
- 오류 진단: asset/audio/Game Spec/asset pipeline 오류는 `kind`, `name` 또는 `id`, `url` 또는 `path`, `detail`을 포함하는 메시지 형식으로 보고한다. `FerrumDiagnosticError`는 이 메시지를 유지하면서 `code`와 `context`를 제공하고, host 앱은 `diagnosticReport(error)` 또는 `formatDiagnosticReport(error)`로 bootstrap 실패를 수집/표시한다.

`BrowserPlatformHost`는 asset loading과 audio playback을 소유하고, `WebGL2Renderer`는 render command drawing과 texture resource만 소유한다.

Rust에는 URL, ImageBitmap, WebGLTexture, AudioBuffer를 전달하지 않는다. Rust는 `set_texture_ids(...)`, `set_sound_ids(...)`로 받은 numeric id만 command/event에 기록한다.

Game Spec도 Rust에 원본 JSON이나 문자열 object를 넘기지 않는다. TypeScript가 `world.width`, `player.speed`, `enemies.spawnInterval`, `enemies.orbit.radius`, `enemies.orbit.radialBand`, `enemies.presets.*.health`, `enemies.waves.*.enemy`, `enemies.waves.*.enemyCount`, `weapons.damage`, `weapons.cooldown`, `prefabs.enemy.width`, `prefabs.*.animation.states.move.row`, `prefabs.*.frame`, `atlas.frames.*.texture`, `atlas.frames.*.uv.u1`, `tilemap.tiles.*.frame`, `tilemap.layers.*.data`, `camera.preset`, `camera.lookAhead.distance`, `audio.events.shoot.volume` 같은 필드를 검증하고 기본값을 채운 뒤 `set_shooter_resolved_config(...)`, `set_shooter_animations(...)`, `set_shooter_camera_preset(...)`, `set_shooter_atlas_frame(...)`, `set_shooter_tile(...)`, `set_shooter_tilemap_layer(...)`, `set_shooter_wave(...)`, `set_shooter_audio_policy(...)`로 숫자와 typed array만 전달한다. 이 경로는 게임 시작 전 설정용이며 프레임 hot path가 아니다.

## Wave timeline

`enemies.presets`와 `enemies.waves`는 TypeScript에서 이름 참조를 해석한다. Rust에는 wave index, duration, spawn interval, enemy count, enemy speed, behavior code, spawn pattern code, health, score reward만 전달된다. `ShooterScene`은 `chase`, `drift`, `static`, `orbit` behavior를 Rust-side movement preset으로 처리하고, active wave index, elapsed time, wave spawn count, spawn timer를 소유한다. `orbit` behavior의 목표 반경과 보정 폭은 전역 `enemies.orbit` 값을 `set_shooter_resolved_config(...)`로 전달받아 사용한다. wave가 duration 또는 enemy count 조건을 만족하면 다음 wave로 넘어가며, 마지막 wave 이후에는 첫 wave로 돌아가 Top-down Shooter 예제가 계속 진행된다.

## Audio policy

Rust `AudioEvent`의 volume/pitch는 `ShooterScene`의 audio policy에서 정한다. TypeScript는 `audio.masterVolume`과 `audio.sfxVolume`을 `BrowserPlatformHost.configureAudio(...)`로 Web Audio bus에 적용하고, `audio.events.*`는 `set_shooter_audio_policy(...)`로 Rust에 전달한다. 예제는 첫 key/pointer 입력에서 `BrowserPlatformHost.unlockAudio()`를 호출해 브라우저 autoplay 제한을 해제한다.

## Texture atlas metadata

Game Spec `atlas.frames`는 frame name을 texture name/id, normalized UV rect, frame size로 매핑한다. `prefabs.*.frame`이 이 frame을 참조하면 TypeScript가 frame 존재 여부와 수치 범위를 검증한다.

Runtime에서 frame texture가 string이면 `AssetHost.textureId(name)`으로 numeric id를 해석한 뒤 Rust에 전달한다. Rust `EntityTemplate`은 frame UV와 sprite/collider size를 보관하고, `ShooterScene`은 prefab별 `set_shooter_atlas_frame(...)` 호출로 현재 texture id와 template을 갱신한다. `SpriteRenderCommand`는 이미 `u0/v0/u1/v1/texture_id`를 포함하므로 atlas frame 추가로 render command ABI를 바꾸지 않았다.

현재 atlas frame binding은 static frame용이다. 기존 horizontal sprite sheet animation은 계속 `SpriteAnimation`이 Rust에서 UV를 갱신하고, TypeScript 검증은 같은 prefab에 `frame`과 `animation`이 동시에 지정되는 것을 막는다.

## Tilemap runtime

Game Spec `tilemap`은 정적 tile layer 렌더링과 단순 collision layer를 담당한다. TypeScript는 tile id, atlas frame 참조, tint color, layer dimension, `collision` boolean, row-major data 길이와 tile id 참조를 검증한다. texture name은 `AssetHost.textureId(name)`으로 numeric id가 되고, numeric texture id는 그대로 전달된다.

Rust `Tilemap`은 entity를 만들지 않고 tile definition과 layer data를 보관한다. 매 프레임 `ShooterScene.update()`는 `collision: true` layer의 양수 tile을 정적 AABB로 해석해 player/enemy transform을 최소 축으로 밀어낸다. 충돌 layer는 설정 시 인접 solid tile run을 merged AABB obstacle cache로 굽고, runtime에서는 dynamic collider AABB 또는 swept path가 겹치는 merged obstacle만 검사한다. push-out은 `CollisionSystem::aabb_contact(...)`의 normal/penetration 결과를 재사용한다. `PhysicsSystem::move_and_slide_with_tilemap(...)`는 같은 tile obstacle을 swept AABB 기반 kinematic 이동에도 연결한다. `EnemyBehavior::Chase`는 원본 collision tile data를 4방향 grid navigation 장애물로 사용해 다음 waypoint를 계산하고, 유효한 경로가 없으면 기존 direct chase로 되돌아간다. `ShooterScene`은 enemy id/generation별 navigation target cache를 두고 짧은 repath interval 또는 waypoint 도달 시점에만 A*를 다시 계산한다. 이후 `Engine.build_render_commands()`는 tile layer 순서대로 `SpriteRenderCommand`를 먼저 생성하고, 그 뒤 player/enemy/bullet entity command를 추가한다. 이 방식은 tile별 JS/Wasm 왕복 호출을 만들지 않고 기존 render command ABI를 그대로 사용한다.

현재 collision 범위는 player/enemy 이동 차단과 chase enemy navigation 장애물이다. bullet-wall 충돌, navmesh, crowd simulation은 포함하지 않는다.

## Physics v2/v3

Physics v2는 Rust core 내부의 scoped AABB 물리 고도화다. `CollisionSystem`은 `AabbBounds`, sweep-and-prune broadphase, layer pair query, swept AABB time-of-impact, swept layer pair query를 제공한다. Top-down Shooter의 bullet/enemy 충돌은 swept layer pair query를 사용해 한 프레임 사이에 enemy를 통과하는 빠른 총알도 명중으로 처리한다.

Physics v3 기반은 shooter 전용 layer 의존을 줄이는 범용화 작업이다. `CollisionMask`와 `CollisionFilter`는 entity별 category/mask bitset을 제공하고, `CollisionSystem::build_mask_pairs(...)`와 `build_swept_mask_pairs(...)`는 layer enum이 아닌 category bitset으로 pair를 만든다. `AabbCollider`와 `CircleCollider`는 current-frame broadphase에서 AABB proxy로 후보를 줄인 뒤 precise overlap으로 확정한다. `point_query(...)`, `aabb_query(...)`, `circle_query(...)`, `shape_query(...)`, `shape_cast(...)`, `raycast(...)`, `nearest_body_query(...)`는 mask 기반 world collider query를 제공한다. `CollisionQueryShape`는 현재 AABB와 circle query/cast shape를 지원한다. `AabbContact`와 `CollisionContact`는 AABB/circle current-frame overlap의 normal/penetration을 제공하고, `build_broadphase_debug_lines(...)`는 broadphase AABB proxy bounds를, `build_contact_debug_lines(...)`는 contact normal을 world-space debug line primitive로 변환한다. `build_physics_debug_lines(...)`는 두 결과를 같은 debug line buffer에 담는다. `SweptAabbContactHit`는 swept AABB time-of-impact와 entry normal을 함께 제공한다. `PhysicsSystem::move_and_slide(...)`와 `move_and_slide_with_tilemap(...)`는 solid AABB collider와 tile obstacle에 대한 kinematic movement를 처리하되 mass/force/impulse는 도입하지 않는다. `PhysicsSystem::move_and_slide_with_one_way_platforms(...)`는 특정 `CollisionMask` category를 entity one-way platform으로 취급해 위에서 아래로 진입하는 contact만 막는다. `PhysicsSystem::ground_probe(...)`와 `ground_probe_with_tilemap(...)`는 platformer controller가 사용할 수 있는 아래 방향 ground detection query를 제공한다. `PhysicsSystem::carry_moving_platform(...)`는 현재 특정 platform 위에 grounded된 rider에게 platform delta를 적용하고, carrier entity 자체는 무시하되 다른 solid/tilemap obstacle에는 기존 move-and-slide를 적용한다. `PhysicsSystem::move_platformer_controller(...)`와 tilemap variant는 `PlatformerControllerInput`/`PlatformerControllerConfig`를 받아 수평 입력, 중력, grounded jump를 kinematic move-and-slide에 연결하고 `World`의 velocity component와 ground before/after 결과를 갱신한다. `PlatformerControllerState`를 받는 stateful variant는 coyote time과 jump buffering timer를 controller 외부 상태로 유지해 fixed/variable timestep 모두에서 같은 책임 경계를 지킨다. `with_step_offset(...)`은 grounded entity/tilemap 수평 충돌에 한해 위로 올림, 수평 이동, 아래로 ground snap을 시도하고 실패 시 기본 move-and-slide 결과를 유지한다. `PlatformerScene`은 이 controller, one-way platform, moving platform carry를 `use_platformer_scene(...)` 경로로 묶어 Web runtime 예제에서 검증한다. slope handling은 이 controller primitive에 포함하지 않는다. Tilemap collision은 solid tile을 merged AABB obstacle로 캐시해 push-out, swept movement, nearest obstacle query, ground probe 후보 검사를 줄인다. `FixedTimestep`은 opt-in fixed update accumulator와 render interpolation alpha를 계산하고, `PhysicsCounters`는 fixed step과 kinematic collision 후보/히트 수를 누적해 `FrameState.physics`로 노출한다. `CollisionEventTracker`는 current-frame pair enter/stay/exit를 `CollisionEvent` u32 buffer로 기록하고 shooter gameplay 충돌은 despawn 전에 `hit` event를 기록한다. Bullet/enemy hit는 bullet damage를 payload로 기록하고 TypeScript는 `decodeCollisionEvents(...)`로 `CollisionEventView.damage`를 복원한다. Breakout scene은 같은 swept AABB contact와 collision hit event buffer로 paddle/ball/brick/wall 충돌을 검증한다. Physics debug line은 `Engine.set_physics_debug_lines_enabled(...)`로 opt-in 생성하고 `PhysicsDebugLine` f32 buffer를 `FrameState.physicsDebugLineBuffer`로 읽는다. decoded `FrameState.physicsDebugLines`는 `includePhysicsDebugLines`를 켠 경우에만 만든다.

범위는 [Physics v2 범위](physics-v2.md)와 [Physics v3 기반](physics-v3.md)을 따른다. rigid body impulse solver, friction/restitution, joints, polygon collider, external physics dependency는 현재 포함하지 않는다.

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
- `InputManager.destroy()`는 keyboard/mouse/pointer/touch 관련 window/canvas event listener를 제거한다. Gamepad는 `snapshot()` 시점 polling만 사용한다.
- `UiOverlay.destroy()`는 runtime text/UI DOM node를 제거하고 이후 update를 무시한다.
- `DebugOverlay.destroy()`는 DOM node를 제거한다.

위 `destroy()` 계열 메서드는 모두 중복 호출을 no-op으로 처리한다. `destroy()` 이후 객체는 active runtime에 재사용하지 않고, 새 세션에는 새 instance를 만든다. Top-down Shooter 예제는 cleanup stack을 사용해 partial bootstrap 실패와 `beforeunload` 모두에서 같은 정리 경로를 탄다.

## Text/UI Overlay

`UiOverlay`는 Product Beta Text/UI rendering의 첫 public API다. Rust core와 Wasm ABI는 바꾸지 않고, TypeScript runtime이 같은 frame의 `FrameState`, `RendererStats`, fps/render time을 바탕으로 `UiOverlayState`를 만들어 canvas 위 DOM overlay를 갱신한다.

- `panels`: HUD, score, menu 같은 반복 text/action 묶음을 `top-left`, `top-right`, `bottom-left`, `bottom-right`, `center` region에 배치한다.
- `dialog`: pause, title, game over 같은 중앙 dialog를 표시한다.
- `actions`: button click을 `UiOverlayOptions.onAction` event로 돌려준다. 이 event는 platform input 보조용이며 Rust simulation state를 직접 바꾸지 않는다.
- `createFerrumRuntime({ ui, uiParent, uiState })`는 overlay 생성과 destroy를 runtime lifecycle에 묶는다. `uiParent`는 canvas를 감싸는 positioned element를 권장한다.

`examples/minimal-game`은 `UiOverlay`를 runtime HUD/dialog로 사용해 starter가 DebugOverlay 없이도 score/state/entity/render command/fps 텍스트를 표시할 수 있음을 검증한다.

## Asset Pipeline v2

Asset pipeline v2의 현재 범위는 Aseprite JSON metadata import, Tiled JSON tilemap import, LDtk JSON tilemap import다. `importAsepriteAtlas(...)`와 `importAsepriteAtlasFrames(...)`는 Aseprite export의 atlas pixel rect를 Game Spec `atlas.frames`에 맞는 normalized UV와 frame size로 변환한다. `importTiledTilemap(...)`와 `importTiledGameSpec(...)`는 Tiled finite orthogonal map의 embedded tileset과 tile layer를 Game Spec `atlas`/`tilemap` 조각으로 변환한다. `importLDtkTilemap(...)`와 `importLDtkGameSpec(...)`는 LDtk project JSON의 embedded level, Tiles/AutoLayer tile instances, tileset definition을 같은 Game Spec 조각으로 변환한다.

- 변환은 TypeScript authoring/runtime bootstrap 단계에서만 수행한다.
- Rust core는 기존 `set_shooter_atlas_frame(...)` 숫자형 경로만 받으며 WebGL texture나 JSON 구조를 알지 않는다.
- rotated Aseprite frame, flipped/rotated Tiled gid, infinite/chunked Tiled map, encoded/compressed tile data, flipped LDtk tile, external LDtk level, raw IntGrid collision layer는 현재 Game Spec/renderer 계약에서 표현하지 않으므로 진단 오류로 거부한다.
- atlas animation binding은 별도 후속 범위로 둔다.

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
| `fixed steps` | count | 현재 frame에서 소비한 fixed physics step 수. fixed timestep이 꺼져 있으면 0 |
| `kinematic hits` | count | 현재 frame에서 kinematic movement가 world collider 또는 tile obstacle에 부딪힌 횟수 |
| `tile checks` | count | 현재 frame에서 kinematic tile collision 후보로 검사한 merged tile obstacle 수 |
| `collision events` | count | 현재 frame의 collision enter/stay/exit/hit event 수 |
| `physics debug lines` | count | WebGL2 debug line pass가 그린 physics debug line 수 |
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
| `physicsDebugLineCount` | `physics debug lines` | count | WebGL2 debug line pass가 그린 physics debug line 수 |

## 테스트 경계

Rust 테스트:

- entity id generation
- physics velocity integration과 bounds clamp
- camera follow와 render command offset
- AABB collision
- broadphase layer pair와 swept AABB collision
- bullet lifetime
- game state transition
- render command generation
- audio event generation

TypeScript 테스트:

- GameLoop start/stop
- InputManager keyboard/mouse/pointer/touch/gamepad snapshot과 listener cleanup
- UiOverlay HUD/dialog DOM rendering과 action event forwarding
- DebugOverlay DOM cleanup
- Asset manifest parsing
- Aseprite/Tiled/LDtk asset pipeline import와 invalid metadata diagnostics
- BrowserPlatformHost/AudioManager destroy idempotency
- Shooter Game Spec validation/apply
- render command parsing
- renderer stats derivation
- collision event buffer decoding

WebGL2 실제 렌더링은 Node 테스트에서 다루지 않고 예제 실행 기반 smoke/manual check로 확인한다.

Public API 테스트:

- package entrypoint type export
- `FrameHandler`, `InputProvider`, `ViewportProvider`, `EngineLifecycleHooks` callback type
- `FerrumEngine`, `FrameState`, `PhysicsFrameStats`, collision event 타입, `Renderer`, `RendererStats`, `UiOverlay`, Aseprite/Tiled/LDtk asset pipeline helper, `AssetManifest`, `ShooterGameSpec` import 경로
- `createRenderer` factory와 deprecated compatibility export인 `WebGPURenderer`, `generateTextureAtlasLayout` import 경로

## 현재 제품 범위 제외 항목

- WebGPU
- Worker/멀티스레딩
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 physics engine
- IndexedDB cache
- 자동 texture atlas pipeline
- spatial audio와 복잡한 mixer

일부 제외 범위의 파일이나 export는 compatibility shim으로 남아 있을 수 있다. 이 shim은 unsupported 또는 no-op 경로이며, 제품 runtime 기능으로 취급하지 않는다.
