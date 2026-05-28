# 리팩토링 로드맵

이 문서는 Ferrum2D를 상용제품 코드베이스로 다듬기 위한 구조 리팩토링과 성능 개선 작업의 기준이다. 기능 추가가 아니라 기존 동작을 유지하면서 책임 경계, 테스트 가능성, hot path 비용을 개선하는 것을 목표로 한다.

## 적용 원칙

- Rust core는 게임 상태, 충돌, 물리, 씬 로직, render/audio/query buffer 생성을 소유한다.
- TypeScript platform layer는 브라우저 API, Wasm loading, renderer, input, audio, asset loading을 소유한다.
- Wasm ABI와 public API는 리팩토링 중에도 유지한다. 공유 buffer layout을 바꿔야 할 때만 별도 변경으로 분리하고 Rust size function, TS decoder, 테스트를 함께 수정한다.
- SOLID 중 가장 우선하는 기준은 SRP와 DIP다. 한 파일이나 타입이 여러 변경 이유를 가지면 먼저 기능 단위 module로 분리한다.
- Rust hot path는 allocation, string/object 생성, 동적 디스패치를 피하고 bulk buffer와 재사용 scratch storage를 우선한다.
- TypeScript hot path는 `subarray()`/object allocation 같은 작은 GC 압력도 누적 비용으로 본다. renderer upload 경로는 preallocated staging buffer와 offset/length API를 우선한다.

## 1차 완료 기준

- `physics.rs`, `collision.rs`, `engine.rs`, `world.rs`의 inline test module을 외부 test module로 분리한다.
- renderer material/legacy command upload 경로에서 per-batch `TypedArray.subarray()` view 생성을 제거한다.
- `collision.rs`의 physics debug line 생성 책임을 `collision/debug.rs`로 분리하고 public debug API/flag 경로를 유지한다.
- `collision.rs`의 public collision/query/ABI data type 정의를 `collision/types.rs`로 분리하고 `collision::*` re-export 경로를 유지한다.
- `collision.rs`의 pair 후보 수집, broadphase proxy, scratch buffer 재사용 책임을 `collision/broadphase.rs`로 분리한다.
- `collision.rs`의 contact/manifold 조립 책임을 `collision/contacts.rs`로 분리해 broadphase 모듈의 책임을 pair 후보 수집에 가깝게 유지한다.
- Rust/TS 테스트와 lint가 통과해야 한다.

## 다음 분리 순서

1. `collision.rs`
   - 완료: AABB 기반 contact manifold helper는 `collision/aabb_manifold.rs`로 분리했다.
   - 완료: `debug_draw` 역할은 `collision/debug.rs`로 분리했다.
   - 완료: public collision/query/ABI data type 정의는 `collision/types.rs`로 분리했다.
   - 완료: pair 후보 수집, broadphase proxy, scratch buffer 재사용 책임은 `collision/broadphase.rs`로 분리했다.
   - 완료: contact/manifold 조립 책임은 `collision/contacts.rs`로 분리했다.
   - 완료: bounds 계산과 query sweep bounds helper는 `collision/bounds.rs`로 분리했다.
   - 완료: point/aabb/circle/shape/nearest body query API와 scratch 재사용 entrypoint는 `collision/query.rs`로 분리했다.
   - 완료: raycast/segment cast API와 재사용 entrypoint는 `collision/raycast.rs`로 분리했다.
   - 완료: 단건 `CollisionSystem::raycast`와 `segment_cast`는 `*_all`의 `Vec` 수집/정렬 경로를 거치지 않고 shared visitor에서 nearest hit만 갱신하도록 바꿨다. `raycast_all`/`segment_cast_all`의 distance/entity-id 정렬 계약은 공용 comparator로 유지한다.
   - 완료: shape cast API, 재사용 entrypoint, 내부 shape-cast hit helper는 `collision/shape_cast.rs`로 분리했다.
   - 완료: 단건 `CollisionSystem::shape_cast`는 `shape_cast_all`의 `Vec` 수집/정렬 경로를 거치지 않고 shared visitor에서 nearest hit만 갱신하도록 바꿨다. `shape_cast_all`의 distance/entity-id 정렬 계약은 공용 comparator로 유지한다.
   - 완료: shape cast의 capsule/capsule-side helper는 `collision/shape_cast/capsule.rs`로 분리하고 dispatcher와 public query API는 `collision/shape_cast.rs`에 유지했다.
   - 완료: shape cast의 generic moving-segment vs AABB/circle primitive는 `collision/shape_cast/segment.rs`로 분리하고, capsule module은 capsule 조합/side 변환 책임에 집중하도록 정리했다.
   - 완료: shape contact dispatch helper는 `collision/shape_contact.rs`로 분리했다.
   - 완료: layer/mask/filter 판정 helper는 `collision/filters.rs`로 분리했다.
   - 완료: collider pair를 overlap/contact/manifold로 조립하는 narrowphase context는 `collision/narrowphase.rs`로 분리했다.
   - 완료: contact point fallback 계산 helper는 `collision/contact_points.rs`로 분리했다.
   - 완료: contact manifold dispatch helper는 `collision/contact_manifold.rs`로 분리했다.
   - 완료: face-circle contact manifold, face clipping, capsule-face arc clipping helper는 `collision/face_manifold.rs`로 분리했다.
   - 완료: oriented box 기반 contact manifold helper는 `collision/oriented_box_manifold.rs`로 분리했다.
   - 완료: capsule-circle/capsule-capsule contact manifold helper는 `collision/capsule_manifold.rs`로 분리했다.
   - 완료: convex polygon 기반 contact manifold helper는 `collision/convex_manifold.rs`로 분리했다.
   - 완료: convex SAT/contact geometry cluster는 `collision/convex_contact.rs`로 분리했다.
   - 완료: fixed-size manifold point packer helper는 `collision/manifold_points.rs`로 분리했다.
   - 완료: value-only distance/intersection/vector helper 일부는 `collision/geometry.rs`로 분리했다.
   - 완료: query/shape-cast에서 재사용하는 collider overlap dispatch는 `collision/overlap.rs`로 분리했다.
   - 완료: circle/capsule/AABB primitive overlap helper는 `collision/overlap_primitives.rs`로 분리했다.
   - 완료: oriented box/convex polygon overlap predicate는 `collision/overlap_shapes.rs`로 분리했다.
   - 완료: SAT projection과 oriented box vertex helper는 `collision/shape_projection.rs`로 분리했다.
   - 완료: raycast/shape-cast에서 공유하는 swept/cast primitive, segment frame, nearest-hit helper는 `collision/cast_primitives.rs`로 분리했다.
   - 완료: query/collider finite validation과 shape validity helper는 `collision/validation.rs`로 분리했다.
   - 완료: compound collider shape lookup, chain segment expansion, edge-as-capsule policy, collider center/query-shape conversion은 `collision/collider_shapes.rs`로 분리하고 `crate::collision::collider_shape` 내부 경로는 유지했다.
   - 완료: primitive contact 계산은 `collision/contact_primitives.rs`로, oriented-box geometry/transform helper는 `collision/oriented_box_geometry.rs`로 분리했다.
   - 완료: `collision/shape_cast.rs`의 convex polygon/oriented-box shape-cast helper는 `collision/shape_cast/{convex_polygon,oriented_box}.rs`로 분리했다. Dispatcher와 public query API는 `collision/shape_cast.rs`에 유지해 public re-export와 ABI를 바꾸지 않는다.
   - 완료: `collision/tests.rs`의 shape-cast 회귀 테스트 묶음은 `collision/tests/shape_cast.rs`로 분리해 collision root test harness 크기를 줄였다. 공용 fixture/helper는 parent module에 유지해 중복을 늘리지 않는다.
   - 완료: `collision/tests.rs`의 point/area/shape/nearest query, raycast/segment-cast, swept/buffer-reuse, compound/chain collider 회귀 테스트 묶음은 `collision/tests/{point_queries,area_queries,shape_queries,nearest_queries,raycasts,swept,compound_colliders}.rs`로 분리했다. 공용 shape/world fixture는 parent module에 유지해 private helper 접근과 중복 최소화 계약을 유지한다.
   - 완료: `collision/tests.rs`에 남은 overlap/pair/filter/contact/debug/manifold 회귀 테스트는 `collision/tests/{overlap_basics,pair_filters,contact_builders,debug_lines,manifold_basic,manifold_convex,manifold_oriented_box,manifold_capsule}.rs`로 분리했다. Root test harness는 collider/world fixture와 private collision helper 접근 계약만 유지한다.
   - public re-export는 `collision.rs`에서 유지해 외부 import 경로를 깨지 않는다.

