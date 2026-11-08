# Ferrum2D Breakout

Ferrum2D의 두 번째 장르 예제다. Top-down Shooter 전용 Game Spec 없이 Rust core의 Breakout scene mode를 실행해 같은 browser runtime/API가 다른 장르에서도 동작하는지 검증한다.

상단에서 공·벽·패들 충돌과 충돌 이벤트·파티클의 관찰 안내를 선택한다.
A/D·방향키 또는 터치 이동 버튼으로 패들을 움직이고 `충돌 영역 켜고 다시 시작`으로 판정 형태를 비교한다.
`hits`는 현재 프레임 이벤트 수이며 `particles`는 살아 있는 파티클 수다.

색상 도형은 공통 흰 텍스처 위에 native tint를 그대로 표시한다. 체크무늬 placeholder로 판정 색이 달라지지 않는다.
상세 DebugOverlay는 `?debug=true`에서 화면 아래에 표시하며 기본 화면은 조작·관찰에 집중한다.
한글 글꼴은 기존 Noto Sans KR subset을 재사용하고 OFL 고지를 `public/fonts/`에 포함한다.

## 화면과 조작

- 상단에는 현재 상태에 필요한 시작·처음부터·일시정지·계속하기만 표시한다. 정지 중 초기화해도 바로 진행한다.
- `P` / `Esc`로 정지·계속할 수 있고, 다른 탭으로 이동하면 자동으로 멈춘다.
- 800×480 논리 화면을 유지해 작은 창에서도 같은 범위의 판정을 본다. 큰 창에서는 정수 배율과 레터박스를 적용한다.
- 700px 이하 또는 터치 기기에서는 화면 아래 조작 버튼을 제공한다. 정지·초기화 시 누르던 입력은 해제한다.
- 캔버스 아래 색상 안내로 플레이어/패들·공·발판을 구분한다. 색상 도형은 실제 native 충돌 fixture이며 장식 아트로 판정 범위를 가리지 않는다.

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
pnpm --filter @ferrum2d/breakout lint
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
