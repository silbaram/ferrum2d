# Ferrum2D Minimal Game

이 예제는 새 프로젝트의 가장 작은 실행 형태를 보여준다. 별도 texture, sound, Game Spec 파일 없이 `WebGL2Renderer`의 placeholder texture와 기본 Rust engine state만 사용한다.

## 실행

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/minimal-game dev
```

브라우저에서 Vite URL을 열면 `createFerrumRuntime(...)`이 engine loop, input snapshot, render command buffer, WebGL2 renderer, BrowserPlatformHost, DebugOverlay를 연결한 상태를 확인할 수 있다.

기본 실행은 starter 개발 흐름을 보여주기 위해 `environment: "development"`로 runtime을 생성한다. 상용 기본값처럼 DebugOverlay를 끄려면 URL에 `?environment=production`을 붙인다. 명시적으로 제어하려면 `?debug=true` 또는 `?debug=false`를 사용할 수 있다.

## 다음 단계

- 실제 게임 asset이 필요하면 `engine.loadAssets(...)`와 `engine.setTextureIds(...)`를 연결한다.
- Top-down Shooter 수치 조정이 필요하면 `examples/topdown-shooter/public/game.json` 흐름을 따른다.
- 새 장르 runtime이 필요하면 Rust core 쪽 scene/module 계약을 먼저 설계한다.
