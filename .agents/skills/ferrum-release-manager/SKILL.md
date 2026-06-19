---
name: ferrum-release-manager
description: Use when preparing, reviewing, or executing Ferrum2D npm beta releases, release candidate metadata, changelog/version/tag alignment, GitHub Release notes, npm publish approval gates, post-publish verification, deprecation, or recovery. Trigger for release, publish, npm, beta, dist-tag, changelog release section, Git tag, GitHub Release, @ferrum2d/ferrum-web package deployment, or release rollback.
---

# Ferrum Release Manager

Use this skill for Ferrum2D release work. It coordinates release metadata, package publish readiness, local package-family rehearsal, approval gates, and post-release verification for `@ferrum2d/ferrum-web`.

## Source Of Truth

- npm procedure: `docs/development/operations/npm-release.md`
- Release notes template: `docs/development/operations/release-notes-template.md`
- Package metadata: `packages/ferrum-web/package.json`, `packages/ferrum-authoring-viewer/package.json`, `packages/create-game/package.json`, `packages/agents/package.json`
- Changelog: `CHANGELOG.md`
- Release readiness script: `scripts/package/check-release-readiness.mjs`
- Package artifact script: `scripts/package/check-package-files.mjs`
- Root release commands: `package.json`

## Release Scope

This skill covers npm beta releases and GitHub Release preparation for `@ferrum2d/ferrum-web`, plus local release rehearsal for the companion package set `@ferrum2d/authoring-viewer`, `@ferrum2d/create-game`, and `@ferrum2d/agents`.

- Allowed npm tag: `beta`
- Allowed release version format: `x.y.z-beta.N`
- Required Git tag format: `ferrum-web-vx.y.z-beta.N`
- Local rehearsal command: `pnpm release:local-check`
- Stable `latest` releases are out of scope until a separate release policy exists.

## Workflow

1. Read `docs/development/operations/npm-release.md` and `docs/development/operations/release-notes-template.md`.
2. Inspect `git status --short` and identify unrelated work before editing release files.
3. Confirm the target beta version and expected Git tag.
4. Move relevant `CHANGELOG.md` entries from `Unreleased` to `## x.y.z-beta.N - YYYY-MM-DD`.
5. Update `packages/ferrum-web/package.json` version to the target beta version.
6. Keep `publishConfig.access` as `"public"` and `publishConfig.tag` as `"beta"`.
7. Do not set `private: false` until the user explicitly approves a publish candidate.
8. Run the required local checks from the npm release procedure.
9. Run `pnpm release:local-check` before treating the package set as locally rehearsed.
10. Run `pnpm release:check` for publish metadata validation.
11. After publish approval and `private: false`, run `pnpm release:publish-check`.
12. Only after all checks pass, request explicit approval for `npm publish --access public --tag beta`.
13. After publish, verify the npm package and record the exact results in the response or release notes.

## Required Checks

Run these before a release candidate is considered ready:

```bash
pnpm lint
pnpm test
pnpm validate:game-spec
pnpm smoke:headless
pnpm package:check
pnpm release:local-check
pnpm build:web
pnpm release:check
```

For Rust/Wasm boundary changes, also run:

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

Before actual publish, after publish approval and `private: false`:

```bash
pnpm release:publish-check
```

## Approval Gates

Always stop and get explicit user approval immediately before these external-state actions:

- Setting `packages/ferrum-web/package.json` `private` from `true` to `false`.
- Setting any companion package `private` from `true` to `false`.
- Running `npm publish --access public --tag beta`.
- Creating or pushing a release Git tag.
- Publishing or editing a GitHub Release.
- Running `npm deprecate` or other npm recovery commands.

## Post-Publish Verification

After publish, verify:

- `npm view @ferrum2d/ferrum-web@beta version dist-tags --json`
- The published version equals `packages/ferrum-web/package.json` version.
- The `beta` dist-tag points to the published version.
- A clean consumer project can import the purpose-specific public runtime subpath:

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";
```

Do not document internal imports from `dist/*`, `pkg/*`, `src/*`, or generated wasm-bindgen files as public API. Treat the root aggregate `@ferrum2d/ferrum-web` as a compatibility shim, not the preferred import path for new release examples.

## Failure And Recovery

Published npm versions cannot be overwritten. If a release is bad:

1. Do not attempt to republish the same version.
2. Deprecate the bad version only after explicit user approval.
3. Fix the issue in a new commit.
4. Release `x.y.z-beta.N+1`.
5. Record the failure cause, user impact, and recovery action in `CHANGELOG.md` or the GitHub Release notes.

## Hard Boundaries

- Do not publish to `latest`.
- Do not run `npm publish` without explicit approval.
- Do not bypass `pnpm release:publish-check`.
- Do not hand-edit generated `dist/**` or `pkg/**` artifacts.
- Do not mix unrelated feature work into a release-only change.
- Do not claim npm publish succeeded unless registry verification was performed.
