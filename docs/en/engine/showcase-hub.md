# Explore Features and Examples

[한국어](../../engine/showcase-hub.md) · English

Try engine features without installing tools. Follow the actions and expected results shown in each demo.
Open the [Feature Lab](https://silbaram.github.io/ferrum2d/starter-runtime/) to choose a topic, or use the direct links below.
Some controls are in Korean. For audio, click the screen or press Play first.

## Three experiments to try first

1. **Normal lighting:** move the light and toggle normals to compare depth on the same image.
2. **Navigation:** click beyond a wall and watch the character walk around it.
3. **9-slice:** resize a dialogue box and compare ordinary stretching with preserved corners.

## Feature map

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
| [HD-2D shadow comparison](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=hd2d-shadow-proxy) | Change camera, character height, and sun angle to compare shadow placement. |
| [Destructible terrain](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=destructible-terrain) | Erase a mask, drop a ball through the opening, and observe collider chunk updates. |
| [Area queries and shape casts](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=physics-queries) | Compare circle/AABB overlap and moving-circle casts using native hits. |
| [Pixel resolution and snapping](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=pixel-perfect) | Compare virtual resolution and fractional positions with display snapping. |
| [Sprite appearance](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=sprite-materials) | Compare palette replacement, hit flash, and outline on the same source images. |
| [Rendering and GPU resources](https://silbaram.github.io/ferrum2d/starter-runtime/?feature=rendering) | Compare command/draw counts and texture allocation/release; memory values are estimates. |

Reset each experiment to compare again. For exact options, see the [shared references](../README.md#shared-detailed-references).
Give an agent [AI Game Development](ai-game-development.md) when you want a feature implemented in your game.

## Games and Studio

| Example | Open | What to try |
| --- | --- | --- |
| Top-down Shooter | [Play](https://silbaram.github.io/ferrum2d/topdown-shooter/) | Move, aim, fire, and survive enemy waves. |
| Platformer | [Play](https://silbaram.github.io/ferrum2d/platformer/) | Jump and ride one-way/moving platforms. |
| Breakout | [Play](https://silbaram.github.io/ferrum2d/breakout/) | Reflect the ball and remove bricks. |
| Physics Lab | [Open](https://silbaram.github.io/ferrum2d/physics-sandbox/) | Choose a scenario and compare collisions, materials, and joints. |
| Little Garden of Light | [Play](https://silbaram.github.io/ferrum2d/pixel-art/) | Click to move, collect seeds, and compare pixel sources, normal lighting, and palettes. |
| 2D Lantern Garden | [Open Studio](https://silbaram.github.io/ferrum2d/studio/?scene=garden) | Compare editing, game preview, and play. |
| HD-2D Village | [Open Studio](https://silbaram.github.io/ferrum2d/studio/?scene=village) | Adjust a spatial scene, its camera, and lighting. |

See the [Simple User Guide](user-guide.md#edit-and-play-in-studio) for Studio controls and saving.

## Continue in your own project

[Run Your First Game](developer-quickstart.md) covers installation, play, and a small setting change.
Web examples use deployed development source and may differ from your installed release.
