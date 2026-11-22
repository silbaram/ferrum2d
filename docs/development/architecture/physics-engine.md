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

- Rust native checkpoint: `PhysicsWorld3d::capture_snapshot`/`from_snapshot`/`restore_snapshot`이
  같은 빌드의 backend arena·접촉 cache·controller/관절·예약 명령·관측 큐와 projectile motion을 보존한다.
  private Serde remote schema와 Postcard 1.1.3을 사용하며 opaque checkpoint만 복원한다.
  envelope 형식·source fingerprint·CRC·길이와 candidate를 검증한 뒤 원자적으로 교체한다.
  encoded 64 MiB 상한은 전체 world 메모리 제한이 아니다. 임의 byte import, Web API와
  Engine/Data Scene 저장·replay 이전은 미완료이며 기존 native 저장 거부를 해제하지 않는다.
- 메모리 runtime rollback: `Engine::runtime_checkpoint`/`restore_runtime_checkpoint_native`와 Web의
  `captureRuntimeCheckpoint`/`restoreRuntimeCheckpoint`가 같은 Engine의 전체 Rust 실행 상태를 보존한다.
  native solver, World ownership/generation·보간, fixed clock/input, 진행 중 AI 검색/cache/intent,
  terrain phase, projectile/hit·effects와 관측 buffer를 포함한다. immutable shape 신원을 유지하고
  bounded action/contact queue와 World joint free-list의 예약 공간을 보존한다. RAF 중 사용·외부 Engine·
  dispose 후 사용은 거부한다. native JSON/file 저장, 외부 JS/asset/GPU/authoring context 복원과
  미래 handle의 자동 epoch 검사는 별도 계약이며 전체 저장/기본 backend 이전 작업은 계속 진행한다.
