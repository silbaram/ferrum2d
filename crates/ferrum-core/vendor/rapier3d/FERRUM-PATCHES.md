# Ferrum2D의 Rapier3D 수정

원본은 crates.io `rapier3d 0.36.1`이다. `UPSTREAM.json`은 원본 archive SHA-256,
소스별 hash, 라이선스 출처를 기록한다. `LICENSE`는 Apache-2.0 원문이다.
이 디렉터리의 Rust 소스는 상류 코드이며 아래 수정만 Ferrum2D에서 적용한다.

- 두 3D 마찰 모델은 고정면을 정면으로 향하는 네 접촉점의 법선 충격량을 함께 풀 수 있다.
  네 점의 유효질량, 속도 편향, 연성 계수와 기존 충격량이 같고 회전 효과가 두 쌍에서 정확히
  상쇄될 때 적용한다. 이 경우 같은 크기의 법선 충격량이 네 점에 분배되며 기존 마찰 풀이와
  충격량 누적 및 기록에 그대로 전달된다. 구현은 아래 세 접촉 제약 파일에 있다.

- `src/dynamics/solver/contact_constraint/contact_constraint_element.rs`:
  두 3D 접선 마찰 solver가 공유하는 2×2 풀이를 추가한다. 평면 축 잠금으로 rank가 1이 된 경우
  Moore–Penrose pseudoinverse로 허용된 접선 방향만 풀고, rank 0은 impulse 0을 반환한다.
  행렬을 최대 대각 원소로 정규화하고 determinant를 상대 오차로 검사해 단위·질량 배율의 영향을 줄인다.
  full-rank 행렬은 기존의 coupled inverse 풀이를 유지한다.

- `src/geometry/contact_correction.rs`(추가), `src/geometry/mod.rs`,
  `src/geometry/contact_pair.rs`, `src/pipeline/physics_hooks.rs`,
  `src/geometry/narrow_phase/pair_update.rs`:
  manifold별 접촉 보정 응답을 hook에서 전달한다. contact anchor/거리나 SolverContact의 SIMD
  layout을 바꾸지 않는다. hook 제거 뒤 과거 응답을 재사용하지 않도록 full update에서 초기화한다.
- `src/dynamics/solver/contact_constraint/contact_with_coulomb_friction.rs`,
  `src/dynamics/solver/contact_constraint/contact_with_twist_friction.rs`,
  `src/dynamics/solver/contact_constraint/generic_contact_constraint.rs`:
  explicit response가 있는 경우 속도 편향과 위치 보정을 독립적으로 계산한다.
  위치 적분 전에는 둘을 적용하고 relaxation에서는 split 설정에 따라 속도 편향만 유지한다.
  지정하지 않은 contact는 상류 bias/softness를 유지한다. 실제 Ferrum2D runtime 검증은
  두 rigid-body 마찰 모델의 공간/평면 contact를 대상으로 하며 multibody API는 노출하지 않는다.

- `src/dynamics/integration_parameters.rs`,
  `src/dynamics/solver/staged_island_solver/init.rs`,
  `src/dynamics/solver/staged_island_solver/helpers.rs`,
  `src/dynamics/solver/staged_island_solver/worker.rs`와 위 contact constraint 세 파일:
  전역 restitution velocity threshold를 contact 생성 단계에 전달한다. restitution을 곱하기 전의
  접촉점 접근 속도(각속도 포함)가 threshold보다 클 때만 bounce seed를 만든다. 기본 threshold 0은
  기존 동작을 보존하며 hook이나 추가 충돌 query를 필요로 하지 않는다.

상류 원본 324개 중 23개 파일을 수정하고 Rust 파일 1개를 추가했다. 이전 마찰 수정만 있을 때의
검증은 `artifacts/physics-3d/contact-policy-qa`에 보존하며, 접촉 보정 이후 검증은
`artifacts/physics-3d/contact-correction-qa`에서 구분한다. 전역 설정 이후 최신 검증은
`artifacts/physics-3d/solver-settings-qa`에 기록한다.

상류 업그레이드 시 `UPSTREAM.json` 대비 diff를 확인하고 Ferrum2D의 실제 평면/공간
마찰·컨베이어·축 잠금 회귀와 이 소스의 `tangent_mass_tests`를 실행한다.
수정된 라이브러리 배포에는 이 파일과 Apache-2.0 고지를 포함해야 한다.

- `src/geometry/contact_pair.rs`와 contact constraint 세 파일, `contact_constraint_element.rs`:
  solver 생성 시점의 접촉점·접근 속도(각속도 포함)를 transient report에 보존한다. writeback에서
  실제 적용한 normal/friction impulse 누계와 world-space 방향을 기록한다. `solved` observation은
  serde에서 제외하며 warm-start 입력과 solver 계산식은 변경하지 않는다. Simplified 모델의 공유
  마찰 row는 보고할 때만 solver point 수로 나눠 중복 합산을 막는다. 기존 per-point
  `tangent_impulse`도 누계로 채운다. twist friction의 별도 각충격량은 이 선형 충격 보고에 포함하지 않는다.
  보고 geometry 필드로 인해 ContactData와 normal constraint의 메모리가 증가하며 최종 밀집 장면
  성능·메모리 수용 검증이 필요하다. 검증은 `artifacts/physics-3d/contact-impulse-qa`에 기록한다.

- `src/dynamics/ccd/ccd_solver.rs`, `src/dynamics/ccd/sweeps.rs`,
  `src/dynamics/solver/staged_island_solver/worker.rs`, `src/pipeline/physics_pipeline/substep.rs`,
  `src/dynamics/ccd/mod.rs`, `src/dynamics/mod.rs`:
  평면 축 잠금과 실제 Z축 회전이 확인되는 단일 박스 동적 바디는 post-solve CCD 활성화 시
  COM 기준 XY 회전 반경으로 재판정한다. 준비된 CCD 계획과 native writeback에 같은 판정을 적용한다.

