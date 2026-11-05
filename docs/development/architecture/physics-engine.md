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
| CCD/query | swept AABB, raycast/segment-cast, point/AABB/circle/oriented-box/capsule/convex-polygon query, edge raycast/segment-cast, shape cast |
| Kinematic movement | move-and-slide, tilemap obstacle, one-way platform, moving platform linear carry, opt-in moving platform rotation carry, HD-2D step/ramp/ledge/bridge-under movement |
| Platformer support | ground probe, controller config/state, coyote time, jump buffering, step offset, slope snap |
| Rigid body | static/kinematic/dynamic, finite-reciprocal mass/inertia gate, force/impulse/torque, gravity scale, damping, sleep/wake |
| Solver | substep, contact impulse, friction/restitution, Baumgarte tuning, split impulse, island metrics/scheduling |
| Joints | distance, rope, spring, pulley, revolute, prismatic, weld, gear. Distance/Rope/Spring은 optional local anchor와 회전 관성 effective mass를 지원하고, Spring partial stiffness는 soft denominator로 velocity solve에 적용한다. Pulley는 기본 equality constraint와 opt-in slack inequality를 지원한다. Revolute limit은 기본 normalized 상대각과 opt-in continuous multi-turn 상대각을 지원한다. Weld는 off-center anchor position correction을 relative angle correction과 coupled solve로 처리 |
| Tilemap physics | merged AABB obstacle cache, dirty chunk 기반 runtime cell/rect refresh, one-way tile, slope definition, tile floor/elevation/height span metadata, HD-2D tile kind/ramp/blocking metadata, collision layer -> chain boundary extraction |
| Pixel mask terrain | alpha mask edit, dirty patch extraction, WebGL2 texture create/update, chunk 단위 Physics Spec chain collider rebuild |
| Events/stats | collision enter/stay/exit/hit, trigger lifecycle, physics frame stats, rigid body step stats |
| Debug | category별 broadphase/contact/collider/joint/CCD debug line buffer, sleeping color, DebugOverlay physics metrics, WebGL2 debug line rendering |
| HD-2D foundation | `PhysicsFloorId`/`HeightSpan` storage, Physics Spec `physics.hd2d`, body/tile `floor`/`elevation`/`height`, tile `kind`/`ramp`/bridge/blocking metadata, runtime body/tile height span API, runtime tile HD-2D metadata API, body/tile query height filter, bridge portal multi-floor navigation, projectile arc height span, built-in combat/projectile tile height filter, render sort key, lighting occluder height helper, filter/player telemetry, snapshot sidecar restore |

선형 rigid-body CCD는 moving/target의 유효한 non-trigger compound collider와 chain segment를
각각 sweep하고 가장 이른 접촉을 선택한다. 내부 후보와 hit가 entity·collider·segment identity를
유지하므로 실제 접촉한 collider의 filter와 material override가 적용된다. Primary collider가
sensor이거나 비활성화되어도 별도 solid collider의 접촉을 막지 않는다. 같은 시각의 hit는
target entity, moving collider/segment, target collider/segment 순으로 안정적으로 선택한다.
회전하는 OBB/convex polygon은 convex 분리 간격과 상대 surface-speed 상한으로
conservative advancement를 수행한다. offset과 local vertex 회전 반경을 포함한 broadphase
영역을 사용하며, 한 query 64회·body sweep/재시도 4회·동적 연쇄 깊이 8회로 작업량을 제한한다.
상한에 도달하면 마지막 안전 pose에 머물고 무검사 잔여 이동을 하지 않는다.
계산 한도 도달은 실제 접촉과 구분하며 충격 이벤트를 만들지 않고 CCD 상한 진단에 기록한다.
동적 충돌 target은 TOI까지의 선행 구간과 충돌 후 남은 구간을 모두 검사한다. 선행 구간의
방해물이 있으면 target을 먼저 처리하고 source의 sweep를 재시도한다. 이미 진행한 body/연쇄
ancestor는 잔여 구간에서 정지 장벽으로 취급한다.
이는 보수적인 clipping 정책으로, 모든 body를 공통 TOI 순서로 푸는 전역 연속 solver는 아니다.
기존 penetration은 discrete solver가 처리하며 AABB/circle/capsule/edge의 shape 회전 의미는 변경하지 않는다.

