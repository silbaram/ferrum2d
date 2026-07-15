# Ferrum2D 물리 엔진 개선 개발계획

이 문서는 `crates/ferrum-core/src/physics/**` 검토에서 나온 물리 엔진 개선 후보를 개발 가능한 단위로 재정리한 planning 문서다. 확정된 public contract나 사용법은 아니며, 구현이 끝난 항목은 `docs/engine/physics-spec.md`, `docs/development/architecture/physics-engine.md`, `docs/development/quality/smoke-check.md` 같은 확정 문서로 옮긴다.

## 목적

- 수학적 오류, 성능 병목, 게임 이동 안정성 이슈를 한 번에 구현하지 않고 검증 가능한 slice로 나눈다.
- 확정 버그와 재현이 필요한 가설을 분리해 잘못된 물리 수정이 들어가지 않게 한다.
- Ferrum2D의 Rust core / TypeScript platform 경계를 유지하면서, physics authoring과 browser smoke까지 회귀 검증한다.
- complex physics, multiplayer/rollback, Wasm threads, 전체 physics 병렬화처럼 별도 승인 대상인 기능을 일반 리팩토링과 섞지 않는다.

## 현재 판정

기존 리뷰 내용은 개선 후보 목록으로는 유용하지만, 모든 항목을 확정 버그로 볼 수는 없다. 특히 Baumgarte bias 부호 변경, pulley slack, moving platform 회전 상속, KCC jump step-up, slope tangent projection은 현재 게임감/제품 계약에 따라 의도 동작일 수 있으므로 회귀 fixture 또는 별도 제품 결정을 먼저 둔다.

| 분류 | 의미 | 예시 |
| --- | --- | --- |
| 확정 개선 후보 | 코드 구조상 한계가 확인됐고, 테스트를 붙여 안전하게 진행 가능 | gear angle wrap, off-center joint anchor 부재, contact cache linear lookup |
| 재현 필요 | 가능성은 있으나 버그로 단정하면 위험 | Baumgarte 접근 중 bias, one-way apex stuck, HD2D bridge high-speed sampling, KCC skin jitter |
| 제품 결정 필요 | 물리적으로 가능하지만 현재 public 계약이 정의되지 않음 | continuous revolute limit, pulley slack, moving platform rotation carry |
| 별도 승인 필요 | 현재 roadmap 금지/주의 범위와 맞닿음 | parallel solver, fluid, wheel/vehicle, deterministic rollback physics |

## 설계 원칙

- Rust core가 물리 상태, 충돌, 조인트, solver를 소유한다.
- TypeScript는 Physics Spec authoring, validation, Wasm loading, browser smoke만 담당하고 frame loop 물리 상태를 소유하지 않는다.
- hot path에서 entity별 JS/Wasm 왕복 호출을 추가하지 않는다.
- solver, KCC, contact cache 변경은 per-frame allocation을 늘리지 않고 scratch buffer 재사용을 우선한다.
- public API나 Physics Spec schema가 바뀌면 기존 authoring 문서와 샘플을 같이 갱신한다.
- 게임감이 바뀌는 KCC 변경은 기본값 보존 또는 명시 config migration을 먼저 설계한다.

## 개발 순서 요약

| Slice | 상태 | 목표 | 핵심 산출물 |
| --- | --- | --- | --- |
| Slice 0 | 완료 | 리뷰 보정 및 회귀 fixture 확보 | 잘못 단정한 항목 재분류, 실패/성공 fixture |
| Slice 1 | 완료 | API 보존 correctness cleanup | gear wrap, damping 식, contact cache key lookup |
| Slice 2 | 완료 | solver/KCC 성능 기반 정리 | sleep/wake early-out, KCC candidate broadphase, budget smoke |
| Slice 3 | 완료 | joint rotational coupling 개선 | local anchors, effective mass angular term, spring soft denominator, weld coupled position solve |
| Slice 4 | 완료 | platformer/KCC 안정성 정책 확정 | 기본 KCC 정책 확정, HD2D 고속 bridge traversal 보강 |
| Slice 5 | 완료 | 제품 기능 결정 | pulley slack, revolute continuous limit, moving platform rotation carry 완료 |
| 후속 A | 활성 후보 | solver hot path 정리 | coupled weld fallback의 constraint context 중복 생성 제거 |
| 후속 B | 검토 후보 | 수치 안전성 보강 | singular 3x3 mass matrix 입력 방어와 회귀 fixture |
| 후속 C | 측정 후보 | despawn 비용 경계 확인 | 고차수 joint graph 일괄 파괴 runtime budget profiling |
| Deferred | 보류 | 별도 승인 기능 | parallel solver, fluid, wheel, deterministic rollback |