- `src/dynamics/ccd/ccd_solver.rs`, `src/dynamics/ccd/sweeps.rs`,
  `src/dynamics/ccd/mod.rs`, `src/dynamics/mod.rs`:
  CCD가 실제 수행한 collider-pair cast와 실제 body pose clamp를 별도로 센다. time-slice 예측 검사와
  solve 후 검사를 구분하고, sweep가 이미 계산한 fraction·world-space point/normal과 collider identity를
  제한된 transient 버퍼로 제공한다. proxy/composite 경로와 nonlinear fallback의 기존 fraction 선택 및
  motion clamp 계산은 유지한다. 통계를 위해 별도 geometry query를 실행하지 않는다.
  `CCDSolver.reset_diagnostics`는 adapter가 각 backend step 전에 호출한다. 기본 detailed report limit는
  0이며 Ferrum2D는 WorldConfig.max_events를 설정한다. 진단은 serde state에 포함하지 않는다.
  수정 검증은 `artifacts/physics-3d/statistics-qa`에 기록한다. CCD callback/diagnostics는 물리 impulse를
  뜻하지 않는다. retained witness와 per-body result 저장 비용은 최종 성능 검증 대상이다.


## 지정된 kinematic 선형 운동 보존

`src/dynamics/solver/solver_body.rs`의 기존 flag byte에 kinematic 종류를 보존하고,
`src/dynamics/solver/staged_island_solver/worker.rs`의 선형 속도 상한에서 해당 종류를 제외한다.
상류는 velocity-kinematic의 지정 속도까지 매 substep 400 × length_unit으로 줄이고,
position-kinematic은 목표 위치를 유지하면서 보고 속도만 줄여 둘이 불일치했다.
Ferrum2D는 두 kinematic 종류의 지정 선형 운동을 보존한다. dynamic/soft-frame의 기존 선형 상한,
각속도 상한, 접촉/관절 풀이와 렌더 ABI는 변경하지 않는다. `integration_parameters.rs`의 설명도 이를 명시한다.

직접 native 두 모드·두 kinematic 종류의 두 tick 위치/속도와 dynamic 상한 보존,
실제 Data Scene 고속 투사체의 연속 tick·수동 tick·충돌 지점 정지를 회귀 검증한다.
이는 이동 대상과의 상대 운동 sweep이나 고속 kinematic 접촉 비용 수용을 완료했다는 의미가 아니다.

## 실제 solver 적분 경로 관측

`pipeline/event_handler.rs`에 기본 비활성인 rigid-body motion callback과 owned COM pose record를 추가하고
`pipeline/mod.rs`에서 내보낸다. `physics_pipeline/substep.rs`는 각 CCD 시간 구간의 시작을 알린다.
`physics_pipeline/solve.rs`, `staged_island_solver/init.rs`·`mod.rs`가 observer를 전달하고,
`worker.rs`는 실제 속도 제한·위치 적분 전후의 COM pose와 구간 시간을 전달한다. 각 적분의 회전을
별도로 보관하므로 같은 자세로 돌아온 여러 회전을 한 번의 최단 회전으로 압축하지 않는다.

observer 활성 시에만 재사용 eligibility mask를 구성한다. multibody link·soft-frame·soft particle은
이 callback 대상에서 제외한다. 기존 worker가 소유한 pose를 복사하며 추가 unsafe 접근이나 concurrent
RigidBodySet 읽기를 도입하지 않는다. callback은 parallel 빌드에서 동시에 실행될 수 있다.
Ferrum2D의 수집기는 Mutex 안의 재사용 Vec에 기록하며, 기록 유무로 solver 계산식·적분·속도 제한을 바꾸지 않는다.

`ccd_solver.rs`는 기존 clamp를 적용한 뒤 실제 시작/제한된 COM pose와 fraction을 observer에 전달한다.
bounded CCD 진단 버퍼와 독립적이므로 진단이 넘쳐도 게임 판정에 필요한 경로는 누락되지 않는다.
adapter는 해당 CCD 시간 구간의 solver overshoot를 폐기하고 승인된 sweep 구간과 이후 정지를 사용한다.
같은 body의 반복 clamp는 fraction을 곱하고 마지막 pose를 보존한다. 기존 CCD 자체의 판정·clamp 계산은 유지한다.

이 관측은 transient callback으로 전달하며 native backend state나 Wasm render ABI에 필드를 추가하지 않는다.
position-kinematic의 정확한 target writeback은 adapter에서 지정된 pass별 pose 보간으로 처리한다.
적분 interval 내부의 연속 경로는 두 pose의 보간이며 새로운 연속시간 적분법이 아니다. 고밀도 기록/정렬/BVH 비용,
고속 회전에서 native CCD 자체의 정확성, snapshot/replay와 최종 제품 검증은 별도 수용이 필요하다.
회귀와 vendor 검증은 `artifacts/physics-3d/solver-motion-qa`에 기록한다.

## 캡슐 이동 종료 오차의 단위 정합

`control/character_controller.rs`의 이동 벡터 정규화 종료값을 고정 `1e-5` 월드 단위에서
설정된 capsule clearance의 `1e-5` 배로 변경했다. 기존 값은 60 Hz에서 속도 `0.0003`의
유효 입력을 매 틱 버려 경로 추종을 장애물 정지로 판정하게 했다. offset은 기존 설정을
사용하며 별도 API·serde 필드는 추가하지 않는다. 최대 20회 반복 상한은 유지한다.
Ferrum2D의 접지 이동용 swept clearance도 0이 아닌 작은 입력에 동일하게 적용한다.
작은 속도·벽 정지·경사/단차 및 기존 캐릭터 회귀를 함께 검증한다. f32 위치 정밀도보다
작은 이동까지 표현된다는 뜻은 아니다.

## Native checkpoint의 solver 운동 관측

