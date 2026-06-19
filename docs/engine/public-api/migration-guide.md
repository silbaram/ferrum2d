# Public API Migration Guide

이 문서는 기존 consumer 코드가 `@ferrum2d/ferrum-web` root aggregate import나 내부
경로 import를 사용하고 있을 때, 목적별 public subpath로 옮기는 절차를 정리한다.
정확한 public contract는 [Public API](../public-api.md)와
[Public API surface manifest](../public-api-surface.json)를 기준으로 한다.

## 마이그레이션 대상

다음 import는 새 consumer 코드에서 사용하지 않는다.

| 기존 import | 상태 | 이동 방향 |
| --- | --- | --- |
| `@ferrum2d/ferrum-web` | compatibility shim | 목적별 subpath로 분리 |
| `@ferrum2d/ferrum-web/dist/*` | 내부 build artifact | public subpath에서 export되는 facade 사용 |
| `@ferrum2d/ferrum-web/pkg/*` | generated wasm-bindgen artifact | `createFerrumRuntime(...)` 또는 `createEngine(...)`가 Wasm loading을 담당 |
| `@ferrum2d/ferrum-web/src/*` | package 내부 source path | public subpath에서 export되는 facade 사용 |
| `packages/ferrum-web/src/*` | monorepo 내부 개발 경로 | package import로 교체 |

root aggregate import는 기존 코드 호환을 위해 유지하지만 신규 예제, create-game
template, generated consumer project는 목적별 subpath를 사용한다. 공식
`examples/**`와 `packages/create-game/templates/**`는
`pnpm validate:public-api-surface`에서 root aggregate import가 차단된다.

## Entry Point 선택

| 새 import path | 주 용도 | Reference |
| --- | --- | --- |
| `@ferrum2d/ferrum-web/core` | runtime 생성, renderer/input/audio/asset, Physics Spec/API, snapshot, Wasm buffer decoder | [Core Runtime](core.md) |
| `@ferrum2d/ferrum-web/authoring` | Scene Composition, Data Scene, Placement Viewer, Behavior Recipe, FSM, gameplay/physics authoring helper | [Authoring](authoring.md) |
| `@ferrum2d/ferrum-web/starter-scenes` | Shooter Game Spec, starter input profile, Tiled/LDtk/Aseprite importer, starter scene helper | [Starter Scenes](starter-scenes.md) |
| `@ferrum2d/ferrum-web/labs` | WebGPU, sprite material, lighting/atlas helper, VFX, PixelMaskTerrain, HD-2D helper | [Labs](labs.md) |
| `@ferrum2d/ferrum-web/quality` | profiler, diagnostics, replay, screenshot summary, debug gizmo, smoke/report helper | [Quality](quality.md) |

한 파일에서 여러 범위의 API를 쓰면 import를 여러 줄로 나눈다. subpath를 하나로
억지로 합치지 않는다.

## 기본 변환 예시

root aggregate import를 쓰던 코드는 다음처럼 목적별 import로 나눈다.

```ts
import {
  RuntimeProfiler,
  createFerrumRuntime,
  resolveSceneCompositionSpec,
  resolveShooterGameSpec,
} from "@ferrum2d/ferrum-web";
```

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { resolveSceneCompositionSpec } from "@ferrum2d/ferrum-web/authoring";
import { resolveShooterGameSpec } from "@ferrum2d/ferrum-web/starter-scenes";
import { RuntimeProfiler } from "@ferrum2d/ferrum-web/quality";
```

내부 build artifact나 source path를 직접 import하던 코드는 public facade로 옮긴다.

```ts
import { resolveSceneCompositionSpec } from "@ferrum2d/ferrum-web/dist/sceneComposition.js";
import initFerrumCore from "@ferrum2d/ferrum-web/pkg/ferrum_core.js";
```

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { resolveSceneCompositionSpec } from "@ferrum2d/ferrum-web/authoring";
```

Wasm 초기화는 generated `pkg/*`를 직접 호출하지 않고 runtime 생성 경로에 맡긴다.
raw Wasm API가 필요해 보이면 public API가 부족하다는 신호로 보고 facade 승격을
검토한다.

## 대표 Symbol 매핑

