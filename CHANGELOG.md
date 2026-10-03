# CHANGELOG

Ferrum2D의 공식 공개 릴리즈 변경 기록이다. 정식 공개 전 내부 개발 이력은 커밋, PR, 개발 문서에 남기고, 이 파일에는 사용자와 배포자가 알아야 할 릴리즈 단위 변경만 요약한다.

형식은 Keep a Changelog 관례를 참고한다. 공개 beta는 prerelease 버전으로 기록하며, 첫 정식 버전은 `1.0.0`을 목표로 한다.

## Unreleased

### Changed

- 아직 기록할 변경 사항이 없다.

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