`pipeline/event_handler.rs`의 Ferrum 전용 `SolverBodyMotion`에 `serde-serialize` feature 조건부
Serialize/Deserialize를 추가했다. callback은 여전히 transient이며 backend world에 새 저장 필드를 넣지 않는다.
adapter가 이미 보관한 실제 구간별 motion을 native checkpoint에 포함해 복원 직후 projectile 상대 운동
query를 유지하기 위한 변경이다. Serde가 꺼진 빌드의 타입과 callback 동작은 유지한다.
CCDSolver workspace/진단은 상류처럼 직렬화하지 않으며 adapter가 보관한 완료 step 통계와 clamp 결과를
저장한다. 복원 시 diagnostic limit를 다시 설정한다. 전체 Engine/Data Scene 저장은 별도 연결이 필요하다.

`tests/snapshot_portability.rs`의 기준 snapshot도 Ferrum의 접촉 보정/settings 저장 layout에 맞춘다.
동일 dependency lock의 수정 없는 상류는 원래 기준값 488,334 bytes를 통과했으며, Ferrum 소스는
x86_64와 실제 wasm32-wasip1 실행에서 동일한 513,230 bytes/FNV-1a digest를 생성하는 것을 확인한 뒤
기준값을 갱신했다. 상류 기준을 삭제하거나 임의 불일치를 허용하지 않는다. 이 검사는 native backend
bincode layout의 target parity이며 Ferrum opaque Postcard checkpoint의 공개 파일 호환성 보장은 아니다.

## Native arena 복원 불변식

`src/data/arena.rs`의 `Arena<T>` 역직렬화는 원소 수와 free-list 전체 연결을 검사한다.
점유 슬롯 수 불일치, 누락·순환·범위 밖·점유 슬롯을 가리키는 free-list, 성장할 수 없는 0-slot 상태를
거부한다. 저장 slot 수에 비례하는 검사이며 별도 scratch 할당은 없다. 저장된 세대·빈 슬롯 순서와 기존
Serde 필드 순서를 유지하고, Serde 비활성 빌드와 매 step 삽입/삭제 경로는 바꾸지 않는다.
이는 entry 내부 payload, 세대 번호 소진, arena 간 참조, BVH/형상/동적 행렬의 검증을 대신하지 않는다.
`src/data/arena/serde_tests.rs`에서 bincode/JSON 손상 거절과 기존 wire 왕복·재삽입 순서를 검사하며,
Ferrum cold Postcard reader를 통과하는 회귀도 별도로 둔다. 외부 파일 importer는 아직 제공하지 않는다.

## Parry dependency의 고정 소스

`Cargo.toml`의 기존 Parry3D 0.31.1 의존성을 동일 버전의 `../parry3d`에 연결했다.
BVH와 geometry storage의 private 불변식을 Deserialize 경계에서 검증하기 위한 변경이다.
해당 원본·수정·라이선스 기록은 `../parry3d/UPSTREAM.json`과 `FERRUM-PATCHES.md`에 둔다.

## 저장 backend 간 참조의 cold 검증 기반

`src/geometry/stored_references.rs`와 broadphase·narrowphase·impulse-joint의 private validation
module에서 읽기 전용 `validate_stored_references(&PhysicsWorld, StoredReferenceLimits)`를 제공한다.
공개 게임 엔진 API와 Wasm ABI에는 연결하지 않는 `doc(hidden)` vendor 경계다. 입력 arena free-list와
Parry BVH·shape의 Deserialize 구조 검사를 선행 조건으로 하며, 저장된 데이터를 재생성하거나 수정하지 않는다.

`src/data/graph/validation.rs`는 양방향 adjacency의 범위, 소유 endpoint, prev/next 역참조,
전체 도달 여부를 반복 순회로 검사한다. self-loop와 parallel edge를 허용하며 adjacency 링크 순환·도달 불가 edge를
거부한다. `coarena.rs`와 `solver_contact_graph.rs`의 crate-private borrowed accessor는 저장 slot을
복사하거나 public 필드로 노출하지 않는다. broadphase pair↔양쪽 adjacency, collider slot↔BVH leaf,
narrowphase pair↔broadphase pair, graph node↔generation별 Coarena index,
ContactPair endpoint, body↔collider, impulse-joint arena↔graph를 상호 대조한다.
유효 solver graph의 ContactRef↔GraphPos, 동일 active-set epoch의 body index,
색상 mask와 force-event list의 역참조도 검사한다.

정상적인 지연 상태는 보존한다. 정확한 old generation이 removed_colliders에 있는 경우 제거 전
broadphase/narrowphase 참조를 허용하며, 같은 raw slot에 새 collider가 생긴 경우도 구분한다.
prev_updated_leaves 최적화 history, 수면 접촉의 사용되지 않는 solver ID, 명시적으로 무효화된
solver graph의 예전 위치, reparent/type 변경 직후 cache, 제거 뒤 남은 미사용 color mask bit와
joint wake/join queue의 예전 body generation은 소비 경로의 실제 조건에 따라 허용한다.
무효화된 force-event list도 pair 제거 때 사용하는 자체 list↔position 역참조는 검사한다.

방문 한도는 live 개수만이 아니라 raw arena·Coarena·graph slot, 저장 참조와 scratch 초기화를
선행 청구한다. 그래프 edge 상한을 body 수로 추측하지 않는다. scratch Vec의 실제 요청 길이를
검사한 뒤 try_reserve_exact를 사용하고 typed error를 반환한다. 비교 정렬은 허용된 scratch 길이에
제한되지만, max_work는 CPU 명령 수 또는 decoder heap/RSS 상한이라는 뜻은 아니다.

집중 회귀는 실제 backend의 각 참조를 손상시킨 거절과 정상 삭제·재사용·수면·기상·접촉 전환을
함께 둔다. validator 호출 전후 bincode bytes, pair 순서, sensor 필터 ray 결과와 다음 step replay가
보존됨을 확인한다. Serde 저장 필드와 순서는 변경하지 않는다. core의 build fingerprint는 vendor
소스 변경을 포함하므로 서로 다른 build의 checkpoint envelope가 같다는 주장은 하지 않는다.