HD-2D 보행의 AABB actor도 같은 native shape sweep으로 원·캡슐·회전 박스·convex polygon·edge·chain과
compound 장애물을 판정한다. 일반 이동, cached navigation probe, 층 연결의 source/destination pose가
각 collider/segment key와 filter를 유지한다. Spatial actor는 기존의 단일 AABB 제한을 유지하며
지지면·계단/경사로·다리의 층/높이 결정은 기존 Rust 지형 controller가 담당한다.

## Runtime별 사용 경계

### Built-in scenes

`ShooterScene`, `BreakoutScene`, `PlatformerScene`은 Rust core 안에서 동작한다.

- Shooter: bullet/enemy swept collision, player/enemy collision, score/game over, Game Spec 기반 prefab/tilemap/audio/camera 설정
- Breakout: paddle/ball/brick/wall collision과 event buffer 회귀
- Platformer: kinematic controller, one-way/moving platform, slope/tilemap 경로 검증

### Platformer/KCC 기본 정책

Platformer KCC는 물리적 보편 해답보다 예제 게임감과 기존 fixture 호환성을 우선한다. 기본 controller에는 별도 skin/shell margin을 추가하지 않고, `ground_probe_distance`와 기존 sweep epsilon 계약을 유지한다.

- One-way platform은 frame history 없이 per-sweep stateless 판정이 기본이다. apex 전환 stuck 같은 재현 fixture가 생길 때만 Rust controller 내부 state나 pass-through grace를 검토하고, public runtime state로 노출하지 않는다.
- Jump가 발생한 frame에는 step offset을 적용하지 않는다. 상승 중 step-up 허용은 ceiling/corner snap fixture가 있는 opt-in config로만 검토한다.
- Slope snap은 수평 속도를 보존하면서 vertical snap을 더하는 arcade platformer 정책을 기본으로 둔다. tangent projection은 기본값 변경이 아니라 별도 config 후보로 남긴다.
- Moving platform carry는 기본적으로 platform displacement만 rider에 상속한다. 회전 플랫폼의 각운동 이동량은 `PhysicsSystem::carry_moving_platform_with_rotation_carry(...)`에 `MovingPlatformRotationCarryConfig`를 넘긴 경우에만 platform rotation origin/delta 기준으로 추가한다.
- HD-2D bridge under-pass는 swept segment/tile traversal로 bridge tile 후보를 찾는다. 고속 이동에서도 작은 bridge tile을 건너뛰지 않는 fixture를 유지하고, Top-down HD-2D browser smoke로 예제 계약을 확인한다.

### Generic physics API

`FerrumEngine`은 낮은 빈도의 physics authoring/control/query API를 제공한다.

- runtime: `configureFixedTimestep(...)`, `setPhysicsDebugLinesEnabled(...)`, `stepRigidBodies(...)`
- spec apply/helper: `createPhysicsWorldFromSpec(...)`, `createRigidBody(...)`, `createCollider(...)`, `createJoint(...)`, `createVehicleRig(...)`
- body: `spawnRigidBody(...)`, `getPhysicsEntity(...)`, `despawnPhysicsEntity(...)`, `setPhysicsBodyPosition(...)`
- body control: velocity, rotation, angular velocity, enabled, force/impulse, torque/angular impulse, optional `setPhysicsBodyHeightSpan(...)` / `clearPhysicsBodyHeightSpan(...)`, `moveHd2dKinematicBodyWithTilemap(...)`
- material/tuning: body material, collider material, mass properties, solver tuning
- joint: `spawnPhysicsJoint(...)`, `getPhysicsJoint(...)`, `clearPhysicsJoint(...)`, `setPhysicsJointEnabled(...)`
- query: nearest body/tile, body overlap, body raycast/segment-cast, body shape-cast, optional body/tile query `heightSpan` filter, tile raycast/segment-cast, tile shape-cast/contact/manifold, current body contact/manifold, rigid contact impulse snapshot
- snapshot/replay: `capturePhysicsWorldSnapshot(...)`, `restorePhysicsWorldSnapshot(...)`, `capturePhysicsBodyStateBuffer(...)`, `restorePhysicsBodyStateBuffer(...)`, `createPhysicsReplayInputStream(...)`, `runPhysicsReplayInputStream(...)`, `verifyPhysicsReplayRollback(...)`, `verifyPhysicsReplayInputStreamRollback(...)`, `createPhysicsReplayWorkerClient(...)`
- editor/AI authoring: `compilePhysicsAuthoringDocument(...)`, `validatePhysicsAuthoringDocument(...)`, `physicsEditor` metadata schema
- terrain authoring/runtime: `extractTilemapBoundaryChains(...)`, `PixelMaskTerrain`, `extractPixelMaskBoundaryChains(...)`, `createPixelMaskTerrainRuntime(...)`

