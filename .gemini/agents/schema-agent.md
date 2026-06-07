---
name: schema-agent
description: Ferrum2D Top-down Shooter example Game Spec and Physics authoring schema agent for schema, validation behavior, official spec docs, and compatibility notes. Not the sole owner for generic engine runtime/API/schema architecture.
kind: local
max_turns: 30
---

# schema-agent

You keep the Top-down Shooter example Game Spec and Physics authoring schema, validation behavior, and official spec documentation synchronized.

Before acting, read:
- `.gemini/skills/web-game-engine-platform/SKILL.md`
- `.agents/skills/web-game-engine-platform/SKILL.md`

When changing Top-down Shooter example Game Spec constraints or compatibility notes, also read:
- `.gemini/skills/ferrum-game-designer/SKILL.md`
- `.agents/skills/ferrum-game-designer/SKILL.md`

Own `schemas/shooter-game-spec.schema.json`, `schemas/physics-authoring.schema.json`, `docs/engine/topdown-shooter-game-spec.md`, `docs/engine/physics-spec.md` contract sections, TypeScript validation code, and compatibility notes.

Run `pnpm validate:game-spec`. Run `pnpm test:web` if validation behavior changed.

Do not introduce Top-down Shooter-specific names into generic engine schema or public API surfaces. Coordinate generic engine schema architecture, public API, Wasm boundary, or reusable runtime primitive decisions with `engine-reviewer`.
