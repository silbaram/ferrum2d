# Ferrum2D Consumer Game Development Harness

Use this harness for games that depend on `@ferrum2d/ferrum-web`.

## Product Goal

Ferrum2D consumer projects are AI agent-first. The default development loop is not a visual editor. Agents should modify app code, Game Spec, Physics Spec, assets, and metadata through explicit files, then prove the result with local validation and smoke commands.

## Standard Loop

1. Inspect `package.json`, `src/`, `public/`, `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.
2. Identify whether the task is project setup, architecture, spec data, assets, gameplay glue, playtest, or build.
3. Use the matching `ferrum-consumer-*` skill under `.agents/skills/`.
4. Prefer public imports from `@ferrum2d/ferrum-web`.
5. For data-driven gameplay or behavior changes, run an authoring validation command before browser playtest when the project provides one.
6. For project-specific deterministic runtime replay beyond template surface fixtures, follow `.agents/harness/ferrum-runtime-replay.md`.
7. Run the narrowest command that proves the change.
8. Report commands, result, skipped checks, and next action.

## Template Discovery

When creating a new Ferrum2D consumer project or choosing a closer starting point, prefer the machine-readable create-game catalog before guessing a template:

```bash
npx @ferrum2d/create-game --list-templates --json
```

Use the catalog's `sceneAuthoring`, `gameplayReplay`, and `runtimeGameplayReplay` entries to decide which template already provides data-driven authoring reports, deterministic template replay, and runtime replay scaffolding. Keep the selected template id in the task notes so later agents know which scaffold contract they inherited.

## Agent-First Authoring Surfaces

Prefer supported authoring data and public helper APIs before writing bespoke runtime logic.

- Game Spec data: `public/game.json` and schema-compatible variants for scene, prefab, wave, collider, score, and balance values.
- Game Spec content data: `content.localization`, `content.dialogue.graphs`, and `content.cutscenes` for localized dialogue, cutscenes, and HUD-friendly text.
- Behavior Recipe data: declarative behavior profiles that compile to runtime commands.
- Projectile/weapon authoring: `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles(...)`, and `behaviorRecipeCommandsForEntity(...)` from `@ferrum2d/ferrum-web`.
- Runtime content apply path: use `resolveShooterGameSpec(...)` and `createShooterContentRuntimeOptions(...)` to convert validated Game Spec content into `createFerrumRuntime(...)` `localization`/`dialogue`/`cutscene` options.
- Runtime gameplay apply path: use public engine methods such as `applyGameplayBehaviorCommands(...)`, `setInputActionBinding(...)`, and `builtInShooterPlayerHandle()` when the generated template exposes a built-in player.
- Asset import path: keep raw sprite/audio/localization/Tiled/LDtk/Aseprite inputs in app-owned folders, generate runtime-ready atlas/audio/metadata with project-owned scripts or public `@ferrum2d/ferrum-web` helpers such as `packTextureAtlas(...)`, `textureAtlasDocumentToShooterAtlas(...)`, `importAsepriteAtlas(...)`, `importTiledGameSpec(...)`, `importLDtkGameSpec(...)`, `AudioAssetLoader`, and `LocalizationBundle`, then follow the `import -> validate -> Game Spec` loop by validating the merged Game Spec with `npm run ferrum:validate`.
- Placement/ObjectDefinition path: current `@ferrum2d/create-game` templates expose `npm run ferrum:placement-viewer`, Project Assets Add Sprite, selected-object `ObjectDefinition` creation, and ObjectDefinition-backed instance drafts. Treat `ScenePlacementPatch` operations such as `addObjectDefinition` and `addInstance` as UI-owned `sceneComposition.prefabs[]` / `sceneComposition.fragments[].instances[]` edits, not behavior recipe edits.
- Behavior Binding path: the viewer may export an `updateBehaviorBinding` reference patch and report evidence such as `behaviorBindings[].recipeId`, `bindingPath`, and `behaviorRecipePath`. Treat that as Behavior Binding evidence for an agent-owned follow-up, not as permission to edit `behaviorRecipes.entities` inside a placement-only save.

For projectile or weapon changes, keep the source as serializable authoring data when possible. The usual loop is `edit definition -> compile command document -> apply through public runtime facade -> run authoring/replay report -> smoke/build`. Do not add per-frame TypeScript movement, collision, or damage loops for behavior already supported by Ferrum2D primitives.

For placement-driven behavior changes, keep the human-owned spatial placement and agent-owned behavior data separate. The usual loop is `inspect npm run ferrum:authoring-report -> optionally open npm run ferrum:placement-viewer -> read gameplayAuthoring.sceneAuthoring.summary.placementAuthoring.instances[] or the viewer handoff JSON -> choose a stable instanceId -> inspect Behavior Binding evidence -> edit behaviorRecipes or props.behaviorRecipes -> rerun ferrum:authoring-report -> replay/smoke`. If a placement viewer exports a `ScenePlacementPatch`, apply `addObjectDefinition` only to `sceneComposition.prefabs[]` and placement `addInstance`/transform/rename/remove operations only to `sceneComposition.fragments[].instances[]`; use `previewScenePlacementBindingMigration(...)` or the report's placement summary before changing behavior references. A viewer-created `updateBehaviorBinding` patch only attaches or detaches an existing recipe reference, and report fields such as `behaviorBindings[].recipeId`, `bindingPath`, and `behaviorRecipePath` are evidence for where the agent should work next. Do not rewrite `behaviorRecipes` as part of a placement-only save, do not modify `behaviorRecipes.entities` through a placement-only patch, and do not invent coordinates in behavior recipes when an `instanceId` already names the target.

For narrative or localized UI changes, keep text, dialogue graph, and cutscene sequence data in Game Spec `content` when the project uses `public/game.json`. The usual loop is `edit content namespace -> run ferrum:validate -> resolve spec -> createShooterContentRuntimeOptions(...) -> createFerrumRuntime(...) -> run ferrum:smoke` or the project's browser smoke. Do not hardcode localization, dialogue progression, or cutscene text in frame loops when Game Spec content and public runtime hooks can express it.

For asset import changes, keep the source as reproducible files and scripts. The usual loop is `add raw assets -> run pack/import script -> merge atlas/tilemap/localization/audio manifest into Game Spec or app manifest -> run ferrum:validate -> run ferrum:smoke/build`. Do not import Ferrum2D engine workspace scripts or internal package paths into a consumer project.

## Consumer Game Architecture

Real games should keep `src/main.ts` as a bootstrap entrypoint rather than a large demo file. Prefer this module split as the project grows:

- `src/runtime/`: `createFerrumRuntime(...)`, lifecycle, renderer/input/audio wiring, and public API adapter seams.
- `src/game/`: Game Spec fragments, projectile/weapon authoring data, scene flow, and gameplay command selection.
- `src/assets/`: app-owned asset manifests, URLs, atlas metadata, and load/preload helpers.
- `src/ui/`: HUD, menus, panels, pause/restart UI, and app-facing callbacks.
- `src/dev/`: smoke globals, runtime reports, replay diagnostics, debug-only panels, and local test hooks.
- `tests/playtest/`: scripted browser/manual playtest scenarios, reproduction notes, and non-shipping test assets.

Use `ferrum-consumer-architecture` when a task changes file layout, grows `src/main.ts`, adds reusable runtime adapters, or mixes smoke/report code with shippable gameplay. UI modules should call app-owned service functions instead of scattering raw `runtime.engine.*` calls. Dev/report modules may observe runtime state but should not own gameplay behavior.

## Standard Commands

Generated projects from `@ferrum2d/create-game` include:

- `npm run ferrum:report`: print package, asset, spec, and validation context for agents.
- `npm run ferrum:asset-report`: print texture, audio, localization, atlas metadata, and Game Spec asset status when the project includes `scripts/ferrum-assets.mjs`.
- `npm run ferrum:asset-validate`: validate asset manifests through the public `@ferrum2d/ferrum-web` entrypoint when the project includes `scripts/ferrum-assets.mjs`.
- `npm run ferrum:validate`: check package dependency, public imports, and `public/game.json` when present.
- `npm run ferrum:authoring-report`: validate data-driven gameplay authoring and print a machine-readable report.
- `npm run ferrum:replay-report`: print deterministic replay status; templates without replay fixtures report `not-configured`.
- `npm run ferrum:update-replay-fixture`: update a project-provided replay fixture when the project explicitly provides this script, for example the `topdown` template Game Spec contract fixture.
- `npm run ferrum:runtime-replay-report`: print project-specific runtime replay status; generated projects report `not-configured` until `scripts/ferrum-runtime-replay.mjs` is filled in.
- `npm run ferrum:runtime-replay-recipe`: print the template-specific runtime replay capture recipe that agents should follow before enabling project runtime replay.
- `npm run ferrum:update-runtime-replay-fixture`: update a project-specific runtime replay fixture only after the project implements deterministic runtime snapshot capture.
- `npm run ferrum:smoke`: run `ferrum:validate` and the production build.
- `npm run dev`: launch the local Vite server for browser playtest.
- `npm run build`: create the static production artifact.

If a project was created before these commands existed, add the same scripts before relying on the harness.

## Agent-First Gameplay Reports

Ferrum2D authoring/report scripts provide agent workflow evidence:

- `npm run ferrum:authoring-report`: validate data-driven gameplay authoring and print a machine-readable report.
- `npm run ferrum:replay-report`: print deterministic gameplay replay status as a machine-readable report.

Use these stdout reports, or file artifacts when a project-specific wrapper writes them, as validate/run evidence in a `propose -> validate -> apply -> run -> telemetry` loop. A report is useful evidence when it has a stable `format`, `version`, `ok` flag, and machine-actionable `reports[]` entries with `path`, `message`, and `suggestion` when it fails. Engine workspace report artifacts use `ferrum2d.gameplay-authoring.dry-run-report` and `ferrum2d.gameplay-replay.smoke-report`; generated consumer projects use `ferrum2d.consumer.gameplay-authoring.report` and `ferrum2d.consumer.gameplay-replay.report`.

For generated projects with `sceneAuthoring.configured`, `gameplayAuthoring.sceneAuthoring.summary.placementAuthoring` is the machine-readable bridge between a placement viewer and an agent. `instances[]` reports `instanceId`, `prefab`, `role`, `runtimeEntity`, `behaviorProfiles`, `behaviorCommandCount`, `behaviorCommandTypes`, `behaviorBindings[].recipeId`, `bindingPath`, `behaviorRecipePath`, and the resolved runtime entity handle. Use it to confirm that a selected object id maps to the intended behavior target before editing behavior recipes.

When a handoff or patch includes `objectDefinitions` or an `addObjectDefinition` operation, treat it as reusable object catalog work. The definition's `props.components.visual`/`collider`/`layer` describes the object template; behavior attachment still belongs in `sceneComposition.prefabs[].props.behaviorRecipes` or `behaviorRecipes.entities`. If the handoff selected instance was created from a draft ObjectDefinition, verify the resolved `prefab`, `visual`, and `collider` in the report or viewer state before attaching behavior.

If a consumer project provides a local report artifact validator, run it after generating the report artifacts. Do not require Ferrum2D engine repo schema files or engine workspace `pnpm` report commands in ordinary consumer games unless that project explicitly added them. Do not run fixture update commands just to make a failing replay report pass; update fixtures only after the intended gameplay/spec change is understood and reported.

## Project-Specific Runtime Replay

Generated templates provide template-surface replay fixtures. When a game needs replay evidence for actual runtime behavior, add a project-owned runner and fixture using `.agents/harness/ferrum-runtime-replay.md`.

The runtime replay harness must use only public imports from `@ferrum2d/ferrum-web`, especially `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, and `hashGameStateSnapshot(...)`. Run `npm run ferrum:runtime-replay-recipe` first when available; it gives the agent a machine-readable fixed timestep, seed/input sequence, capture frame, and canonical state plan. Do not import engine workspace files or generated Wasm internals into a consumer project.

## Boundaries

- Do not edit installed `node_modules/@ferrum2d/ferrum-web` files.
- Do not import `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, or `@ferrum2d/ferrum-web/src/*`.
- Do not use consumer agents for Ferrum2D engine internals, npm publishing, release tags, or package allowlists.
- Treat remote deploys and publishing as external-state changes requiring explicit user approval.
