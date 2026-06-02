# Ferrum2D Consumer Game Development Harness

Use this harness for games that depend on `@ferrum2d/ferrum-web`.

## Product Goal

Ferrum2D consumer projects are AI agent-first. The default development loop is not a visual editor. Agents should modify app code, Game Spec, Physics Spec, assets, and metadata through explicit files, then prove the result with local validation and smoke commands.

## Standard Loop

1. Inspect `package.json`, `src/`, `public/`, `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.
2. Identify whether the task is project setup, spec data, assets, gameplay glue, playtest, or build.
3. Use the matching `ferrum-consumer-*` skill under `.agents/skills/`.
4. Prefer public imports from `@ferrum2d/ferrum-web`.
5. For data-driven gameplay or behavior changes, run an authoring validation command before browser playtest when the project provides one.
6. For project-specific deterministic runtime replay beyond template surface fixtures, follow `.agents/harness/ferrum-runtime-replay.md`.
7. Run the narrowest command that proves the change.
8. Report commands, result, skipped checks, and next action.

## Standard Commands

Generated projects from `@ferrum2d/create-game` include:

- `npm run ferrum:report`: print package, asset, spec, and validation context for agents.
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

If a consumer project provides a local report artifact validator, run it after generating the report artifacts. Do not require Ferrum2D engine repo schema files or engine workspace `pnpm` report commands in ordinary consumer games unless that project explicitly added them. Do not run fixture update commands just to make a failing replay report pass; update fixtures only after the intended gameplay/spec change is understood and reported.

## Project-Specific Runtime Replay

Generated templates provide template-surface replay fixtures. When a game needs replay evidence for actual runtime behavior, add a project-owned runner and fixture using `.agents/harness/ferrum-runtime-replay.md`.

The runtime replay harness must use only public imports from `@ferrum2d/ferrum-web`, especially `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, and `hashGameStateSnapshot(...)`. Run `npm run ferrum:runtime-replay-recipe` first when available; it gives the agent a machine-readable fixed timestep, seed/input sequence, capture frame, and canonical state plan. Do not import engine workspace files or generated Wasm internals into a consumer project.

## Boundaries

- Do not edit installed `node_modules/@ferrum2d/ferrum-web` files.
- Do not import `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, or `@ferrum2d/ferrum-web/src/*`.
- Do not use consumer agents for Ferrum2D engine internals, npm publishing, release tags, or package allowlists.
- Treat remote deploys and publishing as external-state changes requiring explicit user approval.
