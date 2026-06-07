---
name: ferrum-consumer-gameplay
description: Use when implementing gameplay in a game that consumes @ferrum2d/ferrum-web: input-to-runtime integration, HUD updates, game-side state coordination, simple rules, scene flow, and public API orchestration. Do not use for Ferrum2D engine simulation internals.
---

# Ferrum Consumer Gameplay

## Scope

This skill is for application gameplay code around the Ferrum2D runtime.

Use it for:
- Connecting UI actions, input transforms, runtime callbacks, and game-side presentation.
- Implementing game-side menus, HUD, pause/resume, restart, score display, and scene shell behavior.
- Coordinating data-driven gameplay through supported game spec fields.
- Applying compiled Behavior Recipe or projectile/weapon profile commands through public runtime APIs.

Do not use it for:
- Moving core simulation ownership into TypeScript when Ferrum2D owns that behavior.
- Editing installed engine package files or generated Wasm bindings.
- Introducing unapproved engine features such as multiplayer, Workers, WebGPU, or complex physics.

## Workflow

1. Find the app entrypoint and runtime creation code.
2. Keep simulation state in Ferrum2D when public APIs already own it.
3. Keep browser/platform UI code in the app layer.
4. Use narrow adapters instead of scattering direct runtime calls across unrelated files.
5. Preserve hot-path discipline: do not create per-entity JS/Wasm round trips in frame loops.
6. For projectile/weapon profile changes, prefer public helpers such as `compileWeaponProfiles(...)`, `behaviorRecipeCommandsForEntity(...)`, `applyGameplayBehaviorCommands(...)`, `setInputActionBinding(...)`, and `builtInShooterPlayerHandle()` over bespoke simulation code.
7. For data-driven gameplay or behavior authoring, run `npm run ferrum:authoring-report` when the project provides it after authoring and before browser playtest.
8. Treat authoring/replay reports as machine-readable evidence only after checking `format`, `version`, `ok`, and failure `reports[]` entries with `path`, `message`, and `suggestion`.
9. After applying data-driven gameplay changes, run `npm run ferrum:replay-report` when the project provides it, or hand off to playtest for deterministic replay evidence.
10. When the generated template-surface replay is not enough, use `.agents/harness/ferrum-runtime-replay.md` to add a project-specific deterministic runtime replay runner and fixture.
11. If the project provides a local report artifact validator, run it after generating report artifacts. Do not require Ferrum2D engine workspace schema files in ordinary consumer projects.
12. Validate with `npm run ferrum:smoke` when available, otherwise run build and, when possible, a browser smoke pass.

## Projectile/Weapon Runtime Apply

Generated templates may expose profile ids such as `standard`, `piercing`, or `bounce`. Keep this pattern agent-editable:

- Store profiles as serializable `ProjectileDefinition`/`WeaponDefinition` data.
- Compile once during startup or scene load, not per frame.
- Bind input actions with `setInputActionBinding(...)` when a non-default action id is selected.
- Apply the selected command list with `applyGameplayBehaviorCommands(...)` against a stable entity handle.
- Expose selected profile state through simple app-owned telemetry or HUD text when useful for smoke checks.

If a requested profile needs unsupported core behavior, report the missing Ferrum2D capability instead of moving collision, steering, or damage ownership into TypeScript.

## Runtime Replay Harness

Project-specific replay harnesses must use only the public `@ferrum2d/ferrum-web` entrypoint. The expected public helpers are `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, and `hashGameStateSnapshot(...)`.

Do not import `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, `@ferrum2d/ferrum-web/src/*`, generated Wasm bindings, or Ferrum2D engine workspace files into a consumer game. Replay fixtures should capture canonical gameplay state only and should keep render/audio/wall-clock/debug data outside the replay hash.

If the public API cannot express the requested gameplay, stop and document the missing engine capability.
