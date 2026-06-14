# Ferrum2D Gemini Instructions

Read `AGENTS.md` as the repository-wide source of truth for Ferrum2D architecture, milestone scope, working rules, checks, documentation rules, and review output.

Gemini CLI uses this file and `.gemini/commands/ferrum/*.toml` as the official project surface.

The canonical skill bodies live in `.agents/skills/` so Codex, Claude, and Gemini can share one set of project workflows. Do not rely on `.gemini/agents` or `.gemini/skills` wrappers; Gemini commands should read the matching canonical skill files directly.

Available repository commands:

- `/ferrum:docs`: documentation synchronization.
- `/ferrum:engine-reviewer`: engine architecture, Rust/TypeScript boundary, Wasm ABI, smoke/runtime budget review.
- `/ferrum:game-designer`: Top-down Shooter Game Spec data tuning.
- `/ferrum:package`: package artifact and consumer import QA.
- `/ferrum:pages-deploy`: GitHub Pages demo/docs artifact verification.
- `/ferrum:qa`: local verification command selection and reporting.
- `/ferrum:release`: beta release coordination and publish gate checks.
- `/ferrum:schema`: Game Spec and Physics authoring schema contract work.

For release, publish, Git tag, GitHub Release, npm deprecation, or remote Pages deployment work, stop for explicit user approval before changing external state.