## Slice 0. 리뷰 보정 및 재현 기반 확보

### 목표

개발 전에 “실제 버그”와 “가설”을 분리한다. 이 slice에서는 production solver 동작을 크게 바꾸지 않고, 테스트와 문서 정합성을 먼저 만든다.

### 작업

- `Baumgarte` sign convention 회귀 테스트를 추가한다.
  - 접근 중 겹침, 정지 중 겹침, 멀어지는 중 겹침을 분리한다.
  - 현재 normal impulse 식과 bias 식이 어떤 조건에서 push-out을 담당하는지 명시한다.
  - 부호를 뒤집는 수정은 이 테스트가 실패를 증명하기 전까지 하지 않는다.
- `CCD` impact path에서 `delta_seconds = 1.0`이 실제 penetration bias에 영향을 주는지 fixture로 확인한다.
  - 현재 CCD contact constraint는 penetration을 `0.0`으로 생성하므로, 문서상 “Baumgarte 약화” 주장은 검증 후 확정한다.
- KCC/HD2D 재현 fixture를 추가한다.
  - one-way platform apex 전환 중 stuck 여부
  - HD2D bridge 고속 이동 sampling 누락 여부
  - ground probe 접지 flicker 여부
  - slope snap 속도 정책
  - jump 상승 중 step offset 정책
- 낮은 우선순위 항목을 정리한다.
  - `sanitize_non_negative`는 동작 버그가 아니라 naming/readability cleanup으로 낮춘다.
  - `ground_probe` 내적 조건은 dead-code 가능성이 높지만, KCC sweep 정책 변경과 분리한다.

### 완료 기준

- 관련 Rust unit test가 의도한 현재 동작 또는 실패 동작을 명시한다.
- `pnpm test:rust`가 통과한다.
- fixture가 browser example을 건드리면 `pnpm smoke:physics` 또는 관련 browser smoke를 추가로 실행한다.

### 진행 로그

- 2026-06-17: Baumgarte approaching-overlap sign convention, CCD zero-penetration impact의 Baumgarte config 독립성, one-way platform partial-overlap pass-through fixture를 추가했다.
- 2026-06-17: HD2D bridge fixed-sample pass-through 한계, ground probe 접지 안정성, slope snap 수평 속도 보존 정책, jump 중 step offset 비적용 fixture를 추가했다.
- 남은 Slice 0 fixture: 없음. 다음은 Slice 1의 API 보존 correctness cleanup으로 진행한다.

## Slice 1. API 보존 correctness cleanup

### 목표

public API와 Physics Spec schema를 흔들지 않는 범위에서 확정성이 높은 수학/자료구조 개선을 먼저 처리한다.

### 작업

- Gear joint angle error를 주기성에 맞게 normalize한다.
  - 대상: `crates/ferrum-core/src/physics/joints/gear_joint.rs`
  - 기대: `pi` 경계 근처에서 오차가 급격히 튀지 않는다.
  - 테스트: wrap 경계 전후의 error/impulse가 연속적으로 유지되는 unit test.
- rigid body damping과 particle damping의 dt 의존성을 줄인다.
  - 대상: `crates/ferrum-core/src/physics/rigid_body_step/integration.rs`, `crates/ferrum-core/src/particles.rs`
  - 후보식: `exp(-d * dt)` 또는 `1 / (1 + d * dt)`
  - 선택 기준: 기존 값에 가까운 migration, 큰 `dt`에서 역방향 속도 반전 없음.
