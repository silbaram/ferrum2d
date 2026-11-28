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

별도 내부 `nativeFileDialogueQuest`는 실제 SDK 생성자 기록과 명시 등록 root에서 도달 가능한 공유 Quest graph를
파일용으로 포착한다. 새로 만든 객체와 파일에서 복원한 객체는 같은 SDK 생성자에서 Wasm 핸들을 등록한다.
파일용 어댑터는 불변 콘텐츠·래퍼 식별자·삭제 상태·저장 출처를 기록한다. Quest wrapper가 삭제돼도 live
Dialogue의 Rc가 유지하는 진행은 해당 Dialogue의 bulk packet에서 읽는다. 선언 graph에 native owner가 없으면
진행 없는 NativeAbsent metadata만 보존하고 기본 진행을 만들지 않는다. 같은 값의 별도 owner는 합치지 않는다.
등록하지 않은 외부 Dialogue를 root로 추정하지 않으며 공유 Quest의 외부 변경은 native revision fence로 감지한다.

Standalone cold API는 Quest16B/Dialogue32B header probe와 expected-header 대조 후 body packet 읽기,
초기 Quest update를 실행하지 않는 linked restore 생성자다. 기존936개 Wasm export의 signature는 유지하고
`nativequestlog_file_state_packet`, `nativedialoguesession_file_state_packet`,
`nativedialoguesession_file_with_quests`3개만 추가했다. Mutable 진행은 계속 Rust가 소유한다.
성공한 같은 값 restore도 checked u64 revision을 증가시키고 overflow는 commit 전에 거절한다. 저장 origin은
provenance이며 새 runtime revision에 주입하지 않는다. 실제 restored native packet도 입력과 byte-exact 대조한다.
SDK capture/prepare/consume은 같은 자원 ledger와 source/target/alias fence를 사용하며 실패한 detached graph를
정리한다. 이 graph token은 Engine 전체 Ready·공개 importer·원자적 게임 세션 교체가 아니다. 논리 quota와
주입한 factory 실패 회귀를 실제 allocator/OOM·전체 RSS 한도 검증으로 확대하지 않는다.

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
frame 단계에서 예외가 발생하면 scheduler는 실행 상태와 예약된 RAF를 정리한 뒤 원래 예외를 전달한다.
Rust update 실패 뒤에는 audio/render/`onFrame`을 실행하지 않으며, facade의 frame 진행 표시는 `finally`에서
해제한다. 실패 처리 후 명시적으로 다시 시작하거나 checkpoint·해제를 실행할 수 있다.
새 Core의 frame/manual step 오류는 checked entry의 `Result` 반환으로 전달한다. `&mut self` export 내부에서
직접 JS 예외를 던져 Wasm borrow guard의 해제를 건너뛰지 않는다. SDK는 해당 entry가 있으면 기존 호출을
대체해 한 번만 실행하며, 이전 Core에는 기존 void entry를 사용한다.
checked entry는 clock·입력·지형/관절 준비·경로 한도 검사에서 native step이 거절된 경우
`Err`를 반환한다. 제품 물리 틱은 시작 전에 모든 실패 가능한 검사를 끝낸다. 승인한 틱은
입력과 힘을 소비하고 Rapier 적분을 완료한다. 새 실패 가능 단계는 사전 검사에 둔다.
강체·캐릭터·지정 경로 모두 이 경계를 사용한다. 실패한 조회·gameplay 보조 값은 별도
진단으로 남긴다.

비율 관절의 위치 보정은 적분 뒤 자세에서 Parry 접촉 질의로 검사한다. 센서, 그룹, 무시 쌍을
따르며 새 겹침이나 더 깊어지는 겹침이 허용 오차를 넘으면 해당 보정만 건너뛴다. 관절 쌍
버퍼는 틱 시작 전에 확보한다. 지정 경로의 구간 분할과 경로·대시 슬롯도 입력 소비 전에
검사한다. `UnresolvedMotion`은 공개 오류 ordinal을 위해 예약돼 있으며 현재 제품에서는 발생하지 않는다.

## Renderer와 자원 경계

WebGL2가 기본이며 WebGPU는 capability에 따라 선택한다. 선택 renderer는 Rust render command ABI를 바꾸지 않고
기존 fallback을 유지한다. WebGPU 필수 smoke는 fallback으로 통과시키지 않는다.

runtime은 구조적 renderer capability를 사용한다. custom renderer를 구체적인 WebGL2/WebGPU class의 private 상태로
단언하지 않는다. 미지원 debug/render 요청은 target 변경 전에 거절하고, timer 종료와 외부 소유 자원의 수명을 보존한다.
런타임은 렌더러 준비 뒤 에셋 선행 로딩과 엔진 생성을 함께 진행하고, 둘 다 완료되면 Data Scene과 물리 프로필을 적용한다.
시작 취소는 런타임 소유 자원을 정리하며, 성공한 런타임은 호출자가 해제한다. 크기 감시는 시작이 끝난 뒤 연결한다.
전용 캔버스를 선택한 런타임은 크기 감시와 렌더러 자원을 정리한 뒤 캔버스 컨텍스트를 해제한다.
렌더러 생성 도중에는 팩터리가 이미 선택된 컨텍스트를 정리한다. 주입된 렌더러의 수명과 컨텍스트는 호출자가 관리한다.
평면 Data Scene의 화면 맞춤은 씬 적용 시 렌더러 zoom·native viewport·카메라를 함께 확정한다.
적용 실패 시 기존 네이티브 체크포인트로 카메라와 씬을 복원하고 런타임이 렌더러 표시를 되돌린다.
크기 감시는 화면 맞춤이 켜져 있을 때 배율만 계산하며, 좌표 변환 view는 씬이 바뀌어도 같은 런타임에 연결된다.
WebGPU 장치가 준비되기 전에는 크기 변경을 보류한다. 복구 완료 알림에서 맞춤 배율과 native viewport를 함께 갱신한다.
Studio는 게임 모드에 들어갈 때 문서의 표시 설정을 적용하고, 2D 모드로 돌아올 때 문서별 편집 카메라를 복원한다.

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

Web의 `unifiedPhysicsControls`는 저작용 숫자 payload를 `web_bridge/controls`로 전달한다.
kind/활성화/감쇠/잠금/질량과 collider 추가·교체·삭제 검증은 기존 native world가 담당한다.
콜라이더 변경은 entity와 collider generation 양쪽을 검증하고, 삭제 이벤트를 슬롯 재사용 전에
수집한다. imported legacy component의 설정은 원본 소유권을 유지하며 직접 편집은 거부한다.
저작 제어는 틱별 bulk motion command와 구분하며 추가 JS 시뮬레이션 상태를 만들지 않는다.

통합 관절의 Web codec은 13종 native joint와 frame/motor/spring/break 설정을 숫자 payload로 전달한다.
14-word `repr(C)` state/event buffer는 entity와 native body/joint generation, 실제 sampled 반력을 담는다.
한 native event drain에서 legacy 진단용 pending과 opt-in Web queue를 각각 채우며,
body binding 제거 전에 capture해 이전 identity를 보존한다. 두 소비자가 서로의 기록을 소비하지 않는다.
공개 state 조회는 bulk 또는 전체 생존 snapshot이며 스텝을 실행하지 않는다. legacy source-owned
관절의 직접 편집은 거부한다. 매 틱 문자열/객체 변환이나 entity별 Wasm 호출은 추가하지 않는다.

통합 spatial actor의 키 입력·경로 추종은 `unified_physics/spatial_actor`가 승인된 native 구간 전에
컨트롤러 의도로 전달한다. 기존 XY 지형 이동기를 같은 actor에 실행하지 않는다. 경로 탐색의 cold probe와
실제 이동은 `physics3d/character_query`의 static response와 접지 판정을 공유하며, probe가 입력·점프·중력이나
바디 pose를 소비/변경하지 않는다. 임시 경로는 Rust 소유이며 실제 post-physics pose와 지지면으로 도착을 판단한다.
새 외부 프레임 호출·Wasm ABI 변경이나 TypeScript 시뮬레이션 상태는 추가하지 않는다.

통합 물리 전환은 [진행 중 계획](../../planning/unified-3d-physics-plan.md)을 따른다.
Rust의 `physics3d`는 Rapier3D 기반 공간/평면 world와 충돌체·지형·조회·충돌 이벤트·캐릭터 이동·관절을 구현 중이며,
새 native Data Scene body와 기존 2D component의 planar adapter를 Engine의 승인 구간·World entity·렌더 보간에 연결했다.
Physics Spec `rigid`와 `arcade`는 고정·가변 시간 모두 전체 component 그룹을 만든 뒤 같은 planar native world를 설정한다.
동일 world/clock mode의 추가 적용은 accumulator·예약 입력·frame/step 상한·보간 이력·native identity를 유지한다. 실제 mode 전환도 현재 상한·보간 옵션을 유지하며 profile이 자동·수동 실행을 결정한다.
SDK는 mode와 backend를 구분한다. Arcade mode 표시·기본 중력0·CCD 꺼짐·solver1/1·sleep 꺼짐을 유지하며,
가변 시간도 같은 native backend를 사용한다. Raw `Engine::new`/`Default`와 무옵션 Web 생성은 planar native·가변 시간·자동 실행을
선택한다. Raw 생성은 constructor의 authored player를 즉시 import하지 않으므로 생성 옵션을 적용하기 전 사용자 solver 상태를 폐기하지 않는다.
명시 `physicsBackend: "legacy"`는 실제 실행·import·사용자 물리 설정 전에 cold guard로 초기 native 정책만 제거하며 World entity/component는 보존한다.
`none`을 사용할 때도 legacy를 명시한다. Native 요청의 실패를 legacy로 바꾸지 않는다.
Native 활성 world는 arcade/rigid의 native 재적용을 허용하고 `none` downgrade는 기존 그룹을 지우기 전에 거절한다.
동일 config 동기화와 살아 있는 body가 있는 world의 전역 설정 제한은 그대로 적용한다. 남은 query·지원면 탐색·밀집 수용은 별도 개발/검증 범위다.
내장 Shooter·Breakout·Platformer는 planar native를 사용하며 spatial built-in 설정은 거절한다.
`configurePhysicsRuntime`의 planar Physics Spec setup은 Data Scene과 Shooter를 지원한다.
생성 옵션 `"unified"`는 기존 명시 선택의 고정 시간 기본 계약을 유지하고 `fixedTimestep: false`로 같은 native backend의 가변 시간을 선택한다.
다른 scene 전환은 저장 config로 fresh native world를 설치한다. Physics를 생략한 Data Scene도 상속하며 같은 scene reset은 현재 world,
auto=false와 frame/step 상한을 유지한다. Unsupported cold fixture는 native admission에서 막고 legacy 이동을 실행하지 않는다.
명시 `configureUnifiedPhysics`는 scene-local 설정이다. 현재 Data world를 별도 설정해도 다음 다른 scene은 저장 default로 돌아간다.
직접 world 설정은 현재 scene을 고정 시간으로 구성하지만 저장된 다음 scene의 mode는 유지한다.
명시 `configureFixedTimestep`은 현재 clock과 저장 policy의 mode를 갱신한다. 기본 policy와 clock mode는 Engine persistence에 포함된다.
Decode의 private bare candidate는 새 native 기본 world를 만들거나 저장된 legacy 정책을 변환하지 않는다.
SDK의 physicsDefaults는 초기 clock metadata를 실제 실행에 맞춘다. `setGameSpec`에서 physics를 생략하면 같은 Shooter의 현재 설정을
유지하고 다른 scene에서 Shooter로 전환할 때는 생성 default를 상속한다. 무옵션 native 생성의 명시 game.physics는 먼저 검증한 뒤
실제 Shooter reset 이후 같은 native solver에 적용한다. 생성 physicsMode/fixedTimestep 우선순위와 현재 자동/수동 소유권을 유지한다.
기존 명시 `physicsBackend: "unified"`는 target의 중력·step·solver·continuous·clock mode와 일치해야 하는 엄격한 계약을 유지한다.
`none` 또는 이 명시 정책의 불일치는 scene/entity 변경 전에 거절한다. 다음 scene의 mode는 현재 local clock과 별도로 Rust policy getter에서 읽는다.
Physics 생략 경로는 debug만 적용하며 생성 clock override를 다시 실행하지 않는다. Rust가 현재 clock을 소유한다.
Aggregate 작성의 명시 physics 요건은 유지한다. Native 전체 파일은 public same-build 세션으로 저장·복원하고 legacy JSON 물리 snapshot과 구분한다.
CreateEngine은 Wasm await 전에 options 최상위와 fixedTimestep 객체를 복사하고 private creation Spec을 유지한다. 반환 Game Spec과
현재 진단 metadata는 baseline과 분리한 clone을 사용해 외부 수정이 이후 default 선택을 바꾸지 않는다.
Unified 정책의 FrameState가 필요한 경로에서만 Rust update 뒤 숫자 policy-scene getter를 한 번 읽고 frame 추출 전에 metadata를 맞춘다.
Sound/texture/tile 작성이 암묵적으로 Shooter를 활성화하는 경로도 같은 scene stamp로 처리한다. 같은 scene의 local override는 유지한다.
명시 selector는 실행 전후에 stamp를 동기화해 두 API 호출 사이의 암묵적 Shooter 전환도 관측한다. 별도의 Rust scene epoch는 추가하지 않는다.
메모리 checkpoint capture도 frame 없이 metadata를 맞춘 뒤 저장하고 restore는 physics Spec과 scene stamp를 함께 복구한다.
이 상수 크기의 관측 호출은 엔티티별 왕복이나 시뮬레이션을 수행하지 않는다.
읽기 전용 2D bulk projection은 native query prepare를 한 번 수행하며 예약 입력과 tick을 소비하지 않는다.
31-float/5-u32 행은 component 소유 바디만 지원하고 full solver 저장과 구분한다.
JSON 저장은 실제 Rust backend getter로 거절하며 native 메모리 checkpoint를 사용한다.
이는 mode 표시가 arcade인 native world에도 적용한다. Manual profile의 native 물체는 직접 step까지 정지하고 runtime은
autoStep 설정을 따른다. 빈 none runtime profile의 autoStep=true 반환은 backend 선택과 별개의 기존 계약이다.
Physics world JSON capture/restore는 backend getter에 더해 world/snapshot Spec이 기존 legacy 형식에 해당하는지 사전 검사한다.
실제 backend getter가 명시적 legacy를 반환해야 하며 getter 누락·native·unknown 결과는 거절한다. 현재 Engine이
legacy여도 rigid/고정 시간 arcade Spec은 staging·기존 world clear·transaction 전에 거절한다.
따라서 옛 fixed-arcade JSON의 복원 도중 backend를 native로 바꾸거나 legacy solver 상태를 변환하지 않는다.
none과 fixedTimestep이 명시적 false인 arcade만 legacy JSON helper 대상이다. Arcade의 누락·비boolean 값을 가변 시간으로
해석하지 않으며 native는 동일 Engine 메모리 checkpoint를 사용한다.
기존 JSON 복원 후처리는 private metadata callback으로 legacy clock/debug만 구성한다. 일반 variable Spec의 native 설정을 다시 호출하지 않으며 이 경로를 일반 authoring의 backend 선택에 사용하지 않는다.
Arcade와 rigid 설정은 clock mode와 무관하게 native WorldConfig의 범위를 적용 전 검사한다. Velocity/position 반복은 각각1..32,
f32 변환 뒤 stepSeconds는0.0001..0.1, 중력 각 성분은 유한하며 절댓값1,000,000 이하이다.
기존 legacy JSON 입력의 solver 허용 범위와 새 native authoring을 구분한다.

