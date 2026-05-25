# Ferrum2D Public API

이 문서는 `@ferrum2d/ferrum-web` package entrypoint에서 애플리케이션이 직접 import해도 되는 API 계약을 요약한다. 코드 기준은 `packages/ferrum-web/src/index.ts`다.

## Import 원칙

애플리케이션과 예제 코드는 package entrypoint만 사용한다.

```ts
import {
  BrowserPlatformHost,
  capturePhysicsWorldSnapshot,
  compilePhysicsAuthoringDocument,
  createPhysicsReplayInputStream,
  WebGL2Renderer,
  createEngine,
  createFerrumRuntime,
  createPhysicsWorldFromSpec,
  createRigidBody,
  createRenderer,
  runPhysicsReplayInputStream,
  restorePhysicsWorldSnapshot,
  verifyPhysicsReplayInputStreamRollback,
  physicsMaterial,
  resolvePhysicsSpec,
  resolveShooterGameSpec,
  type FerrumEngine,
  type FerrumRuntime,
  type FrameState,
  type PhysicsBodyColliderOptions,
  type PhysicsBodyColliderSnapshot,
  type PhysicsDebugOptions,
  type PhysicsMode,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";
```

다음 경로는 public API가 아니다.

- `@ferrum2d/ferrum-web/dist/*`
- `@ferrum2d/ferrum-web/pkg/*`
- `packages/ferrum-web/src/*`
- generated wasm-bindgen API인 `../pkg/ferrum_core`

## 주요 엔트리포인트