이 기반은 전체 numerical payload, multibody/soft topology, persistent-island/event 구조,
모든 allocator 실패·RSS, Engine/Data Scene 파일 API, SDK binding 또는 전역 native default의
완료를 뜻하지 않는다. core의 snapshot validator 연결도 별도 통합 작업이다. 개발·검증 근거와
정확한 patch/SHA manifest는 `artifacts/physics-3d/goal-closure/native-cross-arena`에 둔다.

### 통합 전 저장 참조 리뷰 보완

`narrow_phase/validation.rs`는 ContactPair의 color/mask와 실제 solver bucket의 소유권을 별도로
검사한다. 유효한 0..127 bucket의 manifold는 pair의 color와도 일치해야 하며, 실제 manifold가
가리키는 동적 body는 같은 bucket에서 한 번만 소유할 수 있다. 기존 pair-mask scratch를 읽기
대조한 뒤 방문 예산을 선청구하여 0으로 재사용한다. 저장된 mask/history는 수정하지 않으며
추가 scratch 할당이나 정렬은 도입하지 않는다. overflow(128)와 generic(129)은 solver의 별도
regroup 경로가 있으므로 이 중복 금지를 적용하지 않는다. 정상 2개 이상 manifold와 shared
multibody generic 사례를 회귀로 유지한다. 비동적 쪽의 공유와 TYPE 변경 직후 history도 구별한다.
TYPE 예외는 정확한 body handle이 modified_bodies에 있어 실제 user-change 처리에서 pair를
recolor하는 경우만 허용하며, queue 검색 비용도 선행 청구한다.

NarrowPhase graph_indices의 비활성 MAX-generation slot은 producer의 초기화/삭제 값인
end/end여야 한다. unknown-generation query가 generation 검사 없이 payload를 읽기 때문에 다른
정상 node를 가리키는 alias도 거절한다. 정확한 MAX-generation handle이 현재 collider 또는
removed_colliders에 있으면 활성 참조 검사를 수행하며 일률적으로 end/end를 요구하지 않는다.
이는 ImpulseJoint Coarena의 비활성 default 값에 적용하는 규칙이 아니다.

수정 전 실제 bucket 이동과 inactive node alias가 기존 검증을 통과하는 negative control을 먼저
재현했다. bucket 이동은 nonzero hint의 실제 process_pair에서 OUTCOME_RECYCLED를 반환해 위치를
유지했고, inactive alias는 contact/intersection unknown-generation 조회를 오염시켰다. 수정 후
동일 손상을 typed error로 거절하는 회귀와 정상 상태의 byte/replay 보존을 함께 검사한다.
세대 MAX의 live/pending 참조 fixture는 세대 소진·Arena::remove overflow의 numerical 보장을
뜻하지 않는다. 통합 전 리뷰 결과는 `artifacts/physics-3d/goal-closure/native-cross-arena/review`에 둔다.

## 저장 rigid body/collider 수치의 별도 cold 검증 후보

`src/dynamics/stored_body_numerics.rs`와 테스트를 추가하고 `dynamics/mod.rs`에서 숨김 vendor API
`validate_stored_body_numerics(&RigidBodySet, &ColliderSet, StoredBodyNumericLimits)`로 내보낸다.
기존 cross-arena 검증에 암묵적으로 추가하지 않으며 core snapshot/외부 파일 API/Wasm ABI에는
연결하지 않는다. 지원은 현재 Ferrum의 3D/f32 일반 rigid-body/collider이며 soft-frame/deformable
identity는 지원 범위 밖으로 거절한다. 새 production dependency는 없다.

현재/다음/이전/local pose의 finite translation과 unit quaternion, 실제 velocity/CCD velocity,
force/torque/gravity, damping, local/additional/effective mass·inertia, CCD·activation scalar,
collider local/world pose와 mass/material/event threshold를 의미별로 검사한다. 원본 quaternion
입력은 Ferrum valid_pose의 squared-norm 1e-5 오차를 따르고, 두 유효 입력이 합성된 world pose와
body local mass frame은 rounding history를 보존하도록 3e-5를 허용한다. quaternion을 정규화하거나
현재/예약 pose, local/effective mass, lock/type/cache를 같은 값으로 고치지 않는다.

0 mass/inertia, rank-deficient 잠금 tensor와 signed off-diagonal을 허용한다. symmetric effective
inertia는 f64로 scale 정규화한 principal minor를 64*f32::EPSILON 오차 안에서 검사하며 고유값 계산이나
shape.mass_properties를 호출하지 않는다. 추가 per-body solver/PGS 횟수는 trusted caller가 주는
독립 상한으로 검사한다. signed force/COM/gravity와 negative never-sleep threshold는 허용하고,
friction/restitution은 finite 비음수로 구분한다. restitution>1은 상류의 superelastic 계약을 보존한다.
순수 event 비교 threshold에는 양의 무한대를 허용한다. Ferrum 작성 API의 더 좁은 크기 상한은
core 정책으로 남기며 이 vendor 경계가 그 검사를 대신한다고 주장하지 않는다.

validator는 할당하지 않는다. raw arena의 빈 슬롯과 고정 크기 record의 작업 단위를 모두 시작 전에
checked arithmetic으로 청구한다. shape·attached-list·graph·동적 행렬을 순회하거나 숫자 크기에 비례하는
반복을 실행하지 않는다. max_work는 명시한 slot/record 작업 단위로 CPU 입력 크기를 제한하며,
실제 CPU instruction·벽시계·decoder heap/RSS 상한을 뜻하지 않는다.

회귀는 실제 저장 payload의 body/collider 원소별 NaN·무한대·부호·비단위 회전·indefinite tensor 손상을
거절하고, 정상 pending·sleep/disable·0 inertia/axis lock·kinematic·재질 threshold와 저장 bytes/pair 순서 및
다음 step replay를 보존함을 함께 확인한다. 유한한 MAX force로 실제 step에서 overflow가 발생한 뒤
quarantine report에 포함되어 disabled/유한 pose·velocity가 된 본체도 검증·저장·재실행한다. 이는 모든
비활성 overflow cache 이력의 완료 증명이 아니다. helper는 비정상 primary payload를 disabled라는 이유만으로
면제하지 않으며 비정상 derived cache의 모든 안전한 수용 정책은 후속 감사가 필요하다.