Native 가변 frame은 maxFrameSeconds·maxStepsPerUpdate를 먼저 적용한 실제 승인 시간을 균등 구간으로 나눈다.
각 구간은0.0001..0.1초이며 최대1,024개다. Native clock 설정은 maxFrameSeconds0.0001..102.4초·maxStepsPerUpdate1..1,024를 검사한다.
Scene·tween·일반 이동·지형·캐릭터·backend가 같은 구간 dt를 사용한다. 실제 구간은 Rust의 transient nominal 슬롯으로
소유하고 정상·실패 반환 후 config/backend dt를 함께 복구한다. Active interval의 checkpoint capture는 거절한다.
자동 실행 frame의 외력은 첫 실제 구간과 전체 승인 시간 양 끝을 검사하고, 구간 진입 실패를 무시하지 않는다.
첫 진입 실패는 simulation을 시작하지 않으며 이후 실패는 완료한 구간만 clock·particle·camera·telemetry에 반영한다.
입력 edge는 첫 승인 구간에서 한 번 소비하고 zero frame은 예약 입력을 유지한 채 출력·frame 통계만 새로 만든다.
수동 variable step은0.0001..0.1초 한 구간, fixed step은 nominal과 일치해야 한다. Engine당 숫자 capability/설정 호출만 추가하며 entity별 JS 시뮬레이션은 없다.
기존 fixedSteps/Consumed/Dropped 필드에 variable의 실제 Engine 구간·시간도 기록하고 내부 backend step 수는 별도 진단으로 구분한다.
Checked native setter 성공 전에는 SDK의 보간·metadata를 변경하지 않는다.

일반 Data Scene의 planar importer는 명시적 rigid component가 없는 collider-only 객체도 다룬다. 0이 아닌 선형·각속도나 Static 이외의
AI movement pattern이 있으면 implicit kinematic, 없으면 fixed로 가져온다. 한번 implicit mover가 된 binding은0속도·정지 pattern에서도 역할을
유지하며 명시적 rigid component를 추가하면 해당 type이 우선한다. Native 설정 뒤 새로 생성한 collider-only mover의
첫 틱에서도 World의 사전 적분을 억제해 native와 두 번 움직이지 않는다. Rigid body·collider가 모두 없는 velocity entity는 기존 World
이동을 유지한다. 지원하는 convex implicit mover는 기본 자동 controller를 쓰며 per-entity custom 설정은 명시적
kinematic rigid component에만 허용한다. 이 component를 제거하면 다음 native 준비에서 custom override도 지우고
collider-only 후속 body에는 기본값을 적용한다. Built-in 게임의 전용 실행기는 이 소유권 정책으로 일괄 이전하지 않는다.

내장 Shooter는 별도의 pre/native/post 실행 경계를 둔다. Pre는 입력·action·AI·spawn 의도를 계산하고,
native 단계가 fixture import와 물체 이동을 한 번 수행한다. Post는 world clamp·bullet lifetime/arc·게임 충돌·피해·획득을
적용한다. 그 뒤 query preparation으로 spawn/despawn·bounce·height·clamp 편집을 native와 동기화하되 tick·예약 force/impulse는
소비하지 않는다. 일반 Engine의 auto rigid 단계는 native Shooter를 다시 step하지 않는다.
Shooter의 Player·Enemy·Bullet 레이어는 초기0속도에서도 kinematic으로 가져오며 Data Scene의 일반 추론과 구분한다.
플레이어·적의 이동 controller는 Wall mask를 사용해 기존 overlap 기반 접촉 피해·pickup을 유지한다.
정지 actor의 solid tile 초기 겹침도 mask·floor를 유지한 최대8회 native contact 복구를 계획한 뒤 반영하며,
해결하지 못하면 이동 batch를 되돌리고 legacy 보정으로 전환하지 않는다.
기본 Player/Enemy의 World trigger flag는 유지하지만 native fixture는 solid로 매핑해 벽 sweep을 수행한다.
Native lifecycle은 이 접촉을 ENTER/STAY/EXIT로, native Bullet sensor를 TRIGGER_*로 보고하고 피해·점수는 World gameplay
HIT 정책이 처리한다. World collider trigger 조회와 native contact/sensor 관측을 같은 값으로 가정하지 않는다.
Bullet은 native sensor/kinematic으로 이동시키되 World fixture와 기존 Shooter swept gameplay·tile pierce/bounce/despawn
정책은 유지한다. 모든 Shooter query나 projectile 충돌 정책의 native 이전을 뜻하지 않는다.
UI의 `builtInShooterProgress`는 Rust wave index·timer·spawn 수만 읽으며 legacy 저장 snapshot을 만들지 않는다.
Presentation particle의 위치는 프레임의 actor/source handle을 `queryGameplayPositions` 한 번에 모아 읽는다.
Native-bound body는 render offset·보간과 독립인 simulation XYZ, unbound entity는 authored XY/Z=0을 반환한다.
Stale generation·위치 없는 entity도 요청 순서를 유지한 빈 결과를 반환해 다른 유효한 effect를 막지 않는다.
두 조회 모두 solver·input·진행 상태를 바꾸지 않으며 추가 persistent storage를 만들지 않는다.

Title 시작·GameOver 재시작 tick은 pre에서 상태만 바꾸고 native 이동/post는 실행하지 않는다.
같은 활성 Shooter의 authoring/reset은 native world를 유지하며 다른 built-in/Data Scene 전환은 현재 world를 폐기한다. Unified 생성 정책이 있으면 기본 world로 교체한다.
Legacy Shooter snapshot은 native solver를 저장하지 못하므로 capture/restore를 mutation 전에 거절하고 동일 Engine 메모리
checkpoint를 사용한다. 수동 auto=false에서도 update는 현재 pose에서 의도·timer·post를 실행하고 직접 승인 물리 구간은 이동만
수행하므로 자동 실행을 권장한다. Raw 기본값의 전역 전환은 후속 범위이며 physics 생략 씬은 생성 정책을 따른다. 이 실행 경계는 native variable 구간에도 적용한다.

Breakout은 scene이 소유한 paddle·ball entity를 별도로 관리한다. 이들은 정지·collider 제거 뒤에도 native kinematic으로
연결하고 일반 automatic planar controller에서 제외한다. 명시적 rigid component가 있으면 enabled kinematic만 허용하며
configure mutation 전과 매 step admission에서 검사한다. World trigger는 유지하되 Player·Bullet·Enemy·Wall의 native fixture는
solid로 가져온다. Paddle의 clamp된 endpoint를 먼저 native에 반영한 뒤 ball의 실제 source/target fixture를 sweep한다.
대상은 scene 소유 paddle·walls·bricks이며 동시 hit는 이 category 순서와 각 vector 순서를 따른다. 같은 레이어만으로
추가한 lookalike entity는 scene hit 대상이 아니다. Ball 속도를 first-hit fraction으로 줄여 공통 native tick에서 한 번 이동하고,
명령 속도를 복구한 뒤 ContactOffsetX paddle 반사·wall/brick normal 반사·brick effect/피해·점수·despawn·종료 판정을 처리한다.
남은 dt는 사용하지 않으며 cold query sync는 추가 tick이나 예약 입력을 소비하지 않는다. 표면에서 멀어지는 contact rounding은
즉시 재충돌에서 제외하고 실제 초기 침투는 유지한다. 회전 CCD·전체 상대 운동·밀집 비용 수용과 구분한다.
Title/restart tick은 level·launch만 재구성한다. 같은 Breakout 선택/reset은 native를 보존하고 다른 built-in/Data 전환은 현재 world를 폐기한다. Unified 생성 정책이 있으면 기본 world로 교체한다.
동일 Engine memory checkpoint를 지원하지만 Breakout JSON API나 native 전체 파일 저장은 추가하지 않는다.
Breakout manual auto=false의 Playing update는 input command만 저장한다. 직접 승인 물리 구간이 movement와 reflection·HIT·score·finish를
함께 실행하며 입력 재샘플링·Title/restart 전환·일반 timer는 실행하지 않는다. Shooter의 post와 Data Scene manual 계약은 바꾸지 않는다.

Platformer도 기존 planar 설정에 opt-in한다. 기본8개 level body를 같은 native world에 가져오되 player는 기존28×36 AABB를
유지한다. 속도210·중력900·점프420·최대 낙하760·probe2·step12·coyote0.08초·buffer0.10초의 기본 튜닝과 authored 값을
그대로 사용한다. Legacy/native의 속도·jump timing은 공통 순수 state-step helper를 사용하고 collision geometry만 분리한다.
Native sweep은 one-way Enemy fixture의 방향·시작 feet/top 조건을 closest hit 선택 전에 적용하고 ground probe도 지지 가능한
normal을 가진 후보를 먼저 고른다. Side contact가 더 먼 바닥을 가리지 않으며 tangent/표면 이탈은 이동을 막지 않는다.
Carry는 old ground probe가 scene 소유 moving platform을 선택한 경우에만 그 platform을 제외하고 rider delta를 sweep한다.
이어서 platform path endpoint를 반영하고 player controller를 실행한다. 위치를 native에 commit한 뒤 소유 player/platform의
선속도를0으로 두고 공통 tick을 한 번 실행해 중복 이동을 막는다. 실패 시 계획 위치·명령을 복구하며 legacy로 전환하지 않는다.
정지·collider 제거 뒤에도 이 두 entity는 kinematic 소유권을 유지하고 일반 automatic controller에서 제외한다. 명시 rigid
component가 있으면 enabled kinematic만 허용하며 설정 변경 전과 step admission에서 검증한다. Capsule·회전 carry·angular CCD·
전체 dynamic support를 지원하는 것으로 해석하지 않는다.
Title/restart는 rebuild만 하고 held Space를 jump edge로 재사용하지 않는다. 같은 Platformer 선택/reset은 native를 유지하고
owner refresh hook으로 public query 전에 새 entity 역할을 갱신한다. 다른 built-in/Data 전환은 현재 world를 폐기하며 unified 생성 정책이 있으면 기본 world로 교체한다.
Manual Playing update는 수평 axis와 OR jump edge만 저장한다. 직접 승인 물리 구간이 controller·carry·물리 시간/점수·coyote/buffer·
landing/finish를 실행하며 입력 재샘플링·Title 전환은 하지 않는다. Queue는 memory checkpoint에 포함되고 성공한 step만 jump를
소비한다. 동일 Engine checkpoint와 bounded same-build Native 게임 파일을 지원하며 legacy JSON snapshot과 구분한다.

HD-2D 수동 controller는 같은 native shape의 가상 offset에서 최대8회 sweep을 계획한 뒤 common surface metadata를
적용한다. Core physics helper의 surface 처리만 공유하며 legacy AABB collision은 호출하지 않는다. 변경된 height/floor에서
native 도착 penetration을 검사하고 허용된 pose/span만 publish한다. 실패 시 World 후보를 복구하고 native 이동을 실행하지 않는다.
Data Scene grid API는 bounded 숫자 buffer를 받으며 임시 Tilemap과 지형 descriptor로 검증한 뒤 교체한다.
기존 충돌 packet v1을 보존하고 선택 그래픽만 capability v2의 별도 visual metadata/value buffer로 전달한다.
Rust가 기존 layer 0 Tilemap 정의에서 렌더 명령을 생성하며 renderer ABI·entity별 frame 호출은 추가하지 않는다.
Scene JSON의 `physics.collisionTilemap.definitions[].visual`은 cold 경로에서 로드된 texture ID와 working-space 색으로
컴파일한다. Canonical SDK는 그 packet을 임시 native world와 실제 적용에 재사용하며 공간 카메라의 그래픽 격자를 거절한다.
임시 terrain validation은 live physics를 readonly로 사용하며 현재 capacity도 검사한다. 교체 revision은 단조 증가하고
같은-Engine checkpoint에는 기존 Tilemap/World/native 필드가 저장된다.

통합 물리의 기존 2D component AI는 component/지형 변경을 native에 반영한 뒤 승인 물리 구간에서 방향·속도를 평가한다.
직접 만든 native body와 같은 steering/target 선택을 사용하고, 그 후 예약 force/impulse를 적용해 AI가 impulse를 덮어쓰지 않는다.
입력 코드가 설정한 속도도 같은 틱에서 처리한다. Component 소유 kinematic의 AABB·OBB·원·캡슐·볼록 다각형과
여러 convex fixture로 구성한 복합 충돌체는 활성 solid fixture 각각의 native pose·SharedShape로 sweep/slide한다.
비활성·sensor source fixture는 검색에서 제외하고, 결과는 전체 source의 가장 이른 충돌과 안정적인 collider ID 순서로 선택한다.
변경된 height/floor의 도착 검사는 활성 solid fixture 전체에 적용하며 source 전체를 하나의 AABB로 대체하지 않는다.
지형 surface 처리의 참조점은 단일 AABB collider 중심이며 다른 형상·복합에서는 body/entity 원점이다.
전체 source footprint의 타일 rasterization과 native 충돌 검색을 혼동하지 않는다.
이동한 위치를 반영한 틱의 native 선형 적분만 억제한다. 틱 종료 시 명령 속도를 복원하며 회전과 다른 body는 정상 step한다.
상호 collision mask·sensor/enable·floor/height를 적용한다. 세대별 entity handle의 controller 설정은 Rust가 소유하며
`configureDataSceneKinematicController`가 낮은 빈도의 숫자 설정을 전달한다. mask 기본all·반복 기본4회(1..8), step/drop 기본0
(0..65536), ledge drop 기본비허용이며 옵션은 전체 교체한다. false는 기본값 복원이며 disable이 아니다.
초기화는 현재 세대·planar native·component 소유권을 검사하되 source가 비활성·미지원 또는 dynamic으로 바뀐 뒤에도 허용한다.
설정은 같은 Engine의 메모리 checkpoint로 복원한다. 새 Physics Spec/Scene JSON 필드·Studio UI·기본 WASD mapping이나
TypeScript 시뮬레이션은 추가하지 않는다. 수동 HD-2D·XY 목적지 route의 단일 AABB source 계약은 별도로 유지한다.
목적지 route는 속도를0으로 설정하며, queued dash/projectile/attachment는 자동 sweep에서 제외한다. 지원하는 활성 solid
source가 없는 body, 비볼록 source와 직접 생성한 native body는 기존 native 적분 계약을 유지한다.
재사용 velocity scratch는 public checkpoint 경계에서 비어 있다.
이동자도 같은 loop의 timer/action dispatch를 유지한다. 후순위 자동 이동 admission이 실패하면 앞 이동자의 pose/span/속도도
복구하고 그 틱의 예약 force/impulse는 적용하지 않는다. 이 복구는 자동 이동 배치 범위이며 전체 시뮬레이션 트랜잭션은 아니다.
통합 world 안에서 legacy 공간 combat navigation을 실행하지 않는다. 미지원 조합은 설정 시 거절하며, 활성 legacy navigation이
있으면 먼저 해제한 뒤 native world/navigation을 설정해야 한다. 이 변경은 일반 XY 목적지 grid를 제한하지 않는다.
자동 sweep은 현재 위치에서의 병진 검색이며 상대 운동·회전 CCD·동적 밀기나 지지 결합을 완료하지 않는다.

