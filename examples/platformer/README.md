# Ferrum2D Platformer

Kinematic platformer controller를 검증하는 장르 예제다. `createFerrumRuntime(...)`과 `FerrumEngine.usePlatformerGame()`이 같은 renderer/input/runtime 경로에서 one-way platform, moving platform, grounded state를 처리하는지 확인한다.

상단의 `체험할 기능`에서 점프·착지 / 단방향 발판 / 이동 발판을 선택하고 `이 위치에서 실험`을 누르면
해당 구역으로 플레이어를 옮긴다. A/D·방향키와 Space로 조작하며, 터치 화면에서는 왼쪽·오른쪽·점프 버튼을 사용한다.
`충돌 영역 켜고 다시 시작`은 query를 바꿔 충돌 선을 표시하며 씬을 다시 시작한다.
색상 사각형은 controller 판정을 보여주는 fixture다. 경사면 실험은 Physics Sandbox의 platformer-physics 시나리오에서 확인한다.

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
pnpm --filter @ferrum2d/platformer lint
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
