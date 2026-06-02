# Ferrum2D Starter Runtime

`createFerrumRuntime(...)`로 Ferrum2D 브라우저 runtime을 시작하는 가장 작은 예제다. 별도 texture, sound, Game Spec 없이 기본 Rust engine state와 placeholder texture만 사용한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Runtime bootstrap | canvas, renderer, input, audio host, frame loop를 `createFerrumRuntime(...)`로 생성한다. |
| Demo shell | `examples/shared`의 공통 shell로 canvas, controls, metric panel, smoke hook을 재사용한다. |
| Render command buffer | Rust가 만든 sprite command를 WebGL2 renderer가 소비한다. |
| UiOverlay | runtime frame state를 HUD/dialog로 표시한다. |
| DebugOverlay | development 환경에서 frame/render/physics metric을 표시한다. |
| Runtime profiler | `?profilerSmoke=true`로 browser budget smoke sample을 수집한다. |

## 실행

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/starter-runtime dev
```

DebugOverlay를 끄려면 `?environment=production` 또는 `?debug=false`를 사용한다.

## 검증

```bash
pnpm smoke:starter-runtime
pnpm smoke:starter-runtime-budget
```

## 다음 단계

- texture/sound/JSON asset이 필요하면 `examples/topdown-shooter`의 manifest 흐름을 따른다.
- lighting, material, post-process, particle VFX를 확인하려면 현재 `examples/minimal-game`의 visual smoke mode를 참고한다.
- 새 Physics Spec fixture를 확인하려면 `examples/physics-sandbox`를 사용한다.