모든 수치/shape/global solver/joint/manifold/island/soft topology, 이후 산술 overflow·solver 안정성,
generation 소진·실제 allocator/RSS·전체 파일/SDK/epoch는 완료 범위 밖이다. 전필드 정책표, baseline SHA,
회귀와 정확한 patch는 `artifacts/physics-3d/goal-closure/native-body-numeric`에 둔다.

## Persistent island 저장 참조와 pending joint edit 보존

`island_manager/persistent/validation.rs`와 테스트에 별도 read-only `validate_stored_islands` 경계를
추가한다. 모든 active/sleep chunk 및 persistent body/index의 역참조, free id의 범위·중복·occupied 충돌,
contact/joint link의 location 상호 참조와 현재/지연 joint edit generation을 검사한다. current/sleep/fixed/
disabled/pending body 상태를 producer 조건으로 구분하고 정상 연결 cycle과 scheduling history를 보존한다.
raw slot/list/hash iteration, local scratch 초기화·정렬/검색을 먼저 청구하고 fallible reserve를 사용한다.
원본 데이터를 정렬하거나 bootstrap/rebuild로 고치지 않는다. helper는 Ferrum public API/Wasm ABI에
연결하지 않는 숨김 vendor 경계이며 Core 호출·지원 범위 정책은 별도다.

`impulse_joint_set.rs`의 island_events/modified_joints/all_joints_modified는 기존 Serde skip에서 실제 저장
필드로 변경했다. 첫 step 후 joint를 생성하고 저장할 때 bootstrapped=true인 이전 island cache는 남고
pending Link만 사라져 다음 step의 persistent island가 달라지는 결함을 재현했기 때문이다. modified queue와
flag도 다음 flush에서 event를 만들기 때문에 함께 순서/중복/값을 보존한다. assembly/selection epoch은
직렬화되지 않는 solver workspace 재사용용으로 유지한다. crate-private borrowed accessor는 modified
상태와 raw joint slot 수만 읽으며 필드를 consumer public API로 노출하지 않는다. bootstrapped를 false로
강제하거나 queue/history를 지워 복원 결과를 맞추지 않는다.

이 변경은 실제 persistent wire format 변경이다. 기존 bincode golden 513,230 bytes /
0x6ac634d1d5d42c9a는 before artifact에 보존하고, 세 개의 empty edit 필드가 추가된 새 golden
513,247 bytes / 0xe7e849ba178f3a1a를 native와 실제 wasm32-wasip1에서 대조했다. private Ferrum
checkpoint의 format version과 이전 버전 거절은 Core 통합에서 함께 변경해야 한다. 다른 codec의
전체 envelope에 일률적으로 +17 bytes가 늘어난다고 주장하지 않는다.

수정 전 sleeping index 손상이 기존 검사를 통과하고 remove의 swap_remove panic에 이르는 것과,
pending joint event 누락의 실제 wire/continuation 차이를 먼저 재현했다. 수정 후 정상 create/rewire/
remove/reuse·modified flag·sleep/wake/type 상태에서 즉시 bytes 및 live 원본 대비 여러 step을 비교한다.
이 기반은 complete component/contact eligibility, scheduling counter의 u32 합/랩 arithmetic,
multibody/soft link topology, actual allocator/RSS 또는 전체 외부 파일/SDK/epoch 검증의 완료가 아니다.
계약 ledger·소스 SHA·명령과 patch는 `artifacts/physics-3d/goal-closure/native-island-admission`에 둔다.


## 저장 rigid contact 수치·인덱스 admission 기반

`geometry/narrow_phase/stored_numerics.rs`와 집중 테스트를 추가하고 geometry의 숨김 vendor API
`validate_stored_contact_numerics(&PhysicsWorld, StoredContactNumericLimits)`로 내보낸다.
검사는 readonly/무할당이며 plain manifolds와 solver clusters를 모두 방문한다. 각 저장
pair/manifold/point/solver record와 ready-graph slot은 순회 전에 별도 작업 한도로 charge한다.
작업 단위는 CPU 명령 수·allocator/RSS 추정이 아니다.

접촉 local point/dist, signed warm-start/impulse/tangent와 frozen solver arms, local/world normal,
유한 비음수 friction/restitution, correction의 0/1 flags와 유한 비음수 rate/speed/slop,
subshape pose와 recycling reference pose/rotation/extent/drift를 의미별 검사한다. Superelastic
restitution>1, signed impulse·distance·tangent, inactive empty manifold와 pending/sleep 이력은 보존한다.
정상 NEW bit31은 그대로 두고 masked CID만 `points.len()` 및255 미만인지 검사한다. CID255는
SIMD writeback padding sentinel이며 정상 cluster producer는 최대255 points/CID254를 유지한다.
Ferrum producer의 solver contacts는 최대4개다. Soft pair는 이 rigid-only guard에서 거절한다.

Normal의 squared-norm error1e-3은 compound/relative/world 변환을 고려한 cold admission 정책이다.
Subshape input quaternion은1e-5, cached world rotation은3e-5, 두 world rotation의 product인
recycling relative pose는1e-4 squared-norm error를 허용한다. 값을 normalize/재생성하지 않는다.
실제 producer에 input error 약9e-6인 body/collider/compound rotation을 함께 적용해 clustering
on/off·sleep/recycling·codec 후 원본6step continuation을 검사한다. 별도7종 shape producer도 검사한다.

Ready-graph empty-list 검사는 graph valid와 실제 active-set/multibody epoch가 모두 맞는 경우에만
적용한다. 범용 workspace의 shape/feature 의미, 전체 reference/topology, arbitrary 훅 producer,
세대/epoch 소진과 유한 입력의 후속 arithmetic overflow·실제 할당량 상한은 이 기반의 완료 주장이 아니다.
Serde-skipped solver observations와 저장된 unused SIMD padding도 physical payload와 구분한다.
Wire 필드와 solver/hot path는 바꾸지 않는다. Field policy와 검증 기록은
`artifacts/physics-3d/goal-closure/native-contact-admission`에 둔다.

