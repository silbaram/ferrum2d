# CHANGELOG

Ferrum2D의 공식 공개 릴리즈 변경 기록이다. 정식 공개 전 내부 개발 이력은 커밋, PR, 개발 문서에 남기고, 이 파일에는 사용자와 배포자가 알아야 할 릴리즈 단위 변경만 요약한다.

형식은 Keep a Changelog 관례를 참고한다. 공개 beta는 prerelease 버전으로 기록하며, 첫 정식 버전은 `1.0.0`을 목표로 한다.

## Unreleased

### Changed

- 아직 기록할 변경 사항이 없다.

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
