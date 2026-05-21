# Ferrum2D Physics v3 기반

이 문서는 탄막/Top-down Shooter 전용 충돌 계층을 범용 2D 게임 물리 계층으로 확장하기 위한 Physics v3 기반 범위를 기록한다. 목표는 full rigid body solver가 아니라, 기존 AABB 물리 위에 다른 장르가 재사용할 수 있는 collision filter, query, kinematic movement 기반을 마련하는 것이다.

## 완료 범위

- `CollisionMask`와 `CollisionFilter`: `Player/Enemy/Bullet` 전용 layer를 유지하면서 entity별 category/mask bitset을 추가했다. 기존 spawn 경로는 layer 기반 기본 filter를 자동 설정한다.
- Mask pair query: `CollisionSystem::build_mask_pairs(...)`와 `build_swept_mask_pairs(...)`로 shooter 전용 layer가 아닌 category bitset 기반 pair query를 지원한다.
- AABB contact: `AabbContact`와 `CollisionContact`가 contact normal과 penetration을 제공한다. contact normal은 pair의 `a`에서 `b` 방향이며, `a`를 밀어낼 때는 `-normal * penetration`을 적용한다.
- Query API: `point_query(...)`, `aabb_query(...)`, `raycast(...)`, `raycast_all(...)`이 `CollisionMask` 기반으로 world collider를 조회한다.
- Swept contact: `swept_aabb_contact(...)`가 time-of-impact와 entry normal을 함께 제공한다.
- Kinematic move-and-slide: `PhysicsSystem::move_and_slide(...)`가 swept AABB 기반으로 solid collider에 멈추고 남은 접선 이동을 유지한다. `move_and_slide_with_tilemap(...)`는 `collision: true` tile layer의 정적 AABB 장애물도 같은 이동 경로에서 처리한다.
- Generic World component setter: `World::set_transform(...)`, `set_velocity(...)`, `set_aabb_collider(...)`, `set_collision_filter(...)`로 shooter prefab 경로 없이도 physics entity를 구성할 수 있다.
- Tilemap collision candidate range: `collision: true` layer 전체를 매 entity마다 순회하지 않고, collider AABB가 겹치는 tile cell 범위만 검사한다.
- Tilemap push-out 공통화: tile obstacle push-out은 `CollisionSystem::aabb_contact(...)` 결과를 사용한다.
- Fixed timestep accumulator/runtime: `FixedTimestep`이 delta clamp, accumulator, fixed step count, render interpolation alpha, dropped time을 계산한다. 기본 `Engine.update(delta)`는 variable-delta 호환 경로를 유지하고, `Engine.configure_fixed_timestep(...)`, `CreateEngineOptions.fixedTimestep`, `FerrumEngine.configureFixedTimestep(...)`으로 opt-in fixed update loop를 켤 수 있다. fixed step이 없는 render frame에서 발생한 action input press는 다음 fixed step까지 latch해 짧은 클릭/키 입력 누락을 막는다.
- Physics counters/API: `PhysicsCounters`가 fixed step 수, kinematic move/hit 수, world solid 후보 검사 수, tile 후보 검사 수를 누적하고, `FrameState.physics`와 DebugOverlay 물리 지표로 노출된다.
- Collision event lifecycle: `CollisionEventTracker`가 current-frame AABB pair의 enter/stay/exit를 추적한다. Shooter gameplay 충돌처럼 충돌 처리 직후 despawn되는 pair는 `hit` event로 기록한다. Wasm 경계는 `CollisionEvent` u32 buffer와 `decodeCollisionEvents(...)`를 사용하며, `FrameState.collisionEventBuffer`는 항상 제공하고 decoded `FrameState.collisionEvents`는 `includeCollisionEvents` opt-in이다.

## 제외 범위

- fixed timestep 기본값 강제 전환
- substep
- shape query
- circle/capsule/polygon collider
- dynamic rigid body, mass, force accumulator
- friction, restitution, impulse solver
- joints/constraints
- entity별 JS/Wasm collision callback
- damage 같은 gameplay payload event

위 항목은 별도 설계와 검증 기준이 생긴 뒤 단계적으로 추가한다.

## 설계 기준

- Rust core가 simulation state와 collision query를 소유한다.
- TypeScript platform layer는 physics simulation state를 소유하지 않는다.
- public Wasm API를 추가할 경우 entity별 JS/Wasm 호출이 아니라 bulk buffer를 사용한다.
- 기존 Top-down Shooter의 layer API는 회귀 방지용 호환 경로로 유지한다.
- full rigid body solver는 Product 1.0 이후 별도 milestone로 판단한다.

## 검증 기준

필수 Rust 테스트:

- 기존 layer pair와 swept layer pair 회귀
- collision filter가 기존 layer pair를 제외할 수 있는지
- custom category mask pair query
- AABB contact normal/penetration
- point/AABB/raycast query
- kinematic move-and-slide stop/slide/trigger ignore
- tilemap candidate range
- tilemap swept AABB contact와 kinematic tile stop
- fixed timestep accumulator clamp/backlog drop
- physics counter 누적
- collision enter/stay/exit/hit lifecycle
- Top-down Shooter fast bullet collision scoring
- TypeScript collision event buffer decode와 public API type export

필수 명령:

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
pnpm build
```

현재 개발 환경에서 `cargo fmt`가 cargo subcommand로 설치되어 있지 않으면 `rustfmt --edition 2021`로 변경된 Rust 파일을 직접 검증한다.
