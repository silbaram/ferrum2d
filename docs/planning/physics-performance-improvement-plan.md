# 물리엔진 성능 개선 계획

작성일: 2026-06-11

이 문서는 Ferrum2D 물리엔진의 신규 기능 확장이 아니라, 현재 구현된 generic physics runtime의 성능 개선 후보를 정리한다. 실제 개발은 이 문서를 기준으로 별도 task 또는 이슈에서 범위와 검증 기준을 확정한 뒤 진행한다.

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

## 현재 관찰

### 1. `continuous` 옵션이 Rust solver 성능 경로에 연결되지 않음

- 근거:
  - `packages/ferrum-web/src/physicsSpec/defaults.ts`의 `rigid` 기본값은 `continuous: true`다.
  - `packages/ferrum-web/src/engineTypes/frame.ts`의 `PhysicsRigidBodyStepOptions`에는 CCD/continuous 옵션이 없다.
  - `crates/ferrum-core/src/physics/rigid_body.rs`의 `RigidBodyStepConfig`에도 CCD/continuous 옵션이 없다.
  - `crates/ferrum-core/src/physics/rigid_body_step/integration.rs`는 dynamic body 위치 적분 시 CCD 경로를 시도한다.
  - `crates/ferrum-core/src/physics/ccd.rs`의 CCD hit 탐색은 대상 후보로 `world.alive_indices()` 전체를 순회한다.
- 성능 영향:
  - `continuous: false`로 작성된 Physics Spec도 Rust solver에서는 CCD 비용을 피하지 못할 수 있다.
  - 대량 dynamic body 또는 projectile이 있는 장면에서 `ccd body 수 * alive entity 수` 형태로 비용이 커질 수 있다.
- 기대 개선:
  - Physics Spec의 `continuous`가 실제 runtime step option으로 내려가면, arcade/low-cost physics scene에서 CCD 탐색을 건너뛸 수 있다.

### 2. collision pair dedupe가 선형 검색 기반임

- 근거:
  - `crates/ferrum-core/src/collision/broadphase.rs`의 `collect_current_pairs(...)`는 collider pair를 entity pair로 변환한다.
  - `crates/ferrum-core/src/collision.rs`의 `push_unique_pair(...)`는 `pairs.iter().any(...)`로 중복을 제거한다.
- 성능 영향:
  - compound collider, chain collider, dense overlap처럼 한 entity pair에서 여러 collider pair가 나오는 경우 중복 제거가 O(N²)로 커질 수 있다.
- 기대 개선:
  - `CollisionScratch`에 pair key scratch를 추가하고 sort/dedup 또는 stamp 기반 dedupe로 바꾸면 dense collision scene에서 pair 수 증가 비용을 낮출 수 있다.

### 3. position solver가 iteration마다 contact를 다시 빌드함

- 근거:
  - `crates/ferrum-core/src/physics/rigid_body_step.rs`는 velocity constraint 준비 단계에서 contact constraint를 빌드한다.
  - 같은 파일의 position phase는 `position_iterations`마다 `build_rigid_collider_contacts_into(...)`를 다시 호출한다.
  - `packages/ferrum-web/src/physicsSpec/defaults.ts`의 `rigid` 기본 position iteration은 8이다.
- 성능 영향:
  - contact refresh가 안정성에는 도움이 될 수 있지만, dense rigid body scene에서는 broadphase/contact 비용이 position iteration 수에 비례해 증가한다.
- 기대 개선:
  - 먼저 벤치로 비용을 측정하고, 필요하면 contact refresh cadence 조정 또는 manifold 재사용 전략을 검토한다.

### 4. physics debug line 생성이 별도 broadphase/contact pass를 추가함

- 근거:
  - `crates/ferrum-core/src/collision/debug.rs`의 contact debug line 생성은 `build_all_collider_pairs(...)`를 다시 호출한다.
  - broadphase debug line 생성은 proxy bounds Vec를 새로 만든다.
- 성능 영향:
  - 기본 runtime에서는 opt-in이므로 즉시 문제는 아니다.
  - physics sandbox나 개발 모드에서 debug line을 켠 상태로 성능을 판단하면 실제 gameplay 비용보다 크게 보일 수 있다.
- 기대 개선:
  - debug 전용 scratch를 `Engine`에 보관하거나, solver/collision pass 결과를 재사용하는 방향을 검토한다.

### 5. runtime budget이 CCD 비용을 직접 gate하지 않음