기존 단일 AABB component actor의 XY 목적지 이동도 native geometry query로 연결했다. 씬 step에서 한 번 body/지형 변경을 준비하고 각 waypoint는 같은 native collider의 pose·SharedShape로 검색한다. 상호 mask·sensor/enable·native pair span을 적용하며 첫 충돌에서 멈춘다. Native position과 World projection을 함께 갱신하고 누적 회전각·예약 입력·fixed clock을 검색으로 초기화하지 않는다. 통합 Data Scene은 이후 기존 AABB 타일 보정을 실행하지 않는다. Grid 계획과 route/animation 상태는 기존 Rust 소유자를 유지하며 ephemeral query context는 snapshot 필드를 추가하지 않는다. 일반 actor/HD-2D 기본 이전·동적 결합·회전 CCD 완료를 뜻하지 않는다. 조회는 변경된 collider bounds를 갱신하되
물리 step에 필요한 변경 기록을 소비하지 않는다. 접촉/센서 전이는 물리 step에서 생성하고,
명시적인 삭제는 기존 세대 핸들을 포함한 종료 이벤트를 즉시 큐에 넣는다.
Rust native world는 `capture_snapshot`/`from_snapshot`/`restore_snapshot`으로 같은 빌드의 opaque checkpoint를
만든다. backend arena·접촉/solver cache, 예약 명령, controller·관절, 충돌/파손 큐와 마지막 step 관측을
Serde/Postcard로 보존한다. 직접 `Deserialize`를 구현하지 않고 private remote schema를 거치며,
유효한 world가 생성한 checkpoint만 복원한다. 임의 bytes importer와 Engine/Data Scene 진행 저장은 아직 없다.
32-byte envelope의 형식 5·소스 schema fingerprint·길이·CRC를 검사하고 candidate 전체 검증 후 교체한다.
인코딩은 최대 64 MiB이며 더 작은 제한을 지정할 수 있다. 이 제한은 전체 world/복원 메모리 상한이 아니다.
일시 workspace는 재구성하고 CCD diagnostic limit를 복원하며, 발판 정지 기록과 projectile의 구간별 motion은
즉시 관측되는 상태이므로 보존한다. 네이티브 세대 핸들은 저장 시점으로 되돌아간다. Engine의 entity epoch,
AI·투사체·보간·pending hit 등을 포함한 전체 저장과 버전 간 마이그레이션은 별도 구현이 필요하다.
같은 Engine의 메모리 롤백은 `EngineRuntimeCheckpoint`로 확장했다. token은 전체 실행 상태를 인코딩한
byte와 owner/revision metadata를 보유한다. Engine은 단일 필드 목록과 exhaustive match, World는 private
remote schema의 전체 initializer로 새 필드의 저장 여부를 검토한다. native 솔버는 기존 opaque checkpoint로
함께 인코딩·복원한다. 32-byte outer envelope는 형식 2, 소스/target fingerprint, 길이·CRC·word 크기를 검사하고
전체 인코딩을 64 MiB로 제한한다. 이 한도는 process/복원 메모리 상한이 아니며 CRC는 인증 수단이 아니다.
build script가 crate/vendor 소스와 고정 Cargo 입력·target 정보를 fingerprint에 포함한다.
Rapier 0.36.1과 기존 의존성 Parry 0.31.1은 `crates/ferrum-core/vendor/`의 고정 소스를 사용한다.
archive·원본 파일 해시와 수정/라이선스 고지를 각각 보존한다. native/Engine envelope 모두 같은
build script의 source/target fingerprint를 사용하며 Parry 소스도 변경 감지에 포함한다.
Engine candidate는 heap에 두고 별도 cold frame에서 필드별로 decode해 큰 aggregate Deserialize 임시 값이
한 stack frame에 쌓이지 않게 한다. 검증 후 swap하고 실패 시 원본을 보존한다. Vec 예약 공간을 보존하며,
lookup HashMap은 정렬해 인코딩한다. 매 probe 시작 시 비우는 character scratch는 내용 대신 예약 공간만 보존한다.
World·Engine·Tilemap·ParticleSystem·FixedTimestep 같은 live storage에 public Deserialize를 추가하지 않는다.
공개 sprite frame sequence와 tile layer의 Deserialize는 private count/grid-storage 불변식을 검사한다.
`checkpoint_decode`는 별도 cold admission scope에서 재귀 깊이·처리 값 수·collection과 할당 작업 예산을
검사한다. 기본 한도는 깊이 96, 값/collection 각각 64 Mi개, zero-sized element 4,096개,
할당 작업 계산값 1 GiB다. 계산값은 타입 slot/B-tree 여유·문자열·명시적 예약 공간·초기 candidate allowance를
누적한 admission 지표이며 실제 allocator/RSS 또는 모든 upstream 내부 할당의 상한을 증명하지 않는다.
동적 sequence/map은 길이 hint를 사전 할당에 전달하지 않고, 각 값 생성 및 저장된 예약 공간 할당 전에 검사한다.

scope는 thread-local이며 nested root 교체를 거부하고, 포함된 native payload는 같은 누적 예산을 사용한다.
제한 오류를 visitor가 무시해도 실패를 유지하고 scope 종료 시 정리한다. native blob은 입력 slice에서
borrow해 decode하며, 불필요한 byte별 재할당을 하지 않는다. 이 자원 admission은 native arena·형상·행렬 등의
의미/구조 검증을 대신하지 않으며 외부 파일 importer는 계속 비공개다.

예산 관리 상태는 const TLS의 `RefCell<Option<Budget>>`에 직접 보관한다. Decode마다 관리용 `Rc`를 먼저
할당하지 않으며 중첩 decoder는 같은 상태를 불변 borrow하고 `Cell` 카운터를 누적한다. Scope 정리는 borrow보다
먼저 선언해 정상·오류·native unwind 모두 borrow 해제 뒤 TLS를 비운다. 중첩 root로 새 예산을 시작하는 요청은
기존처럼 거절한다. 별도 test-only 계측에서 scalar/거절 경로의 관리용 요청은 native104B·WASI52B에서0으로
줄었고 결과·논리 Usage·오류 우선순위를 유지했다. TLS 고정 저장 공간과 전체 allocator/host/RSS 한도는 별개다.

Checkpoint의 vector/map/array/optional-array helper는 첫 sequence materialization도 custom fallible visitor로
읽는다. 파일 length hint로 선할당하지 않고 각 outer Vec growth를 `try_reserve` 뒤에 수행한다. 저장 capacity와
기존 Serde wire는 유지하며 workspace/최종 capacity 복원·HashMap 예약도 실제 실패를 전파한다.
실제 `TryReserveError`는 별도 sticky `Allocation`이고 논리 `Limit(Allocation)`과 구분한다. Engine/native snapshot
경계에서는 둘 다 Capacity로 반환한다. 첫 오류를 보존하고 실패 시 부분 값과 scope를 정리한다.
별도 test-only allocator-null 실험은 네 helper의 기존 abort와 수정 후54개 Native/WASI 예약 실패 정리를
비교했다. Main/production allocator를 바꾸지 않았으며 nested T/String/Arc/BTree·Engine 기본 constructor·실제
process RSS/전체 메모리 상한을 닫은 것은 아니다.

외부 파일을 준비하는 내부 `engine::file_envelope`는 별도의 v1 framing을 사용한다. 64-byte header와
7개의 32-byte directory entry 뒤에 Engine·변수·작성 정보·자원 manifest·자원 자료·대화/퀘스트·host binding
구역이 순서대로 이어진다. 형식/build/word 크기·길이·예약 bit·CRC를 검사하며 빈 구역·중복·간격·후행 bytes를
거절한다. 기본 파일/체크섬 작업 한도는64 MiB, 절대 상한은256 MiB다. Reader는 caller 소유 bytes를 빌리고
전체 구역 범위를 body CRC 검사 전에 확인하며 heap을 할당하지 않는다. CRC/build 일치는 인증이나 구역 내용의
의미 검증이 아니다. 이 framing은 내부 candidate와 NativeFilePrepare에서 사용하며 기존 opaque checkpoint와
공개 세션 importer의 계약을 대체하지 않는다.

별도 cold `World::validate_storage_admission`은 이미 decode된 candidate의 entity arena·45종 component
슬롯·8종 joint arena·incident count를 검사한다. 명시적인 슬롯/논리 작업/scratch 한도를 선청구하고 fallible
reserve를 사용하며 정상 reset 뒤 lazy incident prefix와 과거 관측을 수리하지 않는다. Native 소유권 helper는
World/native admission을 선행조건으로 entity↔body 역참조·fixture·지형·관절·projectile 소유권을 대조한다.
Component 수치/nested reference·pending payload는 아래의 별도 World payload 검사에서 다룬다.
전체 Engine 의미·실제 allocator/RSS 검증은 계속 별도 미완이다.
Reset 뒤 retired MAX entity 앞의 빈 incident prefix를 채우는 producer 수정은 실행 중 해당 gap에만 적용한다.
저장 형식은 유지하며 일반 append/reuse/reset-prefix의 World payload bytes는 수정 전후 동일해야 한다.

SDK 내부 JSON reader는 이미 소유한 Uint8Array에 byte 제한→fatal UTF-8→중첩/값/문자열/collection 제한과
중복 key 검사→전체 JSON parse 순서를 적용한다. 기본 byte4 MiB/depth32, 절대64 MiB/depth128이며 실제 heap
상한을 뜻하지 않는다. 변수 metadata capture/prepare/attach는 선언·slot만 새 SDK store에 연결하고 native
clear/configure/get/set을 호출하지 않는다. Native layout은 caller가 해당 candidate에서 검증해 제공해야 한다.
내부 SDK 파일 경로는 NativeFilePrepare의 bulk packet에서 실제 candidate layout을 읽는다. 변수 metadata의
순수 admission과 실제 대상 facade에 한 번 연결하는 단계는 분리한다. 세션 fence/epoch·단일 publication은
각 metadata participant의 성공만으로 보장되지 않는다.

내부 `engine::file_candidate::prepare`는 framing→파일용 Engine 구역 decode→World 구조/컴포넌트 payload→실제
native 변수 slab layout→Engine root 설정→작성 스냅샷→표시 상태→Tilemap/navigation scratch→Data Scene 이동·grid→전용 물리 scratch→
공간 씬/continuity→저장 물리 출력→저장 frame 출력→native 소유권→공유 관계 연결→native controller 순서다. Engine fingerprint와 word 크기는
실행 중인 codec에서 얻고 SDK identity는 호출자가 제공한다. Native snapshot은 기존 nested decoder의 admission을
먼저 통과한다. Decode의 논리 할당 allowance와 post-decode scratch 합계를 사전 검사하며, 연결된 모든 owner
검사는 하나의 post-decode work/scratch allowance에서 차감한다. 이는 decoder의 모든 실행 작업이나 실제 allocator/RSS
상한이 아니다. Framing·파일 Engine wrapper·내부 memory Engine·그 안의 단일 native PhysicsWorld CRC에는 파일 길이
네 배의 보수적인 scan allowance를 먼저 청구한다. 기본256 MiB·절대1 GiB이며 CPU 명령 수가 아니다.
Candidate의 Engine 필드는 부모 모듈에도 비공개이며 실행/query/render/Engine 반환/publication API가 없다.
나머지6개 SDK 구역은 검증 전 bytes로만 읽을 수 있고 전체 Engine 의미·SDK/자원/owner/epoch/fence를
통과한 Ready token으로 사용할 수 없다. 변수 layout도 현재 Rust 내부 결과이며 일반 Data Scene용 공개 bulk API는
추가하지 않았다. 기존 변수 snapshot bulk는 Shooter 전용이라 일반 candidate introspection을 대신하지 못한다.

개발용 `native-wasm-source-identity.mjs`는 실제 Wasm이 생성한 파일 header의 기존 Engine fingerprint를
현재 Core·vendor·Cargo/build 입력 및 wasm32 target 정보의 계산값과 비교한다. Rust PathBuf의 component
정렬 순서도 유지하며 새 Wasm API나 runtime package 파일을 추가하지 않는다. 이 검사는 오래된 Wasm의
재사용을 거절하는 package/CI gate이고 compiler/flags·binary 재현성·암호학적 인증이나 파일의 의미 수용은 아니다.

내부 `file_native_roster`는 동일 Candidate의 admission·공유 관계 복원 뒤 실제 변수 layout, 저장 slot의
generation/alive, live component·texture role·clip, 저장 base/LOD model·native body binding과 pending continuity
참조를 읽기 전용 metadata로 추출한다. 동일 immutable Engine을 두 번 순회해 count→fallible reserve→fill하고
잔여 work/scratch에 합산한다. 결과 Vec는 Candidate와 함께 유지되므로 여기의 scratch는 임시 공간만을 뜻하지 않는다.
Metadata getter는 Engine 반환·실행·Ready를 허용하지 않으며 자원 ID로 loaded content를 증명하지 않는다.
현재 slot/generation의 일치만 `LiveExact`다. 불일치·MAX retirement·낮은 generation은 과거 실존이나 삭제된
sprite/clip을 증명하지 않는다. Reset은 never-spawn slot의 세대도 올린다. Pending continuity에는 원래 handle이
없으므로 ordinal을 현재 entity에 연결하지 않는다. 저장 epoch/revision은 wrapping 수치이며 세션 인증이 아니다.

후행 `file_native_resources`는 Engine84개 저장 field와 하위44개 persistent struct를 census하고 현재·미래 생성용
정의·pending·retained 출력의 resource 참조를 owner/path/provenance/domain/role/실제 handle/raw ID/flags/sentinel로
추출한다. Texture/Model/Font/DirectSound/Preset/PresentationEffect/owner-local Clip을 합치지 않으며 raw finite
f32의 signed/fractional/-0 bits도 보존한다. Despawn/reuse 뒤 snapshot/cache, pending spawn에 포착된 옛 ID,
모델의 미래 LOD와 retained draw, ground-shadow cache·shader bits를 현재 live 상태로 고치지 않는다.
Builtin/ground-shadow texture0 코드 의존성은 ProgramConstant이며 navigation/physics tile과 Alpha cache의 texture
representation을 실제 loaded GPU 의무로 추정하지 않는다. 두 scan·fallible reserve·metadata sort는 같은 잔여
work/scratch에 청구하며 font HashMap은 retained backing capacity를 먼저 청구한다. Output은 Candidate에 남는
논리 payload다. Metadata getter는 content/alias/host/SDK/session Ready를 제공하지 않는다.

내부 cold `NativeFilePrepare`는 파일 bytes, 검증된 candidate와 구역 범위를 소유한다. 실제 대상 placeholder
Engine의 owner/revision에 묶이며 다른 대상·변경된 대상·재사용 설치를 거절한다. 14개 table의 LE bulk packet으로
Native 사실을 전달하고, SDK 구역 여섯 개는 여전히 미검증 bytes로 취급한다. Context는 저장 Data epoch·raw
spatial revision과 실제 canonical configuration revision·현재 Data epoch를 별도 값으로 전달한다. 움직이는
발판 때문에 바뀌는 raw revision을 SDK 설정 revision으로 사용하지 않는다. Metadata/구역 복사·repack은 같은
잔여 Native work/scratch/output 예산을 누적 사용한다. 설치는 소유한 candidate와 placeholder를 교환하고 저장
revision을 보존한다. 새 candidate owner 때문에 이전 placeholder checkpoint는 외부 소유가 된다. 저장 counter와
SDK 세션 epoch는 별개이며, 이 Native 설치 연산 자체는 SDK Ready나 전체 세션 publication이 아니다.