- contact impulse cache lookup을 key 기반으로 바꾼다.
  - 대상: `crates/ferrum-core/src/physics/solver/contact_cache.rs`, 관련 `World` contact impulse storage
  - 기대: previous contact count가 증가해도 warm-start lookup이 선형 중첩으로 커지지 않는다.
  - 제약: frame hot path allocation을 늘리지 않고 scratch/storage 재사용을 우선한다.
- CCD impact `delta_seconds` 전달은 Slice 0 fixture 결과에 따라 결정한다.
  - 실제 bias 영향이 확인되면 solver 호출부에 실제 substep `delta_seconds`를 전달한다.
  - 영향이 없으면 문서에서 low-priority cleanup으로 유지한다.

### 완료 기준

- `cargo fmt`
- `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets`
- `pnpm test:rust`
- `pnpm smoke:physics`
- Physics Spec이나 public API 문서 변경이 없음을 확인한다. 변경이 발생하면 `docs/engine/physics-spec.md`를 갱신한다.

### 진행 로그

- 2026-06-17: Gear joint angle error와 break angle 판정에 `normalize_angle_radians`를 적용하고, wrap 경계에서 joint가 과도하게 끊기지 않는 회귀 테스트를 추가했다.
- 2026-06-17: rigid body linear/angular damping과 particle damping을 `exp(-d * dt)` 기반 감쇠식으로 바꾸고, substep 안정성과 큰 dt에서 속도가 즉시 0으로 떨어지지 않는 회귀 테스트를 추가했다.
- 2026-06-17: contact impulse warm-start lookup을 per-step scratch의 entity pair key index 기반으로 바꾸고, 기존 `World` contact impulse export API는 유지했다.
- CCD impact `delta_seconds` 전달은 Slice 0 fixture상 zero-penetration CCD contact의 Baumgarte bias에 영향이 없어 production 변경 없이 low-priority cleanup으로 남긴다.
- 남은 Slice 1 작업: 없음. 다음은 Slice 2의 solver/KCC 성능 기반 정리로 진행한다.

## Slice 2. Solver/KCC 성능 기반 정리

### 목표

물리 품질을 바꾸기 전에 중복 계산과 후보 검색 구조를 줄인다. 성능 개선은 반드시 budget/smoke로 확인한다.

### 작업

- rigid body substep 안의 manifold 구축을 재사용한다.
  - 대상: `crates/ferrum-core/src/physics/rigid_body_step.rs`, `crates/ferrum-core/src/physics/sleep.rs`, `crates/ferrum-core/src/physics/solver/constraints.rs`
  - 방향: `RigidBodyStepScratch`에 substep contact/manifold buffer를 두고 wake, constraint build, sleep island pass가 같은 데이터를 읽게 한다.
  - 주의: position solve iteration에서 필요한 contact rebuild와 sleep island용 graph 데이터를 같은 lifetime으로 묶어 stale contact를 만들지 않는다.
- KCC sweep 후보군을 broadphase/candidate provider로 줄인다.
  - 대상: `platformer_controller/kinematic_sweep.rs`, `step_offset.rs`, tilemap/entity collision candidate 경로
  - 방향: 전체 `world.alive_indices()` 순회 전에 AABB query 후보를 좁힌다.
  - 주의: 후보 필터는 Rust core 내부에 두고 TypeScript frame callback을 추가하지 않는다.
- step offset early-out을 추가한다.
  - 작은 턱 후보가 없는 경우 4회 `move_and_slide_internal` 호출로 들어가지 않도록 경량 probe를 먼저 둔다.
- runtime budget metric과 smoke를 연결한다.
  - physics/collision candidate count가 profiler sample에 이미 연결돼 있는지 확인하고, 없다면 metric을 추가한다.

### 성능 요구사항

- hot path에서 새 `Vec` allocation을 반복하지 않는다. scratch buffer를 clear/reuse한다.
- collision candidate, contact pair, CCD check metric이 증가하지 않는다.
- Top-down mass object와 physics sandbox budget smoke에서 frame/Rust update budget을 악화시키지 않는다.
- 최적화 전후 비교는 최소한 동일 smoke에서 report artifact 또는 test output으로 남긴다.