- 근거:
  - `packages/ferrum-web/src/runtimeProfiler.ts`는 `physicsCcdChecks`, `physicsCcdHits`, `physicsDebugLineCount`를 sample로 받을 수 있다.
  - `tests/smoke/runtime-budget-profiles.mjs`는 현재 `maxPhysicsFixedSteps`, `maxPhysicsTileCandidateChecks`, `maxCollisionPairCount`까지만 budget field로 관리한다.
- 성능 영향:
  - CCD 탐색 비용이나 debug line 폭증이 frame/Rust update time으로 간접 반영되기 전에는 구조적 회귀를 놓칠 수 있다.
- 기대 개선:
  - `maxPhysicsCcdChecks`, `maxPhysicsDebugLineCount`를 budget에 추가하면 최적화 결과를 CI gate로 유지할 수 있다.

## 권장 작업 순서

### Slice 1. Physics Spec `continuous`를 solver step option에 연결

- 문제:
  - `continuous`가 public spec과 frame state에는 존재하지만 Rust solver step config에는 없다.
- 목표:
  - `continuous: false`인 scene에서 CCD 탐색을 건너뛰게 한다.
- 구현 범위:
  - `RigidBodyStepConfig`에 CCD/continuous boolean 추가.
  - `sanitize_rigid_body_step_config(...)`에 기본값과 validation 반영.
  - Wasm `configure_auto_rigid_body_step(...)`, `step_rigid_bodies_with_config(...)` 인자 확장.
  - TypeScript `PhysicsRigidBodyStepOptions`에 `continuous?: boolean` 추가.
  - `createPhysicsWorldFromSpec(...)`의 `stepOptions`가 `spec.continuous`를 포함하도록 수정.
  - `integrate_rigid_body_positions(...)`에서 continuous가 false면 CCD 통합 경로를 건너뛰게 수정.
- 유지할 public contract:
  - 기존 Physics Spec의 `continuous` 의미를 runtime에 실제 반영한다.
  - 기본 동작은 `rigid` mode에서 기존과 동일하게 continuous true를 유지한다.