2. `physics.rs`
   - 완료: fixed timestep scheduler는 `physics/fixed_timestep.rs`로 분리했다.
   - 완료: physics counter type은 `physics/counters.rs`로 분리했다.
   - 완료: rigid-body step config/stats type은 `physics/rigid_body.rs`로 분리했다.
   - 완료: `PhysicsSystem` facade type은 `physics/system.rs`로 분리하고 기존 impl 경로를 유지했다.
   - 완료: rigid-body sleep/wake helper와 island sleep/wake glue는 `physics/sleep.rs`로 분리했다.
   - 완료: rigid-body island graph/schedule과 union helper는 `physics/islands.rs`로 분리했다.
   - 완료: platformer/slope public type과 기본 config 값은 `physics/platformer.rs`로 분리하고 기존 `physics::*` re-export 경로를 유지했다.
   - 완료: platformer/kinematic `PhysicsSystem` facade method와 controller flow는 `physics/platformer_controller.rs`로 분리하고 method 이름과 시그니처를 유지했다.
   - 완료: platformer step offset, kinematic sweep, ground probe, slope snap/ground, solid/one-way filter helper는 `physics/platformer_controller/{step_offset,kinematic_sweep,ground_probe,slope_ground,solid_filter}.rs`로 분리했다.
   - 완료: platformer bounds clamp, moving platform carry, controller runtime/update, config/timer sanitizer는 `physics/platformer_controller/{bounds,moving_platform,controller,config}.rs`로 추가 분리했다. Public `PhysicsSystem` method 이름과 hot-path allocation-free sweep loop는 유지하고, slope snap tilemap 입력은 단일 source로 정리했다.
   - 완료: rigid-body CCD integration, TOI query, debug hit 기록, support-point helper는 `physics/ccd.rs`로 분리했다.
   - 완료: joint constraint context, velocity/position solver, joint-specific impulse helper는 `physics/joints.rs`로 분리했다.
   - 완료: joint 종류별 solver는 `physics/joints/{distance_joint,gear_joint,prismatic_joint,pulley_joint,revolute_joint,rope_joint,spring_joint,weld_joint}.rs` vertical slice로 분리하고, `physics/joints.rs`는 shared context/helper와 facade re-export를 유지한다.
   - 완료: joint solver 공용 numeric sanitizer와 회전/축 geometry helper는 `physics/joints/{sanitizers,geometry}.rs`로 추가 분리했다.
   - 완료: joint solver context struct, revolute/prismatic limit-motor/effective-mass helper, shared impulse/position-correction helper는 `physics/joints/{contexts,limits,impulses}.rs`로 분리했다. Context field visibility는 `pub(in crate::physics::joints)` 중심으로 제한하고, 기존 joint solver entrypoint와 static dispatch는 유지한다.
   - 완료: distance/spring zero-length positive-rest fallback, prismatic zero-axis fallback, pulley zero-segment fallback, angle normalization fallback은 내부 단위 테스트로 고정했다.
   - 완료: `RigidBodyIslandSchedule`은 island root slot mapping을 보유하고, `RigidBodyJointIslandBuckets`는 step 준비 단계에서 enabled joint index를 island별로 한 번만 bucket한다. Joint solver는 velocity/position iteration마다 전체 joint store를 다시 순회하지 않고 현재 island의 index slice만 처리한다.
   - 완료: joint index bucket build/accessor 책임은 `physics/islands/joint_buckets.rs`로 분리했다. `root_slot_for_pair_indices`와 dense slot field는 `physics::islands` 내부 구현으로 유지하고, solver가 쓰는 bucket type/accessor만 `pub(in crate::physics)`로 제한한다.
   - 완료: joint bucket은 dynamic-static joint를 dynamic island에 포함하고 disabled/self/static-static joint를 제외하는 테스트로 고정했다.
   - 완료: rigid contact constraint build/cache, normal/tangent/block/split impulse solver는 `physics/solver.rs`로 분리했다.
   - 완료: contact filter, contact material lookup/sanitize, Baumgarte bias, restitution threshold, surface velocity helper는 `physics/solver/{contact_filter,contact_material,baumgarte,restitution,surface_velocity}.rs`로 분리했다.
   - 완료: rigid contact constraint 생성/cache warm-start 입력은 `physics/solver/constraints.rs`, split impulse 상태와 world 적용은 `physics/solver/split_impulse.rs`로 분리했다. Contact constraint buffer는 rigid collider manifold 수를 기준으로 capacity를 선할당해 hot path 재할당 가능성을 줄인다.
   - 완료: warm-start impulse 적용과 post-solve contact impulse cache 저장 책임은 `physics/solver/contact_cache.rs`로 분리했다. 기존 `physics::solver` restricted re-export 경로와 `World::rigid_contact_impulses` buffer 재사용 계약은 유지한다.
   - 완료: rigid contact velocity/split/position solver는 contact별 mass/transform context를 재사용해 contact radius, denominator, impulse apply 경로의 반복 `World` transform 조회를 줄였다. Split impulse도 radius 기반 velocity/apply helper를 사용해 같은 contact point radius를 재계산하지 않는다.
   - 완료: shared vector math와 finite/sanitize helper는 `physics/math.rs`로 분리했다.
   - 완료: rigid-body enabled/mass/inertia/gravity-scale/damping 조회 helper는 `physics/rigid_body_properties.rs`로 분리했다. Hot path helper에는 `#[inline]`을 유지하고, child module이 쓰는 함수는 `pub(in crate::physics)`로만 노출한다.
   - 완료: contact impulse mass context, denominator, relative velocity, position/velocity impulse apply helper는 `physics/solver/contact_impulse.rs`로 분리해 solver flow와 shared impulse math 책임을 나눴다.
   - 완료: joint/solver가 공유하는 rigid-body contact point velocity와 pair linear impulse 적용 helper는 `physics/body_impulses.rs`로 분리했다. 함수는 `pub(in crate::physics)` restricted re-export로만 노출해 public Rust API와 Wasm ABI를 넓히지 않는다.
   - 완료: `physics/tests.rs`는 root test harness를 유지하고 `physics/tests/{basics,kinematic_platformer,contact_block_solver}.rs`로 독립 테스트 그룹을 분리했다. Integration test로 옮기지 않아 private physics helper와 test-only joint import 접근 계약을 유지한다.
   - 완료: `physics/tests/kinematic_platformer.rs`의 move-and-slide, one-way platform, moving platform carry, controller slope/step, controller state, ground-probe 회귀 테스트는 `physics/tests/kinematic_platformer/*.rs` 하위 모듈로 분리했다. Parent module은 tilemap/config helper를 유지한다.
   - 완료: rigid-body island stats/schedule/joint-bucket 회귀 테스트는 `physics/tests/rigid_body_islands.rs`로 분리했다. Root test harness는 공용 fixture/helper를 계속 소유해 private physics helper 접근 계약을 유지한다.
   - 완료: rigid-body CCD 회귀 테스트와 전용 convex-polygon CCD mover fixture는 `physics/tests/rigid_body_ccd.rs`로 분리했다. Root test harness는 공용 spawn/collider fixture를 유지해 private physics helper 접근 계약을 유지한다.
   - 완료: `physics/tests/rigid_body_ccd.rs`의 AABB, shape-pair, convex-polygon, wake/repeat CCD 회귀 테스트는 `physics/tests/rigid_body_ccd/*.rs` 하위 모듈로 추가 분리했다. 전용 convex-polygon mover fixture는 parent module에 유지한다.
   - 완료: rigid-body joint solver 회귀 테스트는 `physics/tests/rigid_body_joints.rs`로 분리했다. Root test harness는 공용 spawn/geometry fixture와 private joint solver import 접근 계약을 유지한다.
   - 완료: `physics/tests/rigid_body_joints.rs`의 distance/rope/spring/pulley/revolute/gear/prismatic/weld joint solver 회귀 테스트를 `physics/tests/rigid_body_joints/*.rs` joint 타입별 모듈로 분리했다. Parent module은 test harness facade로 유지해 공용 fixture/helper 접근 계약을 보존한다.
   - 완료: rigid-body position integration의 CCD `integrated` bitmap은 substep마다 새 `Vec<bool>`를 만들지 않고 step 호출 단위 scratch buffer를 재사용한다. CCD dynamic target 중복 integration 방지 계약과 substep force/impulse 적용 순서는 유지한다.
   - 완료: rigid-body velocity/position integration loop와 substep accumulator mode는 `physics/rigid_body_step/integration.rs` child module로 분리했다. `RigidBodyStepScratch::integrated_bodies` 재사용, CCD fallback 순서, force/impulse clear 시점은 유지하고 helper visibility는 `pub(super)`로 제한한다.
   - 완료: rigid-body step config/substep sanitizer는 `physics/rigid_body_step/config.rs` child module로 분리했다. 순수 config 정규화만 이동해 `World`/scratch/solver phase 순서와 public API/Wasm ABI는 바꾸지 않고 helper visibility는 `pub(super)`로 제한한다.
   - 완료: island graph contact union은 `CollisionManifold` Vec을 한 번 더 만드는 `build_rigid_manifolds()` 경로 대신 `build_rigid_collider_manifolds()`의 pair를 직접 사용한다. Sleep wake/put-to-sleep/final stats graph build의 중간 manifold collect를 제거하면서 union 순서와 filter 계약은 유지한다.
   - 완료: rigid-body position solver는 island마다 `build_rigid_collider_contacts()`를 다시 호출하지 않고 position iteration마다 contact list를 한 번 생성한 뒤 island filter만 수행한다. Position correction iteration 사이의 contact 재계산 의미는 유지하면서 `position_iterations * island_count` 반복 pair scan/allocation을 `position_iterations`회로 줄였다.
   - 완료: rigid-body contact/manifold build는 `CollisionScratch`의 collider-pair buffer와 caller-owned contact/manifold/constraint buffer를 재사용하는 내부 `*_into` 경로를 제공한다. Public 반환 API와 rigid trigger-filter 계약은 유지하고, substep/position-iteration hot path의 반복 allocation 가능성을 줄였다.
   - 완료: `physics.rs`에 남은 rigid-body step orchestration과 `RigidBodyStepScratch`는 `physics/rigid_body_step.rs`로 분리했다. Root `physics.rs`는 public/restricted re-export, 공유 상수, `valid_world_entity_index`, 기존 `PhysicsSystem::integrate` facade만 유지하고, `RigidBodyStepScratch`는 `pub(crate)` 호환 re-export로 `Engine` scratch storage 계약을 유지한다.
   - 완료: `physics/tests.rs`에 남은 rigid-body integration/contact response/contact bias/position correction/sleep-wake 회귀 테스트는 `physics/tests/rigid_body_{integration,contact_response,contact_bias,position_correction,sleep_wake}.rs`로 분리했다. Root test harness는 공용 spawn/collider fixture와 private physics import 접근 계약만 유지한다.
   - solver와 CCD는 성능 회귀가 나기 쉬우므로 분리 전후 `cargo test`와 headless smoke를 같이 실행한다.

