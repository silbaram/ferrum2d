# CHANGELOG

Ferrum2D의 공식 공개 릴리즈 변경 기록이다. 정식 공개 전 내부 개발 이력은 커밋, PR, 개발 문서에 남기고, 이 파일에는 사용자와 배포자가 알아야 할 릴리즈 단위 변경만 요약한다.

형식은 Keep a Changelog 관례를 참고한다. 공개 beta는 prerelease 버전으로 기록하며, 첫 정식 버전은 `1.0.0`을 목표로 한다.

## Unreleased

### Changed

- consumer AI 지침에 요구사항별 기능 안내서를 추가했다. 공개 API·사용 조건·최소 버전·예시·미지원 범위를 안내하고, 개발 전에 설치된 타입과 같은 버전의 문서를 확인하도록 연결한다. 기존 agents 지침은 비교·병합해 갱신해야 한다.

## 0.1.0-beta.5 - 2026-10-04

GitHub Release 설치용 여섯 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고,
배포 staging의 네 package를 `0.1.0-beta.5`로 고정한다. #73 B2 alpha 그림자와 C1 후속 설계,
리뷰 수정을 포함한다. (#75)

### Added

- Data Scene의 `visual.shadow.shape: "alpha"`로 현재 atlas frame의 투명 윤곽을 지면에 투영한다.
  프레임·UV 반전·회전·원점·scale을 따르며 기존 ellipse/box와 caster budget을 유지한다. (#73 B2)
- normal map, receiver 높이·층, 차폐 광선, view-depth/DOF의 범위·비용·fallback을 독립 후속 설계로 정리했다.
  이 네 효과의 런타임 구현이나 consumer A1~A4 이식을 포함하지 않는다. (#73 C1)

### Fixed

- 태양 방향과 지면 압축을 렌더 명령과 함께 확정해 다음 frame 설정 변경이 현재 frame의 그림자 투영을 바꾸지 않도록 했다.
- 렌더 검증용 snapshot에서 projection metadata도 복사해 엔진 파괴·메모리 재사용 뒤 저장한 값이 바뀌지 않도록 했다. RenderTexture의 alpha 픽셀과 잘못된 metadata 거절 후 기존 이미지 보존 검증을 추가했다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않으며 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 기본 ellipse/box와 공개 import 경로, 15-float/60-byte render command layout을 유지한다. `shape: "alpha"`는 선택 기능이며 JS와 Wasm은 같은 runtime tarball로 함께 업데이트한다.
- custom renderer는 flag 32와 `groundShadowProjection` metadata를 함께 처리해야 한다. 보관하는 frame은 command buffer뿐 아니라 projection typed array도 복사한다.

### Known Limitations

- alpha 그림자는 2D 이미지의 지면 투영 근사다. normal map, 높이·층별 receiver, 차폐 광선, view-depth/DOF는 C1 설계이며 런타임 구현은 포함하지 않는다. #73 A1~A4의 별도 게임 이식도 포함하지 않는다.
- WebGL2 legacy/linear-sRGB 및 WebGPU legacy를 검증했다. WebGPU linear-sRGB는 기존 WebGL2 fallback을 사용하며, 실물 GPU/mobile 성능 검증은 별도다.

## 0.1.0-beta.4 - 2026-10-04

GitHub Release 설치용 다섯 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.4`로 고정한다. #73 B1 입력 API와 후속 리뷰 수정을 포함한다. (#74)

### Added

- `InputManager`에 임의 키·복수 키 바인딩과 JSON action/axis profile을 추가했다. `actionSnapshot()`으로 현재 입력과 프레임 사이의 짧은 누름·해제를 함께 읽을 수 있다.
- `setEnabled()`/`clear()`로 모달·포커스 전환·씬 재시작 때 gameplay 입력을 취소하고, `setVirtualInput()`으로 앱의 가상 입력을 source별로 합성한다.
- `VirtualControls.subscribe()`와 실제 tarball의 `/core`를 사용하는 입력 browser smoke를 추가했다.

### Fixed

- 키·포인터·게임패드·가상 입력을 함께 사용할 때 일부 해제가 다른 source를 지우거나, 모달·창 전환 뒤 held 입력이 다시 살아나던 문제를 수정했다.
- canvas와 가상 버튼/joystick의 마우스 버튼 조합, open Shadow DOM 입력칸, touch fallback 좌표, canvas 소유 창의 gamepad 처리와 잘못된 profile 검증을 보완했다.
- 입력 취소 콜백이 실패해도 리스너·DOM과 runtime 소유 자원 정리를 계속한다. 초기화 실패 시 생성한 physics scene/streaming wrapper를 정리하고 원래 오류와 외부 객체 소유권을 보존한다.

### Upgrade Notes

- 사용 중인 engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않으며, 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 공개 import 경로, 기존 9-field `InputSnapshot`과 Wasm ABI는 유지한다. `pressedActions`는 기존처럼 held 목록이며, 한 번의 누름 처리는 `justPressedActions`를 사용한다.
- `actionSnapshot()`의 edge는 읽으면 소비하므로 프레임마다 한 번 읽고 여러 처리기가 공유한다. `clear()`는 대기 중 edge도 취소한다.
- 입력 비활성화는 시뮬레이션 pause나 클릭 이동 목표를 바꾸지 않는다. 앱의 pause·경로 취소 정책을 함께 연결하고, 초기화된 게임패드는 매핑된 모든 control의 중립 상태를 한 번 확인한 뒤 다시 활성화한다.

### Known Limitations

- context는 단일 gameplay enable gate다. context stack이나 UI/gameplay action 우선순위 router는 제공하지 않는다. 게임패드 poll 사이의 짧은 전환은 관찰할 수 없다.
- #73의 소비자 게임 작업 A1~A4, B2/C1과 기존 게임의 입력 이행은 이 릴리스에 포함하지 않는다. 실물 모바일·게임패드 조합 검증은 남아 있다.

## 0.1.0-beta.3 - 2026-10-04

GitHub Release 설치용 네 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.3`으로 고정한다. #68~#70 구현과 후속 리뷰 수정을 포함한다. (#71)

### Added

- Data Scene 캐릭터마다 독립적인 atlas animation set과 clip/frame/방향/일시정지 전환을 제공한다. 같은 texture를 공유하면서 여러 entity를 하나의 batch로 갱신하고, 잘못되거나 stale한 handle이 있으면 batch 전체를 거부한다. (#68)
- `groundYScale`과 ground/upright sprite로 2.5D 지면 투영을 제공한다. 카메라·입력·조명·문자·particle·collider debug가 같은 투영을 사용하고, world/physics 데이터는 그대로 유지한다. (#69)
- 태양 방향광과 ellipse/box 지면 그림자를 제공한다. sprite의 발 위치·회전·이동과 연결하며, 정적 그림자 cache와 화면 culling, caster 상한으로 비용을 제어한다. (#70)
- 공개 API recipe와 packed runtime의 WebGL2 및 WebGPU offscreen 픽셀·자원·비용 검증을 추가했다.

### Fixed

- 지면 투영에서 원점이 다른 직립 sprite와 world text의 깊이 정렬이 화면의 발·문자 block 위치를 따르도록 수정했다.
- 타원형 점광원의 세로 반경을 그림자 거리·외삽·차폐물 culling과 geometry cache에 반영했다.
- 최소 `groundYScale: 0.01`이 Wasm f32로 반올림된 뒤 renderer 검증에서 거부되던 문제를 수정했다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않는다. 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 기본 `groundYScale: 1`과 기존 animation은 유지한다. `animation`과 `animationSet`은 동시에 지정할 수 없다. reapply 뒤 새 entity handle로 animation/camera/label을 다시 연결한다.
- 투영과 태양 그림자는 선택 기능이다. `createDataSceneView`의 snapshot/lighting을 같은 frame에 공유하고, 사용자 renderer는 투영 capability와 새 render flag를 지원해야 한다.
- 공개 import 경로와 15-float/60-byte render command ABI는 유지한다. 새 frame metadata와 render flag가 있으므로 JS와 Wasm은 동일한 release tarball로 함께 업데이트한다.

### Known Limitations

- 2.5D는 평면 world의 지면 투영과 직립 sprite 표현이다. 3D renderer, PBR/normal map, sprite alpha 윤곽 그림자나 임의 높이의 그림자 수신면은 제공하지 않는다.
- WebGPU 검증은 실제 device/WGSL/queue/readback을 사용하는 offscreen 방식이다. headless native canvas presentation과 실물 GPU/mobile 성능 검증은 포함하지 않는다. linear-sRGB는 WebGL2 fallback을 사용한다.

## 0.1.0-beta.2 - 2026-10-04

GitHub Release 설치용 세 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.2`로 고정한다. #62~#65 구현과 후속 리뷰 수정을 포함한다. (#66)

### Added

- Data Scene sprite와 같은 entity에 optional static/kinematic body와 heightSpan을 연결한다. 물리 이동과 sprite 위치를 별도로 동기화할 필요가 없다. (#64)
- Rust camera follow/bounds/smoothing과 `createDataSceneView`를 추가해 camera, zoom, pointer, world label/light/occluder 좌표를 같은 viewport에 연결한다. (#65)
- 공개 API recipe와 실제 runtime tarball 기반 Data Scene browser 검증을 추가했다.

### Fixed

- sprite origin, tint/alpha, sortOrder를 렌더링에 반영하고 회전된 pivot의 culling을 수정했다. (#62)
- Data Scene은 render layer를 먼저 정렬하고 `depthSort: "hd2d"`를 명시한 sprite에만 높이·발 위치 정렬을 적용한다. heightSpan만 추가해 배경 순서가 바뀌던 문제를 수정했다. (#63)
- Placement Viewer와 생성 프로젝트의 선택 영역·표시가 origin/rotation/scale을 반영하며 회전된 primitive의 크기 조절과 runtime body/depth/tint metadata 보존을 수정했다.
- renderer별 색 공간 옵션을 Data Scene 초기 적용/reapply/transition에 동일하게 전달하고 충돌하는 옵션은 적용 전에 거부한다.
- Data Scene reset/reapply 후 이전 entity handle이 새 객체를 가리키지 않도록 generation을 유지·증가시킨다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않는다. 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 수동 sprite origin/색조 보정 코드는 중복 적용되지 않도록 확인한다. Data Scene 색은 `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`만 허용하며 다른 CSS 색 표현은 오류로 진단한다.
- 높이·Y 정렬을 사용할 sprite에는 `depthSort: "hd2d"`를 지정한다. reset/reapply 뒤 새 entity handle로 camera follow와 label anchor를 다시 연결한다.
- 공개 import 경로와 15-float render command ABI는 유지한다. JS와 Wasm은 동일한 release tarball로 함께 업데이트한다.

## 0.1.0-beta.1 - 2026-10-03

GitHub Release 설치용 두 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.1`로 고정한다.

### Changed

- 초기 설치 지침은 엔진·개발 도구·AI 지침만 설치하고 게임 제작 요청을 기다리도록 정리했다. Release 설치 안내에서 이 경로와 선택형 예제 생성을 구분한다.
- consumer 공통 지침에 플레이 공간·카메라·HUD·에셋 설계와 장르별 예외를 추가하고 Codex·Claude·Gemini가 같은 기준을 참조하도록 했다. 기능 검증과 실제 브라우저 플레이 경험 검수를 분리한다. (#59, #60)
- 기존 AI 지침은 자동으로 덮어쓰지 않는다. 업데이트 시 빈 디렉터리 설치 후 비교·병합하도록 CLI 안내와 설치 보존 검사를 보강했다.

### Fixed

- consumer template catalog 조회를 설치 버전에 맞는 GitHub Release tarball 경로로 안내하고 npm 12의 외부 URL 정책을 반영했다.
- 초기 설치의 게임 파일/빈 디렉터리 생성 방지, 기존 게임 소스·데이터·사용자 지침 보존, 패키지에 포함된 공통 지침 참조 검사를 보강했다.
- 문서 사이트의 저장소 증거 링크를 수정했다.

### Upgrade Notes

- 엔진 public API와 Wasm ABI 변경은 없다. 엔진·viewer·agents URL과 릴리스 출처 metadata는 같은 버전으로 맞춘다.
- `ferrum:agents` 재실행은 기존 파일을 보존한다. 새 지침을 별도 빈 디렉터리에 설치해 기존 skill/agent/command와 루트 managed block을 비교·병합한다.
- 기존 게임의 화면을 자동으로 재설계하지 않으며, 게임 제작·변경 요청 시 새 검수 기준을 적용한다.

## 0.1.0-beta.0 - 2026-10-03

GitHub Releases의 설치 패키지로 제공하는 첫 공개 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.0`으로 고정한다.

### Added

- GitHub Releases의 tarball로 게임 프로젝트를 생성하고 동일 버전의 엔진·뷰어·선택형 AI 도구를 연결하는 설치 경로와 로컬 배포 묶음 검증을 추가했다.
- WebGL2 RenderTexture, opt-in linear-sRGB 색 공간, GPU 자원 통계와 씬 전환 누수 검증을 추가했다.
- KTX2/Basis 압축 텍스처의 Worker 변환과 이미지 fallback, 선택형 비동기 셰이더 준비와 로딩 진행 표시를 추가했다.
- Rust + WebAssembly 기반 2D browser game runtime과 TypeScript platform layer를 제공한다.
- WebGL2 기본 렌더러와 선택형 WebGPU renderer fallback 구조를 제공한다.
- Top-down Shooter, Minimal, Platformer, Breakout starter/template 흐름을 제공한다.
- Game Spec, Physics Spec, Scene Composition, Behavior Recipe, deterministic replay 기반의 data-driven authoring 흐름을 제공한다.
- `@ferrum2d/create-game`으로 새 consumer game project를 생성하는 CLI 흐름을 제공한다.
- `@ferrum2d/agents`로 Codex, Claude, Gemini용 consumer game development agent/skill/command를 설치하는 흐름을 제공한다.
- 생성 프로젝트의 `ferrum:report`, `ferrum:validate`, `ferrum:smoke`, authoring/replay/runtime replay report 루프를 제공한다.
- npm package, consumer smoke, browser smoke, runtime budget, release metadata 검증 흐름을 제공한다.

### Changed

- 프로젝트 기준을 MVP baseline에서 상용제품 기능 개발 단계로 정리했다.
- consumer project는 `@ferrum2d/ferrum-web` public entrypoint만 사용하도록 package/import 경계를 정리했다.
- visual editor 중심이 아니라 AI agent-first 2D game engine 방향에 맞춰 spec, template, validation, smoke artifact 중심의 개발 루프를 정리했다.

### Fixed

- 프로젝트 경로의 셸 인용, 설치 smoke의 실패 보고서 갱신과 시간 초과 시 하위 프로세스 정리를 보완했다.
- consumer browser smoke가 실제 렌더 완료 직후 픽셀과 비용을 측정하도록 수정하고, Chrome 미설치 시 전체 Chromium을 사용하도록 했다.

### Known Limitations

- 정식 `1.0.0` 공개 전까지 public API, package 구조, template contract는 변경될 수 있다.
- visual editor, multiplayer, full game loop Worker migration, Wasm threads, complex physics, 3D rendering은 별도 설계/승인 전 제품 범위에 포함하지 않는다.
- Windows 네이티브 Placement Viewer 검증과 native KHR 지원 실물 GPU/mobile 성능 검증은 남아 있다. 새 renderer 기능별 native WebGPU 지원 범위는 각 API 문서의 fallback 정책을 따른다.
