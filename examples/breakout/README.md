# Ferrum2D Breakout

Ferrum2D의 두 번째 장르 예제다. Top-down Shooter 전용 Game Spec 없이 Rust core의 Breakout scene mode를 실행해 같은 browser runtime/API가 다른 장르에서도 동작하는지 검증한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Scene switch API | `FerrumEngine.useBreakoutGame()`으로 Breakout scene을 선택한다. |
| Runtime reuse | `createFerrumRuntime(...)`, WebGL2 renderer, input, render command buffer를 Top-down Shooter와 공유한다. |
| Collision events | paddle, ball, brick, wall collision과 brick hit event를 검증한다. |
| Particle side effect | brick hit 시 Rust scene-internal particle burst가 생성되고 HUD의 `particles` 값으로 관측된다. |
| Debug/budget metrics | renderer stats, collision debug line buffer, runtime budget smoke를 확인한다. |

## 실행

```bash
pnpm dev:breakout
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/breakout dev
```

## 검증

```bash
pnpm --filter @ferrum2d/breakout build
pnpm smoke:breakout
pnpm smoke:breakout-effects
pnpm smoke:breakout-budget
```

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/breakout/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## 참고 문서

- [Runtime extensibility](../../docs/engine/runtime-extensibility.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- Breakout을 create-game template처럼 배포하려면 `packages/create-game/templates/breakout`과 package consumer smoke matrix를 함께 갱신한다.
- 추가 장르 primitive를 넣을 때는 scene-specific rule과 reusable runtime primitive를 분리해서 검증한다.
