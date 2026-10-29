# HD-2D 후속 기능·검증 후보

기준일: 2026-10-29
상태: 미착수 후보. 별도 task에서 범위·완료 조건을 확정한 뒤 개발한다.

이 문서는 미착수 후보만 관리한다.
[현재 공간 계약](../engine/data-scene-spatial.md)을 기준으로 하며, 과거 단계에서 남았던 작업을
이미 구현된 뒤에도 미완료로 되살리지 않는다. 공간 WebGPU, native attachment/OBB/LOD,
군중 회피·분할 탐색·melee/dash/spawn·탄환 animation은 신규 후보가 아니다.

## 실게임 품질·성능 검증

| 후보 | 현재 한계 | 착수 시 완료 조건 |
| --- | --- | --- |
| 실제 콘텐츠의 장기 전투·저장/복원 | 합성 장면의 기능/작업 상한 검증과 실제 게임 부하는 다름 | 게임별 asset·AI·탄환·VFX·층 이동·checkpoint를 함께 실행하고 시간·부하·환경·원본 hash 기록 |
| 느린 frame 원인 확정·GPU 비용 비교 | frameTrace와 제출 보강은 완료했지만 원본 40.20ms 원인은 미확정 | 발행 frame ID의 CPU/GPU·draw/shadow/cache·upload 근거 보존, 단독 반복·조건 교차 후 원인과 개선을 분리 판정 |
| LOD 외형 검수 | 삼각형/자원 절감 검증이 미술 품질 수용을 대신하지 않음 | 실제 표시 크기에서 원본 기반 LOD의 pivot·외곽선·팔레트·cutout·그림자를 비교 |
| 다른 기기·DPR·해상도 | 단일 AMD PC와 software adapter 결과를 일반화할 수 없음 | 대상 환경별 CPU/GPU p95·느린 frame·메모리·효과별 비용과 실제 장면 예산 확정 |

## 엔진 확장 후보

| 후보 | 별도 설계할 경계 |
| --- | --- |
| WebGPU GPU 시간·자원 통계·device-loss 복구 | 현재 픽셀/할당 검증과 profiler·장치 복구 계약을 구분. 복구 실패와 소유 자원의 정리·재생성 검증 |
| 전체 scene GPU transaction | 현재 모델 GPU 사전 준비의 rollback과 지형/billboard/environment/target까지의 일괄 활성화·복구를 구분 |
| 추가 모델 형식·재질 | BLEND, occlusion·metallic/roughness texture, texture transform 등의 필요성을 입력 자산으로 확인. 전체 PBR·skin/morph/animation 지원으로 자동 확대하지 않음 |
| 자동 네트워크 geometry 스트리밍 | 현재 사전 등록 CPU LOD·native visual chunk와 별개. 요청 취소·재진입·자원 상한·오래된 결과 차단부터 설계 |
| 움직이는 보행면·탑승자 운반 | 모델 attachment/proxy 동기화와 다른 물리/탐색·층 전환·저장 계약. 기존 구현 완료에 포함하지 않음 |
| 탐색 규모·공간 물리 진단 확장 | 현재 bounded 분할 탐색 이후의 대형 경로 요구와 전체 contact manifold·joint/CCD 진단을 각각 검토. 복잡한 새 solver와 혼동하지 않음 |

## 별도 제품 결정이 필요한 시각 효과

독립 평면 shadow receiver API, 화면 공간 광선 mask, 반투명 다중 depth, 물리적 bokeh,
PCSS·다중 point shadow light는 과거 prototype 후보이며 현재 API 지원 약속이 아니다.
현재 spatial의 높이 기반 그림자·normal lighting·view-depth DOF를 다시 개발하는 계획으로 사용하지 않는다.
실제 게임의 필요와 renderer별 비용·fallback·자원 수명·HUD/alpha 경계를 먼저 검토한다.

## 작성 도구와의 관계

