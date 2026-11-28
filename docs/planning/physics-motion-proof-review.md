# 3D 물리 운동 증명 방식 검토

상태: 사용자 결정 B(허용 오차 방식 전환)·P1a·P1b 비교 완료·P2a 강체 경로 전환 완료(PR #114, 2026-11-27 main 머지)·P2b 제품 경로 확정(작업 브랜치).

관련 문서: [통합 3D 물리의 회전 상자 접촉 기록](unified-3d-physics-plan.md#해결-회전-상자-접촉의-운동-증명-2026-11-22), [PR CI 정리](ci-and-studio-distribution-plan.md)(빌드 시간 조사의 출발점).

## 왜 조사했나

`crates/ferrum-core/src`는 Rust 약 41만 줄의 단일 크레이트다. 그중 `physics3d/`가 15.3만 줄이며, 대부분이 2026-11-21 커밋 `cb110be7`(788개 파일, +24만 줄)에서 들어왔다.
가장 큰 `physics3d/solver_trajectory/`(5.9만 줄)는 기능 규모에 비해 지나치게 크고, 이 코드가 물리 실험실 4개 시나리오와 벽돌 깨기의 world 정지 원인이다.
빌드·테스트 시간과 미해결 결함을 함께 줄일 수 있는지 판단하려고 동작, 요구사항 근거, 대체 가능성, 영향 범위를 조사했다.

## 결론

- 물리 계산 자체는 Rapier가 한다. 매 틱 `PhysicsPipeline::step`을 호출한다. 자체 코드는 Rapier가 낸 결과를 받아들일지 판정하는 **검사기(gate)**다.
- 검사기는 한 틱 동안의 움직임 전체가 겹침 없이 안전하다는 것을 **f32 반올림 결과 단위까지 수학적으로 증명**하려 한다. 증명하지 못하면 그 틱을 되돌리고,
  같은 입력으로 다음 프레임에도 다시 실패하므로 world가 멈춘 것처럼 보인다. 사용자에게 보이는 `physics capacity exceeded`는 실제 용량 문제가 아니라 **증명이 수렴하지 않았다는 뜻**이다.
- 이 방식은 사용자가 정한 요구가 아니다. 사용자 승인은 "3D 물리를 도입해 2D·HD-2D에 함께 쓰고 고도화"까지이며, 정확한 증명은 에이전트가 정한 완료 조건에서 나왔다.
  공개 문서도 회전 CCD나 관통 없음을 약속하지 않고, 오히려 보장하지 않는다고 적는다.
- `solver_trajectory`의 제품 코드 약 3.3만 줄 중 약 95%가 증명 장치다. 허용 오차 방식(Rapier CCD·접촉 여유)으로 바꾸면 대부분 지울 수 있고, 어느 방식이든 필요한 형상 계산은 1~2천 줄이며 그 대부분을 parry가 이미 제공한다.
- **추천: 허용 오차 방식으로 전환한다.** 먼저 증명 검사기를 끈 실험 모드로 실제 동작을 비교한 뒤 단계적으로 전환·삭제한다(아래 "단계 제안").

## 현재 동작 (확인한 사실)

**틱 흐름.** `PhysicsWorld3d::step` → 캐릭터 이동(Rapier `KinematicCharacterController`) → 관절 → `step_backend` → vendor Rapier의 `PhysicsPipeline::step`.
vendor에 추가한 콜백 `resolve_solver_motion`이 각 물체의 실제 적분 결과를 넘기면 증명을 돌려 승인·거절을 정한다. 거절된 구간은 반영하지 않는다
(`physics3d/character_motion/backend.rs`의 `BackendEvents`, `vendor/rapier3d/FERRUM-PATCHES.md`).

**언제 켜지나.** `backend_motion_enabled()`(`physics3d/character_motion/backend.rs:5801`)는 캐릭터·지정 경로·step-motion 쿼리가 있거나,
`continuous`가 켜져 있고 동적 물체가 하나라도 있으면 참이다. `continuous`의 기본값은 `true`다(`physics3d/settings.rs:25`).
켜지면 매 구간 모든 충돌체 쌍을 훑어 경계 상자가 겹치는 쌍마다 증명을 돌린다(`physics3d/character_motion/actual_scene.rs:671`). 빠른 물체만이 아니라 맞닿아 쉬는 물체도 대상이다.

**증명 방법.** 구간을 최대 48단계까지 반으로 나누며(`solver_trajectory.rs:2013`), 구간 전체에서 고정된 분리 평면이 성립함을 다항식 계수로 증명한다.
그걸로 부족하면 `rounded/`의 특수 증명 약 30종으로 넘긴다. 틱당 작업 한도는 `MAX_PROOF_WORK = 32Mi`(`character_motion/trajectory.rs:9`)이다.

**실패 처리.** 한도를 넘으면 `WorkLimit` → 공개 오류 `CapacityExceeded`, 수렴하지 않으면 `UnresolvedMotion`이다(`backend.rs:5785`).
허용 오차를 늘리거나 다른 방식으로 넘어가지 않는다("Never fall back to another rigid solver in this world.", `engine/unified_physics.rs:638`).

## 왜 이렇게 커졌나

| 부분 | 줄 수 |
| --- | --- |
| `solver_trajectory/` 전체 | 58,821 (테스트 약 25.6k, 제품 약 33.2k) |
| └ `rounded/` | 45,494 (제품 약 28.9k) |
| `character_motion/` | 39,077 (제품 약 20.6k, `backend.rs` 6,054) |
| vendor rapier3d 패치 | 수정 44개·추가 23개 파일, 약 +10.8k줄 |
| vendor parry3d 패치 | 수정 30개·추가 11개 파일, 약 +3.9k줄 |

`rounded`는 둥근 모양이 아니라 **f32 반올림**을 뜻한다. Rapier의 계산식이 낼 수 있는 모든 f32 값을 다루는 증명을 형상 조합(상자·공·캡슐 등) × 움직임 종류(이동·회전·발판 위 운반)마다 따로 만든다.
대표 주석: "Exact finite image of the existing interval-local f32 kernel parameter."(`rounded.rs:1`), "A complete RN32 residue proof for one existing cardinal separating axis."(`rounded/correlated_linear.rs:1`).
형상 이름이 붙은 함수만 약 118개다.

새 사례에서 증명이 막힐 때마다 그 사례 전용 증명을 추가하는 방식으로 고쳐 왔다. 커밋 기록의 예:
- "certify grazing CCD"(`c8547cf2`, 약 +2.1k줄)
- "certify spinning centered balls with a translation-only twin"(`0026eb3e`)
- 마을 전투 1.1초 정지, WASI 회전 발판, 회전 상자·공의 3틱·28틱 거절

물리 계획 문서의 미해결 수정안 4개 중 셋도 같은 방향(증명 추가·정밀화)이다. 이대로 가면 코드는 계속 늘어난다.
벽돌 깨기 사례는 회전이 없는 공이다. 그러니 회전만의 문제가 아니라, 접촉 거리가 0에 가까울 때 f32 정확 증명을 요구하는 방식 자체의 문제다.
일반 물리 엔진은 이 구간을 접촉 여유(contact slop)로 흡수한다.

## 요구사항 근거

- 사용자 승인(물리 계획 336~338줄): 조사 자료와 오픈소스 비교를 바탕으로 3D 물리를 도입해 2D·HD-2D에 함께 사용하고 고도화한다.
- 정확한 증명으로 이어진 문장은 모두 계획 문서의 완료 조건이다.
  - 434줄 "중복 시뮬레이션·조용한 fallback 금지"
  - 815줄 "관통 방지·안정성 검증은 `isFinite` 또는 count 검사로 대체하지 않는다"
  - 1270~1272줄: 접촉 후 반전·CCD clamp 전후 궤적은 끝 위치만으로 복원할 수 없다
  - 2524줄 "기존 TOI·skin·solver cap을 완화하지 않았다"

  이 조건들 근처에 "사용자 결정"·"제품 결정" 기록이 없고, `cb110be7`에는 커밋 본문이 없다.
- 결정성(같은 입력 → 같은 결과)은 증명과 별개다. vendor의 `enhanced-determinism`, f32 빌드, 병렬·SIMD 미사용으로 얻는다.
  증명을 빼도 결정성은 유지되고 결과값(hash)만 바뀐다.

## 공개 계약

- 회전 CCD나 상대 운동 전체를 보장하지 않는다고 공개 문서에 적혀 있다(`docs/engine/public-api/core.md:1055` 외 여러 곳, `physics-spec.md:224, 228`).
- 저장 파일은 같은 빌드에서만 쓴다(`docs/engine/public-api/native-game-files.md:7`). 이전 베타(beta.10)에서도 64명 군중 궤적이 바뀐다고 공지한 전례가 있다(CHANGELOG).
- 전환해도 지켜야 할 약속: 실패 시 `native physics step skipped` 오류와 진행하지 못한 틱 되돌리기, 같은 Engine에서의 `RuntimeCheckpoint` 이어가기, 오류 번호 유지, `continuous:false`에서 CCD 생략.

## 허용 오차 방식으로 바꾸면

**Rapier가 이미 하거나 할 수 있는 것.**
- 적분, 접촉, 마찰, 관절, 수면(sleep). 지금도 Rapier가 한다.
- 빠른 동적 물체와 고정 지형: Rapier CCD와 추측 접촉(speculative contact), 0.36의 `soft_ccd_prediction`.
- 기본 캐릭터 이동: 이미 쓰는 `KinematicCharacterController`.
- 동적 물체 밀기: `solve_character_collision_impulses`.
- 단방향 지형: `PhysicsHooks`. 이미 `contact_policy.rs`에서 쓴다.

**어떤 방식이든 자체 코드가 필요한 것(증명 없이 더 단순해진다).**
- 회전 발판 위 캐릭터 운반.
- 움직이는 키네마틱 물체에 대한 상대 운동 sweep.
- 캐릭터끼리의 결합·군중·끼임.
- 유한 질량 캐릭터 밀기.
- 기어·도르래 관절과 연속 힌지.
- 경로 꺾임점에서 틱 나누기.

**위험.**
- 구간 전체 "절대 겹치지 않음" 보장이 사라진다.
- Rapier CCD의 한계가 그대로 드러난다.
  - 빠른 동적 물체만 sweep한다.
  - 키네마틱 물체는 sweep하지 않는다(빠른 발판이 bullet이 아닌 물체를 통과할 수 있다).
  - 끝 위치만 자르므로 충돌한 틱에 남은 움직임 일부를 잃는다.
- 얇은 메시 지형은 추측 접촉에 기대야 한다.
- 캐릭터 동작이 미세하게 달라질 수 있다.

**얻는 것.**
- 물리 실험실 4개 시나리오와 벽돌 깨기 연속 충돌 정지가 사라질 가능성이 높다. 실험 모드로 확인해야 한다.
- 대략 지울 수 있는 코드:
  - `solver_trajectory` 증명부 약 3.1만 줄과 그 테스트 약 2.5만 줄
  - `character_motion`의 승인·거절 처리 상당 부분
  - vendor의 증명 전용 훅(승인 장치, Prepared Native CCD, 되돌리기)
- Core 빌드·테스트 시간과 Wasm 크기가 함께 준다.

## 바뀌는 기준 파일과 테스트

| 대상 | 처리 |
| --- | --- |
| `tests/smoke/native-gameplay-navigation-probe.mjs:35`(64명·405스텝 군중 hash) | 다시 만든다. 물리 계획의 완료 조건 "군중 hash 유지"도 함께 바꾼다 |
| `packages/create-game/templates/*/public/gameplay-runtime-replay.fixture.json`(4개) | 다시 만든다(Rust 변경마다 이미 다시 만든다) |
| `physics3d/broad_phase_nonreuse_golden.postcard` | 접촉·위치가 바뀌면 다시 만든다 |
| `tight_clearance_tests.rs`의 `FULL_MARGIN_QUERY_GOLDEN` | `character_query`가 바뀔 때만 |
| `solver_trajectory/` 테스트 약 331개, `character_motion/` 테스트 약 198개 | 증명 전용은 삭제, 동작 테스트는 새 방식 기준으로 다시 쓴다 |
| `tests/smoke/native-checked-error-probe.mjs` | 제품 고정 틱의 사전 거절을 검사한다. 틱 중 롤백은 저장 바이트를 비교하는 Rust 실패 주입 시험으로 검증한다. |
| `engine/unified_physics/sandbox_scene_tests.rs`의 ignored 3건, `examples/shared/physicsExamples.json`의 `knownIssue` | 통과하면 ignore와 예외 목록을 지운다 |
| `tests/fixtures/gameplay-golden/*.json`, vendor 저장 형식 golden | 영향 없음(legacy backend 강제 또는 형식 고정) |

## 선택지

| 선택지 | 내용 | 장점 | 단점 |
| --- | --- | --- | --- |
| A. 현행 유지 | 물리 계획의 수정안 1~4로 증명을 넓힌다 | 현재 보장 유지, 기준 파일 그대로 | 코드가 계속 늘고 같은 유형 정지가 다시 생길 수 있음. 빌드 시간 문제 그대로 |
| B. 허용 오차 방식 전환 (추천) | 증명 검사기를 없애고 Rapier CCD·접촉 여유를 쓴다. 캐릭터는 KCC와 필요한 자체 sweep만 남긴다 | 미해결 정지 해소 가능성, 수만 줄 삭제, 빌드·Wasm 축소 | 결과 hash 변경, 테스트 재작성, Rapier CCD 한계 수용 |
| C. 단기 완화 | 증명 실패 시 world를 멈추지 않고 Rapier 결과로 진행하며 진단을 남긴다 | 정지 증상만 빠르게 해결 | "조용한 fallback 금지" 원칙과 충돌. 코드는 그대로 |

## 진행 단계

1. **P1 실험 모드 비교**: 증명 검사기만 끄고 Rapier CCD는 켠 설정을 실험용으로 만들어 지금 방식과 비교한다. 공개 API에는 노출하지 않는다.
   범위는 아래 "P1 작업 범위"에 둔다. 결과로 B를 확정하거나 보류한다.
2. **P2 기본 경로 전환**: 기본값을 새 방식으로 바꾼다. 캐릭터는 KCC와 발판 운반·군중·끼임만 자체 코드로 재구성한다.
   - 공개 문서와 CHANGELOG에 결과 변화를 공지한다.
   - 군중 hash와 리플레이 기준 파일을 다시 만든다.
3. **P3 삭제**: 다음을 지우고 빌드 시간과 Wasm 크기를 다시 잰다.
   - `solver_trajectory` 증명부와 그 테스트
   - `character_motion`의 승인·거절 처리
   - vendor의 증명 전용 훅
   - 테스트 전용 `force_rigid_motion_proof`와 강체 증명 테스트
     `observation_off_linear_sphere_and_locked_box_keep_actual_force_kernels_and_native_momentum`,
     `forced_proof_includes_all_enabled_native_dynamic_origins`,
     `prediction_extra_cadence_never_changes_actual_backend_base_parameters`
   - `p1a_compare_*`의 강체 증명 대조군. 일반 CCD·관통·겹침 검사와 공개 오류 복구 회귀는 해당 시점의 제품 경로로 유지한다.
   - `force_character_motion_proof`와 P1b 증명 비교. 분류 표의 정확 suffix·handoff·zero-time credit,
     `event_prefix`의 정밀 재생, exact step-motion trace·file admission 시험도 지운다.
   - 정확한 CCD prefix를 요구하는 `file_candidate_actual_native_ccd_saved_queries_and_six_tick_runtime_are_identical`,
     `file_candidate_actual_native_ccd_original_end_damage_rejects_valid_crcs_and_keeps_source`.
     제품 경로의 저장 바이트, 일반 보간 질의, atomic admission 시험은 유지한다.
   - `step_motion::exact`와 내부 callback의 Native trajectory trace. 프로젝트 파일의 호환 범위를
     검토한 뒤 snapshot의 기존 exact 레코드를 정리한다. 일반 보간·BVH와 공개 체크포인트 검사는 유지한다.
   - `step_kinematic_tick`의 승인·prefix 재시도와 제품에서 false인 `backend_motion_enabled`의 테스트
     분기를 제거한다. `step_rapier_kinematic_tick`의 매듭 분할, KCC sweep과 발판 운반은 유지한다.
   - 증명 경로와 일반 스텝이 함께 쓰는 시간 변환·저장 검사·틱 되돌리기 코드를 먼저 구분한다.
     사전 거절 상태 불변과 테스트 전용 틱 실패 주입은 증명 대조군을 삭제한 뒤에도 유지한다.
4. 그 뒤 기존 2D 물리(`physics`·`collision`) 정리와 크레이트 분리를 검토한다(빌드 시간 조사의 2·3번 항목).

## 사용자 결정 (2026-11-27)

"다른 엔진들이 쓰는 방식으로 간다." Unity(PhysX·Box2D), Godot(Godot Physics·Jolt), Unreal(Chaos)처럼 매 틱 증명하지 않고,
작은 겹침을 허용 오차로 흡수하며 빠른 물체만 CCD로 막는다. 품질은 실행 중 판정이 아니라 장면 테스트로 확인한다.

1. 방향: B. P1 실험부터 시작한다.
2. 품질 기준: 아래 표를 장면 테스트로 확인한다. 겹침 깊이 한도는 P1에서 실제 값을 잰 뒤 정한다.
3. 결과 변화 허용: 군중 hash·리플레이 기준 파일을 다시 만들고, 다음 베타 CHANGELOG에 물리 결과 변화를 공지한다.
4. 증명 방식은 옵션으로 남기지 않는다. P3에서 완전히 지운다.
5. 허용 오차는 Rapier 기본값(겹침 허용 0.005, 접촉 예측 0.02, 길이 단위당)으로 시작하고, 처음에는 공개 설정으로 내놓지 않는다.
6. 결정성(같은 빌드·같은 입력 → 같은 결과)은 지금처럼 유지한다. 일반 엔진보다 강한 이 약속은 증명과 별개다.

| 품질 기준 | 확인 장면 |
| --- | --- |
| world가 멈추지 않음(300프레임 동안 step 오류 0) | 물리 실험실 4개, 벽돌 깨기(연속 충돌 켬) |
| CCD 대상의 빠른 물체가 얇은 벽·지형을 통과하지 않음 | 벽돌 깨기 공, 얇은 지형 고속 낙하 |
| 쌓인 물체가 떨리거나 서로 파고들지 않음 | 상자 더미, 관절 |
| 회전·이동 발판 위 캐릭터가 떨어지거나 미끄러지지 않음 | 회전 발판 |
| 캐릭터끼리 뚫지 않고, 끼였다가 빠져나옴 | 64명 군중, 마을 전투 |
| 같은 입력을 두 번 실행하면 같은 hash | 64명 군중 |
| 프레임 시간이 지금보다 나쁘지 않음 | 64명 군중, 마을 전투 |

## P1 작업 범위

코드 확인 결과, 강체만 있는 장면과 캐릭터가 있는 장면은 증명을 끄는 난이도가 다르다.

- 강체만 있는 장면: `step_checked`(`physics3d/world.rs:334`)는 `backend_motion_enabled()`가 거짓이면 이미 증명 없는 일반 경로
  (`step_with_joints` → `step_backend`)를 탄다. vendor 훅 `resolves_solver_motion`의 기본값도 `false`라 끄면 Rapier 원래 경로로 돈다
  (`vendor/rapier3d/src/pipeline/event_handler.rs:255`). 남은 일은 일반 경로에서 `continuous`일 때 Rapier CCD가 실제로 도는지 확인하는 것이다.
- 캐릭터가 있는 장면: 캐릭터가 하나라도 있으면 항상 증명 경로를 탄다(`backend.rs:5801`). 캐릭터 이동·발판 운반·군중 처리가 증명 경로 위에 있어,
  끄려면 KCC 기반 경로를 새로 짜야 한다. 이 부분은 사실상 P2의 앞부분이다.

그래서 P1을 둘로 나눈다.

- **P1a 강체 장면 비교**: 내부 전용 스위치로 강체 장면의 증명을 끄고 Rapier CCD를 켠다. 물리 실험실 4개(기존 ignored 시험 3건과 관절 재현 추가),
  벽돌 깨기 재현, 얇은 지형 고속 낙하, 상자 더미를 Rust 단위 비교로 돌려 정지·관통·최대 겹침 깊이·step 시간을 지금 방식과 표로 비교한다.
- **P1b 캐릭터 장면 비교**: P1a 결과가 좋으면 회전 발판과 64명 군중만 대상으로 KCC 기반 최소 경로를 시험 구현해 같은 표로 비교한다.

P1의 공통 규칙.

- 기본값, 공개 API·TS 타입, 기준 파일, vendor 파일, 의존성은 바꾸지 않는다. 스위치는 Rust 내부(테스트·실험 전용)에만 둔다.
- 브라우저 확인은 필요할 때만 하며, 비교의 기준은 Rust 단위 결과다.
- 결과 표와 판단(B 확정·보류)을 이 문서에 남긴다.

### P1a 결과

이 절의 현행은 P2a 전 강체 증명 경로를 가리킨다. 당시 실험은 P2a의 제품 기본 경로가 됐다.

Rust 단위 테스트에서만 `PhysicsWorld3d`의 직렬화 대상이 아닌 작업 상태에 실험 스위치를 둔다. 기본값은 꺼짐이다.
캐릭터, 지정 경로, step-motion 중 하나라도 있으면 스위치를 켜도 증명 경로를 탄다. 나머지 장면에서는
`step_checked` → `step_with_joints` → `step_backend`로 들어간다.

일반 경로는 `resolves_solver_motion=false`로 Rapier의 기본 CCD 활성화 검사와 위치 클램프를 실행한다.
반경 0.5인 공을 x=-2에서 속도 300으로 두께 0.1의 고정 벽을 향해 1틱 쐈다. `continuous`와 물체의
`ccd_enabled`를 둘 다 켜면 클램프 1회, 정지 위치 x=-0.545였다. 물체의 플래그만 끄면 Rapier의
빠른 동적 물체 대 고정물 CCD가 같은 위치에서 막았다. `continuous`만 끄면 클램프 0회, x=3.000까지
진행해 벽을 통과했다. Rapier CCD 활성화를 위한 추가 수정은 필요 없었다.

두 모드의 기존 적분 설정은 `dt=1/60 s`, `length_unit=1`, `allowed_linear_error=0.005`,
`prediction_distance=0.02`, `min_ccd_dt=0.00016666668 s`, `max_ccd_substeps=1`,
고정 접촉 `natural_frequency=240 Hz`였다. 0.005는 solver 보정에 쓰이는 여유이며 장면에서 측정한
최대 겹침 깊이에 적용할 품질 합격선은 아직 정하지 않았다.

장면별·모드별 300틱을 시도했다. 프레임 번호는 0부터 시작하며, 정지로 집계한 틱은 단계 오류가 나고 승인된
시간이 0인 틱이다. 겹침은 매 틱 후 충돌하는 고체 fixture 쌍의 Parry 부호 거리로 측정했다. 같은 강체에
속한 fixture, 센서, 관절에서 접촉을 끈 쌍은 제외했다. 벽돌 깨기는 공 중심의 틱 전후 선분이
실제 치수의 벽·벽돌·패들 내부에 들어가는지 검사했다. `collider-gallery`는 중심 이동 선분이
체인의 어느 구간에서든 아래로 교차하는지 확인했다. 바닥·메시 검사는 틱 후 위치로 판정했다.
겹침 깊이는 각 장면의 월드 좌표 단위다. 이 표본 검사로는 틱 안에서 관통하고 돌아오는 움직임을 검출할 수 없다.

| 장면 | 단계 오류 수 (최초 틱), 현행 → 실험 | 정지 수 (최초 틱), 현행 → 실험 | 지정 장벽 관통, 현행 / 실험 | 최대 겹침 깊이, 현행 → 실험 | 릴리스 시간 평균 / 최대 (µs), 현행 → 실험 |
| --- | --- | --- | --- | --- | --- |
| 실험실 `rigid-materials` | 185 (115) → 0 | 185 (115) → 0 | 미검출 / 미검출 | 4.0241852 → 4.0241852 | 3107.53 / 9653.39 → 8.94 / 60.55 |
| 실험실 `contacts-sensors` | 237 (63) → 0 | 237 (63) → 0 | 미검출 / 미검출 | 2.6360264 → 4.2528687 | 5215.76 / 8596.30 → 6.13 / 56.09 |
| 실험실 `collider-gallery` | 250 (50) → 0 | 250 (50) → 0 | 미검출 / 미검출 | 5.7482629 → 6.3751030 | 4624.78 / 6936.14 → 15.68 / 47.03 |
| 실험실 `joints-lab` | 300 (0) → 0 | 299 (1) → 0 | 미검출 / 미검출 | 0.6535240 → 1.0178833 | 4293.06 / 5434.19 → 56.41 / 169.64 |
| 벽돌 깨기 `breakout-gap` | 128 (136) → 0 | 128 (136) → 0 | 미검출 / 미검출 | 0 → 0.0381165 | 1426.04 / 3883.42 → 11.15 / 158.84 |
| 얇은 메시 지형 고속 낙하 `thin-mesh-fall` | 0 → 0 | 0 → 0 | 미검출 / 미검출 | 0.0000043 → 0.0061371 | 6.10 / 885.87 → 0.64 / 24.55 |
| 상자 8개 더미 `box-stack` | 292 (8) → 0 | 292 (8) → 0 | 미검출 / 미검출 | 0.0010937 → 0.0102206 | 6963.68 / 12564.94 → 2.07 / 42.91 |

기존 ignored 장면의 정지 틱 115·63·50을 모두 재현했다. 관절 장면의 현행 경로는 0틱에 일부 시간을
승인한 뒤 `CapacityExceeded`를 반환했고, 이후 시간 승인 없이 `UnresolvedMotion` 299회를 반환했다.
나머지 장면의 단계 오류는 모두 `CapacityExceeded`였다. 관절 장면의 초기 겹침은 0.6680799였으며,
실험 경로는 관절 7개를 유지했고 용접 앵커의 최대 이격은 0.0713455였다. 얇은 메시를 향해 속도 1,000으로
떨어뜨린 공은 두 모드 모두 CCD 클램프 1회로 지형 위에 남았다.

상자 더미는 바닥부터 상자 8개까지 순서대로 지지되는지 검사했다. 각 상자 중심이 아래 지지체의 윗면 범위에
놓이고, 기존 접촉 예측 거리 0.02 안에서 위쪽 방향의 접촉이 잡혀야 지지로 집계했다. 마지막 60틱 중 더미
전체가 지지된 틱은 현행 0개, 실험 60개였다. 최종 틱도 실험 경로에서 지지를 유지했다. 같은 구간의 최대
선속도는 1.308 → 0, 최대 각속도는 0 → 0이었다.

벽돌 깨기는 물리 계획의 조건으로 Rust Data Scene 자동 스텝을 구성했다. 폭 112인 패들은 움직이지 않게 두고,
반지름 6인 공은 중력과 마찰 없이 반발계수 1, 속도 300으로 유지했다. (348, 168)의 벽돌 하나를
먼저 제거한 뒤 0·100·200틱의 강제 발사로 틈에 진입시켰다. 나머지 벽돌은 충돌 진입 이벤트로 제거했다.
발사 틱을 고정해 같은 틈 진입 조건을 만들었다. 현행은 136틱에 `CapacityExceeded`를 처음
반환했고, 이때 증명 진단은 벽돌 모서리에서 `native_ccd::plan`의 `WorkLimit`을 기록했다.
두 모드 모두 틈 안에 13틱 머물렀고, 벽돌 제거는 현행 2개·실험 4개였다.

릴리스 테스트 바이너리는 같은 장면을 한 스레드에서 순서대로 측정했다. 타이머는 실험실 4개의 수동
물리 단계, 벽돌 깨기의 자동 단계를 포함한 `Engine::update`, 공간 장면 2개의 `step_checked`를
각각 감쌌다. 겹침·관통 검사와 게임 규칙은 타이머 밖에서 실행했다. 결과에는 기존 증명 테스트의
오류 진단 비용과 실패한 단계의 소요 시간도 포함된다. CPU는 Ryzen AI Max+ 395, 환경은 WSL2다.
오류·정지·관통·겹침 수치는 디버그와 릴리스 실행에서 일치했다.

**판단 — P1b 진행.** 실험 경로는 일곱 장면에서 각각 300틱을 오류 없이 진행했고 지정 장벽 관통이
검출되지 않았다. 멈췄던 물리 실험실 네 장면과 벽돌 깨기가 계속 진행했고, 실험 경로의 상자 더미는 마지막
60틱 내내 쌓임을 유지했다. 단계 오류와 관통에 대한 결과를 근거로 캐릭터 장면을 비교할 가치가 있다고 판단했다.
`contacts-sensors`와 `collider-gallery`의 최대 겹침은 각각 4.25와 6.38 월드 단위였다. 현행의
최댓값은 정지 전까지 진행한 운동을 반영하므로, 두 수치를 같은 구간의 겹침 차이로 해석할 수 없다.
B의 최종 확정에는 장면별 겹침 허용 한도와 캐릭터 품질 확인이 남아 있다. P1a에는 캐릭터 경로 구현을
포함하지 않았다.

재현 명령은 저장소 루트에서 Rust 1.97.1로 실행한다. 시간은 `--release` 실행에서만 집계한다.
`p1a_probes`는 벽돌 가장자리, 체인 꼭짓점 주변, 바닥에 흩어져 멈춘 상자를 단위 테스트로 확인한다.

```bash
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib rigid_step_respects_continuous_ccd_without_motion_proof -- --show-output
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1a_probes
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1a_compare -- --ignored --show-output --test-threads=6
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --release --lib p1a_compare -- --ignored --show-output --test-threads=1
```

Core 전체 테스트 1회에서 단위 3,789건과 통합 1건이 통과했다. 기본 실행이 건너뛰는 11건 중 P1a 비교
7건은 위 명령으로 각각 통과했다. Core Clippy(`--all-targets -- -D warnings`), Rust 포맷 검사,
문서 링크 검사도 통과했다. Wasm 빌드와 브라우저 smoke는 P1a 검증 범위에서 제외했다.

#### P1a 겹침 추적

표는 각 모드의 기하 겹침 최댓값이 처음 나온 틱을 기록한다. 속도는 그 틱 직후의 `(vx, vy, ωz)`이며
고정물의 속도는 0이다. 지속 기간은 같은 collider 쌍의 양수 겹침이 연속 관측된 구간이다. `진행`은
단계 오류 없이 끝난 틱, `깊이 ≥ 1`은 그중 큰 겹침이 남았던 틱 수다. 마지막 60틱의 조용한 쌍은
서로의 선속도와 각속도 크기가 각각 0.01 이하인 진행 표본으로 집계했다.

| 장면 / 경로 | 최대 깊이 @ 틱 | 쌍 및 동적 물체의 속도 | 지속 구간 / 진행 / 깊이 ≥ 1 | 마지막 60틱 최대 / 조용한 진행 쌍 최대 |
| --- | --- | --- | --- | --- |
| `rigid-materials` 현행 | 4.0241852 @114 | 고정 상자 발판 (610, 216) × 동적 공, (0, 339.71, 0) | 114–299 / 1 / 1 | 4.0241852 (동결) / — |
| `rigid-materials` 실험 | 4.0241852 @114 | 같은 발판 × 같은 공, (0, 339.71, 0) | 114–115 / 2 / 2 | 2.809784 / 0.009783 |
| `contacts-sensors` 현행 | 2.6360264 @51 | 고정 회전 상자 경사면 (548, 340) × 동적 공, (−36.47, 398.33, 0) | 51–52 / 2 / 2 | 0 (동결) / — |
| `contacts-sensors` 실험 | 4.2528687 @90 | 고정 바닥 상자 × 동적 공, (−135.23, 376.45, −7.40) | 90–92 / 3 / 2 | 0.010376 / 0.010376 |
| `collider-gallery` 현행 | 5.7482629 @49 | 고정 체인(복합 형상) × 동적 회전 상자, (0, 400, 0) | 49–299 / 1 / 1 | 5.7482629 (동결) / — |
| `collider-gallery` 실험 | 6.3751030 @52 | 같은 체인 × 같은 상자, (2.70, 191.97, −10.64) | 49–299 / 251 / 12 | 0.048608 / 0.012630 |

세 장면에서 기하 겹침을 센 모든 쌍이 충돌 유형, 그룹, 관절 및 접촉 훅을 통과했다. `max_ccd_substeps=1`은
최종 적분 뒤 narrow-phase를 다시 수행하지 않는다. 실험 경로에서 `rigid-materials`의 4.024185와
`contacts-sensors`의 4.252869는 최대 겹침을 확인한 다음 틱인 115와 91에 처음 solver contact로 나타났다.
두 공 모두 해당 최고점에서 CCD 비활성이었다. `rigid-materials`의 공은 그 틱에 약 5.66 단위를 전진했으며,
반경 22의 절반인 빠른 물체 판정 거리 11보다 작았다.

갤러리 상자는 49틱에 속도 400으로 약 6.67 단위를 진행했다. 두께 14의 절반인 7보다 작아 현행의 그
틱에서 CCD가 비활성이었다. 실험의 50틱에서 최초 solver contact 깊이 5.748263을 확인했다. 이후 상자가
회전하면서 52틱에는 CCD가 활성화됐고, 해당 틱의 solver contact는 2.436164, 적분 후 기하 겹침은
6.375103이었다. 이 쌍에는 이미 접촉이 생긴 뒤였으므로 피크를 첫 충돌 검출 시점으로 해석할 수 없다.
사용자가 제공한 `length_unit=50` 확인에서도 깊이는 줄지 않았다.

### P1b 결과

P1a 스위치를 테스트 전용 모드로 확장했다. 캐릭터가 있는 실험 장면은 Rapier KCC로 지형에 대한 이동과
초기 겹침 보정을 계산하고, 확정된 키네마틱 목표를 Rapier 일반 스텝으로 진행한다. 탑승자의 입력 이동을
발판의 현재 자세에서 계산한 뒤 이동한 지점을 발판의 다음 자세로 운반한다. 지지를 고를 때 벽이 첫 하향
충돌로 잡히면 걸을 수 있는 후보만 비교한다. 벽과 바닥을 한 복합 충돌체에 넣은 경우에도 각 부분을 확인한다.
군중은 이동 끝점의 캡슐 쌍에 최대 네 번 분리 보정을 적용하고, KCC로 지형에 막히는 보정을 제한한다.
이 실험은 지정 경로의 마지막 매듭을 사용하며, step-motion 캡처, 틱 중간 꺾임, 유한 질량 캐릭터 밀기 및
상대 운동 연속 충돌은 검증 범위 밖이다.

회전·이동 발판과 끼임 장면은 예열 뒤 1/60초로 300틱씩 비교했다. 회전 명령은 틱당 0.015rad, 이동
발판의 X 목표는 진폭 2.5의 사인 왕복이다. 미끄러짐은 실제 발판 좌표계에서 탑승자 시작점과 비교한
최대 수평 오차이며, 바닥 지지 대상이 발판에서 바뀐 틱을 따로 셌다. 끼임 장면은 지름 0.5인 캡슐의
양쪽 벽 간격을 0.58에서 0.48까지 줄인 뒤, 120틱부터 오른쪽 벽을 열었다. 캡슐 중심이 X=1을 넘긴
첫 틱을 탈출로 집계했다.

리뷰 후속 회귀는 발판을 틱당 0.05씩 세 틱 내린 뒤 세 틱 올리며 지지와 높이 오차를 확인한다.
옆 벽이 한 틱에 0.03 이동해 캡슐과 겹친 경우와 복합 충돌체의 벽이 바닥을 가린 경우도 확인한다.
틱이 시작되기 전에 입력이 거절되면 관측 시간은 0으로 기록한다. 실험 구현은 `experimental_tests.rs`에
있으며, 이 파일만 수정했을 때 Native Wasm 소스 지문이 유지되는 것을 확인했다.

군중은 `native-gameplay-navigation-probe.mjs`의 배치·캡슐·지형·추적·내비게이션 설정을 Rust의
동일한 `Engine` 경로에 넣었다. 0.01초 수동 예열 4틱 뒤 50ms 프레임 81개에서 405틱을 검증했다.
관측은 각 물리 틱 직후 수행했다. 마을 전투는 재현 범위에서 제외했다. 기존 장면은 Studio 문서에
TS 하네스가 런타임으로 적 32명의 보정 배치, 행동·투사체 규칙과 지형·모델 입력을 합성하며, Rust에
그 결합 입력과 프레임 기록을 동일하게 가져오는 픽스처가 없다. 단순 평지 전투는 마을 경사로와 건물
모서리, 투사체 충돌 재현을 대체할 수 없어 비교표에서 제외했다.

| 장면 | 비교 틱 | 오류 / 정지 수, 현행 → 실험 | 지지 이탈 / 최대 미끄러짐, 현행 → 실험 | 캐릭터 쌍 최대 겹침, 현행 → 실험 | release step 평균 / 최대 (µs), 현행 → 실험 |
| --- | --- | --- | --- | --- | --- |
| 회전 발판 | 300 | 290 / 290 (최초 틱 3, `CapacityExceeded`) → 0 / 0 | 0 / 0.0000020 → 0 / 0.0000035 | — | 7223.94 / 12145.44 → 8.34 / 95.21 |
| 이동 발판 | 300 | 0 / 0 → 0 / 0 | 0 / 0.0000029 → 0 / 0.0000006 | — | 33.65 / 143.28 → 7.56 / 35.19 |
| 끼임 해소 | 300 | 182 / 182 (최초 틱 2, `UnresolvedMotion`) → 0 / 0 | — | — | 400.09 / 901.81 → 25.97 / 146.74 |
| 64명 군중 | 405 | 0 / 0 → 0 / 0 | — | 0 → 0 | 3097.99 / 8396.98 → 491.16 / 593.98 |

회전 발판의 현행 미끄러짐은 발판 자체가 정지한 구간을 포함한다. 끼임 장면에서는 현행이 최소 간격 0.52에서
멈춰 탈출 틱이 없었다. 실험 경로는 간격 0.48까지 줄어들고 172틱에 탈출했다(개방 시작 뒤 52틱).
군중의 최소 목표 접근 거리는 0.07730 → 0.23365, 합계는 86.98011 → 90.74490이었다.
군중 `Engine::update`의 프레임 평균 / 최대는 21.387 / 27.811ms → 8.127 / 10.467ms였다.
step 시간은 물리 호출만 감쌌고, 외부 프레임에는 내비게이션·텔레메트리와 테스트 관측 비용이 들어간다.
release 비교는 한 스레드에서 순차 실행했다. 품질 수치는 디버그와 일치했다.

| 장면 | 현행 FNV-1a 64 | 실험 FNV-1a 64 | 독립 실행 2회 |
| --- | --- | --- | --- |
| 회전 발판 | `51ee2378b28e83f7` | `6c1a614133fcd930` | 각 경로 일치 |
| 이동 발판 | `725f7569f913a321` | `6b7f21ace3ab0ab8` | 각 경로 일치 |
| 끼임 해소 | `f79406ccb86ce505` | `3b67073449777327` | 각 경로 일치 |
| 64명 군중 | `0590a067ad35647f` | `9dcde82ecdea8586` | 각 경로 일치 |

발판과 끼임은 대상 강체의 틱별 자세·속도와 캐릭터 지지 상태를 해시했다. 군중은 프레임별 위치와
최종 내비게이션 카운터를 해시했고, 추가로 Native 체크포인트 직렬화 결과의 해시도 두 실행에서
일치했다(현행 `b9cdc35da5611650`, 실험 `f2607468f095f58f`).

**판단 — B 확정.** 실험 단계에서 회전 발판과 끼임의 정지를 해소했고, 이동·회전 발판 이탈 0과
64명 군중의 틱 후 겹침 0을 확인했다. 64명 군중의 단계 및 프레임 평균·최대 시간이 모두 줄었고,
동일 입력의 반복 실행도 각 경로에서 재현됐다. 전환 방향을 확정할 근거는 이 비교 결과다. 제품 경로의
허용 겹침 한도는 P1a의 충돌 피크·안정 후 수치를 기준으로 장면별로 정해야 한다. 현재 끝점 보정은 빠른
캐릭터가 한 틱 안에서 서로의 위치를 바꾸는 경우를 검증하지 못한다. 마을 전투와 투사체, 틱 중간 경로
전환, 유한 질량 접촉도 제품 전환 전에 별도 확인이 필요하다.

#### P2 초안

- `physics3d/character.rs`의 이동을 Rapier KCC 중심으로 재구성한다. 회전·이동 발판의 운반과 상대
  운동, 군중의 빠른 상대 충돌, 끼임 분리를 작은 별도 처리로 둔다. 경로 매듭을 유지해 한 틱 안의
  방향 전환을 처리하고, 발판이 벽과 탑승자를 동시에 밀 때의 결과와 마을 전투의 발사·명중을 검증한다.
- `physics3d/world.rs`와 `kinematic_paths.rs`는 일반 Rapier 실행을 기본으로 연결한다. 일반 CCD,
  관절, 필요한 개별 운동 관측 및 공개 상태 계약을 유지하고, 장면별 허용 한도와 결정성 검증을 세운다.
  제품 변경에 맞춰 군중·리플레이 기준 파일을 다시 만들고 CHANGELOG에 결과 변화를 기록한다.
- 전환 후 삭제할 코드의 목록은 `solver_trajectory`의 구간 증명과 전용 테스트,
  `character_motion`의 증명 이벤트·승인/거절·되돌리기, `kinematic_paths`의 증명 경로 중간 승인 검사,
  vendor의 Prepared Native CCD 및 증명 콜백이다. 일반 CCD와 경로·이벤트 관측에 필요한 공통 코드를
  먼저 분리하고, 계획의 P3에서 목록을 제거한 뒤 Core 빌드 시간과 Wasm 크기를 다시 잰다.

```bash
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1b_
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1b_compare -- --ignored --show-output --test-threads=4
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --release --lib p1b_compare -- --ignored --show-output --test-threads=1
```

P1a 비교 7건은 위 P1a 결과에 기록했다. 리뷰 후속 상태에서 P1b 선별 5건과 디버그·release 비교 각 4건이
통과했다. 최종 Core 전체 테스트 1회에서 단위 3,794건과 통합 1건이 통과했다.
`cargo clippy --all-targets -- -D warnings`, Rust 포맷, 문서 링크와 `native-wasm-source-identity`
검사도 통과했다. Wasm 빌드와 브라우저 smoke는 이번 범위에서 제외했다.

## P2a 작업 범위 (2026-11-27 사용자 승인)

P2를 강체 전환(P2a)과 캐릭터 전환(P2b)으로 나눈다. P2a는 캐릭터·지정 경로·step-motion이 없는 world만 바꾼다.
캐릭터·지정 경로·step-motion을 사용하는 world는 기존 증명 경로를 유지한다. 경로는 장면 구성으로 정해지며, 실패 뒤 다른 방식으로 넘어가는 fallback이 아니다.

- **기본 경로 전환**: 위 조건의 world는 `continuous`가 켜져 있어도 증명 경로를 타지 않고 Rapier 일반 step과 Rapier CCD로 진행한다.
  P1a의 `RigidRapier` 실험을 기본값으로 만들고, 그 테스트 전용 스위치는 지운다. 캐릭터가 있는 world는 바꾸지 않는다.
- **처음 닿는 순간의 겹침**: P1a의 세 장면(`rigid-materials`, `contacts-sensors`, `collider-gallery`)에서 첫 접촉 겹침을 잰다.
  Rapier `soft_ccd_prediction`을 내부 기본값으로 쓰면 줄어드는지 시험한다. 효과가 분명하고 결정성과 step 시간 기준을 지키면 적용하고,
  아니면 수치만 남긴다. 공개 설정으로는 내놓지 않는다. 장면별 겹침 한도를 제안한다.
- **기존 테스트**: 강체 world로 증명을 시험하던 테스트 중 동작을 보는 것은 새 기대값으로 고친다. 증명 자체만 보는 것은
  테스트 전용 강제 스위치로 증명 경로를 유지하고 P3 삭제 목록에 올린다.
- **오류 검사**: `tests/smoke/native-checked-error-probe.mjs`는 강체 world의 `CapacityExceeded`에 기대므로, 오류를 일으킬 사례를 새로 정한다.
  틱 되돌리기, 체크포인트 복원, 저장 파일 불변 같은 검사 내용은 유지한다.
- **물리 실험실·예제**: `sandbox_scene_tests`의 ignored 3건을 일반 테스트로 바꾼다. `examples/shared/physicsExamples.json`의 `knownIssue` 4개와
  브라우저 smoke의 예외 목록도 지운다. 실험실의 오류 표시 기능은 남긴다. 벽돌 깨기 예제는 연속 충돌을 다시 켜고 멈추지 않는지 확인한다.
- **기준 파일**: 바뀌는 기준 파일만 다시 만든다. 64명 군중 hash는 캐릭터 world라 바뀌지 않아야 한다.
- **문서**: 공개 문서의 `continuous` 설명을 고친다. 대상은 Rapier CCD 대상, 처음 닿는 순간의 겹침, 증명 오류가 캐릭터 world에서만 남는 점이다.
  CHANGELOG의 미배포 항목에 강체 물리 결과 변화를 공지한다. 통합 3D 물리 계획의 미해결 절과 이 문서에 P2a 결과를 적는다.

### P2a 결과

강체만 있는 world는 캐릭터·지정 경로·step-motion이 없을 때 `continuous`와 관계없이 일반 step을 사용한다.
평면·공간에서 `continuous: true`는 빠른 동적 물체와 고정물의 Rapier CCD를 켠다. `ccd: true`인 동적 물체는
운동학적 물체와 `ccd`를 켜지 않은 동적 물체도 탐색한다. `RigidRapier` 테스트 스위치는 제거했다.
P1a의 과거 대조군은 `force_rigid_motion_proof`, P1b의 캐릭터 실험은 기존 `CharacterKcc`로 재현한다.
체크포인트와 저장 파일 롤백 검사는 먼 곳에 캡슐 캐릭터를 등록한 제품 world에 경사 메시와 빠른 상자를
배치해, 실제 `CapacityExceeded`를 0초 승인 상태에서 일으킨다.

#### 첫 접촉과 soft CCD

300틱 동안 양의 기하 겹침이 처음 관측된 틱을 접촉 에피소드의 시작으로 집계했다. 한 쌍이 떨어졌다가
다시 겹치면 새 에피소드다. 시작 깊이의 최댓값과 전체 틱의 피크를 구분했다. 틱 중 정확한 접촉 순간보다
틱 종료 자세를 표본으로 사용했다. 센서와 solver가 배제하는 쌍은 집계에서 제외했다. 후보는 동적 물체에
달린 활성 고체 콜라이더의 최소 CCD 두께 × 0.5를 각 물체의 `soft_ccd_prediction`에 설정했다.
일반 접촉 예측 거리 0.02와 허용 겹침 0.005 등 기존 적분 값은 유지했다.

| 장면 | 첫 접촉 최대 깊이 @ 틱, 기본 → 후보 | 전체 피크, 기본 → 후보 | 권고 상한 (첫 접촉 / 전체 피크 / 마지막 60틱의 정지 쌍) |
| --- | --- | --- | --- |
| `rigid-materials` | 4.0241852 @114 → 0.0002766 @0 | 4.0241852 → 0.0103378 | 4.5 / 4.5 / 0.02 |
| `contacts-sensors` | 4.2528687 @90 → 0.0885620 @125 | 4.2528687 → 0.0885620 | 4.75 / 4.75 / 0.02 |
| `collider-gallery` | 5.7482629 @49 → 2.5464621 @53 | 6.3751030 → 2.5464621 | 6.0 / 6.75 / 0.02 |

권고 상한은 이 세 장면의 월드 단위에서 현재 피크에 여유를 더한 값이다. 정지 쌍 상한은 P1a 추적의
마지막 60틱 수치에 근거한다. 제품이나 회귀 테스트의 제약으로 아직 적용하지 않았다.

| 장면 | 릴리스 step 평균 / 최대의 중앙값(µs), 기본 → 후보 | 300틱 상태 hash, 기본 → 후보 |
| --- | --- | --- |
| `rigid-materials` | 15.45 / 162.85 → 14.16 / 87.54 | `2ce2bad1c7df0104` → `090358931228e0f2` |
| `contacts-sensors` | 9.94 / 71.39 → 9.13 / 51.35 | `5bace87fd58058d8` → `e8589d96f648ad87` |
| `collider-gallery` | 29.05 / 134.62 → 26.75 / 235.63 | `28a5274030db0df8` → `b45cc1dcf717e7f5` |

릴리스 단일 스레드 테스트를 CPU 5에 고정하고 30회 실행했다. 실행마다 장면·설정별로 300틱을 두 번 실행했고,
위 표는 각 실행의 평균과 최대를 모은 60개 표본의 중앙값이다. 타이머에는 수동 물리 스텝만 포함했다.
장면·설정별 두 실행의 hash는 일치했고 단계 오류와 바닥·체인 관통은 검출되지 않았다.
CPU를 고정하지 않은 별도 15회에서는 `contacts-sensors`의 최대 중앙값도 27.40 → 32.12µs로 늘었다.
겹침 개선과 동일 입력 결정성을 확인했지만 틱 최대 비용이 증가하지 않는다는 조건을 확인하지 못해
soft CCD 기본값은 Rapier의 0으로 유지했다.

```bash
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --release --lib p2a_compare_soft_ccd --no-run
# 위 명령이 출력한 릴리스 테스트 바이너리를 사용한다.
for run in {1..30}; do
  taskset -c 5 "$test_binary" p2a_compare_soft_ccd --ignored --show-output --test-threads=1
done
```

#### 회귀 검증

| 검증 | 결과 |
| --- | --- |
| Core 전체 테스트 · Clippy · 포맷 | Rust 1.97.1에서 단위 3,797건과 통합 1건 통과, 수동 측정 13건은 기본 실행에서 제외. `--all-targets -- -D warnings`와 Rust 포맷 검사 통과 |
| Native 물리 실험실과 벽돌 깨기 | 일반 테스트로 되돌린 3개 장면은 각각 300틱 무오류. 별도 300틱 관절 비교는 관절 7개 유지, weld 앵커 최대 이격 0.0713455. 넓은 패들로 발사하는 벽돌 깨기 Rust 비교에서 틈 진입 13틱, 벽돌 4개, 오류·지정 장벽 관통 0. 얇은 지형의 고속 낙하는 CCD 클램프 1회 |
| Wasm · SDK | 배포용 Wasm 지문 `11069d5bf39a8803` 일치. 지문 검사와 SDK 테스트 292건, SDK 빌드 헬퍼 검사 2건 통과 |
| Chromium 물리 실험실 · 벽돌 깨기 | `physics-sandbox`와 `physics-demo-suite` 7개 장면이 각각 추가 300프레임 무오류. 실제 예제의 넓은 패들을 고정하고 세 번 발사해 점수 160, 벽돌 11개 제거, 정상 게임 오버까지 진행 |
| Chromium 오류 복구 | SDK tarball의 자동·수동(기본·설정 명시) 3개 경로에서 실제 작업량 한도 초과와 롤백·체크포인트 복원·메시 제거 후 재시작 확인. 두 수동 경로의 저장 파일은 각각 448,482바이트로 거절 전후 완전히 동일 |
| Chromium 64명 군중 | 고정 50ms 입력에서 81프레임·405스텝. 상태 SHA-256 `da6e9fd49d89addd7d87e6a7b296f1a82bca7ff2ff7542c890c4544aace6776d` 유지. 최종 실행에서 Rust 최대 36.2ms와 기존 프레임 예산 통과 |
| 기준 파일 | `update-fixture`로 Minimal·Topdown·Platformer·Breakout 리플레이 기준 파일 갱신. Native 파일 SHA-256, snapshot hash, replay hash만 변경. 템플릿 패키지와 리포트 검사 통과. broad-phase golden은 기존 바이트 검사를 통과해 유지 |
| 문서 | 공개 `continuous`·`ccd` 동작과 첫 접촉 겹침, 증명 경로의 남은 오류를 Core API·Physics Spec·통합 계획에 반영. 미배포 CHANGELOG와 문서 링크 검사 완료 |

검증은 저장소 루트에서 실행했다. 브라우저의 두 실험실 모드는 같은 Wasm으로 만든 실험실 빌드를
`node tests/smoke/browser-render-smoke.mjs --mode=physics-sandbox <lab-dist>`와
`--mode=physics-demo-suite <lab-dist>`에 각각 넘겼다. 오류 복구와 군중은
`tests/smoke/unified-physics-browser-smoke.mjs`가 사용하는 개별 probe를 추출한 SDK tarball에 연결해 실행했다.
군중의 첫 실행은 SwiftShader를 명시한 Chromium 1243에서 렌더 시간 392.7ms로 125ms 상한을 넘었고,
그때도 405스텝 결과 hash는 같았다. Chromium 1223의 기본 그래픽 선택으로 재실행해 기존 단언을 모두 통과했다.


```bash
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline -- --test-threads=6
cargo +stable clippy --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --all-targets -- -D warnings
cargo +stable fmt --manifest-path crates/ferrum-core/Cargo.toml --all -- --check
pnpm build:wasm
node --test tests/smoke/native-wasm-source-identity.test.mjs
node scripts/package/native-wasm-source-identity.mjs
pnpm test:web
pnpm --filter @ferrum2d/physics-sandbox build
pnpm --filter @ferrum2d/example-site build
pnpm --filter @ferrum2d/example-site lint
node scripts/package/check-create-game-package.mjs --verify-pack --skip-build
node tests/smoke/create-game-template-report-envelope-smoke.mjs
pnpm validate:rust-test-harness
pnpm validate:docs-links
```

## P2b 작업 범위 (2026-11-27 사용자 승인)

P2a 뒤 증명 경로를 타는 world는 세 종류다. P2b는 셋을 모두 일반 Rapier 경로로 옮겨, 제품에서 증명 경로가 쓰이지 않게 만든다.

| 대상 | 지금 증명 경로를 타는 이유 | P2b에서 할 일 |
| --- | --- | --- |
| 캐릭터 | 캐릭터가 하나라도 있으면 항상 증명 경로 | P1b의 `CharacterKcc` 실험을 제품 경로로 만든다. 지형 이동은 Rapier KCC, 발판 운반·군중 분리·끼임 해소만 작은 자체 처리로 둔다 |
| 지정 경로(키네마틱 경로) | 경로 매듭에서 한 틱 안의 방향 전환을 증명으로 처리 | 매듭 단위로 틱을 나누는 등 증명 없이 처리한다. P1b 실험은 마지막 매듭만 썼다 |
| step-motion(투사체 cast) | 투사체가 틱 안에서 움직이는 대상을 맞히는지 정확 증명으로 계산(`queries/step_motion.rs`) | 틱 시작·끝 자세의 보간과 parry cast로 바꾼다. 마을 전투의 발사·명중으로 확인한다 |

P1b가 남긴 확인 항목도 P2b에서 처리한다.
- 빠른 캐릭터 둘이 한 틱 안에 서로 위치를 바꾸는 경우: 끝점 분리 보정만으로는 놓친다. 상대 운동 sweep 같은 최소 처리를 둔다.
- 유한 질량 캐릭터가 동적 물체를 미는 경우, 발판이 벽과 탑승자를 함께 미는 경우.
- 빠른 키네마틱 발판과 `ccd`를 켜지 않은 동적 물체: Rapier는 키네마틱 물체를 sweep하지 않는다. 측정해서 문제가 보이면 최소 처리를 둔다.

규칙.
- 품질 기준은 "사용자 결정 (2026-11-27)"의 표를 쓴다. 기준을 못 맞출 때 증명 같은 새 장치를 덧붙이지 않는다. 멈추고 기록한 뒤 보고한다.
- 공개 API와 TS 타입은 바꾸지 않는다. 뜻이 달라지는 옵션이 있으면 문서에 적고 보고한다. vendor 파일과 의존성은 바꾸지 않는다(vendor 정리는 P3).
- 끝나면 제품 빌드에서 증명 경로로 들어가는 조건이 없어야 한다. 증명 경로는 테스트 전용 강제 스위치로만 남기고 P3 삭제 목록을 갱신한다.
- `native-checked-error-probe`: 제품에서 증명 오류가 사라지면, 틱 되돌리기를 일으키는 실제 실패 사례가 남는지 찾는다. 없으면 되돌리기 계약을 어떻게 검사할지 제안하고, 계약 자체는 지우지 않는다.
- 결과가 바뀌는 기준 파일(64명 군중 hash, 리플레이 fixture, `FULL_MARGIN_QUERY_GOLDEN` 등)을 다시 만든다. CHANGELOG 미배포 항목에 캐릭터·투사체 결과 변화를 공지한다.
- 하위 단계(캐릭터, 지정 경로, 투사체)마다 커밋한다.

### P2b 결과

**2026-11-27 첫 제품 전환 검토는 캐릭터 단계에서 보류.** P1b의 테스트 전용 경로에서 캡슐 쌍의 상대 이동을 Parry로 cast하고,
최초 충돌 시점에서 이동을 제한했다. 끝점 분리 보정과 발판 운반은 유지했다. 유한 질량에는 예약된
충격과 외력을 적분하고, Rapier KCC가 제공하는 충돌 충격 계산으로 동적 물체를 미는 후보를 시험했다.

| 장면 | 기존 제품 경로 | KCC 후보 |
| --- | --- | --- |
| 빠른 캡슐 두 개의 교차 | — | 0.1초에 각각 속도 20으로 서로 향하는 캡슐이 위치를 바꾸지 않았다. 중심 간격 0.5(오차 0.00001)와 두 캐릭터의 차단 상태를 검사했다. |
| 이동 입력으로 질량 2 상자 밀기 | 캐릭터와 상자의 X 속도 각각 5.000, 합산 운동량 20.000 | 캐릭터 4.899, 상자 4.649, 합산 운동량 19.096. 동적 물체에는 유한한 반응이 전달됐다. |
| 입력 없이 외부 충격 10을 한 번 받은 질량 2 캐릭터, 50틱 | 평면·공간에서 캐릭터와 상자의 X 속도 모두 2.500, 합산 운동량 10.000 | 평면·공간에서 캐릭터 3.982, 상자 4.391, 합산 운동량 16.744. 기존 브라우저 검사의 운동량 오차 0.1을 넘었다. |
| 발판과 탑승자가 벽에 접근 | 발판 중심 X=0.760, 탑승자 X=1.040, 접지 유지, 벽과 겹침 0 | 발판 중심 X=1.500, 탑승자 X=1.040, 접지 유지. 발판이 벽과 X축으로 0.200 겹쳤다. |

후보의 KCC 충격 계산은 동적 물체의 속도를 바꾸지만 캐릭터의 저장된 외부 속도에서 반작용을
차감하지 않는다. 이동 입력을 주지 않아도 다음 틱마다 남은 외부 속도로 다시 미는 것을 확인했다.
운반 cast는 탑승자의 이동만 제한하고 발판의 지정 목표는 그대로 두므로, 발판의 강체 접촉 한도도
지키지 못했다. 새 증명이나 추가 접촉 solver를 도입하기 전에 캐릭터 단계에서 전환을 중단했다.

P1b 비교 네 건도 다시 실행했다. 후보는 회전·이동 발판에서 300틱 동안 각각 오류와 지지 이탈이
0건이었고, 끼임 장면에서는 벽을 열기 시작한 뒤 52틱이 지나 탈출했다. 64명 군중은 405틱 동안
오류와 관측한 겹침이 0건이었다. 동일 입력을 두 번 실행해 얻은 후보의 상태 해시는
`9dcde82ecdea8586`로 일치했다. 이번 비교는 디버그 실행으로, 릴리스 step 시간은 P1b의 측정 기록을 참조한다.

제품의 캐릭터·지정 경로·step-motion 분기와 롤백 계약은 기존 상태다. 이 비교는 제품에서 실제
롤백 실패 사례가 사라졌는지에 대한 판단 근거가 아니다. 지정 경로와 투사체 전환, P3 삭제, 기준
파일 재생성, 옵션 의미와 미배포 변경 기록 동기화는 제품 경로가 품질 검증을 통과한 뒤 진행한다.

```bash
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p2b_ -- --include-ignored --show-output
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1b_ -- --test-threads=6
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1b_compare -- --ignored --show-output --test-threads=4
```

#### 보류 상태 검증

Core 전체 테스트는 단위 3,799건과 통합 1건이 통과했고, 수동 비교 16건은 기본 실행에서 제외했다.
`cargo clippy --all-targets -- -D warnings`, Rust 포맷과 테스트 구조 검사, `pnpm test:web`의 SDK 테스트 292건,
문서 링크 검사도 통과했다.

새 Rust 코드는 빌드의 테스트 모듈에만 있다. `native-wasm-source-identity`에서 Core 소스 지문
`11069d5bf39a8803`이 기존 Wasm과 일치하므로 그 Wasm을 재사용했다. 현재 제품 기준으로
통합 물리 Web, 마을 전투(8개 조합), Platformer, Top-down HD-2D, 물리 실험실 두 스모크를 통과했다.
통합 물리 Web은 기존 64명 군중 SHA-256과 실제 오류 롤백, 유한 질량 충격 계약을 확인했다.
HD-2D 전투 첫 실행은 적 32명·1280×720·DPR 1에서 9프레임이었다. 다른 Chromium으로 단독 재실행했을
때는 그 조합에서 15프레임, 적 0명·1280×720·DPR 2에서 4프레임이었다. 두 실패 모두 최소 10프레임
단언에서 발생했고 페이지가 수집한 오류는 없었다. 두 실행 모두 같은 기존 Wasm을 사용했다.

#### 2026-11-28 재개 결정

- 양수 `pushMass`는 KCC 충돌 충격 전후의 동적 물체 선운동량 차이 `J`를 합산한다.
  반작용 `J / pushMass`를 캐릭터의 저장된 외부 속도에서 뺀다. 외부 충격 10을 한 번 준 뒤
  50틱의 평면·공간 합산 운동량은 각각 10.000이었다. 이동 입력으로 상자를 미는 장면은 캐릭터
  X 속도 4.899, 상자 4.649, 합산 운동량 19.096으로 다시 측정했다.
- 지정 발판과 접지한 탑승자의 이동을 외부 콜라이더에 검사한다. 막힌 묶음은 해당 틱을 시작
  자세에서 보낸다. 벽 접근 재현에서 발판 X=0, 탑승자 X=0.28, 벽 겹침 0, 접지 유지였다.
  후보의 `kinematicPathStops`는 1이었다. 임시 제품 연결에서는 `blockedPlatforms` 집계에 쓰는
  경로 상태를 진행률 0과 차단으로 기록했다. 이 실험은 기존 지정 경로와 같은 비동적 차단 대상을
  사용했다. 빠른 키네마틱과 동적 물체의 상호작용은 지정 경로 단계에서 확인한다.
- 브라우저 스모크는 로컬에서 실행한다. HD-2D 전투의 최소 10프레임 실패가 나오면 제품 Wasm과
  `main`의 소스 지문을 비교한다. `main`에서의 별도 재현은 통합 담당 범위다.

#### 재개 후 품질 검증

두 재개 기준을 통과해 KCC를 캐릭터 제품 경로에 임시 연결했다. 기본 캐릭터 시험 26건은 통과했다.
동적 캐릭터 시험에서는 9건 통과, 6건 실패, 1건 제외였다. 아래 두 회귀는 제품 경로와 테스트 후보를
같은 입력으로 비교해 다시 확인했다. 속도와 이동은 모두 X축 기준이다.

| 재현 장면 | 기존 제품 경로 | KCC 후보 |
| --- | --- | --- |
| 속도 -10으로 접근한 질량 2 상자가 질량 2 캐릭터와 충돌 | 충돌 뒤 캐릭터 속도 -4.933, 상자 -5.067 | 캐릭터 0, 상자 -10. 캐릭터가 움직여 만드는 KCC 충격 목록에 이 접촉이 없다. |
| 회전이 잠긴 동적 지지체가 탑승자를 싣고 벽까지 이동 | 발판 이동 0.200, 탑승자 운반량 0.200 | 발판 이동 0.195, 탑승자 운반량 0. 지형 cast에 쓰는 운반 후보는 키네마틱 지지체만 처리한다. |

동적 지지체에서 탑승자가 미끄러져 2026-11-27의 발판 품질 기준을 충족하지 못했다. 동적 상자가
먼저 접근하면 두 물체의 충격 교환도 사라졌다. 벽을 치운 뒤 저장된 밀림이 다시 나타나는 검사와
한 틱 내 유한 질량 충돌·여러 캐릭터의 운동량 전달을 확인하는 검사 세 건도 실패했다.
임시 제품 연결을 되돌리고 승인된 두 처리와 진단을 테스트에 남겼다.
재현 명령은 위의 `cargo … --lib p2b_ -- --include-ignored --show-output`이며,
`p2b_compare_incoming_impact_and_dynamic_support`에서 두 경로의 수치를 출력한다. 캐릭터 전환이
보류되어 지정 경로·투사체·롤백 검사·기준 파일·P3 삭제 목록과 공개 변경 기록은 기존 상태다.

최종 후보에서 P1b 비교 네 건도 다시 실행했다. 지정 회전·이동 발판에서 300틱 동안 오류와 접지
이탈은 각각 0건이었다. 최대 수평 미끄러짐은 회전 0.0000035, 이동 0.0000006이었다. 끼임은
열림 시작 52틱 뒤에 풀렸다. 64명 군중은 405틱 동안 오류·정지·겹침 0건, 두 번 실행한 해시
`9dcde82ecdea8586`이 일치했다. 이번에는 디버그 결과만 비교했다.

`origin/main` (`c931e948`)과 현재 Core의 제품 소스를 같은 방식으로 해시했다. 두 소스 지문과 기존
제품 Wasm에 내장된 지문은 `11069d5bf39a8803`으로 일치했다. 사용한 제품 Wasm의 SHA-256은
`14d0b988db53d1debcb0427904a33bbe8fdeea605cedfde15887cf5a9d4ec980`이다. 이 Wasm을
재사용했고 HD-2D 전투의 최소 프레임 실패는 재실행하지 않았다.

최종 상태에서 Core 전체 단위 테스트 3,801건과 통합 테스트 1건, `p2b_` 비교 5건, Rust 포맷,
`clippy --all-targets -- -D warnings`, 테스트 구조 검사, `native-wasm-source-identity` 검사,
SDK 테스트 292건, 문서 링크 검사가 통과했다. 64명 군중의 기존 제품 브라우저 검사가 405스텝의
기존 해시와 체크포인트 재현을 확인했다. 같은 통합 물리 Web 실행에서 기존 오류 롤백 검사도 통과했다.
마을 전투 8개 조합, Platformer, Top-down HD-2D, 물리 실험실 단일 장면과 전체 7개 장면도
통과했다. 로컬 스모크는 같은 Wasm을 재사용해 각 명령의 Node 실행부를 직접 돌렸다.

#### 2026-11-28 사용자 결정 B

- `pushMass`가 양수여도 들어오는 접촉에서 캐릭터는 Rapier 키네마틱 바디로 처리한다. 물체는
  접촉으로 멈추거나 튕긴다. 게임이 자동 피격 밀림을 원하면 `drainUnifiedPhysicsCollisionEvents`로
  충돌을 읽어 `applyUnifiedPhysicsCharacterImpulses`를 호출한다. 캐릭터끼리는 이동을 막으며
  운동량을 교환하지 않는다. A는 Rapier 위에 자체 운동량 교환을 다시 쌓아야 하므로 채택하지 않았다.
- 캐릭터가 물체를 밀 때의 가상 질량과 반작용, 외부 힘·충격 명령은 유지한다. 외부 속도가 벽에
  막히면 그 방향 성분을 지운다.
- 동적·키네마틱 지지체의 실제 이동과 회전을 접지점에 적용한다. 동적 지지체 이동과 탑승자
  운반량의 차이는 0.005 이내로 확인한다. 벽 앞에서 발판·탑승자 묶음을 정지시키는 계약은 유지한다.

#### 결정 B 적용 시험

| 장면 | Rapier KCC 후보 결과 |
| --- | --- |
| 벽까지 이동하는 동적 지지체 | 지지체 이동 0.19499996, 탑승자 운반 0.19499993. 회전하는 접지점 추적과 접지도 통과했다. |
| CCD 상자가 캐릭터에 충돌 | 캐릭터 X는 0이고 접선 방향 이동은 이어졌다. 최대 모양 겹침은 0.004995391이었다. 상자는 충돌로 회전했고 X 속도가 −10에서 −0.942267로 줄었다. 충돌 이벤트 뒤 게임이 충격 −10을 주자 캐릭터가 X 방향으로 −0.5 이동했다. |
| 캐릭터 밀기·외부 충격·군중 | 상자 밀기의 반작용을 캐릭터에 기록했다. 평면·공간의 수동 충격 10에서 합산 운동량 10.000을 유지했다. 캐릭터끼리는 막기만 하며 그 뒤의 상자가 밀리지 않았다. 외부 속도는 벽에 막힌 뒤 벽을 제거해도 다시 나타나지 않았다. |

제품 분기에 임시 연결해 캐릭터 시험군(`cargo test … --lib physics3d::character`)을 실행했다.
294건 통과, 27건 실패, 2건 제외였다. 실패에는 증명·정확한 접촉 시각을 직접 검증하는 시험이
있지만, 빠른 키네마틱 장애물이 캡슐을 통과하는 동작 회귀도 확인했다. 0.1초에 X=3에서 X=-3으로
지나가는 위치 키네마틱 벽 장면에서 기존 제품은 캡슐을 X=-3.51 부근으로 옮겼다. KCC 후보에서는
벽만 반대편으로 이동했고 캡슐의 X는 0이었다. 아래에서 올라온 키네마틱 승강기도 캡슐을 찾지 못해
기존 지지체가 없던 캡슐의 높이 0.5를 그대로 두었다. 두 바디가 모두 키네마틱이면 Rapier의 강체 접촉
해석이 둘 중 하나의 위치를 바꾸지 않으며, KCC의 정지 장면 질의는 움직이는 벽의 경로를 검사하지 않는다.
동적 물체의 충돌 방향을 바꾼 결정 B는 키네마틱 장애물 통과를 허용하지 않는다.

기존 키네마틱 관통 회귀로 임시 제품 연결을 되돌렸다. 결정 B의 여섯 가지 비교·회귀와
키네마틱 벽 재현은 `cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p2b_ -- --include-ignored --show-output`으로 실행한다.
지정 경로·투사체·롤백 프로브·기준 파일·P3 목록, 제품 브라우저 기대값과 공개 변경 기록의 갱신은 보류했다.

최종 테스트 후보에서 P2b 비교·회귀 12건과 P1b 수동 비교 4건이 통과했다. 회전·이동 지지체는
각각 300틱 동안 접지 이탈과 오류가 없었다. 군중은 405틱 동안 오류·정지·겹침이 없었고 두 번
실행한 후보 동작 해시 `9dcde82ecdea8586`이 일치했다. Core 전체는 단위 3,807건과 통합 1건이
통과했다. Rust 포맷, `clippy --all-targets -- -D warnings`, 테스트 구조, SDK 테스트 292건,
공개 API 표면과 문서 링크 검사도 통과했다.

제품 Wasm과 `origin/main` (`c931e948`)의 Core 소스 지문은 `11069d5bf39a8803`이다. 이 Wasm을
로컬 브라우저 검증에 재사용했다. 통합 물리 Web에서 405스텝 기존 군중 해시와 오류 롤백을 다시
확인했다. 마을 전투 8개 조합, Platformer, Top-down HD-2D, 물리 실험실 단일 장면과 전체 7개
장면도 각 Node 스모크를 로컬에서 실행해 통과했다. HD-2D 전투의 최소 프레임 실패는 재실행하지
않았다.

#### 2026-11-28 움직이는 키네마틱 물체 결정

위치·속도 키네마틱과 지정 경로의 이동을 주변 캐릭터에 cast한다. 회전에는 Parry 비선형 cast를
사용한다. 닿으면 남은 이동을 KCC로 밀고, 밀림이 막히면 바디와 이동 묶음을 틱 시작 자세에
남겨 `kinematicPathStops`에 센다. 빠른 벽의 캡슐 위치는 X=-3.51에서 0.005 이내여야 한다.
위로 오는 승강기는 캐릭터를 받아 다음 틱에도 접지와 운반을 유지해야 한다. 끼임에서는 본래
물체와 캐릭터 사이 겹침을 Rapier 허용 오차 안에 둔다.

#### 임시 제품 연결에서 실패한 캐릭터 시험 27건

이전 `cargo test --lib physics3d::character`의 실패를 단언의 목적에 따라 분류했다. 기하 결과는
Rapier 허용 겹침, 관통 방지, 접지와 운반으로 검사한다. 기존 정밀 접촉 시각과 증명 카운터가 필요했던
단언은 보수적인 틱 전체 정지 결과 또는 테스트 전용 증명 대조군으로 남기는 것이 기준이다.

| 시험 | 분류 | 전환 기준 |
| --- | --- | --- |
| `incoming_wall_push_propagates_to_another_capsule_with_free_space` | 동작 | 열린 공간에서 선두 캡슐과 뒤의 캡슐이 벽 앞에 있고 순서와 간격을 유지한다. |
| `capsule_chain_transmits_fixed_wall_obstruction_back_to_the_prescribed_pusher` | 동작·정지 시각 | 끝이 막히면 키네마틱과 밀린 캡슐의 변위를 폐기하고 겹침 없이 정지한다. |
| `free_capsule_chain_is_pushed_without_a_false_squeeze_stop` | 동작 | 열린 8·16·32명 줄에서 벽의 통과나 불필요한 정지가 없어야 한다. |
| `coupled_push_preserves_tangential_input_and_planar_locks` | 동작 | 밀리는 동안 접선 입력과 planar Z 잠금을 보존한다. |
| `oblique_wall_normals_push_a_capsule_pair_in_the_actual_world_direction` | 동작 | 기울어진 벽은 실제 월드 표면 법선 쪽으로 밀고 캡슐 순서를 보존한다. |
| `a_distant_fast_obstacle_does_not_loosen_local_capsule_contact_tolerance` | 동작 | 먼 장애물과 무관하게 가까운 캡슐 쌍의 겹침을 제한한다. |
| `pair_contacts_reduce_reported_carry_to_the_accepted_motion` | 동작·정지 시각 | 막힌 운반 묶음은 정지한다. 보고 운반량, 접지, 체크포인트, 역방향 운반을 확인한다. |
| `excluded_capsule_pairs_do_not_transmit_pushes_or_consume_pair_query_work` | 동작 | 마스크로 제외한 쌍은 충돌·밀림을 교환하지 않고 각각 벽에 반응한다. |
| `a_disabled_controller_does_not_push_an_enabled_character` | 동작 | 비활성 캐릭터는 고정 상태를 유지하며 활성 캐릭터만 벽에 반응한다. |
| `forty_independent_moving_entries_keep_all_twenty_real_stops_and_checked_full_tick_replay` | 동작·증명 분할 | 독립적인 20개 정지, 겹침, 같은 틱의 리플레이를 보존한다. 증명 분할 수는 내부 비교에 속한다. |
| `angular_suffix_retains_static_ceiling_and_old_stop_prefix_for_single_and_aggregate` | 증명 | 회전 suffix·prefix 대조군이다. 제품에서는 회전 cast와 천장 겹침을 검사한다. |
| `selected_pusher_handoff_preserves_checked_squeeze_endpoints_and_native_call_count` | 증명 | 개별 pusher handoff 및 Native 승인 횟수 대조군이다. 제품은 틱 시작 정지와 겹침을 검사한다. |
| `late_promotion_returns_zero_time_command_credit_before_a_fresh_plan` | 증명 | 승인 시각 0에서의 승격·credit 대조군이다. 제품 롤백은 공개 계약으로 따로 검증한다. |
| `fast_incoming_wall_pushes_an_idle_capsule_without_passing_through` | 동작 | 0.1초 X=3→−3 벽에서 캐릭터 X=-3.51±0.005를 검사한다. |
| `incoming_elevator_catches_a_previously_unsupported_capsule` | 동작 | 아래에서 받은 캐릭터가 올라가고 다음 틱에도 접지·운반한다. |
| `incoming_wall_preserves_the_capsules_tangent_locomotion` | 동작 | 벽에 밀리면서 접선 입력을 유지한다. |
| `locomotion_does_not_hit_the_old_pose_of_a_receding_wall` | 동작 | 캐릭터가 멀어지는 벽의 시작 자세에 막히지 않는다. |
| `moving_obstacle_filters_preserve_sensors_masks_and_planar_floors` | 동작 | 센서, 충돌 마스크, planar 층 필터를 존중한다. |
| `moving_one_way_surface_catches_from_above_and_passes_from_below` | 동작 | 단방향 표면의 허용 면에서만 받쳐 준다. |
| `velocity_based_wall_uses_the_same_relative_response_and_reports_query_work` | 동작·통계 | 속도와 위치 명령의 물리 결과를 비교한다. 실제 cast를 세며 증명 카운터는 요구하지 않는다. |
| `a_stopped_command_is_consumed_and_a_new_command_resumes_after_obstacle_removal` | 동작·정지 시각 | 정지 명령은 소비되며 장애물을 치우고 새 명령을 주면 재개한다. |
| `commanded_wall_stops_when_its_capsule_reaches_a_fixed_wall` | 동작·정지 시각 | 네 가지 공간·바디 종류에서 틱 시작 자세, 정지 1건과 겹침 한도를 검사한다. |
| `commanded_elevator_stops_below_a_ceiling_and_keeps_its_rider_grounded` | 동작·정지 시각 | 천장에 닿을 운반 묶음은 틱 시작에 남으며 접지를 유지한다. |
| `two_incoming_commanded_walls_stop_together_around_a_capsule` | 동작·정지 시각 | 양쪽 벽과 캡슐이 통과하지 않고 양쪽 명령이 정지한다. |
| `squeeze_events_preserve_unrelated_jump_input_and_full_tick_translation` | 동작·정지 시각 | 끼임에 관여하지 않은 이동·점프는 전체 틱에 한 번만 적용된다. |
| `more_than_sixteen_independent_external_commands_can_stop_in_one_tick` | 동작·정지 시각 | 직접 입력한 16개 이상의 명령을 각각 정지시키고 겹침을 제한한다. |
| `rotating_rider_with_locomotion_meets_wall_in_one_tick` | 동작·정지 시각 | 회전과 입력을 합성할 때 벽을 통과하지 않으며, 막힌 운반 묶음은 접지를 잃지 않는다. |

위 캐릭터 시험군은 KCC 제품 연결에서 321건 통과, 실패 0건, 수동 비교 3건 제외였다.
정지 관련 시험은 틱 중간의 좌표 대신 틱 시작 자세와 `kinematicPathStops`를 확인한다.
캡슐 간격은 허용 겹침 0.005로 확인한다. 증명 내부의 suffix, handoff, zero-time credit
세 시험은 테스트 전용 강제 경로에 두며 P3 때 제거한다. 빠른 벽, 두 틱 승강기와
회전 중간에만 닿는 문 사례를 포함한 캐릭터 운동 시험 10건도 통과했다.

| 키네마틱 후보 확인 장면 | 통과 기준 |
| --- | --- |
| X=3→−3 빠른 벽 | 캡슐이 벽 앞면 밖의 X=−3.51에서 0.005 이내였다. |
| 아래서 오는 승강기 | 첫 틱에서 높이 2.61 부근에 올라 접지했고, 다음 틱에서도 같은 지지체에 접지하며 0.25를 운반했다(오차 0.005). |
| 끼임과 회전 문 | 양쪽 벽이 모두 시작 자세로 돌아가 정지 2건을 기록했다. 천장 앞 승강기는 정지 1건과 접지를 유지했다. 90도 회전 문은 두 끝점 사이에서 캐릭터를 밀고 마지막 겹침이 0.005 이하였다. |

#### 지정 경로 전환

경로의 매듭 시간을 합쳐 Rapier 스텝을 나눴다. 0.1초의 X=3→−3→3 경로는 끝점이 같아도
중간 구간에서 캡슐을 X=-3.51로 밀었다. 뒤 구간에서 끼이면 경로와 해당 경로의 캐릭터 이동을
틱 시작 기준으로 되돌리고 `blockedPlatforms`에서 정지를 보고한다. 서로 압박하는 상승·하강
발판은 함께 멈춘다. 기존 엔진 시험은 접촉 순간의 위상 대신 마지막 안전 자세, 정지 통계, 접지와
장애물 제거 후 재개를 검사한다.

빠른 위치 키네마틱은 순수 Rapier 스텝에서 X=3→−3으로 이동하며 X=0의 CCD 미설정 상자를
통과했다. 지정 경로가 그 물체의 모양 전체를 한 구간 안에 가로지를 때는 기존 cast와 정지 규칙으로
막는다. 끝에서도 접촉하는 경우는 Rapier의 일반 접촉을 사용한다. 지정 경로 시험 13건과 엔진
발판 차단 시험 9건을 통과했다.

#### 투사체와 확대 검증

후보에서 Rapier 일반 스텝의 시작·끝 자세를 보간하고 Parry cast로 투사체 접촉을 찾았다.
증명 경로 진입은 테스트 빌드의 강제 설정에만 남겼다. 회전 모서리가 끝점 사이에서 명중하는
사례를 포함해 step-motion 시험 22건을 통과했다. 마을 전투 브라우저 검사에서는 8개 조합마다
측정 구간에 발사 140회와 명중 4~5회를 확인했다. 바디가 한 틱 안에 방향을 바꿔 시작 자세로
돌아오면 두 자세가 같아 그 중간 접촉을 복원할 수 없다. 기존 내부 반전·왕복 투사체 시험 두 건은
이 차이를 드러냈다.

경로 스텝 분할이 저장·복원에서 요구하는 캐릭터 미리보기 상태를 누락해 체크포인트가 거절됐다.
첫 구간 전 미리보기를 초기화한 뒤 지형·발판 체크포인트 재생이 다시 통과했다. 대시에는 기존
cast의 접촉 직전까지 이동하는 처리를 적용해 대시 시험 13건을 회복했다. 낮은 천장과 좁은
공간은 경로 탐색이 쓰던 KCC 여유 처리를 공유해 시험 20건을 통과했다.

| 확대 검증의 미해결 항목 | 관측 결과와 분류 |
| --- | --- |
| 빠른 동적 상자가 정지 캡슐에 충돌 | 0.01초 간격, CCD 활성, 초기 상자 X=1.5·속도 −200. 첫 스텝 직후 겹침은 평면·공간 모두 0.005였다. 다음 스텝에서 상자가 튕기면서 회전했고, 상자 자세를 적용한 OBB와 캡슐 중심선 사이 거리로 잰 겹침은 각각 0.058997·0.058751이었다. 캐릭터의 X는 0, 게임이 이벤트 뒤 준 충격으로 이동한 X는 −0.05였다. 자동 밀림 방지와 이벤트는 작동했으나 Rapier 허용치 0.005를 넘는 실제 접촉 회귀다. |
| 저장 복원 뒤 선두를 돌아 목표에 도달 | `native_cached_actual_connector_around_second_wall_reaches_goal_and_keeps_file_continuation`에서 480틱의 추종자 X/Z는 2.651724/−0.379310이었다. 정지 동료를 KCC 지형 질의에 넣은 비교에서도 추종자 X/Z가 480틱과 1,200틱 모두 2.644484/−0.386206에 남았다. 목표 X/Z=4/0까지 약 1.41로 한도 1.02를 넘었다. 동료에 의해 경로 진행이 막히는 회귀다. |
| 두 에이전트의 목표 도달 | `native_combat_navigation_multiple_agents_share_search_token_and_reach_target`에서 360틱 후 X/Z=2.232322/0.399237로 목표까지 거리 1.52 이내에 들지 못했다. 정지 동료를 KCC 질의에 넣은 비교에서도 X/Z=2.555441/0.509411로 도달하지 못했다. |
| 경사로 목표 도달 | `native_navigation_reaches_raised_floor_through_ramp`에서 240틱에 [3.646768, 1.759979, 0.767290], 상태 1(진행 중)이었다. 비교 실행에서는 300틱에 도달했다. 기존 240틱 완료 단언은 유지했다. |
| 매듭 왕복 뒤 운반 관측값 | `full_cycle_inside_tick_preserves_rider_transport_and_motion_work`에서 발판과 탑승자가 왕복을 끝내 시작 위치 부근에 있고 접지 상태였으나, 마지막 구간 상태만 남아 `carried_by`가 비었다. 공개 운반 관측값을 잃는 회귀다. |
| 저장 파일과 결정적 이어하기 | 활성 연결 경로 및 힘이 들어 있는 체크포인트에서 틱 1의 상태 단언이 달랐다. Core에서도 대기 점프·지지체 이력을 복원한 뒤 상태 바이트가 달랐다. 일부 회전·CCD 저장 시험은 테스트 전용 증명 경로를 복원 과정에서 다시 지정해야 한다. 두 종류를 함께 통과한 것으로 판정하지 않았다. |
| 정지 좌표의 비트 단언 | 정지 동료·회전 속도가 0인 조준·분할 경로 탐색 세 시험은 0.0000003 이하의 좌표 차이에서 실패했다. 접촉 허용 오차에 맞출 단언이다. 같은 입력을 되풀이했을 때 같은 결과를 요구하는 결정성 검사는 별도로 유지한다. |

Rust 확대 시험은 `physics3d` 1,069건 통과·7건 실패·6건 제외,
`engine::unified_physics` 599건 통과·10건 실패·9건 제외, `engine::file_candidate`
39건 통과·2건 실패였다. 마지막 두 실패는 기존 solver가 기록한 정확한 CCD prefix를 읽는
시험이었다. 재현은 아래 필터와 위 표의 시험 이름을 사용한다.

```bash
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib physics3d
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib engine::unified_physics
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib engine::file_candidate
pnpm smoke:unified-physics-web
node tests/smoke/village-game-quality-browser-smoke.mjs
```

#### 브라우저·롤백 및 판정

- 중간 후보 Wasm의 소스 지문은 `548d6069a63a3626`이다. 이 빌드로 마을 전투 8개 조합,
  Platformer, Top-down HD-2D, 물리 실험실 단일 장면과 전체 7개 장면을 로컬에서 통과했다.
  통합 물리 Web의 64명·405스텝 상태 해시는 `0f5b8a8d7f8ad02422ce138944833f0ccbf09126fdff1bf0a5814ea276331bf4`로
  기존 기준 `da6e9fd49d89addd7d87e6a7b296f1a82bca7ff2ff7542c890c4544aace6776d`과 달라
  비교에서 멈췄다. 동적 상자 프로브와 기존 오류 프로브는 같은 Wasm에 따로 실행했다.
- 후보의 기존 메시 오류 장면은 첫 스텝을 완료해 물리 시간이 0에서 0.01로 늘었다. 지정 경로
  16개에 같은 틱의 대시를 추가하는 용량 오류는 스텝 시작 전에 거절되므로 틱 중 롤백을 검증할
  수 없다. 제품의 대체 사례는 찾지 못했다. 전환을 재개할 때 제품 API는 사전 거절의 상태 불변을,
  테스트 전용 틱 실패 주입은 체크포인트·저장 바이트를 포함한 틱 중 롤백을 검증하는 구성을
  제안한다. 공식 브라우저 롤백 프로브의 기존 단언은 유지했다.
- **판정은 제품 전환 보류다.** 빠른 키네마틱 벽·승강기·끼임은 기준을 통과했다. 빠른 동적 상자
  겹침과 군중의 목표 도달, 지정 발판의 운반 관측값, 저장 뒤 결정적 이어하기 기준이 남았다.
  후보는 캐릭터 `17456edf`, 지정 경로 `459aab30`, 투사체와 통합 시험 `09f5fa86`에 보존했다.
  제품 경로를 재개 전 상태로 되돌려 공개 계약, 롤백, 기준 파일, P3 삭제 목록과 미배포 공지를
  유지한다. `FULL_MARGIN_QUERY_GOLDEN`은 후보의 직접 질의 검사에서도 같았다. 전환이 보류되어
  새 군중 해시·리플레이 fixture 확정과 합격 후보의 성능 비교는 진행하지 않았다.

복원한 제품에서 Core 단위 3,807건, 통합 1건, SDK 테스트 2,075건이 통과했다.
Core 포맷, Clippy, 테스트 구조, 공개 API 표면과 문서 링크 검사도 통과했다. 설치된 도구로 Wasm을 다시 빌드한 뒤
`native-wasm-source-identity`와 해당 단위 검사를 통과했다. 제품 소스, Wasm 내장 지문,
`origin/main`(`c931e948`)의 소스 지문은 모두 `11069d5bf39a8803`이다.
HD-2D 전투 최소 프레임 실패는 다시 실행하지 않았다.

복원한 제품의 로컬 통합 물리 Web에서 64명·405스텝 기존 해시와 체크포인트 재생,
브라우저 오류 롤백과 기존 질량 계약이 통과했다. Platformer, Top-down HD-2D, 물리 실험실
단일 장면과 전체 7개 장면도 통과했다. 마을 전투 첫 실행은 효과와 LOD를 끈 두 번째 반복에서
시뮬레이션 5.6502초 부근에 기존 운동 증명이 `actual motion could not be certified or resolved`로
스텝을 거절했다. 이 실행의 Wasm SHA-256은 재개 전 제품과 같은
`14d0b988db53d1debcb0427904a33bbe8fdeea605cedfde15887cf5a9d4ec980`이다.
같은 Wasm으로 마을 전투를 단독 재실행해 8개 조합 모두 통과했다.

#### 2026-11-28 사용자 결정 3차

- `bf728fb6`의 제품 경로 복원을 되돌리고 작업 브랜치에서 캐릭터 KCC·지정 경로·투사체 보간
  후보를 이어간다. 위 기록은 이전 실행 결과다. 작업 브랜치에서 기준을 충족하지 못한 항목은
  측정해 보고하고 후보 경로는 유지한다.
- 빠른 동적 물체는 같은 입력의 일반 Rapier 키네마틱 캡슐과 비교한다. 최대 겹침은 대조군 값
  +0.005 이내, 관통 없음, 5틱 안에 겹침 0.005 이하 회복, 충돌 이벤트 발생을 검사한다.
- KCC가 동료 캡슐을 장애물로 받아 표면을 따라 미끄러지게 한다. 경로가 멈춘 동료를 가로지르면
  기존 길찾기의 장애물 처리를 쓴다. 경사면 투영으로 달라진 도착 시간은 진행·접지 결과로 검증한다.
- 한 틱의 여러 구간에서 탑승 상태를 합친다. 저장·복원 다음 틱부터 원래 실행과 바이트가 같아야 한다.
  제품 사전 거절은 상태 불변을, 테스트 전용 틱 실패 주입은 실제 틱의 되돌리기를 검사한다.
- 정지 좌표 세 검사는 접촉 오차를 적용한다. 투사체의 틱 안 반전·왕복 두 장면은 시작·끝 자세의
  보간으로 판정한다. 제품 전환을 확정한 뒤 기준 파일과 공개 변경 기록을 갱신한다.

#### 3차 비교 및 수정

다음 수치는 고정 간격 0.01초, CCD 상자 X=1.5·속도 −200, 키네마틱 캡슐 X=0인 장면을 Parry
형상 접촉으로 측정한 값이다. 회복 시간은 최초 허용치 초과 틱부터 센다.

| 공간 | 일반 캡슐 최대 겹침 | 캐릭터 최대 겹침 | 허용치 초과 5틱 뒤 | 0.005 이하 회복 |
| --- | ---: | ---: | ---: | ---: |
| 평면 XY | 0.058997154 | 0.058997154 | 0.038406283 | 20틱 |
| 공간 XYZ | 0.058749318 | 0.058749318 | 0.036364615 | 17틱 |

두 경로의 겹침이 관측한 32틱 동안 같은 흐름이었고 상자는 캡슐 반대쪽으로 통과하지 않았다.
양쪽 모두 고체 충돌 이벤트를 받았다. 회복 속도는 일반 Rapier에서도 5틱 기준에 미달한다.
기본 Rapier 해석을 유지하며 이 기준을 검사하는 Rust 시험을 남겼다.

길막힘은 캐시의 공유 경로가 먼저 도착한 정지 캡슐을 가로지르는 경우였다. KCC 이동 질의가
동료의 표면을 받아도 같은 경로로 다시 전진하면 막혔다. KCC가 동료에 막힌 뒤에는 기존
길찾기의 장애물 처리로 정지 동료를 돌아가게 했다. 저장 파일을 복원한 추종자와 두 에이전트의
목표 도달이 기존 거리 한도 1.02·1.52에서 통과했다.

경사로에서 Rapier는 이동을 경사면에 투영했다. 이동 한 틱당 평균 수평 거리는 평지 0.03232,
경사로 0.03034였다. 진입·출구와 경사로에서 정지나 0.005를 넘는 하강 떨림이 없었고,
목표 층에 265틱에 도착했다. 도착 한도를 300틱으로 갱신하고 기존 목표 좌표와 층 단언을 유지했다.

왕복 발판은 구간별 운반을 합쳐 최종 접지한 운반체를 보고한다. 캐릭터 이동 관측값은 실제
저장된 끝점과 시작점의 차이를 사용한다. 진행 중인 연결 경로에서 원본과 복원본이 같은 바이트를
유지하는 검사와, 외부 힘을 한 번만 소비하는 검사를 유지했다. 구간 분할 직후 저장한 지지체
기록과 대기 점프가 6틱 동안 그대로 재생되는 일반 경로 시험도 추가했다. 기존 체크포인트가
입력·접지·미리보기를 보존하고 있어 필드를 추가할 필요는 없었다. 정확 경로를 쓰는 테스트는
복원한 world에 테스트 전용 경로를 다시 설정했다.

제품의 고정 틱 사전 거절은 호출자에게 오류를 반환하면서 포즈·시간·마지막 틱 진단·파일을
보존한다. 틱 안의 실패는 Rust 테스트에서 입력과 관측값을 준비한 직후 주입한다. Native 파일과
체크포인트가 그대로이고 재시도 때 힘·충격이 한 번만 적용되는지 검사한다.

```bash
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p2b_fast_incoming_ccd -- --show-output
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib native_cached_actual_connector
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib native_combat_navigation_multiple_agents
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib native_navigation_reaches_raised_floor -- --show-output
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib rapier_path_checkpoint
cargo +stable test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib injected_native_tick_failure
```

#### 3차 검증 결과

- Core 전체 단위 실행은 3,805건 통과, 1건 실패, 수동 비교 16건 제외였다. 실패는 위
  5틱 겹침 회복 시험이다. API 통합 시험 1건, Rust 포맷, Clippy, 테스트 구조와 문서 링크
  검사를 통과했다. SDK 테스트 2,075건과 공개 API 표면 검사도 통과했다.
- 로컬 브라우저의 동일 초기 상태 비교는 평면 최대 0.058997143, 공간 최대 0.058750612로
  일반 캡슐과 캐릭터의 값이 같았다. 두 경로에서 고체 충돌 이벤트가 발생했고, 게임이 준
  충격으로만 캐릭터가 X 방향으로 이동했다. 고정 간격을 다르게 호출한 기본·설정 지정
  수동 API에서는 저장 파일을 포함해 관찰한 상태가 같았다.
- 공식 통합 물리 Web은 64명·405스텝의 기존 해시 비교에서 실패했다. 후보 해시는
  `486c58c1e2a2fec256d42c63fc567da28d89576a5305d3c6be24ec8d96f9a301`이다.
  로컬 진단 실행은 기존 해시 단언을 출력으로 바꿔 나머지 검사를 모두 통과했다.
  같은 입력에서 위 해시가 다시 나왔고, 최소 간격 0.5499997, 체크포인트 뒤 6스텝 일치,
  스텝당 Rust 비용 p95 2.22ms였다. 기준 해시는 저장소에 그대로 두었다.
- 최종 후보의 마을 전투 8개 조합, Platformer, Top-down HD-2D, 물리 실험실 단일 장면과
  전체 7개 장면이 통과했다. 마을 전투의 측정 구간에서는 조합마다 발사 140회, 명중 4~8회를 확인했다.
- 후보 Wasm 내장 지문과 작업 브랜치 소스 지문은 `e174f8267b2e182b`이며,
  `origin/main`(`c931e948`) 소스 지문은 `11069d5bf39a8803`이다.
  HD-2D 전투 최소 프레임 실패는 재실행하지 않았다.

후보는 작업 브랜치에 유지한다. 5틱 회복 기준이 남아 64명 해시와 리플레이 fixture 재생성,
결정 B의 공개 문서·CHANGELOG 반영, 두 빌드의 정식 성능 비교는 보류한다.

#### 2026-11-28 회복 기준 정정 및 제품 경로 확정

5틱 회복 조건을 일반 Rapier와의 비교로 정정했다. 32틱 동안 각 틱의 캐릭터 겹침은 일반
키네마틱 캡슐의 값 +0.000001 이내여야 한다. 일반 캡슐이 그 구간 내에 0.005 이하로 회복하고,
상자 통과가 없으며 충돌 이벤트가 도착해야 한다. Rapier 접촉 설정은 유지했다.

Rust와 브라우저에서 32틱 비교가 통과했다. Rust에서 일반 캡슐은 허용치를 처음 넘은 뒤 평면
20틱, 공간 17틱에 0.005 이하로 돌아왔다. 실제 알려진 동작으로
[Physics Spec](../engine/physics-spec.md)과 [Core API](../engine/public-api/core.md)에 기록했다.

제품은 Rapier 일반 스텝, 캐릭터 KCC, 키네마틱 매듭 분할과 투사체 시작·끝 자세 보간을 사용한다.
운동 증명 진입은 테스트 전용이다. 64명·405스텝 저장 기준은
`da6e9fd49d89addd7d87e6a7b296f1a82bca7ff2ff7542c890c4544aace6776d` →
`486c58c1e2a2fec256d42c63fc567da28d89576a5305d3c6be24ec8d96f9a301`로 갱신했다.
같은 빌드에서 체크포인트 뒤 6스텝 재생과 반복 실행의 결정성은 유지한다.

Minimal·Topdown·Breakout·Platformer를 생성한 뒤 각 프로젝트의
`node scripts/ferrum-runtime-replay.mjs update-fixture`로 재생성했다. Native 파일 SHA-256
18개, snapshot hash 18개, replay hash 22개가 바뀌었다. 다른 JSON 값은 같았다.

Core 단위 3,806건과 통합 1건, Rust 포맷과 Clippy를 통과했다. 수동 비교 16건은 기본
테스트 실행에서 제외했다. `FULL_MARGIN_QUERY_GOLDEN`과 broad-phase 저장 순서·바이트
시험은 기존 기준으로 통과했다. SDK 테스트 292건, Wasm 소스 지문, 런타임 패키지와 공개 타입,
생성기 패키지와 템플릿 리포트, 공개 API·문서 링크·Rust 테스트 구조 검사도 통과했다.

최종 실행에서 통합 물리 Web은 정정한 겹침 기준, 새 64명 해시와 6스텝 체크포인트 재생을
통과했다. 마을 전투 8개 조합, Platformer, Top-down HD-2D와 물리 실험실 단일·전체 스모크도
통과했다. 마을 전투 측정에서 조합당 140회 발사와 3~7회 명중을 확인했다.
HD-2D 전투의 최소 프레임 검사는 별도로 실행하지 않았다.

#### 성능 비교

`origin/main`(`c931e948`)에서 Rust 1.97.1과 같은 Wasm 도구로 최적화 빌드를 만들었다.
P2b의 테스트 변경은 제품 소스 지문을 바꾸지 않아 같은 도구로 만든 기존 최적화 Wasm을
재사용했다. Wasm 소스 지문은 `11069d5bf39a8803` → `e174f8267b2e182b`, 크기는
10,550,797 → 10,017,492 바이트다. 두 빌드는 같은 SDK JS와 로컬 Chromium 153.0.8010.12에서
측정했다.

64명 군중은 `probeNativeGameplayNavigation`에 50ms RAF 입력을 주어 81프레임·405스텝을
각 빌드에서 세 번씩 번갈아 실행했다. 같은 빌드의 세 해시와 체크포인트 뒤 6스텝은 일치했고,
두 빌드의 최소 캡슐 간격은 각각 0.5499997이었다.

| 64명 군중 지표 | main | P2b |
| --- | ---: | ---: |
| 첫 Rust 업데이트 시간 중앙값 (ms) | 38.90 | 23.70 |
| 예열 후 프레임당 Rust p95의 중앙값 (ms) | 32.10 | 12.30 |
| 예열 후 스텝당 Rust p95의 중앙값 (ms) | 6.42 | 2.46 |
| Wasm 선형 메모리 최댓값 (바이트) | 7,405,568 | 6,422,528 |

`main`의 전체 마을 전투 스모크는 시뮬레이션 5.6502초에서 기존 운동 증명 오류로 중단됐다.
P2b의 전체 스모크는 8개 조합을 통과했다. 비교에는 같은 마을 전투 fixture의 적 32명·효과와
LOD 끔 상태를 사용했다. 두 빌드에서 같은 예열 절차와 경사로 입력을 적용하고, 정지 지점 전의
1.8초 구간을 세 번씩 측정했다. 실행마다 37프레임과 84회 발사를 확인했다. 짧은 구간까지는
양쪽 모두 명중이 없어 전체 전투 비용의 비교에는 한계가 있다.

| 마을 전투 1.8초 구간 지표 | main | P2b |
| --- | ---: | ---: |
| 프레임당 Rust p95의 중앙값 (ms) | 30.20 | 4.10 |
| 시뮬레이션 1초당 Rust 시간 중앙값 (ms) | 342.83 | 48.22 |
| Wasm 선형 메모리 최댓값 (바이트) | 9,895,936 | 6,619,136 |

시뮬레이션 1초당 시간은 각 실행의 첫 프레임 이후 Rust 시간 합계를 그 구간의 실제
시뮬레이션 시간으로 나눴다. 브라우저는 각 측정을 순차 실행했다.
