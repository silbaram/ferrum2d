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
| Slice 0 | 대기 | 리뷰 보정 및 회귀 fixture 확보 | 잘못 단정한 항목 재분류, 실패/성공 fixture |
| Slice 1 | 대기 | API 보존 correctness cleanup | gear wrap, damping 식, contact cache key lookup |
| Slice 2 | 대기 | solver/KCC 성능 기반 정리 | manifold reuse, KCC candidate broadphase, budget smoke |
| Slice 3 | 대기 | joint rotational coupling 개선 | local anchors, effective mass angular term, weld coupling |
| Slice 4 | 대기 | platformer/KCC 안정성 정책 확정 | skin, one-way history, slope/step/HD2D behavior |
| Slice 5 | 보류 | 제품 기능 결정 | revolute continuous limit, pulley slack, rotating platform carry |
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

## Slice 3. Joint rotational coupling 개선

### 목표

center-to-center 근사로 제한된 joint를 실제 rigid body joint에 가깝게 보강한다. 이 slice는 public API와 Physics Spec에 영향을 줄 수 있으므로 호환성 설계를 먼저 확정한다.

### 작업

- Distance/Spring/Rope joint에 local anchor를 도입한다.
  - 대상: `distance_joint.rs`, `spring_joint.rs`, `rope_joint.rs`, joint component type, Physics Spec joint resolver
  - 기본값: 기존 동작을 보존하기 위해 local anchor 기본값은 body center로 둔다.
  - solver: `K = mA^-1 + mB^-1 + IA^-1 * (rA x n)^2 + IB^-1 * (rB x n)^2` 유효 질량을 사용한다.
  - impulse: anchor point impulse가 angular velocity에 반영되도록 contact-point impulse helper를 재사용하거나 joint 전용 helper를 둔다.
- Spring joint를 iteration count에 덜 의존하는 soft constraint로 조정한다.
  - frequency/damping-ratio 기반 설계를 검토하되, 기존 stiffness/damping public field migration을 먼저 정의한다.
- Weld joint anchor position correction에 angular coupling을 반영한다.
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

## Slice 4. Platformer/KCC 안정성 정책 확정

### 목표

KCC는 물리적으로 “정답” 하나보다 게임감과 예제 호환성이 중요하다. 따라서 기본 정책을 먼저 정하고, compatibility를 깨는 변경은 config opt-in 또는 fixture 기반으로 진행한다.

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

## Slice 5. 제품 기능 결정 대상

이 항목들은 코드상 개선 후보지만, 바로 버그 수정으로 처리하면 제품 계약을 잘못 확정할 수 있다. 각 항목은 별도 설계 문서 또는 issue로 승격한 뒤 진행한다.

| 항목 | 결정해야 할 내용 | 기본 입장 |
| --- | --- | --- |
| Revolute continuous limit | `[-pi, pi]` normalized limit 외에 multi-turn 누적각을 public contract로 제공할지 | optional feature로 설계 |
| Pulley slack | 현재 equality pulley를 rope slack inequality로 바꿀지, 별도 rope/pulley variant로 둘지 | 기존 equality 유지, slack은 새 옵션 |
| Moving platform rotation carry | displacement carry 외에 angular carry를 KCC가 상속할지 | opt-in config 우선 |
| Wheel joint | vehicle/suspension을 core physics에 넣을지 example helper로 둘지 | 별도 승인 필요 |

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

## 우선순위 결정

추천 진행 순서는 다음과 같다.

1. Slice 0으로 기존 리뷰의 과도한 단정을 테스트 기준으로 보정한다.
2. Slice 1에서 API를 흔들지 않는 correctness cleanup을 처리한다.
3. Slice 2로 solver/KCC 성능 기반을 정리한다.
4. Slice 3은 public API/Physics Spec migration을 포함해 별도 작업 단위로 진행한다.
5. Slice 4와 Slice 5는 example gameplay와 제품 계약 결정 후 진행한다.

현재 바로 개발 착수하기 좋은 첫 작업은 **Slice 0의 Baumgarte/CCD/KCC fixture 추가**다. 이 작업은 물리 동작을 바꾸지 않고, 이후 수정이 실제 버그를 고치는지 확인하는 안전망을 만든다.