3. `tilemap.rs`
   - 완료: tilemap test module은 `tilemap/tests.rs`로 분리했다.
   - 완료: collision rect merge/chunk cache build 책임은 `tilemap/collision_cache.rs`로 분리했다.
   - 완료: tile coordinate/range helper는 `tilemap/layer.rs`로 분리했다.
   - 완료: A* navigation scratch, path reconstruction, waypoint/path facade는 `tilemap/navigation.rs`로 분리했다.
   - 완료: tile collision/shape-cast/raycast/contact/slope query facade는 `tilemap/collision_queries.rs`로 분리하고 public method 이름과 hit type을 유지했다.
   - 완료: tile contact/raycast 변환과 numeric validation helper는 `tilemap/queries.rs`로 분리했다.
   - 완료: tile render command emission은 `tilemap/rendering.rs`로 분리했다.
   - 완료: tile collision query의 merged collision rect 후보 순회는 `tilemap/collision_candidates.rs`로 분리하고, query/shape-cast/raycast/contact/ground-probe/nearest 경로는 flattened rect 전체 순회 대신 collision chunk cache 범위만 방문하도록 바꿨다. One-way platform tile은 기존 tile range 기반 별도 순회를 유지한다.
   - 완료: tile linear cast query(`swept_aabb_contact`, shape-cast, raycast, segment-cast)는 `tilemap/collision_queries/linear_cast.rs`로, AABB contact/manifold query는 `tilemap/collision_queries/contact.rs`로 분리했다. Public method 이름, `*_into`의 caller-owned buffer clear/reuse, hit sort tie-break는 유지한다.
   - 완료: slope ground sampling과 one-way platform raw tile scan helper는 `tilemap/collision_queries/{slope,one_way}.rs`로 분리했다. Solid merged rect cache와 one-way/slope raw tile semantics는 섞지 않는다.
   - 완료: `tilemap/tests.rs`의 rendering, collision cache, dynamic resolution, obstacle query/cast, obstacle contact/manifold, navigation 회귀 테스트는 `tilemap/tests/*.rs` 하위 모듈로 분리했다. Parent test module은 shared import와 `test_collider` fixture만 유지한다.
   - 완료: collision chunk cache rebuild의 row solid-run 수집은 caller-owned scratch `Vec`에 쓰도록 바꿔 행마다 새 `Vec`를 만드는 반복 할당을 제거했다. Collision rect merge 결과와 dirty chunk rebuild semantics는 유지한다.
   - 완료: dynamic collision resolution도 candidate tile range에 맞는 collision chunk 후보만 수집하도록 바꾸고, 재사용 `Vec`를 `tile_index` 순서로 정렬해 기존 flattened rect 처리 순서와 통계 계약을 유지한다.
   - 완료: tilemap authoring setter, navigation cost setter, collision cache rebuild/invalidation helper는 `tilemap/authoring.rs`로 분리했다. Public `Tilemap` method surface, non-collision layer edit semantics, dirty chunk rebuild budget preflight, cache rebuild stats 계약은 유지한다.
   - `tilemap.rs`는 public data type, constants, `Tilemap` storage 중심으로 유지한다.

