---
name: ferrum-schema-contracts
description: Use when editing, reviewing, or validating Ferrum2D schema contracts, JSON authoring specs, Data Scene component contracts, Physics authoring schema, Top-down Shooter Game Spec schema, validation diagnostics, compatibility notes, or public API documentation tied to schema behavior.
---

# Ferrum Schema Contracts

Use this skill to keep Ferrum2D authoring schemas, validation code, examples, and docs synchronized.

## Source Of Truth

- Game Spec docs/schema: `docs/engine/topdown-shooter-game-spec.md`, `schemas/shooter-game-spec.schema.json`
- Physics authoring docs/schema: `docs/engine/physics-spec.md`, `schemas/physics-authoring.schema.json`
- Data Scene docs: `docs/engine/data-scene-authoring.md`
- Public authoring docs: `docs/engine/public-api/authoring.md`
- Planning context: `docs/planning/object-authoring-tool-plan.md`, `docs/planning/physics_review.md`

## Owned Surface

- JSON schemas under `schemas/**`
- TypeScript validation and normalization for Game Spec, Physics authoring, Data Scene, and Scene Placement authoring
- Example specs under `examples/**/public/*.json`
- Create-game template specs under `packages/create-game/templates/*/public/*.json`
- Contract sections in `docs/engine/**`

## Workflow

1. Identify whether the change is example-only, Data Scene authoring, Physics authoring, or generic engine/public API.
2. Update schema, validation behavior, examples, and docs together when a contract changes.
3. Document whether new fields are required, optional, defaulted, and backward compatible.
4. Keep Top-down Shooter-specific concepts out of generic Data Scene and public API contracts.
5. Coordinate generic runtime/API/ABI decisions with `engine_reviewer`.
6. Coordinate gameplay balance compatibility with `game_designer` only when Top-down Shooter data changes.

## Validation

Use the checks that match the changed contract:

```bash
pnpm validate:game-spec
pnpm test:web
pnpm --filter @ferrum2d/ferrum-web test
pnpm smoke:placement-viewer
pnpm validate:public-api-surface
```

For create-game template schema changes, also run the relevant generated-template smoke or package consumer smoke.

## Hard Boundaries

- Do not add fields without docs and migration/backward-compatibility notes.
- Do not break existing example specs without updating validation, docs, and smoke expectations.
- Do not use authoring-only metadata as runtime data unless the contract explicitly says so.
- Do not change Rust spawn or physics semantics without Rust-side checks.
