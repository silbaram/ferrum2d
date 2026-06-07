---
name: ferrum-consumer-game-spec
description: Use when authoring, tuning, validating, or reviewing Ferrum2D consumer game configuration such as game.json, Behavior Recipe data, ProjectileDefinition/WeaponDefinition authoring data, prefab values, spawn waves, collider metadata, balance values, and schema-compatible game variants. Do not use for engine validation code.
---

# Ferrum Consumer Game Spec

## Scope

This skill is for game-side `game.json`, Behavior Recipe data, projectile/weapon authoring definitions, or equivalent Ferrum2D game spec data in applications that consume `@ferrum2d/ferrum-web`.

Use it for:
- Data-only changes to actors/entities, controllable characters, opponents, projectiles, items, tilemaps, spawn rules, scoring, and balance values.
- Projectile/weapon profile changes expressed with `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles(...)`, or schema-compatible data that compiles to Behavior Recipe commands.
- Keeping game variants schema-compatible.
- Explaining which runtime defaults apply when fields are omitted.

Do not use it for:
- Editing Ferrum2D engine schema, parser, Rust simulation, or validation implementation.
- Adding scripting, plugin systems, editor behavior, multiplayer, Workers, WebGPU, or complex physics.

## Workflow

1. Locate the game spec file, usually `public/game.json`.
2. If the task changes weapons/projectiles or behavior profiles, also locate app-owned authoring data in `src/` that uses public helpers such as `compileWeaponProfiles(...)` or `behaviorRecipeCommandsForEntity(...)`.
3. Preserve valid JSON/TypeScript and small diffs.
4. Keep gameplay behavior changes data-driven when existing public spec fields or public authoring helpers support them.
5. Avoid inventing undocumented fields. If a field is needed but unsupported, report the limitation.
6. Check references available in the project, such as schema files, package types, README snippets, generated docs, or template harness output.
7. Run `npm run ferrum:authoring-report` when available after data-driven authoring changes. Then run `npm run ferrum:replay-report` if the project has a replay fixture, and `npm run ferrum:validate` or `npm run ferrum:smoke` as the final local gate.

Balance changes should state expected player impact: difficulty, pacing, enemy density, projectile feel, or scoring.

## Projectile And Weapon Authoring

When a generated template exposes weapon profiles, prefer editing the profile definitions instead of hardcoding custom update loops.

- Use `ProjectileDefinition` for projectile speed, damage, lifetime, aim, collision target, and tile impact policy.
- Use `WeaponDefinition` for action id/name, cooldown, and the projectile it fires.
- Use `compileWeaponProfiles(...)` to validate/compile profile data and `behaviorRecipeCommandsForEntity(...)` to select one profile's runtime commands.
- If a generated template supports `?profile=...`, keep profile ids stable unless intentionally changing the public template contract and replay fixture.

Do not implement projectile steering, collision damage, area damage, or tile impact behavior with per-frame TypeScript entity loops when Ferrum2D public authoring primitives already cover the behavior.