4. `engine.rs`
   - 완료: physics Wasm/query/snapshot bridge DTO와 buffer writer/helper는 `engine/physics_bridge.rs`로 분리했다.
   - 완료: physics bridge의 public hit ABI DTO와 내부 snapshot DTO는 `engine/physics_bridge/{hit_types,snapshot_types}.rs`로 분리하고 기존 `engine::physics_bridge` re-export 경로를 유지했다.
   - 완료: physics bridge의 query/contact/raycast hit buffer writer는 `engine/physics_bridge/hit_storage.rs`, joint snapshot DTO writer는 `engine/physics_bridge/joint_snapshots.rs`로 분리했다. 기존 `Engine` helper method 이름, caller-owned buffer reuse, joint snapshot field mapping은 유지한다.
   - 완료: physics body snapshot capture/append/restore codec은 `engine/physics_bridge/body_snapshots.rs`로 분리했다. Rust/TypeScript가 공유하는 body snapshot float/u32 순서, flag bit, 사전 길이 검증 전제는 유지한다.
   - 완료: physics body/collider authoring validation과 `RigidBody` 생성 helper는 `engine/physics_authoring.rs`로 분리했다.
   - 완료: active scene dispatch, scene reset/update, scene score/state helper는 `engine/scenes.rs`로 분리하고 Wasm wrapper method는 유지했다.
   - 완료: render command buffer assembly helper는 `engine/rendering.rs`로 분리하고 기존 buffer reuse와 `render_command_ptr/len` ABI를 유지했다.
   - 완료: shooter/physics body snapshot Wasm API와 buffer helper는 `engine/snapshots.rs`로 분리하고 pointer/length/export 이름을 유지했다.
   - 완료: physics query hit pointer/length, snapshot scalar getter, fixed timestep/physics counter getter, collision/debug/render/audio pointer getter는 `engine/telemetry.rs`로 분리하고 Wasm export 이름을 유지했다.
   - 완료: telemetry Wasm getter는 `engine/telemetry/{physics_hits,physics_snapshot_accessors,physics_joint_accessors,physics_stats,frame_buffers,scene_stats}.rs` vertical slice로 추가 분리했다. 기존 `#[wasm_bindgen]` method 이름, ptr/len element-count ABI, cached snapshot getter semantics는 유지한다.
   - 완료: physics entity/body/joint 단건 조회와 collision/tilemap query/raycast/shape-cast Wasm API는 `engine/physics_queries.rs`로 분리하고 query result/hit buffer layout을 유지했다.
   - 완료: `engine/physics_queries.rs`의 Wasm query API를 `engine/physics_queries/{body_queries,area_queries,cast_queries,tile_queries}.rs`로 추가 분리했다. 기존 `#[wasm_bindgen]` export 이름, query scratch buffer 재사용, hit/result ABI layout은 유지한다.
   - 완료: physics body 생성/mutation, debug line toggle, rigid-body step/config Wasm API는 `engine/physics_controls.rs`로 분리하고 export 이름과 snapshot buffer 갱신 경로를 유지했다.
   - 완료: `engine/physics_controls.rs`의 debug line toggle, physics body spawn, body mutation/force, rigid-body step/config API를 `engine/physics_controls/{debug_lines,body_spawning,body_mutation,rigid_body_steps}.rs`로 추가 분리했다. 기존 `#[wasm_bindgen]` export 이름, spawn 실패 시 snapshot default 처리, setter 성공 시 snapshot refresh 경로는 유지한다.
   - 완료: physics compound collider 생성/mutation/material Wasm API는 `engine/physics_collider_controls.rs`로 분리했다.
   - 완료: physics joint 생성/clear/enabled Wasm API는 `engine/physics_joint_controls.rs`로 분리했다.
   - 완료: fixed timestep 입력 edge latch와 frame/runtime update helper는 `engine/fixed_step.rs`, `engine/runtime.rs`로 분리하고 `Engine.update()`의 단일 Wasm 호출 경계와 frame phase 순서를 유지했다.
   - 완료: scene 전환/texture/sound control, tilemap/navigation authoring API, shooter authoring API, particle API는 `engine/scene_controls.rs`, `engine/tilemap_api.rs`, `engine/shooter_authoring.rs`, `engine/particle_controls.rs`로 분리하고 `#[wasm_bindgen]` export 이름과 side effect를 유지했다.
   - 완료: shooter atlas/animation authoring Wasm API는 `engine/shooter_authoring/animation.rs`로 추가 분리했다. 기존 `set_shooter_atlas_frame`, `set_shooter_atlas_animation`, `set_shooter_animations` export 이름과 `gameSpecApply.ts` 호출 계약은 유지한다.
   - 완료: shooter prefab collider authoring Wasm API는 `engine/shooter_authoring/colliders.rs`로 추가 분리했다. 기존 `set_shooter_prefab_*_collider` export 이름, 인자 순서, material tuple 적용 계약은 유지한다.
   - 완료: viewport resize Wasm API는 shooter authoring에서 `engine/viewport_controls.rs`로 이동했다. `set_viewport_size` export 이름과 active scene별 camera update side effect는 유지한다.
   - snapshot capture/restore의 pointer/length getter는 snapshot ABI 응집을 위해 `engine/snapshots.rs`에 유지한다.
   - 완료: physics/body/collider/joint/snapshot 숫자 상수는 `engine/physics_abi.rs`로 분리해 Wasm-facing ABI 코드값과 snapshot layout 상수의 책임을 명확히 했다.
   - 완료: `engine/tests.rs`의 scene/runtime, fixed timestep, collision event, physics debug/ABI, physics control/query bridge, shooter snapshot/authoring, rendering/particle 회귀 테스트를 `engine/tests/*.rs` 도메인 모듈로 분리했다. 공용 helper는 parent test harness에 유지해 private Engine/World fixture 접근과 테스트 중복 최소화 계약을 유지한다.
   - `#[wasm_bindgen]` method 이름과 buffer layout은 유지한다.

