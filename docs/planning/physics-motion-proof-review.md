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
   - 경로 틱에 남은 증명용 작업 공간 admission과 저널(`begin_backend_step_rollback`의 기존
     경로 연결)을 정리한다. 제품 검증에 필요한 시간 변환·저장 검사와 실제 틱 실패의 상태 복원은 보존한다.
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

#### PR 전 검토 수정

| 항목 | 수정 전 재현 | 제품 경로에서 확인한 결과 |
| --- | --- | --- |
| 문이 미는 캡슐과 문 경로 밖의 동료 | 문이 −0.55에서 −0.25까지 이동했다. 앞 캡슐은 뒤의 정지 캡슐 표면을 통과했다. | 캡슐의 추가 이동을 동료의 계획 자세에 cast한다. 밀기 여유가 부족하면 문은 −0.55에 머물고 경로 정지 1건을 기록한다. 문에 직접 닿은 캡슐 연쇄는 기존 간격 처리를 유지한다. |
| 두 벽의 동시 끼임 | ±1에서 출발한 벽이 ±0.4에 도착해 지름 0.5 캡슐에 0.3의 공간만 남겼다. | 승인한 밀기를 다른 mover의 끝 자세와 대조한다. 두 벽 모두 시작에 머물고 경로 정지 2건을 기록한다. 벽 생성 순서를 바꿔도 같다. |
| 동적 천장과 무거운 상자 | 상승 속도를 먼저 0으로 지웠다. Rapier는 같은 질량의 천장 상자에 두 접촉점으로 초속 3을 전달했다. | 동적 천장에는 점프 속도를 반작용까지 보존한다. 접촉점의 합산 전달량을 위 방향에서 두 질량으로 제한한다. 질량비 1·10·0.1에서 합산 운동량 오차 1% 이내, 수직 속도 상한, 같은 틱 snapshot을 검사한다. 무거운 상자와 두 캡슐의 밀기는 반작용과 실제 상자 속도를 함께 검사한다. |
| 막힌 발판의 보행과 진단 | 회전 발판이 막히면 옆으로 걸어도 X가 1이었다. held 분기가 이전 접촉 플래그와 카운터를 다시 발행했다. | 운반을 취소한 자세에서 KCC를 실행하므로 벽 쪽 성분은 막히고 접선 방향으로 걷는다. 반대쪽으로 걸어 발판을 벗어날 수 있다. 이전 틱의 pair·obstacle 카운터와 플래그는 재사용하지 않는다. |
| 운반 출처와 부분 운반 | 발판에서 걸어 나온 틱에 `carry_translation.x ≈ 0.1`인데 출처가 없었다. 뒤 매듭에서 되돌린 발판의 운반량이 0으로 돌아가도 그 발판 ID가 남았다. 벽 앞에 남은 운반량이 0.000001보다 작은 경우에도 출처가 빠졌다. | 받아들인 이동을 지지체별로 누적해 되돌린 발판의 기여를 뺀다. 발판에서 내리기 전 받은 운반은 출처와 함께 남는다. 동적 지지체가 벽 쪽으로 움직이면 캡슐이 벽 전에 실제로 움직인 양과 출처를 보고한다. 회귀 시험은 일반 부분 운반과 0.000001 미만의 운반을 모두 검사한다. |
| PlanarXy 밀기 | XY에서 회전하는 문의 캡슐 밀기에 Z = −0.00001525가 남았다. | 원하는 밀기와 수용한 밀기를 XY로 제한한다. 실제 cast와 밀기가 일어난 뒤 깊이 변위는 0이다. |
| 뒤 매듭의 되돌리기 | 문과 탑승자를 시작 자세로 되돌린 뒤에도 앞 구간에서 발생한 동적 상자 충격과 Enter 이벤트가 남았다. | 앞 구간의 Rapier 관측과 동적 응답은 유지하고 [공간 씬 계약](../engine/data-scene-spatial.md)에 명시했다. 뒤 매듭이 있는 밀기·되돌리기와 양수 `pushMass`의 밀기가 각각 snapshot 복원 뒤 6틱 동안 같은 바이트를 생성했다. |
| Clock mismatch와 자동 RAF 사전 거절 | Clock mismatch는 호출에서 알리고 저장하지 않는 구현을 확인했다. 외력 검증의 RAF 사전 거절은 14,578바이트 파일을 14,580바이트로 바꿨다. | 시계 불일치의 기존 계약을 유지한다. 가변 RAF의 외력 사전 거절도 호출 진단에만 기록한다. 자동 스텝에서 자세·시계·마지막 CCD 진단·Native 저장 바이트 보존과 체크포인트 복원을 확인한다. |

`platform_blocking_tests`의 뒤로 움직이는 벽 장면은 실제 cast 수행과 실패 0건을 모두 검사한다.
경로 admission과 저널은 P3 목록에 추가했고, 현재의 `CapacityExceeded` 가능성과 항상 0인
증명 카운터를 [Core API](../engine/public-api/core.md)에 기록했다.

**256명·1,024명 군중 성능.** Rust 1.97.1 release 테스트에서 반지름 0.25 캡슐을 격자로
배치했다. 각 캡슐의 입력은 초속 1, 중력은 0이다. 20틱 예열 뒤 100틱의 평균과 최대를
측정했다. `origin/main`(`b4ddcd63`)의 소스 아카이브에도 같은 테스트를 넣어 실행했다.

| 캡슐 수·간격 | main 평균 / 최대 (ms) | 수정 후 평균 / 최대 (ms) |
| --- | ---: | ---: |
| 256명·0.6 | 5.7848 / 6.8609 (100틱) | 0.8902 / 1.2657 (100틱) |
| 1,024명·0.6 | 140.2427 / 169.3721 (5틱), 26틱에 `CapacityExceeded` | 5.9238 / 41.9819 (100틱) |
| 1,024명·1.2 | 첫 틱에 `CapacityExceeded` (거절에 248.7594ms) | 3.0683 / 4.2882 (100틱) |

1,024명의 main 수치에는 완료 구간의 차이가 있다. 두 배치 모두 `native_ccd::clip_curves`의
`WorkLimit`에서 멈췄다. 수정본은 두 배치의 전체 120틱을 완료했다. 이 비교 결과에 따라
기존 캐릭터 쌍 탐색을 유지했다.

```bash
cargo +stable test --locked --offline --manifest-path crates/ferrum-core/Cargo.toml --release --lib p2b_crowd_tick_benchmark -- --ignored --nocapture
```

**검증과 기준 파일.** Core 단위 3,816건과 통합 1건, Clippy, Rust 포맷, 테스트 구조를 통과했다.
최종 Wasm 내장 지문과 소스 지문은 `385f514c92dfcd37`이며 main 지문은 `11069d5bf39a8803`이다.
SDK의 테스트 292개와 SDK 식별자·Wasm 팩토리 단독 검사, 패키지 파일 및 문서 링크·공개 API·
Data Scene authoring 검사가 통과했다.

