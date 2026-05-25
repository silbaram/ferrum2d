---
name: ferrum-consumer-build
description: Use when preparing or verifying a Ferrum2D consumer game production build or static deploy artifact: npm scripts, Vite base paths, dist output, asset URLs, preview checks, and deploy notes. Do not use for Ferrum2D engine package publishing.
---

# Ferrum Consumer Build

## Scope

This skill is for production builds of games that consume `@ferrum2d/ferrum-web`.

Use it for:
- Checking `npm run build`, preview output, static hosting base paths, and `dist/` contents.
- Verifying Wasm and asset URLs work from the built artifact.
- Preparing deploy notes for static hosts.

Do not use it for:
- Publishing `@ferrum2d/ferrum-web`.
- Changing Ferrum2D package exports, tarball allowlists, or release tags.

## Workflow

1. Read `package.json` and identify build/preview scripts.
2. Confirm the app imports only public APIs from `@ferrum2d/ferrum-web`.
3. Check Vite `base` handling for the target host.
4. Run `npm run ferrum:validate` when available.
5. Run the production build.
6. Inspect output for missing Wasm, JSON, images, audio, or incorrect absolute paths.
7. Run preview or a static smoke check when available.

For deploys, clearly separate local artifact creation from any command that changes remote state.