| Symbol 범위 | 새 import path |
| --- | --- |
| `createFerrumRuntime`, `createEngine`, `createRenderer` | `@ferrum2d/ferrum-web/core` |
| `WebGL2Renderer`, `AudioManager`, `AssetLoader`, `InputManager`, `BrowserPlatformHost` | `@ferrum2d/ferrum-web/core` |
| `resolvePhysicsSpec`, `createRigidBody`, `createCollider`, `createJoint`, `captureGameStateSnapshot` | `@ferrum2d/ferrum-web/core` |
| `decodeRenderCommands`, `decodeGameplayEvents`, `decodePhysicsDebugLines`, `decodePhysicsQueryHits` | `@ferrum2d/ferrum-web/core` |
| `resolveSceneAuthoringDocument`, `resolveSceneCompositionSpec`, `resolveDataSceneComponentsSpec` | `@ferrum2d/ferrum-web/authoring` |
| `createDataSceneRuntimeTarget`, `createSceneInstanceHandleRegistry` | `@ferrum2d/ferrum-web/authoring` |
| `createScenePlacementViewer`, `createScenePlacementViewport`, `createScenePlacementPatchStore` | `@ferrum2d/ferrum-web/authoring` |
| `mergeScenePlacementPatch`, `saveScenePlacementPatch`, `previewScenePlacementBindingMigration` | `@ferrum2d/ferrum-web/authoring` |
| `resolveBehaviorRecipeDocument`, `resolveBehaviorStateMachineDocument`, `compileWeaponProfiles`, `projectile`, `weapon` | `@ferrum2d/ferrum-web/authoring` |
| `resolveShooterGameSpec`, `applyShooterGameSpec`, `createShooterContentRuntimeOptions` | `@ferrum2d/ferrum-web/starter-scenes` |
| `TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE`, `PLATFORMER_INPUT_ACTION_PROFILE`, `BREAKOUT_INPUT_ACTION_PROFILE` | `@ferrum2d/ferrum-web/starter-scenes` |
| `importTiledGameSpec`, `importLDtkGameSpec`, `importAsepriteAtlasFrames` | `@ferrum2d/ferrum-web/starter-scenes` |
| `WebGPURenderer`, `resolveSpriteMaterialPreset`, `ParticleVfxEmitter` | `@ferrum2d/ferrum-web/labs` |
| `packTextureAtlas`, `normalizeLightingScene`, `createPixelMaskTerrain` | `@ferrum2d/ferrum-web/labs` |
| `RuntimeProfiler`, `evaluateRuntimeProfilerBudget`, `diagnosticReport` | `@ferrum2d/ferrum-web/quality` |
| `createGameplayReplayRun`, `createPhysicsReplayWorkerClient`, `resolveScreenshotCaptureSpec`, `buildDebugGizmoLines` | `@ferrum2d/ferrum-web/quality` |

이 표는 자주 쓰는 이름의 빠른 안내다. 전체 export와 지원 수준은
[Public API](../public-api.md)의 allowlist와 각 reference 문서를 확인한다.

## Consumer Project 절차

1. 기존 import를 찾는다.

```bash
rg "@ferrum2d/ferrum-web($|/(dist|pkg|src)|['\"])" src scripts tests
```

2. root aggregate import를 symbol 범위별로 분리한다.
3. `dist/*`, `pkg/*`, `src/*` import를 public facade로 교체한다.
4. type-only import도 같은 subpath 정책을 적용한다.
5. consumer project 검증을 실행한다.

```bash
npm run build
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:smoke
```

`ferrum:report`가 `rootAggregateImports: 0`, `internalImports: 0`을 보고하면
package import 경계는 통과한 것이다.

## Ferrum2D 저장소 절차

공식 예제나 create-game template import를 바꾸는 경우 다음을 실행한다.

```bash
pnpm validate:public-api-surface
pnpm smoke:create-game-template-reports
pnpm package:consumer-smoke -- --templates minimal --artifact-dir artifacts/consumer-smoke
pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke --expect-status passed
```

package release 후보나 generated consumer surface 전체를 확인해야 하면
`pnpm package:consumer-smoke`를 full matrix로 실행한다. smoke 기준은
[Smoke Check](../../development/quality/smoke-check.md)를 따른다.

## 문제 해결

| 증상 | 의미 | 조치 |
| --- | --- | --- |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | package `exports`에 없는 내부 경로를 import했다. | public subpath로 옮기거나 facade 승격을 검토한다. |
| `Module has no exported member` | symbol이 선택한 subpath에 없다. | 위 매핑과 reference 문서를 보고 올바른 subpath로 옮긴다. |
| `rootAggregateImports`가 0이 아니다. | compatibility root aggregate import가 남아 있다. | 신규/generated consumer 코드에서는 목적별 subpath로 분리한다. |
| `internalImports`가 0이 아니다. | `dist/*`, `pkg/*`, `src/*` 같은 내부 경로가 남아 있다. | package public API만 사용하도록 교체한다. |
| raw Wasm 함수가 필요하다. | 현재 public facade가 부족할 수 있다. | Rust/Wasm ABI를 직접 노출하지 말고 `core` 또는 `authoring` facade 추가를 검토한다. |

## 호환 정책

root aggregate는 compatibility tier다. 기존 consumer 코드의 갑작스러운 파손을 줄이기
위해 유지하지만, 새 문서와 예제의 기준은 목적별 subpath다. stable API를 제거하거나
semantic을 바꾸는 경우 release note와 migration을 요구하고, 가능한 경우 한 beta
기간 이상 compatibility shim을 유지한다. preview API는 1.0 전 변경 가능하지만
`public-api-surface.json`, reference 문서, consumer smoke를 함께 갱신해야 한다.