2D·HD-2D 문서 세션·Undo/Redo·dock·scene tab·공간 picking 도구의 사용 계약은
[Authoring API](../engine/public-api/authoring.md)와 [검증 기준](../development/quality/smoke-check.md)을 따른다.
이 후보 문서는 제공 중인 작성 도구를 미완료로 되살리거나 다음 기능을 자동 승인하지 않는다.
Rust/TypeScript 책임, WebGL2 기본·WebGPU fallback, agent-first JSON/patch 흐름과
visual editor·복잡한 물리·범용 3D의 별도 설계 경계를 유지한다.


## three.js 소스 비교에서 이어갈 후보

공식 three.js 소스 `83f6bd095356c68334df7d9b7ec03a0abebff3fc`와 Ferrum2D 구현을 대조한 순서다.
분석 clone은 `/tmp/ferrum2d-threejs-source-review`이며 없어져도 아래 고정 링크로 재현할 수 있다.
three.js는 렌더링 라이브러리이며 게임 상태·물리·저장 전체를 대체하는 엔진으로 취급하지 않는다.
에셋 묶음 로딩의 동시성·취소·audio 수명은 [확정된 API 계약](../engine/public-api/core.md#에셋-묶음-로딩과-취소)을 따른다.
정적 GLB/glTF의 UV0 텍스처 변환은 [확정된 모델 계약](../engine/data-scene-spatial.md#정적-glb-배경-모델)을 따른다.
이미 제공하는 UV 변환·instancing/LOD·KTX2·shader preparation·HDR bloom·spotlight를 신규 미구현 항목으로 세지 않는다.

| 우선순위 | 비교 소스와 실제 차이 | 착수 시 완료 조건 |
| --- | --- | --- |
| 1 | [PositionalAudio](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/audio/PositionalAudio.js)의 거리·방향 음향. 현재 `playSpatial`은 일반 SFX fallback | 마을 물소리/횃불 등으로 listener/source의 좌표·거리 단위와 bulk 전달 설계. 이동/층 전환·카메라·음소거·해제·브라우저 fallback 검증 |
| 2 | [InstancedMesh](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/objects/InstancedMesh.js), [LOD](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/objects/LOD.js)의 반복 모델 제출·단순화. 엔진 기능은 이미 제공 | 위 실게임 성능·LOD 외형 후보와 합쳐 실제 마을의 silhouette/cutout/그림자 및 CPU/GPU 비용 측정 |
| 3 | [WebGPURenderer](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/renderers/webgpu/WebGPURenderer.js)의 backend/자원 책임 분리 | 기존 WebGPU 통계·device-loss/scene transaction 후보와 통합. 소유자별 복구·실패·해제 증거 확보 |
| 4 | [LoadingManager](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/loaders/LoadingManager.js)의 URL 해석, [FileLoader](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/src/loaders/FileLoader.js)의 진행 중 요청 공유 | CDN/로컬 blob resolver·cache key·인증·독립 취소·참조 수명을 먼저 정의. 이미 있는 모델별 요청 공유·CPU/GPU cache·IndexedDB preload를 중복 구현하지 않고 texture/sound/JSON의 공통 요청 계약으로 검증 |
| 5 | [GLTFLoader](https://github.com/mrdoob/three.js/blob/83f6bd095356c68334df7d9b7ec03a0abebff3fc/examples/jsm/loaders/GLTFLoader.js)의 추가 표준 확장·geometry 압축 | 실제 게임 자산에서 UV1/추가 재질/Draco·Meshopt 중 필요한 범위를 먼저 측정. decoder 의존성과 CPU·메모리 예산, 실패·fallback을 설계한 뒤 선택. skin/morph/범용 PBR은 별도 설계 |

분석 패턴만 참고하며 three.js production 의존성을 추가하지 않는다. 동시성 상한은 Ferrum2D 자체 정책이다.
다음 작업은 공간 오디오를 실제 마을의 listener/source 계약으로 좁혀 시작한다. 전체 목록의 구현 완료를 의미하지 않는다.
