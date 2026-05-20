# Ferrum2D Physics v2 범위

이 문서는 post-MVP 물리 고도화의 완료 범위를 고정한다. 목표는 범용 rigid body 엔진이 아니라 Top-down Shooter와 Ferrum2D Rust core에 맞는 2D AABB 물리 계층을 안정화하는 것이다.

2D 물리엔진에서 일반적으로 다루는 전체 기능 목록과 Ferrum2D 단계별 후보는 [2D 물리엔진 기능 맵](physics-engine.md)을 기준으로 한다.

## 완료 범위

- `AabbBounds`: `Transform2D`와 `AabbCollider`에서 world-space AABB를 계산한다.
- Sweep-and-prune broadphase: x축 min bound로 정렬한 뒤 가능한 pair만 좁혀 current-frame collision pair를 만든다.
- Layer pair query: `CollisionSystem::build_layer_pairs(...)`가 요청한 collision layer 순서로 pair를 반환한다.
- Swept AABB time-of-impact: 빠른 이동체가 한 프레임 사이에 target AABB를 통과하는지 계산한다.
- Swept layer pair query: `CollisionSystem::build_swept_layer_pairs(...)`가 이동 경로를 포함한 AABB로 후보를 좁히고 precise swept overlap을 확인한다.
- Top-down Shooter bullet/enemy 충돌은 swept layer pair query를 사용해 빠른 총알의 터널링을 방지한다.
- Player/enemy game-over 충돌은 layer pair query를 사용한다.

## 제외 범위

- rigid body mass, force accumulator, torque, angular velocity
- friction, restitution, impulse solver
- joints/constraints
- circle/polygon collider
- dynamic-dynamic solid push-out
- continuous collision response와 sliding
- navmesh, crowd simulation
- external physics dependency 통합

위 항목은 별도 설계와 milestone 합의 없이 구현하지 않는다.

## Rust/Wasm 경계

Physics v2는 Rust core 내부 변경이다. Wasm ABI, render command ABI, TypeScript platform layer API는 바꾸지 않는다. TypeScript는 여전히 입력, asset/audio, renderer, debug UI만 담당하고 simulation collision state를 소유하지 않는다.

## 검증 기준

필수 Rust 테스트:

- overlap AABB pair
- layer pair orientation
- swept AABB fast pass-through
- swept bullet/enemy layer pair
- Top-down Shooter fast bullet collision scoring

필수 명령:

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm build
```

브라우저 수동 smoke에서는 빠른 총알 발사 시 명중 누락이 없는지 함께 확인한다.

## 실행 예제

Physics v2의 public API는 `crates/ferrum-core/examples`에서 작은 Cargo example로 확인할 수 있다.

```bash
cargo run --manifest-path crates/ferrum-core/Cargo.toml --example aabb_bounds
cargo run --manifest-path crates/ferrum-core/Cargo.toml --example layer_pairs
cargo run --manifest-path crates/ferrum-core/Cargo.toml --example swept_aabb
```

- `aabb_bounds`: `Transform2D`와 `AabbCollider`에서 world-space AABB를 만들고 overlap을 확인한다.
- `layer_pairs`: `World`에 player/enemy를 배치한 뒤 layer pair query가 요청한 순서로 pair를 반환하는지 보여준다.
- `swept_aabb`: 빠른 bullet이 한 프레임 사이 enemy를 통과해도 swept query로 명중을 잡는 흐름을 보여준다.
