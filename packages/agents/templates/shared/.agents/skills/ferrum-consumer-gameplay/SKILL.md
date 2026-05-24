---
name: ferrum-consumer-gameplay
description: Use when implementing gameplay in a game that consumes @ferrum2d/ferrum-web: input-to-runtime integration, HUD updates, game-side state coordination, simple rules, scene flow, and public API orchestration. Do not use for Ferrum2D engine simulation internals.
---

# Ferrum Consumer Gameplay

## Scope

This skill is for application gameplay code around the Ferrum2D runtime.

Use it for:
- Connecting UI actions, input transforms, runtime callbacks, and game-side presentation.
- Implementing game-side menus, HUD, pause/resume, restart, score display, and scene shell behavior.
- Coordinating data-driven gameplay through supported game spec fields.

Do not use it for:
- Moving core simulation ownership into TypeScript when Ferrum2D owns that behavior.
- Editing installed engine package files or generated Wasm bindings.
- Introducing unapproved engine features such as multiplayer, Workers, WebGPU, or complex physics.

## Workflow

1. Find the app entrypoint and runtime creation code.
2. Keep simulation state in Ferrum2D when public APIs already own it.
3. Keep browser/platform UI code in the app layer.
4. Use narrow adapters instead of scattering direct runtime calls across unrelated files.
5. Preserve hot-path discipline: do not create per-entity JS/Wasm round trips in frame loops.
6. Validate by running build and, when possible, a browser smoke pass.

If the public API cannot express the requested gameplay, stop and document the missing engine capability.
