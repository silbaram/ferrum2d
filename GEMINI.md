# Ferrum2D Gemini Instructions

Read `AGENTS.md` as the repository-wide source of truth for Ferrum2D architecture, milestone scope, working rules, checks, documentation rules, and review output.

Gemini CLI project agents live in `.gemini/agents/`.
Gemini CLI project skills live in `.gemini/skills/`.

The canonical skill bodies live in `.agents/skills/` so Codex, Claude, and Gemini can share one set of project workflows. Gemini skill wrappers under `.gemini/skills/` point back to those canonical files.

For release, publish, Git tag, GitHub Release, npm deprecation, or remote Pages deployment work, stop for explicit user approval before changing external state.
