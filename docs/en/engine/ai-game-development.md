# AI Game Development

[한국어](../../engine/ai-game-development.md) · English

For **AI agents implementing or modifying games that use Ferrum2D**.
This guide defines the working sequence. Use the [shared references](../README.md#shared-detailed-references)
for API behavior and the installed `.agents/harness/ferrum-feature-guide.md` to choose features.

Point people to the [Simple User Guide](user-guide.md). Work on the engine itself follows its repository `AGENTS.md`
and [development documentation (Korean)](../../development/architecture/architecture.md).

## 1. Identify the request and project

| Request | Starting action |
| --- | --- |
| Setup only | Follow [AI Installation (Korean)](../../engine/ai-agent-install.md); do not generate a game as part of setup. |
| New game | Use the release generator from [Run Your First Game](developer-quickstart.md), choosing the appropriate template. |
| Existing game | Inspect existing instructions, files, and user changes before editing. Do not overwrite the project with a template. |

Read the applicable `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` and installed consumer harness.
The consumer harness is for game development, separate from engine release and package QA procedures.
Check:

- `package.json`, lockfile, and `FERRUM_INSTALL.md` for scripts, package manager, and provenance.
- The installed `@ferrum2d/ferrum-web/package.json` and public `.d.ts` for the actual version and APIs.
- Existing entrypoints, specifications, assets, and uncommitted changes for current behavior and scope.

Web documentation may describe newer development source. Check the installed types and matching tag documentation.
Do not call unavailable APIs based only on the current docs. Explain supported alternatives or the upgrade scope when needed.

The current source uses `@ferrum2d/studio-kit`, `studio.html`, and `ferrum:studio`.
Beta.9 and earlier retain `authoring-viewer`, `placement-viewer.html`, and `ferrum:placement-viewer`.
Do not rename old release URLs to the new package names.

## 2. Find the inputs used by the running game

When provided by the project, run from its root:

```bash
npm run ferrum:report
```

Read `project.runtimeInputs` to find the active files and their integration.
The existence of `public/scene-authoring.json`, or opening it in Studio, does not prove that the game uses it.
If a custom project has no report command, inspect its bootstrap and scripts for equivalent evidence.

| Change | First input to inspect | Detailed reference |
| --- | --- | --- |
| Shooter balance, weapons, waves | `topdown`'s `public/game.json` | [Game Spec (Korean)](../../examples/topdown-shooter/game-spec.md) |
| Placement, prefabs, components, behavior references | The connected Scene Authoring JSON | [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) |
| Movement, interaction, combat, progress saving | Gameplay settings and native runtime wiring | [Native Runtime (Korean)](../../engine/data-scene-native-runtime.md), [Authoring API (Korean)](../../engine/public-api/authoring.md) |
| Clips, 2D materials, lighting, effects | Scene visual/lighting and presentation settings | [Presentation (Korean)](../../engine/data-scene-presentation.md) |
| HD-2D terrain, models, cameras, environment | `spatial` and asset registration/preparation | [Spatial Scenes (Korean)](../../engine/data-scene-spatial.md) |
| Physics and input | Physics Spec, action/context configuration, bootstrap | [Physics (Korean)](../../engine/physics-spec.md), [Input (Korean)](../../engine/input-actions.md) |
| Images, sounds, tile sources | `public/assets/`, actual manifests and registries | [Core (Korean)](../../engine/public-api/core.md), [Authoring (Korean)](../../engine/public-api/authoring.md) |
| Initialization, HUD, browser integration | `src/main.ts`, `src/styles.css`, project modules | [Core API (Korean)](../../engine/public-api/core.md) |

These paths describe generated templates; observed runtime inputs take precedence.
Use [AI Feature Lookup (Korean)](../../engine/ai-feature-guide.md) for the installed feature guide and reference links.

## 3. Implement the change

1. Define an observable result, such as faster movement, blocked wall traversal, or restoring a saved position.
2. Check existing specifications, assets, and public APIs, then edit the relevant files.
3. Connect authored data to the actual bootstrap, registry, and runtime input.
4. Check relevant failure conditions, including saving, scene replacement, cancellation, and resource lifetime.

Use the purpose-specific subpaths in [Public API](public-api.md), not engine `src/*`, `dist/*`, or `pkg/*` internals.
Do not duplicate native gameplay, physics, or animation state in a TypeScript frame loop.
Identify the boundary when a feature requires separate engine work. Studio does not edit recipe bodies/FSM graphs or execute arbitrary game entrypoints.

Compare Studio patches and handoffs with their target document, source, and asset references before applying them.
A handoff is not the saved scene. Confirm that the game uses the changed file.

## 4. Validate

For generated projects, run the standard check with the actual package manager and available scripts:

```bash
npm run ferrum:check
```

It runs validation, assets, authoring, replay, and build stages, reporting the first failure.
Read `check.failedStep`, `check.nextCommand`, and the failed entry's `diagnosticCodes` and output in `check.steps[]`.
Fix the cause, then check the affected stage and full sequence.
Use detailed commands as needed:

| Script | Checks |
| --- | --- |
| `ferrum:validate` | Game Spec and basic generated inputs |
| `ferrum:asset-report`, `ferrum:asset-validate` | Assets, atlas, audio, localization inputs and references |
| `ferrum:authoring-report` | Scene Authoring and Behavior Recipe bindings |
| `ferrum:replay-report` | Authoring/gameplay replay fixture |
| `ferrum:runtime-replay-report` | Actual runtime replay and expected state |
| `ferrum:smoke` | Generated project validation/build |
| `ferrum:deploy-report` | Build, relative assets, actual preview HTTP, Wasm MIME |

Run each as `npm run <script>`. Do not assume a missing script exists or require engine-repository smoke/package commands in a game project.

If gameplay changes a replay, inspect the first difference, inputs, seed, and intended behavior.
Do not blindly replace expected hashes or snapshots. Only after confirming an intentional change, use the appropriate
`ferrum:update-replay-fixture` or `ferrum:update-runtime-replay-fixture` script, then validate again.

## 5. Check the game and deployment output

Run `npm run dev`, exercise the changed feature, and compare the visible result.
Loading, configuration round-trips, and report generation alone do not prove gameplay success.
Record interactions, audio, or device checks that could not be performed as unverified.

For a deployment request, prepare locally:

```bash
npm run ferrum:deploy-report
npm run preview
```

`ready` covers supported static-path checks and local HTTP/Wasm responses.
The check's limitations include HTML `<base>` and relative literal `fetch(...)` across HTML entries in different directories.
See the [deployment contract (Korean)](../../development/operations/npm-package-strategy.md).
Target-host execution/MIME/input checks and remote publication are separate; do not report local preparation as publication.

## 6. Report to the person

Include changed behavior and key files, validation results and skipped/failed checks with reasons,
the run command and controls to try, and remaining issues or required environments.
Lead with results and how to run the game. Link detailed reports and shared references when useful.
