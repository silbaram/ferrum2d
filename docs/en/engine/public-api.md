# Ferrum2D Public API

[한국어](../../engine/public-api.md) · English

Use the package's public subpaths in game projects. They separate runtime, authoring, starters, optional features, and quality tooling.
This English overview describes import policy and support levels. Detailed symbol contracts are linked below and are currently in Korean.
The installed package's exported types and its release documentation determine what is available.

## Supported imports

| Import | Tier | Purpose | Detailed reference |
| --- | --- | --- | --- |
| `@ferrum2d/ferrum-web/core` | stable | Runtime creation, engine facade, rendering, input, audio, assets, physics, snapshots, and buffer accessors | [Core Runtime (Korean)](../../engine/public-api/core.md) |
| `@ferrum2d/ferrum-web/authoring` | preview | Scene composition, authoring documents, behavior references, and physics authoring | [Authoring (Korean)](../../engine/public-api/authoring.md) |
| `@ferrum2d/ferrum-web/starter-scenes` | preview | Built-in starter scenes and Shooter Game Spec helpers | [Starter Scenes (Korean)](../../engine/public-api/starter-scenes.md) |
| `@ferrum2d/ferrum-web/labs` | preview | WebGPU and optional visual, atlas, VFX, terrain, and HD-2D helpers | [Labs (Korean)](../../engine/public-api/labs.md) |
| `@ferrum2d/ferrum-web/quality` | preview | Profiling, diagnostics, replay, capture, and report helpers | [Quality (Korean)](../../engine/public-api/quality.md) |
| `@ferrum2d/ferrum-web` | compatibility | Aggregate import retained for existing code | [Migration Guide (Korean)](../../engine/public-api/migration-guide.md) |

`stable` means a candidate for the 1.0 product contract; breaking changes require release notes and migration guidance.
`preview` APIs may change before 1.0, with corresponding documentation and validation updates.
`compatibility` exports preserve existing code and are not the preferred choice for new integrations.

For example:

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

This excerpt assumes that the application supplies `canvas` and `gameSpecJson`.
Use a [generated project](developer-quickstart.md) for a complete runnable starter.

## Keep implementation paths private

Do not import `dist/*`, `pkg/*`, or `src/*` under the engine package,
monorepo paths such as `packages/ferrum-web/src/*`, or generated wasm-bindgen modules.
They are implementation details rather than supported consumer entrypoints.

The engine repository records its public surface in `docs/engine/public-api-surface.json`.
`pnpm validate:public-api-surface` checks exports and the maintained consumer import restrictions.

## Rust, Wasm, and TypeScript ownership

Rust owns game state, entity storage, simulation, collision, physics, scene progression, and render command generation.
TypeScript owns browser/GPU APIs, input collection, audio playback, asset loading, Wasm initialization,
content validation, and UI presentation.

Frame data crosses the boundary in bulk buffers or telemetry, not a per-entity sequence of JS/Wasm calls.
Use the provided accessors and layouts instead of hardcoding struct offsets or snapshot indices.
Borrowed Wasm views are temporary: memory growth or another native mutation can invalidate them.
Follow the documented frame callback and ownership contracts when retaining data.

Pure TypeScript geometry helpers can transform points without owning simulation state.
See [coordinates and geometry (Korean)](../../engine/coordinate-system.md) for rotation, offset, and anchor rules.

## Initialization and resource lifetime

The runtime initializes Wasm as part of its startup. If you create standalone native-backed dialogue or terrain helpers first,
call `await initializeFerrumWasm()` from the public core entrypoint before constructing them.
Use each helper's documented cleanup method and do not access a native resource after destruction.
See [Core Runtime (Korean)](../../engine/public-api/core.md) for the exact initialization and lifecycle contracts.

## Check optional capabilities

The availability of an authoring field does not prove that an older Wasm binary supports it.
For optional HD-2D and combat features, use the documented capability checks and handle unsupported cases explicitly.
Read [Spatial Scenes (Korean)](../../engine/data-scene-spatial.md),
[Scene Authoring (Korean)](../../engine/data-scene-authoring.md), and the installed package's types.

Built-in starter authoring and generic Data Scene spawning are distinct paths.
Starter adapters support scene-specific mutations and reject unsupported visual/collider or lifetime changes with diagnostics.

## Where to look next

| Topic | Reference |
| --- | --- |
| Runnable projects and validation | [Developer Quickstart](developer-quickstart.md) |
| Features and examples | [Feature Guide](showcase-hub.md) |
| Scene documents and assets | [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) |
| Physics inputs, queries, and replay | [Physics Spec (Korean)](../../engine/physics-spec.md) |
| Projectile, weapon, prefab, reaction, and effect primitives | [Runtime Extensibility (Korean)](../../engine/runtime-extensibility.md) |
| Detailed API compatibility and migration | [Migration Guide (Korean)](../../engine/public-api/migration-guide.md) |

When changing the engine's public surface, update the export facade, surface manifest, relevant references,
and consumer checks together. A documentation translation does not change API support tiers.
