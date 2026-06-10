# Ferrum2D Top-down Shooter

Ferrum2D의 대표 Game Spec 기반 예제다. `public/game.json`으로 atlas animation, tilemap collision, wave, audio, camera, authored gameplay behavior를 구성하고, Rust core의 built-in Shooter scene을 browser runtime에서 검증한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Game Spec runtime | `examples/topdown-shooter/public/game.json`을 읽어 Shooter config, texture/audio id, wave, tilemap, animation을 적용한다. |
| WebGL2 renderer | Rust render command buffer를 WebGL2 sprite renderer가 소비한다. |
| Shooter gameplay | player movement, projectile, enemy waves, score, GameOver, audio event를 검증한다. |
| Authored behavior variant | `public/authored-behavior.variant.json`으로 SceneComposition, Behavior Recipe, FSM, gameplay actions를 낮은 빈도 경계에서 적용한다. |
| Snapshot/replay | built-in Shooter snapshot, save/load, deterministic gameplay replay hash를 검증한다. |
| Runtime budget | Top-down effects, mass object, HD2D/destructible terrain smoke로 browser/runtime budget을 확인한다. |

## 실행

```bash
pnpm dev:topdown
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

## 검증

```bash
pnpm --filter @ferrum2d/topdown-shooter build
pnpm validate:game-spec
pnpm validate:topdown-authored-behavior-variant
pnpm smoke:headless
pnpm smoke:topdown
pnpm smoke:topdown-save-load
pnpm smoke:gameplay-replay
pnpm smoke:topdown-authored-behavior-runtime
pnpm smoke:topdown-mass-objects
```

변경 범위가 renderer/runtime budget이면 `pnpm smoke:topdown-budget`, HD2D면 `pnpm smoke:topdown-hd2d`, destructible terrain이면 `pnpm smoke:destructible-terrain-browser`도 함께 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/topdown-shooter/`에 복사하고 Pages 홈의 primary demo link로 노출한다.

## Runtime Extensibility 노출 범위

Top-down Shooter의 public demo surface는 기본 `game.json` 기반 Shooter runtime이다. Runtime extensibility showcase는 기본 화면에 별도 profile selector를 추가하지 않고, 다음 두 경계로 제한한다.

| 경계 | 노출 방식 | 용도 |
| --- | --- | --- |
| Variant summary | production build가 `authored-behavior.variant.json`을 preload/load하고 `window.ferrumTopdownAuthoredBehaviorVariant` summary를 만든다. | agent/smoke가 variant와 replay 계약을 확인한다. |
| Variant apply toggle | `?authoredBehaviorVariantApply=true`가 있을 때만 scene load 이후 낮은 빈도 경로에서 variant instance와 behavior/FSM command를 Rust component storage에 적용한다. | browser smoke와 manual QA가 authored gameplay 흐름을 실제 runtime에서 확인한다. |
| Window-only helpers | `ferrumTopdownAuthoredBehaviorStart()`, `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`, `ferrumTopdownAuthoredBehaviorResetAndReapply()`를 smoke 전용 helper로 노출한다. | state command apply, reset/reapply, stale handle 회귀를 검증한다. |

현재 노출 범위에는 frame hot path callback, visual editor, state-entry 자동 apply runtime, 사용자용 in-app profile switcher를 포함하지 않는다. 이 범위를 넓힐 때는 public API 계약, `pnpm smoke:topdown-authored-behavior-runtime`, replay fixture/hash 영향을 함께 갱신한다.

## 참고 문서

- [Top-down Shooter Game Spec](../../docs/examples/topdown-shooter/game-spec.md)
- [Public API](../../docs/engine/public-api.md)
- [Top-down Shooter smoke checklist](../../docs/development/quality/topdown-shooter-smoke-checklist.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- Game Spec field를 바꾸면 schema, `docs/examples/topdown-shooter/game-spec.md`, validation, smoke를 함께 갱신한다.
- Runtime extensibility profile 노출을 늘릴 때는 public API와 agent smoke가 검증할 수 있는 낮은 빈도 authoring 경계로 유지하고, 기본 demo UI와 smoke-only helper를 섞지 않는다.