통합 물리 Web에서 자동 RAF의 사전 거절 전후 Native 파일은 14,578바이트로 동일했다.
64명·405틱의 상태 SHA-256은 기존 `486c58c1e2a2fec256d42c63fc567da28d89576a5305d3c6be24ec8d96f9a301`과
일치했고 체크포인트 뒤 6틱의 정확 재생도 확인했다. 네 템플릿의 리플레이는
`node scripts/ferrum-runtime-replay.mjs update-fixture`로 갱신했다. Core 소스와 SDK 식별자가
바뀌어 Native 저장 파일 SHA-256, snapshot 해시, 순차·전체 replay 해시가 달라졌다.
파일 길이와 나머지 관측값은 기존 값과 일치했다. create-game tarball 검사와 템플릿 보고서 스모크가 통과했다.

최종 Wasm으로 로컬 통합 물리 Web, Platformer, Top-down HD-2D, 물리 실험실 단일 장면과
전체 7개 장면, 마을 전투 8개 조합이 통과했다. `smoke:hd2d-combat`은 사용자 지시대로
생략했다. main의 DPR 2 소프트웨어 렌더링에서도 이미 약 1.6fps로 5프레임만 관측한 검사다.

#### 2026-11-28 후속 결정 · 막힌 구간의 시작에서 정지

지정 경로를 매듭에서 나눈 틱에서 막힌 물체와 경로 진행률을 해당 구간의 시작에 둔다. 틱에
구간이 하나면 틱 시작 자세에서 정지한다. 이미 진행한 구간의 자세, 탑승자 운반, 캐릭터 밀기,
동적 물체 응답과 충돌 이벤트는 그대로 이어진다. 경로가 없는 속도 키네마틱, 발판·탑승자 묶음,
두 벽이 만드는 끼임에도 같은 규칙을 적용한다. `sweep_sensors` 대시는 기존의 안전한 이동
구간 계산을 사용한다.

| 재현 장면 | 확인한 결과 |
| --- | --- |
| 두 번째 구간에서 막힌 문 | 문은 X=-1에서 X=-0.4 매듭까지 이동하고 진행률 0.5에 정지한다. 첫 구간에서 밀린 캡슐과 상자, 상자의 접촉 진입 이벤트, 탑승자의 X 방향 운반량 0.6이 같은 실행에 남는다. |
| 공간 씬의 지정 발판 | 진행 시간 0.05초와 X=0.5에서 막힌 상태로 유지된다. 장애물을 제거하면 다음 틱에 0.15초와 X=1.5로 진행하고 native 자세와 authored 위치가 일치한다. |
| 발판 묶음과 두 벽 끼임 | 막히기 전 0.2 운반을 보존하고 탑승자가 이후 걸어서 내려갈 수 있다. 지정 경로 벽과 속도 키네마틱 벽은 두 번째 구간 시작인 X=-1과 X=1에서 각각 정지한다. |
| 하강 발판의 동적 상자 | 발판은 Y=-0.1 매듭에 머문다. 상자의 높이와 수직 속도를 그 매듭에서 정상 정지한 대조군과 30틱 비교해 추가 반동이 없음을 확인했다. |

`rewind_kinematic_path`와 틱 시작의 속도 바디 자세·운반·밀기를 따로 추적하던 자료를 제거했다.

정지 직후 Core snapshot을 복원하고 같은 경로를 6틱 진행한 상태 바이트가 일치했다.
Engine 체크포인트에서는 장애물을 제거한 뒤 6틱을 재생했다. 복원 횟수 카운터가 1 증가하는
공개 계약을 먼저 검사하고, 비교할 때 그 카운터만 맞춰 나머지 저장 바이트가 일치하는지 확인했다.

**기준 파일.** 64명·405틱의 상태 해시는 기존
`486c58c1e2a2fec256d42c63fc567da28d89576a5305d3c6be24ec8d96f9a301`과 같고
체크포인트 뒤 6틱 재생도 일치했다. 최소·탑다운·벽돌 깨기·Platformer 템플릿은
`node scripts/ferrum-runtime-replay.mjs update-fixture`로 갱신했다. `origin/main`(`39019828`)과
수정본의 Native 저장본 18개를 비교해 Core 빌드 지문과 그에 따른 체크섬만 바뀌었음을
확인했다. 네 템플릿에는 이번 매듭 정지로 달라진 물리 상태가 없으며, JSON에는 저장·스냅샷·
리플레이 해시만 바뀌었다.

**검증.** Core 단위 3,819건과 통합 1건, Clippy, Rust 포맷이 통과했다. 최종 Wasm의
소스와 내장 지문은 `b8752eb11c6f9821`이며 main은 `385f514c92dfcd37`이다.
`pnpm test:web`, 공개 API·문서 링크, Wasm과 create-game tarball·템플릿 보고서 검사도
통과했다.

최종 Wasm을 사용한 로컬 통합 물리 Web, Platformer, 물리 실험실 7개 장면, 마을 전투
8개 조합이 통과했다. `smoke:hd2d-combat`은 사용자 지시대로 생략했다. main에서도 재현된
DPR 2 소프트웨어 렌더링의 최소 프레임 문제 때문이다.

## P3 삭제 지도

P3-0의 기준은 PR #117을 병합한 `origin/main`(`5d0097e7`)이다. 제품 경로는 일반 Rapier 스텝,
Rapier CCD, KCC, 경로 매듭 분할과 시작·끝 자세를 보간하는 투사체 질의다. 증명 실행은
`force_rigid_motion_proof`와 `force_character_motion_proof`를 사용하는 테스트에만 연결된다.
이 지도는 사용자 결정 4번에 따라 그 경로를 최종 삭제하는 순서를 제안한다.

### 빌드와 크기 기준

AMD Ryzen AI Max+ 395, 16코어·32스레드, WSL2 Linux 6.18.58.1 x86-64에서 측정했다. 게스트가
인식한 RAM은 16,577,130,496바이트(15.44 GiB), swap은 4 GiB이며 cgroup CPU·메모리 제한은
`max`였다. Rust·Cargo 1.97.1, wasm-pack 0.15.0, wasm-bindgen 0.2.120, wasm-opt 117,
gzip 1.14를 사용했다. 각 대상 디렉터리를 비운 상태에서 Cargo 레지스트리와 설치된 도구 캐시는
재사용했다. 두 빌드를 순차 실행했고, 각각 외부 타이머의 wall time을 한 번 측정했다.

| 작업 | wall time | 산출물 |
| --- | ---: | --- |
| Core 디버그 `cargo test --no-run` | 91.08초 | 단위·통합 테스트 바이너리 컴파일 |
| Core Wasm release | 159.16초 | Cargo 84초, 나머지 시간에 wasm-bindgen·wasm-opt와 패키지 출력 포함 |
| `ferrum_core_bg.wasm` | | 10,027,707바이트 |
| 동일 파일 `gzip -n -9` | | 3,490,382바이트 |

```bash
p3_dir="$PWD/artifacts/physics-p3-map"
export RUSTUP_TOOLCHAIN=stable CARGO_NET_OFFLINE=true CARGO_BUILD_JOBS=8
# wasm-bindgen 0.2.120과 wasm-opt 117의 설치 경로를 PATH에 둔다.
CARGO_TARGET_DIR="$p3_dir/native-cold" /usr/bin/time -f '%e' \
  cargo +stable test --no-run --locked --offline --manifest-path crates/ferrum-core/Cargo.toml
CARGO_TARGET_DIR="$p3_dir/wasm-cold" /usr/bin/time -f '%e' \
  wasm-pack build --mode no-install crates/ferrum-core --release --target web --out-dir "$p3_dir/pkg"
wc -c < "$p3_dir/pkg/ferrum_core_bg.wasm"
gzip -n -9 -c "$p3_dir/pkg/ferrum_core_bg.wasm" | wc -c
```

