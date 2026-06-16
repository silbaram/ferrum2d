# Ferrum2D Public API

이 문서는 `@ferrum2d/ferrum-web` consumer가 import해도 되는 public surface의
인덱스다. 세부 동작은 목적별 reference 문서로 나누고, 이 파일은 import 경로,
지원 수준, 호환 정책, 내부 API 차단 규칙만 유지한다.

Public API surface manifest는 `docs/engine/public-api-surface.json`이다. 이
manifest는 package export path, source entrypoint, stable/preview/compatibility
tier, forbidden internal import allowlist를 기계적으로 검증하는 기준이다.

## Import 원칙

신규 consumer 코드는 목적별 subpath를 우선 사용한다.

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { resolveSceneCompositionSpec } from "@ferrum2d/ferrum-web/authoring";
import { resolveShooterGameSpec } from "@ferrum2d/ferrum-web/starter-scenes";
import { RuntimeProfiler } from "@ferrum2d/ferrum-web/quality";
```

root aggregate import는 compatibility shim이다. 기존 코드 호환을 위해 유지하지만,
새 코드에서는 subpath import를 사용한다.

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web";
```

consumer는 다음 경로를 import하지 않는다.

| 금지 경로 | 이유 |
| --- | --- |
| `@ferrum2d/ferrum-web/dist/*` | build artifact이며 export contract가 아니다. |
| `@ferrum2d/ferrum-web/pkg/*` | generated wasm-bindgen files 위치다. |
| `@ferrum2d/ferrum-web/src/*` | package 내부 source path다. |
| `packages/ferrum-web/src/*` | monorepo 내부 개발 경로다. |
| generated wasm-bindgen files | Rust/Wasm bridge 구현 detail이다. |

내부 경로가 필요해 보이면 public API가 부족하다는 신호로 보고, 새 public facade나
기존 facade 승격을 검토한다.

## 지원 수준

| Tier | 의미 | 변경 정책 |
| --- | --- | --- |
| stable | 1.0 제품 계약 후보 | breaking change는 release note와 migration을 요구한다. |
| preview | 제품 후보이지만 1.0 전 변경 가능 | public 문서, manifest, smoke를 함께 갱신한다. |
| compatibility | 기존 코드 호환 shim | 신규 사용은 권장하지 않고 subpath로 이전한다. |

deprecation은 removal보다 먼저 문서화한다. stable API를 제거하거나 semantic을 바꾸는
경우 release note의 Breaking Changes에 migration을 적고, 가능한 경우 한 beta 기간
이상 compatibility shim을 유지한다.

preview API는 1.0 전 breaking change가 가능하다. 그래도 `public-api-surface.json`,
이 문서, package consumer smoke를 함께 갱신해야 한다. internal API는 consumer import
대상이 아니므로 package export에 추가하지 않는다.

## Public Import Allowlist

| Import path | Tier | Source | Reference |
| --- | --- | --- | --- |
| `@ferrum2d/ferrum-web` | compatibility | `packages/ferrum-web/src/index.ts` | 이 문서 |
| `@ferrum2d/ferrum-web/core` | stable | `packages/ferrum-web/src/core.ts` | [Core Runtime](public-api/core.md) |
| `@ferrum2d/ferrum-web/authoring` | preview | `packages/ferrum-web/src/authoring.ts` | [Authoring](public-api/authoring.md) |
| `@ferrum2d/ferrum-web/starter-scenes` | preview | `packages/ferrum-web/src/starter-scenes.ts` | [Starter Scenes](public-api/starter-scenes.md) |
| `@ferrum2d/ferrum-web/labs` | preview | `packages/ferrum-web/src/labs.ts` | [Labs](public-api/labs.md) |
| `@ferrum2d/ferrum-web/quality` | preview | `packages/ferrum-web/src/quality.ts` | [Quality](public-api/quality.md) |

## Reference Map

| 문서 | 목적 |
| --- | --- |
| [Core Runtime](public-api/core.md) | runtime 생성, `FerrumEngine`, renderer, input, asset, physics, snapshot, buffer decoder |
| [Authoring](public-api/authoring.md) | scene composition, Data Scene spawn/role/handle registry, behavior recipe, gameplay command, FSM, physics authoring facade |
| [Starter Scenes](public-api/starter-scenes.md) | official starter scene, Shooter Game Spec, runtime scene mutation helper |
| [Labs](public-api/labs.md) | WebGPU, sprite material, particle/VFX, texture atlas, PixelMaskTerrain, HD-2D helper |
| [Quality](public-api/quality.md) | profiler, diagnostics, replay, screenshot capture, debug gizmo, report helper |
| [Runtime Extensibility](runtime-extensibility.md) | projectile/weapon/prefab/reaction/effect event의 제품 기준 설명 |
| [Data Scene Authoring](data-scene-authoring.md) | generic data scene 최소 authoring envelope |
| [Physics Spec](physics-spec.md) | physics authoring, solver, query, snapshot/replay 계약 |

## Public API 경계

Rust core는 게임 상태, entity storage, collision, physics, scene rule, render command
생성을 소유한다. TypeScript layer는 browser API, renderer, input, audio, asset loading,
Wasm loading, 낮은 빈도 authoring facade를 소유한다.

핫패스에서 entity별 JS/Wasm 왕복 호출을 추가하지 않는다. frame output은 render,
audio, gameplay, effect, physics debug 같은 bulk buffer나 telemetry로 전달한다.

raw Wasm setter와 generated wasm-bindgen files는 public API가 아니다. consumer는
`FerrumEngine`, authoring resolver, package subpath export를 통해서만 엔진 상태를
변경한다.

## API 변경 규칙

Public export를 추가, 삭제, rename하면 다음을 함께 확인한다.

1. `packages/ferrum-web/src/index.ts`
2. 목적별 subpath entrypoint
3. `docs/engine/public-api-surface.json`
4. 이 문서와 관련 reference 문서
5. README 또는 예제 import
6. `pnpm validate:public-api-surface`

Wasm bridge, runtime frame buffer, public type contract가 바뀌면 `pnpm build`와 관련
smoke도 같이 실행한다.

## 기본 사용 예시

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { resolveShooterGameSpec } from "@ferrum2d/ferrum-web/starter-scenes";

const runtime = await createFerrumRuntime({
  canvas,
  assets: { baseUrl: "/assets" },
});

const spec = resolveShooterGameSpec(gameSpecJson);
runtime.engine.setGameSpec(spec);
runtime.start();
```
