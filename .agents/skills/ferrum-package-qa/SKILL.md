---
name: ferrum-package-qa
description: Use when checking Ferrum2D npm package contents, tarball allowlist, generated Wasm artifacts, package exports, local pack installs, package metadata, or consumer import smoke tests for @ferrum2d/ferrum-web. Trigger for package:check, package:publish-check, pnpm pack, tarball, package files, wasm artifact, exports, consumer install, or package QA.
---

# Ferrum Package QA

Use this skill to verify that `@ferrum2d/ferrum-web` can be consumed as an npm package without leaking source/test files or relying on internal import paths.

## Source Of Truth

- npm package procedure: `docs/development/operations/npm-release.md`
- Package metadata: `packages/ferrum-web/package.json`
- Package check script: `scripts/check-package-files.mjs`
- Release readiness script: `scripts/check-release-readiness.mjs`
- Public API contract: `docs/engine/public-api.md`

## Package Contract

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

1. Read `docs/development/operations/npm-release.md` and `docs/engine/public-api.md`.
2. Inspect `packages/ferrum-web/package.json` `files`, `exports`, `main`, and `types`.
3. Run `pnpm build:wasm`.
4. Run `pnpm --filter @ferrum2d/ferrum-web build`.
5. Run `pnpm package:check`.
6. If preparing an actual publish candidate, run `pnpm package:publish-check` only after publish approval and `private: false`.
7. For high-risk changes, install the generated tarball in a clean temporary consumer project and import the public entrypoint.

## Required Checks

Normal package QA:

```bash
pnpm package:check
```

Publish candidate package QA:

```bash
pnpm package:publish-check
```

Use publish candidate QA only when the release manager has confirmed that publish metadata is intentionally set.

## Consumer Import Rule

Consumer examples and smoke tests must import only the public entrypoint:

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web";
```

Do not make consumers import from:

- `@ferrum2d/ferrum-web/dist/*`
- `@ferrum2d/ferrum-web/pkg/*`
- generated wasm-bindgen files

## Hard Boundaries

- Do not edit generated `pkg/**` or `dist/**` manually.
- Do not broaden `package.json` `files` to include source or test directories.
- Do not add new public export paths without updating `docs/engine/public-api.md`.
- Do not mark package QA complete if `pnpm pack` contents were not verified.
