# Ferrum2D Documentation

[한국어](../README.md) · English

Choose a path: **simple instructions for people using the engine**, or **a workflow for AI agents building games with it**.
Both paths use the same detailed API and data references.

## Simple guides for people

| Goal | Guide |
| --- | --- |
| Understand the engine and try Studio | [Simple User Guide](engine/user-guide.md) |
| Run a first game and change one setting | [Run Your First Game](engine/developer-quickstart.md) |
| Try lighting, physics, animation, and other features without installing tools | [Explore Features and Examples](engine/showcase-hub.md) |

Start with the user guide, then run your first game. To delegate development, give your agent the guide below.

## AI game development

Start with **[AI Game Development](engine/ai-game-development.md)**.
It covers checking the request and installed version, finding the files the game actually uses, implementing changes, and validating results.

| Task | Reference |
| --- | --- |
| Install tools without generating game code | [AI Installation (Korean)](../engine/ai-agent-install.md) |
| Match a requirement to supported features | [AI Feature Lookup (Korean)](../engine/ai-feature-guide.md) |
| Choose files and validation commands | [AI Game Development](engine/ai-game-development.md) |

Read the game's installed agent instructions and public types. Engine-repository CI and release commands are separate from consumer game checks.

## Shared detailed references

These references are for lookup when you need exact behavior, options, or limits. Korean-only references are marked.

| Topic | Reference |
| --- | --- |
| Public imports and compatibility | [Public API](engine/public-api.md), [Migration (Korean)](../engine/public-api/migration-guide.md) |
| Scenes, objects, assets, and pixel sources | [Scene Authoring (Korean)](../engine/data-scene-authoring.md) |
| Animation, 2D materials, and lighting | [Presentation (Korean)](../engine/data-scene-presentation.md) |
| HD-2D terrain, models, cameras, and shadows | [Spatial Scenes (Korean)](../engine/data-scene-spatial.md) |
| Movement, gameplay, and extensions | [Native Runtime (Korean)](../engine/data-scene-native-runtime.md), [Runtime Extensibility (Korean)](../engine/runtime-extensibility.md) |
| Input, coordinates, and physics | [Input (Korean)](../engine/input-actions.md), [Coordinates (Korean)](../engine/coordinate-system.md), [Physics (Korean)](../engine/physics-spec.md) |
| Shooter settings and diagnostics | [Game Spec (Korean)](../examples/topdown-shooter/game-spec.md), [Quality API (Korean)](../engine/public-api/quality.md) |

## Engine development and operations

For work on the engine itself, use [Architecture](../development/architecture/architecture.md),
[Regression Checks](../development/quality/smoke-check.md), [Releases](../development/operations/github-release.md),
[Pages Operations](../development/operations/demo-deploy.md), and [Planning](../planning/README.md). These references are in Korean.

## Versions and maintenance

- Development source and released packages may have different features. Check the installed version's instructions, types, and documentation.
- Simple guides explain actions and expected results. AI guides explain implementation and validation. Shared references define API contracts.
- English and Korean starting guides follow the same flow. Untranslated pages are labeled and link back to the English index when switching language.
- Internal development and pending plans remain separate. `dist-pages/` is generated from Markdown and is not an editing source.