### 소스 규모

파일과 하위 모듈의 물리 줄 수다. 주석과 빈 줄을 포함한다. Rust 구문을 파싱해
`#[cfg(test)]`로 제한된 선언·블록·외부 모듈, `#[test]` 함수와 그 시험 모듈의 보조 코드도
시험에 포함했다. 매크로가 확장하면서 만드는 줄은 세지 않았다. 표의 비시험 줄은 소스 구성 기준이다.
제품에서 실행되지 않지만 해당 빌드에 컴파일되는 증명 코드도 비시험 열에 포함된다.

| Core 모듈과 하위 | Rust 파일 | 비시험 줄 | 시험 줄 | 명시적 `#[test]` |
| --- | ---: | ---: | ---: | ---: |
| `solver_trajectory` | 93 | 36,506 | 26,577 | 331 |
| `character_motion` | 51 | 18,462 | 21,164 | 198 |
| `queries/step_motion` | 6 | 1,087 | 790 | 10 |
| `motion_trace` | 2 | 274 | 158 | 4 |
| `kinematic_paths` | 6 | 1,104 | 889 | 14 |
| 합계 | 158 | 57,433 | 49,578 | 557 |

Vendor의 수정 파일은 각 `UPSTREAM.json`의 경로별 SHA-256과 추적 파일을 대조했다. 원본
압축본의 SHA-256을 확인한 뒤 Python `difflib.SequenceMatcher`로 줄 diff를 계산했다.
추가 줄은 바뀐 줄의 새 쪽도 포함한다.
`Cargo.toml` 등 Rust 소스 외 파일과 수정 기록·라이선스 파일은 이 표에서 제외했다.

| Ferrum 추가·수정 소스 | Rust 파일 | 현재 비시험 줄 | 현재 시험 줄 | 상류 대비 비시험 추가 줄 | 상류 대비 시험 추가 줄 | 상류 쪽 제거 줄 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `vendor/rapier3d` | 72 | 29,493 | 7,131 | 5,607 | 5,602 | 203 |
| `vendor/parry3d` | 41 | 19,964 | 1,723 | 3,689 | 355 | 537 |

`crates/ferrum-core/src`에서 `tests` 및 `*_tests` 경로를 제외하고 이름을 검색하면
`solver_trajectory`는 131파일(모듈 안 59, 밖 72), `character_motion`은 46파일(안 26, 밖 20)이다.
후자의 54파일은 같은 검색 범위에서 재현되지 않았다. 모듈 밖에서 인라인 시험 구문과 주석 줄을
추가로 제외하면 각각 50·13파일이다. 이 집계에는 import, 필드 접근, 실행되지 않는 분기도 있다.
호출 위치와 저장 형식 접근을 아래 분류에 따로 반영했다.

### 도달 범위 실험

`5d0097e7`에서 Core를 추출해 독립 임시 Git 저장소에 실험 커밋을 만들었다. `world.rs`,
`kinematic_paths.rs`, `joints.rs`, `statistics.rs`, `character_motion/backend.rs`에서
증명 분기와 `step_kinematic_tick`을 `#[cfg(test)]`로 차단했다. 강제 스위치는 원래
`character/experimental_tests.rs`의 테스트 전용 모듈에 있다. KCC를 선택하고 남은 강체 분기의
기존 캐릭터 preview 호출도 차단했다. 지정 경로의 실사용 사전 검사와 저널, 일반 투사체,
저장용 타입과 decode 분기를 실험 사본에 남겼다.

```bash
# 별도 실험 사본의 루트에서 실행한다.
export CARGO_TARGET_DIR="$p3_dir/experiment-target" CARGO_BUILD_JOBS=8
cargo +stable build --lib --locked --offline --manifest-path crates/ferrum-core/Cargo.toml --message-format=json
cargo +stable build --lib --locked --offline --manifest-path crates/ferrum-core/Cargo.toml \
  --target wasm32-unknown-unknown --message-format=json
```

두 비시험 빌드에서 각각 같은 **`dead_code` 진단 352건**(63파일, primary span 788개)과 실험으로
인한 `unused_variables` 4건을 얻었다. 진단당 첫 위치 기준으로 `character_motion` 208,
`solver_trajectory` 27, `character_contacts` 47, `character_dynamics` 27,
`contact_impulses` 7, `kinematic_paths` 9, `motion_trace` 3, `queries/step_motion` 3,
나머지 `character*`·`events`·`kinematic_limits`·`one_way`·`world` 21건이다.
Rapier·Parry의 외부 공개 export는 이름과 Core 호출 위치를 추적했다. 최종 Wasm에서 실제로
절약할 바이트는 삭제 뒤 같은 release 빌드와 gzip 설정으로 다시 잰다.

### Core 파일 지도

A는 증명 전용, B는 제품 공통, C는 제품 또는 저장 판독이 아직 증명 쪽 타입·할당·분기에
의존하는 부분이다. A도 호출자와 함께 삭제한다. 혼합 파일에서는 아래에 적은 함수·필드 단위로
경계를 잡는다.