| API | 용도 |
| --- | --- |
| `createEngine(...)` | Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶어 `FerrumEngine`을 만든다. |
| `createFerrumRuntime(...)` | canvas, WebGL2 renderer, input, asset/audio host, UI/debug overlay를 포함한 browser runtime을 만든다. |
| `createRenderer(...)` | WebGL2 renderer를 생성한다. `preferred: "webgpu"`는 현재 WebGL2 fallback 진단용이다. |
| `resolveShooterGameSpec(...)` | Shooter Game Spec 기본값과 검증을 적용한다. |
| `applyShooterGameSpec(...)` | 검증된 Shooter Game Spec을 Rust engine에 적용한다. |
| `resolvePhysicsSpec(...)` | `physics` namespace의 mode/material/layer/body/collider/joint metadata 기본값과 검증을 적용한다. |
| `createPhysicsWorldFromSpec(...)` | resolved/raw Physics Spec body/joint metadata를 runtime rigid body world로 적용한다. |
| `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)` | 낮은 수준 scalar API 대신 intent 중심 physics object를 생성한다. |
| `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `verifyPhysicsReplayRollback(...)` | Physics Spec으로 만든 world의 낮은 빈도 snapshot/restore/replay 검증을 수행한다. |
| `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayInputStreamRollback(...)` | frame/seed/fixed step/body event 기반 replay stream과 rollback 검증을 수행한다. |
| `compilePhysicsAuthoringDocument(...)` | `physicsEditor` metadata를 제거하고 runtime `PhysicsSpec`만 export한다. |
| `diagnosticReport(...)` | runtime/package 진단 정보를 만든다. |

## FerrumEngine API 그룹

`FerrumEngine`은 `packages/ferrum-web/src/createEngine.ts`의 인터페이스 조합이다.

| 그룹 | 대표 API |
| --- | --- |
| Lifecycle | `start`, `pause`, `resume`, `stop`, `destroy`, `time`, `version` |
| Scene | `score`, `entityCount`, `gameState`, `resetGame`, `useBreakoutGame`, `usePlatformerGame`, `setGameSpec`, `setViewportSize`, tilemap edit helpers |
| Asset | `loadAssets`, `textureId`, `soundId`, `setTextureIds`, `setSoundIds` |
| Particle | `setParticlePreset`, `spawnParticleBurst`, `clearParticles`, `particleCount` |
| Physics runtime | `configureFixedTimestep`, `setPhysicsDebugLinesEnabled`, `setPhysicsDebugOptions`, `stepRigidBodies` |
| Physics body | `spawnRigidBody`, `addPhysicsBodyCollider`, `getPhysicsBodyColliderCount`, `getPhysicsBodyCollider`, `getPhysicsEntity`, `despawnPhysicsEntity`, body/collider control, force/impulse/torque |
| Physics joint | `spawnPhysicsJoint`, `getPhysicsJoint`, `clearPhysicsJoint`, `setPhysicsJointEnabled` |
| Physics query | nearest, overlap, raycast, segment-cast, shape-cast, contact/manifold, contact impulse snapshot |

`FrameState`는 render/audio/collision/debug snapshot이다. `FrameState.physics.mode`는 현재 runtime physics mode 표시용이며, 게임 규칙의 source of truth가 아니므로 장기 simulation state로 사용하지 않는다.

## Runtime API

`createFerrumRuntime(...)`은 browser app에서 우선 사용하는 high-level entrypoint다.

| 타입/API | 역할 |
| --- | --- |
| `FerrumRuntime` | `engine`, `renderer`, `input`, `assetHost`, optional `debugOverlay`/`uiOverlay`와 lifecycle method를 묶는다. |
| `FerrumRuntimeOptions` | canvas, renderer/input/ui/debug/engine option, per-frame callback을 받는다. |
| `FerrumRuntimeFrame` | `FrameState`, renderer stats, debug metrics, fps/render time snapshot이다. |
| `UiOverlayStateProvider` | runtime frame을 읽어 HUD/menu/dialog state를 만든다. |

## Renderer API

현재 제품 renderer는 WebGL2다.

- `WebGL2Renderer`: WebGL2 sprite/debug line renderer
- `Renderer`: `render`, `resize`, `stats`, `destroy` 계약
- `RendererStats`: draw call, batch, sprite, texture bind/switch, physics debug line count
- `createRenderer`: WebGL2 renderer factory

`WebGPURenderer`, `CreateRendererOptions.webgpu`, `preferred: "webgpu"`는 호환/진단용 export다. 현재 제품 기능으로 WebGPU를 활성화하지 않는다.

## Game Spec API

Top-down Shooter Game Spec의 상세 필드와 예시는 [Top-down Shooter Game Spec](topdown-shooter-game-spec.md)에 둔다. Public API 문서에서는 코드 계약만 요약한다.

- `ShooterGameSpec`: 사용자 입력 JSON 구조
- `ResolvedShooterGameSpec`: 기본값과 검증이 적용된 구조
- `ShooterGameSpecTarget`: Game Spec을 적용받는 target method 계약
- `ShooterPrefabSpec`, `ShooterPrefabColliderSpec`: prefab 크기, animation, collider metadata
- `ShooterTilemapSpec`, `ShooterTileSpec`, `ShooterTileSlopeSpec`: tilemap, one-way, slope metadata
- `ShooterWaveSpec`, `ShooterEnemyPresetSpec`, `ShooterCameraSpec`, `ShooterAudioSpec`: shooter gameplay 설정
- `ShooterGameSpec.physics`: 범용 [Physics Spec](physics-spec.md) namespace. 계약/검증, runtime mode 병합, `createPhysicsWorldFromSpec(...)` 기반 generic body/joint apply에 사용한다.

Game Spec 검증의 코드 기준은 `packages/ferrum-web/src/gameSpec.ts`이며, JSON Schema는 편집기 보조 기준이다.

Runtime tilemap 변경은 shooter scene의 기존 tilemap occupancy를 수정하는 낮은 빈도 API다. `FerrumEngine.setShooterTilemapTile(...)`은 단일 cell을, `FerrumEngine.setShooterTilemapTilesRect(...)`는 폭발/드릴 같은 직사각형 cell 묶음을 바꾼다. Collision layer 변경은 Rust tile obstacle cache를 즉시 갱신하고 render command는 같은 tile occupancy에서 다시 생성된다. 이 API는 P2 destructible terrain prototype 표면이며, pixel mask terrain이나 dirty chunk partial rebuild 제품 기능은 아직 포함하지 않는다.

## Physics Spec API

범용 physics authoring 계약은 [Physics Spec](physics-spec.md)에 둔다.

| 타입/API | 역할 |
| --- | --- |
| `PhysicsMode` | `"none"`, `"arcade"`, `"rigid"` mode 계약 |
| `PhysicsSpec` | Game Spec `physics` namespace 입력 구조 |
| `ResolvedPhysicsSpec` | 기본값, layer bit mask, 참조 검증이 적용된 구조 |
| `resolvePhysicsSpec(...)` | `PhysicsSpec`을 검증하고 resolved 구조를 반환 |
| `createPhysicsWorldFromSpec(...)` | raw/resolved Physics Spec을 `FerrumEngine` generic rigid body world에 적용 |
| `PhysicsWorldApplyResult` | body/joint handle mapping, summary, warning, step option, clear callback |
| `PhysicsWorldSnapshot` | versioned JSON snapshot. Physics Spec 기반 world의 body/joint runtime state와 replay hash를 담는다. |
| `capturePhysicsWorldSnapshot(...)` | `PhysicsWorldApplyResult`의 body/joint handle을 조회해 snapshot을 만든다. |
| `restorePhysicsWorldSnapshot(...)` | snapshot의 `ResolvedPhysicsSpec`을 다시 적용하고 body/joint state를 복원한다. |
| `verifyPhysicsReplayRollback(...)` | snapshot restore 후 같은 frame 수를 재시뮬레이션해 hash를 비교한다. |
| `PhysicsReplayInputStream` | frame, seed, fixed step, snapshot interval, body event를 담는 replay input stream |
| `runPhysicsReplayInputStream(...)` | replay input stream을 실행하고 interval snapshot과 replay hash를 반환한다. |
| `verifyPhysicsReplayInputStreamRollback(...)` | 같은 input stream을 snapshot restore 이후 다시 실행해 hash를 비교한다. |
| `PhysicsAuthoringDocument` | runtime `physics`와 editor/AI metadata `physicsEditor`를 분리한 authoring document |
| `compilePhysicsAuthoringDocument(...)` | authoring document에서 editor metadata를 제거해 runtime `PhysicsSpec`을 반환 |
| `createRigidBody(...)` | helper options를 `spawnRigidBody(...)` 호출로 정규화 |
| `createCollider(...)` | `box`/`aabb` alias와 shape option을 runtime collider 구조로 정규화 |
| `createJoint(...)` | `world` anchor, limit/motor option을 `spawnPhysicsJoint(...)` 호출로 정규화 |
| `physicsMaterial(...)`, `PHYSICS_MATERIAL_PRESETS` | built-in material preset과 override helper |
| `createPhysicsLayerMap(...)`, `createPhysicsLayerSpec(...)`, `physicsLayerMaskBits(...)` | named layer pattern에서 category/mask bit 계산 |
| `PhysicsDebugOptions` | broadphase/contact/collider/joint/sleeping/layer/CCD debug category 옵션 |
| `CreateEngineOptions.physicsMode` | Game Spec보다 우선하는 engine-level physics mode override |
| `CreateEngineOptions.physicsDebugOptions` | engine 생성 시 적용할 physics debug category 옵션 |
| `FerrumRuntimeOptions.physicsMode` | `createFerrumRuntime(...)`에서 직접 지정하는 physics mode override |

## Asset Pipeline API

| API | 용도 |
| --- | --- |
| `AssetLoader` / `AudioAssetLoader` | texture/sound/JSON asset loading |
| `importAsepriteAtlasFrames(...)` | Aseprite JSON frame metadata를 Game Spec atlas frame으로 변환 |
| `importTiledGameSpec(...)` / `importTiledTilemap(...)` | Tiled orthogonal JSON map을 atlas/tilemap 설정으로 변환 |
| `importLDtkGameSpec(...)` / `importLDtkTilemap(...)` | LDtk project/level data를 atlas/tilemap 설정으로 변환 |
| `generateTextureAtlasLayout(...)` | atlas layout helper |

Asset pipeline helper는 metadata 변환을 담당한다. Runtime asset fetch/cache와 texture/audio resource 생성은 platform layer가 담당한다.

## Physics API

Physics 구현 범위는 [2D 물리엔진 기능 맵](../development/architecture/physics-engine.md)을 기준으로 한다. Web public API는 낮은 빈도의 authoring/control/query 흐름을 대상으로 한다.

| 그룹 | 대표 타입/API |
| --- | --- |
| Spec apply/helper | `createPhysicsWorldFromSpec`, `PhysicsWorldApplyResult`, `createRigidBody`, `createCollider`, `createJoint` |
| Material/layer authoring | `physicsMaterial`, `PHYSICS_MATERIAL_PRESETS`, `createPhysicsLayerMap`, `createPhysicsLayerSpec`, `physicsLayerMaskBits` |
| Step/stats | `stepRigidBodies`, `PhysicsRigidBodyStepOptions`, `PhysicsRigidBodyStepStats` |
| Body authoring | `PhysicsRigidBodySpawnOptions`, `PhysicsEntityHandle`, `PhysicsEntitySnapshot` |
| Body control | `setPhysicsBodyPosition`, `setPhysicsBodyVelocity`, `setPhysicsBodyRotation`, `setPhysicsBodyEnabled`, force/impulse/torque |
| Body collider/material/tuning | `PhysicsBodyColliderOptions`, `PhysicsBodyColliderSnapshot`, `addPhysicsBodyCollider`, `getPhysicsBodyColliderCount`, `getPhysicsBodyCollider`, `setPhysicsBodyColliderMaterial`, `PhysicsRigidBodyMaterial`, `PhysicsMaterialSnapshot`, `PhysicsRigidBodyMassProperties`, `PhysicsRigidBodyTuning` |
| Joint authoring | `PhysicsJointSpawnOptions`, `PhysicsJointHandle`, `PhysicsJointSnapshot` |
| Snapshot/replay | `PhysicsWorldSnapshot`, `PhysicsReplayInputStream`, `capturePhysicsWorldSnapshot`, `restorePhysicsWorldSnapshot`, `hashPhysicsWorldSnapshot`, `runPhysicsReplayInputStream`, `verifyPhysicsReplayRollback`, `verifyPhysicsReplayInputStreamRollback` |
| Editor/AI authoring | `PhysicsAuthoringDocument`, `compilePhysicsAuthoringDocument`, `validatePhysicsAuthoringDocument`, `schemas/physics-authoring.schema.json` |
| Overlap query | `PhysicsPointBodyQuery`, `PhysicsAabbBodyQuery`, `PhysicsCircleBodyQuery`, `PhysicsOrientedBoxBodyQuery`, `PhysicsCapsuleBodyQuery`, `PhysicsConvexPolygonBodyQuery` |
| Cast query | `PhysicsRaycastBodyQuery`, `PhysicsSegmentCastBodyQuery`, shape별 `Physics...BodyShapeCastQuery` |
| Tile query | `PhysicsNearestTileObstacleQuery`, `PhysicsRaycastTileObstacleQuery`, `PhysicsAabbTileObstacleShapeCastQuery`, tile contact/manifold query |
| Result buffers | `PhysicsBodyQueryHit`, `PhysicsRaycastBodyHit`, `PhysicsShapeCastBodyHit`, tile query hit types, `PhysicsRigidContactImpulseHit` |

Rust crate의 low-level `World`, `PhysicsSystem`, collider/joint helper는 Web package entrypoint에서 직접 re-export하지 않는다.

`PhysicsJointSpawnOptions`의 공식 joint type은 `distance`, `rope`, `spring`, `revolute`, `prismatic`, `weld`, `gear`다. `weld`는 local anchor와 `referenceAngle`을 기준으로 두 rigid body의 상대 위치/회전을 고정하며, `breakDistance`와 `breakAngle`을 지원한다.

`PhysicsRigidBodyCollider`는 generic runtime body 생성에서 AABB, circle, capsule, oriented box, convex polygon, edge를 지원한다. `edge`는 `startX`, `startY`, `endX`, `endY` local segment와 optional offset을 사용하며, zero-length segment는 생성이 거부된다.

`addPhysicsBodyCollider(handle, options)`는 기존 rigid body에 secondary collider를 추가한다. 첫 collider는 기존 `spawnRigidBody(...)`/단일 collider API의 primary collider(index `0`)이고, 추가 collider는 body-local index `1+`를 사용한다. `getPhysicsBodyColliderCount(...)`와 `getPhysicsBodyCollider(...)`는 낮은 빈도 tooling/snapshot 용도로 collider index, type, enabled/trigger, offset, material override, category/mask bit를 조회한다. Contact/query/debug 결과는 현재 public API에서 body/entity 단위로 반환된다. Collider별 material/filter/trigger/enabled 값은 runtime collision/query/debug와 contact solver에 반영된다.

## UI와 Debug API

- `UiOverlay`: DOM 기반 HUD/menu/dialog/action overlay
- `UiOverlayState`, `UiPanel`, `UiDialog`, `UiAction`: UI state contract
- `DebugOverlay`: fps, renderer stats, physics stats, lifecycle/debug metrics 표시
- `DebugOverlayMetrics`, `RendererStats`: debug overlay와 renderer stats 계약
- `PhysicsDebugOptions`: `broadphase`, `contacts`, `manifolds`, `colliders`, `joints`, `sleeping`, `layers`, `ccd` category 계약

UI/debug overlay는 platform layer 상태 표시용이다. Rust simulation state를 대체하지 않는다.

## Buffer Decoder Export

`wasmBridge.ts`의 buffer view와 decoder 타입은 advanced 사용자를 위해 export한다.

- render/audio/collision buffer view
- physics debug line buffer view
- physics query/cast/contact/manifold result buffer view
- rigid contact impulse result buffer view

일반 애플리케이션은 `FerrumEngine`과 `FrameState`를 우선 사용한다.

## Deprecated API 정책

호환을 위해 남아 있지만 신규 코드에서 사용하지 않는 항목이 있다.

- `CreateEngineOptions.includeDeprecatedRenderCommands`: 매 프레임 object 배열을 생성하므로 기본 buffer path를 사용한다.
- `CreateEngineOptions.useWorkerClock`: 현재 범위 밖이라 무시된다.
- WebGPU 관련 renderer option/export: WebGL2 fallback 진단용이다.
- generated wasm-bindgen API 직접 import: public API가 아니다.

Deprecated 항목을 제거하거나 동작을 바꿀 때는 README, 예제, release note를 함께 갱신한다.

## 오류 진단 정책

- 사용자 설정 오류는 `FerrumDiagnosticError`와 `DiagnosticReport`로 설명 가능한 메시지를 제공한다.
- Game Spec validation은 어떤 필드가 잘못됐는지 path를 포함한다.
- package/release artifact 검증은 `pnpm package:check`, `pnpm release:check`를 기준으로 한다.

## 기본 사용 예시

```ts
import {
  BrowserPlatformHost,
  createFerrumRuntime,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("missing #game canvas");

const platform = new BrowserPlatformHost();
const runtime = await createFerrumRuntime({
  canvas,
  assetHost: platform,
  environment: "development",
  debug: true,
});

const spec: ShooterGameSpec = await fetch("/game.json").then((res) => res.json());
runtime.engine.setGameSpec(spec);
runtime.start();
```

## API 변경 규칙

- Public export를 추가/삭제/rename하면 `packages/ferrum-web/src/index.ts`, 이 문서, README/예제를 함께 확인한다.
- Wasm buffer layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.
- Top-down Shooter Game Spec 필드가 바뀌면 [Top-down Shooter Game Spec](topdown-shooter-game-spec.md), schema, 예제 `game.json`, validation을 함께 갱신한다.
- Architecture나 physics 책임 경계가 바뀌면 [아키텍처](../development/architecture/architecture.md), [2D 물리엔진 기능 맵](../development/architecture/physics-engine.md)을 함께 갱신한다.