- 검증 기준:
  - Rust test: continuous false일 때 `ccd_checks == 0`, continuous true일 때 기존 CCD test 유지.
  - TypeScript test: resolved Physics Spec의 `continuous`가 `stepOptions`에 포함되는지 확인.
  - `pnpm --filter @ferrum2d/ferrum-web test`
  - `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
  - Wasm ABI 변경이 있으므로 `pnpm build`

### Slice 2. collision pair dedupe를 scratch 기반으로 개선

- 문제:
  - `push_unique_pair(...)`가 Vec 선형 검색으로 중복을 제거한다.
- 목표:
  - dense collider 또는 compound collider scene에서 pair dedupe 비용을 낮춘다.
- 구현 범위:
  - `CollisionScratch`에 dedupe용 `Vec<CollisionPairKey>` 또는 정렬 가능한 lightweight key 추가.
  - `collect_current_pairs(...)`에서 entity pair key를 모은 뒤 sort/dedup하고 `CollisionPair`로 변환.
  - collision lifecycle event ordering에 의존하는 테스트가 있는지 확인하고 deterministic ordering 유지.
- 유지할 public contract:
  - collision pair 결과의 의미는 유지한다.
  - enter/stay/exit lifecycle event semantics를 유지한다.
- 검증 기준:
  - `cargo test --manifest-path crates/ferrum-core/Cargo.toml collision`
  - `pnpm smoke:mass-objects`
  - `pnpm smoke:topdown-mass-objects`
  - compound/chain collider 중복 pair fixture 추가 검토.

### Slice 3. CCD 후보 탐색에 broadphase pruning 적용

- 문제:
  - CCD hit 탐색이 moving body마다 전체 alive entity를 순회한다.
- 목표:
  - swept bounds와 collision filter를 이용해 CCD 후보 수를 줄인다.
- 구현 범위:
  - CCD 전용 scratch 또는 기존 `CollisionScratch` 재사용 여부 결정.
  - moving body의 swept AABB와 겹치는 target proxy만 검사.
  - dynamic target의 현재/예상 위치 처리와 기존 CCD wake/repeat semantics 보존.
- 유지할 public contract:
  - fast projectile tunneling 방지 동작을 유지한다.
  - `RigidBodyStepStats.ccd_checks`는 실제 후보 검사 수를 계속 나타낸다.
- 검증 기준:
  - 기존 `physics::tests::rigid_body_ccd::*` 유지.
  - 대량 static target + 소수 fast dynamic body fixture 추가.
  - `pnpm smoke:physics`

### Slice 4. position solver contact rebuild 비용 벤치 후 최적화

- 문제:
  - position iteration마다 contact를 다시 빌드한다.
- 목표:
  - 안정성을 해치지 않는 범위에서 broadphase/contact rebuild 횟수를 줄일 수 있는지 확인한다.
- 구현 범위:
  - 먼저 Rust core bench 또는 deterministic smoke fixture로 stacked boxes, dense contacts, joint chain 비용 측정.
  - 측정 후 contact refresh cadence 조정, manifold 재사용, 또는 현 구조 유지 결정.
- 유지할 public contract:
  - stacking stability, sleep/wake, joint constraint 결과를 유지한다.
- 검증 기준:
  - `pnpm smoke:physics`
  - stacked-boxes, joint-chain scenario hash 비교.
  - 필요 시 rollback 기준: penetration drift 또는 기존 contact solver test 실패.

### Slice 5. runtime budget에 physics-specific metric 추가

- 문제:
  - CCD/debug line 비용이 budget gate에 직접 연결되어 있지 않다.
- 목표:
  - `maxPhysicsCcdChecks`, `maxPhysicsDebugLineCount`를 runtime budget profile에서 검증한다.
- 구현 범위:
  - `RuntimeDiagnosticsBudget`와 profiler snapshot에 max CCD/debug line metric 추가.
  - `tests/smoke/runtime-budget-profiles.mjs`의 budget field 목록과 physics profile에 기준값 추가.
  - `browser-render-smoke.mjs`의 budget 평가 field에 연결.
- 유지할 public contract:
  - 기존 budget profile은 확장만 하고 기존 metric 의미는 유지한다.
- 검증 기준:
  - `pnpm smoke:runtime-budgets`
  - `pnpm smoke:physics-sandbox-budget`

### Slice 6. physics debug line scratch 재사용

- 문제:
  - debug line 생성 시 별도 proxy/contact Vec를 만들 수 있다.
- 목표:
  - debug mode에서만 발생하는 GC/allocation과 Rust Vec churn을 줄인다.
- 구현 범위:
  - `Engine`에 debug collision scratch를 추가하거나 `CollisionSystem` append API에 scratch 인자를 추가.
  - public `build_*_debug_lines(...) -> Vec<_>` convenience API는 유지하되, runtime hot path는 scratch API 사용.
- 유지할 public contract:
  - debug line buffer layout과 WebGL/WebGPU debug render path는 유지한다.
- 검증 기준:
  - `crates/ferrum-core/src/engine/tests/physics_debug_abi.rs`
  - `pnpm smoke:physics-sandbox-budget`

## 권장 우선순위

| 우선순위 | 작업 | 이유 |
| --- | --- | --- |
| P1 | Slice 1. `continuous` step 연결 | 기존 spec 의도가 성능 경로에 반영되지 않는 문제이며, CCD 전체 비용을 직접 줄일 수 있다. |
| P1 | Slice 2. collision pair dedupe 개선 | dense/compound collision에서 O(N²) 위험을 줄인다. |
| P2 | Slice 5. runtime budget metric 추가 | 성능 개선이 회귀하지 않도록 CI gate를 강화한다. |
| P2 | Slice 3. CCD broadphase pruning | 대량 target scene에서 CCD 탐색 비용을 구조적으로 줄인다. |
| P3 | Slice 4. solver contact rebuild 벤치 | 안정성 영향이 있어 측정 후 적용한다. |
| P3 | Slice 6. debug line scratch 재사용 | opt-in debug 경로라 우선순위는 낮지만 sandbox 품질에 도움된다. |

## 리스크

- `RigidBodyStepConfig`와 Wasm exposed method 인자를 변경하면 generated wasm binding, TypeScript wrapper, ABI 검증을 함께 갱신해야 한다.
- CCD pruning은 fast body tunneling 방지 동작을 깨뜨릴 수 있으므로 기존 CCD test를 먼저 고정해야 한다.
- pair dedupe ordering을 바꾸면 collision lifecycle event ordering 또는 replay hash가 바뀔 수 있다. deterministic ordering을 유지하거나 의도한 hash 변경으로 문서화해야 한다.
- position solver contact rebuild 최적화는 stability regression 위험이 있어, 측정 없이 바로 구조 변경하지 않는다.

## 완료 기준

- 성능 변경마다 최소 하나 이상의 구조적 metric이 budget/report에 남는다.
- Rust core 변경은 `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`를 통과한다.
- Wasm/API 변경은 `pnpm build`, `pnpm --filter @ferrum2d/ferrum-web test`, 관련 browser smoke를 통과한다.
- 완료된 항목은 이 planning 문서에서 제거하거나 결정 로그로 축약하고, 확정된 public contract는 `docs/engine` 또는 `docs/development`로 옮긴다.
