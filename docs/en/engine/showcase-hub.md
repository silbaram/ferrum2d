# Ferrum2D Feature and Example Guide

[한국어](../../engine/showcase-hub.md) · English

Use the [public demo site](https://silbaram.github.io/ferrum2d/) to try engine features without installing tools.
The Feature Lab separates each topic into a small scene with controls, observations, and implementation API names.
All 31 experiments explain a game use case, ordered steps, object roles, and a visual legend. Primary actions sit next to the scene.
Frame strips, camera bounds, and loading dashboards expose the comparison; dialogue and HUD use the actual engine UI inside the game view.
Technical statistics are available under a collapsed details section.
To run it from the engine source, use `pnpm dev:starter-runtime`.

The site entry opens the Feature Lab directly. Use its topic menu for **individual features** and the example switcher for **games, advanced physics, and authoring tools**.
Ten topics cover lighting, physics, cameras, sprites, world movement, VFX, gameplay, UI/input, audio, and runtime assets. The physics topic also links to all seven advanced scenarios. Game and lab examples share navigation, typography, colors, instructions, observations, and related experiments.
`examples/shared/exampleCatalog.json` defines example roles; `featureCatalog.json` defines individual experiments.
Minimal, the original shooter starter, and Engine Playground remain reference/test routes outside the main catalog.

These descriptions cover the development source. Demo controls may be in Korean; changing documentation language does not translate the demo UI.
Ferrum2D Studio provides its own English/Korean setting.

## Independent feature experiments

Each link opens the corresponding experiment in Starter Runtime. Reset restores its baseline scene and settings.

| Experiment | What to try and observe |
| --- | --- |
| [Sprite animation](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=animation) | Switch idle/walk clips, playback direction, frame events, and one-shot completion. |
| [Navigation and obstacles](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=navigation) | Select a destination across a wall and observe the native route around it. |
| [Physics materials](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=physics) | Launch rubber and clay balls with the same impulse to compare bounce and damping. |
| [Normal-map lighting](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=lighting) | Move a point light and compare lighting with and without surface normals. |
| [Post-processing](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=postprocess) | Compare the original with bloom, CRT, vignette, glitch, pixel-art color, and fade, including intensity. |
| [Camera tracking and zoom](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=camera) | Compare fixed/tracking cameras, zoom, a short screen impulse, and world bounds. |
| [9-slice borders](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=nine-slice) | Compare ordinary image scaling against panels that preserve corner thickness. |
| [Tilemaps and collision](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=tilemap) | Edit wall/floor tiles and observe rendering and native collision updating together. |
| [Drawing layers](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=layers) | Change overlapping objects' drawing order without moving them. |
| [Particles and VFX](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=particles) | Compare sharp sparks and expanding dust side by side; switch distinct textures/defaults, emission, count, lifetime, and speed. |
| [Spatial audio](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=audio) | Move a sound source and compare stereo position, distance, and volume. |
| [Input switching](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=input) | Compare keyboard, gamepad, virtual controls, and modal input blocking. |
| [Scene transitions](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=scenes) | Switch scenes, inspect local/global counters, and pause during a fade. |
| [Interaction and triggers](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=interaction) | Try distance and switch conditions, door interaction, and region entry/exit. |
| [Save and load](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=save-load) | Save and restore movement and collection progress, then delete the demo slot. |
| [Dialogue and quests](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=dialogue) | Accept or refuse a quest and complete its delivery conditions. |
| [HUD, localization, and accessibility](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=hud) | Change health, text size, contrast, and the HUD language. |
| [Projectiles and wall impacts](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=projectiles) | Compare ordinary, penetrating, and bouncing projectiles at the same speed. |
| [Cutscenes and reduced motion](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=cutscene) | Play or skip a sequence and compare subtitles, audio, and reduced motion. |
| [Asset loading and caching](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=asset-loading) | Compare fetching and session cache reuse, cancel a load, and retry after failure. |
| [Level streaming](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=streaming) | Change zones and inspect unique textures being released while shared ground remains. |
| [HD-2D movement](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=hd2d-movement) | Traverse slopes and floors and ride vertical/horizontal platforms. |
| [AI pursuit and combat](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=ai-combat) | Observe obstacle avoidance, melee damage, and ranged projectiles. |
| [Parent/child attachments](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=attachments) | Move or rotate a cart and detach/reattach a child object. |
| [HD-2D lights, shadows, and fog](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=hd2d-environment) | Compare point/sun/mixed lighting, sun direction, hard/PCF shadows, fog, bloom, AO, DOF, and ACES. |
| [Destructible terrain](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=destructible-terrain) | Erase a mask, drop a ball through the opening, and observe collider chunk updates. |

Audio may require a click or key press before the browser permits playback.
WebGPU is optional; the default renderer is WebGL2.
| [Area queries and shape casts](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=physics-queries) | Compare circle/AABB overlap and moving-circle casts using native hits. |
| [Pixel resolution and snapping](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=pixel-perfect) | Compare virtual resolution and fractional positions with display snapping. |
| [Sprite appearance](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=sprite-materials) | Compare palette replacement, hit flash, and outline on the same source images. |
| [Rendering and GPU resources](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=rendering) | Compare command/draw counts and texture allocation/release; memory values are estimates. |

## Integrated examples and authoring tools

| Example | What it demonstrates | Local command |
| --- | --- | --- |
| [Feature Lab](https://silbaram.github.io/ferrum2d/starter-runtime/) | Start with the 31 focused experiments | `pnpm dev:starter-runtime` |
| [Ferrum2D Studio](https://silbaram.github.io/ferrum2d/placement-viewer/) | Garden/village placement, transforms, layers, game cameras, pixel editing, and change review | `pnpm dev:placement-viewer` |
| [Physics Sandbox](https://silbaram.github.io/ferrum2d/physics-sandbox/) | Seven focused Physics Spec scenarios and native diagnostics | `pnpm dev:physics-sandbox` |
| [Top-down Shooter](https://silbaram.github.io/ferrum2d/topdown-shooter/) | Neon Outpost pixel arena, three enemy waves, native HUD, pause/restart, lighting settings, and mobile controls | `pnpm dev:topdown` |
| [Breakout](https://silbaram.github.io/ferrum2d/breakout/) | Reflection, collision events, scoring, and particles | `pnpm dev:breakout` |
| [Platformer](https://silbaram.github.io/ferrum2d/platformer/) | Jumping, one-way platforms, and moving platforms | `pnpm dev:platformer` |
| [Little Garden of Light](https://silbaram.github.io/ferrum2d/pixel-art/) | Pixel sources, movement/collection, normal lighting, palette swaps, and post-processing | `pnpm dev:pixel-art` |

The built-in examples in the browser version of Studio are export only. See the [User Guide](user-guide.md#edit-and-play-in-studio)
for saving boundaries and the distinction between the editor camera and game camera.

## Develop with an agent

1. Use the [Developer Quickstart](developer-quickstart.md) to create a project from a selected GitHub Release.
2. Run `npm run ferrum:agents` in the generated project to install its agent instructions.
3. Run `npm run ferrum:check` and inspect `npm run ferrum:report` for the project's runtime inputs.
4. Edit specifications, assets, or bootstrap code through [public APIs](public-api.md).
5. Validate and inspect the actual browser result. Use `npm run ferrum:placement-viewer` when placement review is useful.

For engine-source regression coverage, use the [Smoke Check reference (Korean)](../../development/quality/smoke-check.md).
The Feature Lab's maintained browser check is `pnpm smoke:feature-examples`.

## Documentation and release versions

Pages contains the documentation and demos from the deployed development commit.
It is updated separately from downloadable release packages. Check the installed release's types and contracts before using a feature.
Advanced reference pages are currently in Korean; the [English documentation index](../README.md) identifies those links.
