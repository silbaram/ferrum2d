# CHANGELOG

Ferrum2D의 변경 기록이다. 형식은 Keep a Changelog 관례를 참고하되, 현재 저장소 상태에 맞춰 간단히 유지한다.

## Unreleased

### Changed

- `pnpm smoke:breakout-effects`와 `pnpm smoke:platformer-effects`를 추가해 Breakout/Platformer scene-internal particle effects가 browser render path에 도달하는지 검증하도록 했다.
- Platformer landing transition에 scene-internal Particles v1 dust burst를 연결하고 예제 HUD에 live particle count를 표시하도록 했다.
- Breakout brick hit event에 scene-internal Particles v1 burst를 연결하고 예제 HUD에 live particle count를 표시하도록 했다.
- `pnpm smoke:topdown`을 추가해 Top-down Shooter production build에서 particle burst와 non-lethal enemy tint flash가 browser render path에 도달하는지 검증하도록 했다.
- Rust core에 scene-internal `TweenSystem`을 추가하고 Top-down Shooter non-lethal enemy hit에서 enemy sprite tint flash를 시작하도록 연결했다.
- Top-down Shooter bullet/enemy hit event에 Particles v1 burst를 연결하고 예제 bootstrap에서 hit particle preset을 등록하도록 했다.
- `pnpm smoke:headless`가 Wasm runtime을 로드해 particle preset/burst/count/render command append sanity를 검증하도록 보강했다.
- Tween v1 범위를 scene-internal `SpriteTint` target으로 제한하고 Web public API/Game Spec 확장 보류를 문서화했다.
- `FerrumEngine.setParticlePreset(...)`, `setShooterHitParticlePreset(...)`, `spawnParticleBurst(...)`, `particleCount()` 등 Particles v1 Web public API와 Rust/Wasm binding을 추가하고, particle render commands를 기존 render command buffer에 연결했다.
- Rust core에 `ParticleSystem` primitive를 추가해 seeded burst spawn, lifetime/update, capacity 제한, color/size interpolation, 기존 `SpriteRenderCommand` append를 단위 테스트로 검증했다.
- Product 1.0 Particles/Tweens 후보의 사전 범위, Rust/TypeScript 책임 경계, 구현 순서를 문서화했다.
- GitHub Release 본문 작성을 위한 릴리스 노트 템플릿과 generated release notes label category 설정을 추가했다.
- `pnpm build:pages`가 `docs/*.md`를 `dist-pages/docs/` HTML 문서 사이트로 렌더링하고 Pages home에서 데모와 문서를 함께 연결하도록 확장했다.
- `pnpm release:check`와 tag push CI 검증을 추가해 `@ferrum2d/ferrum-web` beta release version, changelog section, Git tag 이름을 함께 확인하도록 했다.
- AssetLoader, AudioManager, Game Spec validator의 오류 메시지를 `kind`, `name` 또는 `id`, `url` 또는 `path`, `detail` context 형식으로 표준화했다.
- Top-down Shooter 예제가 누락된 texture/sound/Game Spec 적용 실패를 console과 HUD에서 보고하도록 보강했다.
- `BrowserPlatformHost`를 추가해 asset/audio host 책임을 `WebGL2Renderer`에서 분리했다.
- `AudioAssetLoader`를 추가해 sound fetch/decode 책임을 `AudioManager` playback lifecycle에서 분리했다.
- `createEngine()` 프레임 처리 단계를 입력, viewport, Rust update, audio drain, frame state 생성 함수로 분리했다.
- Top-down Shooter bootstrap 실패 경로에서도 생성된 renderer/input/debug/engine/audio resource를 정리하도록 보강했다.
- `FerrumEngine`, renderer, texture/audio/input/debug/platform host의 `destroy()` 중복 호출을 안전한 no-op으로 정리했다.
- DebugOverlay 표시명/단위/순서와 `RendererStats` 필드 계약을 테스트와 문서로 고정했다.
- `pnpm smoke:check`와 `docs/smoke-check.md`를 추가해 로컬 smoke check와 브라우저 수동 확인 절차를 고정했다.
- Game Spec `camera` 필드와 Rust camera preset을 추가해 follow, dead-zone, look-ahead, time-based shake를 설정할 수 있게 했다.
- Camera post-process, lighting/material, particle VFX, mobile input, WebGPU 선택 렌더러 smoke를 확장해 브라우저 렌더링 회귀 검증 범위를 넓혔다.
- Game Spec `atlas.frames`와 `prefabs.*.frame`을 추가해 static atlas frame의 texture name/id, UV rect, frame size를 검증하고 Rust prefab에 적용할 수 있게 했다.
- Game Spec `enemies.presets`와 `enemies.waves`를 추가해 Top-down Shooter wave timeline을 데이터로 설정할 수 있게 했다.
- Game Spec `audio` 필드, `AudioManager.unlock()`, audio bus volume 설정을 추가해 효과음 volume/pitch와 browser audio unlock UX를 정리했다.
- Game Spec `tilemap` 필드와 Rust `Tilemap` render command 경로를 추가해 정적 tile layer를 데이터로 렌더링할 수 있게 했다.
- Game Spec `tilemap.layers.*.collision` 필드와 Rust `Tilemap` AABB push-out을 추가해 player/enemy가 tile 장애물을 통과하지 못하게 했다.
- Game Spec `content` namespace와 `createShooterContentRuntimeOptions(...)`를 추가해 localization, dialogue graph, cutscene 데이터를 runtime option으로 연결할 수 있게 했다.
- `createFerrumRuntime(...)`에 dialogue, cutscene, localization, HUD, accessibility, animation timeline, level streaming opt-in runtime adapter를 추가했다.
- Minimal Game의 content runtime showcase와 `pnpm smoke:content-runtime`을 추가해 localized cutscene dialogue, HUD, subtitle/accessibility panel, animation timeline event report를 브라우저에서 검증하도록 했다.
- Runtime extensibility 계층에 Behavior Recipe, Scene Composition, gameplay event action, presentation effect, FSM authoring/replay/install helper를 추가하고 Rust-owned component/action/reaction 경로와 연결했다.
- Rust physics authoring/solver 범위를 rigid body, collider, joint 8종, material/contact tuning, CCD/debug query, HD-2D height span/navigation/combat smoke까지 확장했다.
- Level streaming manifest/plan/streamer와 runtime adapter를 추가하고, preload/load/unload target, renderer texture eviction, collider rebuild hook, tilemap/픽셀마스크 chunk boundary alignment를 `pnpm smoke:level-streaming`으로 검증하도록 했다.
- `create-game` 템플릿 catalog를 `minimal`/`topdown`/`platformer`/`breakout` 4종으로 확장하고, template별 scene authoring, gameplay replay, runtime replay fixture와 consumer smoke report 검증을 추가했다.
- Consumer agent/skill/template harness를 보강해 Game Spec, gameplay, asset pipeline, project validation 루프를 생성 프로젝트에 함께 설치하도록 했다.
- Asset pipeline e2e smoke를 추가해 raw sprite folder에서 texture atlas/Game Spec frame 병합, audio/localization manifest 검증까지 이어지는 agent import workflow를 검증하도록 했다.
- GitHub Actions validate job, 선택형 extended browser smoke matrix, runtime budget artifact, Pages post-deploy route check를 보강했다.
- `@ferrum2d/ferrum-web` npm beta package 후보의 explicit artifact allowlist, `pnpm pack` 검증, release 절차 문서를 추가했다.
- 공개 배포 메타데이터와 패키지 파일을 `MIT OR Apache-2.0` 듀얼 라이선스로 정리했다.
- `createFerrumRuntime()`의 debug overlay 기본값을 development/production environment로 분리하고 초기화 실패 시 browser resource cleanup을 보강했다.
- 문서의 현재 개발 단계를 **MVP 개발 완료, 상용제품 기능 개발** 기준으로 정리했다.

