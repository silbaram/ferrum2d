# Ferrum2D Gemini Instructions

Read `AGENTS.md` as the repository-wide source of truth for Ferrum2D architecture, milestone scope, working rules, checks, documentation rules, and review output.

Gemini CLI uses this file and `.gemini/commands/ferrum/*.toml` as the official project surface.

The canonical skill bodies live in `.agents/skills/` so Codex, Claude, and Gemini can share one set of project workflows. Do not rely on `.gemini/agents` or `.gemini/skills` wrappers; Gemini commands should read the matching canonical skill files directly.

Authoring workflow work should use `/ferrum:authoring`. Treat Scene Placement/Object Authoring and Behavior Binding Inspector as agent-first support tools: they may edit placement/component data and existing behavior recipe references, but they must not become a Behavior Recipe body editor, FSM/action graph editor, or general visual editor without explicit approval.

Available repository commands:

- `/ferrum:authoring`: Scene Placement, Object Authoring, Behavior Binding reference handoff, placement viewer scaffold, and generated viewer smoke work.
- `/ferrum:docs`: documentation synchronization.
- `/ferrum:engine-reviewer`: engine architecture, Rust/TypeScript boundary, Wasm ABI, smoke/runtime budget review.
- `/ferrum:game-designer`: Top-down Shooter Game Spec data tuning.
- `/ferrum:package`: package artifact and consumer import QA.
- `/ferrum:pages-deploy`: GitHub Pages demo/docs artifact verification.
- `/ferrum:pixelforge-design`: Pixelforge Design System UI, token, mock, and branded authoring surface work.
- `/ferrum:qa`: local verification command selection and reporting.
- `/ferrum:release`: beta release coordination and publish gate checks.
- `/ferrum:schema`: Game Spec and Physics authoring schema contract work.

For release, publish, Git tag, GitHub Release, npm deprecation, or remote Pages deployment work, stop for explicit user approval before changing external state.