SDK 내부 `ResourceBudget`는 같은 ledger에서 resource 수·work·metadata/source/decoded/GPU byte 요청을 누적한다.
기본 한도는 호출자가 줄일 수 있으며 일반 ArrayBuffer 기반 typed array만 intrinsic bounds로 복사한다.
자원 record는 getter를 읽지 않고 모든 own descriptor를 검사해 숨은 필드·Symbol·accessor를 거절한다.
이는 bounded reader가 구성한 record의 후속 검사이며 JS reflection의 임시 key 배열·driver 내부 할당·process RSS를
제한하는 allocator가 아니다. 실제 facade의 asset/audio/renderer/font/model owner가 capture와 새 대상 자원
준비에 같은 ledger를 사용한다. Loaded 자원 내용과 예약된 이름/ID namespace는 구별하며, 외부 opaque 자원은
신뢰된 앱이 등록한 typed capability만 해소한다. 자원 lease의 adopt는 세션 publication을 대신하지 않는다.

내부 `nativeFileResourceCodec`는 owner가 확보한 불변 자원 graph를 manifest JSON과 binary data 두 구역으로
직렬화한다. 일반/null-prototype record, dense array, undefined, 유한 f64 값과 네 종류의 typed view를 지원한다.
동일 object/view/backing 공유와 서로 다른 동일 값의 identity, view offset·길이·전체 backing bytes를 보존한다.
Owner는 backing 전체를 소유해야 하며 pooled/외부 차용 buffer를 그대로 넘기면 안 된다. Scalar -0와 raw typed
float bits는 유지하고, semantic finite 검사는 각 resource owner가 수행한다. Mixed view의 raw alias를 보존하기
위해 host byte order가 다른 파일은 거절한다. 같은 `ResourceBudget`를 누적하고 JSON 출력 전 byte 크기,
decode 출력 backing 생성 전 참조·범위·도달성·cycle·공유 경로의 최대 깊이를 검사한다. 기본 manifest4 MiB,
data64 MiB·node65,536·member262,144·depth64는 낮출 수 있다. 이 codec은 자원 내용 검증이나 세션 Ready가 아니다.

별도 cold `WasmNamespace`는 trusted production Wasm의 memory maximum을 낮춘 사본을 비동기로 컴파일하고
독립 bindings factory로 초기화한다. 빌드 시 생성한 정적 factory가 instance/module·typed view cache·finalizer를
namespace별로 소유한다.
Runtime JS 평가나 query 문자열 import로 모듈을 복제하지 않는다. 동일 입력 초기화는 진행 중 promise를 공유하고
다른 입력·dispose/poison 뒤 초기화·완료 전 호출은 거절한다. 초기화 완료 직전 dispose도 참조를 다시 보관하지
않는다. 동기 native boundary의 RuntimeError는 target을 poison하고 module/instance/cache 참조를 놓으며 이후
finalizer가 Rust에 재진입하지 않게 한다. Memory는 Rust getter 대신 초기화 export에서 얻는다.
Bridge의 ABI 조회는 해당 namespace를 사용하며 기존 기본 singleton 실행 경로에는 factory를 정적으로 연결하지
않는다. 이는 linear memory 제한과 소유권 분리이며 JS/GPU/RSS·GC 시점이나 파일 전체의 원자적 교체를 보장하지 않는다.

독립 namespace의 generated 객체는 private owner guard를 통해 호출하고, 대상 밖 객체 전달·해제 후 호출을
거절한다. 실제 trap 뒤에는 free도 Rust에 재진입하지 않는다. Data Scene의 임시 물리 preflight Engine과 내부
PixelMask 생성도 실제 대상과 같은 namespace를 사용한다. 기본 singleton의 공개 생성 계약은 유지한다.
내부 detached facade는 초기 물리 설정이나 저장된 출력 큐를 다시 적용하지 않고 설치 대상에 SDK metadata를
연결한다. Host metadata는 실제 SDK factory owner에서 포착하고 callback은 등록된 역할별 참조로만 저장한다.
새 renderer/frame callback 연결은 신뢰된 대상 platform factory의 책임이며 파일에서 코드를 실행하지 않는다.

작성 정보의 texture/entity-exists resolver는 실제 SDK factory가 표시한 함수 identity만 canonical로 판정한다.
임의 wrapper는 실행해서 추정하지 않고 등록된 typed host 참조로만 연결한다. 예약됐지만 아직 로드되지 않은
texture 이름/ID namespace는 loaded 자원의 내용과 분리해 보존하고, 새 대상의 실제 namespace와 대조한다.
Component template provider는 파일 단계에서 다시 호출하지 않는다. 정상 apply가 이미 계산한 사용 template과
원래 문서·handle baseline을 성공 시점에 별도로 보관한다. Provider-only apply는 기존처럼 JSON progress 없이
유지하며, 이 file-only 자료를 이유로 JSON progress 지원 범위를 늘리지 않는다.

자원 교체의 publication 순서는 새 lease adopt, 새 font membership 적용, 세션 pointer/epoch 교체, 오디오 활성화,
font commit과 이전 소유 자원 정리다. 오디오 활성화 실패 시 pointer/epoch와 font membership을 되돌리고 새
대상을 폐기해야 한다. 이전 자원 정리는 성공 뒤에 수행하며 차용 자원은 자동 파기하지 않는다.

내부 `nativeFileRuntimeSession`이 capture/prepare/commit/discard를 조립한다. 실제 source owner의 정지 상태,
Native 파일 cut과 SDK 작성/변수/자원/host/DQ fence를 확인하고, SDK 구역 여섯 개의 admission 뒤에만 새 대상의
Native candidate를 설치한다. Metadata 연결과 자원 adopt는 publication 전 새 대상에서 끝낸다. Ready는 세션과
현재 epoch에 묶인 일회용 token이며 SDK epoch는 성공한 pointer 전환에서만 증가한다. 저장된 Native counter는
별도로 보존하고 새 실행 루프는 정지 상태다. 일반 host 함수·DQ·작성 resolver의 새 등록 owner는 private key이며
글꼴 자원의 실제 engine owner와 분리한다. 준비된 글꼴 fence를 무관한 함수 등록 때문에 무효화하지 않는다.
Callback과 외부 상태는 신뢰된 platform factory가 새 대상에 명시 연결한다. 이 coordinator는 공개 barrel에
노출하지 않은 내부 구현이며, 개별 participant 성공과 전체 패키지의 세션 복원 증거는 구별한다.

공개 `/core`의 `createNativeGameFileSession`은 내부 coordinator를 지연 로드한다. Public context에는 역할별
callback 요구와 읽기 전용 host data만 전달하고 native candidate/Engine/bridge를 노출하지 않는다. Native 한도는
이름 있는 옵션에서 내부 bulk words로 변환한다. Blob은 읽기 전에 크기와 논리 요청량을 검사하고 Wasm 생성의
복사도 같은 생성 ledger에 누적한다. Resource adopt 뒤 앱의 동기 validate를 호출하고, 작성 metadata 연결·source
최종 fence 뒤에 세션을 전환한다. 앱은 새 platform scope를 명시 구성하며 이전 Runtime 속성만 교체하지 않는다.

World payload 검사는45종 component와8종 joint의 수치·고정 backing/len·FSM·clip/timeline 관계를 owner 모듈에서
검사한다. 구조 검사 비용을 포함해 반환하고, 기본 slot 방문 뒤 실제 존재하는 component에만 backing 검사 비용을
추가 청구한다. HDR·signed 값·static/kinematic 무한 질량 같은 명시 sentinel과 지연 삭제/미해결 이동 목표·변수 참조를
보존한다. 유한 원시 collider/joint 값의 sanitize/skip 정책을 유지하며 전체 geometry의 충돌 유효성이나 이후 모든
산술의 overflow 방지를 증명하지 않는다. Root 설정 검사도 clock/camera/input/default 정책과 참조 범위이며84개
Engine 저장 필드의 subsystem/cache/output 전체 승인은 아니다.

표시 상태 검사는 particles/presets/bitmap text/tweens/impact feedback의 owner 내부 payload를 검사한다. Font glyph·
fallback/kerning·text cache, tween의 full entity key 중복/과거 세대, impact pair·deadline·sentinel을 포함한다.
문자열 byte와 collection/sort/scratch는 방문 전에 청구하며, preset burst count도1회 emission 반복의 보수적인
work ceiling으로 청구한다. Raw finite reversed 범위/HDR·RNG0·미등록/삭제된 자원 참조·과거 output은 producer
정책에 따라 보존한다. Clone/rollback 뒤 논리 capacity와 Vec backing capacity가 달라질 수 있으므로 동일성을
강제하지 않는다. 잘못된 nonfinite payload는 재샘플링/보정하지 않고 typed 거절하며 자원 bytes/GPU 승인은 별도다.

저장 frame 출력 검사는 `EngineFrameBuffers`의23개 필드를 전수 분류한다. 렌더 command/material 길이 대응,
선택 material sidecar의 empty 또는 동일 길이, 그림자 triangle·타일 경로5-float stride, 오디오 pose 최대65개와
수치·material 범위를 readonly로 검사한다. 다음 animation update가 직접 참조하는 overflow event 인덱스는
실제 overflow 종류·sentinel event를 가리켜야 한다. 과거 엔티티/자원 ID를 현재 World와 대조해 삭제하지 않으며,
telemetry의 actor height 부재를 나타내는3개 NaN과 정수 gameplay payload bits도 보존한다. 모든 vector 방문은
합산 work에 사전 청구하고 scratch 할당이나 frame 재생성을 하지 않는다. 실제 자원 해소와 출력 생성 이력의
완전한 증명은 별도 단계다.

Private `file_engine_section`은16-byte `F2DFSTAT` v1 prefix 뒤에 기존 memory
payload bytes와 두 typed table 필드를 둔다. 기존 memory checkpoint schema는 바꾸지 않는다. 중첩 Engine/native
decode와 두 table은 기존 admission scope 하나에서 allocation/value/depth 한도를 누적 사용하며, 중첩 decoder가
독립 default 예산을 시작하지 못한다. Table은 실제 원본 `&Engine`에서 memory encode 전에 포착하며 주소를 파일에
쓰지 않는다. Route Point/clip Arc의8개 owner 위치와 native collider/Compound child를 전수 열거하고 첫 ordinal로
공유 관계를 기록한다. 같은 값의 별도 allocation은 합치지 않는다. 파일은 graph 선언이며 과거 process의 인증은 아니다.

`file_sharing`은 table/실제 root census·location·generation·domain·group·길이와 같은 group의 값을 검사한다.
Shape table 유무는 실제 native runtime과 일치해야 하며 work/scratch/root/compare allowance를 두 owner에서
차례로 차감한다. Route/clip 정렬은 주소 순서가 quota 판정에 영향을 주지 않도록 n 기반 보수 상한을 먼저 청구한다.
공유 복원은 새 `Box<Engine>`을 소비하므로 뒤 owner가 실패해도 부분 변경된 Engine을 반환하지 않는다.

형상은 실제7종 concrete type만 허용하고 overridable tag를 신뢰하지 않는다. 저장 Serde-event의 float bits·BVH·flags·
topology를 bounded byte 비교하고, 양쪽 Arc를 pin한 proof로 같은 값의 backing만 바꾼다. COW 이후 다른 Arc가 된
target에는 stale proof를 적용할 수 없다. Compound parent는 unique이어야 하며 child→parent 순서로 연결한다.
복원 중 shape setter·dirty flag/revision 변경·query/step/BVH 재빌드를 하지 않는다. Wrapper나 공유 graph 성공도
완전한 Engine/resource/session 승인 결과는 아니다.

Tilemap 검사는11개 저장 필드와 별도 navigation scratch의8개 collection을 검사한다. Definition/층·collision chunk와
flat rectangle 대응·solid cell coverage 및 실제 horizontal run/vertical 연속성을 재빌드 없이 대조한다. 과거 path/floor
출력을 현재 map으로 재계산하지 않는다. Heap은 같은 Vec wire를 읽되 heapify 전에 원래 순서·필수 값을 검사하므로,
잘못된 원본 heap을 자동 정렬해 승인하지 않는다. 정상 memory wire는 보존하고 잘못된 입력의 거절은 강화한다.

Data Scene의 전용 navigation Tilemap·장애물 overlay·이동 route·이동 animation은 별도 owner 검사로 연결한다.
장애물의 원래 cell 순서와 과거 active/rectangle은 유지하면서 내부 coverage 합계·base/effective cost·grid geometry를
대조한다. 현재 collider를 조회해 overlay를 다시 만들지 않는다. Grid 교체 직후의 이전 route/search, 삭제된 actor와
animation binding, float32 반올림을 갚는 음수 거리 credit도 정상 history다. Facing·route cursor·유한 수치와 raw index를
검사하고 search/sweep의 각 owner에는 같은 잔여 work/scratch를 전달한다. Heap 예약 capacity처럼 wire에 없는 값으로
원본 엔진과 복원 후보의 Usage가 다를 수 있으며, 같은 파일의 반복 복원에서 일정한 Usage와 byte 보존을 검사한다.

전용 collision scratch2개와 rigid-step scratch의 별도 검사도 candidate에 연결한다. Nested broad-phase/cache·island
forest/schedule·constraint/contact cache/sleep/split 상태를 읽기 전용으로 검사하며 재귀·World 재조회·solver 실행·
clear/rebuild로 손상 상태를 복구하지 않는다. 이 연결은 나머지 Engine owner/SDK 자원/세션 Ready 검사를 대신하지 않는다.

작성 스냅샷은14개 저장 필드를 검사하며 World component와 같은 수치 predicate를 공유한다. 과거 entity handle을
현재 World와 대조해 바꾸지 않고 full backing/count·guard·이동/행동/충돌 반응의 저장 payload를 검사한다.
Native capsule snapshot은 public enable과 같은 skin/radius 및 body×collider 현재 축 조건을 검사한다. 예약된 다음
target의 과거 pose를 현재 축 조건으로 거절하지 않으며, 이것만으로 CharacterRuntime 전체 payload를 승인하지 않는다.

별도 character 저장 검사는 Runtime의12개 persistent 필드와 `PathScratch`의 Preview/합산 상태 사본을 다룬다.
공개 명령 범위와 solver 결과 범위를 구분해 결과 속도가 단일 명령 상한을 넘거나 cold edit 뒤 translation과
velocity×dt가 다른 정상 이력을 보존한다. 이전 config가 저장되지 않은 Preview를 현재 up/mass와 대조하지 않고,
제거된 support/stop token도 현재 World로 다시 만들지 않는다. `hit_ceiling`은 여러 구간의 OR 이력이므로 마지막
구간의 하강 속도를0으로 강제하지 않는다. 이 native pass는 기본128 Mi 논리 방문·scratch0의 독립 정책이며
candidate의 post-decode budget과 별도로 표시한다. 기존 누적 decoder scope를 새로 시작하지 않는다.
WorldState.characters도 원시 BodyId 순서/중복을 삽입 전에 검사해 조용한 정렬·행 소거를 거절한다.

UnifiedPhysicsRuntime의 binding/inverse/joint/projectile, lifecycle과 terrain, automatic settings에 있는11개
map/set도 같은 원칙으로 원래 key를 검사한다. Optional terrain map은 기존 option wire를 유지하고 입력의
중복 value를 decode하기 전에 거절한다. 정상 Serialize wire와 기존 누적 decode 청구량은 유지한다.
이는 원시 key 검사이며 별도 payload 검사와 구분한다.

