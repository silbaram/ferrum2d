---
name: ferrum-consumer-playtest
description: Use when playtesting or smoke-testing a Ferrum2D consumer game: local dev server checks, browser behavior, debug overlay evidence, frame stats, input flow, asset load failures, and regression notes. Do not use for engine CI ownership.
---

# Ferrum Consumer Playtest

## Scope

This skill is for validating a game project that consumes `@ferrum2d/ferrum-web`.

Use it for:
- Running local build/dev/preview scripts.
- Checking canvas rendering, input, HUD, assets, audio, and runtime diagnostics.
- Recording reproducible steps and observed behavior.

Do not use it for:
- Ferrum2D engine release qualification.
- npm package publishing or package tarball review.

## Workflow

1. Inspect available scripts in `package.json`.
2. Prefer the smallest check that proves the changed behavior.
3. For browser checks, record URL, viewport, user steps, console errors, and visual symptoms.
4. Check debug overlay or exposed runtime stats when available.
5. Separate game bug reports from suspected engine bugs.
6. Report commands run, failures, and skipped checks with reasons.

If a dev server remains running after testing, stop it before finishing unless the user asked to keep it running.
