---
name: ferrum-engine-reviewer
description: Use when reviewing Ferrum2D engine code, architecture, public APIs, Rust/TypeScript responsibility boundaries, SOLID-style design issues, Wasm ABI safety, hot-path performance risks, missing tests, or code changes before merge/release. Trigger for code review, architecture review, SOLID review, Rust review, TypeScript review, Wasm boundary review, public API review, or engine design risk analysis.
---

# Ferrum Engine Reviewer

Use this skill for Ferrum2D code and architecture review. This is a review skill, not a test runner. It identifies design, correctness, maintainability, boundary, and release risks before implementation is accepted.

## Source Of Truth

- Repository rules: `AGENTS.md`
- Architecture docs: `docs/development/architecture/architecture.md`
- Public API docs: `docs/engine/public-api.md`
- Smoke policy: `docs/development/quality/smoke-check.md`
- Code review baseline: `docs/development/quality/code-review.md`
- Rust conventions: `.agents/skills/rust-game-engine-conventions/SKILL.md`
- Web platform conventions: `.agents/skills/web-game-engine-platform/SKILL.md`

## Review Scope

Review the changed surface first, then follow dependencies only when needed.

- Rust core: state, entity/world storage, math/collision, scene logic, render command generation.
- TypeScript platform: browser APIs, canvas/WebGL2, input, audio, assets, Wasm loading.
- Wasm boundary: `#[repr(C)]`, ptr/len buffers, typed array views, command buffer layout, string/object hot-path avoidance.
- Public API: package entrypoint, exported types, backwards compatibility, docs synchronization.
- Examples and Game Spec: runtime behavior, schema compatibility, generated variant safety.
- Packaging/deploy impact: only flag release/package/docs risks; defer execution to release/package/pages/qa agents.

## SOLID For Ferrum2D

Apply SOLID as a design smell framework, not as Java-style class doctrine.

- SRP: each module, struct, class, function, and package owns one clear responsibility.
- OCP: new renderer/runtime/example behavior should not require editing unrelated stable modules.
- LSP: TypeScript interfaces and Rust traits must allow substitutable implementations without hidden preconditions.
- ISP: avoid broad interfaces or traits that force unrelated implementers to provide unused behavior.
- DIP: high-level engine/runtime code should depend on stable contracts, not concrete browser/WebGL/package internals.

Ferrum2D-specific priority is higher than generic SOLID: Rust core and TypeScript platform responsibilities must not cross.

## Rust Review Criteria

Use `rust-game-engine-conventions` for detailed Rust guidance when `.rs` files are involved.

Flag:

- `unwrap()`/`expect()` in library paths without a proven invariant.
- runtime checks that should be encoded in types or explicit `Result`/`Option`.
- oversized traits, leaky modules, or trait methods unrelated to one capability.
- unclear ownership, avoidable clones, or borrow patterns that hide data flow.
- hot-path allocation, unnecessary dynamic dispatch, or entity-per-call Wasm crossings.
- missing `#[repr(C)]` or size/layout checks for Wasm-shared structs.
- renderer/browser/platform dependencies entering Rust simulation code.

## TypeScript Review Criteria

Use `web-game-engine-platform` for detailed browser/Wasm/WebGL2 guidance when `.ts` or `.js` files are involved.

Flag:

- TypeScript owning simulation state that belongs in Rust.
- renderer, input, asset, audio, or Wasm bridge responsibilities mixed into one class.
- public API exposing `dist/*`, `pkg/*`, or generated wasm-bindgen internals.
- per-entity JS/Wasm calls in frame hot paths.
- stale typed array views across Wasm memory growth.
- missing canvas resize/DPR, WebGL2 context, asset decode, audio unlock, or requestAnimationFrame lifecycle handling.
- broad interfaces that couple independent platform services.

## Review Workflow

1. Inspect `git status --short` and identify the review target.
2. Read the relevant changed files and nearby contracts.
3. Classify the surface: Rust, TypeScript, Wasm boundary, public API, Game Spec, docs, package/deploy.
4. Apply the criteria above plus the matching language/platform skill.
5. Report findings first, ordered by severity.
6. Include file/line references for each finding.
7. Separate concrete defects from design concerns, open questions, and optional cleanup.
8. Recommend the minimum fix that preserves current milestone boundaries.

## Severity

- Critical: likely runtime breakage, memory/ABI corruption, publish/deploy damage, data loss, or hard security issue.
- High: user-visible regression, public API break, invalid Wasm boundary, hot-path scalability failure, or architecture boundary violation.
- Medium: maintainability issue that will make near-term product work unsafe or expensive.
- Low: localized cleanup, naming, small duplication, or documentation clarity.

## Output Format

Use a code-review stance:

1. Findings first.
2. Open questions or assumptions.
3. Change summary only after findings.
4. Tests/checks reviewed or recommended.

If no issues are found, say that clearly and mention residual test or smoke risk.

## Hard Boundaries

- Do not rewrite code during a review unless the user explicitly asks for fixes.
- Do not treat generic SOLID preferences as blockers when Ferrum2D boundary rules are satisfied.
- Do not recommend WebGPU, Workers, editor, multiplayer, or complex physics unless the user explicitly approved that scope.
- Do not ask `qa_agent` to run checks when a static review is enough; recommend checks instead.
- Do not claim a command passed unless it was actually run.
