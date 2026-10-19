# HD-2D 실제 모델 적용 후 고도화

2026-10-17 사용자 요청에 따라 다음 여섯 단계를 순서대로 개발한다. 기존 접촉 경계 수정은 유지하며,
각 단계의 코드·계약·저장·실제 Wasm/packed browser 검증을 분리한다. visual editor·삼각형 메시 물리·
스키닝/PBR 전체 구현은 이번 범위가 아니다. 원본 게임 프로젝트와 Blender 에셋은 검증 입력으로만 읽는다.

| 단계 | 작업 | 완료 조건 | 상태 |
| --- | --- | --- | --- |
| 1 | 다층 길찾기 비용 | 실제 model-cove cell32 요청 수락·상층 도착, 8M/1M 예산 유지와 밀집 후보 예산 거절 | 완료 |
| 2 | 큰 정적 모델 | 32개 이하 기존 draw 순서 유지, 큰 모델의 재질 병합, 기존 geometry·최종 32 batch 예산 유지 | 완료 |
| 3 | Blender 재질 | unlit과 bounded emissive strength, 실제 사용자 GLB 수용과 조명/발광 픽셀 검증 | 완료 |
| 4 | 움직이는 모델/부착물 | Rust가 root XY·height·yaw 및 제한된 attachment DAG를 소유, 물리/그림/자식 동기화·fresh restore | 완료 |
| 5 | 자유 각도 collider assembly | 기존 OBB 수학 재사용, 실제 회전 벽 차단과 빈 모서리 통과·층 필터. 보행면은 cardinal 유지 | 완료 |
| 6 | 큰 장면 자원 | native chunk/LOD 선택, platform 자원 수명·사전 로드와 계측, 경계 왕복·종료/성능 증거 | 완료 |

## 책임과 호환성

- Rust는 이동·충돌·부착물 pose·카메라 기반 가시성/LOD를 계산한다. TS는 authoring 검증·에셋 로딩·
  GPU 준비/자원 수명·브라우저 계측을 담당하며 frame별 entity pose를 복제하지 않는다.
- 2번의 큰 모델 병합은 static bake된 동일 재질만 대상으로 한다. alpha blend와 animated node를 추가하지
  않는다. 소스 primitive 수와 geometry에 별도 상한을 두며, 기존 final draw budget은 늘리지 않는다.
- 3번은 Khronos `KHR_materials_unlit`, `KHR_materials_emissive_strength` 계약을 따른다. strength는
  렌더러 예산상 유한 0..64로 제한한다. 두 확장의 같은 재질 조합은 glTF 계약에 따라 거절한다.
- 4번의 attachment는 Data Scene 전용 제한 DAG이며 cold assembly flattening과 구분한다. proxy world pose를
  별도 authoritative 저장값으로 만들지 않는다. 기존 save는 계속 읽으며 새 root yaw와 연결 계약은 버전으로 구분한다.
- 5번에서 OBB를 authoring에만 추가하지 않는다. broadphase/narrowphase, 길찾기 및 gateway pose 검사에도
  연결한다. 임의 회전 terrain의 보행 영역을 AABB로 넓히지 않는다.
- 6번의 청크/LOD는 모델 표현/자원을 대상으로 하며, 화면 밖이라는 이유로 지형·물리·길찾기를 제거하지
  않는다. 카메라 밖 shadow caster와 사전 등록한 LOD 자원을 유지하고, 자원 소유와 visible draw를 구분한다.

## 검증

실제 `rail-survivors/assets/models` 58개의 로딩 수용 결과와 game-test `model-cove`를 입력으로 쓴다.
원본 설치본을 바꾸지 않고 임시 복사본에 새 packed 엔진을 넣어 검사한다. 실패 재현의 `ok:true`와
기능 수락/도착은 별도로 판정한다. 실제 대상 기기 GPU는 이 환경의 headless 결과와 구분해 기록한다.

임시 중간 자료는 `/tmp/ferrum2d-followups-1-6/`, 최종 근거는 기존
`artifacts/hd2d-static-model/followups-1-6/`에 둔다. `artifacts/` 최상위 작업 폴더는 늘리지 않는다.

관련 계약: [공간 Data Scene](../engine/data-scene-spatial.md),
[기존 개발 기록](hd2d-graphics-followups.md).

재질 기준: [Khronos unlit](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_unlit),
[Khronos emissive strength](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_emissive_strength).


## 구현 및 검증 범위

여섯 항목의 코드 연결을 마쳤다. 6번은 CPU 자원을 먼저 load/register하는 bounded 계약이며,
visual chunk 이탈 후 GPU를 해제하고 재진입 시 다시 준비한다. 자동 네트워크 스트리밍으로
확장하지 않는다. headless 검증의 timer unsupported 기록은 유지한다. 이후 받은 Windows 실물 GPU
측정은 아래에 별도 환경·원본 hash·남은 검수 범위와 함께 반영한다.

상세 변경 파일·실행 명령·실패 수정·최종 수치는
`artifacts/hd2d-static-model/followups-1-6/report.md`와 `verification.json`에 기록한다.

최종 결과: Rust 1,391 unit + 1 integration·웹 943개·packed 공간 browser 4조건 통과. 실제 GLB 58/58, cell32 상층 도착·fresh 저장 복원 통과. GPU timer는 이 headless 환경에서 unsupported로 기록했다.


## 실물 GPU 측정 근거 반영 (2026-10-18)

사용자가 제공한 game-test의 2026-10-17 실측 문서·주 측정 JSON·청크 해제 보조 JSON을 읽고
반복별 수치와 표본 수를 재계산했다. 이번 반영에서 새 실물 브라우저 측정을 실행하지 않았다.
원본 게임 문서·측정 JSON·설치 엔진은 변경하지 않았다.