### 완료 기준

- `pnpm test:rust`
- `pnpm smoke:physics`
- `pnpm smoke:mass-objects`
- 변경 표면이 browser physics demo에 닿으면 `pnpm smoke:physics-sandbox-budget`
- runtime budget field를 추가했다면 `pnpm smoke:runtime-budgets`

### 진행 로그

- 2026-06-17: KCC step offset에서 첫 이동의 blocking entity가 `step_offset`보다 높은 AABB 장애물임을 확인할 수 있으면 보조 `move_and_slide_internal` 호출을 생략하도록 early-out을 추가했다. 타일맵/불명확한 hit는 기존 경로를 유지한다.
- 2026-06-17: tall blocking entity 회귀 테스트를 추가해 `PhysicsCounters.kinematic_moves`가 step offset 보조 이동 없이 1회로 유지되는지 확인한다.
- 2026-06-17: KCC sweep에 `CollisionScratch` 기반 entity candidate provider를 연결해 swept AABB와 겹치는 AABB collider만 narrowphase에 넘기도록 했다. step offset/slope snap/HD2D 경로는 같은 scratch를 재사용한다.
- 2026-06-17: 멀리 떨어진 64개 entity가 있어도 `solid_candidate_checks`가 실제 swept 후보 1개로 유지되는 카운터 회귀 테스트를 추가했다.
- 2026-06-17: rigid body sleep/wake pass에서 sleeping body나 wake source가 없거나, sleep timer 갱신 후 ready 후보가 없으면 sleep island graph와 contact manifold rebuild를 건너뛰도록 했다.
- 2026-06-17: 겹친 collider가 있어도 sleep/wake 후보가 없으면 `RigidBodySleepScratch.manifolds`가 채워지지 않는 내부 회귀 테스트를 추가했다.
- 2026-06-17: `solid_candidate_checks`를 `DebugOverlayMetrics`, `RuntimeProfiler` sample/snapshot, browser smoke budget field, runtime budget profile에 연결해 KCC entity candidate 비용도 budget gate가 검증하도록 했다.
- 2026-06-17: `pnpm test:rust`, `pnpm smoke:physics`, `pnpm smoke:mass-objects`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget`, `pnpm smoke:runtime-budgets`, `pnpm validate:runtime-budget-product`로 Slice 2 성능/검증 경로를 확인했다.
- Slice 2 완료. 다음 물리 개선은 Slice 3 joint rotational coupling 설계부터 별도 작업 단위로 진행한다.

## Slice 3. Joint rotational coupling 개선

### 목표

center-to-center 근사로 제한된 joint를 실제 rigid body joint에 가깝게 보강한다. 이 slice는 public API와 Physics Spec에 영향을 줄 수 있으므로 호환성 설계를 먼저 확정한다.

### 작업

- Distance/Spring/Rope joint에 local anchor를 도입한다.
  - 대상: `distance_joint.rs`, `spring_joint.rs`, `rope_joint.rs`, joint component type, Physics Spec joint resolver
  - 기본값: 기존 동작을 보존하기 위해 local anchor 기본값은 body center로 둔다.
  - solver: `K = mA^-1 + mB^-1 + IA^-1 * (rA x n)^2 + IB^-1 * (rB x n)^2` 유효 질량을 사용한다.
  - impulse: anchor point impulse가 angular velocity에 반영되도록 contact-point impulse helper를 재사용하거나 joint 전용 helper를 둔다.
- Spring joint를 iteration count에 덜 의존하는 soft constraint로 조정한다. (완료)
  - frequency/damping-ratio 기반 설계를 검토하되, 기존 stiffness/damping public field migration을 먼저 정의한다.
  - 이번 slice에서는 새 public field를 추가하지 않고, 기존 0..1 `stiffness`를 velocity solve의 soft denominator로 해석한다.
- Weld joint anchor position correction에 angular coupling을 반영한다. (완료)
  - 현재 angular position correction은 별도로 존재하므로 “각도 보정 없음”이 아니라 “anchor gap correction과 angular response coupling 부족”으로 다룬다.
  - off-center welded body fixture로 jitter/수렴성을 검증한다.

### 호환성 요구사항

- 기존 Physics Spec joint JSON은 그대로 resolve되어야 한다.
- 새 anchor field를 추가하면 optional field로 추가하고 default를 명시한다.
- Wasm ABI/public TypeScript facade가 바뀌면 `docs/engine/public-api.md`와 `docs/engine/physics-spec.md`를 갱신한다.
- 기존 physics replay hash가 바뀌면 의도한 물리 변경으로 리뷰하고 fixture를 갱신한다.

### 완료 기준

- off-center distance/spring/rope/weld fixture unit test
- `pnpm test:rust`
- `pnpm validate:physics-authoring`
- `pnpm smoke:physics`
- `pnpm smoke:physics-replay`
- `pnpm smoke:physics-demo-suite`

### 진행 로그

- 2026-06-17: Distance/Rope/Spring joint component와 Wasm/TypeScript `spawnPhysicsJoint(...)` facade에 optional local anchor를 추가했다. 기본값은 body center(`0, 0`)로 유지한다.
- 2026-06-17: Distance/Rope/Spring solver가 anchor point distance/velocity를 사용하고, `mA^-1 + mB^-1 + IA^-1 * (rA x n)^2 + IB^-1 * (rB x n)^2` 기반 denominator로 angular coupling을 반영하도록 했다.
- 2026-06-17: off-center Distance/Rope/Spring damping fixture와 Physics Spec/vehicle authoring local anchor 전달 테스트를 추가했다.
- 2026-06-17: Weld joint anchor position correction을 anchor x/y와 relative angle을 함께 푸는 coupled position solve로 바꾸고, off-center anchor 회전 fixture와 angular-only regression fixture를 추가했다.
- 2026-06-17: Spring velocity solve가 partial stiffness일 때 denominator를 soft하게 해석하도록 바꾸고, spring+damping 결합 fixture를 추가했다. `frequencyHz`/`dampingRatio` public migration은 별도 API 설계 전까지 보류한다.
- 2026-06-17: Slice 3 완료 기준인 Rust unit, physics authoring validation, physics smoke/replay, physics demo browser smoke matrix를 실행했다.
- 남은 Slice 3 작업: 없음.

## Slice 4. Platformer/KCC 안정성 정책 확정

### 목표

KCC는 물리적으로 “정답” 하나보다 게임감과 예제 호환성이 중요하다. 따라서 기본 정책을 먼저 정하고, compatibility를 깨는 변경은 config opt-in 또는 fixture 기반으로 진행한다.

### 정책 결정

| 항목 | 기본 정책 | 근거 | 후속 조건 |
| --- | --- | --- | --- |
| Skin/shell margin | 기본 controller에 새 skin/shell margin을 추가하지 않는다. `ground_probe_distance`와 기존 sweep epsilon 계약을 유지한다. | 좁은 통로 통과, platformer example 이동감, existing KCC fixture 호환성을 우선한다. | ground/falling flicker가 재현되는 fixture가 생기면 opt-in config로 설계하고 narrow-passage 회귀와 browser smoke를 함께 추가한다. |
| One-way platform history | per-sweep stateless 판정을 기본으로 유지한다. 이전 프레임 pass-through state를 public runtime state로 노출하지 않는다. | 현재 fixture가 위에서 착지, 아래/측면 통과, 부분 겹침 통과를 고정한다. | apex 전환 stuck이 재현될 때만 Rust controller 내부 state 또는 grace window를 검토한다. |
| Step offset during jump | jump가 발생한 frame에는 step offset을 적용하지 않는다. | `platformer_controller_jump_does_not_apply_step_offset`가 상승 중 step-up 차단을 고정한다. | 상승 중 step-up을 허용하려면 opt-in config와 ceiling/corner snap 회귀 fixture를 먼저 추가한다. |
| Slope movement | slope snap은 현재처럼 수평 속도를 보존하고 vertical snap을 더하는 arcade platformer 정책을 기본으로 둔다. | `platformer_controller_slope_snap_preserves_horizontal_velocity_policy`가 현 정책을 고정한다. | tangent projection은 기본값 변경이 아니라 별도 config 후보로만 검토한다. |
| HD2D bridge pass-through | fixed sample 대신 swept segment/tile traversal로 bridge 후보를 찾는다. | `hd2d_controller_detects_high_speed_bridge_pass_through_with_tile_traversal`가 고속 통과를 고정한다. | `pnpm smoke:topdown-hd2d`로 Top-down HD-2D browser 계약을 유지한다. |

### 작업

- KCC skin/shell margin 정책을 설계한다.
  - 대상: `ground_probe.rs`, `kinematic_sweep.rs`, `solid_filter.rs`
  - 목표: ground/falling 판정 flicker를 줄이되, 좁은 통로 통과와 platformer example 이동감을 깨지 않는다.
- one-way platform 통과 이력 상태를 검토한다.
  - apex 전환 중 stuck이 재현될 때만 이전 프레임 상태 또는 pass-through grace를 추가한다.
  - KCC state를 public runtime state로 노출하지 않고 Rust controller 내부 상태로 관리하는 방향을 우선한다.
- step offset jump 상승 정책을 결정한다.
  - 상승 중 step-up을 허용할지, 의도적으로 차단할지 example fixture와 UX 기준으로 결정한다.
  - 허용 시 ceiling collision과 corner snap 회귀 테스트를 추가한다.
- slope movement 정책을 결정한다.
  - 현재 vertical snap은 arcade platformer에 유리할 수 있으므로, tangent projection을 기본값으로 바꿀지 config로 둘지 결정한다.
- HD2D bridge pass-through를 high-speed movement에 맞게 보강한다.
  - 고정 5-sample 대신 swept segment/tile traversal 기반 후보를 검토한다.
  - Top-down HD2D smoke의 bridge portal navigation을 유지한다.

### 완료 기준

- `pnpm test:rust`
- `pnpm smoke:platformer`
- `pnpm smoke:platformer-budget`
- `pnpm smoke:topdown-hd2d`
- KCC public behavior가 바뀌면 `docs/engine/physics-spec.md`와 관련 smoke 문서를 갱신한다.

### 진행 로그

- 2026-06-17: Slice 4의 기본 KCC 정책을 확정했다. 기본값은 skin/shell margin 추가 없음, one-way stateless 판정 유지, jump 중 step offset 차단, slope snap 수평 속도 보존이다.
- 2026-06-17: HD2D bridge pass-through를 fixed sample에서 swept segment/tile traversal 기반 후보 검색으로 바꾸고, 고속 이동 fixture를 pass 기대값으로 갱신했다.
- 2026-06-17: Slice 4 완료 기준인 Rust unit, platformer browser smoke/budget, Top-down HD-2D browser smoke를 실행했다.
- 남은 Slice 4 작업: 없음.

## Slice 5. 제품 기능 결정 대상

이 항목들은 코드상 개선 후보지만, 바로 버그 수정으로 처리하면 제품 계약을 잘못 확정할 수 있다. 각 항목은 별도 설계 문서 또는 issue로 승격한 뒤 진행한다.

| 항목 | 결정해야 할 내용 | 기본 입장 |
| --- | --- | --- |
| Revolute continuous limit | `[-pi, pi]` normalized limit 외에 multi-turn 누적각을 public contract로 제공할지 | 완료: 기존 normalized limit 유지, `continuousLimit`/`limit.continuous` 옵션 추가 |
| Pulley slack | 현재 equality pulley를 rope slack inequality로 바꿀지, 별도 rope/pulley variant로 둘지 | 완료: 기존 equality 유지, `slack` 옵션 추가 |
| Moving platform rotation carry | displacement carry 외에 angular carry를 KCC가 상속할지 | 완료: 기존 displacement carry 유지, `carry_moving_platform_with_rotation_carry(...)` opt-in 추가 |
| Wheel joint | vehicle/suspension을 core physics에 넣을지 example helper로 둘지 | 별도 승인 필요 |

### 진행 로그

- 2026-06-17: Pulley slack은 기본 pulley 계약을 바꾸지 않고 optional `slack` boolean으로 확정했다. `slack: true`이면 weighted length가 `restLength` 이하일 때 correction/break 판정을 건너뛰고, 초과했을 때만 taut pulley처럼 당긴다.
- 2026-06-17: Rust `PulleyJoint`, Wasm `spawn_physics_pulley_joint(...)`, Web `spawnPhysicsJoint(...)`, Physics Spec resolver, authoring helper, snapshot/hash/public docs를 갱신했다.
- 2026-06-17: Revolute continuous limit은 기본 normalized limit 계약을 유지하고 optional `continuousLimit`/`limit.continuous`를 추가하는 방향으로 확정했다. Rust solver는 기존 `relative_angle` 경로를 보존하고 opt-in일 때만 누적 `continuous_relative_angle`으로 limit/motor 방향을 판정한다.
- 2026-06-17: Moving platform rotation carry는 기본 displacement carry 계약을 유지하고 `PhysicsSystem::carry_moving_platform_with_rotation_carry(...)`와 `MovingPlatformRotationCarryConfig` opt-in으로 확정했다. rider 시작 위치를 platform rotation origin/delta로 회전시켜 생기는 delta를 기존 displacement에 더한 뒤 기존 `move_and_slide` 충돌 처리를 재사용한다.
- 남은 Slice 5 작업: 없음. Wheel joint는 full vehicle/wheel system과 연결되므로 Deferred의 별도 승인 대상으로 유지한다.

## Deferred. 별도 승인 필요

다음 항목은 현재 planning 문서에 후보로만 남긴다. 별도 승인 없이 production 코드로 구현하지 않는다.

- parallel island solver
  - Wasm/browser thread 제약, 새 dependency, determinism, profiling 체계가 먼저 필요하다.
- fluid/buoyancy system
  - complex physics 범위에 가까우므로 Physics Spec authoring과 예제 요구가 확정된 뒤 검토한다.
- deterministic rollback physics
  - multiplayer/rollback 범위와 연결되므로 현재 제품 범위 밖이다.
- full vehicle/wheel system
  - wheel joint 단독보다 gameplay/example 요구를 먼저 확정한다.

## 검증 매트릭스

| 변경 표면 | 필수 검증 | 추가 검증 |
| --- | --- | --- |
| Rust physics solver | `cargo fmt`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets`, `pnpm test:rust`, `pnpm smoke:physics` | `pnpm smoke:physics-replay` |
| Physics Spec/API | `pnpm validate:physics-authoring`, `pnpm validate:public-api-surface`, `pnpm build` | `pnpm package:check:ferrum-web` |
| KCC/platformer | `pnpm test:rust`, `pnpm smoke:platformer` | `pnpm smoke:platformer-budget`, `pnpm smoke:topdown-hd2d` |
| Browser physics demo | `pnpm smoke:physics-sandbox`, `pnpm smoke:physics-demo-suite` | `pnpm smoke:physics-sandbox-budget` |
| 성능 hot path | `pnpm smoke:runtime-budgets`, 관련 budget smoke | before/after artifact 비교 |
| 문서-only 변경 | `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact` | 없음 |

