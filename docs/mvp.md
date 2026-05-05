# Ferrum2D MVP 범위

## 목표

Ferrum2D MVP의 목표는 Rust/Wasm 기반 2D 웹 게임 엔진의 최소 수직 슬라이스를 완성하는 것이다. 단일 예제인 Top-down Shooter로 입력, 업데이트, 충돌, 렌더링, 에셋, 오디오, 디버그, 테스트 흐름을 검증한다.

## MVP에 포함

- Rust core 업데이트 루프
- World/entity 저장과 간단한 component store
- Transform, velocity, sprite, collider
- Player-follow 2D camera와 viewport size 전달
- MVP 2D physics: velocity integration, collider 기반 world bounds clamp
- AABB collision
- Render command buffer 기반 Rust -> TypeScript bulk 전달
- WebGL2 sprite rendering
- Keyboard/mouse input
- Manifest 기반 texture, sound, JSON loading
- JSON Game Spec 기반 Top-down Shooter 수치, prefab 크기, combat, enemy behavior/spawn preset 설정
- TextureRegistry와 SoundRegistry
- Rust AudioEvent buffer와 TypeScript Web Audio 재생
- Title, Playing, GameOver scene state
- Top-down Shooter 전용 `ShooterScene`
- Top-down Shooter 예제
- DOM 기반 DebugOverlay
- Rust unit test
- TypeScript Node test runner 기반 platform test
- GitHub Actions 기반 기본 검증

## MVP에서 제외

- WebGPU
- Worker/멀티스레딩
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 physics engine
- scripting/plugin system
- IndexedDB cache
- texture atlas 자동 생성
- skeletal animation
- spatial audio
- BGM/mixer system
- 외부 scene graph/prefab file loading

## Top-down Shooter 완료 기준

- Title에서 Enter 또는 Space로 Playing에 진입한다.
- W/A/S/D로 player가 이동한다.
- Mouse Left 또는 Space로 마우스 방향 bullet을 발사한다.
- enemy가 주기적으로 spawn되고 player 방향으로 이동한다.
- bullet과 enemy가 충돌하면 둘 다 제거되고 score가 증가한다.
- enemy와 player가 충돌하면 GameOver가 된다.
- GameOver에서 Space로 재시작한다.
- player/enemy/bullet texture가 manifest로 로드되고 texture_id와 일치한다.
- shoot/hit/gameOver sound가 manifest로 로드되고 audio event로 재생된다.
- `json.game` Game Spec으로 world 크기, 이동 속도, enemy spawn interval/pattern, enemy behavior preset, health/damage/score reward, bullet 설정, player/enemy/bullet prefab 크기를 조정할 수 있다.
- DebugOverlay에서 FPS, frame time, entity count, sprite count, draw calls, batches, Rust update time, render time, mouse position, game state, score를 확인할 수 있다.
- DebugOverlay에서 camera position을 확인할 수 있다.

## 현재 구현 상태 (2026-04-29)

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| Monorepo bootstrap | 완료 | pnpm workspace, Rust crate, TS package, example 구성 |
| Rust/Wasm bridge | 완료 | Engine export, ptr/len buffer, ABI 검증 |
| TypeScript GameLoop | 완료 | RAF 기반 start/stop, delta clamp |
| WebGL2 renderer | 완료 | sprite rendering, texture_id batch, stats |
| Render command buffer | 완료 | Rust 생성, TS typed array 소비 |
| Input | 완료 | keyboard/mouse snapshot |
| World/Entity | 완료 | entity id, generation, despawn |
| AABB collision | 완료 | overlap pair와 shooter collision 처리 |
| Shooter game logic | 완료 | movement, fire, spawn, chase, score, game over |
| Scene state | 완료 | Title, Playing, GameOver, restart |
| AssetLoader | 완료 | textures, sounds, JSON manifest |
| Game Spec | 완료 | `json.game` 검증 후 shooter config, prefab template, combat, enemy behavior/spawn preset 적용 |
| Game Spec CLI | 완료 | `pnpm validate:game-spec`로 예제 JSON 검증 |
| Agent workflow | 완료 | game designer skill, agent workflow, review checklist, variant CLI |
| AudioManager | 완료 | Web Audio 기반 효과음 재생 |
| DebugOverlay | 완료 | DOM overlay, debug=false 지원 |
| Tests | 완료 | Rust unit test, TS Node test |
| Release docs | 완료 | README, docs, CHANGELOG 정리 |

## 수동 검증

1. `pnpm build:wasm` 실행
2. `pnpm --filter @ferrum2d/topdown-shooter dev` 실행
3. 브라우저에서 Vite URL 접속
4. Title -> Playing -> GameOver -> restart 흐름 확인
5. score 증가와 GameOver 발생 확인
6. DebugOverlay 수치가 표시되는지 확인
7. `?debug=false`에서 overlay가 숨겨지는지 확인
8. 발사, 피격, 게임오버 효과음이 중복 없이 재생되는지 확인

## 릴리스 전 필수 검증

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm test
pnpm build
pnpm validate:game-spec
```

WebGL2 실제 화면 렌더링은 headless unit test 범위가 아니므로 예제 manual smoke check를 함께 수행한다.
