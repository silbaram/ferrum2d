# Ferrum2D 아키텍처

Ferrum2D는 Rust가 게임 상태와 시뮬레이션을 소유하고, TypeScript가 플랫폼 API와 GPU 출력을 담당하는
AI agent-first 2D 웹 게임 엔진이다. MVP 이후의 제품 기능을 개발 중이며, 이 문서는 현재 소스의 책임·수명·경계를 정의한다.
기능별 필드와 예제는 [Public API](../../engine/public-api.md)에, 개발 후보는 [Planning](../../planning/README.md)에 둔다.

## 패키지와 기준 소스

| 위치 | 책임 |
| --- | --- |
| `crates/ferrum-core` | World/entity, 충돌·물리, 씬·게임 진행, 렌더 커맨드와 이벤트 생성 |
| `packages/ferrum-web` | Wasm bridge, runtime, renderer, 브라우저 입력·오디오·에셋, 공개 authoring API |
| `packages/ferrum-studio-kit` | `@ferrum2d/studio-kit`: 공통 작성 UI/helper. 독립 앱이나 runtime 의존성이 아님 |
| `apps/studio` | Ferrum2D Studio 웹 앱: 씬·에셋 작성, 실제 엔진 미리보기, patch/handoff |
| `apps/studio-desktop` | Tauri host: 허용한 프로젝트 파일·설치·업데이트와 native 자산 접근 |
| `packages/create-game` | 게임 프로젝트·검증 도구·경량 `studio.html` / `ferrum:studio` 생성 |
| `packages/agents` | 게임 프로젝트에 설치하는 consumer agent/skill 템플릿 |
| `examples` | 통합 게임과 기능 실험. 예제 전용 규칙을 범용 엔진 API와 구분 |

`ScenePlacementViewer`는 씬 배치 기능 API 이름이다. 독립 Studio와 생성 프로젝트의 경량 작성 페이지는
같은 UI/helper를 재사용하지만 제공 기능과 호스트 저장 권한이 다르다.
배포 버전은 [GitHub Release 운영](../operations/github-release.md)을 따르며, 개발 소스 지원이 이전 릴리스 지원을 뜻하지 않는다.

## Rust와 TypeScript의 상태 소유권

| 영역 | Rust | TypeScript |
| --- | --- | --- |
| 프레임·게임 | 엔티티·진행·씬·충돌·물리·난수·렌더 명령 | 입력 수집, 시간 공급, bulk 결과 소비, GPU 제출 |
| gameplay·애니메이션 | FSM·변수·timer·전투·탐색·clip 시간·이벤트 | 불변 authoring 데이터 검증·설치, 표시와 외부 효과 연결 |
| 대화·퀘스트 | 진행·flag·조건·전이·복원 검증 | 불변 콘텐츠 해석, 이름 매핑, byte packet 변환, 대화 UI |
| 파괴 지형 | alpha 원본·편집·solid 판정·dirty rect·version | 텍스처 upload, chunk collider authoring 연결 |
| 공간 장면 | pose·camera/depth 기하·광원 선택·환경 원본과 저장 | 모델·텍스처 로딩, GPU 자원·pass·합성·표시용 picking |
| 제작 도구 | Play 시 실제 게임 상태 | 문서/draft·선택·Undo·미리보기 시간·파일 작업 상태 |

TS의 authoring 문서·캐시·보기 상태는 게임 시뮬레이션의 복제본이 아니다. runtime 결과가 필요하면
native bulk telemetry 또는 낮은 빈도의 query를 사용한다. Rust는 WebGL/WebGPU·DOM·파일 선택기를 직접 호출하지 않는다.

`NativeQuestLog`와 `NativeDialogueSession`은 독립 native 자원이며 shared quest 상태를 Rust에서 연결한다.
`World` snapshot에 자동 포함되지 않으므로 호스트가 `captureDialogueQuestState` /
`restoreDialogueQuestState` 결과를 저장 데이터에 포함한다. TS wrapper가 mutable 진행 상태를 복제하지 않는다.

`NativePixelMaskTerrain`은 최대 4096×4096 alpha를 소유한다. `data` / `solidData()`는 독립 복사본이며
편집은 native 메서드를 거친다. collider 동기화는 solidity를 bulk로 읽어 재사용한다.
외부 upload callback이 만든 새 dirty 영역은 다음 sync까지 보존한다.
독립 native helper를 사용하기 전 `initializeFerrumWasm()`을 기다리고, 소유자가 `destroy()`로 해제한다.

## Wasm 경계와 버퍼 수명

- 프레임의 entity별 JS/Wasm 왕복을 금지한다. 입력·커맨드·이벤트·진단은 숫자와 bulk buffer를 우선한다.
- 공유 Rust struct는 `#[repr(C)]`로 배치를 고정한다. version·stride·길이·정수 범위와 유한 값을 검증한다.
- 기본 render command는 15-float / 60-byte다. 추가 수광·공간 정보는 계약이 있는 sidecar로 전달한다.
- layout의 기준은 `wasmBridgeAbi.ts`, 공간 환경은 `spatialEnvironmentAbi.ts`와 대응 Rust 구현이다.
  native source buffer와 renderer의 private GPU uniform은 서로 다른 포맷이다.