## Definition of Done

각 slice는 다음 조건을 만족해야 완료로 본다.

- 실패를 설명하는 regression test 또는 smoke fixture가 먼저 존재한다.
- 구현은 Rust core 내부에서 끝나며, TypeScript frame loop에 물리 시뮬레이션 상태를 새로 만들지 않는다.
- public API, Physics Spec, smoke contract가 바뀌면 문서가 같은 PR/커밋에서 갱신된다.
- 성능 개선은 실행한 명령과 전후 관측값을 리뷰에 남긴다.
- 완료된 항목은 이 planning 문서에서 제거하거나 완료 로그로 축약하고, 운영 계약은 확정 문서로 이동한다.

## 완료된 우선순위 기록

Slice 0~5는 다음 순서로 진행했다.

1. Slice 0에서 기존 리뷰의 과도한 단정을 테스트 기준으로 보정했다.
2. Slice 1에서 API를 흔들지 않는 correctness cleanup을 처리했다.
3. Slice 2에서 solver/KCC 성능 기반을 정리했다.
4. Slice 3은 public API/Physics Spec migration을 포함한 별도 작업 단위로 진행했다.
5. Slice 4와 Slice 5에서 example gameplay와 제품 계약을 결정했다.

현재 물리 개선 planning의 Slice 0-5는 완료 상태다. 다음 일반 개선 후보는 아래 solver 중복 연산, singular matrix 방어, 고차수 despawn profiling이며, 각각 재현 fixture와 성능 기준을 별도 task에서 확정한다. Deferred 항목은 명시적 승인 없이는 착수하지 않는다.

