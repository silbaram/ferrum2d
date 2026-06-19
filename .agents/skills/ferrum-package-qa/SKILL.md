---
name: ferrum-package-qa
description: Use when checking Ferrum2D npm package contents, tarball allowlists, generated Wasm artifacts, package exports, CLI package metadata, local pack installs, consumer import smoke tests, create-game scaffolds, or agents package templates. Trigger for package:check, package:publish-check, pnpm pack, tarball, package files, wasm artifact, exports, CLI package, or package QA.
---

# Ferrum Package QA

Use this skill to verify Ferrum2D npm packages without leaking source/test files, relying on internal import paths, or mixing engine runtime artifacts with developer tooling.

## Source Of Truth

- npm package strategy: `docs/development/operations/npm-package-strategy.md`
- npm package procedure: `docs/development/operations/npm-release.md`
- Runtime package metadata: `packages/ferrum-web/package.json`
- Authoring viewer package metadata: `packages/ferrum-authoring-viewer/package.json`
- CLI package metadata: `packages/create-game/package.json`, `packages/agents/package.json`
- Package check scripts: `scripts/package/check-package-files.mjs`, `scripts/package/check-authoring-viewer-package.mjs`, `scripts/package/check-create-game-package.mjs`, `scripts/package/check-agents-package.mjs`
- Consumer smoke script: `tests/smoke/package-consumer-smoke.mjs`
- Release readiness script: `scripts/package/check-release-readiness.mjs`
- Public API contract: `docs/engine/public-api.md`

## Runtime Package Contract

The package artifact may include:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/**`
- `pkg/ferrum_core.js`
- `pkg/ferrum_core.d.ts`
- `pkg/ferrum_core_bg.wasm`
- `pkg/ferrum_core_bg.wasm.d.ts`
- `pkg/package.json`

The artifact must not include:

- `src/**`
- `test/**`
- `dist-test/**`
- `node_modules/**`
- `tsconfig*.json`
- `pkg/.gitignore`

## Workflow

1. Read `docs/development/operations/npm-package-strategy.md`.
2. For runtime package changes, read `docs/development/operations/npm-release.md` and `docs/engine/public-api.md`.
3. Inspect the changed package `files`, `bin`, `exports`, `main`, and `types` fields as applicable.
4. For `create-game` template changes, verify generated scaffold files, shared template allowlists, and browser smoke coverage for generated surfaces such as `placement-viewer.html`.
5. Run the narrow package check for the changed package, or `pnpm package:check` before merging package-surface changes.
6. If preparing an actual publish candidate, run the package-specific `pnpm package:publish-check:*` command only after publish approval and `private: false`.
7. For high-risk runtime or scaffold changes, install the generated tarball in a clean temporary consumer project and import the purpose-specific public subpaths.

## Required Checks

Normal package QA:

```bash
pnpm package:check
```

Release rehearsal package QA:

```bash
pnpm release:local-check
```

Narrow package QA:

```bash
pnpm package:check:ferrum-web
pnpm package:check:authoring-viewer
pnpm package:check:create-game
pnpm package:check:agents
```

Publish candidate package QA:

```bash
pnpm package:publish-check:ferrum-web
pnpm package:publish-check:authoring-viewer
pnpm package:publish-check:create-game
pnpm package:publish-check:agents
```

Use publish candidate QA only when the release manager has confirmed that publish metadata is intentionally set.

Consumer scaffold smoke:

```bash
pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal
pnpm validate:consumer-smoke-report -- --report <report-path> --artifact-dir <artifact-dir>
```

Run the full template matrix when shared create-game code changes. The consumer smoke report should include `placementViewerSmoke: true` or equivalent generated placement viewer coverage when the placement viewer scaffold is part of the package contract.

## Consumer Import Rule

Official examples, create-game templates, and generated consumer smoke projects must import purpose-specific public subpaths:

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
import { resolveShooterGameSpec } from "@ferrum2d/ferrum-web/starter-scenes";
```

Do not make consumers import from:

- `@ferrum2d/ferrum-web` in official examples or create-game templates; it is a compatibility root aggregate for existing external code.
- `@ferrum2d/ferrum-web/dist/*`
- `@ferrum2d/ferrum-web/pkg/*`
- `@ferrum2d/ferrum-web/src/*`
- generated wasm-bindgen files

Consumer smoke and generated project reports should keep both `internalImports` and `rootAggregateImports` at zero for generated templates.

## Hard Boundaries

- Do not edit generated `pkg/**` or `dist/**` manually.
- Do not broaden `package.json` `files` to include source or test directories.
- Do not add new public export paths without updating `docs/engine/public-api.md`.
- Do not include engine development agents in `@ferrum2d/agents`; it is consumer game development only.
- Do not use `postinstall` to write `.agents`, `.codex`, `.claude`, or `.gemini` files into a consumer project.
- Do not mark package QA complete if `pnpm pack` contents were not verified.
- Do not mark create-game scaffold QA complete if generated template browser smoke was required but not run.