나머지 runtime16 저장 payload는 이전 raw auto config·legacy binding descriptor·pending planar/joint·projectile·
terrain/platform motion·dash·automatic settings를 읽기 전용으로 검사한다. 기존 binding/inverse/retired 참조 검사를
반복하지 않고 같은 잔여 work/scratch를 차감한다. Raw 이전 설정과 sanitize된 contact 설정의 범위는 구분한다.
실패한 prepare의 정상 prefix/default suffix와 유한하지만 생성 위치 한도를 넘은 과거 platform pose를 보존한다.
Dash backup과 automatic saved motion은 공개 checkpoint 경계에서 항상 비어 있어야 한다. 내부 prefab 설정은
unbound batch로 native body 한도를 넘을 수 있고 삭제 직후에는 다음 retirement 전까지 stale key가 남는다.
이 이력을 현재 World로 다시 바인딩하거나 무제한 세대 누적의 증거로 취급하지 않는다.

게임플레이 공통 cold helper는 trigger queue·contact tracker·이동 target cache와 World EntityTemplate을 읽기
전용으로 검사한다. World component의 기존 animation/material predicate를 재사용하며 재설정·정규화·현재
World 동등 비교를 하지 않는다. DataSceneGameplay/Combat의 queue·scratch·navigation·prefab·작성 사본도 같은
누적 budget으로 검사한다. ActorPrototype/BodyPrototype과 controller 설정은 원본 descriptor를 읽기만 하며
backend shape를 만들거나 과거 경로를 현재 씬으로 재계획하지 않는다. Combat binding map의 원시 key 순서와
중복도 삽입 전에 검사한다. Native controller는 별도 선행 pass가 담당해 중복 검사하지 않는다.

Shooter/Breakout/Platformer의 비활성 슬롯까지 저장 payload를 검사하고 native 내장 씬의 두 body-cache owner도
검사한다. 이전 입력·pending command·제거된 body token은 실제 producer의 저장 계약을 따르며 현재 설정으로
재작성하지 않는다. 이 검사는 나머지 runtime pending/planar/terrain/dash payload 검사를 대신하지 않는다.

공간 씬 검사는 환경 버전1~15·조명/모델/streaming·terrain·attachment·공간 navigation과 continuity의 저장 owner를
검사한다. 렌더 비활성화 뒤 남은 출력과 terrain 교체 뒤의 과거 shadow metadata를 현재 source로 재생성하지 않는다.
공간 navigation heap은 heapify 전에 저장 순서를 검사한다. 공간 씬·모델·streaming·search의6개 BTree map/set도
key가 엄격히 증가하는지 삽입 전에 확인하므로 잘못된 순서/중복이 자동 정렬/덮어쓰기로 사라지지 않는다.
정상 Serialize wire와 기존 누적 decoder allowance를 유지하며 별도 decode scope나 임시 key vector를 만들지 않는다.

Native controller 검사는 actor route·search·cache·combat navigation을 대상으로 하며 공유 관계 복원 뒤에 실행한다.
현재 World의 세대나 장애물로 과거 경로를 재계획하지 않는다. Physics query snapshot의 합성 collider 회전 오차는
실제 body×local pose producer 계약을 따르고, 거절된 요청에 남은 raw floor history를 활성 search floor와 구분한다.
공유 복원 뒤 이 검사가 실패하면 소유한 candidate를 폐기하며 live Engine을 노출하지 않는다.

별도 물리 출력 검사는 legacy34개·native6개, 총40개 저장 root를 분류한다. Query/hit·scratch·bulk body/character/
joint·collision/observation·Shooter packed output의 길이/수치/코드를 검사한다. 요청 순서와 중복 bulk handle, 삭제된
entity의 과거 출력, 명시된 무한 질량/관성과 joint break sentinel을 보존하며 현재 World에 맞춰 정리하지 않는다.
한 owner가 사용한 work/scratch는 다음 owner의 allowance에서 차감한다. 이 논리 비용은 실제 allocator/RSS의 상한이나
모든 출력 생성 이력의 증명이 아니며 자원·SDK/session admission은 계속 별도다.

Runtime 내부 observation11개는 별도 읽기 전용 pass로 lifecycle·contacts·gameplay pair·네 종류 query cache·
manifold·joint event/stream·통계를 검사한다. 공개 query 출력이 실패로 비워져도 남는 내부 cache를 검사하며,
event limit을 active snapshot 전체의 길이 제한으로 잘못 적용하지 않는다. 공유 복원과 controller 검사 뒤
DataSceneGameplay, runtime observation, runtime payload, 내장 scene 순으로 남은 work/scratch를 차감한다. 정상 bytes와 pending/
stale 이력을 유지하고 실패하면 새 candidate를 폐기한다. 실제 allocator/RSS·Ready·단일 publication은 별도다.

구 중심에서 시작한 solid ray는 접촉 법선이 정의되지 않는다. Vendor ball-ray 계산은 이때 NaN 대신 capsule과
동일한 유한0 벡터를 반환한다. 원래 유한했던 법선과 TOI의 비트·조회 순서·필터는 유지하고 저장 검사의 유한값
정책을 완화하지 않는다.

외부 host binding의 공통 내부 registry는 SDK 코드가 정의한 type token과 실제 GPU object/FontFace/host 객체의
identity를 연결한다. 파일에는 kind/version/symbol만 들어가며 새 host의 명시적 등록으로 해소한다. 등록할 때만
trusted type guard를 호출하고 capture/resolve/prepare는 파일이 제공한 코드·guard·adapter를 실행하지 않는다.
별도 자원 owner가 전체 파일 자료 검사 뒤 등록된 typed adapter를 사용한다. Registry 수정·해제·재등록은 이전
fence와 대상에 묶인 prepared token을 무효화한다. 준비는 공통 resource ledger를 받아 metadata/work를 청구하며
consume/discard는 host 소유 자원을 해제하지 않는다. Registry revision은 객체 내부 변이·GPU generation·Engine
epoch나 전체 세션의 Ready를 증명하지 않는다. 실제 자원/대화·퀘스트와 최종 세션 연결은 계속 별도 개발 범위다.

Navigation producer는 raw finite layer 크기를 저장에서 clamp하지 않는다. 표현할 수 없는 center는 기존 query 실패
경로로 반환한다. 거리의 기존 f32 결과가 유한하면 연산 순서/비트와 정상1회 순회를 유지한다. Overflow에서만 원본
좌표를 f64로 넓혀 계산하고, f32 최대 범위를 넘으면 cast가 MAX로 반올림되더라도 실패한다. Path query 실패는 결과와
path/debug 출력을 지우며 waypoint 실패는 기존 계약대로 query 결과만 초기화하고 과거 path 출력을 보존한다.

SDK authoring 내부 helper는 실제 저장 문서·continuity·순서 있는 instance registry·resource ID/content 대응을
detached DTO로 포착/검사하고 metadata만 새 candidate에 연결한다. Native apply/spawn/configure/진행 복원은
재실행하지 않는다. 실제 같은 capture cut의 admitted native/resource roster와 canonical read-only adapter는
호출자 전제다. Materialized document 부재와 임의 resolver/service callback은 capability 오류로 남기며,
이를 최종 파일 기능의 지원 범위 축소로 취급하지 않는다. Host binding 재해소·자원 byte/GPU 준비·실제 roster 추출·
모든 참여자의 fence/단일 publish는 아직 별도 미완이다. JS traversal/resolve 제한은 논리 예산이며 VM의 열거·할당/RSS
상한을 보장하지 않는다.

