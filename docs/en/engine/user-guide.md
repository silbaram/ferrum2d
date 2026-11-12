# Ferrum2D User Guide

[한국어](../../engine/user-guide.md) · English

Ferrum2D is an **AI agent-first 2D and HD-2D web game engine**. Rust/Wasm owns game state, collision,
scene progression, and render command generation. TypeScript handles browser input, asset loading, audio,
and WebGL2 or optional WebGPU rendering. Agents edit specifications and code, and people inspect the result in Ferrum2D Studio.

This guide describes the development source. When using a released package, check its installed types and the documentation for that release.

## Choose a starting point

| Goal | Start with |
| --- | --- |
| Try features without installing anything | [Feature and Example Guide](showcase-hub.md) and the [demo site](https://silbaram.github.io/ferrum2d/) |
| Create a game project | [Developer Quickstart](developer-quickstart.md) |
| Select a public API | [Public API](public-api.md) |
| Edit scenes, assets, or cameras | [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) |
| Ask an agent to set up tools without creating game code | [AI Installation (Korean)](../../engine/ai-agent-install.md) |

## Current capabilities

| Area | Features | Detailed reference |
| --- | --- | --- |
| 2D rendering | Sprites, animation, tilemaps, layers, 9-slice, pixel-perfect presentation, palettes, and post-processing | [Presentation (Korean)](../../engine/data-scene-presentation.md), [Core API (Korean)](../../engine/public-api/core.md) |
| HD-2D | Terrain, slopes, floors, static models, billboards, cameras, lights, and shadows | [Spatial Scenes (Korean)](../../engine/data-scene-spatial.md) |
| Gameplay | Movement, navigation, triggers, dialogue, quests, saving, combat, and scene transitions | [Native Runtime (Korean)](../../engine/data-scene-native-runtime.md) |
| Physics | Bodies, colliders, materials, joints, CCD, queries, controllers, and destructible terrain | [Physics Spec (Korean)](../../engine/physics-spec.md) |
| Authoring tools | Scene browsing, placement, transforms, layers, game cameras, pixel editing, PNG import, and normal generation | [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) |
| Asset integration | Atlases, Tiled/LDtk and Aseprite data, loading, caching, and resource lifetime management | [Core API (Korean)](../../engine/public-api/core.md), [Authoring API (Korean)](../../engine/public-api/authoring.md) |

Each reference defines its supported inputs and limits. TypeScript connects content and platform services;
Rust remains the source of truth for gameplay progression and physics.

## Run the repository examples

Prepare the source environment in the [Developer Quickstart](developer-quickstart.md#work-on-the-engine-source), then run commands from the repository root.
Run `pnpm build` before the first launch or after modifying Rust. Use the address and port printed by Vite.

| Example | Command | What to inspect |
| --- | --- | --- |
| Engine Feature Lab | `pnpm dev:starter-runtime` | 31 independent experiments with controls, observations, and API names |
| 2D garden and HD-2D village | `pnpm dev:placement-viewer` | Use `?scene=garden` or `?scene=village` for placement and game preview |
| Physics Sandbox | `pnpm dev:physics-sandbox` | Seven focused scenarios and collision/solver diagnostics |
| Top-down Shooter | `pnpm dev:topdown` | Movement, aiming, projectiles, waves, scoring, and Game Spec |
| Breakout | `pnpm dev:breakout` | Reflection, collision events, brick removal, and particles |
| Platformer | `pnpm dev:platformer` | Jumping, one-way platforms, and moving platforms |
| Little Garden of Light | `pnpm dev:pixel-art` | Editable pixel sources, collection, lighting, palettes, and effects |

Follow **topic-based experiments → game applications**. The site entry opens the Feature Lab directly.
Use the example switcher to open games, advanced physics, or authoring tools, and the topic menu to select individual experiments. Each screen provides instructions, observations, and related experiments.
Run `pnpm build && pnpm build:pages && pnpm preview:examples` to browse the whole suite locally.
A standalone Vite server explains how to launch the suite rather than linking to apps it cannot serve.
Minimal and the legacy `?mode=playground`/`?mode=starter` routes remain reference/test fixtures, outside the main catalog.
The [feature guide](showcase-hub.md) lists all experiments.

## Edit and play in Studio

1. Open the garden or village through **File → Examples**, or open a project's Scene Authoring JSON.
2. Select objects and change placement, transforms, layers, or assets. Use **My Changes** to compare against the original document.
3. Use **Game Preview** to inspect the authored game camera and **Play** to run the supported scene behavior.
4. **Stop** restores authored placement, drafts, and the editor camera. A character's runtime position is not saved as its authored placement.
5. Save or export according to the storage mode shown for the current document.

The editor camera navigates the workspace. The game camera defines the view saved for gameplay.
Game Preview runs the Scene Authoring runtime; it does not automatically execute an external project's arbitrary TypeScript entrypoint or custom HUD.

| Environment | Saving and project access |
| --- | --- |
| GitHub Pages and built-in browser examples | Export only. They do not overwrite the example source or a local project automatically. |
| Local development server | Saving is disabled by default. An explicitly enabled adapter/endpoint can save within its permitted scope. |
| Desktop application | Saving uses the project, document, and asset paths authorized by the host. |

Scene and pixel-source saving are separate from `.ferrum-placement-handoff.json`.
The handoff communicates selection, drafts, and asset references to an agent; it is not a replacement for saving the scene.
The [Studio guide (Korean)](https://github.com/silbaram/ferrum2d/blob/main/apps/placement-viewer/README.md) covers storage permissions,
English/Korean UI, and `Ctrl+K` command search.

## Files to edit in a game project

| Input | Generated project path | Reference |
| --- | --- | --- |
| Shooter balance, waves, weapons, and camera | `public/game.json` in the `topdown` template | [Game Spec (Korean)](../../examples/topdown-shooter/game-spec.md) |
| Scenes, prefabs, placement, and asset references | `public/scene-authoring.json` | [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) |
| Images, audio, and tile sources | `public/assets/` and asset metadata | [Authoring API (Korean)](../../engine/public-api/authoring.md) |
| Runtime bootstrap, HUD, and platform integration | `src/main.ts`, `src/styles.css` | [Core API (Korean)](../../engine/public-api/core.md) |
| Physics authoring | The project's Physics Spec input | [Physics Spec (Korean)](../../engine/physics-spec.md) |

How a scene file affects gameplay depends on the template and bootstrap. Opening it in Studio does not wire it into another entrypoint.
Check `project.runtimeInputs` in `npm run ferrum:report`.

## Make and verify a change

1. Check the installed package's public types and the relevant feature contract.
2. Edit the specification, assets, or code. Use Studio drafts and handoff data when useful.
3. Run the generated project's standard check:

```bash
npm run ferrum:check
```

This runs validation, authoring/replay checks, and a production build in sequence.
If it fails, read the JSON report's failed step and suggested next command.
Then use `npm run dev` to check actual controls, gameplay, camera behavior, and audio.
Before static deployment, run `npm run ferrum:deploy-report` and `npm run preview`.
Install the generated project's agent instructions explicitly with `npm run ferrum:agents`.

## Change the Top-down Shooter example

In the engine repository, edit `examples/topdown-shooter/public/game.json`.
See [Game Spec (Korean)](../../examples/topdown-shooter/game-spec.md) for fields, defaults, constraints, and presets.

```bash
pnpm validate:game-spec
pnpm dev:topdown
```

| Input | Action |
| --- | --- |
| Enter or Space | Start from the title screen |
| W/A/S/D | Move |
| Mouse movement | Aim |
| Left mouse button or Space | Fire |
| Space after game over | Restart |

Append `?debug=true` to show the debug overlay. Touch, gamepad, virtual controls, and input contexts are described in
[Input Actions (Korean)](../../engine/input-actions.md).

## Support boundaries

WebGL2 is the default renderer. WebGPU is optional and depends on browser support and feature-specific contracts.
HD-2D combines 2D gameplay with static models and terrain.
General-purpose visual editing of Behavior Recipe bodies or FSM/action graphs, multiplayer, Wasm threads,
and skeletal animation require separate design and approval.

Continue with the [Public API](public-api.md), [architecture (Korean)](../../development/architecture/architecture.md),
or [regression checks (Korean)](../../development/quality/smoke-check.md).
