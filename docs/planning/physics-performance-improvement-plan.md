# 물리엔진 성능 개선 계획

작성일: 2026-06-11
업데이트: 2026-06-12
상태: Slice 1-6 구현 및 로컬 검증 완료

이 문서는 Ferrum2D 물리엔진의 신규 기능 확장이 아니라, 현재 구현된 generic physics runtime의 성능 개선 후보와 완료된 결정 로그를 정리한다. 확정된 public contract는 `docs/engine`과 `docs/development` 문서로 옮기고, 이 문서는 성능 개선 slice의 근거와 남은 후속 후보를 보존한다.

## 목표

- Rust physics hot path에서 불필요한 CCD 탐색, 중복 broadphase, O(N²) dedupe 비용을 줄인다.
- Physics Spec의 기존 성능 관련 의도가 runtime solver에 실제로 반영되게 한다.
- browser runtime budget과 Rust 단위 검증으로 성능 회귀를 잡을 수 있게 한다.
- Wasm ABI와 public API 변경은 최소화하고, 변경이 필요하면 Rust size/function, TypeScript wrapper, smoke 검증을 같은 작업으로 묶는다.

## 제외 범위

- soft body, cloth, fluid 같은 complex physics core 확장.
- 전체 게임 루프 Worker 이전, Wasm threads, multiplayer rollback.
- visual editor 중심 물리 편집 기능.
- 신규 collider primitive 또는 joint primitive 추가.

## 완료 결과 요약

### 1. `continuous` 옵션 runtime 연결 완료

- 상태:
  - resolved Physics Spec의 `continuous`가 `createPhysicsWorldFromSpec(...)`의 `stepOptions`에 포함된다.
  - `PhysicsRigidBodyStepOptions.continuous`가 TypeScript wrapper와 Wasm exposed method를 거쳐 Rust `RigidBodyStepConfig`로 내려간다.
  - `continuous: false`이면 dynamic body 위치 적분에서 CCD 경로를 건너뛰며 `RigidBodyStepStats.ccd_checks == 0` 회귀 테스트로 고정한다.
- 남은 후속:
  - Slice 3에서 swept bounds 기반 pruning을 적용했다. 다만 CCD 대상 수집은 여전히 `world.alive_indices()`를 순회하므로, 정렬 scratch/proxy 기반 후보 수집은 별도 최적화 후보로 남긴다.

### 2. collision pair dedupe scratch 기반 개선 완료

- 상태:
  - `collect_current_pairs(...)`는 collider pair 후보를 `CollisionScratch.entity_pair_candidates`에 모은 뒤 entity-pair key 기준으로 sort/dedup한다.
  - dedupe 후 `first_order` 기준으로 다시 정렬해 기존 first-hit pair ordering을 유지한다.
  - `PairFilter::All`은 unordered entity pair key로 중복을 제거하고, `PairFilter::Layers`/`PairFilter::Masks`는 방향이 의미 있는 필터 계약을 위해 ordered key를 유지한다.
  - compound collider가 같은 두 entity 사이에서 여러 collider-level 후보와 reversed orientation 후보를 만들 수 있는 fixture를 회귀 테스트로 고정했다.
- 남은 후속:
  - swept layer/mask pair builder는 Shooter projectile 전용 proxy path의 성격이 강하므로 이번 slice에서는 current pair dedupe만 변경했다.

### 3. position solver contact rebuild 계측 완료

- 상태:
  - `RigidBodyStepStats`에 `position_contact_rebuilds`, `position_contact_count_sum`, `max_position_contacts`를 추가했다.
  - Web public stats는 `positionContactRebuilds`, `positionContactCountSum`, `maxPositionContacts`로 같은 값을 노출한다.
  - dense contact fixture와 기존 stale contact regression fixture로 position iteration마다 contact를 다시 빌드하는 현재 solver 구조를 관측 가능하게 만들었다.
- 남은 후속:
  - contact refresh cadence 조정이나 manifold 재사용은 안정성 리스크가 있어 이번 slice에서 적용하지 않았다. 이후에는 새 stats로 실제 병목을 확인한 뒤 별도 설계로 진행한다.

### 4. physics debug line scratch 재사용 완료

