# Physics v5 Slope Handling Plan

이 문서는 Physics v5 platformer controller의 다음 후보인 slope handling을 구현하기 전 범위와 완료 기준을 고정한다.

## 목표

- `PlatformerControllerConfig` 기반 controller가 낮은 경사면에서 안정적으로 grounded 상태를 유지한다.
- Rust core가 경사면 판정과 이동 보정을 담당하고, TypeScript는 기존 `FerrumEngine.usePlatformerGame()`과 render command buffer 경로를 그대로 사용한다.
- 기존 AABB collider, tile obstacle, one-way platform, moving platform carry, step offset 동작을 깨지 않는다.

## 비범위

- polygon collider, rigid body impulse solver, friction/restitution, joint, arbitrary mesh collision은 포함하지 않는다.
- WebGPU, Worker, editor, multiplayer와 연결하지 않는다.
- full tile slope authoring format은 바로 도입하지 않는다. 먼저 Rust core primitive와 테스트를 고정한 뒤 Game Spec 또는 asset importer 확장을 검토한다.

## 설계 방향

1. Slope는 별도 narrow primitive로 시작한다.
   - 초기 후보는 `SlopeSegment` 또는 tile-local slope descriptor다.
   - AABB body의 bottom center 또는 bottom edge probe로 slope surface height를 계산한다.
   - 기존 `AabbCollider` 자체를 polygon으로 확장하지 않는다.

2. Controller는 opt-in 설정만 사용한다.
   - `PlatformerControllerConfig`에 slope 관련 옵션을 추가하되 기본값은 disabled다.
   - max climb angle, snap distance, downhill snap 허용 여부를 작은 값으로 시작한다.
   - 기존 `move_platformer_controller(...)` 호출자는 설정을 바꾸지 않으면 현재와 같은 결과를 얻어야 한다.

3. 이동 순서는 기존 controller 후처리로 제한한다.
   - 현재 horizontal/gravity velocity 계산과 `move-and-slide`를 유지한다.
   - slope snap은 grounded이거나 하강 중인 경우에만 적용한다.
   - jump 중, one-way platform 통과 중, moving platform carry 중에는 slope snap이 과도하게 개입하지 않도록 한다.

4. Tilemap 확장은 별도 단계로 둔다.
   - 1차 구현은 Rust test fixture에서 slope primitive를 직접 구성한다.
   - 2차에서 Tiled/LDtk custom property 또는 Game Spec tile metadata로 slope descriptor를 연결한다.

## API 후보

```rust
pub struct SlopeConfig {
    pub max_climb_angle_radians: f32,
    pub snap_distance: f32,
}

impl PlatformerControllerConfig {
    pub const fn with_slope_config(mut self, slope_config: SlopeConfig) -> Self;
}
```

이 API는 후보이며, 구현 전 테스트에서 필요한 최소 형태로 조정한다.

## 완료 기준

- 평지와 기존 step offset 테스트가 그대로 통과한다.
- 낮은 오르막에서 controller가 slope surface를 따라 올라간다.
- 낮은 내리막에서 grounded 상태가 프레임 단위로 끊기지 않는다.
- 너무 가파른 slope는 wall처럼 막히거나 기존 move-and-slide 결과를 유지한다.
- tilemap slope authoring은 별도 후속으로 남기더라도 Rust core primitive 테스트는 통과한다.

## 검증

필수:

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml slope
```

Wasm/API 또는 예제 적용 단계가 포함되면 추가:

```bash
PATH="/Users/qoo10/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" pnpm smoke:platformer
PATH="/Users/qoo10/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" pnpm build
```