## 후속 개선 후보 (2026-06-17 추가, 2026-07-14 갱신)

Slice 0-5 완료 이후 코드 심층 리뷰에서 추가로 확인된 개선 및 보완 계획이다.

### 1. 엔티티 디스폰(Despawn) 시 조인트 리소스 누수 방지 — 완료 (2026-07-14)
- **문제**: joint가 참조하는 엔티티가 디스폰되어도 저장소 항목과 handle generation이 유지되어, joint count와 solver 순회 대상에 남을 수 있었음.
- **조치**: `World::despawn`이 유효한 엔티티를 제거하기 전에 distance, rope, spring, pulley, revolute, prismatic, weld, gear joint를 정리한다. generation-aware per-entity incident joint count로 연결 여부를 O(1)에 판정하고, 연결된 경우에만 8종 저장소를 순회해 joint 제거, generation 증가, free-list 반환을 함께 수행한다. free-list capacity는 slot 생성과 snapshot restore 시 storage high-watermark까지 확보한다. public Rust joint mutation은 checked `try_add_*`/`try_set_*`에서 current endpoint를 검증하며 invalid endpoint를 저장하지 않는다.
- **회귀 기준**: 8종 joint 제거, 관계없는 joint 유지, setter endpoint 이동, snapshot restore의 incident index 재구축, free-list clear capacity, 재사용 handle의 generation 변경, 재사용 entity generation에 이전 joint가 승계되지 않는 동작과 future/stale endpoint add/set 거부를 world lifecycle 테스트로 고정한다.
- **성능 경계**: active joint가 다른 entity에 존재하더라도 projectile처럼 연결 joint가 없는 entity의 대량 despawn은 incident count gate만 확인한다. 한 entity에 실제로 연결된 joint를 제거할 때는 8종 저장소 high-watermark를 한 번 순회하므로 대규모 연결 구조의 일괄 파괴는 별도 runtime budget profiling 후보로 유지한다.