- 상태:
  - `CollisionSystem`에 scratch-aware debug line builder를 추가했다.
  - public convenience API는 유지하고, runtime hot path는 `Engine`이 보관하는 debug collision scratch를 재사용한다.
  - debug line buffer layout과 WebGL/WebGPU debug render path는 바꾸지 않았다.
- 남은 후속:
  - solver/collision pass 결과 자체를 debug line 생성에 재사용하는 변경은 더 큰 구조 변경이므로 별도 설계가 필요하다.

### 5. runtime budget physics metric 연결 완료

- 상태:
  - `RuntimeDiagnosticsBudget`와 `RuntimeProfilerSnapshot`에 `maxPhysicsCcdChecks`, `maxPhysicsDebugLineCount`를 추가했다.
  - browser budget smoke와 `tests/smoke/runtime-budget-profiles.mjs`가 CCD check 수와 physics debug line 수를 직접 평가한다.
  - physics sandbox budget profile은 debug line 경로를 위한 별도 상한을 둔다.

## 완료된 작업 순서

### Slice 1. Physics Spec `continuous`를 solver step option에 연결 - 완료

- 문제:
  - `continuous`가 public spec과 frame state에는 존재하지만 Rust solver step config에는 없다.
- 목표:
  - `continuous: false`인 scene에서 CCD 탐색을 건너뛰게 한다.
- 완료 범위:
  - `RigidBodyStepConfig`에 `continuous` boolean을 추가하고 기본값은 기존 동작과 같은 `true`로 유지했다.
  - Wasm `configure_auto_rigid_body_step(...)`, `step_rigid_bodies_with_config(...)` 인자를 확장했다.
  - TypeScript `PhysicsRigidBodyStepOptions`에 `continuous?: boolean`을 추가했다.
  - `createPhysicsWorldFromSpec(...)`의 `stepOptions`가 `spec.continuous`를 포함하도록 수정했다.
  - `integrate_rigid_body_positions(...)`에서 `continuous: false`이면 CCD 통합 경로를 건너뛰게 수정했다.
- 유지할 public contract:
  - 기존 Physics Spec의 `continuous` 의미를 runtime에 실제 반영한다.
  - 기본 동작은 `rigid` mode에서 기존과 동일하게 continuous true를 유지한다.
