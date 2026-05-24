# Ferrum2D Platformer

```bash
pnpm --filter @ferrum2d/platformer dev
```

이 예제는 `createFerrumRuntime(...)`과 `FerrumEngine.usePlatformerGame()`이 같은 WebGL2 renderer, input, render command buffer, physics counters/debug line buffer를 재사용해 kinematic platformer controller를 실행하는지 검증한다. Player가 공중에서 grounded 상태로 전환될 때 Rust scene-internal landing dust particle burst가 생성되며 HUD의 `particles` 값으로 live particle 수를 확인할 수 있다.


자동 effect smoke는 다음 명령으로 실행한다.

```bash
pnpm smoke:platformer-effects
```
