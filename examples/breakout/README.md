# Ferrum2D Breakout

Ferrum2D의 두 번째 장르 예제다. Top-down Shooter 전용 Game Spec 없이 Rust core의 Breakout scene mode를 실행해 paddle, ball, brick, wall collision과 score/game state/debug overlay 경로를 검증한다.

```bash
pnpm --filter @ferrum2d/breakout dev
```

브라우저에서 Vite URL을 열면 `createFerrumRuntime(...)`과 `FerrumEngine.useBreakoutGame()`이 같은 WebGL2 renderer, input, render command buffer, collision event/debug line buffer를 재사용하는지 확인할 수 있다.
