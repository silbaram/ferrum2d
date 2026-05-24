---
name: ferrum-game-designer
description: Use when designing, tuning, validating, or reviewing Ferrum2D Top-down Shooter Game Spec JSON, game variants, prefab sizes, enemy behavior presets, or agent-generated gameplay changes. Trigger when editing examples/topdown-shooter/public/game.json, creating game variant JSON, balancing shooter values, or coordinating AI agents that modify Ferrum2D game data.
---

# Ferrum Game Designer

Use this skill to make data-only gameplay changes for Ferrum2D. Prefer editing Game Spec JSON over Rust/TypeScript code when the requested change can be expressed as tuning, prefab sizing, enemy behavior preset selection, or enemy spawn pattern selection.

## Source Of Truth

- Main editable spec: `examples/topdown-shooter/public/game.json`
- Spec reference: `docs/engine/topdown-shooter-game-spec.md`
- JSON Schema: `schemas/shooter-game-spec.schema.json`
- Validation command: `pnpm validate:game-spec`
- Variant helper: `pnpm create:game-variant <name> [output.json]`

## Workflow

1. Read `docs/engine/topdown-shooter-game-spec.md` before changing gameplay data.
2. Modify only Game Spec JSON for balance/preset changes.
3. Keep values positive finite numbers.
4. Use `enemies.behavior` only as `"chase"`, `"drift"`, `"static"`, or `"orbit"`.
5. Use `enemies.spawnPattern` only as `"edge"`, `"corners"`, or `"center"`.
6. Run `pnpm validate:game-spec` after editing the main spec.
7. Run `pnpm test:web` if changing TypeScript validation behavior.
8. Run `cargo test --manifest-path crates/ferrum-core/Cargo.toml` if Rust behavior or spawn semantics changed.

## Safe Tuning Ranges

- `world.width`: 800-3200
- `world.height`: 480-1800
- `player.speed`: 120-320
- `enemies.speed`: 0-180
- `enemies.spawnInterval`: 0.25-3.0
- `enemies.orbit.radius`: 96-320
- `enemies.orbit.radialBand`: 0-64
- `weapons.bulletSpeed`: 240-900
- `weapons.cooldown`: 0.05-0.5
- `weapons.lifetime`: 0.5-4.0
- `weapons.damage`: 1-10
- `enemies.health`: 1-20
- `enemies.scoreReward`: 1-100
- `prefabs.player.width/height`: 24-72
- `prefabs.enemy.width/height`: 12-64
- `prefabs.bullet.width/height`: 4-24

Values outside these ranges may still validate if positive, but should be treated as experimental and documented in the response.

## Agent Coordination

When multiple agents work together, keep write ownership separate:

- Game data agent (`game_designer` / `game-designer`): owns `examples/topdown-shooter/public/*.json`
- Schema agent (`schema_agent` / `schema-agent`): owns `docs/engine/topdown-shooter-game-spec.md` and `schemas/*`
- QA agent (`qa_agent` / `qa-agent`): runs validation/build/test commands and reports failures
- Docs agent (`docs_agent` / `docs-agent`): owns README and docs workflow updates

Do not let multiple agents edit the same file in parallel.

## Hard Boundaries

- Do not add scripting, plugins, editor functionality, WebGPU, Workers, multiplayer, or complex physics for data-only gameplay requests.
- Do not move game simulation into TypeScript.
- Do not pass raw JSON objects into Rust hot paths.
- Keep Rust behavior selection as numeric/preset-based Wasm API calls.