## 0.1.0 - 2026-05-17

상태: MVP 개발 완료, 상용제품 기능 개발의 baseline release

### Added

- Rust core crate `crates/ferrum-core`
- TypeScript platform package `packages/ferrum-web`
- Vite 기반 `examples/topdown-shooter`
- Rust/Wasm `Engine` bridge
- `World`, entity id generation, transform, velocity, sprite, collider 저장
- AABB collision
- Top-down Shooter game logic
- Title, Playing, GameOver scene state
- score, game over, restart flow
- `SpriteRenderCommand` buffer와 WebGL2 sprite renderer
- texture manifest loading, TextureRegistry, TextureManager
- sound manifest loading, SoundRegistry, AudioManager
- Rust `AudioEvent` buffer와 Web Audio 효과음 연결
- DOM 기반 DebugOverlay
- Rust unit tests
- TypeScript Node test runner 기반 tests
- GitHub Actions CI workflow
- architecture, 완료된 MVP 기준, roadmap, code review guide 문서
- MVP 개발 완료와 상용제품 기능 개발 baseline 상태 문서화
- Public API 계약 문서와 `FrameHandler`, `InputProvider`, `ViewportProvider` type export

### Changed

- Render command와 audio event는 Rust에서 numeric id만 기록하고 TypeScript platform layer에서 브라우저 resource로 해석한다.
- README를 새 사용자가 예제를 실행할 수 있는 릴리스 진입 문서로 정리했다.
- 완료된 MVP 기준 제외 범위를 WebGPU, Worker, 3D, editor, multiplayer, complex physics 등으로 명확히 했다.

### Known Limitations

- WebGL2 실제 렌더링은 자동 e2e가 아니라 manual smoke check로 검증한다.
- texture atlas 자동 생성, IndexedDB cache, spatial audio, BGM, complex mixer는 아직 구현하지 않았다.
- WebGPU, Worker, editor, multiplayer, complex physics는 현재 제품 범위가 아니다.