Legacy `SpriteAnimation::advance`는 정상 f32 연산을 유지하면서 최대4096회 실제 frame subtraction 뒤에는
bounded phase 계산을 사용한다. 극대 FPS/진행량과 f32 overflow는 f64 cycle/remainder로 바로 처리해 subtraction
비진행을 막는다. 저장 시 period로 반올림된 remainder는 다음 frame으로 넘기고0을 저장하며, f32로 표현할 수 없는
큰 remainder는 이 fallback에서만 finite MAX로 포화한다. FPS constructor 범위/struct/serde wire는 바꾸지 않는다.
일반 경로 byte 보존과 비종료/overflow 범위의 새 처리 정책은 별개이며 전체 애니메이션/엔진 시간 예산 수용은 아니다.
vendored Rapier의 `Arena<T>` 복원은 점유 슬롯 수와 빈 슬롯 전체 연결을 반환 전에 검사한다.
잘못된 free-list head/link·순환·누락·0-slot 상태는 거절하고 저장된 세대/재사용 순서는 보존한다.
검사는 slot 수에 비례하며 scratch 할당이 없다. 이는 arena 간 참조·entry payload·세대 소진과
BVH/형상/동적 행렬의 검증 완료를 뜻하지 않는다.
Cold native checkpoint capture와 candidate 복원은 추가로 body/collider의 상호 참조,
broad/narrow phase와 impulse-joint graph, 유효한 solver bucket의 실제 dynamic body 소유권을 검사한다.
독립 한도는 raw slot·저장 링크·scratch 초기화 등 128 Mi개 방문 작업과 누적 요청 scratch 64 MiB다.
요청 한도를 선청구하고 fallible reserve를 사용하며 초과·할당 실패는 Capacity로, 참조 모순은 InvalidState로 거절한다.
정렬 비교 횟수·decode heap·allocator/RSS 상한을 뜻하지 않는다. 실행 중 매 틱에는 이 검사를 호출하지 않는다.
정상 pending removal·TYPE 변경·무효화된 graph의 지연 이력은 producer/consumer 조건에 따라 보존하고,
저장된 상태를 정렬·재빌드해 검사를 통과시키지 않는다. 별도 island 검사는 모든 active/sleep 및 persistent
body/index의 양방향 참조, free id와 contact/joint location, 대기 중 joint edit의 generation을 검사한다.
BroadPhase의 삭제 직후 collider slot 재사용에서는 신 generation의 Coarena row 삽입 전에 구 generation adjacency를
회수한다. 실제 pair/역방향 link 삭제는 기존 canonical stale pass에서 처리해 일반 경로의 Add/Delete 순서를 유지한다.
같은 slot의 새 row가 옛 pair를 숨겨 정상 다음 step의 저장을 거절하던 producer 결함을 고친 것이며 validator를 완화하지 않는다.
독립 한도는 128 Mi개 방문/정렬/검색 작업 단위와 누적 요청 scratch 64 MiB이며 초과·예약 실패는 Capacity다.
정상 삭제·재사용·타입/수면 변경의 지연 이력을 보존한다. 여러 component가 동시에 잠든 뒤 남은 빈 활성
container는 지정 awake id일 때만 허용하며 삭제·재빌드하지 않는다. 다른 empty chunk는 계속 거절한다.
Persistent island removal count는 소비 의미가 zero/nonzero이므로 증가/합산을 포화 처리한다.
Sleep scan과 split deadline 생성 전에16 scan의 정수 여유를 확보하며, 부족하면 실행 중에만 clock을1로
옮기고 future deadline의 남은 scan 수/expired 의미·기본0을 유지한다. 일시 scan stamp 목록을 비워0 alias를
방지한다. Capture/restore/admission은 저장된 숫자를 정리하지 않는다. 일반 경로는 O(1), 드문 rebase는
O(raw island slots + scan id-space)이며 전체 frame 시간/할당량 상한으로 해석하지 않는다.
안정된 enabled joint와 실제 active solver contact는 현재 body의 island 소속과 저장 link/owner를 대조한다.
정확히 해당하는 pending joint edit와 body TYPE/ENABLED, collider PARENT/TYPE/ENABLED 변경은 그 endpoint만
대조에서 제외해 정상 지연 이력을 보존한다. Dirty 목록을 전체 검사의 면제 조건으로 쓰지 않는다.
완전한 connected-component 재구성과 pending flag의 생성 이력, 다른 backend 정수의 산술·세대 소진·공유
geometry topology 검증은 별도 미완이며 외부 byte importer는 공개하지 않는다.
Native 형식 5는 impulse joint의 대기 중 island event와 modified 목록/flag를 실제 저장한다. 첫 step 뒤 관절을
생성한 직후에도 원본의 연결 순서와 이후 continuation을 유지하며 bootstrapped를 false로 강제하지 않는다.
형식 2·3·4는 거절한다. Engine outer 형식 2와 Web memory-checkpoint capability 1은 그대로다.
실제 backend IntegrationParameters는 config와 공통 생성 계약으로 대조한다. 정상 native tuning의
CCD substep 1..32(continuous off는0), warm-start 계수0..1, 두 friction model은 보존한다.
그 밖의 반복 수·softness·중첩 미사용 soft 설정도 검사하므로 정상 config 뒤에 다른 solver 설정을 숨겨 복원하지 못한다.
Body/collider 수치 검사는 별도 128 Mi개 raw-slot/고정-record 작업 한도를 선청구하며 무할당으로 수행한다.
현재/예약 pose, force·velocity, 질량/유효 관성, activation·material의 의미별 수치를 검사한다.
Never-sleep의 음수 threshold, zero mass/inertia·lock, signed force, 양의 무한 event threshold와
정상 pending/quarantine 이력은 구별한다. Body별 추가 solver/PGS 반복은 각각32를 cold 상한으로 둔다.
실제 backend joint frame·limit·motor·signed warm-start impulse와 Ferrum ratio cache도 검사한다.
변경된 native frame을 작성 원본으로 덮어쓰지 않으며 joint 수는 runtime metadata와 일치해야 한다.
각 방문/반복 한도는 전체 simulation CPU·allocator/RSS 또는 모든 유한 입력의 이후 overflow 방지 증명이 아니다.
Contact 수치는 raw manifold와 현재 선택된 solver cluster를 모두 검사한다. 접촉점·signed warm-start,
normal·subshape/recycle pose·material/correction·solver anchor/velocity를 의미별로 검사하고,
NEW bit를 제거한 contact index는 실제 point 길이와 SIMD sentinel255 미만이어야 한다.
Solver contact 길이의 producer 상한4와 현재 epoch가 일치하는 ready graph의 비지 않은 list도 검사한다.
이 검사는 무할당이며 별도의128Mi 논리 작업 한도를 pair32/manifold64/point32/solver16 및 graph slot으로
선청구한다. 현재 pose와 cached 이력을 강제로 같게 만들지 않으며 signed/zero·정상 pending/sleep 이력을 보존한다.
Approximate normal과 cached 회전의 tolerance는 역할별 cold 정책이며 모든 극단값의 이후 산술을 증명하지 않는다.
지원하는5종 workspace의 cache와 raw manifold도 cold 경계에서 대조한다. Map의 timestamp·index·역참조와
shape 역할별 subshape/part pose를 검사하고, TriMesh는 저장 interference와 현재 bounds의 실제 triangle 집합을
비교한다. SHAPE 변경 대기 중에는 이전 geometry cache의 내부 관계를 검사하되 새 geometry로 덮어쓰지 않는다.
별도128Mi 작업/누적 요청 scratch64MiB를 선청구하며 저장 순서와 pose padding bytes는 유지한다.
제거한 collider가 다음 tick까지 graph에 남는 경우에는 삭제 큐의 정확한 handle/generation을 별도 정렬
scratch에서 확인한다. 같은 slot의 새 shape를 이전 pair에 적용하지 않는다. 현재 geometry 대조만 생략하고
내부 cache 검사는 계속 수행하며 큐에 없는 missing handle은 거절한다. 큐 scan/init·정렬/검색의 논리 level과
scratch를 선청구한다. 이 work 모델은 실제 std 비교 횟수·CPU/RSS 상한을 뜻하지 않는다.
모든 shape feature의 의미·pending flag 생성 이력과 전체 파일/SDK 복원 계약은 계속 별도 검증 대상이다.
실행 중 SHAPE 교체를 실제 소비할 때는 기존 manifold/cluster/workspace/recycle을 비우고 solver graph를 다시
구성한다. Collider identity와 event/color 상태는 유지해 접촉 지속·종료·센서 전이를 구분한다. Cold capture는
이 reset을 실행하지 않으며 pending history를 보존한다. Workspace None의 current primitive pair도 root
manifold 0/1개·subshape 0·part pose 없음의 역할을 검사한다. Geometry 교체의 graph 재구성 비용은 별도 수용 대상이다.
Native checkpoint는 별도 private backend schema를 사용한다. 지원하는 바디·collider·impulse joint와
island·broad/narrow phase·솔버 설정은 그대로 저장하고, API를 제공하지 않는 multibody/soft-body set은
정상적인 초기 empty persistent state와 정확히 같을 때만 각각 0 표식으로 저장한다. 고정 256-byte 버퍼로
현재 set과 초기 set의 인코딩을 비교하므로 사용 후 비어 보이는 set의 세대·queue·epoch 이력도 버리지 않는다.
복원은 표식을 검사하고 고정 초기 arena의 작업량을 누적 예산에 반영한 뒤 빈 set을 생성한다. 이 경로에서
해당 native set/entry의 Deserialize를 호출하지 않아 multibody의 동적 행렬 payload에 도달하지 않는다.
이 변경은 지원한 상태를 생략하지 않으며, vendor의 일반 Serde와 나머지 형상/구조 검증을 대신하지 않는다.
Parry의 Array2/VecMap Deserialize는 checked 차원·실제 배열 길이/occupied count를 검사한다.
HeightField는 height/status grid·삼각형 수, 유한한 값·bounds·scaled height, flag와 양수 cell spacing을 검사한다.
BVH는 parent 저장 길이·표식 bit, free list, rooted graph의 부모/자식·count·leaf map을 검사한다.
owned candidate의 parent 상위 bit를 임시 방문 표식으로 사용하고 성공 전에 원래 값을 복원하므로
재귀·추가 scratch 할당 없이 O(node storage + leaf storage)로 검사한다. 최적화가 남긴 unreachable 이전
노드와 optimization cursor, free 순서를 보존한다. 부분 갱신은 flag 없이도 ancestor bounds를 stale하게
둘 수 있으므로 이 단계는 generic BVH의 containment를 요구하지 않으며 호출자는 query 전 refit 계약을 지킨다.
전체 BVH rebuild는 rooted leaf만 기존 저장 순서로 모은다. 기존 raw scan은 최적화가 남긴 retired leaf를
되살릴 수 있었다. 새 mask는 기존 workspace Vec를 재사용하며 최대 4 bytes/node 예약 공간이 추가된다.
immutable TriMesh/Compound의 BVH에는 연속 part ID·정확한 leaf 수와 실제 형상을 포함하는 leaf/ancestor
bounds를 별도로 검사한다. TriMesh의 half-edge next/twin/vertex, connected-component face permutation,
ConvexPolyhedron의 vertex/edge/face incidence와 reciprocal outgoing edge, Compound의 part pose와 bounds,
optional normal cache도 cold Deserialize에서 검사한다. Vendor의 primitive SharedShape는 유한 좌표·비음수 크기와
unit half-space normal을 Arc 생성 전에 검사한다. 정상 wire·feature ID·cache 순서를 유지한다.
Ferrum checkpoint reader는 별도로 지원7종(Box/Sphere/Capsule/ConvexHull/TriangleMesh/Heightfield/Compound)의
Serde enum tag만 허용한다. 미지원 tag는 payload 생성 전에 거절하며 Compound child에도 같은 경계를 적용한다.
접촉 workspace도 TriMesh, Heightfield–Shape/Composite, Composite–Shape/Composite의5개 tag만 허용한다.
Voxel3종과 Custom은 내용 생성 전에 거절한다. 두 경계는 같은 private enum visitor에서 원래 tag/seed를 유지하며,
앞의 cold workspace 검사는 이 tag 경계 이후 실행한다. 일반 vendor Serde의 더 넓은 tag 허용과 정상
저장 bytes·query 순서는 유지한다. 이 경계가 전체 cross-arena·numeric·공유 geometry topology·실제
allocator/RSS 한도 또는 외부 파일 importer를 증명하지는 않는다.
볼록체 비균일 scale은 inverse-transpose normal과 반사 winding을 사용하며, 메시의 angle-weighted
pseudo-normal은 scaled geometry에서 재계산한다. 기하학적 볼록성, 모든 shape variant·수치 연산,
cross-arena와 전체 파일/SDK 복원 검증은 계속 필요하다.
BVTT 자기 교차 검색과 `subtree_depth`는 부모 링크를 반복 순회하며, 두 subtree 교차 검색은 기존 workspace의
3-word frame을 재사용한다. 유효한 깊은 저장 트리를 depth cap이나 재빌드로 바꾸지 않고 처리하며 기존
callback 순서와 change filter를 유지한다. pair 순회는 pending depth마다 12 bytes와 leaf 순회의 기존
stack entry를 사용하며, workspace가 부족할 때만 성장한다. 다른 build/refit 재귀와 전체 작업/할당 예산은
별도 수용 대상이다.
layout-resolving/flag-preserving refit은 기존 destination buffer와 새 parent link를 반복 순회해 깊이별
호출 스택·추가 traversal scratch 없이 같은 layout을 생성한다. in-place refit도 parent link를 사용한다.
optional native parallel refit은 분리된 mutable slice로 task별 쓰기 범위를 제한하며 raw pointer의 전체
Vec/VecMap 가변 참조 공유를 사용하지 않는다. task 분할은 최대 7단계이고 tail은 반복 helper를 사용한다.
sparse leaf mapping은 join 후 O(node count) pass에서 갱신한다. 기존 buffer 성장 및 추가 parallel pass의
비용, 남은 build 재귀와 전체 작업/메모리 예산은 별도 수용 대상이다.
검색·경로 캐시는 collider generation과 형상 변경 번호로 geometry를
검사하며 프로세스 내부 SharedShape 주소에 의존하지 않는다. 같은 값으로 교체하거나 원래 형상으로
되돌려도 변경 번호가 증가해 이전 검색을 되살리지 않는다. 변경 번호는 native checkpoint 형식 2부터 포함하며,
u64 초과는 변경 전에 거절한다. sparse 기록은 fixture/body 삭제 시 제거한다. private query snapshot도
직렬화할 수 있으며 외부 파일은 public bounded same-build Native 게임 파일 세션으로 읽는다. clock/input latch, entity arena·ownership, 지형 phase,
AI intent/frontier/cache, projectile/pending hit, camera/particles/tweens와 출력 buffer까지 포함한다.
평면/공간의 continuation은 native encoded bytes와 World/보간/게임플레이 관측으로 검사한다.
owner Arc가 다른 Engine과의 교환을 거부하고, 복원 revision은 단조 증가하며 wrap을 거부한다.
기존 entity/native 세대와 Data Scene epoch는 저장 시점으로 돌아간다. revision을 handle에 자동 부착하지는
않으므로 폐기된 미래의 handle/view는 호스트가 버려야 한다. 실패는 candidate commit 전에 반환한다.
Web은 RAF pause/stop 뒤에만 사용하고 SDK의 physics metadata도 함께 복원한다. token은 위조·교차 Engine·
dispose 이후 사용과 JSON 직렬화를 거부한다. 외부 JS 서비스·asset/GPU 자원·authoring registry와
파일 저장은 포함하지 않으며, 기존 native JSON 저장 거부와 파일 호환성 작업은 계속 유지한다.
기존 entity lifecycle reducer와 별도로 native collider stream을 Web에 제공한다. 단일 native drain에서
양쪽으로 전달하므로 한 소비자가 다른 소비자의 전이를 가져가지 않는다. 타일/공간 표면을 포함한
참가자 identity는 매핑 제거 전에 22-u32 repr(C) row로 보존한다. 선택적 public 큐는 maxEvents까지
누적하고 native/public 누락 수를 구분한다. 전체 active snapshot은 큐를 소비하거나 물리를 진행하지
않으며, overflow 이후 현재 상태를 복구한다. snapshot 저장량은 활성 pair 수에 따라 증가한다.
충격량은 별도 post-solve 경로에서 수집한다. 내부 solver substep의 실제 누계를 CCD/관절 solve별로 합치고,
constraint 생성 시점의 접촉점·각속도를 포함한 접근 속도와 마찰의 world-space 방향을 보존한다.
Engine은 이를 기존 rigid contact/impact buffer와 충돌 효과에 연결한다. 효과 분류는 실제 접촉 fixture를 사용하며,
XYZ native 결과와 화면용 XY 또는 X/-Z 투영 결과를 구분한다. native solver 제출량·body/island 상태와
CCD 실제 검사·이동 제한을 step/frame 통계로 수집한다. CCD witness는 기존 디버그 선 버퍼에도 연결하고
한 frame의 초기 tick에서 발생한 제한을 보존한다. 기존 solver의 row-operation 수를 native 접촉 수로 대신하지 않는다.
Web은 지형을 포함한 접촉면 27-word/point 7-word, solve 시점의 충격량 32-word와 frame CCD 28-word를 읽는다.
현재 geometry 조회와 마지막 tick의 solved 결과를 분리하고, entity/terrain 매핑 제거 전 identity를 저장한다.
지형은 셀별 collider/정확 shape·one-way·filter·authored identity를 유지하면서 같은 8×8 chunk/span의 fixed body를 공유한다.
움직이는 SpatialSurface는 독립 kinematic body를 사용한다. Native body ID를 셀 ID로 간주하지 않는다.
query의 terrain purpose(all/movement/projectile/vision)는 실제 authored flag로 limit 전에 거른다.
기존 tile DTO는 실제 Tile source만 매핑하며 SpatialSurface에 가짜 tile 번호를 부여하지 않는다.
Solved terrain impulse와 swept projectile witness는 별도 24-word frame sidecar와 kind15 gameplay event로 연결한다.
지형 cooldown은 entity-pair와 분리한 typed key를 사용하고 실제 XYZ를 유지한다. Entity pair impulse ABI는 바꾸지 않는다.
성공한 platform path/accepted prefix의 render history와 presented terrain mesh는 물리 surface·picker와 분리한다.
GPU는 `terrainRenderRevision`으로 표시 mesh 변경을 추적한다. Native memory checkpoint/file owner는 이 nested state와 budget을 함께 검사한다.
외부 파일은 동일 Core/SDK build fingerprint만 승인하므로 과거 nested wire를 새 layout으로 자동 해석하지 않는다.
71-word 진단은 header와 repr(C) native step/frame counters를 담으며 별도의 allocation-free refresh가 frame sampling에 사용된다.
FrameState의 소유 진단은 Runtime overlay/profiler/trace로 전달한다. native frame extrema는 native sample 수와 함께 기록한다.
Raw Engine과 Web의 backend 생략 생성은 Native PlanarXy·자동·가변 시간 정책을 사용한다.
명시적 `physicsBackend: "legacy"`만 legacy 경로를 선택하며, 저장 복원은 파일에 저장된 정책을 유지한다.
전체 제품 통합과 밀집 성능의 최종 수용은 별도 검증 대상이다.
캐릭터 입력·중력·점프와 이동 발판 운반은 Rust의 승인 물리 구간에서 처리하고,
접지 상태는 backend step 뒤의 실제 위치를 기준으로 확인한다. 아직 기존 엔진의 HD-2D 이동 경로를 대체하지 않는다.
관절은 backend의 마지막 impulse만 읽어 순간 파손을 놓치지 않도록 각 solver substep의 하중을 확인한다.
이 경로에서는 position-kinematic 목표를 substep별 보간하고, 세대 핸들과 bounded 삭제/파손 이벤트를 유지한다.
거리 관절의 압축 구속과 spring의 겹친 anchor 복구는 실제 anchor 방향을 따르는 radial constraint로 처리한다.
Gear/Pulley와 탄성 Rope는 같은 Rapier body/substep에 전용 row를 적용한다. rigid 구속의 위치 오차는 속도와 분리해 보정하고,
탄성 구속은 적분 전 implicit impulse를 적용해 하중에 따른 늘어남을 유지한다.
기존 관절의 생성·수정·삭제·파손·진단과 continuous hinge limit도 연결했다. 연속 회전각은 별도로 보존하고,
매 substep hinge frame과 limit을 현재 각도 주변으로 옮겨 같은 native solver에서 anchor·motor·접촉을 처리한다.
평면 body가 이미 잠근 hinge 축의 중복 row는 제거하며, 비활성 endpoint의 과거 impulse를 현재 하중으로 보고하지 않는다.
native 하중은 quaternion gradient와 mass-orthogonalized Jacobian을 반영해 힘과 anchor couple로 변환한다.
기존 8종 관절의 normalized stiffness/damping과 frequency 없는 Spring을 60 Hz 기준의
질량 정규화 탄성 계수로 변환한다. 두 계수가 0이면 해당 구속을 해제하고, stiffness 0·damping 양수는 순수 감쇠다.
기존 solver의 iteration별 궤적과 같다는 보장은 없으며, 변환식은 통합 물리 계획에 명시한다.
힌지·슬라이더·용접의 선형/회전 탄성은 해당 locked axis를 native motor row로 바꾸며, free axis의 motor/limit은 유지한다.
탄성 frame이 있는 world는 off-center 구속의 정착을 위해 각 substep에서 PGS/relax를 각각 4회 수행한다.
회전 motor의 목표 속도·위치는 limit 안으로 제한해 경계에서 계속 가속하는 현상을 막는다. 밀집 비용 검증은 남아 있다.
기존 2D API와 새 world가 동시에 같은 바디를 시뮬레이션하지 않도록 연결 단계에서 소유권을 명시한다.
새 entity binding은 기존 속도 적분에서 제외한다. planar adapter는 기존 질량·관성을 zero-density fixture와 명시적
mass properties로 보존하며, 힘·충격량을 한 tick에 한 번 소비한다. body-local fixture 회전·offset은 기존 canonical
충돌 query에도 같은 방식으로 반영한다. 마찰은 기하평균, 반발력은 최댓값으로 합성하며, surface velocity는
native contact의 접선 속도로 전달한다. 평면 height/floor는 contact·sensor·CCD·query·character에 공통 적용한다.
평면 축 잠금에서 특이해진 접선 마찰 행렬과 manifold별 접촉 보정은 `crates/ferrum-core/vendor/rapier3d`의 수정으로 처리한다.
원본 버전·hash·라이선스와 변경 내역은 해당 디렉터리에 보존한다. 기존 네 가지 접촉 보정 material scale과
전역 contact bias·상한·position percent/slop·split impulse 설정은 fixture 응답으로 변환한다.
위치 보정은 적분 후 속도에 남기지 않고, 속도 편향은 split 설정에 따라 relaxation에도 유지한다.
실행 중 contact 설정 변경은 fixture cache를 갱신하며 입력 전체 검증을 먼저 수행한다.
중력·반복 횟수·반발 속도 임계값·전체 CCD는 `SolverSettings`와 공통 native 적분 경로에 연결한다.
제품의 통합 물리는 Rapier 일반 스텝과 CCD를 사용한다. 캐릭터는 Rapier KCC로 이동하며,
지정 경로의 매듭 시간에 스텝을 나눈다. 투사체는 틱 시작·끝 대상 자세를 보간해 명중을 계산한다.
중력 변경의 native wake를 과거 World sleep projection으로 덮어쓰지 않는다. 기존 자동 실행 off는
native step도 멈추며, 수동 step은 같은 world·고정 tick을 사용한다. one-shot 설정은 자동 설정과
Engine accumulator를 바꾸지 않는다. spatial legacy component의 전체 이전은 남아 있다.
통합 planar world의 기존 ray/segment/point·영역·nearest·shape cast 조회는 native geometry와 세대별 body→entity 매핑을 사용한다.
조회 전 authored body/fixture 변경을 반영하되 힘·충격량과 fixed accumulator는 소비하지 않는다.
category-only·sensor 포함·height span 필터와 기존 bulk hit layout을 유지한다. spatial ray는 명시적 XYZ Rust API를 사용하며,
XY-only 조회 호출은 진단으로 거부한다. 기존 shape cast의 point는 이동한 도형 기준점을 유지하며 native surface witness와 구분한다.
이동 거리 0의 sweep은 현재 contact를 검사한다.
통합 world의 collision lifecycle은 native collider 전이를 세대별 entity 쌍으로 합쳐 기존 24-byte 이벤트 버퍼에 전달한다.
복합 fixture의 마지막 접촉이 끝날 때만 Exit가 발생하며 solid와 sensor는 독립 채널이다.
Stay는 실제 native step이 끝났을 때만 생성한다. 삭제 시 body→entity 매핑을 지우기 전에 전이를 회수한다.
이벤트 누락 시 전체 active pair snapshot으로 현재 상태를 복구하며, native 전이/출력 이벤트의 누락 수를 각각 노출한다.
이벤트 출력과 무관하게 같은 active pair 상태로 Data Scene 아이템 획득을 처리한다.
통합 world에서 Data Scene의 충돌 반응도 이 active pair를 사용하며 compound/solid/sensor 중복은 entity 쌍당 한 번 처리한다.
범위 피해는 실제 native 도형의 category를 기준으로 sphere overlap을 수행한다. Spatial에서는 XYZ 거리,
PlanarXy에서는 기존 논리 floor/height 필터를 적용하며 시각적 offset을 판정에 넣지 않는다.
넉백은 dynamic/velocity-kinematic body의 native 속도를 변경한다. 기존 `impulse` 값은 질량별 물리 충격량이 아니라
속도 증가량이라는 authoring 의미를 유지한다. fixed/position-controlled 대상은 진단으로 거부하며 거짓 World 속도를 쓰지 않는다.
근접 상호작용은 native body 중심 사이의 거리를 사용하고, body가 없는 marker는 authored 위치를 사용한다.
Spatial에서는 높이까지 거리 계산에 포함한다.
Data Scene melee는 dispatch 시 native 중심을 저장하고 물리 뒤 native 도형까지 최근접 거리와 WALL ray를 검사한다.
문서의 collision layer는 생략한 native category의 기본값이며 명시적 category는 우선한다.
공격자의 첫 enabled fixture와 대상 fixture의 상호 mask, planar native span, gameplay faction을 적용한다.
복합 도형은 노출된 fixture를 찾되 entity당 한 번만 피해를 준다. 전체 query와 예산 승인이 끝나기 전에는
쿨다운/피해를 바꾸지 않는다. 별도 World collider나 render offset을 물리 판정으로 사용하지 않는다.
Data Scene dash는 물리 tick 전에 변위를 요청하고 완료한 실제 진행량으로 쿨다운을 결정한다.
캡슐은 transient tick velocity를 기존 controller 입력·점프와 합성하고, 다른 키네마틱은 발판과 같은 swept path로 실행한다.
속도형 몸체는 해당 tick에만 position path로 구동한 뒤 kind와 원래 속도를 복구한다. 회전 winding은 최대4개 경로 조각으로 유지한다.
일반 대시 경로는 sensor fixture도 solid 대상으로 sweep하고, 들어오는 비 경로 키네마틱도 접촉 시점에 정지한다.
투사체의 상대 운동 판정은 대시 바디의 틱 시작·끝 자세를 사용한다.

