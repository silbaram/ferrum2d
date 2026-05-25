# Ferrum2D Consumer Game Development Harness

Use this harness for games that depend on `@ferrum2d/ferrum-web`.

## Product Goal

Ferrum2D consumer projects are AI agent-first. The default development loop is not a visual editor. Agents should modify app code, Game Spec, Physics Spec, assets, and metadata through explicit files, then prove the result with local validation and smoke commands.

## Standard Loop

1. Inspect `package.json`, `src/`, `public/`, `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.
2. Identify whether the task is project setup, spec data, assets, gameplay glue, playtest, or build.
3. Use the matching `ferrum-consumer-*` skill under `.agents/skills/`.
4. Prefer public imports from `@ferrum2d/ferrum-web`.
5. Run the narrowest command that proves the change.
6. Report commands, result, skipped checks, and next action.

## Standard Commands

Generated projects from `@ferrum2d/create-game` include:

- `npm run ferrum:report`: print package, asset, spec, and validation context for agents.
- `npm run ferrum:validate`: check package dependency, public imports, and `public/game.json` when present.
- `npm run ferrum:smoke`: run `ferrum:validate` and the production build.
- `npm run dev`: launch the local Vite server for browser playtest.
- `npm run build`: create the static production artifact.

If a project was created before these commands existed, add the same scripts before relying on the harness.

## Boundaries

- Do not edit installed `node_modules/@ferrum2d/ferrum-web` files.
- Do not import `@ferrum2d/ferrum-web/dist/*`, `pkg/*`, or `src/*`.
- Do not use consumer agents for Ferrum2D engine internals, npm publishing, release tags, or package allowlists.
- Treat remote deploys and publishing as external-state changes requiring explicit user approval.
