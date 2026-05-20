# 2D 물리엔진 기능 맵

이 문서는 2D 게임에서 일반적으로 쓰이는 물리엔진 기능을 Ferrum2D 관점으로 정리한다. 현재 저장소의 구현 범위는 [Physics v2 범위](physics-v2.md)를 기준으로 하며, 아래 항목은 전체 기능 목록과 단계별 후보를 구분하기 위한 기준이다.

Ferrum2D의 기본 원칙은 Rust core가 simulation state와 collision query를 소유하고, TypeScript platform layer는 입력, asset/audio, renderer, debug UI를 담당하는 것이다. 물리 기능을 확장하더라도 hot path에서 entity별 JS/Wasm 왕복 호출을 만들지 않는다.

## 현재 구현됨

| 영역 | 내용 | 구현 위치 |
| --- | --- | --- |
| Transform/Velocity | 위치와 선형 속도 component, `delta` 기반 위치 적분 | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/physics.rs` |
| AABB collider | half width/height 기반 축 정렬 박스 collider | `crates/ferrum-core/src/components.rs` |
| World bounds clamp | collider extents를 고려한 entity bounds 제한 | `crates/ferrum-core/src/physics.rs` |
| AABB bounds | `Transform2D`와 `AabbCollider`에서 world-space min/max 계산 | `crates/ferrum-core/src/collision.rs` |
| Overlap test | 두 AABB의 현재 프레임 겹침 판정 | `crates/ferrum-core/src/collision.rs` |
| Broadphase | x축 min bound 정렬 기반 sweep-and-prune pair 축소 | `crates/ferrum-core/src/collision.rs` |
| Collision layer | player/enemy/bullet layer와 요청 순서 기반 pair query | `crates/ferrum-core/src/collision.rs` |
| Swept AABB | 빠른 이동체의 한 프레임 통과 충돌 time-of-impact 계산 | `crates/ferrum-core/src/collision.rs` |
| Swept layer pair | 이동 경로 AABB로 후보를 줄인 뒤 precise swept overlap 확인 | `crates/ferrum-core/src/collision.rs` |
| Shooter collision | bullet/enemy hit, player/enemy game-over 충돌 연결 | `crates/ferrum-core/src/shooter_scene.rs` |
| Tilemap obstacle | `collision: true` tile layer를 정적 AABB 장애물로 사용 | `crates/ferrum-core/src/tilemap.rs` |

## 2D 물리엔진 전체 기능 목록

### Simulation Loop

- Fixed timestep accumulator
- Variable delta clamp
- Substep
- Pause/resume
- Deterministic update order
- Simulation island 분리
- Debug/profile timing

현재 Ferrum2D는 `GameLoop`의 delta clamp와 Rust update 루프를 사용한다. fixed timestep accumulator와 substep은 아직 별도 구현하지 않았다.

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

현재 구현은 AABB와 tilemap AABB obstacle 중심이다. circle, capsule, polygon, one-way platform은 상용제품 기능 개발 로드맵에서 별도 설계 후 추가한다.

### Broadphase

- Brute force pair check
- Sweep-and-prune
- Uniform grid/spatial hash
- Dynamic AABB tree
- Quad tree
- Layer/mask 기반 pair pruning
- Active body pruning

현재 구현은 sweep-and-prune과 layer pair query다. entity 수가 많아지면 spatial hash 또는 dynamic AABB tree를 별도 벤치마크 후 검토한다.

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

현재 구현은 AABB overlap과 swept AABB hit time이다. 충돌 반응용 normal/depth/manifold는 아직 없다.

### Continuous Collision Detection

- Swept AABB
- Ray cast 기반 fast projectile hit
- Conservative advancement
- Speculative contact
- Substep fallback

현재 구현은 빠른 bullet/enemy 충돌을 위한 swept AABB다. 연속 충돌 반응, sliding, bounce는 구현하지 않았다.

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

현재 Ferrum2D는 shooter hit/game-over 같은 trigger event를 중심으로 한다. solid push-out과 impulse solver는 Physics v3 이상에서 별도 설계가 필요하다.

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
- Shape query
- Ray cast
- Segment cast
- Shape cast
- Nearest body query
- Layer/mask query

현재는 collision pair query가 중심이다. ray cast와 point query는 editor 없이도 gameplay에 유용하므로 Physics v3 후보로 둔다.

### Character and Platformer Support

- Kinematic character controller
- Slope handling
- Step offset
- Ground detection
- Jump buffering
- Coyote time
- One-way platform
- Moving platform carry

현재 Top-down Shooter 범위에는 포함하지 않는다. platformer 예제를 추가할 때 별도 문서와 테스트로 설계한다.

### Tilemap Physics

- Static tile obstacle
- Tile collision layer
- Tile AABB merge
- Slope tile
- One-way tile
- Destructible tile collision refresh
- Navigation obstacle reuse

현재는 `collision: true` layer의 양수 tile을 player/enemy AABB 장애물과 navigation obstacle로 사용한다. tile AABB merge와 slope tile은 아직 없다.

### Events and Callbacks

- Collision enter/stay/exit
- Trigger enter/stay/exit
- Contact begin/end
- Pre-solve/post-solve
- Collision filtering callback
- Hit payload, damage payload

현재는 shooter scene 내부에서 pair query 결과를 직접 소비한다. public callback API는 Wasm 경계와 hot path 비용을 먼저 설계해야 한다.

### Debug and Tooling

- Collider debug draw
- Broadphase bounds debug draw
- Contact point/normal debug draw
- Physics profile counters
- Pair count/collision count metrics
- Determinism replay
- Golden simulation tests

현재 DebugOverlay는 game/render/audio 중심이다. physics counter와 collider debug draw는 안정화 후보로 둔다.

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
| Physics v3 | fixed timestep, ray/point/AABB query, physics debug counters | 현재 shooter 구조를 유지하면서 query와 관측성을 확장 |
| Physics v4 | circle collider, collision mask bitset, tile AABB merge | 더 다양한 2D gameplay와 tilemap 성능 개선 |
| Physics v5 | kinematic solid movement, push-out, sliding | top-down wall collision과 platformer 기반 마련 |
| Physics v6 | dynamic rigid body, material, impulse solver | 상자, 폭발, bounce 같은 물리 상호작용 지원 |
| Physics v7 | joints/constraints | rope, spring, hinge, vehicle류 gameplay 지원 |

각 단계는 별도 설계 문서, Rust unit test, 예제, smoke 기준을 만든 뒤 구현한다.

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
