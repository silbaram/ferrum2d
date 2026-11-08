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

`pnpm smoke:topdown`은 Neon Outpost production 화면에서 시작 버튼, P/Esc·버튼 일시정지/계속,
정지 중 native 시간·위치·점수·웨이브 불변, native snapshot 기반 HUD, 조명/후처리 draw 통계 전환,
정지/게임 종료 후 재시작, 390px 가상 조이스틱 이동·취소와 렌더 규모/16 draw 이하를 검증한다.
이 검증은 기존 `smoke:topdown`과 기본 CI의 `smoke:feature-examples`에 연결되며 테스트 구현은 `tests/smoke/topdown-showcase-smoke.mjs`다.
에셋 생성의 재현성은 `python3 scripts/assets/build-topdown-outpost.py --check`로 확인한다.

`tests/smoke/guided-examples-smoke.mjs`는 기존 gate에서 다음 예제 사용성을 확인한다.

- `smoke:feature-examples`: Breakout/Platformer의 native 시간·위치 정지, P/Esc, 정지 중 초기화, 게임 종료 후 재도전(Breakout), 터치 이동·입력 취소·점프, 800×480 viewport와 8 draw 이하.
- `smoke:physics-demo-suite`, `smoke:physics-sandbox`: 기본 시나리오의 Shooter actor 제외, camera/viewport, native body 정지, 클릭당 solver 한 번, desktop/mobile 레터박스 포인터 좌표와 선택.
- `smoke:starter-runtime`: Reset·버튼/Space 재시작 전후 선택한 native primary action 설정 유지.

Physics Lab의 `visibleBodyCount`는 기존 이름을 유지한 body 상태 조회 수이며 화면 culling 측정치가 아니다. UI에서는 `조회 물체`로 표시한다.

## 일반 2D sprite normal 검증

`pnpm smoke:sprite-normal-2d`는 빌드된 SDK/Wasm으로 WebGL2와 native WebGPU offscreen 경로를 DPR1/2에서 검사한다.
실제 Wasm finite animation의2개 UV·Playing/완료·sidecar ID와 독립 정적 UV 픽셀 일치를 확인한다.
좌우/상하 반전·회전·opaque/반투명 전경·조명 OFF·camera pan/zoom/groundYScale의 실제 픽셀과 draw 비용을 assert한다.
GL scissor/color mask 복원, point 높이·sun 고도, invalid data texture/flags 거절, target 해제·destroy 자원0도 검사한다.
종료 시 삭제 예정인 current program 바인딩도 해제해 동일 canvas의 다음 renderer가 삭제된 프로그램을 복원하지 않도록 검사한다.
WebGPU 장치를2회 재생성해 pixels/할당 plateau를 확인하고, linear-sRGB 요청의 WebGL2 fallback에서도 normal 조명을 검사한다.
검증은 Chromium software adapter이며 native GUI나 실물 GPU 성능을 주장하지 않는다.
CI validate job에서 직접 실행하며 결과는 `artifacts/pixel-normal-2d/runtime/verification.json`에 저장한다.

`smoke:pixel-authoring`과 `smoke:pixel-project`는2D/HD-2D 모두에서 실제 Worker 생성·paired 적용·source stale/cancel·export를 검사한다.
후자는 Rust 파일 host에 source/color→normal→scene을 저장한 뒤 재시작·원본 재열기·Worker 없는 검증된 pair 복원과 fresh game 조명까지 확인한다.
SDK/Rust 단위 검사는 optional ABI·bulk 원자성·정렬/수명·prototype·기존unlit 호환·patch/handoff를 담당한다.
SDK는 normal instance 65,537개를 활성화·spawn 전에 거절하는지도 검사한다.
`test:native-normal-project`는 숫자 normal alias의 프로젝트 범위 보호와 잘못된 JSON의 참조 수집 경계를 검사한다.

`smoke:pixel-animation-export`와 전체 `smoke:pixel-authoring`은 실제 다운로드를 Chromium `ImageDecoder`로 다시 열어 GIF/APNG 전체/왕복 태그 프레임별 픽셀·alpha·시간·반복을 검증한다. GIF 색 축소 opt-in·취소/오래된 callback·source/Undo/dirty 보존과 한글390px도 검사한다. 단위 검사는 APNG CRC/sequence/원본 RGBA 및 GIF 구조·최소시간·AbortSignal과 잘못된 설정을 확인한다.

`smoke:pixel-transform`은 실제2D/HD2D의 자유 변형 미리보기·단일 Undo·원본에서 재계산·PNG 결과·미확정 이동 보존·잘못된 값/늦은 콜백·한글390px을 검사한다. 단위 검사는 cardinal 회전의 독립 기대값, alpha 보간, mask/atlas clip과 문맥 무효화를 포함한다.

`smoke:pixel-indexed`는 실제 모드 전환·index 원본·전역 색상·순서 변경/삭제 제한·Undo·RGBA 전환과 노멀 Worker·태그 runtime을 검사한다. native `--pixel-indexed-only`는 실제 저장/재열기·paired normals·fresh runtime을 검사하고 `smoke:pixel-project` CI 경로에 포함한다. 단위 검사는 256색 초과 rollback, v1~v9 호환, 최대64프레임/8레이어 이력과 복구도 포함한다.

`test:pixel-authoring`는 선택 영역의 raw RGBA·겹치는 이동·비정사각형90도 회전·frame/layer 클립보드와
preview/cancel/Undo·stale target·atlas 경계·잘못된 입력의 원자성을 검사한다.
`smoke:pixel-authoring`의 `pixelSelection`은 DPR1의2D와 DPR2의HD-2D에서 실제 marquee/drag/keyboard/menu,
저장·적용 차단, Enter 확정·Escape/blur 취소·한 번의 Undo, pan/zoom 좌표와 한글390px 캡처를 검사한다.
취소 버튼·메뉴 summary/회전 항목의 Enter, 드래그 중 Enter/Ctrl-X 차단, pointercancel/lost capture의 원본 보존도 검사한다.
단위는 v1~v5의 편집·Undo 원본/metadata 보존과 revision을 바꾸지 않는 frame/layer/atlas 전환의 오래된 target 폐기를 확인한다.
전체 atlas UI 검사는 x offset이 있는 활성 frame의 선택 이동·잘림·인접 frame RGBA 보존과 Undo를 확인한다.
선택만 단독 진단하려면 save 허용 앱 build 후 `node tests/smoke/aseprite-assets-smoke.mjs --pixels --pixel-selection-only`를 사용한다.
노멀 smoke는 floating 선택의 적용 차단과 확정 후 stale/Undo/cache 복원도 검사한다. 전체 UI gate가 CI validate에서 실행되므로 별도 중복 gate를 추가하지 않는다.

`smoke:pixel-authoring`의 `pixelBlend`와 `pnpm smoke:pixel-blend`는 보통 no-op·v9 전환·곱하기/스크린 PNG의 고정 기대값·합성/불투명도 동시 적용 한 Undo·순수 미리보기·취소/프레임 전환 후 늦은 적용·잠금·병합·한글390px을 확인한다. `test:pixel-authoring`의 독립 rational 기준 벡터는 투명/반투명/opacity0/최대 채널의 색/alpha와 normal의 기존 결과를 대조하고, native 단위도 같은 고정 벡터로 실제 저장/재열기 및 잘못된 PNG 거절을 검사한다.
`pnpm smoke:pixel-blend-project`는 실제 Rust host에서 태그 있는 역방향 v9와 태그 없는 정방향 v9를 저장하고 새 Rust/browser 세션에서 원본 전체와 실제 게임 Playing·프레임 UV·색·시간·draw/texture 예산을 확인한다. `smoke:pixel-project` aggregate와 CI가 이 경로를 호출한다. clipboard와 IndexedDB 복구 fixture도 v9 모드를 포함한다.

`smoke:pixel-authoring`의 `pixelOpacity`는2D/HD-2D에서 숫자·슬라이더 미리보기의 원본 무변경, Apply/Cancel/Escape, 레거시 no-op·v8 승격·한 Undo/Redo·새 레이어 추가 뒤 불투명도 역편집의 dirty 복원·0/100% 오해 없는 소수 표시, 잠금/재생 차단·씬으로 돌아가기/닫힌 창의 늦은 적용 및 숨긴 버튼 재열기 거절, PNG/병합 결과와 한글390px을 검사한다. 집중 실행은 `pnpm smoke:pixel-opacity`다.
`pixel-authoring.test.mjs`는 모든 프레임/태그/방향·원본 RGBA 보존, opacity0/255·반투명 정수 합성, 잘못된 버전/값 거절, PNG·애니메이션·그리기 미리보기의 일치와 병합 중복 적용 방지를 검사한다.
`smoke:pixel-project`는 전체 기존 프로젝트 검사 후 opacity와 blend 집중 native 검사를 추가로 실행한다. `pnpm smoke:pixel-opacity-project`로 단독 실행할 수 있다. 실제 Rust host 저장·독립 PNG 검증·태그 유무 두 원본의 sidecar 일치·새 Rust/browser 세션 재열기와 두 방향 frame의 실제 Wasm Playing/UV/색·draw 예산을 확인한다. GUI 배포 앱이나 실물 GPU 검증은 포함하지 않는다.

도트 편의성 회귀도 같은 `test:pixel-authoring`/`smoke:pixel-authoring` CI 경로에서 실행한다.
`pixelDrawing`은 브러시·대칭·도형/Shift·선택 마스크·취소·한 Undo를, `pixelPalette`는 metadata와 픽셀 교체의 분리·잠금/숨김 보호·늦은 가져오기 거절을 검사한다.
`pixelCanvasPreview`는 모든 cel의 여백/자르기·치수 Undo/Redo·고정 atlas 차단·실제 크기1×/2×·DPR1/2·프레임/태그 연동·blur/접기/탭 전환 자원 해제를 검사한다.
자르기 전 제거 영역 표시와 팔레트/치수 변경의 노멀 stale 차단·Undo 후 검증 cache 재사용도 확인한다. native 프로젝트 검사는 크기/팔레트를 바꾼 원본의 저장·재열기와 게임 로딩을 포함한다.
각 helper는 한글390px 캡처와 씬 변경 없음도 확인한다. 크기 연산 단위는 기준점9개·홀수 offset·raw RGBA·예산 초과의 원자성을 검사한다.
집중 진단은 save 허용 앱 build 후 위 Node 진입점에 `--pixel-drawing-only`, `--pixel-palette-only`, `--pixel-canvas-preview-only`를 지정한다.
집중 실행은 전체 검증을 대체하지 않는다. 결과는 같은 `artifacts/pixel-authoring/verification.json`을 사용한다.

도트 후속 도구의 `pixelNext`는 같은 전체 UI gate에서 픽셀 퍼펙트의 원래 RGBA 복원·마스크 선택과 조합·자유형/다각형·외곽선 미리보기/확정,
이미지 브러시 등록/간격/중심점/hover/취소/한 Undo, 반복9타일의 실제 canvas 픽셀과 경계 그리기/채우기·단일 PNG·고정 atlas 차단을 검사한다.
캔버스 밖 이탈·재진입이 픽셀 퍼펙트의 가짜L을 만들지 않는지 실제 드래그와4방향/offset atlas/반복 바깥 경계 단위 회귀로 확인한다. 선택 soft mask는 보정 후 최종 적용하는 계약을 별도 검사한다.
2D DPR1/HD-2D DPR2·한글390px·씬 무변경·종료 시 URL/texture0도 확인한다. 집중 진단은 위 Node 진입점의 `--pixel-next-only`다.
순수 연산 회귀는 `pixel-perfect`, `pixel-mask`, `pixel-outline`, `pixel-image-brush`, `pixel-repeat`, `pixel-batch` 단위 검사를 `test:pixel-authoring`에 연결한다.
`pixel-batch`는 프레임 범위 모델의 대상/제외·metadata/raw RGBA 보존·잘못된 입력의 원자성·잘림·한 Undo/Redo를 검사한다.
전체 gate의 `pixelNext.frameBatch`는 실제 sparse 이동/좌우·상하 반전·읽기 전용 프레임별 미리보기·잠금/숨김 제외·재생/대상 전환 폐기·잘림·no-op의 Redo 보존을 확인한다.
인라인 패널 크기로 실제 렌더된 캔버스의 픽셀을 클릭해, 패널 접기에 따른 좌표 이동이나 잘못된 원본 쓰기가 없는지도 확인한다.
확정 원본을 IndexedDB에서 다른 탭으로 복원하고 정확한 raw RGBA/metadata를 내보내 비교한다. 탭 종료·destroy의 범위 목록/브러시 해제와64자 ID/한글390px도 검사한다.
집중 진단은 `--pixel-batch-only`다. 다각형의 Backspace/더블클릭과 반복 보기의 pan/zoom 좌표는 `pixelNext`의 실제 입력으로 검사한다.
공통 노멀 검사는 범위 반전·외곽선 결과를 원본에 유지한 뒤 Worker 입력·원본 내보내기·게임 실행을 검증한다. native 프로젝트 gate는 이 원본과 pair를 저장하고 재시작 후 정확히 재열어 실행한다.
추가 외곽선/범위 편집의 stale 차단·Undo 후 원본 cache 재사용도 같은 공통 함수에서 검사한다.

같은 `test:pixel-authoring`는 `pixel-recovery.test.mjs`도 실행해 v1~v9 checkpoint, 원본/이력 무변경,
용량/기간/개수 상한·project/scene 격리·늦은 list 무시·write 뒤 delete 순서·quota/접근 거부·종료 수명을 검사한다.
종료 직후 host가 에디터를 해제해도 최신 확정본을 저장하고, 이전 write가 지연 중이면 그 뒤에 최신본을 남기는지 검사한다.
활성 stroke·선택 미리보기는 종료 캡처에서도 제외하며 중복 destroy는 저장 작업을 추가하지 않는다.
전체 `smoke:pixel-authoring`의 `pixelRecovery`는 실제 IndexedDB에서 확정 전 저장 차단과 reload 복원,
raw RGBA/태그/레이어 보존·미저장 상태·씬/Undo 불변·다중 탭의 독립 항목을 확인한다.
실제 transaction abort를 주입해 이전 완료본 보존·수동 내보내기·재시도·도트 닫기/원본 내보내기의 해당 항목 정리를 검사하며,
손상 원본 복원 거절·저장소 접근 거부·메뉴 클릭·한글390px 캡처도 포함한다.
600ms debounce 전 확정 직후 같은 task에서 실제 도구의 `pagehide` 정리를 실행하고, 다른 탭의 IndexedDB 조회로 정확한 v9 원본 저장을 확인한다.
명시적으로 도트 문서를 닫으면 팔레트 원본 참조와 팔레트/최근 색 목록을 비우며, 잠시 씬으로 돌아가는 동작은 편집 상태를 유지한다.
단독 진단은 앱 build 후 `node tests/smoke/aseprite-assets-smoke.mjs --pixels --pixel-recovery-only`다.
IndexedDB 검증은 같은 origin의 브라우저/WebView 저장소 기준이며 실제 설치 앱·OS별 storage 정책이나 전원 종료 직전 완료되지 않은 write를 증명하지 않는다.
native pixel 프로젝트의 공통 노멀 저장 검증은 실제 Rust 저장 뒤 잘못된 응답을 주입한다. 앱의 저장 검증 실패 후 복구 원본이 남고,
재시도 성공 후 해당 세션 항목이 정리되는지 확인한 뒤 저장된 pair를 새 게임에 로딩한다. 단독 normal-project 진단도 같은 검증 함수를 실행한다.

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
기본 CI에서도 다음을 확인한다.

- 2D DPR 1·HD-2D DPR 2의 JSON+PNG 검사와 frame Preview, 등록 후 실제 frame 배치·Apply Frame
- frame 이름을 유지한 크기/위치 변경 재import의 실제 native PNG 픽셀과 pose/size/pivot/collider/body 보존
- 한 건 Undo/Redo와 revision handoff 복원, 제거·모호한 frame 및 animation/normal migration 진단
- 잘못된 JSON/PNG 크기·파일명·회전·잘못된 trim offset·범위·중복·byte 한도 거절과 기존 씬 보존
- 실제 GPU 업로드 뒤 실패 rollback, 취소 직후 같은 revision 재시도, URL/GL texture 해제
- 문서별 catalog 분리·8 revision 한도·닫기 후 재개, compact Source/Preview 방향키/Home/End
- scene-only Save 차단, 원본 JSON/PNG byte hash와 sRGB manifest가 담긴 Export Assets,
  bundle과 동반 patch를 별도 새 페이지에 로딩한 native 복원
- BFCache pagehide/pageshow 후 재개와 최종 pagehide 이후 Blob URL/실제 GL texture 잔여 0