- 공개 Web runtime의 외부 물리 backend 전환: 진행 중. `physics3d` Rust 모듈에 Rapier3D 0.36.1을 도입하고
  기존 geometry 의존성 Parry3D 0.31.1도 같은 버전의 vendored source로 고정했다. glam이 쓰는 libm 0.2.16도
  vendored source로 고정해 stable wasm32의 제곱근을 하드웨어 명령으로 계산한다(결과 비트 동일). 캐릭터 접촉 해결은
  캡슐이 상자 한 면 안쪽 위에 있으면 정확한 면 거리로, 모서리·관통은 Parry GJK로 계산한다. BVH·height grid·
  sparse map의 Deserialize 불변식을 검사하며, 전체 BVH rebuild가 retired leaf를 되살리는 오류를 수정했다.
  native Data Scene body와 기존 2D body/fixture의 planar adapter는 Engine fixed tick·entity·렌더 보간에 연결했다.
  기존 질량·관성·force/impulse와 실행 중 component 변경을 반영하며, 네 가지 접촉 보정 material scale과
  전역 contact 보정 설정도 이전했다. 중력·반복 횟수·반발 임계값·전체 CCD 및 기존 자동/수동 step을
  같은 native 경로에 연결했다. native 모드의 수동 dt는 설정된 고정 tick을 사용하며 zero는 no-op이다.
  기존 ray/segment/point·영역 5종·nearest·shape cast 5종 조회는 통합 planar world에 연결했다.
  공간 ray는 XYZ native Rust API를 사용하고, XY-only 조회는 공간 world에서 진단으로 거부한다.
  collision lifecycle은 native fixture 전이를 entity 쌍으로 합쳐 기존 이벤트 버퍼에 연결했다.
  복합 fixture의 참조 수와 solid/sensor 채널을 구분하고, overflow 후 전체 active snapshot으로 복구한다.
  Data Scene pickup과 전투의 충돌 반응은 telemetry를 꺼도 같은 native pair 상태를 사용한다.
  범위 피해는 native sphere overlap과 fixture category, 넉백은 native 속도, 상호작용은 물리 중심 거리에 연결했다.
  Spatial 거리에는 높이를 포함하며 render offset은 제외한다. PlanarXy의 논리 floor/height와 기존 입력/once 규칙은 유지한다.
  생성 projectile의 native ownership·지속 이동·entity sweep·첫 hit 정지/소비를 연결했다.
  지정 kinematic 선형 속도는 보존하고 dynamic 속도 상한은 유지한다.
  투사체는 실제 solver 적분별 COM pose와 CCD가 승인한 제한 경로를 별도 BVH에 기록해 상대 운동을 검사한다.
  position-kinematic은 지정 target 보간을 사용한다. 다회전·반전 경로의 query 회귀를 추가했지만 native CCD 자체의
  극단 회전 수용, combat AI의 임의 지지면 길찾기와 character 외력은 남아 있다. 직접 이동은 실제 native 좌표에서 표적을 선택해 controller/velocity/position target에 전달한다. native A* 커널은 frontier/진행 중인 probe를 보관하는 slice 실행으로 분리했고 실제 query 입력 변경 시 취소한다. 단일 actor는 같은 커널을 사용한다. native Chase에는 fixed-geometry policy와 자동 tick의 순환 검색/추종을 연결했고, native JSON에는 Y-up capsule/target/source 용량과 별도 capability 사전 검사를 연결했다. shared route cache와 profile/geometry 무효화·검증된 connector도 연결했다. Native crowd는 capsule 상대 예측과 지형/예산 검사를 통과한 local steering을 사용한다. All-pattern은 SeekTarget 경로/보간과 Accelerate의 틱당 가속·지형 검사를 같은 source/work/crowd에 연결했다. 별도 native movement capability가 필요하며 밀집 성능 수용은 남아 있다. 대시는 native fixed tick의 capsule/controller 또는 swept kinematic path를 사용한다. melee는 native 도형/시야와 fixture mask를 사용한다.
  접촉/manifold 조회도 native geometry에 연결했다. XYZ 표면점과 기존 planar 두 점 buffer를 구분한다.
  깊은 2D box/polygon 겹침의 Z축 접촉 결함은 authored extrusion 깊이로 보정하며 질량/관성은 유지한다.
  solver 충격량은 기존 rigid contact/impact buffer와 feedback에 연결했다. 접근 속도는 회전 운동을 포함하고,
  fixture별 category를 사용한다. XYZ 관측과 화면용 투영을 구분하며 수집 한도 초과는 별도 진단한다.
  native solver 제출량·body/island gauge·CCD 검사/위치 제한과 frame 통계를 추가했다. 기존 CCD 디버그 선도 연결했다.
  legacy substeps는 native pipeline 호출 수, CCD hits는 실제 위치 제한 수다. warm-start/block-solve 등 이전
  solver 전용 row-operation 지표는 native에서 미측정이며 0으로 초기화한다. 세부 native 수치는 typed Rust API를 사용한다.
  main tile·SpatialScene의 정적 geometry도 같은 native world에 등록하며, 편집 시 shape/capacity 검증과
  cell/surface identity를 유지한다. XY slope·one-way, Spatial ramp·bridge underside·walkable support와
  projectile tile impact는 native geometry를 사용한다. 별도 Rust `cast_unified_terrain_ray_all`은 terrain identity를 반환한다.
  authored 이동 발판의 position-kinematic 경로·capsule 운반·틱 내부 왕복 반전·native clock 동기화도 연결했다.
  발판 자체의 벽 충돌, 탑승자의 벽/천장 차단, 접근하는 authored 발판과 움직이는 천장에 대해
  상대 sweep 시점에서 관련 경로와 phase를 멈추고 나머지 틱을 계속 진행한다. native blocked 집계와
  별도의 path/preview 비용 지표를 연결했다. dynamic body는 일반 solver 응답을 유지한다.
  일반 capsule의 보행/운반도 움직이는 kinematic의 상대 sweep을 사용한다. 같이 움직이는 벽의 이전 pose에
  막히지 않고, 접근하는 벽의 밀림·접선 보행과 새 승강기 지지를 처리한다. local one-way plane도 query 시점의
  target pose로 검사한다. velocity-kinematic의 COM/fixture offset과 각회전량을 경로 계산에 보존한다.
  외부 position/velocity 명령도 capsule squeeze 시점에서 관련 이동체를 정지시킨다. 남은 틱은 계속 진행하고,
  소비된 명령은 새 target/속도를 받아야 재개한다. 막힌 탑승자 아래의 수평 발판 접선 이동은 유지한다.
  정지 수·근접 접촉 검사/실패 수는 native tick/frame 진단에 합산한다. 선형 벽/승강기와 PlanarXy 회귀를 추가했다.
  여러 capsule의 공통 접촉 시점·속도 제약을 연결해 밀림을 전달하고 고정 벽에 막힌 연쇄 접촉의 이동체를 정지시킨다.
  자유 공간의 32명 연쇄 밀림, 비스듬한 벽, 평면 축 잠금, 필터/비활성 body, 실제 허용된 carry를 검증했다.
  반복 한도에 의한 보수적 정지는 진단으로 구분하며 밀집 성능 수용이나 해의 부재를 뜻하지 않는다.
  상대 밀림의 dynamic impulse 결합 응답·dynamic carry·회전 장애물 수용·지형 표시 보간,
  전체 tile query/시야/impact·chunk 비용은 남아 있다.
  Web collider event stream은 entity 없는 tile/surface와 삭제 당시 세대까지 반환하며,
  native/public queue 누락 수와 전체 active snapshot으로 overflow 복구를 지원한다.
  기존 entity lifecycle frame 출력과 독립적이다. Web 접촉면/XYZ impulse/CCD 관측은 지형 identity와 함께 연결됐고,
  32개 native step/frame 측정은 FrameState와 Runtime overlay/profiler/trace에 전달한다.
  기존 solver row 지표를 추정하지 않는다. 전체 디버그 geometry 시각화와 최종 성능 수용은 남아 있다.
  Web 물체 설정(활성화·중력·감쇠·잠금)과 additive mass/inertia, collider 목록·추가·교체·삭제도
  native admission에 연결했다. 기존 component 소유권과 캐릭터 capsule 제한을 적용하며
  삭제 이벤트의 이전 generation을 유지한다. 관절 Web 제어도 13종 생성/수정/삭제·bulk 상태·파손/삭제 이벤트에 연결했다.
  frame/motor/spring/break 설정과 native 검증을 공유하며 legacy 진단과 Web 큐는 독립 소비한다.
  전체 debug geometry 시각화는 아직 남아 있다.
  기존 시각 entity에 native body를 연결/해제하는 공개 API는 동일 entity와 asset을 유지한다.
  해제 시 native 충돌/관절 identity를 보존하고 선형·각속도를 정지한다.
  Scene JSON의 shape body·capsule controller·named joint와 Studio 재생/배치/진단을 연결했다.
  HD actor의 WASD·목적지 이동·cold displacement는 같은 native capsule 경로에 연결했다.
  Physics Spec 전체 이전·기본 경로 전환·AABB actor 데이터 자동 변환은 남아 있다. [통합 물리 계획](../../planning/unified-3d-physics-plan.md)이 완료 범위를 관리한다.
  기존 8종 관절의 기본 rigid 설정/frequency spring, pulley/gear, identity·수정·파손·진단을 native Engine에 연결했다.
  continuous hinge limit, Distance/Rope/Gear/Pulley의 normalized stiffness/damping과 frequency 없는 Spring도
  native Engine에 연결했다. 정규화 값은 60 Hz 기준 탄성 계수로 변환하므로 이전 solver와 궤적이 같지는 않다.
  hinge/prismatic/weld의 독립적인 선형/회전 부분 강성도 native 관절 row에 연결했다. 공개 runtime 전환은 미완료다.
  planar height/floor와 surface velocity, 마찰 기하평균·반발력 최댓값도 연결했다. 층 필터는 native contact/sensor/CCD와
  조회·캐릭터에 적용하며, 공간 모드는 논리 height span 대신 실제 3D geometry를 사용한다.
  Web의 명시적 설정과 native XYZ state/velocity batch를 연결했다. 기존 planar authoring은 설정 시 또는
  다음 유효 step에서 import한다. 명령 전체를 사전 검증하며 실패 시 일부 body만 바꾸지 않는다.
  16-word state ABI의 핸들은 u32, pose/velocity는 f32이고 메모리 확장 뒤 view를 다시 생성한다.
  명시적 Web body 생성은 box/sphere/capsule/hull/mesh/heightfield/compound와 재질·local pose를 지원한다.
  controller 설정/해제, 4-f32 입력 batch와 28-word last-tick 상태도 같은 native world에 연결했다.
  body 명령 batch는 pose/kinematic target·force/torque·impulse·clear·sleep/wake를 연결했다.
  XYZ ray/point/convex overlap/sweep/nearest는 재사용 가능한 mixed query batch와 tile/surface identity까지 연결했다.
  mutable body options/collider/joint와 contact/sensor event·debug/전체 지표의 Web 이전은 남아 있다.
  capsule controller의 경사·계단·낙하·키네마틱 발판·상대 이동 충돌도 새 Rust world 안에서 검증 중이다.
- per-entity Web callback 기반 collision handling
- built-in scene loop에 generic Physics Spec body/joint를 자동 적용하는 것
- built-in scene loop에 generic rigid body solver를 자동 적용하는 것
- 전체 built-in scene loop의 Web Worker 이전 또는 Wasm threads 기반 physics execution
- 별도 multi-hitbox/hurtbox authoring DSL
- 고급 roof/wall visibility rule, entity shadow scale/offset, material 기반 lighting response
- 기본 3D backend 전환 및 Physics Spec/Studio의 공간 world 작성: 이전 진행 중. 명시적 Web 경로와 구분한다.

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