5. `world.rs`
   - 완료: `EntityTemplate*`, 기본 player/enemy/bullet template, template 초기 UV helper는 `world/templates.rs`로 분리하고 기존 `crate::world::*` re-export 경로를 유지했다.
   - 완료: `WorldSnapshot`와 `snapshot/restore_snapshot`은 `world/snapshot.rs`로 분리했다. snapshot은 논리 상태가 아니라 `World` 내부 storage 전체 복제 계약을 유지한다.
   - 완료: entity slot 생성/해제, alive count, generation/free-list validation helper는 `world/entity_lifecycle.rs`로 분리했다.
   - 완료: collider getter/setter, compound collider primary slot, material/filter fallback은 `world/colliders.rs`로 분리했다. primary compound index `0`과 secondary compound collider 보존 계약은 유지한다.
   - 완료: distance/rope/spring/pulley/revolute/prismatic/weld/gear joint store API와 generation/free-list validation은 `world/joints.rs`로 분리했다.
   - 완료: world unit tests는 `world/tests.rs`로 분리했다.
   - 완료: `world/tests.rs`의 entity lifecycle, template spawn, component setter, snapshot, joint store, collider setter, sprite animation 회귀 테스트는 `world/tests/*.rs` 하위 모듈로 분리했다. Parent test module은 import facade 역할만 유지한다.
   - 완료: spawn preset/template 적용은 `world/spawning.rs`, transform/velocity/rotation accessor는 `world/component_access.rs`, rigid-body getter/setter/force/impulse/CCD debug access는 `world/rigid_bodies.rs`, sprite animation tick은 `world/sprite_animation.rs`로 분리했다.
   - 완료: static/kinematic body에는 linear force/impulse accumulator를 쌓지 않도록 dynamic guard를 추가하고, `set_rigid_body`의 기본 motion component 보강 계약은 회귀 테스트로 고정했다.
   - `world.rs`는 `World` storage와 `update()` phase orchestration 중심으로 유지한다.

6. `components.rs`
   - 완료: `Transform2D`, `Velocity`, `Rotation2D`, `AngularVelocity` 같은 기본 motion component는 `components/motion.rs`로 분리했다.
   - 완료: `Sprite`, `SpriteFrame`, `SpriteAnimation*`, `MAX_SPRITE_ANIMATION_FRAMES`는 `components/sprite.rs`로 분리했다.
   - 완료: `CollisionLayer`, `CollisionMask`, `CollisionFilter`는 `components/collision_masks.rs`, collider limit 상수는 `components/limits.rs`로 분리했다.
   - 완료: AABB/circle/oriented-box/capsule/edge/chain/convex/compound collider type은 `components/colliders.rs`로 분리하고 기존 `crate::components::*` re-export 경로를 유지했다.
   - 완료: `RigidBody`, `RigidBodyType`, rigid contact/CCD DTO와 mass/inertia helper는 `components/rigid_body.rs`로 분리했다.
   - 완료: `PhysicsMaterial`은 collider와 solver가 공유하는 material value object로 `components/material.rs`에 분리하고 기존 `crate::components::PhysicsMaterial` re-export 경로를 유지했다.
   - 완료: distance/rope/spring/pulley/revolute/prismatic/weld/gear joint public type과 id는 `components/joints.rs`로 분리했다.
   - 완료: joint public type은 `components/joints/{distance_rope_spring,pulley,revolute_prismatic,weld_gear}.rs` 기능군으로 추가 분리하고 `components/joints.rs` facade re-export로 기존 `crate::components::joints::*` 및 `crate::components::*` 경로를 유지했다.
   - 완료: component unit tests는 `components/tests.rs`로 분리했다.
   - 완료: `SpriteAnimation::uv()` hot path에서 atlas frame sequence를 값으로 복사하던 private helper를 참조 반환으로 바꿔 최대 32-frame 배열 복사를 제거했다.
   - 완료: atlas frame lookup helper와 frame metadata accessor도 `&self` receiver로 바꿔 `uv()` hot path와 public accessor 호출에서 frame sequence 전체가 복사되지 않도록 했다.
   - 완료: 큰 `Copy` collider 반환 경로는 public owned getter를 유지하되 `chain_collider_ref`, `convex_polygon_collider_ref`, crate-private `compound_collider_ref_at` borrow view를 추가해 collision shape lookup, filter/trigger/material 조회, physics body collider snapshot에서 불필요한 large collider 복사를 줄였다.
   - `components.rs`는 public facade와 re-export 중심으로 유지해 crate root 및 내부 import 경로를 깨지 않는다.

7. `shooter_scene.rs`
   - 완료: config/type authoring, numeric sanitizer, prefab template/collider validation, animation frame parsing은 `shooter_scene/config.rs`로 분리하고 기존 `crate::shooter_scene::*` import 경로는 facade re-export로 유지했다.
   - 완료: shooter scene config의 numeric sanitizer, prefab template/collider normalization, sprite animation parsing은 `shooter_scene/config/{numbers,templates,animation}.rs` child module로 추가 분리했다. 기존 `crate::shooter_scene::*` re-export와 Game Spec/Wasm authoring 호출 계약은 유지한다.
   - 완료: Top-down Shooter snapshot DTO, snapshot capture/restore, snapshot ABI helper는 `shooter_scene/snapshot.rs`로 분리하고 `SHOOTER_*` 상수와 field ordering은 유지했다.
   - 완료: update loop, input, enemy/navigation, bullet lifetime/despawn, enemy spawn, collision/audio/VFX side effect는 `shooter_scene/runtime.rs`로 분리했다. Frame phase 순서와 scratch `Vec` 재사용 계약은 유지한다.
   - 완료: `shooter_scene/runtime.rs`의 enemy behavior/navigation cache와 wave/spawn state는 `shooter_scene/runtime/{enemies,waves}.rs`로 추가 분리했다. Update frame phase, navigation scratch reuse, wave spawn count/interval semantics는 유지한다.
   - 완료: player input/fire/clamp와 bullet lifetime/despawn은 `shooter_scene/runtime/{player,bullets}.rs`로 추가 분리했다. Fire cooldown, camera-adjusted mouse target, bullet lifetime/out-of-bounds despawn semantics는 유지한다.
   - 완료: bullet-enemy/player-enemy combat collision side effect는 `shooter_scene/runtime/combat.rs`로 추가 분리했다. Collision scratch/pair buffers, pending despawn drain order, hit event/audio/particle/tween semantics는 유지한다.
   - 완료: shooter scene unit tests는 `shooter_scene/tests.rs`로 분리했다.
   - 완료: `shooter_scene/tests.rs`의 player/state, combat, config/prefab, enemy behavior, wave, audio event 회귀 테스트는 `shooter_scene/tests/*.rs` 하위 모듈로 분리했다. Parent test module은 `playing_scene`/`count_layer` fixture와 shared imports만 유지한다.
   - 완료: runtime module 내부의 collision event/particle/tween sink와 audio event helper는 `shooter_scene/runtime/effects.rs`로 분리하고, `update_internal`의 optional side-effect 인자는 `ShooterRuntimeSinks`로 묶어 frame orchestration 잡음을 줄였다. Bullet/combat phase의 `pending_despawn` scratch clear/drain도 private helper로 통일해 phase별 drain 위치와 scratch 재사용 계약을 유지한다.
   - `shooter_scene.rs`는 `ShooterScene` storage, reset/config facade, texture/template application 중심으로 유지한다.

