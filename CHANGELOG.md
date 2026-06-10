# CHANGELOG

Ferrum2D의 공식 공개 릴리즈 변경 기록이다. 정식 공개 전 내부 개발 이력은 커밋, PR, 개발 문서에 남기고, 이 파일에는 사용자와 배포자가 알아야 할 릴리즈 단위 변경만 요약한다.

형식은 Keep a Changelog 관례를 참고하되, Ferrum2D의 첫 정식 공개 버전은 `1.0.0`부터 기록한다.

## Unreleased

정식 `1.0.0` 공개 전 준비 중인 제품 범위 요약이다. 아래 항목은 세부 구현 로그가 아니라 첫 공개 버전에 포함될 사용자-facing 변화만 정리한다.

### Added

- Rust + WebAssembly 기반 2D browser game runtime과 TypeScript platform layer를 준비했다.
- WebGL2 기본 렌더러와 선택형 WebGPU renderer fallback 구조를 준비했다.
- Top-down Shooter, Minimal, Platformer, Breakout starter/template 흐름을 준비했다.
- Game Spec, Physics Spec, Scene Composition, Behavior Recipe, deterministic replay 기반의 data-driven authoring 흐름을 준비했다.
- `@ferrum2d/create-game`으로 새 consumer game project를 생성하는 CLI 흐름을 준비했다.
- `@ferrum2d/agents`로 Codex, Claude, Gemini용 consumer game development agent/skill/command를 설치하는 흐름을 준비했다.
- 생성 프로젝트의 `ferrum:report`, `ferrum:validate`, `ferrum:smoke`, authoring/replay/runtime replay report 루프를 준비했다.
- npm package, consumer smoke, browser smoke, runtime budget, release metadata 검증 흐름을 준비했다.

### Changed

- 프로젝트 기준을 MVP baseline에서 상용제품 기능 개발 단계로 정리했다.
- consumer project는 `@ferrum2d/ferrum-web` public entrypoint만 사용하도록 package/import 경계를 정리했다.
- visual editor 중심이 아니라 AI agent-first 2D game engine 방향에 맞춰 spec, template, validation, smoke artifact 중심의 개발 루프를 정리했다.

### Known Limitations

- 정식 `1.0.0` 공개 전까지 public API, package 구조, template contract는 변경될 수 있다.
- visual editor, multiplayer, full game loop Worker migration, Wasm threads, complex physics, 3D rendering은 별도 설계/승인 전 제품 범위에 포함하지 않는다.