| 경로 또는 기호 | 분류 | 남은 호출과 정리 방법 |
| --- | --- | --- |
| `world::step_checked`의 증명 분기, `kinematic_paths::step_kinematic_tick`, `event_prefix.rs`, `wake_join.rs`, `joints.rs`의 exact prefix·공통 solver cadence 분기, `statistics.rs`의 `BackendEvents` 분기 | A | 강제 스위치, solver motion 콜백, 재승인·잠든 바디 합류·승인 prefix 기록을 함께 제거한다. 일반 Rapier 스텝, joint pass와 관절 고장 보고는 B다. |
| `character_motion/{actual_scene,angular_suffix,native_ccd,sensors,feedback}.rs`와 하위, `backend/{active_constraints,classification,clock_phase,confined_push,finite_coasting,opposed_rider,physical_momentum,representable}.rs`와 하위 | A | 셀별 증명, native CCD 사전 계획, 승인 feedback, 실제 prefix용 센서 예측 경로다. `BackendEvents`와 함께 참조를 끊는다. |
| `character_motion.rs`의 옛 장애물 resolve, `character.rs`의 `step_characters`/preview 복원·옛 `step_character`, `character_contacts`와 옛 `character_dynamics` coupling, `character_constraints.rs`, `character_query/tight_ground_admission.rs`, `kinematic_limits.rs`, `contact_impulses/actual.rs` | A 중심 | 제품 진입을 막았을 때 증명과 구형 preview/solver 호출이 사라진다. `character_stops::stop_prescribed_body`, `character_dynamics::predicted_pose`, 실제 KCC 접촉 normal·접지, native impulse/CCD 관측 수집은 B다. 기존 contact event collector와 센서 enter/exit는 유지한다. |
| `character/kcc.rs`, `kcc/kinematic_push.rs`, `kinematic_motion.rs`, `kinematic_paths::step_rapier_kinematic_tick`, `engine/unified_physics/terrain_motion.rs` | B | 입력·군중·밀기·운반, 매듭과 blocked 구간에서의 다음 틱 phase, sweep-sensors 대시의 안전 prefix가 제품 동작이다. |
| `solver_trajectory::Time`, `clock::Domain`의 구간 생성·분할, `same_pose_bits`, `backend::native_duration` | B | 일반 joint/경로 시간 변환과 보간에서 쓰인다. 공통 시간·검증 옆으로 옮기고 `Kernel`의 원 solver 표현과 분리한다. |
| `solver_trajectory`의 `accepted_capsules_separated`, `contacts_full_shapes*`, `offset_box_ball_separated`, `tight_face_fits`, actual support·회전 분리 검사 | A 중심 | 실험 후 위 진입이 경고로 드러났다. `rounded`나 `world_contact`를 먼저 통째로 자르면 아래 저장 exact cast가 컴파일되지 않는다. |
| `solver_trajectory.rs`의 `Curve`, `ShapeMotion`, `cast_full_shapes_policy*`, `leaf_contact`와 `clock::Kernel`, `feature_contact`, `positive_initial_support`, `rounded`, `world_contact`의 exact cast 종속부 | C → A | 증명 실행 외에도 `queries/step_motion.rs`의 `Some(exact)` → `exact.rs`의 cast 및 `finish.rs`·`file_admission.rs`의 bounds/검증에서 닿는다. 일반 KCC는 Parry, 일반 투사체는 시작·끝 보간과 Parry로 간다. 우선 exact 판독/호환 방침을 확정하고 공통 시간·pose 검사만 분리한다. 하위 파일의 잔존 호출을 다시 확인한 뒤 순서대로 삭제한다. |
| `queries/step_motion.rs`의 `record_interpolated_step_motion`, 보간 BVH·질의·호출자 `engine/unified_physics/projectiles.rs` | B | 발사/명중, 월드 query의 read-only 성질, 태그·센서·그룹/one-way 필터, 후보·hit 상한, 일반 저장 BVH admission을 남긴다. |
| `queries/step_motion::{exact,file_admission,finish}.rs`의 exact 구간, `motion_trace.rs`, `events.rs`의 `EventCollector.2` 및 solver motion callback | C → A | exact trace producer는 A다. collector는 직렬화 구조에 있고 `TargetMotion.exact`를 처리하는 reader/query가 있다. 호환 결정에 맞춰 레코드·콜백·읽기를 묶어 정리한다. 일반 ordinary BVH 빌드/검증은 B다. |
| `character_motion/backend.rs`의 `actual_motion_result`/완료 시간·error latch·scratch 계산, `trajectory::MAX_PROOF_WORK`, `Work::charge` | C | 일반 경로 틱의 `begin_backend_step_rollback`/출력 예약과 `finish_step_motion`에도 기존 32 Mi 작업 단위 ledger가 전달된다. 위치·query 출력의 예산과 오류를 각각 소유시키고, 기존 캡 증감은 별도 검토한다. 준비·승인 오류가 이후 성공 출력으로 덮이지 않도록 한다. |
| `character_motion/credit.rs`·`character/interval_credit.rs`, `credit/step.rs`, `world/tick_outputs.rs`, `events.rs`의 틱 저널 | C | 증명 전용 interval credit은 A다. `step_checked`의 `finish_actual_interval_credit` 호출을 정리한다. 경로 틱은 `prescribed_paths`만으로도 rigid graph/body/BVH와 prior outputs를 예약한다. 제품에 필요한 차단·입력·이벤트 원자성을 별도로 입증한 뒤 큰 저널과 해당 vendor API를 제거한다. |
| `MotionStop`, `CharacterPreview`, `character/file_admission.rs`, `kinematic_paths/character_admission.rs`, `snapshot.rs`의 해당 레코드 | C | `CharacterRuntime.motion_stop`, `path_scratch.preview` 및 legacy carry/동적 접촉 상태가 저장 검사를 거친다. 제품은 경로 시작에 preview를 저장하며, `PathScratch`의 실제 stop/phase·운반 합도 사용한다. 증명 필드만 걷어내고 다음 틱에 영향을 주는 지지체·입력·힘과 진행률, cold 참조 검증을 유지한다. |

### Vendor 수정 지도

`FERRUM-PATCHES.md`의 변경 목적과 원본 archive diff를 같이 확인했다. 아래 경로는 각 vendor의
`src/` 기준이며 마지막 행의 통합 테스트만 crate 루트 기준이다. A+B 또는 B+C 파일은 해당
hunk만 제거한다. Rust 공개 export는 Core와 vendor 내부의 사용을 함께 추적한다.

| Rapier 파일 | 분류 | P3 처리 |
| --- | --- | --- |
| `control/character_controller.rs` | B | offset 비례의 이동 epsilon과 접촉 충격 조회 동작을 유지한다. |
| `dynamics/solver/contact_constraint/{contact_constraint_element,contact_with_coulomb_friction,contact_with_twist_friction,generic_contact_constraint}.rs`, `dynamics/integration_parameters.rs`, `geometry/{contact_correction,contact_pair}.rs`, `pipeline/physics_hooks.rs` | B | 3D 마찰·rank-1 접선 풀이, 접촉/분리 보정, 반발 문턱, 실제 normal/friction impulse 보고는 일반 스텝에서 사용한다. |
| `dynamics/ccd/{ccd_solver,sweeps,mod,sweeps_tests}.rs`, `dynamics/mod.rs` | A+B | Prepared Native CCD 적용과 승인용 crossing export는 A다. 일반 clamp/sweep, 평면 회전 상자 활성 판단, CCD 진단·상한·일반 회귀는 B다. |
| `pipeline/{solver_motion.rs,solver_motion/tests.rs,event_handler.rs,mod.rs,physics_pipeline/{mod,solve,substep}.rs}`, `dynamics/solver/{velocity_solver.rs,staged_island_solver/{helpers,init,mod,worker}.rs,solver_body.rs}` | A+B | solver motion callback, f64 logical domain·decision/barrier, prepared plan, 전용 trace·관측 serde와 이들 export는 A다. 기본 writeback, CCD/접촉 이벤트, 지정 키네마틱 선속도·기존 각속도 정책과 반발 문턱은 B다. `RigidBody::predict_kinematic_motion` 소비자인 KCC·path 예측을 함께 확인한다. |
| `pipeline/rigid_step_credit.rs`, `geometry/broad_phase_bvh/step_credit.rs`, `data/modified_objects.rs` 및 `data/{arena,coarena,mod}.rs`·`dynamics/{rigid_body,rigid_body_set}.rs`·`geometry/{collider_set,broad_phase_bvh/mod}.rs`의 journal·motion-credit hunk | C | Core 경로 틱에서 `RigidStepCredit`를 호출한다. 제품 저널 분리 뒤 해당 복사·capture·restore·백업 전용 sizing을 없앤다. 저장 검사에서도 사용하는 arena 접근·순회 비용 함수는 남긴다. |
| `data/{arena/serde_tests,graph,graph/validation}.rs`와 `data/{arena,coarena,mod}.rs`의 복원·검증부, `dynamics/{rigid_body,rigid_body_components,rigid_body_set,stored_body_numerics,stored_body_numerics/tests}.rs`의 공통부 | B | 슬롯·세대·free list·graph·동적 수치 admission과 일반 적분을 유지한다. |
| `dynamics/island_manager/{global_split,local_split,manager,mod,persistent}.rs`와 `persistent/{scheduler_tests,validation,validation/eligibility,validation/eligibility_tests,validation/tests}.rs`, `dynamics/joint/impulse_joint/{impulse_joint_set,impulse_joint_set/validation}.rs`, `dynamics/solver/solver_contact_graph.rs` | B | 일반 island scheduler·저장 참조와 contact/joint graph를 유지한다. 저널용 caller만 끊긴 함수는 C 검토에 포함한다. |
| `geometry/{broad_phase_bvh/{mod,update,validation},collider_set,contact_pair,file_shape_aliases,mod,stored_references,stored_references/tests}.rs`, `geometry/narrow_phase/{mod,pair_update,shape_change_tests,stored_numerics,stored_numerics/tests,stored_workspaces,stored_workspaces/tests,validation,validation/tests}.rs` | B | slot reuse, SHAPE 교체와 pending 제거, solver hints, manifold/workspace, alias 및 저장 geometry 검증을 남긴다. 저널 hunk만 위 C 행을 적용한다. |
| `tests/snapshot_portability.rs`, `Cargo.toml`의 고정 Parry 경로 | B | 상류 bincode target parity와 vendoring 근거를 유지한다. 영속 vendor layout을 실제로 바꾸는 PR에서만 검증값을 재생성한다. |

