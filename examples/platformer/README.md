# Ferrum2D Platformer

Kinematic platformer controller를 검증하는 장르 예제다. `createFerrumRuntime(...)`과 `FerrumEngine.usePlatformerGame()`이 같은 renderer/input/runtime 경로에서 slope, one-way platform, moving platform, grounded state를 처리하는지 확인한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Scene switch API | `FerrumEngine.usePlatformerGame()`으로 Platformer scene을 선택한다. |
| Kinematic controller | horizontal movement, jump, gravity, max fall speed, coyote/jump buffer tuning을 검증한다. |
| Platform collision | slope, one-way platform, moving platform, step block fixture를 확인한다. |
| Landing side effect | player가 grounded 상태로 전환될 때 landing dust particle burst가 생성된다. |
| Physics counters | physics counters/debug line buffer와 runtime budget smoke를 확인한다. |

## 실행

```bash
pnpm dev:platformer
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/platformer dev
```

## 검증

```bash
pnpm --filter @ferrum2d/platformer build
pnpm smoke:platformer
pnpm smoke:platformer-effects
pnpm smoke:platformer-budget
```

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/platformer/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## 참고 문서

- [Runtime extensibility](../../docs/engine/runtime-extensibility.md)
- [2D physics engine map](../../docs/development/architecture/physics-engine.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- Platformer controller를 더 일반화할 때는 one-way platform rule과 scene-specific controller state를 별도 설계로 다룬다.
- Physics Spec fixture와 맞추려면 `examples/physics-sandbox/public/demos/platformer-physics.json`도 함께 확인한다.
