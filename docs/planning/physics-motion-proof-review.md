# 3D 물리 운동 증명 방식 검토

상태 — 사용자 결정 B(허용 오차 방식 전환)와 기준 확정(2026-11-27). P1a 강체 장면 비교를 마쳤다.

관련 문서: [통합 3D 물리](unified-3d-physics-plan.md)의 "미해결: 회전 상자 접촉의 운동 증명", [PR CI 정리](ci-and-studio-distribution-plan.md)(빌드 시간 조사의 출발점).

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
| `tests/smoke/native-checked-error-probe.mjs:147`(실제 `CapacityExceeded` 필요) | 실패 사례를 새로 정하거나 바꾼다 |
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
   범위는 아래 "P1 작업 범위"에 둔다. 결과로 B를 확정하거나 되돌린다.
2. **P2 기본 경로 전환**: 기본값을 새 방식으로 바꾼다. 캐릭터는 KCC와 발판 운반·군중·끼임만 자체 코드로 재구성한다.
   - 공개 문서와 CHANGELOG에 결과 변화를 공지한다.
   - 군중 hash와 리플레이 기준 파일을 다시 만든다.
3. **P3 삭제**: 다음을 지우고 빌드 시간과 Wasm 크기를 다시 잰다.
   - `solver_trajectory` 증명부와 그 테스트
   - `character_motion`의 승인·거절 처리
   - vendor의 증명 전용 훅
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
속한 fixture, 센서, 관절에서 접촉을 끈 쌍은 제외했다. 관통은 각 장면의 지정 벽·바닥·체인에서 앞뒤 위치로
판정했다. 겹침 깊이는 각 장면의 월드 좌표 단위다. 틱 사이의 순간 관통과 모든 물체 쌍의 구간 전체는
측정 범위 밖이다.

| 장면 | 단계 오류 수 (최초 틱), 현행 → 실험 | 정지 수 (최초 틱), 현행 → 실험 | 지정 장벽 관통, 현행 / 실험 | 최대 겹침 깊이, 현행 → 실험 | 릴리스 시간 평균 / 최대 (µs), 현행 → 실험 |
| --- | --- | --- | --- | --- | --- |
| 실험실 `rigid-materials` | 185 (115) → 0 | 185 (115) → 0 | 미검출 / 미검출 | 4.0241852 → 4.0241852 | 3044.02 / 5163.73 → 8.84 / 63.81 |
| 실험실 `contacts-sensors` | 237 (63) → 0 | 237 (63) → 0 | 미검출 / 미검출 | 2.6360264 → 4.2528687 | 5354.24 / 7336.77 → 6.36 / 64.26 |
| 실험실 `collider-gallery` | 250 (50) → 0 | 250 (50) → 0 | 미검출 / 미검출 | 5.7482629 → 6.3751030 | 4940.01 / 12033.69 → 15.87 / 69.86 |
| 실험실 `joints-lab` | 300 (0) → 0 | 299 (1) → 0 | 미검출 / 미검출 | 0.6535240 → 1.0178833 | 4309.68 / 10047.95 → 58.80 / 176.42 |
| 벽돌 깨기 `breakout-gap` | 128 (136) → 0 | 128 (136) → 0 | 미검출 / 미검출 | 0 → 0.0381165 | 1438.23 / 3493.53 → 12.18 / 341.89 |
| 얇은 메시 지형 고속 낙하 `thin-mesh-fall` | 0 → 0 | 0 → 0 | 미검출 / 미검출 | 0.0000043 → 0.0061371 | 6.08 / 839.04 → 0.64 / 24.07 |
| 상자 8개 더미 `box-stack` | 292 (8) → 0 | 292 (8) → 0 | 미검출 / 미검출 | 0.0010937 → 0.0102206 | 7117.96 / 12354.22 → 1.98 / 35.04 |

기존 ignored 장면의 정지 틱 115·63·50을 모두 재현했다. 관절 장면의 현행 경로는 0틱에 일부 시간을
승인한 뒤 `CapacityExceeded`를 반환했고, 이후 시간 승인 없이 `UnresolvedMotion` 299회를 반환했다.
나머지 장면의 단계 오류는 모두 `CapacityExceeded`였다. 관절 장면의 초기 겹침은 0.6680799였으며,
실험 경로는 관절 7개를 유지했고 용접 앵커의 최대 이격은 0.0713455였다. 상자 더미는 실험 경로의
마지막 60틱에서 최대 선속도 0을 기록했다. 얇은 메시를 향해 속도 1,000으로 떨어뜨린 공은 두 모드
모두 CCD 클램프 1회로 지형 위에 남았다.

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
검출되지 않았다. 멈췄던 물리 실험실 네 장면과 벽돌 깨기가 계속 진행했고, 상자 더미의 마지막
60틱은 최대 선속도 0이었다. 단계 오류와 관통에 대한 결과를 근거로 캐릭터 장면을 비교할 가치가 있다고 판단했다.
`contacts-sensors`와 `collider-gallery`의 최대 겹침은 각각 4.25와 6.38 월드 단위였다. 현행의
최댓값은 정지 전까지 진행한 운동을 반영하므로, 두 수치를 같은 구간의 겹침 차이로 해석할 수 없다.
B의 최종 확정에는 장면별 겹침 허용 한도와 캐릭터 품질 확인이 남아 있다. P1a에는 캐릭터 경로 구현을
포함하지 않았다.

재현 명령은 저장소 루트에서 Rust 1.97.1로 실행한다. 시간은 `--release` 실행에서만 집계한다.

```bash
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1a_unproved_rigid_step_respects_continuous_ccd -- --show-output
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --lib p1a_compare -- --ignored --show-output --test-threads=6
cargo +1.97.1 test --manifest-path crates/ferrum-core/Cargo.toml --locked --offline --release --lib p1a_compare -- --ignored --show-output --test-threads=1
```

Core 전체 테스트 1회에서 단위 3,786건과 통합 1건이 통과했다. 기본 실행이 건너뛰는 11건 중 P1a 비교
7건은 위 명령으로 각각 통과했다. Core Clippy(`--all-targets -- -D warnings`), Rust 포맷 검사,
문서 링크 검사도 통과했다. Wasm 빌드와 브라우저 smoke는 P1a 검증 범위에서 제외했다.
