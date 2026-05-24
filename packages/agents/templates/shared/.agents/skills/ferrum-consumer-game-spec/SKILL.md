---
name: ferrum-consumer-game-spec
description: Use when authoring, tuning, validating, or reviewing Ferrum2D consumer game configuration such as game.json, prefab values, spawn waves, collider metadata, balance values, and schema-compatible game variants. Do not use for engine validation code.
---

# Ferrum Consumer Game Spec

## Scope

This skill is for game-side `game.json` or equivalent Ferrum2D game spec data in applications that consume `@ferrum2d/ferrum-web`.

Use it for:
- Data-only changes to player, enemy, projectile, tilemap, spawn, scoring, and balance values.
- Keeping game variants schema-compatible.
- Explaining which runtime defaults apply when fields are omitted.

Do not use it for:
- Editing Ferrum2D engine schema, parser, Rust simulation, or validation implementation.
- Adding scripting, plugin systems, editor behavior, multiplayer, Workers, WebGPU, or complex physics.

## Workflow

1. Locate the game spec file, usually `public/game.json`.
2. Preserve valid JSON and small diffs.
3. Keep gameplay behavior changes data-driven when existing public spec fields support them.
4. Avoid inventing undocumented fields. If a field is needed but unsupported, report the limitation.
5. Check references available in the project, such as schema files, package types, README snippets, or generated docs.
6. Run the project validation script if present. If no validator exists, run at least the production build.

Balance changes should state expected player impact: difficulty, pacing, enemy density, projectile feel, or scoring.