- Wasm typed-array view는 빌린 메모리다. native 호출의 할당·메모리 증가·씬 교체 이후까지 보관하지 않는다.
- 내장 GPU 경로는 borrow를 즉시 소비한다. dynamic provider/custom renderer와 후속 callback처럼
  재진입할 수 있는 경계에서는 필요한 frame/sidecar를 소유 복사한다.
- 오디오 host 메서드 확보·이벤트 해석/복사·native queue 소비를 마친 뒤 외부 host를 호출한다.
  callback이 새로 생성한 이벤트를 이전 queue 정리로 지우지 않는다.
- renderer/runtime callback이 엔진을 해제하면 lifetime check로 남은 native·GPU 작업과 callback을 중단한다.

bridge 변경은 선언 타입 검사만으로 검증하지 않는다. 실제 Wasm으로 메모리 증가·재진입·해제와
기존 buffer/sidecar 정합을 검사한다. [역할 경계 회귀](../quality/smoke-check.md#rust-typescript-역할-경계-회귀)를 따른다.

## 프레임 순서

기준 구현은 `packages/ferrum-web/src/engineFramePipeline.ts`다.

1. 입력·viewport를 전달하고 Rust를 업데이트한다.
2. 오디오 이벤트를 복사·소비해 host에 전달한다. 필요하면 할당을 수반하는 물리 진단 query도 끝낸다.
3. render command·telemetry·gameplay/effect/collision·debug buffer를 읽는다.
4. 후속 소비자나 재진입 경계가 요구하는 frame buffer를 snapshot으로 보존한다.
5. renderer가 command/sidecar를 소비하고 GPU에 제출한다.
6. native 작업을 일으킬 수 있는 effect를 dispatch한 뒤 `onFrame`을 호출한다.

단계 사이의 lifetime check를 유지한다. `include*` 옵션은 불필요한 읽기·복사를 줄이지만
실행 순서와 소유권을 바꾸지 않는다. RAF scheduler는 실행 상태와 이미 예약한 frame을 함께 확인해
callback 안의 stop/pause/restart가 중복 예약을 만들지 않게 한다.

## Renderer와 자원 경계

WebGL2가 기본이며 WebGPU는 capability에 따라 선택한다. 선택 renderer는 Rust render command ABI를 바꾸지 않고
기존 fallback을 유지한다. WebGPU 필수 smoke는 fallback으로 통과시키지 않는다.

runtime은 구조적 renderer capability를 사용한다. custom renderer를 구체적인 WebGL2/WebGPU class의 private 상태로
단언하지 않는다. 미지원 debug/render 요청은 target 변경 전에 거절하고, timer 종료와 외부 소유 자원의 수명을 보존한다.

에셋 CPU 데이터·GPU 준비·장면 활성화는 구분한다. 비동기 취소, 늦은 결과, 실패 rollback,
참조 수명, resize·context/device loss·destroy의 해제를 다룬다. 개별 모델 GPU 준비의 rollback을
전체 장면·지형·환경까지 아우르는 transaction으로 확대해 설명하지 않는다.

| 상세 계약 | 경계 |
| --- | --- |
| [Flat 합성](flat-lighting-composition.md) | 기본 overlay와 opt-in lit, opaque/cutout receiver, HDR·Surface·광원별 차폐 |
| [Spatial 합성](spatial-lighting-composition.md) | 환경광/직접광/발광 분리, AO·fog·DOF·Bloom 순서와 target 수명 |
| [화면 표현](../../engine/data-scene-presentation.md) | clip, 2.5D, normal·palette·9-slice, Flat 조명과 수신 mask |
| [공간 계약](../../engine/data-scene-spatial.md) | 지형·모델·billboard·camera·LOD·그림자·환경 버전과 지원 조합 |
| [압축 텍스처](../quality/compressed-textures.md) | 선택형 KTX2/Basis 준비·Worker·fallback·취소 |
| [셰이더 준비](../quality/shader-preparation.md) | 준비 완료/실패와 로딩 UI, GPU 자원 회수 |

새 조명 기능은 기존 profile 생략 경로의 픽셀과 비용을 보존한다. effects OFF, 빈 환경, warm frame,
resize, 실패, destroy를 실제 draw/target/bytes와 픽셀로 확인한다. 통계상의 work 상한과 GPU 시간을 구분한다.

## Data Scene과 게임 실행

Data Scene은 object definition·instance·asset reference·component의 검증 가능한 데이터 계약이다.
TS가 source를 해석·검증하고 native가 진행과 실행 상태를 소유한다. 적용 전 전체 입력을 검증하며
실패 원자성은 해당 API가 보장하는 범위로 제한한다. custom callback을 포함한 모든 외부 효과의 rollback을 약속하지 않는다.

- instance registry는 authored id와 native handle을 연결하며 제거·재적용·씬 교체 시 오래된 handle을 차단한다.
- visual/body/view는 서로 다른 component다. 표시 크기를 바꿨다고 collider나 게임 판정이 자동 변경되지 않는다.
- 탐험·전투·navigation·crowd·projectile·spawned actor는 명시적 capability와 예산을 따른다.
  새 TS simulation loop로 native 이동·수명·충돌을 중복 구현하지 않는다.
- 저장은 문서 원본, native 진행 snapshot, 외부 자원을 구분한다. 버전별 필드를 검증하고
  지원하지 않는 조합이나 구 Wasm을 장면을 바꾸기 전에 진단한다.
- 모델 attachment/LOD와 visual chunk는 이미 준비한 데이터를 선택한다. 네트워크 geometry streaming과 동일한 기능이 아니다.

상세 계약은 [Scene Authoring](../../engine/data-scene-authoring.md),
[Native Runtime](../../engine/data-scene-native-runtime.md), [물리 기능 맵](physics-engine.md),
[Runtime Extensibility](../../engine/runtime-extensibility.md)에 둔다.

## Studio 문서와 호스트 저장

Studio는 scene placement·ObjectDefinition·visual/collider/layer·에셋·기존 Behavior Recipe 참조를 작성하고
patch/handoff로 agent에게 전달한다. recipe 본문·FSM/action graph 편집은 현재 도구의 범위가 아니다.

문서별 draft·선택·Undo/Redo·자산 참조를 분리한다. 씬 탐색은 bounded 목록을 읽고, 오류·취소·교체·늦은 decode가
다른 문서나 활성 runtime을 덮어쓰지 않게 한다. Play는 실제 native runtime을 사용하고 편집 원본의 보존과 구분한다.
프로젝트 경로와 source fingerprint가 바뀌면 오래된 비동기 저장 결과를 적용하지 않는다.

| 호스트 | 저장 경계 |
| --- | --- |
| 일반 브라우저 | patch·원본·handoff 내보내기. 디스크 임의 덮어쓰기 권한 없음 |
| 개발 서버 | `VITE_FERRUM_STUDIO_SAVE` opt-in과 명시적 middleware 범위. production 브라우저 저장 권한을 뜻하지 않음 |
| desktop | 사용자가 연 프로젝트의 canonical root와 허용 파일, source 비교·충돌 검출·원자적 저장·복구 |

native asset protocol의 읽기 권한과 프로젝트 쓰기 권한은 다르다. 경로 이탈·symlink·외부 변경 충돌을 거절한다.
외부 Tiled/LDtk/Aseprite 입력과 도트 원본은 불변 source·변환 결과·설치 참조를 분리하며,
미설치 참조를 저장 완료로 처리하지 않는다. 원본과 설정을 유지해 재가져오기·Undo·게임 실행을 검증한다.
정확한 가져오기 한도와 도트 checkpoint 계약은 [Scene Authoring](../../engine/data-scene-authoring.md)을 따른다.

### 프로젝트 관리 Catalog의 복구 가능한 정리

읽기 전용 사용처 조회는 씬 파일과 열린 원본/draft에서 근거를 모은다.
코드·외부 manifest·GLB 내부·전체 Undo를 완전히 분석한 미사용 판정으로 취급하지 않는다.
관리 Catalog 정리는 호스트가 소유한 범위에 한정하고 backup/복구를 제공한다.
외부 파일 변경·열린 편집·로드 중인 자원·stale 결과와 충돌하면 정리를 거절하며, 정리 이후
참조·재열기·Undo가 깨지지 않아야 한다. [정리 회귀](../quality/smoke-check.md#복구-가능한-프로젝트-catalog-정리)로 확인한다.

## 설치와 업데이트

게임 프로젝트의 engine/Studio Kit/생성기/agents와 OS에 설치하는 Studio 앱은 서로 다른 배포 단위다.
업데이트는 정확한 release 버전·출처·checksum·설치 대상·복구 자료를 검증한다.
manifest나 모의 host 테스트를 실제 OS 설치·서명·GUI 성공으로 취급하지 않는다.

[GitHub Release 운영](../operations/github-release.md), [로컬 설치](../operations/local-engine-install.md),
[배포 후속 검증](../../planning/deployment-roadmap.md)을 기준으로 하며 이 문서에 배포 결과를 누적하지 않는다.

## 검증과 제품 범위

[Smoke Check](../quality/smoke-check.md)는 변경별 명령, 실제 Wasm/GPU·consumer·native 검증의 차이와
report 기준을 관리한다. `RuntimeProfiler`는 bounded sample을 수집하며 예산은 실제 frame metric으로 평가한다.
테스트 실행 횟수·과거 commit·일회성 artifact는 현재 아키텍처 계약에 포함하지 않는다.

전체 게임 루프 Worker 이전, Wasm threads, multiplayer, full visual editor, Behavior Recipe 본문/FSM graph 편집,
complex physics, skeletal animation, 범용 3D는 별도 설계/승인 범위다. 기존 physics replay Worker는
선택형 replay 작업이며 전체 게임 루프 이전이 아니다.