직접 전투 이동은 공유 MovementPattern 수학에 물리 좌표 기반 표적 resolver를 주입한다.
명시적 native body의 Chase/Seek/Accelerate/Orbit/Linear/MoveToPoint/Static은 Rust 고정 tick에서
controller ground input, native velocity 또는 kinematic target을 갱신한다. World/renderOffset은
AI 물리 위치의 원본이 아니다. capsule은 점프·중력을 보존하고 이전 locomotion에서 carry를 제외한다.
primaryActor와 spatial.actor는 AI 이동 대상에서 제외한다. 기존 512 mover/2048 entity 경계는 유지하며
후보 순회는 임시 배열을 만들지 않는다. 아래 native Chase 경로에 다중 AI 캐시·스케줄링·bounded peer 회피를 연결했다.

native A* 커널은 검색 frontier, 후보 support, edge의 분할 위치와 slope 보정 횟수, 경로 복원 상태를 소유한다.
작업 예산을 소진하면 실행한 probe를 다시 수행하지 않고 다음 slice에서 계속한다. 노드4096·probe32768·
heap32768·요청 work8M 한도를 유지한다. 각 slice는 collider 수에 따른 조회 입력 비교 비용을 먼저 승인한다.
조회 입력은 원래 shape의 참조와 정확한 pose/filter/one-way/height 데이터로 보관해 hash 충돌 없이 변경을 검출한다.
지형 revision, collider generation, source pose/config 변경 시 pending job을 취소한다. 현재 단일 spatial.actor의
공개 요청은 이 커널을 기존 동기 호출 방식으로 사용한다. Native Chase의 scheduler/cache/crowd는 아래 경로를 사용한다.
전투 Chase에는 fixed geometry 전용 검색 policy를 추가했다. 정적 query 입력을 보존하고 mobile peer의 위치 변경은
pending job을 취소하지 않는다. 일반 spatial.actor 검색·cold 이동과 실제 물리 구간의 controller는 모든 몸체를 검사한다.
Chase runtime은 native body/terrain commit 뒤, 자동 tick에서만 검색과 route intent를 준비한다. 수동 step은 물리만 진행한다.
한 outer update에 검색 token1개·work1M·slice262144를 공유하고 pending frontier는 한 개만 둔다. 각 actor는 작은 route를
소유하며 목표 generation/floor/위치, 도착 반경, 재탐색 대기 시간을 관리한다. 패턴 제거·전투 해제는 입력을 정지한다.
native JSON admission은 additive capability getter로 구형 빌드를 사전에 거절한다. Native shape world의
공간 설정을 gameplay보다 먼저 한 번 적용해 입력 actor를 먼저 확정하고, source/거리 바인딩/최대 agent 계산에서 제외한다.
Rust의 v4 admission도 같은 소유자를 제외한다. Native route cache는 최대8개 FIFO이고 body ID 대신 실제
capsule/config/local pose/orientation/groups/span 값으로 호환성을 비교한다. 고정 query 입력 guard는 한 개만 보관하고,
고정 집합 membership까지 검증하므로 동일 개수의 fixed/kinematic 교환도 이전 경로를 무효화한다.
route 점은 Arc slice로 공유하며 각 follower는 별도 index만 진행한다. 합류는 동일한 sliced edge checker로 검증한다.
합류 검색이 만든 실제 꺾임점을 보존하고 가까운 cached waypoint부터의 suffix에 연결한다. 연결한 전체 점 수는
4096개 이내이며, 합류 실패 시 전체 A*를 다시 요청한다. A*와 connector는 하나의 pending job과 frame 예산을 공유한다.
cacheHit는 합류가 성공해 route를 설치한 경우에만 증가한다. Native crowd는 같은64 source와 frame work를 공유한다.
관측 속도 snapshot과 재사용 probe scratch는 Rust가 소유하고, 실제 capsule의 local pose/groups/generation과
3D 상대 sweep을 검사한다. Actor당 최대8 후보에 대해 peer forecast와 실제 이동 구간의 지형/지지 높이를
승인 후 검사한다. 회피는 수평 input만 바꾸며 대기 시 follower의 실패 판정을 보류한다. jump/gravity와 실제
character 접촉은 공통 tick에 남는다. Native crowd capability는 Chase capability와 별개로 검사한다.
64개 source의 서비스 시작점은 tick마다 순환한다. Planar actor와 grid obstacle도 별도 World collider 없이
실제 Native shape·pose·local offset·enable·generation을 사용하며 render anchor를 물리 위치로 사용하지 않는다.
Native all-pattern은 별도 movement capability와 v6 source admission으로 연결한다. Chase/Seek/Accelerate의
소유권을 먼저 확정하므로 일반 native 이동과 중복 적분/가속하지 않는다. Actor별 canonical velocity는
회피/실제 collision displacement와 분리하며, 예산이 승인된 tick마다 한 번만 보간/가속한다. Seek는 다음
waypoint까지 실제 지지면/높이를 검증한 shortcut과 skin 여유를 둔 stop-circle clip을 사용한다. A* support도
실제 capsule center/plane support로 계산해 local offset을 반영한다. Accelerate는 검색 없이 같은 terrain probe를
사용한다. 입력 actor 제외·jump/gravity·outer work 한도와 진단 ABI는 유지한다.
메모리 rollback은 `EngineRuntimeCheckpoint`에 포함되며 native JSON snapshot은 계속 미지원이다.


동시 비 controller 경로의16개 한도는 발판과 공유하며 초과 요청은 실행 전에 거절한다.
Data Scene 생성 투사체는 spawn 시 native velocity-kinematic sensor에 연결하고 이전 World collider는 제거한다.
기존 velocity 적분과 중복하지 않으며 실제 고정 tick의 시작/종료 pose를 sweep해 첫 충돌 지점에서 정지한다.
수동 스텝의 명중도 gameplay phase까지 보관한다. 대상의 틱 시작·끝 자세를 보간하고 Parry의 상대
운동 cast로 검사한다. 중간 회전으로 넓어지는 영역은 별도 BVH에 포함한다. 두 끝점 사이에 드러나지
않는 내부 반전이나 왕복은 관측에 포함되지 않는다. 앞선 투사체의 위치 보정은 뒤의 판정 경로를 바꾸지 않는다.

예측 분할기와 기본 vendor Dynamic CCD의 local candidate 검색은 회전 tip이 두 endpoint AABB 밖을 지나는 경우도 포함한다. 실제 collider-local
COM과 bounding sphere의 pivot envelope, endpoint union에 nlerp curvature를 반영한 bound의 보수적 교집합을 쓴다.
작은 각도는 회전 축에 따른 coordinate 범위를 보존하며 지속 BVH leaf·contact tolerance·TOI·결과 순서는 바꾸지 않는다.
예측 pass는 force-integrated velocity, 승인 pass는 현재 solver ccd_vels를 사용한다. 회전0은 원래 union bits 그대로다.
이 candidate 검색만으로 endpoint-nlerp narrowphase의 full-winding 손실이나 character의 authored 예측과 backend cap의
차이를 해결하지 않는다. Core의 실제 kernel 승인 경계는 아래와 같으며 전체 character·운반 경로 수용은 별도다.

main tile과 정적 SpatialScene 지형을 같은 native world의 fixed body로 등록하며, authored 이동 발판은 position-kinematic body를 사용한다. 변경된 지형과 planar body batch의
형상·최종 용량을 먼저 검사하고 삭제 후 갱신·생성한다. 같은 cell/surface id는 collider handle을 유지하며 삭제 후
재생성은 새 generation을 받는다. SpatialScene의 base·top·ramp로 다리 밑면과 경사 volume을 구성한다.
walkable HD tile은 authored elevation을 지지면으로 사용하고, 높이가 없는 일반 Spatial tile은 tile-height의 유한 벽이다.
일방통행은 local plane과 상대 collider의 지지점을 contact/CCD/controller에 적용하며 검사 ray와 projectile sensor는 양면이다.
투사체는 이전 tile AABB 판정 없이 native sweep의 지형 identity로 impact를 기록한다.
`cast_unified_terrain_ray_all`은 entity용 ray API와 구분해 `UnifiedTerrainSource`·XYZ witness를 반환한다.
이동 발판의 phase는 native 물리 구간이 성공한 뒤 갱신하며 기존 씬 업데이트에서는 중복 진행하지 않는다.
왕복 경로가 틱 중간에 반전하면 그 시점에서 모든 body의 물리 구간을 나누고, 다른 position target도 같은 시간으로 보간한다.
캐릭터 carry·접지는 각 구간의 실제 위치를 사용하고, 한 틱의 translation·운반·충격량·관절 peak·작업량을 합산한다.
query·pause·자동 물리 OFF·거절된 틱은 phase를 진행시키지 않는다. 이동만으로 shape를 다시 만들거나 지지면을 teleport하지 않는다.
발판과 탑승자의 이동은 한 묶음으로 cast한다. 막히면 묶음과 지정 경로 phase가 해당 구간의
시작에 머물고 나머지 월드는 계속 진행한다. 구간이 하나면 틱 시작에 머문다. 왕복 후 같은 발판에 접지하면 운반 변위 합이 0이어도 운반체를
보고한다. 동적·키네마틱 지지체의 운반은 해당 스텝의 실제 자세 변화로 지지점을 이동한다.
키네마틱 장애물은 주변 캡슐에 선형 또는 비선형 cast를 수행하고, 접촉 이후의 남은 이동을 KCC에
전달한다. 끼임으로 밀 수 없으면 장애물이 해당 구간의 시작 자세에 머물고 정지 통계에 기록된다.
막힌 구간의 발판 운반을 취소하며 탑승자는 KCC로 계속 걸을 수 있다. 정지한 속도 키네마틱은 새 속도를
받아야 다시 움직이며 직접 목표를 지정하는 위치 키네마틱에는 새 목표 자세가 필요하다.
캐릭터끼리는 KCC 이동 질의에 참여해 서로 막고 표면을 따라 미끄러진다. 상대 이동 검사로 한 틱 안에
자리가 뒤바뀌는 것을 막는다. 캐릭터가 동적 물체를 밀 때의 반작용은 외부 속도에 기록하고,
들어오는 동적 물체에 대한 피격 밀림은 게임이 충돌 이벤트를 받은 뒤 적용한다.
위의 terrain 표시 보간·chunk quota·시야 flag·typed impact와 Native 지지면 길찾기를 사용한다.
HD actor의 Y-up capsule 이동은 native controller를 사용하며, 전체 solver 궤적·회전 CCD 수용은 아래 미완 범위를 따른다.
Rapier의 선형 속도 상한은 dynamic/soft-frame에 유지하고 지정된 kinematic 선형 운동에는 적용하지 않는다.
이렇게 velocity 명령의 감속 및 position 목표와 보고 속도의 불일치를 방지한다. 각속도 상한은 그대로다.
Velocity-kinematic의 capsule preview/path/carry 예측은 solver와 같은 각속도 상한·COM·damping·pass별 writeback
연산을 사용한다. 저수준 authored motion 조회는 원래 입력 속도를 유지하며 예상된4rad 이동 때문에 실제45도만
회전하는 bar가 닿지 않은 capsule을 밀던 오류를 방지한다. Joint 유무에 따른 실제 pass schedule도 공유한다.
충돌 이벤트로 구간 dt가 다시 줄어드는 경우의 prefix 재평가와 전체 piecewise/angular narrowphase 수용은 별도 미완이다.
접촉/manifold 즉시 조회도 native geometry를 사용한다. 새 Rust XYZ API는 collider/subshape와 양쪽 surface witness를 제공한다.
기존 planar API는 첫 표면 접촉점과 접선 양 끝의 최대 두 점으로 36/56-byte buffer를 유지한다.
이 조회는 고정 바디끼리와 선택한 sensor도 포함하며 마지막 tick의 solver impulse/lifecycle 상태와 구분한다.
깊은 2D polygon 겹침이 잠긴 Z축 접촉으로 처리되지 않도록 authored box/hull과 해당 query의 extrusion을 XY 외접 반경보다 크게 만든다.
평면 solver hook은 같은 XY 접촉의 Z 중복을 합치고 anchor를 평면으로 투영해 extrusion 두께가 중복 구속을 만들지 않도록 한다.
명시적인 3D 도형 자체는 바꾸지 않는다. 원래 Z 법선을 가지는 도형의 XY-only 조회는 진단으로 거부한다.
지형 impact는 위의 typed sidecar를 사용한다. 기존 JSON snapshot은 Native backend state를 빠뜨린 성공으로 처리하지 않는다.
Native 외부 파일은 bounded same-build 세션을 사용한다. Web/Studio 전체 통합·성능 수용은 개별 구현과 구분해 검증한다.

