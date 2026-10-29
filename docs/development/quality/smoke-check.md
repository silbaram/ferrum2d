# Ferrum2D Smoke Check

이 문서는 릴리스 후보나 큰 변경 후 실행할 smoke check 기준을 고정한다. 자동 검증은 빠른 회귀 확인을 담당하고, WebGL2 실제 렌더링/입력/오디오는 browser smoke와 수동 확인으로 보완한다.

광원 v3 회귀는 기존 `smoke:spatial-webgpu-offscreen`의 environment fixture에 연결한다.
`node tests/smoke/spatial-webgpu-browser-smoke.mjs --offscreen-target --environment-only`로 단독 실행할 수 있다.
각 WebGL2/WebGPU·직교/원근 조합에서 30개 환경 상태를 1280×720/390×844와 DPR 1/2로 검사한다.
반구광 sky/ground/방향·최종 노멀맵·unlit 불변, point/sun normalBias의 hard/PCF 실제 픽셀 이동과 변경 시 shadow cache 유지,
추가 shadow pass 없음, v3+actor focus·HDR·DOF 동시 저장/복원과 renderer 픽셀 parity를 assert한다.
단위 테스트는 legacy 80/112 buffer 보존, invalid v3 원자성, 명시적인 null 입력 거절, native 진행 복원, WebGPU 기존 uniform 할당 재사용·legacy 전환 초기화를 검사한다.
공식 viewer 조명 smoke는 기존 팝오버의 반구광과 두 표면 보정 입력도 native 값·문서·Undo/Redo·언어·compact 경계로 검증한다.
`node tests/smoke/placement-village-smoke.mjs --lighting-only`로 HD-2D 조명 조작만 실행하며 반구광 OFF/ON의 색·세기 보존도 확인한다.
같은 명령의 저장 회귀는 2D/HD-2D 모두에서 초점을 둔 값의 저장·잘못된 입력 차단·재열기를 확인한다. HD-2D는 반구광과 두 normalBias, 꺼진 반구광의 색·방향·밝기 보존도 검사한다. 파일 호스트만 public bridge로 모사하며 작성·렌더·페이지 재로딩은 실제 경로를 실행한다.

로컬 `artifacts/`는 현재 작업의 검토·검증과 설치 복구에 필요한 동안만 보관한다. 종료된 작업의
결과는 확정 문서에 요약하고 중간 로그·반복 실행·임시 설치 사본은 삭제한다. 문서에 출력 경로가
있다는 이유로 해당 디렉터리를 영구 보존하지 않는다. 과거 보고서가 필요하면 생성 명령부터 다시
실행한다. 현재 미커밋 작업의 최종 검증 자료와 실제 복구에 필요한 백업은 작업 정리 전까지 유지한다.

Placement Viewer의 Three.js 참고 고도화 회귀는 `placement-threejs-upgrades-smoke.mjs`에서 검사한다.
`placement-spatial-workspace` browser mode에 연결되며, 단독 확인은 viewer 빌드 후
`node tests/smoke/placement-village-smoke.mjs --threejs-only`로 실행한다. 모델 HTTP 실패→원래 bootstrap 재시도,
촬영 범위 가이드의 authoring 보존, mesh bounds 빈 공간 선택 제외, X축 이동·단일 Undo·회전 취소,
native 원형 충돌체 진단, EN/KO, 조작부 위 wheel, 2D/HD-2D 전환·반복 Play/Stop의 GPU 할당 plateau와 종료 후 자원 0을 확인한다.
실시간 게임 카메라만 확인하려면 같은 script의 `--game-camera-live-only`를 사용한다. 수동 편집 구도 보존과 자동 맞춤의 resize 계약을 구분한다.
`pnpm test:placement-scenes`는 로딩 retry/cancel/교체/영구오류 Close/dispose·Escape 취소를 추가 검증한다.
취소를 무시하는 decode가 완료되기 전 caller가 해제되고 늦은 실패도 처리되는지 검사한다.
`pnpm test:placement-camera`는 종횡비/높이/원근·직교 geometry fit과 깊이 범위, 좁힘→넓힘 시 배율 복구,
표시 행렬의 화면 모서리 near/far 역투영을 검사한다.
SDK `spatialModelPicking.test.ts`는 삼각형/앞뒤 면/MASK/normal-map stride와 입력 거절,
native LOD snapshot·camera visibility·generation 전달·owned matrix·구 Wasm fallback을 검증한다.
`placement-model-picking-smoke.mjs`는 spatial gate에서 DPR 1/2와 직교/원근의 실제 LOD 외형·MASK 구멍,
런타임 정지 후 새 camera 입력과 기존 표시 화면의 선택 일치를 검사한다. 단독 실행은
`node tests/smoke/placement-village-smoke.mjs --model-picking-only`다.

## 제품 Runtime Budget Readiness

런타임 렌더러 계약의 확장성은 SDK `runtimeFrameRenderer`/`createFerrumRuntime.integration` 테스트로 검증한다.
class private 상태를 포함한 타입 단언 없이 custom renderer와 최소 command sink를 전달하고,
미지원 디버그 요청이 frame target 변경 전에 실패하는지, GPU timer의 종료와 외부 자원 소유권이 유지되는지 확인한다.
공통 spatial 통계·camera 타입 이동은 기존 WebGL2/WebGPU 테스트와 public API/실제 tarball import 검사로 함께 검증한다.

제품 runtime budget 기준은 "빠른 CI gate", "tag/manual opt-in gate", "수동 브라우저 확인"을 분리한다. 성능 회귀는 감각적인 설명보다 아래 matrix의 report, hash, budget artifact로 논의한다.