## Persistent island scheduler arithmetic

- Treat `constraint_remove_count` as its consumed zero/non-zero dirty state. Body/local removals
  and merges saturate at `u32::MAX`; ordinary counts and serialized fields are unchanged.
- Reserve 16 scans of clock headroom before both split-deadline arming and scan advancement.
  At the runtime boundary only, rebase the clock to 1, translate future deadlines by their exact
  remaining scans, retain expired status/default zero, and clear transient scan stamp buffers.
  This rare O(raw island slots + scan id space) transition allocates no new workspace beyond the
  scan's existing resize policy. Capture/admission never canonicalizes saved history.
- All u32 scheduler payloads remain readable; no schema/field/type changes or producer-history
  range guesses reject expired/far-history values. Direct MAX-boundary, all split producers,
  zero-stamp/old-scratch alias, exact 16-scan cooldown, sleeping/hot/over-budget removals and
  immediate-wire/continuation regressions are covered by `stored_scheduler_*`.

여러 독립 component가 같은 tick에 모두 잠들 때 `commit_sleeping_chunks`는 각각을 sleeping chunk로
옮긴 뒤 지정된 awake container를 비워 둔다. 저장 guard는 이 지정 container의 empty 상태를 허용한다.
다른 empty chunk는 계속 거절하며 원본 container id/free-list를 삭제하거나 재빌드하지 않는다.
즉시 wire·원본 대비 재실행과 wake/remove/reuse를 검사하고, Core의 일반/최대 clock·양 공간 checkpoint
회귀에서도 동일한 history를 보존한다. Scheduler wire digest fixture는 실제 dim3/f32 대상에서만 실행한다.

## 저장 eligible impulse/contact link correspondence

- `persistent/validation/eligibility.rs`는 bootstrapped 상태의 settled enabled impulse joint와
  active rigid contact에 stable member측이 있으면 필수 cached link를 역으로 요구한다.
  모든 stable endpoint의 현재 island id는 cached link의 owner와 일치해야 한다.
- 기존 sorted joint location/modified/event scratch를 재사용한다. Current dense joint/contact
  graph와 선택 solver manifolds를 선청구하고, modified collider keys는 실제 길이로 선청구한
  fallible sorted scratch에 넣는다. Original hashmap 반복 lookup/repair/rebuild는 추가하지 않는다.
- pending exact handle+generation Link/Unlink/modified 상태, body TYPE/ENABLED, collider parent/
  type/enable 변화, removed generation, sleep/wake 및 지연 split/journal 이력은 보존한다.
  한 side가 pending이어도 다른 stable side의 owner 의무를 blanket 면제하지 않는다.
- current graph의 connected components를 재계산해서 island와 같다고 강제하지 않는다.
  cycle와 deferred disconnected island는 합법이다. Extra inactive links/forged pending provenance,
  multibody/soft topology 및 완전한 file semantic admission의 완료는 이 후속의 주장이 아니다.
- wire/counter/clock/serde 정책과 공개 Ferrum API는 바꾸지 않는다. 안전한 before 수용 proof,
  typed read-only 거절 및 정상 immediate bytes/6step continuation은
  `artifacts/physics-3d/goal-closure/native-island-eligibility`에 기록한다.


## 저장 contact workspace의 cold admission 연결

`geometry/narrow_phase/stored_workspaces.rs`의 숨김 `validate_stored_contact_workspaces`는 실제 collider의
SHAPE pending 여부와 raw geometric manifolds를 Parry의 supported5 workspace guard에 전달한다.
Solver clusters는 workspace index의 대상이 아니다. 기존 reference/shape admission이 먼저 필요하다.
None은 그대로 허용하고 Voxels3종/Custom은 cold capture측도 거절하여 Ferrum의 decode tag 경계와 맞춘다.
Generic vendor Serde와 solver/query hot path는 변경하지 않는다.

각 pair visit 및 workspace의 map capacity/entry, vector/triangle/scratch 사용량을 cumulative 정책으로
먼저 charge하고 try_reserve_exact로 scratch를 만든다. Core checkpoint는 별도128Mi visit/64Mi requested
scratch 정책을 사용하며 resource 실패는 Capacity, semantic 실패는 InvalidState다. 이는 actual allocator/RSS,
모든 feature/공유 geometry topology·generation/epoch 소진이나 후속 finite arithmetic overflow 증명이 아니다.
새 guard/구조 필드는 serialize하지 않으므로 native 형식5와 기존 backend wire layout을 유지한다.
## SHAPE 교체의 geometry cache reset과 primitive None context

같은 collider identity에서 SHAPE를 소비하면 query 전에 `ContactPair::clear`로 이전 raw manifold, solver cluster와
previous cluster, workspace/recycle을 비운다. Pre-update was-active, pair event status, solver color/bodymask
ownership을 유지하고 기존 `OUTCOME_FULL_COMPOSITE`의 full graph rebuild 경로로 이전 ordinal/graph_pos를 제거한다.
Cold capture는 pending history를 수정하지 않으며 정상 step에서만 소비한다. Vector capacity는 유지하지만
geometry 교체 시 전역 solver graph를 다시 구성하므로 밀집 시간 수용을 주장하지 않는다. SHAPE는 첫 detect 후
clear돼 CCD substep마다 reset하지 않는다. 저장 field와 Serde 형식은 유지한다.

Workspace None도 primitive current context에서는 raw 0/1개와 root ID 0/pose None을 검사한다. Empty/filtered
pair와 known pending SHAPE history는 유지한다. 정상 `set_shape`의 compound→small sphere에서 floor gap 0.4인데도
발생한 ghost impulse/두 번째 tick의 debug graph panic, 7종 shape의148개 교체와 동일 handle/replay,
공개 lifecycle/impulse/cold 거절 회귀는 다음 경로에서 추적한다.
`artifacts/physics-3d/goal-closure/native-contact-workspaces/none-transition/fix-workspace/reports`