### 2. Coupled Solver의 Fallback 시 중복 연산 최적화
- **문제**: Weld Joint의 Coupled Solver 실패 시 Fallback으로 개별 linear/angular 보정 솔버가 실행되는데, 이때 내부적으로 `prismatic_joint_constraint_context`가 최대 3회 중복으로 재생성되어 핫패스 성능 저하 유발.
- **방향**: 컨텍스트를 상위 호출부에서 한 번만 생성하고, 각 솔버 함수는 참조(Borrow) 형태로 주입받아 사용하도록 리팩토링.

### 3. 수치적 특이성(Singular Matrix) 안전성 보강
- **문제**: 3x3 질량 행렬 솔버에서 무한 관성 등 극단적 입력값 연산 시 Determinant의 f32 오버플로우/언더플로우 위험 존재.
- **방향**: solver 진입 전 `inverse_inertia` 및 질량 성분의 Clamping/정규화 방어 로직 검토.

### 4. 고차수 조인트 그래프 Despawn Profiling

- **문제**: joint가 없는 entity despawn은 incident count로 O(1) gate되지만, 실제 연결 joint가 있는 entity는 8종 저장소 high-watermark를 순회한다.
- **방향**: 대규모 연결 구조 일괄 파괴 fixture에서 before/after runtime budget을 먼저 측정하고, 병목이 확인될 때만 per-kind incident index 또는 저장소 구조 변경을 별도 설계한다.