- 설치 엔진 `0.1.0-local.20261017140229395.365e69f9`, Windows Chrome 155 / AMD Radeon 8060S /
  ANGLE D3D11 / 하드웨어 WebGL2 / 1465×800 / DPR 1 / 디스플레이 75Hz다.
- 주 측정 15회 + 모델 그림자를 제외한 청크 해제 3회 = 18회, 유효 GPU 표본 80,951개다.
  두 JSON 모두 complete이며 각 구간의 GPU 결과 수가 frame 수와 일치한다. 중복·비정상 query 및
  미측정 frame은 0이다. query는 결과가 도착한 frame이 아닌 발행 frame에 연결했다.
- 원본→LOD 삼각형은 6,084→1,188(80.47% 감소), GPU 가중 평균은 5.5958→5.2587ms
  (관측상 0.3371ms/6.02% 감소)다. 순차 실행 결과이며 조건 순서를 교차한 인과/유의성 검증은 아니다.
- 그림자가 필요한 청크의 자원 유지와 그림자 수요가 없는 청크의 GPU 해제를 구분했다.
  보조 검사 30회 왕복은 버퍼 35→9→35, 가까운 동일 상태에서 자원 수 동일이다.
- 밀집 216개는 전체 13,483 frame 중 16.67ms 초과 111개(0.823%), 33.33ms 초과 3개다.
  3개 모두 첫 반복이며 frame 최대 40.20ms다. 첫 반복 CPU/GPU 평균은 10.56/10.94ms,
  후속 두 반복은 약 3.59/4.38ms다. 최대 CPU/GPU 값도 약 39.5/39.98ms이지만 각각의 집계이므로
  같은 frame에서 발생했다고 단정하지 않는다. 추가 198개 모델에는 추가 물리 collider가 없다.

이 근거로 단일 PC의 실물 GPU 계측·native LOD 선택·청크 GPU 자원 수명 검증을 완료 범위에 추가한다.
LOD 미술 품질과 지연 원인 규명·개선은 미완료다. 평균 75fps는 VSync 상한의 영향을 받으며, 이 프로토콜의
허용 frame 예산은 60fps 기준 16.67ms다. 75fps를 매 frame 유지하는 별도 판정은 하지 않는다.

### 다음 작업

| 우선순위 | 책임 | 작업과 완료 기준 |
| --- | --- | --- |
| P1 | 측정/엔진 진단 | 느린 frame의 앞뒤 구간을 제한된 크기로 보존한다. 발행 frameId에 CPU·GPU·draw/shadow/cache hit·모델/행렬 upload를 연결해 export하고 예산 초과 시점을 재현한다. 원인 증거를 얻은 뒤 최적화한다. |
| P1 | 게임 에셋 | 현재 테스트용 단순 윤곽 LOD를 원본에서 만든 LOD로 교체하고 pivot·외곽선·팔레트·cutout·그림자를 실제 게임 표시 크기로 비교한다. 성능 수용과 시각 수용을 따로 판정한다. |
| P2 | 재현성 검증 | 밀집 장면을 단독 반복하고 원본/LOD 조건 순서를 교차한다. 같은 경로·해상도에서 그림자/DOF/안개를 하나씩 비교하고 지연 frame과 효과 비용을 연결한다. |

현재 JSON에는 구간별 분포와 LOD/자원 전환만 보존돼 있어 40ms frame의 upload·draw·그림자 비용과
직접 연결할 수 없다. 클럭·동시 작업·driver/compiler trace도 없어 stall 원인은 미확정이다.
다른 GPU·DPR·해상도·장기 플레이·밀집 물리 성능으로 이 결과를 일반화하지 않는다.

입력은 game-test의 `tests/playtest/gpu-benchmark.md`, `gpu-benchmark-chrome.json`,
`gpu-benchmark-summary.json`, `gpu-chunk-release-chrome.json`, `chrome-gpu-environment.json`이다.
정확한 입력 경로·SHA-256·재계산 결과는 기존 artifact 하위
`artifacts/hd2d-static-model/followups-1-6/hardware-review.json`에 기록했다.

## 밀집 장면 지연 진단·렌더 제출 개선 (2026-10-18)

후속 P1의 엔진 진단과 렌더 제출 비용을 보강했다. 원본 game-test 대신 임시 복사본에
변경 전·후 엔진을 각각 연결한다. Windows Chrome의 별도 프로필에서 같은 AMD Radeon 8060S,
1465×800/DPR 1, 밀집 216개 장면을 20초 예열 + 60초 측정으로 반복한다.
원본 사용자가 제공한 집계 결과와 이번 실행의 절대 GPU 시간은 직접 비교하지 않는다.

- `profiler.frameTrace`를 켜면 느린 frame의 앞뒤 구간을 제한된 크기로 보존한다. 현재 renderer
  frame ID와 완료된 과거 GPU query ID를 분리하고, GPU 결과를 발행 frame에 연결한다.
  CPU·원시 interval·model draw/upload·그림자 cache/pass·자원 수를 함께 export할 수 있다.
  미측정 GPU 시간은 0으로 채우지 않으며, runtime 기본값은 진단 기록 꺼짐이다.
- 모델 행렬을 여러 batch/그림자 면마다 같은 GPU buffer 시작 위치에 덮어쓰던 방식을 바꿨다.
  실제 그릴 pass의 행렬을 사전 구성하고 frame당 최대 한 번 upload한 뒤 독립된 offset으로
  소비한다. native draw 순서와 singleton uniform 경로는 유지한다. GPU buffer 예약은
  64KiB→512KiB(+448KiB)이며 object 수는 증가하지 않는다.
- 별도 Chrome trace에서 generic vertex attribute 조회가 command buffer 동기 대기를 거치는 것을
  확인했다. 모델 primitive 색상·alpha cutoff를 main/point/sun program의 uniform으로 전달해
  generic attribute 변경과 frame당 두 번의 조회·복원을 제거했다. terrain/billboard vertex color와
  caller VAO/program 등 공유 GL 상태 복원은 유지한다. 이 대기가 원본 40ms의 원인이라는 뜻은 아니다.