8. `breakout_scene.rs`
   - 완료: `breakout_scene.rs`는 `BreakoutScene` storage, default/new/accessor, facade re-export 중심으로 줄이고 config, effects, level spawn, runtime update/collision, tests 책임은 `breakout_scene/{config,effects,level,runtime,tests}.rs`로 분리했다.
   - 완료: 기존 `crate::breakout_scene::{BreakoutScene, BreakoutParticleBurstSink, breakout_brick_hit_particle_preset}` 경로와 `BreakoutScene::{new, reset_to_title, reset_playing, update, update_camera, score, game_state}` method surface는 유지했다.
   - 완료: ball hit detection은 기존처럼 walls/bricks slice를 직접 순회하며 `Option<(f32, BreakoutHit)>`만 갱신하고, 매 프레임 live brick `Vec` 재수집이나 trait object dispatcher를 추가하지 않았다.
   - `breakout_scene.rs`는 built-in example scene facade이며, WebGL/WebGPU/audio browser 책임은 계속 TypeScript platform layer와 engine runtime buffer 소비 경로에 둔다.

9. TypeScript runtime
   - `createEngine.ts`를 Wasm lifecycle, frame assembly, asset bootstrap, input/audio/render adapter로 나눈다.
   - 완료: `createEngine.ts`의 frame assembly/input push/viewport push/audio drain/FrameState 조립 책임은 `engineFramePipeline.ts`로 분리하고, public API facade와 lifecycle 상태는 `createEngine.ts`에 유지했다.
   - 완료: `createEngine.ts`의 fixed timestep, physics debug flag, rigid-body step option/stats, Physics Spec runtime option 적용 책임은 `physicsRuntimeControls.ts`로 분리하고, public `FerrumEngine` API와 타입 export는 유지했다.
   - 완료: `createEngine.ts`의 rigid body/collider authoring facade는 `physicsBodyApi.ts`로 분리하고, material merge/write 책임은 `physicsBodyMaterials.ts`, snapshot read 책임은 `physicsBodySnapshots.ts`, body-state buffer encode/decode ABI 책임은 `physicsBodyStateBuffer.ts`에 모았다. public `FerrumPhysicsBodyApi` 타입과 `FerrumEngine` surface는 유지했다.
   - 완료: `physicsBodyApi.ts`의 rigid body spawn switch와 compound collider add switch는 `physicsBodySpawning.ts`로 분리했다. `createPhysicsBodyApi()`는 lifecycle guard와 public facade 조립을 유지하고, spawn/add collider의 Wasm 호출 순서와 기본 layer/mask/material/tuning 적용 계약은 바꾸지 않는다.
   - 완료: `createEngine.ts`의 body/tile physics query facade와 query buffer decode dispatch는 `physicsQueryApi.ts`로 분리하고, body authoring/query 공용 mask/convex polygon vertex buffer helper는 `physicsWasmInputs.ts`로 분리해 Wasm 호출 순서와 public `FerrumPhysicsQueryApi`를 유지했다.
   - 완료: `createEngine.ts`의 physics joint spawn/query/clear/toggle facade는 `physicsJointApi.ts`로 분리하고, body/joint 공용 numeric guard와 entity handle guard는 `physicsAuthoringNumbers.ts`, `physicsHandles.ts`로 분리했다. public `FerrumPhysicsJointApi` 타입과 `FerrumEngine` surface는 유지했다.
   - 완료: `createEngine.ts`의 package-facing public type/interface contract는 `engineTypes.ts`로 분리하고, `createEngine.ts`는 type-only re-export로 기존 import 경로를 유지했다. runtime factory는 lifecycle 조립과 내부 API composition에 집중한다.
   - 완료: `engineTypes.ts`의 public type contract는 `engineTypes/{api,frame,physicsBodies,physicsGeometry,physicsJoints,physicsQueries}.ts`로 기능군 분리하고, 기존 `./engineTypes.js` facade import 경로와 `createEngine.ts` type-only re-export surface를 유지했다.
   - 완료: 내부 TypeScript 모듈의 type-only import는 `createEngine.ts` 대신 `engineTypes.ts`를 직접 참조하도록 정리해 runtime factory가 타입 허브 역할까지 맡지 않도록 했다.
   - 완료: `createEngine.ts`의 shooter tilemap 편집/네비게이션 API 조립은 `engineTilemapApi.ts`로 분리했다. Public `FerrumSceneApi` surface, explicit query buffer copy semantics, debug line decode 계약은 유지한다.
   - 완료: `physicsAuthoring.ts`의 exported type contract, preset constants, material helper, layer-map helper, collider conversion/runtime collider flattening, joint option conversion/world-anchor cleanup, vehicle rig composition, public handle snapshot, runtime body guard, Physics Spec world apply, validation helper는 `physicsAuthoringTypes.ts`, `physicsAuthoringPresets.ts`, `physicsAuthoringMaterial.ts`, `physicsAuthoringLayers.ts`, `physicsAuthoringColliders.ts`, `physicsAuthoringJoints.ts`, `physicsAuthoringVehicle.ts`, `physicsAuthoringHandles.ts`, `physicsAuthoringRuntime.ts`, `physicsAuthoringWorld.ts`, `physicsAuthoringValidation.ts`로 분리하고, 기존 `./physicsAuthoring.js` public import 경로는 facade re-export로 유지했다.
   - 완료: `createJoint`가 `"world"` endpoint용 static anchor body를 생성할 때 반환 handle에 `worldAnchors`와 idempotent `clear()`를 제공해 joint와 anchor를 함께 정리할 수 있게 했다. joint 생성 실패나 stale resolved joint reference가 발생하면 생성된 world anchor를 즉시 despawn한다. Physics Spec 적용 경로의 world-anchor ownership은 `PhysicsWorldApplyResult.clear()`가 계속 담당한다.
   - 완료: `createPhysicsWorldFromSpec`는 body/joint 적용 중간 실패 시 이미 생성한 body, joint, world anchor를 rollback한다. `clearPhysicsWorld`는 `PhysicsWorldApplyResult.clear()`로 위임해 중복 clear 호출도 idempotent cleanup 경로를 사용한다.
   - 완료: `createVehicleRig`의 chassis/wheel/joint composition은 `physicsAuthoringVehicle.ts`로 분리하고, wheel validation/body spawn/joint spawn 중간 실패 시 guide/suspension joint, wheel, chassis 순서로 rollback한다. 반환 배열은 frozen snapshot으로 제공해 consumer mutation이 internal cleanup ownership을 깨지 않게 했다.
   - 완료: `createPhysicsWorldFromSpec` orchestration과 resolved body/collider runtime apply는 `physicsAuthoringWorld.ts`로 분리했다. `physicsAuthoringRuntime.ts`는 body spawn, mass property, compound collider material runtime rejection을 diagnostic error로 정규화해 `createRigidBody`, joint world anchor 생성, world apply가 같은 failure contract를 사용한다. `physicsAuthoringHandles.ts`는 public body/joint/world-anchor handle을 frozen snapshot으로 제공해 consumer mutation이 private cleanup ownership을 깨지 않게 한다.
   - 완료: `physicsSpec.ts`는 `DEFAULT_PHYSICS_MODE`, `resolvePhysicsMode`, `resolvePhysicsSpec`, public type re-export만 담당하는 compatibility facade로 줄이고, 기본값/field key/root/material-layer/body/collider geometry/joint/debug resolution은 `physicsSpec/*.ts` vertical slice로 분리했다. 기존 `./physicsSpec.js` public import 경로와 diagnostic error contract는 유지한다.
   - 완료: Physics Spec reference validation은 inherited object key를 id로 인정하지 않도록 `hasOwnProperty` 기반 검사로 바꾸고, `world`-`world` joint와 `aabb`/`box`의 무시되는 `rotationRadians`를 spec 단계에서 diagnostic으로 차단한다. Resolved material/layer/body/joint map은 `__proto__` 같은 특수 id도 기존 `Object.fromEntries`와 같이 own data property로 보존한다.
   - 완료: Physics Spec layer mask 계산은 layer 이름별 index `Map`을 한 번 만들고 재사용해 mask target마다 `names.indexOf()`를 반복하지 않게 했다. Collider allowed-key `Set`도 shape별 module-level cache로 바꿔 collider마다 새 `Set`을 만들지 않는다.
   - 완료: WebGPU sprite texture range batching helper는 `webgpuSpriteRanges.ts`로 분리해 renderer class가 GPU pass/resource orchestration에 집중하도록 했다.
   - 완료: renderer stats는 public helper의 immutable 반환 계약을 유지하면서 WebGL2/WebGPU renderer 내부 `currentStats` 갱신을 mutating helper로 바꿨다. Frame hot path에서 stats spread copy와 `currentStats` 객체 교체를 줄이고 `stats()` public copy boundary는 유지한다.
   - 완료: runtime profiler는 optional field object spread, budget report 임시 배열/filter, bounded sample `splice()` 제거 배열, snapshot summary의 다중 `map()` 집계를 줄였다. Public sample/snapshot optional property omission과 property order, 0 값 보존 계약은 테스트로 고정했다.
   - 완료: `resolveLevelStreamingPlan()`은 active/preload/retain chunk를 단일 manifest 순회에서 분류하고, `LevelChunkStreamer.plan()`은 내부 loaded `Set`을 그대로 전달해 매 plan 호출의 loaded id 배열 생성을 피한다. Public chunk array 순서, string-sorted id summary, capped retain 이후 unload 판단 계약은 테스트로 고정했다.
   - 완료: `levelStreaming.ts`는 public compatibility facade로 유지하고, 타입 계약, manifest resolution, streaming plan 계산, streamer 상태 관리, 진단/검증 helper를 `levelStreamingTypes.ts`, `levelStreamingManifest.ts`, `levelStreamingPlan.ts`, `levelStreamingStreamer.ts`, `levelStreamingValidation.ts`로 분리했다. 기존 `./levelStreaming.js` public import surface와 plan 계산 계약은 유지한다.
   - 완료: WebGPU texture resource/upload/store 책임은 `webgpuTextureStore.ts`로 분리하고, resolution uniform upload는 재사용 staging buffer로 전환했다.
   - 완료: WebGPU sprite pipeline/material pass/instance buffer upload 책임은 `webgpuSpritePass.ts`로 분리하고, material staging buffer는 power-of-two growth로 전환해 outline/flash/legacy command copy 경로의 반복 재할당 가능성을 줄였다.
   - 완료: WebGL2 `SpriteBatch`는 stable material identity별 pass list를 내부 캐시로 재사용하고, WebGPU renderer는 `setSpriteMaterial()` 시점에 sprite material pass 배열을 확정해 render hot path의 `spriteMaterialPasses()` 반복 할당을 제거했다. `SpriteBatch`의 기존 material preset 입력 경로는 유지해 public API 호환성을 보존한다.
   - 완료: WebGL2 renderer의 logical/drawing-buffer resolution tuple은 renderer-owned scratch tuple로 재사용해 sprite, lighting, physics debug line, post-process draw 경로의 프레임별 작은 배열 생성을 줄였다.
   - 완료: tile occluder shadow projection은 기존 `projectTileOccluderShadowTriangles()` wrapper를 유지하면서 renderer-owned scratch/output buffer에 쓰는 `writeTileOccluderShadowTrianglesInto()` 경로를 추가했다. WebGL2/WebGPU lighting pass는 reusable clip rect와 scratch를 사용하고, WebGL2 shadow upload는 `subarray()` view 생성 없이 offset/length overload를 사용한다.
   - 완료: tile occluder grid derivation은 동일한 x/width의 연속 row run을 vertical merge해 큰 직사각형 벽의 occluder 수를 줄이고, WebGL2/WebGPU shadow culling은 `Math.hypot()` 대신 squared-distance 비교를 사용한다. 기존 `distanceToTileOccluder()` 호환 helper는 유지한다.
   - 완료: WebGPU fade-only post-process pass는 `webgpuPostProcessPass.ts`로 분리해 pipeline/uniform/bind group 수명과 unsupported pass 진단을 renderer 밖으로 이동했다.
   - 완료: WebGPU physics debug line pass는 `webgpuDebugLinePass.ts`로 분리하고, debug line vertex upload는 `subarray()` view 생성 없이 buffer offset/byteCount로 수행한다.
   - 완료: WebGPU lighting/shadow pass는 `webgpuLightingPass.ts`로 분리하고, lighting/shadow upload는 buffer offset/byteCount 방식과 power-of-two staging growth를 사용한다.
   - 완료: `cameraPostProcessing.ts`는 public compatibility facade로 유지하고, camera rig type/resolve/runtime, post-process type/resolve, screen fade transition, validation helper는 `cameraPostProcessing/{types,cameraRig,postProcess,screenFade,validation}.ts`로 분리했다. 기존 `./cameraPostProcessing.js` local import와 root public export surface는 유지한다.
   - 완료: `resolveCameraRigSpec()`가 mutable default dead-zone 객체를 공유하지 않도록 기본값을 복사하고 회귀 테스트를 추가했다.
   - 완료: `resolvePostProcessPasses()`는 `entries`/`map`/`filter`/shorthand spread 객체 생성을 줄이고 단일 result 배열에 직접 resolve/push하도록 바꿨다. Renderer별 command encoding은 계속 `webgl2FullscreenPass.ts`와 `webgpuPostProcessPass.ts`에 둔다.
   - 완료: post-process config marker, physics material preset/spec material, rigid body type/layer, joint type, input action reference 검증은 inherited property를 유효 키로 인정하지 않도록 `hasOwnProperty` 기반으로 정리했다. Prototype-chain key가 public authoring/runtime API를 통과해 Wasm code나 renderer config에 잘못 전달되는 경로를 차단한다.
   - 완료: `assetPipeline.ts`의 Aseprite/Tiled/LDtk importer, public type, JSON validation, tile metadata parsing 책임은 `assetPipelineAseprite.ts`, `assetPipelineTiled.ts`, `assetPipelineLDtk.ts`, `assetPipelineTypes.ts`, `assetPipelineValidation.ts`, `assetPipelineTileMetadata.ts`로 분리하고, 기존 `assetPipeline.ts` import 경로는 compatibility facade로 유지했다.
   - 완료: `assetPipelineLDtk.ts`의 level selection/external level source, entity layer parsing, LDtk 공용 좌표/상수 helper를 `assetPipelineLDtkLevels.ts`, `assetPipelineLDtkEntities.ts`, `assetPipelineLDtkValues.ts`, `assetPipelineLDtkConstants.ts`로 분리했다. Public `importLDtkTilemap`/`importLDtkGameSpec` export와 diagnostic path 문자열은 유지한다.
   - 완료: `assetPipelineLDtk.ts`의 tileset/metadata parsing, tile layer/int-grid conversion, atlas frame naming/texture mapping은 `assetPipelineLDtk{Tilesets,Layers,Frames}.ts`로 추가 분리했다. `assetPipelineLDtk.ts`는 public importer orchestration과 result assembly facade로 유지한다.
   - 완료: `gameSpec.ts`의 public type contract, 기본값, JSON 검증 helper, Game Spec resolution, Wasm 적용 책임은 `gameSpecTypes.ts`, `gameSpecDefaults.ts`, `gameSpecValidation.ts`, `gameSpecResolve.ts`, `gameSpecApply.ts`로 분리하고, 기존 `gameSpec.ts` import 경로는 compatibility facade로 유지했다.
   - 완료: `gameSpecResolve.ts`의 prefab collider/material, atlas frame/animation, tilemap parsing 책임은 `gameSpecPrefab.ts`, `gameSpecAtlas.ts`, `gameSpecTilemap.ts`로 추가 분리했다. `resolveShooterGameSpec`는 orchestration과 gameplay preset 조립에 집중하며, atlas animation 검증은 spread 배열 생성을 피하고 idle/move frame group을 직접 순회한다.
   - 완료: `extractTilemapBoundaryChains()`의 boundary segment 연결은 path마다 남은 segment Set을 배열화/정렬하지 않고, 한 번 정렬한 segment index와 cursor를 재사용한다. PixelMaskTerrain chunk boundary rebuild 경로의 반복 정렬/배열 allocation 가능성을 줄이고 disconnected chain 출력 순서는 테스트로 고정했다.
   - 완료: `physicsSnapshot.ts`의 public snapshot/replay facade를 유지하고, type contract, canonical hash, public JSON validation, world capture/restore, replay input runner 책임을 `physicsSnapshotTypes.ts`, `physicsSnapshotHash.ts`, `physicsSnapshotValidation.ts`, `physicsWorldSnapshot.ts`, `physicsReplayInput.ts`로 분리했다. Snapshot/replay hash는 rollback/debug 검증용 non-hot-path로 유지하고, body state capture/restore는 기존 bulk buffer 경계를 유지한다.
   - 완료: `wasmBridge.ts`의 Rust/TypeScript ABI layout 검증은 `wasmBridgeAbi.ts`로 분리했다. `WasmBridge` class는 public method/export 경로와 frame buffer view 생성 책임을 유지하며, render/audio/collision/physics buffer는 기존처럼 호출 시점에 새 typed array/DataView를 만들어 Wasm memory grow에 안전하게 둔다.
   - 완료: `wasmBridge.ts`의 render/audio/collision/physics/tilemap/shooter buffer view 생성은 `wasmBridgeBufferViews.ts`로 분리했다. `WasmBridge`의 public `read*Buffer`/`read*` method 이름, shape-cast/raycast buffer alias, physics body snapshot length consistency check는 유지한다.
   - 완료: root `index.ts` public entrypoint는 유지하고 export 목록은 `public/{workflowExports,engineExports,physicsAuthoringExports,platformExports,wasmBufferExports}.ts` 내부 barrel로 분리했다. Package `exports["."]` surface와 기존 named export는 유지한다.
   - 완료: 3,585줄 단일 `publicApiTypes.test.ts`는 `publicApiTypes.shared.ts` 공통 type/export harness와 asset, scene, physics authoring, physics decoder, rendering, runtime, shooter spec, UI/platform 도메인별 `*.test.ts`로 분리했다. `node --test dist-test/test/*.test.js` discovery 경로와 public entrypoint type/import 계약은 유지한다.
   - 완료: 2,189줄 단일 `gameSpec.test.ts`는 core resolve, validation, content/atlas, tilemap, apply/engine-forwarding 도메인별 `gameSpec*.test.ts`와 `gameSpec.shared.ts` FakeEngine fixture로 분리했다. `node --test dist-test/test/*.test.js` discovery 경로와 기존 `../src/gameSpec.js` compatibility import 계약은 유지한다.
   - 완료: 1,088줄 단일 `assetPipeline.test.ts`는 Aseprite, Tiled, LDtk importer 테스트와 `assetPipeline.shared.ts` 공통 assertion/base64 helper로 분리했다. 기존 `../src/assetPipeline.js` compatibility import와 `node --test dist-test/test/*.test.js` discovery 경로는 유지한다.
   - 유지: `physicsAuthoring.ts` facade에 새 public helper가 추가될 경우 기존처럼 기능별 모듈에서 구현하고 facade는 re-export만 담당한다.
   - `webgpuRenderer.ts`는 texture resource, sprite pass, lighting pass, debug line pass, post-process pass orchestration 중심으로 유지한다.

## 검증 기준

- Rust core 변경: `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- TypeScript platform 변경: `pnpm --filter @ferrum2d/ferrum-web lint`, `pnpm --filter @ferrum2d/ferrum-web test`
- Wasm/API 변경: `pnpm build`, `pnpm smoke:headless`, `pnpm package:check`
- Game Spec/예제 영향: `pnpm validate:game-spec`
