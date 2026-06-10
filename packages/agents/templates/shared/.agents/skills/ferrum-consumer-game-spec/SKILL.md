---
name: ferrum-consumer-game-spec
description: Use when authoring, tuning, validating, or reviewing Ferrum2D consumer game configuration such as game.json, Game Spec content localization/dialogue/cutscene data, Behavior Recipe data, ProjectileDefinition/WeaponDefinition authoring data, prefab values, spawn waves, collider metadata, balance values, and schema-compatible game variants. Do not use for engine validation code.
---

# Ferrum Consumer Game Spec

## Scope

This skill is for game-side `game.json`, Behavior Recipe data, projectile/weapon authoring definitions, or equivalent Ferrum2D game spec data in applications that consume `@ferrum2d/ferrum-web`.

Use it for:
- Data-only changes to actors/entities, controllable characters, opponents, projectiles, items, tilemaps, spawn rules, scoring, and balance values.
- Game Spec content changes in `content.localization`, `content.dialogue.graphs`, and `content.cutscenes`.
- Projectile/weapon profile changes expressed with `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles(...)`, or schema-compatible data that compiles to Behavior Recipe commands.
- Keeping game variants schema-compatible.
- Explaining which runtime defaults apply when fields are omitted.

Do not use it for:
- Editing Ferrum2D engine schema, parser, Rust simulation, or validation implementation.
- Adding scripting, plugin systems, editor behavior, multiplayer, Workers, WebGPU, or complex physics.

## Workflow

1. Locate the game spec file, usually `public/game.json`.
2. If the task changes weapons/projectiles or behavior profiles, also locate app-owned authoring data in `src/` that uses public helpers such as `compileWeaponProfiles(...)` or `behaviorRecipeCommandsForEntity(...)`.
3. If the task changes localized text, dialogue graph nodes, or cutscene dialogue commands, keep those edits under the Game Spec `content` namespace when the project uses `public/game.json`.
4. Preserve valid JSON/TypeScript and small diffs.
5. Keep gameplay behavior changes data-driven when existing public spec fields or public authoring helpers support them.
6. Avoid inventing undocumented fields. If a field is needed but unsupported, report the limitation.
7. Check references available in the project, such as schema files, package types, README snippets, generated docs, or template harness output.
8. Run `npm run ferrum:validate` after Game Spec `content` edits. Run `npm run ferrum:authoring-report` when available after data-driven gameplay authoring changes. Then run `npm run ferrum:replay-report` if the project has a replay fixture, and `npm run ferrum:smoke` as the final local gate.

Balance changes should state expected player impact: difficulty, pacing, enemy density, projectile feel, or scoring.

## Projectile And Weapon Authoring

When a generated template exposes weapon profiles, prefer editing the profile definitions instead of hardcoding custom update loops.

- Use `ProjectileDefinition` for projectile speed, damage, lifetime, aim, collision target, and tile impact policy.
- Use `WeaponDefinition` for action id/name, cooldown, and the projectile it fires.
- Use `compileWeaponProfiles(...)` to validate/compile profile data and `behaviorRecipeCommandsForEntity(...)` to select one profile's runtime commands.
- If a generated template supports `?profile=...`, keep profile ids stable unless intentionally changing the public template contract and replay fixture.

Do not implement projectile steering, collision damage, area damage, or tile impact behavior with per-frame TypeScript entity loops when Ferrum2D public authoring primitives already cover the behavior.

## Content Runtime Authoring

For localized dialogue, cutscenes, and narrative UI text, prefer Game Spec content data over hardcoded runtime strings when the generated project uses `public/game.json`.

- Put localized text in `content.localization.locales`.
- Put dialogue graphs in `content.dialogue.graphs`.
- Put cutscene sequences in `content.cutscenes`.
- Use stable ids for graph ids, node ids, cutscene ids, and localization keys.
- When a cutscene dialogue command references `graphId`/`nodeId`, the runtime helper can hydrate the displayed text from the referenced dialogue node.
- `createShooterContentRuntimeOptions(...)` converts resolved content into `createFerrumRuntime(...)` `localization`, `dialogue`, and `cutscene` options. It auto-selects only a single unambiguous graph/cutscene unless the project passes explicit ids.

Do not add per-frame TypeScript loops to localize text, advance dialogue nodes, or rewrite cutscene text when Game Spec content plus public runtime hooks can express the change.
