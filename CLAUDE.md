# Ferrum2D Claude Instructions

Read `AGENTS.md` as the repository-wide source of truth for Ferrum2D architecture, milestone scope, working rules, checks, documentation rules, and review output.

Claude Code project agents live in `.claude/agents/`.
Claude Code project skills live in `.claude/skills/`.

The canonical skill bodies live in `.agents/skills/` so Codex, Claude, and Gemini can share one set of project workflows. Claude skill wrappers under `.claude/skills/` point back to those canonical files.

For release, publish, Git tag, GitHub Release, npm deprecation, or remote Pages deployment work, stop for explicit user approval before changing external state.