`despawnPhysicsEntity(...)`로 유효한 body를 제거하면 그 body를 어느 endpoint로든 참조하는 distance, rope, spring, pulley, revolute, prismatic, weld, gear joint도 같은 호출에서 제거된다. 제거된 joint handle은 generation이 증가해 즉시 무효화되므로 별도 `clearPhysicsJoint(...)` 호출이 필요하지 않다. World는 generation-aware per-entity incident joint count를 유지하므로 연결 joint가 없는 body의 despawn은 O(1) gate에서 8종 storage 순회를 건너뛴다. 연결 body의 cascade는 미리 capacity를 확보한 free-list에 제거 slot을 반환해 해당 경로에서 재할당하지 않는다.

고차수 graph 회귀는 하나의 hub에 4,096개 spoke와 8종 joint를 연결한 총 32,768개 joint를 구성한다. hub despawn은 연결 joint를 모두 제거하고 관계없는 8종 joint를 보존해야 하며, cleanup 구간은 debug test profile에서 250ms budget을 적용한다. 이 budget은 `pnpm smoke:physics`의 `physics:joint-despawn-budget` scenario가 실제 Rust 측정 marker를 파싱해 CI에서 검증한다. 현재 구조가 budget 안에 있는 동안에는 per-kind incident index나 joint storage 변경을 도입하지 않는다.

이 API는 editor나 runtime tooling처럼 호출 빈도가 낮은 흐름을 대상으로 한다. entity별 매 프레임 authoring stream 용도가 아니다.

### Rust-only helpers

일부 helper는 Rust crate API로만 제공된다.

- `PhysicsSystem`의 low-level movement/query/solver helper
- `World`의 collider/joint storage 접근자. joint add의 recoverable endpoint 검증은 `try_add_*_joint(...) -> Option<JointId>`, joint handle/새 endpoint 검증을 포함한 update는 `try_set_*_joint(...) -> bool`을 사용한다. 기존 `add_*_joint(...)`는 current entity endpoint를 전제로 하는 convenience API이며 위반 시 저장 전에 panic하고, 기존 `set_*_joint(...)`는 invalid 입력을 무변경으로 처리한다.
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
- gravity, fixed timestep, continuous, solver iteration 기본값
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

Generic rigid body/joint authoring metadata는 `physics` namespace에서 검증되고, `createPhysicsWorldFromSpec(...)`를 통해 runtime world에 opt-in 적용할 수 있다. 현재 apply 경로는 body당 1개 이상의 collider, AABB/box/circle/capsule/oriented-box/convex-polygon/edge/chain collider, distance/rope/spring/pulley/revolute/prismatic/weld/gear joint를 지원한다. distance/rope/spring/pulley/revolute/prismatic/weld의 `localAnchorA`/`localAnchorB`는 생략 시 body center로 resolve된다. 첫 collider는 primary collider(index `0`)로 기존 단일 collider API와 호환되고, secondary collider는 `addPhysicsBodyCollider(...)` 경로로 같은 body에 추가된다. `"world"` joint endpoint는 helper가 collision-disabled static anchor body로 변환한다. `chain`은 Rust core에서 dedicated storage로 보존되고, 내부 collision/query/debug 경로에서 segment를 순회한다.

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

## 표시 보간·충격 정보·정적 geometry 재사용

`configureFixedTimestep({ interpolate: true })`는 Rust의 직전/현재 rigid-body pose를
위치·최단 각도·같은 층 elevation으로 보간한다. 기본값은 false이고 표시가 물리 한 step만큼 늦어진다.
simulation/query/replay 좌표는 현재 물리 pose다. 2D sprite, spatial billboard/model, entity bitmap label 및 연결 광원이
동일한 render pose를 읽고 두 renderer는 기존 command ABI를 그대로 소비한다.
순간이동, generation 변경, restore, pause에서는 이전 pose를 사용하지 않는다.
Data Scene follow 카메라와 HD-2D actor focus도 같은 표시 pose를 읽는다.
부착 오브젝트는 보간된 parent에서 local 위치·회전·높이를 다시 계산하고 native collider는 유지한다.
spatial model picking은 표시용 draw matrix를 사용한다.
physics query는 표시 picking API가 아니므로 물리 현재 좌표를 반환한다.
물리 높이 debug marker 역시 native 위치·높이를 함께 사용한다.