Web의 명시적 `configureUnifiedPhysics`는 같은 native Engine 설정/planar import를 호출한다.
상태 조회는 entity id/generation과 XYZ pose/velocity를 16-word `repr(C)` 행으로 반환하며,
속도 명령은 전체 batch를 검증한 뒤 적용한다. TS는 입력 packing과 현재 Wasm memory의 view 생성만 담당한다.
버전·stride 확인, stale handle/평면 잠금/controller 소유권 검증, memory.grow 이후 view 재취득을 유지한다.
setup-only 공간 body 생성은 7종 native shape와 material/pose를 exact-consumption 숫자 codec으로 전달한다.
중첩·개수·길이·capacity 검증 뒤 native body와 entity를 원자적으로 생성한다.
캐릭터 설정은 저빈도 API, 입력은 4-f32 batch, 마지막 tick 상태는 28-word `repr(C)` buffer다.
입력 전체를 검증한 뒤 교체해 실패한 batch가 기존 이동/대기 점프를 바꾸지 않도록 한다.
body 명령 capability v1은 pose/target의 7-f32 행, force/torque와 linear/angular impulse의 6-f32 행,
clear/sleep/wake의 값 없는 핸들 행을 받는다. Rust의 단일 setter와 같은 validator로 전체 batch를 검사한 뒤
적용한다. target은 다음 tick, teleport와 impulse는 즉시 반영하며 force는 clear까지 유지한다.
반복 핸들의 pose/target은 마지막 값, force/impulse는 합산이다. TS는 per-entity native 호출을 하지 않는다.

캐릭터 외력은 별도 capability v1로 전달한다. World-space XYZ force·one-shot impulse는 3-f32 bulk 행,
clear는 값 없는 handle 행이며 기존 character input/state와 body command ABI를 바꾸지 않는다.
Rust는 최대65,536행의 중복 누적까지 임시 BTreeMap에 검증한 뒤 예약 상태를 한 번에 갱신한다.
Force/impulse/external velocity는 character runtime이 소유하고 native checkpoint에 포함한다.
Cold probe는 이를 소비하지 않으며, 가상 질량 `pushMass`가 0이면 force 추가와 impulse 명령을 거절한다.
질량0 controller의 승인된 기하 이동은 translation·carry·차단 상태에 기록하지만 external/contact 운동량을 만들지 않는다.
이 구분은 저장 상태 검증에도 적용하며, 기하 반응 때문에 질량0의 외부 속도를 허용하도록 validator를 완화하지 않는다.

투사체는 완료한 틱의 대상 시작·끝 자세에서 보간한 운동을 Parry로 질의한다.
같은 틱의 모든 투사체가 같은 보간 기록을 읽는다. 후보 BVH는 작업 예산을 먼저 검사한
뒤 갱신한다. 준비가 실패하면 해당 틱의 보간 조회를 사용할 수 없으며 다음 틱에서 다시 준비한다.
일반 CCD의 위치 제한과 충돌 이벤트는 Rapier 계산에서 직접 수집한다.

물리 snapshot v8은 지지체·입력·힘, 지정 발판의 구간 진행률과 보간 투사체 조회를 저장한다.
Engine 내부 checkpoint 버전은 2이며, 외부 F2DFILE v1의 7개 section과 같은 빌드 복원
정책을 유지한다. 캐릭터 28-word와 observations 71-word의 예약 칸에는 0을 기록한다.

정지한 거의 평평한 바닥의 착지 수치 정체는 실제 첫 접촉 prefix를 유지하고 남은 수평 의도만
같은 shape/query/filter의 clearance lift·KCC·down sweep으로 최대 한 번 이어간다. Compound 바닥의 벽도
계속 검사하며 여유가 부족한 천장을 무시하지 않는다. 기존 slope·step·one-way 정책을 유지한다.
캐릭터가 같은 높이의 유한한 지지면을 따라 걸 때, 임시로 들어 올린 캡슐을 되돌리는 과정에서 수평 이동에
하강이 더해질 수 있다. 캡슐이 같은 평면 위에 머물고 수평 경로 전체에 여유가 있으면 원래 높이를
유지한다. 착지 시 캡슐 전체가 유한한 상자 면 위에 있고 양의 간격이 확인되면 그 면의 법선으로
응답해 바닥과 평행한 충격 속도를 보존한다.
실제 capsule은 들어가지만 선호 skin 여유는 없는 정지 box 통로에서는 양의 query margin을 줄여 다시 검사한다.
Capsule의 실제 반경·shape와 authored skin 설정은 보존한다. 추가 down 배치는 전체 선형 구간의 같은 box
분리 평면이 증명될 때만 사용하고, 수평·restore도 별도 동일 shape 증거로 native touching 수치 정체를 구분한다.
Compound의 모든 leaf와 기존 query filter를 적용하며 움직이는 부모·미지원 geometry는 certificate를 얻지 못한다.
증거는 gap≥-epsilon의 roundoff 정책이며 엄밀한0 침투·전체 native KCC/snap 경로의 독립 증명은 아니다.
실제 native prefix를 보존하고 최종 geometry 승인 후 접촉 기록을 commit한다. 새로운 TOI/충격 행은 만들지 않는다.
Native ground cast가 실패한 좁은 통로의 지지면은 원래 capsule footprint가 finite face 안에 있는 정지 box로만
보완하며 실제 collider handle을 반환한다. 가까운 전방벽의 기존 작은 skin 후퇴는 남아 있다.
Pipeline cast 상한은 stair/snap 없을 때44, 모두 포함하면206이며 추가 geometry/support/continuous 검사는
최대16회 BVH scan, ground fallback은 별도2회다. 각 scan의 collider/compound leaf와 내부 contact 비용은 별도다.
Positive-gap 스윕에서 GJK upper bound가 origin 근처에서 불안정해지면 유효한 이전 simplex witness를 유지하고,
실제 양의 분리·접근이 확인된 support plane을 기존 halfspace clipping에 한 번만 통과시킨다.
원래100회 반복·max TOI 검사를 유지하며 단일 GJK ray cast의 support pair 상한은101이다.
이는 전체 authoritative piecewise trajectory 소비나 회전 장애물/angular CCD의 완료가 아니다.

공간 query capability v1은 최대 256개의 혼합 요청을 12-u32 metadata/13-f32 값 행과 convex shape stream으로 받는다.
ray·point/convex overlap·sweep·nearest는 기존 native query와 scratch를 사용하며 prepare_query는 batch당 한 번 호출한다.
19-word hit는 entity/native body/collider와 원래 tile/surface 식별자를 보존하고, 3-word summary는 offset/count/truncation을 제공한다.
조회는 tick이나 대기 입력/target을 소비하지 않는다. 실패 시 public output 전체를 비우며 TS는 네 입력 alias를
allocation 전에 복사하고 현재 memory에서 출력 view와 summary 범위를 검사한다.
전체 Physics Spec·Studio/snapshot 이전은 미완료이며 native debug geometry/지표의 현재 범위는 아래를 따른다.

Native debug는 PhysicsWorld3d::debug_draw가 renderer와 query 상태를 건드리지 않고 실제7종 shape·13종 관절·cached contact·저장 CCD
witness를 기존6개 bit로 순회한다. Body pose×fixture local pose를 사용해 query refresh 전 teleport도 읽는다. Broadphase는 실제 shape
AABB이며 BVH proxy/node 진단이 아니다. Curve16분할, 고정64개 compound work stack과 line/work 상한16,384/65,536을 사용한다.
Sparse body/collider arena의 빈 raw slot·parent·fixture·mesh/convex/cell 방문과 선 시도도 work에 포함한다. Contact dense graph와 joint BTree는 실제 방문을 센다.
To_mesh 할당·무제한 재귀를 사용하지 않으며 출력 capacity의 최초 확보는 가능하다. Geometry와 retained frame CCD는 한 line/work budget을 공유한다.
CCD 입력은 entity-only 편의 필터 전의 bounded CcdRecord frame 목록이다. 이른 물리 구간과 entity 없는 native terrain도 보존하고 frame4,096개/native 누락은 debug truncated에 반영한다.
Contact는 마지막 cached local manifold를 현재 body/fixture pose로 재투영하며 teleport 뒤 다음 tick까지 남을 수 있다. 새 query/solve를 하지 않는다.
Engine은 component/terrain을 prepare_query로 한 번 cold admit한 뒤 추출한다. Tick/force/impulse를 소비하지 않지만 admission 비용은
debug work 상한 밖이다. Joint component의 일시정지 편집은 별도 admission 경계를 유지한다. 실패는 rejected/truncated이며 legacy 형상으로 내리지 않는다.
공간 frame이면 기존11-float vertex endpoint packet에만 적고 flat buffer는 비운다. Native Spatial XYZ는 그대로, Planar는[x,z,-y]로
보내며 수치적 extrusion을 authored heightSpan으로 바꾸지 않는다. 공간 camera가 없으면 기존8-float XY 또는 Spatial XZ footprint다.
Spatial colliders/contacts 선택은 native category로 매핑하고 legacy prism/이동 hit 중복을 억제한다. Terrain/billboard/floor label은 metadata로
유지한다. Engine-only native 출력은 output marker256만 더하며 configure category나 depth preference를 바꾸지 않는다. Depth-only true는 허용한다.
두 additive Wasm getter의 version1/고정4u32는 line/work/flags/unsupported를 전달하고 SDK는 owned optional debug 객체로 해석한다.
Disabled는0상태이며 같은 Engine checkpoint에 geometry/stats를 포함한다. Profiler는 nested debug/root를 복사·freeze한다.
Runtime physicsDebugLineCount는 flat+spatial 전체 제출 debug 선을 합쳐 기존 budget이3D 비용을 보게 한다. WebGPU는 빈 truncated packet도
truncated 상태를 보존한다. Overlay는 debug가 있을 때 complete/partial/rejected·line/work/projection/unsupported를 표시하고 absent를 complete로 채우지 않는다.
Active native의 직접 debug setter는 guard를 적용하지만 passive applyPhysicsDebugLineOptions는 guard 없이 설정한다. 이전 core의 native setup은
성공할 수 있고 flat nonzero/spatial native flag 출력 소비가 미지원 legacy geometry를 거절한다. Debug-off 실행과 구분한다.
공간/flat shader ABI·의존성·authoring schema·Studio UI·backend 기본 선택은 바꾸지 않는다. 상한은 시간 budget이나 실기기 수용을 대신하지 않는다.

시각 entity 연결 capability v1은 기존 body 생성과 동일한 숫자 descriptor를 사용한다.
Rust는 live generation과 기존 물리 소유권을 확인한 뒤 native body를 같은 entity에 연결한다.
생성/연결이 공유하는 decoder와 native validator로 입력을 검사하며 TS는 형상 alias를 먼저 복사한다.
해제는 삭제 이벤트를 원래 identity로 수집한 뒤 mapping과 body를 제거하고 표시 entity는 유지한다.
속도를 초기화해 legacy 적분이 해제한 객체를 계속 이동시키지 않는다. 소유권이 다른 component body와
projectile은 해제를 거부한다. 이 경로는 Scene/Studio 3D authoring 이전에 필요한 runtime 연결이다.

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

Scene Authoring root의 선택형 `componentTemplates`는 외부 프로젝트 코드를 실행하지 않는 inline JSON catalog다.
SDK cold resolver는 명시적 runtime override를 우선하고 참조별 detached snapshot을 검증/preflight/spawn에 전달한다.
문서·patch/save·handoff는 authored catalog와 raw template reference를 유지하며 instance/prefab 이름으로 catalog를 추측하지 않는다.
Studio selection·bounds·picking은 해석한 components를 읽고 공유 component의 body/visual/collider/sorting 편집은 거절한다.
instance transform과 template-owned `visual.layer`가 없는 render layer만 placement 소유권으로 수정한다.
원본 catalog의 color/normal/material과 collision tile texture 참조는 원래 JSON pointer로 에셋 역할·사용처·handoff 진단에 남긴다.
임의 URL 로딩·tile 편집기·Behavior Recipe 본문 편집 범위는 추가하지 않는다.

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

Scene Authoring의 `physics` world와 shape `components.body`는 배치 좌표·scale·회전을
설정 시 native descriptor로 컴파일한다. body는 같은 시각 entity에 연결되며 frame별 동기화는 Rust가 맡는다.
TS preflight는 disposable native Engine의 실제 world/body/character/joint 생성 검증을 재사용하고 step을 실행하지 않는다.
geometry·planar axis·body/character/joint capacity 실패는 이전 live scene을 보존한다.
관절의 authored instance ID는 preflight와 적용 시 각 월드의 entity handle로 변환한다.
캐릭터 입력·관절 solver·이동은 native가 소유하며 TS는 설정 시 frame 위치의 scale만 합성한다.
Planar 문서는 기존 body·collider-only와 명시적 shape body를 다른 entity에 함께 작성하며 spatial은 기존 2D encoding을 거절한다.
선택 controller JSON은 순수 검증 뒤 기존 cold 설정 API로 설치한다. Collision-only grid도 planar root physics에서 같은 bulk codec을 쓴다.
마지막 admission은 terrain·component·joint를 함께 검증/commit하며 clock과 예약 입력을 소비하지 않는다.
내부 Wasm `unified_physics_scene_authoring_version() === 1`과 `finalize_unified_physics_authoring()`을 사용하며
새 공개 hot-path ABI나 entity별 프레임 호출을 추가하지 않는다. Canonical SDK는 전체 Rust checkpoint로 기존 씬·clock과
SDK physics metadata를 복원하고, Scene apply가 variables·registry·progress context를 복원한다. Spec 교체 실패는 이전 world의
clear 상태도 되돌린다. 외부 자원/custom callback의 부수 효과는 별도 호스트 책임이다.
명시적 spatial native binding의 모델은 Rust에서 현재 XYZ/quaternion과 world-space renderOffset·모델 elevation·local yaw/scale을
합성한다. 위치·회전 모두 현재 pose이며 quaternion 보간은 없고 기존 모델 80바이트 ABI와 다른 표현의 보간은 유지한다.
Studio는 quaternion·각속도를 읽기 전용으로 표시하고 작성 controller JSON과 실제 적용 증거를 구분한다.
Native JSON 진행 저장은 계속 거절하며 같은 Engine 메모리 checkpoint와 외부 파일 import를 구분한다.
