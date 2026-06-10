---
name: ferrum-pages-deploy
description: Use when preparing, reviewing, or verifying Ferrum2D GitHub Pages demo/docs deployment, dist-pages generation, docs HTML rendering, example production builds, Pages workflow status, or post-deploy browser smoke checks. Trigger for Pages, demo deploy, docs deploy, build:pages, dist-pages, GitHub Pages, deploy-pages, page_url, or demo/docs publishing.
---

# Ferrum Pages Deploy

Use this skill for Ferrum2D GitHub Pages deployment work. It keeps browser demos, generated docs HTML, and deployment verification tied to the repository deployment procedure.

## Source Of Truth

- Pages procedure: `docs/development/operations/demo-deploy.md`
- Pages builder: `scripts/build/build-pages.mjs`
- Pages workflow: `.github/workflows/pages.yml`
- Smoke policy: `docs/development/quality/smoke-check.md`
- Screenshot policy: `docs/development/quality/screenshots/README.md`
- Root commands: `package.json`

## Deployment Scope

GitHub Pages deployment publishes one `dist-pages/` artifact containing:

- Pages home
- `docs/**/*.md` rendered to `dist-pages/docs/**/*.html`
- `examples/starter-runtime/dist`
- `examples/topdown-shooter/dist`
- `examples/breakout/dist`
- `examples/platformer/dist`

`dist-pages/` is generated output and must not be committed.

## Workflow

1. Read `docs/development/operations/demo-deploy.md`.
2. Inspect `git status --short` and identify unrelated work.
3. Run `pnpm build` to build Wasm and all packages/examples.
4. Run `pnpm build:pages` to generate `dist-pages/`.
5. Verify expected demo directories and docs HTML exist under `dist-pages/`.
6. Verify docs assets such as screenshots are copied when referenced.
7. If the deployment is through GitHub Actions, check the `Pages` workflow result.
8. After deploy, verify the published Pages URL and at least one demo route.
9. For rendering-sensitive changes, run the relevant browser smoke command or document why it was not possible.

## Required Local Checks

```bash
pnpm build
pnpm build:pages
```

For renderer, input, asset, audio, or example behavior changes, run the relevant smoke check:

```bash
pnpm smoke:browser
pnpm smoke:topdown
pnpm smoke:breakout
pnpm smoke:platformer
```

Use only the checks that match the changed surface and report skipped checks with a reason.

## Artifact Verification

After `pnpm build:pages`, verify at minimum:

- `dist-pages/index.html`
- `dist-pages/docs/index.html`
- `dist-pages/docs/engine/user-guide.html`
- `dist-pages/docs/engine/public-api.html`
- `dist-pages/docs/examples/topdown-shooter/game-spec.html`
- `dist-pages/starter-runtime/index.html`
- `dist-pages/topdown-shooter/index.html`
- `dist-pages/breakout/index.html`
- `dist-pages/platformer/index.html`

If docs were moved or renamed, inspect generated docs links before considering the deploy ready.

## Approval Gates

Get explicit user approval before:

- Triggering a remote GitHub Pages deployment manually.
- Pushing commits whose only purpose is to deploy.
- Changing `.github/workflows/pages.yml` permissions or deployment environment.

## Hard Boundaries

- Do not commit `dist-pages/`.
- Do not introduce a static-site generator dependency without prior approval.
- Do not change demo base paths unless Pages subpath behavior is verified.
- Do not claim Pages deployment succeeded unless the workflow or published URL was checked.