| Parry 파일 | 분류 | P3 처리 |
| --- | --- | --- |
| `partitioning/bvh/{bvh_binned_build,bvh_geometry,bvh_refit,bvh_serde,bvh_traverse_bvtt,bvh_tree,mod}.rs` | B+C | 일반 query·broad phase·투사체 BVH와 cold 그래프 검사는 B다. `bvh_tree.rs`의 `step_credit_bytes`·`retained_step_credit_bytes`·`try_copy_step_credit`는 Rapier 저널 분리 뒤 제거한다. |
| `shape/{compound,compound/serde_state,convex_polyhedron,convex_polyhedron/serde_state,file_aliases,file_aliases/encoding,heightfield3,mod,serde_validation,shared_shape,trimesh,trimesh/serde_state}.rs`, `utils/{array2,vec_map}.rs) | B | Native 파일 검증·shape alias 동일값 검사·법선/반사 scale·수치 보정을 유지한다. `file_aliases`의 동일값 입증은 운동 증명과 별개인 저장 계약이다. |
| `query/contact_manifolds/{contact_manifolds_composite_shape_composite_shape,contact_manifolds_composite_shape_shape,contact_manifolds_heightfield_composite_shape,contact_manifolds_heightfield_shape,contact_manifolds_trimesh_shape,stored_workspace,mod}.rs), `query/mod.rs`의 저장 export | B | 저장 workspace 원본 대응과 root metadata admission을 유지한다. |
| `query/{contact/contact_cuboid_cuboid,gjk/gjk,ray/ray_ball,shape_cast/shape_cast_support_map_support_map}.rs`, `utils/interval.rs` | B 중심 | 일반 cuboid SAT 원 local witness/선택면, coplanar GJK 복구, ray NaN 방지, shape cast·interval 회귀를 유지한다. GJK의 metered 분기만 아래 행에서 정리한다. SAT 수정은 증명 작업 때 들어왔어도 일반 dispatcher가 사용한다. |
| `query/{contact/metered,contact/mod,native_work,gjk/gjk,epa/epa3,sweep_toi/mod,sweep_toi/proxy_distance,mod}.rs`의 metered/local-witness 부분, `contact_manifolds/contact_manifolds_cuboid_capsule.rs`의 Ferrum 명시 SAT 연결 | C → A | Core `solver_trajectory::leaf_contact`와 fullshape exact query의 `proxy_distance_with_local_witness_metered`, `contact_point_cloud_metered`, 명시 capsule/box SAT가 마지막 연결이다. exact 판독 제거 뒤 re-export·callback·계량 구현을 제거한다. 기본 GJK/EPA·CCD와 일반 거리/접촉 수식을 유지하며 capsule SAT는 추가로 활성화한 hunk만 되돌린다. |

### 시험 이관과 공백

강제 스위치의 직접 호출과 `Mode::configure`·`p1b_step_observed`·Engine 시험용 proof
설정의 간접 호출을 함께 추적했다. 같은 이름군에 제품만 쓰는 대조도 있으므로 함수의 설정과
단언을 기준으로 분리한다.

