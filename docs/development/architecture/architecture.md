# Ferrum2D 아키텍처

Ferrum2D는 Rust core가 게임 상태와 시뮬레이션을 소유하고, TypeScript platform layer가 브라우저 API를 다루며, renderer가 Rust에서 만든 command buffer를 소비하는 2D 웹 게임 엔진이다.

제품 목표는 비주얼 에디터 중심 엔진이 아니라 **AI agent-first 2D game engine**이다. 사용자는 `@ferrum2d/create-game`으로 프로젝트를 만들고, AI agent는 Game Spec, Physics Spec, asset metadata, agent/skill, 검증 스크립트를 반복적으로 수정/실행해 게임을 개발한다. Visual editor는 기본 authoring surface가 아니며, 필요한 경우에도 별도 승인된 보조 도구로만 다룬다.

현재 단계는 **MVP 개발 완료, 상용제품 기능 개발**이다. 기준 예제는 `examples/minimal-game`, `examples/topdown-shooter`, `examples/breakout`, `examples/platformer`다.

상용화 기준의 지원 수준은 다음처럼 구분한다.

| 수준 | 아키텍처 의미 |
| --- | --- |
| Core runtime | Rust/Wasm frame loop, WebGL2 renderer, input/audio/asset loading, Physics Spec/API, snapshot/replay처럼 1.0 제품 계약 후보인 표면 |
| Authoring primitive | Scene Composition, Behavior Recipe, projectile/weapon authoring, FSM, effect registry처럼 장르 adapter가 낮은 빈도로 조합하는 데이터 계약 |
| Starter scene/template | Shooter/Breakout/Platformer built-in scene과 create-game template처럼 검증된 시작점. 장르 전체를 범용으로 자동 제작하는 engine mode는 아님 |
| Optional/lab/helper | WebGPU, WebGPU fade-only post-process, HD-2D helper, PixelMaskTerrain, level streaming, texture atlas JSON helper처럼 opt-in 또는 capability-dependent 표면 |
| Compatibility/quality infrastructure | deprecated shim, smoke/report/runtime budget/package QA/Pages build처럼 제품 기능과 분리해 관리하는 보조 표면 |

Runtime budget은 quality infrastructure 표면이며 `RuntimeProfiler`가 frame/debug metric을 bounded sample로 모은 뒤 browser smoke가 profile별 상한을 평가한다. Physics 성능 gate는 fixed step, solid/tile candidate, CCD check, physics debug line, collision pair처럼 Rust/Wasm frame에서 실제 기록된 구조적 metric만 사용한다.

Spatial 조명은 Rust가 검증·저장하는 environment v1(80)/v2(112)/v3(128)/v4(512) numeric buffer를
GLSL/WGSL이 소비한다. v3는 선택형 반구광과 point/sun receiver normal bias를 추가하며 기존 render
command/vertex/model ABI와 레거시 buffer는 유지한다. shading normal은 반구광에, geometric normal은
그림자 조회 보정에 사용한다. 물리·caster geometry·shadow depth cache identity는 변경하지 않는다.
WebGPU는 기존 1,024-byte uniform stride 안의 padding을 사용하며 반구광 때문에 GPU texture/pass를 늘리지 않는다.

공식 Placement Viewer의 카메라 맞춤/가이드·이동 축/yaw 조작·GLB 삼각형 선택은 TS의 cold authoring 경로다.
`raycastSpatialModel`은 전달한 불변 CPU 모델의 삼각형만 검사하며 Rust collider/시뮬레이션과 별개다.
포인터 선택 시 cold `dataSceneSpatialModelDrawSnapshot`으로 마지막 native 렌더의 LOD·pose·가시성을 읽는다.
native binding은 마지막 draw의 index만 보관하며 render command ABI와 frame별 entity 왕복 호출은 추가하지 않는다.
선택 광선은 표시 frame의 projection을 역투영하므로 다음 frame을 기다리는 UI camera와 혼합하지 않는다.
모델/텍스처 로딩 controller는 취소 신호와 실행 identity로 오래된 결과를 차단하고 재시도는 원래 열기 caller를 유지한다.
중단할 수 없는 decode가 남아도 취소/교체 시 caller는 즉시 reject하고 늦은 성공·실패는 결과를 덮어쓰지 않는다.
선택 physics 진단은 최대 32 collider를 4 Hz로 읽고, 렌더/자원 통계는 보이는 패널에서만 2 Hz로 읽는다.
게임 상태를 TS로 복제하거나 frame마다 entity별 Wasm 호출을 추가하지 않는다. GPU 시간의 발행 frame과 할당 추정/미측정을 구분한다.

공식 Placement Viewer의 편집용 탐색 카메라는 문서/이력과 분리한 탭별 UI 상태다. 저장되는 게임 카메라는
`spatial.camera`이며 spatial patch v5의 씬 수준 `setCamera`로 기존 diff/merge/Undo/저장 경로를 따른다.
`placementGameCamera.ts`는 설정 UI·씬 구도 작성용 수학·native presentation의 화면 범위 표시를 담당하고,
`placementSpatialWorkspace.ts`가 변경 transaction·native 적용/취소와 모드 전환을 소유한다.
게임 카메라 확인은 실제 pixelArt/viewport를 사용하는 일시정지 미리보기이며 runtime 진행 상태는 Rust가 소유한다.
Rust/Wasm camera ABI·렌더 명령 형식은 변경하지 않는다.

공간 환경 작성은 spatial patch v6의 씬 수준 `setEnvironment`로 기존 이력/병합/저장을 사용한다.
`lighting.enabled: false`는 작성 설정을 보존하며 TS 환경 컴파일러가 기존 native buffer의 조명 플래그를 끈다.
native buffer에는 비활성 광원 값이 전달되지 않으므로 runtime 환경 readback은 비활성 설정 원본의 저장소가 아니다.
작성 JSON을 광원 설정의 기준으로 유지하며 Rust 환경 ABI와 렌더러 pass 계약은 변경하지 않는다.
flat 2D는 선택 `SceneAuthoringDocumentSpec.lighting`과 placement patch v4의 전체 lighting envelope를 사용한다.
작성 resolver는 world 광원과 OFF 상태의 설정을 검증·보존한다. 뷰어 host가 기존 `DataSceneView.lighting`
투영과 native `setDataSceneSun`을 연결하며, 시뮬레이션 상태와 renderer 소유권은 변경하지 않는다.

Physics debug line 생성은 opt-in quality/debug path다. Runtime `Engine`은 debug 전용 collision scratch를 보관해 broadphase proxy와 contact collider pair scratch를 frame마다 재사용하며, public debug line buffer ABI와 renderer 경로는 그대로 유지한다.

