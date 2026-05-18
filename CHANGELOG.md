# CHANGELOG

Ferrum2D의 변경 기록이다. 형식은 Keep a Changelog 관례를 참고하되, 현재 저장소 상태에 맞춰 간단히 유지한다.

## Unreleased

### Changed

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
- Game Spec `atlas.frames`와 `prefabs.*.frame`을 추가해 static atlas frame의 texture name/id, UV rect, frame size를 검증하고 Rust prefab에 적용할 수 있게 했다.
- Game Spec `enemies.presets`와 `enemies.waves`를 추가해 Top-down Shooter wave timeline을 데이터로 설정할 수 있게 했다.
- Game Spec `audio` 필드, `AudioManager.unlock()`, audio bus volume 설정을 추가해 효과음 volume/pitch와 browser audio unlock UX를 정리했다.
- Game Spec `tilemap` 필드와 Rust `Tilemap` render command 경로를 추가해 정적 tile layer를 데이터로 렌더링할 수 있게 했다.
- Game Spec `tilemap.layers.*.collision` 필드와 Rust `Tilemap` AABB push-out을 추가해 player/enemy가 tile 장애물을 통과하지 못하게 했다.

## 0.1.0 - 2026-05-17

상태: MVP 개발 완료

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
- architecture, MVP, roadmap, code review guide 문서
- 최종 MVP 검증 완료 상태 문서화
- Public API 계약 문서와 `FrameHandler`, `InputProvider`, `ViewportProvider` type export

### Changed

- Render command와 audio event는 Rust에서 numeric id만 기록하고 TypeScript platform layer에서 브라우저 resource로 해석한다.
- README를 새 사용자가 예제를 실행할 수 있는 릴리스 진입 문서로 정리했다.
- MVP 제외 범위를 WebGPU, Worker, 3D, editor, multiplayer, complex physics 등으로 명확히 했다.

### Known Limitations

- WebGL2 실제 렌더링은 자동 e2e가 아니라 manual smoke check로 검증한다.
- texture atlas 자동 생성, IndexedDB cache, spatial audio, BGM, complex mixer는 아직 구현하지 않았다.
- WebGPU, Worker, editor, multiplayer, complex physics는 MVP 범위가 아니다.