| 시험·파일군 | 처리 | 제품에서 필요한 단언 |
| --- | --- | --- |
| `p1a_compare_*` 7개 | 삭제 + 일부 장면 이관 | 증명 대조군·거절 틱·모드 전용 시간을 지운다. 제품의 실험실 3장면 300틱 회귀는 유지한다. 관절 실험실, 벽돌 깨기 gap, 얇은 mesh 낙하, 더미는 기존 제품 시험과 비교해 빠진 동일 장면의 무오류·관통·겹침/안정 단언을 독립 fixture로 남긴다. |
| `p1b_compare_*` 4개, ignored `p2b_compare_*` 3개 | 삭제 + 일부 장면 이관 | 회전·이동 발판, 끼임/풀림, 64명 재생, 동적 지지체·고속 키네마틱 벽·유한 질량은 현재 KCC 단독 회귀를 보존한다. 64명·405틱 해시와 저장 뒤 6틱 재생, 256/1,024명 제품 benchmark는 유지한다. `p2a_compare_soft_ccd_at_first_contact`는 두 일반 Rapier 설정을 재는 별도 실험이므로 필요하면 proof 모드 확인만 걷고 유지한다. |
| 일반 테스트인 `p2b_compare_passive_knockback`, `p2b_compare_platform_and_rider_at_wall`와 `p1b_tests.rs`의 KCC 전용 조작 | 제품 경로로 다시 쓰기 | proof 기대값을 끊고 outbound push의 운동량·반작용, 피격의 게임 충격, 발판 정지·운반, 두 캡슐의 자리 교환 방지를 기본 KCC로 단언한다. 복수 캡슐의 쌍과 플랫폼 그룹은 실제 제품 결과를 유지한다. |
| `actual_trajectory_tests.rs`, `character_motion/backend/{clock_phase,active_constraints,classification,native_ccd_tests}`의 실제 kernel·suffix·handoff·promotion 테스트, `angular_suffix/tests.rs`, `kinematic_paths/event_prefix/tests.rs` | 대부분 삭제 | exact witness/출력 비트/승인 작업량·native call 수·원 시각을 따지는 단언을 지운다. 남겨야 할 의미는 빠른 센서/대시가 갖는 문서화된 접촉·비충격, 회전 장벽에 대한 겹침·끼임, extra iterations/joints 장면의 재생이다. 제품 허용 오차와 실제 정상 진행을 측정한다. |
| `observation_off_linear_sphere_and_locked_box_keep_actual_force_kernels_and_native_momentum`, `forced_proof_includes_all_enabled_native_dynamic_origins`, `prediction_extra_cadence_never_changes_actual_backend_base_parameters` | 삭제 | 증명 kernel/원본 cadence 전용이다. 같은 `native_ccd_tests.rs`의 `disabled_joint_pair_does_not_disable_an_unrelated_native_ccd_target`는 일반 CCD로 실행하므로 유지한다. |
| 강제 증명인 `squeeze_substeps_preserve_force_targets_and_original_motion_time`, `path_splits_keep_other_targets_forces_joint_load_and_full_tick_motion`, `controller_preview_preserves_jump_and_does_not_duplicate_dynamic_pushes` | 제품 경로로 다시 쓰기 | 매듭이 나뉜 물리 틱에서 관련 없는 위치 목표와 힘·충격이 한 번만 반영되고, pending jump·관절의 실제 힘/파손 보고와 다음 틱이 재생되는지 검사한다. `path_impact_preserves_true_hit_time_and_the_other_bodies_full_tick`에서는 다른 바디가 full dt를 진행하는 제품 단언만 이관한다. `preview_pair_work_counts_each_query_once_and_is_separate_from_ccd`는 삭제한다. |
| `step_motion_tests.rs`의 full turn·내부 반전·원 CCD prefix, `queries/step_motion/logical_clock_tests.rs`, `motion_trace/tests.rs`, `snapshot/tests/actual_paths.rs`의 exact 전용 테스트 | 삭제 + 제품 회귀 유지 | 투사체의 시작·끝 보간, tie/필터, 질의의 상태 불변, BVH 실패의 원래 데이터 보존과 restore 후 같은 명중을 확인한다. 동일 끝점 회전과 exact CCD prefix 단언은 P2b 제품 계약에서 제외됐다. |
| `engine/file_candidate/tests/actual_native_ccd.rs`의 `saved_queries_and_six_tick_runtime_are_identical`, `original_end_damage_rejects_valid_crcs_and_keeps_source`, `uses_exact_decode_and_common_post_decode_quotas` 및 `precise_completed_query_payload_valid_crc_damage_keeps_native_source_unchanged` | exact 부분 삭제, 일반 형식으로 다시 쓰기 | 일반 보간 레코드·유효 CRC의 잘못된 참조·공통 quota·same-build 파일 rejection에 대해 원본 보존과 6틱 일치를 남긴다. outer/cold decoder의 일반 admission 테스트는 보존한다. |
| `character_runtime_admission_preview_stale_support_clear_reenable_and_new_axis_are_history`, `character_runtime_admission_grounded_jump_is_retained_then_consumed_once`, `native_snapshot_retains_path_stop_and_rotating_piecewise_motion_queries` | 제품 경로로 다시 쓰기 | 실사용 지지체 세대·재설정·queued jump/force·정지한 매듭 진행률과 그 뒤 6틱을 지킨다. `rapier_path_checkpoint_replays_support_preview_and_pending_jump`와 PR #117의 `late_knot_stop_*` 검증에 겹치는 부분은 합칠 수 있다. |
| `preapply_capacity_rejection_preserves_last_tick_and_pending_world_bytes`, `zero_progress_rejection_restores_staged_tick_inputs`, `rejected_frame_retry_does_not_repeat_pre_physics_gameplay` | 제품 오류 계약으로 다시 쓰기 | 공통 proof quota 대신 공용 admission의 실제 오류를 쓰거나 test-only 실패 주입을 둔다. 첫 거절의 이전 진단·입력·이벤트·Native 바이트 불변과 재시도에서 tween/scene·게임 입력·동적 힘의 정확히 한 번 적용을 각각 검증한다. |
| `solver_trajectory` 내부 331개와 `character_motion` 내부 198개의 단위 시험 | 모듈마다 위 처리를 적용 | `rounded`·`world_contact`·`query_work_tests`·`cardinal_tests`, proof용 장면·추적·모멘텀·셀이 삭제되는 경우 그 내부 수학 시험도 삭제한다. `clock.rs`의 유한/시간 단위 검사와 유지할 일반 geometry·work의 회귀는 공통 모듈로 이동한다. `credit.rs`의 legacy 명령 소유 증명은 삭제하되 실제 제품의 journal/출력 계약은 아래 검사를 남긴다. |
| `queries/step_motion/finish/tests.rs`, `kinematic_paths/character_admission/tests.rs`, 통합 물리 Web·Platformer·물리 실험실·마을 전투·공개 체크포인트/Native 파일 시험 | 혼합, 일반 경로 유지 | BVH 상한·capture 불능 상태에서 복구·path phase 정밀도·hand-crafted valid-CRC 저장 손상·trajectory 없는 정상 재생은 유지한다. exact 공유 ledger 및 오래된 preview 검사만 제거 대상이다. |

삭제 전에 막아야 할 공백은 복합 매듭의 힘/관절/입력 소비, sensor 대시와 일반 CCD의 활성·필터,
복원 후 명중·carry·path phase의 결정성, 사전 거절과 틱 안 실패를 분리한 복구다. 독립
일반 경로 시험으로 받은 뒤 비교용 모드를 없앤다. 지정 경로의 0.5 구간 정지, 하강 발판
상자, 두 벽 정지와 박스/탑승자/이벤트 일관성은 PR #117 제품 회귀를 기준으로 유지한다.

### 공개 ABI와 저장 형식

| 항상 0으로 생성되는 값 | 노출 경계 | 제거 영향 |
| --- | --- | --- |
| `couplingVisits`(word 22), `failedPairCasts`(23), `failedObstacleContacts`(27), `couplingLimitFlag`(flags word 2의 16), `obstacleLimitFlag`(64) | Rust `CharacterState`와 `engine/unified_physics/web_bridge/characters.rs`의 버퍼, TypeScript `unifiedPhysicsCharacters.ts`의 `UNIFIED_PHYSICS_CHARACTER_LAYOUT`과 `UnifiedPhysicsCharacterStateBufferView`. character capability v1, 28 words/112 bytes. [Core API](../engine/public-api/core.md) | v1에서 0인 예약 word·bit를 유지하면 기존 offset과 소비자가 그대로 동작한다. 압축 시 25 words/100 bytes로 바뀌고 obstacle offset이 이동하므로 capability v2·TS stride/offset·Wasm 패키지·스모크를 함께 갱신해야 한다. |
| `characterPreviewPasses`, `characterPreviewPairCasts`, `characterPreviewPairContacts`, `characterPreviewCouplingVisits`, `characterPreviewCouplingLimits`, `characterPreviewObstacleCasts`, `characterPreviewObstacleContacts`, `characterPreviewObstacleFailures` | Rust `StepStatistics`의 word 4–11과 frame 합계, `DiagnosticsRecord` parts `step`과 `frame`. observations v1 kind 4는 7-word 헤더 + 32 words × 2 = 71 words/284 bytes다. `unifiedPhysicsObservations.ts`의 `UNIFIED_PHYSICS_COUNTER_LAYOUT`, `UnifiedPhysicsCounters`, `decodeCounters`, `copyUnifiedPhysicsDiagnostics`, `FrameState.unifiedPhysics`와 profiler 경로에 노출된다. [Core API](../engine/public-api/core.md) | 0인 자리를 두면 두 counter block과 JSON 키가 유지된다. 압축 시 각 block이 24 words이고 전체가 55 words/220 bytes다. observations v2, 두 block의 시작 위치와 공개 TS 키·문서·profiler 검사도 바뀐다. |