body bulk 복원은 collider 종류를 포함한 모든 항목을 먼저 검증한다. 실패한 world transaction은
미소비 관절 파손 이벤트, 접촉 충격/효과 큐와 진단 상태를 보존한다. 성공한 일반 복원은
이전 simulation의 이벤트를 비우며, 런타임 설정·플랫폼 side effect는 transaction 계약 밖이다.

`configurePhysicsContactImpacts`는 접근 속도 기준으로 opt-in 충격 수집을 켠다.
CCD와 discrete solver에서 normal/tangent impulse를 수집하며 warm-start cache 조회와 수명을 분리한다.
`queryPhysicsContactImpacts`는 기존 40-byte bulk contact decoder를 재사용하고 기존 24-byte collision
Event ABI는 바꾸지 않는다. frame당 4096개 상한과 dropped 수를 제공하며 query는 소비하지 않는다.
수집은 다음 update에서 비우고, frame 안의 fixed/substep 결과는 순서대로 합친다.
접근 속도 임계값은 프로젝트 단위와 중력·step 크기에 맞춰 지정한다. 작은 임계값에서는
중력으로 다시 접근하는 정지 접촉도 수집될 수 있다.
원/원·원/캡슐 접촉점은 두 접촉 표면의 중점으로 계산해 pair A/B 순서에 영향을 받지 않는다.
한 manifold의 여러 접점은 solver에서 좌표 순으로 처리해 pair 방향에 따른 순서 반전을 방지한다.

persistent CollisionScratch는 static geometry signature(entity/generation, transform, shape)를 매번
확인하고 변경이 없으면 계산한 AABB와 정렬 순서를 재사용한다. dynamic proxy만 정렬한 뒤 병합하며
filter/material은 계속 현재 world에서 읽는다. 변경된 static geometry는 다시 계산한다.
이 캐시는 world snapshot에 직렬화하지 않는 파생 데이터다.

## 물리 제작 기능: 진단·반작용·support 이동

- `fixed_rotation`은 body의 authored inertia를 보존하며 solver 역관성과 적분의
  각속도를 0으로 만든다. 배치 회전 setter와 물리 회전 제어를 구분한다.
- `world/physics_diagnostics.rs`는 opt-in CCD 상한 표본 및 관절별 반작용을
  수집한다. 관절 velocity solve 전후 endpoint 운동량 차이만 누적하므로
  다른 관절·접촉의 충격이 해당 관절 하중으로 섞이지 않는다. substep dt로
  환산하고 위치 보정은 제외한다. geometry/force/torque 파손 queue는 bounded다.
- `engine/physics_impact_feedback.rs`는 contact report와 독립적인 충격 수집을
  사용한다. report를 끄거나 임계값을 바꿔도 효과의 조건은 변하지 않는다.
  category profile·pair cooldown·발생 상한은 Rust, 음원 재생은 플랫폼에 있다.
- `batch_cast_bodies`는 고정 48-word f64 요청 packet을 받아 기존 단건 cast를
  사용한다. 응답은 bounded 소유 배열이며 u32 handle을 f64로 정확히 운반한다.
  기존 render/body/query ABI를 재해석하지 않는다.
- `spatial_scene/moving_platforms.rs`는 안정된 support index 위에서 이동·승강과
  탑승자 carry를 수행한다. 외부 장애물은 swept volume으로 검사하고 동승자는
  공통 변위로 일괄 이동한다. 실패하면 phase·support·rider를 함께 되돌린다.
  외부 compound collider는 자식별 filter·trigger·실제 shape 교차를 확인한다.
  저장 복원 사전검증도 runtime과 같은 half-open 지형 경계 소유권을 사용한다.
  같은 층 surface overlap은 허용하지 않는다. 변경된 physics layer만 갱신하고
  terrain render mesh는 step당 한 번 갱신한다. frame별 물리 본체를 TS에서
  움직이는 방식은 사용하지 않는다.

계약·한도는 [Physics Spec](../../engine/physics-spec.md),
[Core API](../../engine/public-api/core.md),
[HD-2D support](../../engine/data-scene-spatial.md#이동-보행면승강-발판)를 따른다.