## 제거 대기 collider의 contact workspace history 보존

Cold workspace admission은 실제 제거 큐의 정확한 collider handle/generation만 현재 geometry가 없는
pending history로 인정한다. 같은 slot의 새 generation은 이전 pair의 geometry로 사용하지 않는다.
제거 큐의 scan/init 및 n·ceil(log2 n) sort 논리 work를 선청구하고, missing handle의 binary-search
level도 검색 전에 청구한다. 이는 std 비교 횟수나 CPU 상한이 아니다. Fallible sorted scratch를 써 pair마다 큐를
반복 선형 검색하거나 persistent 순서/bytes를 수정하지 않는다. 큐에 없는 missing handle은 거절한다.

현재 geometry 비교만 생략하며 지원5 workspace의 내부 timestamp/index/bijection/vector 검증은
계속 수행한다. Workspace None과 pending SHAPE도 기존 정책을 유지한다. 참조 및 수치 admission이
먼저 필요하며 solver/query의 제거 처리·hot path·직렬화 field·형식5·공개 Ferrum/Wasm API는 바꾸지 않는다.
Actual allocator/RSS나 전체 native-file/shared-topology 완료를 주장하지 않는다.
정상 제거 직후 capture의 수정 전 Context/InvalidState, 양공간·양순서 public32case와
지원5 cache60case/slot reuse/6step continuation, 손상 guard-only 및 exact budget 회귀는
`artifacts/physics-3d/goal-closure/native-contact-workspaces/pending-removal-fix/reports`에서 추적한다.

## File-only persistent shape alias census and restoration

Hidden `geometry::file_shape_aliases`는 collider raw slot/generation 순서와 compound child index를 전수
방문해 first-Arc ordinal sidecar를 capture한다. 포인터 주소는 scratch 정렬에만 쓰고 파일에 쓰지 않는다.
Restore는 위치/누락/중복/forward·noncanonical group, incompatible existing sharing, shared parent의
child group 모순과 모든 same-value bytes/자원을 먼저 검사한 뒤 child→parent 순서로 Arc backing만
연결한다. Parry sealed same-value token/current identity 및 unique parent를 강제하며 arbitrary different
shape를 dirty 없이 바꾸는 safe API는 추가하지 않는다. set_shape/modified tracking/rebuild/query/step을
호출하지 않으며 native shape revision/contact/BVH/dirty history와 ordinary memory schema는 유지한다.
재할당으로 기존 group을 split하거나 shared parent를 COW 수리하지 않으므로 fresh unpublished ordinary
memory candidate가 기본 계약이다. Idempotent/compatible current aliases는 허용한다.
Fallible scratch와 raw arena·sort logical model·encoding·byte comparison을 사전청구하며 compare byte work는
total work에 포함된다. Scratch는 누적 requested payload이며 CPU/RSS/전체 Engine admission 증명이 아니다.
기존 UPSTREAM.json 원본 hash/license는 그대로이고 변경 source/patch/notice 근거와 회귀는
`artifacts/physics-3d/goal-closure/native-file-shape-aliases/reports`에 있다.

## Ferrum2D: collider slot reuse adjacency recovery

- `src/geometry/broad_phase_bvh/update.rs`: before a new collider generation can replace a removed generation's Coarena adjacency row, recover that old row into the existing canonical stale-pair pass. Pair/reverse-link deletion still runs in that pass, with no extra removal events for explicitly removed colliders. The extra recovery only runs when the raw collider slot has a different live generation.
- Fixes normal public remove/add-before-next-step leaving an old-generation pair and one reverse link behind (3 stored pairs versus 5 directed adjacency entries in the minimal source fixture). Stored-reference/cardinality validation remains strict.
- No persistent field, wire, public API, dependency, shape or BVH geometry change; non-reuse paths retain existing pair/event ordering and stored bytes. Reuse boundary behavior is corrected by removing obsolete generations; the previous inconsistent pair history is not a replay-compatibility target.

## Ferrum2D: 실제 solver 구간 운동 승인

`SolverBodyIntegration`은 실제 선형화 quaternion 적분식, solver 속도와 실제 kernel dt를
반올림된 관측 시간과 구분해 보존한다. 선택된 배타 운동 승인 단계는 모든 rigid-body
적분이 완료된 기존 worker-0 barrier에서 ordinary reference를 빌린다. 새 unsafe 표현식,
외부 힘 재적분, 영속 solver field는 추가하지 않는다. 유한값·unit 회전·엄격한 slot 순서를
가진 전체 batch를 먼저 검사하고 승인된 solver row만 함께 바꾼다.

명시적인 Approved/Rejected/NeedsWakeJoin 결과로 미승인 제안이 body/contact impulse
writeback이나 후행 CCD/최종 위치 advance에 도달하지 못하게 한다. Committed seconds는
private solver scratch의 승인 callback 수가 아니라 완전히 writeback/advance된 slice 시간이다.
기본 opt-out의 barrier, solver grouping, body writeback과 event adapter는 그대로 따른다.

선택된 결합 운동은 기존 ungrouped 경로의 최대 additional solver/PGS 설정을 공통 실제
시간축으로 사용한다. 저장 승인된 body extra를 제한하거나 다시 쓰지 않는다. 명시적인
교체가 없으면 position-kinematic의 원래 정확한 authored target writeback을 유지한다.
마지막 실제 interval/기존 target override의 읽기 전용 정보와 batch의
`keep_integrated_endpoint`가 검증되지 않은 dt0 target 치환을 막는다. 원래 CCD Sweep을
관측하여 짧아진 endpoint 두 개로 nlerp 시간을 다시 만들지 않는다.