근거는 `artifacts/aseprite-assets/verification.json`, `checks.json`과 run별 PNG/bundle/resume JSON이다.
기존 기본 fixture는 비회전·비트림 atlas이며 trim 복원은 아래 전용 gate로 검증한다. JSON 1 MiB/PNG 16 MiB·한 변 4,096·4 MP·256 frame,
세션 8 revision/원본 64 MiB 한도를 사용한다. resource 개수 검사는 JS heap·실제 기기 성능 검증을 대체하지 않는다.
이 명령은 generated create-game viewer와 프로젝트 filesystem 설치를 검사하지 않는다. 프로젝트 저장은 아래 별도 smoke로 검증한다.
명령이 남긴 테스트용 save-enabled app은
`pnpm --filter @ferrum2d/placement-viewer build` 또는 `pnpm build`로 기본 설정에 복원한다.
공식 작업공간 smoke의 입력·크기·focus 대상은 `canvas.demo-canvas`로 지정해 Assets의 frame preview canvas와 구분한다.
workspace 전환의 native readback은 최대 16 RAF 안에 CSS/DPR와 drawing buffer 크기가 일치하고
세 프레임 연속 크기가 안정될 때만 읽는다. 실패 전후 PNG의 완전 동일성 조건은 유지한다.

### Trim 프레임 복원과 원본 보존

`pnpm test:aseprite-trim`은 offset/원본 canvas·혼합 프레임·UTF-8 ID 배치와 source 순서, alpha-zero RGB·투명 여백, Adam7, 원본 기반 identity·기존 untrim의 두 파일 호환을 검사한다.
프로젝트 재열기는 별도 PNG encoding을 보존하고, 원본 sidecar 변조·pixels 불일치·복원 치수 초과를 거절해야 한다.
`pnpm smoke:aseprite-trim`은 save-enabled app과 기존 Aseprite harness의 `--trim` 분기로 2D DPR1·HD-2D DPR2를 검증한다.
실제 재가져오기·단일 Undo/Redo·pose/size/origin/collider/body·clip ID를 보존하고 export PNG의 전체 RGBA/여백과 원본 JSON/packed PNG hash를 독립 대조한다.
새 게임은 Playing·실제 native UV·visible frame·draw/texture switch 예산을 함께 검사한다. native는 실제 Rust writer/protocol·재시작·원본 PNG 변조 거절을 확인한다.
desktop 단위 검사는 sourcePng의 지원 필드 정규화·불변 재시도, PNG trailing bytes/non-sRGB 거절, 원본 PNG의 정리/백업/복원을 포함한다.
증거는 `artifacts/aseprite-trim/{browser,native}/verification.json`과 run별 PNG/JSON에 남긴다. CI와 aggregate smoke에 연결한다.
선택 노멀 생성기 설치 후 `pnpm smoke:aseprite-trim-normals`로 실제 Worker 입력의 복원 frame RGBA·여백과 normal 적용/Undo를 검증한다. 이 추가 gate는 `artifacts/aseprite-trim/normals/`에 기록하며 기본 trim CI는 선택 생성기를 요구하지 않는다.

`pnpm test:aseprite-slices`는 명시적 원본 key frame, bounds-local pivot/center, metadata 상한/오류, 정적/animated origin patch, 같은 packed rect를 공유하는 frame, 선택/잠금/UV 검사와 다른 속성 보존을 검사한다.
`pnpm smoke:aseprite-slices`는 2D·HD-2D에서 실제 Preview 선택·명시적 origin 적용·단일 Undo/Redo·일반 재가져오기 origin 보존·KO/EN 전환을 검증한다.
slice 패널 toggle과 선택 변경·기준점 적용, 원본 파일/이름 입력·가져오기 버튼 이벤트를 queue한 뒤 같은 task에서 작업공간을 종료해, 뒤늦은 이벤트에도 일반/Promise 예외가 없고 URL/GL 자원이 정리되는지 확인한다. `persisted` 페이지 전환에서는 편집 상태와 이벤트를 유지해 복귀 후에도 기준점 적용·Undo/Redo가 동작해야 한다.
native 분기는 실제 Rust 저장/protocol·재시작·원본 slice JSON/scene origin 보존·trim 재검사와 새 게임의 Playing/UV/visible frames/draw 예산을 확인한다. 종료 시 Blob URL/GL 자원0도 검사한다.
보고서는 `artifacts/aseprite-slices/browser/verification.json`과 `artifacts/aseprite-slices/native/verification.json`에 기록한다. 기본 CI에 연결하며 선택 normal 생성기는 필요하지 않다. 실제 native GUI IPC·실물 GPU 검증은 포함하지 않는다.
기존16 MiB·4096·4MP·256frame·8revision/64 MiB 예산을 원본/복원에 각각 적용하며 합계에는 두 PNG를 모두 포함한다. native GUI IPC·실물 GPU/모바일 성능은 이 검증 대상이 아니다.

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
`showPlacementBottom`은 뷰포트 클릭 뒤에도 패널을 유지하도록 실제 핀 버튼으로 고정하고, 도구는 `showPlacementAssetPanel`로 Import/Manage 메뉴를 거쳐 연다.
`placement-asset-drawer-smoke.mjs`는 서랍이 canvas 크기를 바꾸지 않는지, 탭 재클릭·바깥 클릭·Esc·Ctrl+Space 동작,
도구 뷰 왕복, 실제 마우스 드래그로 뷰포트에 놓는 흐름, 고정 시 레이아웃 복귀를 확인한다.
펼친 서랍의 도구 뷰에서 에셋 목록 전체가 숨겨지고 짧은 도구가 탭 줄을 넘지 않는지, 드롭 뒤 상단 `변경 N` 버튼이
My Changes를 열어 추가된 오브젝트 한 행을 이름과 함께 보여 주고 Undo 뒤 숨는지도 검사한다.
`placement-change-labels.test.mjs`는 인스턴스 id 짝짓기(중간 삭제가 한 건), index 비교 fallback, 오브젝트·항목 이름 해석을 검사한다.
`pnpm test:placement-commands`는 한영·키워드·NFKC 검색, 안정적 결과 순서, 검색 중 실행 금지와 현재 모드의 기존 버튼 위임을 검사한다.
`placement-key-hints.test.mjs`는 2D/HD-2D·선택·잠금별 단축키 안내, 한국어 문구 누락, Ctrl+K/⌘K 판정을 검사한다.
이 단위 검사는 `smoke:placement-viewer`와 CI의 뷰어 단위 검사에 연결된다. 같은 toolbar gate의 `placement-command-palette-smoke.mjs`는
실제 2D/HD-2D 세로 도구 클릭·위/아래 focus, Ctrl+K 열기와 상태 바 안내·이동 도구 전환 시 숨김, F3 검색·실행·취소·focus 복귀, 동적 비활성 재검사와 IME Enter/Escape를 확인한다.
320~1125px에서는 실제 hit-test로 선택/이동 버튼이 입력을 받는지, 선택 팝업이 도구 모음과 겹치거나 canvas 오른쪽을 넘지 않는지 검사한다.
두 번째 문서를 열고 속성 명령을 실행해 현재 문서의 탭만 바뀌며, 숨겨 둔 이전 문서의 컨트롤은 바꾸지 않는지 검사한다.
세로 도구 모음에는 선택/이동만 두고 게임 카메라는 상단에서 접근한다. 공간 데이터가 없는 문서의 게임 카메라 명령은 비활성인지 확인한다.
드래그·다른 modal·도트 미확정 편집의 F3 차단, 도트/게임 전환의 도구 숨김, 한영/390px와 씬 원본·선택·이력 보존을 함께 검사한다.
화면과 결과는 `artifacts/workspace-command-search/`에 남긴다.
`pnpm test:placement-layouts`는 legacy 내 구성 보존·잘못된 저장값 검증·구성 간 독립성·named profile round-trip을 검사하며 뷰어 단위 CI와 공식 viewer smoke에 연결된다.
`pnpm smoke:placement-layouts`는 같은 `placement-layout-presets-smoke.mjs`를 2D DPR 1/HD-2D DPR 2에서 실행한다.
이 helper는 기존 두 모드의 toolbar gate에도 연결되며 별도 browser context에서 실행해 caller 문서/저장 설정을 바꾸지 않는다.
기존 내 구성 복귀·구성별 수정/현재 구성만 초기화·focus/drawer/하단 탭 복귀·reload·storage 거부,
문서 전환 및 도트 pending 취소 후 F3 availability 회복, dirty 씬·실행 중 게임·실제 도트 stroke/Undo 보존을 확인한다.
실제 줌으로 구성한 수동 편집 시점도 비교하며, 한영·320/390px 메뉴 경계·128px 이상 canvas와 실제 native entity 3개 이상·draw 1~32회를 함께 검사한다.
근거는 `artifacts/workspace-layout-presets/`에 남긴다.
`pnpm test:placement-asset-usage`는 닫힌 씬의 prefab/variant/include/instance·model/LOD 참조, JSON pointer escaping,
원본/draft 구분·읽기 실패·미해소 숫자/template·참조/노드/씬/재읽기 byte 한도와 stale 결과 중단을 검사한다.
또한 잘못된 참조 container/컴포넌트의 진단, 복제 전 열린 snapshot 제한, 공백 포함 원문 byte와 남은 읽기 예산,
읽기 전용 inspect 부재 시 open fallback 차단, 스트림 정리 실패 후 원래 오류/reader lock 보존을 검사한다.
지연된 catalog/scene host가 취소 이후 응답하지 않아도 호출자를 해제하는지 확인한다.
압축 응답의 encoded Content-Length/decoded 본문 구분, 선언된 owner와 게임 `props.id` 구분,
빈 dictionary key의 JSON pointer·긴 식별자 한도도 검사한다.
이 단위 명령은 빌드된 public SDK를 사용하므로 최초에는 `pnpm build`로 준비한다. 공식 viewer smoke는 Wasm/SDK 빌드 뒤 이 명령을 실행하며 CI 단위 gate도 전체 빌드 이후에 실행한다.
CI 단위 gate와 공식 `smoke:placement-viewer`에 연결한다. `pnpm smoke:placement-asset-usage`와 양쪽 toolbar gate는
별도 브라우저 context에서 동일한 사용처 helper를 실행한다. 실제 조회/검색/JSON 다운로드와 source/patch/Undo/선택/모드/탭 불변,
편집본 근거, 부분 실패, 한영·compact, 읽기 중 문서 교체, 선택 폴더 snapshot을 확인한다.
문서 교체 시 목록/본문 fetch signal의 실제 abort, Open JSON 완료 후 재조회,
독립적인 native 재조회 뒤 이전 explorer entry의 저장 문맥 보존과 저장 완료 후 재조회도 검사한다.
2D DPR 1·HD-2D DPR 2에서 native frame entity ≥3·drawCalls 1..32·pageerror 0을 요구한다.
native 브라우저 검증은 IPC emulation임을 보고서에 명시하고 inspect command만 사용하며 scene open/save를 호출하지 않는지 검사한다.
`cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features`는 실제 native 파일 조회·경로/symlink·2 MiB·저장 allowlist 불변을 검사한다.
설치형 GUI 검증은 별도이며 결과는 `artifacts/project-asset-usage/`에 남긴다.

`pnpm test:placement-inspector`는 선택 없음·게임·잠금·2D 그룹·spatial target 안내와 한영/단위 표시를 검사하며 CI/공식 viewer 단위 gate에 연결된다.
같은 명령의 `placement-inspector-originals.test.mjs`는 표시 정밀도와 실제 원본 정밀도의 구분, 다중 선택의 개별 원본/단일 Undo,
modern/legacy component의 정상·노멀·애니메이션·그림자·바디 보존, optional leaf 제거, 잠금/새 객체, rename와 저장 기준 재설정을 검사한다.
공간 baseline은 authored 원본으로 optional 존재를 판단하며 모델 rename·지형/빌보드의 미지원 optional 복귀도 검사한다.
같은 명령의 `placement-component-edits.test.mjs`는 일반 속성 편집의 노멀·animationSet·projection·그림자·dynamic body·확장 metadata 보존,
legacy sprite 변환·색상 변경·shape 변경·원본 불변과 단일 Undo를 검사한다. 실제 Inspector browser도 이 metadata를 가진 객체의 크기를 변경한다.
`node tests/smoke/placement-tool-ui-runner.mjs --spatial-fields`는 모델 가져오기 후 지형/빌보드/모델 선택과 문서 왕복에서
공유 필드의 표시·단일 filter/reset 소유권·원본 불변을 검사한다. 공식 공간 aggregate도 새 문서에서 모델 회전 입력을 실행한다.
`pnpm smoke:placement-inspector`와 두 모드의 toolbar gate는 같은 `placement-inspector-smoke.mjs`를 별도 context에서 실행한다.
2D DPR1/HD-2D DPR2의 입력 우선 순서·읽기 전용 details 토글, 실제 rad/도/좌표/시각 입력과 atomic Undo,
잠금·다중 선택·terrain/empty/game 안내, 프리팹 원본 보존, 240px sticky header/tablist와 320px 화면·한영을 검사한다.
Rust frame entity 6/3개와 draw 1~32회 조건을 유지하며 `artifacts/inspector-properties/`에 근거를 남긴다.
속성 검색·변경/고급 필터는 source/patch/이력을 보존하고 필드 복귀는 단일 Undo로 되돌린다. 다른 staged component 값이 필터/필드 복귀로 사라지면 실패한다.
`pnpm smoke:placement-tools`와 두 모드 toolbar gate의 `placement-tool-ui-smoke.mjs`는 실제 More Actions 메뉴와
에셋 검사→명시적 배치·사용처 이동, 목록/키보드·compact 복귀, 노멀 기본/고급·오류/정밀도/초점 복귀를 검사한다.
잘못된 가져오기 원본의 읽기 쉬운 복구 안내와 접힌 raw 진단, 입력 수정 후 stale 진단 제거도 검사하며 `artifacts/editor-ux-modernization/`에 근거를 남긴다.
기존 pixel/normal/import 통합 runner도 실제 action overflow·에셋 상세 경로로 동작해야 한다. helper module을 단독 import한 종료값은 동작 검증으로 세지 않는다.
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
JSON 재개방과 canvas offset·DPR 2 SVG overlay를 확인한다. 하단 Problems/Runtime/My Changes 탭을
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
도트 쇼케이스(`examples/pixel-art`)도 shared shell을 사용하며 같은 report의 누락·중복 검사 대상이다.

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