`pairCasts`, `pairContacts`, `obstacleCasts`, `obstacleContacts`, `failedObstacleCasts`,
`droppedContacts`, blocked flags, `kinematicPath*`, native CCD/impulse 및 contact 관측은
일반 경로 소유다. 예를 들어 KCC의 움직이는 장애물 cast 실패는 `failedObstacleCasts`에
기록한다. 삭제 표는 제품 스텝이 생성하는 값 기준이다. 디코더가 받아들일 수 있는 저장된
legacy 상태와 구분해 슬롯을 정리한다.

| 저장 레코드 | 현재 연결 | 추천 정리와 버전 |
| --- | --- | --- |
| `WorldState.step_motion`의 `TargetMotion.exact: Option<exact::Segment>`, exact `Curve/Kernel`, `exact_failed`, `EventCollector.2`의 solver `MotionTrace` | Physics snapshot v7 안에 직렬화된다. 공개 Native 파일 Engine section과 Core/Engine 체크포인트도 그 world를 포함한다. exact reader가 허용하는 pose·time·owner·BVH 대응과 상한이 있다. | 같은 빌드 정책을 유지하고 exact 저장·reader·확정 trace를 지운다. 일반 `StepMotion`의 보간 pose, BVH 및 resume는 남긴다. 실제 physics wire 제거 시 `PHYSICS_SNAPSHOT_VERSION` 7→8. |
| `CharacterRuntime.motion_stop`/옛 coupling 상태, `PathScratch.preview`·`pending_stops` 등의 proof 레코드, 캐릭터·step/frame 통계 | `character/file_admission.rs`, `kinematic_paths/character_admission.rs`, `stored_characters` 및 Engine의 통계 구조 안에서 검증한다. | f64의 실제 구간 stop과 phase, 현재 character input/support, 동적 속도·외력, 일반 통계는 유지한다. 바꾸는 wire 필드를 확정해 physics v8과 정합시킨다. Engine의 직접 Serde 필드를 바꾸면 `checkpoint_codec` 내부 엔진 버전 2도 올린다. |
| `MotionScene`, `TickOutputs`, rigid journal/그래프 복사 | 런타임 scratch는 `serde(skip)`이거나 한 틱 전용이다. decoder에 `MotionScene` 초기 heap의 별도 charge가 있다. | scratch만 이동/제거할 때 해당 타입의 decode charge와 저장이 실제로 소비하는 예산을 함께 정리한다. 같은 serialized layout이면 이 변경만으로는 wire version을 올리지 않는다. |

현재 Physics snapshot과 Engine 코덱, Native 파일 헤더는 Core/target의 build 지문을 확인한다.
Native v1은 SDK 지문도 확인하고, 공개 메모리 체크포인트는 Engine 인스턴스 소유권도 확인한다.
따라서 **기존 빌드의 저장 파일이 새 P3 빌드에서 열리는 호환성은 현재 계약에 없다**.
P3 빌드가 생성한 새 파일과 체크포인트는 같은 빌드에서 복원돼야 한다. 외부 `F2DFILE`
envelope의 7-section 배치가 유지되면 outer v1을 유지할 수 있고, Rust 내부의 layout 버전과
공개 체크포인트 capability 버전은 각각 자기 계약으로 관리한다. 소스 지문이 들어간 Native
저장 SHA·템플릿 fixture는 Rust 소스를 바꾸는 단계마다 재생성하고, 정상 제품 동작의 해시를
별도로 대조한다. PR #117 비교처럼 지문/종속 CRC와 실제 payload 변화를 나눠 확인한다.
현재 28/71 ABI를 보존해도 내부 저장 layout을 바꾸면 새 버전과 fixture가 필요하다.

### 오류와 저널 제거 조건

| 검사·동작 | 현재 발생 지점 | P3 이후 검사 |
| --- | --- | --- |
| `native-checked-error-probe.mjs`의 수동 기본/설정 지정과 자동 RAF | 수동은 고정 10ms world에 5ms를 요청해 clock mismatch가 난다. 자동은 nominal 10ms에 승인된 힘 500,000·가상 질량 0.01을 30ms RAF에서 평가해 `InvalidCharacter`가 난다. | 세 사례 모두 path journal이나 `CapacityExceeded`에 의존하지 않아 그대로 유지한다. 이전 CCD 진단과 포즈·시간·Native bytes, RAF 중단·재시작, restore 검사를 유지한다. |
| `aggregate-native-authoring-probe.mjs`의 두 `physics capacity exceeded` 단언 | Physics Spec collider 추가 batch 한도와 Scene JSON 혼합 배치 admission이다. | 그대로 유지한다. 제거할 증명 ledger와 무관한 body/collider/schema 한도에서 계속 실패할 수 있다. |
| 제품 지정 경로/대시의 `CapacityExceeded` | `step_with_kinematic_paths`의 16개 경로 한도, `tick_motion::begin_tick_motions`의 경로 + 비캐릭터 대시 합계 16개 제한과 별도로, 현재는 저널·출력 예약이 proof ledger에서 거절될 수 있다. | 제품에서 용량 오류가 필요한 회귀는 16개 승인 가능한 경로에 비캐릭터 대시 하나를 추가하는 실제 preflight로 옮긴다. 입력과 직전 출력·저장 불변을 동시에 확인한다. 기존 경로별 4매듭, 기타 제품 설정 상한도 유지한다. |
| `injected_native_tick_failure_preserves_diagnostics_checkpoint_and_native_file`, `planar_legacy_inputs_are_rolled_back_with_a_zero_progress_rejection` | 테스트 전용 주입은 tick output/journal을 만든 뒤 staged 입력을 적용하고 실패한다. | 이 둘을 preflight 실패로 대체하지 않는다. 남은 제품 실패의 발생 위치와 mutation 순서를 먼저 확인한다. 실패 가능한 단계가 앞당겨져야 하는 곳은 사전 검사로 옮기고, 남는 틱 중 실패에는 필요한 입력·작은 출력/이벤트 복원을 유지한다. 실제 틱 실패 주입 전후 바이트, 예약 입력과 다음 재시도를 검사한다. |

`CapacityExceeded` 자체는 공개 오류이며 일반 한도에도 쓰인다. `UnresolvedMotion` 및 exact
prefix 전용 에러 변환이 제품에서 실제로 발생하는지 이관 때 다시 확인하되, 공개 enum/tag 제거는
별도의 호환 결정을 거친다. `MAX_PROOF_WORK`를 없앨 때 할당의 checked 산술·fallible reserve와
Native 파일의 독립적인 decode 예산을 남긴다.

### 단계별 PR 제안

앞 단계의 merge를 다음 단계의 기준으로 삼는다. 삭제량은 위 물리 줄 수에서 잡은 작업
범위이며, 이관할 코드·테스트와 vendor 공통 hunk를 제외하면 줄어든다. 1만 줄을 넘는
하위 묶음은 표에 적은 대로 분리한다. 제품 참조가 남은 동안 해당 선언을 유지한다.

