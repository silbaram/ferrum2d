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

Do not use it for:
- Editing Ferrum2D engine asset loader internals.
- Committing generated build output or cache directories.

## Workflow

1. Identify the app's asset root, usually `public/assets/`.
2. Keep URLs relative to the deployed base path when possible.
3. Verify manifest keys match the names used by runtime code and game spec data.
4. Prefer explicit startup diagnostics for missing assets.
5. Avoid very large unoptimized assets unless the user asked for high fidelity and accepts the cost.
6. Build the project and confirm required assets are present in the output.

For browser games, treat case-sensitive file paths as required even if the local filesystem is forgiving.
