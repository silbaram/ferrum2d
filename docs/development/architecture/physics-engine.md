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
| Physics editor/AI authoring schema | `packages/ferrum-web/src/physicsAuthoringSchema.ts`, `schemas/physics-authoring.schema.json` |
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
| Collider | AABB, circle, capsule, oriented box, convex polygon, edge |
| Collider 옵션 | local offset, enable/disable, material override, collision filter |
| Collision filter | layer pair와 category/mask bitset |
| Broadphase | AABB proxy 기반 sweep-and-prune |
| Narrowphase | overlap, contact normal/penetration, 대표 contact point, 일부 2점 manifold |
| CCD/query | swept AABB, raycast/segment-cast, point/AABB/circle/oriented-box/capsule/convex-polygon query, edge raycast/segment-cast, shape cast |
| Kinematic movement | move-and-slide, tilemap obstacle, one-way platform, moving platform carry |
| Platformer support | ground probe, controller config/state, coyote time, jump buffering, step offset, slope snap |
| Rigid body | static/kinematic/dynamic, mass/inertia, force/impulse/torque, gravity scale, damping, sleep/wake |
| Solver | substep, contact impulse, friction/restitution, Baumgarte tuning, split impulse, island metrics/scheduling |
| Joints | distance, rope, spring, revolute, prismatic, weld, gear |
| Tilemap physics | merged AABB obstacle cache, runtime cell/rect refresh, one-way tile, slope definition |
| Events/stats | collision enter/stay/exit/hit, trigger lifecycle, physics frame stats, rigid body step stats |
| Debug | category별 broadphase/contact/collider/joint debug line buffer, sleeping color, DebugOverlay physics metrics, WebGL2 debug line rendering |

## Runtime별 사용 경계

### Built-in scenes

`ShooterScene`, `BreakoutScene`, `PlatformerScene`은 Rust core 안에서 동작한다.

- Shooter: bullet/enemy swept collision, player/enemy collision, score/game over, Game Spec 기반 prefab/tilemap/audio/camera 설정
- Breakout: paddle/ball/brick/wall collision과 event buffer 회귀
- Platformer: kinematic controller, one-way/moving platform, slope/tilemap 경로 검증

### Generic physics API

`FerrumEngine`은 낮은 빈도의 physics authoring/control/query API를 제공한다.

- runtime: `configureFixedTimestep(...)`, `setPhysicsDebugLinesEnabled(...)`, `stepRigidBodies(...)`
- spec apply/helper: `createPhysicsWorldFromSpec(...)`, `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)`
- body: `spawnRigidBody(...)`, `getPhysicsEntity(...)`, `despawnPhysicsEntity(...)`, `setPhysicsBodyPosition(...)`
- body control: velocity, rotation, angular velocity, enabled, force/impulse, torque/angular impulse
- material/tuning: body material, collider material, mass properties, solver tuning
- joint: `spawnPhysicsJoint(...)`, `getPhysicsJoint(...)`, `clearPhysicsJoint(...)`, `setPhysicsJointEnabled(...)`
- query: nearest body/tile, body overlap, body raycast/segment-cast, body shape-cast, tile raycast/segment-cast, tile shape-cast/contact/manifold, current body contact/manifold, rigid contact impulse snapshot
- snapshot/replay: `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayRollback(...)`, `verifyPhysicsReplayInputStreamRollback(...)`
- editor/AI authoring: `compilePhysicsAuthoringDocument(...)`, `validatePhysicsAuthoringDocument(...)`, `physicsEditor` metadata schema

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
| solver snapshot | `World::snapshot()`/`restore_snapshot(...)`, `queryRigidContactImpulses`, `stepRigidBodies` stats, Physics Spec world snapshot/replay helper, replay input stream interval snapshot |

정확한 타입 이름과 필드는 `packages/ferrum-web/src/createEngine.ts`와 [Public API](../../engine/public-api.md)를 기준으로 한다.

## Physics Spec과 Game Spec 연결

Shooter Game Spec은 전용 prefab/tilemap metadata와 범용 `physics` namespace를 함께 지원한다.

범용 [Physics Spec](../../engine/physics-spec.md)은 다음 계약을 제공한다.

- `none` / `arcade` / `rigid` physics mode
- gravity, fixed timestep, continuous, solver iteration 기본값
- material, layer, body, collider, joint metadata validation
- material/layer/body/joint 참조 diagnostic
- `CreateEngineOptions.physicsMode`, `FerrumRuntimeOptions.physicsMode` runtime override
- `createPhysicsWorldFromSpec(...)` runtime apply와 body/joint handle mapping
- material preset, layer/mask helper, browser physics sandbox fixture

Shooter 전용 Game Spec은 다음 physics metadata를 지원한다.

- prefab collider: AABB, circle, capsule, oriented box, convex polygon
- prefab collider material
- tile collision layer
- tile one-way platform metadata
- tile slope metadata
- Tiled/LDtk import helper를 통한 atlas/tilemap metadata 변환

Generic rigid body/joint authoring metadata는 `physics` namespace에서 검증되고, `createPhysicsWorldFromSpec(...)`를 통해 runtime world에 opt-in 적용할 수 있다. 현재 apply 경로는 body당 1개 이상의 collider, AABB/box/circle/capsule/oriented-box/convex-polygon/edge collider, edge segment로 낮춘 chain collider, distance/rope/spring/revolute/prismatic/weld/gear joint를 지원한다. 첫 collider는 primary collider(index `0`)로 기존 단일 collider API와 호환되고, secondary collider는 `addPhysicsBodyCollider(...)` 경로로 같은 body에 추가된다. `"world"` joint endpoint는 helper가 collision-disabled static anchor body로 변환한다. dedicated `chain` runtime storage는 여러 edge segment 또는 별도 composite storage를 Rust core에 직접 넣을 후속 범위다.

## 현재 제외 또는 제한

- dedicated chain collider runtime storage와 tilemap boundary extraction 구현
- tilemap destructible terrain dirty chunk partial rebuild와 pixel mask terrain
- CCD per-hit 위치 marker line ABI
- external physics dependency
- per-entity Web callback 기반 collision handling
- built-in scene loop에 generic Physics Spec body/joint를 자동 적용하는 것
- built-in scene loop에 generic rigid body solver를 자동 적용하는 것
- Web Worker/Wasm threads 기반 physics execution

## 문서 동기화 규칙

physics 코드가 바뀌면 이 문서는 상세 구현 이력을 늘리는 대신 다음만 갱신한다.

- 지원/제외 범위 표
- Web API 그룹
- Game Spec 연결 여부
- 기준 소스 또는 검증 경계

개별 milestone의 세부 계획은 이 문서에 누적하지 않는다.
