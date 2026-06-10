---
name: ferrum-consumer-project
description: Use when creating, wiring, or reviewing a game application that consumes @ferrum2d/ferrum-web: Vite/TypeScript setup, canvas/runtime bootstrap, package scripts, project layout, and public API integration. Do not use for Ferrum2D engine internals.
---

# Ferrum Consumer Project

## Scope

This skill is for game projects that depend on `@ferrum2d/ferrum-web`.

Use it for:
- Creating or adjusting a Vite/TypeScript game project.
- Wiring `createFerrumRuntime(...)` or other public package entrypoint APIs.
- Checking package scripts, `index.html`, `src/main.ts`, and `public/` layout.
- Establishing the initial folder layout before feature code grows.

Do not use it for:
- Editing Ferrum2D engine source, Rust/Wasm internals, renderer implementation, release packaging, or npm publishing.
- Importing `@ferrum2d/ferrum-web/dist/*`, `pkg/*`, generated wasm-bindgen files, or `src/*`.

## Workflow

1. Confirm the target is an application project, not the Ferrum2D engine repository.
2. Read `.agents/harness/ferrum-game-development.md` when present.
3. For new project/template selection, inspect `npx @ferrum2d/create-game --list-templates --json` and choose a template using its `sceneAuthoring`, `gameplayReplay`, and `runtimeGameplayReplay` entries.
4. Read `package.json` and verify `@ferrum2d/ferrum-web` is a dependency.
5. Keep `src/main.ts` bootstrap-only: create the shell/runtime, install top-level modules, start, and render startup failures.
6. For non-trivial projects, create clear `src/runtime/`, `src/game/`, `src/assets/`, `src/ui/`, and `src/dev/` boundaries. Use `ferrum-consumer-architecture` for refactors or reviews of these boundaries.
7. Keep app code under `src/`, browser assets under `public/`, and generated build output out of source edits.
8. Use only public imports from `@ferrum2d/ferrum-web`.
9. Keep startup failure handling visible in the page so agent-generated projects are debuggable.
10. Validate with `npm run ferrum:validate` when available, then `npm run build` or the package manager equivalent.

If a requested feature needs engine behavior that is not public, report the gap and propose an engine feature request instead of modifying installed package files.
