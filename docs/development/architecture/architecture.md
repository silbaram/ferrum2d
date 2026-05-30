# Ferrum2D 아키텍처

Ferrum2D는 Rust core가 게임 상태와 시뮬레이션을 소유하고, TypeScript platform layer가 브라우저 API를 다루며, renderer가 Rust에서 만든 command buffer를 소비하는 2D 웹 게임 엔진이다.

제품 목표는 비주얼 에디터 중심 엔진이 아니라 **AI agent-first 2D game engine**이다. 사용자는 `@ferrum2d/create-game`으로 프로젝트를 만들고, AI agent는 Game Spec, Physics Spec, asset metadata, agent/skill, 검증 스크립트를 반복적으로 수정/실행해 게임을 개발한다. Visual editor는 기본 authoring surface가 아니며, 필요한 경우에도 별도 승인된 보조 도구로만 다룬다.

현재 단계는 **MVP 개발 완료, 상용제품 기능 개발**이다. 기준 예제는 `examples/minimal-game`, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`다.

## 기준 소스

| 영역 | 코드 기준 |
| --- | --- |
| Rust crate export | `crates/ferrum-core/src/lib.rs` |
| Engine/Wasm API | `crates/ferrum-core/src/engine.rs`, `crates/ferrum-core/src/engine/*.rs` |
| World/component/physics | `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/*.rs`, `components.rs`, `components/*.rs`, `collision.rs`, `collision/*.rs`, `physics.rs`, `physics/*.rs`, `tilemap.rs`, `tilemap/*.rs` |
| Scene runtime | `crates/ferrum-core/src/shooter_scene.rs`, `crates/ferrum-core/src/shooter_scene/*.rs`, `breakout_scene.rs`, `breakout_scene/*.rs`, `platformer_scene.rs` |
| Render/audio/ABI layout | `render_command.rs`, `audio_event.rs`, `collision_event.rs`, `packages/ferrum-web/src/wasmBridge.ts` |
| Web public entrypoint | `packages/ferrum-web/src/index.ts` |
| Runtime/API wrapper | `packages/ferrum-web/src/createEngine.ts`, `engineTypes.ts`, `engineFramePipeline.ts`, `physicsRuntimeControls.ts`, `physicsBodyApi.ts`, `physicsBodyMaterials.ts`, `physicsBodySnapshots.ts`, `physicsJointApi.ts`, `physicsQueryApi.ts`, `physicsWasmInputs.ts`, `physicsAuthoringNumbers.ts`, `physicsHandles.ts`, `physicsAuthoring*.ts`, `cameraPostProcessing.ts`, `cameraPostProcessing/*.ts`, `createFerrumRuntime.ts` |
| Renderer | `packages/ferrum-web/src/createRenderer.ts`, `webgl2Renderer.ts`, `renderer.ts` |
| Game Spec / agent authoring | `packages/ferrum-web/src/gameSpec.ts`, `packages/ferrum-web/src/gameSpec*.ts`, `packages/ferrum-web/src/physicsSpec.ts`, `packages/ferrum-web/src/physicsSpec/*.ts`, `packages/ferrum-web/src/physicsSpecTypes.ts`, `packages/ferrum-web/src/physicsSpecValidation.ts`, `packages/ferrum-web/src/assetPipeline.ts`, `packages/ferrum-web/src/assetPipeline*.ts`, `schemas/shooter-game-spec.schema.json`, `packages/agents/templates/**` |

문서와 코드가 충돌하면 위 코드 기준을 먼저 따른다.

## 책임 경계

### Rust core

Rust core는 플랫폼 독립적인 상태와 계산을 소유한다.

- scene state, score, game over/restart, entity lifecycle
- `World` component 저장소: transform, velocity, sprite, collider, rigid body, joint
- collision/physics/tilemap query, kinematic movement, opt-in rigid body solver
- camera preset, particle/tween system, shooter/breakout/platformer scene logic
- render command, audio event, opt-in collision lifecycle event, physics debug/query buffer 생성

Rust core는 DOM, Canvas, WebGL, Web Audio, `fetch`를 호출하지 않는다.

### Wasm boundary

프레임 hot path는 entity별 JS/Wasm 왕복 호출을 만들지 않는다.

```text
input snapshot -> Engine.set_input(...)
viewport       -> Engine.set_viewport_size(...)
frame update   -> Engine.update(delta_seconds)
telemetry      -> frame_telemetry_ptr()
render         -> visible render command buffer ptr + len
audio          -> audio_event_ptr()/audio_event_len()
events/debug   -> opt-in collision/physics buffer ptr + len
```

Game Spec, asset metadata, physics authoring 같은 낮은 빈도의 설정은 TypeScript에서 검증한 뒤 숫자형 값이나 bulk buffer 형태로 Rust에 전달한다.

`engine.rs`는 Wasm `Engine` facade와 shared state를 유지한다. 현재 분리된 책임별 구현은 `engine/physics_authoring.rs`, `engine/physics_bridge.rs`, `engine/physics_controls.rs`, `engine/physics_collider_controls.rs`, `engine/physics_joint_controls.rs`, `engine/physics_queries.rs`, `engine/rendering.rs`, `engine/scenes.rs`, `engine/snapshots.rs`, `engine/telemetry.rs`에 둔다. `World` storage는 `world.rs`에 두고 template, snapshot, entity lifecycle, collider, joint, tests 구현은 `world/*.rs`에 둔다. Component public surface는 `components.rs` facade와 `components/{motion,sprite,rigid_body,joints,collision_masks,limits,colliders,tests}.rs`로 나누고, joint public type은 `components/joints/*.rs` 기능군 모듈 뒤의 `components/joints.rs` facade로 다시 모은다. 기존 `crate::components::*`, crate 내부 `crate::components::joints::*`, crate root re-export 경로를 유지한다. Top-down Shooter scene은 `shooter_scene.rs` facade/storage와 `shooter_scene/{config,runtime,snapshot,tests}.rs` vertical slice로 나눈다. Breakout scene은 `breakout_scene.rs` facade/storage와 `breakout_scene/{config,effects,level,runtime,tests}.rs`로 나누며 기존 `crate::breakout_scene::{BreakoutScene, BreakoutParticleBurstSink, breakout_brick_hit_particle_preset}` 경로를 유지한다. `physics/solver.rs`는 rigid-body solver facade를 유지하고 contact constraint 생성/cache, split impulse state, material/restitution/surface velocity/baumgarte helper는 `physics/solver/*.rs`에 둔다. `physics/body_impulses.rs`는 joint/solver가 공유하는 rigid-body contact point velocity와 pair linear impulse 적용 helper를 담당한다. `physics/rigid_body_properties.rs`는 rigid-body enabled/mass/inertia/gravity-scale/damping 조회 helper를 담당한다. `physics/islands.rs`는 rigid-body island graph/schedule과 union helper를 담당하고, `physics/islands/joint_buckets.rs`는 solver iteration 안의 전체 joint store 반복 순회를 피하는 joint index bucket을 담당한다. `physics/joints.rs`는 joint solver facade/re-export를 유지하고, joint별 solver는 `physics/joints/*.rs`, shared context/limit/impulse helper는 `physics/joints/{contexts,limits,impulses}.rs`에 둔다. `tilemap.rs`는 public type/storage와 authoring facade를 유지하고, collision cache, collision candidate traversal, collision/query facade, navigation, layer helper, rendering, tests는 `tilemap/*.rs`에 둔다. 이 분리는 Rust module 구조만 바꾸며 `#[wasm_bindgen]` export 이름과 buffer layout을 유지한다.

### TypeScript platform layer

TypeScript는 브라우저와 package-facing API를 담당한다.

- Wasm module 초기화와 `FerrumEngine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer/touch/gamepad 입력 snapshot 생성
- texture/sound/JSON asset 로딩, Aseprite/Tiled/LDtk import helper
- WebGL2/WebGPU texture path, audio registry, `AudioManager`, `UiOverlay`, `DebugOverlay`
- Wasm buffer를 typed array/DataView로 읽고 필요한 경우에만 object view로 decode
- Physics Spec snapshot/replay를 Web Worker에서 opt-in 실행하는 worker client

TypeScript는 게임 규칙의 source of truth를 소유하지 않는다.

Root `index.ts`는 package의 유일한 public entrypoint를 유지하고, export 목록은 `public/*Exports.ts` 내부 barrel에서 기능군별로 관리한다. `engineTypes.ts`는 package-facing public type facade만 유지하고, frame/runtime, physics body, joint, query, API surface type은 `engineTypes/*.ts` 기능군 모듈에 둔다. Physics authoring helper는 `physicsAuthoring.ts` public facade를 유지하고, type contract, preset/material, layer map, collider conversion, joint conversion/cleanup, vehicle rig composition, public handle snapshot, runtime guard, Physics Spec world apply, validation helper는 `physicsAuthoring{Types,Presets,Material,Layers,Colliders,Joints,Vehicle,Handles,Runtime,World,Validation}.ts`에 둔다. `createJoint`가 `"world"` endpoint를 위해 생성하는 static anchor body는 반환 handle의 `worldAnchors`와 `clear()`로 정리할 수 있어야 하며, joint 생성 실패나 Physics Spec/vehicle rig 적용 중간 실패 시 이미 생성한 body, joint, world anchor는 즉시 rollback해야 한다.

Physics snapshot/replay helper는 `physicsSnapshot.ts` public facade/import 경로를 유지하고, type contract, canonical hash, public JSON validation, world capture/restore, replay input runner를 `physicsSnapshot{Types,Hash,Validation}.ts`, `physicsWorldSnapshot.ts`, `physicsReplayInput.ts`에 둔다. Snapshot/replay hash는 rollback/debug 검증용 non-hot-path이며, body state capture/restore는 bulk buffer API를 우선 사용한다.

Physics Spec resolver는 `physicsSpec.ts` public facade/import 경로를 유지하고, spec field resolution, type contract, primitive validation/type guard를 분리한다. Public type contract는 `physicsSpecTypes.ts`, 숫자/vector/object/reference validation은 `physicsSpecValidation.ts`에 두어 Game Spec resolution, physics authoring, runtime apply가 동일한 diagnostic contract를 사용한다. 실제 field resolution은 `physicsSpec/{root,materialsLayers,bodies,colliders,geometry,joints,debug,defaults,keys}.ts` vertical slice에 두며, resolver는 inherited object key를 reference로 인정하지 않고 런타임 authoring에서 거부되는 `world`-`world` joint 같은 구조 오류를 spec 단계에서 먼저 차단한다.

### AI agent authoring surface

AI agent가 직접 다루는 주요 표면은 코드 내부 구현이 아니라 안정적인 authoring contract다.

- Game Spec / Physics Spec: 게임 규칙, 밸런스, 물리 authoring 입력
- JSON Schema / validation script: AI가 만든 설정의 구조 검증
- create-game template: 새 게임 프로젝트의 시작점
- consumer agent/skill template: Codex, Claude, Gemini 같은 도구별 개발 지침
- smoke script: agent 변경 결과의 회귀 검증

이 경계 때문에 visual editor UI 상태, drag/drop 편집 상태, canvas selection state를 runtime core에 넣지 않는다.

### Renderer

제품 기본 renderer는 WebGL2다. `createRenderer(...)`는 `preferred: "webgpu"`가 들어오면 WebGPU adapter/device/context를 먼저 생성하고, 실패하면 WebGL2로 fallback한다. WebGPU는 Rust render command ABI를 바꾸지 않는 선택 renderer이며 WebGL2를 대체하지 않는다.

## 프레임 순서

```text
Browser input events
  -> InputManager.snapshot()
  -> Engine.set_input(...)
  -> Engine.update(delta_seconds)
  -> WasmBridge reads render/audio/collision/debug buffers
  -> Runtime renderer render()
  -> AudioManager.play()
  -> UiOverlay / DebugOverlay update
  -> Engine.clear_audio_events()
```

`FrameState`는 렌더링, HUD, debug에 필요한 snapshot이다. 게임 상태를 장기 보관하거나 TypeScript에서 별도 simulation state로 복제하지 않는다.

## ABI와 데이터 포맷

Rust/TypeScript 공유 buffer는 `#[repr(C)]` Rust struct와 TypeScript decoder가 함께 맞아야 한다.

| Buffer | Rust 기준 | TypeScript 기준 | 용도 |
| --- | --- | --- | --- |
| Frame telemetry | `engine/telemetry/frame_stats.rs` | `engineFrameState.ts`, `wasmBridgeAbi.ts`, `wasmBridgeBufferViews.ts` | `FrameState` scalar metric bulk snapshot |
| Sprite render command | `render_command.rs` | `renderCommandDecoder.ts`, `wasmBridge.ts` | WebGL2 sprite batch 입력 |
| Audio event | `audio_event.rs` | `wasmBridge.ts`, `audioManager.ts` | frame 단위 sound playback |
| Collision event | `collision_event.rs` | `collisionEventDecoder.ts`, `wasmBridge.ts` | enter/stay/exit/hit/trigger event |
| Physics debug line | `collision.rs` | `physicsDebugLineDecoder.ts` | opt-in physics debug rendering |
| Physics query scalar getters | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `createEngine.ts` | nearest body/tile query result fields |
| Physics query hit buffers | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `physicsQueryDecoder.ts`, `createEngine.ts` | body/tile query, shape cast, contact/manifold hit arrays |

공유 layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.

## Runtime/API 구성

`@ferrum2d/ferrum-web`의 public entrypoint는 `packages/ferrum-web/src/index.ts`다. 주요 runtime API는 [Public API](../../engine/public-api.md)에 둔다.

- `createEngine(...)`: Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶는다. Public API/type contract는 `engineTypes.ts`에 두고 `createEngine.ts`에서 기존 export 경로를 유지한다.
- `createFerrumRuntime(...)`: browser canvas, WebGL2/WebGPU renderer, input, asset/audio host, UI/debug overlay를 포함한 제품용 runtime을 만든다.
- `createRenderer(...)`: 기본 WebGL2 renderer를 생성하며 WebGPU 선호 옵션은 지원 환경에서 선택 renderer를 사용한다.
- `applyShooterGameSpec(...)` / `resolveShooterGameSpec(...)`: Top-down Shooter Game Spec 검증과 Rust 적용 계약을 담당한다. Public import 경로는 `gameSpec.ts` facade가 유지하고, 타입/기본값/검증/resolution/Wasm 적용 구현은 `gameSpec*.ts` 내부 모듈에 둔다.
- `importAsepriteAtlas(...)` / `importTiledTilemap(...)` / `importLDtkTilemap(...)`: asset authoring 데이터를 Game Spec 친화 구조로 변환한다. Public import 경로는 `assetPipeline.ts` facade가 유지하고, 포맷별 구현은 `assetPipeline*.ts` 내부 모듈에 둔다.

## 주요 기능 경계

| 영역 | 현재 기준 |
| --- | --- |
| Scene | Shooter, Breakout, Platformer, Minimal starter 예제 |
| Input | keyboard/mouse/pointer/touch/gamepad snapshot |
| Rendering | Rust render command buffer + WebGL2 기본 renderer, 선택 WebGPU sprite/debug line pass |
| Assets | texture/sound/JSON manifest, Aseprite/Tiled/LDtk import helper |
| UI | DOM 기반 `UiOverlay`, 개발용 `DebugOverlay` |
| Physics | 자세한 범위는 [2D 물리엔진 기능 맵](physics-engine.md) |
| Effects | Rust particle/tween primitive와 Web runtime 연결 |
| Packaging | npm package/release 검증은 [npm 베타 패키징](../operations/npm-release.md) |

## 현재 제품 범위 밖

다음은 별도 설계/승인 전 제품 기능으로 확장하지 않는다.

- 전체 게임 루프의 Web Worker 이전 또는 Wasm threads
- visual editor
- multiplayer
- 3D rendering
- user scripting/plugin runtime
- skeletal animation
- complex physics core expansion
- 외부 physics engine 의존성
- frame hot path의 entity별 JS/Wasm callback

## 검증 경계

문서만 바뀌면 Markdown 링크 검사와 `pnpm build:pages`를 우선 실행한다. 코드나 public API가 바뀌면 범위에 맞춰 다음을 추가한다.

- Rust core: `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- Wasm/API: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`
- Game Spec: `pnpm validate:game-spec`
- 예제 회귀: [Smoke Check](../quality/smoke-check.md), [Top-down Shooter 수동 체크리스트](../quality/topdown-shooter-smoke-checklist.md)