- 검증:
  - Rust test: continuous false일 때 `ccd_checks == 0`, continuous true일 때 기존 CCD test 유지.
  - TypeScript test: resolved Physics Spec의 `continuous`가 `stepOptions`에 포함되는지 확인.
  - `pnpm --filter @ferrum2d/ferrum-web test`
  - `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
  - Wasm ABI 변경 검증: `pnpm build`

### Slice 2. collision pair dedupe를 scratch 기반으로 개선 - 완료

- 문제:
  - `push_unique_pair(...)`가 Vec 선형 검색으로 중복을 제거한다.
- 목표:
  - dense collider 또는 compound collider scene에서 pair dedupe 비용을 낮춘다.
- 완료 범위:
  - `CollisionScratch`에 정렬 가능한 lightweight entity pair candidate scratch를 추가했다.
  - `collect_current_pairs(...)`에서 entity pair key를 모은 뒤 sort/dedup하고 `CollisionPair`로 변환한다.
  - dedupe 뒤 `first_order` 기준으로 복원해 기존 deterministic ordering과 lifecycle semantics를 유지했다.
- 유지할 public contract:
  - collision pair 결과의 의미는 유지한다.
  - enter/stay/exit lifecycle event semantics를 유지한다.
- 검증:
  - `cargo test --manifest-path crates/ferrum-core/Cargo.toml collision`
  - `pnpm smoke:mass-objects`
  - `pnpm smoke:topdown-mass-objects`
  - compound collider 중복/reversed pair fixture 추가.

### Slice 3. CCD 후보 탐색에 broadphase pruning 적용 - 완료

- 문제:
  - CCD hit 탐색이 moving body마다 전체 alive entity를 순회한다.
- 목표:
  - swept bounds와 collision filter를 이용해 CCD 후보 수를 줄인다.
- 완료 범위:
  - 새 public API나 Wasm buffer layout을 추가하지 않고 Rust CCD narrow 후보 검사 앞에 swept AABB pruning을 적용했다.
  - moving body의 swept AABB와 겹치는 target body만 expensive `swept_shape_contact(...)` 후보로 검사한다.
  - dynamic target의 현재/예상 위치 처리와 기존 CCD wake/repeat semantics를 보존했다.
- 유지할 public contract:
  - fast projectile tunneling 방지 동작을 유지한다.
  - `RigidBodyStepStats.ccd_checks`는 실제 후보 검사 수를 계속 나타낸다.
- 검증:
  - 기존 `physics::tests::rigid_body_ccd::*` 유지.
  - 대량 static target + 소수 fast dynamic body fixture 추가.
  - `pnpm smoke:physics`
- 결과:
  - moving body와 target body의 현재/예상 transform을 포함한 swept AABB가 겹칠 때만 expensive `swept_shape_contact(...)` 후보로 평가한다.
  - `RigidBodyStepStats.ccd_checks`는 broadphase pruning 이후 실제 narrow CCD 후보 검사 수를 유지한다.
  - 이번 slice는 CCD narrow 후보 수를 줄이는 변경이며, alive entity 순회 자체를 정렬 scratch 기반으로 바꾸는 작업은 별도 최적화 후보로 남긴다.

### Slice 4. position solver contact rebuild 비용 벤치 후 최적화 - 완료

- 문제:
  - position iteration마다 contact를 다시 빌드한다.
- 목표:
  - 안정성을 해치지 않는 범위에서 broadphase/contact rebuild 횟수를 줄일 수 있는지 확인한다.
- 완료 범위:
  - `RigidBodyStepStats`에 `position_contact_rebuilds`, `position_contact_count_sum`, `max_position_contacts`를 추가했다.
  - Web public `PhysicsRigidBodyStepStats`에는 `positionContactRebuilds`, `positionContactCountSum`, `maxPositionContacts`로 노출한다.
  - dense contacts fixture가 `position_iterations`만큼 rebuild가 발생하고 contact count sample이 누적되는 것을 고정한다.
  - 기존 `rigid_body_position_phase_rebuilds_contacts_when_reusing_scratch` fixture는 stale contact 재사용이 penetration drift를 만들 수 있음을 계속 검증한다.
  - 측정 결과, 현재 구조에서는 rebuild 횟수가 의도적으로 `position_iterations * substeps`에 비례한다. contact refresh cadence 조정 또는 manifold 재사용은 안정성 리스크가 있어 이번 slice에서 적용하지 않았다.
- 유지할 public contract:
  - stacking stability, sleep/wake, joint constraint 결과를 유지한다.
- 검증:
  - `pnpm smoke:physics`
  - stacked-boxes, joint-chain scenario hash 비교.
  - 필요 시 rollback 기준: penetration drift 또는 기존 contact solver test 실패.

### Slice 5. runtime budget에 physics-specific metric 추가 - 완료

- 문제:
  - CCD/debug line 비용이 budget gate에 직접 연결되어 있지 않다.
- 목표:
  - `maxPhysicsCcdChecks`, `maxPhysicsDebugLineCount`를 runtime budget profile에서 검증한다.
- 완료 범위:
  - `RuntimeDiagnosticsBudget`와 profiler snapshot에 max CCD/debug line metric 추가.
  - `tests/smoke/runtime-budget-profiles.mjs`의 budget field 목록과 physics profile에 기준값 추가.
  - `browser-render-smoke.mjs`의 budget 평가 field에 연결.
- 유지할 public contract:
  - 기존 budget profile은 확장만 하고 기존 metric 의미는 유지한다.
- 검증:
  - `pnpm smoke:runtime-budgets`
  - `pnpm smoke:physics-sandbox-budget`
- 결과:
  - `RuntimeProfiler` snapshot과 browser smoke budget evaluator가 `maxPhysicsCcdChecks`, `maxPhysicsDebugLineCount`를 평가한다.
  - 모든 runtime budget profile에 physics-specific 기준값을 추가했고, physics sandbox profile은 debug line 경로를 위한 별도 상한을 둔다.

### Slice 6. physics debug line scratch 재사용 - 완료

- 문제:
  - debug line 생성 시 별도 proxy/contact Vec를 만들 수 있다.
- 목표:
  - debug mode에서만 발생하는 GC/allocation과 Rust Vec churn을 줄인다.
- 완료 범위:
  - `CollisionSystem`에 scratch-aware debug line builder를 추가했다.
  - public `build_*_debug_lines(...) -> Vec<_>` convenience API는 유지하고 내부에서 temporary scratch를 사용한다.
  - `Engine` runtime hot path는 `physics_debug_collision_scratch`를 보관해 physics debug line 생성 시 broadphase/contact scratch Vec 용량을 재사용한다.
  - 이번 slice는 debug line buffer layout이나 renderer path를 바꾸지 않고, debug 전용 collision scratch 재사용만 적용했다.
- 유지할 public contract:
  - debug line buffer layout과 WebGL/WebGPU debug render path는 유지한다.
- 검증:
  - `crates/ferrum-core/src/engine/tests/physics_debug_abi.rs`
  - `pnpm smoke:physics-sandbox-budget`

## 완료 순서

| 상태 | 작업 | 이유 |
| --- | --- | --- |
| 완료 | Slice 1. `continuous` step 연결 | 기존 spec 의도를 runtime solver 성능 경로에 반영했다. |
| 완료 | Slice 2. collision pair dedupe 개선 | dense/compound collision에서 O(N²) 선형 dedupe 위험을 줄였다. |
| 완료 | Slice 5. runtime budget metric 추가 | CCD/debug line 비용을 CI budget gate에 직접 연결했다. |
| 완료 | Slice 3. CCD broadphase pruning | swept AABB로 CCD narrow 후보 수를 줄였다. |
| 완료 | Slice 4. solver contact rebuild 벤치 | position contact rebuild 비용을 step stats와 dense fixture로 관측 가능하게 만들고 solver 구조 변경은 보류했다. |
| 완료 | Slice 6. debug line scratch 재사용 | opt-in debug 경로의 Rust Vec churn을 줄이고 physics sandbox budget 경로를 안정화했다. |

## 검증된 리스크와 남은 주의점

- `RigidBodyStepConfig`와 Wasm exposed method 인자 변경은 generated wasm binding, TypeScript wrapper, public type, build 검증을 함께 갱신해야 한다. 이번 slice는 이 경로를 함께 수정했다.
- CCD pruning은 fast body tunneling 방지 동작을 깨뜨릴 수 있으므로 기존 CCD test와 physics replay hash를 유지해야 한다.
- pair dedupe는 lifecycle event ordering과 방향성 있는 layer/mask filter 의미를 깨뜨릴 수 있다. 이번 구현은 `All`과 `Layers`/`Masks`의 key 정책을 분리해 회귀 테스트로 고정했다.
- position solver contact rebuild 최적화는 stability regression 위험이 있어, 측정 없이 바로 구조 변경하지 않는다.

## 완료 및 검증 기록

- 성능 변경마다 최소 하나 이상의 구조적 metric이 budget/report에 남는다.
- Rust core 변경은 `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`를 통과한다.
- Wasm/API 변경은 `pnpm build`, `pnpm --filter @ferrum2d/ferrum-web test`, 관련 browser smoke를 통과한다.
- 2026-06-12 로컬 검증:
  - `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check`
  - `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`
  - `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
  - `pnpm format`
  - `pnpm lint`
  - `pnpm test`
  - `pnpm build`
  - `pnpm smoke:physics`
  - `pnpm smoke:mass-objects`
  - `pnpm smoke:topdown-mass-objects`
  - `pnpm smoke:runtime-budgets`
  - `pnpm smoke:physics-sandbox-budget`

## 남은 후속 후보

- CCD 대상 수집은 swept bounds pruning 뒤에도 `world.alive_indices()`를 순회한다. 대량 static target scene에서 병목이 재확인되면 sorted proxy/scratch 기반 후보 수집을 별도 slice로 검토한다.
- position solver의 contact refresh cadence 조정 또는 manifold reuse는 현재 stats와 fixture로 비용을 관측한 뒤 진행한다. penetration drift 리스크가 있으므로 단순 최적화로 바로 적용하지 않는다.
- release/package 준비 단계에서는 이 문서의 로컬 검증과 별도로 `pnpm package:check`, package tarball QA, consumer smoke를 실행한다.
