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
