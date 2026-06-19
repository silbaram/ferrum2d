---
name: ferrum-authoring-workflow
description: Use when designing, implementing, reviewing, or validating Ferrum2D Scene Placement and Object Authoring workflows, including placement viewer UI, placement patch generation, asset providers, handoff summaries, Data Scene component props, create-game placement-viewer scaffolds, or generated placement viewer browser smoke checks.
---

# Ferrum Authoring Workflow

Use this skill for Ferrum2D agent-first authoring surfaces. Keep the workflow spec-driven and validation-friendly; do not turn it into a general visual editor.

## Source Of Truth

- Planning status: `docs/planning/object-authoring-tool-plan.md`
- Public authoring API: `docs/engine/public-api/authoring.md`
- Data Scene contract: `docs/engine/data-scene-authoring.md`
- Smoke policy: `docs/development/quality/smoke-check.md`
- Runtime/public API surface: `docs/engine/public-api-surface.json`

## Owned Surface

- Core APIs: `packages/ferrum-web/src/scenePlacementViewer.ts`, `scenePlacementPatch.ts`, `scenePlacementAssets.ts`, `scenePlacementHandoff.ts`
- Data Scene integration: `packages/ferrum-web/src/dataSceneComponents.ts`, `sceneComposition.ts`, `authoring.ts`
- Official app host: `apps/placement-viewer/**`
- Create-game viewer: `packages/create-game/templates/_shared/src/ferrum-placement-viewer.ts`, `.css`
- Template authoring docs/data: `packages/create-game/templates/*/public/scene-authoring.json`
- Smoke checks: `tests/smoke/package-consumer-smoke.mjs`, `tests/smoke/browser-render-smoke.mjs`

## Workflow

1. Read the planning doc and the relevant engine docs before changing authoring behavior.
2. Keep authoring edits as JSON/spec patches that agents can inspect and replay.
3. Preserve Rust/TypeScript boundaries: authoring UI and browser assets live in TypeScript; simulation and render command generation remain in Rust/core runtime.
4. Keep patch generation deterministic. Prefer explicit diagnostics over silently dropping unsupported authoring data.
5. Update public exports and `docs/engine/public-api-surface.json` when adding or renaming public authoring APIs.
6. Update docs and smoke expectations in the same change when behavior changes.

## Placement Rules

- Asset providers must map project assets to placement assets without requiring internal package imports from consumers.
- Add Sprite flows should create an object-prefab-based draft patch with visual component data and a collider when available.
- Patch writers should update `props.components` through the supported Data Scene component path instead of inventing parallel schema fields.
- Handoff summaries should include enough diagnostics for a follow-up agent to apply, reject, or refine generated drafts.
- Behavior Binding Inspector may create `updateBehaviorBinding` reference patches and handoff evidence such as `behaviorBindings[].recipeId`, `bindingPath`, and `behaviorRecipePath`; do not treat those as behavior recipe body edits.
- Keep placement-only saves out of `behaviorRecipes.entities`; recipe body creation, FSM/action graph work, and scripting remain agent/spec-owned unless separately approved.
- Create-game template changes must keep minimal, topdown, platformer, and breakout generated viewers functional.

## Required Checks

Use the narrowest set that covers the changed surface:

```bash
pnpm --filter @ferrum2d/ferrum-web test
pnpm --filter @ferrum2d/placement-viewer build
pnpm smoke:placement-viewer
pnpm smoke:create-game-template-reports
pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal
pnpm validate:consumer-smoke-report -- --report <report-path> --artifact-dir <artifact-dir>
pnpm validate:public-api-surface
```

Run the full `package:consumer-smoke` template matrix when shared create-game placement viewer code changes.

## Hard Boundaries

- Do not add a visual editor product surface without explicit approval.
- Do not move game simulation state into TypeScript authoring UI code.
- Do not make consumers import from `@ferrum2d/ferrum-web/dist/*` or `pkg/*`.
- Do not hand-edit generated `dist/**` or `pkg/**`.