- 그림자 cache는 실제 shadow caster의 asset/content ID·shadow face mask·행렬을 비교한다.
  camera visibility bit·receive 설정·카메라 전용 모델·미사용 asset 변경은 depth map을
  무효화하지 않는다. 실제 caster pose/LOD/그림자 면 변경은 계속 무효화한다.
  매 frame 전체 asset 문자열 결합과 miss 시 전체 model packet 복사는 제거했다.

진단 API 계약은 [quality API](../engine/public-api/quality.md#느린-프레임-전후-기록)에,
완료된 실측·검증 명령·남은 원인 범위는
`artifacts/hd2d-static-model/gpu-stalls/report.md`에 기록한다.

변경 전 별도 실측의 47/42.1ms frame은 geometry upload 0, shadow cache hit, shadow pass 0이며
render 호출 구간에서 42.5/33.7ms를 사용했다. 발행 frame별 GPU 시간은 10.90283/0.83524ms다.
원본 40.20ms와 동일한 원인이라는 증거는 없다. 추가 trace의 변경 전 진단은 최대 18.4ms로
40ms를 재현하지 못했고, 초기 반복의 동시 host 부하와 계측 차이도 남는다.
엔진 진단/제출 보강과 원인 확정을 구분하며, 새 frameTrace로 재발 구간을 보존하는 작업은 계속 필요하다.

이번 slice의 코드·리뷰·검증은 완료했다. 웹 952개, matrix/cache 이후 packed 전체 4조건,
최종 package의 모델/재질 각 4조건과 실제 timer 연결 검증이 통과했다. 최종 AMD 3회는
최대 interval 17.8ms, 33.33ms 초과 0개, 독립 trace 연결 124/124다. GPU 상위 시간은 증가했고
추가 intermediate→final 1회씩의 비교에서도 GPU 평균 1.377→1.511ms/P95 4.042→4.311ms였다.
원본 40ms의 해결이나 GPU 성능 향상을 확정하지 않으며, GPU 비용 차이는 후속 프로파일링 대상으로 남긴다.

### 푸시 전 전체 변경 검증 (2026-10-18)

- `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`,
  `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets -- -D warnings` 통과.
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`: unit 1,391개 + integration 1개 통과.
- `pnpm build`: Wasm 재생성과 전체 package/app/example 빌드 통과. 재생성한 Wasm SHA-256은
  GPU 실측의 `3c3f29893bf05bcdf6c8f78ce3610b279f2b9e037d07f4504324cc3936c6abd2`와 같다.
- `node scripts/package/check-package-files.mjs --require-wasm-pkg --verify-pack`,
  `pnpm validate:public-api-surface`, `pnpm validate:docs-links`, `git diff --check` 통과.
- 최근 웹 952개·lint·최종 모델/재질 각 4조건 결과는 동일한 코드 hash를 확인해 재사용했다.
  생성 템플릿·배포 변경은 없어 consumer 전체 matrix와 외부 배포는 실행하지 않았다.

## HD-2D 전투 실행·부하 검증 (2026-10-18)

다음 우선순위는 배경 전용 GPU 검사에서 실제 AI·발사·충돌·피해·파티클을 함께 실행하는 검증으로 확장하는 것이다.
조사 결과 generic Data Scene은 탐험 실행기만 연결되어 있었다. 평면 Shooter의 대량 객체 검사를
HD-2D 전투 성능으로 보고할 수 없어 먼저 `gameplay.combat` opt-in native 실행기를 연결했다.

- Rust가 기존 scene-neutral movement, timer/action projectile, 높이별 sweep, collision reaction,
  lifetime과 particle preset을 실행한다. 동적 탄환/파티클도 공간 깊이·높이를 공유한다.
- 기본 false와 기존 네 인자 Wasm 설정 ABI를 유지한다. 전투는 별도 atomic v2 설정을 사용한다.
  지원하지 않는 action, 잘못된 참조/float32 값/상한은 가능한 범위에서 activation 전에 검증한다.
- trigger 적은 전투 전용 이동 경로로 벽과 terrain에 대응한다. 일반 주인공/navigation의 collider 계약은 유지한다.
  동적 billboard 검색은 build 단계 정렬과 binary search를 사용한다.
- pause/complete freeze, generation-safe 정리, 초기화, custom item pickup, EffectEvent payload 보존을 검증한다.
  불완전한 combat 저장은 TS/Rust에서 사전 거절한다.
- `smoke:hd2d-combat`를 CI validate job/aggregate에 연결했다. 자체 rock GLB 216개 + 적 0/32/128개,
  네 viewport/DPR 조건에서 입력 개수 외에 실제 model triangle/draw·AI 위치 변화·측정 중 명중/파티클 증가를 확인한다.
  CPU/GPU 원시 sample은 renderer 발행 frame ID로 연결한다. CI FPS는 실기기 성능으로 해석하지 않는다.

실행 결과와 명령·원인/수정·실기기 측정 범위는 `artifacts/hd2d-static-model/combat/report.md`에 기록한다.
당시 범위는 직접 추적하는 적의 자동 사격과 기본 접촉 전투였다. 플레이어 입력 공격은 아래 후속 slice에서 보강했다.
projectile prefab/visual, 전투 health/timer/dynamic spawn 저장, 다중 AI의 층간 경로 탐색,
실제 게임 전용 콘텐츠와 장기 전투는 후속 범위다.

검증 완료: Rust unit 1,403개 + integration 1개, 웹 958개, 최종 packed 전투 12조건,
기존 공간 전체 4조건과 최종 탐험 공개 API probe가 통과했다. lint/fmt/build/package 및 문서/API 검사도 통과했다.
Chrome 155 / AMD Radeon 8060S / 1465×800·DPR1에서 5초 예열 + 20초 측정 × 3부하 × 3회,
총 13,500프레임을 측정했다. 전부 약 75fps이며 적128 조건 Rust 평균 2.976ms/P95 3.8ms,
GPU 평균 0.894ms/P95 1.687ms였다. 33.33ms 초과는 0개, 최대 callback interval은 18.3ms다.
최종 Wasm SHA-256은 `dfb04054c287cac8ff55ce7236f6e6f7f19e103db42fc7115498d8b5c66401af`다.
이 결과는 초기 128명 중 근접 4명 사망 후 124명이 지속 사격하는 자체 rock 216개 합성 장면이며,
실제 game-test 전체·DOF/bloom·게임 전용 에셋·장기 전투의 성능 보증으로 확장하지 않는다.


## HD-2D 플레이어 입력 발사 (2026-10-18)

기존 `projectileAction`의 input/enemies와 `setInputActionBinding`을 Data Scene combat에 연결했다.
새 authoring 필드는 없다. primaryActor만 입력 공격을 실행하며 타이머에 input action을 연결하면 적용 전에 거절한다.
이전 적 자동 사격 Wasm과 구분하는 `supportsDataSceneInputProjectiles()` native v1 검사를 추가했다.

- Rust가 cooldown 뒤·world integration 전에 bounded action binding을 검사한다. substep당 입력 공격은 최대 한 번이다.
  `pressed`/`down`, fixed-step의 짧은 연속 입력·zero-substep latch와 pause 동안 입력 폐기를 공유한다.
- renderer와 입력이 동일 presented camera를 사용한다. 직교/원근, 현재 viewport, pixelArt 여백·camera snap,
  발사자의 body midpoint + billboard visual elevation을 반영한다. TS는 CSS→logical viewport 변환만 수행한다.
  조준은 이 시각 높이의 수평면이며 실제 3축 탄도/고저차 조준은 포함하지 않는다.
- 기존 projectile 생성·수명·피해·사망·파티클 경로를 공유한다. 적/플레이어 collision target과
  body/compound mask를 CCD nearest 후보에서 적용해 다른 층이나 충돌 거절 대상이 앞에 있어도 올바른 대상을 찾는다.
- 잘못된 화면/여백/ray 또는 capacity 거절은 cooldown을 소비하지 않는다. 기존 configure ABI와 stats v1은 유지한다.

native 신규 회귀 10개를 포함한 unit 1,413개 + integration 1개, 웹 961개가 통과했다.
전체 build, fmt/clippy/lint, 공개 API·문서·Data Scene 샘플·tarball 검사를 통과했다.
Linux 입력 20조건, Windows Chrome 전투12 + 입력20조건, 기존 공간 전체4조건도 통과했다.
최종 브라우저 검증 결과와 재현 명령은 `artifacts/hd2d-static-model/combat-input/report.md`에 기록한다.
당시 남긴 전투 저장은 아래 checkpoint slice에서 보강했다. projectile prefab/visual, 다층 AI 경로 탐색,
실제 게임 전용 장기 전투 검증은 남아 있다.


## HD-2D 전투 checkpoint (2026-10-18)

플레이어 입력 공격 다음으로 전투 진행 저장·복원을 연결했다. 기존 GameStateSnapshot 바깥 version 2와
탐험 v2~v8/hash는 유지하고, combat 문서는 nested v9 `progress.combat`(native codec v1)을 사용한다.

- authored 고정 ID로 pose/높이/속도/회전·체력·수명·timer/fired·action/reaction cooldown을 저장한다.
  비행 중 탄환도 source ID/UV/높이/속도/피해/수명/faction을 저장하고 fresh handle로 복원한다.
- 죽은 발사자는 제거 commit 전에 새 authored texture slot을 확보한다. 이전 live authored contact 쌍을
  복원해 enter-only 효과가 중복되지 않게 했다. 입력/latch·accumulator·파티클/RNG·event/진단/통계는 reset한다.
- `supportsDataSceneCombatProgress()`로 이전 combat Wasm과 구분한다. 전체 기본 문서 apply와
  `includeDataSceneProgress`가 필수이며 원문 레시피·구조/참조·숫자/상한 검증 뒤 native batch를 commit한다.
  runtime gameplay 재설정은 저장 metadata를 무효화한다. 별도 physics snapshot과의 결합은 지원하지 않는다.
- inline static/kinematic checkpoint 범위다. dynamic body/joint/FSM, authored 외 entity,
  저장되지 않는 정적 정의 변경은 capture를 거절한다. 기존 탐험/공간/animation 복원 ABI를 유지했다.

native 신규12개를 포함한 unit1,425 + integration1, 웹968개가 통과했다.
최종 packed 패키지로 Linux 입력20 + checkpoint4, Windows Chrome 전투12 + 입력20 + checkpoint4가 통과했다.
기존 탐험37개와 공간 전체4조건도 통과했다. 공간/탐험 검증 이후에는 combat cooldown의 sparse 배열 거절만 보강했고,
최종 Linux/Windows 패키지의 공개 dist/pkg 513개 파일이 현재 산출물과 일치함을 확인했다.
최종 packed 브라우저/패키지/기존 탐험 및 공간 회귀 결과·명령·제한 사항은
`artifacts/hd2d-static-model/combat-save/report.md`에 기록한다.
당시 남긴 projectile prefab/visual은 아래 slice에서 보강했다. 다층 AI 경로 탐색과 게임 전용 장기 전투 검증은 남아 있다.


## HD-2D 탄환 프리팹·외형 (2026-10-18)

checkpoint 다음 항목으로 `gameplay.projectilePrefabs`와 `projectileAction.projectilePrefab`을 연결했다.
정적 sprite texture/atlas UV/크기/색상·trigger AABB·billboard scale/cutoff/상대 elevation을 공유 정의로 작성한다.
원문 authoring의 명칭을 저장하고 새 texture slot으로 복원하는 combat codec v2를 추가했으며 기본 v1 저장은 유지한다.

- source generation/action별 바인딩을 Rust가 조회하고 기존 생성·높이 필터·CCD·피해·수명·소유권 경로를 공유한다.
  입력 ray와 spawn은 같은 prefab elevation을 사용한다. collider 크기는 world unit이며 visual scale과 독립적이다.
- asset/float32/UV/참조/기능 지원과 binding 상한을 activation 전에 검증한다. 새 native configure v3도 전체
  catalog와 handle/action을 검증한 뒤 commit한다. 기존 configure/stats/render ABI는 유지한다.
- catalog 최대256, source/action binding8192, texture ID는 정점 f32의 정확한24bit 범위다. 정적 중앙 pivot sprite 범위로,
  animation·velocity 회전·임의 collider·normal/독립 shadow 설정은 후속 요구가 생기면 별도로 다룬다.
- 브라우저 gate의 `prefabCases` 4조건은 실제 quad UV/RGBA/크기/cutoff와 slot 교체 후 복원·실제 명중을 검사한다.
  기존 checkpoint4·입력20·전투12도 유지한다. 최종 검증 명령·결과는
  `artifacts/hd2d-static-model/combat-projectiles/report.md`에 기록한다.

당시 다음 항목으로 남긴 다층 AI 길찾기는 아래 slice에서 보강했다. 게임별 에셋과 긴 전투·checkpoint 통합 검증은 남아 있다.

native 신규8개를 포함한 unit1,433 + integration1, 웹975개가 통과했다.
최종 packed 패키지의 Linux28조건·Windows Chrome40조건과 기존 탐험37개·공간 전체4조건이 통과했다.
세 검증 패키지의 공개 dist/pkg515개 파일이 현재 산출물과 일치하며, 중복 package/tarball은 정리했다.


## 다층 전투 AI 길찾기 보강 (2026-10-18)

`gameplay.combatNavigation` opt-in을 추가했다. native Chase는 기존 공간 A*와 sweep을 재사용해
ramp/bridge/층간 connection을 따르며 floor·elevation을 실제 body/billboard에 반영한다.
경로 실패 때 직선으로 추적하지 않고 정지한다. 기존 player route와 기본 직접 추적 동작은 유지한다.

- 최대 64-agent route, 공유 search scratch, outer update당 검색 1회/총 1M work와 검색당 600K 상한.
- trigger AABB·wall/상호 mask·height를 일관되게 적용. generation/floor/terrain connection 변경·막힘·teleport 시 경로 무효화.
- authoring/capability/원자적 v4 bulk 설정, 별도 diagnostics, v9 checkpoint 복원 후 재탐색.
- packed browser 8-agent 다층·pause·checkpoint 회귀를 기존 CI combat gate에 포함했다.

최종 실행 결과·명령·리뷰 수정은 `artifacts/hd2d-static-model/combat-navigation/report.md`에 기록한다.
남은 제품 검증은 실제 게임 콘텐츠에서의 긴 전투·저장/복원·기기별 CPU/GPU 측정이다.
군중 회피, 대형 장면의 계층형/비동기 탐색, 다른 movement/action 확장은 별도 요구 범위다.


## 엔진 후속 코드 개발 단계와 완료 근거 (2026-10-18~19)

사용자 목표 **“개발 남은 스텝들 완료 해”**에 따라 아래 여섯 단계를 모두 개발·검증했다.
완료한 원래 모델 여섯 단계와 구분한다. 현재 상태는 아래 표이며, 이후 기록의 당시 후속 항목은 각 단계 완료 시점의 이력이다.

| 단계 | 코드 범위 | 완료 기준 | 상태 |
| --- | --- | --- | --- |
| C1 | 군중 회피·적별 정지 거리 | native 같은 층/높이·상호 mask·벽/경사/gateway 보존, 개체별 stopDistance, 새 handle 저장 복원·예산 회귀 | 완료 |
| C2 | 대량 AI 탐색 | 공유 목표 경로 재사용·프레임 분할 탐색으로 대기/긴 동기 작업 완화, 공통 예산·공정성 검증 | 완료 |
| C3 | 다층 이동 패턴 | seekTarget/accelerate를 공간 경로·층 연결에 연결하고 기본 동작/저장 호환 검증 | 완료 |
| C4 | 전투 action | Data Scene native melee/dash/spawnPrefab 실행·충돌/높이·입력/타이머·저장 계약 | 완료 |
| C5 | 탄환 표현 | 정적 prefab에 atlas animation·이동 방향 회전 추가, 실제 render·저장/복원·구형 build 거절 | 완료 |
| C6 | 공간 WebGPU 대응 | 공개 공간 ABI와 WebGL2 fallback을 유지하며 지원 WebGPU 경로/효과를 구현·브라우저 검증 | 완료 |

각 단계는 원문 authoring 검증, Rust 실행, public API와 Wasm capability, 저장/복원,
관련 회귀 gate와 한국어 문서를 함께 갱신한다. 외부 push/publish와 원본 게임 프로젝트 변경은 별도 요청 시 진행한다.


### C1 완료 근거

선택적 crowdAvoidance·Chase별 stopDistance, 실제 peer sweep·bounded corner/ring 보강 탐색,
정확한 반경 안 도착과 큰 좌표/저속 credit, shared-edge 코너와 f32 분할 commit 검증을 완료했다.
기존 v4·navigation 진단·v9 저장/render ABI를 유지하고 v5 원자적 batch와 별도 capability/stats를 추가했다.
Rust unit1,463+integration1, 웹984, 최종 packed Linux36/Windows48, 기존 공간4와 탐험37이 통과했다.
상세 변경·명령·리뷰 수정·지원 범위는 `artifacts/hd2d-static-model/combat-crowd/report.md`에 기록한다.
C4~C6는 위 표의 다음 순서로 계속 개발한다.


### C2 완료 근거

static A*의 scene-owned 단일 job과 기본262K/최대600K slice·요청8M/outer1M 예산,
최대8개 footprint/target/revision별 공유 route를 구현했다. cache 진입과 실제 follower 모두 native sweep을
통과하며 취소 owner 공정성·admission 원자성·pending checkpoint/fresh 복원도 검증했다.
브라우저에서 발견한 다리 입구의 peer corner 유실을 support 경계/인접 ramp 점으로 보강했고
큰 collider offset의 half-open rounding도 수정했다. 기존 v4/v5·진단·v9 저장 ABI는 유지한다.
Rust unit1,472+integration1, 웹985, 최종 packed Linux40/Windows52, 기존 공간4와 탐험37이 통과했다.
최종 package와 각 검증의 dist/pkg519개가 일치한다. 상세 변경·명령·실패 수정·지원 범위는
`artifacts/hd2d-static-model/combat-scheduler/report.md`에 기록한다. C3는 아래 단계에서 보강했으며 C4~C6는 계속 개발한다.


## C3 SeekTarget·Accelerate 공간 이동 (2026-10-19)

선택 `combatNavigation.movementPatterns: "all"`로 기존 Chase에 SeekTarget·Accelerate를 연결했다.
SeekTarget의 substep turnRate와 Accelerate의 substep 가속/속도 한도를 유지하면서 실제 경사·다리
gateway·벽/층/높이/mask·선택 peer padding을 적용한다. 최대64개와 outer1M 예산을 공유한다.
v6 mode flag와 별도 movement v1 기능 검사로 구형 Wasm의 적용/저장/복원을 사전 거절한다.
기존 v4/v5·render/진단 ABI와 v9 저장 구조는 유지한다.

리뷰에서 계산된0/벽 거절과 budget defer의 구분, pending credit의 속도 되먹임,
작은 거리의 방향 dead zone을 수정했다. 반전·벽 회전·원 관통 최초 진입·정지 반경0,
64개 fixed substep과 보류된 velocity 보존을 native 회귀로 검증했다.
새 packed browser gate는 SeekTarget4개·가속 상행4개·하행4개 각각의 실제 층 이동과
경사 위 checkpoint JSON/fresh handle의 위치·높이·velocity 복원, pause/resume,
billboard 발 높이와 frameSearches≤1/work≤1M을 확인한다.

Rust unit1,486+integration1·웹988, Linux44·Windows Chrome56·기존 공간4조건과
clean tarball consumer 탐험37개가 통과했다. 전체 build/fmt/clippy/lint/package/API/docs/authoring/harness도 통과했다.
공개 dist/pkg519개가 canonical tarball·현재 산출물·Windows·공간·clean consumer에서 일치한다.
최종 Wasm은 `05187dabe82adbbbe5afdd49dc21c257d6fe97d482b5f35b3d89292c72a05178`다.
변경 파일·명령·실패 수정·제한 사항은 `artifacts/hd2d-static-model/combat-movement/report.md`와
`verification.json`에 기록한다. 다음 단계는 C4 native melee/dash/spawnPrefab이며 C5·C6도 남아 있다.

## C4 melee·dash 범위 완료 (2026-10-19)

native melee/dash의 primary 입력·반복 타이머, 실제 collider의 mask/높이/벽·피해·사망,
경사·다리 gateway와 평면 타일 경계 sweep, 기존 v9 위치·높이·체력·쿨다운 복원을 연결했다.
액션 v1 기능 검사로 구형 Wasm의 적용/저장을 사전에 거절하며 기존 설정·render·저장 codec은 유지한다.
outer update당 별도1M 작업과128회 시도 상한을 적용한다. 회전된 OBB와 공간 높이 누락을 사전 거절하고,
최종 entity/action ID가 authoring·타이머·프리팹 참조·저장 계약에 일관되게 반영되도록 수정했다.

Rust unit1,500 + integration1, 웹995, 최종 packed Linux48·Windows Chrome60조건,
기존 공간4조건과 clean tarball consumer 탐험37개가 통과했다.
현재 빌드·각 브라우저 패키지·clean consumer의 공개 dist/pkg521개 파일이 일치한다.
실행 명령·리뷰 수정·제한과 최종 패키지는 `artifacts/hd2d-static-model/combat-actions/report.md`에 기록한다.
이 단계 다음으로 **spawnPrefab 실행과 생성 개체의 저장·복원**을 연결했다. 아래 C4 공개 연결 완료 기록을 따른다. C5·C6는 남아 있다.

## C4 spawnPrefab native 단계 진행 (2026-10-19)

Rust에 scene 소유 actor prototype catalog와 입력/타이머 생성 경로를 추가했다.
기존 prefab semantic ID를 유지하며 catalog는 최대256개다. 생성 개체는 sprite·atlas playback·충돌체·
static/kinematic body·체력·수명·faction/tag·이동·액션·타이머·변수 트리거를 이어받는다.
atlas 정의는 공유하고 재생 시점은 개체별로 유지한다. 공간 생성은 source floor/elevation과 실제 collider 중심의
보행면·높이 차·벽/타일을 검사한다. 실패하면 새 개체·생성 성공 이벤트·쿨다운·생성 일련번호를 추가하지 않는다.
기존 actionFailed와 예산 진단은 발행한다.
실패한 임시 할당의 generation은 진행할 수 있다.

별도 action1M/frame·128시도 안에서 live spawned512·소유 기록1024·전체 World2048을 제한한다.
추적 정지 거리·탄환 prefab/기본 billboard 표현을 상속하고 maxAgents와 그림자 caster/texture 예산도 공유한다.
prototype의 attachment/model·dynamic body·joint·FSM·projectile 상태와 지원하지 않는 이동 패턴은 거절한다.

개발 중인 native combat codec3은 authored actor72를 유지하면서 spawned89와 serial·prefab 참조,
체력·수명·타이머·쿨다운·개별 collider 활성 상태·atlas/legacy animation을 저장한다.
죽은 생성 발사자는 논리 일련번호로 보존해 슬롯 재사용과 fresh scene 복원 시 비행 중 탄환이 새 개체를 참조하지 않게 한다.
기존 v1/v2 packet은 유지한다. native 회귀와 빌드 증거는
`artifacts/hd2d-static-model/combat-spawn-native/report.md`에 기록한다.

이 native 단계에서는 공개 Data Scene authoring의 catalog/기능 검사, semantic JSON 저장 검증과
packed browser/CI 연결을 보류했다. 이후 완료한 공개 capability는 아래 완료 기록을 따른다.
그 이후 C5 탄환 애니메이션/회전과 C6 공간 WebGPU 대응을 계속한다.

## C4 spawnPrefab 공개 연결 완료 (2026-10-19)

`gameplay.spawnPrefabs`의 standalone prototype과 stable sparse uint32 ID 검증,
입력/타이머 생성의 공개 facade, 새 spawn v1 기능 검사와 native v7 설정을 연결했다.
원본 billboard를 cold capture하도록 공간 설정 순서를 조건부로 조정했다.
JSON codec3은 생성 일련번호/프리팹 이름과 명시적 instanceId/spawnSerial 참조로 저장한다.
제거된 생성 발사자의 탄환 출처, fresh handle 복원, 활성 플래그와 개별 animation clock을 포함한다.
구형 codec1/2와 melee/dash capability는 유지한다.

현재 웹1,004·Rust1,515 unit+integration1, 전체 build/lint, tarball allowlist/실제 pack 검사,
clean consumer public import/type 확인을 통과했다. native와 TS 정의 검증을 맞추며
1프레임 legacy animation, 최종 interaction upsert, raw pose 및 model yaw 불일치 사전 거절을 보강했다.
공개 spawn 4 viewport/DPR(각 직교/원근) gate는 원본 제거·생성·실제 이동·그림자·JSON·pause·정리를 통과했다.
Linux Chromium153/SwiftShader 및 Windows Chrome155/AMD Radeon 8060S에서 각각 전체64조건,
기존 공간4조건을 통과했다. 현재 build·두 browser package·clean consumer의 공개 dist/pkg525개 파일이 일치한다.
실행 명령·검토 수정·한계와 정리한 증거는 `artifacts/hd2d-static-model/combat-spawn-public/report.md`와
`verification.json`에 기록한다. C4는 완료했으며 다음 C5의 완료 기록은 아래를 따른다. C6 공간 WebGPU 대응은 남아 있다.


### C5 탄환 atlas animation·이동 방향 회전 완료 (2026-10-19)

선택적 `gameplay.projectilePrefabs`의 `sprite.animation`과 `rotateToVelocity`를 구현했다.
최대32 atlas frame·fps 0.001..1000·반복/one-shot을 기존 native SpritePlayback에 연결하고,
각 탄환은 독립 clock을 사용한다. 회전은 현재 flat/직교/원근·pixelArt camera에 투영한 속도에서 계산하며
physics pose·AABB·속도는 바꾸지 않는다. 정의는 공유하고 최대512 shot의 render cache를 재사용한다.

독립 visual capability1와 cold gameplay v8, semantic combat progress v4를 공개했다.
clock/pause/flip·동적 UV·source/생성 serial을 검증해 fresh handle·texture slot에 복원한다.
회전은 저장하지 않고 현재 camera에서 파생한다. 기존 codec1/2/3·outer snapshot2/nested Data Scene9와
render ABI를 유지하며 구형 Wasm은 apply/assets/save/restore 전에 거절한다.
평면 복원 후 재저장을 거절하던 spatial revision 문제도 성공한 restore 뒤에만 갱신하도록 수정했다.
확정 사용 계약은 [탄환 animation·회전](../engine/data-scene-authoring.md#탄환-atlas-animation이동-방향-회전-개발-소스)을 따른다.

Rust unit1,521+integration1, 웹1,011, fmt/clippy·전체 lint/build/Wasm·package/tarball·문서/API/harness 검사와
clean consumer import/typecheck가 통과했다. Linux Chromium153/SwiftShader와 Windows Chrome155/AMD Radeon8060S의
전체 전투 gate가 각각68조건, 기존 공간·모델 gate가4조건 통과했다. visual4조건마다5개 projection/pixel 조합에서
실제 atlas 색·제출 quad 방향·독립 clock·pause 카메라 변경·fresh 복원 framebuffer 차이0을 확인했다.
좁은 native/public/회귀 gate 리뷰에서 추가 P1/P2는 발견하지 못했다. `pnpm format`은 하위 script가 없어 실검사가 없었으며
Rust fmt는 별도 통과했다. 상세 변경36개·실행 명령·중간 실패/수정·한계는
`artifacts/hd2d-static-model/combat-projectile-visuals/report.md`와 `verification.json`을 따른다.
C5는 완료했으며 다음 코드 개발은 **C6 공간 WebGPU와 WebGL2 fallback**이다.
실제 소비자 게임의 장기 전투/GPU 성능 측정과 외부 push/publish는 이번 기능 회귀 범위에 포함하지 않는다.


## C6 공간 WebGPU 완료 (2026-10-19)

기존 native geometry v1/v2·model 확장 v1을 유지하고 WebGPU depth/cutout terrain·billboard와
GLB indexed/instanced model을 연결했다. 기본색·발광·MASK·양면·sRGB/data texture·glTF sampler/mip을
공유하며 camera matrix·pose·LOD·frustum/visibility는 Rust가 계속 결정한다.
모델은 async preload에서 GPU validation/OOM·queue 완료를 확인한 뒤에만 authoring lease로 활성화한다.
preload 실패·대기 중 기존 draw·dispose/destroy 수명 회귀를 포함하며 기존 씬 자원을 보존한다.

factory의 옵션/공간 지원 검사와 GPU pipeline 준비를 canvas 취득 앞으로 옮겼다.
이전 bloom 요청이 WebGPU canvas를 먼저 잡아 WebGL2 fallback도 실패하던 문제를 실제 이전 packed build에서 재현했다.
현재 미지원 요청은 context 전에 fallback하며, 연결 뒤 실패는 terminal error로 전파한다.
`createFerrumRuntime`도 초기 Data Scene 공간 요구사항을 factory에 전달한다.

Windows Chrome155/AMD의 실제 canvas와 Linux Chromium153/SwiftShader offscreen target에서
가로/세로·DPR1/2, 직교/원근 geometry 및 나무·바위·건물 3종+중복나무 인스턴싱을 검증했다.
cutout 구멍/다리 가림, depth 제출 순서 독립, picking, warm terrain/model upload0,
fresh handle 복원 framebuffer 차이0과 WebGL2 픽셀 parity를 확인했다.
Linux canvas copy/map 오류는 엔진 없는 최소 WebGPU에서도 재현했으므로 CI는 실제 GPU offscreen target을
별도 표기하고, native canvas는 기본 smoke 명령으로 별도 검증한다. adapter 미지원이나 픽셀 오류는 skip하지 않는다.
상세 명령·소스/패키지 증거·중간 실패와 수정은 `artifacts/hd2d-static-model/spatial-webgpu/report.md`에 기록한다.

후속으로 공간 ambient/4 point/directional 조명, 모델 tangent normal·unlit와 billboard normal atlas,
HDR/DOF 표준13·고품질25 sample·actor focus·색 보정·안개·pixelArt·debug를 연결했다.
같은 public/Wasm 경로에서 효과16개 상태의 실제 픽셀, HUD 불변과 fresh restore를 비교한다.
환경 단계의 소스·패키지·실행 증거는 `artifacts/hd2d-static-model/spatial-webgpu/environment/report.md`에 별도로 기록한다.

point/sun depth32float 그림자와 hard/PCF, native caster/face range·model mask·cast/receive, GPU texture revision과 shared cache를 연결했다.
카메라8 record·모델8 pass의 matrix를 한 번에 준비해 같은 submit의 덮어쓰기를 피하고, alpha cutout과 카메라 밖 caster를 보존한다.
queue.submit 성공 뒤에만 shadow map/cache를 유효화하며, 미제출 encoder와 GPU target/group 실패·resize 경쟁을 검증했다.
리뷰에서 debug 버퍼 확장 시 caster 버퍼 해제와 PCF 효과 검증 누락을 수정하고, 수정 전/강제 hard-only 패키지의 실제 GPU 실패도 보존했다.

웹1,043·Rust unit1,521+integration1, 전체 build/lint·fmt/clippy·Wasm·package/문서/API·clean consumer 검사가 통과했다.
Windows Chrome155/AMD의 실제 canvas와 Linux Chromium153/SwiftShader offscreen에서 각각 그림자19상태×4 viewport/DPR×2투영의
152개 화면 비교, 기존 geometry/model·환경16상태, HUD 불변·fresh JSON 복원과 warm GPU 할당0을 검증했다.
최종 패키지의 기존 WebGL2 전체 공간 gate4조건도 통과했다. 공개 dist/pkg543개는 현재 build·두 browser·WebGL2·clean consumer에서 일치한다.
최종 변경 파일·명령·리뷰 수정·negative proof와 정본은 `artifacts/hd2d-static-model/spatial-webgpu/shadows/report.md`와 `verification.json`에 기록한다.
`completion-audit.json`은 C1~C6의 완료 근거와 C5 이후 native/전투 소스·기존 정본 보존을 대조한다. 합의한 여섯 단계의 남은 구현은 없다.
실제 기기의 장시간 전투/GPU 시간과 WebGPU 자원 통계·device-loss 복구도 별도 후속이다.

## 커밋 전 코드 정리·검증 (2026-10-19)

신규 TypeScript·브라우저 스모크와 전투 설정 facade 등 47개 파일의 들여쓰기·줄바꿈·표현식을 정리했다.
정리 전후 TypeScript 구문 트리를 비교해 실행 코드와 shader·fixture 문자열의 동일성을 확인했다.
포매터는 임시 디렉터리에서만 사용했으며 저장소 의존성과 lockfile은 바꾸지 않았다.
계획 요약과 그래픽 설계의 상단 상태를 모델 후속 1~6·전투 C1~C6 완료 기록에 맞췄다.

최종 소스에서 다음 검증을 통과했다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm lint
pnpm test:web
pnpm build
pnpm package:check:ferrum-web
pnpm validate:docs-links
pnpm validate:public-api-surface
pnpm validate:rust-test-harness
git diff --check
```

Rust unit 1,521개·integration 1개와 웹 1,043개가 통과했고, 신규 스모크 15개의 Node 구문 검사도 통과했다.
Wasm 빌드는 쓰기 가능한 임시 `WASM_PACK_CACHE`를 사용했다. 최종 tarball을 별도 프로젝트에 오프라인 설치해
목적별 공개 subpath 5개 import와 엄격한 NodeNext 타입 검사를 통과했다.
기존 Vite 큰 chunk 경고와 Cargo `repository` 메타데이터 권장 안내는 남아 있다.

이번 서식 정리에서는 기존 브라우저·실기기 매트릭스를 반복하지 않았다. 위 C6의 소스·패키지 해시와
브라우저 결과는 당시 정본의 기록이며, 서식 정리 후 파일과의 바이트 동일성을 뜻하지 않는다.
create-game·agents·placement viewer 계약과 Pages 경로·렌더링은 바뀌지 않아 해당 별도 검증은 반복하지 않았다.
