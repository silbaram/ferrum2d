---
name: ferrum-consumer-project
description: Use when creating, wiring, or reviewing a game application that consumes @ferrum2d/ferrum-web: Vite/TypeScript setup, canvas/runtime bootstrap, package scripts, project layout, and public API integration. Do not use for Ferrum2D engine internals.
---

# Ferrum Consumer Project

## Shared Presentation Contract

Read `.agents/harness/ferrum-game-presentation.md` before working: respect the installation-only boundary; apply its design and browser review criteria when game development is requested.

게임 제작 단계에서는 bootstrap을 작성하기 전에 공통 기준의 화면 설계 메모를 남긴다. shell은 코드 소유권이며 웹사이트형 레이아웃을 뜻하지 않는다.

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
3. If the request is installation-only, verify dependencies/tools/instructions and stop before steps 5–10; do not generate game files or start a server. Only for requested game scaffolding, follow **Template Discovery** in `.agents/harness/ferrum-game-development.md` and choose a template using the catalog's `sceneAuthoring`, `gameplayReplay`, and `runtimeGameplayReplay` entries. Use the installed release's verified create-game tarball URL as described there.
4. Read `package.json` and verify `@ferrum2d/ferrum-web` is a dependency.
5. Keep `src/main.ts` bootstrap-only: create the shell/runtime, install top-level modules, start, and render startup failures.
6. For non-trivial projects, create clear `src/runtime/`, `src/game/`, `src/assets/`, `src/ui/`, and `src/dev/` boundaries. Use `ferrum-consumer-architecture` for refactors or reviews of these boundaries.
7. Keep app code under `src/`, browser assets under `public/`, and generated build output out of source edits.
8. Use only public imports from `@ferrum2d/ferrum-web`.
9. Keep startup failure handling visible in the page so agent-generated projects are debuggable.
10. Validate with `npm run ferrum:validate` when available, then `npm run build` or the package manager equivalent.

If a requested feature needs engine behavior that is not public, report the gap and propose an engine feature request instead of modifying installed package files.
