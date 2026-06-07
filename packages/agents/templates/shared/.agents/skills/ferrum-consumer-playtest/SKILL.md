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
2. Run `npm run ferrum:report` when available to capture project context before testing.
3. Prefer the smallest check that proves the changed behavior.
4. Use `npm run ferrum:authoring-report` for data-driven gameplay validation and `npm run ferrum:replay-report` for deterministic gameplay regression evidence when the project provides them.
5. Check report `format`, `version`, `ok`, and failure `reports[]` entries before treating a report as evidence. If a project-specific artifact validator exists, run it after report generation.
6. Use `npm run ferrum:smoke` for build-level smoke when available.
7. For browser checks, record URL, viewport, user steps, console errors, and visual symptoms.
8. Check debug overlay or exposed runtime stats when available.
9. If playtest requires adding browser hooks or scripted scenarios, put browser-only hooks in `src/dev/` and scenarios/notes in `tests/playtest/`. Do not add these hooks directly to `src/main.ts`.
10. When playtest uncovers architecture issues, report whether the issue is in bootstrap, runtime adapter, game data, UI, assets, or dev/report hook code. Hand off layout/refactor work to `ferrum-consumer-architecture`.
11. Separate game bug reports from suspected engine bugs.
12. Report commands run, failures, and skipped checks with reasons.

If a dev server remains running after testing, stop it before finishing unless the user asked to keep it running.
