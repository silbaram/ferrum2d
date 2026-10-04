# Ferrum2D 아키텍처

Ferrum2D는 Rust core가 게임 상태와 시뮬레이션을 소유하고, TypeScript platform layer가 브라우저 API를 다루며, renderer가 Rust에서 만든 command buffer를 소비하는 2D 웹 게임 엔진이다.

제품 목표는 비주얼 에디터 중심 엔진이 아니라 **AI agent-first 2D game engine**이다. 사용자는 `@ferrum2d/create-game`으로 프로젝트를 만들고, AI agent는 Game Spec, Physics Spec, asset metadata, agent/skill, 검증 스크립트를 반복적으로 수정/실행해 게임을 개발한다. Visual editor는 기본 authoring surface가 아니며, 필요한 경우에도 별도 승인된 보조 도구로만 다룬다.

현재 단계는 **MVP 개발 완료, 상용제품 기능 개발**이다. 기준 예제는 `examples/minimal-game`, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`다.

상용화 기준의 지원 수준은 다음처럼 구분한다.

| 수준 | 아키텍처 의미 |
| --- | --- |
| Core runtime | Rust/Wasm frame loop, WebGL2 renderer, input/audio/asset loading, Physics Spec/API, snapshot/replay처럼 1.0 제품 계약 후보인 표면 |
| Authoring primitive | Scene Composition, Behavior Recipe, projectile/weapon authoring, FSM, effect registry처럼 장르 adapter가 낮은 빈도로 조합하는 데이터 계약 |
| Starter scene/template | Shooter/Breakout/Platformer built-in scene과 create-game template처럼 검증된 시작점. 장르 전체를 범용으로 자동 제작하는 engine mode는 아님 |
| Optional/lab/helper | WebGPU, WebGPU fade-only post-process, HD-2D helper, PixelMaskTerrain, level streaming, texture atlas JSON helper처럼 opt-in 또는 capability-dependent 표면 |
| Compatibility/quality infrastructure | deprecated shim, smoke/report/runtime budget/package QA/Pages build처럼 제품 기능과 분리해 관리하는 보조 표면 |

Runtime budget은 quality infrastructure 표면이며 `RuntimeProfiler`가 frame/debug metric을 bounded sample로 모은 뒤 browser smoke가 profile별 상한을 평가한다. Physics 성능 gate는 fixed step, solid/tile candidate, CCD check, physics debug line, collision pair처럼 Rust/Wasm frame에서 실제 기록된 구조적 metric만 사용한다.

Physics debug line 생성은 opt-in quality/debug path다. Runtime `Engine`은 debug 전용 collision scratch를 보관해 broadphase proxy와 contact collider pair scratch를 frame마다 재사용하며, public debug line buffer ABI와 renderer 경로는 그대로 유지한다.

## 게임 프로젝트 설치 경계

GitHub Releases에는 런타임, authoring viewer, create-game, agents를 개별 npm tarball로 제공한다. `scripts/package/prepare-github-release.mjs`는 기존 package allowlist의 빌드 산출물만 임시 staging으로 복사하고 동일한 beta 버전으로 포장한다. 저장소 package version과 `private: true`는 바꾸지 않는다. 생성기 tarball의 `ferrumGithubRelease` metadata가 같은 릴리스의 dependency URL과 명시적 AI 지침 설치 명령을 결정한다. 새 프로젝트 `.npmrc`는 npm 12에서 직접 URL 의존성만 허용하도록 `allow-remote=root`를 기록하며 기존 설정은 보존한다.

이 경로는 게임 시뮬레이션, Rust/Wasm ABI, public runtime export를 변경하지 않는다. 게임 개발자는 Node/npm만 준비하고 엔진의 JS/Wasm은 패키지에서 받는다. 버전·파일·SHA-256은 `release-manifest.json`과 `SHA256SUMS`에 기록한다. 준비 명령과 수동 workflow는 로컬/Actions artifact만 만들며 GitHub Release 공개는 별도 실행이다. 상세 계약은 [GitHub Release 배포 절차](../operations/github-release.md)를 따른다.

## 기준 소스

| 영역 | 코드 기준 |
| --- | --- |
| Rust crate export | `crates/ferrum-core/src/lib.rs` |
| Engine/Wasm API | `crates/ferrum-core/src/engine.rs`, `crates/ferrum-core/src/engine/*.rs` |
| World/component/physics | `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/*.rs`, `components.rs`, `components/*.rs`, `collision.rs`, `collision/*.rs`, `physics.rs`, `physics/*.rs`, `tilemap.rs`, `tilemap/*.rs` |
| Scene runtime | `crates/ferrum-core/src/shooter_scene.rs`, `crates/ferrum-core/src/shooter_scene/*.rs`, `breakout_scene.rs`, `breakout_scene/*.rs`, `platformer_scene.rs` |
| Render/audio/event/ABI layout | `render_command.rs`, `buffer_layout.rs`, `audio_event.rs`, `collision_event.rs`, `gameplay_event.rs`, `packages/ferrum-web/src/wasmBridgeAbi.ts`, `packages/ferrum-web/src/bufferAccessors.ts`, `packages/ferrum-web/src/wasmBridge.ts` |
| Web public entrypoint | `packages/ferrum-web/src/index.ts` |
| Runtime/API wrapper | `packages/ferrum-web/src/createEngine.ts`, `engineTypes.ts`, `engineFramePipeline.ts`, `geometry2D.ts`, `physicsRuntimeControls.ts`, `physicsBodyApi.ts`, `physicsBodyMaterials.ts`, `physicsBodySnapshots.ts`, `physicsJointApi.ts`, `physicsQueryApi.ts`, `physicsWasmInputs.ts`, `physicsAuthoringNumbers.ts`, `physicsHandles.ts`, `physicsAuthoring*.ts`, `cameraPostProcessing.ts`, `cameraPostProcessing/*.ts`, `createFerrumRuntime.ts` |
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
- render command, audio event, gameplay event, opt-in collision lifecycle event, physics debug/query buffer 생성

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
gameplay event -> gameplay_event_ptr()/gameplay_event_len()
events/debug   -> opt-in collision/physics buffer ptr + len
```

Game Spec, asset metadata, physics authoring, gameplay authoring 같은 낮은 빈도의 설정은 TypeScript에서 검증한 뒤 숫자형 값이나 bulk buffer 형태로 Rust에 전달한다. Game Spec `content.localization`/`content.dialogue.graphs`/`content.cutscenes`는 runtime adapter가 읽을 수 있는 authoring data로 정규화하고, `createShooterContentRuntimeOptions(...)`가 단일/명시 content id만 `createFerrumRuntime(...)` option fragment로 변환한다. `SceneComposition`/`BehaviorRecipe` 묶음은 `ShooterGameSpec` top-level로 승격하지 않고 `ferrum2d.consumer.scene-authoring` 별도 artifact로 유지하며, `resolveSceneAuthoringDocument(...)`가 format/version, scene composition, behavior recipe, optional binding plan을 검증한다. `classifySceneInstance(...)`는 이 resolved instance에서 `worldObject`/`actor` authoring role만 파생하며, Rust runtime class나 Wasm ABI를 추가하지 않는다. 이 경로는 Rust simulation이나 Wasm ABI를 자동 변경하지 않는다. Behavior recipe의 entity-level tags도 TypeScript가 `ids.tags`로 `0..31` numeric bitmask로 컴파일해 Rust `GameplayTags` component로 설치하며, frame loop에서는 문자열 tag를 해석하지 않는다.

### Rust 내부 모듈 구조

#### Engine facade와 frame storage

| 영역 | 코드 기준 |
| --- | --- |
| Engine facade | `crates/ferrum-core/src/engine.rs` |
| 책임별 구현 | `crates/ferrum-core/src/engine/*.rs` |
| Frame buffer와 telemetry | `crates/ferrum-core/src/engine/frame_buffers.rs`, `crates/ferrum-core/src/engine/telemetry.rs` |

`engine.rs`는 Wasm `Engine` facade와 shared state를 유지한다.
현재 분리된 책임별 구현은 `engine/data_scene_spawning.rs`, `engine/gameplay_authoring.rs`, `engine/physics_authoring.rs`, `engine/physics_bridge.rs`, `engine/physics_controls.rs`, `engine/physics_collider_controls.rs`, `engine/physics_joint_controls.rs`, `engine/physics_queries.rs`, `engine/rendering.rs`, `engine/scenes.rs`, `engine/snapshots.rs`, `engine/telemetry.rs`, `engine/frame_buffers.rs`에 둔다.
frame마다 재사용되는 render/audio/event/debug/navigation buffer와 frame telemetry storage는 crate 내부 `EngineFrameBuffers`가 소유하며, public pointer/len Wasm ABI는 기존 getter가 그대로 제공한다.

#### Scene mode와 Data Scene 저장 계약

| 영역 | 코드 기준 |
| --- | --- |
| Scene mode와 runtime slot | `crates/ferrum-core/src/engine/scenes.rs` |
| Data Scene spawn bridge | `crates/ferrum-core/src/engine/data_scene_spawning.rs`, `packages/ferrum-web/src/dataSceneRuntimeTarget.ts` |
| Data Scene declared variables | `crates/ferrum-core/src/gameplay_variables.rs`, `packages/ferrum-web/src/dataSceneVariables.ts` |
| Built-in/physics snapshot bridge | `crates/ferrum-core/src/engine/snapshots.rs` |
| Data Scene JSON snapshot | `packages/ferrum-web/src/gameStateSnapshot.ts` |

`Engine`은 built-in scene 상태를 개별 `scene`/`breakout_scene`/`platformer_scene`/`active_scene` 필드가 아니라 crate 내부 `BuiltInSceneSlots` 단일 필드로 보관하고, built-in scene 활성 상태와 data scene 활성 상태는 `SceneMode`로 분리한다.
data scene mode는 built-in `ActiveScene` enum variant가 아니라 별도 `DataSceneRuntime` storage이며, raw Wasm `use_data_scene()` bridge와 public `FerrumEngine.useDataScene()` facade로 빈 data runtime을 활성화한다.
낮은 빈도 authoring spawn은 package-facing `createDataSceneRuntimeTarget(engine, options?)`가 resolved inline `props.components`를 숫자형 인자로 컴파일하고 raw Wasm `spawn_data_scene_entity(...)`가 이를 `EntityTemplate`/`PrefabEntitySpawnRequest`로 낮추며, 성공 handle은 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 읽는다.
consumer는 generated `pkg/*`, `dist/*`, `src/*` 내부 경로를 직접 import하지 않는다.
data scene save/replay 계약은 built-in Shooter snapshot buffer를 확장하지 않고 `GameStateSnapshot.dataScene`의 optional `DataSceneStateSnapshot` JSON payload에 둔다.
이 payload는 custom JSON과 optional `authoringDocument`를 포함할 수 있고, restore 경로는 authoring document가 있으면 `applyDataSceneAuthoringDocument(...)`로 Data Scene entity/behavior를 낮은 빈도 apply 단계에서 다시 조립한다.
optional authoring `variables`는 TypeScript가 이름을 `1..64` slot으로 compile하고 Rust `World`의 고정 slab이 타입, scope, default, 현재 값을 소유한다.
`DataSceneVariableStore`는 선언된 정수/실수/불리언 이름만 허용하는 낮은 빈도 facade이며 다음 document apply에서 동일 이름·동일 타입의
global 값만 유지하고 scene 값은 default로 초기화한다. gameplay frame은 numeric slot만 사용해 event 기반 set/increment, collision/interaction/timer guard, FSM variable comparison을 Rust 안에서 평가한다. Data Scene snapshot은 새 포맷을 추가하지 않고 기존
`custom["ferrum2d.variables"]`와 `dataScene.custom["ferrum2d.variables"]` reserved payload를 사용하므로
canonical hash 범위도 그대로 재사용한다. Data Scene snapshot opt-in에서만 이 저장소를 캡처하며 restore는
선언·타입을 runtime activation 전에 preflight한다. Built-in Shooter snapshot version `19`는 Rust slab을 exact `f64` bits로 header에 포함한다.

#### Scene dispatch와 gameplay authoring

| 영역 | 코드 기준 |
| --- | --- |
| Built-in/Data Scene dispatch | `crates/ferrum-core/src/engine/scenes.rs` |
| Frame update 통합 | `crates/ferrum-core/src/engine/runtime.rs` |
| Gameplay authoring bridge | `crates/ferrum-core/src/engine/gameplay_authoring.rs` |

`engine/scenes.rs`는 `ActiveScene` dispatch, `BuiltInSceneSlots`, `DataSceneRuntime`, crate 내부 `BuiltInSceneRuntime` 계약을 소유하며, built-in scene의 score/game state/title reset/playing reset/update/camera update/frame telemetry/action-trigger hooks는 공통 reset/update context와 active runtime accessor를 통해 호출한다.
concrete scene 필드는 `BuiltInSceneSlots` 내부 private state로 유지하고, shooter snapshot/authoring처럼 호환 ABI가 필요한 경로만 `shooter()`/`shooter_mut()` accessor로 명시한다.
data scene update는 shooter/breakout/platformer 로직을 실행하지 않고 `World` cooldown tick, generic world update, tilemap dynamic collision resolve만 호출한다.
이 계약은 Rust 내부 구조 정리용이며 기존 snapshot/event/render buffer layout을 바꾸지 않고 frame hot path에 JS/Wasm callback이나 entity별 동적 dispatch를 추가하지 않는다.
scene-level trait object dispatch는 active built-in scene당 frame update/reset/telemetry 호출 1회 단위로 제한한다.
`engine/gameplay_authoring.rs`는 scene load/agent apply 같은 낮은 빈도 경로에서만 호출하는 generation-checked gameplay component setter를 담당하며, frame hot path의 behavior evaluation이나 entity별 JS callback을 담당하지 않는다.

#### World storage와 lifecycle 접근 경계

| 영역 | 코드 기준 |
| --- | --- |
| World facade와 component storage | `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/component_storage.rs` |
| Entity lifecycle | `crates/ferrum-core/src/world/entity_lifecycle.rs` |
| Checked component access | `crates/ferrum-core/src/world/component_access.rs` |
| Snapshot과 joint storage | `crates/ferrum-core/src/world/snapshot.rs`, `crates/ferrum-core/src/world/joints.rs` |

`World` storage는 `world.rs`에 두고 template, snapshot, entity lifecycle, collider, joint, tests 구현은 `world/*.rs`에 둔다.
entity spawn/despawn 때 component slot push/clear 정책은 crate 내부 `WorldComponentStorage`가 담당해 lifecycle id/generation 관리와 component slot 초기화/정리를 분리한다.
Rigid-body contact impulse cache와 CCD debug hit buffer도 `world` module private storage로 유지하고 solver/debug 경로는 `World` helper와 iterator로만 접근한다.
Height span과 projectile arc slot도 `world` module private storage로 유지하며, 외부 runtime/render/collision 경로는 `World`의 entity/index-checked helper를 통해 파생 height span 동기화 정책에 접근한다.
Gameplay health, damage, score reward, lifetime, projectile policy, projectile legacy mirror, faction, faction relation table, tag, pickup, interaction, movement pattern, collision reaction, FSM machine, action binding, FSM state-enter action, one-shot timer trigger slot과 player entity handle은 `world` module private storage로 유지하고 외부 runtime/authoring 경로는 entity/index-checked accessor와 replace helper를 통해서만 읽고 복원한다.
`World`의 lifecycle liveness/generation storage는 `world` module private field로 유지하고, `World` 외부 production 경로는 entity liveness/generation vector를 직접 읽지 않고 `entity_capacity()`, `is_alive_index(...)`, `generation_at_index(...)`, `entity_at_index(...)`, `is_current_entity(...)` accessor를 통해 lifecycle storage 정책에 접근한다.

#### Component facade와 gameplay/FSM/collision reaction data

| 영역 | 코드 기준 |
| --- | --- |
| Component facade | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/components/*.rs` |
| Gameplay component data | `crates/ferrum-core/src/components/gameplay.rs` |
| Gameplay 실행 로직 | `crates/ferrum-core/src/gameplay.rs`, `crates/ferrum-core/src/gameplay/**` |
| Joint public type | `crates/ferrum-core/src/components/joints.rs`, `crates/ferrum-core/src/components/joints/*.rs` |

Component public surface는 `components.rs` facade와 `components/{gameplay,motion,sprite,rigid_body,joints,collision_masks,limits,colliders,tests}.rs`로 나눈다.
`components/gameplay.rs`는 crate-private `MovementPattern`, `ActionBindingSet`/`Cooldown`, `CollisionReactionSet`, `GameplayTimerTrigger` 같은 데이터 layout을 둔다.
Shooter runtime은 현재 `ActionBindingSet`의 cooldown remaining state를 직접 tick/trigger해 primary projectile action을 실행하고, built-in Shooter snapshot은 player primary projectile action binding과 cooldown remaining state를 함께 보존한다.
공통 timer trigger는 entity별 one-shot component로 World snapshot/lifecycle에 포함되며, elapsed event를 기존 FSM event pass가 소비한다.
더 넓은 공통 action system으로 승격할 때는 authoring config와 runtime cache 분리를 다시 확정한다.
joint public type은 `components/joints/*.rs` 기능군 모듈 뒤의 `components/joints.rs` facade로 다시 모은다.
기존 `crate::components::*`, crate 내부 `crate::components::joints::*`, crate root re-export 경로를 유지한다.

#### Built-in scene vertical slice

| 영역 | 코드 기준 |
| --- | --- |
| Top-down Shooter | `crates/ferrum-core/src/shooter_scene.rs`, `crates/ferrum-core/src/shooter_scene/*.rs` |
| Breakout | `crates/ferrum-core/src/breakout_scene.rs`, `crates/ferrum-core/src/breakout_scene/*.rs` |

Top-down Shooter scene은 `shooter_scene.rs` facade/storage와 `shooter_scene/{config,runtime,snapshot,tests}.rs` vertical slice로 나눈다.
Breakout scene은 `breakout_scene.rs` facade/storage와 `breakout_scene/{config,effects,level,runtime,tests}.rs`로 나누며 기존 `crate::breakout_scene::{BreakoutScene, BreakoutParticleBurstSink, breakout_brick_hit_particle_preset}` 경로를 유지한다.

#### Physics solver와 joint schedule

| 영역 | 코드 기준 |
| --- | --- |
| Contact solver | `crates/ferrum-core/src/physics/solver.rs`, `crates/ferrum-core/src/physics/solver/*.rs` |
| Rigid-body helper | `crates/ferrum-core/src/physics/body_impulses.rs`, `crates/ferrum-core/src/physics/rigid_body_properties.rs` |
| Island schedule | `crates/ferrum-core/src/physics/islands.rs`, `crates/ferrum-core/src/physics/islands/*.rs` |
| Joint solver | `crates/ferrum-core/src/physics/joints.rs`, `crates/ferrum-core/src/physics/joints/*.rs` |

`physics/solver.rs`는 rigid-body solver facade를 유지하고 contact constraint 생성/cache, split impulse state, material/restitution/surface velocity/baumgarte helper는 `physics/solver/*.rs`에 둔다.
`physics/body_impulses.rs`는 joint/solver가 공유하는 rigid-body contact point velocity와 pair linear impulse 적용 helper를 담당한다.
`physics/rigid_body_properties.rs`는 rigid-body enabled/mass/inertia/gravity-scale/damping 조회 helper를 담당한다.
`physics/islands.rs`는 rigid-body island graph/schedule과 union helper를 담당하고, `physics/islands/joint_buckets.rs`는 solver iteration 안의 전체 joint store 반복 순회를 피하는 joint index bucket을 담당한다.
`physics/joints.rs`는 joint solver facade/re-export를 유지하고, joint별 solver는 `physics/joints/*.rs`, shared context/limit/impulse helper는 `physics/joints/{contexts,limits,impulses}.rs`에 둔다.
Distance/Rope/Spring local anchor는 TypeScript authoring/facade가 낮은 빈도 숫자 인자로 Wasm에 전달하고, Rust solver가 anchor point velocity와 회전 관성 effective mass를 계산한다.
이 경로는 frame hot path의 JS/Wasm 호출 수를 늘리지 않는다.

#### Tilemap facade와 내부 기능

| 영역 | 코드 기준 |
| --- | --- |
| Tilemap facade | `crates/ferrum-core/src/tilemap.rs` |
| Collision/navigation/rendering | `crates/ferrum-core/src/tilemap/*.rs` |

`tilemap.rs`는 public type/storage와 authoring facade를 유지하고, collision cache, collision candidate traversal, collision/query facade, navigation, layer helper, rendering, tests는 `tilemap/*.rs`에 둔다.
이 분리는 Rust module 구조만 바꾸며 기존 render/audio/debug buffer layout을 유지한다.

#### Joint lifecycle과 handle 안정성

| 영역 | 코드 기준 |
| --- | --- |
| Entity despawn cascade | `crates/ferrum-core/src/world/entity_lifecycle.rs`, `crates/ferrum-core/src/world/joints.rs` |
| Checked joint mutation과 storage | `crates/ferrum-core/src/world/joints.rs` |
| Snapshot runtime state rebuild | `crates/ferrum-core/src/world/snapshot.rs`, `crates/ferrum-core/src/world/joints.rs` |

유효한 entity를 `World::despawn(...)`으로 제거하면 lifecycle generation을 갱신하기 전에 그 entity를 어느 endpoint로든 참조하는 distance, rope, spring, pulley, revolute, prismatic, weld, gear joint를 함께 제거한다. public `despawnPhysicsEntity(...)`도 이 경로를 사용한다. cascade로 제거된 joint는 generation 증가와 free-list 반환을 함께 수행하므로 기존 handle이 즉시 무효화되며, 유효하지 않은 entity handle은 World와 joint 상태를 변경하지 않는다. World의 public Rust joint mutation은 양 endpoint가 현재 alive/generation과 일치해야 한다. 복구 가능한 mutation은 `try_add_*_joint(...) -> Option<JointId>`와 `try_set_*_joint(...) -> bool`을 사용해 invalid endpoint를 저장소 변경 없이 거부한다. 기존 `add_*_joint(...)` convenience API는 이 precondition 위반을 programming error로 취급해 저장 전에 panic하고, 기존 `set_*_joint(...)` 시그니처는 호환성을 유지하면서 invalid 입력을 무변경으로 처리한다. Wasm `Engine` joint spawn/control은 checked 경로만 사용해 panic을 JS 경계로 전달하지 않는다. World는 generation-aware per-entity incident joint count를 derived runtime index로 유지해 joint와 무관한 entity의 despawn은 O(1) gate에서 8종 storage 순회를 생략한다. snapshot restore는 이 index를 active joint endpoint에서 재구축한다. joint free-list는 slot 생성과 snapshot restore 시 storage high-watermark까지 capacity를 확보해 despawn cascade의 free-list 반환이 재할당을 만들지 않게 한다.

#### Gameplay movement runtime

| 영역 | 코드 기준 |
| --- | --- |
| Common movement pattern과 navigation | `crates/ferrum-core/src/gameplay/movement/*.rs` |
| Shooter enemy movement | `crates/ferrum-core/src/shooter_scene/runtime/enemies.rs` |
| Shooter projectile movement | `crates/ferrum-core/src/shooter_scene/runtime/bullets.rs` |

Shooter enemy movement compatibility path는 `MovementPattern::Chase(Player/Entity)`를 Rust-owned tilemap navigation waypoint/cache로 처리한다. cache key에는 player/entity/layer/faction/tag target identity가 포함되어 서로 다른 chase target의 waypoint가 repath interval 안에서 섞이지 않는다. `nearestFaction:*`/`nearestTag:*` target query는 `World`의 faction/tag별 derived index bucket을 먼저 순회하고, stale 방어를 위해 live component와 transform 존재를 재확인한 뒤 source 위치 기준 가장 가까운 transform을 선택한다. 이 bucket은 gameplay component setter, despawn, prefab/projectile spawn, World snapshot restore, gameplay authoring rollback restore에서 component 배열로부터 갱신되며 Wasm/public API에는 노출되지 않는다. Shooter projectile movement path는 Enemy movement phase 이후, physics integration 이전에 Bullet layer authored `MovementPattern`을 적용한다. movement component가 없거나 unsupported인 Bullet은 기존 velocity를 linear fallback으로 유지하며, target query가 해석되지 않는 authored `seekTarget`은 공통 movement 계약에 따라 velocity 0으로 정지한다.

### Data Scene authoring apply와 instance registry

| 영역 | 코드 기준 |
| --- | --- |
| Data Scene runtime target과 document apply | `packages/ferrum-web/src/dataSceneRuntimeTarget.ts` |
| Instance handle registry와 binding guard | `packages/ferrum-web/src/gameplayAuthoring.ts` |
| Runtime startup/transition/reapply composition | `packages/ferrum-web/src/createFerrumRuntime.ts` |
| Rust lifecycle state와 transition cleanup | `crates/ferrum-core/src/game_state.rs`, `crates/ferrum-core/src/engine/{scenes,scene_controls,runtime}.rs` |

`applyDataSceneAuthoringDocument(engine, document, options?)`는 scene-authoring envelope와 optional variable declaration을 검증한 뒤 Data Scene runtime target 생성과 behavior recipe apply를 한 번에 수행하는 package-facing 조립 경로다. binding/component/variable runtime preflight는 runtime activation 전에 끝내고, activation 뒤 Rust variable slot을 먼저 동기화한 다음 guarded recipe/FSM command를 설치한다. variable 동기화 이후 spawn 또는 recipe apply가 실패하면 이전 declaration/slot/current value를 복원하므로 변수 저장소의 트랜잭션 경계를 유지한다. 더 낮은 수준의 `createDataSceneRuntimeTarget(engine, options?)`는 첫 번째 유효한 spawn request 직전에만 lazy `useDataScene()` activation을 수행하고, full apply는 zero-instance 문서도 validation 성공 뒤 실제 Data Scene 전환으로 활성화한다. `activateDataScene: false`는 이 자동 activation을 끄고, caller가 별도로 scene mode를 준비하는 경로다.

Data Scene flow는 임의 상태 graph 대신 Rust-owned `GameState`의 stable numeric code를 사용한다.
`Playing(1)`, `Paused(3)`, `LevelComplete(4)`가 Data Scene 유효 상태이며 `Paused`와
`LevelComplete`에서는 render command 생성은 유지하되 tween, physics, timer/FSM, particle simulation을
`Engine::advance_simulation(...)` 입구에서 멈춘다. TypeScript `runtime.dataScene.transition(...)`은 문서
A→B의 명시적 낮은 빈도 전환이고 activation opt-out을 허용하지 않는다. `reapply(...)`는 현재 문서 reload이며
기본값에서 Rust `use_data_scene()` reset boundary를 사용한다. 기존 caller-prepared 경로인
`reapply(..., { activateDataScene: false })`만 이 경계를 생략한다. reset 경계는 World/tilemap/particle/tween, physics contact/history와 fixed-step/input
latched state, collision/gameplay/effect/render/audio buffer, pending spawn/deferred despawn queue를 정리한다.
TypeScript의 같은 이름·타입 `global` 변수만 B 선언으로 전달하고 모든 `scene` 변수와 lifecycle은 B default와
`Playing`으로 초기화한다. frame hot path에 entity별 JS/Wasm 왕복은 추가하지 않는다.

`createSceneInstanceHandleRegistry(...)`는 Data Scene apply/reload 뒤 `ResolvedSceneCompositionInstance.id`와
`GameplayEntityHandle`을 동기화하는 TypeScript authoring cache다. scene load, reapply, agent patch 같은
낮은 빈도 경로에서만 `gameplay_entity_exists(...)`로 stale handle을 검증하며, frame loop에 registry scan이나
entity별 JS/Wasm callback을 추가하지 않는다. 배치 UI/agent 타겟팅처럼 안정 id가 필요한 경로는
`requireExplicitInstanceIds: true`로 resolver fallback id 의존을 거절한다.

### TypeScript platform layer

TypeScript는 브라우저와 package-facing API를 담당한다.

- Wasm module 초기화와 `FerrumEngine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer/touch/gamepad 입력 snapshot 생성
- InputManager가 physical key·pointer·가상 source를 독립 보관하고 OR로 합친다. JSON action profile은 생성 시 검증·복사하며 TS 플랫폼에서 named action/axis와 소비 가능한 edge를 계산한다. `clear`/`setEnabled`는 입력을 취소하고, 초기화된 게임패드는 매핑된 모든 control의 중립 poll 뒤 재활성화한다. 기존 9-field snapshot과 Wasm 입력 ABI는 유지한다. 앱이 pause·클릭 이동 목표를 소유한다. 입력 이벤트와 gamepad는 canvas 소유 창의 focus/lifecycle을 따른다. 입력 취소 콜백이 실패해도 InputManager/VirtualControls와 상위 runtime은 소유한 리스너·DOM·자원 정리를 끝내며 외부 주입 객체의 소유권은 유지한다. 상세 [입력 계약](../../engine/input-actions.md).
- texture/sound/JSON asset 로딩, Aseprite/Tiled/LDtk import helper
- WebGL2/WebGPU texture path, audio registry, `AudioManager`, `UiOverlay`, `DebugOverlay`
- `createFerrumRuntime(...)`의 opt-in dialogue/localization/cutscene/HUD/accessibility/animationTimeline/levelStreaming frame-end adapter
- Wasm buffer를 typed array/DataView로 읽고 필요한 경우에만 object view로 decode
- 저수준 render command와 Built-in Shooter snapshot buffer는 Rust-derived named-field accessor로 읽고 raw offset을 consumer에 노출하지 않음
- Physics Spec snapshot/replay를 Web Worker에서 opt-in 실행하는 worker client
- Rust collision geometry와 canonical vector가 일치하는 순수 public point/body/collider transform helper

TypeScript는 게임 규칙의 source of truth를 소유하지 않는다.

`geometry2D.ts`는 engine state를 보관하거나 Wasm을 호출하지 않는다. generic point/body
transform과 resolved collider의 world center/reference point 계산만 제공하며, 단일 점은
optional output 객체, collider vertices는 caller-owned numeric buffer를 사용한다. Collider별
offset/rotation semantics는 Rust query/debug geometry를 기준으로 양쪽 conformance test가
고정한다. 따라서 public 기하 helper 추가는 frame ABI나 Rust/TypeScript 소유권 경계를
변경하지 않는다.

Root `index.ts`는 기존 코드 호환을 위한 aggregate public entrypoint로 유지하고, 신규 코드는 `core.ts`, `authoring.ts`, `starter-scenes.ts`, `labs.ts`, `quality.ts` subpath entrypoint를 지원 수준별 import 경로로 사용한다. export 목록의 실제 소스는 계속 `public/*Exports.ts` 내부 barrel에서 기능군별로 관리한다. `engineTypes.ts`는 package-facing public type facade만 유지하고, frame/runtime, physics body, joint, query, API surface type은 `engineTypes/*.ts` 기능군 모듈에 둔다. Gameplay authoring helper는 `behaviorRecipes.ts`, `gameplayAuthoring.ts`, `gameplayEventActions.ts`, `presentationEffects.ts`, `behaviorStateMachine.ts`처럼 recipe validation, low-frequency component apply, frame-end event action mapping, presentation effect registry binding, FSM authoring schema/replay/install/state command planning을 분리한다. `chase`/`seekTarget` query preset은 TS가 문자열 authoring 값을 낮은 빈도 setter로 설치하고, Rust `MovementTarget`이 `primaryActor`/`nearestPrimaryActor`, legacy `player`/`nearestPlayer`, `nearestEnemy`, raw nearest-layer code를 frame loop 안에서 해석한다. `FerrumEngine`은 `FerrumGameplayAuthoringApi`를 typed facade로 합성해 `applyGameplayBehaviorCommands(...)`, `applyFactionRelationTable(...)`, `installBehaviorStateMachineRuntime(...)`, `gameplayBehaviorState(...)`, `preflightBehaviorStateMachineStateCommands(...)` 같은 낮은 빈도 method를 제공하지만, raw `set_gameplay_*` Wasm setter를 public API로 직접 노출하지 않는다. `collisionAreaDamage`, `collisionSound`, `collisionParticle`, `collisionEmitEffect`, `collisionSpawnPrefab`, `collisionDespawn` 같은 authored collision reaction도 Rust-owned numeric data로 저장되고 기존 audio event buffer, particle preset registry, gameplay event buffer, `EffectEvent` buffer, pending spawn queue, deferred despawn queue를 통해 frame 안에서 처리되며, TypeScript per-entity collision callback을 호출하지 않는다. `collisionSpawnPrefab`은 collision phase에서 즉시 `World`를 구조 변경하지 않고 기존 pending spawn queue에 command를 적재하며, queue 성공 후에만 source reaction cooldown을 커밋한다. `collisionEmitEffect`는 gameplay state를 바꾸지 않고 `presentationEffect` bulk event와 `EffectEvent` detail buffer entry만 생성하므로 `resolvePresentationEffectRegistry(...)`/`bindPresentationEffectActions(...)` 기반 effect registry/UI/VFX 연결은 frame-end adapter가 담당한다. `collisionSound`/`collisionParticle`/`collisionEmitEffect`/`collisionSpawnPrefab`의 optional cooldown도 source entity의 Rust component state로 tick되는 per-entity throttle일 뿐 global audio/VFX/spawn throttle이나 TS scheduler가 아니다. `collisionSound`/`collisionParticle`의 `replaceDefault` policy도 Rust-owned boolean flag로 built-in Shooter audio/VFX default만 suppress하며, damage/despawn/game-over gameplay override는 `Damage`/`Pickup`/`Despawn` reaction과 분리한다. `collisionSound`/`collisionParticle`/`collisionEmitEffect`/`collisionSpawnPrefab`의 optional `trigger: "enter"`도 Rust-owned contact key state로 판정되는 side-effect gate이며, TS collision callback이나 generic event bus가 아니다. Score pickup 수집도 Rust frame loop가 score/despawn을 적용한 뒤 `pickupCollected` bulk event로만 노출하며, TS는 frame-end adapter에서 UI/quest/inventory side effect를 붙인다. Bullet/Tile 충돌은 별도 public `"tile"` target을 열지 않고 `projectileAction.tileImpact: "despawn"|"passThrough"|"bounce"` numeric policy와 Rust-owned tile query 결과로 처리한다. `"despawn"`은 authored `AreaDamage`와 self-side effect를 additive로 실행할 수 있고, `"passThrough"`는 blocking tile impact와 tile-side authored reaction을 모두 건너뛰며, `"bounce"`는 swept tile contact normal로 projectile velocity를 반사한다. raw Wasm `set_gameplay_projectile_tile_impact(...)`는 이미 존재하는 authored projectile의 같은 component slot을 낮은 빈도 harness/apply 경로에서 설정할 때만 사용한다. `faction` behavior recipe는 `CollisionLayer` 물리 broadphase와 분리된 Rust-owned `GameplayFaction` numeric component이며, authored `Damage` collision reaction gate와 기본 Bullet->Enemy/Bullet->Player damage gate에 사용한다. projectile spawn은 source faction을 in-flight bullet에 복사하고, 현재 built-in Shooter snapshot version `19`는 bullet source faction metadata, session faction relation table, stable lifecycle state code와 gameplay variable slab의 선언·값을 함께 저장한다. FSM helper는 state/profile/transition reference와 readonly event frame stream을 검증하는 schema/API layer이며, frame hot path의 behavior evaluation을 TypeScript가 소유하지 않는다. FSM replay dry-run은 대상 entity handle로 event subject를 필터링한다. subject는 기본적으로 `source`이고, `pickupCollected`만 collector/player인 `actor`를 subject로 삼는다. transition predicate key는 interaction `actionId`, timer `timerId`, pickup `itemId`, collision event kind, actor/source generation 또는 numeric variable comparison을 포함하는 offline authoring validation이다. FSM runtime install helper는 scene load/agent apply 같은 낮은 빈도 경로에서만 state 문자열을 plan-local numeric state id, event kind, token id로 변환해 Rust setter를 호출한다. FSM state command helper는 실제 install에 사용한 plan으로 current numeric state id를 역매핑해 `BehaviorRecipeCommand[]` apply plan을 만들 뿐, per-frame state-enter callback이나 transition executor가 아니다. state command apply의 기본 mode는 overlay이며, opt-in `replaceSupported`만 command/id/handle preflight 후 지원 gameplay component subset을 clear한 뒤 적용한다. public `preflightBehaviorStateMachineStateCommands(...)`는 같은 검증과 clear capability 확인을 mutation 없이 수행해 agent dry-run 루프에 사용한다. 이 clear/apply 경로도 낮은 빈도 authoring helper이며, `FerrumEngine` runtime에서는 clear 전에 Rust-owned supported component slot snapshot을 잡아 actual setter 실패 시 해당 subset만 restore한다. 이 rollback은 health/damage/lifetime/score/faction/pickup/interaction/timer/movement/action/collision reaction slot의 live value 복원이며, event buffer, physics history, spawn queue, UI/inventory 같은 full engine transaction이나 frame별 state-enter runtime은 아니다. Production FSM transition은 Rust-owned `BehaviorStateMachine` component가 numeric state/event/token 또는 variable comparison predicate를 저장하고 `Engine::advance_simulation(...)` frame 끝에서 누적 `GameplayEvent` buffer를 한 번 읽어 matching subject entity에 붙은 FSM만 처리한다. `pickupCollected`의 source는 collected pickup telemetry로 유지되지만 pickup은 같은 collision phase에서 despawn될 수 있으므로 FSM subject는 actor/collector로 고정한다. Physics authoring helper는 `physicsAuthoring.ts` public facade를 유지하고, type contract, preset/material, layer map, collider conversion, joint conversion/cleanup, vehicle rig composition, public handle snapshot, runtime guard, Physics Spec world apply, validation helper는 `physicsAuthoring{Types,Presets,Material,Layers,Colliders,Joints,Vehicle,Handles,Runtime,World,Validation}.ts`에 둔다. `createJoint`가 `"world"` endpoint를 위해 생성하는 static anchor body는 반환 handle의 `worldAnchors`와 `clear()`로 정리할 수 있어야 하며, joint 생성 실패나 Physics Spec/vehicle rig 적용 중간 실패 시 이미 생성한 body, joint, world anchor는 즉시 rollback해야 한다.

Built-in Shooter snapshot version `19`의 lifecycle slot은 기존 `Title|Playing|GameOver`만 허용한다.
Data Scene 전용 `Paused|LevelComplete` code는 재개 경로가 없는 built-in scene에 주입되지 않도록 restore에서
거절한다.

`FerrumGameplayAuthoringApi.gameplayEntityExists(...)`는 scene load/agent apply 같은 낮은 빈도 경계에서만 쓰는 Rust-owned generation/liveness query다. 이 query는 raw `set_gameplay_*` setter를 public API로 여는 것이 아니며, `preflightBehaviorStateMachineStateCommands(...)`가 stale handle을 clear/apply 전에 거부하는 guard로 사용한다.

`collisionEmitEffect.intensity/radius`는 낮은 빈도 authoring 단계에서 검증되어 Rust `CollisionReaction::EmitEffect` component data로 저장된다. frame hot path에서는 Rust가 기존 collision side-effect 결정 지점에서 이 숫자 payload를 `EffectEvent` detail buffer에 bulk 기록하고, TypeScript는 frame 끝에서 registry/adapter dispatch에만 사용한다.

`effectEventAdapters.ts`는 `FrameState.effectEvents`를 registry-aware sound/particle/cameraShake/custom dispatch로 바꾸는 TS frame-end helper다. `effectEventRuntime.ts`와 `CreateEngineOptions.effectEvents`는 이 helper를 opt-in browser runtime hook으로 연결하고, `AssetHost.playAudioEvents(...)`와 Rust particle burst facade를 명시적 dispatch target으로 묶는다. opt-in `assetValidation: "error"`는 `AudioManager`/`BrowserPlatformHost`의 loaded sound check와 `createEngine()`이 추적하는 particle preset registration set만 읽어 missing asset을 frame-end diagnostic으로 보고한다. 이 helper는 handler target을 명시적으로 받아 브라우저/audio/VFX side effect만 호출하며, Rust simulation state를 되돌려 호출하거나 per-entity hot-path callback을 만들지 않는다.

`createFerrumRuntime(...)`의 `hud`/`accessibility`/`animationTimeline`/`localization`/`cutscene`/`dataScene`/`levelStreaming` option도 같은 낮은 빈도 경계를 따른다. `hud`는 runtime frame을 `HudComponentSpec[]`로 변환해 DOM `UiOverlayState`에 병합하고, `accessibility`는 resolved option, subtitle status panel, contrast HUD theme adapter만 제공한다. `animationTimeline`은 `FrameState.frameTimeMs`로 `AnimationTimelinePlayer`를 갱신하고 frame event/state transition metadata를 `onUpdate`에 전달하지만, sprite renderer나 Rust simulation state를 자동으로 바꾸지는 않는다. `LocalizationBundle`은 locale table과 interpolation helper만 소유하고, `CutsceneSequencePlayer`는 `FrameState.frameTimeMs`로 낮은 빈도 timeline state를 갱신한다. dialogue command는 DOM `UiOverlayState`로 변환되고, audio command는 BGM이면 `AssetHost.playBgm(...)`/`stopBgm(...)` optional hook으로 loop/fade/stop을 보존하며, custom host가 해당 hook을 제공하지 않으면 기존 `AssetHost.playAudioEvents(...)` fallback을 사용한다. 카메라 이동과 장르별 narrative side effect는 `CutsceneSequenceTarget` adapter가 담당하며 Rust simulation을 되돌려 호출하거나 entity별 JS/Wasm callback을 만들지 않는다. `dataScene` option은 startup 또는 explicit `runtime.dataScene.transition(...)`/`reapply(...)` 단계에서만 `applyDataSceneAuthoringDocument(...)`를 실행해 scene-authoring document를 검증/spawn/binding한다. `levelStreaming` adapter는 renderer viewport 또는 custom viewport provider로 chunk plan을 계산하고, load 대상 chunk asset manifest를 기존 preload/cache layer에 넘긴 뒤 `target.applyChunk`/`target.unloadChunk`/`target.releaseAssets`/`target.rebuildColliders`로 낮은 빈도 chunk apply, 미참조 asset eviction, collider rebuild 작업을 위임한다. `createFerrumRuntime`는 `AssetHost.releaseAssets(...)`가 있으면 `target.releaseAssets` 호출 뒤 같은 payload를 host에 전달하고, 기본 `BrowserPlatformHost`는 현재 registry URL과 일치하는 texture/sound만 platform resource에서 evict한다. `target.releaseAssets` payload는 현재 preload/retain window에서 더 이상 참조하지 않는 texture/sound/JSON entry만 포함하므로 shared chunk asset을 즉시 제거하지 않는다. `levelStreamingPhysics.ts` helper는 tilemap/pixel mask collider authoring chunk를 manifest의 chunkColumns/chunkRows, tile size, origin과 맞춘다.

`collisionAreaDamage`도 같은 경계를 따른다. TypeScript recipe/facade는 낮은 빈도 authoring 단계에서 `amount`, `radius`, `targetLayer`를 검증해 Rust component setter로 넘기고, 실제 entity impact radius query, tile impact swept contact point 기반 radius query, faction gate, health/score/despawn 적용, `collisionDamage`/`factionDamageDenied` telemetry 생성은 Rust frame loop에서 처리한다. 이 경로는 per-entity JS collision callback을 만들지 않으며, public gameplay event ABI에 impact world `x/y`를 추가하지 않는다.

`capture_gameplay_authoring_snapshot(...)`, `restore_gameplay_authoring_snapshot(...)`, `clear_gameplay_authoring_snapshot(...)` raw Wasm hook은 public facade method가 아니라 `FerrumEngine` 내부 `replaceSupported` apply rollback용 runtime capability다. TypeScript helper는 hook 세 개가 모두 있는 runtime에서만 snapshot/restore를 사용하고, custom runtime이 hook을 제공하지 않으면 기존 non-transactional apply semantics를 유지한다.

Physics snapshot/replay helper는 `physicsSnapshot.ts` public facade/import 경로를 유지하고, type contract, canonical hash, public JSON validation, world capture/restore, replay input runner를 `physicsSnapshot{Types,Hash,Validation}.ts`, `physicsWorldSnapshot.ts`, `physicsReplayInput.ts`에 둔다. Snapshot/replay hash는 rollback/debug 검증용 non-hot-path이며, body state capture/restore는 bulk buffer API를 우선 사용한다.

Gameplay golden replay helper는 `GameStateSnapshot`을 canonical gameplay snapshot으로 사용한다. `gameplayReplay.ts`는 strictly increasing snapshot sequence를 frame hash/run hash로 묶고 expected/actual run의 첫 mismatch frame과 JSON path diff를 반환한다. 이 helper는 runtime loop를 실행하지 않고, fixed timestep/seed/input stream 실행은 smoke 또는 예제 harness가 담당한다. `tests/smoke/gameplay-replay-smoke.mjs`는 `tests/fixtures/gameplay-golden/scenarios.json` manifest를 읽어 scenario별 runner, fixture path, frame count, capture frame, input event, expected replay hash와 score/event/FSM metadata를 검증한 뒤 raw Wasm Top-down Shooter를 실행한다. manifest는 scenario 계약을 고정하고, 장르별 setup과 exact payload assertion은 runner가 소유한다. 각 scenario는 같은 Wasm build에서 두 번 실행해 actual-vs-actual determinism을 먼저 확인한다. 기본 fixture는 deterministic enemy spawn, projectile travel, enemy damage, score reward까지 포함한다. authored behavior fixture는 raw Wasm authoring setter로 score pickup, interaction event, collisionDamage reaction, one-shot timer trigger, source-scoped FSM transition을 설치하고 custom JSON state에 event/FSM 결과와 exact event payload를 넣어 hash 범위에 포함한다. homing missile fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `nearestTag:hostile` seek target, damage, particle, despawn, lifetime command를 설치하고, Rust frame loop에서 projectile movement, collision damage/despawn, `presentationEffect` telemetry, score reward, decoy 생존을 exact custom state로 검증한다. timer fixture는 state-enter runtime을 열지 않고 authoring setup 이후 Rust timer system이 emit한 frame event와 FSM telemetry만 검증한다. 비교 범위는 scene metric, built-in shooter snapshot, Data Scene state/authoring document, optional PhysicsWorld/custom state이며 render/audio/debug/profiler output은 제외한다.

Physics Spec resolver는 `physicsSpec.ts` public facade/import 경로를 유지하고, spec field resolution, type contract, primitive validation/type guard를 분리한다. Public type contract는 `physicsSpecTypes.ts`, 숫자/vector/object/reference validation은 `physicsSpecValidation.ts`에 두어 Game Spec resolution, physics authoring, runtime apply가 동일한 diagnostic contract를 사용한다. 실제 field resolution은 `physicsSpec/{root,materialsLayers,bodies,colliders,geometry,joints,debug,defaults,keys}.ts` vertical slice에 두며, resolver는 inherited object key를 reference로 인정하지 않고 런타임 authoring에서 거부되는 `world`-`world` joint 같은 구조 오류를 spec 단계에서 먼저 차단한다. `createPhysicsWorldFromSpec(...)`가 반환하는 rigid body `stepOptions`는 resolved gravity, solver iteration, `continuous` 값을 함께 포함해 runtime auto-step과 manual step이 같은 Physics Spec 계약을 사용하게 한다.

Manual rigid body step 통계는 Rust solver의 구조적 비용 신호를 TypeScript facade로 노출한다. `PhysicsRigidBodyStepStats.positionContactRebuilds`는 position solver가 contact list를 다시 만든 횟수이며, solver가 correction 없는 안정 iteration 뒤에 남은 position iteration을 조기 종료하면 `positionIterations`보다 작을 수 있다. Raw rigid-body step getter는 마지막 solver step 결과를 유지하고, frame telemetry의 `physics.ccdChecks`/`physics.ccdHits`/sleeping/joint counters는 현재 render frame 안에서 실행된 solver step을 누적한다. Fixed timestep이 한 render frame에서 여러 번 소비되더라도 runtime budget과 debug overlay는 frame 전체 비용을 본다.

### AI agent authoring surface

AI agent가 직접 다루는 주요 표면은 코드 내부 구현이 아니라 안정적인 authoring contract다.

- Game Spec / Physics Spec: 게임 규칙, 밸런스, 물리 authoring 입력
- JSON Schema / validation script: AI가 만든 설정의 구조 검증
- create-game template: 새 게임 프로젝트의 시작점
- consumer agent/skill template: Codex, Claude, Gemini 같은 도구별 개발 지침
- smoke script: agent 변경 결과의 회귀 검증

이 경계 때문에 visual editor UI 상태, drag/drop 편집 상태, canvas selection state를 runtime core에 넣지 않는다.

Scene Composition fragment include의 occurrence별 배치는 resolved flat id를 원본 flat instance로 잘못
저장하지 않는다. patch v2 `updateResolvedTransform`은 include occurrence provenance와 parent transform을
보존하고 world transform을 parent-local로 역변환해 `include.instanceTransforms` override에 기록한다.
동일 fragment의 다른 include occurrence는 영향을 받지 않으며 patch v1 flat transform merge는 호환
경로로 유지한다. nested component/binding/rename/remove는 별도 provenance 계약이 생기기 전까지 명시적
unsupported diagnostic을 반환한다.

### Renderer

WebGL2 자원 통계는 기존 소유 모듈에서 집계한다. TextureManager는 texture 객체별 크기와
합계를 변경 시 갱신하고, RenderTexture store도 생성/resize/release 때 합계를 갱신한다.
renderer의 `resourceStats()`는 이 합계와 고정 개수의 batch/내부 target 상태를 결합하므로
전체 asset/entity 순회나 GPU query가 없다. 소유권 관리용 별도 GC/리소스 그래프는 도입하지 않는다.
같은 TextureManager의 ID alias는 마지막 참조가 사라질 때 texture를 해제하며 중복 집계하지 않는다.
raw texture는 기존처럼 renderer destroy까지 소유한다.
RuntimeFrameRenderer는 실제 render/post-process 완료 뒤 snapshot을 DebugOverlay 및
RuntimeProfiler sample로 전달한다. bytes는 texture 저장량과 GPU buffer capacity의 합계 추정치이며
미지원/크기 불명은 0으로 보정하지 않는다. native WebGPU 통계는 아직 미지원이다.


색 공간은 renderer 생성 시 `legacy`(기본값) 또는 `linear-srgb`로 고정한다.
WebGL2 managed 모드는 sRGB 색상 texture와 수치 texture를 분리하며, 숫자 RGB는 linear 계약이다.
sprite/lighting/material/후처리는 linear로 계산하고 sRGB framebuffer 저장 형식으로 중간 정밀도를 확보한다.
최종 fullscreen pass만 canvas용 sRGB 변환을 수행하고 premultiplied alpha를 보존한다.
후처리가 없으면 출력 draw 1회가 추가되며 frame 통계에 포함한다. 기존 bulk ABI와 Rust 게임 상태는 바꾸지 않는다.
WebGPU의 managed 모드는 canvas 취득 전에 거절하고 factory가 같은 설정을 유지해 WebGL2로 fallback한다.
asset manifest의 `textureOptions`는 직접 load/preload 단계에서 검증하고 renderer로 전달한다.

WebGL2 RenderTexture는 `webgl2RenderTextureStore.ts`가 renderer별 handle/id와 자원을 소유하고,
`webgl2RenderTarget.ts`가 내부 후처리 target과 공개 target의 GPU 할당을 공통으로 처리한다.
asset texture와 별도 저장하되 `SpriteBatch`의 texture 조회 계약에서 합쳐 소유권 중복과 double delete를 피한다.
`renderToTexture`는 기존 bulk command를 별도 framebuffer로 소비하고 main draw framebuffer,
viewport, clear/color-mask/scissor 상태를 복구한다. texture feedback과 누락된 입력은 clear 전에 거절한다.
불투명 8-bit RGBA(legacy RGBA8/managed SRGB8_ALPHA8), 일반 sprite와 같은 좌상단 UV,
고정 texel 크기와 별도 논리 viewport가 첫 버전의 계약이다.
framebuffer 저장 방향은 `SpriteBatch`의 texture별 shader uniform으로 보정하므로 Data Scene/Rust UV 계약과
직접 buffer upload를 유지한다. 부분 UV, asset 혼합, material staging에서도 동일하게 적용한다.
기존 Rust 컬링/화면 좌표 및 Wasm ABI를 바꾸지 않으며 독립 카메라를 구현하지 않는다.
main/offscreen 비용을 frame 통계에 합산한다. 공개 API와 제약은 [Core Runtime](../../engine/public-api/core.md#rendertexture-webgl2)을 따른다.

제품 기본 renderer는 WebGL2다. `createRenderer(...)`는 `preferred: "webgpu"`가 들어오면 WebGPU adapter/device/context를 먼저 생성하고, 실패하면 WebGL2로 fallback한다. WebGPU는 Rust render command ABI를 바꾸지 않는 선택 renderer이며 WebGL2를 대체하지 않는다. WebGPU post-process는 현재 fade pass만 지원하므로 bloom/CRT/vignette/glitch 같은 fullscreen pass의 기준 구현은 WebGL2다.

WebGL2 sprite renderer는 Rust render command buffer를 그대로 instance data로 업로드하고, static quad vertex buffer와 static index buffer를 재사용해 `drawElementsInstanced`로 texture-contiguous batch를 그린다. `SpriteRenderCommand`는 rect/uv/color/texture/effect와 visible `rotation_radians`를 숫자 슬롯으로 전달하며, shader는 rect 중심 기준으로 회전한다. 이 구조는 per-sprite draw call 없이 tilemap/sprite render command를 WebGL2 instancing path로 소비한다.

비트맵 월드 텍스트는 새 render command ABI를 만들지 않는다. TypeScript `BitmapFontPolicySpec` loader/validator가 atlas glyph·kerning metadata를 저빈도 bulk typed-array 호출로 Rust `BitmapTextSystem`에 등록하고, `setWorldText(...)`는 문자열 내용이 바뀔 때만 문자열을 전달한다. 내용이 같은 속성 변경은 숫자 전용 update를 사용하며 좌표·sort metadata·anchor만 바뀌면 기존 glyph command cache도 유지한다. Rust는 정렬 전 월드 좌표 `SpriteRenderCommand` cache를 만들고 frame에서는 entity anchor resolve, camera transform, glyph 단위 viewport culling과 기존 layer/HD-2D sort만 수행한다. 따라서 문자열과 entity별 callback은 frame hot path를 건너지 않으며 WebGL2/WebGPU는 같은 15-float sprite ABI를 그대로 소비한다.

동적 debug primitive도 새 ABI를 추가하지 않는다. Rust가 frame마다 bulk 생성한 `PhysicsDebugLineBufferView`를 TypeScript `physicsDebugLineComposer`가 필요할 때만 받아 `DebugGizmoLineBufferWriter`의 재사용 typed array에 append하고 line/polyline/arrow/circle을 추가한다. renderer는 합성된 기존 8-float physics debug line buffer 하나를 소비하므로 WebGL2/WebGPU 경로가 분기되지 않는다. `physicsDebugLines`가 비활성화되면 Rust debug buffer 생성, composer 호출, debug renderer pass를 모두 생략한다. 이 경로는 debug 표현 전용이며 TypeScript가 simulation state를 소유하지 않는다.

## 프레임 순서

```text
Browser input events
  -> InputManager.snapshot()
  -> Engine.set_input(...)
  -> Engine.update(delta_seconds)
  -> WasmBridge reads render/audio/gameplay/collision/debug buffers
  -> Runtime renderer render()
  -> AudioManager.play()
  -> DebugOverlay update
  -> Runtime content adapters (HUD/accessibility/animationTimeline/localization/dialogue/cutscene/levelStreaming)
  -> Low-frequency Data Scene or built-in scene authoring adapters
  -> UiOverlay update
  -> Engine.clear_audio_events()
```

`FrameState`는 렌더링, HUD, debug에 필요한 snapshot이다. action trigger diagnostic도 Rust frame telemetry에서 읽은 관측 신호로 포함하지만, 게임 상태를 장기 보관하거나 TypeScript에서 별도 simulation state로 복제하지 않는다.

Built-in Scene Authoring은 Data Scene spawn 계약을 재사용하지 않는다.
`applyBuiltInSceneAuthoringDocument(...)`는 활성 Shooter/Platformer/Breakout이 이미 생성한 entity를
`built_in_*_entity_{id,generation}`으로 찾고 generation-safe `set_built_in_scene_entity_position(...)`과 기존 bulk
behavior apply facade를 scene load/reset 경계에서만 호출한다. Rust가 entity 수명과 transform을 계속
소유하며, TypeScript가 frame마다 handle을 조회하거나 entity별 callback을 등록하지 않는다. 회전/scale,
render layer와 Data Scene visual/collider component는 현재 built-in scene 전용 adapter가 지원하지 않으므로
무시하지 않고 preflight diagnostic으로 거부한다. health, lifetime, pickup-despawn,
collision-despawn처럼 built-in scene 소유 entity 수명을 끊는 behavior command도 같은 preflight 경계에서
차단한다.

Placement Viewer Desktop host는 browser frontend와 Rust file authority를 분리한다. Tauri의 load command가
성공한 scene document canonical path와 inferred/selected project root만 process-local write registry에
등록하고, scene save와 `.ferrum-placement-handoff.json` save는 이 allowlist를 다시 확인한다. handoff의
고정 저장 파일이 심볼릭 링크이면 쓰기를 거부한다. 따라서 frontend가 열지 않은 sibling 또는 임의
filesystem 경로를 save command 인자로 전달하거나 링크로 우회해도 쓰지 않는다.
이미지 read는 별도 asset registry가 canonical asset root 아래 파일만 `ferrum-asset://` protocol로 제공한다.
protocol 요청마다 canonical file identity를 다시 확인해 등록 뒤 외부 symlink로 바뀐 경로를 거부하고,
GET/HEAD/OPTIONS와 공식 custom-protocol URI 형태만 허용한다.
packaged WebView는 명시적 CSP로 local bundle, Wasm, Tauri IPC와 등록된 asset protocol을 허용한다.
기본 텍스처의 `data:` PNG도 `fetch`로 읽으므로 `connect-src`와 `img-src` 양쪽에 `data:`를 허용한다.
package smoke는 이 정책이 비활성화되거나 필수 source가 빠지면 artifact build 전에 실패한다.
desktop asset browser smoke는 같은 CSP를 HTML 응답에 적용해 texture load와 canvas 초기화를 검증한다.
native asset URL은 id 기준으로 고정되어 있으므로 frontend는 명시적 asset folder 검사마다 별도 revision을
올려 같은 id/URL도 다시 upload한다. Upload는 순차 처리하고 오래된 결과를 현재 폴더의 ready/error
상태로 publish하지 않아 연속 폴더 선택에서도 최신 이미지가 마지막으로 적용된다.

## ABI와 데이터 포맷

Rust/TypeScript 공유 buffer는 `#[repr(C)]` Rust struct와 TypeScript decoder가 함께 맞아야 한다.

| Buffer | Rust 기준 | TypeScript 기준 | 용도 |
| --- | --- | --- | --- |
| Frame telemetry | `engine/telemetry/frame_stats.rs` | `engineFrameState.ts`, `wasmBridgeAbi.ts`, `wasmBridgeBufferViews.ts` | `FrameState` scalar metric/action/spawn diagnostic bulk snapshot |
| Sprite render command | `render_command.rs`, `bitmap_text.rs` | `renderCommandDecoder.ts`, `spriteMaterial.ts`, `worldText.ts`, `wasmBridgeAbi.ts` | sprite/tile/particle/bitmap glyph의 WebGL2/WebGPU batch 입력. 15-float layout이며 texture/effect offset 뒤 마지막 슬롯이 visible sprite rotation이다. |
| Audio event | `audio_event.rs` | `wasmBridge.ts`, `audioManager.ts` | frame 단위 sound playback |
| Gameplay event | `gameplay_event.rs` | `gameplayEventDecoder.ts`, `gameplayEventActions.ts`, `presentationEffects.ts`, `effectEventAdapters.ts`, `wasmBridge.ts` | Rust-owned gameplay action output, interaction/collision reaction/spawn success/action failure/timer/presentation telemetry와 frame-end adapter action/effect binding/dispatch 변환 |
| Collision event | `collision_event.rs` | `collisionEventDecoder.ts`, `wasmBridge.ts` | enter/stay/exit/hit/trigger event |
| Physics debug line | `collision.rs` | `physicsDebugLineDecoder.ts`, `debugGizmos.ts`, `runtimeFrameRenderer.ts` | opt-in Rust line과 TypeScript 동적 primitive를 하나의 8-float buffer로 렌더링 |
| Physics query scalar getters | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `createEngine.ts` | nearest body/tile query result fields |
| Physics query hit buffers | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `physicsQueryDecoder.ts`, `createEngine.ts` | body/tile query, shape cast, contact/manifold hit arrays |

공유 layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.

## Runtime/API 구성

`@ferrum2d/ferrum-web`의 public entrypoint는 호환 aggregate인 `packages/ferrum-web/src/index.ts`와 지원 수준별 subpath인 `core.ts`, `authoring.ts`, `starter-scenes.ts`, `labs.ts`, `quality.ts`다. 주요 runtime API는 [Public API](../../engine/public-api.md)에 둔다.

- `createEngine(...)`: Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶는다. Public API/type contract는 `engineTypes.ts`에 두고 `createEngine.ts`에서 기존 export 경로를 유지한다.
- `createFerrumRuntime(...)`: browser canvas, WebGL2/WebGPU renderer, input, asset/audio host, UI/debug overlay를 포함한 제품용 runtime을 만든다. 기본값은 runtime이 `FerrumEngine`을 생성/소유하지만, `engineInstance`로 이미 만든 엔진을 주입하면 runtime은 lifecycle 호출만 forwarding하고 엔진 destroy는 호출하지 않는다.
- `createRenderer(...)`: 기본 WebGL2 renderer를 생성하며 WebGPU 선호 옵션은 지원 환경에서 선택 renderer를 사용한다.
- `applyBuiltInSceneAuthoringDocument(...)`: built-in starter의 기존 entity handle에 위치와 Behavior Recipe를 낮은 빈도로 적용한다. generic Data Scene spawn/apply와 분리한다.
- `applyShooterGameSpec(...)` / `resolveShooterGameSpec(...)`: Top-down Shooter Game Spec 검증과 Rust 적용 계약을 담당한다. Public import 경로는 `gameSpec.ts` facade가 유지하고, 타입/기본값/검증/resolution/Wasm 적용 구현은 `gameSpec*.ts` 내부 모듈에 둔다.
- `importAsepriteAtlas(...)` / `importTiledTilemap(...)` / `importLDtkTilemap(...)`: asset authoring 데이터를 Game Spec 친화 구조로 변환한다. Public import 경로는 `assetPipeline.ts` facade가 유지하고, 포맷별 구현은 `assetPipeline*.ts` 내부 모듈에 둔다.

## 주요 기능 경계

| 영역 | 현재 기준 |
| --- | --- |
| Scene | `useDataScene()` generic data scene mode, Shooter/Breakout/Platformer starter scene, Minimal starter 예제 |
| Input | keyboard/mouse/pointer/touch/gamepad snapshot |
| Rendering | Rust render command buffer + WebGL2 기본 renderer, 선택 WebGPU sprite/debug line/fade pass |
| Assets | texture/sound/JSON manifest, Aseprite/Tiled/LDtk import helper, deterministic texture atlas JSON helper |
| UI | DOM 기반 `UiOverlay`, 개발용 `DebugOverlay` |
| Physics | 자세한 범위는 [2D 물리엔진 기능 맵](physics-engine.md) |
| Runtime extensibility | projectile/weapon/prefab/motion/query/reaction/effect event 확장성 계약은 [Runtime Extensibility](../../engine/runtime-extensibility.md) |
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
- 예제 회귀: [Smoke Check](../quality/smoke-check.md), `examples/topdown-shooter/SMOKE_CHECKLIST.md`


### 선택적 KTX2/Basis 에셋 경로

`TextureLoadOptions.ktx2Url`은 TS 자산 로딩 계층이 처리한다. WebGL2 capability 선택 후
별도 module Worker가 Basis v2.50 decoder로 ETC1S/UASTC를 ASTC/BC7/ETC2 block으로 변환한다.
Rust command ABI, texture ID 및 게임 시뮬레이션은 바뀌지 않는다. 이미지 URL은 항상 fallback으로
유지하며 native WebGPU는 이 이미지 경로를 사용한다. 같은 ID의 새 load/evict/destroy와
AbortSignal은 늦은 upload를 차단한다. 소유한 Worker와 공유 decoder의 수명을 구분한다.
고정된 공식 decoder와 라이선스는 package dist에 복사하고 SHA-256으로 검증한다.
[측정·배포·캐시 정책](../quality/compressed-textures.md)에 유지보수 및 지원 범위를 기록한다.


### WebGL2 셰이더 사전 준비

`WebGL2Renderer.create`와 factory의 `shaderPreparation`은 선택적 async 초기화 경로다.
5개 내부 shader source를 동기 생성과 공유한다. compile/link를 제출한 뒤 지원 기기에서는
KHR completion 상태만 poll하며 준비된 program을 생성자에 1회 이전한다. 이 scope는 동기
구성 직후 제거되므로 renderer/context를 넘어 program을 공유하거나 frame에서 조회하지 않는다.
미지원 기기는 link 조회 사이에 yield하며 해당 조회의 blocking은 남는다. AbortSignal,
timeout/context loss/compile/link 오류와 부분 생성 실패는 owned GPU 자원을 rollback한다.
로딩 UI는 renderer 준비 phase를 표시하고 전체 runtime/asset 준비 완료와 구분한다.

## Data Scene visual/body/view 연결

Data Scene spawn은 origin/tint/sortOrder와 명시적 depthSort를 Rust Sprite에 저장한다. Rust가 pivot 회전·culling·레이어 및 depth 정렬을 수행하며 15-float render ABI는 유지한다. optional static/kinematic body는 sprite와 동일한 World entity/transform을 사용한다. reset은 entity generation을 보존·증가시킨다.

TypeScript authoring viewer는 `scenePlacementVisualGeometry`로 동일한 pivot/scale/rotation 사각형을 계산해 picking과 공식·생성 viewer overlay에 사용한다. 이 계산은 authoring interaction에만 사용한다. runtime 소유 renderer와 Data Scene hex 색 변환은 같은 renderer option resolver를 공유하며 reapply/transition도 같은 working color space를 유지한다.

Data Scene camera follow/bounds/smoothing은 simulation 뒤 Rust에서 계산한다. TypeScript `createDataSceneView`는 renderer의 CSS zoom, pointer와 light/occluder 변환을 같은 camera snapshot으로 연결한다. 렌더러는 zoom에 맞춘 logical viewport와 원래 DPR backbuffer를 분리한다. [사용 계약](../../engine/data-scene-native-runtime.md).

Data Scene clip descriptor와 UV는 생성/재설정 시 Rust `SpritePlayback`에 설치한다. 전환은
generation handle을 포함한 stride-8 u32 batch를 검증한 뒤 원자적으로 적용한다. Rust가 시간·frame·
flip을 소유하며 기존 texture와 sprite/body를 유지한다. cold 설정 이외에는 clip frame allocation이 없다.

`Camera2D.ground_y_scale`은 물리 transform과 별개인 render-only 값이다. Rust가 anchor/culling을,
WebGL2/WebGPU vertex shader가 회전된 ground quad의 local Y를 변환한다. `SpriteRenderCommand`는
15-float/60-byte를 유지한다. effectFlags의 bit 4는 ground projection, bit 8/16은 ellipse/box shadow,
bit 32는 현재 sprite alpha를 사용하는 ground shadow다
(여기서 숫자는 mask 값이며 기존 low effect bit와 독립이다). frame buffer metadata로 실제 scale을
한 번 전달하므로 내장 씬으로 전환해도 renderer/debug에 이전 scale이 남지 않는다.
alpha shadow의 `GroundShadowProjection`은 `#[repr(C)]` 세 f32(direction X/Y, length scale)로
Wasm에서 소유한다. bridge가 매 frame ptr로 새 typed view를 만들고 renderer의 공통 uniform으로
보낸다. entity별 추가 boundary 호출이나 command의 RGB/rotation 필드 재해석은 없다.
projection과 groundYScale은 `EngineFrameBuffers`에 render build와 함께 캡처한다. 다음 frame용
설정이 먼저 변경돼도 현재 command 중심/AABB와 shader의 projection이 어긋나지 않는다.
폭 축 `p=(sun.y,-sun.x)`와 길이 축 `-sun*lengthScale`의 행렬 B에 대해,
발 F에서 `B * rotation * diag(width,height) * (uvCorner-(0.5,1))`를 계산하고 마지막에 ground Y를
압축한다. Rust의 중심/AABB와 GL/WGSL vertex가 같은 순서를 사용한다. UV/frame/flip은 캐시된
geometry와 별도로 매 command에 현재 값을 복사한다. alpha texture 재사용으로 별도 mask/FBO는 없다.
renderer는 f32로 반올림된 최솟값 0.01을 허용한다. upright의 depth-sort pivot offset은 scale로
나눠 지면 단위로 비교하며, 기존 회전 독립 정렬과 ground sprite의 기준은 유지한다.
world text의 직립 block 높이도 같은 지면 단위로 환산해 sprite와 정렬한다.
점광원의 타원 falloff와 차폐물 거리/외삽은 같은 `radiusY / radius` 좌표계를 사용하고,
세로 반경 변경도 geometry cache를 무효화한다.

`GroundShadowCaster`의 explicit silhouette와 geometry cache는 Rust world component로 소유한다.
camera offset은 cache 밖에서 적용한다. transform/origin/alpha/sun/projection 변화로 무효화하고
despawn/reset에서 제거한다. culling 후 visible caster budget을 적용하고 일반 sprite batch에 제출한다.
caster마다 GPU resource/pass를 만들지 않는다. TS의 directional light는 기존 ambient/point-light
pipeline에 추가되는 flat additive pass다. [지원 범위와 비용 계약](../../engine/data-scene-presentation.md).
