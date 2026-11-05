# Ferrum2D Platformer

Kinematic platformer controller를 검증하는 장르 예제다. `createFerrumRuntime(...)`과 `FerrumEngine.usePlatformerGame()`이 같은 renderer/input/runtime 경로에서 one-way platform, moving platform, grounded state를 처리하는지 확인한다.

상단의 `체험할 기능`에서 점프·착지 / 단방향 발판 / 이동 발판을 선택하고 `이 위치에서 실험`을 누르면
해당 구역으로 플레이어를 옮긴다. A/D·방향키와 Space로 조작한다.
`충돌 영역 켜고 다시 시작`은 query를 바꿔 충돌 선을 표시하며 씬을 다시 시작한다.
색상 사각형은 controller 판정을 보여주는 fixture다. 경사면 실험은 Physics Sandbox의 platformer-physics 시나리오에서 확인한다.

색상 도형은 공통 흰 텍스처 위에 native tint를 그대로 표시한다. 체크무늬 placeholder로 판정 색이 달라지지 않는다.
상세 DebugOverlay는 `?debug=true`에서 화면 아래에 표시하며 기본 화면은 조작·관찰에 집중한다.
한글 글꼴은 기존 Noto Sans KR subset을 재사용하고 OFL 고지를 `public/fonts/`에 포함한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Scene switch API | `FerrumEngine.usePlatformerGame()`으로 Platformer scene을 선택한다. |
| Kinematic controller | horizontal movement, jump, gravity, max fall speed, coyote/jump buffer tuning을 검증한다. |
| Platform collision | 고정 발판, one-way platform, moving platform를 확인한다. |
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
