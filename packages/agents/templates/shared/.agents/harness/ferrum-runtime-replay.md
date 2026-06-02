# Ferrum2D Consumer Runtime Replay Harness

Use this harness when a consumer game needs deterministic replay evidence beyond the default template surface fixture.

## Purpose

Generated `@ferrum2d/create-game` templates include `npm run ferrum:replay-report` and committed template-surface fixtures. Those fixtures prove the generated project contract, package scripts, and public replay helper shape. They do not prove a game-specific runtime sequence unless the project adds its own runner.

Project-specific runtime replay should stay agent-first:

- Capture fixed-timestep gameplay state from the project runtime or an explicit headless runner.
- Convert captured frames into `GameStateSnapshot` objects.
- Build a replay with `createGameplayReplayRun(...)`.
- Compare against a committed fixture with `compareGameplayReplayRuns(...)`.
- Report machine-actionable mismatch details with JSON paths and patch candidates.

## Public API Boundary

Consumer replay harnesses must import needed helpers from the package public entrypoint only. The replay comparison core normally uses:

```js
import {
  compareGameplayReplayRuns,
  createGameplayReplayRun,
  hashGameStateSnapshot,
} from "@ferrum2d/ferrum-web";
```

Do not import from `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, `@ferrum2d/ferrum-web/src/*`, generated Wasm bindings, or an engine workspace checkout.

## Fixture Contract

A project-specific replay fixture should be a committed JSON file under `public/` or another project-owned test fixture directory. Keep it separate from ad hoc browser screenshots or profiler output.

Minimum fixture shape:

- `format`: project-specific stable format string.
- `version`: positive integer.
- `scenario`: stable scenario id.
- `fixedDelta`: fixed timestep used by the runner.
- `captureFrames`: sorted frame numbers captured by the runner.
- `coverageTagDefinitionsPath`: relative path to the coverage vocabulary file when the project provides one.
- `coverageTags`: active coverage tags used by the fixture.
- `replay`: `GameplayReplayRun` from `createGameplayReplayRun(...)`.

Coverage vocabulary files should use the same common shape as generated templates:

- `coverageTagDefinitions`
- `coverageTagGroups`
- `deprecatedCoverageTags`

Generated agents should reject active fixture tags that are missing, deprecated, or not grouped.

## Report Contract

`npm run ferrum:replay-report` should keep the generated report envelope and extend it with the project-specific scenario result.

Expected report fields:

- `format`
- `version`
- `ok`
- `reports[]`
- `gameplayReplay.configured`
- `gameplayReplay.status`
- `gameplayReplay.scenario`
- `gameplayReplay.replayHash`
- `gameplayReplay.comparison`

On mismatch, include a report entry with:

- `kind`: `error`
- `code`: stable project-owned code, for example `FERRUM_CONSUMER_REPLAY_MISMATCH`
- `path`: `gameplayReplay.snapshots.N.snapshot...` when available
- `message`
- `expected`
- `actual`
- `suggestion`

If the harness can compute an updated fixture without changing external state, include a `patchCandidate` or equivalent JSON value in stdout. Do not overwrite fixtures unless the user explicitly runs `npm run ferrum:update-replay-fixture`.

## Runner Rules

- Use a fixed timestep and deterministic seed.
- Capture only canonical gameplay state: scene state, score, entity transforms/velocity/health/lifetime, relevant project-owned custom state.
- Exclude render commands, audio playback, wall-clock timing, DOM state, debug overlay, and profiler output from replay hashes.
- Avoid per-entity JS/Wasm calls inside the runtime frame loop. Gather low-frequency snapshots after frame execution.
- Keep project-specific browser/UI effects behind frame-end adapters, not inside Rust simulation callbacks.
- Prefer one small scenario per behavior contract over one large fixture that is hard for agents to diagnose.

## Authoring Loop

Use this order for gameplay changes that affect runtime behavior:

1. Edit Game Spec, Behavior Spec, assets, or app glue.
2. Run `npm run ferrum:authoring-report` when provided.
3. Run `npm run ferrum:replay-report`.
4. If the mismatch is expected, inspect the JSON path diff and patch candidate.
5. Run `npm run ferrum:update-replay-fixture` only after confirming the intended gameplay change.
6. Run `npm run ferrum:smoke` or `npm run build`.

Do not update a fixture to hide an unexplained regression.
