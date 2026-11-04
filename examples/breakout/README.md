# Ferrum2D Breakout

Ferrum2D의 두 번째 장르 예제다. Top-down Shooter 전용 Game Spec 없이 Rust core의 Breakout scene mode를 실행해 같은 browser runtime/API가 다른 장르에서도 동작하는지 검증한다.

상단에서 공·벽·패들 충돌과 충돌 이벤트·파티클의 관찰 안내를 선택한다.
A/D·방향키로 패들을 움직이고 `충돌 영역 켜고 다시 시작`으로 판정 형태를 비교한다.
`hits`는 현재 프레임 이벤트 수이며 `particles`는 살아 있는 파티클 수다.

색상 도형은 공통 흰 텍스처 위에 native tint를 그대로 표시한다. 체크무늬 placeholder로 판정 색이 달라지지 않는다.
상세 DebugOverlay는 `?debug=true`에서 화면 아래에 표시하며 기본 화면은 조작·관찰에 집중한다.
한글 글꼴은 기존 Noto Sans KR subset을 재사용하고 OFL 고지를 `public/fonts/`에 포함한다.

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
