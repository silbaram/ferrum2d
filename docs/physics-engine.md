# 2D 물리엔진 기능 맵

이 문서는 2D 게임에서 일반적으로 쓰이는 물리엔진 기능을 Ferrum2D 관점으로 정리한다. 현재 저장소의 구현 범위는 [Physics v2 범위](physics-v2.md), [Physics v3 기반](physics-v3.md), Physics v4 nearest query를 기준으로 하며, 아래 항목은 전체 기능 목록과 단계별 후보를 구분하기 위한 기준이다.

Ferrum2D의 기본 원칙은 Rust core가 simulation state와 collision query를 소유하고, TypeScript platform layer는 입력, asset/audio, renderer, debug UI를 담당하는 것이다. 물리 기능을 확장하더라도 hot path에서 entity별 JS/Wasm 왕복 호출을 만들지 않는다.

## 현재 구현됨

| 영역 | 내용 | 구현 위치 |
| --- | --- | --- |
| Transform/Velocity | 위치와 선형 속도 component, `delta` 기반 위치 적분 | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/physics.rs` |
| AABB collider | half width/height 기반 축 정렬 박스 collider | `crates/ferrum-core/src/components.rs` |
| Circle collider | radius 기반 원형 collider와 AABB broadphase proxy | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/collision.rs`, `crates/ferrum-core/src/world.rs` |
| World bounds clamp | collider extents를 고려한 entity bounds 제한 | `crates/ferrum-core/src/physics.rs` |
| AABB bounds | `Transform2D`와 `AabbCollider`에서 world-space min/max 계산 | `crates/ferrum-core/src/collision.rs` |
| Overlap test | AABB/AABB, AABB/circle, circle/circle 현재 프레임 겹침 판정 | `crates/ferrum-core/src/collision.rs` |
| Broadphase | x축 min bound 정렬 기반 sweep-and-prune pair 축소 | `crates/ferrum-core/src/collision.rs` |
| Collision layer | player/enemy/bullet layer와 요청 순서 기반 pair query | `crates/ferrum-core/src/collision.rs` |
| Collision filter | entity별 category/mask bitset 기반 pair pruning | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/collision.rs` |
| Swept AABB | 빠른 이동체의 한 프레임 통과 충돌 time-of-impact 계산 | `crates/ferrum-core/src/collision.rs` |
| Swept layer pair | 이동 경로 AABB로 후보를 줄인 뒤 precise swept overlap 확인 | `crates/ferrum-core/src/collision.rs` |
| AABB/circle contact | 현재 frame overlap의 normal과 penetration 계산 | `crates/ferrum-core/src/collision.rs` |
| Physics query | point/AABB/circle/generic shape/raycast/shape cast/nearest body 기반 world collider 조회 | `crates/ferrum-core/src/collision.rs` |
| Physics debug line | current-frame broadphase AABB proxy bounds와 contact normal을 world-space line primitive로 생성하고 opt-in Wasm/TypeScript f32 buffer로 노출 | `crates/ferrum-core/src/collision.rs`, `crates/ferrum-core/src/engine.rs`, `packages/ferrum-web/src/wasmBridge.ts` |
| Kinematic movement | world collider와 tilemap obstacle 대상 swept AABB 기반 move-and-slide | `crates/ferrum-core/src/physics.rs`, `crates/ferrum-core/src/tilemap.rs` |
| Fixed timestep | delta clamp, accumulator, fixed step count, render alpha, dropped time 계산과 opt-in `Engine.update(delta)` fixed loop | `crates/ferrum-core/src/physics.rs`, `crates/ferrum-core/src/engine.rs` |
| Physics counters | fixed step, kinematic hit, solid/tile 후보 검사 수 누적과 `FrameState.physics`/DebugOverlay 노출 | `crates/ferrum-core/src/physics.rs`, `packages/ferrum-web/src/createEngine.ts`, `packages/ferrum-web/src/debugOverlay.ts` |
| Collision events | AABB pair enter/stay/exit lifecycle, gameplay hit event, damage payload, Wasm u32 buffer decode | `crates/ferrum-core/src/collision_event.rs`, `packages/ferrum-web/src/collisionEventDecoder.ts` |
| Shooter collision | bullet/enemy hit, player/enemy game-over 충돌 연결 | `crates/ferrum-core/src/shooter_scene.rs` |
| Tilemap obstacle | `collision: true` tile layer를 merged 정적 AABB 장애물로 굽고 collider AABB 주변 obstacle, swept path, nearest obstacle query에 재사용 | `crates/ferrum-core/src/tilemap.rs` |

## 2D 물리엔진 전체 기능 목록

### Simulation Loop

- Fixed timestep accumulator
- Variable delta clamp
- Substep
- Pause/resume
- Deterministic update order
- Simulation island 분리
- Debug/profile timing

현재 Ferrum2D는 reusable `FixedTimestep` accumulator와 opt-in fixed update loop를 제공한다. 기본값은 기존 gameplay delta 회귀를 피하기 위해 variable-delta update이며, host 앱은 `CreateEngineOptions.fixedTimestep` 또는 `FerrumEngine.configureFixedTimestep(...)`으로 fixed timestep을 켠다. substep은 아직 별도 구현하지 않았다.

### Body Model

- Static body: 움직이지 않는 벽, 바닥, tile obstacle
- Kinematic body: 코드가 직접 위치/속도를 제어하는 player, platform, enemy
- Dynamic body: mass, force, impulse로 움직이는 물체
- Sensor/trigger body: 충돌 반응 없이 overlap event만 발생
- Body enable/disable
- Sleep/wake
- Gravity scale
- Linear/angular damping

현재 Ferrum2D는 player/enemy/bullet을 kinematic에 가까운 방식으로 다루며, collider의 `is_trigger`는 이벤트성 충돌 전제로 사용한다. dynamic rigid body, sleep/wake, mass 기반 motion은 구현하지 않았다.

### Shape and Collider

- AABB
- Circle
- Capsule
- Oriented box
- Convex polygon
- Chain/edge collider
- Compound collider
- Tilemap collider
- One-way platform collider
- Collider offset
- Collider material
- Collision mask/category

현재 구현은 AABB, circle, tilemap AABB obstacle, entity one-way platform 중심이다. capsule, polygon, one-way tile은 상용제품 기능 개발 로드맵에서 별도 설계 후 추가한다.

### Broadphase

- Brute force pair check
- Sweep-and-prune
- Uniform grid/spatial hash
- Dynamic AABB tree
- Quad tree
- Layer/mask 기반 pair pruning
- Active body pruning

현재 구현은 sweep-and-prune, layer pair query, category/mask 기반 mask pair query다. entity 수가 많아지면 spatial hash 또는 dynamic AABB tree를 별도 벤치마크 후 검토한다.

### Narrowphase

- AABB vs AABB
- Circle vs circle
- Circle vs AABB
- Segment/ray vs shape
- Polygon SAT
- Contact normal
- Penetration depth
- Contact manifold
- Closest point query

현재 구현은 AABB/circle overlap, swept AABB hit time, AABB/circle contact normal/penetration, point-to-collider nearest point/distance query다. 여러 contact point를 갖는 manifold는 아직 없다.

### Continuous Collision Detection

- Swept AABB
- Ray cast 기반 fast projectile hit
- Conservative advancement
- Speculative contact
- Substep fallback

현재 구현은 빠른 bullet/enemy 충돌과 kinematic move-and-slide를 위한 swept AABB다. bounce/restitution 기반 연속 충돌 반응은 구현하지 않았다.

### Collision Response

- Trigger event only
- Solid push-out
- Sliding movement
- Bounce/restitution
- Friction
- Velocity projection
- Position correction
- Dynamic-dynamic impulse response
- Dynamic-static response
- Contact persistence

현재 Ferrum2D는 shooter hit/game-over 같은 trigger event와 kinematic move-and-slide를 지원한다. tilemap obstacle은 기존 overlap push-out과 swept move-and-slide에서 모두 AABB contact 계열 계산을 재사용하지만, impulse solver는 별도 설계가 필요하다.

### Solver

- Sequential impulse solver
- Position solver
- Velocity solver
- Warm starting
- Baumgarte stabilization
- Iteration count tuning
- Mass/inertia calculation

현재 구현하지 않는다. 이 영역은 복잡한 physics engine 범위이므로 milestone 합의 없이 추가하지 않는다.

### Forces and Materials

- Gravity
- Force accumulator
- Impulse
- Torque
- Drag
- Friction material
- Restitution material
- Density
- Surface velocity

현재 구현하지 않는다. Top-down Shooter에서는 velocity를 직접 설정하는 방식이 더 단순하고 안정적이다.

### Joints and Constraints

- Distance joint
- Revolute/pin joint
- Prismatic/slider joint
- Rope joint
- Spring joint
- Motor joint
- Gear joint
- Limit constraint
- Breakable joint

현재 구현하지 않는다. 이 기능군은 별도 rigid body solver가 생긴 뒤에만 검토한다.

### Queries

- Point query
- AABB query
- Circle query
- Shape query
- Ray cast
- Segment cast
- Shape cast
- Nearest body/tilemap obstacle query
- Ground probe
- Layer/mask query

현재는 collision pair query, point query, AABB query, circle query, generic shape query, raycast, AABB/circle shape cast, nearest body query, tilemap nearest obstacle query, ground probe를 지원한다. `nearest_body_query(...)`는 point와 `max_distance`, `CollisionMask`를 받아 가장 가까운 collider surface hit를 deterministic tie-break로 반환한다. `Tilemap::nearest_collision_obstacle(...)`는 같은 방식으로 `collision: true` layer의 merged obstacle rect를 조회한다. `PhysicsSystem::ground_probe(...)`와 `ground_probe_with_tilemap(...)`는 아래 방향으로 짧은 swept AABB probe를 수행해 platformer controller의 grounded 판정을 돕는다.

### Character and Platformer Support

- Kinematic character controller
- Slope handling
- Step offset
- Ground detection
- Jump buffering
- Coyote time
- One-way platform
- Moving platform carry

현재 ground detection은 Rust core query로 제공하고, entity one-way platform은 `OneWayPlatformConfig`와 `move_and_slide_with_one_way_platforms(...)`로 제공한다. moving platform carry는 `MovingPlatformCarryConfig`와 `carry_moving_platform(...)`로 현재 grounded된 rider에게 platform delta를 적용한다. kinematic platformer controller primitive는 `PlatformerControllerInput`, `PlatformerControllerConfig`, `PlatformerControllerState`, `move_platformer_controller(...)`, `move_platformer_controller_with_state(...)`, `move_platformer_controller_with_tilemap(...)`로 제공하며 수평 입력, 중력, grounded/coyote/buffered jump, step offset, ground before/after 결과를 한 번에 처리한다. stateful variant는 `PlatformerControllerConfig.with_coyote_time_seconds(...)`와 `with_jump_buffer_seconds(...)` 설정을 사용해 coyote time과 jump buffering timer를 갱신한다. `with_step_offset(...)`은 grounded 상태에서 entity 또는 tilemap obstacle 수평 충돌이 발생할 때 위로 올림, 수평 이동, 아래로 ground snap을 순서대로 시도하며 실패하면 원래 move-and-slide 결과로 복원한다. `PlatformerScene`과 `examples/platformer`는 이 API를 Web runtime 경로에서 검증한다. slope handling과 one-way tile은 Top-down Shooter 범위에는 포함하지 않으며 별도 설계 후 추가한다.

### Tilemap Physics

- Static tile obstacle
- Tile collision layer
- Tile AABB merge
- Slope tile
- One-way tile
- Destructible tile collision refresh
- Navigation obstacle reuse

현재는 `collision: true` layer의 양수 tile을 player/enemy AABB 장애물과 navigation obstacle로 사용한다. 충돌 처리는 인접 solid tile run을 merged AABB obstacle로 캐시한 뒤 dynamic collider가 겹치거나 swept path가 지나가는 obstacle만 검사한다. navigation은 원본 tile grid를 계속 사용한다. slope tile은 아직 없다.

### Events and Callbacks

- Collision enter/stay/exit
- Trigger enter/stay/exit
- Contact begin/end
- Pre-solve/post-solve
- Collision filtering callback
- Hit event, damage payload

현재는 shooter scene 내부에서 pair query 결과를 직접 소비하고, 범용 관측용으로 `CollisionEventTracker`가 current-frame AABB pair의 enter/stay/exit를 `CollisionEvent` u32 buffer에 기록한다. 충돌 처리 직후 despawn되는 shooter bullet/enemy와 player/enemy 충돌은 `hit` event로 같은 buffer에 남긴다. Bullet/enemy hit event는 bullet damage를 payload로 기록하고, TypeScript decoder는 이를 `CollisionEventView.damage`로 복원한다. entity별 JS/Wasm callback과 pre/post-solve callback은 아직 없다.

### Debug and Tooling

- Collider debug draw
- Broadphase bounds debug draw
- Contact point/normal debug draw
- Physics profile counters
- Pair count/collision count metrics
- Determinism replay
- Golden simulation tests

현재 Rust core에는 `PhysicsCounters`가 있으며 fixed step, kinematic hit, solid/tile 후보 검사 수를 누적한다. TypeScript는 이 값을 `FrameState.physics`로 읽고 Top-down Shooter DebugOverlay는 `fixed steps`, `kinematic hits`, `tile checks`, `collision events`를 표시한다. Rust core는 broadphase AABB proxy bounds와 contact normal debug line primitive를 생성할 수 있고, TypeScript는 `FrameState.physicsDebugLineBuffer`와 `decodePhysicsDebugLines(...)`로 opt-in 관측할 수 있다. `WebGL2Renderer.renderPhysicsDebugLines(...)`와 runtime `physicsDebugLines` 옵션은 같은 buffer를 실제 line pass로 그린다.

### Performance and Memory

- Bulk buffer 기반 pair/result 전달
- Frame allocation 제한
- Scratch buffer 재사용
- Broadphase benchmark
- Hot path string/object 전달 금지
- Wasm memory typed array view 사용

Ferrum2D에서는 Rust core 내부에서 pair를 만들고 shooter scene이 바로 소비한다. public physics query를 Wasm 밖으로 노출할 경우, entity별 호출 대신 bulk buffer를 사용한다.

## Ferrum2D 단계별 후보

| 단계 | 후보 | 목적 |
| --- | --- | --- |
| Physics v3 | collision mask bitset, AABB/circle contact, point/AABB/circle/shape/raycast/shape-cast query, kinematic move-and-slide, tile candidate query, opt-in fixed timestep, physics counters/API, collision event lifecycle/payload | 현재 shooter 구조를 유지하면서 query와 관측성을 확장 |
| Physics v4 | nearest body/tilemap obstacle query (완료) | 더 다양한 2D gameplay와 물리 query 개선 |
| Physics v5 | ground detection, entity one-way platform, moving platform carry, kinematic platformer controller, jump buffering/coyote time, step offset, platformer example (부분 완료) | platformer 기반 마련 |
| Physics v6 | dynamic rigid body, material, impulse solver | 상자, 폭발, bounce 같은 물리 상호작용 지원 |
| Physics v7 | joints/constraints | rope, spring, hinge, vehicle류 gameplay 지원 |

각 단계는 별도 설계 문서, Rust unit test, 예제, smoke 기준을 만든 뒤 구현한다.
Physics v3 중 collision mask bitset, AABB/circle contact, point/AABB/circle/shape/raycast/shape-cast query, contact/broadphase debug line primitive와 Wasm/TypeScript buffer/rendering bridge, world/tilemap kinematic move-and-slide, tile candidate query와 tile AABB merge, opt-in fixed timestep runtime, physics counters/API 노출, collision event lifecycle과 damage payload는 [Physics v3 기반](physics-v3.md)으로 완료했다. Physics v4 nearest query는 Rust core `CollisionSystem::nearest_body_query(...)`와 `Tilemap::nearest_collision_obstacle(...)`로 완료했다. Physics v5 platformer 기반 중 ground detection은 `PhysicsSystem::ground_probe(...)`와 `ground_probe_with_tilemap(...)`로, entity one-way platform은 `OneWayPlatformConfig`와 `move_and_slide_with_one_way_platforms(...)`로, moving platform carry는 `MovingPlatformCarryConfig`와 `carry_moving_platform(...)`로, kinematic platformer controller는 `PlatformerControllerConfig`와 `move_platformer_controller(...)`로, jump buffering/coyote time은 `PlatformerControllerState`와 stateful controller variant로, step offset은 `PlatformerControllerConfig.with_step_offset(...)`으로, Web runtime 예제는 `FerrumEngine.usePlatformerGame()`와 `examples/platformer`로 시작했다.

## 현 단계에서 바로 넣지 않는 것

- 범용 rigid body solver
- force/torque 기반 dynamic simulation
- joints/constraints
- complex polygon collision
- fluid/soft body
- 외부 physics dependency 통합
- TypeScript가 simulation state를 소유하는 구조
- hot path entity별 JS/Wasm callback

이 항목들은 2D 게임 물리엔진에는 흔하지만, 현재 상용제품 기능 개발 범위에서는 크기와 위험이 크다. 구현이 필요하면 Physics v3 이상 milestone으로 분리한다.