| 순서 | PR 단위와 예상 삭제 줄 | 단계별 판정과 위험 |
| --- | --- | --- |
| P3-1 제품 경계와 시험 이관 | 공통 시간·pose·용량 유틸리티를 뽑고, 복합 경로·센서·CCD·재생·거절 시험을 제품 경로로 옮긴다. 비교 fixture와 강제 모드 의존을 1–4천 줄씩 정리한다. | 제품 상태 해시는 유지할 예상이다. 같은 물리 입력, preview와 실제 힘 소비, 정지 phase를 독립적으로 검사한다. |
| P3-2 제품 preflight와 journal | `Work`/출력 예산·오류 소유권을 분리하고, 제품의 경로 시작 전 실패와 틱 중 복원 범위를 명시한다. interval credit·rigid graph journal 및 Rapier/Parry의 C 복사 API를 독립적으로 정리한다. 약 1–4천 줄. | 이전 예산의 일부 실패가 제품 동작으로 바뀔 수 있다. 실제 16개 경로+대시 거절, 실패 주입, 동적/관절/체크포인트를 비교한다. 미해결 mutation 순서가 있으면 저널 삭제를 해당 PR에서 보류한다. |
| P3-3 저장/ABI 경계와 증명 실행 연결 제거 | 호환 방침을 적용하고 `StepMotion` exact reader/producer, `MotionTrace` 및 저장 proof fields를 정리한다. `BackendEvents`·강제 스위치·proof 경로와 그 전용 테스트 등록을 제거한다. 아래 A 파일들은 module 선언에서 끊어두고 실파일 삭제는 여러 PR로 분리한다. 약 3–8천 줄. | 먼저 일반 CCD·투사체·발판 경로와 B/C import를 분리해 두어야 한다. native/wasm 비시험 및 모든 테스트 target에 미사용 선언·이전 import가 없어야 한다. 승인 구간 바이트·step motion의 비exact 명중·손상 CRC/참조 거절을 비교한다. 저장 버전은 이 PR의 실제 wire 변경과 함께 적용한다. |
| P3-4a vendor 실행 훅 | Rapier callback·Prepared Native CCD·logical clock hunk, Parry exact metering/local-witness hunk와 전용 시험을 원본 diff 기준으로 정리한다. 약 2–5천 줄. | 일반 CCD 활성/관측, 마찰·반발·축 잠금·KCC, broad phase와 저장 graph를 대조한다. 혼합 파일의 공통 수식을 원본으로 덮어쓰지 않는다. |
| P3-4b 구형 캐릭터 풀이 | `character_contacts`, `character_dynamics` legacy coupling과 `character_constraints`·`kinematic_limits`·옛 character preview/resolve, 연결 시험을 제거한다. 약 5–8천 줄. | 제품의 `predicted_pose`, stop helper와 KCC의 캐릭터 장애물·동적 push는 유지한다. |
| P3-4c `character_motion` 실파일 | `backend.rs` 약 6천 줄, `backend/representable`은 normal-witness/angular-rate 약 5천 줄과 나머지 약 8천 줄, 기타 `backend/` 약 8–10천 줄, `actual_scene`·native CCD·sensor·feedback·suffix 및 남은 legacy shell 약 8–10천 줄로 각각 나눈다. | P3-3에서 등록을 끊은 파일부터 지운다. 제품으로 옮긴 error/시간/pose와 저널 경계를 반복 점검한다. |
| P3-4d `solver_trajectory` 원 진입·contact | 루트 검사·전용 top-level 시험 약 7–9천 줄, `world_contact`·feature/initial support·센서·clock의 증명부 약 5–8천 줄로 분리한다. | 위에서 옮긴 `Time`, `Domain` 공통 연산, pose equality와 일반 query budget을 보존한다. |
| P3-4e `solver_trajectory/rounded` | common timeline·phase/correlated/finite/stationary 약 5–8천 줄, `integrated_linear` 약 6.7천 줄, `output/shared_normal` 약 8.8천 줄. `output/support`는 rotating-box-ball·exact-box·corotating 약 8.6천 줄과 나머지 약 6.4천 줄을 분리하고, 이외 `output` 약 9천 줄을 마지막 묶음으로 지운다. | 모듈 등록이 끊긴 상태에서 각 파일을 삭제한다. 최종 `solver_trajectory`/proof experiment 모듈 선언, build fingerprint 입력·패치 기록과 정확 운동 문서 참조까지 정리한다. |

P3-3에서 모듈 등록을 끊으면 이후 실파일 삭제 PR마다 독립적으로 빌드할 수 있다. 물리
스텝에서 force 여부를 선택하는 옵션이나 release용 dead-code 예외를 두지 않는다.
후속 PR의 공통 통과 기준은 Core test/Clippy/포맷·Rust 시험 구조, Wasm release와 소스 지문, SDK 및
Native 저장/재생·패키지 검사, 공개 API/문서 링크다. 동작을 이관하거나 vendor 계산에 손을
대는 단계에는 통합 물리 Web·Platformer·물리 실험실·마을 전투의 관련 로컬 검사를 붙인다.
마지막 PR에 이 지도 첫 표와 같은 두 cold build와 크기 측정을 반복한다.

동일 설정·입력의 64명 해시는 단계별로 기존 값과 대조한다. 달라질 것으로 예상하는 경우는
명시적으로 바꾼 admission의 거절 결과나 **별도 승인으로** 변경한 일반 수치 정책이다.
Wasm 크기는 제품 그래프를 줄이는 P3-2~3과 vendor hook 제거에서 먼저 줄 수 있다.
Rust 파일을 등록에서 분리했어도 `build.rs`가 추적하는 비시험 파일의 삭제는 지문에
반영되므로, 그 뒤 PR에서도 Native fixture·SHA는 갱신될 수 있다. 해시 외 차이가 나면
매듭/CCD/캐릭터/저장 바이트 중 실제 차이가 난 항목을 기록하고 원인을 확인한다.

### 사용자 결정이 필요한 경계

| 결정 | 선택지와 권고 |
| --- | --- |
| 0인 공개 값과 버퍼 | **권고는 기존 v1의 키·offset·flag 예약을 유지하고 0을 쓰는 것**이다. 내부 proof 상태는 삭제할 수 있다. 소비자에 공개된 이름의 제거와 압축은 별도 v2 PR에서 진행하는 선택지다. 그 경우 오래된/새 SDK와 Wasm 조합, 숫자 배열 직접 소비자, profiler/exported 타입과 release 공지를 함께 다뤄야 한다. |
| 저장 파일·체크포인트 | **권고는 현재 same-build 계약을 유지하고, 실제 payload layout 변경 때 내부 버전을 올리는 것**이다. 오래된 빌드는 그 빌드의 파일을 계속 연다. 빌드 간 이어하기가 필요하면 향후 별도 migration PR에서 옛 v7 일반 레코드의 검증/변환과 exact 데이터의 거절 또는 정의된 변환, target/SDK 버전 및 cold quota를 설계한다. 구버전 fixture로 성공·실패 원자성을 검증한다. 일반 데이터를 유지하기 위해 proof solver를 계속 실행할 필요는 없다. |

P3-0에서 남은 판정은 제품 저널을 대신할 실제 실패 경계의 크기, 혼합 파일에서 마지막
일반 호출이 제거되는 순서, 위 두 호환 선택과 삭제 후 실측 절약량이다. 컴파일 경고는
A 후보를 좁히지만 저장 분기의 실행 가능성과 vendor 공개 호출은 별도로 확인했다.
이번 브랜치의 변경은 이 문서뿐이다. 기준 측정·실험 빌드와 별도로 최종 검증은 문서 링크
검사만 실행한다.
