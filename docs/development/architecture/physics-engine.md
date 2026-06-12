# 2D 물리엔진 기능 맵

이 문서는 Ferrum2D의 현재 physics 기능 범위를 코드 기준으로 요약한다. 세부 구현의 기준은 Rust core와 Web public API 코드이며, milestone 번호별 과거 계획은 기준 문서로 유지하지 않는다.

## 기준 소스

| 영역 | 코드 기준 |
| --- | --- |
| Component/body/collider/joint model | `crates/ferrum-core/src/components.rs` |
| World storage/API | `crates/ferrum-core/src/world.rs` |
| Collision/query/manifold | `crates/ferrum-core/src/collision.rs` |
| Movement/rigid body solver/platformer | `crates/ferrum-core/src/physics.rs` |
| Tilemap obstacle/slope/one-way | `crates/ferrum-core/src/tilemap.rs` |
| Wasm bridge methods | `crates/ferrum-core/src/engine.rs` |
| Web physics API | `packages/ferrum-web/src/createEngine.ts` |
| Physics Spec resolver | `packages/ferrum-web/src/physicsSpec.ts` |
| Physics authoring/apply helper | `packages/ferrum-web/src/physicsAuthoring.ts` |
| Physics snapshot/replay helper | `packages/ferrum-web/src/physicsSnapshot.ts` |
| Physics replay Worker client | `packages/ferrum-web/src/physicsReplayWorker.ts`, `packages/ferrum-web/src/physicsReplayWorkerEntry.ts` |
| Physics editor/AI authoring schema | `packages/ferrum-web/src/physicsAuthoringSchema.ts`, `schemas/physics-authoring.schema.json` |
| Tilemap boundary extraction | `packages/ferrum-web/src/tilemapPhysics.ts` |
| Pixel mask terrain helper/runtime | `packages/ferrum-web/src/pixelMaskTerrain.ts`, `packages/ferrum-web/src/pixelMaskTerrainRuntime.ts` |
| Query decoders | `packages/ferrum-web/src/physicsQueryDecoder.ts`, `wasmBridge.ts` |
| Browser sandbox | `examples/physics-sandbox` |

## 설계 원칙

- Rust core가 simulation state, collision query, solver state를 소유한다.
- TypeScript는 낮은 빈도의 authoring/control/query wrapper와 buffer decoding만 담당한다.
- 프레임 hot path에서 entity별 JS/Wasm callback을 만들지 않는다.
- Web API 결과는 bulk buffer를 읽어 필요한 경우에만 object 배열로 decode한다.
- Shooter/Breakout/Platformer scene loop에 generic rigid body solver를 자동 연결하지 않는다. generic physics API는 opt-in이다.

## 현재 지원 범위

| 영역 | 지원 내용 |
| --- | --- |
| Transform/velocity | `Transform2D`, `Velocity`, `Rotation2D`, `AngularVelocity` |
| Collider | AABB, circle, capsule, oriented box, convex polygon, edge, chain |
| Collider 옵션 | local offset, enable/disable, material override, collision filter |
| Collision filter | layer pair, category/mask bitset, optional HD-2D floor/height span filter |
| Broadphase | AABB proxy 기반 sweep-and-prune |
| Narrowphase | overlap, contact normal/penetration, 대표 contact point, 일부 2점 manifold |
| CCD/query | continuous opt-in CCD, swept AABB pruning, raycast/segment-cast, point/AABB/circle/oriented-box/capsule/convex-polygon query, edge raycast/segment-cast, shape cast |
| Kinematic movement | move-and-slide, tilemap obstacle, one-way platform, moving platform carry, HD-2D step/ramp/ledge/bridge-under movement |
| Platformer support | ground probe, controller config/state, coyote time, jump buffering, step offset, slope snap |
| Rigid body | static/kinematic/dynamic, mass/inertia, force/impulse/torque, gravity scale, damping, sleep/wake |
| Solver | substep, contact impulse, friction/restitution, Baumgarte tuning, split impulse, island metrics/scheduling |
| Joints | distance, rope, spring, pulley, revolute, prismatic, weld, gear |
| Tilemap physics | merged AABB obstacle cache, dirty chunk 기반 runtime cell/rect refresh, one-way tile, slope definition, tile floor/elevation/height span metadata, HD-2D tile kind/ramp/blocking metadata, collision layer -> chain boundary extraction |
| Pixel mask terrain | alpha mask edit, dirty patch extraction, WebGL2 texture create/update, chunk 단위 Physics Spec chain collider rebuild |
| Events/stats | collision enter/stay/exit/hit, trigger lifecycle, physics frame stats, rigid body step stats |
| Debug | category별 broadphase/contact/collider/joint/CCD debug line buffer, sleeping color, DebugOverlay physics metrics, WebGL2 debug line rendering |
| HD-2D foundation | `PhysicsFloorId`/`HeightSpan` storage, Physics Spec `physics.hd2d`, body/tile `floor`/`elevation`/`height`, tile `kind`/`ramp`/bridge/blocking metadata, runtime body/tile height span API, runtime tile HD-2D metadata API, body/tile query height filter, bridge portal multi-floor navigation, projectile arc height span, built-in combat/projectile tile height filter, render sort key, lighting occluder height helper, filter/player telemetry, snapshot sidecar restore |