Consumer agents 지침 변경은 `pnpm package:check:agents`에서 공통 `.agents/harness/ferrum-game-presentation.md`와 기능 탐색용 `.agents/harness/ferrum-feature-guide.md`의 참조·tarball 포함 여부, 설치 결과의 원본 일치, 설치 전용 파일/루트 디렉터리 allowlist를 확인한다. 기능 안내서는 root 지침과 development/presentation harness에서 연결하며 tarball consumer 설치에서도 내용과 참조를 검사한다. 재설치와 기존 프로젝트 dry-run에서는 사용자 지침·게임 소스·데이터·package 설정을 보존하고, 구형 지침을 건너뛸 때 비교·병합 안내가 나오는지도 검사한다. `package:consumer-smoke`는 tarball로 설치된 공유 기준과 도구별 참조도 검사한다. 게임의 화면 품질은 이 자동 검증과 별도로 공통 기준에 따라 실제 브라우저에서 첫 화면·가독성·이동/카메라·조사/수집·HUD 입력·resize를 검수하고 스크린샷/조작 순서와 미검수 항목을 기록한다. 설치-only 검증 과정에 게임 생성이나 서버 실행을 추가하지 않는다. [consumer 화면 제작 기준](https://github.com/silbaram/ferrum2d/blob/main/packages/agents/templates/shared/.agents/harness/ferrum-game-presentation.md)을 따른다.

Consumer browser smoke는 설치된 Chrome을 우선 사용하고, 없으면 전체 Chromium의 `channel: "chromium"` headless 모드를 사용한다. 별도 headless shell로 자동 전환하지 않는다. 로컬 브라우저가 없으면 `pnpm exec playwright-core install chromium`으로 전체 Chromium을 설치한다(`--only-shell` 제외). `FERRUM_BROWSER_CHANNEL` 또는 `FERRUM_BROWSER_EXECUTABLE`로 지정할 수도 있다. 두 headless 구현의 차이는 [Playwright 브라우저 문서](https://playwright.dev/docs/browsers#chromium-new-headless-mode)에 설명되어 있다.

GitHub Releases 설치 경로는 `pnpm test:github-release`로 자동 release 선택, 네 template의 동일 버전 URL, fork, 잘못된 옵션, 기존 프로젝트/.npmrc 보존, 출력된 디렉터리 이동 명령의 특수문자 처리, 실패 보고서 갱신과 명령 시간 초과 시 하위 프로세스 종료를 검사한다. `pnpm release:github:prepare -- --version 0.1.0-beta.0`으로 준비한 묶음에 `pnpm smoke:github-release-install -- --bundle-dir <묶음 경로>`를 실행하면 실제 npx URL tarball 실행, HTTP redirect, npm install/ci, lock integrity, 명시적 agent 설치, check/build와 preview/Wasm MIME을 검증한다. localhost mirror 검증이며 실제 GitHub 다운로드 성공을 뜻하지 않는다. 전체 template browser/placement viewer 회귀는 기존 `package:consumer-smoke`와 report validator를 사용한다. 계약 테스트는 CI validate에 연결되며 수동 `github-release-prepare.yml`은 묶음 준비부터 HTTP 설치와 전체 consumer matrix까지 실행한다. [배포 절차](../operations/github-release.md)를 참고한다.

release 후보를 배포하지 않고 로컬에서 리허설할 때는 `pnpm release:local-check`를 사용한다. 이 명령은 `pnpm release:candidate-check`, `pnpm package:check`, `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke-release-local`, `pnpm validate:consumer-smoke-report -- --expect-status passed`를 순서대로 실행해 같은 후보 세트의 metadata, tarball, generated consumer project smoke를 묶어서 확인한다.

## CI와 로컬 검증 차이

기본 GitHub Actions CI(`.github/workflows/ci.yml`)는 `workflow_dispatch`로 수동 실행한다. 별도 `Language boundaries` workflow는 PR/main push에서 자동 실행한다. 기본 CI는 `ferrum-web-v*` tag ref에서도 GitHub 배포용 candidate guard와 `private: true` package 검사를 사용하며 consumer smoke와 extended browser matrix를 실행한다. branch에서 해당 matrix가 필요하면 각각 `consumer_smoke`, `extended_browser_smoke` input을 켠다. npm publish 전용 검사는 별도 npm 배포 절차에 남긴다.

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

### Gameplay authoring 모듈 경계 회귀

`pnpm test:web`의 `gameplayAuthoring.test.ts`는 공개 command 적용 경로에서 7종 action의 이름 조회·명시 ID 우선순위·누락/잘못된 ID 진단과 prefab/timer 구분, 선택적 timer action을 검사한다. 검증 실패는 runtime setter를 호출하지 않아야 한다. 기존 registry 회귀는 handle 복사·generation·역방향 조회·stale 제거·sync를 검증한다. 모듈 분리 뒤에도 공개 import와 declaration은 `pnpm package:check:ferrum-web`의 packed consumer 타입 검증으로 확인한다.

ID 회귀에는 특수 이름의 JSON 왕복·required 선언 검사·상속 속성 차단과 u32 상한/상한 초과를 포함한다. 엔티티 핸들 검증 실패는 기존 registry와 runtime을 바꾸지 않아야 한다. 패키지 타입 검사는 실제 `.tgz`를 임시 consumer에 추출하고 registry factory → 공개 타입 → apply 옵션 연결을 ES2022/strict/`skipLibCheck: false`로 컴파일한다.
직접 command의 점수·효과음 uint32 경계, 타일 충돌 코드 0/2와 이름 일치, 알 수 없는 이벤트·비교 연산자의 거부도 검사한다. `gameplayFactionRelations.test.ts`는 고정 진영·관계 코드표의 상속 속성을 거부하고 정상 이름·숫자 코드와 unsigned 상위 비트 mask를 보존하는지 확인한다.

### 에셋 묶음 로딩 수명 회귀

`pnpm test:web`의 `textureManager.test.ts`는 WebGL2/WebGPU 업로드 byte와 오류 문구 일치, pre-abort, 늦은 decode 중 취소·evict·destroy, 성공·실패 시 abort listener 해제, 이전 요청의 finally가 같은 ID의 새 요청을 제거하지 않는지를 검증한다. GPU mock 단위 검증과 아래 실제 브라우저 검증을 구분한다.

같은 ID의 abort 재진입·동기 교체·eviction은 최신 요청을 보존해야 한다. 성공 등록은 자기 signal을 abort하지 않고, 종료·취소로 등록하지 못한 texture를 회수한다. HTTP body 취소 실패는 원래 HTTP 오류를 덮어쓰지 않으며, 외부 size 변경은 patch bounds와 byte 통계를 바꾸지 않아야 한다. `webgpuRendererCreation.test.ts`는 own/inherited 옵션 변경 뒤 loss→recover가 원래 Blob·decode 설정을 사용하고 별도 signal로 ready 상태에 복귀하는지 검증한다.

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
읽는 중 취소는 실제 응답의 첫 body chunk를 소비할 때 발생시킨다. 타이머로 취소하면
이미 버퍼된 응답의 완료와 경쟁하므로 취소 경로를 검증한 근거로 사용하지 않는다.
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
벽과 다리의 높이 차폐·다리 아래 빛의 윗면 비조명, 카메라 밖 모델의 그림자, 그림자+debug와 DOF/normal/안개/색 보정,
태양 고도 기준축 경계·낮은 caster 접촉·유한 범위 경계와 점광원 접촉의 기존 116상태에
아래 수신면 진단 118상태를 더한 234상태를 비교한다.
alpha patch/atlas 교체 뒤 cache miss, native caster revision에 따른 camera 변경 재계산, GPU normal-only 갱신의 cache 보존을 검사한다.
각 상태 cold6/1/7 pass와 warm shadow draw/upload0·WebGPU의 실제 buffer/texture/group 할당0, fresh JSON handle 복원 byte 차이0을 요구한다.
GPU/GL 간 채널3·상이 pixel1% 미만을 적용하며 `report.shadowCases`와 shadow PNG에 증거를 남긴다.
point/sun/동시 PCF는 각 backend에서 같은 hard 상태 대비 채널3을 초과하는 변화 pixel이100개보다 많아야 한다. 전체 화면 허용치 안에 묻히는 hard-only 회귀도 거절한다.
태양 기준축 회귀는 normalized native Y 0.9899/0.9901에서 shadow off/hard/PCF3 6상태를 추가한다.
같은 world 수신점의 R 채널 값이 shadow off보다 40을 초과해 낮고, 두 고도 사이의 값 차이는 3 이하여야 한다.
사각 맵 경계 근처의 작은 다리를 사용하므로 전체 이미지 허용 오차에 가려지는 그림자 소멸도 거절한다.
증거는 각 backend의 `sunStability`와 해당 상태의 PNG이며 기존 직교/원근·가로/세로·DPR 1/2 matrix에 포함된다.
접촉 회귀는 고도 30° 태양과 높이 2 world unit의 작은 다리를 사용한다. shadow off 1상태와
해상도 256/512/1024 × hard/PCF3 6상태에서 고정 바닥 수신점의 R 값이 off보다 30을 초과해 낮아야 한다.
열린 바닥의 R 값 차이는 3 이하로 제한해 bias 축소로 생기는 평면 자기 그림자도 거절한다.
`contactShadows`에 해상도·필터·lit/receiver/open 값을 기록한다. 기존 backend 픽셀 parity와 cold/warm 예산도 함께 적용한다.
점광원 접촉은 높이 2 plate·낮은 광원 1개·X/Z cube 면 경계 4개·거의 평행한 광원 1개를 사용한다.
각각 OFF 1상태와 128/256/512/1024 × hard/PCF3 8상태, 합계 54상태다. 그림자는 off보다 R 값이
30을 초과해 낮아야 한다.
거의 평행한 광원은 plate 아래에 있어 바닥을 가릴 수 없으므로 off와 수신점 차이를 3 이하로 제한한다.
각 상태의 떨어진 바닥 9점도 off와 RGB 차이 3 이하여야 하며, 검은 baseline으로 거짓 통과하지 않도록
수신점의 off R 값은 10 이상이어야 한다. `pointContacts`에 광원 위치·해상도·필터·native bias/normalBias/radius와
lit/receiver/open 값을 기록한다. fresh JSON handle 복원 후 전체 frame byte 차이0·model upload0을 검사한다.
기본/full/offscreen gate에 포함하며 `--offscreen-target --point-contact-only`로 이 54상태만 실행할 수 있다.
범위 경계는 수직 태양·128 map/extent 32의 같은 수신점에서 camera X를 이동하거나 depth distance를 바꾼다.
XY/depth 각각 shadow off와 hard/PCF3 × 내부 여유 3/2/1.5/1/0.5/0/-1 world unit을 검사한다.
중간 구간은 fully shadowed/fully lit 사이여야 하며 범위 밖은 off와 채널 차이 3 이하, pan 순서의 밝기는 역전하지 않아야 한다.
`shadowEdges`에 축·필터·여유·수신점 값을 기록한다. 내부 접촉/기준축/다른 광원 검증도 유지한다.
수신면 진단은 다음을 검사한다.

- 태양 5°/1°/0.1°/0.03° × OFF 및 128/256/512/1024 hard/PCF의 36상태다.
  열린 바닥 9점의 RGB 차이는 OFF 대비 3 이하다. 5°/1°의 낮은 caster 그림자는 R 대비 20 초과의 차이를 요구한다.
  caster가 light texel을 실제로 덮도록 1° fixture는 폭을 늘린다. 표본이 없는 얇은 caster의 그림자를 기대값으로 삼지 않는다.
- 자체 제작 thin/slope/curve GLB는 CPU 삼각형 raycast로 독립 높이 oracle을 확인한다.
  sun/point, 128/256, hard/PCF, normalBias 0/0.35를 검사하며 곡면 point에는 2와 512/1024 품질 조합도 추가한다.
  총 62상태이며 얇은 면·경사면·sun 곡면과 해소된 point 조합은 OFF 대비 RGB 차이 3 이하다.
  낮은 해상도의 곡면 PCF는 `approximationLimited`와 실제 오차를 기록하는 진단 행이다.
  이 행의 자기 그림자를 무오차로 인정하지 않는다. 128/PCF/0에서 오차 10 초과를 요구해 진단 입력이 무효가 되는 것도 거절한다.
  512/normalBias 0.35, 1024/0 및 0.35는 차이 3 이하를 강제한다.
- 같은 곡면의 1024 PCF/normalBias 0.35에서 작은 caster OFF/ON 2상태를 더해 접촉 대비 20 초과를 요구한다.
- 기존 나무의 geometry/UV/MASK/sampler를 유지한 diffuse 대조군과 원본 바위 GLB는 CPU triangle/alpha raycast로 보이는 바닥의 가림/열림을 분류한다.
  나무의 normal 강도와 emission만 기존 scale0 variant로 끈다. 그림자 형상과 alpha 입력은 바꾸지 않는다.
  radius 2048, 128/256 hard/PCF, normalBias 0/0.35의 18상태에서 차폐 대비 10 초과·열린 바닥 차이 3 이하를 요구한다.
  광원이 바닥 모서리에 정렬된 장면도 유지해 clipped caster의 radial depth 저장 회귀를 검출한다.

위 118상태는 두 backend·투영·viewport·DPR 조합에서 1,888상태가 된다. `sunGrazing`, `receiverModels`,
`curvedContact`, `realAssetShadows`와 PNG를 보존한다. 기존 RGB 채널3/상이 pixel1% 미만 조건을 그대로 적용하고,
parity 실패 시에도 두 실패 PNG와 위치·상태 정보를 report에 남긴다.
`--offscreen-target --receiver-shadows-only`로 전체 진단, `--offscreen-target --game-asset-shadows-only`로
실제 에셋 18상태만 실행한다. full/offscreen CI 경로에 포함한다. fixture당 callback 상한은
512이며 full의 cold/warm 234×2 + 추가 read 8 = 476회다. 각 callback의 Rust 시간·draw 예산은 그대로다.
configure의 cold에서는 기존에 사용하지 않던 픽셀 readback만 생략한다. cold 비용·warm cache와 모든 상태의 warm 픽셀은 계속 검사한다.
`node tests/smoke/spatial-webgpu-browser-smoke.mjs --offscreen-target --shadows-only`로 그림자234상태와 아래 proxy·flat 검사를 실행할 수 있다.

flat fixture는 GL legacy·GPU legacy·GL linear-srgb 각각에서 물리/가상 해상도 × 노멀맵 OFF/ON으로
red/blue 두 빛·주변광·태양광 보존, warm 재사용, 단일/중복 차폐체, 빨강 투과, alpha 0, 광원 없음,
조명 비활성을 검사한다. 태양 지면 caster는 box/alpha, 겹침, alpha 구멍, 불투명/반투명 upright 수신 제외,
태양 0·약한 태양·OFF·caster 없음·standalone native 호환을 같은 네 조합에서 18상태씩 추가 검사한다.
각 GL 113/GPU 114상태(기존 장면 40 + 태양 72 + resize + GPU 복구)를 가로/세로·DPR 1/2에
걸쳐 합계 1,360상태 검사한다. opaque 수신점에서 A 차폐 결과는 A를 제거한 장면과 채널 차이 2 이하이고,
중복 차폐·warm·alpha 0·GPU 복구의 비교는 허용 오차를 두지 않는다.
태양을 완전히 가린 픽셀도 태양 0 대조군과 채널 차이 2 이하이며 환경광·다른 광원을 보존한다.
약한 태양의 대비는 sRGB 출력에 선형 강도 상한을 직접 적용하지 않고 주광 대비와 무관한 채널 불변을 함께 검사한다.
GL/GPU의 차폐/중복/투과·전체 태양 상태 PNG는 RGB 채널3·상이 pixel1% 미만을 요구한다.
warm frame의 실제 texture/buffer/bind group 생성 0과 비활성 시 mask 타깃 해제,
물리/가상 해상도에서 점광원·태양 각각 R8 `width × height` byte의 추가 비용·destroy 후 자원 0을 검사한다.
resize·GPU 복구는 두 마스크가 동시에 활성화된 상태의 픽셀을 비교한다.
정원 회귀는 실제 native command에서 바닥·다리 ground 433개, upright 32개, 일반 지면 caster 28개와 별도 volume caster 4개를 확인한다.
source의 접지 pivot·alpha 설정뿐 아니라 바닥이 upright 마스크 제거 대상에 잘못 포함되는 회귀를 검사한다.
GL은 두 mask pass 뒤 framebuffer/viewport·scissor·color mask·blend equation 복원도 확인한다.
별도 `report.flatShadowCases`와 PNG를 보존하며 기본/full/offscreen gate에 포함한다.
`--offscreen-target --flat-shadows-only`로 독립 실행한다. software adapter의 API/픽셀 검사이며
실제 GPU 성능이나 WebGPU canvas presentation 성공을 의미하지 않는다.

같은 flat gate는 `flat-volume-shadow-browser-fixture.mjs`에서 실제 Wasm volume을 추가 검증한다.
GL legacy/GPU legacy/GL linear-sRGB의 0~360°(15° 간격 25방향)를 3D wall/roof half-space ray clipping
oracle과 비교한다. native convex hull을 JS로 재구현한 대조군을 사용하지 않는다.
edge 근처를 제외한 shadow/open 픽셀과 다른 두 색 채널의 보존, 0/360 픽셀 동일성, warm texture/buffer/group 생성 0을 검사한다.
volume-only `commandCount:0`, owner rotation/instance scale, normal·pixelPerfect·ground scale, resize,
WebGPU device 복구와 OFF·destroy 자원 해제를 포함한다. GL 57/GPU 58상태를 네 viewport/DPR 조합에서
합계 688상태 검사하고 선택 각도의 GL/GPU RGB 차이 채널3·상이 pixel1% 미만을 요구한다.
실제 정점 수·caster·draw·Rust 시간·독립 oracle 표본 수·PNG는 각 backend의 `volumes`에 보존한다.
기존 flat 1,360상태와 함께 총 2,048상태이며 full/offscreen CI gate에 연결한다.
native는 1° 간격의 고정 footprint 포함/closure, geometry cache·공통 budget·화면 밖 owner·prototype/
World snapshot·렌더 생략·reset을 검사한다. TS는 선택형 ABI·ptr/길이·finite/opacity·memory growth와
frame snapshot 깊은 복사·instance scale·custom consumer capability 거절을 검사한다.

proxy fixture는 별도 GLB volume과 body/collider 없는 model child를 billboard root에 연결한다.
표시/control·shadowOnly·cast OFF·sun/point shadow·camera orbit·부모 yaw·fresh JSON restore·이동의 10상태를
두 backend/투영/viewport·DPR 1/2에서 검사한다. main model draw0, 실제 바닥 shadow, orbit 중 같은 world
수신점의 차폐·model matrix 불변·warm cache hit/draw/upload0, 부모 물리 설정 불변과 proxy body 부재를 요구한다.
fresh restore는 frame byte 차이0, GL/GPU는 채널3/상이 pixel1% 미만이다. `report.proxyCases`와 PNG를 보존한다.
기본/offscreen 전체 gate에도 포함하며 `--offscreen-target --proxies-only`로 단독 실행한다.
native `spatial_shadow_only` 회귀는 cold flag 검증·기존 output ABI·camera/light mask와
interpolation ON/OFF의 파생 elevation·물리 body/collider/heightSpan 부재·billboard root yaw capture를 검사한다.
native cube matrix 회귀는 6면 중심 축과 비중심점의 canonical UV를 함께 검사해 shader의 광선 복원과
다른 방향으로 면이 뒤집히거나 회전하는 변경을 거절한다. clip-W의 world major-axis 거리와 reciprocal-W radial 복원의 단위도 검사한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml spatial_sun_stability`는 동일 경계와 천정/지평선의
기준축 연속성, 양 극점의 유한·직교 행렬, camera orbit 불변과 subtexel/한 texel 이동을 검사한다.
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

## 실게임 품질과 복구·맵 작성 회귀

### 실제 마을 성능과 LOD 외형

`pnpm smoke:village-game-quality`는 packed SDK와 공식 마을의 14 GLB/42 model instance, 적 32개,
실제 PNG·WAV, native AI/발사/VFX와 WASD 경사 이동·checkpoint를 실행한다.
조명·그림자·후처리 켬/끔 × 원본/Blender LOD 후보 × 2회로 원본/설정·SDK/Wasm hash, GPU adapter, 해상도/DPR,
CPU/Rust/render/audio/frame interval·지원 GPU timer, draw/triangle/upload와 Wasm/GPU 저장량을 기록한다.
전투 VFX와 공간 오디오 2개 loop는 두 조건에서 유지하고 실제 입자/음성을 검사한다. 마을 자체는 0층 경사이며 다른 층 전환은 기존 공간 탐색 회귀가 검사한다.
기존 profiler의 느린 frame window도 함께 보존한다. 정적 모델 warm upload 0, draw≤256,
Rust<250ms/render<1000ms의 작업 상한, warm 자원 증가 없음과 destroy 뒤 소유 GPU/음성 0을 검사한다.
Wasm≤128 MiB, GPU buffer≤16 MiB·추정 전체≤64 MiB도 검사한다. 상한은 FPS 보장이 아니다. GPU 표본이 없으면 count 0/값 누락으로 기록하며 0ms로 해석하지 않는다.

보고서/캡처는 `artifacts/village-game-quality/run-*/`다. `scripts/assets/build-village-lod.py`는 Blender에서
공식 tree/pine의 후보를 생성하며 `tests/fixtures/village-lod/manifest.json`에 원본/출력 hash를 남긴다.
원본 모델의 외형·피벗·팔레트·그림자를 실제 표시 크기에서 확인하고, FPS 개선이 확인되지 않은 후보를 기본 예제에 넣지 않는다.
인접 재질 병합은 source geometry를 유지하며 대표 모델의 draw 감소와 양 renderer의 픽셀 동등성을 별도로 검증한다.
단일 software GPU의 결과를 실제 PC/mobile 성능으로 일반화하지 않는다. 장기 benchmark와 타 기기 검증은 별도 실행이다.

### WebGPU 장치 손실 복구

`pnpm smoke:webgpu-recovery`는 실제 WebGPU device.destroy로 손실을 주입하고 DPR 1/2·두 viewport에서
새 장치 generation, 같은 renderer 참조, 중복 recovery Promise 공유, sprite·폐기한 URL의 texture·깊이/cutout과
정적 모델/재질을 복구한다. 다음 씬용 asset handle 16개(같은 hash의 별도 로드 포함)를 preload한 상태에서도 복구하고, 현재 픽셀과 다음 준비 자원이 모두 남아야 한다. 복구 전후 픽셀은 동일해야 한다. shader/buffer/texture는 실제 GPU를 사용한다.
CI의 offscreen target 검증이며 native canvas presentation·실물 GPU loss를 대체하지 않는다.
SDK 회귀는 생성 시 이미 손실된 device의 context 선택 차단, 재생성 검증 실패·재시도와 중간 destroy를 보강한다.
기존 pre-context WebGL2 fallback과 공간 renderer parity도 유지한다. 보고서는 기존 spatial-webgpu `run-*/report.json`의 recoveryCases다.

모델 복구 회귀는 `webgpu.gpuTiming`을 켜고 실제 timestamp 지원 장치에서 RuntimeProfiler의 GPU 표본이 생기는지 검사한다.
미지원이면 `unsupported`·표본 0이고 시간을 만들어내지 않아야 한다. 손실 시 resource count 0·timer `context-lost`,
복구 뒤 소유 buffer/texture 재생성과 이전 픽셀 보존도 확인한다. 단위 검사는 최대 4 readback·128 pass,
out-of-order 완료·결과 한 번 발행·disabled/unsupported/rejected mapping과 mip/layer·미측정 형식·destroy를 검사한다.
software adapter의 시간은 계측 연결 증거이며 실물 GPU 성능 합격 기준이 아니다.
추가 negative 회귀는 image-copy 실패를 실제 WebGPU queue에 주입해 이전 texture의 픽셀과 자원 수가 유지되는지 확인한다.
단위 검사는 image/RGBA·bind-group 실패 allocation rollback, 계측 할당/encoder 예외의 슬롯 반환과
runtime render 실패 시 WebGL2/WebGPU 부분 timing 폐기도 검사한다.

### 에디터 내장 도트 제작

`pnpm smoke:pixel-import`는 외부 PNG 가져오기 변환 단위 검사와 2D/HD-2D 실제 브라우저 검증을 실행한다.
순수 변환은 crop 좌표·픽셀 중심 최근접·분수 영역 평균·알파 가중·자동 RGB 개수 상한·팔레트 매핑·결정성·원본 불변과 최대4MP 입력을 확인한다.
브라우저에서는 큰 PNG의 자동 변환 진입·드래그/수치 crop·실제 결과 픽셀·PNG/원본 재열기·잘못된 입력/디코드 실패·취소·늦은 bitmap 해제·미저장 확인·한국어 좁은 화면을 검증한다.
좁은 화면에서 Esc가 가져오기 창만 닫고 에셋 패널은 유지하는지, 대기 중인 수치 미리보기가 자르기 드래그 중 적용 버튼을 활성화하지 않는지도 확인한다.
HD-2D에서 객체 배치 대기 중에도 첫 Esc는 가져오기 창을 닫고, 배치 대기 상태는 유지해야 한다.
입력 회귀는 실제 Chromium 클립보드 PNG와 Ctrl+V로 제작 영역·편집기·가져오기 버튼을 확인하고, 기존 내부 픽셀 붙여넣기 우선순위와 텍스트 입력을 검증한다.
파일 드롭은 실제 DOM의 DataTransfer/DragEvent로 두 영역·hover 해제·잘못된 형식/여러 파일·미확정 선택/모달 차단·취소 후 원본 불변·한국어 오류를 확인한다. OS 파일 관리자 제스처 자체를 자동화하는 검사는 아니다.
테스트에만 클립보드 권한을 부여하고 종료 시 비운다. 프로덕션은 사용자가 실행한 paste 이벤트만 소비한다. Windows/macOS 설치본의 파일 관리자 드롭·붙여넣기는 별도 수동 QA가 필요하다.
새 레이어 경로는 v1→v2·태그/방향 포함 다중 프레임의 원본/cel 보존, RGBA 소유권, 한 Undo/Redo, 잘못된 좌표/bytes·레이어/픽셀 예산·고정 atlas·stroke 차단을 단위 검사한다.
브라우저에서는 기존 프레임 위 합성 픽셀, 초기 중앙 배치·범위 오류, 미저장 문서 보존, 현재 프레임만 채우기, 원본 재열기, 제한 이유, 탭 전환 취소 및 한국어 좁은 화면을 확인한다.
변환 검사는 `test:pixel-authoring`, 브라우저 검사는 전체 `smoke:pixel-authoring`에도 포함한다. AI 서비스 호출이나 실제 생성 품질 검증은 이 gate에 포함하지 않는다.

`pnpm smoke:pixel-clipboard`는 쓰기의 동기 시작·PNG Blob bytes·capability/permission/encoding 실패·abort 전후 지연 promise 정리를 단위 검사하고 2D/HD-2D 실제 Clipboard API를 검증한다.
브라우저에서는 OS PNG read-back과 파일 PNG 비교, 복사→가져오기, dirty/한 Undo 유지, 전체 애니메이션 sheet/fixed atlas, 내부 Ctrl+C/V, 재생/미확정 선택 차단, 미지원/권한 오류·지연 OS write 중 Back/늦은 결과·한국어 좁은 메뉴를 확인한다.
실제 성공 경로만 클립보드 권한을 사용하고 실패/지연 경로는 writer를 대체해 검사한다. 마지막에 원래 API/권한을 복원한다. 설치된 OS 앱 자체의 붙여넣기 및 native WebView GUI 시험은 별도 환경에서 수행한다. 새 검사는 `test:pixel-authoring`와 전체 `smoke:pixel-authoring`에도 포함된다.

`pnpm smoke:pixel-merge`는 모델 검사와 2D/HD-2D 병합·기존 레이어 패널 browser 검사를 실행한다. 아래/visible 병합의 모든 frame PNG 일치·숨긴 locked 원본·이름/ID·태그/시간 보존·한 Undo/Redo·원본 재열기·import→merge를 확인한다.
반올림 차이가 있는 비활성 frame 때문에 전체 작업을 거절하는 경우와 visible 병합 대체 경로를 검사한다. 메뉴의 잠금/숨김/대상 수·재생/미확정 선택 차단, 메뉴 Esc, 한국어 좁은 화면, 종료 후 retained merge callback 무효화도 포함한다.
레이어 문서를 닫은 뒤 남은 제어의 click/Escape와 재열기 뒤 이전 행의 select/change를 전달해도 예외·선택 변경·새 문서 잠금 변경이 없어야 한다. 일반 편집에서 비활성 드롭 표시를 위해 작업영역의 layout을 측정하지 않는지도 확인한다.
최대 cel 예산·history 상한·투명 RGB·오류 시 Redo/revision 불변은 단위 검사한다. 병합 browser 시나리오는 전체 `smoke:pixel-authoring`에도 포함한다.

`pnpm test:pixel-authoring`은 자체 편집 원본의 검증·roundtrip, 정수 선 보간·clipping, 연결 영역 채우기,
transaction 취소·Undo/Redo 분기·64단계/16 MiB 상한, PNG의 반투명/투명 RGBA 수치 보존을 검사한다.
v1→v2 전환·독립 레이어 픽셀·정수 alpha 합성, 순서/표시/잠금/삭제와 픽셀의 통합 Undo,
선택 레이어 fill·합성 스포이트·선택만 바꿀 때 dirty 불변, 삭제/재열기 후 ID 재사용 방지도 검사한다.
8개·256×256의 1 MiB 초과 원본과 3 MiB/16 MiB 예산, v1 400,000 bytes 유지·중복 ID/잘못된 flag 거절을 확인한다.
JSON 정수의 소수/지수 표기·JS 공백 판정·UTF-16 길이와 짝 없는 surrogate 거절도 검사한다.
v3 프레임 추가/복제/삭제/순서/시간과 모든 frame의 layer/cel 연결·독립 픽셀·Undo를 검사한다.
최대64프레임(v3/v5 읽기는16)/전체8 MiB cel/12 MiB 원본과 최대 문서의16 MiB history, atlas 순서/투명 RGB/마지막 padding, snapshot·PNG 대조를 확인한다.
기존 유효 GCD→고정FPS UV tick 호환과 v6/32 tick 초과의 원본 프레임 시간 변환, frame 선택/preview cursor의 dirty 불변과 서식 있는 v3 revision의 그대로 재사용도 검사한다.
v5 태그의 고유 ID/이름/clip ID·frame 참조·단조 증가 할당·초기 태그, Undo/Redo·저장/재열기·이전 버전 거절을 확인한다.
태그 순서의 독립성과 기존 clip 보존, 정확한 전후 set에만 유효한 migration 승인·승인 취소·수동 변경 보호도 검사한다.
v4 고정 atlas의 정수 UV·비중첩·한도·버전 경계, 선택 rect 밖으로 나가지 않는 선/fill, 프레임 선택의 비변경성, 구조 변경 거절도 검사한다.
전체 시트 PNG/source roundtrip의 투명 RGB와 적용 시 UV/다른 components 보존·잘못된 대상/normal/animation 거절을 확인한다. frame 생략·빈 frame의 기본 전체 UV와 일부 UV 필드 생략을 엔진의 frame 해석과 일치시킨다. null frame과 실제 UV 불일치는 거절한다.
어니언 인접 프레임의 이전/다음·경계 비순환·자기 자신 제외·0~100% 불투명도·재생 중 숨김과 UI 설정의 비변경성을 검사한다.
현재/인접 합성 읽기가 source/history/dirty를 바꾸지 않고 읽은 bytes 수정으로 원본을 바꿀 수 없어야 한다. 다중 합성 cache도 픽셀·레이어 표시·Undo의 최신 내용을 반영해야 한다.
sprite component patch의 설정 보존·잠금/다른 애니메이션/normal 거절·검증된 도트 animation 교체와
실제 session store의 immutable revision·history 보존·미사용 정리·취소된 upload 해제를 함께 확인한다.
비동기 PNG 중 caller 원본 변경, numeric-only texture alias의 save/문서 경계 우회,
prefab/variant/include/legacy/normal export 정규화, 큰 metadata 보존·미지원 참조 진단,
미확정/확정 revision rollback과 원본 씬을 닫은 뒤 다른 씬의 참조 보존도 검사한다.

도트 팔레트 검사는 JSON/GPL/HEX 가져오기·오류 원자성·Undo/Redo·기존 픽셀 보존을 확인한다.
디더·그라데이션 검사는 정확한 두 RGBA·팔레트 단계·미리보기 취소·선택 마스크·고정 atlas 인접 프레임 보호·한 Undo와 실제 stroke 취소/Redo 보존을 확인한다.
`pixel-animation-tools-smoke.mjs`는 전체 도트 gate의 별도 세션에서 실행한다. v5→v7 방향 편집·Undo·재열기·KR/EN 메뉴와8장 어니언의 실제 canvas 변화를 확인하고,
내보낸 네 방향/반복 조합을 새 native 런타임에서 Playing·프레임 시간·UV·실제 색상 픽셀·완료 상태·draw/texture 예산으로 대조한다.
문서 닫기·destroy 뒤 남은 프레임/태그/어니언 이벤트는 예외·행 재생성·씬 변경을 일으키지 않아야 한다.
다시 연 문서의 정상 편집·Undo는 유지하고, 이전 문서에서 분리된 frame/tag 행 이벤트는 새 원본을 바꾸지 않는지 확인한다.
Rust headless 검사는 v7 source·normal 저장/재열기, 구버전 direction 필드 거절과 실패 시 catalog 불변을 검증한다. 실제 packaged GUI 검증과는 구분한다.

`pnpm smoke:pixel-authoring`은 save-enabled app에서 Aseprite 입력 없이 새 도트를 만든다.
2D DPR 1·HD-2D DPR 2에서 실제 마우스 stroke·Esc 취소·채우기·도트/씬 Undo 분리·적용,
source 다운로드/재열기·폐기/취소·한국어/영어, history 참조를 보존하는 정리를 검증한다.
release 최종 좌표·창 blur 취소/Space 복원·잘못된 알파, 늦은 File.text와 닫기 확인의 경합,
GPU upload 뒤 선택 변경 시 임시 자원 회수, numeric-only save/다른 문서 열기 거절과 이름으로 된 export를 확인한다.
native update bridge와 release 응답은 fixture로 대체해 미저장 도트의 설치/재시작 요청이 전달되지 않는지 검사한다.
레이어 추가·이름 Undo/Redo·숨김·잠금 그리기 차단·앞뒤 이동·삭제 복원을 실제 UI로 조작한다.
레이어 선택/체크박스의 키보드 포커스·이름 blur 직후 다른 레이어 클릭·조합 중 Enter·잘못된 이름 복원,
2D/HD-2D 도트 캔버스의 Space+드래그 이동과 dirty 불변도 확인한다.
이모지가 길이 경계에 있는 PNG 파일명을 잘못된 surrogate로 자르지 않아야 하며 긴 제목도 390px 작업 공간을 넘지 않아야 한다.
도트 탭을 닫으면 레이어 행/편집기 cache를 비우고 같은 다중 레이어 원본을 다시 열어 이름·선택·합성을 복원해야 한다.
2개 레이어의 원본과 합성 PNG(`[64,0,191,255]`)를 확인하고 한국어 720px·390px의 패널 내용/버튼 경계와 스크린샷을 남긴다.
390px 작업 공간에서는 이미지 레이어가 캔버스 아래로 이동해야 한다.
다중 레이어에서 내보낸 PNG/manifest/scene을 별도 runtime에서 로드해 hash와 실제 파란 픽셀 100개 초과를 요구한다.
runtime은 paused 상태(3)·entity 1개·sprite 1개 이상·draw call 1~16회·texture switch 16회 이하를 실제 frame/renderer stats로 확인한다.
manifest path를 변조한 negative fixture는 runtime 시작 전에 실패해야 한다.
미설치 session texture의 scene Save는 요청을 전송하지 않아야 하며, 종료 후 URL/GL texture 잔여는 0이어야 한다.
근거는 `artifacts/pixel-authoring/verification.json`과 run별 원본/PNG/bundle/화면이다.
프레임 UI는 v2 레이어 원본을 복제/그리기/시간/삭제/순서/Undo하며, 키보드 Undo 후 같은 도트 편집기로 focus가 유지되어야 한다.
프레임·레이어 순서 버튼이 경계에서 비활성화되거나 마지막 하나를 남기고 삭제해도 포커스는 도트 편집기에 남아야 한다.
바로 이어진 키보드 Undo/Redo가 실제 픽셀 순서·삭제를 복원하는지 확인한다.
83/124ms는32개 tick 초과를 진단하고 apply를 막는다. preview 재생/정지·blur·탭 전환·재생 중 편집 차단·dirty/원본 불변을 확인한다.
재생 중 최종 pagehide의 canvas 정리 콜백이 비운 프레임 행을 다시 만들지 않아야 한다.
어니언 검사는 움직이는 픽셀의 자체 v3 3-frame 원본을 열어 실제 canvas 픽셀로 이전 coral·다음 cyan·원본 alpha·현재 opaque 덮기를 대조한다.
이전/다음 개별 표시, 0/30/50/100% 불투명도·키보드 조작·Escape 포커스, source/PNG export bytes·dirty·Undo/Redo 불변을 확인한다.
ghost 위치에서 스포이트가 현재 투명 픽셀을 읽고 그리기는 현재 cel만 수정하는지, hidden/locked 레이어·순서/삭제/Undo와 경계 비순환을 검사한다.
DPR1/2의 zoom/pan 정렬, 재생 중 ghost 숨김·정지 복원·동일 탭 설정 유지·닫기/재열기 초기화와 한국어390px 설정 메뉴 경계를 확인한다.
재생 중에는 실제 중앙 픽셀로 대상 프레임을 식별한 같은 브라우저 콜백에서 비교 픽셀을 함께 읽는다. 별도 protocol 조회 사이에 프레임이 진행해도 검사 대상이 섞이지 않아야 한다.
검사 뒤 기존2-frame 원본을 그대로 복원해 자산 등록·native 저장/재열기·게임 재생 회귀를 계속한다. fixture가 프로젝트 자산으로 등록되지 않아야 한다.
태그 UI는 2개 프레임에서 idle/walk를 만들고 한국어390px·이름 Undo·명시적 migration 취소/승인·v5 export/reopen을 검사한다.
태그 bundle은 새 2D/HD-2D runtime에서 모든 clip으로 전환하며 Playing·native frame 수·반복/비반복 완료와 실제 UV/blue/red 픽셀·draw 비용을 검증한다.
실제 Rust 저장·프로세스/브라우저 재시작 후 v5 원본을 바이트 내용으로 대조하고 다시 게임에서 재생한다. 이 helper는 기존 pixel browser/native gate에 연결한다.
최종100/200ms 두 프레임의16×8 atlas를 내보내 새 runtime의 Playing(1)에서300ms 주기·native3 tick/실제2 source frame·화면 blue/red 전환을 대조한다.
상태/비용 검사는 초기 paused(3)와 재생 Playing(1)을 별도로 요구하며 draw call1~16·texture switch≤16·실제각색100px 초과를 유지한다.
native 프로젝트 파일 저장은 아래 별도 gate로 검증한다. 고정 atlas와 태그 회귀를 포함하며 노멀 재생성은 후속 범위다.

`pnpm smoke:pixel-project`는 실제 Rust 저장/protocol 함수를 test-only stdio transport로 호출한다.
2D DPR 1·HD-2D DPR 2에서 도트 생성/적용→원본/PNG/catalog 저장→Rust/브라우저 새 세션 재열기와 원본 동일성을 검사한다.
잘못된 저장 응답은 씬 저장을 막아야 하며 외부 catalog 변경·씬 변경의 bytes를 보존해야 한다.
파일 저장 뒤 늦은 응답을 중단해도 씬이 뒤늦게 저장되지 않고 재열기 안내가 나와야 한다.
별도 새 게임 runtime은 실제 저장된 catalog manifest·원본/PNG hash를 읽어 paused 상태 3·entity 1개·sprite 1개 이상,
draw call 1~16회·texture switch 16회 이하와 파란 픽셀 100개 초과를 요구한다. 종료 후 URL/GL texture는 0이다.
Rust host unit은 원본/PNG의 투명 RGBA 일치, identity·hash·경로 검증, stale catalog 거절, 부분 생성 실패 rollback·기존 파일 보존,
변조/링크 catalog 거절을 검사한다. UI 전용 테스트가 실제 native GUI/picker/IPC 또는 실물 GPU 검증을 대신하지 않는다.
다중 레이어 편집 원본을 저장한 뒤 Rust/브라우저를 다시 시작해 레이어 수·이름과 원본 bytes를 복원하고 합성 PNG로 새 게임을 실행한다.
v3 두 frame과100/200ms를 실제 저장·새 브라우저/호스트에서 복원하고 저장된 catalog/scene만으로 같은 Playing 시간·색상/UV와 비용을 검사한다.
Rust unit은 1 MiB 초과 8개 레이어 원본의 실제 저장/재열기, 합성과 다른 PNG·잘못된 flag·중복 ID의 저장 거절도 확인한다.
v3는3 MiB 초과 원본/전체 cel 예산·프레임 ID/시간/cel 연결·잘못된 atlas padding의 저장 거절을 추가로 확인한다.
원본/metadata의 `1.0` 정수 표기를 저장·재열기·재저장해 원본 bytes 보존과 metadata 정규화를 대조한다.
서식 있는 원본과 독립 인코더의 필터·분할 IDAT·Adam7 PNG를 실제 Rust에 저장하고 UI에서 재열기/재저장해 원본 bytes를 대조한다.
bundle 생성/PNG 검증 중 caller 데이터 변경, sRGB와 충돌하는 프로필, PNG IEND 누락·CRC 오류·끝 쓰레기 bytes의 저장 거절도 검사한다.
공통 `smokePixelFrameCard`는 자체 제작한 두 번째 애니메이션 프레임 카드로 열어 선택 ID와 실제 빨간 cel 픽셀·원본 보존·빈 Undo를 확인한다. browser와 native 재시작 뒤의 카드 진입을 모두 검사한다. 도구 버튼 전환 중 base64 인코딩 호출이0인지 확인해 적용 미리보기가 전체 cel을 직렬화하지 않는지도 검사한다.
공통 `pixel-atlas-smoke.mjs`는 외부 PNG+프레임 정보를 기존 importer로 등록하고 프레임 카드에서 v4 편집 원본을 열어 프레임 선택·캡처된 바깥 endpoint·Undo/Redo·잘못된 UV 적용 차단,
다른 프레임/투명 RGB·전체 PNG·등록된 revision 재열기·중첩 원본 거절·한국어390px 화면을 실제 UI에서 대조한다.
해독을 지연한 뒤 이전 탭을 다시 열어 그려도 stale atlas 읽기가 새 문서의 폐기 확인창을 열거나 원본을 바꾸지 않아야 한다.
별도 fresh runtime은 2D command와 HD-2D billboard 정점의 실제 UV, Playing 상태1·entity1개·sprite와 draw/texture 비용을 확인한다.
프로젝트 smoke는 v4 source/PNG를 실제 Rust에 저장하고 호스트/브라우저를 재시작한 뒤 프레임 카드로 재열어 원본·선택 영역을 검사한다.
Rust unit은 같은 정수/중첩/버전 계약의 저장 거절과 기존 catalog 보존을 확인한다.
근거는 `artifacts/pixel-project/verification.json`과 run별 화면/원본/`rust-build.log`다.

### 자체 도트 노멀 회귀

`pnpm smoke:pixel-normals`와 `pnpm smoke:pixel-normals-project`는 도트 노멀의 집중 진입점이다.
동일한 `pixel-normals-smoke.mjs` 검사는 기존 `smoke:pixel-authoring`/`smoke:pixel-project` 전체 gate에서도 레이어·프레임·태그·atlas 검사 뒤 실행한다.
2D DPR1/HD-2D DPR2에서 자체 v5 원본의 서로 다른 색·투명 영역을 frame별 실제 Worker 입력으로 확인한다.
생성기 부재·보류한 job 취소·Worker 종료·원본 수정/Undo의 stale 차단·불변 cache 재사용·한국어390px을 검사한다.
조명 dialog의 실제 GL readback으로 Flat/Normal 차이를 요구하며 생성/미리보기/취소가 기존 scene patch를 바꾸지 않아야 한다.
HD-2D 적용은 color+normal 한 씬 patch와 정상 UV·clip 재생을 확인하고 별도 fresh runtime의 controlled light에서 normal 유무의 픽셀 차이를 대조한다.
Playing1·entity1·draw1~16·texture switch≤16·normal none/color srgb를 실제 renderer/engine sample로 확인한다. 기본2D의 미리보기와 HD-2D runtime 조명 검증을 구분한다.
실제 Rust 저장 gate는 source/color → normal pair → scene 순서, 재시작 뒤 source JSON hash/PNG/frame rect 검증과 durable pair 재사용을 확인한다.
같은 gate는 문서 탭 전환으로 임시 pair가 넘어가지 않는지, 저장한 프로젝트 pair는 같은 프로젝트의 다른 씬에 적용하고 해당 씬의 evidence로 기록할 수 있는지 확인한다.
Rust unit은 잘못된 source hash/PNG/frame/generator metadata와 디스크의 원본 PNG 변조가 저장/복원에서 거절되고 기존 catalog를 바꾸지 않는지 검사한다.
`smoke:pixel-project`는 `test:native-normal-project`도 먼저 실행해 복원 metadata·source/frame 증거·공유 texture 소유권의 Node 회귀를 CI 수동 gate에 연결한다.
원본/normal을 해제할 때 공유 color를 중복 해제하지 않고 종료 URL/texture/Worker가0이어야 한다.
집중 결과는 기존 pixel artifact run의 `focus: pixel-normals`로 표시하며 전체 pixel gate 완료와 구분한다.

### Import revision 정리와 진단

`pnpm test:placement-scenes`는 미참조 session revision 정리·예산 회수·persisted/pending 보존과
해제 실패 시 source/URL 보존·재업로드를 검사한다. SDK 회귀는 source/Undo/Redo/transaction 참조 query를 검사한다.
`pnpm smoke:aseprite-assets`는 실제 Register 뒤 불필요한 revision의 URL/GPU 회수와 참조 중 두 revision의
Undo/Redo 픽셀 보존, 누락 frame의 source 파일·frame ID·정확한 씬 pointer를 검증한다.
등록된 자산을 숫자 texture ID로만 작성한 경우에도 정리 후 자원 수와 실제 표시 픽셀이 유지되는지 검사한다.
`pnpm smoke:tile-map`도 Tiled/LDtk의 실제 missing frame 진단과 기존 save/reopen 회귀를 함께 검사한다.
이 세션 정리 gate를 프로젝트 디스크 원본 정리/GC의 검증으로 해석하지 않는다. 관리 Catalog는 아래 별도 gate를 사용한다.
Import 진단 단위 검사는 늦은 Problems 초기화를 위한 상태 재조회·snapshot 분리와
공유 객체/순환·깊이·대량 속성에서 순회 상한 및 `scenePathsTruncated` 표시를 검사한다.

### 전체 타일 맵과 native 저장

`pnpm smoke:tile-autotile`는 프레임 이름 규칙의 순서·원본 이웃·8방향·범위/작업량 제한과
결과 충돌 정책·원본 불변·단일 Undo를 단위 검사한다. 실제 브라우저에서는 Tiled/LDtk 맵 미리보기의 픽셀과
씬 무변경·오류/설정 변경 시 무효화·KO/EN·적용/Undo/Redo·GID 변경 재가져오기를 검사하고 HD-2D는 명시적으로 거절한다.
원본에서 미사용인 출력 프레임의 UV/충돌도 검사한다. 설정 변경·종료 후 늦게 완료된 bitmap은 표시하지 않고 해제한다.
디코딩을 지연시킨 상태에서 연속 클릭해도 요청은 하나이며, 종료 뒤 도착한 파일/입력/버튼 이벤트가 정리된 draft에 접근하지 않는지 검사한다.
Data Scene의 64/512/2,048 타일에서 실제 Playing·entity/렌더 명령 규모·draw/texture switch·렌더 CPU 시간과
Rust body raycast 충돌을 함께 측정한다. 작성 미리보기/적용 시간은 브라우저 작업의 전체 경과 시간이며 Rust update CPU 측정이 아니다.
각 규모에서 미리보기/적용 각각 10초 미만, 렌더 CPU 평균 50ms 미만, draw 1~32·texture switch 8 이하를 검사한다.
SDK batch 테스트는 2,048개 단일 검증·Undo/Redo·중복/잘못된 prefab/host 거절 시 원복을 확인한다.
배치 크기 초과·잘못된 배열 같은 초기 입력 오류도 열린 transaction 전체를 취소한다.
native 분기는 실제 Rust 저장/protocol·재시작에서 규칙·UV·collider·셀 ID/behavior와 원본·fresh game을 확인한다.
보고서는 `artifacts/tile-autotile/browser/verification.json`, `artifacts/tile-autotile/native/verification.json`이며 CI와 `smoke:check`에 연결된다.
headless software rendering 기준이며 실제 GUI IPC·실물 GPU/모바일 성능은 별도 검증이다.

`pnpm smoke:tile-animation`는 이름별/Tiled 원본 clip의 시간·반복·미사용 frame/외부 TSJ·예산·고정 충돌·Undo를 검사한다.
옵션만 16KiB 이내여도 source 식별자와 합친 저장 메타데이터가 초과하면 패치 생성·미리보기·적용 전에 거절하는지 확인한다.
브라우저에서 0/100/280ms 미리보기 픽셀과 씬 무변경, 1,001ms 프레임·2,002ms 반복/종료 경계, 빈 값·음수·소수·상한 및 초과 시간 입력을 검사한다.
실제 Playing 프레임 변화·pause/resume·nonloop 종료도 확인한다.
64/512/2,048 animated tiles의 native frame과 렌더 UV 변화, command/entity 수, 실제 FrameState의 Rust update 시간·renderer CPU·draw·texture switch,
고정 body raycast와 Apply 10초 예산을 검사한다. 시간·UV view는 test sample에서 숫자로 복사하고 보관한 Wasm view를 재사용하지 않는다.
native 분기는 실제 Rust 저장·재시작과 독립 게임에서 animationSet/설정·source hash·ID/binding·시간·pause·고정 충돌을 확인한다.
보고서는 `artifacts/tile-animation/browser/verification.json`, `artifacts/tile-animation/native/verification.json`이다. CI와 `smoke:check`에서 직접 실행한다.

`pnpm smoke:tile-map`는 tile assets 단위 검사와 공식 viewer의 기존 PNG/upload/lock/cancel/재import 회귀에
Tiled/LDtk whole-map 적용·그룹 교체·단일 Undo/Redo를 추가한다. 기존 negative upload 검사를 먼저 실행해 캐시로 실패 주입을 건너뛰지 않는다.
좌표/offset·layer 방향·object mapping·명시적 nonblocking 셀·제외 tileset·lock·provenance 경계를 검사한다.
2×2→3×2 변경에서 같은 좌표의 ID와 instance binding이 유지되고 단일 Undo/Redo로 돌아오는지 확인한다. SDK 단위 검사는 explicit detach/prefab 상속·미지원 prop 거절·legacy 원본 누락 거절·cell metadata 한계도 검사한다.

`pnpm smoke:tile-project`는 기존 Rust headless transport의 실제 파일 저장·원본/catalog/CAS·protocol·새 세션과 fresh game에
2D whole-map provenance·재import도 연결한다. 구형 선형 key의 실제 저장 파일과 원본 catalog를 다시 열어 좌표 identity로 이관하고, 너비 변경 뒤 ID·동작 참조·fresh game을 확인한다. 저장 실패/취소 시 원문 보존과 저장 직후 baseline/viewer의 일관성도 검사한다.
이 결과는 GTK/WebView native GUI나 설치 파일 검증이 아니다. 미지원 형식은 [현재 사용 범위](../../engine/data-scene-authoring.md#tiledldtk-전체-맵-적용-개발-소스)를 따른다.

## 복구 가능한 프로젝트 Catalog 정리

```bash
pnpm test:placement-asset-cleanup
cargo fmt --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features --all-targets -- -D warnings
cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features
pnpm smoke:placement-asset-cleanup
```

단위 검사는 bounded host 응답·열린 저장/초안 보호·한 Catalog 명시적 선택·필수 재열기 계약을 확인한다.
Rust는 네 Catalog의 실제 원본 검증/정리/복구, 공유 PNG, 닫힌/escaped JSON·추가 manifest alias 참조,
normal 리비전 ID·숫자 텍스처·등록된 textureOptions 확장 metadata의 참조, 들여쓰기로1 MiB를 넘는 compact Catalog의 안전한 발행,
권한·외부 변경·변조·링크·한도·불완전 백업과8개 한도에서의 복구를 검증한다.
발행 충돌/후속 실패는 원본을 복구하고 새 외부 Catalog를 보존해야 한다.
발행 직후 프로세스 중단을 모사한 뒤 새 registry에서 축소 Catalog를 정상 로드하고 백업으로 원문을 복원한다.
분석을 막는 손상된 public JSON에서도 독립적인 백업 목록과 실제 복구를 확인한다. 손상된 완료 marker는 다른 백업을 숨기면 안 된다.

브라우저는 실제 Rust 저장/protocol 함수를 기존 test-only stdio bridge로 호출한다.
생성된 임시 프로젝트에서 명시적 분석·선택·계획 내보내기, 닫힌 씬 참조, 미적용 속성/미저장/Redo 보호,
분석 이후의 새 참조 거절, 처리 중 Escape 차단, 전체 백업 bytes와 정리 대상 파일 제거를 검사한다.
읽기 전용 분석 중 Escape는 즉시 닫히고 늦은 응답이 재분석 결과를 덮어쓰지 않아야 한다.
닫힌 JSON을 손상시켜 분석 실패 뒤에도 실제 백업 복구가 가능하고 해당 JSON을 변경하지 않는지 검사한다.
쓰기 뒤 강제 재열기, Rust/브라우저 새 세션 복구, 한국어/680px 모달과 URL/GL texture 해제도 확인한다.
앱 쓰기는 사용자 프로젝트에 실행하지 않는다. CI의 독립 단계에서 실행하고
`artifacts/project-asset-cleanup/browser/verification.json`과 run별 화면/계획/`rust-build.log`를 남긴다.
GTK/WebView native GUI·picker·실제 IPC·전원 상실 내구성 검증은 이 테스트가 대신하지 않는다.
동적 코드·GLB 내부·외부 파일 전체 GC 및 백업 영구 삭제도 검증 범위가 아니다.

## 명시적 sprite animation 런타임 gate

```bash
pnpm smoke:sprite-animation-runtime
```

새 Wasm과 SDK를 빌드하고 WebGL2·software WebGPU offscreen을 모두 필수로 검사한다.
실제 GameLoop/FrameState callback·Rust playback·GameStateSnapshot API를 사용하며 JS는 재생 상태를 계산하지 않는다.
90/180ms 경계, 역순 시간, loop/nonloop pingpong, 1프레임, 한 update의 중간 frame 이벤트를 확인한다.
8방향×48원본 frame atlas에서 GCD UV 복제 없이 각 clip의 재생·seek47·seek48 거절과 실제 UV/픽셀을 확인한다.
paused/flipped pingpong 중간 phase·완료 phase·legacy FPS 저장 왕복과 완료 이벤트 중복 방지도 검사한다.
각 renderer에서 100개 이상의 실제 render, 300개 이상의 frame 이벤트, 완료 이벤트와 draw 예산을 assert한다.
보고서는 `artifacts/runtime-animation/verification.json`과 고유 run 폴더에 기록하며 실패도 `ok: false`로 남긴다.
실행 시작부터 `ok: false`·`status: running`으로 이전 성공을 무효화하고, 종료 시 passed/failed로 갱신한다.
같은 명령의 report 회귀 테스트는 SDK 준비 실패와 POSIX FIFO에서 중단된 실행의 root/run 보고서가 일치하는지 검사한다.
CI validate와 `smoke:check`에 연결하며, actual color target readback PNG와 visible canvas screenshot의 종류를 구분한다.

Rust의 `data_scene_animation_extended` 테스트는 256프레임·4096원본 frame 예산·v2 원자적 거절·
여러 loop/fixed step·4096 이벤트+전역 overflow record·재사용 capacity를 검사한다.
큰 유효 delta의 정확한 binary period 나머지와 bounded 이벤트 작업량, WorldSnapshot으로 교체된 clip metadata·
핑퐁 복귀 phase·pause/flip·완료 상태를 되돌린 뒤의 재개도 검증한다.
`data_scene_spawn_prefabs::checkpoint`는 spawned actor의 timed pingpong 중간/완료 phase 복원을 검사한다.
SDK tests는 v2 capability·owned cold plan·시간 합산·authored/spawn progress·이벤트 decoder와 공개 타입을 확인한다.
잘못된 null clip/frame·희소 update 배열은 일부 항목도 native에 전달하지 않고 거절되어야 한다.
뷰어 재가져오기 검사는 새 emitEvents 정책을 보존하고 수동 변경한 timing/direction을 덮어쓰지 않고 거절한다.
기존 replay golden과 공식 placement viewer gate를 함께 사용한다. 실물 GPU/모바일·장시간 timing 검증을 대신하지 않는다.

## PNG 아틀라스 가장자리 보호 gate

```bash
pnpm build
pnpm smoke:atlas-extrusion
```

Node 검사는 실제 PNG 합성 결과에서 원본 RGBA·모서리·투명 RGB·반투명 알파·부분 extrusion·
남은 투명 여백·기본/명시 0의 PNG 바이트 동일성을 확인한다. CLI/config 우선순위, 0 padding,
layout/UV/Game Spec 보존과 잘못된 옵션의 기존 파일 무변경도 검사한다.
빈 CLI 값이 config의 보호 설정을 끄지 못하는지, 비유한 padding이 쓰기 전에 거절되는지도 확인한다.
브라우저 실행 실패를 별도 `--artifact-dir`에서 재현해 이전 성공 JSON이 `ok: false`, `status: failed`로
바뀌고 run별 보고서와 일치하는지 검사한다. 실행 중 보고서도 `ok: false`, `status: running`이다.

browser smoke는 CLI가 생성한 atlas와 **동일 크기·동일 UV**의 독립 단일 프레임 참조를 비교한다.
참조는 다른 프레임 없이 해당 프레임의 edge를 texture 전체로 확장한 이미지다. 크기가 다른 PNG끼리의
nearest 텍셀 선택 차이를 경계 번짐으로 오인하지 않는다. GL/GPU × DPR 1/1.5/2에서
회전·소수 크기/위치·UV flip·반투명 이미지의 정상 렌더와 색상+표시 2 draw, destroy 후 자원 해제를 확인한다.
`colorSpace: "none"`과 기본 `"srgb"` 로딩 모두 각 backend의 독립 참조와 전체 렌더/경계 행렬을 비교한다.
보호된 정상 출력은 참조와 channel 오차 최대 1이다. 별도 축 정렬 프레임의 backend 직접 비교는
RGBA data(`none`) 디코드에서 최대 오차 2를 허용한다. sRGB legacy 업로드의 alpha 처리까지 두 backend가 같다고 주장하지 않는다.
두 renderer에 검정 clear를 명시하고 DPR 1에서 빈 참조 이미지로 실제 음성 대조군을 실행해 빈 화면을 거절한다.
나머지 DPR의 `emptyReferenceCheck`는 `not-run`으로 기록해 실제 실행 범위를 구분한다.

별도 UV edge probe는 경계 및 경계 밖 0.25~1.75 texel에 실제 샘플을 보내 투명 여백과 extrusion의
보호 폭을 측정한다. 이는 정상 게임 UV가 그만큼 벗어난다는 뜻이 아니다. `normalCases`와 `edgeProbes`를
분리해 기록하며 정상 nearest 사례의 번짐이 0이어도 그대로 보고한다. 원본 프레임 UV를 전역 inset하지 않는다.
CI validate job과 `smoke:check`에서 실행하고 PNG·JSON·검증 보고서는 `artifacts/atlas-extrusion/`에 남긴다.
기존 노멀 pair는 `sprite-normal-animation.test.mjs`, asset CLI/병합은 기존 `pack-textures-smoke`·`smoke:asset-pipeline`로 회귀 검증한다.
대상은 Chromium WebGL2와 소프트웨어 WebGPU offscreen이며 실물 모바일 fp16·2048px 이상 GPU UV 오차·
실기기 GPU 시간·native compositor는 이 gate의 검증 범위가 아니다. 기본 fragment 정밀도는 유지한다.

## Public package 선언 타입 gate

`pnpm package:check:ferrum-web`는 실제 tarball allowlist 검사에 이어
`ferrum-web-public-types.test.mjs`를 실행한다. 임시 consumer의 공개 subpath를 ES2022·DOM,
`strict: true`, `skipLibCheck: false`, `types: []`로 검사해 Wasm 선언의 누락된 타입 lib와 `snap` 타입 회귀를 잡는다.
독립된 브라우저 consumer를 검사하며 저장소 SDK test의 Node ambient type에 의존하지 않는다.

## Flat 2D 픽셀 퍼펙트 gate

```bash
pnpm smoke:flat-pixel-perfect
```

SDK build/Wasm와 공식 뷰어 build 후 DPR 1/1.5/2에서 실제 WebGL2 및 software WebGPU offscreen target을 검사한다.
가상 픽셀마다 정수 블록 색 일치, RGB/alpha backend parity, 불투명 여백, normal·point light·fade,
WebGL2 multipass·linear-sRGB fallback·RenderTexture 격리, resize 시 고정 virtual allocation과 destroy 자원 해제를 확인한다.
실제 Wasm Playing Data Scene의 포인터/여백·zoom/ground projection·문서 재적용과 bounded 카메라의 실패 보존을 검사한다.
투명 clear의 opaque 출력, 중복 finalization, 최대 1메가픽셀·hidden canvas, GL 각 candidate/GPU bind group 동기 할당 실패의 기존 화면·메모리·후보 자원 정리도 검사한다.
private 뷰어 fixture에서 UI로 Game Preview 왕복·resize·Play/Pause/Stop·다른 가상 해상도의 문서 탭 왕복/닫기·HD-2D 문서 전환을 실행한다.
source/patch/history와 편집 카메라·zoom·선택 viewport의 복원을 확인하고 실제 객체를 클릭해 선택한다.
`pixel-snap-fixture.mjs`는 snap 생략/false의 동일 출력, 소수 이동 fixture의 실제 off 픽셀 변화와 on 안정성,
소수 zoom·회전 원점·normal/color 정합·1,024 sprite 배칭·명령 버퍼 불변·RenderTexture 격리·WebGPU 장치 복구를 검사한다.
`pixel-snap-native-tiles-fixture.mjs`는 실제 Rust 타일 커맨드를 소비해 소수 카메라/zoom의 이음새와
GPU 렌더 전후 native snapshot 불변을 확인한다. 별도 실제 Playing Data Scene에서 시작해 일시정지한 뒤
카메라의 소수 이동과 출력 안정성, 원본·좌표·명령 불변도 비교한다. 테스트용 타일 snapshot 설정은 named accessor를 쓴다.
타일 fixture는 follow 대상도 같은 소수 좌표로 배치하고 실제 frame 카메라가 각 요청 좌표에 도달했는지 검사한다.
회전·노멀 조명·UV flip·입자·소수 재질 offset·13-float 호환·명시/생략 투영의 backend 픽셀을 비교한다.
스냅 사각형의 coverage는 분석한 정수 경계와 일치해야 한다. 스냅 활성 결과와 공통 coverage의 RGB 오차는 최대 2다.
스냅 off에서만, 실제 단색 사각형 coverage가 다르고 분석한 경계에서 1/16 가상 픽셀 이내인 픽셀은
legacy raster 경계 차이로 별도 계측한다. 내부 coverage 차이나 공통 영역의 색/노멀 차이는 허용하지 않는다.
장치 복구는 노멀 조명까지 복원한 화면을 비교한다. `snap.parityCases`는 공통 영역/원본 최대 channel 차이와
`legacyEdgeCoveragePixels`를 구분해 기록하므로 legacy 경계 예외를 전체 픽셀 동일로 보고하지 않는다.
Game Preview fixture는 `display.pixelPerfect.snap: true`를 열어 옵션 적용과 편집 복원을 확인한다.
결과는 `artifacts/flat-pixel-perfect/`에 남고 CI validate job에서 실행한다.
이 gate는 native GPU canvas compositor·실물 GPU·CSS/OS 확대 품질을 검증했다고 주장하지 않는다.
회귀 비교는 `smoke:color-management`, `smoke:sprite-normal-2d`, `smoke:render-texture`, `smoke:runtime-budgets`와 공식 placement viewer gate를 사용한다.

## 내장 도트 편집기64프레임 용량 검증

도트 이력은 `test:pixel-authoring`의 `pixel-history.test.mjs`에서 최대8MiB 원본의64개 단일 픽셀 Undo, v1~v9, 투명 RGB, hidden/locked cel, 혼합 pixel/metadata/resize/merge trace, 저장 checkpoint, cancel/no-op/Redo branch, dense delta와 전체 snapshot의16MiB 퇴출을 검사한다.
`pnpm profile:pixel-history <label>`은 같은32×32/최대 원본의 pixel·stroke·fill·resize를 측정해 `artifacts/pixel-history/<label>.json`에 남긴다. 이력 RGBA byte·명시적 Uint8Array 생성/slice 할당과 편집/Undo/Redo 시간을 구분한다. 이 할당 수치는 문자열·metadata·다른 TypedArray/VM 전체 할당을 뜻하지 않고 Node memory 표본도 browser/mobile 성능으로 해석하지 않는다. 실패 보고서는 ok:false다.
`pnpm smoke:pixel-history`는 실제2D/HD2D UI에서 최대 원본의64번째 프레임에 포인터로4번 편집하고 Undo/Redo 후 전체 source 일치·다른 cel 보존·레이어 속성 snapshot 복원을 확인한다. 같은 helper가 기존 CI의 `smoke:pixel-authoring` 전체 흐름에도 포함된다. 런타임·저장 검증은 해당 aggregate의 기존 실제 게임/PNG/host 검사와 함께 사용한다.

```bash
pnpm test:pixel-authoring
pnpm profile:pixel-capacity
pnpm smoke:pixel-capacity
```

`pixel-capacity.test.mjs`는 v6의64프레임·8방향 태그, v3/v5의16프레임 거부 경계, 17번째 frame의
원자적 upgrade/Undo,64번째 frame 편집과16 MiB history, 원본 UV/ms 전달과 PNG 투명 RGB를 검사한다.
기존 v1~v5의 source/checkpoint/revision 계약을 유지하고 v6 tag metadata 일부만 있는 입력은 거절한다.
작은 v6(1·8·16프레임)도 편집기 메타데이터와 원본 내보내기의 시간 형식이 같아야 한다. 17번째 프레임 추가·삭제·Undo/Redo로 바뀌는 버전을 따라가며 UI 검증 중 cel 직렬화를 호출하지 않는다.

profile은16프레임 기준선,32×32×64 대표 시트,8레이어, 최대 cel 예산, 고엔트로피32프레임 큰 시트의
열기·편집·Undo/Redo·JSON 저장/재열기·PNG 생성/검증 시간과 Node memory stage 표본을 기록한다.
고엔트로피 PNG가 기존8 MiB를 넘지만 v6의16 MiB 안에 들어오는 사례도 실제 인코딩으로 확인한다.
`artifacts/pixel-editor-capacity/profile.json`은 진행/실패 때 ok:false이며 성공 때만 true다.
메모리는 stage별 Node process 관측치와 cel/atlas/history byte를 구분하고 실물 browser/mobile peak나 FPS로 해석하지 않는다.

smoke는 공식 UI에서 16→17버전 전환,64개 막대의 End/Home·선택 가시성, 마지막 cel의 편집·Undo/Redo,
좁은 화면·PNG·게임에서 사용하는 고유 UV32개 노멀 한도(미사용 cel 제외) 안내와 원본 UV64개를 내보내는 게임 적용을 검사한다.
새 게임이8개 clip의64개 원본 frame을 실제 재생하며 state·draw 예산·UV·색상 픽셀을 함께 assert한다.
같은 시나리오를 실제 Rust 저장/protocol transport에서 실행하고 host/browser 재시작 후 frame63/source와
저장된 새 게임의64프레임 출력을 확인한다. native GUI IPC는 이 stdio transport 검증에 포함되지 않는다.
CI validate와 aggregate smoke에 연결하며 browser/native 고유 run·PNG·JSON과 profile을 같은 artifact 폴더에 둔다.

## 평면 2D 팔레트 스왑

`pnpm smoke:sprite-palette`는 SDK를 빌드하고 WebGL2/WebGPU의 실제 shader/buffer를 DPR 1/2에서 실행한다.
두 팀과 미지정 texture를 한 프레임에 그려 RGB 교체·미매칭·한 번만 치환·투명/반투명·tint/colorMix·additive·outline·normal 조명을 비교한다.
RGB 채널 허용 오차는 2이고 tint/flash/additive/outline은 기대 픽셀도 직접 검사한다. alpha는 같은 backend의 전후 값을 비교하며
제외 pass 색과 충돌하는 mapping을 넣어 primitive/그림자/normal이 교체되지 않는지 검사한다.
GL linear-sRGB의 비원색 교체, RenderTexture 출력과 미지원 입력 진단, 동일 설정 반복 시 자원 유지,
변경/비활성 복귀, 64번째 binding 실제 draw, 4096px 미지정 atlas의 sampling 불변, WebGPU 장치 손실 2회 복구, destroy 자원 0을 검사한다.
반복 설정 동안 실제 GPU create 호출을 계수하며, 비활성 시 draw·program/buffer/texture 개수가 기준값으로 돌아오는지 확인한다.
이 결과를 전체 CPU/GPU 비용이 0이라는 주장으로 확대하지 않는다. 설정 복사 실패의 화면 원자성과 단일 owned snapshot도 검사한다.
실제 Rust Data Scene은 Playing·2,048 entities/commands·60프레임·draw≤2·texture switch=0·CPU p95<250ms와
팔레트가 적용된 실제 픽셀을 assert한다. `webgl2.gpuTiming`은 실제 지원 상태/결과를 보고하며 unsupported를 0ms로 취급하지 않는다.
각 native runtime의 실제 backend를 확인하고, 동적 provider를 사용해 lost/recovering 중 native update·onFrame 유지와
GPU 제출/provider 호출 0, 복구 후 팔레트 해제/교체의 실제 픽셀을 검사한다.
보고서는 `artifacts/sprite-palette/verification.json`과 `run-*/verification.json`이다. CI와 `smoke:check`에 직접 연결한다.
WebGPU는 소프트웨어 offscreen target이므로 실물 GPU 성능·native canvas compositor 검증을 주장하지 않는다.

단위 검사는 입력 한도·중복/잘못된 RGB·불변 복사·base-only pass·기존 command staging 무변경,
WebGPU 독립 uniform/동일 설정 재사용/실패 원자성·해제, optional shader의 기본 준비 제외를 확인한다.

## 도트 후처리

`pnpm smoke:pixel-postprocess`는 Wasm/SDK 빌드 후 Game Spec JSON 스키마와 resolver의 입력 범위·순서 동등성을 검사하고,
WebGL2와 소프트웨어 WebGPU의 실제 shader를 DPR 1/2에서 실행한다.
RGB 양자화·Bayer 임계값·홀수 행 감쇠를 CPU 기대값과 오차 2 이내로 비교하고 alpha 전후 일치,
fade 전/후 순서와 반투명·투명 픽셀의 alpha 보존, 잘못된 설정 거절과 이전 출력 유지를 검사한다.
가상 31×23 픽셀의 확대 블록·홀수 행 원점·resize·backend/DPR 간 출력을 비교한다. GL linear-sRGB도 별도 실행하며
양쪽 virtual/nonvirtual 경로의 device loss 2회·off baseline·destroy 자원 0을 확인한다.
반복 설정/프레임 중 실제 createTexture/createBuffer/createProgram 또는 createRenderPipeline 호출이 0인지 검사한다.
단위 검사는 숫자 범위·불변 복사·순서·실패한 resize의 이전 자원 보존·선택 자원 해제를 확인한다.
선택 효과의 uniform 할당 실패 시 생성 중인 pipeline을 해제하고 기존 fade를 유지하며, 이후 재시도가 성공하는지도 검사한다.
직접 pass/shorthand의 알 수 없는 필드, 누락 kind, 잘못된 enabled, 비활성 내부 설정과 color null은 실제 Game Spec resolver까지 검사한다.
기본 fade `{}`의 schema 호환도 유지해야 한다. 두 pixelArt pass의 순서·통계와 잘못된 형태의 설정 거절 후 화면 보존을 검사한다.
반투명 RGB oracle은 이상적인 PNG 색이 아니라 실제 SRGB8_ALPHA8 입력 타깃을 읽어 계산한다.

실제 Rust Data Scene은 Playing·1,024 entities/commands·60프레임·draw=2·texture switch=0·후처리 pass=1·
CPU frame p95<250ms와 객체 색상 픽셀을 함께 assert한다. presentation은 authored postProcess 통계를 덮어쓰지 않아야 한다.
같은 규모에서 bloom·CRT·vignette·glitch·pixelArt를 함께 실행하는 경로도 draw=6·후처리 pass=5로 검증한다.

Sampled 효과는 source 1texel/logical pixel의 불투명 장면에서 **baseline을 먼저 비교**하고 네 효과·7개 혼합/역순 pass의
전체 RGBA를 backend 간 오차 2 이내로 비교한다. 같은 seed 반복·다른 seed의 영상 변화·원래 seed 복귀를 검사한다.
legacy의 sprite alpha 누적은 backend마다 달라 반투명 end-to-end RGBA가 동일하다고 주장하지 않는다.
별도 반투명·투명 입력에서는 실제 baseline에 대해 bloom/vignette alpha 보존과 CRT/glitch의 warped/shifted bilinear alpha CPU oracle을 검사한다.
GL linear-sRGB의 네 효과와 pixelArt/fade 혼합도 실행하며 radius=0 색상 oracle은 최종 불투명 확대 화면이 아닌
효과 직전 실제 SRGB8_ALPHA8 FBO를 읽어 계산한다. threshold=1, resize/off, device 복구와 자원 0도 확인한다.
WebGPU sampled 효과 전체가 복사 texture 하나를 공유하며 반복 설정/프레임의 실제 sampler 생성도 0이어야 한다.
고정5×5 가상 타깃으로 극소 양수 softness의 비네트 경계 픽셀·radius0·softness0, 최대 유한 float32 curvature의 중앙 픽셀과 seed 재현성을 검사한다.
float32 범위 밖의 값은 비활성 설정에서도 거절하고, 기존 출력·texture/buffer/program 수를 보존해야 한다. JSON 스키마도 같은 범위를 검사한다.
보고서는 `artifacts/pixel-postprocess/run-*/verification.json`과 최신 `verification.json`이다. CI와 aggregate smoke에 연결한다.
이 검증은 실제 GPU 명령의 software/offscreen 실행이며 실물 GPU 성능·native canvas compositor를 보장하지 않는다.

## Consumer 도트 프로필

`test:pixel-authoring`에 포함된 `consumer-pixel-profile.test.mjs`는 PNG RGBA/CRC·팔레트(투명 RGB 포함)·타일·정수 scale·nearest 선언·atlas rect/실제 extrusion·경로/용량과 CLI 종료코드/JSON 진단을 확인한다.
파일 열기 직전 leaf/상위 폴더 symlink 교체·동일 경로 파일 교체와 읽기 중 변경은 거절하고 descriptor를 닫아야 한다.
FIFO 입력은 CLI를 멈추지 않아야 하며, 정상 프로젝트 내부 symlink와 Linux procfs 없는 portable 검사도 유지한다.
빈/1-byte IDAT가 많아도 추가 메모리는 chunk 객체 수에 비례하지 않아야 한다. 정상 빈·분할 IDAT/압축 뒤 잔여 byte는 허용하고 중복 PLTE는 거절한다.
`package:check:create-game`은 생성한 템플릿의 실제 validator로 정상 프로필과 팔레트 오류를 검사한다. `package:check:agents`는 shared/Claude skill의 설치 및 tarball 포함을 검사한다.
공통 생성 스크립트 변경은 `smoke:create-game-template-reports`와 full `package:consumer-smoke` 및 해당 report validator를 통과해야 한다. 선언과 PNG 검증은 런타임 renderer 검증을 대신하지 않는다.

## 도트 쇼케이스

`pnpm smoke:pixel-showcase`는 `examples/pixel-art`의 production build를 project subpath에서 실행한다.
WebGL2 canvas와 software WebGPU offscreen에서 실제 키보드 버튼/캔버스 클릭으로 목적지를 보내고,
Rust의 걷기 clip/frame·좌표 이동·씨앗 변수 0→3·pickup 소멸 250→247 entities·Playing을 확인한다.
재시작·일시정지, 가상 320×192와 정수 배율, 좁은 화면에서도 상태 유지·가로 넘침 없음,
실제 노멀 조명/팔레트/후처리의 픽셀 변화와 drawCalls≤20을 검사한다.
PNG의 팔레트/타일은 실제 consumer validator로 검사하며, Wasm MIME·브라우저 오류 0과 종료 시 texture/buffer/program 0을 확인한다.
`artifacts/pixel-showcase/run-*/verification.json`에 결과와 desktop/mobile 캡처를 남긴다.
`test:pixel-authoring`은 예제의 편집 가능한 원본을 실제 도트 reader/exporter로 읽어 배포 PNG의 RGBA와
씬의 animationSet이 일치하는지 확인한다. 노멀 시트의 크기·불투명 영역도 색상 시트와 대조한다.
실물 GPU와 OS compositor 검증은 별도이며, 원격 배포는 이 명령에 포함되지 않는다.


### 2D 9-slice runtime

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml nine_slice`: atlas UV·테두리/축소·origin/rotation/ground·tint·normal sidecar·flip 합성·atomic batch·snapshot/prototype/reuse.
- SDK `spriteNineSlice.test.ts`: authoring 정규화·전체 bounds·지원 여부/scale preflight·deferred batch·공간 경로 거절.
- `pnpm smoke:sprite-nine-slice`: 최신 Wasm/SDK build 후 WebGL2/WebGPU × DPR1/2에서 실제 Playing 상태의9-slice를 독립 CPU 역변환/테두리 기대값과 픽셀 단위 대조. 비대칭 flip·회전·ground projection·origin·instance scale·축소·batch 실패/해제·draw budget·resource0를 검사한다.
- Chromium software WebGPU의 offscreen color target을 사용하며 native canvas presentation 검증으로 주장하지 않는다. CI validate에 직접 연결하며 `artifacts/pixel-tools-and-demo/nine-slice/runtime`에 결과를 보관한다.

### 엔진 기능별 예제

파티클 구분 검사는 `feature-particles-checks.mjs`를 사용한다. 불꽃/먼지/잔상의 고유 기본값,
서로 다른 native texture id와 실제 픽셀, 먼지 크기 증가·알파 감소, 정지 뒤 방출 종료와 기존 입자 만료를 확인한다.
나란히 비교는 실제 두 native 입자 그룹·pause/reset·390/320px 이름표 경계와 겹침을 검사한다.
초기화 중 새 먼지 PNG를 지연한 채 이탈하거나 씬 읽기가 실패해도 GPU 자원이 남지 않아야 한다. 이 검사는 전체 feature smoke에도 포함한다.
빌드 후 해당 주제만 확인할 때는 `node tests/smoke/feature-examples-smoke.mjs --particles-only`를 사용한다.
결과는 `artifacts/particle-dust-clarity/browser/verification.json`에 저장한다.


`pnpm smoke:feature-examples`는 빌드된 SDK/Wasm을 전제로 관련 예제 4종을 lint/build한 뒤 독립 실험 26종을 WebGL2/WebGPU로 검증한다. Platformer/Breakout/Shooter도 strict TypeScript 검사를 공통 `pnpm lint`에 포함한다.
Catalog 검증은 각 주제의 `lesson`에 사용 상황·실험 설명·2~4단계·범례·유효한 객체 참조가 있는지 확인한다.
`feature-learning-checks.mjs`는 실제 페이지의 설명·실행 버튼 배치, 이름표의 화면 경계/겹침,
대화/HUD의 캔버스 내부 배치와 한국어 글꼴, 게임 화면에 붙인 조이스틱의 가림 없는 배치, 접힌 수치 진단을 확인한다.
카메라의 실제 화면 영역·광원 상하 선택·탄 충돌 정책·로딩/캐시·스트리밍·부모 연결 상태와 비교 그림의 일치도 검사한다.
모든 주제의 WebGL2 데스크톱/390px 캡처를 run 디렉터리에 저장한다. 320px를 포함한 전수 화면 검토 근거는
`artifacts/feature-learning-clarity/`에 보관한다. 리사이즈 후 다음 프레임에 이름표를 다시 투영해야 한다.
학습 UI는 기존 native/platform snapshot을 표시한다. 2D 이름표는 200ms 관측 구간에서 한 번의 bulk pose 조회로 읽고,
HD-2D는 이미 조회한 pose와 소유한 카메라 숫자를 사용한다. borrowed Wasm view를 다음 조회까지 보관하지 않는다.
애니메이션 재생/반전, 장애물 우회와 도달 불가 목적지, 물리 재질에 따른 실제 속도와 pause,
노멀/광원/후처리 GPU pixel 차이, 카메라 추적/확대, 9-slice 명령 수/테두리 차이를 확인한다.
9-slice는 대화창·가방의 같은 크기 비교와 24×24 원본을 표시한다. 너비/높이를 바꿔도 native 모서리 command의 크기가 유지되고,
테두리 배율을 바꾸면 실제 크기가 비례해야 한다. 적용 해제(11→3개 command), 일시정지 상태 유지, Reset·키보드·390/320px 세로 배치와 해제도 검사한다.
해당 검사만 실행하려면 SDK/Wasm과 starter-runtime을 빌드한 뒤 `node tests/smoke/feature-examples-smoke.mjs --nine-slice-only`를 사용한다.
별도 결과는 `artifacts/nine-slice-example/browser/verification.json`에 저장하며 전체 feature smoke와 기존 CI에도 같은 검사가 포함된다.
조명 실험은 실제 포인터를 공의 상하좌우로 이동하고 같은 표면 픽셀의 밝기를 반대편 광원과 비교한다.
WebGL2/WebGPU 양쪽에서 광원이 있는 면이 밝아져야 하며, 공·로봇·정원지기의 생성된 노멀맵도 OpenGL +Y 위쪽 규약을 확인한다.
타일 통로의 native 충돌/통과·점유 중 닫기 거절·벽으로 막힌 출발 위치 복귀 방지, 레이어 변경 pixel, 파티클 burst/loop/trail·수명·정지, 실제 Web Audio 노드의 좌우 출력·거리 감쇠·context 종료, 키보드/가상 조이스틱/게임패드 polling과 메뉴 복귀 중립화도 확인한다. 중첩 URL, 설정 초기화, 390px 폭, 키보드 접근, 자원 0 복귀도 검사한다. 기존 Platformer의 구역 이동, Breakout/Shooter의 기능 안내 전환, 충돌 영역 재시작 링크와 실제 debug line 렌더링, 작은 화면 배치도 검증한다. Shooter는 타이틀에서 Enter로 시작한 뒤 확인한다.
각 실험은 native Playing 상태로 전환된 뒤 검사한다. 레이어/조명/후처리/오디오의 기본 픽셀이 시간에 따라 바뀌지 않는지도 확인해 비교 결과에 애니메이션이 섞이는 것을 막는다.
기존 예제에서는 기능 메뉴를 선택한 뒤 캔버스를 누르면 키보드 포커스가 복귀하는지 확인한다. 저수준 `createEngine`을 사용하는 Shooter는 debug 활성화와 FrameState 포함 옵션을 함께 설정한다.
초기 씬/텍스처 응답을 지연한 상태의 pagehide(일반 이탈/캐시 저장)와 HTTP 실패에서 실제 WebGL 객체의 해제를 확인한다. 캐시 복귀 이벤트를 모사해 초기화가 다시 완료되는지도 확인한다. DPR 2·390px의 WebGL2/WebGPU에서 터치 타일 편집에 따른 native 충돌 변화와 조이스틱 이동/해제를 별도로 검사한다. 조이스틱 검사는 고정 대기시간 대신 제한 시간 안에 실제 native 이동·입력 해제가 발생해야 통과한다.
추가 게임 구성 실험은 두 씬의 scene/global 변수 수명·전환 재입력 차단·첫 씬의 실제 중간 페이드 픽셀·pause/reset·반복 전환 GPU 자원 수, 근접/잠금 조건·Space 단발·트리거 진입/이탈을 검사한다.
저장 슬롯은 실제 localStorage로 수집/위치 복원, 복원 뒤 다시 저장, 페이지 reload, 손상 데이터 거절, pause 중 덮어쓰기 차단과 다른 키 보존을 검증한다. SDK checksum/형식 검증에는 통과하지만 진행·변수·캐릭터가 누락되거나 수집 상태/활성 상태/이동 범위가 맞지 않는 저장도 현재 씬 변경 전에 거절해야 한다. 저장 용량 오류 시 기존 슬롯 유지와 복원 뒤 최신 generation의 애니메이션 진단도 확인한다.
대화의 조건부 선택지·퀘스트 목표/완료·키보드 포커스 유지와 HUD의 native 체력, 한영 label, progressbar 접근성 값, 22px/390px·고대비 표시도 확인한다.
사격 비교는 실제 Rust 탄의 벽 소멸·벽 뒤 통과·역방향 반사 궤적을 검사한다. 컷신은 카메라 이동·멈춘 타임라인·명령 순서·실제 AudioBufferSourceNode 시작·동작 감소·건너뛰기를 확인한다.
로딩은 실제 fetch 3회→캐시 3개/fetch 0회, 취소 후 완료된 캐시만 재사용·의도한 실패 후 재시도·초기화 중 늦은 완료 차단을 검사한다. 스트리밍은 구역별 픽셀 변화, 공통 바닥 유지, 왕복 시 실제 텍스처 수 일정, 빠른 이동·로딩 중 초기화 후 자원 수 복귀를 검사한다. 신규 3종의 네트워크 응답을 보류한 상태에서 destroy 후 늦은 응답을 풀어도 GPU 자원이 재생성되지 않고 AudioContext가 종료되는지 두 렌더러에서 검사한다.
오디오 잠금 거부 시 무음 연출, 초기화 후 늦은 unlock의 추가 요청 차단, 오디오 로딩 중 건너뛰기·취소·재시작, 스트리밍 네트워크 실패 시 기존 구역/공유 텍스처 보존과 재시도를 두 렌더러의 별도 8개 복구 검사로 확인한다.
HD-2D 실험은 경사로의 층·높이 전환과 양방향 이동, 승강/수평 발판의 native 탑승, 일시정지 중 위치 고정, AI 장애물 우회와 근접/발사체 피해, 모델 부모 위치·회전과 자식 연결 해제/복귀를 확인한다. 정상 사망한 캐릭터는 오래된 handle 조회로 렌더링을 중단하지 않아야 하며, 사망과 일회성 렌더 오류 후 초기화가 실제 프레임 진행을 복구해야 한다. 새 공통 화면의 씬/텍스처/모델 로딩 취소·실패 정리, BFCache 복귀 reload, DPR 2 조이스틱 이동/해제도 검사한다.
`node tests/smoke/feature-examples-smoke.mjs --spatial-only`는 빌드 후 HD-2D 4종과 관련 생명주기·입력·복구 검사만 실행하고 `artifacts/hd2d-feature-examples/browser/verification.json`에 별도로 기록한다.
애니메이션 실험은 기존 재생 설정 외에 native idle/walk·방향·프레임 이벤트·단발 완료 1회·재시작, 실제 음원 시작과 pause 중단을 검사한다. 음원 HTTP 실패/재시도, reset으로 로딩 취소 후 늦은 응답 차단을 양쪽 렌더러에서 확인한다.
HD-2D 환경 실험은 동일 장면의 그림자 켬/끔·광원 위치·안개·초기화 pixel을 비교하고 정적 장면에 GPU 프레임이 계속 제출되지 않는지도 검사한다. 지형 실험은 마스크 변경, 수정 범위 texture patch, native 충돌/공 낙하와 초기화 자원 수, 편집 전후 실제 속도 변화/고정 스텝 소비 시간 기반 중력 300 유지, DPR 2 터치 좌표를 확인한다.
`node tests/smoke/feature-examples-smoke.mjs --next-only`는 애니메이션/공간 환경/지형 3종과 관련 검사를 선택해 `artifacts/feature-examples-next/browser/verification.json`에 기록한다.
탐색은 분류 버튼의 키보드 조작, 390px에서 메뉴 높이 80px 미만, 모바일 주제 전환과 렌더러 유지까지 확인한다.
증거는 `artifacts/feature-examples/verification.json`과 고유 run의 주제별 screenshot이다.
수동 실행 CI(`workflow_dispatch`)는 `pnpm exec playwright-core install --with-deps chromium`으로 브라우저를 설치하고 기존 Engine Playground build를 재사용해 52개 기능/renderer 조합, 기존 안내 3종, 초기 로딩 생명주기 11종, 신규 컷신/로딩/스트리밍의 실행 중 요청 종료 6개 조합, DPR/터치 8개 조합, 실패/복구 16개 조합을 실행한다.
WebGPU는 소프트웨어 offscreen 검증이며 실물 GPU/compositor·모바일 터치 기기 검증을 뜻하지 않는다. 게임패드는 브라우저 polling 경계만 모사한다. 오디오는 실제 AudioContext/Analyser 출력 검사이며 스피커·헤드폰 청취 검증은 아니다.

### 통합 예제 Catalog와 공통 화면

`pnpm validate:example-catalog`는 공개/참고 역할·중복 ID/경로·실제 실행 명령·관련 feature와 씬 파일을 검사한다.
Pages 빌드도 같은 검증을 실행한다. `exampleCatalog.json`은 앱 역할·목적·조작·관찰의 기준이고 `featureCatalog.json`은 기능 실험의 기준이다.

`pnpm smoke:example-suite`는 전체 예제 dist를 전제로 Pages artifact를 만들고 통합 홈의 검색·분류·검색 URL 복원·빈 결과·JavaScript 없는 링크를 확인한다.
먼저 `pnpm test:example-catalog-build`를 실행해 예제 index/head 오류 시 기존 산출물 보존과 발행 복사본의 통합 표식을 검증한다.
공개 앱 6종의 공통 메뉴·현재 선택·관련 실험·테마, 1440/390/320px 폭, 키보드 안내 패널을 검사한다.
안내 패널의 Space 조작이 게임 점프를 발생시키지 않고, UI로 포커스를 옮긴 뒤 키를 놓아도 게임 입력이 해제되어야 한다.
데스크톱 도트 정원의 3배 정수 배율과 Breakout/Platformer의 DPR 1·2 전체 표시도 확인한다.
중첩 배포와 `index.html`에서 실제 앱 전환, 단독 서버의 잘못된 교차 앱 링크 차단, 참고용 기존 URL도 검증한다.
예제와 같은 이름의 단독 폴더, 뒤로가기의 현재 선택, 고해상도·JavaScript 비활성 보조 페이지의 오류도 확인한다.
물리 picking은 폰트와 리사이즈된 캔버스 해상도를 확인한 뒤 좌표를 계산하며 허용 오차는 계속 1 미만이다.
Breakout/Platformer 입력·일시정지·재시작·터치, Physics 좌표/단일 step, Shooter native HUD/입력, Starter 프로필 복원은 기존 검증 helper를 재사용한다.
공통 수명 처리(`examples/shared/exampleLifetime.ts`)를 사용하는 게임·참고 예제 8종은 시작 전부터 `pagehide`를 처리한다.
HTTP/Wasm 응답을 지연시킨 도중 이탈하거나 실제 로딩을 실패시켜, 뒤늦은 런타임 실행·진단 hook 노출·GPU 자원 재생성이 없는지 검사한다.
WebGL의 실제 Texture/Buffer/Program/Shader/Framebuffer/Renderbuffer/VAO 생성·삭제를 추적하며, 취소할 수 없는 Wasm 초기화의 완료도 기다린다.
준비된 BFcache 페이지는 런타임을 유지하고, 초기화가 취소된 BFcache 페이지는 복원 때 새로 초기화해야 한다.
Minimal은 공개 탐색 메뉴에 재노출하지 않고 별도의 단독 빌드 테스트 경로로 검사한다.
물리 씬 전환은 늦은 이전 응답 무시, 최신 선택 유지, 실패 시 기존 월드 유지·오류 표시와 정상 요청으로 복구까지 검증한다.
공통 shell의 `controls:false`는 기본 재생 버튼만 숨긴다. 뷰어가 사용하는 `.demo-actions` 확장 영역을 유지해야 하며,
공식 `smoke:placement-viewer`의 production 파일/예제 메뉴와 실행·중지 검사로 이 계약도 확인한다.
native 객체와 명령이 실제로 존재하고 entity≤2,500·command≤3,000·draw≤64여야 한다. 이는 UI 회귀용 상한이며 성능 보증 수치는 아니다.
결과는 `artifacts/example-suite/verification.json` 및 고유 run에 저장한다. 기존 `smoke:check`와 수동 CI에서 실행하고 artifact를 업로드한다.
뷰어 제작 도구는 메뉴·발행 경로를 제공하며 viewer 자체 편집 동작은 기존 viewer gate를 따른다.

### Engine Playground 통합 데모

이전 통합 데모는 참고·검증용 경로다. 공개 학습 안내는 기능 실험실과 역할별 게임 예제로 통합했다.

`pnpm smoke:engine-playground`는 빌드된 SDK/Wasm을 전제로 starter-runtime lint/build 후 `?mode=playground` 통합 게임을 검증한다. CI에서는 앞선 SDK/Wasm build 이후 실행한다. 중첩 URL 경로에서 WebGL2 및 WebGPU로 실제 키보드 이동/애니메이션, 장애물 경로와 전지 3개 수집, 고무·점토 공 반사/감속, 움직이는 공의 pause/resume, 재시작, 카메라 추적/확대, 광원·노멀·후처리 pixel readback 변화, 390px 화면과 키보드 접근, 자원 0 복귀를 확인한다. 증거는 `artifacts/engine-playground/verification.json` 및 고유 run 디렉터리다. WebGPU는 Chromium 소프트웨어 offscreen target으로 검증하며 네이티브 presentation과 하드웨어 성능을 보증하지 않는다.

기존 `smoke:starter-runtime`, `smoke:starter-runtime-budget` 및 공용 browser-render harness는 이 디렉터리에 대해 `?mode=starter`를 명시하여 기존 profile/replay budget 기준을 유지한다. 새 기본 화면은 별도 위 gate에서 검사한다.


### 물리 품질 회귀

`pnpm smoke:physics`의 `physics:quality-upgrade`는 CCD 상한/동적 연쇄/회전·offset·근접 접촉,
표시 보간/순간이동/pause-resume/추적 카메라/HD-2D attachment와 focus, 충격 수집 수명, bulk 복원 실패 원자성, static proxy invalidation,
spring 질량·iteration·timestep 응답을 검증한다. `pnpm test:web`의 `physicsQuality.test.ts`는
실제 Wasm으로 v2 JSON round-trip, pending force/impulse, v1 호환, ID 재할당·접촉 방향 반전 후 궤적/hash, 실패 후 기존 world/clock,
spring 주파수 authoring, collider 종류 불일치가 포함된 bulk 복원에서 모든 body의 상태 보존을 검증한다.
Rust 회귀는 실패한 transaction의 미소비 파손/충격 큐 보존, offset OBB/convex의
회전 접점과 실제 충격 방향, 원·캡슐의 표면 접점도 확인한다. 회전 sweep 연산 한도는
실제 접촉과 구분하며 한도 diagnostic만 남고 가짜 hit·impulse·feedback은 없어야 한다.

정적 proxy 최적화는 아래 release 측정으로 uncached/cached를 같은 fixture에서 비교한다.
시간값은 관찰값이며 CI 절대 시간 gate로 쓰지 않는다.

```bash
cargo test --release --manifest-path crates/ferrum-core/Cargo.toml static_proxy_reuse_benchmark -- --ignored --nocapture
```

`pnpm smoke:feature-examples`의 physics 경로는 30 Hz 표시 보간과 실제 충격량을 두 renderer에서
확인한다. 표시 보간은 렌더 명령의 위치를 물리 위치와 직접 대조하고, 끈 뒤에는 새 표본에서
두 위치가 일치하는지 검사한다. Rust rendering 회귀는 bitmap label의 표시 위치와
물리 debug marker의 실제 위치도 구분한다. 이 결과는 소프트웨어 WebGL2/WebGPU 기준이며 실물 GPU 검증과 구분한다.

### 물리 제작 확장 회귀

- Rust `joint_dispatch`와 `engine::tests::physics_joint_controls`는 8종 관절의 코드 0..7, unknown/stale 거부, 명시 삭제 성공 시 snapshot 초기화, force/torque 파손 및 슬롯 재사용 뒤 이전 generation의 삭제 차단을 확인한다.
  pending load가 남은 상태의 endpoint·joint 슬롯 동시 재사용과 full snapshot restore의 진단 초기화도 8종에 대해 조합 검증한다.
- Rust `engine::tests::physics_expansion`: 회전 잠금/해제·이동 유지, 반복 횟수와
  관절 힘 환산, 파손 큐 소비·stale handle, batch parity/입력 상한, impact
  실제 discrete/CCD의 report와 효과 독립성·cooldown, reset 후 재발생,
  수동 step 간 frame 상한, 복원 commit/rollback·일반 despawn의 효과 수명,
  발판 carry/하차/차단/동승자 순서 독립성.
- `spatial_progress::moving_platform_checkpoint_*`,
  `data_scene_combat_progress::combat_checkpoint_accepts_validated_platform_suffix_*`:
  원래 8값 pose·비시각 body·발판 phase·combat의 원자적 복원과 half-open 지형 경계 소유권 일치.
  `moving_platforms` 회귀는 원형/OBB trigger 통과와 compound의 활성 solid collider별 차단·filter를 확인한다.
- `physicsQuality.test.ts`: 실제 Wasm에서 회전 고정/런타임 하중 제한 JSON 복원,
  7가지 batch cast와 단건 결과·height filter·소유 배열 수명 일치,
  보고 기능을 끈 충돌의 오디오 이벤트·입자 발생과 잘못된 profile 교체 거부.
- `physicsBatchQueries.test.ts`: 8개 쿼리의 native 호출 1회, 입력 실패 시 0회,
  destroy 이후 접근 거부. `spatialMovingPlatforms.test.ts`: phase/ID/종류/stride 검증.
- `pnpm smoke:spatial-scene`: 기존 4 viewport/DPR matrix에 승강 바닥·이동 다리,
  pause 저장 v10, 새 handle 복원, 손상 phase 거부·기존 scene 보존·GPU 해제를
  추가했다. 기존 CI의 동일 gate에 포함된다.
- `pnpm smoke:feature-examples`: 물리 예제의 기존 두 renderer 회귀에 더해
  회전 고정·충돌 효과·관절 파손·일괄 탐색을 육안으로도 확인할 수 있다.
  단순 screenshot을 물리 계약 검증으로 취급하지 않는다.

소프트웨어 Chromium 결과는 실물 모바일 GPU·오디오 장치·장시간 부하 검증을
대체하지 않는다. batch 성능은 데이터·브라우저별 측정값이며 고정 배속을 보장하지 않는다.
`pnpm build` 후 `node tests/smoke/physics-batch-benchmark.mjs`로 전체 적중/최근접
적중 시나리오의 단건·batch 결과 일치와 교차 순서 5회 중앙값을 측정한다.
`raycast_bodies`·`batch_cast_bodies`의 JS→Wasm dispatch를 wrapper로 실제 계측해
반복당 단건 32회·batch 1회를 assert하며 getter·buffer 접근은 이 횟수에서 제외한다.
시간 측정 trial은 wrapper를 제거한 뒤 실행해 계측 오버헤드를 섞지 않는다.
결과는 `artifacts/physics-gameplay-expansion/batch-benchmark.json`에 남는다.


## Rust / TypeScript 역할 경계 회귀

- `pnpm test:language-boundaries`: AST 소유권 검사 자체의 negative fixture 15개.
- `pnpm validate:language-boundaries`: QuestLog/DialogueSession/PixelMaskTerrain의 native 위임과 필드·쓰기·타입 출처를 검사한다.
  세 facade의 scoped regression gate이며 전체 TS 코드의 gameplay 부재를 증명하는 정적 분석기는 아니다.
- 현재 `pnpm build:wasm` 및 SDK build 후 `pnpm smoke:language-boundaries`:
  실제 Wasm ABI, 1/128/1024 엔티티에서 동일한 frame 호출 분포와 기본 21회 예산을 검사한다.
  volume export가 있으면 version/stride/ptr/vertex count/caster count의 고정 bulk 읽기 5회를 별도 허용해 총 26회다.
  이 5개 getter는 각각 프레임당 정확히 한 번이어야 하며, 나머지 native 호출은 기존 21회 이하를 유지한다.
  선택형 export가 없는 호환 경로·빈 sidecar·엔티티 전체가 volume caster인 경로를 같은 규모에서 비교하고,
  실제 triangle buffer가 renderer에 전달되며 caster 증가가 호출 분포를 바꾸지 않는지 확인한다.
  render→effect summary 순서·memory.grow 뒤 frame snapshot 유지,
  native quest/dialogue/terrain 위임·공유 상태·owned snapshot을 검사한다.
- `pnpm test:web`: callback 재진입, provider/custom renderer/audio getter의 native 성장,
  초기화 실패 후 재시도·동시 초기화, native helper 수명·원자 복원, terrain sync 중 재편집을 검증한다.
- `.github/workflows/language-boundaries.yml`은 PR/main push에서 frozen install, 위 ownership 검사,
  현재 Wasm 빌드·SDK 단위 테스트와 native harness를 실행하도록 구성한다. 기존 무거운 수동 CI/browser matrix는 유지한다.

자동 보고서는 `artifacts/language-boundaries/`에 기록한다. frame 비용 예산은 기본 flat 경로의
계측된 호출 수이며 모든 renderer/extension의 시간·메모리 예산을 의미하지 않는다.


언어 경계 native harness는 추가로 실제 allocator pressure에서 diagnostics Vec 반환이 memory.grow를
발생시키는 경우를 검증한다. 현재 frame의 view는 query 후에 획득하며 render 15 floats와 telemetry 62 floats를
정상 소비해야 한다. 테스트의 raw allocation은 finally에서 해제하고, 상한 안에서 query growth가 없으면 실패한다.
SDK 회귀는 callback 중 실제 native engine 해제, RAF 재시작 중복 방지, getter 중 해제된 quest 복원,
terrain nested sync/destroy/constructor rollback/force retry 및 클래스형 effect target의 receiver를 검사한다.
