# HD-2D 후속 기능·검증 후보

기준일: 2026-11-05
상태: 기능 확장은 설계 후보·미착수, 실물 GPU·장시간 항목은 후속 검증 대기다.
기능 개발은 대상 장면과 완료 조건을, 환경 검증은 기기·실행 조건을 정한 뒤 시작한다.

현재 지원 범위는 [공간 계약](../engine/data-scene-spatial.md), [물리 기능 맵](../development/architecture/physics-engine.md),
[Core API](../engine/public-api/core.md)가 기준이다. 완료된 개발 단계는 이 문서에서 관리하지 않는다.

## 실게임 품질 후속 검증

실제 마을·전투·조명·경사·오디오와 원본/LOD 비교는 [품질 회귀](../development/quality/smoke-check.md#실게임-품질과-복구맵-작성-회귀)를 기준으로 한다.
Blender tree/pine 후보는 삼각형 수를 줄였지만 FPS 개선이 확인되지 않아 기본 예제에는 활성화하지 않는다.

| 남은 검증·분석 | 실행 시 완료 조건 |
| --- | --- |
| 실물 GPU·장시간 실행 | 기기/브라우저·해상도/DPR별 동일 시나리오, 프레임 분포·Wasm/GPU·오디오 수명과 장시간 증가 여부 기록 |
| LOD 전환 외형 | 거리 경계 왕복·다양한 카메라에서 pivot/외곽선·cutout·그림자·전환 튐 캡처. 외형과 실제 성능이 모두 수용될 때 콘텐츠 기본 적용 판단 |
| 실제 마을 제출 비용 | 원본 draw 수는 재질 인접 병합으로 줄지 않았다. 효과 켬/끔의 GPU 시간·제출 비용을 대조한 후 별도 최적화 선택 |

### 평면 2D 픽셀 표현·아틀라스 실기기 검증

PNG extrusion의 현재 계약과 검증 명령은
[PNG 가장자리 보호](../engine/public-api/labs.md#png-아틀라스의-가장자리-보호)와
[Smoke Check](../development/quality/smoke-check.md#png-아틀라스-가장자리-보호-gate)를 따른다.
아래는 환경 검증 대기이며 기능 미구현 목록이 아니다.

- 실제 기기의 해상도/DPR·정수 배율·카메라 이동에서 sprite/tile/text/particle·shake의 픽셀 정합과 letterbox·pointer 좌표를 확인한다. 시뮬레이션/replay 불변과 GPU target 비용을 함께 기록한다.
- 실제 모바일 GPU 또는 fp16 mediump 환경에서 2048px 이상 atlas의 소수 크기·위치·회전·UV flip을 측정한다.
- 경계 오차와 내부 텍셀 선택 오차를 구분한다. extrusion이 내부 텍셀 오차도 해결한다고 가정하지 않는다.
- 기본 fragment 정밀도 변경이 필요하다면 같은 장면의 `webgl2.gpuTiming` draw 비용·color/normal 정합·기존 아트 변화를 비교한다.
- 기기·드라이버·PNG·옵션·픽셀 비교·GPU 시간 증거를 남긴다. 소프트웨어 offscreen smoke를 실물 GPU·native compositor·장시간 검증으로 대체하지 않는다.

## 엔진 확장 후보

| 후보 | 현재 경계와 착수 조건 |
| --- | --- |
| 전체 scene GPU transaction | 기존 모델 GPU 준비 rollback과 지형/billboard/environment/target까지의 일괄 활성화·복구를 구분한다. |
| 공통 URL 해석·요청 공유 | texture/sound/JSON의 cache key·인증·독립 취소·참조 수명을 정의한다. 기존 bounded manifest 로딩·모델 요청 공유·CPU/GPU cache·IndexedDB preload를 중복 구현하지 않는다. |
| 네트워크 geometry 스트리밍 | 사전 등록 CPU LOD·native visual chunk와 구분한다. 요청 취소·재진입·자원 상한·오래된 결과 차단부터 설계한다. |
| 추가 모델 형식·재질·압축 | 실제 자산에서 BLEND, UV1, 추가 재질, Draco/Meshopt 필요성을 측정한다. decoder 의존성·CPU/메모리 예산·실패/fallback을 먼저 정하며 skin/morph/전체 PBR로 자동 확대하지 않는다. |

장치 손실 처리의 플랫폼 기준은 [GPUDevice.lost](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost)다.
현재 명시적 복구와 terminal destroy를 구분한다. 자동 재시도 UI 정책·실물 GPU loss 검증은 앱 필요에 따라 별도 범위를 정한다.

## 물리·탐색 후속 후보

지원하는 물리·보행 충돌의 범위는 [물리 기능 맵](../development/architecture/physics-engine.md)을 따른다.
아래 항목은 그 이후의 별도 후보이며 기존 기능의 재구현 목록이 아니다.

| 후보 | 착수 시 완료 조건 |
| --- | --- |
| 대형 경로·물리 진단 | 기존 bounded joint/CCD 진단·batch cast 이후의 대형 scene 비용을 측정하고, 추가 broadphase/query 가속이 필요한 경우 착수 |

## 추가 시각 효과와 제품 경계

독립 평면 shadow receiver, 화면 공간 광선 mask, 반투명 다중 depth, 물리적 bokeh,
PCSS·다중 point shadow light는 제품 필요와 비용·fallback·HUD/alpha 경계를 먼저 정할 후보다.
현재 높이 기반 그림자·normal lighting·view-depth DOF를 신규 미구현 기능으로 세지 않는다.

three.js 비교의 고정 기준은 `83f6bd095356c68334df7d9b7ec03a0abebff3fc`다.
[반복 모델 제출](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/objects/InstancedMesh.js),
[LOD](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/objects/LOD.js),
[요청 관리](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/loaders/LoadingManager.js)를 참고하되
production 의존성이나 외부 물리 solver를 추가하는 계획은 아니다.

작성 도구 후보는 [제작 편의성](game-development-convenience-review.md)에 둔다.
Rust simulation 소유권, bulk Wasm 경계, WebGL2 기본과 선택 WebGPU, agent-first JSON/patch 흐름을 유지한다.
