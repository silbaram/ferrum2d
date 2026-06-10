---
name: ferrum-consumer-asset-pipeline
description: Use when adding, organizing, validating, or debugging assets in a Ferrum2D consumer game: public asset paths, texture and audio manifests, atlas metadata, preload behavior, cache-safe paths, and build output asset checks. Do not use for engine asset loader internals.
---

# Ferrum Consumer Asset Pipeline

## Scope

This skill is for game-owned assets in projects that consume `@ferrum2d/ferrum-web`.

Use it for:
- Placing image, audio, atlas, tilemap, LDtk, Tiled, or JSON assets under app-owned public/source folders.
- Matching asset names with game spec and runtime loading code.
- Debugging missing texture, sound, or JSON asset errors.
- Building an import -> validate -> Game Spec update loop for raw sprite, audio, localization, Aseprite, Tiled, or LDtk inputs.

Do not use it for:
- Editing Ferrum2D engine asset loader internals.
- Committing generated build output or cache directories.
- Importing from `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, or `@ferrum2d/ferrum-web/src/*`.

## Workflow

1. Identify the app's asset root, usually `public/assets/`.
2. Keep URLs relative to the deployed base path when possible.
3. Verify manifest keys match the names used by runtime code and game spec data.
4. Prefer explicit startup diagnostics for missing assets.
5. Avoid very large unoptimized assets unless the user asked for high fidelity and accepts the cost.
6. For raw sprite folders, run the project-owned texture packing script when available, usually `npm run pack:textures`; if none exists, add or propose an app-owned script that imports public helpers from `@ferrum2d/ferrum-web`, such as `packTextureAtlas(...)` and `textureAtlasDocumentToShooterAtlas(...)`.
7. For Aseprite, Tiled, or LDtk inputs, convert through public helpers such as `importAsepriteAtlas(...)`, `importTiledGameSpec(...)`, or `importLDtkGameSpec(...)`, then merge the generated `atlas`, `tilemap`, or frame metadata into the app's Game Spec or asset manifest.
8. For audio, keep stable sound ids or names in an app-owned manifest, keep files under a deployed public path such as `public/assets/audio/`, and verify the runtime decode/load path through `AudioAssetLoader` or the app's audio facade.
9. For localization, prefer `public/game.json` `content.localization` when the project uses Game Spec content; otherwise keep a single app-owned localization JSON and load it through `LocalizationBundle`.
10. Run `npm run ferrum:asset-report` when available to inspect texture, audio, localization, atlas metadata, and Game Spec asset status.
11. Run `npm run ferrum:asset-validate` when available to validate asset manifests through the public `@ferrum2d/ferrum-web` entrypoint.
12. Run `npm run ferrum:report` when available to inspect wider package/spec status.
13. Run `npm run ferrum:validate` after changing `public/game.json`, atlas metadata, tilemap data, or content localization.
14. Build the project and confirm required assets are present in the output.

For browser games, treat case-sensitive file paths as required even if the local filesystem is forgiving.

## Game Spec Asset Loop

Use a deterministic file update loop so future agents can reproduce asset changes.

1. Put source assets in a stable raw location, for example `public/assets/raw/sprites/`, `public/assets/raw/audio/`, or `src/assets/source/`.
2. Generate runtime-ready assets into a stable public location, for example `public/assets/atlas.png` or `public/assets/audio/*.wav`.
3. Merge generated atlas frames into `public/game.json` `atlas.frames` without deleting hand-authored frames.
4. Reference generated frame names from `prefabs.*.frame`, tile definitions, scene authoring data, or app-owned manifests.
5. Resolve the Game Spec with `resolveShooterGameSpec(...)` when the project has a local validation script, and fix path diagnostics before browser playtest.
6. Record the commands used to regenerate assets in `package.json` scripts or project docs.

Do not make generated metadata depend on filesystem iteration order. Sort frame names, manifest entries, and localization keys when writing generated JSON.

## Validation Checklist

Run the narrowest available checks for the asset type you changed:

- Raw sprite or atlas metadata: `npm run pack:textures` when present, then `npm run ferrum:validate`.
- Audio or localization manifests: `npm run ferrum:asset-report` and `npm run ferrum:asset-validate` when present.
- Game Spec atlas, tilemap, or localization: `npm run ferrum:validate`.
- Runtime asset loading or public path changes: `npm run ferrum:smoke` or `npm run build`.
- Browser-only audio unlock or decode issues: run the project's browser playtest/smoke and report whether audio required a user gesture.

If a command is unavailable, say that explicitly and use the next closest project-owned command. Do not require Ferrum2D engine workspace `pnpm` commands in a normal consumer game.