공식 Assets의 Aseprite import/reimport는 `placementAsepriteAssets.ts`가 검증·원본/hash·immutable revision·component patch를,
`placementAsepriteTool.ts`가 파일 선택·preview·명시적 등록/적용과 문서 수명을 소유한다. 기존 importer를 authoring subpath에
재노출하며 새 runtime frame schema를 만들지 않는다. 이전 GPU revision을 유지해 Undo와 실패 복원에 사용하고, session-only
참조의 scene Save는 거절한다. `placementAsepriteProject.ts`는 desktop project host와 원본 재검증·bootstrap 복원을 소유한다.
native `placement_document/aseprite_assets.rs`는 승인된 프로젝트의 독점 파일 생성·catalog/manifest 비교 후 교체·protocol 등록을 맡는다.
Save Project는 에셋/catalog를 먼저 확정한 뒤 기존 scene Save를 실행한다. 이미 확정한 에셋과 별도로 scene 충돌을 판정한다.
`placementAsepriteNormals.ts`는 별도 normal texture 수명·frame별 Worker 생성·합성 report와 normal export/save host를 소유한다.
color texture는 기존 Aseprite store가 계속 소유한다. `placementAsepriteNormalPng.ts`는 bounded RGBA8 PNG만 처리해
Canvas premultiplication 없이 투명 RGB까지 그대로 합성한다. native writer와 engine ABI를 변경하지 않는다.
명시적 Normals action만 combined component/spatial patch를 한 transaction으로 적용하고 기존 Normal tool의 수치 설정을 공유한다.
기본 Tauri project host의 normal writer는 generated PNG pair와 provenance를 별도 catalog에 저장한다. browser-only는 optional host/export 설치 전에 scene 저장을 차단한다.
Tauri command adapter는 기존 placement_document 모듈에 유지하며, headless Cargo feature는 같은 저장/프로토콜 로직을 GUI 없이 검증한다.
default feature는 계속 desktop이다. app의 `asepriteImports` handoff 확장은
engine handoff/scene schema와 구분한다. [사용 계약](../../engine/data-scene-authoring.md#aseprite-assets-가져오기재import)을 따른다.

native `asset_files.rs`는 Aseprite/normal catalog의 bounded read·독점 파일 생성·소유 파일 rollback과 publish 직전 비교를 공유한다.
`normal_assets.rs`는 content-addressed PNG/ordered metadata와 normal catalog/manifest를 검증·저장·protocol에 등록한다.
`placementNormalProject.ts`는 기본 project host, durable bytes/provenance 재검증과 복원 texture 수명을 맡는다.
씬을 적용하기 전에 정상 PNG를 올리고 Aseprite source color와 hash/색 공간이 같으면 중복 업로드하지 않는다.
현재 scene/fragment에 맞는 binding evidence는 캐시하며 문서 변경 시 재구성한다. scene/runtime animation 상태는 기존 Rust가 소유한다.
generated pair의 기존 format과 public engine API·Wasm ABI를 유지하며 native GUI IPC는 별도 실행 환경에서 검증한다.

`placementSpriteRevisions.ts`는 Aseprite와 tile import가 공유하는 bounded immutable PNG revision store다.
동일 이름의 upload를 직렬화하며 취소/부분 upload 실패/문서 닫기 후 늦게 완료된 texture도 소유권 안에서 회수한다.
`placementTileDependencies.ts`는 명시적으로 고른 외부 TSJ를 상대 source의 유일한 basename과 연결한다. 자동 경로 읽기 없이 map/TSJ 합계 1 MiB를 제한하고 원본과 변환 입력을 분리한다.
`placementTileSelection.ts`는 bounded 원본 metadata에서 선택 목록과 명시적 단일 PNG projection을 만든다. 원본 bytes와 선택 범위 evidence는 별도로 보존한다.
`placementTileAssets.ts`는 기존 public starter-scenes importer로 선택 tileset을 검증하고 frame provider/placement patch/export를 만든다.
`placementTileTool.ts`는 문서별 UI/취소/자원 수명을 소유한다. map/grid·LDtk entity는 report/export 데이터이며 TS simulation state로 설치하지 않는다.
미설치 참조의 Save를 막고 app handoff에 `tileImports` 근거를 연결한다.
`placementTileProject.ts`는 Open Project 기본 문서의 원본을 preload하고 source identity/hash를 재검증한다.
native `tile_assets.rs`는 원본 식별 정보와 선택형 tileset key·TSJ dependency source/name/hash만 저장하며 변환 frame/map은 frontend public importer가 다시 계산한다.
Aseprite와 `sprite_assets.rs`의 bounded immutable 저장·protocol 등록을 공유한다. Tile 계약만 최대 8개 TSJ 원본을 허용하고 source/hash를 revision ID에 포함한다. TSJ도 exclusive create/충돌 보존/rollback과 hash가 지정된 protocol URL을 사용하며 Aseprite는 dependency를 허용하지 않는다. 저장 검증 후 기존 scene CAS를 사용한다.
전체 map 적용은 별도 후속이다.

`placementAsepriteAnimation.ts`는 immutable 원본 JSON에서 frameTags/duration을 변환하는 app 전용 모듈이다.
방향별 frame 순서·정수 GCD 반복 UV로 기존 `visual.animationSet`을 만들며 native frame/FPS 한도 초과를 거절한다.
정규화된 기존 UV/FPS로 원본 태그를 유일하게 식별한 뒤 numeric clip ID·initialClip·loop를 보존한다.
같은 revision의 성공/실패 진단을 WeakMap에 보관해 UI 상태 변경마다 원본을 다시 파싱하지 않는다.
명시적 action은 일반 component patch 한 건으로 적용하며 source JSON/scene 저장 계약과 Rust/native ABI를 유지한다.
export/handoff의 animation evidence는 현재 scene/원본에서 다시 계산하므로 Undo/재열기 후 stale 매핑을 쓰지 않는다.
일반 animation action은 normal binding이 연결된 대상을 거절한다. 명시적 paired action은 같은 migration을 재사용해
component와 billboard normal 참조를 combined patch 한 건으로 적용한다. legacy animation은 계속 거절한다.
`asepriteNormalLayout`은 전체 clip의 반복 UV를 dedupe하고 기존 normal binding의 32 unique UV 한도를 생성 전에 검사한다.
`placementAsepriteNormals.ts`는 instance animationSet을 포함한 evidence를 layout/정책별로 유지해 Undo에 대응한다.
`placementNormalProject.ts`는 검증한 rect report와 현재 scene animationSet으로 같은 binding을 재구성한다.
생성 atlas bundle은 기존 전체 atlas provenance를 유지하며 renderer/animation hot path와 public contract는 바꾸지 않는다.

선택형 sprite normal 생성은 `scripts/tools/install-sprite-normals.mjs`와 `generate-sprite-normals.mjs`가 맡는
asset 준비 작업이다. upstream commit/Cargo.lock과 설치 binary hash를 확인하며 core/npm runtime에는 의존성을 추가하지 않는다.
source·MIT 고지·binary는 ignored `artifacts/tools/` cache에 둔다. 입력 스냅샷·임시 출력에서 처리하고
완료 report를 마지막에 확정한다. report는 generator/config/input/output provenance를 제공한다.
기존 spatial normal atlas 검증을 재사용하며 render ABI·게임 상태는 바꾸지 않는다.
선택형 `animation` 변환은 `sprite-normal-animation.mjs`에서 full uniform frame을 같은 비회전 layout으로
재패킹하고 기존 `visual.animationSet`을 생성한다. 유리수 delay GCD의 반복 UV로 고정 FPS·32 frame 한도를 지키며
표현 불가능한 타이밍은 거절한다. source/native f32 FPS의 시간 차이를 descriptor에 기록한다.
`spriteNormalBinding.ts`는 생성 report/descriptor와 host가 측정한 metadata에서 stable project 이름·provenance를 가진
binding JSON과 combined component/spatial patch를 만든다. 파일/GPU 작업이나 게임 상태를 소유하지 않는다.
spatial billboard의 선택형 normalTexture 이름은 apply 전 cold path에서 registry ID로 해석하며 저장 문서에는 이름을 유지한다.
기존 normalTextureId와 native material 배열 ABI는 유지한다. 이름 누락은 destructive activation 전에 거절한다.
spatial patch v4는 normal 참조 교체/해제를 지원하며 viewer 이력·sparse diff와 handoff evidence도 같은 계약을 사용한다.
[생성 CLI 계약](../../engine/data-scene-spatial.md#선택형-노멀맵-생성-cli)을 따른다.

브라우저의 선택형 생성 경로는 `spriteNormalWorker.ts` client와 독립 module Worker에서 처리한다.
`build-sprite-normals-wasm.mjs`는 고정 upstream의 별도 generator Wasm과 설정 adapter·MIT·SHA-256 manifest를 만든다.
generator binary는 기본 build/runtime package에 포함하지 않으며 host가 제공한 manifest hash와 각 bytes를 검증해 lazy load한다.
입력 복사/transfer, owned 출력의 finally free, 최대 256 MiB linear memory와 bounded cache/time을 asset 작업에만 적용한다.
동기 Rust 연산의 취소·timeout은 Worker 종료로 처리하고 client의 request id/Worker identity가 오래된 응답을 차단한다.
브라우저 adapter는 기존 frame grid·유리수 timing과 binding을 재사용한다. 시뮬레이션·렌더링은 기존 엔진에 남으며
게임 루프 Worker 이전·엔진 Wasm ABI 변경은 없다.
공식 app의 `placementNormalTool.ts`는 문서별 source/settings/result와 비동기 작업 수명만 소유한다.
`placementNormalAssets.ts`는 실제 bytes 측정·bounded immutable pair·명시적 upload/export·host 저장을,
`placementNormalPreview.ts`는 독립 WebGL2 asset 비교 자원을 관리한다. 게임 상태는 기존 runtime에 남는다.
Apply의 component/normal 참조 교체는 native 중간 적용을 보류하고 최종 combined draft를 한 번 검증한 뒤
한 Undo transaction으로 commit한다. 실패하면 draft/native preview를 복원한다.
정적 host는 JSON bundle export를 사용하며 파일 저장 adapter는 기존 권한 경계 밖으로 자동 확장하지 않는다.
저장 완료는 host의 catalog 등록과 반환 URL의 실제 bytes 검증 뒤 인정하고, 미저장 참조의 scene-only Save는 거절한다.

## 프로젝트 씬 탐색과 실행

공식 앱과 native fallback의 기본 문서는 2D 정원 `placement.garden.scene-authoring.json`이다.
단순 기본 2D와 HD-2D 지형/발판 데이터는 `tests/fixtures/`의 회귀 입력으로만 유지하며 public 자산/예제 메뉴에는 포함하지 않는다.
공개 씬은 정원과 마을 2개이며 기존 `?scene=hd2d` 주소는 마을을 연다.
기존 consumer 프로젝트의 `public/placement.scene-authoring.json` 파일명 지원은 유지한다.

공식 authoring app의 프로젝트 씬 탐색기는 `placementSceneCatalog.ts`의 발견 metadata와
`placementSceneExplorer.ts`의 UI를 분리한다. 기존 문서 workspace가 실제 JSON 검증·문서별 초안/이력·플레이 모드를 소유한다.
`server/sceneCatalog.mjs`는 고정 `public/` 루트에서 개발 서버 목록을 제공하고 정적 빌드의 `placement-scenes.json`을 생성한다.
브라우저 폴더 입력은 사용자가 선택한 읽기 전용 File 사본만 다루며 임의 host 경로·쓰기 권한을 추론하지 않는다.
desktop `scene_catalog.rs`의 읽기 전용 command는 명시적 Open Project 권한을 요구하고 bounded traversal에서 symlink를 건너뛴다.
목록 조회와 개별 문서 저장 allowlist는 분리한다. host open 응답의 canonical 경로가 탭 identity이며,
새 프로젝트 씬은 같은 프로젝트의 최신 자산 문맥을 사용한다. 실행은 기존 Scene Authoring runtime 경로를 재사용하고
사용자 게임 코드 로더나 Rust/Wasm ABI를 추가하지 않는다.

`placementAssetScope.ts`는 문서별 세션 에셋과 host 검증 후 프로젝트에 저장된 에셋의 가용 범위를 구분한다.
같은 프로젝트로 열린 문서만 영속 에셋을 공유하며, 원본 문서 닫기는 세션 에셋만 해제한다.
공유 sprite/normal 자원은 기존 bounded store에서 보관하다 workspace 종료 시 해제한다.
노멀 catalog의 복원·export·handoff도 같은 프로젝트 문맥을 요구한다. 추가 씬에 원본 catalog 쓰기 권한을 자동 부여하지 않는다.
native 저장은 직렬화된 최종 UTF-8 크기를 read limit와 대조한 뒤 임시 파일 교체를 시작한다.
웹/native 씬 탐색의 개별 경로 I/O 실패는 최대 32개 진단으로 반환하며, 명시적 root 접근 실패와 구분한다.

## 버전 확인과 업데이트 경계

`placementReleaseVersions.ts`는 공개 beta 조회·숫자형 semver 비교를, `placementUpdates.ts`는 수동 확인 dialog와
미저장/실행/편집 중 설치 차단을 맡는다. 프레임 루프나 Wasm ABI에 네트워크/업데이트 호출을 추가하지 않는다.
native `placement_document::updates`는 명시적 Open Project registry 권한으로만 프로젝트 갱신을 허용한다.
앱에 내장한 `create-game/bin/update-game.mjs`와 `update-integrity.mjs`가 Node에서 npm/pnpm을 실행하며
원본/실패 상태 백업, 다운로드 SHA-256·설치 파일 대조, 실패 복원을 관리한다. scene·사용자 게임 코드는 실행하지 않는다.
기존 Ferrum dependency만 동일한 exact release URL로 갱신하며 workspace/file과 엔진 저장소는 source control에 남긴다.
잠금은 updater 간 동시 실행만 직렬화한다. 외부 writer와 완전한 filesystem transaction을 보장하지 않는다.

앱 갱신은 `tauri-plugin-updater` 2.14.1의 다운로드·공개키 서명 검증·OS 설치 경로를 재사용한다.
릴리스 안내는 `tauri-plugin-opener` 2.7.0을 host command로 호출하며 정확한 GitHub beta 안내 URL만 허용한다.
고정 공식 저장소/정확한 beta/OS metadata로 조회하며, 확인된 Update와 일회용 token을 host가 보관한다.
설치는 host busy guard로 직렬화하고 완료 후에만 재시작한다. 프로젝트 패키지 버전과 앱 내장 엔진 버전은 별개다.
공개키 없는 앱, Linux non-AppImage, 웹에서는 앱 자동 교체를 제공하지 않는다.
서명 artifact 준비는 기존 SDK 네 tgz 계약에 OS별 updater metadata와 signature를 추가하며 배포 공개 자체는 수행하지 않는다.

## 게임 프로젝트 설치 경계

consumer의 기능 탐색은 `@ferrum2d/agents`가 설치하는 `.agents/harness/ferrum-feature-guide.md`에서
시작한다. root 지침과 공통 harness가 이 안내서로 연결하고, 실제 설치된 runtime의 public 타입과
같은 릴리즈의 reference로 지원 여부를 확인한다. 안내서는 runtime 지원 여부를 자동 판정하는 API가
아니다. 내용과 배포 범위는 [AI 기능 안내](../../engine/ai-feature-guide.md)를 따른다.

GitHub Releases에는 런타임, authoring viewer, create-game, agents를 개별 npm tarball로 제공한다. `scripts/package/prepare-github-release.mjs`는 기존 package allowlist의 빌드 산출물만 임시 staging으로 복사하고 동일한 beta 버전으로 포장한다. 저장소 package version과 `private: true`는 바꾸지 않는다. 생성기 tarball의 `ferrumGithubRelease` metadata가 같은 릴리스의 dependency URL과 명시적 AI 지침 설치 명령을 결정한다. 새 프로젝트 `.npmrc`는 npm 12에서 직접 URL 의존성만 허용하도록 `allow-remote=root`를 기록하며 기존 설정은 보존한다.

이 경로는 게임 시뮬레이션, Rust/Wasm ABI, public runtime export를 변경하지 않는다. 게임 개발자는 Node/npm만 준비하고 엔진의 JS/Wasm은 패키지에서 받는다. 버전·파일·SHA-256은 `release-manifest.json`과 `SHA256SUMS`에 기록한다. 준비 명령과 수동 workflow는 로컬/Actions artifact만 만들며 GitHub Release 공개는 별도 실행이다. 상세 계약은 [GitHub Release 배포 절차](../operations/github-release.md)를 따른다.

## 기준 소스

엔진을 수정하며 외부 게임에서 확인하는 경로는 `pnpm engine:local --project <경로>`다.
runtime package allowlist의 JS/Wasm만 고유 버전의 staging tarball로 포장해 npm 게임의
`file:vendor/...tgz`에 설치한다. Windows 대상은 Windows npm을 사용하며 게임 소스나
runtime API는 변경하지 않는다. 백업·검증·실패 복원은
[로컬 엔진 설치](../operations/local-engine-install.md)를 따른다.

| 영역 | 코드 기준 |
| --- | --- |
| Rust crate export | `crates/ferrum-core/src/lib.rs` |
| Engine/Wasm API | `crates/ferrum-core/src/engine.rs`, `crates/ferrum-core/src/engine/*.rs` |
| World/component/physics | `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/*.rs`, `components.rs`, `components/*.rs`, `collision.rs`, `collision/*.rs`, `physics.rs`, `physics/*.rs`, `tilemap.rs`, `tilemap/*.rs` |
| Scene runtime | `crates/ferrum-core/src/shooter_scene.rs`, `crates/ferrum-core/src/shooter_scene/*.rs`, `breakout_scene.rs`, `breakout_scene/*.rs`, `platformer_scene.rs` |
| Render/audio/event/ABI layout | `render_command.rs`, `buffer_layout.rs`, `audio_event.rs`, `collision_event.rs`, `gameplay_event.rs`, `packages/ferrum-web/src/wasmBridgeAbi.ts`, `packages/ferrum-web/src/bufferAccessors.ts`, `packages/ferrum-web/src/wasmBridge.ts` |
| Web public entrypoint | `packages/ferrum-web/src/index.ts` |
| Runtime/API wrapper | `packages/ferrum-web/src/createEngine.ts`, `engineTypes.ts`, `engineFramePipeline.ts`, `geometry2D.ts`, `physicsRuntimeControls.ts`, `physicsBodyApi.ts`, `physicsBodyMaterials.ts`, `physicsBodySnapshots.ts`, `physicsJointApi.ts`, `physicsQueryApi.ts`, `physicsWasmInputs.ts`, `physicsAuthoringNumbers.ts`, `physicsHandles.ts`, `physicsAuthoring*.ts`, `cameraPostProcessing.ts`, `cameraPostProcessing/*.ts`, `createFerrumRuntime.ts` |
| Renderer | `packages/ferrum-web/src/createRenderer.ts`, `webgl2Renderer.ts`, `renderer.ts` |
| Game Spec / agent authoring | `packages/ferrum-web/src/gameSpec.ts`, `packages/ferrum-web/src/gameSpec*.ts`, `packages/ferrum-web/src/physicsSpec.ts`, `packages/ferrum-web/src/physicsSpec/*.ts`, `packages/ferrum-web/src/physicsSpecTypes.ts`, `packages/ferrum-web/src/physicsSpecValidation.ts`, `packages/ferrum-web/src/assetPipeline.ts`, `packages/ferrum-web/src/assetPipeline*.ts`, `schemas/shooter-game-spec.schema.json`, `packages/agents/templates/**` |

문서와 코드가 충돌하면 위 코드 기준을 먼저 따른다.

## 책임 경계

### Rust core

Rust core는 플랫폼 독립적인 상태와 계산을 소유한다.

- scene state, score, game over/restart, entity lifecycle
- `World` component 저장소: transform, velocity, sprite, collider, rigid body, joint
- collision/physics/tilemap query, kinematic movement, opt-in rigid body solver
- camera preset, particle/tween system, shooter/breakout/platformer scene logic
- render command, audio event, gameplay event, opt-in collision lifecycle event, physics debug/query buffer 생성

Rust core는 DOM, Canvas, WebGL, Web Audio, `fetch`를 호출하지 않는다.

### Wasm boundary

프레임 hot path는 entity별 JS/Wasm 왕복 호출을 만들지 않는다.

```text
input snapshot -> Engine.set_input(...)
viewport       -> Engine.set_viewport_size(...)
frame update   -> Engine.update(delta_seconds)
telemetry      -> frame_telemetry_ptr()
render         -> visible render command buffer ptr + len
audio          -> audio_event_ptr()/audio_event_len()
gameplay event -> gameplay_event_ptr()/gameplay_event_len()
events/debug   -> opt-in collision/physics buffer ptr + len
```

Game Spec, asset metadata, physics authoring, gameplay authoring 같은 낮은 빈도의 설정은 TypeScript에서 검증한 뒤 숫자형 값이나 bulk buffer 형태로 Rust에 전달한다. Game Spec `content.localization`/`content.dialogue.graphs`/`content.cutscenes`는 runtime adapter가 읽을 수 있는 authoring data로 정규화하고, `createShooterContentRuntimeOptions(...)`가 단일/명시 content id만 `createFerrumRuntime(...)` option fragment로 변환한다. `SceneComposition`/`BehaviorRecipe` 묶음은 `ShooterGameSpec` top-level로 승격하지 않고 `ferrum2d.consumer.scene-authoring` 별도 artifact로 유지하며, `resolveSceneAuthoringDocument(...)`가 format/version, scene composition, behavior recipe, optional binding plan을 검증한다. `classifySceneInstance(...)`는 이 resolved instance에서 `worldObject`/`actor` authoring role만 파생하며, Rust runtime class나 Wasm ABI를 추가하지 않는다. 이 경로는 Rust simulation이나 Wasm ABI를 자동 변경하지 않는다. Behavior recipe의 entity-level tags도 TypeScript가 `ids.tags`로 `0..31` numeric bitmask로 컴파일해 Rust `GameplayTags` component로 설치하며, frame loop에서는 문자열 tag를 해석하지 않는다.

### Runtime 렌더러 확장 경계

`runtimeRenderer.ts`의 `FerrumRuntimeRenderer`는 GPU 클래스의 private 멤버를 포함하지 않는 구조적 포트다.
`createRenderer.ts`는 WebGL2/WebGPU 선택·fallback을 담당하는 조합 지점이고 구체 반환형을 유지한다.
프레임 소비자 `RuntimeFrameRenderer`는 `RuntimeFrameRenderTarget`의 그리기·선택 진단 capability만 받으며,
텍스처 로딩·canvas 크기·자원 소유권과 결합하지 않는다. flat command sink만으로 프레임을 검증할 수 있다.
미지원 공간 geometry/디버그 라인은 frame target이나 GPU timer를 건드리기 전에 거부한다.

공통 `SpatialRendererStats`와 `PhysicsDebugLineCamera`의 canonical 정의는 `renderer.ts`다.
WebGL2/WebGPU 구현이 이 계약에 의존하고 기존 내부 타입 경로는 재export로 호환한다.
공식 authoring host는 자신이 생성한 grid renderer의 `SpatialModelPreparer`를 명시적으로 전달한다.
범용 runtime 포트에 모델 준비나 특정 GPU texture 반환을 암묵적으로 요구하지 않는다.
Rust simulation 및 bulk render command ABI는 유지하고 frame별 entity 왕복 호출을 추가하지 않는다.

### Authoring 문서 세션과 저장

`ScenePlacementViewer`의 draft와 bounded Undo/Redo는 TypeScript의 저빈도 문서 편집 상태다.
`scenePlacementHistory.ts`가 snapshot과 transaction을 관리하며 선택·hover·camera 탐색은 새 이력을 만들지 않는다.
2D 레이어 패널은 기존 numeric render layer와 components patch를 사용한다. 별칭은 source 경로별 로컬 UI 설정이고 레이어 숨김/잠금은 viewer의 history 밖 정책이다. 개별 잠금과 레이어 잠금은 독립적으로 보존하며 저장 rebase에서 합집합을 개별 잠금으로 복사하지 않는다. 실제 게임 순서 변경은 `updateInstanceRenderLayers`의 원자적 transform/components 변경으로 기록한다. 숨김 handle은 변경 시에만 기존 bounded bulk `setDataSceneSpatialPreviewFilter`로 전달하며 이 hook은 flat Data Scene에도 적용한다. Rust가 sprite와 소유 그림자 command를 제외하고 collider/simulation은 유지한다. render command struct/ABI는 바꾸지 않으며 매 entity의 frame별 JS/Wasm 호출도 추가하지 않는다. HD-2D/게임 모드에서는 2D 정책을 중단하고 복귀 시 복원한다.

단독 보기와 활성 목록 레이어는 문서별 presentation 상태이며 저장으로 inspector를 재생성할 때도 보존한다. 새 숫자 레이어·Undo·2D 복귀 시 단독 보기 정책을 다시 계산하고, 단독 표시한 레이어가 사라지면 이전 숨김 집합으로 복원한다. HD-2D 목록 필터는 2D 패널의 활성 레이어를 덮어쓰지 않는다. 일괄 components 변경은 검증된 ref를 재사용해 pick bounds를 한 번 갱신하며, 같은 layer의 depth 피킹은 Rust의 floor/elevation/발 위치 정렬을 따른다.

`placementLayerState.ts`는 DOM 없이 layer별 ID·선택·잠금을 한 번 분류하고 단독 보기 정책을 계산한다. 행별 전체 instance 재검색을 하지 않는다. UI 적용 실패는 정책뿐 아니라 선택·hover도 복원한다. 공개 공간 instance 편집에도 숨김 정책을 적용하고, 평면 피킹 비교는 spawn 값과 native 연산의 f32 반올림 및 signed-zero 순서를 따른다.
선택 host `validateDraft`는 최종 draft 검증과 history 복원 안에서 실행한다. 거절 시 이력 위치를 이동하지 않으며,
실패한 edit의 복구 대상으로 거절된 candidate를 쓰지 않는다. 열린 gesture의 취소도 거절되면 직전 정상 초안과
transaction을 유지한다. callback 중 draft/history 재진입은 차단한다.
공식 app의 `placementDocumentSession.ts`는 pointer gesture와 숫자 input을 작업 단위로 묶고,
Escape 취소·단축키·dirty 상태·미저장 문서 이탈 확인·저장 중 UI 입력 차단을 담당한다.
저장 preflight는 활성 pointer·pointerup 뒤 최종 RAF 반영 대기·별도 spatial gesture 중에는 저장을 시작하지 않는다.
숫자 입력을 확정한 다음 patch를 캡처하여 rebase가 마지막 입력을 버리지 않게 한다.
탭 activation은 성공 여부를 반환한다. 마지막 pointer RAF가 남아 있으면 전환을 보류하며,
활성 탭 닫기는 activation 성공 뒤에만 원래 문서를 제거한다. 새 문서 열기 실패는 후보를 정리한다.
Undo/Redo는 Rust gameplay 진행이나 camera 탐색을 되감지 않고 기존 patch를 다시 노출한다.
공식 app은 최대 8개 문서별 viewer/이력·Inspector·host/asset 문맥을 유지한다.
`placementDocumentTabs.ts`는 실제 문서 탭 UI만 담당하고 활성 문서의 기존 viewer로 입력을 연결한다.
canvas·FerrumRuntime·renderer는 하나를 유지하며 탭 전환 시 해당 기준 문서만 native preview에 재적용한다.
게임 진행 상태를 TypeScript에 복사하거나 비활성 탭마다 runtime을 실행하지 않는다.
`placementPreviewSession.ts`는 마지막 정상 authoring 문서와 registry만 보관한다. native apply는 새 registry에
준비하고 성공 뒤 공개한다. native 설정이 scene 교체 후 거절되어도 정상 authoring 문서를 재적용하여
generational handle을 갱신하며, 이 복구까지 실패하면 registry를 비우고 오류를 전달한다.
`placementWorkspaceLayout.ts`는 dock 크기·접힘·집중 모드를 맡으며 localStorage에는 문서 데이터 없이 프로젝트별 UI 설정만 기록한다.
뷰포트의 확장/복원 버튼은 같은 집중 상태를 공유한다. 8px 경계 손잡이는 기존 pointer/keyboard resize로 연결하고,
크기 표시는 ResizeObserver가 실제 canvas의 CSS 치수를 읽는다. renderer/native camera의 기존 resize 경로를 사용한다.
공식 app의 `placementLocale.ts`와 `placementLocaleMessages.ts`는 한국어·영어 UI 전용 상태와 메시지를 관리한다.
명시적으로 등록한 Text/attribute binding만 WeakMap에 보관하고 언어 전환 시 갱신한다. DOM의 사용자 문자열을 추측해
번역하거나 MutationObserver/프레임별 전체 DOM 순회를 추가하지 않는다. 분리된 문서 Inspector root도 WeakRef로 갱신하여
탭 복귀 때 언어가 섞이지 않게 한다. 중첩 메시지만 번역하고 ID·경로 등 매개변수는 원문으로 삽입한다.
언어 선택은 단일 UI localStorage key에만 저장하며 native 씬·history·runtime을 재생성하지 않는다.
공용 control/chrome helper는 app adapter로 label만 연결하고 public authoring API·Rust/Wasm ABI는 유지한다.
Noto Sans KR의 한글 subset은 같은 origin의 app asset으로 제공하며 OFL과 원본/변환 provenance를 배포한다.
`placementViewportNavigation.ts`는 2D 편집 카메라·탐색 입력·Frame/Fit Scene을 맡는다.
기존 공개 `/core`의 `createDataSceneView`로 renderer zoom·Rust Data Scene camera와 viewer viewport를 함께 갱신한다.
CSS 확대나 overlay만의 이동 경로를 만들지 않는다. 카메라 중심·배율은 탭별 UI 메모리에만 유지하며
scene JSON·patch·history·localStorage에는 쓰지 않는다. 실제 simulation/entity 상태는 계속 Rust가 소유한다.
문서 전환·저장 후 native preview를 재적용하면 해당 탭의 편집 카메라를 다시 연결한다.
pan은 RAF로 합치고 취소·전환 시 예약된 호출을 제거한다. 문서 session은 탐색 gesture를 편집 transaction에서 제외한다.
pan/Space 탐색 입력은 gameplay input에서 중립화하며 객체 gesture 중에는 탐색으로 좌표계를 바꾸지 않는다.
`placementGridGeometry.ts`는 편집 camera frustum과 명시적 작업 높이의 교차 영역에서 원점 정렬 기준선을 최대 512개 생성한다.
6개 homogeneous clip plane과 authoring 좌표 상한 ±1,000,000으로 범위를 제한하므로 수평선에서도 무한 메시를 만들지 않는다.
`placementGrid.ts`는 Grid 표시·공유 snap 간격과 실제 표시 간격을 관리하며 authored 문서와 이력을 변경하지 않는다.
공식 WebGL2 app은 기존 renderer 주입 경로에 private `PlacementGridRenderer`를 사용한다. 2D는 sprite 앞의
기존 bulk debug line pass, HD-2D는 scene depth를 공유하는 11-float spatial debug pass에 제출한다.
공간 선의 RGBA alpha는 WebGL2 fragment/blend 경로에서 혼합하고 blend factor/equation·depth 상태를 복원한다.
HD-2D 편집용 runtime clone은 `environment.pixelArt`만 제외해 전체 canvas 해상도를 사용한다.
Game Preview에서는 원본 픽셀 해상도/letterbox를 적용하며 authoring JSON·초안·이력은 바꾸지 않는다.
native debug는 app 소유 재사용 buffer로 복사해 격자와 합성하며 borrowed Wasm frame은 수정하지 않는다.
기존 Proxy Overlay는 유지하고 depth를 끈 별도 debug packet이 주입되면 격자만 생략한다.
작업 평면은 지형 유무와 독립한 X/Y·기본 elevation 0이며 높이·층은 문서별 UI session 상태다.
선택 표시인 지형 높이 격자는 surface 경계·ramp 높이·floor 가시성을 따른다. 작업 평면과 같은 높이의 flat surface는
중복 생성하지 않고 나머지 collinear 구간은 합쳐 alpha 누적을 막는다. 원근 화면에서는 clip W 거리로 먼 선의 alpha를 낮춘다.
표시 LOD는 실제 snap 간격을 바꾸지 않는다. 공간 격자의 표시 간격은 투영된 두 축의 길이 대신
평행선 사이의 수직 거리로 판정하여 낮은 각도의 밀집 교차 무늬를 줄인다.
palette는 기본 native terrain pick과 명시적 작업 평면 교차 배치를 구분한다. camera pan과 같은 투영 수학을 재사용하고
ghost/click/drop이 같은 support/snap 계산으로 표준 addInstance patch를 만든다. 가상 surface ID나 runtime terrain은 생성하지 않는다.
sprite의 층·높이는 기존 body.heightSpan, visual-only 모델의 높이는 spatial.models.elevation에 기록한다.
body가 collider를 요구하는 기존 계약을 유지하므로 모델에 가짜 collider나 물리 층을 추가하지 않는다.
보행·중력·충돌 판정은 계속 native runtime 소유다.
Game Preview에서는 제출하지 않는다. 실제 추가 draw call은 최대 1개이며 기존 spatial debug와 합쳐지면 추가 호출은 없다.
공급된 renderer의 pagehide/실패 정리는 app이 소유하며 CPU 합성 buffer와 기존 GPU line 자원을 해제한다.
Rust simulation·Wasm ABI·public API·WebGPU renderer는 변경하지 않는다.
`ScenePlacementViewer`는 ordered selection과 transient edit lock을 소유하며 기존 단일 선택은 대표 객체로 유지한다.
batch transform/remove는 전체 사전검증 후 draft를 갱신하고 picking cache/state를 한 번 재생성한다.
잠금은 source ID·추가 초안의 내부 identity를 사용하며 patch/history에 포함하지 않는다. Undo/Redo는 문서 변경과
당시 선택 집합을 복원하고 이미 폐기된 객체의 UI 잠금은 되살리지 않는다. 직접 instance 변경과 canvas picking을 보호하며
외부 writer나 전체 Undo/Revert의 권한 계약은 아니다.
app의 `placementSelection.ts`는 modifier/box 선택·보조 outline·선택 도구와 그룹 XY delta를 맡는다.
`placementTransformGizmo.ts`는 같은 대표 pivot을 사용하는 그룹 회전·균일 scale의 숫자/pointer/keyboard 변경을 맡는다.
`placementSpatialWorkspace.ts`는 실제 spatial runtime preview와 편집 camera·선택 투영·XY/높이 입력을 연결한다.
HD-2D의 Select/Pan·H/V와 Space 임시 이동은 기존 camera gesture 경로를 사용한다. 배치 도구를 선택하면 Select로 복귀한다.
`placementViewportChrome.ts`는 공식 app 전용 stroke icon·도구 그룹·버튼 focus 이동을 제공한다.
`placementControlMenu.ts`는 카메라·화면 구성·조작 안내의 명칭이 있는 disclosure를 제공한다.
열림 상태와 focus, 창 내부 배치만 소유하며 native 입력/실행 상태는 기존 경로를 사용한다.
메뉴의 바깥 클릭·focus·Escape·resize를 처리하고 pagehide에서 document/window listener를 해제한다.
기준 버튼의 ancestor scroll로 위치가 변하면 메뉴를 닫고, 메뉴 본문 스크롤이나 열기 전 큐에 들어간 scroll은 무시한다.
공간 입력의 window capture handler는 열린 메뉴 내부 Escape를 넘겨 메뉴 닫기가 배치·선택 후보 취소보다 먼저 처리되게 한다.
desktop 패널 토글은 화면 구성 메뉴에, compact 패널 토글은 기존 탭 행에 같은 DOM control을 배치한다.
`placementViewportToolbar.ts`는 공통 보기 disclosure와 배치/탐색 안내를 소유한다. native gesture의 UI 상태 이벤트로
Space 임시 이동/복귀와 pressed 상태를 갱신하며 게임 상태나 카메라 좌표를 복제하지 않는다.
격자 표시·공유 간격과 공간 overlay/snap은 보기 disclosure에 연결하고 층 선택은 툴바에 유지한다.
Escape는 disclosure 안에서만 소비하고 바깥 pointer/focus는 focus를 빼앗지 않고 닫는다.
summary의 Enter/Space 활성화는 app에서 처리하여 전역 runtime 입력과 충돌하지 않게 한다.
휠과 버튼은 동일한 orthographic height/perspective distance 제한을 사용하며 객체 gesture 동안 확대를 차단한다.
`placementSpatialCamera.ts`는 target 상대 벡터의 pitch를 계산하고 1~89° 범위로 회전한다.
상하 버튼은 10°씩, Camera 메뉴의 range input은 1°씩 조절한다. 탐색 상태의 target·eye 거리·yaw·orthographic height/perspective FOV와 clip 범위를 유지한다.
직교 편집의 native camera는 별도 `spatialEditorRenderCamera`로 파생한다. 현재 height·pitch·작업 높이에서
화면 상하 끝의 평면 깊이를 구하고 필요할 때 eye를 바라보는 축의 뒤로 옮긴 뒤 far를 늘린다.
직교의 screen X/Y와 배율은 그대로이며 탐색 상태에는 이 offset을 누적하지 않는다. resize와 작업 평면 높이 변경에도 다시 계산한다.
기존 near/far 안의 객체는 보존하고 native 행렬·depth·picking을 함께 갱신한다. 원근과 Game Preview는 이 보정을 적용하지 않는다.
수평/수직 특이점을 피하고 native camera setter가 수락한 뒤에만 UI camera와 각도 readout을 갱신한다.
슬라이더와 버튼은 문서별 기존 camera session을 공유한다. authored camera·작업 평면·patch/history를 변경하지 않고 Reset·Stop·탭 복귀에 연동한다.
탐색 gesture 전환 때 활성 상태를 다시 동기화해 pan 종료·취소 뒤 각도 컨트롤이 비활성 상태로 남지 않게 한다.
탐색 커서·손잡이 상태는 2D/HD-2D별로 분리하고 카메라 조작은 문서 patch·history에 넣지 않는다.
게임 진행은 Rust가 소유하고, 편집 camera와 정지한 authored model bounds/billboard geometry만 TS에 둔다.
Wasm borrowed frame은 다음 프레임까지 보관하지 않는다. 지연 클릭에는 camera/presentation 복사와 terrain revision만 유지한다.
XY drag와 camera pan은 pointerdown 시 표시한 matrix·presentation을 복사하고 시작 높이 평면에서 역투영한다.
경사면을 다시 hit하여 움직임에 되먹임하지 않으며, Height는 authored geometry 위쪽 anchor의 원근 투영을 역산한다.
terrain의 native picker는 선택 identity에 사용한다. 2D 탐색 listener는 HD-2D·Game Preview 입력을 소비하지 않는다.
모델 bounds는 전체 LOD asset union이며 root Sprite의 authored 회전과 attachment body yaw를 구분한다.
attachment-owned 위치·높이는 UI에서 변경하지 않는다. camera 범위와 native 거절은 문서 이력과 분리해 처리한다.
spatial gesture는 해당 모듈만 취소·확정한다. 일반 문서 session의 단축키·history hook·finish는 이를 중복 처리하지 않는다.
native가 취소를 거절하면 정상 초안·열린 transaction·gesture 소유권을 유지하고 모드/탭 전환을 중단한다.
취소 대기 중 pointerup은 확정 대신 취소를 재시도한다.
Model resource는 contentId로 namespace한 runtime key를 사용하며 저장 JSON의 asset ID는 보존한다.
Spatial v3 placement envelope는 spatial v1 갱신/v2 추가/v3 identity·GLB SHA 교체를 지원하고 flat v1/v2 계약을 유지한다.
visual map migration은 composition operation과 쌍으로 검증한다. envelope 없는 outer migration도 보호하며 agent-owned ID는 UI가 바꾸지 않는다.
복제 원본은 metadata 추정 대신 draft snapshot에 explicit identity로 보관하고, 원본 ID는 저장 전까지 예약한다.
`addInstance`의 선택 spatial addition은 composition과 billboard/model 참조를 같은 edit/host 검증 경계에서 만든다.
`placementSpatialPalette.ts`는 asset/frame 선택·미리보기·click/drop과 cold instance 생성을 담당한다.
provider 갱신 시 선택한 sprite의 URL·크기·프레임 snapshot을 비교해 미리보기와 옵션을 갱신하고 이전 pending/drag를 취소한다.
관련 없는 에셋만 바뀐 경우 도구를 유지하며, 선택한 frame ID가 새 목록에도 있으면 보존한다. 변경 없는 provider에서는 같은 snapshot을 재직렬화하지 않는다.
속성 섹션의 모드별 가시성은 번역된 제목 대신 canonical `data-section`으로 결정한다.
기본 support identity는 기존 native terrain picker에서 가져오며 snap 뒤 높이는 해당 authored surface의 경사를 반영한다.
명시적 작업 평면 모드에서는 viewport ray/plane 교차점에 동일 snap을 적용한다. visual-only 모델의 ghost에는 물리 층 대신 Visual Only를 표시한다.
미리보기는 DOM UI에만 있고 native entity나 문서 이력을 만들지 않는다. 모드·탭 전환과 Escape는 pending 배치와 drag token을 정리한다.
Sprite는 지면 pivot과 static heightSpan·기본 AABB로 배치한다. Model은 collider/body 없이 원래 asset/contentId와 지면 높이를 포함한 시각 offset으로 배치한다.
Model의 floor는 배치 support 안내에 사용하며 물리 floor를 생성하지 않는다. behavior binding 없는 definition을 바탕으로 UI 소유 components만 추가한다.
model collider는 자동 추론하지 않는다. cache의 GLB resource와 씬 instance는 분리하며 import 자체는 instance를 생성하지 않는다.
배치 확정 시 현재 문서의 model/LOD asset ID와 contentId를 다시 대조하여, 탭 간 cache의 다른 GLB가 같은 authored asset 경로로 저장되는 것을 거절한다.
`placementDiagnostics.ts`는 source pointer·before/after evidence·Problems와 선택 entity의 opt-in 4Hz native 진단만 담당한다.
진단은 metrics와 함께 접기·크기 조절·스크롤 가능한 하단 Panels의 탭으로 표시한다.
`placementRuntimeSummary.ts`는 이 owned snapshot의 요약 행·변수·event 표시만 담당하며 raw JSON은 접는다.
추가 Wasm 조회나 게임 상태 소유권을 만들지 않는다.
`placementViewportToolbar.ts`는 canvas 밖 고정 행에 camera 도구와 배치 상태·취소 동작을 둔다.
에셋 카드의 pressed 상태는 현재 placement tool에서 파생하며 drag 중 카드 DOM을 교체하지 않는다.
Inspector는 고정 선택 이름·종류와 Properties/Placement 탭으로 속성과 새 객체 배치 도구를 나눈다.
Scene의 검색·종류/layer 필터·기존 fragment 그룹은 UI 상태이며 authored hierarchy·선택·잠금을 변경하지 않는다.
하단 Assets/Problems/Runtime/Agent Changes는 한 패널씩 표시하고, 문서별 asset mount는 활성 문서를 따라 이동한다.
Document는 기본 접힘, GLB import는 하단 Assets에 둔다. 표시 중인 Runtime 탭에서만 bounded native 진단을 조회한다.
Play/Pause/Resume/Stop은 Data Scene 진행을 제어하며 RAF/renderer를 유지한다. Stop은 직전 편집 모드와 초안·이력을 복원한다.
HD-2D 공간 요약은 소유한 authoring state와 기존 picker 결과를 재사용한다. 고정 Review/Export는 기존 diff/Handoff·host save gate로 연결한다.
860px 이하의 패널 서랍은 일시적 UI 상태다. 기존 v1 desktop 크기/접힘 localStorage와 문서/history를 변경하지 않는다.
서랍 높이는 상단 고정 행을 뺀 남은 공간에서 viewport 행 128px을 먼저 확보한 뒤 제한한다.
낮은 창의 도구 행은 가로 스크롤하며, 행 크기도 ResizeObserver로 관찰해 모드·문서 전환의 높이 변화를 반영한다.
임시로 drawable viewport가 0인 host는 native camera 갱신을 건너뛰고 양수 크기의 resize에서 다시 적용한다.
공유 2D 배치 대기는 native mode sync 성공 후에만 정리한다. 실패한 전환은 기존 tool 문맥을 유지한다.
2D asset/frame·prefab·회전·배율 입력 변경은 캡처된 배치 ghost를 취소하여 live 입력과 표시의 불일치를 막는다.
숫자 입력은 blur 전 pointerdown보다 먼저 대기를 취소하며, DOM keydown 없는 native HTML drag Escape도 dragend에서 정리한다.
패널 ID와 aria-controls는 숨겨진 문서 wrapper의 하위 패널을 제외하여 현재 Scene/Inspector에 연결한다.
파일 저장 불가의 `Export Only` 상태와 편집 초안 dirty는 별도로 표시한다.
기본 runtime frame마다 전체 entity를 순회하는 디버그 경계를 추가하지 않는다.
그룹 이동은 대표 객체만 snap하고 상대 간격을 유지한다. 다중 선택에서 개별 component/recipe/layer를
대표 객체에만 적용하지 않도록 Inspector를 제한한다. 공식 app 저장 rebase는 현재 선택/잠금을 새 viewer에 다시 연결한다.
이 상태는 탭 메모리에만 유지하며 기존 handoff의 대표 선택 필드는 보존하고 집합 결과는 기존 patch operation 배열로 전달한다.

웹 개발 host와 Tauri host는 병합 문서와 `expectedDocument`를 받아 현재 파일의 의미상 JSON을 비교한다.
같은 host의 저장을 직렬화하고 기존 파일 권한을 적용한 같은 디렉터리 임시 파일을 sync한 후 재비교·교체한다.
충돌·실패 시 초안과 이력을 유지하고, 성공 시 현재 탭의 기준 문서와 이력만 초기화한다.
문서 전환은 예약된 handoff와 pointer RAF의 revision을 무효화하고 이전 비동기 결과가 새 문서에 반영되지 않게 한다.
페이지 이탈 경고는 비활성 초안도 검사하며 runtime 자원 정리는 취소 가능한 beforeunload 대신 실제 pagehide에서 수행한다.
브라우저가 back-forward cache에 보존한 페이지는 자원을 파괴하지 않는다.
경로 allowlist와 문서 충돌 검사는 서로 다른 책임이다. 독립 외부 writer의 비협조적 동시 쓰기까지
완전한 transaction으로 보호하거나 자동 rebase하지 않는다. 저장 host는 Wasm ABI를 바꾸지 않는다.

### Authoring 에셋·필터·읽기 전용 진단

`placementAssetBrowser.ts`는 공유 검색/썸네일/최근 사용/즐겨찾기를, `placementAssetChanges.ts`는 opt-in 감지와 명시적 재가져오기를 맡는다.
파일 revision은 host cache fingerprint이고 GLB contentId는 실제 SHA-256이다. 저빈도 loader와 단일 문서 transaction으로 교체하며
모델 resource는 Undo를 위해 bounded cache에 보존한다. UI가 importer metadata나 시뮬레이션을 소유하지 않는다.
`placementSpatialProxy.ts`는 명시적 collider/body와 visual offset 보존을 한 건 Undo로 연결한다.
Rust의 preview filter는 draw/picking만 제외하고 terrain/physics를 유지한다. entity+generation과 surface ID 배열을 한 번 전송한다.
다른 층 ghost는 bounded authored outline이며 별도 simulation이나 투명 재질 pass를 만들지 않는다.
`gameplayEntityDiagnostics(handle)`는 Rust에서 FSM/health/timer/최대 16 action cooldown을 한 숫자 packet으로 읽어 owned object로 반환한다.
존재하지 않는/stale handle은 undefined다. Selected Runtime이 열린 동안 최대 4 Hz로만 조회하며
변수 32개·event ring 64개를 제한한다. 프레임 이벤트는 복사하고 borrowed Wasm view를 보관하지 않는다.
선택/문서/모드/native apply epoch가 바뀌면 진단 context를 비운다. 렌더링 hot path의 entity별 왕복은 추가하지 않는다.

### Rust 내부 모듈 구조

#### Engine facade와 frame storage

| 영역 | 코드 기준 |
| --- | --- |
| Engine facade | `crates/ferrum-core/src/engine.rs` |
| 책임별 구현 | `crates/ferrum-core/src/engine/*.rs` |
| Frame buffer와 telemetry | `crates/ferrum-core/src/engine/frame_buffers.rs`, `crates/ferrum-core/src/engine/telemetry.rs` |

`engine.rs`는 Wasm `Engine` facade와 shared state를 유지한다.
현재 분리된 책임별 구현은 `engine/data_scene_spawning.rs`, `engine/gameplay_authoring.rs`, `engine/physics_authoring.rs`, `engine/physics_bridge.rs`, `engine/physics_controls.rs`, `engine/physics_collider_controls.rs`, `engine/physics_joint_controls.rs`, `engine/physics_queries.rs`, `engine/rendering.rs`, `engine/scenes.rs`, `engine/snapshots.rs`, `engine/telemetry.rs`, `engine/frame_buffers.rs`에 둔다.
frame마다 재사용되는 render/audio/event/debug/navigation buffer와 frame telemetry storage는 crate 내부 `EngineFrameBuffers`가 소유하며, public pointer/len Wasm ABI는 기존 getter가 그대로 제공한다.

#### Scene mode와 Data Scene 저장 계약

| 영역 | 코드 기준 |
| --- | --- |
| Scene mode와 runtime slot | `crates/ferrum-core/src/engine/scenes.rs` |
| Data Scene spawn bridge | `crates/ferrum-core/src/engine/data_scene_spawning.rs`, `packages/ferrum-web/src/dataSceneRuntimeTarget.ts` |
| Data Scene declared variables | `crates/ferrum-core/src/gameplay_variables.rs`, `packages/ferrum-web/src/dataSceneVariables.ts` |
| Built-in/physics snapshot bridge | `crates/ferrum-core/src/engine/snapshots.rs` |
| Data Scene JSON snapshot | `packages/ferrum-web/src/gameStateSnapshot.ts` |

`Engine`은 built-in scene 상태를 개별 `scene`/`breakout_scene`/`platformer_scene`/`active_scene` 필드가 아니라 crate 내부 `BuiltInSceneSlots` 단일 필드로 보관하고, built-in scene 활성 상태와 data scene 활성 상태는 `SceneMode`로 분리한다.
data scene mode는 built-in `ActiveScene` enum variant가 아니라 별도 `DataSceneRuntime` storage이며, raw Wasm `use_data_scene()` bridge와 public `FerrumEngine.useDataScene()` facade로 빈 data runtime을 활성화한다.
낮은 빈도 authoring spawn은 package-facing `createDataSceneRuntimeTarget(engine, options?)`가 resolved inline `props.components`를 숫자형 인자로 컴파일하고 raw Wasm `spawn_data_scene_entity(...)`가 이를 `EntityTemplate`/`PrefabEntitySpawnRequest`로 낮추며, 성공 handle은 `data_scene_entity_id()`/`data_scene_entity_generation()`으로 읽는다.
consumer는 generated `pkg/*`, `dist/*`, `src/*` 내부 경로를 직접 import하지 않는다.
data scene save/replay 계약은 built-in Shooter snapshot buffer를 확장하지 않고 `GameStateSnapshot.dataScene`의 optional `DataSceneStateSnapshot` JSON payload에 둔다.
이 payload는 custom JSON과 optional `authoringDocument`를 포함할 수 있고, restore 경로는 authoring document가 있으면 `applyDataSceneAuthoringDocument(...)`로 Data Scene entity/behavior를 낮은 빈도 apply 단계에서 다시 조립한다.
optional authoring `variables`는 TypeScript가 이름을 `1..64` slot으로 compile하고 Rust `World`의 고정 slab이 타입, scope, default, 현재 값을 소유한다.
`DataSceneVariableStore`는 선언된 정수/실수/불리언 이름만 허용하는 낮은 빈도 facade이며 다음 document apply에서 동일 이름·동일 타입의
global 값만 유지하고 scene 값은 default로 초기화한다. gameplay frame은 numeric slot만 사용해 event 기반 set/increment, collision/interaction/timer guard, FSM variable comparison을 Rust 안에서 평가한다. Data Scene snapshot은 새 포맷을 추가하지 않고 기존
`custom["ferrum2d.variables"]`와 `dataScene.custom["ferrum2d.variables"]` reserved payload를 사용하므로
canonical hash 범위도 그대로 재사용한다. Data Scene snapshot opt-in에서만 이 저장소를 캡처하며 restore는
선언·타입을 runtime activation 전에 preflight한다. Built-in Shooter snapshot version `19`는 Rust slab을 exact `f64` bits로 header에 포함한다.

#### Scene dispatch와 gameplay authoring

| 영역 | 코드 기준 |
| --- | --- |
| Built-in/Data Scene dispatch | `crates/ferrum-core/src/engine/scenes.rs` |
| Frame update 통합 | `crates/ferrum-core/src/engine/runtime.rs` |
| Gameplay authoring bridge | `crates/ferrum-core/src/engine/gameplay_authoring.rs` |

`engine/scenes.rs`는 `ActiveScene` dispatch, `BuiltInSceneSlots`, `DataSceneRuntime`, crate 내부 `BuiltInSceneRuntime` 계약을 소유하며, built-in scene의 score/game state/title reset/playing reset/update/camera update/frame telemetry/action-trigger hooks는 공통 reset/update context와 active runtime accessor를 통해 호출한다.
concrete scene 필드는 `BuiltInSceneSlots` 내부 private state로 유지하고, shooter snapshot/authoring처럼 호환 ABI가 필요한 경로만 `shooter()`/`shooter_mut()` accessor로 명시한다.
data scene update는 shooter/breakout/platformer 로직을 실행하지 않고 scene-owned 경로 이동,
`World` cooldown tick, generic world update와 opted-in interaction/pickup/timer/변수 이벤트를 처리한다.
`engine/data_scene_movement.rs`의 `DataSceneMovement`는 primary actor generation handle, 목적지,
waypoint cursor, 미소 거리 누적값과 재사용 A*/AABB sweep scratch를 소유한다. 명령/격자 수정/외부 위치
변경 때만 경로를 계산하고 public navigation query 결과 buffer는 수정하지 않는다. 각 simulation step의
거리 예산을 구간별로 소비하며 world/자동 rigid-body 적분 전에 제어 actor velocity를 0으로 유지하여
중복 이동을 막는다. 수동 입력 취소는 해당 sample의 velocity를 보존한다. TypeScript는 옵션 검증과
낮은 빈도 명령/상태 조회만 제공하며 frame별 위치 제어 callback을 추가하지 않는다.
primary AABB sweep의 가까운 접촉 판정은 offset을 반영한 접촉면·이동 방향을 사용하여 반복 요청 관통을
막고 분리/접선 이동을 허용한다. 경로는 transient state이므로 snapshot schema/ABI는 변경하지 않는다.
Navigation 이동은 내부 설정으로 작은 변위를 보존하며 기존 platformer의 반복 종료 epsilon은 유지한다.
AABB sweep의 축 정지 판정은 정확히 0인 변위에만 적용해 작은 틈의 충돌도 처리한다.
중간 waypoint는 정확히 도달해야 하며 float32 셀 중심이 원래 셀로 매핑되지 않는 경로는 거절한다.
변위를 float32로 바꾼 실제 끝점이 waypoint를 넘으면 한 ULP를 0 방향으로 보정해 sweep 범위를 보존한다.
이 계약은 Rust 내부 구조 정리용이며 기존 snapshot/event/render buffer layout을 바꾸지 않고 frame hot path에 JS/Wasm callback이나 entity별 동적 dispatch를 추가하지 않는다.
scene-level trait object dispatch는 active built-in scene당 frame update/reset/telemetry 호출 1회 단위로 제한한다.
`engine/gameplay_authoring.rs`는 scene load/agent apply 같은 낮은 빈도 경로에서만 호출하는 generation-checked gameplay component setter를 담당하며, frame hot path의 behavior evaluation이나 entity별 JS callback을 담당하지 않는다.

#### World storage와 lifecycle 접근 경계

| 영역 | 코드 기준 |
| --- | --- |
| World facade와 component storage | `crates/ferrum-core/src/world.rs`, `crates/ferrum-core/src/world/component_storage.rs` |
| Entity lifecycle | `crates/ferrum-core/src/world/entity_lifecycle.rs` |
| Checked component access | `crates/ferrum-core/src/world/component_access.rs` |
| Snapshot과 joint storage | `crates/ferrum-core/src/world/snapshot.rs`, `crates/ferrum-core/src/world/joints.rs` |

`World` storage는 `world.rs`에 두고 template, snapshot, entity lifecycle, collider, joint, tests 구현은 `world/*.rs`에 둔다.
entity spawn/despawn 때 component slot push/clear 정책은 crate 내부 `WorldComponentStorage`가 담당해 lifecycle id/generation 관리와 component slot 초기화/정리를 분리한다.
Rigid-body contact impulse cache와 CCD debug hit buffer도 `world` module private storage로 유지하고 solver/debug 경로는 `World` helper와 iterator로만 접근한다.
Height span과 projectile arc slot도 `world` module private storage로 유지하며, 외부 runtime/render/collision 경로는 `World`의 entity/index-checked helper를 통해 파생 height span 동기화 정책에 접근한다.
Gameplay health, damage, score reward, lifetime, projectile policy, projectile legacy mirror, faction, faction relation table, tag, pickup, interaction, movement pattern, collision reaction, FSM machine, action binding, FSM state-enter action, one-shot timer trigger slot과 player entity handle은 `world` module private storage로 유지하고 외부 runtime/authoring 경로는 entity/index-checked accessor와 replace helper를 통해서만 읽고 복원한다.
`World`의 lifecycle liveness/generation storage는 `world` module private field로 유지하고, `World` 외부 production 경로는 entity liveness/generation vector를 직접 읽지 않고 `entity_capacity()`, `is_alive_index(...)`, `generation_at_index(...)`, `entity_at_index(...)`, `is_current_entity(...)` accessor를 통해 lifecycle storage 정책에 접근한다.

#### Component facade와 gameplay/FSM/collision reaction data

| 영역 | 코드 기준 |
| --- | --- |
| Component facade | `crates/ferrum-core/src/components.rs`, `crates/ferrum-core/src/components/*.rs` |
| Gameplay component data | `crates/ferrum-core/src/components/gameplay.rs` |
| Gameplay 실행 로직 | `crates/ferrum-core/src/gameplay.rs`, `crates/ferrum-core/src/gameplay/**` |
| Joint public type | `crates/ferrum-core/src/components/joints.rs`, `crates/ferrum-core/src/components/joints/*.rs` |

Component public surface는 `components.rs` facade와 `components/{gameplay,motion,sprite,rigid_body,joints,collision_masks,limits,colliders,tests}.rs`로 나눈다.
`components/gameplay.rs`는 crate-private `MovementPattern`, `ActionBindingSet`/`Cooldown`, `CollisionReactionSet`, `GameplayTimerTrigger` 같은 데이터 layout을 둔다.
Shooter runtime은 현재 `ActionBindingSet`의 cooldown remaining state를 직접 tick/trigger해 primary projectile action을 실행하고, built-in Shooter snapshot은 player primary projectile action binding과 cooldown remaining state를 함께 보존한다.
공통 timer trigger는 entity별 one-shot component로 World snapshot/lifecycle에 포함되며, elapsed event를 기존 FSM event pass가 소비한다.
더 넓은 공통 action system으로 승격할 때는 authoring config와 runtime cache 분리를 다시 확정한다.
joint public type은 `components/joints/*.rs` 기능군 모듈 뒤의 `components/joints.rs` facade로 다시 모은다.
기존 `crate::components::*`, crate 내부 `crate::components::joints::*`, crate root re-export 경로를 유지한다.

#### Built-in scene vertical slice

| 영역 | 코드 기준 |
| --- | --- |
| Top-down Shooter | `crates/ferrum-core/src/shooter_scene.rs`, `crates/ferrum-core/src/shooter_scene/*.rs` |
| Breakout | `crates/ferrum-core/src/breakout_scene.rs`, `crates/ferrum-core/src/breakout_scene/*.rs` |

Top-down Shooter scene은 `shooter_scene.rs` facade/storage와 `shooter_scene/{config,runtime,snapshot,tests}.rs` vertical slice로 나눈다.
Breakout scene은 `breakout_scene.rs` facade/storage와 `breakout_scene/{config,effects,level,runtime,tests}.rs`로 나누며 기존 `crate::breakout_scene::{BreakoutScene, BreakoutParticleBurstSink, breakout_brick_hit_particle_preset}` 경로를 유지한다.

#### Physics solver와 joint schedule

| 영역 | 코드 기준 |
| --- | --- |
| Contact solver | `crates/ferrum-core/src/physics/solver.rs`, `crates/ferrum-core/src/physics/solver/*.rs` |
| Rigid-body helper | `crates/ferrum-core/src/physics/body_impulses.rs`, `crates/ferrum-core/src/physics/rigid_body_properties.rs` |
| Island schedule | `crates/ferrum-core/src/physics/islands.rs`, `crates/ferrum-core/src/physics/islands/*.rs` |
| Joint solver | `crates/ferrum-core/src/physics/joints.rs`, `crates/ferrum-core/src/physics/joints/*.rs` |

`physics/solver.rs`는 rigid-body solver facade를 유지하고 contact constraint 생성/cache, split impulse state, material/restitution/surface velocity/baumgarte helper는 `physics/solver/*.rs`에 둔다.
`physics/body_impulses.rs`는 joint/solver가 공유하는 rigid-body contact point velocity와 pair linear impulse 적용 helper를 담당한다.
`physics/rigid_body_properties.rs`는 rigid-body enabled/mass/inertia/gravity-scale/damping 조회 helper를 담당한다.
`physics/islands.rs`는 rigid-body island graph/schedule과 union helper를 담당하고, `physics/islands/joint_buckets.rs`는 solver iteration 안의 전체 joint store 반복 순회를 피하는 joint index bucket을 담당한다.
`physics/joints.rs`는 joint solver facade/re-export를 유지하고, joint별 solver는 `physics/joints/*.rs`, shared context/limit/impulse helper는 `physics/joints/{contexts,limits,impulses}.rs`에 둔다.
Distance/Rope/Spring local anchor는 TypeScript authoring/facade가 낮은 빈도 숫자 인자로 Wasm에 전달하고, Rust solver가 anchor point velocity와 회전 관성 effective mass를 계산한다.
이 경로는 frame hot path의 JS/Wasm 호출 수를 늘리지 않는다.

#### Tilemap facade와 내부 기능

| 영역 | 코드 기준 |
| --- | --- |
| Tilemap facade | `crates/ferrum-core/src/tilemap.rs` |
| Collision/navigation/rendering | `crates/ferrum-core/src/tilemap/*.rs` |

`tilemap.rs`는 public type/storage와 authoring facade를 유지하고, collision cache, collision candidate traversal, collision/query facade, navigation, layer helper, rendering, tests는 `tilemap/*.rs`에 둔다.
이 분리는 Rust module 구조만 바꾸며 기존 render/audio/debug buffer layout을 유지한다.

#### Joint lifecycle과 handle 안정성

| 영역 | 코드 기준 |
| --- | --- |
| Entity despawn cascade | `crates/ferrum-core/src/world/entity_lifecycle.rs`, `crates/ferrum-core/src/world/joints.rs` |
| Checked joint mutation과 storage | `crates/ferrum-core/src/world/joints.rs` |
| Snapshot runtime state rebuild | `crates/ferrum-core/src/world/snapshot.rs`, `crates/ferrum-core/src/world/joints.rs` |

유효한 entity를 `World::despawn(...)`으로 제거하면 lifecycle generation을 갱신하기 전에 그 entity를 어느 endpoint로든 참조하는 distance, rope, spring, pulley, revolute, prismatic, weld, gear joint를 함께 제거한다. public `despawnPhysicsEntity(...)`도 이 경로를 사용한다. cascade로 제거된 joint는 generation 증가와 free-list 반환을 함께 수행하므로 기존 handle이 즉시 무효화되며, 유효하지 않은 entity handle은 World와 joint 상태를 변경하지 않는다. World의 public Rust joint mutation은 양 endpoint가 현재 alive/generation과 일치해야 한다. 복구 가능한 mutation은 `try_add_*_joint(...) -> Option<JointId>`와 `try_set_*_joint(...) -> bool`을 사용해 invalid endpoint를 저장소 변경 없이 거부한다. 기존 `add_*_joint(...)` convenience API는 이 precondition 위반을 programming error로 취급해 저장 전에 panic하고, 기존 `set_*_joint(...)` 시그니처는 호환성을 유지하면서 invalid 입력을 무변경으로 처리한다. Wasm `Engine` joint spawn/control은 checked 경로만 사용해 panic을 JS 경계로 전달하지 않는다. World는 generation-aware per-entity incident joint count를 derived runtime index로 유지해 joint와 무관한 entity의 despawn은 O(1) gate에서 8종 storage 순회를 생략한다. snapshot restore는 이 index를 active joint endpoint에서 재구축한다. joint free-list는 slot 생성과 snapshot restore 시 storage high-watermark까지 capacity를 확보해 despawn cascade의 free-list 반환이 재할당을 만들지 않게 한다.

#### Gameplay movement runtime

| 영역 | 코드 기준 |
| --- | --- |
| Common movement pattern과 navigation | `crates/ferrum-core/src/gameplay/movement/*.rs` |
| Shooter enemy movement | `crates/ferrum-core/src/shooter_scene/runtime/enemies.rs` |
| Shooter projectile movement | `crates/ferrum-core/src/shooter_scene/runtime/bullets.rs` |

Shooter enemy movement compatibility path는 `MovementPattern::Chase(Player/Entity)`를 Rust-owned tilemap navigation waypoint/cache로 처리한다. cache key에는 player/entity/layer/faction/tag target identity가 포함되어 서로 다른 chase target의 waypoint가 repath interval 안에서 섞이지 않는다. `nearestFaction:*`/`nearestTag:*` target query는 `World`의 faction/tag별 derived index bucket을 먼저 순회하고, stale 방어를 위해 live component와 transform 존재를 재확인한 뒤 source 위치 기준 가장 가까운 transform을 선택한다. 이 bucket은 gameplay component setter, despawn, prefab/projectile spawn, World snapshot restore, gameplay authoring rollback restore에서 component 배열로부터 갱신되며 Wasm/public API에는 노출되지 않는다. Shooter projectile movement path는 Enemy movement phase 이후, physics integration 이전에 Bullet layer authored `MovementPattern`을 적용한다. movement component가 없거나 unsupported인 Bullet은 기존 velocity를 linear fallback으로 유지하며, target query가 해석되지 않는 authored `seekTarget`은 공통 movement 계약에 따라 velocity 0으로 정지한다.

### Data Scene authoring apply와 instance registry

| 영역 | 코드 기준 |
| --- | --- |
| Data Scene runtime target과 document apply | `packages/ferrum-web/src/dataSceneRuntimeTarget.ts` |
| Instance handle registry와 binding guard | `packages/ferrum-web/src/gameplayAuthoring.ts` |
| Runtime startup/transition/reapply composition | `packages/ferrum-web/src/createFerrumRuntime.ts` |
| Rust lifecycle state와 transition cleanup | `crates/ferrum-core/src/game_state.rs`, `crates/ferrum-core/src/engine/{scenes,scene_controls,runtime}.rs` |

`applyDataSceneAuthoringDocument(engine, document, options?)`는 scene-authoring envelope와 optional variable declaration을 검증한 뒤 Data Scene runtime target 생성과 behavior recipe apply를 한 번에 수행하는 package-facing 조립 경로다. binding/component/variable runtime preflight는 runtime activation 전에 끝내고, activation 뒤 Rust variable slot을 먼저 동기화한 다음 guarded recipe/FSM command를 설치한다. variable 동기화 이후 spawn 또는 recipe apply가 실패하면 이전 declaration/slot/current value를 복원하므로 변수 저장소의 트랜잭션 경계를 유지한다. 더 낮은 수준의 `createDataSceneRuntimeTarget(engine, options?)`는 첫 번째 유효한 spawn request 직전에만 lazy `useDataScene()` activation을 수행하고, full apply는 zero-instance 문서도 validation 성공 뒤 실제 Data Scene 전환으로 활성화한다. `activateDataScene: false`는 이 자동 activation을 끄고, caller가 별도로 scene mode를 준비하는 경로다.

Data Scene flow는 임의 상태 graph 대신 Rust-owned `GameState`의 stable numeric code를 사용한다.
`Playing(1)`, `Paused(3)`, `LevelComplete(4)`가 Data Scene 유효 상태이며 `Paused`와
`LevelComplete`에서는 render command 생성은 유지하되 tween, physics, timer/FSM, particle simulation을
`Engine::advance_simulation(...)` 입구에서 멈춘다. TypeScript `runtime.dataScene.transition(...)`은 문서
A→B의 명시적 낮은 빈도 전환이고 activation opt-out을 허용하지 않는다. `reapply(...)`는 현재 문서 reload이며
기본값에서 Rust `use_data_scene()` reset boundary를 사용한다. 기존 caller-prepared 경로인
`reapply(..., { activateDataScene: false })`만 이 경계를 생략한다. reset 경계는 World/tilemap/particle/tween, physics contact/history와 fixed-step/input
latched state, collision/gameplay/effect/render/audio buffer, pending spawn/deferred despawn queue를 정리한다.
TypeScript의 같은 이름·타입 `global` 변수만 B 선언으로 전달하고 모든 `scene` 변수와 lifecycle은 B default와
`Playing`으로 초기화한다. frame hot path에 entity별 JS/Wasm 왕복은 추가하지 않는다.

`createSceneInstanceHandleRegistry(...)`는 Data Scene apply/reload 뒤 `ResolvedSceneCompositionInstance.id`와
`GameplayEntityHandle`을 동기화하는 TypeScript authoring cache다. scene load, reapply, agent patch 같은
낮은 빈도 경로에서만 `gameplay_entity_exists(...)`로 stale handle을 검증하며, frame loop에 registry scan이나
entity별 JS/Wasm callback을 추가하지 않는다. 배치 UI/agent 타겟팅처럼 안정 id가 필요한 경로는
`requireExplicitInstanceIds: true`로 resolver fallback id 의존을 거절한다.

### TypeScript platform layer

TypeScript는 브라우저와 package-facing API를 담당한다.

- Wasm module 초기화와 `FerrumEngine` lifecycle 조정
- `requestAnimationFrame` 기반 `GameLoop`
- keyboard/mouse/pointer/touch/gamepad 입력 snapshot 생성
- InputManager가 physical key·pointer·가상 source를 독립 보관하고 OR로 합친다. JSON action profile은 생성 시 검증·복사하며 TS 플랫폼에서 named action/axis와 소비 가능한 edge를 계산한다. `clear`/`setEnabled`는 입력을 취소하고, 초기화된 게임패드는 매핑된 모든 control의 중립 poll 뒤 재활성화한다. 기존 9-field snapshot과 Wasm 입력 ABI는 유지한다. 앱이 pause·클릭 이동 목표를 소유한다. 입력 이벤트와 gamepad는 canvas 소유 창의 focus/lifecycle을 따른다. 입력 취소 콜백이 실패해도 InputManager/VirtualControls와 상위 runtime은 소유한 리스너·DOM·자원 정리를 끝내며 외부 주입 객체의 소유권은 유지한다. 상세 [입력 계약](../../engine/input-actions.md).
- texture/sound/JSON asset 로딩, Aseprite/Tiled/LDtk import helper
- WebGL2/WebGPU texture path, audio registry, `AudioManager`, `UiOverlay`, `DebugOverlay`
- `createFerrumRuntime(...)`의 opt-in dialogue/localization/cutscene/HUD/accessibility/animationTimeline/levelStreaming frame-end adapter
- Wasm buffer를 typed array/DataView로 읽고 필요한 경우에만 object view로 decode
- 저수준 render command와 Built-in Shooter snapshot buffer는 Rust-derived named-field accessor로 읽고 raw offset을 consumer에 노출하지 않음
- Physics Spec snapshot/replay를 Web Worker에서 opt-in 실행하는 worker client
- Rust collision geometry와 canonical vector가 일치하는 순수 public point/body/collider transform helper

TypeScript는 게임 규칙의 source of truth를 소유하지 않는다.

`assetLoadTasks.ts`는 load/preload의 cold-path 작업 순서, 묶음별 동시성 상한, signal 결합과 listener 정리를 공유한다.
`AssetLoader`는 registry와 texture/audio/JSON adapter를 연결하고, GPU upload·audio decode는 각 owner가 처리한다.
기본 순차 처리와 manifest ID 시작 순서를 유지하면서 opt-in 병렬 처리를 지원한다. 첫 실패 시 sibling에 취소를
전파하고 시작된 작업이 끝난 뒤 reject한다. 성공 자원/cache의 rollback은 하지 않는다.
Engine과 BrowserPlatformHost는 자신의 lifetime signal을 묶음에 결합한다. AudioManager는 ID별 pending controller로
재요청/evict/destroy 뒤의 늦은 decode 등록을 차단한다. 새 pending 요청을 게시한 뒤 이전 요청을 취소하므로
동기 abort listener가 다시 load/destroy를 호출해도 최신 요청과 종료 상태를 유지한다. AudioAssetLoader는 HTTP 오류
응답의 남은 body를 취소하며, 정리 실패가 원래 HTTP 진단을 덮어쓰지 않게 한다.
Rust simulation, render command ABI와 hot-path 호출에는 변화가 없다.


공간 오디오는 `spatialAudio.ts`의 browser PannerNode/gain/source와 `spatialAudioScene.ts`의 cold binding 설정으로 나눈다.
Rust `engine/audio_poses.rs`는 transform/height/yaw/generational identity만 read-only bulk query로 제공한다.
`#[repr(C)]` AudioPose는 32 bytes(4 u32 + 4 f32), 최대 65개이며 Engine 생성 때 저장 공간을 예약한다.
TS는 query 후 새 Wasm view를 동기 소비하며 개체별 JS/Wasm 호출을 하지 않는다. simulation/거리 계산 상태를 TS에 복제하지 않는다.
source distance/cone와 listener rendering은 Web Audio가 수행하고, 게임 XY/elevation → audio X/Y-up/-Z 변환은 플랫폼 표현 변환이다.
voice는 최대 64개, warm update는 기존 노드의 AudioParam만 갱신한다. gain은 SFX/master mixer를 따르며 stop/end/evict/destroy가
source/panner/gain을 정리한다. createPanner 미지원은 명시적인 일반 SFX fallback, 할당 오류는 rollback 후 거절이다.
scene의 rebind는 복원된 instance handle을 cold 단계에서 교체한다. sound graph/playhead는 native 저장 포맷에 넣지 않는다.
기존 audio event의 4-float ABI·Rust simulation·기본 renderer 경계는 유지한다.


`geometry2D.ts`는 engine state를 보관하거나 Wasm을 호출하지 않는다. generic point/body
transform과 resolved collider의 world center/reference point 계산만 제공하며, 단일 점은
optional output 객체, collider vertices는 caller-owned numeric buffer를 사용한다. Collider별
offset/rotation semantics는 Rust query/debug geometry를 기준으로 양쪽 conformance test가
고정한다. 따라서 public 기하 helper 추가는 frame ABI나 Rust/TypeScript 소유권 경계를
변경하지 않는다.

Root `index.ts`는 기존 코드 호환을 위한 aggregate public entrypoint로 유지하고, 신규 코드는 `core.ts`, `authoring.ts`, `starter-scenes.ts`, `labs.ts`, `quality.ts` subpath entrypoint를 지원 수준별 import 경로로 사용한다. export 목록의 실제 소스는 계속 `public/*Exports.ts` 내부 barrel에서 기능군별로 관리한다. `engineTypes.ts`는 package-facing public type facade만 유지하고, frame/runtime, physics body, joint, query, API surface type은 `engineTypes/*.ts` 기능군 모듈에 둔다. Gameplay authoring helper는 `behaviorRecipes.ts`, `gameplayAuthoring.ts`, `gameplayEventActions.ts`, `presentationEffects.ts`, `behaviorStateMachine.ts`처럼 recipe validation, low-frequency component apply, frame-end event action mapping, presentation effect registry binding, FSM authoring schema/replay/install/state command planning을 분리한다. `chase`/`seekTarget` query preset은 TS가 문자열 authoring 값을 낮은 빈도 setter로 설치하고, Rust `MovementTarget`이 `primaryActor`/`nearestPrimaryActor`, legacy `player`/`nearestPlayer`, `nearestEnemy`, raw nearest-layer code를 frame loop 안에서 해석한다. `FerrumEngine`은 `FerrumGameplayAuthoringApi`를 typed facade로 합성해 `applyGameplayBehaviorCommands(...)`, `applyFactionRelationTable(...)`, `installBehaviorStateMachineRuntime(...)`, `gameplayBehaviorState(...)`, `preflightBehaviorStateMachineStateCommands(...)` 같은 낮은 빈도 method를 제공하지만, raw `set_gameplay_*` Wasm setter를 public API로 직접 노출하지 않는다. `collisionAreaDamage`, `collisionSound`, `collisionParticle`, `collisionEmitEffect`, `collisionSpawnPrefab`, `collisionDespawn` 같은 authored collision reaction도 Rust-owned numeric data로 저장되고 기존 audio event buffer, particle preset registry, gameplay event buffer, `EffectEvent` buffer, pending spawn queue, deferred despawn queue를 통해 frame 안에서 처리되며, TypeScript per-entity collision callback을 호출하지 않는다. `collisionSpawnPrefab`은 collision phase에서 즉시 `World`를 구조 변경하지 않고 기존 pending spawn queue에 command를 적재하며, queue 성공 후에만 source reaction cooldown을 커밋한다. `collisionEmitEffect`는 gameplay state를 바꾸지 않고 `presentationEffect` bulk event와 `EffectEvent` detail buffer entry만 생성하므로 `resolvePresentationEffectRegistry(...)`/`bindPresentationEffectActions(...)` 기반 effect registry/UI/VFX 연결은 frame-end adapter가 담당한다. `collisionSound`/`collisionParticle`/`collisionEmitEffect`/`collisionSpawnPrefab`의 optional cooldown도 source entity의 Rust component state로 tick되는 per-entity throttle일 뿐 global audio/VFX/spawn throttle이나 TS scheduler가 아니다. `collisionSound`/`collisionParticle`의 `replaceDefault` policy도 Rust-owned boolean flag로 built-in Shooter audio/VFX default만 suppress하며, damage/despawn/game-over gameplay override는 `Damage`/`Pickup`/`Despawn` reaction과 분리한다. `collisionSound`/`collisionParticle`/`collisionEmitEffect`/`collisionSpawnPrefab`의 optional `trigger: "enter"`도 Rust-owned contact key state로 판정되는 side-effect gate이며, TS collision callback이나 generic event bus가 아니다. Score pickup 수집도 Rust frame loop가 score/despawn을 적용한 뒤 `pickupCollected` bulk event로만 노출하며, TS는 frame-end adapter에서 UI/quest/inventory side effect를 붙인다. Bullet/Tile 충돌은 별도 public `"tile"` target을 열지 않고 `projectileAction.tileImpact: "despawn"|"passThrough"|"bounce"` numeric policy와 Rust-owned tile query 결과로 처리한다. `"despawn"`은 authored `AreaDamage`와 self-side effect를 additive로 실행할 수 있고, `"passThrough"`는 blocking tile impact와 tile-side authored reaction을 모두 건너뛰며, `"bounce"`는 swept tile contact normal로 projectile velocity를 반사한다. raw Wasm `set_gameplay_projectile_tile_impact(...)`는 이미 존재하는 authored projectile의 같은 component slot을 낮은 빈도 harness/apply 경로에서 설정할 때만 사용한다. `faction` behavior recipe는 `CollisionLayer` 물리 broadphase와 분리된 Rust-owned `GameplayFaction` numeric component이며, authored `Damage` collision reaction gate와 기본 Bullet->Enemy/Bullet->Player damage gate에 사용한다. projectile spawn은 source faction을 in-flight bullet에 복사하고, 현재 built-in Shooter snapshot version `19`는 bullet source faction metadata, session faction relation table, stable lifecycle state code와 gameplay variable slab의 선언·값을 함께 저장한다. FSM helper는 state/profile/transition reference와 readonly event frame stream을 검증하는 schema/API layer이며, frame hot path의 behavior evaluation을 TypeScript가 소유하지 않는다. FSM replay dry-run은 대상 entity handle로 event subject를 필터링한다. subject는 기본적으로 `source`이고, `pickupCollected`만 collector/player인 `actor`를 subject로 삼는다. transition predicate key는 interaction `actionId`, timer `timerId`, pickup `itemId`, collision event kind, actor/source generation 또는 numeric variable comparison을 포함하는 offline authoring validation이다. FSM runtime install helper는 scene load/agent apply 같은 낮은 빈도 경로에서만 state 문자열을 plan-local numeric state id, event kind, token id로 변환해 Rust setter를 호출한다. FSM state command helper는 실제 install에 사용한 plan으로 current numeric state id를 역매핑해 `BehaviorRecipeCommand[]` apply plan을 만들 뿐, per-frame state-enter callback이나 transition executor가 아니다. state command apply의 기본 mode는 overlay이며, opt-in `replaceSupported`만 command/id/handle preflight 후 지원 gameplay component subset을 clear한 뒤 적용한다. public `preflightBehaviorStateMachineStateCommands(...)`는 같은 검증과 clear capability 확인을 mutation 없이 수행해 agent dry-run 루프에 사용한다. 이 clear/apply 경로도 낮은 빈도 authoring helper이며, `FerrumEngine` runtime에서는 clear 전에 Rust-owned supported component slot snapshot을 잡아 actual setter 실패 시 해당 subset만 restore한다. 이 rollback은 health/damage/lifetime/score/faction/pickup/interaction/timer/movement/action/collision reaction slot의 live value 복원이며, event buffer, physics history, spawn queue, UI/inventory 같은 full engine transaction이나 frame별 state-enter runtime은 아니다. Production FSM transition은 Rust-owned `BehaviorStateMachine` component가 numeric state/event/token 또는 variable comparison predicate를 저장하고 `Engine::advance_simulation(...)` frame 끝에서 누적 `GameplayEvent` buffer를 한 번 읽어 matching subject entity에 붙은 FSM만 처리한다. `pickupCollected`의 source는 collected pickup telemetry로 유지되지만 pickup은 같은 collision phase에서 despawn될 수 있으므로 FSM subject는 actor/collector로 고정한다. Physics authoring helper는 `physicsAuthoring.ts` public facade를 유지하고, type contract, preset/material, layer map, collider conversion, joint conversion/cleanup, vehicle rig composition, public handle snapshot, runtime guard, Physics Spec world apply, validation helper는 `physicsAuthoring{Types,Presets,Material,Layers,Colliders,Joints,Vehicle,Handles,Runtime,World,Validation}.ts`에 둔다. `createJoint`가 `"world"` endpoint를 위해 생성하는 static anchor body는 반환 handle의 `worldAnchors`와 `clear()`로 정리할 수 있어야 하며, joint 생성 실패나 Physics Spec/vehicle rig 적용 중간 실패 시 이미 생성한 body, joint, world anchor는 즉시 rollback해야 한다.

Built-in Shooter snapshot version `19`의 lifecycle slot은 기존 `Title|Playing|GameOver`만 허용한다.
Data Scene 전용 `Paused|LevelComplete` code는 재개 경로가 없는 built-in scene에 주입되지 않도록 restore에서
거절한다.

`FerrumGameplayAuthoringApi.gameplayEntityExists(...)`는 scene load/agent apply 같은 낮은 빈도 경계에서만 쓰는 Rust-owned generation/liveness query다. 이 query는 raw `set_gameplay_*` setter를 public API로 여는 것이 아니며, `preflightBehaviorStateMachineStateCommands(...)`가 stale handle을 clear/apply 전에 거부하는 guard로 사용한다.

`collisionEmitEffect.intensity/radius`는 낮은 빈도 authoring 단계에서 검증되어 Rust `CollisionReaction::EmitEffect` component data로 저장된다. frame hot path에서는 Rust가 기존 collision side-effect 결정 지점에서 이 숫자 payload를 `EffectEvent` detail buffer에 bulk 기록하고, TypeScript는 frame 끝에서 registry/adapter dispatch에만 사용한다.

`effectEventAdapters.ts`는 `FrameState.effectEvents`를 registry-aware sound/particle/cameraShake/custom dispatch로 바꾸는 TS frame-end helper다. `effectEventRuntime.ts`와 `CreateEngineOptions.effectEvents`는 이 helper를 opt-in browser runtime hook으로 연결하고, `AssetHost.playAudioEvents(...)`와 Rust particle burst facade를 명시적 dispatch target으로 묶는다. opt-in `assetValidation: "error"`는 `AudioManager`/`BrowserPlatformHost`의 loaded sound check와 `createEngine()`이 추적하는 particle preset registration set만 읽어 missing asset을 frame-end diagnostic으로 보고한다. 이 helper는 handler target을 명시적으로 받아 브라우저/audio/VFX side effect만 호출하며, Rust simulation state를 되돌려 호출하거나 per-entity hot-path callback을 만들지 않는다.

`createFerrumRuntime(...)`의 `hud`/`accessibility`/`animationTimeline`/`localization`/`cutscene`/`dataScene`/`levelStreaming` option도 같은 낮은 빈도 경계를 따른다. `hud`는 runtime frame을 `HudComponentSpec[]`로 변환해 DOM `UiOverlayState`에 병합하고, `accessibility`는 resolved option, subtitle status panel, contrast HUD theme adapter만 제공한다. `animationTimeline`은 `FrameState.frameTimeMs`로 `AnimationTimelinePlayer`를 갱신하고 frame event/state transition metadata를 `onUpdate`에 전달하지만, sprite renderer나 Rust simulation state를 자동으로 바꾸지는 않는다. `LocalizationBundle`은 locale table과 interpolation helper만 소유하고, `CutsceneSequencePlayer`는 `FrameState.frameTimeMs`로 낮은 빈도 timeline state를 갱신한다. dialogue command는 DOM `UiOverlayState`로 변환되고, audio command는 BGM이면 `AssetHost.playBgm(...)`/`stopBgm(...)` optional hook으로 loop/fade/stop을 보존하며, custom host가 해당 hook을 제공하지 않으면 기존 `AssetHost.playAudioEvents(...)` fallback을 사용한다. 카메라 이동과 장르별 narrative side effect는 `CutsceneSequenceTarget` adapter가 담당하며 Rust simulation을 되돌려 호출하거나 entity별 JS/Wasm callback을 만들지 않는다. `dataScene` option은 startup 또는 explicit `runtime.dataScene.transition(...)`/`reapply(...)` 단계에서만 `applyDataSceneAuthoringDocument(...)`를 실행해 scene-authoring document를 검증/spawn/binding한다. `levelStreaming` adapter는 renderer viewport 또는 custom viewport provider로 chunk plan을 계산하고, load 대상 chunk asset manifest를 기존 preload/cache layer에 넘긴 뒤 `target.applyChunk`/`target.unloadChunk`/`target.releaseAssets`/`target.rebuildColliders`로 낮은 빈도 chunk apply, 미참조 asset eviction, collider rebuild 작업을 위임한다. `createFerrumRuntime`는 `AssetHost.releaseAssets(...)`가 있으면 `target.releaseAssets` 호출 뒤 같은 payload를 host에 전달하고, 기본 `BrowserPlatformHost`는 현재 registry URL과 일치하는 texture/sound만 platform resource에서 evict한다. `target.releaseAssets` payload는 현재 preload/retain window에서 더 이상 참조하지 않는 texture/sound/JSON entry만 포함하므로 shared chunk asset을 즉시 제거하지 않는다. `levelStreamingPhysics.ts` helper는 tilemap/pixel mask collider authoring chunk를 manifest의 chunkColumns/chunkRows, tile size, origin과 맞춘다.

`collisionAreaDamage`도 같은 경계를 따른다. TypeScript recipe/facade는 낮은 빈도 authoring 단계에서 `amount`, `radius`, `targetLayer`를 검증해 Rust component setter로 넘기고, 실제 entity impact radius query, tile impact swept contact point 기반 radius query, faction gate, health/score/despawn 적용, `collisionDamage`/`factionDamageDenied` telemetry 생성은 Rust frame loop에서 처리한다. 이 경로는 per-entity JS collision callback을 만들지 않으며, public gameplay event ABI에 impact world `x/y`를 추가하지 않는다.

`capture_gameplay_authoring_snapshot(...)`, `restore_gameplay_authoring_snapshot(...)`, `clear_gameplay_authoring_snapshot(...)` raw Wasm hook은 public facade method가 아니라 `FerrumEngine` 내부 `replaceSupported` apply rollback용 runtime capability다. TypeScript helper는 hook 세 개가 모두 있는 runtime에서만 snapshot/restore를 사용하고, custom runtime이 hook을 제공하지 않으면 기존 non-transactional apply semantics를 유지한다.

Physics snapshot/replay helper는 `physicsSnapshot.ts` public facade/import 경로를 유지하고, type contract, canonical hash, public JSON validation, world capture/restore, replay input runner를 `physicsSnapshot{Types,Hash,Validation}.ts`, `physicsWorldSnapshot.ts`, `physicsReplayInput.ts`에 둔다. Snapshot/replay hash는 rollback/debug 검증용 non-hot-path이며, body state capture/restore는 bulk buffer API를 우선 사용한다.

Gameplay golden replay helper는 `GameStateSnapshot`을 canonical gameplay snapshot으로 사용한다. `gameplayReplay.ts`는 strictly increasing snapshot sequence를 frame hash/run hash로 묶고 expected/actual run의 첫 mismatch frame과 JSON path diff를 반환한다. 이 helper는 runtime loop를 실행하지 않고, fixed timestep/seed/input stream 실행은 smoke 또는 예제 harness가 담당한다. `tests/smoke/gameplay-replay-smoke.mjs`는 `tests/fixtures/gameplay-golden/scenarios.json` manifest를 읽어 scenario별 runner, fixture path, frame count, capture frame, input event, expected replay hash와 score/event/FSM metadata를 검증한 뒤 raw Wasm Top-down Shooter를 실행한다. manifest는 scenario 계약을 고정하고, 장르별 setup과 exact payload assertion은 runner가 소유한다. 각 scenario는 같은 Wasm build에서 두 번 실행해 actual-vs-actual determinism을 먼저 확인한다. 기본 fixture는 deterministic enemy spawn, projectile travel, enemy damage, score reward까지 포함한다. authored behavior fixture는 raw Wasm authoring setter로 score pickup, interaction event, collisionDamage reaction, one-shot timer trigger, source-scoped FSM transition을 설치하고 custom JSON state에 event/FSM 결과와 exact event payload를 넣어 hash 범위에 포함한다. homing missile fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `nearestTag:hostile` seek target, damage, particle, despawn, lifetime command를 설치하고, Rust frame loop에서 projectile movement, collision damage/despawn, `presentationEffect` telemetry, score reward, decoy 생존을 exact custom state로 검증한다. timer fixture는 state-enter runtime을 열지 않고 authoring setup 이후 Rust timer system이 emit한 frame event와 FSM telemetry만 검증한다. 비교 범위는 scene metric, built-in shooter snapshot, Data Scene state/authoring document, optional PhysicsWorld/custom state이며 render/audio/debug/profiler output은 제외한다.

Physics Spec resolver는 `physicsSpec.ts` public facade/import 경로를 유지하고, spec field resolution, type contract, primitive validation/type guard를 분리한다. Public type contract는 `physicsSpecTypes.ts`, 숫자/vector/object/reference validation은 `physicsSpecValidation.ts`에 두어 Game Spec resolution, physics authoring, runtime apply가 동일한 diagnostic contract를 사용한다. 실제 field resolution은 `physicsSpec/{root,materialsLayers,bodies,colliders,geometry,joints,debug,defaults,keys}.ts` vertical slice에 두며, resolver는 inherited object key를 reference로 인정하지 않고 런타임 authoring에서 거부되는 `world`-`world` joint 같은 구조 오류를 spec 단계에서 먼저 차단한다. `createPhysicsWorldFromSpec(...)`가 반환하는 rigid body `stepOptions`는 resolved gravity, solver iteration, `continuous` 값을 함께 포함해 runtime auto-step과 manual step이 같은 Physics Spec 계약을 사용하게 한다.

Manual rigid body step 통계는 Rust solver의 구조적 비용 신호를 TypeScript facade로 노출한다. `PhysicsRigidBodyStepStats.positionContactRebuilds`는 position solver가 contact list를 다시 만든 횟수이며, solver가 correction 없는 안정 iteration 뒤에 남은 position iteration을 조기 종료하면 `positionIterations`보다 작을 수 있다. Raw rigid-body step getter는 마지막 solver step 결과를 유지하고, frame telemetry의 `physics.ccdChecks`/`physics.ccdHits`/sleeping/joint counters는 현재 render frame 안에서 실행된 solver step을 누적한다. Fixed timestep이 한 render frame에서 여러 번 소비되더라도 runtime budget과 debug overlay는 frame 전체 비용을 본다.

### AI agent authoring surface

AI agent가 직접 다루는 주요 표면은 코드 내부 구현이 아니라 안정적인 authoring contract다.

- Game Spec / Physics Spec: 게임 규칙, 밸런스, 물리 authoring 입력
- JSON Schema / validation script: AI가 만든 설정의 구조 검증
- create-game template: 새 게임 프로젝트의 시작점
- consumer agent/skill template: Codex, Claude, Gemini 같은 도구별 개발 지침
- smoke script: agent 변경 결과의 회귀 검증

이 경계 때문에 visual editor UI 상태, drag/drop 편집 상태, canvas selection state를 runtime core에 넣지 않는다.

Scene Composition fragment include의 occurrence별 배치는 resolved flat id를 원본 flat instance로 잘못
저장하지 않는다. patch v2 `updateResolvedTransform`은 include occurrence provenance와 parent transform을
보존하고 world transform을 parent-local로 역변환해 `include.instanceTransforms` override에 기록한다.
동일 fragment의 다른 include occurrence는 영향을 받지 않으며 patch v1 flat transform merge는 호환
경로로 유지한다. nested component/binding/rename/remove는 별도 provenance 계약이 생기기 전까지 명시적
unsupported diagnostic을 반환한다.

### Renderer

WebGL2 자원 통계는 기존 소유 모듈에서 집계한다. TextureManager는 texture 객체별 크기와
합계를 변경 시 갱신하고, RenderTexture store도 생성/resize/release 때 합계를 갱신한다.
renderer의 `resourceStats()`는 이 합계와 고정 개수의 batch/내부 target 상태를 결합하므로
전체 asset/entity 순회나 GPU query가 없다. 소유권 관리용 별도 GC/리소스 그래프는 도입하지 않는다.
같은 TextureManager의 ID alias는 마지막 참조가 사라질 때 texture를 해제하며 중복 집계하지 않는다.
raw texture는 기존처럼 renderer destroy까지 소유한다.
RuntimeFrameRenderer는 실제 render/post-process 완료 뒤 snapshot을 DebugOverlay 및
RuntimeProfiler sample로 전달한다. bytes는 texture 저장량과 GPU buffer capacity의 합계 추정치이며
미지원/크기 불명은 0으로 보정하지 않는다. native WebGPU 통계는 아직 미지원이다.

`webgl2.gpuTiming: true`는 별도의 비동기 GPU timer를 켠다. RuntimeFrameRenderer가
clear부터 post-process까지 `try/finally`로 감싸고 WebGL2GpuTimer가 이전 query를
준비된 경우에만 읽는다. 최대 4개 query를 재사용하며 disjoint/context loss에서는 결과를 폐기한다.
GPU 시간은 CPU `renderTimeMs`와 분리하고 미측정 frame에 값을 만들지 않는다.
`engine.memoryStats()`와 full FrameState는 현재 `WebAssembly.Memory.buffer.byteLength`를
읽어 모듈 전체 Wasm 확보 용량을 제공한다. Rust ABI 변경이나 entity별 경계 호출은 없다.
이 값은 사용 중인 heap이나 누수 판정값이 아니며 GPU 저장량 추정치와도 분리한다.


색 공간은 renderer 생성 시 `legacy`(기본값) 또는 `linear-srgb`로 고정한다.
WebGL2 managed 모드는 sRGB 색상 texture와 수치 texture를 분리하며, 숫자 RGB는 linear 계약이다.
sprite/lighting/material/후처리는 linear로 계산하고 sRGB framebuffer 저장 형식으로 중간 정밀도를 확보한다.
최종 fullscreen pass만 canvas용 sRGB 변환을 수행하고 premultiplied alpha를 보존한다.
후처리가 없으면 출력 draw 1회가 추가되며 frame 통계에 포함한다. 기존 bulk ABI와 Rust 게임 상태는 바꾸지 않는다.
WebGPU의 managed 모드는 canvas 취득 전에 거절하고 factory가 같은 설정을 유지해 WebGL2로 fallback한다.
asset manifest의 `textureOptions`는 직접 load/preload 단계에서 검증하고 renderer로 전달한다.

WebGL2 RenderTexture는 `webgl2RenderTextureStore.ts`가 renderer별 handle/id와 자원을 소유하고,
`webgl2RenderTarget.ts`가 내부 후처리 target과 공개 target의 GPU 할당을 공통으로 처리한다.
asset texture와 별도 저장하되 `SpriteBatch`의 texture 조회 계약에서 합쳐 소유권 중복과 double delete를 피한다.
`renderToTexture`는 기존 bulk command를 별도 framebuffer로 소비하고 main draw framebuffer,
viewport, clear/color-mask/scissor 상태를 복구한다. texture feedback과 누락된 입력은 clear 전에 거절한다.
불투명 8-bit RGBA(legacy RGBA8/managed SRGB8_ALPHA8), 일반 sprite와 같은 좌상단 UV,
고정 texel 크기와 별도 논리 viewport가 첫 버전의 계약이다.
framebuffer 저장 방향은 `SpriteBatch`의 texture별 shader uniform으로 보정하므로 Data Scene/Rust UV 계약과
직접 buffer upload를 유지한다. 부분 UV, asset 혼합, material staging에서도 동일하게 적용한다.
기존 Rust 컬링/화면 좌표 및 Wasm ABI를 바꾸지 않으며 독립 카메라를 구현하지 않는다.
main/offscreen 비용을 frame 통계에 합산한다. 공개 API와 제약은 [Core Runtime](../../engine/public-api/core.md#rendertexture-webgl2)을 따른다.

제품 기본 renderer는 WebGL2다. `createRenderer(...)`는 WebGPU 옵션·공간 요구사항을 먼저 검사하고,
adapter/device의 pipeline 생성·GPU 오류 확인까지 canvas context 연결 전에 끝낸다.
이 단계의 실패는 같은 canvas의 WebGL2로 fallback한다. context 연결 뒤 configure/resize 오류는
다른 API로 교체할 수 없으므로 전파하며 새 canvas가 필요하다. debug/postprocess pass도 context getter를
draw 때만 호출한다. WebGPU는 Rust render command ABI를 유지하며 fullscreen post-process는 fade만 지원한다.

WebGL2 sprite renderer는 Rust render command buffer를 그대로 instance data로 업로드하고, static quad vertex buffer와 static index buffer를 재사용해 `drawElementsInstanced`로 texture-contiguous batch를 그린다. `SpriteRenderCommand`는 rect/uv/color/texture/effect와 visible `rotation_radians`를 숫자 슬롯으로 전달하며, shader는 rect 중심 기준으로 회전한다. 이 구조는 per-sprite draw call 없이 tilemap/sprite render command를 WebGL2 instancing path로 소비한다.

비트맵 월드 텍스트는 새 render command ABI를 만들지 않는다. TypeScript `BitmapFontPolicySpec` loader/validator가 atlas glyph·kerning metadata를 저빈도 bulk typed-array 호출로 Rust `BitmapTextSystem`에 등록하고, `setWorldText(...)`는 문자열 내용이 바뀔 때만 문자열을 전달한다. 내용이 같은 속성 변경은 숫자 전용 update를 사용하며 좌표·sort metadata·anchor만 바뀌면 기존 glyph command cache도 유지한다. Rust는 정렬 전 월드 좌표 `SpriteRenderCommand` cache를 만들고 frame에서는 entity anchor resolve, camera transform, glyph 단위 viewport culling과 기존 layer/HD-2D sort만 수행한다. 따라서 문자열과 entity별 callback은 frame hot path를 건너지 않으며 WebGL2/WebGPU는 같은 15-float sprite ABI를 그대로 소비한다.

동적 debug primitive도 새 ABI를 추가하지 않는다. Rust가 frame마다 bulk 생성한 `PhysicsDebugLineBufferView`를 TypeScript `physicsDebugLineComposer`가 필요할 때만 받아 `DebugGizmoLineBufferWriter`의 재사용 typed array에 append하고 line/polyline/arrow/circle을 추가한다. renderer는 합성된 기존 8-float physics debug line buffer 하나를 소비하므로 WebGL2/WebGPU 경로가 분기되지 않는다. `physicsDebugLines`가 비활성화되면 Rust debug buffer 생성, composer 호출, debug renderer pass를 모두 생략한다. 이 경로는 debug 표현 전용이며 TypeScript가 simulation state를 소유하지 않는다.

## 프레임 순서

```text
Browser input events
  -> InputManager.snapshot()
  -> Engine.set_input(...)
  -> Engine.update(delta_seconds)
  -> WasmBridge reads render/audio/gameplay/collision/debug buffers
  -> Runtime renderer render()
  -> AudioManager.play()
  -> DebugOverlay update
  -> Runtime content adapters (HUD/accessibility/animationTimeline/localization/dialogue/cutscene/levelStreaming)
  -> Low-frequency Data Scene or built-in scene authoring adapters
  -> UiOverlay update
  -> Engine.clear_audio_events()
```

`FrameState`는 렌더링, HUD, debug에 필요한 snapshot이다. action trigger diagnostic도 Rust frame telemetry에서 읽은 관측 신호로 포함하지만, 게임 상태를 장기 보관하거나 TypeScript에서 별도 simulation state로 복제하지 않는다.

Built-in Scene Authoring은 Data Scene spawn 계약을 재사용하지 않는다.
`applyBuiltInSceneAuthoringDocument(...)`는 활성 Shooter/Platformer/Breakout이 이미 생성한 entity를
`built_in_*_entity_{id,generation}`으로 찾고 generation-safe `set_built_in_scene_entity_position(...)`과 기존 bulk
behavior apply facade를 scene load/reset 경계에서만 호출한다. Rust가 entity 수명과 transform을 계속
소유하며, TypeScript가 frame마다 handle을 조회하거나 entity별 callback을 등록하지 않는다. 회전/scale,
render layer와 Data Scene visual/collider component는 현재 built-in scene 전용 adapter가 지원하지 않으므로
무시하지 않고 preflight diagnostic으로 거부한다. health, lifetime, pickup-despawn,
collision-despawn처럼 built-in scene 소유 entity 수명을 끊는 behavior command도 같은 preflight 경계에서
차단한다.

Placement Viewer Desktop host는 browser frontend와 Rust file authority를 분리한다. Tauri의 load command가
성공한 scene document canonical path와 inferred/selected project root만 process-local write registry에
등록하고, scene save와 `.ferrum-placement-handoff.json` save는 이 allowlist를 다시 확인한다. handoff의
고정 저장 파일이 심볼릭 링크이면 쓰기를 거부한다. 따라서 frontend가 열지 않은 sibling 또는 임의
filesystem 경로를 save command 인자로 전달하거나 링크로 우회해도 쓰지 않는다.
이미지 read는 별도 asset registry가 canonical asset root 아래 파일만 `ferrum-asset://` protocol로 제공한다.
protocol 요청마다 canonical file identity를 다시 확인해 등록 뒤 외부 symlink로 바뀐 경로를 거부하고,
GET/HEAD/OPTIONS와 공식 custom-protocol URI 형태만 허용한다.
packaged WebView는 명시적 CSP로 local bundle, Wasm, Tauri IPC와 등록된 asset protocol을 허용한다.
기본 텍스처의 `data:` PNG도 `fetch`로 읽으므로 `connect-src`와 `img-src` 양쪽에 `data:`를 허용한다.
package smoke는 이 정책이 비활성화되거나 필수 source가 빠지면 artifact build 전에 실패한다.
desktop asset browser smoke는 같은 CSP를 HTML 응답에 적용해 texture load와 canvas 초기화를 검증한다.
native asset URL은 id 기준으로 고정되어 있으므로 frontend는 명시적 asset folder 검사마다 별도 revision을
올려 같은 id/URL도 다시 upload한다. Upload는 순차 처리하고 오래된 결과를 현재 폴더의 ready/error
상태로 publish하지 않아 연속 폴더 선택에서도 최신 이미지가 마지막으로 적용된다.

## ABI와 데이터 포맷

Rust/TypeScript 공유 buffer는 `#[repr(C)]` Rust struct와 TypeScript decoder가 함께 맞아야 한다.

| Buffer | Rust 기준 | TypeScript 기준 | 용도 |
| --- | --- | --- | --- |
| Frame telemetry | `engine/telemetry/frame_stats.rs` | `engineFrameState.ts`, `wasmBridgeAbi.ts`, `wasmBridgeBufferViews.ts` | `FrameState` scalar metric/action/spawn diagnostic bulk snapshot |
| Sprite render command | `render_command.rs`, `bitmap_text.rs` | `renderCommandDecoder.ts`, `spriteMaterial.ts`, `worldText.ts`, `wasmBridgeAbi.ts` | sprite/tile/particle/bitmap glyph의 WebGL2/WebGPU batch 입력. 15-float layout이며 texture/effect offset 뒤 마지막 슬롯이 visible sprite rotation이다. |
| Spatial render packet | `spatial_scene.rs`, `engine/spatial_api.rs`, `bitmap_text.rs` | `dataSceneSpatial.ts`, `wasmBridge.ts`, `webgl2SpatialPass.ts` | opt-in version 2, repr(C) 44-byte/11-float vertex·camera28·8-byte/u32×2 terrain draw ranges. 새 reader는 v1도 읽고 기존 sprite ABI는 보존한다. |
| Audio event | `audio_event.rs` | `wasmBridge.ts`, `audioManager.ts` | frame 단위 sound playback |
| Gameplay event | `gameplay_event.rs` | `gameplayEventDecoder.ts`, `gameplayEventActions.ts`, `presentationEffects.ts`, `effectEventAdapters.ts`, `wasmBridge.ts` | Rust-owned gameplay action output, interaction/collision reaction/spawn success/action failure/timer/presentation telemetry와 frame-end adapter action/effect binding/dispatch 변환 |
| Collision event | `collision_event.rs` | `collisionEventDecoder.ts`, `wasmBridge.ts` | enter/stay/exit/hit/trigger event |
| Physics debug line | `collision.rs` | `physicsDebugLineDecoder.ts`, `debugGizmos.ts`, `runtimeFrameRenderer.ts` | opt-in Rust line과 TypeScript 동적 primitive를 하나의 8-float buffer로 렌더링 |
| Physics query scalar getters | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `createEngine.ts` | nearest body/tile query result fields |
| Physics query hit buffers | `engine/physics_queries.rs`, `engine/physics_bridge.rs`, `engine/telemetry.rs`, `collision.rs`, `tilemap.rs`, `tilemap/*.rs` | `physicsQueryDecoder.ts`, `createEngine.ts` | body/tile query, shape cast, contact/manifold hit arrays |

공유 layout이 바뀌면 Rust size function, TypeScript decoder, 관련 tests를 함께 수정한다.

## Runtime/API 구성

`@ferrum2d/ferrum-web`의 public entrypoint는 호환 aggregate인 `packages/ferrum-web/src/index.ts`와 지원 수준별 subpath인 `core.ts`, `authoring.ts`, `starter-scenes.ts`, `labs.ts`, `quality.ts`다. 주요 runtime API는 [Public API](../../engine/public-api.md)에 둔다.

- `createEngine(...)`: Wasm `Engine`, input/viewport provider, asset host, frame callback을 묶는다. Public API/type contract는 `engineTypes.ts`에 두고 `createEngine.ts`에서 기존 export 경로를 유지한다.
- `createFerrumRuntime(...)`: browser canvas, WebGL2/WebGPU renderer, input, asset/audio host, UI/debug overlay를 포함한 제품용 runtime을 만든다. 기본값은 runtime이 `FerrumEngine`을 생성/소유하지만, `engineInstance`로 이미 만든 엔진을 주입하면 runtime은 lifecycle 호출만 forwarding하고 엔진 destroy는 호출하지 않는다.
- `createRenderer(...)`: 기본 WebGL2 renderer를 생성하며 WebGPU 선호 옵션은 지원 환경에서 선택 renderer를 사용한다.
- `applyBuiltInSceneAuthoringDocument(...)`: built-in starter의 기존 entity handle에 위치와 Behavior Recipe를 낮은 빈도로 적용한다. generic Data Scene spawn/apply와 분리한다.
- `applyShooterGameSpec(...)` / `resolveShooterGameSpec(...)`: Top-down Shooter Game Spec 검증과 Rust 적용 계약을 담당한다. Public import 경로는 `gameSpec.ts` facade가 유지하고, 타입/기본값/검증/resolution/Wasm 적용 구현은 `gameSpec*.ts` 내부 모듈에 둔다.
- `importAsepriteAtlas(...)` / `importTiledTilemap(...)` / `importLDtkTilemap(...)`: asset authoring 데이터를 Game Spec 친화 구조로 변환한다. Public import 경로는 `assetPipeline.ts` facade가 유지하고, 포맷별 구현은 `assetPipeline*.ts` 내부 모듈에 둔다.

### Data Scene 공간 기반 (개발 소스)

`SpatialScene`은 `Engine`이 소유한다. 낮은 빈도 authoring의 사각 surface에서 top/side/bottom mesh와
tilemap height metadata를 함께 컴파일한다. Rust가 직교/원근 camera snapshot, native step/ramp 이동,
heightSpan 기반 cylindrical billboard·anchored glyph, terrain ray hit와 frustum 판정을 계산한다.
TypeScript는 DOM client/NDC 변환, bulk Wasm view 읽기, WebGL2/WebGPU vertex/depth/sampler 자원만 소유한다.
entity별 JS/Wasm frame 호출이나 새 rigid-body solver는 추가하지 않는다.

기존 60-byte sprite command는 보존한다. 선택 `RenderCommandBufferView.spatial`은 version 2의
44-byte vertex·camera28 float와 `repr(C)` u32×2 draw range metadata를 분리해 전달한다.
Rust는 authored surface마다 전체 top/side/bottom AABB를 만들고 f64 clip plane과 f32 roundoff 여유로
확실히 밖인 chunk만 제외한다. 연속한 visible surface는 절대 vertex 범위로 병합하고 cold configure에서
예약한 Vec capacity를 frame에서 재사용한다. 메시·physics·picking 원본은 줄이지 않는다.
TS는 같은 frame의 range를 검증해 static buffer의 절대 offset으로 draw하며 culling math를 복제하지 않는다.
GPU terrain은 revision/memory identity
변경 시 upload하고 dynamic billboard는 bulk upload한다. shared depth에서 opaque/cutout을 검사한 뒤
기존 flat command와 DOM HUD를 그린다. 공간 RenderTexture는 명시 거절한다.
WebGPU의 `webgpuSpatialPass`는 같은 native geometry/range를 depth24plus에 그린다.
`spatialRenderPacket`·`spatialModelPacket`은 양 backend의 사전 validation을 공유한다.
`webgpuSpatialModels`는 native model matrix/visibility를 받아 indexed instancing하며 CPU game state를 소유하지 않는다.
GLB sRGB/data texture·sampler/mip 자원은 async preload의 GPU scope/queue 완료 뒤에만 cache에 등록한다.
동기 authoring lease는 검증된 cache만 사용한다. preload 중 기존 scene draw/prune가 재사용 자원을 해제하지
않도록 source pin을 유지하고, 실패·dispose·destroy에서 소유 자원을 정리한다.
`webgpuSpatialEnvironment`는 native 환경 v1/v2·shadow matrix를 960-byte uniform 두 record로 묶고 rgba16float/depth24plus target을 소유한다.
조명·모델 tangent/derivative normal·안개는 geometry shader에서 계산하고 DOF·색 보정은 기존 flat HUD 앞에 합성한다.
native actor focus·pixelArt viewport·debug buffer를 그대로 소비한다. resize/disable/destroy는 target 수명을 관리하며,
비동기 GPU target 실패는 잘못된 warm cache를 폐기하고 다음 호출에 오류를 전달한다. cold 모델 활성화의 rollback과는 별도 계약이다.
`webgpuSpatialShadows`는 depth32float point 6-layer array와 sun 2D target을 소유한다. native matrix로 face UV를 투영하고
radial/projected depth·slope bias·hard/PCF를 공유하며 shadow pass에는 sampling group을 연결하지 않아 read/write alias를 피한다.
camera8개 record와 model8개 pass의 matrix를 draw 전에 한 번씩 bulk upload하고 각 draw는 별도 offset을 사용한다.
receive flag는 같은 환경의 두 bind group으로 선택하며 per-draw queue overwrite를 하지 않는다.
shared `SpatialShadowCache`는 native caster/terrain revision·light/matrix·모델 shadow mask/content/pose와 색 atlas revision을 비교한다.
WebGPU texture store는 replace/alpha patch마다 해당 texture revision을 갱신한다. 정상 warm frame은 GPU object를 다시 만들지 않는다.
그림자 target은 실제 queue.submit 성공 뒤에만 cache에 등록한다. 인코딩 중단·resize 준비 실패는 미제출 map을 warm으로 취급하지 않는다.
resize의 async target/bind-group validation 오류는 identity guard로 현재 자원에만 적용하고 다음 호출에 전파한다.
효과가 꺼진 fullscreen postprocess target은 별도 depth renderbuffer를 소유한다.

공간 설정은 Scene Authoring version 1의 optional `spatial`이고 기존 JSON document 재적용에 참여한다.
공간 진행을 opt-in capture하면 Data Scene v6에 native camera와 live authored billboard/model의 XY/heightSpan을
저장한다. body 없는 장식은 span=null이고 terrain support link는 stable authored ID로 저장한다.
TS는 ID/JSON 변환만 수행하고 native는 임시 terrain 기반 preflight 및 flag/animation/pose/camera
전체 batch의 검증·commit을 수행한다. viewport는 복원 대상 engine에서 재생성한다.
configuration revision은 terrain/binding/actor 변경의 누락 저장을 막으며 camera-only 변경은 허용한다.
일반 capture v5와 v2~v5 읽기/기존 hash는 보존한다. 전체 physics momentum/world save는 별도 계약이다.
공개 API·지원 제한은 [공간 지형·카메라·빌보드](../../engine/data-scene-spatial.md), pixel/resource gate는
`pnpm smoke:spatial-scene`을 기준으로 한다.

M3 외부 입력의 `spatialGltf.ts`는 HTTP glTF JSON과 같은 origin의 binary/image를 cold 단계에서 준비한다.
문서 2 MiB·전체 고유 decoded bytes/정규화 bundle 32 MiB·16 binary/16 image 상한, redirect/URL 정책과 reader 취소/해제를 소유한다.
압축 응답·Content-Encoding이 숨겨진 CORS 응답은 실제 decoded stream으로 상한을 검사한다.
image용 view를 추가하기 전에 accessor/image 참조가 원래 view 목록 안에 있는지도 검증한다.
`spatialModelAssetCache.ts`는 URL/format/content revision의 cold CPU load를 합치고 독립 소비자 lease·취소·
동시 로드/entry/decoded byte 상한·idle LRU를 관리한다. engine 등록/GPU 준비·해제와 native scene 상태는 소유하지 않는다.
같은 asset handle을 공유해 renderer의 기존 resource identity cache를 재사용하며 저장 포맷과 render ABI는 유지한다.
모든 view를 원래 buffer 범위로 검사한 뒤 정렬·재배치하며 이미지를 내장한다. 결과는 기존 GLB 디코더로 보내므로
geometry·normal/tangent·재질·이미지 해석을 복제하지 않는다. content identity는 종속 bytes를 포함한 정규화 bundle에 둔다.
네트워크·정규화는 플랫폼 자산 준비이며 Rust simulation·기존 80-byte model ABI·authoring/progress 형식을 바꾸지 않는다.
load 실패/취소는 씬을 적용하지 않으며 성공 뒤 기존 register/preflight/선택 GPU 준비/apply 흐름을 사용한다.

정적 GLB 모델 M1은 기존 spatial pass의 독립 extension v1이다. `spatialModel.ts`가 제한된 파일/이미지
파싱과 SHA-256 content identity, 불변 CPU 자원 등록을 맡고 `spatial_scene/models.rs`는 native entity의
XY/heightSpan과 authored root yaw/scale에서 matrix·bounds·camera/light 제출 mask를 만든다.
`repr(C)` 80-byte record(u32×4 + f32×16)를 한 bulk view로 읽으며 entity별 Wasm 호출은 없다.
`webgl2SpatialModels.ts`는 공유 indexed buffers/texture/sampler를 같은 depth/HDR/shadow pass에서 소비한다.
M3 첫 규모 확장은 scene당 1,024 instance/4,096 제출 primitive/262,144 triangle 입력을 허용한다.
TS는 native mask로 걸러진 연속 동일 자원/receive 설정을 GPU instancing하며 게임 pose/culling을 계산하지 않는다.
WebGL2의 attr 6..9는 instance matrix이고 main/shadow가 같은 shader 변환을 사용한다. geometry 순서를 전역 정렬하지 않는다.
기본 공간 pipeline 생성 시 64 KiB GPU buffer를 미리 예약하고 CPU staging을 재사용하며 frame 안에서는 행렬만 bulk 갱신한다.
한 개체 batch는 기존 uniform draw를 유지한다. main instanced draw와 전체 pass 행렬 bytes를 별도 통계로 노출하며,
총 draw/triangle/upload에도 실제 비용을 반영한다. shadow cache hit에는 shadow 행렬을 전송하지 않는다.
기존 render ABI v1은 유지하고 확장 한도는 cold capability로 식별한다. 저장 문서/v6/v7과 physics proxy 계약은 유지한다.
공유 모델의 geometry/material 검증과 triangle 합계 계산은 같은 frame에서 자원별 한 번만 수행한다.
각 native row의 matrix/flags/mask/reserved와 전체 primitive/triangle 예산은 계속 전부 검사한다.
직접 작성한 renderer packet도 참조하는 서로 다른 CPU 자원 수/bytes를 16개/128 MiB로 제한해 native registry 우회를 막는다.
미참조 handle은 업로드하지 않고 같은 resource identity의 숫자 별칭은 자원을 중복 계산하지 않는다.
검증 cache는 frame 밖으로 유지하지 않아 자원 수명을 늘리거나 다음 frame 검증을 생략하지 않는다.
행렬은 원래 bulk view의 숫자 인덱스로 검사해 개체별 임시 typed-array view를 만들지 않는다.
Rust는 cold model configure에서 최대 제출 수의 output Vec 용량을 예약하며 첫 frame부터 같은 pointer/capacity를 사용한다.
캐시에는 model pose/flags/mask와 contentId도 포함하며 제거/실패/destroy 자원을 회수한다. mesh 데이터는
기존 44-byte 지형 정점이나 shadow source 0/1로 위장하지 않는다. 물리는 별도 작성한 world 단위 AABB/heightSpan,
저장은 기존 v6/v7의 authored resource 참조·pose를 재사용한다. 모델 자원/content preflight는 파괴적 활성화 전에 수행한다.
capture/restore 모두 native model pose의 표현 가능 범위를 검사한다. 모델에 anchor한 world text는 공간
billboard 정점 경로에서 같은 높이·depth를 사용하며 모델 배율과 독립적인 글꼴 크기를 유지한다.
선택 authoring `spatialModelPreparer`는 native 씬 교체 전에 opaque 모델 handle을 WebGL2 renderer에 전달한다.
`WebGL2SpatialModels`는 batch 전체 upload를 staging하고 성공 전 기존 cache를 evict하지 않는다.
cache는 불변 CPU resource identity로 공유하므로 engine numeric ID가 바뀌어도 재사용한다.
preparation lease는 native 적용 성공 뒤 commit, finally dispose하며 pending GPU 자원도 진단에 포함한다.
모델 GPU 준비 실패는 entity/progress context를 변경하지 않는다. lease는 platform 자원이며 JSON/save에 넣지 않는다.
normal frame은 이미 준비한 자원을 소비하고 cold 준비 bytes는 lease에서 별도 보고한다. engine/frame ABI는 유지한다.
environment/FBO·동적 frame buffer의 첫 할당과 arbitrary callback 실패까지 포함한 전체 씬 transaction은 별도다.
모델 GPU upload는 ARRAY/ELEMENT buffer·texture unit과 unpack row/skip·PBO를 격리하고 cold upload의 WebGL 오류를 검사해 실패 staging을
해제한다. renderer의 실제 geometry budget 검증을 통과한 자원만 준비하며 warm frame에는 오류 polling을 추가하지 않는다.
M2 첫 재질 확장은 CPU primitive의 cutoff/양면 설정을 기존 attr3와 WebGL culling에 연결한다.
MASK는 같은 alpha 비교로 color/depth·point/sun shadow를 작성하고 양면 mesh의 뒷면 normal을 반전한다.
M2 후속은 normal map의 exported tangent XYZW를 CPU model 정점에 선택적으로 추가한다(32/48 bytes).
node normal/tangent 변환과 직교화는 GLB cold prepare에서 수행하고 native 80-byte pose ABI는 유지한다.
TS는 base/normal/emissive의 sampler와 색 공간별 texture 자원을 소유한다. GLB color는 두 renderer 모드에서
모두 sRGB8로 준비해 GPU 보간/mipmap 전에 linear로 해석하며 normal은 RGBA8을 유지한다.
HTTP prepare는 최대 파일 크기의 연속 버퍼를 단계적으로 확장하여 작은 chunk 참조의 누적을 막는다.
main pass의 normal unit 2와
emissive unit 4를 사용하며 caller texture/sampler state를 복구하고 legacy 정점에서 tangent attr 5를 해제한다.
shader는 glTF handedness·양면 최종 normal 반전과 linear emission을 처리한다. emission은 diffuse 조명 뒤,
fog/HDR composite 앞에 합성하며 shadow는 기존 base alpha만 사용한다. GPU 오류/부분 sampler 할당도 회수한다.
null을 반환한 allocation의 OOM flag도 cold 실패 정리에서 비워 즉시 재시도에 남기지 않는다.
material은 불변 asset/contentId에 속하므로 native pose ABI·instance별 Wasm 호출·기존 저장 버전을 추가하지 않는다.
`spatialTextureTransform.ts`는 GLB/분리형 glTF의 required-extension 허용 목록과 UV0의
`KHR_texture_transform`을 검사한다. 이미지 decode 전 f32 행렬/UV 중간 overflow를 검증하고 identity는 생략한다.
base/normal/emissive별 행렬은 CPU primitive에 보관하며 asset.byteLength와 재질 batch identity에 포함한다.
WebGL2는 main/shadow draw에 공통 base 행렬과 main 전용 normal/emissive 행렬을 전달한다.
WebGPU는 `webgpuSpatialMaterial.ts`의 144-byte material uniform(기존 48-byte 색/옵션 + 3×32-byte UV affine rows)을
color/shadow WGSL에서 공유한다. upload는 cold resource 준비에만 발생하고 warm frame 할당은 추가하지 않는다.
CPU alpha picking도 UV 보간 후 base 행렬을 적용한다. 정점의 UV0·exported tangent와 native ABI는 그대로다.
GLB의 image 준비는 `spatialModelImage.ts`의 격리된 임시 WebGL2 readback을 사용한다. Canvas 2D의
premultiply 왕복을 제거해 alpha 0 RGB와 부분 alpha 색을 보존하고, 이미지마다 다음 await 전에
texture/FBO·bitmap과 지원되는 임시 context를 해제한다. persistent model GPU upload와 구분되는 cold 준비다.
readback 실패·비동기 decode 취소도 활성 renderer state에 접근하지 않고 자원을 회수한다.
M2 건물 통합은 `SpatialTerrainSurface.render:false`인 보행/충돌 proxy를 지원한다.
Rust는 같은 surface/height tile을 물리·picking·debug에 유지하고 main/shadow 제출만 제외한다.
static terrain의 surface당 36 vertices와 절대 range index는 유지하며 material cast/receive도 0으로 제한한다.
cold metadata bit 4와 native capability v1을 사용하고 TS authoring은 씬 교체 전에 지원 여부를 확인한다.
frame v2·44-byte 정점·80-byte model instance 및 저장 버전은 유지한다. GLB 계층은 static bake,
assembly는 기존 fragment include/prefab, 보행층 연결과 벽 AABB는 명시적 world-unit 데이터다.
모델 geometry와 proxy의 자동 변환/추출 및 runtime parenting은 추가하지 않는다.
OPAQUE/MASK diffuse 변환이며 BLEND·glTF PBR, mesh physics, 자동 proxy 변환, skin/animation이나 3D editor는 범위 밖이다.

선택 environment는 기존 v1 numeric80을 보존하고 품질 설정에 v2 numeric112, 반구광·normalBias에 v3 numeric128, 광원 선택/cone/Bloom/AO에 v4 numeric512를 사용한다.
Rust는 원본 환경·native actor 초점·표시 camera/viewport·caster revision과 광원 면별 제출 범위를
소유한다. source camera/physics pose는 보존하고 직교 표시 camera만 opt-in pixel snap을 적용한다.
`spatial_scene/shadows.rs`의 repr(C) 16-byte 범위는 point cube face 0..5와 sun face 6을 구분한다.
material sidecar는 repr(C) 8-byte normal texture ID/cast-receive flags이며 기존 44-byte vertex는 유지한다.

TS `WebGL2SpatialEnvironmentPass`는 HDR RGBA16F/depth24 target, point cube 6면과 방향광의
단일 depth map, 13/25 sample DOF·HDR 색 보정·view-distance fog와 composite를 소유한다.
`spatialShadowCache.ts`는 native revision/matrix와 texture 내용 revision이 같을 때 GPU 결과를 재사용한다.
authoring/진행 복원의 camera/environment 조합은 read-only native preflight로 activation 전에 검사한다.
태양 matrix 생성 실패가 장면 교체 이후 발생하지 않도록 저장 camera도 같은 검증에 전달한다.
태양 방향은 f32 단위 벡터의 재정규화 오차가 저장 왕복에 누적되지 않게 보존한다.
알 수 없는 mutable texture와 RenderTexture는 재계산하며 native geometry 생성까지 생략하지 않는다.
normal atlas는 기존 asset loading 경로에서 none/linear 데이터로 읽고 크기·색 공간을 제출 전에 검사한다.
shader는 같은 atlas UV로 tangent basis를 계산한다. normal 미지정 시 기존 표면 normal을 유지한다.

고정 내부 해상도는 같은 native 표시 viewport로 nearest 정수 확대하고 최종 해상도 flat HUD 전에 합성한다.
legacy는 effect pass의 색 변환, linear-srgb는 기존 최종 encode를 유지한다. `EXT_color_buffer_float`가
필요하며 기능 제거를 조용히 적용하지 않는다. 상한은 point light 4개/point shadow 1개/sun 1개,
1,024 caster/면당 64 batch/HDR 8,388,608 pixel/내부 pixel target 1,048,576 pixel/blur 12 CSS px다.
PCF는 receiver당 최대 9회 비교이며 pass 수를 늘리지 않는다. 고급 DOF는 같은 composite에서 전경/배경을
분리 누적하고 기존 배경 위 전경 coverage를 확장한다. 중간 texture·반투명 다중 depth는 추가하지 않는다.

환경 진행 v7은 설정을 저장하고 native batch로 복원한다. frame 파생 초점·GPU identity는 저장하지 않는다.
기존 v5/v6 hash와 v1 numeric80 capture는 유지한다. 자원은 resize/disable/destroy에서 해제하고
그림자·효과 비용은 실제 draw/upload/resource 통계에 합산한다. authoring/restore 예산은 activation과
native commit 전에 검증한다. 내부 shadow/HDR pass는 외부 scissor/color mask와 독립적으로 초기화하고
composite 뒤 texture units 0..3, sampler·FBO·viewport 등 호출자 상태를 복원한다.
같은 frame flat HUD는 공간 자원을 유지하고 전체 flat frame 전환은 환경 target을 회수한다.
구체적인 제한과 별도 extension layout은 [공간 계약](../../engine/data-scene-spatial.md)을 따른다.
같은 gate의 `spatial-visibility-browser-fixture.mjs`는 packed public subpath로만 atlas/flip/native
playback·offscreen pivot·near/eye-plane clipping의 framebuffer를 확인한다. CPU는 실제 billboard quad의
보수적 frustum 판정을 하고 부분 절단은 GPU에 맡긴다. frame/flip은 UV를 바꾸며 body/발 pivot은
이동시키지 않는다. 회전 pivot/bounds는 Rust 회귀로 확인하고 JS에 simulation 상태를 추가하지 않는다.
같은 gate의 terrain fixture는 256 surface에서 v2 culling과 전체 v1 제출의 실제 framebuffer를 비교하고
제출 triangle/draw/upload와 invalid/empty range를 확인한다. 새 renderer는 v1 full submission도 받으며
구 JS/새 v2 Wasm의 혼합 지원은 주장하지 않는다. range는 borrowed frame 데이터이며 지연 사용 시 복사한다.
camera-only range 갱신은 configuration revision을 바꾸지 않으며 공간 progress에 draw 범위를 저장하지 않는다.

공간 debug는 `spatial_scene/debug.rs`가 같은 terrain/제출 billboard quad와 native heightSpan에서
11-float vertex의 endpoint pair를 생성한다. 기본 꺼짐이며 optional `spatial.debug` 독립 v1 확장을
사용해 기본 공간 v2/평면 ABI를 유지한다. native enable 시 최대 32,768 vertices를 예약하고
frame에서 capacity를 재사용하며 초과/비유한 geometry는 `truncated`로 노출한다.
TS는 world geometry를 재계산하지 않고 같은 camera로 기존 spatial shader/VAO와 영속 buffer에
`LINES` 1 draw를 제출한다. depth test/가려진 선 표시 모드 모두 depth write는 false이며 상태를 복구한다.
debugLineCount/debugDrawCalls/debugUploadBytes는 triangle/texture batch와 분리하고 전체 draw/upload에 합산한다.
전체 configure/reset은 debug 설정을 초기화하며 skip-render/restore는 stale frame 선분을 제거한다.
diagnostic 설정은 authoring/progress에 저장하지 않는다. collider footprint/contact 공간 gizmo는 별도 후속이다.
`spatial-debug-browser-fixture.mjs`는 실제 line/depth/upload 호출, occlusion/overlay 픽셀, camera/물리 높이
anchor, 잘못된 extension의 draw 전 거절, disable 뒤 원래 화면과 GPU 자원 수명을 검사한다.

`spatial_scene/connections.rs`는 optional authored `{from,to}` surface ID 연결을 cold-path u32 pair로
검증해 양방향 native gateway를 만든다. 다른 floor의 walkable shared edge만 허용하고
중복·모호한 경계를 거절한다. 연결이 있으면 새 `configure_spatial_scene_connected`로 임시 scene 전체를
검증·교체하며 기존 raw configure signature와 render ABI는 유지한다. terrain 교체 성공 시 기존 연결은 제거한다.
native 이동은 support/실제 collider center의 경계 통과·폭·step/drop을 검사하고 재사용 sweep scratch로
source/destination floor를 각각 probe한다. 시작/끝 penetration도 filter/heightSpan을 공유해 거절하며
실패한 substep의 XY/span을 복원한다. 작은 이동을 보존하고 실제 끝점이 destination 안에 있어야 commit한다.
중간 floor를 건너뛰는 다중 edge substep은 거절한다. generic stair/ramp의 암묵적 floor 추론을 spatial에서 차단한다.
JS는 validation/ID packing만 맡으며 simulation 이동/충돌/층 결정은 Rust가 소유한다.
연결은 authoring JSON으로 재구성하고 전환 pose는 기존 공간 v6 progress로 저장한다.
public consumer의 ramp→bridge·underpass·WASD·fresh restore framebuffer 검증은 `spatial-connections-browser-fixture.mjs`다.

`spatial_scene/navigation.rs`는 단일 spatial actor의 runtime 목적지 요청과 follower를 소유한다.
TS는 옵션 검증/숫자 인자 전달만 하며 Rust가 collider offset·floor support와 명시적 surface 연결로
4방향 sparse grid A*를 수행한다. 정확한 시작/목적지를 추가하고 모든 edge를 같은 native move/solid 검사로
probe한다. 탐색 중 임시 actor XY/span/velocity는 성공/실패 모두 복원하며 tick/event는 실행하지 않는다.
entity AABB의 공간 pose/접촉 분리는 `kinematic_sweep.rs`에서 sweep과 같은 rounded f32 모서리로
판정한다. center 거리와 half extent 합의 반올림 차이로 표면 접촉이 penetration으로 바뀌지 않게 하며,
접선/이탈 경로와 실제 모서리 겹침을 구분한다. epsilon 확대나 actor 위치 보정은 하지 않는다.
격자 node 4,096(+2)·probe/heap 32,768 외에 보수적 work를 요청 8M/frame 1M으로 제한한다.
`KinematicSweepScratch`는 동기 탐색 요청/추종 frame 안에서만 actor 이외 target collider/chain segment의
bounds를 준비·정렬해 재사용한다. AABB actor의 장애물은 AABB/OBB뿐 아니라 circle/capsule/convex/edge/chain과
compound child를 포함한다. 후보는 entity index로 축약하지 않고 collider·segment key를 유지하여 실제
장애물의 enable/trigger/filter와 body heightSpan을 판정한다. gateway pose overlap도 같은 후보를 사용한다.
준비/반복 work의 target 수는 collider/segment proxy 수로 청구하므로 compound 하나로 비용을 숨기지 않는다.
준비 단계는 proxy를 만들지 않은 disabled/invalid collider와 segment의 방문도 센다. Combat navigation과
action의 admission bound도 같은 방문 비용을 포함하여 실제 준비 후 frame 예산을 초과하지 않게 한다.
actor만 바뀌는 범위에서
사용하며 모든 정상 종료·거절에서 snapshot을 해제하고, 다음 요청/frame은 다른 body의 변경을 다시 읽는다.
준비 work는 alive 순회·target 정렬, 반복 work는 실제 target 수·surface·substep·candidate 정렬에 근거한다.
장식 entity의 순회를 edge마다 중복 청구하지 않으며 frame admission과 follower 비용에 준비도 포함한다.
follower는 최대 64회 iteration, f64 잔여 이동량과 실제 변위 정산을 사용하며 frame에서 재탐색하지 않는다.
현재/다음 support의 slope와 step/drop 허용량으로 frame 조각을 제한하여, 전체 edge와 부분 변위의
substep 수 차이가 유효한 경사면 경로를 막지 않게 한다. 기존 native collision 검사는 매 조각에 유지한다.
동적 solid는 blocked, WASD 기본 취소는 같은 frame 수동 이동, cancelOnInput=false는 follower가 전담한다.
평면/spatial follower 소유권을 분리하고 기존 movement animation에 target/마지막 motion/종료를 전달한다.
진행 복원은 navigation을 idle로 초기화하며 route/search는 저장하지 않는다. 기존 raw method 4개의 낮은 빈도
요청·상태·취소·6개 u32 통계 전달은 유지한다. 독립 optional `data_scene_spatial_move_diagnostics`는
v1의 5개 u32로 마지막 요청 사유·누적 요청 횟수·target 수·준비 work를 전달한다. TS는 이를
`SpatialMoveStats.lastRequest`로 해석하고 구 Wasm/미지원 진단 확장에는 생략한다.
실패 요청의 진단과 현재 설치된 route 통계를 구분하며 render ABI/authoring/save version은 바뀌지 않는다.
검증은 `spatial-navigation-browser-fixture.mjs`의 다리 위/아래·동적 solid·입력·fresh restore와 native 회귀다.

공간 physics debug는 `spatial_scene/debug/physics.rs`에서 기존 native collider shape 선을
실제 heightSpan bottom/top으로 변환한다. compound/chain child·offset/회전·enabled 판정을 재사용하며
body 없는 visual binding에 의존하지 않는다. floor ID는 native 카메라 방향의 stroke geometry다.
전체 endpoint 32,768 외에 entity 4,096·shape/segment 2,048의 순회 상한을 둔다.
접촉은 opt-in `KinematicSweepScratch`의 최대 128개 실제 선택 hit와 기존 rigid impulse snapshot 최대
256개를 읽는다. navigation probe는 기록을 끄고 gateway 가상 sweep·rollback도 제외한다.
마지막 nonzero 이동을 저장하며 actor pose/span이 달라지면 표시하지 않는다. collision pair/narrowphase를
render에서 재실행하지 않고 debug OFF에서는 trace reserve/push와 physics 진단 순회를 실행하지 않는다.
새 flag bit 16/32/64만 추가하므로 debug extension v1/render ABI v2/JS per-frame bulk 경계는 유지한다.
truncated는 vertex 외 work/hit 상한도 포함하며 native progress restore는 설정·기록을 초기화한다.

## 주요 기능 경계

| 영역 | 현재 기준 |
| --- | --- |
| Scene | `useDataScene()` generic data scene mode, Shooter/Breakout/Platformer starter scene, Minimal starter 예제 |
| Input | keyboard/mouse/pointer/touch/gamepad snapshot |
| Rendering | Rust render command buffer + WebGL2 기본 renderer, 선택 WebGPU sprite/debug line/fade 및 공간 geometry/model pass |
| Assets | texture/sound/JSON manifest, Aseprite/Tiled/LDtk import helper, deterministic texture atlas JSON helper |
| UI | DOM 기반 `UiOverlay`, 개발용 `DebugOverlay` |
| Physics | 자세한 범위는 [2D 물리엔진 기능 맵](physics-engine.md) |
| Runtime extensibility | projectile/weapon/prefab/motion/query/reaction/effect event 확장성 계약은 [Runtime Extensibility](../../engine/runtime-extensibility.md) |
| Effects | Rust particle/tween primitive와 Web runtime 연결 |
| Packaging | npm package/release 검증은 [npm 베타 패키징](../operations/npm-release.md) |

## 현재 제품 범위 밖

다음은 별도 설계/승인 전 제품 기능으로 확장하지 않는다.

- 전체 게임 루프의 Web Worker 이전 또는 Wasm threads
- visual editor
- multiplayer
- 범용 3D rendering. 승인된 제한적 HD-2D terrain/billboard/정적 GLB 배경 경로는 이 문서의 공간 계약을 따른다.
- user scripting/plugin runtime
- skeletal animation
- complex physics core expansion
- 외부 physics engine 의존성
- frame hot path의 entity별 JS/Wasm callback

## 검증 경계

문서만 바뀌면 Markdown 링크 검사와 `pnpm build:pages`를 우선 실행한다. 코드나 public API가 바뀌면 범위에 맞춰 다음을 추가한다.

- Rust core: `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- Wasm/API: `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`, `pnpm build`
- Game Spec: `pnpm validate:game-spec`
- 예제 회귀: [Smoke Check](../quality/smoke-check.md), `examples/topdown-shooter/SMOKE_CHECKLIST.md`


### 선택적 KTX2/Basis 에셋 경로

`TextureLoadOptions.ktx2Url`은 TS 자산 로딩 계층이 처리한다. WebGL2 capability 선택 후
별도 module Worker가 Basis v2.50 decoder로 ETC1S/UASTC를 ASTC/BC7/ETC2 block으로 변환한다.
Rust command ABI, texture ID 및 게임 시뮬레이션은 바뀌지 않는다. 이미지 URL은 항상 fallback으로
유지하며 native WebGPU는 이 이미지 경로를 사용한다. 같은 ID의 새 load/evict/destroy와
AbortSignal은 늦은 upload를 차단한다. 소유한 Worker와 공유 decoder의 수명을 구분한다.
고정된 공식 decoder와 라이선스는 package dist에 복사하고 SHA-256으로 검증한다.
[측정·배포·캐시 정책](../quality/compressed-textures.md)에 유지보수 및 지원 범위를 기록한다.


### WebGL2 셰이더 사전 준비

`WebGL2Renderer.create`와 factory의 `shaderPreparation`은 선택적 async 초기화 경로다.
5개 내부 shader source를 동기 생성과 공유한다. compile/link를 제출한 뒤 지원 기기에서는
KHR completion 상태만 poll하며 준비된 program을 생성자에 1회 이전한다. 이 scope는 동기
구성 직후 제거되므로 renderer/context를 넘어 program을 공유하거나 frame에서 조회하지 않는다.
미지원 기기는 link 조회 사이에 yield하며 해당 조회의 blocking은 남는다. AbortSignal,
timeout/context loss/compile/link 오류와 부분 생성 실패는 owned GPU 자원을 rollback한다.
로딩 UI는 renderer 준비 phase를 표시하고 전체 runtime/asset 준비 완료와 구분한다.

## Data Scene visual/body/view 연결

Data Scene spawn은 origin/tint/sortOrder와 명시적 depthSort를 Rust Sprite에 저장한다. Rust가 pivot 회전·culling·레이어 및 depth 정렬을 수행하며 15-float render ABI는 유지한다. optional static/kinematic/dynamic body는 sprite와 동일한 World entity/transform을 사용한다. reset은 entity generation을 보존·증가시킨다.

Dynamic body attach는 생성 시 기존 collider shape의 질량/관성 helper를 사용한다. TypeScript는
검증된 mass/tuning/material과 height span을 낮은 빈도로 전달하고 Rust가 simulation 상태를 소유한다.
일반 velocity 적분은 dynamic/static/disabled rigid body를 제외하며, Data Scene의 자동 solver가 켜지면
kinematic body도 일반 적분에서 제외해 중복 이동을 막는다. 수동 kinematic velocity 이동과 body 없는
legacy entity 이동은 유지한다. collider shape 공통 필터는 collider.enabled와 body.enabled를 함께 검사해
collision/spatial query/cast 경계를 일치시킨다. snapshot은 raw component를 읽으므로 disabled 상태도 보존한다.

TypeScript authoring viewer는 `scenePlacementVisualGeometry`로 동일한 pivot/scale/rotation 사각형을 계산해 picking과 공식·생성 viewer overlay에 사용한다. 이 계산은 authoring interaction에만 사용한다. runtime 소유 renderer와 Data Scene hex 색 변환은 같은 renderer option resolver를 공유하며 reapply/transition도 같은 working color space를 유지한다.

Data Scene camera follow/bounds/smoothing은 simulation 뒤 Rust에서 계산한다. TypeScript `createDataSceneView`는 renderer의 CSS zoom, pointer와 light/occluder 변환을 같은 camera snapshot으로 연결한다. 렌더러는 zoom에 맞춘 logical viewport와 원래 DPR backbuffer를 분리한다. [사용 계약](../../engine/data-scene-native-runtime.md).

Data Scene clip descriptor와 UV는 생성/재설정 시 Rust `SpritePlayback`에 설치한다. 전환은
generation handle을 포함한 stride-8 u32 batch를 검증한 뒤 원자적으로 적용한다. Rust가 시간·frame·
flip을 소유하며 기존 texture와 sprite/body를 유지한다. cold 설정 이외에는 clip frame allocation이 없다.

Primary actor의 opt-in 이동 애니메이션은 `engine/data_scene_movement_animation.rs`가 소유한다.
TS는 idle/walk의 네 방향 pose를 검증해 8개 `[clip, flipX, flipY]` 레코드로 한 번 전달한다.
Rust는 scene update 시작 위치와 경로의 다음 waypoint/마지막 실제 구간을 이용해 physics 뒤에 clip을
선택한다. 같은 clip이면 시간은 유지하고 flip만 적용하며, 다른 clip이면 elapsed를 0으로 초기화한다.
시간 증가는 기존 World playback update 한 곳에서만 한다. frame별 JS 호출/추가 allocation은 없다.
성공한 수동 playback 변경은 full-batch 검증 뒤 해당 actor 연결을 해제하므로 수동 연출을 덮어쓰지 않는다.
연결은 scene-owned transient state이며 reset/gameplay 재설정으로 제거한다. 기존 render/snapshot ABI는 유지한다.

`Camera2D.ground_y_scale`은 물리 transform과 별개인 render-only 값이다. Rust가 anchor/culling을,
WebGL2/WebGPU vertex shader가 회전된 ground quad의 local Y를 변환한다. `SpriteRenderCommand`는
15-float/60-byte를 유지한다. effectFlags의 bit 4는 ground projection, bit 8/16은 ellipse/box shadow,
bit 32는 현재 sprite alpha를 사용하는 ground shadow다
(여기서 숫자는 mask 값이며 기존 low effect bit와 독립이다). frame buffer metadata로 실제 scale을
한 번 전달하므로 내장 씬으로 전환해도 renderer/debug에 이전 scale이 남지 않는다.
alpha shadow의 `GroundShadowProjection`은 `#[repr(C)]` 세 f32(direction X/Y, length scale)로
Wasm에서 소유한다. bridge가 매 frame ptr로 새 typed view를 만들고 renderer의 공통 uniform으로
보낸다. entity별 추가 boundary 호출이나 command의 RGB/rotation 필드 재해석은 없다.
projection과 groundYScale은 `EngineFrameBuffers`에 render build와 함께 캡처한다. 다음 frame용
설정이 먼저 변경돼도 현재 command 중심/AABB와 shader의 projection이 어긋나지 않는다.
폭 축 `p=(sun.y,-sun.x)`와 길이 축 `-sun*lengthScale`의 행렬 B에 대해,
발 F에서 `B * rotation * diag(width,height) * (uvCorner-(0.5,1))`를 계산하고 마지막에 ground Y를
압축한다. Rust의 중심/AABB와 GL/WGSL vertex가 같은 순서를 사용한다. UV/frame/flip은 캐시된
geometry와 별도로 매 command에 현재 값을 복사한다. alpha texture 재사용으로 별도 mask/FBO는 없다.
renderer는 f32로 반올림된 최솟값 0.01을 허용한다. upright의 depth-sort pivot offset은 scale로
나눠 지면 단위로 비교하며, 기존 회전 독립 정렬과 ground sprite의 기준은 유지한다.
world text의 직립 block 높이도 같은 지면 단위로 환산해 sprite와 정렬한다.
점광원의 타원 falloff와 차폐물 거리/외삽은 같은 `radiusY / radius` 좌표계를 사용하고,
세로 반경 변경도 geometry cache를 무효화한다.

`GroundShadowCaster`의 explicit silhouette와 geometry cache는 Rust world component로 소유한다.
camera offset은 cache 밖에서 적용한다. transform/origin/alpha/sun/projection 변화로 무효화하고
despawn/reset에서 제거한다. culling 후 visible caster budget을 적용하고 일반 sprite batch에 제출한다.
caster마다 GPU resource/pass를 만들지 않는다. TS의 directional light는 기존 ambient/point-light
pipeline에 추가되는 flat additive pass다. [지원 범위와 비용 계약](../../engine/data-scene-presentation.md).


## Data Scene 탐험 실행 경계

DataSceneGameplay는 Rust에 있고 generic scene의 physics step 뒤 interaction/pickup을 실행한다.
primary actor는 World의 generation handle/예약 tag를 재사용한다. 입력 edge는 별도 이전 step 입력으로
비교하며 첫 fixed step에는 누적 press edge를 함께 소비해 연속한 짧은 입력을 보존한다.
frozen frame 및 pause/resume·gameplay 재설정에서 입력 기록을 동기화한다. CollisionScratch/pair buffer를 재사용하고
충돌 debug/event 출력 여부와 독립적으로 pickup을 처리한다. GameplayEvent ABI는 그대로 사용하며
variable/FSM event phase보다 먼저 event를 생성한다. Shooter의 점수·발사·적 spawning 정책을 가져오지 않는다.

Data Scene은 별도 Tilemap을 navigation 전용으로 소유하고 기존 A* scratch와 path buffer ABI를 재사용한다.
이 grid는 단일 XY 평면이며 renderer/물리 collider에는 설치하지 않는다. TS는 문서를 검증하고 초기화
명령을 호출할 뿐 frame별 충돌·수집·탐색 상태를 복제하지 않는다. `gameplay` opt-in 문서는 지원 executor를
명시적으로 검사한다. [public 계약](../../engine/data-scene-authoring.md)을 참고한다.

`engine/data_scene_navigation.rs`는 기본 지형 비용, 셀별 blocker count, 명시적 instance→cell binding을
Rust에 저장한다. query/이동 명령과 simulation step에서 bound generation/body/단일 collider 상태만
확인하고 변경된 칸의 effective cost와 경로를 갱신한다. step별 메모리 할당·전체 World 순회·JS callback은
추가하지 않는다. 겹친 obstacle 하나를 제거해도 다른 blocker나 지형 비용 0은 보존한다. save는 effective
0이 아닌 기본 비용과 stable ID binding을 담아 fresh handle로 재연결한다. 격자/clear/reset은 binding을 초기화한다.
기존 AABB sweep/ground probe의 solid filter도 비활성 rigid body를 제외해 navigation 통행 상태와 일치시킨다.
TS component/obstacle 검증은 binding plan과 같은 fragment·prefix·props 옵션의 instance를 사용하며
빈 슬롯 배열도 activation 전에 거절한다. collider 활성 setter의 성공 여부는 collider 변경 결과로
판단하고 body snapshot 갱신과 분리해 collider-only 개체를 지원한다.

Data Scene 진행 snapshot의 시뮬레이션 상태는 Rust World에만 있다. TS WeakMap은 성공한 전체
문서 apply의 원본 문서와 stable ID→원래 generation handle만 보관하며 live registry에서 제거된
객체도 추적한다. Rust scene epoch로 reset/씬 교체를 감지한다. 낮은 빈도의 capture/restore는
handle pair와 상태 u32 배열을 bulk 전달하고 navigation도 한 번에 복사한다. 프레임별 JS 왕복은 없다.
Rust restore는 전체 entity batch의 유효성을 먼저 확인한다. TS는 저장 문서의 ID/interaction 계약과
navigation을 activation 전에 검사한 뒤, 새 apply handle로 obstacle과 제거/consumed/physics 활성 상태를 연결한다.
Data Scene state v5는 body/collider flag·obstacle binding에 authored atlas playback과 native 이동 pose 연결을 추가하며 v2/v3/v4 읽기와 기존 hash를 유지한다.
flag가 없는 legacy 파일은 authored 기본값을 사용한다. 외부 binding override/누적 apply와
위치·timer·FSM·추가 spawn의 전체 세계 저장은 이 계약에 포함하지 않는다.


Data Scene navigation obstacle은 고정 칸 또는 opt-in live collider bounds로 Rust가 관리한다.
자동 source는 allocation 없는 clipped cell rectangle으로 유지하며, 활성/경계 변경 시 기존
overlay를 제거하고 새 overlay를 적용한다. 자동 collider는 최대 64개, 격자는 최대 4096칸이다.
Data Scene progress v5는 JS가 stable instance ID만 연결하고 Rust의 atlas playback과 이동 pose
policy를 cold-path bulk buffer로 캡처·복원한다. raw restore는 entity/physics/animation batch
전체를 검증한 뒤 적용한다. 공유 render ABI와 per-frame JS/Wasm 호출 수는 바뀌지 않는다.

정적 모델 묶음 `addSpatialModelAssembly`는 cold authoring 단계에서 모델-local AABB/사각 보행면을
기존 Scene JSON으로 컴파일한다. cardinal yaw와 단일 양수 scale만 지원하고 floorId는 전역으로 유지한다.
TS에 live 부모/자식 pose 상태를 두지 않으며 이후 이동·높이·충돌·path following은 Rust가 소유한다.
선택 assembly `children`은 cold authoring 입력의 정적 계층이다. 부모 기준 transform을 재귀 합성해
일반 world-unit 모델·충돌체·보행면으로 평탄화하고, 전체 결과를 한 번 검증한다. root 포함 깊이 8·64노드,
순환 참조·전체 ID 충돌·합성 scale/좌표 범위를 검사한다. 자식의 보행면으로 actor 계약을 완성할 수 있다.
저장은 생성된 일반 Scene JSON을 사용하고 원본 계층의 live state나 새 Wasm ABI를 추가하지 않는다.
assembly proxy 배열은 생략만 기본값으로 처리하고 null·빈 칸은 거절한다. collider의 최종 월드 AABB 경계와
높이 구간도 f32에서 유한·양수임을 확인해, 구성요소만 유효한 퇴화/무한 bounds를 native에 전달하지 않는다.
X-axis ramp는 기존 cold terrain metadata의 bit 5와 별도 capability v1로 확장한다. Surface의 동일
축/모서리 데이터를 native tilemap·층 연결·slope budget·render/pick/debug에서 재사용한다.
기존 공유 render layout·proxy capability·저장 버전은 유지한다. 자세한 제한은
[모델 묶음 배치 계약](../../engine/data-scene-spatial.md#정적-모델-로컬-proxy-묶음-배치)을 따른다.

공개 model frame sidecar는 ID→불투명 `SpatialModelAsset` 핸들만 전달한다. immutable resource identity의
vertex/index·decoded RGBA는 내부 WeakMap에 유지하고 WebGL2 cache가 해석하므로 공개 frame이 CPU
자원 소유권을 누출하지 않는다. 공간 지형의 bounds/overlap 검증은 numeric buffer와 동일한 f32
연산을 사용하며 model-local authoring 정규화와 최종 월드 bounds 검증을 구분한다. 축소된 폭/깊이는
TS 사전 검증과 native configure 모두에서 원자적으로 거절한다.

### 모델 attachment·LOD 경계

공간 모델의 native body yaw와 제한된 attachment DAG는 Rust가 소유한다. root setter와 물리 적분 뒤
자식 model/collider pose를 한 번의 native batch로 갱신한다. 유효하지 않은 batch는 commit하지 않으며
적분 실패는 마지막 유효 root로 복원한다. 저장 v8은 root yaw만 추가하고 child pose는 재계산한다.
정적 authoring bake와 살아 있는 attachment를 구분하며 보행면이 움직이는 묶음은 허용하지 않는다.

native chunk/LOD 정책은 카메라 거리·진입/이탈 hysteresis와 light visibility로 visual residency를 고른다.
기존 80-byte model draw ABI는 유지한다. CPU asset decode/cache/lease·GPU upload/release는 TS에 남고,
물리·보행면은 visual unload와 무관하다. 모든 LOD를 사전 등록하는 bounded 모델이며 자동 network
스트리밍은 제공하지 않는다. 선택된 geometry의 최대 제출 예산과 모든 LOD의 bounds를 cold preflight한다.
세부 저장/수명/지원 범위는 [공간 모델 계약](../../engine/data-scene-spatial.md)을 따른다.

### 밀집 프레임 진단과 matrix 제출

opt-in RuntimeProfiler frameTrace는 현재 renderer ID와 완료한 query의 발행 ID를 분리한다.
유한 history/window에 CPU·공간 draw/shadow/upload를 복사하고, 지연된 GPU 결과를 원래 frame에
연결한다. snapshot은 CPU 진단 데이터이며 simulation·Wasm view·GPU 동기 대기를 소유하지 않는다.
모델 matrix는 native 순서를 유지하는 pass별 batch 계획으로 한 번 업로드하고, 고정 512KiB GPU
버퍼의 독립 offset을 사용한다. 그림자 캐시는 실제 shadow 수요만 비교해 camera-only 변경의
무효화를 피한다. 80-byte native model ABI는 유지한다.

모델 primitive 색상/cutoff는 엔진 소유 main/shadow program의 uniform이다. context-global generic
attribute를 수정하거나 매 frame 조회하지 않으며, enable/pointer는 공간 pass 소유 VAO 안에서만
바꾸고 caller VAO/program 복원은 유지한다.


### Data Scene combat opt-in

개발 소스의 `gameplay.combat`은 기본 false이며 primaryActor와 함께 켠다. Rust Data Scene update 안에서
기존 movement/action/timer/collision/lifetime 시스템을 실행하고 generation-safe 동적 projectile을 소유한다.
TypeScript는 authoring 검증과 렌더 제출, 제한된 numeric sample만 담당한다. entity별 frame Wasm 호출은 추가하지 않는다.
동적 탄환과 기존 native particle preset을 spatial billboard 출력에 연결하고 HeightSpan을 유지한다.
기존 authored billboard 설정/저장 revision을 frame마다 변경하지 않으며 render command ABI는 유지한다.
기존 네 인자 gameplay 설정은 보존하고 전투용 v2 설정과 versioned stats를 별도 제공한다.
전투의 action timer만 반복 실행하며 event-only timer는 one-shot이다. pause/complete는 전체 전투 시뮬레이션을 멈춘다.
primaryActor input projectile은 cooldown tick 뒤, world integration 전에 기존 input registry/readiness/plan을 사용한다.
fixed-step latch를 씬 update 전에 전달하고 탐험 interaction과 같은 previous-input 보정을 사용한다.
발사 substep에서 곧바로 적분하므로 새 탄환의 CCD 경로를 과거 시점으로 계산하지 않는다.
spatial build와 입력 조준은 같은 presented-camera 계산을 공유한다. 현재 logical viewport/pixelArt 여백·snap을 반영하고
발사자의 body midpoint + visual elevation 평면에 ray를 교차시킨다. TS는 CSS→logical 좌표 변환만 수행한다.
입력은 별도 `data_scene_input_projectiles_version` v1로 검사하며 configure/stats/render ABI는 유지한다.
CCD는 projectile target mode와 compound collision filter를 nearest 후보 선택부터 적용한다.
전투 checkpoint는 native codec v1/v2/v3/v4와 nested Data Scene v9로 저장한다. 기존 탐험 progress/공간/animation ABI는 유지한다.
TS는 고정 authored ID와 의미 있는 JSON 필드를 숫자 buffer로 변환하고 원문 레시피의 presence/ID/범위를 검증한다.
Rust는 generation remap·live contact·체력/timer/cooldown·동적 projectile 상태를 소유하며 기존 공간 commit 뒤 적용한다.
죽은 발사자의 원래 handle도 authored index로 치환하고, 제거 commit 전에 새 source texture slot을 확보한다.
구형 Wasm/불완전한 전투 저장은 사전 거절한다. unsupported static mutation과 authored 외 동적 entity는 capture를 거절한다.
입력·accumulator·VFX/RNG·event/진단/통계는 reset하며 deterministic replay를 약속하지 않는다.
검증은 packed public API + 실제 Wasm의 HD-2D 전투 gate에서 수행한다.

melee/dash는 별도 `data_scene_combat_actions_version` v1로 검사한다. Rust가 공통 input registry/readiness와
timer dispatch를 재사용한다. melee는 post-physics/pre-despawn 단계에서 실제 overlapping collider의 mask·높이·
중심 시야·faction을 검증하고 기존 damage/kill 경로를 사용한다. dash는 kinematic AABB만 지원하며
공간 terrain/gateway trial·commit 또는 평면 타일 경계별 native sweep으로 이동한다.
collider offset을 포함한 지면 중심을 기준으로 분할하고 기존 velocity를 유지한다.
outer update당 별도1M work·128회 시도 상한을 metadata scan부터 적용하며 admission 전 피해/이동/cooldown을 commit하지 않는다.
TS는 마지막 entity/action ID의 종류에 따라 authoring·입력/타이머·프리팹 참조·저장 cooldown 계약을 검증한다.
기존 v9 actor payload로 위치·높이·체력·cooldown을 저장하며 restore는 pending melee/예산을 초기화한다.
위 melee/dash capability와 별개로 spawnPrefab 실행과 동적 actor 저장은 아래 spawn v1/progress3 capability를 사용한다.

native spawn 경로는 cold actor prototype catalog를 구성하고 생성·이동·충돌·타이머·수명·정리를
Rust가 소유한다. TS authoring의 `gameplay.spawnPrefabs`와 semantic checkpoint 공개 계약을 연결했다.
prototype은 단일 actor의 지원 컴포넌트를 복제하며 WorldSnapshot 전체를 생성마다 복제하지 않는다.
atlas clip 정의는 `Arc<[SpriteClip]>`로 공유하고 active clip/elapsed/pause/flip은 actor별로 유지한다.
spawn registry는 전체 Entity generation과 논리 serial/prefab ID를 구분한다. 죽은 발사자 기록은 살아 있는
소유 탄환이 참조하는 동안만 남기고 복원 시 World 슬롯과 겹칠 수 없는 내부 참조로 매핑한다.
생성 전 action work·World/actor/기록/nav 수와 실제 지형·벽·그림자 예산을 검사한다.
위치 검사를 통과하지 못한 임시 actor는 despawn 변수 트리거를 발행하지 않고 폐기한다.
native codec3의 spawned state는 전체 사전 검증과 allocator 용량 검증 뒤 common progress와 함께 commit한다.
기존 v1/v2 codec과 public render ABI는 유지한다. 현재 공개 계약은 [Data Scene Authoring](../../engine/data-scene-authoring.md)을 따른다.


### Data Scene projectile prefab catalog

`gameplay.projectilePrefabs`와 projectile action의 named ref는 TS cold authoring metadata다. texture asset 해석·sRGB 색상 변환·
f32 범위/상한·기능 검사를 activation 전에 수행한다. 전체 문서 apply는 ref를 action storage와 분리해 기존 setter ABI를 유지한다.
새 native configure v3는 metadata 2u32/definition, values 15f32/definition, binding 4u32/source-action을 받고
전체 catalog/handle/action/중복 검증 후 기존 gameplay configure와 함께 commit한다. 기존 v2 설정은 catalog를 비운다.
Rust가 generation/source/action 키의 bounded BTreeMap을 조회하며 탄환의 prefab ID를 native 소유 목록에 보관한다.
프레임별 Wasm 왕복·문자열·TS 시뮬레이션은 추가하지 않고 기존 sprite/billboard render ABI를 사용한다.
입력 조준과 spawn은 같은 prefab visual elevation을 사용하고 collider는 독립적인 world 단위를 유지한다.
최대 정의 256/source-action binding 8192이며 texture slot은 정점 f32에서 정확한 24bit 범위다.
원래 codec v1은 유지한다. catalog가 있는 checkpoint v2는 projectile stride 26(기존 25 + prefab ID)을 사용하며
JSON에서는 이 cold ID를 stable prefab 이름으로 변환한다. 복원은 원문 외형 계약을 검증하고, source가 제거되기 전에
fresh catalog의 texture/tint를 확보해 적용한다. 바깥 snapshot와 공통 progress/공간/render ABI는 유지한다.


### Data Scene combat navigation

`gameplay.combatNavigation`은 기존 직접 추적에 대한 선택적 확장이다. TS는 spatial terrain/카메라,
inline kinematic AABB/heightSpan, target과 agent 상한을 활성화 전에 검증한다. 설정 v4는 기존
v3 catalog buffer와 6개 f32(cell/step/drop/repath/radius/maxAgents)를 검증 후 원자적으로 적용한다.
기존 v2/v3 호출은 navigation 설정과 캐시를 비운다. 별도 capability v1과 13u32 diagnostics를 사용하며
기존 gameplay/spatial stats/render ABI는 유지한다.

Rust 전투 실행기가 최대 64개 generation-safe Chase route와 하나의 공유 A* search scratch를 소유한다.
outer update마다 정적 A* slice 또는 군중 보강 1회, 모든 agent의 검색·query 준비·이동에 총1,000,000
work 상한을 적용한다. 정적 탐색은 한 scene-owned job의 grid/heap/edge cursor를 보존하여 slice262,144·
전체8M work로 분할한다. 큰 준비 비용/원자적 단일 edge는 기존600K slice까지 허용하며
군중 보강의 기존600K 상한도 유지한다. 최대8개 footprint/target/revision별
정적 route를 공유하며 같은 support의 짧은 진입 edge를 native sweep으로 검증한다. 이후 edge도 실제 follower
물리를 통과해야 한다. 취소한 owner는 즉시 재시작하지 않으며 disposable job/cache는 save에서 제외한다.
별도 scheduler capability와10u32 진단을 추가하고 기존 navigation13u32와 v4/v5 설정 ABI를 유지한다. fixed substep도 같은 예산을 소비한다. actor마다 broadphase query를 새로 준비하고
즉시 종료하므로 다른 actor의 이동 후 stale proxy를 재사용하지 않는다. round robin 순서는 실제 시뮬레이션이 있는
outer update마다 한 번 이동한다. 0-substep 렌더 프레임은 순서를 변경하지 않는다. 경로가 없거나 예산이 부족하면 정지하며 직선 추적으로 돌아가지 않는다.

기존 native spatial navigation의 A*와 sweep follower를 explicit actor/step/drop 모드로 재사용한다.
combat source만 trigger AABB를 허용하고, sweep/pose overlap/gateway 양쪽 floor 모두 WALL 및 양방향
collision filter/HeightSpan을 적용한다. 일반 player route는 ALL mask와 기존 admission/status를 유지한다.
검색 probe는 성공·실패에 관계없이 원래 transform/heightSpan/velocity를 복구한다. AI 이동의 velocity는
적분 전에 0으로 바꾸고 이후 복원하여 중복 이동을 막는다. 극소 delta에서도 복원 velocity는 유한한 speed 범위다.

target generation/floor, source 변경, 지형/connection revision은 route를 무효화한다. target 이동·막힘은
간격에 맞춰 재탐색하고, 외부 source teleport는 follower pose 검사로 취소한다. 경로는 영속 시뮬레이션 상태가
아닌 캐시다. checkpoint는 기존 v9 authoring/pose를 저장하며 복원 시 캐시·진단을 비우고 재탐색한다.
TS 시뮬레이션, 프레임별 entity Wasm 호출, snapshot/render ABI 변경은 추가하지 않는다.


### Data Scene combat crowd

선택적 crowd와 Chase별 정지 거리는 configure v5의 navigation7f32(기존6+padding, -1은비활성),
source2u32/stop1f32 batch로 전달한다. 모든 값·generation·중복·source 소유권을 검증한 뒤 v4와 함께
commit한다. 기존 v4/13u32 navigation 진단은 유지하고 capability v1/7u32 crowd 진단을 별도 제공한다.
TS는 유효 recipe별 cold binding과 사전 진단을 담당하며, Rust가 위치/높이·경로·steering·도착을 소유한다.

최대64개 peer의 현재 World AABB/offset·mutual mask·floor/HeightSpan을 각 후보에서 읽는다.
segment/rectangle SAT는 나눗셈 없이 얇은 물체 관통을 막고, 기존 높이가 겹친 spawn만 단조 탈출을 허용한다.
후보 최대8개는 query 준비·벽 sweep·종점 보행면·neighbor 검사/실제 commit 비용을 예약하고
실패 시 원래 pose/span/velocity로 복원한다. 가상 probe는 contact를 기록하지 않는다.
실제 commit도 trial과 같은 요청 target으로 수행하고, commit 끝점의 peer sweep을 다시 확인해
f32 분할 이동의 누적 반올림 차이를 막는다. 실제 peer 거절은 이전 pose/span으로 rollback한다.
후보당24×peer 수를 예약해 trial/forecast/commit 세 번의 검사를 모두 포함한다.
기존1M/frame 예산을 공유하고 fixed substep에서 누적한다. 단기 detour credit과 peer lookahead는
스스로 직전 우회를 취소하는 진동을 줄인다. lookahead는 같은 flat support에서만 적용하는 steering 선호도이며
실제 이동의 native 검사를 대체하지 않는다. skip 전에 다음 waypoint까지 native full edge를 검증하고
실패하면 필수 코너 waypoint를 유지한다. shortcut도8후보와frame work에 포함한다.
초기/목표 변경 경로는 기존 static A*를 사용한다. 같은 목표의 crowd 경로는 repath마다
peer를 피하는 refinement를 시도하며 실패 시 유효한 기존 경로를 유지한다. peer검사는 native probe 전에
비용을 예약해 가지치기한다. peer4개 corner/goal8개 ring sample과 cell 이웃 순회도 기존4096 node/검색·frame
작업 상한에 포함한다. 도착 반경 안의 node에서 탐색을 마치고 실제 goal을 마지막 radius 중심으로 유지한다.
actual movement의 원 진입 prefix를 잘라 stop-distance 오차를 줄이며, 도착은 실제 floor/support를 확인한다.
동일 floor의 인접 surface도 선분이 실제 공유 edge 구간을 지나야 한다. 제3의 높은 지형 코너를
큰 probe가 건너뛰어 작은 follower가 영구 막히는 경우를 방지한다. 기존 player 경로도 이 검사를 공유한다. 중간 waypoint는 같은 보행면/연결된 인접 면의 cell 범위에서
진행해 혼잡한 grid 점 수렴을 줄이며 다음 이동도 기존 native sweep을 통과한다.
정지 반경은 native/peer probe 전에 이동을 잘라 적용한다. 32회 bounded 이분 탐색으로 f32의
실제 `from + (target - from)`까지 반영한 반경 안 점을 선택하며, 실제 거리·floor/support가 맞아야 도착이다.
clip 계산도 후보당512 work를 예약한다. 원을 정확히 표현할 수 없는 큰 좌표에서는 표현 가능한 안쪽 점을 사용한다.
같은 목표의 refinement는 저속/sub-ULP 이동 credit를 보존한다. 도착 pose를 캐시해 jitter를 막는다.
이 캐시는 source/target pose·generation·속도·지형 revision 변경 시 폐기하며 저장하지 않는다.


### Data Scene combat spatial movement patterns

선택 `combatNavigation.movementPatterns: "all"`은 Rust manager의 소유 범위를
Chase에서 SeekTarget/Accelerate로 확장한다. 기본/`"chase"`의 v4/v5 호출 경로는 유지하고
별도 native movement v1 capability와 v6 mode flag를 사용한다. TS는 최종 authoring movement,
모든 source의 AABB/kinematic/heightSpan과 최대64개 수용 여부만 preflight한다.
게임 방향/회전/가속과 실제 pose는 Rust가 소유한다.

SeekTarget은 이전 World velocity에서 waypoint 방향을 substep당 보간한다. 계산된 intent와 예산 미처리를
구분해 0을 거치는 반전이나 wall rejection에서도 회전을 누적한다. native edge 검사와 같은 support의
도착 원 최초 진입 clipping을 거친다. Accelerate는 기존 substep 가속/속도 제한 helper와 공간 velocity
trial/commit을 재사용한다. 가상 이동은 pose/heightSpan/velocity를 복구하고 query를 종료하며 실제 commit은
외부1M 예산 안에서 한 번만 수행한다. 선택 peer 회피는 세 pattern의 같은 live World footprint를 읽는다.
공통 wrapper는 managed velocity를 일반 physics integration 전에 잠시 0으로 바꾸고 이후 복원해
이중 이동을 막는다. 보류된 source의 momentum은 유지한다.

새 설정은 기존 v9 progress의 원문 authoring과 World velocity를 사용한다. 저장 구조나 render ABI를
추가하지 않으며 fresh apply 뒤 route/job/cache는 초기화한다. 구형 Wasm은 적용/저장/복원 preflight에서 거절한다.

### Data Scene spawned actor authoring와 checkpoint

공개 `gameplay.spawnPrefabs`는 기존 authored handle을 원본으로 cold 등록한다. native v7 설정은
공간 billboard 설정 후 적용하므로 정의가 같은 style을 캡처한다. 원본의 자동 생성/제거는 하지 않는다.
TS는 catalog 이름과 stable u32 ID·원본 standalone 계약 및 복원 전 상태/예산만 검증하고,
Rust가 생성·이동·수명·애니메이션·소유권과 제거된 탄환 발사자 lineage를 관리한다.
새 spawn v1 capability는 progress3와 v7 호출을 함께 검사하며 기존 melee/dash capability는 유지한다.
기존 combat codec1/2를 유지하고 codec3에 spawned89/serial counter를 추가한다.
JSON v3는 instance ID/spawn serial의 명시적 union으로 참조하고 actor prototype 이름을 저장한다.
common spatial/전투 pose와 model yaw의 중복 표현은 raw 값이 일치해야 사전검증을 통과한다.
생성 상태와 authored 상태를 함께 원자적으로 복원하며 기존 input/queue/route/cache reset 계약을 유지한다.


### Data Scene projectile presentation

선택적 projectile animation/rotateToVelocity는 native visual capability1와 cold gameplay v8로 설정한다.
TS는 최대256 정의의 metadata4/fps1/최대32 UV frame을 검증해 한 batch로 넘긴다.
기존 projectile catalog15-float 값과 renderer command ABI는 유지한다.
Rust는 immutable clip을 Arc로 공유하고 각 shot에 기존 SpritePlayback의 독립 f64 clock/pause/flip을 설치한다.
render 시 최대512 소유 projectile의 회전을 현재 presented camera의 투영 미분과 billboard basis 역변환으로 계산한다.
카메라 pixel snap/aspect와 실제 elevation을 반영하며 physics rotation/속도/AABB는 변경하지 않는다.
재사용 Vec를 cold reserve하고 generation-safe 정렬 cache로 flat/spatial command에만 적용한다.

animation 또는 align 정의가 있으면 codec4의 header7/shot32를 사용한다.
이전 shot26 뒤의 playback6는 present/clip0/elapsed/pause/flipX/flipY이며 별도 actor catalog bit로
catalog 없는 장면과 생성 source serial이 있는 장면을 구분한다. codec1/2/3 byte layout은 유지한다.
정의·clock·동적 UV·source를 전체 검증한 후 commit하며 각도는 저장하지 않고 다음 render에서 파생한다.
TS snapshot union은 v4 semantic animation을 제공하고 구형 Wasm은 active scene 교체 전에 거절한다.


### 광원 작성·선택 및 씬 효과 확장

환경 v4는 작성 광원 최대 16개와 활성 광원 최대 4개를 분리한다. Rust는 immutable 원본,
객체 generation binding과 camera 기반 영향도 선택을 소유하고 frame buffer에 위치/cone/활성 순서를 기록한다.
그림자 소유 광원은 고정 슬롯을 사용한다. TS는 cold instance ID 연결, 검증, UI draft/history 및 GPU 제출만 담당한다.
연결 대상이 없어져도 다른 generation을 추적하거나 원점에 빛을 비추지 않는다.
WebGL2/WebGPU의 scene HDR composite에 접촉 음영(깊이 법선 4+접촉 12), Bloom(32)을 넣어
톤 매핑과 HUD 전에 적용한다. sampler loop와 반경은 제한되며 warm frame에 target을 추가하지 않는다.
WebGPU uniform은 환경 512+카메라 16+행렬 112 floats, 두 개의 2,560-byte 슬롯을 재사용한다.
Authoring 뷰어의 광원 gizmo는 위치 작성 전용 DOM overlay이며 native buffer view는 frame 이후 보존하지 않는다.
객체와 광원은 같은 authored attachment pose 계산을 사용하고 광원의 world 위치는 draft 동기화 때 계산해 카메라 프레임마다 객체 계층을 탐색하지 않는다.
광원 연결의 정수 handle/generation은 cold configure에서 씬 교체 전에 확인하여 stale handle 실패가 기존 씬을 바꾸지 않게 한다.
`lightBindings`와 환경은 scene-wide patch/Undo/저장 경로를 공유하고 기존 v1/v2/v3 환경 입력을 유지한다.

## WebGPU 복구와 전체 맵 작성 경계

`webgpuRenderer.ts`는 stable renderer facade와 장치 수명·cold 복구를 소유하고,
`webgpuRendererBackend.ts`는 한 GPUDevice의 pipeline·pass·texture store·target을 소유한다.
손실 시 제출을 건너뛰며 `recoverDevice`가 private 대체 backend를 준비·검증한 뒤 교체한다.
동시 복구는 공유하고 실패·중간 destroy·복구 중 eviction을 검증한다. render command ABI와 Rust simulation은 변경하지 않는다.
관리 텍스처의 원본 Blob/RGBA와 현재/준비 모델의 opaque CPU handle만 보존한다.
현재 모델 묶음을 먼저 preload·pin하고 다음 준비 묶음을 preload하여 각각의 16개 상한과 합계 GPU byte 예산을 유지한다.
이전 프레임의 Wasm views나 과거 모든 모델 preload를 영구 보관하지 않는다. 사용 계약은 [Labs](../../engine/public-api/labs.md#webgpu-장치-수명과-복구)를 따른다.

`webgpuResources.ts`는 native device별 renderer 소유 allocation ledger다. 모든 내부 buffer/texture/pipeline 생성과
교체·해제가 동일 ledger를 사용하며 native GPU 객체를 Proxy로 감싸거나 prototype을 수정하지 않는다.
생성 중 실패한 pass의 allocation도 backend 생성 실패 시 일괄 해제한다. canvas/external device allocation은 소유하지 않는다.
형식별 저장량을 모르면 추정 합계를 생략하고 buffer 용량과 객체 수를 유지한다.
`webgpuGpuTimer.ts`는 opt-in timestamp pass 계측과 bounded 비동기 readback을 맡는다.
renderer pass가 공통 begin helper를 거쳐야 계측되며 runtime의 기존 begin/end 경계가 shadow/debug/post-process까지 포함한다.
WebGPU pass 시간 합계와 WebGL2 전체 query 구간은 다른 측정 범위다. profiler의 기존 GPU sample/자원 필드를 재사용한다.
손실 이전 자원·readback은 버리고 facade의 frame ID offset만 보존한다. Rust simulation/render command ABI는 변경하지 않는다.
계측 전용 동기 할당/제출 실패는 측정만 생략하며, runtime은 실패한 render frame을 `endGpuTiming(true)`로 폐기한다.
texture upload/등록 실패는 새 allocation만 rollback하므로 ledger와 기존 texture ID가 일치한다.

도트 제작은 app의 `placementPixelDocument`(원본 검증·픽셀 연산·transaction·bounded Undo),
`placementPixelCanvas`(포인터/CSS/DPR/zoom/pan), `placementPixelLayers`(이미지 레이어 패널), `placementPixelPng`(straight-alpha RGBA PNG 출력),
`placementPixelAssets`(불변 session revision·기존 component patch), `placementPixelTool`(에셋 탭·수명·내보내기)로 분리한다.
`placementPixelFrames`는 프레임 조작과 미리보기 RAF, `placementPixelAnimation`은 atlas UV/정수 시간의 기존 runtime clip 변환을 담당한다.
`placementFrameNormals`는 Aseprite와 자체 도트가 공유하는 rect별 Worker 생성·normal texture 수명·불변 pair 저장 구현이다.
`placementAsepriteNormals`는 기존 provenance를 유지하는 얇은 adapter이며 `placementPixelNormals`는 자체 source JSON hash·frame ID/rect·paired patch 검증을 담당한다.
도트 source/color는 pixel store, normal은 normal store가 소유한다. 재열기 시 JSON hash/rect를 pixel store와 대조하고 공유한 color texture를 중복 해제하지 않는다.
노멀의 최신 여부는 편집 revision/강도와 함께 color/normal store의 생존 여부·문서/저장된 프로젝트 범위를 확인한다. 적용 evidence는 원본 자산의 소유 문서가 아닌 적용한 씬의 key로 기록하고, 비동기 복원 중 store가 닫히면 entry를 다시 등록하지 않는다.
`placementAssetPatch`는 active fragment의 component scope를 검증한 뒤 같은 target의 normal binding만 spatial patch로 허용한다. 조명/카메라/다른 target 변경으로 권한을 확대하지 않는다.
`placementPixelTags`는 태그 metadata 편집·UI preview 범위 선택을 담당한다. v5의 stable frame/tag ID와 단조 증가 clip ID는 편집 원본에 보관하고,
`placementPixelAnimation`이 태그별 기존 runtime clip으로 변환한다. clip 변경 확인은 정확한 전후 set에 묶이며 기존 ID 제거는 차단한다. 게임/behavior 참조를 UI에서 재작성하지 않는다.
`placementPixelOnion`은 순환 없는 인접 프레임 선택을 계산하며 어니언 설정은 `placementPixelFrames`의 UI 상태다.
`placementPixelCanvas`는 최대2개 인접 프레임 합성을 offscreen canvas의 source-in으로 tint해 현재 이미지 뒤에 그린다.
설정·tint는 모델/PNG·history에 들어가지 않고 스포이트·그리기는 현재 프레임만 사용한다. 재생 중 표시를 숨기며 문서 교체/종료는 보기 설정과 event listener를 정리한다.
편집 원본은 app 전용 `ferrum2d.pixel-document` v1/v2/v3/v4/v5이며 runtime은 합성 PNG와 기존 scene-authoring `animationSet`만 소비한다.
v1의 단일 레이어를 유지하고 구조·표시·잠금을 편집할 때만 v2의 아래→위 `layers` 배열로 전환한다.
v2는 최대 8개·256×256·원본 3 MiB이며 고유 ID·이름·표시·잠금·독립 RGBA를 보존한다. 선택은 UI 상태이고 픽셀/레이어 편집은 64단계·실제 snapshot 16 MiB 이력을 공유한다.
프레임 편집은 v3로 전환한다. 공통 layer metadata와 프레임별 순서/ID/시간/cel을 최대16개·전체8 MiB RGBA·원본12 MiB로 제한하고 같은 Undo 예산을 적용한다.
합성 cache는 현재/인접 프레임을 위해 최대3개(256×256 기준768 KiB)의 RGBA만 보관하며 문서 변경/Undo에서 비운다. 화면 이동/확대만으로 모든 레이어를 재합성하지 않는다.
미리보기 재생 위치/프레임 선택은 UI 상태이며 게임 simulation을 갱신하지 않는다. 정지/blur/탭 전환/해제에서 RAF와 편집기 참조를 정리한다.
PNG는 최대4×4 atlas/한 변1024다. native와 TypeScript는 모든 frame cel·합성·padding을 검증하고 metadata 치수는 atlas 치수로 유지한다.
원본 ms의 GCD로 UV를 반복해 기존32-frame/f32 FPS clip0을 구성한다. 범위 초과는 진단하며 정확한 게임 적용을 막고 원본/PNG 저장은 유지한다.
같은 도트 source에서 생성한 기존 animationSet만 교체하고 수동 변경/다른 animation/normal binding을 보호한다. 게임 재생은 기존 Rust SpritePlayback이 소유한다.
레이어 패널은 ID별 행을 재사용해 이름 blur 직후 클릭과 키보드 포커스를 보존하며 IME 조합 키를 편집 명령으로 처리하지 않는다.
문서를 닫거나 도구를 해제할 때 행과 편집기 identity cache를 비워 닫힌 문서의 픽셀 이력을 붙잡지 않는다. 씬 탭으로 잠시 전환할 때는 이력을 보존한다.
도구 해제는 먼저 disposed/비활성 상태로 바꾸고 canvas 정리 콜백의 render·탭 갱신을 차단해 비운 프레임 패널이 다시 편집기를 참조하지 않게 한다.
`placementPixelAtlas`는 고정 외부 atlas의 정수 UV·비중첩·개수 검증과 rect 변환을 담당한다.
v4 원본은 전체 RGBA8/sRGB 시트와 atlas metadata를 보관한다. 선택 rect는 모델의 보기 상태이며 픽셀 연산의 경계이기도 하다.
프레임 변경은 source/history를 바꾸지 않고 canvas는 같은 rect로 표시·좌표 변환한다. 구조 변경은 차단하며 기존 v3 자동 atlas 배치와 섞지 않는다.
`placementPixelPng`의 RGBA8 decoder는 canvas 변환 없이 CRC·필터·Adam7·sRGB·팽창 상한을 검사해 다른 프레임과 투명 RGB를 보존한다.
v4의 새 texture revision 적용은 같은 atlas/UV의 정적 선택 객체만 허용한다. native도 같은 metadata·PNG 계약을 검증하며 runtime/API/ABI는 바뀌지 않는다.

기존 배치 뷰포트는 도트 작업 공간이 열려 있으면 키 입력을 가로채지 않고 도트 캔버스/폼에 위임한다.
TypeScript와 native 저장 호스트는 같은 정수 straight-alpha source-over 합성을 사용한다. v1 원본 400,000 bytes와 기존 bundle/catalog 버전은 유지한다.
공통 `sprite_assets::Contract`의 원본/PNG byte 상한을 형식별로 지정해 Pixel의 다중 레이어 허용이 Aseprite/타일 검증을 느슨하게 만들지 않는다.
Aseprite import와 독립된 에셋 제작 경로로 Rust simulation·Wasm ABI·공개 SDK export를 변경하지 않는다.
도트/씬 Undo와 입력을 분리하고, source 변경·문서 전환·종료 시 stale 결과의 씬 적용을 차단한다.
원본 검증·snapshot은 비동기 PNG 생성 전에 수행하며 revision을 provisional/committed로 나눠 실패한 적용만 rollback한다.
숫자 texture alias도 source 참조로 검사하고, export는 실제 authoring component/normal 경로만 이름으로 정규화한 사본을 만든다.
도구가 확인창의 수명과 operation epoch를 함께 소유하고, 앱 업데이트 guard는 도트 dirty/busy/gesture 상태도 확인한다.
`placementPixelProject`는 native pixel catalog의 원본/hash/PNG를 재검증하고 `placementPixelAssets`의 검증된 revision에만 프로젝트 범위를 부여한다.
desktop `pixel_assets`는 공통 `sprite_assets`/`asset_files`의 allowlist·bounded read·immutable 파일·catalog publication을 재사용한다.
도트 catalog만 optimistic SHA-256을 요구하며 기존 Aseprite/타일 저장 요청은 호환된다. 응답의 추가 `catalogRevision`은 기존 클라이언트에서 무시할 수 있다.
원본/PNG 저장 후 씬을 별도 저장하고 실패·취소는 이미 완료된 파일 저장을 되돌렸다고 주장하지 않는다.
검증된 원본의 의미 모델과 identity에 쓰이는 실제 JSON bytes를 구분해 불변 revision의 재저장을 보장한다.
같은 문서에서 의미가 같은 원본을 준비하면 기존 검증 revision을 재사용해 서식만 다른 원본의 ID/bytes도 유지한다.
원본 이름/ID의 Unicode·UTF-16 길이·빈 값과 JSON 정수의 값 판정을 양쪽에서 맞추고, metadata 치수만 정수로 정규화해 JS 왕복 시 불변 revision 충돌을 막는다.
저장 bundle과 PNG verifier는 비동기 작업 전에 입력을 복제하며 RGBA8 filter/Adam7 복원·끝 청크/CRC·sRGB 해석을 native/frontend 양쪽에서 검증한다.
재열기 시 catalog 자산은 씬 runtime 생성 전에 로드한다. 브라우저는 기존 export를 유지하며 프로젝트 디스크 삭제는 범위에 포함하지 않는다.

`ScenePlacementHistory.someSnapshot`과 viewer의 `retainsAssetReference`는 cold 자원 정리를 위한 보수적 참조 query다.
Import 패널은 모든 열린 문서·Undo/Redo·transaction·후보를 확인한 뒤 미저장 session revision만 정리한다.
프로젝트에 저장된 원본은 별도 project-wide 참조 검증 없이는 삭제하지 않는다. Import 진단은 원본 항목과 authored JSON pointer를
읽기 전용으로 연결하며 Behavior Recipe 본문이나 실행 상태를 편집하지 않는다.
Import 진단은 채널별 최신 불변 snapshot을 보존하고 이벤트는 변경 알림으로만 사용한다.
Problems의 늦은 초기화와 무관하게 동일 상태를 읽으며, 순회·pointer·결과 수를 제한해 오류 보고가 UI를 중단하지 않게 한다.

정적 모델 loader는 32개 이하 source primitive에서 인접한 동일 material 범위만 합쳐 제출한다.
동일 재질의 triangle 순서와 다른 재질 사이의 draw 순서를 유지하므로 coplanar depth tie를 바꾸지 않는다.
기존 32개 초과 모델의 material batching과 geometry/메모리 상한은 유지한다. cold load에서만 병합하며 frame마다 geometry를 재작성하지 않는다.

`placementTileMap.ts`는 검증된 tile import 결과와 원본에서 flat scene patch를 만드는 순수 authoring 변환이다.
실행·물리는 기존 Rust runtime이 담당한다. UI 소유 `props.tileMapImport`는 제한된 provenance만 저장하고
behavior binding/body나 게임 시뮬레이션 상태로 사용하지 않는다. merge와 viewer의 두 작성 경계가 같은 validator를 사용한다.
asset transaction은 components 수정뿐 아니라 definition/instance 추가·삭제와 기존 behavior binding 참조 복원도 preflight 뒤 한 Undo로 처리한다.
셀 identity는 grid 좌표이며 legacy index는 정확한 원본 revision으로 복원해 기존 ID/key를 유지한다. 미지원 authored prop은 변경 전에 거절한다.
저장 응답의 기준 문서는 깨끗한 새 viewer와 함께 공개하여 add-definition이 남은 초안과 중복 병합되지 않게 한다.