| 제품 기준 | 명령 | gate 위치 | evidence |
| --- | --- | --- | --- |
| Runtime budget profile 계약 | `pnpm smoke:runtime-budgets` | CI 기본 gate, `smoke:check` | `tests/smoke/runtime-budget-profiles.mjs`의 profile/mode mapping 검증 |
| WebGL2 RenderTexture | `pnpm smoke:render-texture` | CI workflow의 validate job, `smoke:check` | DPR 1/2, offscreen 1,024 sprite + main 1 sprite + fade, 총 3 draw calls, 픽셀 방향/상태 복구/resize/해제 검증 |
| 셰이더 준비 | `pnpm smoke:shader-preparation` | CI workflow validate job, `smoke:check` | DPR 1/2 동기/비동기 픽셀 일치, 5 programs, 실패 cleanup, runtime 로딩 UI |
| KTX2/Basis | `pnpm smoke:ktx2` | CI workflow validate job, `smoke:check` | raw ESM/Vite 번들, 실제 Worker·압축 upload·화질·fallback·취소·해제 |
| GPU 자원 수명주기 | `pnpm smoke:gpu-resources` | CI workflow의 validate job, `smoke:check` | DPR 1/2, legacy/linear-srgb, 1,024 sprites, 12회 씬 전환 후 warmup 기준값 복귀, resize/해제, 실제 profiler 예산 검증 |
| 색 공간 관리 | `pnpm smoke:color-management` | CI workflow의 validate job, `smoke:check` | DPR 1/2, legacy/linear-srgb 픽셀·조명·bloom·alpha·fallback, 1,024 sprites에서 1/2 draw calls |
| Rust-side 대량 오브젝트 budget | `pnpm smoke:mass-objects` | CI 기본 gate, `smoke:check` | `ferrum2d.mass-object-stress.smoke-report` JSON과 scenario replay hash |
| Physics solver/query budget | `pnpm smoke:physics`, `pnpm smoke:physics-replay` | CI 기본 gate는 `smoke:physics`, release 후보는 replay까지 실행 | scenario seed/frame/suite hash와 Web replay helper state hash |
| Starter Runtime WebGL2 기본 경로 | `pnpm smoke:starter-runtime`, `pnpm smoke:browser-budget` | `smoke:check`, release 후보 수동/로컬 gate | Browser render smoke report와 `RuntimeProfiler` budget report |
| Scene Placement Viewer browser/desktop smoke | `pnpm smoke:placement-viewer`, `pnpm smoke:placement-viewer-save`, `pnpm smoke:placement-viewer-mass-authoring`, `pnpm smoke:placement-viewer-desktop-assets`, `pnpm smoke:placement-viewer-desktop-package` | viewer/save는 CI validate와 `smoke:check`, 나머지 browser 항목은 `smoke:check`. Linux debug deb/GUI launch는 로컬 수동 후보 | 공식 placement viewer production build, Data Scene preview, picking/edit/patch/save, mass authoring, fake Tauri asset bridge, Linux debug deb artifact와 optional Xvfb process launch. native picker/save/protocol/nonblank canvas는 release 전 수동 GUI evidence도 요구 |
| 프로젝트 씬 탐색 | `pnpm test:placement-scenes`, `pnpm smoke:placement-viewer` | Node 계약과 viewer browser 검증은 CI validate, native 계약은 desktop Rust tests | bounded 탐색·symlink/경로 거절·문서 오류, 중복 탭/초안 보존, 선택 씬 열기·실행 실패 격리, 한영/compact/키보드/폴더 Export Only, fake native의 최신 자산 문맥과 활성 씬 저장 |
| 엔진·에디터 업데이트 | `pnpm test:updates`, `pnpm smoke:placement-viewer`, `pnpm test:github-release` | CI Node/공식 viewer gate, native authority는 desktop Rust tests | beta 숫자 비교·draft/불완전 release 제외·페이지 탐색·오프라인·변조 차단, 실제 npm/pnpm 임시 consumer 설치와 hook 미실행, metadata/lock 복원 및 실패 보고. 화면은 fake native로 진행·재시작·미저장/실행 중 차단·늦은 응답·한영/compact를 검사. 서명 자료 staging/assembly는 모의 tool output이며 실제 OS 설치·서명 검증 evidence는 native release gate에서 확인 |
| 엔진·전체 뷰어 분리 배포 | `pnpm test:github-release`, `pnpm release:distribution:prepare`, `pnpm release:distribution:verify` | release 계약 테스트는 CI validate, native release build는 수동 release workflow의 `include_viewer` | SDK v1 네 tarball 계약 보존, native OS installer/내장 Wasm 검사, 새 출력 보존, 버전·커밋·플랫폼 일치와 통합 SHA-256. 모의 산출물 테스트와 실제 OS build/GUI 증거를 구분. [배포 절차](../operations/github-release.md#엔진과-전체-뷰어-앱-분리-준비) 참고 |
| 2D 레이어 authoring | `pnpm test:placement-layers`, `pnpm smoke:placement-viewer`, `pnpm smoke:placement-viewer-save`, SDK `scenePlacementLayers`/`sceneSpatialPatch` tests, Rust `flat_preview_filter` test | CI layer contracts·viewer/save browser smoke와 SDK/Rust gate | canvas/command 감소, 숨김 피킹·공간 API 편집 차단, 단독 보기·Undo·모드/필터 복원, 저장 후 단독 보기·활성 레이어·개별 잠금 보존, preview 오류 후 선택 복원, 이동·순서 Undo·animation·별칭·한글을 확인. SDK는 f32/signed-zero 정렬과 batch bounds 1회 갱신, layer contracts는 512개 그룹의 1회 분류를 검증. 캡처·checks: `artifacts/placement-layers/` |
| Placement document save contract | `pnpm smoke:placement-document-store`, `cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml` | CI validate | 웹 host의 기준 JSON 비교·동시 요청 직렬화·임시 파일 정리, native 저장의 stale baseline 거부·정상 교체·invalid 요청 보존. desktop Linux 개발 의존성 필요 |
| Top-down Shooter browser budget | `pnpm smoke:topdown-mass-objects`, `pnpm smoke:topdown-tilemap-budget`, `pnpm smoke:topdown-budget` | mass/tilemap은 CI 기본 gate, full topdown budget은 tag/manual opt-in | Playing state, entity/render command 규모, draw/texture/collision budget |
| Breakout/Platformer browser budget | `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget` | tag/manual opt-in | 장르별 production build render/runtime budget artifact |
| Physics Sandbox browser budget | `pnpm smoke:physics-sandbox-budget` | tag/manual opt-in | Physics demo browser render path와 debug line/runtime budget artifact |
| Gameplay canonical replay | `pnpm smoke:gameplay-replay`, `pnpm smoke:gameplay-replay:report` | CI는 report, 로컬 quick check는 basic smoke | committed golden fixture hash, machine-actionable replay report |
| Package consumer smoke | `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`, `pnpm validate:consumer-smoke-report -- --expect-status passed` | tag/manual opt-in | local tarball install, generated template build/deploy-readiness report, 가상 하위 경로의 Playing/runtime 규모/draw call 예산/WebGL2 픽셀 변화/Wasm MIME browser smoke, generated placement viewer grouped Selected Inspector/Handoff action state/Project Assets Add Sprite/ObjectDefinition/Behavior Binding browser smoke, agents dry-run/install, consumer report artifact |
| Pages demo readiness | `pnpm build`, `pnpm build:pages`, `pnpm validate:pages-artifact` | Pages workflow, release candidate local check | Pages route/link validation과 ignored `dist-pages/` artifact |

browser budget smoke에서 `FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR=artifacts/browser-smoke-budgets`를 설정하면 `tests/smoke/browser-render-smoke.mjs`가 `ferrum2d.browser-smoke.runtime-budget-report` JSON artifact를 저장한다. artifact는 `mode`, `budgetProfile`, `distDir`, `url`, `runtimeBudget.budget`, `runtimeBudget.report`, `runtimeBudget.snapshot`을 포함해야 한다. `runtimeBudget.report.passed`가 `false`이면 command는 실패하고, missing metric은 `missingMetric` budget violation으로 다룬다.

WebGL2 기본 경로는 제품 renderer 기준이다. WebGPU optional smoke(`smoke:lighting-webgpu`, `smoke:material-webgpu`)는 capability-aware로 동작하며 WebGPU 미지원 또는 fallback 환경을 제품 실패로 보지 않는다. 단, WebGPU 기능이 사용 가능하다고 보고된 환경에서 해당 renderer stats가 누락되거나 WebGL2 기본 경로까지 깨지면 회귀로 본다.

`pnpm validate:runtime-budget-product`는 package script, runtime budget profile mapping, CI 기본 gate, tag/manual opt-in gate, Pages readiness 문서와 artifact report 경로가 빠지지 않았는지 확인한다.

씬 탐색기 browser evidence는 `artifacts/placement-scene-explorer/report.json`과 한글·compact screenshot에 남긴다.

공식 production viewer의 기본 화면은 465개 instance의 2D 정원이며 공개 씬 catalog는 정원·HD-2D 마을 2개다.
`placement-production-default-smoke.mjs`는 실제 production bundle에서 기본/별칭 진입·예제 2종·중복 탭·Play/Stop과
구 기본 2D·HD-2D JSON의 404와 `?scene=hd2d`의 마을 진입을 검사한다. 465개 오브젝트에서도 왼쪽 탭이 줄거나 잘리지 않는지,
프로젝트 씬 클릭과 키보드의 오브젝트 탭 복귀가 가능한지도 확인한다. 기초 편집/공간 회귀는 `tests/fixtures/`의
`placement.scene-authoring.json`·`placement.hd2d.scene-authoring.json`을 `placement-test-build.mjs`가
`mode=test` 임시 build에만 추가해 실행한다. production dist/public을 덮어쓰지 않는다.
공식 viewer/save/mass/spatial smoke report는 `productionDefault`와 `regressionBuild`로 두 증거를 구분한다.
desktop asset/CSP smoke는 실제 production JS와 mock native 문서를 그대로 사용하며 새 test bundle로 대체하지 않는다.
공간 회귀는 짧은 창에서 아이콘의 숨겨진 접근성 문구가 페이지 스크롤 영역을 늘리지 않는지,
live 카메라 값을 Enter로 확정한 뒤에도 같은 입력칸에서 키보드 편집을 계속할 수 있는지 검사한다.
업데이트 browser evidence는 `artifacts/placement-updates/report.json`과 한글 compact screenshot에 남긴다.
실제 native updater 설치와 OS별 서명 검증은 모의 RPC/산출물 테스트로 증명하지 않는다.
릴리스 HTTP 설치 smoke는 기존 URL 생성기 bin 추론과 `ferrum-update-game --help`도 실행해 multi-bin 패키지 호환성을 검사한다.
리뷰 회귀는 저장 후 2 MiB 초과 거절/원본·임시 파일 보존, 접근 불가 하위 경로의 부분 목록·진단,
공유 프로젝트 에셋의 두 번째 씬 열기·저장·원본 탭 닫기 후 실제 픽셀과 URL 수명, 임의 문서 참조 거절을 검사한다.
`project-assets.json`이 해당 브라우저 결과이며 Node 계약에는 scope/lifetime 및 기존 native normal/tile 계약도 함께 확인한다.
native 항목의 `fakeBridge`는 실제 Tauri GUI 검증을 대체하지 않는다. headless native 계약은
`cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features`로도 실행할 수 있다.

## 로컬 자동 sanity check

`pnpm test:placement-locale`는 한국어 catalog의 매개변수 계약, 영어 복원·알 수 없는 키 fallback,
ID/경로/JSON 매개변수 보존과 저장 언어/브라우저 언어 우선순위를 검사한다.
`pnpm smoke:placement-locale`는 준비된 ferrum-web JS/엔진 Wasm과 Chromium으로 공식 app production build를 실행하는
opt-in gate다. 기본 CI에는 연결하지 않는다. 실제 2D/HD-2D의 한국어↔영어 전환, 초안·patch·이력·선택·카메라·live handle 보존,
비활성 문서 탭 복귀·동적 안내·에셋 도구·접근성 이름, compact 화면의 선택기 접근과 저장값 재사용을 검사한다.
저장값 없음/손상/저장소 차단 환경과 한국어 브라우저 기본값, 포함된 한글 글꼴 로딩도 확인한다.
문서 탭 교체 자체는 기존 native preview 재적용으로 handle을 갱신할 수 있으며 언어 전환 단독의 handle 보존과 구분한다.
근거는 `artifacts/viewer-localization/verification.json`과 한국어 screenshot이다. OS 파일 선택창과 raw engine 진단,
실제 Tauri GUI는 이 gate의 번역/실행 검증에 포함하지 않는다.

`pnpm test:placement-grid`는 별도 Wasm 없이 2D 원점 정렬·pan/zoom·최소 배율 예산과 HD-2D X/Y ramp 높이,
surface 경계·비가시 surface 제외·대규모 선분 상한·입력 불변을 검사한다.
작업 평면의 가시 영역·명시적 높이·원점 정렬, perspective 수평선/평행/뒤쪽 ray, 원근 거리 fade·직교 alpha 보존과 중복 구간 alpha도 검사한다.
`pnpm smoke:placement-grid`는 ferrum-web JS/엔진 Wasm과 Chromium을 준비한 뒤 공식 app production build에서 실행하는
opt-in gate다. CI 기본 gate에는 추가하지 않는다. 2D/HD-2D × DPR 1/2의 Grid 실제 픽셀 차이·draw call 증분,
Grid/Snap 독립성·간격 입력·camera 탐색·resize·floor 필터·Proxy Overlay와 문서/Undo 불변을 확인한다.
bridge/billboard 뒤의 격자 가려짐을 framebuffer로 비교하고 orthographic/perspective·지형 없는 reference plane,
Game Preview 숨김/복원과 pagehide 뒤 GL buffer 잔여 0을 검사한다.
공식 app WebGL2 전용 변경이며 engine WebGPU 동등성이나 실제 기기 성능을 검증했다고 간주하지 않는다.
근거는 `artifacts/viewport-grid/verification.json`과 DPR별 screenshot이다.

`pnpm smoke:placement-village`와 CI의 village browser gate는 `placement-working-grid-smoke.mjs`를 함께 실행한다.
DPR 1/2에서 마을 바깥 격자의 실제 framebuffer 차이, 기본 지형 배치의 빈 공간 거절, 명시적 평면의 음수 snap,
sprite click/model drop의 ghost·patch·높이·층 일치와 native sprite 높이·층을 검사한다. terrain/collider 자동 생성 여부,
Undo/Redo, 표시 설정·camera·Game Preview 전환의 JSON/history 보존, 빈 terrain의 perspective camera와 512선·1 draw 예산도 확인한다.
근거는 `artifacts/working-grid/dpr1.json`, `dpr2.json`과 한국어 ghost/빈 씬 screenshot이다.

`pnpm test:placement-camera`는 상하 회전의 target·거리·yaw·직교 높이/원근 FOV 보존, 입력 불변,
반복 회전·1~89° 상하 한계·유효하지 않은 입력 거절, 직교 렌더 카메라의 pitch/height/작업 높이별 전체 평면 깊이와
화면 투영 보존을 검사하며 CI geometry/locale step에 포함한다. grid 수학 검사는 낮은 각도의 수직 선 간격도 검사한다.
`pnpm smoke:placement-camera`는 준비된 JS/Wasm으로 app을 빌드하고 village gate의 `--camera-only` 경로를 실행한다.
같은 `placement-spatial-camera-smoke.mjs`는 기본 village smoke/CI에서도 실행한다.
직교/원근 × DPR 1/2에서 버튼·슬라이더 키보드/마우스, native 투영 변화, target/거리/화각 보존, 한계 버튼 비활성화,
pan 뒤 각도 유지·컨트롤 재활성화, 배경 bounds를 UI 잠금으로 제외한 캐릭터 선택·지형 배치 ghost,
Game Preview/Stop·Reset·문서 탭별 각도 복원과 한국어 접근성 이름을 검사한다.
JSON/patch/history·작업 평면 불변, native entity 46개, 격자 512선·1 draw와 전체 160 draw/60,000 triangle 상한도 확인한다.
근거는 `artifacts/spatial-camera-angles/dpr1.json`, `dpr2.json`과 낮은/높은 각도·한국어 control screenshot이다.

`pnpm smoke:placement-grid-viewport`는 준비된 JS/Wasm으로 app을 빌드한 뒤 village gate의 `--grid-viewport-only` 경로를 실행한다.
동일 `placement-grid-viewport-smoke.mjs`는 기본 village smoke/CI의 DPR 1/2에서도 실행한다.
직교 카메라의 낮은 각도·축소·pan/orbit·resize·작업 높이 변경과 빈 씬에서 화면 모서리의 native projection/clip을 검사한다.
격자를 켜고 끈 실제 framebuffer 상단/하단 band의 픽셀 차이를 비교해 가운데 띠로 줄어드는 회귀를 검출한다.
46개/0개 entity, 512선·1 grid draw와 160 draw/60,000 model triangle 예산,
JSON/patch/history 보존, 탐색 camera Stop/Reset 복원 및 게임 camera 행렬 불변도 확인한다.
빈 씬의 화면 가장자리에서 작업 평면 ghost를 실제 pointer로 표시하고 다시 native projection으로 돌려 배치 ray도 검사한다.
근거는 `artifacts/grid-viewport/dpr1.json`, `dpr2.json`과 축소/빈 씬 screenshot이다.

`pnpm test:sprite-normals-tool`은 네트워크/외부 binary 없이 config·설치 provenance·binary hash,
입력 snapshot·원본 변경 감지·symlink/출력 충돌·native 부분 실패·발행 경쟁의 정리를 검사한다.
동일 gate에서 유리수 delay/GCD·32 frame/FPS 한도·명시적 loop·메타데이터/알파/패킹 오류,
pair layout/padding 픽셀·반복 UV·PNG inflate 상한과 파생 출력 충돌의 transaction 정리도 검사한다.
CI validate job에서 직접 실행한다. 실제 generator 검증은 `pnpm normals:install` 뒤
`pnpm smoke:sprite-normals`로 실행한다. 미리 빌드한 ferrum-web JS/Wasm과 Chromium이 필요하다.
실제 고정 CLI의 PNG/batch·neutral normal·투명도·원본 hash·uniform sheet 경계와 sidecar를 검사하고,
WebGL2에 생성된 non-color atlas를 로드해 평면 조명 대비 픽셀 차이·sRGB atlas 거절을 확인한다.
근거는 `artifacts/sprite-normal-authoring/phase-1/verification.json` 및 run 하위 PNG/JSON이다.
`pnpm smoke:sprite-normal-animation`은 같은 사전 조건에서 실제 GIF/APNG 부분 frame·Previous/Background disposal,
반투명 Over 합성과 유리수 시간·PNG sheet를 검사한다. standalone frame 생성 결과와 비교해 normal의 경계 간섭을 검사하고,
paired atlas의 모든 내부 RGBA·alpha·hash를 비교한다. APNG 합성에는 upstream의 1바이트 정수화 오차를 명시적으로 허용한다.
브라우저에서 public resolver/authoring과 실제 Rust native 재생을 사용하여 원본 frame 방문·종료·loop wrap·UV 선택과
프레임별 normal 조명·flip의 픽셀 차이를 확인한다. test 전용 RAF clock만 제어하며 native 상태는 mock하지 않는다.
근거는 `artifacts/sprite-normal-authoring/phase-2/verification.json` 및 run 하위 PNG/JSON이다.
실제 생성기 browser smoke는 opt-in이며 CI 기본 gate는 외부 binary 없는 계약 테스트다.
`pnpm smoke:sprite-normal-binding`은 같은 실제 fixture 생성기를 재사용해 3단계 전용 artifact를 만든다.
완료 report·descriptor 파일 hash에서 stable binding을 만들고 host가 측정한 decoded 크기·색 공간·PNG hash와 대조한다.
combined patch/handoff의 generation 설정·원본/결과 hash, source 불변·문서/binding JSON 왕복을 검사한다.
실제 두 registry에서 color/normal ID를 다른 순서로 배정해 native material ID와 프레임별 조명·동일 픽셀을 확인한다.
누락·sRGB·크기·UV·변경 bytes를 거절하고 기존 native handle/렌더링이 유지되는지 검사한다.
근거는 `artifacts/sprite-normal-authoring/phase-3/verification.json` 및 최종 run의 authoring JSON/PNG다.
`pnpm test:web`에는 binding/provenance·metadata 진단·공간 v4의 교체/해제·Undo/Redo·handoff stale guard와
이름 해석 실패 후 native 씬 보존 회귀가 포함된다. CI 기본 web test gate를 통해 실행한다.
WebGPU 및 생성 UI의 renderer/재import 통합 조합은 아래 `smoke:sprite-normal-integration`으로 검사한다.

`pnpm test:sprite-normals-tool`은 선택형 Wasm bundle의 provenance/adapter·파일 path/hash·누락 거절과
실제 memory section의 bounded/unshared 상한도 외부 도구 없이 검사한다.
`pnpm test:web`은 Worker client의 입력 복사·정상 반환 free·cache transfer 격리·LRU byte/entry 상한,
abort/supersede/timeout·오래된 응답·listener 정리·destroy와 오류 후 재생성을 mock port/runtime으로 검사한다.
이 테스트들은 기존 CI 기본 gate에 포함한다.
실제 생성기는 `pnpm normals:install`과 `pnpm normals:wasm:build` 뒤 `pnpm smoke:sprite-normal-worker`로 검사한다.
미리 빌드한 ferrum-web JS/엔진 Wasm, Chromium이 필요하며 브라우저 Worker 검증은 opt-in이다.
실제 module Worker에서 7개 비기본 설정의 PNG·PNG sheet·GIF·APNG를 생성해 CLI normal/color/alpha와 비교한다.
normal 채널 허용 오차는 1바이트이며 실제 차이를 보고하고 timing/loop·기존 binding/patch 호환성을 확인한다.
첫 요청 lazy fetch·cache 복사·반복 free·작업량이 같은 반복 요청의 memory 용량과 4건/8 MiB cache 상한을 검사한다.
1024px 생성 중 main heartbeat와 native HD-2D preview frame이 진행하는지, 생성 normal의 조명 픽셀 차이를 확인한다.
abort/supersede/clearCache/destroy·실제 hanging Worker timeout, 잘못된 manifest/Wasm hash와 256 초과 frame 거절,
오류 후 복구·원본 bytes/씬 보존·생성한 Worker 전부 종료를 assert한다.
Wasm memory 용량 안정성은 전체 JS heap 누수 검사의 대체가 아니다.
근거는 `artifacts/sprite-normal-authoring/phase-4/verification.json`, run 하위 PNG/JSON과 `checks.json`이다.
ferrum-web tarball 검사는 Worker client/entry/runtime/protocol/output의 JS·타입을 필수로 확인하고
선택형 sprite normal generator의 JS/Wasm binary가 package에 포함되면 거절한다.

`pnpm smoke:sprite-normal-ui`는 optional Wasm bundle과 빌드한 ferrum-web/엔진 Wasm·Chromium을 준비한 뒤 실행한다.
테스트 전용 save-enabled 공식 app을 빌드하고 별도 HTTP host에서 실제 Worker를 연결한다. 기본 CI는 기존 공식
2D/HD-2D smoke에서 도구의 비활성 기본 화면을 검사하고 이 실제 생성기 UI smoke는 opt-in이다.
실제 asset 선택·PNG/GIF/APNG 파일·preset·Settings/Preview·고정/이동 조명과 Flat/Normal 픽셀 차이를 확인한다.
생성 중 scene 불변, Apply 한 건 Undo/Redo·유효 handoff와 Undo 후 근거 제거, export PNG hash/manifest,
export를 저장으로 간주하지 않는 scene Save guard, source 오류/취소의 기존 draft 보존을 검사한다.
전용 artifact host의 파일 충돌·변조 bytes 거절과 저장/catalog 확인 뒤 scene Save, 문서별 결과 분리·늦은 결과 차단,
2D의 Apply 비활성·compact UI·문서 닫기 URL 해제와 pagehide 이후 Worker/Blob URL/실제 GL texture 잔여 0을 확인한다.
업로드 중 선택이 바뀌면 Apply를 거절하며 BFCache pagehide/pageshow 이후 tool의 busy 상태가 풀리는지도 검사한다.
기존 오프라인 도구 gate에는 optional UI host의 GET 전용·정확한 파일 allowlist·bundle 누락/변조의 비노출 503 회귀 3개를 포함한다.
근거는 `artifacts/sprite-normal-authoring/phase-5/verification.json`, run의 screenshot/export·host 저장 JSON/PNG다.
자원 개수 관찰은 JS heap 또는 실제 기기 성능 검증을 대체하지 않는다. 새 생성 UI는 공식 viewer에만 연결하며 generated
create-game template에 추가하지 않으므로 consumer/template smoke 범위를 확대하지 않는다.

`pnpm smoke:sprite-normal-integration`은 같은 사전 조건에 고정 CLI 설치도 필요하다. phase-6 전용 artifact에
GIF/APNG 실제 생성 결과의 모든 고유 frame × flip X/Y 네 조합 × 회전 0/0.7rad × 2D/HD-2D × DPR 1/2를 검사한다.
WebGPU adapter가 있으면 실제 GPU shader/texture/native packet과 기존 offscreen capture target을 사용한다.
GPU 사용 가능 상태에서 초기화·검증 실패를 skip하지 않으며 `FERRUM_REQUIRE_WEBGPU=1`은 adapter 부재도 실패로 만든다.
WebGPU readback은 RGBA 채널 허용 오차 8에서 전체 pixel 0.5% 미만 차이를, 강제 adapter 부재 fallback은
WebGL2와 동일한 pixel을 요구한다. 각 HD-2D pose의 normal/flat 조명 차이와 2D 색상 불변도 검사한다.
이 검사는 native canvas presentation 또는 실제 기기 성능을 대체하지 않는다.

같은 명령의 공식 UI 검사는 DPR 2에서 부분 texture 업로드 실패 후 실제 씬 pixel·초안·자원 보존과 재시도,
서로 다른 두 생성 pair 사이 Undo/Redo의 handoff 복원, compact 방향키/Home/End·키보드 취소를 확인한다.
8개 세션 pair 한도 거절과 문서 닫기 뒤 생성 재개, 마지막 Worker/URL/GL texture 잔여 0도 확인한다.
실제 PNG 해시 계산 직후 요청을 취소하고 같은 미적용 후보를 재생성·적용하는 경우에도 소유권과 종료 해제가 유지돼야 한다.
export bundle과 동반 patch로 만든 씬은 별도 새 페이지에서 PNG hash/색 공간·provenance를 검증하고 다른 texture ID로
실제 엔진에 재로딩해 normal 조명을 확인한다. filesystem 설치 transaction은 전용 host/agent 책임이다.
근거는 `artifacts/sprite-normal-authoring/phase-6/renderer-verification.json`, `ui-verification.json`, `checks.json`과 run별 PNG/JSON이다.
명령은 테스트용 save-enabled app을 남기므로 이후 `pnpm --filter @ferrum2d/placement-viewer build`로 기본 app을 복원한다.

`pnpm smoke:aseprite-assets`는 빌드한 ferrum-web/엔진 Wasm과 Chromium을 준비한 뒤 실행한다.
optional 노멀 생성기 설치는 필요 없다. save-enabled 공식 app을 별도 HTTP host에서 실행하며
기본 CI 편입 없이 opt-in으로 다음을 확인한다.

- 2D DPR 1·HD-2D DPR 2의 JSON+PNG 검사와 frame Preview, 등록 후 실제 frame 배치·Apply Frame
- frame 이름을 유지한 크기/위치 변경 재import의 실제 native PNG 픽셀과 pose/size/pivot/collider/body 보존
- 한 건 Undo/Redo와 revision handoff 복원, 제거·모호한 frame 및 animation/normal migration 진단
- 잘못된 JSON/PNG 크기·파일명·회전·trim·범위·중복·byte 한도 거절과 기존 씬 보존
- 실제 GPU 업로드 뒤 실패 rollback, 취소 직후 같은 revision 재시도, URL/GL texture 해제
- 문서별 catalog 분리·8 revision 한도·닫기 후 재개, compact Source/Preview 방향키/Home/End
- scene-only Save 차단, 원본 JSON/PNG byte hash와 sRGB manifest가 담긴 Export Assets,
  bundle과 동반 patch를 별도 새 페이지에 로딩한 native 복원
- BFCache pagehide/pageshow 후 재개와 최종 pagehide 이후 Blob URL/실제 GL texture 잔여 0

근거는 `artifacts/aseprite-assets/verification.json`, `checks.json`과 run별 PNG/bundle/resume JSON이다.
입력은 비회전·비트림 atlas로 제한하며 JSON 1 MiB/PNG 16 MiB·한 변 4,096·4 MP·256 frame,
세션 8 revision/원본 64 MiB 한도를 사용한다. resource 개수 검사는 JS heap·실제 기기 성능 검증을 대체하지 않는다.
이 명령은 generated create-game viewer와 프로젝트 filesystem 설치를 검사하지 않는다. 프로젝트 저장은 아래 별도 smoke로 검증한다.
명령이 남긴 테스트용 save-enabled app은
`pnpm --filter @ferrum2d/placement-viewer build` 또는 `pnpm build`로 기본 설정에 복원한다.
공식 작업공간 smoke의 입력·크기·focus 대상은 `canvas.demo-canvas`로 지정해 Assets의 frame preview canvas와 구분한다.
workspace 전환의 native readback은 최대 16 RAF 안에 CSS/DPR와 drawing buffer 크기가 일치하고
세 프레임 연속 크기가 안정될 때만 읽는다. 실패 전후 PNG의 완전 동일성 조건은 유지한다.

`pnpm test:aseprite-animation`은 duration GCD/native float32 오차·4개 방향·array/hash 순서,
numeric clip ID/initial/loop 보존·태그 추가/누락/모호함·수동 수정·frame/FPS 제한·lock/normal/legacy 거절을 확인한다.
`pnpm smoke:aseprite-animation`은 save-enabled 공식 app에서 실제 2D DPR 1·HD-2D DPR 2의
Apply Animation/Reimport Animation·단일 Undo/Redo·component/pose 보존과 export/handoff tag ID를 확인한다.
별도 새 엔진 세션에서 90ms/180ms 반복 UV의 native 진행/종료와 두 색상 frame의 실제 pixel을 확인한다.
32-frame 한도·태그 삭제 거절, 실제 GPU upload 뒤 실패 rollback·취소 후 재시도와 종료 URL/GL texture 0도 요구한다.
`pnpm smoke:aseprite-animation-project`는 기존 native project smoke의 animation 분기다.
실제 Rust 저장/프로토콜 함수에 test-only stdio transport로 연결해 2D/HD-2D의 원본+animationSet 저장·새 프로세스/브라우저 복원,
한 frame 태그의 재import/Undo/Redo·파일/씬 충돌·취소·변조 거절과 저장 manifest의 standalone game 로딩을 검사한다.
native GUI IPC 자체는 검사하지 않는다. 다중 frame 재생은 앞 browser gate가 담당한다.
근거는 `artifacts/aseprite-animation/verification.json`, `project/verification.json`, `qa.json`, `checks.json`과 run별 export/PNG다.
두 명령은 기본 CI에 편입하지 않은 opt-in gate이며 원래 Aseprite/normal report를 덮어쓰지 않는다.
명령 실행 뒤 기본 app build로 save-enabled 설정을 복원한다.

`pnpm smoke:aseprite-paired`는 기존 Aseprite browser harness의 `--paired` 분기다.
2D에서 paired action 차단, HD-2D DPR 2에서 실제 Worker로 태그 애니메이션·노멀 동시 생성/reimport를 확인한다.
clip ID/initial/loop·component/spatial 설정 보존과 한 Undo/Redo, 생성기 부재·태그 누락·GPU upload 실패·최종 lock·취소 재시도도 검사한다.
독립 PNG decoder로 합성 rect와 실제 Worker output bytes를 비교하고 export를 새 runtime에서 재생한다.
90/180ms native 진행·종료를 검사하며 각 animated color/normal UV의 실제 pixel이 독립 적용한 정적 frame과 완전히 같아야 한다.
각 frame의 visible color와 flat 대비 normal lighting 차이도 100 pixel을 넘어야 한다.
`pnpm smoke:aseprite-paired-project`는 실제 Rust writer/protocol과 새 Rust/browser 실행에서 paired 저장·복원·재import·Undo/Redo·export를 검사한다.
PNG 충돌·잘못된 catalog 응답·취소·변조 거절, 저장 manifest만 사용한 독립 runtime의 다중 frame UV/조명 검증을 포함한다.
종료 URL/GL texture 잔여는 0이어야 한다. native GUI IPC는 검사하지 않는다.
두 명령은 선택형 생성기가 필요한 opt-in gate이며 기본 CI에는 편입하지 않았다.
근거는 `artifacts/aseprite-paired/verification.json`, `project/verification.json`, `qa.json`, `checks.json`이다.
`test:aseprite-animation`은 paired combined patch·billboard/lock·32 unique UV 거절을,
`test:native-normal-project`는 scene animationSet 복원과 report에 없는 UV의 근거 제외도 검사한다.

`pnpm test:aseprite-normal-png`는 PNG filter 0~4와 투명/반투명 RGBA의 수치 보존, CRC·잘린 입력·크기·취소를 검사한다.

`pnpm smoke:tile-external`은 외부 TSJ의 opt-in native gate이며 CI 기본 gate에는 추가하지 않는다.
Tiled 2D DPR 1·HD-2D DPR 2에서 TSJ 누락 진단·명시적 파일 선택·원본 map/TSJ 보존·dependency protocol 변조 거절을 확인한다.
기존 native gate의 충돌/Cancel/CAS/재시작/Undo/Redo/export/자원 회수 조건과, 원본 map이 같은 TSJ 재import를 검사한다.
독립된 game fixture는 저장된 raw map+TSJ를 public importer의 `externalTilesets`로 읽어 실제 두 frame UV와 blue/green pixel을 검증한다.
보고서는 `artifacts/tiled-external-assets/verification.json`이다. 실제 Tauri GUI IPC는 이 stdio harness의 검증 범위에 포함하지 않는다.
`pnpm test:tile-assets`는 TSJ-only revision 분리·누락/추가/모호한 파일명·source/URL/hash 변조와 native 원본 복원도 검사한다.

`pnpm smoke:tile-multi`는 다중 embedded tileset의 opt-in native gate다. Tiled/LDtk × 2D DPR 1·HD-2D DPR 2에서
이름 선택·연속 JSON/PNG 선택·PNG 불일치 시 참조 보존·제외 범위 evidence, 정의 순서 변경 뒤 선택 유지,
선택 key를 포함한 원본 저장·재시작·unchanged 재검사·reimport Undo/Redo·별도 게임의 원본 frame UV와 native 픽셀을 확인한다.
기존 native gate의 충돌/Cancel/CAS/변조/자원 회수 조건도 그대로 사용한다. 보고서는 `artifacts/multi-tileset-assets/verification.json`이다.
`pnpm test:tile-assets`는 projection/raw source 보존·중복/누락/tileset 예산·동일 PNG의 선택별 ID 분리·native 복원도 검사한다.
headless Cargo test는 동일 PNG를 쓰는 두 선택의 독립 저장과 잘못된 선택의 파일 생성 전 거절, key 없는 기존 catalog를 검사한다.

`pnpm smoke:tile-project`는 opt-in native 자산 gate다. Tiled/LDtk 각각 2D DPR 1·HD-2D DPR 2에서 실제 Rust writer/protocol과 Chromium을 사용한다.
파일 충돌 보존·잘못된 응답·native 완료 후 Cancel의 scene 저장 차단, source-only catalog, Rust/browser 재시작 2회,
프레임 복원·unchanged identity·reimport Undo/Redo·외부 scene CAS 충돌·원본 export·저장 manifest로 별도 game 픽셀 복원·파일 변조 거절과 URL/texture 해제를 검사한다.
`pnpm test:tile-assets`에는 native catalog 원본 재검증·취소·canonical identity 복원 테스트가 포함된다.
`cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features --offline`은 native tile 원본/권한/충돌/rollback/변조와 공유 Aseprite 저장 회귀를 검사한다.
이 gate는 native GUI IPC 대신 stdio test transport를 사용하며 Tauri GUI 실행이나 CI 기본 gate 편입을 주장하지 않는다.

`pnpm test:tile-assets`는 Tiled/LDtk 실제 PNG decode/hash·immutable ID·원본/변환 map export, stable frame UV migration,
누락/모호함·lineage/lock/normal/animation 거절과 byte/grid/revision 예산을 확인한다.
공유 PNG revision store의 부분 GPU upload 실패 및 문서 닫기 뒤 늦은 loader 완료의 texture 회수도 검사한다.
`pnpm smoke:tile-assets`는 기존 Aseprite browser harness의 `--tiles` 분기이며 별도 `artifacts/tile-assets` report를 사용한다.
2D DPR 1·HD-2D DPR 2에서 Tiled/LDtk 각각 Register의 씬 불변, 실제 Assets 배치, 서로 다른 frame 두 instance의 단일 Undo 재import,
pose/component 보존·Undo/Redo·GPU upload 실패·최종 lock 재검사·취소 재시도·누락 frame 거절·미설치 참조 scene Save 차단을 검사한다.
별도 새 runtime은 export 원본/hash·public importer 변환 결과·PNG 크기/color space를 재검증한 뒤 두 frame의 blue/green pixel이 각각 100을 넘어야 한다.
종료 시 소유 Blob URL/GL texture 잔여는 0이어야 한다. 이 browser-only gate는 전체 map 적용이나 native 저장을 검사하지 않는다. native 저장은 `smoke:tile-project`에서 따로 확인한다.
CI에는 편입하지 않은 opt-in gate다. 실행 뒤 기본 app build를 복원하며 기존 Aseprite/paired/native 저장 회귀도 수행한다.
검증 근거는 `artifacts/tile-assets/verification.json`, `qa.json`, `checks.json`, run별 export와 PNG다.

`pnpm test:native-normal-project`는 실제 PNG bytes로 worker/Aseprite provenance·metadata/PNG 변조·크기·중복·URL·취소와
기본 native host adapter, source color 공유·복원 evidence/export·문서 소유권/닫기 해제를 검사한다.
desktop headless Cargo test는 normal pair 저장/동일 bytes 재시도·ordered metadata/색 공간, 잘못된 입력의 파일 생성 전 거절,
열지 않은 project 권한·8 pair 한도·실제 PNG 변조·부분 설치 rollback·디렉터리/catalog/PNG symlink 거절을 확인한다.
`cargo clippy --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features --offline --all-targets -- -D warnings`도 실행한다.

`pnpm smoke:native-normal-project`는 실제 optional Worker/Wasm 생성 → 기본 desktop normal host 저장 → 새 Rust/browser 실행을 검사한다.
stdio transport만 대체하고 실제 프로젝트 파일 저장/protocol 함수를 사용한다. HD-2D DPR 2에서 Aseprite normal pair의
파일 충돌 보존·잘못된 catalog 응답 거절·Cancel 후 scene 보존·재시도, 저장/복원 evidence·재import Undo/Redo·다시 export를 확인한다.
기존 Normal tool의 정적 PNG와 animation grid도 같은 native host로 저장한 뒤 새 실행에서 binding/descriptor가 일치해야 한다.
저장 manifest를 별도 native runtime에 로딩하고 PNG hash/normal 색 공간·flat 대비 조명 pixel 차이를 검사하며 마지막 URL/GL texture 잔여 0을 요구한다.
native GUI IPC/picker 자체와 macOS/Windows는 이 headless gate에서 검증하지 않는다. 선택형 생성기 설치가 필요하며 기본 CI에는 편입하지 않은 opt-in gate다.
근거는 `artifacts/native-normal-assets/verification.json`, `qa.json`, `checks.json`, run별 scene/export/PNG와 로그다.
기존 Aseprite/animation/normal browser 회귀를 실행할 때 이전 최상위 verification report는 보존하고 이번 결과를 별도 경로에 둔다.
`pnpm smoke:aseprite-normals`는 save-enabled app과 기존 optional 생성기 bundle을 준비해 실제 Worker/Wasm으로 Aseprite rect별 노멀을 생성한다.
2D에서는 action 차단, HD-2D DPR 2에서는 두 frame/instance의 단일 Undo 재import·UV/크기/pose/collider 보존과 실제 native 색상을 확인한다.
Node의 독립 PNG decoder로 합성 atlas와 실제 Worker frame 출력의 모든 RGBA bytes를 대조하고, 별도 새 runtime에서 export PNG/hash/색 공간·조명 차이를 확인한다.
생성기 부재·겹친 rect·실제 GPU upload 뒤 실패·lock 변경·취소 직후 재시도·저장 host의 잘못된 bytes 거절도 검사한다.
종료 시 owned URL/GL texture와 Worker 잔여 0을 요구한다. 근거는 `artifacts/aseprite-normals/verification.json`, `checks.json`과 run별 PNG/bundle/scene이다.
이 명령은 기존 Aseprite smoke의 `--normals` 분기로 실행하며 이전 `artifacts/aseprite-assets` report를 덮어쓰지 않는다.
CI 미편입 opt-in이며 native normal writer 검증을 주장하지 않는다. 끝나면 기본 app build로 save-disabled 설정을 복원한다.

`pnpm smoke:aseprite-project`는 기본 app을 빌드한 뒤 Chromium과 headless Rust host test binary를 사용한다.
Cargo/Rust dependency cache·빌드한 ferrum-web JS/Wasm이 필요하며 GTK/WebView는 요구하지 않는다.
test-only stdio transport가 실제 Rust project load·asset save·scene CAS·asset protocol 함수를 호출한다.
browser의 `__TAURI__` transport만 대체하고 파일 저장·hash·PNG·경로·씬 비교 동작은 대체하지 않는다.
기본 CI에 추가하지 않은 opt-in 검사이며 실제 native GUI/IPC/package 검증을 대신하지 않는다.

2D DPR 1·HD-2D DPR 2에서 Save Project의 파일 충돌, 변조된 host 응답, native 완료 뒤 취소·재시도,
원본/manifest·scene 저장, 새 Rust 프로세스와 새 browser context의 frame·재import 복원을 확인한다.
UV 변경 재import·Undo/Redo·실제 native 색상과 외부 scene 변경 보존, idempotent 재시도,
저장한 manifest를 별도 게임 runtime에 로드한 native PNG, 손상된 저장 PNG 거절도 확인한다.
종료 시 URL/GL texture 잔여 0을 요구한다. 근거는 `artifacts/aseprite-project/verification.json`, `checks.json`과 run별 실제 프로젝트/PNG다.

native 저장/프로토콜 단위 검증은 아래 명령을 사용한다. default feature는 계속 desktop이며,
full Cargo test/GUI 검증에는 기존 Linux GTK/WebKit 개발 라이브러리가 필요하다.

```bash
cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features
cargo clippy --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features --all-targets -- -D warnings
```

headless 기본 test의 ignored 1건은 브라우저 전용 stdin transport다. `smoke:aseprite-project`가 해당 test를 실제 실행하고
그 프로세스가 수행한 저장/복원 결과를 browser/file assertion으로 검증한다. 경로·symlink·hash/UV 오류·quota·부분 설치와
외부 catalog 변경, 외부 writer가 같은 inode의 bytes를 바꾼 경우까지 원본을 보존해야 한다.
실패 정리는 inode와 bytes 소유권을 입증한 새 파일에만 적용하며, 입증할 수 없으면 미참조 파일을 남겨 재시도에 사용한다.

2D·HD-2D authoring 작업공간의 기본 browser 명령은 `pnpm smoke:placement-viewer`와
`pnpm smoke:placement-spatial-workspace`다. CI validate job은 전체 build 뒤 두 mode를 직접 실행한다.
두 gate의 `placement-lighting-smoke.mjs`는 실제 Wasm/WebGL2 조명 ON/OFF와 framebuffer 차이·복원을 확인한다.
2D 점광원과 HD-2D 환경 buffer의 조명/태양/그림자 flag, bounded draw cost, 설정 보존·카메라 불변,
잘못된 수치와 native 거부의 rollback, Undo/Redo·Play/Stop·탭 격리, 한영·390×500 패널 경계를 검사한다.
2D gate에서 함께 실행하는 저장 검증은 공개 Tauri bridge를 모의하고 실제 native 렌더러를 사용한다.
포커스 중인 입력의 저장/재열기와 잘못된 입력의 저장 차단을 검사하며 실제 OS 파일 선택기/파일 쓰기 검증은 아니다.
근거는 `artifacts/viewer-lighting/`에 남긴다.

2D gate의 `placement-garden-smoke.mjs`는 **파일 → 예제 → 2D 등불 정원**과 `?scene=garden` 경로를 검사한다.
atlas SHA-256/43개 crop, navigation의 운하/다리, 타일 432개를 포함한 native entity 465개,
4개 점광원·그림자와 draw call 1–64·texture switch 4 이하를 요구한다.
실제 클릭 이동·걷기/정지 clip·일시정지/재개·토큰 3개 수집·다리 건너기·막힌 목적지와
native solid 충돌·정지 후 원본 복원·문서 Undo·다른 탭의 초안 보존·한영/작은 창을 확인한다.
근거는 `artifacts/2d-showcase/report.json`과 화면이다. 에셋/JSON 재현성은
`python3 scripts/assets/build-lantern-garden.py --check`로 별도 확인한다.

같은 gate의 `placement-selection-controls-smoke.mjs`는 실제 작은 가로등의 이름·회전/크기 버튼·값,
visual 테두리와 도구의 비겹침, 기본 충돌 표시 OFF와 명시적 보기 토글·문서/이력 불변을 확인한다.
DPR 1/2, 한영, 회전/크기 방향키·Undo, 화면 이동/Space·잠금, canvas 가장자리와 화면 밖 숨김,
실제 좌우 회전 드래그 한 건 Undo, 화면 밖 드래그의 도구 유지·Escape 복원과 번역하지 않는 객체 ID,
390×500·Play/Stop·빈 공간 선택 해제, native entity 465개·점광원 4개·draw 1–64도 함께 검사한다.
근거는 `artifacts/2d-selection-controls/`다. `placement-transform-smoke.mjs`는 새 문맥 도구의 실제 좌우 드래그가
기존 숫자/방향키와 같은 그룹 pivot·rotation/scale patch를 만들고 Escape로 취소되는지도 검사한다.
충돌 offset 회귀는 보기에서 충돌 영역을 켠 뒤 실제 핸들을 조작한다.

`pnpm smoke:placement-village`는 Blender 중세 마을 예제를 production build에서 검사한다.
CI validate job은 전체 build 뒤 `node tests/smoke/placement-village-smoke.mjs`를 실행하며 `smoke:check`에도 포함한다.
14개 GLB/3개 sprite의 SHA-256, native entity 46개·모델 42개·billboard vertex 24개,
실제 framebuffer의 유색 픽셀/색상 수, WASD/방향별 걷기 clip, 남아 있는 2D Pan의 게임 입력 방해 방지,
건물 충돌·일시정지·정지 후 초안 복원, 다리 높이 2와 양안 이동·다리 밖 강 건너기 차단을 확인한다.
실제 `renderer.stats()`의 draw call 1–160, model triangle 5,001–60,000과 warm model upload 0을 요구한다.
마을을 열기 전 기본 2D 문서가 마을 에셋을 요청하지 않는지, JSON 파일 열기 시 지연 로드·주인공 선택이 되는지도 검사한다.
production 검증은 `/placement-viewer/` 하위 경로에서 실행하여 상대 에셋 URL을 확인한다.
같은 gate의 `placement-village-height-grid-smoke.mjs`는 DPR 1/2에서 지형 높이 격자를 켰을 때
높이 24 정원 단·경사길 영역에 청록색 격자·외곽선이 보이는지 실제 framebuffer로 검사한다.
격자 증가·512선/1 draw·깊이 가림, 문서·patch·history·카메라 보존, native 주인공의
평지→경사면→높이 24→평지 보행과 Play/Stop 복원도 확인한다.
`node tests/smoke/placement-village-smoke.mjs --height-grid-only`로 이 범위만 실행할 수 있으며
근거는 `artifacts/village-height-grid/dpr*.json`과 `off-dpr*.png`·`on-dpr*.png`다.
같은 gate의 `placement-village-viewport-smoke.mjs`는 DPR 1/2·세 가지 화면 크기·dock 전환에서
편집 presentation 전체 영역, 실제 grid draw viewport·alpha blending·depth test와 framebuffer의 마을 외곽 여백을 확인한다.
카메라 이동으로 건물을 예전 letterbox 여백에 배치하고 실제 픽셀이 남는지 검사한다.
Play의 384×256 복귀, Stop의 전체 해상도 복원과 JSON/history 보존도 확인한다.
근거는 `artifacts/village-viewport-fix/viewport-dpr*.json`과 화면이다.
자동 gate는 체크인한 Blender 결과물을 사용한다. Blender 재생성은 설치된 5.2.2 LTS로 별도 수행한다.
근거는 `artifacts/rpg-village/checks.json`과 `village-editor.png`, `village-game.png`, `village-game-ko.png`다.
두 gate의 `placement-viewport-sizing-smoke.mjs`는 실제 확장/복원, CSS 치수 표시, 세 dock의 keyboard resize,
한국어/영어 전환, resize 후 grid/render와 문서·선택·native entity·history 보존을 확인한다.
같은 gate의 `placement-toolbar-ux-smoke.mjs`는 한영 아이콘/접근성 이름과 단축키, 방향키 focus 이동의 비실행,
Space 임시 이동 pressed/안내 복귀, 보기 설정 Enter/Space 열기·Escape focus 복원·바깥 클릭 닫기,
격자 표시·공유 간격/잘못된 값 거부, 320~1125px 메뉴/주 도구 경계·최소 canvas 높이와 카메라·선택·문서·history 보존을 검사한다.
데스크톱의 36px 두 줄, 파일 메뉴의 메타데이터/Open 접근, 편집 시점 기능의 접힌 기본 상태·보이는 기능명,
부모 보기 패널을 열어도 닫힌 하위 메뉴 화살표의 방향 유지,
한영 편집 시점/사용 안내 이름과 Enter/Space·Escape focus 복원,
다른 메뉴를 열면 기존 메뉴 닫기, 화면 구성의 초기화 접근, 카메라/화면 구성/안내의 390×500 경계도 검사한다.
메뉴를 닫은 주 도구 행은 표시 버튼 6개 이하로 제한한다. `placement-panel-navigation.mjs`는 실제 summary를 열고
카메라·패널 동작 후 Escape로 닫는다. 숨긴 control을 DOM 변경으로 노출하지 않는다.
같은 gate에 연결된 `placement-menu-regressions-smoke.mjs`는 2D·HD-2D 에셋 배치 대기 중
중첩 메뉴의 Escape가 안쪽부터 메뉴를 닫고 마지막 Escape가 배치를 취소하는지 검사한다.
390×320에서 실제 세로 wheel로 상위 보기 패널을 이동해 기준 버튼이 움직인 팝업을 닫는지,
안내문 내부 wheel은 해당 메뉴를 유지하는지도 확인한다.
문서·이력·선택·편집 카메라 보존과 focus 복원을 함께 확인하며 근거는 `artifacts/viewer-menu-regressions/`에 남긴다.
HD-2D gate의 `placement-six-panels-smoke.mjs`는 한영 × 2D/HD-2D/Game 왕복 시 편집 섹션 5개의 가시성과
문서·history 보존도 확인한다. 같은 gate의 `placement-spatial-asset-refresh-smoke.mjs`는 공개 Tauri invoke를 모의하고
실제 revision별 PNG·Wasm/WebGL2로 선택 이미지 갱신 시 thumbnail·배치 대기·drag 취소, 관계없는 이미지 갱신 시 대기 유지,
재배치의 128×192 크기와 Undo 복원·native entity/draw 근거를 검사한다. 실제 Tauri GUI/파일 감시 검증은 포함하지 않는다.
근거는 `artifacts/spatial-asset-refresh/verification.json`이다.
같은 gate의 `placement-spatial-transforms-smoke.mjs`는 직교 DPR 1·원근 DPR 2의 실제 마을에서
배경과 겹친 집의 선택·XY 드래그·한 건 Undo/Redo, 생략된 모델 변형 기본값, 모델 회전·크기와 충돌 정보 보존,
한영 sprite 회전·크기의 native billboard 정점 반영, 잘못된 크기 rollback·잠금·Play/Stop 복원을 확인한다.
같은 실제 화면에서 높이·회전 아이콘의 SVG/접근성 이름/화면 내 위치, 모델·sprite의 회전 드래그,
Shift 15° 정렬·방향키 조절, 높이 아이콘의 키보드·드래그, 한 건 Undo/Redo와 Escape·포인터 캡처 해제 rollback을 검사한다.
모델 회전 시 collision/instance props와 편집 camera가 유지되고, sprite 회전 아이콘은 native billboard 정점을 바꿔야 한다.
지형·플레이어의 회전 비활성 이유, Pan/잠금/Game Preview/빈 공간 선택 해제 시 아이콘 숨김도 확인한다.
선택 객체가 왼쪽 가장자리에 걸치면 아이콘이 canvas 안에 남고, 화면 왼쪽·오른쪽으로 완전히 벗어나면 숨기며
다시 화면 안으로 이동하면 복원되는지 확인한다. 이 탐색 동안 선택·문서·Undo/Redo 이력은 유지돼야 한다.
에셋 배치 대기 중 높이·회전 드래그를 시작하면 배치 대기·ghost를 종료하고, 첫 Escape로 변형 전체를 취소해
문서·이력·선택·카메라를 복원하는지도 확인한다.
모델·billboard·지형 선택 후 빈 공간 클릭으로 선택·외곽선·높이 손잡이·속성 값이 비워지고,
대상 목록에 `선택 없음`을 표시하며 이름 변경·복제·삭제 버튼을 숨기는지 확인한다.
문서·이력·카메라가 유지되는지, Pan 도구 클릭은 선택을 보존하는지도 검사한다.
근거는 `artifacts/spatial-transform-fix/verification.json`과 화면이다.
같은 spatial gate의 `placement-game-camera-smoke.mjs`는 직교/원근 × DPR 1/2에서 실제 Rust/Wasm의 게임 카메라 작성을 검사한다.
탐색 시점과 JSON의 분리, 현재 시점 적용의 v5 patch·한 건 Undo/Redo, 각도·방향·중심·확대/화각 변경 후 native 투영 변화,
일시정지 미리보기와 pixelArt 320×180의 실제 viewport/점선 프레임 일치, Stop의 편집 카메라 복원을 확인한다.
잘못된 lens와 native 거절의 초안·이력 복구, 연속 적용/복원 실패 중 mode/tab/Undo 차단·resize 오류 보고와 Escape 재시도,
투영 전환, export/reopen, 한영 UI를 검사하며
native entity 3개·billboard vertex 18개와 draw 1~32회 조건도 함께 확인한다.
근거는 `artifacts/game-camera-authoring/browser-verification.json`과 화면이다.
같은 gate의 `placement-game-camera-live-smoke.mjs`는 직교/원근 × DPR 1/2에서 상시 노출된 게임 카메라 버튼과
고정 패널, 포커스를 유지한 숫자·슬라이더 입력 중 native 투영 변화, 입력 확정 전 JSON/이력 유지와 한 건 확정,
Escape·잘못된 값·native 거절 복구를 확인한다. 패널과 실제 pixelArt 게임 프레임이 겹치지 않는지,
재개 시 잠금과 재진입 일시정지, resize·Stop의 편집 시점 복원, Undo/Redo·재열기·한영 UI도 검사한다.
native entity 3개·billboard vertex 18개·draw 1~32회와 근거는 `artifacts/game-camera-live-preview/verification.json`이다.
live smoke가 호출하는 `placement-game-camera-gestures-smoke.mjs`는 실제 마우스 회전·Space/중간 버튼 이동,
연속 휠의 한 건 확정과 숫자 라벨의 Shift 미세·Ctrl 빠른 조절을 같은 네 조합에서 검사한다.
실제 native 행렬과 pixelArt 프레임에 투영한 점이 이동한 CSS 픽셀 거리도 확인한다.
입력 중 JSON/이력 유지, Escape·포인터 캡처 상실·포커스 상실·모드 전환 취소,
native 미리보기 거절과 연속 복원 실패의 제스처 소유권 유지·Escape 재시도를 검사한다.
드래그 도중 modifier 변경의 연속성, 접기 메뉴와 실행 버튼의 Space 활성화, 미리보기 진입 시 뷰포트 포커스도 검사한다.
`placement-game-camera-save-smoke.mjs`는 제스처 중 실제 저장 요청이 발생하지 않는지도 검사한다.
마을 gate의 `placement-working-grid-smoke.mjs`는 DPR 1/2에서 맵 밖의 배치 불가 안내와
실제 마우스가 만든 `isTrusted` dragover의 금지/복사 `dropEffect`, 거절된 drop의 문서/이력 유지,
Escape·drop 후 안내 해제를 검사한다.
대형 모델의 미리보기가 화면에 잘리더라도 실제 지지 위치가 유효하면 복사 커서를 유지하는지도 확인한다.
같은 카메라 smoke에서 호출하는 `placement-game-camera-regressions-smoke.mjs`는 DPR 2에서 resize 없이 JSON 문서를
연 뒤 카메라 입력/적용/미리보기 버튼이 다시 활성화되는지, 탭별 문서·이력·탐색 시점이 보존되는지 확인한다.
직교→원근 전환이 near/far 경계를 넘는 두 사례와 기존 클립이 유효한 사례에서 실제 native 중심 가시성,
수직 화면 범위·기존 유효 클립 유지, 한 건 Undo/Redo와 재열기를 검사한다. 고급 높이로 만든 음수 각도·수평/분수 각도,
±90° 거절, 확대 결과 0.0008과 작은 값 4e-7의 입력/표시·재열기, 0 거절도 포함한다.
재개는 실제 `dataSceneState() === "playing"`과 프레임 숨김으로 확인하며 native entity 3개·billboard vertex 18개·draw 1~32회도 검사한다.
근거는 `artifacts/game-camera-review-fixes/regressions.json`과 화면이다.
`placement-game-camera-save-smoke.mjs`도 같은 gate에서 호출한다. 직교/원근 DPR 2의 실제 frontend와 native renderer에서
포커스를 유지한 dirty/clean 입력이 저장 요청에 포함되는지, 저장 중 중복 요청 차단, unchanged 입력의 no-op,
잘못된 값·빈 값·불완전 숫자(`badInput`)의 저장 차단과 입력/포커스 보존을 검사한다.
native 거절·연속 복원 실패의 초안/이력·transaction 소유권, backend 저장 거절 후 재시도, signed pitch 저장 후
지연된 blur의 중복 편집 방지, 재열기와 실제 일시정지 미리보기도 확인한다. export-only 저장 명령은 입력을 확정하지 않는다.
고정된 일시정지 카메라 패널에서도 입력 포커스를 유지한 저장과 지연된 blur의 중복 편집 방지를 검사한다.
저장 bridge는 테스트 메모리/sessionStorage만 사용하고 실제 native 파일 저장을 실행하지 않는다.
native entity 3개·billboard vertex 18개·draw 1~32회 조건과 근거는 `artifacts/game-camera-pending-save-fix/save-regressions.json`이다.
화면·측정 근거는 `artifacts/viewport-toolbar-ux/`다. grid/locale/공간 배치 회귀도 실제 보기 버튼으로 설정을 연다.
HD-2D gate는 orthographic/perspective에서 Pan 버튼·H·Space 드래그의 실제 화면 투영 이동, Escape 취소,
휠 확대·복원과 비활성 2D 카메라·선택·문서·history 불변도 확인한다. 크기/화면 근거는 `artifacts/viewport-navigation-sizing/`다.
HD-2D 검증은 실제 공간 renderer의 다층/경사 terrain, model bounds·billboard 선택, XY/body 높이·층/시각 offset,
height Undo, edit camera, Game Preview 종료 후 draft/history 복원, source/diff evidence·선택 native 진단,
JSON 재개방과 canvas offset·DPR 2 SVG overlay를 확인한다. 하단 Problems/Runtime/Agent Changes 탭을
실제로 선택하여 해당 패널과 native 값·원본 경로가 보이는지 검사한다.
공간 값만 바꾼 v3 초안도 변경 수·dirty·Copy Patch에 포함하며 native 저장 버튼과 저장 후 clean 복귀를 확인한다.
화면 근거는 `artifacts/placement-spatial-workspace/`다.
같은 gate의 `placement-ui-polish-smoke.mjs`는 1440/1280/1024/768/390px에서 2D·HD-2D 화면을 검사한다.
기본/최소 Inspector 폭의 Handoff 라벨, 회전·배율 라벨/checkbox 크기, 선택 우선 섹션·고정 camera 도구,
Export Only와 dirty 분리·별 즐겨찾기, 단일 패널 서랍·키보드/focus 복원·desktop 설정 보존,
에셋 pressed/readout의 취소·drag·모드/문서 lifecycle을 확인한다. 서랍 닫기 후 실제 native terrain 배치·숫자 편집·Undo도 검사한다.
Selected Runtime의 health/timer/변수/event 요약과 기본 접힌 Raw JSON, 선택 변경 시 event 정리도 실제 Wasm으로 확인한다.
7항목 화면/측정 근거는 `artifacts/authoring-ui-polish/`다.
같은 gate의 `placement-ui-review-fixes-smoke.mjs`는 2D→HD-2D/Game→2D 왕복 뒤 선택 클릭의 객체 수·초안·이력 불변,
실패한 native 모드 전환의 기존 배치 대기 보존, sprite/frame·회전·배율 변경 후 대기 취소와 재배치 visual 일치를 확인한다.
실제 mouse drag/Escape의 dragstart·dragend와 대기 정리도 확인한다. 844×390·768×400·390×500의 2D/HD-2D에서
Scene/Inspector/Panels 서랍의 실제 표시, 양수 canvas 높이·native camera 오류 부재·resize 뒤 terrain picking을 검사한다.
화면/측정 근거는 `artifacts/authoring-ui-review-fixes/`다.
같은 gate의 `placement-six-panels-smoke.mjs`는 Inspector Properties/Placement의 상호 숨김과 방향키/Home,
Scene 검색·종류/layer 필터·fragment 그룹·Frame Selected의 문서/이력 불변, Terrain 선택별 유효 필드를 확인한다.
현재 층/선택 높이와 Floors·proxy overlay 접근, Play/Pause/Resume의 실제 native 상태와 renderer 유지,
Stop의 초안/이력 복원, 하단 단일 탭 표시, 고정 Review/Export와 Export Only 저장 제한도 검사한다.
844×390·390×844 compact canvas 최소 높이/페이지 스크롤/중복 Inspector 제목 부재를 확인한다.
화면/측정 근거는 `artifacts/authoring-workspace-six-panels/`다.
Desktop bridge smoke는 native revision이 같은 에셋의 upload 생략, 변경 texture만 reload,
취소된 지연 upload와 오래된 folder inspection의 결과 차단도 검사한다.
실제 Tauri picker/protocol/save는 별도 native GUI 검증이며 Chromium bridge로 대체하지 않는다.
Linux native GUI에서는 실제 GTK project/file picker로 두 문서를 열고 탭별 draft/history·asset 문맥,
저장 대상 경로, 재개방, 외부 변경 충돌 시 원본/초안 보존과 미개방 경로 거절을 확인한다.
HD-2D 문서는 GLB catalog/preload·SHA-256 contentId 일치, terrain/model/billboard 선택과 높이/층/pose 저장,
Preview 종료 후 draft/history/camera 복원, 보이는 진단과 새 native entity handle을 확인한다.
이미지 reimport는 같은 ID/URL의 변경 픽셀·metadata, 변경 전 revision 409와 다른 폴더 revision의 격리를 검사한다.
증거에는 실제 frontend/binary/source hash, 화면, protocol MIME/status와 저장 전후 JSON을 남긴다.
이 검증은 macOS/Windows installer·signing이나 실제 대상 GPU 성능 검증을 대신하지 않는다.

로컬 게임 설치 도구는 빌드된 Wasm/JS가 있는 상태에서 `pnpm smoke:local-engine-install`로
검증한다. 실제 npm tarball 오프라인 설치, public import, 설치 파일 일치와 게임 검증
실패 시 직전 엔진/package/lockfile 복원을 확인한다. 독립 개발 도구 smoke이며 CI/release
aggregate에는 편입하지 않았다. 실제 적용 명령은
[로컬 엔진 설치](../operations/local-engine-install.md)를 따른다.

권장 명령:

```bash
pnpm smoke:check
```

이 명령은 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm report:example-demo-harness`
3. `pnpm test`
4. `pnpm validate:docs-links`
5. `pnpm validate:public-api-surface`
6. `pnpm release:candidate-check`
7. `pnpm validate:runtime-budget-product`
8. `pnpm validate:rust-test-harness`
9. `pnpm validate:game-spec`
10. `pnpm validate:physics-authoring`
11. `pnpm validate:data-scene-authoring`
12. `pnpm smoke:runtime-budgets`
13. `pnpm smoke:mass-objects`
14. `pnpm smoke:physics`
15. `pnpm smoke:topdown-authored-behavior-variant`
16. `pnpm smoke:level-streaming`
17. `pnpm smoke:level-streaming-browser`
18. `pnpm smoke:asset-pipeline`
19. `pnpm validate:gameplay-authoring:report`
20. `pnpm smoke:gameplay-replay:report`
21. `pnpm validate:gameplay-report-artifacts`
22. `pnpm smoke:create-game-template-catalog`
23. `pnpm smoke:create-game-template-reports`
24. `pnpm smoke:topdown-template-replay-report`
25. `pnpm smoke:topdown-authored-behavior-runtime`
26. `pnpm smoke:topdown-mass-objects`
27. `pnpm smoke:topdown-tilemap-budget`
28. `pnpm smoke:starter-runtime`
29. `pnpm smoke:placement-viewer`
30. `pnpm smoke:placement-viewer-save`
31. `pnpm smoke:placement-viewer-mass-authoring`
32. `pnpm smoke:placement-viewer-desktop-assets`
33. `pnpm smoke:content-runtime`
34. `pnpm smoke:headless`
35. `pnpm build`
36. `pnpm package:check`

`pnpm smoke:check`는 Starter Runtime, Scene Placement Viewer, Minimal Game content runtime showcase, Top-down authored behavior runtime의 browser smoke까지 포함하지만, 모든 장르의 WebGL2 화면, 키보드/마우스 입력, 브라우저 오디오 unlock 상태를 전부 확인하지는 않는다. 나머지 항목은 아래 browser render smoke check와 수동 smoke check에서 확인한다.

`pnpm validate:docs-links`는 `docs/**/*.md`의 내부 Markdown 링크와 heading anchor를 확인한다. GitHub Pages 산출물까지 확인하는 문서 전용 작업에서는 `pnpm build:pages` 이후 `pnpm validate:pages-artifact`를 함께 실행한다.

`pnpm validate:game-spec`는 예제 `game.json`을 public package build의 `resolveShooterGameSpec(...)`로 정규화한다. 이 게이트는 shooter gameplay field뿐 아니라 `content.localization`, `content.dialogue.graphs`, `content.cutscenes` namespace도 검증해 agent가 작성한 narrative/content 데이터의 path diagnostic을 고정한다. Runtime option 자동 결선 정책은 ferrum-web test에서 `createShooterContentRuntimeOptions(...)`와 `resolveShooterContentRuntimeSelection(...)`로 검증한다.

`pnpm smoke:gameplay-replay`는 Top-down Shooter golden replay fixture를 비교하고, 각 scenario를 같은 Wasm build에서 두 번 실행해 deterministic hash가 안정적인지 확인한다. `data-scene-authoring-snapshot-restore` scenario는 public `createEngine(...)`에서 Data Scene을 적용하고 global/scene 변수를 변경한 뒤 `paused` 상태로 캡처해, fresh runtime의 authoring document, scoped 변수, lifecycle state와 custom callback 관측 상태가 모두 동일하게 복원되는지도 검증한다. 출력의 `actionDiagnostics`와 `spawnDiagnostics`는 replay snapshot hash에 포함되지 않는 agent-facing summary다. Rust-owned action trigger frame telemetry와 decoded `actionFailed` event를 `path`/`expected`/`actual`/`suggestion` report로 변환하고, spawn flush telemetry를 same-frame spawn activity report로 변환하므로, 실패 action/spawn spec을 수정할 때 smoke pass/fail보다 구체적인 JSON path 신호를 제공한다.

agent가 이 summary를 파일로 소비해야 하면 다음 명령을 사용한다.

```bash
pnpm smoke:gameplay-replay:report
```

이 명령은 기본 smoke와 같은 검증을 수행한 뒤 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`에 versioned report를 저장한다. report root는 `format: "ferrum2d.gameplay-replay.smoke-report"`, `version`, `ok`, `gameplayReplaySmoke`, 실패 시 `errors`를 포함한다. golden mismatch처럼 command가 실패하는 경우에도 가능한 범위의 scenario summary, replay comparison, `actionDiagnostics`, `spawnDiagnostics`를 artifact로 남긴 뒤 non-zero로 종료한다. scenario가 positive spawn activity를 관측했지만 manifest에 해당 frame/metric expectation이 없으면 summary의 `spawnExpectationPatches`가 `FERRUM_GAMEPLAY_SPAWN_EXPECTATION_PATCH_CANDIDATE` report로 실행 중인 manifest의 `expected.spawnDiagnostics`에 추가할 object 후보를 제공한다. 이미 expectation으로 검증된 metric은 성공 run에서 patch 후보를 만들지 않는다. 기본 `pnpm smoke:gameplay-replay`는 artifact를 만들지 않는다.

agent가 gameplay authoring proposal을 apply 전에 검증해야 하면 다음 명령을 사용한다.

```bash
pnpm validate:gameplay-authoring:report
pnpm smoke:gameplay-replay:report
pnpm validate:gameplay-report-artifacts
```

`pnpm validate:gameplay-authoring:report`는 Top-down authored behavior variant의 Game Spec 참조, runtime id registry, `SceneComposition` + `BehaviorRecipe` binding dry-run, selected placed id별 `agentAttachment`, placement agent handoff fixture 연결, FSM install plan summary, state command preflight summary, replay manifest와 fixture index 연결을 public package build에서 검증하고 `artifacts/gameplay-authoring-dry-run/gameplay-authoring-dry-run-report.json`에 versioned report를 저장한다. 기본 variant 검증은 `tests/fixtures/gameplay-authoring/placement-agent-handoff.json`을 읽어 handoff envelope contract, `selectedInstanceId`와 `selected.instanceId` 일치, selected instance가 dry-run `agentAttachment`에서 실제 behavior command를 갖는지 확인하고 `gameplayAuthoringDryRun.placementHandoff` summary를 기록한다. 다른 variant를 검증할 때는 `--placement-handoff <path>`로 같은 SceneComposition에서 export한 handoff를 넘기거나 `--no-placement-handoff`로 이 연결 검증을 끌 수 있다. fixture index의 `coverageTagDefinitions`가 replay manifest와 다르면 `gameplayAuthoring.replayManifest.fixtureIndex.coverageTagDefinitions` path를 가진 machine-actionable report로 실패한다. variant의 `expected.agentAttachment`가 실제 instance id, role, behavior profile, command target summary와 다르면 `gameplayAuthoring.variant.expected.agentAttachment` path로 실패한다. report root는 `format: "ferrum2d.gameplay-authoring.dry-run-report"`, `version`, `ok`, `gameplayAuthoringDryRun`, 실패 시 `diagnostics`/`reports`/`errors`를 포함한다. 생성된 report는 출력/저장 전에 `schemas/gameplay-authoring-dry-run-report.schema.json` 계약으로 self-validate한다. `gameplayAuthoringDryRun.stateCommandPreflight`는 machine/state별 target entity, command type, result count, `replaceSupported` clear operation을 mutation 없이 기록한다. `reports`는 `path`, `expected`, `actual`, `suggestion`을 포함해 agent가 JSON patch 후보를 만들 수 있는 신호를 제공한다. 이 명령은 Wasm build나 runtime apply를 수행하지 않으며, frame hot path callback도 추가하지 않는다.

`pnpm smoke:gameplay-replay:report`는 replay smoke report를 `artifacts/gameplay-replay-smoke/gameplay-replay-smoke-report.json`에 저장한다. `pnpm validate:gameplay-report-artifacts`는 이미 존재하는 authoring/replay report artifact가 각각 `schemas/gameplay-authoring-dry-run-report.schema.json`, `schemas/gameplay-replay-smoke-report.schema.json`을 만족하는지 확인하고, 성공 report인지, replay scenario가 비어 있지 않은지, 각 scenario가 `passed: true`인지도 검사한다. freshness가 필요한 경우 `pnpm smoke:check`처럼 `validate:gameplay-authoring:report`와 `smoke:gameplay-replay:report`를 먼저 실행한다.

WebGL2 실제 화면의 black-frame 회귀만 자동 확인하려면 별도 browser smoke check를 실행한다.

```bash
pnpm smoke:browser
```

Scene Placement Authoring Viewer의 공식 host와 screen-coordinate picking 회귀를 확인하려면 다음을 실행한다.

```bash
pnpm --filter @ferrum2d/placement-viewer lint
pnpm smoke:placement-viewer
pnpm smoke:placement-viewer-save
pnpm smoke:placement-viewer-mass-authoring
pnpm smoke:placement-viewer-desktop-assets
```

공식 viewer의 `lint`는 app `src`와 참조하는 shared runtime shell을 strict TypeScript로 검사하며
workspace `pnpm lint`에도 포함된다. Vite build의 transpile 성공과 타입 검사 성공을 별도로 확인한다.

`pnpm smoke:placement-viewer`는 `apps/placement-viewer` production build를 정적 서버로 열고, Data Scene preview가 6개 entity와 6개 이상 render command를 만들었는지, canvas readback이 nonblank인지, 실제 pointer move/click이 `crate_left` hover/selection과 inspector state로 반영되는지 확인한다. 또한 `crate_left` draft transform update가 `ScenePlacementPatch` export와 갱신된 picking bounds에 반영되는지, Handoff 섹션이 draft/reference/asset diagnostic count와 Copy Patch/Copy Handoff/Save Draft action 상태를 표시하는지, Behavior Binding inspector가 기존 recipe id attach/detach를 `updateBehaviorBinding` patch로 내보내고 recipe 본문을 건드리지 않는지, 다른 instance를 선택해도 moved draft marker가 유지되는지, Add Rect/Circle/Point/Sprite/Prefab palette가 렌더되는지, Add Sprite frame picker가 UV frame patch를 만드는지, generated `ScenePlacementAgentHandoff`가 selected instance, draft patch, ownership fields, asset diagnostics array를 포함하는지, collider overlay가 선택 collider를 표시하는지, Add Rect pending mode와 hover preview marker가 표시되는지, canvas click이 `props.components.visual.kind: "primitive"` add patch를 만드는지, 선택 overlay resize handle이 rect visual/aabb collider size patch를 만드는지, collider offset handle drag와 Visual/Collider/Layer inspector edit이 added instance의 component patch export로 접히는지, capsule/orientedBox/convexPolygon collider inspector edit이 같은 component patch export로 접히는지, selected instance 기반 ObjectDefinition 생성 action이 `addObjectDefinition` patch와 prefab option으로 반영되는지, 기본 실행에서 save hook이 opt-in 없이 동작하지 않는지도 확인한다. `pnpm smoke:placement-viewer-save`는 `VITE_FERRUM_PLACEMENT_VIEWER_SAVE=true` opt-in build와 smoke host save endpoint를 사용해 primitive/sprite/prefab/ObjectDefinition add patch를 저장하고 reload 뒤 visual/collider offset/layer/prefab reference와 ObjectDefinition 기반 instance가 draft 없이 유지되는지 확인한다.
`pnpm smoke:placement-viewer-mass-authoring`은 같은 production build를 `massAuthoring=true` fixture mode로 열고 기본 6개 instance에 1,024개 crate instance를 추가한 authoring document를 낮은 빈도 load path에서 생성한다. smoke는 `ScenePlacementViewerState.instances`와 Rust runtime `entityCount`가 1,030개 이상인지, responsive viewport culling 뒤에도 visible `renderCommandCount`가 518개 이상이고 전체 entity 수를 넘지 않는지, draw call이 16 이하인지 확인한다. 또한 `mass_crate_0512` 선택과 transform draft patch가 각각 500ms 이하에서 끝나는지, draft marker가 선택된 1개 object에만 생기는지, agent handoff selected/draft summary가 같은 object를 가리키는지 확인한다.
`pnpm smoke:placement-viewer-desktop-assets`는 같은 production build에 fake Tauri bridge를 주입해 desktop project open과 asset folder switch를 재현한다. smoke는 local asset `runtimeUrl`이 initial runtime texture manifest에 포함되고 `engine.textureId(...)`가 0보다 큰 값을 반환하는지, local asset을 참조하는 Data Scene instance가 render command와 nonblank canvas로 이어지는지, 다른 asset folder 선택 후 runtime asset snapshot/handoff/Inspector status가 새 image manifest로 reload되는지 확인한다. 또한 실제 32x32/16x16 PNG metadata가 provider와 handoff `assetFolder.images[].width/height`에 남고, Add Sprite pending/draft marker와 visual/AABB collider가 같은 thumbnail/size/id를 사용하는지 검증한다.
이 mode의 HTML 응답에는 `apps/placement-viewer-desktop/src-tauri/tauri.conf.json`의 CSP를 적용하고
navigation 응답의 정책 일치도 검사한다. `desktopCsp` report에 설정 경로와 적용한 정책을 남긴다.
기본 `data:` 텍스처의 fetch/decode, 초기화 또는 canvas 렌더링이 차단되면 실패하므로 `img-src`에만
`data:`를 허용하고 `connect-src`에서 빠뜨린 회귀도 검출한다. 실제 native custom protocol은 fake bridge
대상에 포함되지 않으며 별도 GUI 검증이 필요하다.
`placementViewerDesktopAssetSmoke.sameNameReload`는 같은 asset id/URL을 반환하는 두 폴더를 전환하고
같은 폴더를 다시 inspect했을 때 metadata 크기와 실제 WebGL 픽셀 hash가 새 이미지에 맞게 바뀌는지
검증한다. 이전 runtime upload를 의도적으로 지연한 뒤 최신 폴더를 선택하는 경우도 검사하며,
최종 픽셀이 최신 이미지와 같아야 한다. 빈 drawing buffer나 context loss는 성공 evidence로 인정하지 않는다.

`pnpm smoke:placement-viewer-desktop-package`는 production frontend를 포함한 Tauri debug Linux deb를 만들고
명시적 CSP, 실행 파일, deb 내부 실행 파일, `index.html`, Wasm artifact를 검증해 JSON report를 출력한다.
같은 frontend에 `placement-viewer-desktop-assets` browser smoke도 실행해 실제 CSP 아래에서 texture와
canvas가 정상인지 확인하고 report의 `frontend.browserSmokeMode`에 검증 mode를 남긴다.
`--launch`를 붙이면 `xvfb-run` 아래에서 process가 지정 시간 동안 조기 종료하지 않는지도 확인한다.
현재 GitHub Actions에는 편입하지 않았다. CI/release gate 변경은 별도 승인 뒤 결정한다. 로컬 자동
검증만으로 native dialog 상호작용과 native WebView canvas pixel을 증명한 것으로 보지 않으며, release 전 project/file
picker, save allowlist, `ferrum-asset://`, handoff sync, nonblank interactive canvas를 수동 GUI evidence로
확인한다.

fragment hierarchy 회귀는 ferrum-web `sceneComposition`, `scenePlacementViewer`,
`scenePlacementPatch` 테스트가 담당한다. 같은 fragment의 반복 include 중 한 occurrence를 world 좌표로
이동했을 때 patch v2가 parent-local `instanceTransforms`로 round-trip되고 sibling occurrence가 유지되는지,
patch v1 flat 문서를 계속 merge하는지 확인한다.
Tauri desktop wrapper의 Rust command 계약은 `pnpm --filter @ferrum2d/placement-viewer-desktop check`와 `pnpm --filter @ferrum2d/placement-viewer-desktop test`로 확인한다. 이 테스트는 기본/명시 scene-authoring JSON load/save, project folder의 `public/scene-authoring.json` 자동 탐색, 성공적으로 연 canonical scene/project만 쓰는 write allowlist, 미승인 sibling 경로와 handoff 심볼릭 링크 대상 거부, 기본/명시 asset folder inspect, local image의 `ferrum-asset://...` preview URL 생성과 protocol MIME/CORS 응답, `.ferrum-placement-handoff.json` 저장, 잘못된 프로젝트 폴더와 handoff envelope 거부를 검증한다. 실제 GUI window, project 직접 경로 입력, asset folder picker, Add Sprite local thumbnail preview, handoff 자동 sync 상태, native dialog 조작, `.app` 실행은 수동 검증 범위다.

Starter Runtime의 실제 browser runtime에서 profiler frame/render/asset budget 회귀까지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:browser-budget
pnpm smoke:runtime-budgets
pnpm smoke:mass-objects
pnpm smoke:topdown-mass-objects
pnpm smoke:topdown-tilemap-budget
pnpm smoke:topdown-budget
pnpm smoke:breakout-budget
pnpm smoke:platformer-budget
pnpm smoke:physics-sandbox-budget
```

`pnpm smoke:mass-objects`는 Rust core 내부 `Engine` 테스트를 통해 1,000개 visible enemy와 512개 projectile lane이 한 frame에서 Shooter update/render command 경로를 통과하고, sparse horde 배치에서 collision pair가 폭증하지 않는지 확인한다. 또한 128개 overlapping enemy의 collision lifecycle total/trigger pair budget을 고정해 dense 배치에서 broadphase pair 수가 의도치 않게 바뀌는 회귀를 잡는다. 출력은 `format: "ferrum2d.mass-object-stress.smoke-report"` report와 scenario별 `enemyCount`, `projectileCount`, `entityCount`, `renderCommandCount`, `collisionPairCount`, `collisionSolidPairCount`, `collisionTriggerPairCount`, `shooterBulletEnemy*`, `shooterBulletPlayer*`, `shooterPlayerEnemy*`, `updateMicros` metric을 포함한다. `shooter*ProxyCount` metric은 Shooter 전용 collision/swept pair builder가 실제 대량 레이어 proxy를 통과했는지 고정한다. 이 smoke는 browser GPU frame time을 대체하지 않고, 대량 오브젝트 최적화 전후의 Rust-side 구조 회귀를 빠르게 고정하기 위한 기준이다.

`pnpm smoke:topdown-mass-objects`는 Top-down Shooter production build를 browser에서 열고 smoke-only snapshot restore로 1,024개 enemy entity를 한 번에 복원한다. 이후 일반 frame loop가 Playing 상태에서 Rust render command buffer를 만들고 WebGL2 renderer가 이를 소비하는지 확인하며, `RuntimeProfiler` budget으로 render command count, draw call, texture switch, collision pair count, frame/render time 회귀를 함께 검증한다. 이 smoke는 public spawn API나 새 Wasm ABI를 추가하지 않고 `restoreShooterStateSnapshot()` setup 경로만 사용한다.

`pnpm smoke:topdown-tilemap-budget`은 Top-down Shooter production build를 browser에서 열고 smoke-only 64x32 tilemap Game Spec을 주입한다. 이후 Playing 상태에서 2,048개 이상의 tile render command가 WebGL2 renderer로 소비되는지 확인하고, `RuntimeProfiler` budget으로 draw call, texture switch, render command count, frame/render time 회귀를 함께 검증한다. 이 smoke는 resident dense tile layer의 현재 render cache/batching 성능을 고정하며, 무제한 월드 streaming 검증을 대체하지 않는다.

Minimal Game의 visual/input-ui 실험 표면은 별도 예제로 분리하지 않고 `Minimal Runtime Lab`으로 묶는다. `visual-runtime-lab`은 `smoke:lighting`, `smoke:lighting-webgpu`, `smoke:material`, `smoke:material-webgpu`, `smoke:camera-postprocess`, `smoke:particle-vfx`가 같은 `examples/minimal-game/dist`에 query flag를 켜서 확인한다. `input-ui-lab`은 `smoke:preload`, `smoke:mobile-input`, `smoke:content-runtime`이 LoadingOverlay, VirtualControls, UiOverlay/content runtime 연결을 확인한다. 이 lab profile은 smoke/manual QA용 명칭이며 public portfolio demo나 사용자-facing in-app profile switcher가 아니다.

Minimal Game smoke fixture의 loading overlay, asset preload progress, IndexedDB JSON/texture body cache 회귀를 확인하려면 다음을 실행한다. Top-down Shooter의 실제 asset manifest preload/cache 적용은 `pnpm smoke:topdown` production build 경로에서 함께 검증한다.

```bash
pnpm smoke:preload
```

WebGL2 lighting pass가 ambient overlay, point light, tile occluder debug draw, shadow projection을 실제 canvas에 반영하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:lighting
```

WebGPU lighting pass가 같은 lighting/shadow stats를 보고하는지 확인하려면 다음을 실행한다. WebGPU를 사용할 수 없거나 renderer가 WebGL2로 fallback한 환경에서는 capability-aware skip 결과를 낸다.

```bash
pnpm smoke:lighting-webgpu
```

Sprite material preset의 outline/additive fallback pass가 WebGL2/WebGPU renderer에서 동작하는지 확인하려면 다음을 실행한다. WebGPU를 사용할 수 없거나 renderer가 WebGL2로 fallback한 환경에서는 WebGPU smoke가 skip 결과를 낸다.

```bash
pnpm smoke:material
pnpm smoke:material-webgpu
```

Particle/VFX preset의 trail emitter가 runtime particle burst와 render command로 이어지는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:particle-vfx
```

Animation timeline의 frame event와 signal/atEnd transition helper가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:animation-timeline
```

Scene composition의 prefab variant/override 검증과 reusable fragment apply path가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:scene-composition
```

Behavior recipe schema가 common gameplay command를 만들고 runtime adapter target으로 전달하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:behavior-recipes
```

HUD toolkit의 theme token과 meter/counter/prompt component preset이 public overlay state로 변환되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:hud-toolkit
```

Audio System v2의 BGM loop/fade와 master/bgm/sfx/ui bus 상태가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:audio-system
```

Camera/post-processing pack의 camera bounds/dead-zone helper와 fullscreen post-processing pass가 public package/browser runtime에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:camera-postprocess
```

Cutscene/sequence helper의 wait/camera/audio/dialogue command 진행, target adapter hook, dialogue text localization helper 연결이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:cutscene-sequence
```

Minimal Game production build에서 `createFerrumRuntime({ localization, cutscene, hud, accessibility, animationTimeline })` opt-in이 실제 browser runtime과 `UiOverlay` dialog/HUD/subtitle DOM, runtime timeline update report까지 연결되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:content-runtime
```

Localization/text helper의 string table fallback, text wrapping, font loading policy가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:localization
```

Dialogue/quest helper의 graph 진행, createFerrumRuntime opt-in export, UI overlay hook, save-state snapshot restore가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:dialogue-quest
```

Generic Physics Scene Integration의 scene profile apply와 runtime auto-step option 연결이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics-scene
```

Texture Atlas Packing의 deterministic atlas JSON CLI와 public conversion helper가 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:texture-atlas
```

raw sprite folder에서 texture atlas와 Game Spec atlas metadata를 만들고, Aseprite import helper, localization bundle, audio asset decode 경로까지 함께 검증하려면 다음을 실행한다.

```bash
pnpm smoke:asset-pipeline
```

Level Streaming/Chunking의 chunk manifest, viewport 기반 load/unload plan, asset lifetime policy, runtime preload/load/unload adapter, target apply/unload/releaseAssets, renderer texture eviction 경로가 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:level-streaming
```

Level Streaming/Chunking이 실제 Chromium + WebGL2 renderer + `BrowserPlatformHost` asset release 경로에서 frame budget을 만족하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:level-streaming-browser
```

이 browser smoke는 built `@ferrum2d/ferrum-web` 모듈을 정적 서버로 열고, 두 chunk를 순차 활성화한 뒤 256개 sprite render command, draw call 2회, texture switch 1회, `RuntimeProfiler` budget pass, 공유 텍스처 retain, 이전 chunk 전용 텍스처 eviction, canvas pixel readback을 함께 검증한다.

In-game Debug Gizmos의 path/spawn/prefab/collider category가 physics debug line buffer로 변환되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:debug-gizmos
```

Accessibility Options의 reduced motion adapter, subtitle panel, contrast palette hook이 public package build에서 동작하는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:accessibility-options
```

Browser smoke screenshot artifact와 screenshot summary threshold 비교 경로를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:screenshot-capture
```

Marketplace-ready template set의 `minimal`, `topdown`, `platformer`, `breakout` gameplay replay fixture와 template catalog/report scaffold를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:create-game-template-catalog
pnpm smoke:create-game-template-reports
pnpm smoke:template-set
```

`pnpm smoke:create-game-template-catalog`는 `@ferrum2d/create-game --list-templates --json` 출력이 `packages/create-game/templates/manifest.json`과 일치하는지 확인한다. 또한 기존 human-readable `--list-templates` 출력이 JSON으로 바뀌지 않았는지, `--json`을 `--list-templates` 없이 사용하면 명확한 오류로 실패하는지, manifest가 잘못된 `sceneAuthoring` 계약을 포함하면 JSON catalog를 출력하기 전에 실패하는지도 검증한다. 이 smoke는 install, tarball pack, template copy, production build를 수행하지 않는다.
`pnpm smoke:create-game-template-reports`는 template별 `ferrum:*` report envelope를 검증한다. `minimal`/`topdown`/`platformer`/`breakout`은 asset report/validate scaffold와 authoring/replay/runtime replay fixture가 `configured`/`validated` 상태여야 한다. deploy readiness synthetic fixture는 정상 상대 경로를 통과시키고, 잘못된 Wasm server mapping과 절대 `fetch(...)` runtime asset 경로를 각각 `FERRUM_DEPLOY_MIME_MISMATCH`, `FERRUM_DEPLOY_ABSOLUTE_ASSET_PATH`로 거부해야 한다.

DOM virtual joystick/button preset이 runtime input으로 합성되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:mobile-input
```

## Physics smoke check

`physics:fast-projectile-ccd`에는 compound secondary의 moving/target 접촉, collider별 filter·재질,
chain의 두 번째 이후 segment를 검증하는 실제 Rust 회귀가 포함된다. Core 전체 테스트는 primary
sensor/disabled와 solid secondary의 공존, 높이 filter, dynamic target wake와 동일 시각 hit 선택도 검사한다.
빠른 회전 궤적의 연속 충돌과 대형 씬의 broadphase 성능 개선은 이 통과 결과에 포함하지 않는다.

`physics:hd2d-navigation-combat`는 실제 `move_spatial_body`의 원·캡슐·convex·edge·chain 및 compound
장애물과 층 gateway 거절, cached query의 collider/segment별 비용 청구도 검사한다.
`pnpm smoke:placement-village`에는 실제 우물의 원형 collider에 대한 WASD 차단과 12개 native
장애물/필터 사례가 포함된다. 빌드 후 `node tests/smoke/placement-village-smoke.mjs --physics-only`로
같은 물리 검증만 실행할 수 있다. Stop 뒤 원본 authoring 문서 보존을 함께 assert한다.
전용 물리 검사에는 다리의 높이 2→0 전환, 다리 밖 강 차단과 경사로→정원→지면 왕복도 포함한다.
이는 전체 마을 viewport/camera 픽셀 검사를 대체하지 않는다.

Rust 물리엔진의 대표 solver/CCD/query 회귀를 빠르게 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics
pnpm smoke:physics-replay
pnpm smoke:destructible-terrain
pnpm smoke:destructible-terrain-browser
```

Tilemap authoring helper의 autotile/animated tile bake와 Tiled/LDtk import fixture 연동 회귀를 확인하려면 다음을 실행한다.

```bash
pnpm smoke:tilemap-authoring
```

이 명령은 `tests/smoke/physics-smoke.mjs`가 canonical Rust test fixture를 scenario 단위로 실행하고, 각 scenario와 전체 suite의 seed/frame/suite hash를 출력한다. 이 hash는 실행한 scenario manifest와 통과 결과를 식별하는 smoke summary 값이다. `physics:joint-despawn-budget`은 Rust test가 출력한 `ferrum2d.physics-budget` marker를 필수 metric으로 파싱하며, marker 누락이나 측정값의 budget 초과도 scenario 실패로 처리한다. wall-clock 측정값 자체는 결정론 hash에 포함하지 않는다.
`pnpm smoke:physics-replay`는 같은 physics smoke suite를 2회 실행해 suite hash가 안정적으로 일치하는지 확인하고, Web public replay helper가 생성한 snapshot state hash(`stateReplayHash`)도 함께 비교한다. 실패 시 run, seed, frame, suite hash, scenario별 hash 차이를 출력한다.
`stateReplayHash`는 Web replay helper의 snapshot/restore/hash 계약을 Node deterministic harness에서 확인하는 값이며, Wasm physics state 전체를 직렬화한 hash는 아니다.
`pnpm smoke:destructible-terrain`은 tilemap rect edit가 collision query와 render command를 같은 tile occupancy source에서 갱신하고 collision obstacle cache를 dirty chunk 단위로 재빌드하는지 확인하며 seed/frame/suite hash를 출력한다. `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter production build에서 deterministic tile 제거를 실행해 browser query와 render command count가 함께 변하는지 확인한다.
Web public API의 `PhysicsReplayInputStream`은 frame/seed/fixed step/body event와 interval snapshot을 기록해 tooling 단위 rollback 검증에 사용한다.

현재 scenario:

- `physics:stacked-boxes`: stack 안정성, sleep/island stats, block solver
- `physics:joint-chain`: rope/spring/revolute/prismatic/weld joint constraint
- `physics:joint-despawn-budget`: 4,096개 spoke와 8종 joint로 구성한 32,768-link graph의 cascade 정확성 및 250ms cleanup budget
- `physics:fast-projectile-ccd`: fast dynamic body CCD matrix
- `physics:tile-edge-snagging`: edge collider pair/contact/cast 회귀
- `physics:moving-platform-character`: moving platform linear/rotation carry와 platformer controller
- `physics:query-cast-matrix`: overlap/raycast/shape-cast matrix
- `physics:hd2d-navigation-combat`: bridge portal multi-floor navigation, projectile arc height span, projectile/tile height filter, render sort

Compound collider runtime apply는 Rust collision/solver unit test, Web physics authoring unit test, `compound-collider` sandbox fixture로 보장한다.
Destructible terrain prototype은 Rust tilemap/engine unit test와 `destructible-terrain:tile-rect-edit` smoke scenario로 보장한다.

개별 scenario 목록은 다음으로 확인한다.

```bash
node tests/smoke/physics-smoke.mjs --list
```

Top-down Shooter의 particle burst와 non-lethal enemy tint flash가 production build의 browser render path에서 감지되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:topdown
pnpm smoke:topdown-save-load
pnpm validate:topdown-authored-behavior-variant
pnpm validate:gameplay-authoring:report
pnpm smoke:topdown-authored-behavior-variant
pnpm smoke:topdown-authored-behavior-runtime
pnpm smoke:gameplay-replay
pnpm smoke:topdown-hd2d
```

`pnpm validate:topdown-authored-behavior-variant`와 `pnpm smoke:topdown-authored-behavior-variant`는 `examples/topdown-shooter/public/authored-behavior.variant.json`을 읽어 기본 `game.json`이 여전히 `resolveShooterGameSpec(...)`를 통과하는지 확인하고, variant의 `ids` runtime token registry, `SceneComposition`, `BehaviorRecipe`, `BehaviorStateMachine`, `semantics.browserPlacement`, `replayScenario` 연결을 public package API로 검증한다. `pnpm validate:gameplay-authoring:report`는 같은 authoring 입력을 exact assertion smoke 대신 agent-facing report artifact로 요약하며, command count/type, selected placed id별 `agentAttachment`, instance binding, FSM transition summary, replay manifest/fixture index link, machine-actionable diagnostics를 제공한다. 이 report는 연결된 fixture index의 coverage tag vocabulary가 manifest와 같은지도 확인한다. 이 파일은 메인 Game Spec에 새 namespace를 넣지 않는 예제용 authoring artifact이며, agent가 prefab/behavior/FSM/replay 계약을 함께 patch할 수 있는 데이터 variant다. 편집기 보조용 구조 계약은 `schemas/topdown-authored-behavior-variant.schema.json`에 있다.

`pnpm smoke:topdown-authored-behavior-runtime`은 production Top-down Shooter build가 같은 variant JSON을 asset manifest로 preload/load하고, browser runtime에서 `window.ferrumTopdownAuthoredBehaviorVariant` summary로 노출하는지 확인한다. smoke URL은 `authoredBehaviorVariantApply=true`를 사용해 scene load 이후 낮은 빈도 경로에서 variant instance를 physics body로 spawn하거나 `runtimeEntity: "builtinShooterPlayer"`를 현재 built-in player handle에 매핑하고, variant `ids` registry를 통해 `FerrumEngine` gameplay authoring facade로 behavior commands와 FSM install plan을 Rust component storage에 적용한다. smoke는 `runtimeApply` summary의 instance count `8`, command count `15`, FSM initial/current state id, `applyId`, `semantics.browserPlacement`에서 온 placement anchor/target/scale, built-in player primary projectile action binding, dash action binding, spawnPrefab action binding(`summon-enemy`)을 검증한다. 또한 browser frame을 실제 Playing 상태로 진행해 score `15`, `interaction`/`collisionDamage`/`factionDamageDenied`/`pickupCollected`/`actionFailed`/`timer`/`prefabSpawned` event payload, one-shot interaction non-repeat, authored FSM state `2/2/1`을 `FrameState.gameplayEvents`와 typed engine query로 검증한다. 그 뒤 window-only helper `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`를 호출해 현재 FSM state command plan을 `replaceSupported` mode로 적용한다. smoke는 clear-only profile과 `test-projectile.spent`의 non-empty profile(`configureLifetime`)을 함께 검증한다. 이후 `ferrumTopdownAuthoredBehaviorResetAndReapply()`를 호출해 `resetGame()` 이후 stale handle을 버리고 variant를 다시 적용한다. 두 번째 run은 frame summary가 새 `applyId`를 갖는지, 이벤트 payload가 현재 `runtimeApply.handles`와 일치하는지, reset 직후 frame/state-command summary가 비워졌는지, state command apply가 두 번째 `applyId`에서도 동작하는지, one-shot interaction과 state change telemetry가 다시 중복 발행되지 않는지 확인한다. 이는 demo apply toggle이지 frame hot path callback이나 state-entry 자동 runtime이 아니다.

`pnpm smoke:gameplay-replay`는 `tests/fixtures/gameplay-golden/scenarios.json` manifest를 읽어 raw Wasm `Engine` 또는 public `createEngine(...)` runtime을 deterministic setup으로 실행하고, 각 scenario의 `fixturePath`에 있는 golden fixture와 `GameStateSnapshot` replay hash를 비교한다. manifest는 scenario id, human-readable description, kebab-case `coverageTags`, coverage vocabulary path, runner, optional `variantPath`, frame count, capture frame, input event, expected replay hash와 score/event/FSM/Data Scene metadata, optional `expected.spawnDiagnostics` frame metric을 고정하는 scenario 계약이다. `fixtureIndexPath`가 가리키는 `tests/fixtures/gameplay-golden/fixture-index.json`은 agent가 빠르게 읽는 파생 catalog이며, source of truth는 manifest다. coverage vocabulary의 source of truth는 `tests/fixtures/gameplay-golden/coverage-tags.json`이고, active `coverageTagDefinitions`, 빠른 탐색용 `coverageTagGroups`, 폐기 tag 보존용 `deprecatedCoverageTags`를 포함한다. 이 vocabulary는 앞으로 만들 gameplay taxonomy가 아니라 현재 커밋된 golden scenario coverage tag contract다. 따라서 모든 active definition은 최소 하나의 scenario에서 사용되어야 하고, 모든 active tag는 최소 하나의 group에 포함되어야 하며, scenario는 deprecated tag를 사용할 수 없다. 아직 coverage가 없는 계획용 tag는 roadmap에만 둔다. smoke는 index의 coverage vocabulary path, scenario id, description, coverage tags, runner, fixture path, replay hash, frame count, capture frame count가 manifest와 일치하는지 먼저 검증한다. 모든 coverage tag는 active vocabulary에 정의되어야 하며, 현재 smoke는 `spawn-diagnostics`/`action-failure`/`variant` 같은 일부 tag가 관련 manifest field와 함께 쓰이는지도 확인한다. 장르별 setup과 exact payload assertion은 runner가 소유한다. `example-topdown-authored-behavior`는 `variantPath`가 가리키는 Top-down authored behavior variant를 함께 읽어 scene instance, physics body metadata, behavior recipe command, FSM expected state가 replay authoring event와 일치하는지 검증한다. 각 scenario는 같은 build에서 두 번 실행해 actual-vs-actual determinism을 먼저 확인한다. 기본 fixture는 deterministic enemy spawn, projectile travel, enemy damage, score reward를 포함한다. authored behavior fixture는 raw Wasm setter로 설치한 score pickup, interaction event, collisionDamage reaction, source-scoped FSM transition을 exact event payload와 custom JSON state까지 포함해 검증한다. `projectile-tile-impact-fsm-authored` fixture는 raw Wasm authoring setter로 bounce tileImpact policy를 가진 projectile body와 FSM을 설치하고, 같은 Rust frame의 `tileImpact`와 `behaviorStateChanged` event payload를 exact custom state로 검증한다. `projectile-homing-nearest-tag` fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `seekTarget(nearestTag:hostile)`, damage, collision particle, collision despawn, lifetime을 설치한 뒤 Rust projectile movement, tagged target collision, `collisionDamage -> collisionDespawn -> presentationEffect` event payload, score reward, untagged decoy 생존을 exact custom state로 검증한다. `projectile-area-damage-entity-impact` fixture는 같은 TS binding 경로로 `collisionAreaDamage`, `collisionEmitEffect`, `collisionDespawn`, `accelerate`, lifetime을 설치한 뒤 반경 내 direct/splash enemy 제거, 합산 score reward, 반경 밖 enemy 생존, `collisionDamage -> collisionDamage -> collisionDespawn -> presentationEffect` event payload를 exact custom state로 검증한다. `projectile-area-damage-tile-impact` fixture는 TS `SceneComposition`/`BehaviorRecipe` binding으로 `collisionAreaDamage`를 설치한 projectile이 blocking tile에 닿을 때 Rust swept tile contact point 중심으로 direct/splash enemy damage, score reward, terminal `tileImpact` telemetry, 반경 밖 enemy 생존을 검증한다. `data-scene-authoring-snapshot-restore` fixture는 public `createEngine(...)`과 `applyDataSceneAuthoringDocument(...)`로 Data Scene entity/behavior를 조립하고, `GameStateSnapshot.dataScene.authoringDocument`와 custom JSON state를 capture한 뒤 fresh runtime restore에서 같은 authoring document 재적용과 `applyDataSceneCustomState` callback을 검증한다. authored timer spawn, wave action spawn, state-enter spawn/projectile scenario는 `expected.spawnDiagnostics`로 deferred spawn queue drain, projectile spawn, prefab payload/event push count를 검증하며 mismatch는 `gameplayReplay.frames.<frame>.spawnDiagnostics.<metric>` path와 expected/actual/suggestion을 가진 report로 실패한다. expectation 없이 관측된 positive spawn activity는 `spawnExpectationPatches`로 실행 중인 manifest의 patch 후보를 제공한다. `--artifact-dir`로 저장되는 smoke report는 출력/저장 전에 `schemas/gameplay-replay-smoke-report.schema.json` 계약으로 self-validate한다. 비교 범위는 scene metric, built-in shooter snapshot, Data Scene authoring/custom JSON state, custom JSON state이며 render/audio/debug/profiler output과 action/spawn diagnostic summary는 golden fixture/hash에서 제외한다. 의도한 gameplay behavior 변경으로 baseline을 갱신해야 할 때는 변경 리뷰 후 다음 명령을 실행해 fixture와 fixture index를 재생성한다.

```bash
pnpm update:gameplay-replay-golden
```

baseline 갱신 PR/commit에는 replay hash 변경 이유와 기대 gameplay 변화가 함께 기록되어야 한다. 입력 stream, frame count, fixed delta, capture frame 목록이 바뀌면 fixture metadata 검증이 실패하므로 먼저 `scenarios.json`, fixture, 문서를 함께 갱신한다. `--update`는 manifest의 `fixtureIndexPath`가 있으면 index를 manifest에서 다시 생성하므로 index를 손으로 patch하지 않는다. 단일 scenario는 `pnpm update:gameplay-replay-golden -- --scenario=<scenario-id>`로 갱신할 수 있고, 실험 manifest는 `node tests/smoke/gameplay-replay-smoke.mjs --manifest <path>`로 실행할 수 있다. Manifest의 `fixturePath`와 `variantPath`는 기본적으로 repo root 기준이다. 실험 manifest가 자기 파일 위치 기준 경로를 쓰려면 `./fixture.json` 또는 `../fixtures/foo.json`처럼 명시적인 relative prefix를 사용한다.

Breakout 예제의 두 번째 장르 runtime/render path를 확인하려면 다음을 실행한다. Brick hit particle burst까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:breakout
pnpm smoke:breakout-effects
```

Platformer 예제의 controller/runtime/render path를 확인하려면 다음을 실행한다. Landing dust까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:platformer
pnpm smoke:platformer-effects
```

KCC 정책이나 controller 이동감이 바뀌는 변경은 Rust fixture만으로 완료하지 않는다. `ground_probe_distance`, one-way platform 판정, jump 중 step offset, slope snap, HD-2D bridge pass-through를 건드리면 최소한 다음 smoke를 함께 확인한다.

```bash
pnpm smoke:platformer
pnpm smoke:platformer-budget
pnpm smoke:topdown-hd2d
```

Physics Spec 기반 generic rigid body sandbox와 demo fixture suite를 브라우저에서 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics-sandbox
pnpm smoke:physics-demo-suite
```

`pnpm smoke:physics-sandbox`는 `examples/physics-sandbox/dist` production build를 `demo=rigid-materials&physicsDebugLines=true`로 열고 `window.ferrumPhysicsSandboxSmokeFrame`을 기다린다. pass 조건은 선택된 demo id가 유지되고, body와 visible body가 각각 2개 이상 적용되며, Rust line을 포함한 전체 physics debug line과 TypeScript custom debug line, bitmap world text가 각각 1개 이상 렌더되고, frame이 2회 이상 진행되는 것이다.

`pnpm smoke:physics-demo-suite`는 같은 browser smoke harness에서 `window.ferrumPhysicsSandboxLoadDemo(id)`를 호출해 `rigid-materials`, `collider-gallery`, `contacts-sensors`, `joints-lab`, `ccd-tunnel-test`, `platformer-physics`, `scene-queries` fixture를 순회한다. 이 suite는 fixture catalog가 browser selector, Physics Spec apply, engine debug primitive와 bitmap world text render path에 모두 연결됐는지 확인한다. Solver determinism, scenario hash, CCD/query 세부 assertion은 `pnpm smoke:physics`와 `pnpm smoke:physics-replay`가 담당하므로 demo suite에 같은 책임을 중복 배치하지 않는다.

`pnpm smoke:physics-sandbox-budget`은 같은 production build를 `physicsDebugLines=false`로 열고 `physicsDebugLineCount`와 `customDebugLineCount`가 모두 `0`인지 확인한 뒤 physics-sandbox runtime budget을 평가한다. 따라서 opt-in debug primitive가 비활성 frame에 renderer pass나 composer 비용을 남기는 회귀를 차단한다. bitmap world text는 debug line flag와 독립적이므로 이 모드에서도 존재할 수 있다.

## Headless smoke check

브라우저를 열지 않고 Top-down Shooter 설정과 platform 적용 경로만 확인하려면 다음을 실행한다.

```bash
pnpm smoke:headless
```

이 명령은 Wasm 패키지와 `@ferrum2d/ferrum-web`을 빌드한 뒤 `tests/smoke/headless-smoke.mjs`를 실행한다. 검증 범위는 다음과 같다.

- 예제 `game.json`이 `resolveShooterGameSpec(...)`를 통과한다.
- `applyShooterGameSpec(...)`가 resolved config, orbit tuning, camera, audio policy, tilemap, wave, atlas frame을 fake engine target에 빠짐없이 전달한다.
- `collision: true` layer에 navigation obstacle로 쓸 양수 tile과 walkable `0` tile이 함께 존재한다.
- tilemap 기반 representative render command buffer가 비어 있지 않고 `decodeRenderCommands(...)`, `rendererStatsForCommands(...)` 계약을 통과한다.
- Rust/Wasm runtime을 headless로 로드해 particle preset 등록, shooter hit preset binding, burst spawn, particle count 증가/만료, render command append를 확인한다.

이 검증은 WebGL2 draw를 실행하지 않는다. 실제 화면은 browser render smoke check와 수동 smoke check로 보완한다.

## Example demo harness report

예제 UI 보일러플레이트와 runtime integration 코드를 구분하는 현재 기준선은 다음 명령으로 확인한다.

```bash
pnpm report:example-demo-harness
pnpm report:example-demo-harness -- --format=json
```

report는 `ferrum2d.example-demo-harness.report` version 1 계약을 사용한다. 공유 TypeScript shell 구현이
`examples/shared/runtimeDemoShell.ts` 한 벌인지, conventional `examples/*/src/main.ts`가 report에서 빠지지
않았는지, `apps/*/src` 또는 `examples/*/src`에 사본이 다시 생기지 않았는지 검사한다. 모든 예제와 Placement
Viewer가 공유 shell 또는 공통 lifecycle/diagnostic primitive를 사용해야 하며, 로컬
button/diagnostic/cleanup helper가 다시 생겨도 실패한다. 이 명령은 CI `validate` job과 `pnpm smoke:check`에
연결된다.

2026-08-24 기준 측정 결과는 다음과 같다. 줄 수는 각 entrypoint의 물리적 줄 수이며, 공백 제외 줄 수도
machine-readable report에 포함된다.

| Surface | 공유 방식 | Entrypoint 줄 수 | 전용 UI 판단 |
| --- | --- | ---: | --- |
| Starter Runtime | shared shell | 685 | profile/capture showcase 로직 포함 |
| Breakout | shared shell | 80 | 없음 |
| Minimal Game | shared shell | 500 | content, preload, lighting/material smoke 로직 포함 |
| Platformer | shared shell | 80 | 없음 |
| Physics Sandbox | shared primitives | 1,620 | scenario/material/query/frame-step UI 유지 |
| Top-down Shooter | shared primitives | 1,512 | direct renderer/platform bootstrap와 debug panel 유지 |
| Placement Viewer | shared shell | 4,936 | Pixelforge authoring UI와 전용 CSS 유지 |

이 수치는 전체가 public API 비용이라는 뜻이 아니다. Breakout과 Platformer는 작은 runtime integration
기준선으로 사용하고, Minimal Game은 여러 lab/content smoke가 함께 들어간 showcase로 해석한다. Physics,
Top-down, Placement Viewer의 전용 UI는 범용 shell option으로 흡수하지 않고 공유 primitive만 사용한다.

## Browser render smoke check

`pnpm smoke:browser`는 `examples/starter-runtime` production build를, `pnpm smoke:placement-viewer`는 `apps/placement-viewer` production build를, `pnpm smoke:topdown`/`pnpm smoke:topdown-mass-objects`/`pnpm smoke:topdown-hd2d`는 `examples/topdown-shooter` production build를, `pnpm smoke:breakout`/`pnpm smoke:breakout-effects`는 `examples/breakout` production build를, `pnpm smoke:platformer`/`pnpm smoke:platformer-effects`는 `examples/platformer` production build를, `pnpm smoke:physics-sandbox`/`pnpm smoke:physics-demo-suite`는 `examples/physics-sandbox` production build를 정적 서버로 띄운 뒤 Playwright Core로 설치된 Chrome/Chromium을 실행한다. 검증 범위는 다음과 같다.

- `createFerrumRuntime(...)` 또는 예제 bootstrap이 browser runtime을 초기화한다.
- WebGL2 canvas가 생성되고 Rust/Wasm render command를 소비한다.
- 기본 render 경로의 browser smoke는 canvas pixel readback에서 placeholder texture의 녹색 픽셀을 확인한다. mode-specific smoke는 아래 항목의 조건을 추가 또는 대체 pass 조건으로 사용한다.
- `pnpm smoke:browser`는 Starter Runtime의 weapon profile panel, 실제 DOM profile/capture report 버튼 클릭, profile별 projectile visual texture/size/rate, snapshot/replay report hook도 함께 확인한다.
- `pnpm smoke:runtime-budgets`는 `tests/smoke/runtime-budget-profiles.mjs`의 per-example profile과 browser smoke mode mapping을 CI-safe 방식으로 검증한다.
- `pnpm smoke:browser-budget`은 Starter Runtime에서 `RuntimeProfiler`를 켜고 frame time, Rust update, render time, draw call, render command, texture switch, physics count, asset load elapsed budget을 구조화된 report로 검증한다.
- `pnpm smoke:topdown-budget`, `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget`은 같은 browser budget harness를 각 예제 profile로 실행한다. 직접 `node tests/smoke/browser-render-smoke.mjs --budget --budget-profile=<profile>`을 사용할 수도 있다.
- `pnpm smoke:placement-viewer`는 Scene Placement Viewer의 `window.__ferrumPlacementViewer` hook, 6개 placed instance/entity, render command와 draw call, canvas readback, `crate_left` hover/click selection, draft transform patch export, Handoff copy/save action state, moved draft marker persistence, sprite frame add patch, ObjectDefinition add patch, collider overlay, rect/circle resize handle patch, collider offset input/drag component patch, capsule/orientedBox/convexPolygon collider component patch, save opt-in disabled gate, inspector selected/hovered/draft row를 확인한다.
- `pnpm smoke:placement-viewer-mass-authoring`은 Scene Placement Viewer의 mass authoring fixture mode에서 1,030개 이상 instance/entity, responsive viewport에 남는 518개 이상 visible render command, draw call 상한, 단일 object 선택/patch latency, 단일 draft marker, handoff selected/draft summary를 확인한다.
- `pnpm smoke:placement-viewer`는 여러 pointer move를 한 이력으로 묶기, 단축키·버튼 Undo/Redo, 아직 RAF에 남은 move의 Escape 취소, 숫자 input의 한 건 확정을 추가 검증한다. Web 단위 테스트는 삭제·rename·component·binding·ObjectDefinition·revert 복원, 실패 transaction rollback, no-op/redo 분기와 100건/8 MiB 예산을 검사한다.
- 같은 2D gate는 중간 move 이벤트 없이 pointerup으로 전달된 마지막 좌표가 그룹 이동과 한 건 Undo에 반영되는지 검사한다. Web 단위 테스트는 취소/실패 Revert의 transient lock 보존, host 거절 시 편집·Undo/Redo·열린 gesture의 초안/cursor 복원, 복구도 거절될 때 실패 candidate 재적용 방지와 callback 재진입 차단을 검사한다.
- 저장 gate는 실제 pointer drag의 RAF를 보류해 활성 drag·pointerup 뒤 마지막 반영 대기 중 SaveDraft가 요청을 보내거나 transaction을 닫지 않는지 검사한다. RAF를 해제한 뒤 실제 저장 문서에 최종 좌표가 들어가고 초안/이력이 비워지는지도 확인한다.
- 같은 경계에서 키보드로 다른 탭을 활성화해도 마지막 입력을 반영하기 전에는 현재 탭·초안·이력을 유지해야 한다.
- `pnpm smoke:placement-spatial-workspace`는 실제 Wasm preview에서 attachment billboard의 누적 yaw, Sprite 회전과 model style yaw/scale의 소유권, 전체 LOD bounds, surface/instance ID namespace, attachment Height 차단과 모드/탭 전환 취소를 검사한다. native가 거절하는 X 입력은 2D·HD-2D 모두 정상 초안·이력·live handle을 유지해야 한다. 경사면 XY는 1회/6회 move의 최종 patch와 화면 이동이 일치해야 하며, Orbit 이후 직교/원근 pan과 zoom 배율, 반복 zoom 한계, 원근 Height의 화면 이동·한 건 Undo·camera 분리를 검사한다. 2D Pan이 선택된 상태에서도 HD-2D gesture가 2D camera를 바꾸면 실패한다.
- 같은 spatial gate는 native configuration 거절을 한 번 주입해 Escape·모드·탭 전환 실패가 정상 pose/handle과 gesture transaction을 보존하는지 검사한다. 이어 pointerup이 확정 대신 취소를 재시도하는지, programmatic history hook이 별도 소유 gesture를 닫지 않는지도 확인한다. 기본 2D gate는 1280/960/720px toolbar의 실제 hit target을 검사하며 오류 안내 뒤에도 viewport 조작을 클릭할 수 있어야 한다. 소수점 CSS canvas 크기의 탐색 기대값은 논리 CSS 크기 비율을 반영한다.
- 같은 spatial gate의 `placement-spatial-placement-smoke.mjs`는 실제 asset 선택·Place 클릭·HTML drag/drop으로 Sprite bridge 배치와 snap된 ramp Model 배치를 검사한다. 생성 전 preview의 문서/history 불변, 중복 ID·같은 asset ID의 다른 GLB content·native 거절의 전체 rollback/live handle, 한 건 Undo/Redo, mode 전환 정리, 원래 asset/contentId와 recipe 본문 보존·JSON reopen을 확인한다. 단위 테스트는 spatial v1/v2 분리와 기존 공백 terrain ID 호환성, 참조 add/update의 중복·고아 참조·허용 필드 검증, composition과 참조의 단일 host 검증 및 checked save/reopen을 검사한다. 기존 CI HD-2D authoring workspace gate에서 실행한다.
- 같은 명령은 `placement-workspace-smoke.mjs`로 dock 접기·Focus·pointer/keyboard resize·Escape·reload 후 UI 설정 복원을 확인한다. JSON 두 문서의 탭 왕복·독립 선택/이력·동일 runtime/canvas·fresh handle, 비활성 dirty 탭의 이탈 보호와 runtime 지속, 닫기 취소/폐기·8탭 상한·잘못된/2 MiB 초과/spatial 문서 거부를 검사한다. 텍스처 누락으로 runtime 적용이 실패하면 기존 초안/선택/이력과 live handle을 복구하고 후보 탭을 제거하는지도 확인한다. 1280/960/720px 실제 화면과 가로 overflow도 확인한다.
- 같은 placement 명령에 연결된 `placement-navigation-smoke.mjs`는 중간 버튼·Space/Pan drag·Escape 취소·wheel 고정점·zoom 상한/하한·빈 scene·Frame/Fit Scene을 검사한다. 실제 WebGL 픽셀과 DPR 2 picking, 비중앙 pivot/회전/scale의 Frame 중심, 확대 상태 pointer/숫자/keyboard의 동일 월드 이동, 폼 Home 보존, 탭별 카메라와 실패한 열기/dock resize 복원, draft/history 무변경을 assert한다. 객체 gesture 중 wheel/Space는 카메라를 바꾸지 않는다. 화면은 `artifacts/placement-navigation/`에 남긴다.
- mass 명령은 기존 선택/patch 비용 상한에 더해 Fit Scene의 동기 작업 500ms 이하, 1,030개 이상 entity/render command·draw 1–16회와 기존 초안/이력 보존을 확인한다. 측정값은 실행 환경의 회귀 근거이며 일반 기기의 FPS 보장이 아니다.
- placement 명령의 `placement-selection-smoke.mjs`는 Tree Ctrl/Shift 범위 선택과 canvas modifier 선택, 부분 교차 제외/완전 포함/가산 영역 선택, Escape·pointer capture 상실의 취소, 선택 전체 Frame·보조 outline, 그룹 pointer/숫자/keyboard 이동·snap의 상대 간격 보존, 잠금 상태의 picking/편집 제한, 잠금의 탭 분리와 그룹 삭제/Undo를 검사한다. 3개 객체 fixture와 DPR 2의 그룹 이동/outline을 확인하고 `artifacts/placement-selection/`에 화면을 남긴다.
- 같은 mass 명령은 1,030개 객체의 전체 선택·그룹 이동·집합 잠금에 각각 동기 작업 500ms 상한을 적용한다. 선택/잠금 수와 전체 patch operation 수, Undo가 한 건만 늘고 이전 patch를 정확히 복원하는지 확인하며 기존 1,030 commands·draw 1–16회 조건도 유지한다. selection metadata만 바꾸고 실제 batch 편집을 생략하는 pass는 허용하지 않는다.
- save smoke는 저장해도 다른 탭의 초안/이력이 남고 활성 탭만 기준 문서로 초기화되는지, 현재 탭과 다른 탭의 배율/카메라가 보존되는지 검사한다. desktop asset smoke의 fake bridge는 탭별 native save 대상 경로와 expectedDocument, 이전 asset 문맥 복원과 실패한 문서 열기를 추가 확인한다. 실제 Tauri GUI 검증은 별도다.
- save/desktop 검사에는 활성 탭 저장 rebase의 편집 잠금과 다른 탭의 선택 집합/잠금 유지도 포함한다. web 단위 테스트는 mixed source/added 삭제, 포함 인스턴스와 flat 객체를 섞은 삭제의 전체 거부, invalid/duplicate/locked batch의 부분 변경 방지, source/추가 객체 rename Undo의 잠금 identity와 1,024건 단일 batch 이력을 확인한다.
- `pnpm smoke:placement-viewer-save`는 새 객체를 저장하고 재개방한 뒤 외부 writer의 JSON 변경을 만든다. 저장 중 inert UI와 중복 요청 차단, HTTP 409, 기존 초안·이력·외부 문서 보존을 assert한다. 예상한 save endpoint의 단일 409 console 메시지만 허용하며 다른 console/page error는 계속 실패한다. 이 검사는 독립 외부 writer와의 완전한 transaction 또는 실제 Tauri GUI 검증을 대신하지 않는다.
- `pnpm smoke:placement-viewer-desktop-assets`는 fake Tauri bridge로 desktop project open을 재현하고, asset folder image의 `runtimeUrl`이 initial `runtime.engine.loadAssets(...)` texture manifest에 포함되는지, local texture id가 0보다 큰지, local asset을 참조하는 Data Scene instance가 render command와 nonblank canvas로 이어지는지, asset folder switch 이후 runtime asset snapshot/handoff/Inspector status가 새 manifest로 reload되는지 확인한다. 실제 PNG의 width/height가 provider와 handoff evidence에 유지되는지, Add Sprite pending/draft marker, draft visual size, AABB collider half-size가 같은 local asset metadata를 사용하는지도 검증한다.
- `pnpm smoke:preload`는 Minimal Game에서 `LoadingOverlay`를 켜고 data URL manifest를 두 번 preload해 첫 실행 fetch와 두 번째 IndexedDB JSON/texture body cache hit를 검증한다.
- `pnpm smoke:mobile-input`은 Minimal Game에서 `VirtualControls` DOM preset을 켜고 joystick/button state가 `W/D/Space/mouseLeft` input으로 합성되고 release되는지 확인한다.
- Minimal Game의 `visual-runtime-lab`과 `input-ui-lab`은 같은 production build와 smoke-only query flag를 공유한다. 별도 app/package 분리는 public portfolio 승격이 필요할 때만 검토한다.
- `pnpm smoke:topdown`은 Top-down Shooter production build에서 실제 asset manifest preload/cache/loading overlay를 거친 뒤 smoke 전용 URL parameter로 deterministic enemy hit를 만들고, particle count와 enemy tint flash render command가 관측되는지 확인한다.
- `pnpm smoke:topdown-mass-objects`는 Top-down Shooter production build에서 Playing 상태의 1,024개 enemy snapshot restore 뒤 `BitmapFontPolicySpec` image/inline atlas를 로드하고 entity-anchored bitmap world text를 같은 frame 경로에 추가한다. 이후 1,000개 이상 Rust render command, glyph count, WebGL2 batching stats, collision pair budget, runtime budget profile을 확인한다.
- `pnpm smoke:topdown-save-load`는 Top-down Shooter production build에서 enemy/bullet과 Rust gameplay variable slab이 포함된 built-in shooter snapshot version `19`와 `GameStateSnapshot` version `2`를 캡처하고, `resetGame()` 이후 restore 및 재캡처 hash 일치를 확인한다. 또한 저장/복원 전후 snapshot을 `createGameplayReplayRun(...)` / `compareGameplayReplayRuns(...)`로 비교해 첫 mismatch frame과 JSON path를 실패 report에 포함한다.
- `pnpm smoke:gameplay-replay`는 Top-down Shooter raw Wasm runtime을 deterministic input stream으로 실행하고 committed golden fixture의 replay hash와 비교한다. 이 경로는 browser rendering smoke가 아니라 gameplay canonical state 회귀 gate다.
- `pnpm smoke:topdown-hd2d`는 Top-down Shooter production build에 smoke 전용 HD-2D spec을 적용해 `weapons.projectileArc`, bridge `toHeightSpan` path, under-pass same-floor path, render command 생성을 확인한다.
- `pnpm smoke:spatial-scene`은 packed public `/core`·`/authoring`과 실제 Wasm의 opt-in 입체 경로를 검증한다. 1280×720 / 390×844, DPR 1/2에서 직교/원근·camera tilt의 terrain hit, canvas offset/CSS scale, native 계단 elevation·화면 높이, bridge depth 픽셀·제출 순서 역전, alpha 구멍, postprocess depth attachment를 assert한다. 100/500/1000 billboard는 draw 2회, steady terrain upload 0, 동적 업로드 count×6×44 bytes와 반복 GPU object 할당 0을 확인하고 CPU submission median/P95를 기록한다. reset의 stale handle/vertex 제거와 destroy 후 buffer/program/shader/texture/FBO/renderbuffer/VAO/sampler 잔여 0도 검사한다. `artifacts/spatial-scene-consumer-*/report.json`과 스크린샷을 남기며 CI validate job에서 실행한다. WebGPU parity·실제 모바일 GPU 예산은 이 gate의 통과 범위가 아니다. [계약](../../engine/data-scene-spatial.md)을 따른다. 공간 진행 v6의 JSON을 fresh engine/renderer에 복원한 뒤 actor XY/높이, bridge floor, 변경 camera, label anchor, paused 상태와 framebuffer 전체 픽셀 차이 0을 검증한다. 같은 gate에 연결된 `spatial-visibility-browser-fixture.mjs`는 atlas 2 frame × flipX/flipY × 직교/원근 16개 조합의 실제 색/alpha hole/nearest 경계 픽셀, 비중앙 발 pivot, native 시간 진행/pause, 화면 밖 pivot, near plane 부분 절단·완전 cull·복귀와 eye plane(w=0) 교차를 검사한다. RGB 오차 허용은 채널당 3이며 retained billboard 수에 맞는 draw/upload 비용을 함께 assert한다. 회전 pivot/bounds는 native Rust 회귀로 검사한다.
- 같은 공간 gate의 `spatial-model-browser-fixture.mjs`는 자체 제작한 textured rock GLB를 공개 loader/register/authoring으로 연결한다. model 1개/8 triangles, steady vertex upload 0·shadow cache, 캐릭터 occlusion 픽셀, cast flag의 화면 차이, native AABB 차단과 높이 분리 통과, 물리 elevation과 native matrix, fresh engine v7 복원 전체 픽셀 일치, 미등록/다른 content 거절과 씬 보존, GPU buffer 2개·texture 1개 회수 및 최종 자원 0을 검사한다. 기존 CI `smoke:spatial-scene`에 포함되며 실제 Blender 출력물·WebGPU·GPU 시간/대량 모델 예산은 별도 gate다.
- 같은 모델 probe는 caller PBO와 unpack row/skip을 설정한 첫 mesh upload의 성공·상태 복구, 복원할 수 없는 native pose의 capture 거절도 검사한다. native 회귀는 모델 anchor world text의 공간 depth·높이 추종·글꼴 크기를 확인한다. 웹 단위 테스트는 작은/큰 node scale의 normal 변환, bounded stream 정리, texture/buffer 오류·부분 할당 실패의 GPU staging 회수와 재시도, raw packet 형식·실제 geometry 예산 거절을 검사한다.
- 같은 gate의 `spatial-model-tree-browser-fixture.mjs`는 2 primitive/14 triangles인 자체 제작 tree GLB를 공개 loader/register/authoring으로 적용한다. alpha 구멍 뒤 캐릭터 픽셀·factor alpha·cutoff 동등 비교, 양면 뒷면 normal과 단면 culling, 앞/뒤 점광원·태양광 4조합의 지면 shadow 구멍/불투명 부분 대비, 줄기 AABB 차단 X=-6, fresh engine 복원 픽셀 일치·GPU buffer 4개/texture 1개 해제를 검사한다. 지면 샘플은 canopy가 가리지 않는 시점에서 비교한다. BLEND와 잘못된 cutoff/타입은 현재 씬을 보존하며 거절한다. 실제 Blender 출력물과 나무 미술 품질은 이 fixture의 완료 기준이 아니다.
- 같은 gate의 `spatial-model-material-browser-fixture.mjs`는 exported TANGENT와 normal/emissive texture를 연결한다. scale 0·양면·handedness의 실제 조명 픽셀, alpha 0 RGB 보존, 발광 RGB 기대값/조명 독립성·HDR/fog, legacy/linear-sRGB 출력 일치, normal/color 동일 이미지의 색 공간 분리·LINEAR base/emissive 색 경계 픽셀, point/sun shadow coverage, unit 4 state 복원, fresh engine 픽셀 차이 0과 자원 해제를 가로/세로·DPR 1/2에서 검사한다. warm model upload 0·2 draw/14 triangles와 decode bitmap/context 해제를 함께 확인한다. 실제 Blender export·실제 GPU 시간 예산 검증은 별도다.
- 모델 image 회귀는 cutoff 0의 숨은 RGB, 비대칭 코너의 행 방향, 선형 MASK 경계 색과 1 바로 위 cutoff의 거절 픽셀을 검사한다. 7개 변형의 bitmap·임시 texture/FBO/context 회수, 4개 병렬 asset×2 images의 동시 임시 context 최대 1개, bitmap decode 직후 취소의 자원 정리·활성 씬 보존도 assert한다. 단위 테스트는 HTML canvas fallback과 부분 할당/attachment/read/context loss 정리, 여러 WebGL 오류 이후 정상 upload 재시도, HTTP/size 진단의 cancel 실패 보존을 검사한다.
- 같은 gate의 `spatial-model-building-browser-fixture.mjs`는 계층을 bake한 자체 제작 건물 GLB(8 primitive/96 triangles)를 fragment include/prefab으로 배치한다. 보이지 않는 terrain 6개가 물리·picking·debug를 유지하면서 main/shadow에 제출되지 않는지, 같은 actor의 문/경사로→1층 높이 32 이동과 벽 X=42 차단·아래층 통과, 모델 바닥의 depth 가림을 검사한다. point/sun의 실제 indexed shadow draw 증가와 화면 차이, 직교/원근 클릭, native 목적지 도착과 warm model upload 0·8 draw/96 triangles를 함께 assert한다. fresh v7 복원은 전체 framebuffer 차이 0·벽 충돌 유지, 제거 후 GPU buffer 16개 해제를 확인한다. 잘못된 proxy 입력은 씬을 보존하며 거절한다. 실제 Blender export, 자동 proxy 변환·runtime parenting은 후속이다.

- 같은 gate의 `spatial-model-preparation-browser-fixture.mjs`는 protected authoring apply/restore에서 모델 GPU 준비를 검증한다. 두 번째 모델 buffer 할당까지 진행한 후 실패하는 경우를 포함해 texture/buffer/sampler/실제 upload 오류 4종에서 기존 handle·paused·snapshot hash·framebuffer 차이 0과 GPU resource 수·caller VAO/ELEMENT/ARRAY/texture/unpack/PBO 상태 유지를 검사한다. cold shader/pipeline 실패의 cleanup/재시도와 pending lease의 중복·cancel·stale/destroy 거절도 확인한다. 성공 뒤 첫 render는 2 models/10 draw/110 triangles·model upload 0, fresh engine의 다른 numeric ID도 준비 bytes/픽셀 차이 0이어야 한다. 실패한 저장 복원은 기존 씬을 보존하며 제거 후 buffer 20개·texture 3개와 최종 destroy 자원을 해제한다. 환경 FBO·전체 callback rollback 보장은 이 모델 준비 gate의 범위가 아니다.

- 같은 공간 gate의 `spatial-terrain-chunks-browser-fixture.mjs`는 실제 ABI v2의 `terrainDrawRanges`와 256 surface/9216 vertices를 검사한다. 가로/세로·DPR 1/2에서 camera 이동·zoom·orbit·near·전체 cull·복귀 7개 조건마다 v1 전체 제출과 framebuffer RGB 차이(채널당 허용 3)를 비교한다. `drawArrays`의 실제 first/count와 `bufferData`/`bufferSubData` 업로드를 별도로 관찰해 range·triangle·draw·upload 통계와 대조하며 GPU object 재할당도 검사한다. 9종 invalid range는 draw 0으로 거절하고 빈 range는 fallback 없이 draw 0·빈 화면이어야 한다. far plane의 float32 상쇄로 GPU에 남는 지형을 CPU가 잘못 제외했던 회귀는 기준 화면의 유색 픽셀과 전체 framebuffer 일치로 검증한다. camera-only culling 뒤 공간 v6 capture가 계속 유효한지도 확인한다. coarse chunk는 authored surface 하나이며 전체 메시/물리/picking과 GPU 상주 메모리는 유지한다.
- 같은 gate의 `spatial-debug-browser-fixture.mjs`는 public `setDataSceneSpatialDebug`와 실제 Wasm의 optional debug v1을 검사한다. occluder 안 billboard/heightSpan의 깊이 가림과 가려진 선 표시를 색상 픽셀로 구분하고, 직교/원근 camera·native elevation 변경 후 투영된 물리 끝점의 자홍색 픽셀을 확인한다. 실제 `LINES` first/count·depth test/write·bulk upload와 별도 통계를 대조하고 camera/toggle 시 반복 GPU object 할당 0을 검사한다. invalid extension 10종은 실제 draw 0으로 거절하며 disable 뒤 전체 framebuffer 차이 0, 저장 progress 불변, scene reset의 debug 해제를 확인한다. 색상 판정은 MSAA 선분 coverage를 허용하며 회색 occluder와 진단 색을 구분한다. 조건별 depth/overlay PNG도 report 옆에 저장한다. native 회귀는 최대 32,768 vertices의 truncation·capacity 재사용, stale handle·skip/reset을 별도 검사한다. 새 physics category는 같은 fixture에서 실제 native collider bottom/top·offset과 visual elevation 분리를 검사한다. depth/overlay의 초록 collider·흰 층 문자 픽셀과 64개 endpoint/1 draw/64×44 upload를 실제 GL 호출과 대조한다. wall 이동은 actor가 충돌면에서 멈추고 빨강 marker/normal 픽셀이 있어야 한다. navigation feasibility probe 후 capture buffer 불변과 debug disable 뒤 draw/upload 0·progress 불변을 검사한다. physics depth/overlay·contact PNG도 저장한다. native 회귀는 모든 collider 형태·compound/chain·disabled·floor/span·rigid snapshot·bounded 순회를 검사한다. 전체 resting/trigger/gateway contact manifold와 실제 대상 GPU 예산은 검증 범위 밖이다.
- 같은 gate의 `spatial-connections-browser-fixture.mjs`는 packed public API로 명시적 shared-edge 연결을 작성하고 같은 actor의 경사로→다리 floor 0→1·높이 0→32와 역방향 이동을 검사한다. 연결 없는 underpass floor 0을 유지하고 실제 WASD 입력도 연결을 통과해야 한다. 전환 pose/authoring connections를 v6 JSON으로 저장해 fresh engine에 복원하고 framebuffer 차이 0(채널당 허용 3), 복원 후 역방향 연결 사용을 확인한다. 목적지 floor 벽은 진입을 막고 invalid connection은 activation 전에 기존 handle을 유지한 채 거절해야 한다. camera/terrain revision·steady terrain upload를 함께 검사한다. native 회귀는 양쪽 floor의 초기/최종 penetration, step/drop·폭·topology·terrain 교체 원자성·미세 이동·중간 floor를 건너뛰는 대각선 substep 거절을 보장한다. 다층 목적지 이동은 다음 fixture에서 별도로 검사한다.
- 같은 gate의 `spatial-navigation-browser-fixture.mjs`는 실제 packed 목적지 API로 ramp→bridge와 같은 XY의 아래층 우회, 도착 floor/elevation·picking, steady terrain revision/upload, 실패 요청의 기존 경로 보존을 검사한다. WASD는 취소와 같은 frame 수동 이동, 이동 중 새 solid는 blocked와 searchCount 불변, 새 요청은 실제 우회 도착이어야 한다. paused 진행 중 route를 v6 JSON으로 fresh restore하면 pose는 보존하고 상태는 idle이어야 하며 새 요청으로 다리를 올라야 한다. 탐색 node/probe/work 상한과 waypoint 소진을 assert한다. native 회귀는 offset·step/drop·미세 속도·pause·외부 mutation·애니메이션·최소 frame 비용 거절·실패 원상복구를 추가한다. 대규모 navmesh/자동 replan/실제 대상 GPU 성능은 이 gate의 보장 범위 밖이다.
- 같은 fixture의 소수 크기 상자 proxy 회귀는 수동 밀착 `(582,745.1749877929688)`에서 안쪽 이동 차단, 위치 보정 없는 목적지 요청과 `(650,780)` 도착, 실패한 상자 내부 재요청의 기존 route 보존을 검사한다. native 회귀는 네 방향·offset 유무 8조합의 접선 이동과 한 ULP의 실제 모서리 겹침 거절을 추가한다. entity AABB 범위이며 mesh collider·동적 모델 assembly 검증은 아니다.
- 같은 navigation fixture는 7개 support의 해안→경사로→다리→전망대 경로를 cellSize 32로 검사한다. collider 없는 장식 1,500개를 추가해도 node/probe/target 수가 같고 준비·전체 work의 차이는 최초 순회 1,500이어야 한다. 전체 요청 work는 기존 8M 이하이며 floor 3/elevation 96의 정확한 목적지에 도착해야 한다. `lastRequest`의 accepted/noPath·요청 횟수와 실패 후 기존 waypoint 보존을 함께 검사한다. native 회귀는 실제 collider가 frame 예산을 넘으면 사전 거절하거나 추종 중 blocked 되는 경우, 실패 후 snapshot 해제, 고속 50 ms/혼합 delta의 경사면 왕복을 포함한다. 실제 game-test authoring JSON을 읽는 격리 검증은 `artifacts/hd2d-navigation-budget/game-repro.json`에 별도로 남기며 원본 게임 재현 파일을 성공 결과로 덮어쓰지 않는다.
- 같은 gate의 `spatial-environment-browser-fixture.mjs`는 P1/P2를 packed public API와 실제 Wasm으로 검증한다. 다리/벽의 빛 차폐·아래 광원의 윗면 비조명, alpha 구멍·이동/화면 밖 caster, 직교/원근 depth DOF·runtime refocus·HDR 노출/톤 매핑/색 보정·camera-distance fog·flat HUD 픽셀 동일성을 assert한다. legacy/linear-sRGB 입력의 중복 decode/encode와 현재 scene FBO composite, 배경 위 debug coverage, 환경 진행 v7 JSON의 fresh Engine/renderer 복원 픽셀 차이 0을 확인한다. 강제 재계산 cube face 6회와 정지 cache hit 시 shadow draw/upload 0, 전체 draw와 통계를 대조하고 면당 batch 64/DOF 13 sample/terrain steady upload 0/HDR·cube 저장량·warm GPU object 할당 0을 검사한다. 잘못된 환경 packet 8종은 draw 0으로 거절하며 disable/destroy 후 effect target 해제를 확인한다. 그림자/DOF PNG와 report의 `spatialEnvironment`에 증거를 남긴다. `EXT_color_buffer_float` 필수이며 WebGPU·실제 모바일 GPU 시간 예산·반투명 다중 depth DOF는 지원 범위 밖이다.
- 같은 gate의 `spatial-quality-browser-fixture.mjs`는 환경 v2의 고정 160×90 target과 가로/세로·DPR 1/2 정수 nearest pixel 블록 일치, 직교 subpixel camera snap, 여백/picking round-trip을 검사한다. 실제 normal atlas의 좌우 조명·flipX 반응과 sRGB map 거절, 태양의 다리 차폐·PCF 경계·cast/receive 선택, 고급 DOF의 배경 위 전경 coverage 확장·13/25 sample 및 동일 texture bytes, native actor 초점 이동과 진행 v7 복원을 확인한다. report의 `spatialQuality`에 값을 기록하고 최종 renderer destroy의 자원 잔여 0을 기존 gate와 공유한다. software adapter 검증이며 실제 대상 GPU의 시간 예산은 별도다.
- 그림자 target 재생성과 texture 집합 변경이 같은 프레임에 발생해도 바로 다음 draw는 cache hit·shadow draw/upload 0이어야 한다. 웹 회귀는 잘못된 camera/sun 조합의 authoring·v7 복원이 activation 전에 거절되어 기존 handle을 보존하는지, 태양 방향의 f32 compile/decode 반복이 byte-identical인지 검사한다.
- 환경 회귀는 외부 scissor/color mask crop과 기준 화면 차이 0, cold/warm/resize debug-only GL error 0, 불완전 cube 할당 주입 후 정상 재시도, 같은 frame flat HUD의 자원 유지와 전체 flat frame 전환의 effect target 해제를 확인한다. 실제 Wasm unit은 잘못된 caster/texture 예산의 activation 전 거절·기존 handle 보존, 제거 예정 caster를 제외한 정상 v7 fresh restore를 검사한다. 기존 슈터 raw dynamic 투사체는 public World 이동을 유지하고 Data Scene만 solver 소유 정책을 선택한다. gameplay replay 전체 17개를 검증하며 의도적인 flat capture v3→v5 골든 변경은 version/hash만 갱신하고 원본 v3/hash의 복원은 legacy fixture로 보존한다.
- `pnpm smoke:breakout-effects`는 `resetGame()` 이후 자연 ball/brick hit에서 scene-internal particle burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:platformer-effects`는 `resetGame()` 이후 player landing transition에서 scene-internal dust burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:physics-sandbox`는 기본 `rigid-materials` fixture가 body를 생성하고 Rust/custom debug line과 bitmap world text를 렌더링하며 frame이 진행되는지 확인한다.
- `pnpm smoke:physics-demo-suite`는 Physics Showcase catalog의 7개 fixture를 순서대로 로드해 demo id, body count, Rust/custom debug line, bitmap world text, frame 진행 조건을 확인한다. CCD/query 세부 assertion은 Node physics smoke와 Rust unit test가 담당한다.
- `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter의 collision tile 하나를 제거하고 같은 frame 경로에서 query hit 제거와 render command 감소를 확인한다.
- `pnpm smoke:lighting`은 Minimal Game에서 lighting smoke URL을 켜고 renderer stats의 lighting draw/point light/tile occluder/shadow count와 canvas warm pixel을 확인한다.
- `pnpm smoke:lighting-webgpu`는 Minimal Game에서 `renderer=webgpu`와 lighting smoke URL을 켜고 WebGPU renderer stats의 lighting draw/point light/tile occluder/shadow count를 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:material`은 Minimal Game에서 outline sprite material preset을 켜고 WebGL2 canvas pixel과 renderer draw call이 material pass 수만큼 증가하는지 확인한다.
- `pnpm smoke:material-webgpu`는 Minimal Game에서 `renderer=webgpu`와 outline sprite material preset을 켜고 WebGPU renderer stats의 material pass draw call을 확인한다. WebGPU 미지원 또는 fallback 환경은 실패 대신 skip으로 보고한다.
- `pnpm smoke:particle-vfx`는 Minimal Game에서 `ParticleVfxEmitter`의 trail preset을 켜고 particle burst count, live particle count, render command 증가를 확인한다.
- `pnpm smoke:animation-timeline`은 public package build에서 `AnimationTimelinePlayer`의 frame event, signal transition, atEnd transition을 확인한다.
- `pnpm smoke:scene-composition`은 public package build에서 prefab variant props, fragment include transform, idPrefix, target apply 결과와 scene behavior apply target의 handle-to-command 연결을 확인한다.
- `pnpm smoke:behavior-recipes`는 public package build에서 health/damage/pickup/chase recipe가 runtime adapter command로 변환되는지 확인한다.
- `pnpm smoke:hud-toolkit`은 public package build에서 HUD theme token과 meter/counter/prompt overlay state preset을 확인한다.
- `pnpm smoke:audio-system`은 public package build에서 `AudioManager` BGM loop/fade와 master/bgm/sfx/ui bus state를 확인한다.
- `pnpm smoke:camera-postprocess`는 Minimal Game browser runtime에서 renderer fullscreen post-processing pass stats와 camera/post-process public helper를 확인한다.
- `pnpm smoke:color-management`는 public Data Scene의 Playing 상태와 실제 Rust 15-float command buffer에서 출발한다. DPR 1/2에서 legacy/linear-srgb의 sRGB·linear·data texture, 숫자 RGB/material 혼합, 반투명 이미지/혼합, fade 체인, ambient/point light, bloom threshold, 어두운 grayscale ramp, RenderTexture 재사용·resize·clear, WebGPU 요청의 WebGL2 fallback, 투명 canvas의 premultiplied/additive 출력을 34개 시나리오로 검증한다. 1,024 commands의 sprite batch 1개와 texture switch 0을 유지하며 legacy draw 1회/managed draw 2회(출력 변환 포함)를 assert한다. 20회 warmup 뒤 60회 CPU submission median/P95를 기록하되 GPU 실행 시간이나 portable 성능 한계로 해석하지 않는다. managed 기본 출력의 framebuffer가 1개이며 반복 frame에서 texture/framebuffer 추가 할당이 없고 destroy 뒤 잔여 자원이 0인지 검사한다. metadata와 변환 함수/비지원 모드 거절은 `colorManagement.test.ts`로 검증한다.
- `pnpm smoke:render-texture`는 public core/authoring entrypoint의 `createEngine`, `applyDataSceneAuthoringDocument`, `WebGL2Renderer`를 실제 browser에서 실행한다. Playing Data Scene의 Rust가 생성한 1,024개 비대칭 사분면 sprite를 target에 그리고, 같은 authoring 경로로 생성한 main sprite와 fade로 합성해 1,025 commands, 2 sprite batches, 3 draw calls를 확인한다. stride는 실제 command view에서 읽으며 15-float 직접 upload와 명시적으로 padding한 호환 buffer의 staging upload, material staging을 각각 검증한다. DPR 1/2의 픽셀 방향, 부분 UV/asset 혼합/target 간 합성, 불투명 alpha, 빈 pass clear, framebuffer/viewport/color-mask/scissor 복구, draw 오류 복구, asset/pending-load id 충돌, feedback/누락 texture 사전 거절, resize 및 8회 destroy/recreate, 최종 live texture/framebuffer 0을 검사한다. `FERRUM_BROWSER_EXECUTABLE` 또는 `FERRUM_BROWSER_CHANNEL`로 브라우저를 선택할 수 있다. 크기/id/foreign handle 및 할당 실패 rollback은 `renderTexture.test.ts`가, batch별 방향 복구와 upload buffer 재사용은 `spriteBatch.test.ts`가 추가 검증한다.
- 같은 RenderTexture smoke는 서로 다른 태양 설정의 엔진을 생성·파괴해 저장한 projection metadata의 독립성을 확인한다. DPR별 태양 방향 2개 × 직접/호환/material upload 3개의 alpha 그림자 픽셀 사례에서 투명 구멍·반투명·지면 압축·후처리 합성을 검사한다. 각 사례는 metadata 누락/잘못된 방향·길이·배열 크기를 거절한 뒤 기존 target 픽셀과 stats/framebuffer가 보존되는지도 확인한다.
- `pnpm smoke:cutscene-sequence`는 public package build에서 `CutsceneSequencePlayer`가 wait/camera/audio/dialogue command event를 순서대로 방출하고 target adapter hook과 `LocalizationBundle` 기반 dialogue text 변환을 호출하는지 확인한다.
- `pnpm validate:game-spec`는 Top-down Shooter `game.json`의 `content` namespace가 localization/dialogue/cutscene resolver path를 통과하는지도 확인한다.
- `pnpm smoke:localization`은 public package build에서 `LocalizationBundle` fallback/interpolation, text wrapping, web/bitmap font loading policy와 inline bitmap atlas glyph/kerning validation을 확인한다.
- `pnpm smoke:dialogue-quest`는 public package build에서 `DialogueSession`, `QuestLog`, UI overlay hook, dialogue/quest snapshot restore를 확인한다.
- `pnpm smoke:physics-scene`은 public package build에서 `applyPhysicsSceneProfile(...)`의 runtime profile, auto rigid-body step option, clear 동작을 확인한다.
- `pnpm smoke:texture-atlas`는 public package build에서 atlas packer를 빌드하고, CLI가 입력 순서와 무관한 deterministic atlas JSON, frame UV, placement metadata를 생성하는지 확인한다.
- `pnpm smoke:asset-pipeline`은 raw sprite folder를 `pack-textures` CLI로 atlas PNG/JSON/Game Spec frame에 병합하고, public `importAsepriteAtlas(...)`, `resolveShooterGameSpec(...)`, `LocalizationBundle`, `AudioAssetLoader`가 같은 consumer asset import 경로에서 함께 동작하는지 확인한다.
- `pnpm smoke:level-streaming`은 public package build에서 chunk manifest bounds, viewport active/preload selection, load/unload candidate, chunk asset manifest 생성, `createRuntimeLevelStreaming(...)`의 preload/load/unload snapshot 갱신, unload 후 `target.releaseAssets` payload와 renderer texture eviction 연결을 확인한다.
- `pnpm smoke:level-streaming-browser`는 Chromium + WebGL2 renderer에서 runtime streaming chunk 이동 후 256개 render command, draw call 2회, texture switch 1회, `RuntimeProfiler` budget, shared texture retain, old chunk texture eviction, canvas pixel readback을 확인한다.
- `pnpm smoke:debug-gizmos`는 public package build에서 path/spawn/prefab/collider debug category가 metadata가 있는 line view와 physics debug line buffer로 변환되는지 확인한다.
- `pnpm smoke:accessibility-options`는 public package build에서 reduced motion camera/fade adapter, subtitle panel helper, high-contrast HUD theme hook, input assist metadata 정규화를 확인한다.
- `pnpm smoke:screenshot-capture`는 Minimal Game browser smoke에서 PNG와 `*.summary.json` artifact를 생성하고 screenshot summary threshold helper가 동작하는지 확인한다.
- `pnpm smoke:create-game-template-catalog`는 `@ferrum2d/create-game`의 machine-readable template catalog 출력과 CLI option negative path를 확인한다.
- `pnpm smoke:template-set`은 `@ferrum2d/create-game`의 `minimal`, `topdown`, `platformer` template catalog, 필수 파일, generated project public import, harness script 구성을 확인한다.
- `pnpm smoke:tilemap-authoring`은 `applyTileRules(...)`, `bakeAnimatedTileLayer(...)`, Tiled import 결과 authoring, LDtk entity/tile layer fixture를 함께 확인한다.
- browser console error와 page error가 발생하지 않는다.

새 browser smoke에서 frame/render/physics budget을 검사할 때는 `RuntimeProfiler`를 우선 사용한다. `FerrumRuntimeOptions.profiler`를 켜면 runtime이 `DebugOverlayMetrics`를 profiler에 기록하고, smoke script는 `--budget` 모드에서 profiler snapshot의 frame time, Rust update, render time, draw call, render command, texture switch, fixed step, solid/tile candidate check, CCD check, physics debug line, collision pair, asset load elapsed budget 위반을 구조화된 결과로 확인한다.

`tests/smoke/runtime-budget-profiles.mjs`에 budget field를 추가할 때는 `packages/ferrum-web/src/runtimeProfiler.ts`의 `RuntimeDiagnosticsBudget`, `RuntimeProfilerSnapshot`, 단일 frame evaluator, aggregate evaluator, 그리고 `tests/smoke/browser-render-smoke.mjs`의 `RUNTIME_BUDGET_FIELDS`를 함께 동기화한다. field가 profiler snapshot에 없으면 browser smoke는 `missingMetric` 위반으로 실패해야 한다.

기본 브라우저 채널은 `chrome`이다. 환경에 따라 다음 환경 변수를 사용할 수 있다.

```bash
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:browser
FERRUM_BROWSER_EXECUTABLE=/path/to/browser pnpm smoke:browser
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:browser-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:placement-viewer
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:physics-sandbox-budget
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:preload
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:mobile-input
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:lighting
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:lighting-webgpu
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:material
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:material-webgpu
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:particle-vfx
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-save-load
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown-hd2d
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:breakout-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:platformer-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:physics-demo-suite
```

이 검증은 Web Audio unlock, 키보드/마우스 조작감, 전체 Top-down Shooter 게임플레이를 대체하지 않는다. 해당 항목은 여전히 수동 smoke check에서 확인한다.

Rust 코드나 Rust/Wasm 경계를 바꾼 경우에는 `pnpm smoke:check`와 별도로 다음을 실행한다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

## Package consumer smoke check

npm package 후보가 실제 사용자 프로젝트에서 설치되고 빌드되는지 확인하려면 다음을 실행한다.

```bash
pnpm package:consumer-smoke
```

이 명령은 네 package의 allowlist/pack 검증을 먼저 실행한 뒤 임시 consumer 환경에서 다음을 확인한다.

- `@ferrum2d/create-game` tarball의 bin으로 starter project를 생성한다.
- 생성 프로젝트가 `@ferrum2d/ferrum-web`과 `@ferrum2d/authoring-viewer` tarball을 dependency로 설치한다.
- 목적별 public subpath import가 성공하고 `@ferrum2d/ferrum-web` root aggregate import와 `@ferrum2d/ferrum-web/dist/*` 내부 import가 generated template report/package exports에서 차단된다. gameplay authoring/replay helper와 `gameplayActionDiagnosticReports(...)` 같은 agent-facing diagnostic helper도 generated project import/type smoke에서 확인한다.
- `@ferrum2d/agents` tarball의 bin이 생성 프로젝트에 대해 dry-run으로 파일을 쓰지 않는다.
- 설치된 consumer agent/skill/command는 projectile/weapon authoring helper와 함께 Game Spec `content.localization`/`content.dialogue.graphs`/`content.cutscenes`, `createShooterContentRuntimeOptions(...)` 기반 content runtime authoring 루프를 문서화해야 한다.
- 생성 프로젝트의 `ferrum:check`, `ferrum:report`, `ferrum:validate`, `ferrum:authoring-report`, `ferrum:replay-report`, `ferrum:runtime-replay-report`, `ferrum:runtime-replay-recipe`, `ferrum:smoke`, `ferrum:deploy-report`, production build가 통과한다. `ferrum:check`는 `ferrum2d.consumer.check.report`로 각 하위 단계와 첫 실패/다음 명령을 요약해야 한다. deploy report는 `ferrum2d.consumer.deploy-readiness.report` envelope로 `dist/index.html`, HTML 및 정적으로 판별 가능한 runtime/CSS 상대 asset 참조와 참조 파일을 가상 하위 HTTP 경로에서 검사하고, 생성 프로젝트의 실제 `preview` 명령이 index HTTP와 Wasm `application/wasm` 응답을 제공하는지 확인해 `status: "ready"`를 반환해야 한다. HTML `<base>` 요소는 `FERRUM_DEPLOY_HTML_BASE_UNSUPPORTED`로 거부하고, 여러 디렉터리의 HTML entry와 상대 literal `fetch(...)`가 함께 있어 document base가 모호하면 `FERRUM_DEPLOY_FETCH_BASE_AMBIGUOUS`로 거부한다. 이어서 generated `dist/index.html`을 별도 가상 하위 경로로 열어 `.wasm`이 `application/wasm`으로 응답하고 runtime이 Playing 상태이며 엔티티·sprite·render command·draw call이 양수인지, 완료된 renderer frame 정확히 12개에서 최종 `renderer.stats()`로 집계한 최대 draw call이 등록된 template runtime budget profile(`minimal` 8, `topdown`/`platformer`/`breakout` 16) 이하인지 확인한다. WebGL2 framebuffer는 production `preserveDrawingBuffer` 설정 없이 12번째 renderer frame 뒤 같은 RAF에서 읽기 시작하고, 빈 경우 최대 8회까지만 같은 순서의 RAF에서 재시도한 뒤 배경색과 다른 픽셀이 있어야 한다. production build 뒤에는 generated `dist/placement-viewer.html`도 정적 서버로 열고 `Project Assets`의 `atlas` Add 버튼이 `object` prefab + `props.components.visual.kind: "sprite"` + 기본 aabb collider `addInstance` draft patch를 만들고 해당 instance를 선택하는지, grouped Selected Inspector가 `Identity`/`Visual`/`Collider`/`Behavior` 값을 현재 선택 상태와 동기화하는지, Behavior Binding inspector가 기존 recipe id attach/detach를 `updateBehaviorBinding` reference patch로 처리한 뒤 draft를 비울 수 있는지, 선택 instance에서 `addObjectDefinition` draft를 만든 뒤 새 ObjectDefinition/Prefab을 참조하는 `addInstance` draft와 resolved state가 이어지는지 Playwright로 확인한다. `Apply Memory`는 viewer session만 갱신하고 `public/scene-authoring.json`을 쓰지 않으며 smoke hook의 `saveMode: "memory"`로 구분한다. consumer smoke는 `ferrum:report`의 `ferrum2d.consumer.project.report` JSON envelope를 파싱해 `format`, `version`, `ok`, project dependency/file/internal-import/root-aggregate-import/deployment summary, template별 `runtimeInputs`와 최상위 `recommendedCommands`를 확인한다. 모든 template의 authoring report는 configured `public/scene-authoring.json` 또는 `public/game.json`을 검증해 `validated`를 반환해야 한다. 모든 template의 gameplay replay report는 `public/gameplay-replay.fixture.json`과 현재 template contract를 비교해 `validated`를 반환하고, `public/gameplay-replay.coverage-tags.json`의 `coverageTagDefinitions`/`coverageTagGroups`/`deprecatedCoverageTags` registry metadata도 report에 포함해야 한다. Runtime replay configured template(`minimal`/`topdown`/`platformer`/`breakout`)은 `public/gameplay-runtime-replay.fixture.json`과 `public/gameplay-runtime-replay.coverage-tags.json`을 포함하며, public `createEngine(...)` + deterministic `requestAnimationFrame` shim + `captureGameStateSnapshot(...)` 기반 headless runtime replay report가 `validated`를 반환해야 한다. `topdown`은 `resolveShooterGameSpec(...)`와 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`로 `public/game.json`과 built-in shooter state를 포함한다. `platformer`는 public `usePlatformerGame()`으로 built-in platformer scene을 boot하고, platformer 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.platformer` JSON에 포함한다. `breakout`은 public `useBreakoutGame()`으로 built-in Breakout scene을 boot하고, Breakout 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.breakout` JSON에 포함한다. `breakout` authoring report는 `public/scene-authoring.json`의 built-in paddle/ball runtime entity handle과 Behavior Recipe binding summary를 포함해야 한다. `ferrum:update-replay-fixture`와 `ferrum:update-runtime-replay-fixture`는 runtime replay configured template에서 fixture update report로 성공해야 한다. `ferrum:runtime-replay-recipe`는 `ferrum2d.consumer.runtime-gameplay-replay.recipe` envelope로 fixed timestep, seed/input sequence, capture frame, canonical/excluded state 목록을 반환해야 한다. `topdown` smoke는 fixture hash를 의도적으로 stale 값으로 바꿔 `ferrum:replay-report`가 non-zero와 `FERRUM_CONSUMER_REPLAY_FIXTURE_INVALID` machine-actionable fixture path report를 반환하는지 확인한다. 이어서 `public/game.json`의 player speed를 임시 변경해 유효한 fixture와 현재 Game Spec이 갈라진 drift case가 `FERRUM_CONSUMER_REPLAY_MISMATCH`와 changed JSON path를 반환하는지도 확인한다. 두 실패 경로 모두 `ferrum:update-replay-fixture`와 재실행 replay report로 복구 경로까지 검증한다. `minimal`/`platformer`/`breakout`은 생성 시 바뀌지 않는 template surface contract replay를 기본 제공한다.

Top-down template replay report 계약만 빠르게 확인하려면 `pnpm smoke:topdown-template-replay-report`를 사용한다. 이 smoke는 template을 임시 폴더에 복사하고 workspace `@ferrum2d/ferrum-web` package를 symlink해, install/registry 접근 없이 `replay-report -> drift patch candidate -> update-replay-fixture -> replay-report` 흐름을 검증한다. full tarball install, public subpath import/type smoke, generated production build는 계속 `pnpm package:consumer-smoke`의 책임이다.

create-game template catalog 계약만 빠르게 확인하려면 `pnpm smoke:create-game-template-catalog`를 사용한다. 이 smoke는 CLI JSON report root `format: "ferrum-create-game-template-list"`, `version`, `defaultTemplate`, template별 `sceneAuthoring`/`gameplayReplay`/`runtimeGameplayReplay` entry가 manifest와 같은지 검증한다. 또한 human-readable list fallback, `--json` misuse negative path, invalid manifest가 JSON catalog로 누출되지 않는지도 확인한다. full tarball install, generated project file replacement, harness report execution은 계속 `pnpm package:consumer-smoke`와 `pnpm smoke:create-game-template-reports`의 책임이다.

전체 create-game template이 consumer agent가 읽을 수 있는 report envelope를 내는지만 빠르게 확인하려면 `pnpm smoke:create-game-template-reports`를 사용한다. 이 smoke는 `packages/create-game/templates/manifest.json`의 모든 template을 임시 폴더에 복사하고, `_shared` asset scaffold를 template overlay 전에 합친 뒤 `package.json` placeholder만 temp copy에서 정규화한다. 이후 `ferrum-assets.mjs report`, `ferrum-assets.mjs validate`, `ferrum-harness.mjs report`, `ferrum-harness.mjs authoring-report`와 `replay-report`, `update-replay-fixture`, `ferrum-runtime-replay.mjs report`, `ferrum-runtime-replay.mjs recipe`, `ferrum-runtime-replay.mjs update-fixture`를 직접 실행한다. 별도 deploy synthetic output과 실제 preview fixture server로 상대 `fetch`/module URL 및 preview HTTP/MIME 정상 경로, 잘못된 preview Wasm MIME, 절대 `fetch`, HTML `<base>`, 다중 HTML 디렉터리의 상대 `fetch` 경로를 실행해 deploy diagnostic의 성공·실패 동작을 고정한다. `ferrum-harness.mjs report`는 `ferrum2d.consumer.project.report` envelope로 project status, package dependency, generated files, internal/root aggregate import count, 최상위 recommended command를 확인한다. `ferrum-harness.mjs authoring-report`는 `placementAuthoring.instances[].behaviorBindings[]`의 `recipeId`, `bindingPath`, `behaviorRecipePath`, target instance, command count/type까지 확인해 Behavior Binding inspector가 만든 reference patch를 agent가 report evidence로 추적할 수 있는지도 검증한다. manifest의 `sceneAuthoring`, `gameplayReplay`, `runtimeGameplayReplay` entry는 template별 deterministic fixture 제공 여부를 catalog로 고정하며, smoke는 각 harness의 configured 값이 catalog와 일치하는지도 확인한다. Workspace `@ferrum2d/ferrum-web` package를 symlink해 asset public subpath validate와 authoring/gameplay/runtime replay fixture를 검증한다. `topdown`은 Game Spec contract replay를, `minimal`/`platformer`/`breakout`은 template surface contract replay를 검증한다. runtime replay는 configured template의 headless runtime fixture/report/update path를 확인한다. 이 명령은 install, tarball pack, create-game CLI token replacement, 실제 template production build를 검증하지 않는다.

의존성 store가 준비된 CI 환경에서는 `pnpm package:consumer-smoke -- --offline`으로 registry resolution 없이 실행할 수 있다. 새 머신에서는 일반 실행으로 Vite/TypeScript 범위 의존성을 consumer install과 같은 방식으로 해석한다. offline 실행은 generated project의 direct dependency tarball(예: TypeScript)이 pnpm store에 없으면 `ERR_PNPM_NO_OFFLINE_TARBALL`로 실패한다. 성공/실패 report와 재현용 파일을 보존하려면 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`를 사용한다. generated deployment canvas는 `renderPostProcess` 직후 같은 호출 스택에서 픽셀을 읽는다. 별도 RAF 등록 순서에 의존하지 않고 실제 완료된 12프레임만 집계하며, 빈 readback은 이후 완료된 프레임에서 최대 8회까지만 읽은 뒤 계속 비어 있으면 실패한다. 재시도 중 draw call도 최대 예산값에 포함한다. context loss/readback 오류는 별도 원인을 남기고, 빈 화면 실패 메시지에도 runtime/canvas 측정값을 보존한다. 이 artifact는 `pnpm validate:consumer-smoke-report`로 `consumer-smoke-report.json`, tarball, tarball-installed `@ferrum2d/create-game --list-templates --json`에서 얻은 `createGameCatalog`, `requestedTemplates`와 generated template summary의 일치, deployment readiness/browser summary의 1~8 `readbackAttempts`, placement viewer check/report와 `dist/placement-viewer.html` build output, `node_modules`/`dist` 없는 snapshot 계약을 검증한다. `pnpm smoke:consumer-smoke-report`는 렌더 완료 시점/연속 프레임/bounded retry/draw budget/WebGL 오류 진단 회귀 테스트와 report validator를 함께 실행한다. validator는 tarball 생성 전 초기 실패처럼 snapshot이 아직 없을 수 있는 failed report를 허용하면서, passed report의 `createGameCatalog`/deployment/placement viewer summary 누락·불일치와 범위를 벗어난 readback evidence, 존재하는 snapshot의 `node_modules`/`dist`/`.pnpm` 오염은 계속 실패시키는지 확인한다.

Consumer agents 지침 변경은 `pnpm package:check:agents`에서 공통 `.agents/harness/ferrum-game-presentation.md`와 기능 탐색용 `.agents/harness/ferrum-feature-guide.md`의 참조·tarball 포함 여부, 설치 결과의 원본 일치, 설치 전용 파일/루트 디렉터리 allowlist를 확인한다. 기능 안내서는 root 지침과 development/presentation harness에서 연결하며 tarball consumer 설치에서도 내용과 참조를 검사한다. 재설치와 기존 프로젝트 dry-run에서는 사용자 지침·게임 소스·데이터·package 설정을 보존하고, 구형 지침을 건너뛸 때 비교·병합 안내가 나오는지도 검사한다. `package:consumer-smoke`는 tarball로 설치된 공유 기준과 도구별 참조도 검사한다. 게임의 화면 품질은 이 자동 검증과 별도로 공통 기준에 따라 실제 브라우저에서 첫 화면·가독성·이동/카메라·조사/수집·HUD 입력·resize를 검수하고 스크린샷/조작 순서와 미검수 항목을 기록한다. 설치-only 검증 과정에 게임 생성이나 서버 실행을 추가하지 않는다. [#59 지침 변경 및 작은 섬 게임 검수 기록](consumer-game-presentation-review.md)을 참고한다.

Consumer browser smoke는 설치된 Chrome을 우선 사용하고, 없으면 전체 Chromium의 `channel: "chromium"` headless 모드를 사용한다. 별도 headless shell로 자동 전환하지 않는다. 로컬 브라우저가 없으면 `pnpm exec playwright-core install chromium`으로 전체 Chromium을 설치한다(`--only-shell` 제외). `FERRUM_BROWSER_CHANNEL` 또는 `FERRUM_BROWSER_EXECUTABLE`로 지정할 수도 있다. 두 headless 구현의 차이는 [Playwright 브라우저 문서](https://playwright.dev/docs/browsers#chromium-new-headless-mode)에 설명되어 있다.

GitHub Releases 설치 경로는 `pnpm test:github-release`로 자동 release 선택, 네 template의 동일 버전 URL, fork, 잘못된 옵션, 기존 프로젝트/.npmrc 보존, 출력된 디렉터리 이동 명령의 특수문자 처리, 실패 보고서 갱신과 명령 시간 초과 시 하위 프로세스 종료를 검사한다. `pnpm release:github:prepare -- --version 0.1.0-beta.0`으로 준비한 묶음에 `pnpm smoke:github-release-install -- --bundle-dir <묶음 경로>`를 실행하면 실제 npx URL tarball 실행, HTTP redirect, npm install/ci, lock integrity, 명시적 agent 설치, check/build와 preview/Wasm MIME을 검증한다. localhost mirror 검증이며 실제 GitHub 다운로드 성공을 뜻하지 않는다. 전체 template browser/placement viewer 회귀는 기존 `package:consumer-smoke`와 report validator를 사용한다. 계약 테스트는 CI validate에 연결되며 수동 `github-release-prepare.yml`은 묶음 준비부터 HTTP 설치와 전체 consumer matrix까지 실행한다. [배포 절차](../operations/github-release.md)를 참고한다.

release 후보를 배포하지 않고 로컬에서 리허설할 때는 `pnpm release:local-check`를 사용한다. 이 명령은 `pnpm release:candidate-check`, `pnpm package:check`, `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke-release-local`, `pnpm validate:consumer-smoke-report -- --expect-status passed`를 순서대로 실행해 같은 후보 세트의 metadata, tarball, generated consumer project smoke를 묶어서 확인한다.

## CI와 로컬 검증 차이

현재 GitHub Actions CI는 `workflow_dispatch`로 수동 실행한다. `ferrum-web-v*` tag ref에서도 GitHub 배포용 candidate guard와 `private: true` package 검사를 사용하며 consumer smoke와 extended browser matrix를 실행한다. branch에서 해당 matrix가 필요하면 각각 `consumer_smoke`, `extended_browser_smoke` input을 켠다. npm publish 전용 검사는 별도 npm 배포 절차에 남긴다.

현재 CI 기준:

1. `pnpm install`
2. `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
3. `pnpm smoke:physics`
4. `pnpm smoke:runtime-budgets`
5. `pnpm validate:runtime-budget-product`
6. `pnpm smoke:mass-objects`
7. `pnpm smoke:topdown-mass-objects`
8. `pnpm smoke:topdown-tilemap-budget`
9. `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
10. `pnpm lint`
11. `pnpm test`
12. `pnpm build`
13. `pnpm package:check`
14. `pnpm validate:gameplay-authoring:report`
15. `pnpm smoke:gameplay-replay:report`
16. `pnpm validate:gameplay-report-artifacts`
17. `pnpm smoke:consumer-smoke-report`
18. `pnpm smoke:asset-pipeline`
19. `pnpm smoke:create-game-template-catalog`
20. `pnpm smoke:create-game-template-reports`
21. `pnpm smoke:topdown-template-replay-report`
22. tag 또는 수동 opt-in일 때 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`
23. consumer smoke 직후 `pnpm validate:consumer-smoke-report -- --expect-status passed` 또는 실패 시 `--expect-status failed`
24. tag 또는 수동 opt-in일 때 extended browser smoke matrix: `smoke:preload`, `smoke:mobile-input`, `smoke:lighting(-webgpu)`, `smoke:material(-webgpu)`, `smoke:camera-postprocess`, `smoke:particle-vfx`, `smoke:topdown*`, `smoke:destructible-terrain-browser`, `smoke:breakout-*`, `smoke:platformer-*`, `smoke:physics-sandbox*`, `smoke:physics-demo-suite`

extended browser smoke job은 matrix별 artifact 이름을 분리해 budget smoke의 `runtimeBudget` report를 `artifacts/browser-smoke-budgets`에 남긴다. browser budget profile은 frame/render/Rust update, draw/render command/texture switch, physics/collision, asset load budget을 평가한다. Chromium이 `performance.memory`를 제공하는 환경에서는 absolute JS heap used sample도 artifact에 포함하고 budget 위반 여부를 평가한다.

로컬 릴리스 후보 검증은 CI 명령에 더해 Game Spec 검증과 브라우저 수동 확인을 포함한다.

- `pnpm lint`로 TypeScript source/test type check를 확인한다.
- `pnpm test`로 TypeScript Node tests와 Rust tests를 모두 실행한다.
- `pnpm validate:game-spec`로 예제 `game.json`이 runtime validator와 같은 경로를 통과하는지 확인한다.
- `pnpm validate:physics-authoring`으로 `physicsEditor` 샘플이 runtime Physics Spec으로 compile되고 resolver를 통과하는지 확인한다.
- `pnpm smoke:physics`로 물리 solver/CCD/query 대표 scenario와 suite hash를 확인한다.
- `pnpm smoke:physics-replay`로 physics smoke suite hash와 Web replay helper state hash 재현성을 확인한다.
- `pnpm smoke:destructible-terrain`으로 tilemap rect edit의 query/render 동기화, dirty chunk collision cache, suite hash를 확인한다.
- `pnpm smoke:destructible-terrain-browser`로 Top-down Shooter browser path의 deterministic tile 제거 demo를 확인한다.
- `pnpm smoke:headless`로 Game Spec 적용 경로, collision/navigation 전제, representative render command buffer를 확인한다.
- `pnpm smoke:topdown`으로 Top-down Shooter production build에서 particle burst와 non-lethal enemy tint flash가 browser render path에 도달하는지 확인한다.
- `pnpm smoke:topdown-mass-objects`로 Top-down Shooter browser path에서 Playing 상태의 1,024개 enemy entity restore, WebGL2 대량 sprite command budget, collision pair budget을 확인한다.
- `pnpm smoke:topdown-save-load`로 built-in shooter save/load snapshot restore가 browser production build에서 재현되는지 확인한다.
- `pnpm smoke:topdown-hd2d`로 bridge portal navigation, projectile arc, HD-2D render path가 Top-down Shooter browser production build에서 재현되는지 확인한다.
- `pnpm smoke:runtime-budgets`로 CI에서 runtime budget profile 계약을 확인하고, 예제별 성능 회귀가 의심되면 해당 `smoke:*-budget` browser smoke를 추가로 실행한다. budget browser smoke는 frame/render/Rust update 지표를 report artifact로 남기고, Chromium이 heap API를 제공하면 heap sample도 함께 기록한다.
- `pnpm smoke:mass-objects`로 1,000개 이상 enemy/projectile Rust frame path와 collision pair budget 회귀를 확인한다.
- `pnpm smoke:physics-demo-suite`로 Physics Sandbox fixture catalog 7개가 browser selector, Physics Spec apply, engine debug primitive와 bitmap world text render path를 통과하는지 확인한다.
- `pnpm package:check`로 runtime package entrypoint, authoring-viewer contract/DOM shell/panel primitive helper package, create-game scaffold, agents template, files allowlist, generated Wasm artifact, 실제 `pnpm pack` tarball 구성을 확인한다.
- `pnpm package:consumer-smoke`로 local tarball install, generated game build, generated placement viewer Handoff copy/save action state, Project Assets Add Sprite browser smoke, authoring-viewer dependency, agents dry-run을 임시 consumer project에서 확인한다.
- `pnpm release:local-check`로 네 package release 후보 metadata, tarball allowlist, local consumer smoke report validation을 배포 없이 한 번에 확인한다.
- `pnpm release:check`로 changelog, beta version, release tag metadata 구조를 확인한다.
- `pnpm build`로 Wasm package와 Top-down Shooter production build를 확인한다.
- `pnpm build:pages`로 GitHub Pages demo/docs artifact 구성과 문서 HTML 생성을 확인한다.
- 브라우저 수동 smoke check로 WebGL2, 입력, 오디오, DebugOverlay 표시를 확인한다.

기본 validate job은 브라우저 실제 렌더링, 사용자 입력, Web Audio 재생, screenshot 갱신을 검증하지 않는다. extended browser smoke job은 tag 또는 수동 opt-in에서 브라우저 렌더링/입력/WebGPU fallback/예제별 budget을 검증하지만, Web Audio unlock과 screenshot baseline 갱신은 여전히 수동 smoke 범위다.

## Top-down Shooter 수동 smoke check

사전 조건:

- `pnpm install`이 완료되어 있어야 한다.
- `wasm-pack`과 Rust `wasm32-unknown-unknown` target이 설치되어 있어야 한다.
- WebGL2를 지원하는 브라우저에서 확인한다.

실행:

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

브라우저에서 Vite URL에 접속한 뒤 `examples/topdown-shooter/SMOKE_CHECKLIST.md`를 따른다. 이 문서는 자동/CI/수동 검증의 관계만 유지하고, 실제 브라우저 확인 항목은 예제 체크리스트 문서를 기준으로 한다.

## Screenshot 갱신

README preview용 스크린샷 절차는 [screenshots README](screenshots/README.md)를 따른다. smoke check에서 화면이 바뀐 것을 의도했다면 `docs/development/quality/screenshots/topdown-shooter-title.png` 갱신 여부를 함께 판단한다.

자동 browser smoke artifact가 필요하면 `tests/smoke/browser-render-smoke.mjs`에 `--screenshot-artifact-dir <dir>`와 `--screenshot-name <name>`을 전달한다. baseline summary JSON과 비교하려면 `--screenshot-baseline <summary.json>`을 함께 전달하고, 허용 오차는 `--screenshot-max-average-delta`, `--screenshot-max-opaque-ratio-delta`, `--screenshot-max-non-transparent-ratio-delta`로 조정한다.

## 실패 기록 형식

검증 실패가 있으면 작업 결과에 다음을 남긴다.

- 실패 명령 또는 수동 확인 항목
- 실패 원인
- 사용자 영향
- 후속 조치 또는 보류 사유

### 에셋 묶음 로딩 수명 회귀

`pnpm smoke:asset-loading`은 실제 public `runtime.engine.loadAssets`와 preload를 로컬 HTTP 서버에서 실행한다.
CI의 수동 `validate` job과 `smoke:check`에 연결한다. 보고서는 `artifacts/asset-loading/report.json`이다.

- DPR 1/2에서 texture/sound/JSON 네 항목의 공유 동시 요청 상한 2와 완료 진행률을 검사한다.
- 실제 PNG upload·WAV decode·JSON 해석, Rust Data Scene Playing/2 render commands와 비어 있지 않은 pixel을 검사한다.
- 네트워크 중 묶음 취소는 대기 작업을 시작하지 않고 audio/texture를 늦게 등록하지 않아야 한다. 같은 ID 재시도도 검증한다.
- HTTP 500 시 원래 오류 보존·sibling 취소·진행률 중단, preload 취소, engine 단독 종료 시 host 자원 보존을 검사한다.
- runtime 종료 후 GPU texture 잔여는 0이어야 한다. 지연은 취소 경합 fixture이며 성능 향상 수치로 해석하지 않는다.
- SDK `assetLoadLifecycle`/`audioManager` 회귀는 cache/body/decode 중단, 같은 사운드 ID 교체, evict/destroy,
  abort listener의 동일 ID 재진입, 실패 HTTP body 취소·정리 오류 시 원래 진단 보존,
  ID 순서·병렬 상한·늦은 진행률 차단을 검사한다. shader/물리 알고리즘과 Wasm ABI 변경은 없다.

### 공간 오디오 출력·native binding 회귀

`pnpm smoke:spatial-audio`는 packed public SDK와 실제 OfflineAudioContext/PannerNode로 12개 출력 상태를 DPR 1/2에서 검사한다.
좌/우 채널 RMS 비율, inverse 거리 1→10의 진폭 0.1배, elevation 포함 거리, cone 반전 0.1배,
listener 180도 회전·source 이동, SFX mute/stop의 무음, Panner 미지원의 동일 채널 fallback을 요구한다.
가짜 audio 계산이나 자체 감쇠 공식을 출력 대신 사용하지 않는다.
동일 페이지의 native 공간 예제는 실제 PNG/Rust 렌더와 물/횃불 WAV 2개를 실행하고 user click으로 context를 unlock한다.
native 이동/높이·층 변경·source despawn/stale generation·rebind·일반/삭제된 source 포함 저장 복원·physics 비활성 상태와
카메라 listener·mute/destroy를 검증한다. destroy 후 실제 AudioContext가 closed 상태가 될 때까지 확인한다.
warm 20 update의 query는 20회 bulk 호출/개체별 호출 0이며 source/gain/panner 생성은 0이다.
보고서와 예제 캡처는 `artifacts/spatial-audio/run-*/`에 보존하며 CI validate와 smoke:check에 연결한다.
단위 회귀는 유효 범위/잘못된 입력의 side effect 차단, 노드 할당 실패 정리, voice 상한 64,
end/evict/destroy, 큰 방향 벡터의 yaw 회전, listener 검증 전 장치 연결 차단,
누락 개체의 음소거/명시적 지연 연결, rebind 실패 보존과 borrowed pose 형식을 보강한다. Rust 회귀는 row ABI와 순서·높이·yaw·stale handle·
physics 비활성 transform·65개 조회의 저장 공간 재사용 및 초과 입력 거절을 검사한다.

### GPU 자원 수명주기 회귀

같은 `pnpm smoke:gpu-resources`는 opt-in GPU timer와 Wasm 용량 sample 연결도 검증한다.
실제 Wasm Data Scene 상태, 1024개 command, 3개 draw call과 함께 engine/frame/profiler의
Wasm bytes 일치, 최대 4개 native query, destroy 후 query 0을 확인한다.
지원 환경에서는 비동기 GPU query 결과가 실제 profiler sample에 들어가야 한다.
미지원 환경은 `unsupported`, sample 0, 최대 시간 없음으로 보고하고 GPU 시간 검증 통과로 해석하지 않는다.
`gpuTiming` report의 상태/sampleCount/maxMs와 `memoryBytes`를 확인한다.
`memoryBaselineBytes`/`memoryFinalBytes`/`memoryDeltaBytes`는 warmup 이후 용량 변화이며
heap 누수 없음의 증거가 아니다. `gpuRenderer`는 검증 브라우저의 실제 renderer 정보를 기록한다.
`node tests/smoke/gpu-resources-browser-smoke.mjs --require-gpu-timing`은 Chromium developer extension을
허용하고 실제 GPU sample이 없으면 실패한다. 이 설정은 검증 브라우저에만 적용한다.
software renderer에서 얻은 시간은 계측 연결 증거이며 실물 GPU 성능 판정값이 아니다.
단위 검사는 query 지연/재사용/포화, 외부 query 충돌 회피, disjoint/context loss,
render 예외의 query 종료와 미측정 budget 실패를 검증한다. 이 smoke는 기존 CI validate에 연결되어 있다.
섬 게임의 나무 24/72/144개 비교, 장면 10회 왕복, 실물 모바일 및 실제 사용 heap 검수는 별도다.

`pnpm smoke:gpu-resources`는 public `createFerrumRuntime`/Data Scene 경로로 실제 Rust
15-float command를 만들고 Playing 상태, entity/command 1,024개와 sprite 1 + 후처리 2 draw를
함께 assert한다. DPR 1/2에서 legacy/linear-srgb 각각 12회 scene 교체, asset 재로드/evict,
RenderTexture 2개 생성·resize·중복 해제 후 warmup 자원 snapshot 복귀를 검증한다.
테스트용 GL 계측은 실제 create/delete/texImage2D/bufferData 호출과 공개 count/bytes를 독립 비교한다.
색상 픽셀 readback, physics debug buffer 용량 증가, retained target의 canvas resize,
steady frame 12회의 GPU 객체 재할당 없음, renderer destroy 후 texture/buffer/program/FBO 0도 확인한다.

DebugOverlay 표시와 실제 `RuntimeProfiler.latestFrame`의 GPU sample을 확인하며,
전용 fixture의 예산은 texture 8, buffer 5, program 5, target 5, 추정 저장량 2 MiB다.
관측값보다 작은 texture budget에서 실제 위반이 발생하는지도 검사한다.
이 fixture의 예산은 해당 해상도/scene 전용이며 전체 GPU VRAM의 성능 한계로 해석하지 않는다.
기존 공용 runtime budget profile에는 미측정 GPU 필드를 일괄 추가하지 않는다.
`runtimeProfiler.test.ts`는 미지원/부분 누락/빈 window가 GPU budget을 통과하지 않는지 검증한다.
WebGPU native 자원 집계, 실제 driver 메모리/context-loss 복구는 이 smoke 범위에 포함하지 않는다.


`pnpm smoke:ktx2`는 DPR 1/2, legacy/linear-srgb에서 실제 ETC1S/UASTC 변환과
압축 업로드를 검사한다. public Data Scene Playing, Rust 15-float 명령 1,024개, draw 1/2회,
PSNR 최소 28/35 dB, 512² GPU block 262,144 bytes, malformed/미지원/alpha fallback,
AbortSignal 및 destroy 후 Worker/GPU 자원 0을 assert한다. 같은 검증을 Vite production 번들로도
실행해 Worker 및 decoder JS/Wasm URL 재작성과 self-host 배포 경로를 검사한다.
단위 테스트는 잘못된 출력, 업로드 실패 cleanup, 입력 크기 제한, 같은 ID 경쟁, WebGPU 취소를 보강한다.


`pnpm smoke:shader-preparation`은 실제 Rust Playing Data Scene 1,024개 command(15-float)를
동기/비동기 renderer로 그린다. DPR 1/2 × legacy/linear-srgb × 기본/3개 후처리에서 픽셀 일치,
program 5개/shader 10개만 생성, draw 1/2/4회, 30회 steady draw 추가 할당 0, destroy 자원 0을 검사한다.
초기화 wall time 5초와 CPU submission P95 100ms는 hang/큰 회귀를 잡는 smoke 한계이며 FPS 보장이 아니다.
실제 native extension 지원 여부를 report한다. CI 미지원 기기에서도 completion 상태 shim으로
실제 GL shader success/abort/link/allocation/callback/timeout cleanup을 검증하지만 native parallel 성능으로
해석하지 않는다. public createFerrumRuntime와 LoadingOverlay 연결도 검사한다.

## Data Scene native consumer (#62~#65)

`pnpm smoke:data-scene`는 실제 runtime tarball을 pack/추출하고 public imports로 WebGL2 recipe를 실행한다. 1280×720/390×844 × DPR 1/2에서 origin/tint 픽셀, 배경/나무/actor 순서, heightSpan 추가/제거, kinematic collider/조개 접촉 위치, camera pan/zoom/resize, pointer 이동, culling, world label/light/occluder, reset stale handle을 확인한다. report는 `artifacts/data-scene-consumer-*/report.json`이다. `smoke:check`와 수동 CI validate job에 연결된다. 원격 CI 성공을 의미하지 않는다.

## Data Scene 애니메이션·투영·태양 (#68~#70)

`pnpm smoke:data-scene-presentation`은 실제 runtime tarball과 Wasm으로 optional
`examples/data-scene-native/presentation.mjs` recipe를 실행한다. 1280×720/390×844 × DPR 1/2 ×
legacy/linear-sRGB에서 독립 clip/frame/flip 픽셀, texture 재업로드 및 entity 재생성 없음,
pause/완료/stale handle, ground scale 1/0.72 × zoom 0.75/1.5의 좌표/입력/label/particle,
지면 그림자 alpha와 sun 방향/cache, point light/occluder/debug를 검증한다.
두 renderer 모두 기본 pivot과 발 pivot 혼용 및 world text의 앞뒤 가림 픽셀, 타원 점광원의 세로 차폐물
그림자와 반경 변경, Wasm f32 최솟값 ground scale 0.01의 실제 frame 진행을 검사한다.
100/500/1000 caster의 command 수와 draw/resource 비용을 report하고 reapply/despawn/destroy를 검사한다.
#73 B2 alpha 경로는 두 atlas frame의 구멍/반투명 픽셀, flipX/flipY, rotation/origin/instance scale,
ground/upright와 resize를 검사한다. 같은 frame 구간에서 texture upload/readback이 증가하지 않아야
하며 100/500/1000 alpha caster의 command는 2N+1, draw는 5 이하, texture/buffer 생존 수는 일정해야
한다. WebGPU 자원은 test-only native allocation tracker로 확인한다. CPU render/Rust p95는 기록만
하고 소프트웨어 adapter 수치로 실제 GPU frame-time gate를 대신하지 않는다.
report와 screenshots는 `artifacts/data-scene-presentation-*/`에 남긴다. `smoke:check`와 CI validate
job에서 실행하며 로컬 통과가 원격 CI 성공이나 물리 GPU 성능을 의미하지는 않는다.

WebGPU는 별도 GPU texture에 같은 renderer/WGSL을 실행하고 readback한 DPR 1/2 픽셀을 검증한다.
test-only canvas context adapter는 offscreen target만 제공하며 shader/queue/texture는 실제 WebGPU다.
headless 환경에서 native canvas clear만으로 device가 종료되는 경로와 분리했으므로 native 화면
presentation 성공으로 해석하지 않는다. adapter가 없거나 validation/pixel 검증에 실패하면 smoke도 실패한다.

`smoke:placement-viewer`는 bottom-origin sprite의 회전·scale을 반영한 selection/draft overlay와 picking, 회전된 primitive resize를 검증한다. `smoke:color-management`는 기본·최상위·WebGL2·WebGPU fallback·주입 renderer의 Data Scene hex 색을 초기 적용/reapply/transition마다 실제 Wasm command와 픽셀로 확인한다. renderer와 다른 색 공간으로 재적용하는 요청은 거부해야 한다.


## 입력 context packed consumer 검증 (#73 B1)

`pnpm smoke:input-context`는 runtime package를 pack한 뒤 `/core`만 import한다.
Chromium의 1280×720/390×844 × DPR 1/2에서 실제 keyboard/mouse 입력으로
복수 키 바인딩, E/Shift action, 짧은 탭 edge, 모달 keyup과 held repeat 차단,
가상 버튼 capture 초기화, 브라우저의 실제 lostpointercapture, source별 해제 및
destroy 후 중립 상태를 assert한다. native dialog, open Shadow DOM 입력칸,
canvas/가상 버튼/joystick의 마우스 버튼 조합과 구독 예외 뒤 DOM 정리도 검사한다.
게임패드는 `navigator.getGamepads` 대역으로 중립 poll 후 재활성화를 검증하며
물리 기기 지원 여부를 판정하지 않는다. visibility와 touch fallback은 단위 테스트로 보강한다.

실패 시 nonzero로 종료하고 `artifacts/input-context-consumer-*/report.json`에 결과를
남긴다. `smoke:check`와 GitHub Actions validate job에 연결한다. CI 실행 성공 여부는
실제 원격 실행 결과로 별도 확인해야 한다. 기존 mobile-input smoke gate도 유지한다.


## Data Scene 탐험 capability 회귀

`pnpm smoke:data-scene-gameplay`는 Wasm/TS 빌드 후 tarball을 별도 consumer에 풀고 public subpath만 import한다.
CI validate job과 `smoke:check`에 연결한다. 증거는 `artifacts/data-scene-gameplay-consumer-*/result.json`이다.
장애물 우회/비용 변경/정확한 waypoint 및 잘못된 좌표 거절, 실패한 Shooter setter의 Data Scene 보존,
activation 전 actor/grid/executor/metadata 진단과 paused 상태·변수·비용 보존을 assert한다.
input gate·pressed/down·hold·release·pause, generic item 수집/한 번 제거/변수 반영을 확인한다.
reapply 및 snapshot restore 뒤 새 generation으로 실제 조사 실행, 변수·정적 grid 복원,
activateDataScene:false의 생략한 설정 보존, complete 중 조사/수집 중단, resetGame과 빈 씬 전환 시
stale handle/grid 제거도 검증한다. Rust 회귀 테스트는 연속 fixed-step 짧은 입력과 재설정 경계를 추가로 검사한다.
`status: passed`는 모든 조건 통과를 의미하며 기존 게임의 관측용 `ok: true` 보고서와 구분한다.
이 명령은 렌더 픽셀/전체 플레이 경험 검증이 아니며 기존 `smoke:data-scene` browser 검증을 함께 유지한다.

Beacon lab 회귀는 authored dynamic의 AABB/circle/capsule/orientedBox/convexPolygon을 scale 1/2로
생성해 기본 mass·gravity와 형상별 관성을 실제 패키지 Wasm에서 확인한다. 자동 stepping의 정확한
단일 이동량, pause, collider obstacle 자동 갱신과 disabled body의 raycast 제외를 검사한다.
authored ID·body flag·collider obstacle은 JSON 왕복/fresh engine 복원 후에도 유지되어야 한다.
Rust 회귀는 variable/fixed step의 dynamic/kinematic 단일 적분, manual dynamic의 명시적 step,
static/disabled 정지, stale handle과 primary/secondary collider의 query/segment/shape cast 제외·재활성화를 검사한다.
TS는 잘못된 f32/mass/material 진단, 작성 옵션의 실제 native 반영과 viewer snapshot의 독립 복사를 확인한다.

같은 packed smoke는 opt-in progress의 JSON 왕복과 fresh engine 복원을 확인한다. 수집된 아이템이
재생성되지 않고 once interaction이 반복되지 않으며 scoped 변수/paused 상태/비용이 유지되어야 한다.
교체한 grid의 크기·원점·최대 비용과 명시적 clear, 잘못된 ID/중복/consumed/grid/version에 해시를
재계산해도 기존 씬 보존, reset/누적 apply/옵션 override의 stale metadata 거절, `__proto__` ID를 검사한다.
Rust는 ID 재사용과 batch 중간 invalid state의 무변경을, TS는 v2 읽기/기존 hash와 restore opt-out을 검증한다.

문 회귀는 `navigation.obstacles`로 연결한 좁은 통로의 body/collider 비활성화 및 개체 제거를 검사한다.
비용 setter 없이 즉시 경로가 열리고 native sweep으로 통과하며, closed/open 상태와 기본 가중 비용·
binding·paused 상태가 JSON 왕복/fresh engine 복원 뒤 유지되어야 한다. 재활성화 시 차단 복구,
잘못된 physics flag/obstacle ID/칸 및 v3에 v4 필드 주입의 무변경 거절, 실제 v3 hash/독립 grid 복원을 검사한다.
Rust는 겹친 blocker·지형 0·generation 재사용·이동 중 재탐색·disabled body의 sweep/ground probe 제외도 검증한다.
빈 슬롯 obstacle/cell 배열과 선택 fragment의 collider 누락은 activation 전에 거절되어 paused 상태·
handle·변수·grid·progress context를 보존해야 한다. 기본 fragment가 비어 있어도 명시적으로 선택한
fragment의 문은 정상 적용된다. collider-only 문은 setter가 true를 반환하고 body flag 없이 저장되어
fresh engine 복원 뒤 재활성화로 통로가 차단되며 stale handle 변경은 false로 거절되어야 한다.

목적지 이동도 public `moveDataSceneActorTo`로 실행한다. solid 장애물을 우회해 정확한 목적지에 도착하고
pickup을 한 번만 수집해야 한다. 잘못된 요청의 이전 경로 보존, pause/resume, 수동 입력 취소와 opt-out,
명시 취소, grid 수정/clear의 blocked 전환, 벽 접촉 후 재요청 시 관통 방지, 진행 복원 시 authored 위치와
idle 복귀, complete/reset 및 static actor 거절을 assert한다. Rust 회귀는 큰 delta의 코너 보존,
auto physics/fixed-step 조합의 거리 중복 방지, 미소 속도/큰 좌표의 거리 누적, 높이/trigger/filter,
teleport·generation 재사용과 양축 접촉면의 분리/접선 이동을 추가 검증한다.
수치 정밀도 회귀는 작은 격자의 코너 유지, 이전 sweep epsilon 경계에서 도착, 양축 미소 변위의
장애물 충돌, 큰 원점에서 잘못 반올림된 셀 중심 거절과 이전 경로 보존, 큰 변위의 목적지 초과 방지를 검사한다.

이동·애니메이션 자동 연결은 같은 packed smoke에서 세 case로 확인한다. authored clip을 적용하고
`configureDataSceneMovementAnimation`으로 연결해 walk→arrival idle, 좌우 공용 clip의 flip/시간 유지,
pause/resume을 검사한다. 없는 clip/중간 invalid batch는 기존 연결을 유지하고 성공한 수동 명령은
해제해야 한다. disable은 playback을 보존하며 v5 진행 snapshot은 clip/시간/flags와 native
pose policy를 자동 복원한다. 새 handle의 주인공이 추가 연결 없이 walk/complete idle을 선택해야 한다.
Rust 회귀는 네 방향, 마지막 코너의 도착 방향, 실제 수동 velocity, blocked 후 idle/수동 이동,
fixed-step·delta 0·pause, 입력 취소, clip 재설정, generation 재사용과 초기화 경계를 추가 검증한다.
기존 `smoke:data-scene-presentation`은 실제 browser의 clip UV/flip 표시 회귀를 확인한다.


같은 packed gameplay smoke는 `collider: true` 장애물의 native 이동/격자 밖 이동/비활성 상태
및 fresh-engine 복원도 검사한다. 분수 경과 시간과 종료된 non-loop clip, pause/flip의 JSON
복원, 잘못된 clip/시간/flag 및 v4에 v5 payload 주입의 원상태 보존을 assert한다. Rust는
경계 접촉/offset/크기/회전/shape 교체, fixed/자동 overlap, 자동 obstacle 제한, native pose
policy와 detached 상태 복원 및 batch atomicity를 확인한다.

`smoke:spatial-scene`의 `spatial-model-assembly-browser-fixture.mjs`는 공개 authoring API로
동일 건물을 0/90/180/270도·0.5~1.5 배율·서로 다른 XY/높이에 배치한다. 동일 actor의 계단/문 이동,
층 전환·회전한 벽 충돌·아래층 통과, 모델을 제거한 실제 depth 비교, 경사면/상층 picking,
native navigation 예산과 warm model upload 0을 확인한다. 각 배치를 fresh engine에 v7 복원해
전체 framebuffer 차이 0과 벽 충돌을 검사한다. 가로/세로·DPR 1/2 matrix 및 최종 GPU 해제를
기존 aggregate gate에서 실행한다. native 회귀는 X ramp의 양방향 높이·top mesh·pick/debug,
unknown flag의 원자적 거절 및 고속 follower fragment의 step/drop 제한을 검사한다.

모델 묶음 probe는 실제 flat frame 뒤의 준비/활성화와 flat frame 완료 직전 commit도 검사한다.
새 준비를 이전 frame 정리로 제거하지 않고 첫 모델 제출 upload 0·WebGL error 0을 유지해야 한다.
소비하지 않은 준비는 다음 flat frame에서 해제하며, 이후 기존 GPU 오류 주입 probe까지 연속 실행해
삭제된 VAO index buffer를 재사용하지 않는지 검증한다.

모델 assembly review 회귀는 소수 좌표·배율의 유효한 native f32 seam 적용과 실제 겹침/퇴화 배치의
activation 전 거절·기존 handle/progress 보존을 검사한다. 같은 probe에서 `__proto__` instance의
적용·저장과 공개 frame의 동일 불투명 핸들/내부 vertex·RGBA 비노출도 assert한다. unit 검증은
`constructor`/`__proto__`/`toString` origin 기본값·상속 속성 제외와 위조 핸들 거절을 포함한다.

같은 probe의 `hierarchies`는 정적 `children`의 3단계 배치를 네 cardinal yaw/서로 다른 scale·높이로
검사한다. 공유 asset의 native 모델 3개 중 화면 밖 부모 2개를 컬링하고 자식 1개만 8 draw/96 triangles·
model upload 0으로 그려야 한다. 자식의 계단/층 전환·벽 충돌·아래층 통과·depth·picking·native 도착과
fresh v7 전체 픽셀 차이 0을 기존 단일 모델 case와 함께 검사한다. 각 viewport/DPR에서 자식의
원래/복원 PNG를 남기며 같은 자원의 공유·최종 해제를 확인한다. unit은 독립 월드 배치와의 JSON 동등성,
입력 불변성·깊이/개수·순환과 공유 객체 구분·namespace 충돌·자식 terrain의 actor 계약 완성도 검사한다.

계층 review probe는 상쇄되지 않는 부모 yaw 90/scale 1.5와 자식의 최종 native matrix basis·pivot을
검사한다. sparse/null proxy와 퇴화/무한 world AABB·높이 구간 10개는 GPU 준비·native 교체 전에
거절해야 하며 기존 handle·snapshot hash·GPU 자원 수를 유지해야 한다. unit도 실제 Wasm에서 이를
재검증한다. 기존 terrain 퇴화 검증은 collider가 없는 별도 입력으로 유지한다.


### 공유 정적 모델 인스턴싱 회귀

`pnpm smoke:spatial-scene`에 연결된 `spatial-model-instancing-browser-fixture.mjs`는 packed public API와 실제
Wasm/WebGL2로 100/500/1,000개 공유 바위의 paused 상태·native row 수·전체 visible 수를 확인한다.
각각 main draw 1회/8N triangles, warm asset upload 0, matrix upload 64N bytes와 일정한 GPU buffer/texture
개수·보관 bytes를 assert하고 CPU submission median/P95를 기록한다. 화면 밖 1개는 native에서 제외하고 자원은 유지한다.
1,000개 저장을 fresh engine에 복원해 전체 framebuffer 차이 0·동일 draw·자원 재업로드 0을 확인한다.
동일 재질 tree 2개는 공유 handle 인스턴싱과 독립적으로 로드한 동일 GLB의 개별 draw를 비교한다.
회전(-25/90도)·배율(.8/1.25)·높이(8/0)가 서로 다른 두 instance에 MASK·양면·normal/tangent·emissive·depth·fog·
점광원 6면/태양광 1면 그림자를 켠 실제 픽셀 차이가 0이어야 한다. 실제 shadow 인스턴싱 호출과 동적 행렬 전송을
통계와 대조하고 warm shadow cache hit의 shadow draw/upload 0도 확인한다.
단위 회귀는 공유 재질 검증 횟수 불변과 마지막 row의 잘못된 행렬/flags/mask/reserved·제출 예산 거절,
native cold output 예약 및 첫 frame의 pointer/capacity 불변을 검사한다. 직접 packet의 17개 자원·128 MiB 초과는
모델 자원 준비 전에 거절하며 미사용 handle·동일 CPU 자원의 별칭은 불필요하게 거절하지 않는다.
준비 smoke는 instance buffer storage 실패도 주입해 pipeline 회수와 재시도를 검사한다.
1280×720 / 390×844 × DPR 1/2에 모두 적용하며 destroy 시 모든 GPU 객체 생존 수 0을 기존 gate와 함께 확인한다.
실제 모바일/데스크톱 GPU frame time 예산은 별도 검증 대상이다.
WebGPU 공간 인스턴싱은 아래 C6 geometry·GLB gate에서 별도로 검증한다.


### 분리형 glTF 입력 회귀

`pnpm smoke:spatial-scene`의 `spatial-gltf-browser-fixture.mjs`는 packed public `loadSpatialGltf`로 바위·나무·건물의
외부 binary/PNG를 읽고 GLB와 bounds/count·같은 framebuffer 픽셀 차이 0을 확인한다. 기존 normal/emissive·MASK·
point/sun shadow·DOF/fog 경로에서 3 model/11 main draw/118 triangles·준비 후 첫/warm model upload 0을 검사한다.
건물 proxy의 ramp 상승 floor 1/elevation 32, x=42 벽 차단, 상층 picking 및 fresh v7 복원의 픽셀 차이 0을 확인한다.
실제 누락 binary·읽는 중 abort·변경된 dependency contentId 불일치는 기존 handle/hash/GPU 자원을 보존해야 한다.
원래 목록 밖 accessor가 추가 image view를 가리키는 입력도 거절하고 기존 씬을 보존한다.
실제 gzip 응답의 압축 길이가 decoded binary보다 큰 조건에서도 원래 contentId를 유지하며,
다른 origin의 CORS 응답에서 Content-Encoding이 숨겨져도 같은 검증을 통과해야 한다.
1280×720 / 390×844 × DPR 1/2와 기존 destroy 전체 GPU 객체 0 gate에 연결한다.
자체 작성 GLB를 분리한 fixture는 `node tests/smoke/generate-spatial-gltf-fixtures.mjs`로 결정적으로 재생성한다.
실제 Blender 출력물 검증을 대신하지 않는다.

같은 probe는 `SpatialModelAssetCache`로 3개 glTF를 각각 두 소비자에게 제공해 같은 handle·6 lease,
원래 10개 HTTP 자원의 요청 1회씩과 decoded byte 단일 청구를 검사한다. pinned entry 용량 거절,
공유 로드의 한 소비자 취소/다른 소비자 완료, pending destroy 취소와 기존 handle/hash/GPU 보존도 검사한다.
기존 GPU 준비·렌더·physics·fresh 저장 복원 뒤 engine 등록과 lease를 해제하고 unused entry/CPU bytes 0을 확인한다.
unit은 LRU·entry/byte/pending 상한·실패 admission 원자성·내용 검증·재시도·마지막 소비자 취소와
늦은 완료/같은 key 재요청·cached hit 취소·destroy 후 기존 lease 수명까지 검사한다.

web unit은 다중 buffer 재배치·원래 범위/참조 침범·URI/형식 상한, 중복 요청 재사용, binary/image hash 변경,
불일치 길이·없는 파일, 잘못된 Content-Length·압축/CORS 헤더 처리·decoded stream 상한·전체 전송 한도·
reader cancel 실패·AbortSignal cleanup과 MIME 판별을 검사한다.
외부 glTF의 raw document hash와 정규화 bundle identity를 혼동하지 않으며 streaming/LOD·PBR·실제 GPU 시간 예산은 별도다.

### 실제 모델 후속 1~6 회귀

`smoke:spatial-scene`의 packed 4 viewport/DPR matrix는 기존 재질 fixture에 unlit/발광 strength 0·4
예상 픽셀·linear-sRGB parity를 포함한다. moving/streaming fixture는 65 source primitive의 MASK
재질 병합과 실제 GPU 2 batch, root 이동·높이·yaw에 따른 child/OBB pose, fresh v8 전체 matrix 복원,
거리별 LOD 선택·warm upload 0·청크 이탈/재진입과 3회 왕복의 buffer/texture 수 유지,
visual unload 후 physics handle 유지와 모든 renderer 자원 해제를 assert한다.
GPU timer는 ready/unsupported/disjoint를 명시하며 실제 기기 성능 합격으로 해석하지 않는다.
`FERRUM_SPATIAL_ARTIFACT_PARENT`를 지정하면 smoke 출력 폴더를 기존 artifact 하위에 만들 수 있다.

native 회귀는 OBB 빈 bounds 모서리 통과/회전 벽 sweep/접촉 escape/층·높이 필터,
청크/LOD hysteresis·camera 밖 shadow caster, 잘못된 graph와 restore 원자성, render 생략을 포함한
legacy/auto physics·fixed/unfixed 4조합의 root 적분 rollback을 확인한다. navigation은 segment 후보를
한 번 준비하고 nested substep에는 지역 후보만 재사용하며 global scan 비용도 요청/frame 예산에 포함한다.
실제 game-test cell32 상층 도착과 58 GLB 호환성은 격리 복사본에서 확인하고 별도 증거로 남긴다.

### 밀집 프레임 지연 회귀

`smoke:gpu-resources`는 작은 frameTrace budget으로 진단 window를 의도적으로 만들고 상한과 실제
renderer ID를 검사한다. 지원 GPU는 지연된 query가 capture의 발행 frame에 들어가야 하며,
unsupported는 measured 0을 유지한다. 이는 시간 예산 합격 판정이 아닌 연결성 검사다.
profiler와 별도로 수집한 현재 CPU/resource와 완료 query의 frameId/elapsedMs를 capture row와 비교한다.
기본 CI는 timer 미지원도 허용한다. 실제 query 완료가 필수인 별도 검증은
`node tests/smoke/gpu-resources-browser-smoke.mjs --require-gpu-timing`으로 실행한다.
단위 검사는 raw interval·CPU/지연 GPU 트리거·이전/이후 frame·독립 snapshot·rolling sample 퇴거·
window/history 상한·reset·누락/중복/늦은 GPU 결과를 검증한다.

`smoke:spatial-scene`의 model instancing fixture는 point 6면+sun 첫 frame에도 instance matrix
upload 1회와 면별 독립 offset, warm shadow cache에서 main 128B만 업로드를 실제 GL 호출로 검사한다.
모델 색상/cutoff uniform 경로는 generic attribute 조회 0회와 비기본 caller 값 보존을 검사한다.
main/point/sun의 MASK·normal·emissive 픽셀 parity와 terrain/billboard attribute 경로를 유지한다.
가림·재질/그림자·fresh restore 픽셀 비교와 GPU 객체 종료 검사는 유지한다. scene의 고정 matrix buffer가
64→512KiB로 바뀌었으므로 bytes 비교는 동일 구현·동일 상태끼리 수행한다.


## HD-2D native combat gate

`pnpm smoke:hd2d-combat`는 CI validate job과 `smoke:check`에서 실행한다. CI는 성공/실패 시 report와 원시 case JSON을
`hd2d-combat` artifact로 업로드한다. packed public `/core`·`/authoring`만
사용해 배경 GLB rock 216개 + 적 0/32/128개를 1280×720/390×844, DPR 1/2에서 검증한다.
개체 수 외에 native AI steps·반복 projectile spawn·실제 hits/kills/particles, 동적 spatial billboard,
pause freeze·전투 checkpoint JSON roundtrip 상태 일치·reset 정리를 assert한다.
`report.inputCases`에는 같은 네 viewport/DPR의 실제 InputManager 마우스/키보드 pressed 입력을 기록한다.
직교/원근 × pixelArt 유무, body/visual 높이 조준, 다른 층 제외, logical zoom과 resize,
누른 채 유지 시 중복 방지, 세 번 명중 후 사망, 벽 차단, pause 동안 입력 폐기를 assert한다.
픽셀 여백이 있는 조건에서는 여백 클릭의 발사 거절도 확인한다. 입력 fixture도 Playing 상태·실제 draw와
동적 billboard 증가, Rust/render max 250/1000ms·GPU buffer capacity 2MiB 상한을 확인한다.
`report.checkpointCases`는 같은 viewport/DPR 4조건에서 비행 중 탄환을 저장하고 새 handle로 복원한 뒤 실제 피해를 확인한다.
유효 hash를 가진 잘못된 health payload는 activation 전에 거절하며 기존 handle/전투 상태를 보존해야 한다.
`report.prefabCases`는 같은 4조건에서 전용 12×8/0.75 world scale sprite의 실제 quad·반전 UV·RGBA·cutoff를 확인한다.
비행 중 v2 checkpoint 후 이름 기반 asset slot을 2→3으로 바꿔 복원하고, 새 slot 렌더·fresh handle·실제 피해가 이어져야 한다.
스냅샷은 runtime texture slot을 저장하지 않는다. `prefab-*.png`도 CI evidence에 업로드한다.
모델 draw가 양수이고 자체 rock 8 triangles × 216개를 실제 제출하며 측정 구간 안의 원거리 명중·파티클 누적 값이 증가해야 한다.
CPU Rust update max 250ms/render max 1000ms는 CI의 무제한 작업 회귀를 잡는 상한이며 목표 FPS가 아니다.
기능 gate는 최소 2초 예열 + 2.5초 측정이다. 낮은 software FPS에서는 native simulation 2.5초까지 예열을 늘린다.
GPU object 수는 예열 기준값을 유지하고 buffer capacity는 2MiB 이하로 제한한다. 원시 숫자 sample과 GPU 발행 renderer frame ID는
`artifacts/hd2d-static-model/combat/run-*/report.json` 및 case JSON에 보존한다.
GPU는 완료 query만 측정 frame ID와 연결하고 미측정 값을 0으로 채우지 않는다.

`pnpm benchmark:hd2d-combat`는 1465×800/DPR 1에서 각 부하를 20초 예열 + 60초 측정 × 3회 실행한다.
`FERRUM_BROWSER_EXECUTABLE`, `FERRUM_BROWSER_CHANNEL`, `FERRUM_COMBAT_HEADED=1`로 브라우저를 지정하고
`FERRUM_COMBAT_WARMUP_MS`/`FERRUM_COMBAT_DURATION_MS`로 측정 시간을 조절할 수 있다.
실제 기기 결과는 renderer 정보·해상도·DPR·Wasm SHA와 함께 보고한다. software renderer의 FPS는 실제 GPU
성능 보증으로 사용하지 않는다. 게임 전용 에셋/AI/장기 생존·deterministic 전투 replay는 이 gate 밖이다.


### HD-2D 다층 전투 AI 회귀

`pnpm smoke:hd2d-combat`의 `navigationCases` 4조건(viewport 1280×720/390×844 × DPR 1/2)은
packed public core/authoring과 실제 Wasm으로 8개 Chase source의 ramp→bridge 이동, 같은 XY 아래층 복귀,
이동 중 checkpoint 저장/새 generation 복원/재탐색, pause, billboard 9개와 실제 draw·billboard 발 위치와 body elevation 일치를 검증한다.
매 frame 검색≤1/work≤1,000,000, Rust update<250ms를 assert하며 CI의 기존 combat gate에서 실행한다.
이 수치는 기능/작업 상한 검증이며 실게임 FPS 또는 GPU 성능 보증이 아니다.

개별 실행은 최종 build 후 `FERRUM_COMBAT_ARTIFACT_PARENT=artifacts/hd2d-static-model/combat-navigation node tests/smoke/hd2d-combat-browser-smoke.mjs --navigation-only`다.
Rust 회귀는 trigger/solid source, 양방향 wall mask, 층/연결 변경·길 없음 정지, target generation,
64-agent 공정성·fixed substep 공통 예산·120Hz 렌더/60Hz 시뮬레이션에서 슬롯 편향 방지·외부 teleport 비용과 설정 원자성을 확인한다.
기존 player spatial navigation과 탐험 저장/입력 gate도 함께 회귀 확인한다.


### HD-2D 군중 회피 회귀

기존 `smoke:hd2d-combat`/CI 전투 gate의 `crowdCases`4조건은 stopDistance8/16의8개 적이
실제 다리/경사를 오르내리며 같은 floor·height에서 padding 포함 AABB 간격을 유지하는지 검사한다.
각 종착에서 native stoppedAgents=8도 요구한다.
checkpoint JSON 왕복·fresh generation·pause·실제 billboard 발 높이 일치와
frameSearches≤1, frameWorkUnits≤1M, frameNeighborTests≤125K를 함께 assert한다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --crowd-only`로 해당4조건을 실행할 수 있다.
전체 gate는 기존 전투12+입력20+checkpoint4+prefab4+navigation4+crowd4+scheduler4+movement4=56조건이다.
native 회귀는 중첩 spawn 탈출·다른 층/높이/mask·정면 교행·벽/경사·얇은 물체 sweep·
최대64개 fixed substep 예산·서로 다른 정지 반경의 공유 gateway 도착을 검사한다.
생성 순서 역전/가변 render delta의 fixed120Hz 왕복, 막힌 목표 중심의 도착 원, sparse peer corner의
좁은 틈, 실제 shared edge를 벗어나는 raised-terrain 코너와 sub-ULP 중첩 이동 credit도 검사한다.
큰 좌표의 실제 반경 안 도착·저속 credit 보존, 유효한 shared-edge upper 소유권과
분할 trial/commit의 touching 간격(gap≥4)을 엄격히 검사한다.


### HD-2D 대량 AI 탐색 회귀

기존 CI `smoke:hd2d-combat`에 `schedulerCases`4 viewport/DPR 조건을 포함한다. 각 조건에서
실제 우회 maze의 여러 slice 완료·pending checkpoint/fresh 복원·가상 pose 미누출과
64개 적의 동일 목표 route 재사용60회 이상·실제 전원 도착·billboard/draw를 검사한다.
정적 frameSearchWork≤262144, 전체 frameWork≤1M, peakSearchWork≤8M과 Rust update<250ms를 함께 assert한다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --scheduler-only`로 해당 조건만 실행한다.
기존 navigation gate의 searches+cacheHits가 층 변경 후 요청 수를 수용하는지도 검사한다.
native 회귀는 긴 경로 완료, source/target/terrain 취소, 취소 owner의 기아 방지, 짧은 frame의 job 소유권,
pause와 구형 설정 reset,64-agent 공정성 및 footprint 차이의 cache 거절을 포함한다.
실제 browser 실패 배치에서 다리 입구의 정지한7개 peer를 우회할 때 support 경계 점·인접 ramp 점을
사용해8개 모두 정지 반경에 도착하는지, padding 간격과 node/frame 예산을 유지하는지 검사한다.
큰 collider offset의 half-open 경계 투영도 실제 center 재구성으로 검증한다.
기존262K 초과/600K 이하 query 준비 요청의 admission 호환성도 native 회귀로 검사한다.


### HD-2D SeekTarget·Accelerate 공간 이동 회귀

기존 `smoke:hd2d-combat`/CI gate의 `movementCases`는 4 viewport/DPR 조건마다
SeekTarget 4개·Accelerate 상행 4개·하행 4개를 별도 장면으로 실행한다.
실제 경사/bridge gateway와 SeekTarget의 같은 XY 다른 floor 우회·정지 반경 도착,
선택 peer padding·매 frame billboard 발 높이와 native elevation 일치를 검사한다.
경사 위 이동 중 v9 JSON checkpoint를 저장해 fresh generation으로 위치/높이와 velocity를
정확히 복원하고 cache 초기화·pause 동안 momentum 보존·resume 후 실제 도착을 요구한다.
frameSearches≤1, 전체 frameWork≤1M, native Rust update<250ms도 함께 assert한다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --movement-only`는 해당4조건만 실행한다.
`--input-only`는 기존 입력/checkpoint/prefab/navigation/crowd/scheduler/movement에 action을 더한48조건이다.
CI 시간 상한은 실기기 FPS 보증이 아니다.

native 회귀는 turnRate0/.15/.25/1, 정확히0을 거치는 반전·벽 앞 회전 누적·한 step의
도착 원 관통 clipping, Accelerate의 양방향 ramp/bridge·휴지 peer·64개 fixed substep 예산과
예산 보류 시 velocity 보존·새 primary 기준 설정 원자성을 검사한다.

### HD-2D melee·dash 액션 검증

기존 `smoke:hd2d-combat`/CI gate의 `actionCases`는 4 viewport/DPR 조건마다 직교/원근 × melee/dash를 실행한다.
실제 Wasm의 입력 melee 피해·다른 층/벽 차단, 키보드 dash의 ramp/bridge와 billboard 발 높이,
타이머 피해/층 이동, JSON/fresh handle 복원과 cooldown·체력·높이 보존, 잘못된 cooldown 저장의 사전 거절,
pause 동안 상태 고정과 입력 폐기를 검사한다. 단순 액션 카운터만으로 통과시키지 않는다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --actions-only`는 이 4조건만 실행한다.

native spawnPrefab 구현 단계의 회귀는
`cargo test --manifest-path crates/ferrum-core/Cargo.toml spawn_prefabs`로 실행한다.
실제 생성 개체의 이동·타이머 탄환·원본 제거·세대 재사용, floor/support/wall 거절, 독립 animation,
그림자 예산·Chase 정지 거리/maxAgents, sparse prefab ID, native codec3 fresh restore/잘못된 상태의 원자적 거절을 검사한다.
이 native 회귀와 별도로 아래 공개 semantic codec/packed browser spawn gate를 함께 실행한다.
기본 gate에도 포함되며 CI는 `actions-*.png`와 전체 report를 업로드한다. Rust update250ms는 CI 상한이며 게임 성능 보장이 아니다.

### HD-2D actor spawn 공개 회귀

`smoke:hd2d-combat`/CI gate의 `spawnCases`는 4 viewport/DPR마다 직교/원근을 검사한다.
원본 seed 제거 후 실제 키보드·timer 생성, native Chase 이동과 상층 floor/elevation,
atlas billboard 발 높이·그림자 제출, 제거된 생성 발사자의 탄환 source serial을 검사한다.
전체 v9 JSON/fresh handle 복원·잘못된 체력 상태의 사전 거절·pause 고정과 입력 폐기·재적용 정리를 요구한다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --spawn-only`로 해당4조건만 실행한다.
전체 gate는 기존60조건에 spawn4조건을 더한다. CI가 `spawn-*.png`와 전체 report를 업로드한다.
복원 unit은 단일 프레임 legacy animation·최종 interaction upsert·raw pose/model yaw의 일치도 검사한다.
Rust update250ms는 기능 회귀 CI 상한이며 실기기 GPU 시간이나 소비자 전투 성능 보장이 아니다.


### HD-2D 탄환 animation·방향 회전

`smoke:hd2d-combat`의 `visualCases`는 4 viewport/DPR에서 flat·직교/원근·각 pixelArt 모드 5개를 검사한다.
실제 timer 발사·탄환별 독립 clock·동적 UV와 framebuffer atlas 색, 제출 quad의 투영 방향을 assert한다.
비행 중 JSON v4를 새 handle/texture slot으로 복원한 후 framebuffer byte 차이0, pause freeze와 resume,
잘못된 clock/playback presence/UV의 기존 scene 보존 및 재적용 cleanup을 검사한다.
구형 Wasm 사전 거절은 public authoring/save 단위 회귀로 검증한다.
`node tests/smoke/hd2d-combat-browser-smoke.mjs --visuals-only`는 해당4조건만 실행한다.
CI 기본 gate가 함께 실행하며 `visuals-*.png`와 report.visualCases를 evidence로 업로드한다.
Rust update250ms/render1000ms는 CI 작업량 상한이며 실기기 성능 보증은 아니다.


### 공간 WebGPU geometry·GLB 모델·환경 효과와 fallback

`pnpm smoke:spatial-webgpu`는 실제 canvas WebGPU와 WebGL2를 packed public API로 비교한다.
가로1280×720/세로390×844·DPR1/2와 직교/원근에서 공유 depth, bridge 위/아래, alpha 구멍,
picking·terrain upload0·fresh handle 복원 byte 차이0·제출 순서 역전을 assert한다.
모델은 나무·바위·건물+동일 나무 2개로 4 instance/11 draw/132 triangles/instanced draw2를 검사하고,
기본색·MASK·발광·mapped vertex stride·warm upload0·fresh restore/row reverse 픽셀을 확인한다.
backend 간 채널3 허용·상이 pixel1% 미만과 cutout/raised actor의 필수 위치 픽셀을 함께 요구한다.
GPU 오류·fallback으로 교체된 필수 WebGPU·adapter 미지원은 실패하며 skip하지 않는다.

`pnpm smoke:spatial-webgpu-offscreen`은 같은 전체 조건을 실제 GPU의 별도 texture target으로 실행하며
Linux CI validate와 smoke:check에 연결한다. test-only target adapter는 shader/queue/depth/texture/readback을
대체하지 않으며 report.presentation은 offscreen이다. native canvas presentation 성공으로 해석하지 않는다.
기본 명령의 report.presentation은 canvas이며 Windows 실제 GPU에서 별도 검증한다.
`pnpm smoke:spatial-webgpu-fallback`은 선택 검사만 좁게 실행한다. bloom과 `linear-srgb` 요청을 context 전에 WebGL2로 연결하고 실제 bloom pass와 색 관리 모드가 유지되는지 검사한다.
지원 point/sun 그림자 요구사항과 runtime 초기 문서는 WebGPU를 유지하는지도 별도 검사한다.
잘못된 packet·typed-view 이동·resource budget과 GPU async upload 실패/rollback/pin/destroy는 웹 단위 회귀로 보강한다.
환경 fixture는 ambient/4 point/sun·billboard/model normal·unlit·fog·grade·표준/고품질 DOF·actor focus·pixelArt·debug·복합 효과의
기존 환경/조명 38개와 텍스처 변환 18개를 합한 56개를 같은 가로/세로·DPR·투영 조합에서 비교한다. HUD magenta 불변, normal의 실제 빛 반응,
DOF 13/25 sample 예산과 변화 픽셀, 160×90 HDR 저장량, warm terrain/model upload0, fresh restore 전체 byte 차이0을 assert한다.
WebGPU warm draw 구간의 실제 createTexture/createBuffer/createBindGroup 호출을 별도로 관측해 모두0인지 검사한다. readback용 buffer 생성은 draw 구간 밖이다.
비교에는 채널3/상이 pixel1% 미만, 전용 DOF 상태에는 0.1% 미만을 적용한다. DOF 기준은 sample Y 방향 역전을 검출한다.
캡처는 PNG로 보존하고 raw framebuffer의 수명은 제한한다.
텍스처 변환 fixture는 실제 Blender 출력(`tests/fixtures/spatial-texture-transform`)의 base/normal/emissive별
이동·회전·음수 배율을 사용한다. 원본 Blender Mapping 값(Y-up)으로 UV를 정점에 bake하고 glTF UV(Y-down)로 바꾼 reference와 비교한다.
확장 JSON/엔진 행렬을 기대값에 재사용하지 않아 회전 부호가 양 backend에서 함께 틀린 경우도 검출한다.
각 map의 identity 대비 변화도 요구하므로 변환을 무시하거나 normal/emissive sampling을 생략하면 실패한다.
point/sun MASK 그림자도 같은 reference와 채널3/상이 pixel0.1% 미만으로 대조하고, 그림자 해제 대비 차이를 요구한다.
GLB와 외부 glTF는 frame byte 차이0, CPU raycast는 64개 위치에서 opaque/cutout 모두와 reference 일치를 요구한다.
지원하지 않는 UV set의 import 실패 후에도 활성 씬의 frame byte 차이0·model upload0을 검사한다.
SDK 단위 테스트는 malformed/overflow 입력과 null required-extension 목록의 decode 전 거절, UV set override, identity/0 배율,
서로 다른 UV 재질 batch 보존, clamp/repeat/mirror alpha picking을 검사한다.
`node tests/smoke/spatial-webgpu-browser-smoke.mjs --environment-only`로 환경 상태만 실행할 수 있다.
HDR resize 동기 실패·비동기 GPU allocation 오류와 오래된 오류의 resize/disable/destroy 경쟁은 단위 회귀로 검사한다.
report.json과 geometry/models/environment PNG를 CI evidence로 업로드한다. GPU 시간 예산은 측정하지 않는다.
그림자 fixture는 point/sun 단독·동시·hard/PCF, model MASK의 실제 바닥 light hole, model cast와 terrain/model/billboard receive,
벽과 다리의 높이 차폐·다리 아래 빛의 윗면 비조명, 카메라 밖 모델의 그림자, 그림자+debug와 DOF/normal/안개/색 보정 복합19상태를 비교한다.
alpha patch/atlas 교체 뒤 cache miss, native caster revision에 따른 camera 변경 재계산, GPU normal-only 갱신의 cache 보존을 검사한다.
각 상태 cold6/1/7 pass와 warm shadow draw/upload0·실제 buffer/texture/group 할당0, fresh JSON handle 복원 byte 차이0을 요구한다.
GPU/GL 간 채널3·상이 pixel1% 미만을 적용하며 `report.shadowCases`와 shadow PNG에 증거를 남긴다.
point/sun/동시 PCF는 각 backend에서 같은 hard 상태 대비 채널3을 초과하는 변화 pixel이100개보다 많아야 한다. 전체 화면 허용치 안에 묻히는 hard-only 회귀도 거절한다.
`node tests/smoke/spatial-webgpu-browser-smoke.mjs --shadows-only`로 그림자19상태만 실행할 수 있다.
단위 회귀는 native 면별 range·camera 밖 모델 mask·8-pass matrix offset과 receiver group, resize/disable/destroy·GPU async target/group 실패를 보강한다.
abandoned encoder·main 인코딩 오류·resize 뒤 bind-group 오류 때 미제출 shadow map을 cache hit으로 오인하지 않는지도 검사한다.
디버그 버퍼의 최초 할당·성장이 인코딩된 shadow caster buffer를 해제하지 않는지도 cold/warm·재계산 수명 회귀로 검사한다.

`placement-authoring-upgrades-smoke.mjs`는 같은 `smoke:placement-spatial-workspace` gate에 연결한다.
실제 Wasm과 시뮬레이션한 desktop command bridge로 Asset Browser 검색/즐겨찾기·GLB geometry 썸네일,
2D/HD-2D 반복 배치·rotation/scale, visual 참조 rename/copy/remove, 명시적 OBB proxy/높이 보존·단일 Undo,
native proxy overlay, 층별 draw/picking 제외·ghost와 entity 수/문서/이력 불변, 겹친 terrain 후보 선택,
Frame/Fit 카메라 분리, variable/gameplay 진단의 모드 전환과 실제 timer event·선택 변경 시 이전 event 분리를 검사한다. GLB의 host revision과 실제 SHA가 다른
조건에서 감지만으로 초안이 바뀌지 않고, 잘못된 바이트 거절·재시도·단일 Undo/Redo·checked save가 동작해야 한다.
opt-in 3초 자동 감지 뒤 명시적 texture 업로드도 검사하며 작은 fixture의 entity/draw/model 작업 상한을 확인한다.
근거는 `artifacts/authoring-workspace-upgrades/`의 JSON/PNG다. 실제 Tauri GUI/file watcher 검증과 구분한다.
같은 gate는 동일 모델의 proxy 수정·Undo/Redo 후 입력값 일치, 잠금 갱신 중 미적용 입력 보존,
잘못된 치수/층/비정상 입력의 Apply 거절과 독립적인 Remove·높이 보존·Undo 복원을 검사한다.
`placement-panel-navigation-smoke.mjs`는 기본 workspace gate에서 native details가 먼저 열리고
ARIA가 늦게 반영되는 실제 브라우저 fixture를 검사한다. 탐색 helper는 native open을 기준으로 클릭하고
open과 ARIA의 완료를 함께 기다려 두 번 클릭해 닫는 경합을 검출한다.
Aseprite Assets gate는 객체 배치뿐 아니라 pointerup transaction 종료·정확한 Undo 증가까지 기다린 뒤
기존 frame/patch/이력 assertion을 수행한다. 실패 조건이나 이력 증가 기준을 완화하지 않는다.
단위 테스트는 spatial envelope 생략 보호, 동일 metadata의 명시적 copy origin, 예약 ID 재사용/자동 복제명,
마지막 optional 모델 제거와 metadata 보존을 검증한다. native tests는 preview filter의 stale 입력 원자 거절·
physics/terrain 보존과 진단 packet의 FSM 부재·health/cooldown·반복 읽기·stale handle을 검증한다.

공간 debug renderer의 RGBA 선은 alpha 0/0.25/1의 실제 framebuffer 혼합과 비기본 blend factor/equation 복원을 검사한다.
이 회귀는 기존 packed `smoke:spatial-scene`의 `spatial-debug-browser-fixture.mjs`에 포함한다.


### 조명 작성·렌더링 v4 회귀

Bloom 강도 0은 효과를 생략한 장면과 배경 픽셀이 같아야 한다. 객체/지형을 다시 선택하면 광원 도구를 해제하고, 광원 키보드 조작은 좌표·반경 한계에서 멈춰야 한다. 연결된 자식 객체는 상위 attachment의 위치·높이·yaw를 반영한 anchor로 광원을 표시하고 연결 변경 시 월드 위치를 보존한다.

- `pnpm smoke:spatial-webgpu-offscreen`의 environment matrix는 56개 상태를 두 projection, 두 viewport, DPR 1/2, 두 backend로 검사한다.
  스포트라이트 방향 반전, HDR Bloom, 접촉 음영의 실제 pixel 변화와 HUD 불변, 16개 중 활성 2개 선택,
  warm GPU 할당/업로드 0, 새 engine 저장 복원, destroy를 검사한다. pixel parity 허용치를 효과 추가 때문에 늘리지 않는다.
- `pnpm smoke:placement-spatial-workspace`의 lighting 회귀는 분위기 4개, 품질, cone 작성,
  객체 연결/해제, 광원 드래그와 Undo/Redo, 높이/반경 Esc 취소 및 키보드 조절을 검사한다.
  focused save와 재열기에서는 v4 효과/연결/반구광/normalBias를 함께 보존한다.
- 빠른 조명 UI 재현은 `node tests/smoke/placement-village-smoke.mjs --lighting-only`를 사용한다.
  저장 bridge는 테스트용 public host stub이며 renderer, authoring, native validation과 재열기는 실제 경로다.
- native/SDK 계약 테스트는 v1..v4 수용, malformed 입력의 원자적 거절, 광원 budget/추적, 원본 capture,
  scene-wide patch merge/Undo, 기존 shadow work limit을 검사한다.
