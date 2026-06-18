---
name: ferrum-docs-sync
description: Use when synchronizing Ferrum2D README, engine docs, development docs, planning docs, public API docs, smoke-check docs, package/release copy, or docs site implications after code, schema, package, Pages, or authoring workflow changes.
---

# Ferrum Docs Sync

Use this skill to keep Ferrum2D documentation aligned with verified behavior. Prefer Korean for repository docs unless the target file is already English-only or machine-readable.

## Source Of Truth

- Repository rules: `AGENTS.md`
- User-facing engine docs: `docs/engine/**`
- Development docs: `docs/development/**`
- Planning docs: `docs/planning/**`
- README surfaces: `README.md`, `docs/README.md`
- Public API surface: `docs/engine/public-api.md`, `docs/engine/public-api/**`, `docs/engine/public-api-surface.json`

## Routing

- Public engine/API behavior: update `docs/engine/**`.
- Architecture, quality gates, smoke checks, release/package procedures: update `docs/development/**`.
- In-progress roadmap or status: update `docs/planning/**` and keep it separate from official behavior.
- Release copy: coordinate with `ferrum-release-manager`.
- Pages build/deploy behavior: coordinate with `ferrum-pages-deploy`.
- Package artifact behavior: coordinate with `ferrum-package-qa`.
- Authoring workflow behavior: coordinate with `ferrum-authoring-workflow`.

## Workflow

1. Read the code or generated artifact before documenting behavior.
2. State current verified behavior, not aspirational goals.
3. Keep planning status explicit: completed, partial, blocked, or pending.
4. Update command names, report paths, and smoke pass conditions when verification scripts change.
5. Keep links and cross-doc references valid after moves or renames.
6. Mention skipped verification and its reason in final reports.

## Validation

Use the checks that match the docs change:

```bash
pnpm validate:docs-links
pnpm validate:public-api-surface
pnpm build:pages
```

Run `pnpm build:pages` only when docs rendering, paths, assets, or Pages output are affected.

## Hard Boundaries

- Do not claim publish, release, deploy, or CI status without verifying it.
- Do not mix planning proposals into official engine behavior docs.
- Do not update public API docs without checking exported API names.
