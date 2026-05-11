# CHANGELOG

Ferrum2D의 변경 기록이다. 형식은 Keep a Changelog 관례를 참고하되, 현재 저장소 상태에 맞춰 간단히 유지한다.

## 0.1.0 - 2026-04-29

상태: MVP 릴리스 준비

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

### Changed

- Render command와 audio event는 Rust에서 numeric id만 기록하고 TypeScript platform layer에서 브라우저 resource로 해석한다.
- README를 새 사용자가 예제를 실행할 수 있는 릴리스 진입 문서로 정리했다.
- MVP 제외 범위를 WebGPU, Worker, 3D, editor, multiplayer, complex physics 등으로 명확히 했다.

### Known Limitations

- WebGL2 실제 렌더링은 자동 e2e가 아니라 manual smoke check로 검증한다.
- texture atlas, IndexedDB cache, spatial audio, BGM, complex mixer는 아직 구현하지 않았다.
- WebGPU, Worker, editor, multiplayer, complex physics는 MVP 범위가 아니다.
