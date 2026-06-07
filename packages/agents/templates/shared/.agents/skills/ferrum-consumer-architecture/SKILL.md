---
name: ferrum-consumer-architecture
description: Use when designing, refactoring, or reviewing Ferrum2D consumer game application structure: src/main.ts bootstrap-only entrypoints, runtime/game/assets/ui/dev/playtest module boundaries, public @ferrum2d/ferrum-web API seams, and separation of demo/smoke/report code from shippable gameplay. Do not use for Ferrum2D engine internals.
---

# Ferrum Consumer Architecture

## Scope

This skill is for application architecture in games that depend on `@ferrum2d/ferrum-web`.

Use it for:
- Splitting a growing single-file game into clear modules.
- Reviewing whether `src/main.ts` is only bootstrap code.
- Deciding where runtime creation, Game Spec data, gameplay commands, assets, UI, reports, and playtest hooks should live.
- Keeping demo/dev/smoke helpers out of shippable gameplay modules.

Do not use it for:
- Editing Ferrum2D engine source, Rust/Wasm internals, renderer implementation, package release metadata, or installed package files.
- Introducing a visual editor, scripting/plugin runtime, multiplayer, full game-loop Worker migration, WebGPU renderer work, or complex physics.
- Importing `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, generated Wasm bindings, or `@ferrum2d/ferrum-web/src/*`.

## Target Layout

Prefer this shape for real games. Small templates may omit empty folders, but should keep the same boundaries as they grow.

```txt
src/
  main.ts                    # bootstrap only
  runtime/
    createGameRuntime.ts     # createFerrumRuntime, start/destroy wiring
    inputBindings.ts         # setInputActionBinding and input profiles
  game/
    gameSpec.ts              # Game Spec fragments and defaults
    weapons.ts               # ProjectileDefinition/WeaponDefinition data
    applyGameplay.ts         # public runtime apply helpers
    scenes.ts                # app-owned scene flow around the runtime
  assets/
    manifest.ts              # app-owned texture/audio/json names and URLs
    loadAssets.ts            # renderer.loadTexture and preload wiring
  ui/
    hud.ts                   # HUD, menus, pause/restart UI
    panels.ts                # optional game-specific controls
  dev/
    smokeHooks.ts            # browser smoke globals and test-only helpers
    playtestHooks.ts         # debug-only browser hooks for local playtest
    runtimeReport.ts         # captureGameStateSnapshot/replay reports
    diagnostics.ts           # visible startup/runtime diagnostics
tests/
  playtest/                  # scripted browser/manual playtest scenarios and notes
```

## Workflow

1. Inspect `package.json`, `src/`, `public/`, and `.agents/harness/ferrum-game-development.md` when present.
2. Identify the changed surface: bootstrap, runtime wiring, game data, gameplay apply path, assets, UI, dev/report hook, playtest, or build.
3. Keep `src/main.ts` short: import dependencies, create the shell/runtime, install high-level modules, start, and show startup errors.
4. Move direct engine calls behind narrow app-owned functions such as `createGameRuntime(...)`, `applyWeaponProfile(...)`, `loadGameAssets(...)`, or `installSmokeHooks(...)`.
5. Keep Game Spec, projectile/weapon definitions, Behavior Recipe data, and balance values in data modules. Do not bury authoring data inside DOM event handlers.
6. Keep UI modules calling app-owned gameplay functions; avoid scattering `runtime.engine.*` calls across unrelated UI files.
7. Keep smoke globals, replay reports, debug panels, and browser test hooks in `src/dev/` or test-only modules. They may observe runtime state but should not own core gameplay behavior.
8. Preserve hot-path discipline: no per-entity JS/Wasm calls in frame loops, no DOM mutation inside per-entity simulation, and no duplicated TypeScript collision/damage simulation for engine-owned behavior.
9. Use only public imports from `@ferrum2d/ferrum-web`. If the architecture needs an internal engine symbol, stop and document the engine capability gap.
10. Validate with the narrowest available commands: `npm run ferrum:validate`, `npm run ferrum:authoring-report`, `npm run ferrum:replay-report`, `npm run ferrum:smoke`, and `npm run build` as applicable.

## Module Ownership

- `src/runtime/` owns browser runtime creation, lifecycle, renderer/input/audio wiring, and public API adapter seams.
- `src/game/` owns app gameplay data, behavior command selection, Game Spec fragments, and app-level scene decisions.
- `src/assets/` owns app asset names, paths, manifests, atlas metadata, and preload/load wiring.
- `src/ui/` owns DOM/HUD/panels and calls app-owned service functions instead of raw engine methods where possible.
- `src/dev/` owns smoke hooks, playtest hooks, report capture, replay diagnostics, debug-only globals, and local playtest instrumentation.
- `tests/playtest/` owns scripted browser/manual playtest scenarios, reproduction notes, and non-shipping test assets.

When delegating to multiple agents, do not let two agents edit the same module at once. Use this split:

- `consumer_project_agent`: package, entrypoint, runtime bootstrap, folder layout.
- `consumer_architecture_agent`: module boundaries, refactors, direct engine-call placement, dev/runtime separation.
- `consumer_game_spec_agent`: `public/game.json`, authoring data, balance values.
- `consumer_asset_agent`: public assets and manifest paths.
- `consumer_gameplay_agent`: gameplay integration through public runtime APIs.
- `consumer_playtest_agent`: local evidence, browser smoke, and `tests/playtest/` scenarios.
- `consumer_build_agent`: production build and static artifact checks.

## Review Checklist

Before finishing an architecture change, verify:

- `src/main.ts` does not contain large UI rendering, smoke report construction, or gameplay data tables.
- Public API calls are centralized behind app-owned adapters when they are reused.
- Game data can be edited by an agent without parsing unrelated DOM code.
- Dev/report/smoke code can be removed without changing shippable gameplay behavior.
- Playtest hooks live in `src/dev/` and scripted/manual scenarios live in `tests/playtest/` when the project needs them.
- Browser-visible startup errors still render on failure.
- Commands run and skipped checks are reported with reasons.