## Runtime별 사용 경계

### Built-in scenes

`ShooterScene`, `BreakoutScene`, `PlatformerScene`은 Rust core 안에서 동작한다.

- Shooter: bullet/enemy swept collision, player/enemy collision, score/game over, Game Spec 기반 prefab/tilemap/audio/camera 설정
- Breakout: paddle/ball/brick/wall collision과 event buffer 회귀
- Platformer: kinematic controller, one-way/moving platform, slope/tilemap 경로 검증

### Generic physics API

`FerrumEngine`은 낮은 빈도의 physics authoring/control/query API를 제공한다.

- runtime: `configureFixedTimestep(...)`, `setPhysicsDebugLinesEnabled(...)`, `stepRigidBodies(...)`, `PhysicsRigidBodyStepOptions.continuous`
- spec apply/helper: `createPhysicsWorldFromSpec(...)`, `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)`, `createVehicleRig(...)`
- body: `spawnRigidBody(...)`, `getPhysicsEntity(...)`, `despawnPhysicsEntity(...)`, `setPhysicsBodyPosition(...)`
- body control: velocity, rotation, angular velocity, enabled, force/impulse, torque/angular impulse, optional `setPhysicsBodyHeightSpan(...)` / `clearPhysicsBodyHeightSpan(...)`, `moveHd2dKinematicBodyWithTilemap(...)`
- material/tuning: body material, collider material, mass properties, solver tuning
- joint: `spawnPhysicsJoint(...)`, `getPhysicsJoint(...)`, `clearPhysicsJoint(...)`, `setPhysicsJointEnabled(...)`
- query: nearest body/tile, body overlap, body raycast/segment-cast, body shape-cast, optional body/tile query `heightSpan` filter, tile raycast/segment-cast, tile shape-cast/contact/manifold, current body contact/manifold, rigid contact impulse snapshot
- snapshot/replay: `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `capturePhysicsBodyStateBuffer(...)`, `restorePhysicsBodyStateBuffer(...)`, `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayRollback(...)`, `verifyPhysicsReplayInputStreamRollback(...)`, `createPhysicsReplayWorkerClient(...)`
- editor/AI authoring: `compilePhysicsAuthoringDocument(...)`, `validatePhysicsAuthoringDocument(...)`, `physicsEditor` metadata schema
- terrain authoring/runtime: `extractTilemapBoundaryChains(...)`, `PixelMaskTerrain`, `extractPixelMaskBoundaryChains(...)`, `createPixelMaskTerrainRuntime(...)`

이 API는 editor나 runtime tooling처럼 호출 빈도가 낮은 흐름을 대상으로 한다. entity별 매 프레임 authoring stream 용도가 아니다.

### Rust-only helpers

일부 helper는 Rust crate API로만 제공된다.

- `PhysicsSystem`의 low-level movement/query/solver helper
- `World`의 collider/joint storage 접근자
- collider shape별 mass/inertia helper
- `Tilemap` obstacle/slope/one-way 설정 helper

Web package가 이 Rust helper를 직접 re-export하지는 않는다.

## Web query 형태

| Query 그룹 | Web API |
| --- | --- |
| nearest | `queryNearestBody`, `queryNearestTileObstacle` |
| body overlap | `queryPointBodies`, `queryAabbBodies`, `queryCircleBodies`, `queryOrientedBoxBodies`, `queryCapsuleBodies`, `queryConvexPolygonBodies` |
| body cast | `raycastBodies`, `segmentCastBodies`, shape별 `shapeCast...Bodies` |
| tile obstacle | `raycastTileObstacles`, `segmentCastTileObstacles`, `shapeCastAabbTileObstacles` |
| contact/manifold | `queryBodyContacts`, `queryBodyManifolds`, `queryAabbTileObstacleContacts`, `queryAabbTileObstacleManifolds` |
| solver snapshot | `World::snapshot()`/`restore_snapshot(...)`, Wasm bulk body state buffer, `queryRigidContactImpulses`, `stepRigidBodies` stats, Physics Spec world snapshot/replay helper, replay input stream interval snapshot |

Body nearest/overlap/cast query와 tile nearest/raycast/segment-cast/shape-cast/contact/manifold query는 optional `heightSpan`을 받을 수 있다. 지정하지 않으면 기존 XY/mask query와 같고, 지정하면 같은 floor이면서 height span이 겹치는 대상만 결과에 포함한다. explicit filter가 지정되면 height span이 없는 legacy body/tile은 결과에서 제외된다. 정확한 타입 이름과 필드는 `packages/ferrum-web/src/createEngine.ts`와 [Public API](../../engine/public-api.md)를 기준으로 한다.

## Physics Spec과 Game Spec 연결

Shooter Game Spec은 전용 prefab/tilemap metadata와 범용 `physics` namespace를 함께 지원한다.

범용 [Physics Spec](../../engine/physics-spec.md)은 다음 계약을 제공한다.

- `none` / `arcade` / `rigid` physics mode
- gravity, fixed timestep, continuous, solver iteration 기본값과 runtime step option 반영
- material, layer, body, collider, joint metadata validation
- material/layer/body/joint 참조 diagnostic
- `CreateEngineOptions.physicsMode`, `FerrumRuntimeOptions.physicsMode` runtime override
- `createPhysicsWorldFromSpec(...)` runtime apply와 body/joint handle mapping
- HD-2D `physics.hd2d`와 body `floor`/`elevation`/`height` validation 및 runtime height span 적용
- material preset, layer/mask helper, browser physics sandbox fixture

Shooter 전용 Game Spec은 다음 physics metadata를 지원한다.

- prefab collider: AABB, circle, capsule, oriented box, convex polygon
- prefab collider material
- tile collision layer
- tile one-way platform metadata
- tile slope metadata
- tile floor/elevation/height/kind/ramp/bridge/blocking metadata와 Tiled/LDtk custom metadata import
- bridge portal `toHeightSpan` navigation path query
- Top-down projectile arc와 bullet/tile `blocksProjectile` height filter
- Tiled/LDtk import helper를 통한 atlas/tilemap metadata 변환

Generic rigid body/joint authoring metadata는 `physics` namespace에서 검증되고, `createPhysicsWorldFromSpec(...)`를 통해 runtime world에 opt-in 적용할 수 있다. 현재 apply 경로는 body당 1개 이상의 collider, AABB/box/circle/capsule/oriented-box/convex-polygon/edge/chain collider, distance/rope/spring/pulley/revolute/prismatic/weld/gear joint를 지원한다. 첫 collider는 primary collider(index `0`)로 기존 단일 collider API와 호환되고, secondary collider는 `addPhysicsBodyCollider(...)` 경로로 같은 body에 추가된다. `"world"` joint endpoint는 helper가 collision-disabled static anchor body로 변환한다. `chain`은 Rust core에서 dedicated storage로 보존되고, 내부 collision/query/debug 경로에서 segment를 순회한다.

## 현재 제외 또는 제한

- external physics dependency
- per-entity Web callback 기반 collision handling
- built-in scene loop에 generic Physics Spec body/joint를 자동 적용하는 것
- built-in scene loop에 generic rigid body solver를 자동 적용하는 것
- 전체 built-in scene loop의 Web Worker 이전 또는 Wasm threads 기반 physics execution
- 별도 multi-hitbox/hurtbox authoring DSL
- 고급 roof/wall visibility rule, entity shadow scale/offset, material 기반 lighting response
- 3D rigid body solver

## 문서 동기화 규칙

physics 코드가 바뀌면 이 문서는 상세 구현 이력을 늘리는 대신 다음만 갱신한다.

- 지원/제외 범위 표
- Web API 그룹
- Game Spec 연결 여부
- 기준 소스 또는 검증 경계

개별 milestone의 세부 계획은 이 문서에 누적하지 않는다.