하위 owner가 실제 piecewise 곡선, 센서 통과, 잠든 물체의 접촉 prefix 재검사와 endpoint
placement를 별도로 검사한다. Callback hook만으로 전체 angular CCD 완료라고 부르지 않는다.
Local motion credit는 사전 계획의 속도·activation·pending target만 보관하며 arena,
월드, island/contact cache나 이미 승인된 body pose를 복원하지 않는다. 계획 전에
modified queue의 반환 여유를 fallible reserve할 수 있다. Raw arena slot 수는 빈 slot과
retired slot의 순회 비용도 포함한다.

이 transient API는 원래 backend serde field를 추가하지 않는다. Ferrum의 완료된 스텝
검색 owner는 별도 version6 exact-curve payload와 cold admission을 사용한다. 구현과
합성 검증은 `artifacts/physics-3d/goal-closure/actual-angular-trajectories/`에서 추적한다.
중간 compile은 전체 Goal5 완료 증거가 아니다.

## Tick-local precise solver clock

- SolverMotionContext exposes private logical substep bounds `D*i/N` in f64,
  where D is the original full CCD slice dt widened from f32. Original observer
  labels, substep physical integration_seconds, solved velocities and poses do
  not change. No additional force integration occurs.
- SolverBodyIntegration permits evaluating its original kernel using only the
  final interval-local physical dt; no absolute f32 time is reconstructed.
- PhysicsPipeline separately reports f64 committed logical time only after the
  same completed CCD-slice writeback that updates its existing f32 observer.
  Rejected slices receive no committed-time credit.

## Prepared Native CCD on actual original kernels

- Reuse native solved fast-body activation, non-bullet/bullet target tiers,
  groups, hooks and pseudo/sensor policy through shared readonly helpers.
- An opted-in handler plans one complete CCD slice after every group and
  restitution, before persistent contact/joint impulse and body writeback.
  Worker zero reuses the original exclusive approval borrow and StageSync;
  pointer expressions are centralized without a new pointer/alias contract.
- A reusable non-serialized VelocitySolver plan retains private f64 cutoffs and
  original-kernel COM endpoints. Coverage includes mixed actual paths, so the
  old whole-endpoint sweep never clamps an already-approved Core path again.
- At the original postsolve CCD phase, apply only prevalidated position rows;
  solved velocities, damping, forces, masses and elapsed-time credit are unchanged.
  Diagnostics retain collider-pair-call/applied-body/drop meanings. The bounded
  diagnostics Vec is reserved fallibly before solver publication; apply allocates
  nothing. Core stages sensor events and publishes only completed slices once.
- Default handlers leave the plan uncovered and retain the original CCD sweep,
  scheduling and event path. Existing observer f32 fraction is output only;
  Core exact paths retain original Integrated domains and Constant suffixes.
  No persistent field/Curve variant, serde wire change or Wasm ABI is introduced.


## Controller·joint·CCD 공통 논리 시간 구간

`EventHandler::solver_motion_step_domain`과 `handle_body_motion_pass_domain_started`는 opt-in
실행의 정확한 tick 시간 구간을 전달한다. pipeline은 기존 F32 CCD remaining-time 분할을 그대로
실행하고 그 경계를 전체 논리 구간에 매핑한다. staged solver는 동일한 구간을 직접 전달받아
내부 interval의 첫·마지막 경계 비트를 보존한다. `SolverMotionContext`의 precise 시간, 전체
Native CCD 증명과 prepared clamp, 실제 완료 credit은 이 시간선을 사용한다. 기존 F32 observer
label과 Native dt, force·constraint·velocity cap·적분 수식은 유지한다. prepared clamp의 관측
fraction만 정확한 논리 구간에서 계산하고 물리 sweep_seconds는 원 dt를 보존한다.

Core는 증명한 Kernel을 원 global tick domain 그대로 저장하며 사후 clock shift를 하지 않는다.
새 Native response continuation은 원 Kernel의 h/D에서 물리 잔여 시간을 가져온다. 시간 credit은
실제 전체 CCD slice writeback이 끝난 뒤에만 그 slice의 정확한 끝으로 진행한다. 마지막 통계
값만 덮어써 미완료 구간을 완료로 처리하는 경로는 두지 않는다. 단계별 회귀와 전체 제품
수용 검증은 구분하며, 현재 후보의 통합 실행 전에는 완료된 결과로 주장하지 않는다.

## 거부된 고정 틱의 rigid 상태 복원

`RigidStepCredit`은 몸체·콜라이더의 변경 필드, 사용자 변경 큐와 broad phase의 영속
상태를 작업자가 재사용하는 버퍼에 보관한다. Core는 쓸 수 있는 메모리와 작업량을
먼저 확인하고, graph 준비 이후에도 승인한 시간이 0인 경우에만 원래 상태를 복구한다.
BVH 노드는 배열 단위로 복사한다. 인접 목록의 세대·길이와 간선은 각각 하나의 배열에
담는다. 밀집한 위치가 옮겨가도 각 슬롯의 과거 최대 버퍼는 남지 않는다. 보유 배열의
실제 capacity를 검사하며 콜라이더 형상과 arena는 원래 소유자에 둔다.

## Ferrum2D: 저장된 solver hint 교차 검증

- `src/geometry/narrow_phase/validation.rs`(추가 파일): 저장된 `pair_solver_hints`는 비어 있거나
  contact edge 수와 같아야 한다. 각 hint의 manifold 수는 0(sleep/역직렬화로 비운 상태)이거나
  실제 qualified manifold 수와 같아야 한다. solver graph를 재사용할 수 있는 상태(`solver_graph_valid`와
  epoch 일치)에서 graph에 들어 있는 manifold는 선택 가능한 hint(dynamic bit와 0이 아닌 수)를 가져야 한다.
- 손상된 hint가 debug에서는 `debug_validate_*` panic을, release에서는 접촉 누락을 일으키던 문제를
  복원 단계의 `StoredReferenceError::SolverGraph`로 거부한다. 정상 상태의 stale 허용 범위(전체 rebuild
  대기 중인 graph 위치, sleep으로 비운 수)는 그대로 둔다. 저장 형식·공개 API는 바뀌지 않는다.
- 회귀: `stored_references_reject_solver_hints_that_disagree_with_ready_graph`.
