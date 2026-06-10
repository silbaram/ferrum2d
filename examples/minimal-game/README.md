# Ferrum2D Minimal Game

새 프로젝트의 가장 작은 실행 형태를 보여주는 예제다. 별도 texture, sound, Game Spec 없이 placeholder texture와 기본 Rust engine state만으로 `createFerrumRuntime(...)` 흐름을 확인한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Runtime bootstrap | `createFerrumRuntime(...)`으로 canvas, renderer, input, frame loop를 연결한다. |
| Placeholder rendering | asset manifest 없이 WebGL2 placeholder texture와 render command buffer를 사용한다. |
| UiOverlay | 기본 Dialogue 예제와 content runtime showcase를 DOM overlay로 표시한다. |
| Content runtime smoke | `?contentRuntimeSmoke=true`에서 localization, cutscene, HUD, accessibility, animation timeline을 한 번에 확인한다. |
| Visual smoke modes | lighting, material, camera post-process, particle VFX smoke fixture로도 사용한다. |
| DebugOverlay | `?debug=true`, `?environment=production`, `?physicsDebugLines=true` query로 runtime/debug 상태를 전환한다. |

## Lab Profile 결정

현재는 별도 visual/input-ui 예제로 분리하지 않는다. `examples/minimal-game`을 `Minimal Runtime Lab`으로 유지하고, 기본 화면은 가장 작은 bootstrap 예제로 둔다. Smoke 전용 query profile은 아래 두 lab으로 문서화한다.

| Lab profile | Smoke/query | 범위 |
| --- | --- | --- |
| `visual-runtime-lab` | `pnpm smoke:lighting`, `pnpm smoke:lighting-webgpu`, `pnpm smoke:material`, `pnpm smoke:material-webgpu`, `pnpm smoke:camera-postprocess`, `pnpm smoke:particle-vfx` | renderer lighting, sprite material, fullscreen post-process, particle VFX 같은 platform visual regression |
| `input-ui-lab` | `pnpm smoke:preload`, `pnpm smoke:mobile-input`, `pnpm smoke:content-runtime` | LoadingOverlay/preload cache, VirtualControls input transform, UiOverlay HUD/dialog/subtitle/content runtime 연결 |

이 profile들은 smoke/manual QA용 진입점이며 public portfolio demo나 사용자-facing in-app profile switcher가 아니다. 새 profile을 추가할 때는 query flag, `tests/smoke/browser-render-smoke.mjs` mode, 이 표를 함께 갱신한다.

## 실행

```bash
pnpm dev:minimal
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/minimal-game dev
```

기본 실행은 development runtime으로 시작한다. 상용 기본값처럼 DebugOverlay를 끄려면 `?environment=production`을 붙인다.

## 검증

```bash
pnpm --filter @ferrum2d/minimal-game build
pnpm smoke:preload
pnpm smoke:mobile-input
pnpm smoke:content-runtime
pnpm smoke:screenshot-capture
```

시각 효과 회귀는 `pnpm smoke:lighting`, `pnpm smoke:material`, `pnpm smoke:camera-postprocess`, `pnpm smoke:particle-vfx`에서 같은 예제 dist를 사용한다.

## Pages 노출

현재 `pnpm build:pages` 홈에는 직접 노출하지 않는다. Minimal Game은 public portfolio보다 `Minimal Runtime Lab`의 runtime smoke, visual fixture, input/UI fixture 역할을 우선한다.

## 참고 문서

- [Public API](../../docs/engine/public-api.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)

## 다음 단계

- 실제 asset 흐름이 필요하면 `engine.loadAssets(...)`와 texture id 매핑을 연결한다.
- 새 smoke query가 늘어나면 `visual-runtime-lab` 또는 `input-ui-lab` 중 하나에 배치하고, 별도 예제 분리는 public portfolio 승격이 필요할 때만 검토한다.
- Top-down Shooter 수치 조정은 `examples/topdown-shooter/public/game.json` 흐름을 따른다.
- 새 장르 runtime이 필요하면 Rust scene/module 계약을 먼저 설계한다.
