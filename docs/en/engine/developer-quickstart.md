# Ferrum2D Developer Quickstart

[한국어](../../engine/developer-quickstart.md) · English

Ferrum2D combines a Rust/Wasm core with a TypeScript browser platform layer and a WebGL2 renderer.
The main development workflow uses specifications, project templates, AI agents, and validation scripts.
The viewer supports scene and asset authoring alongside that workflow.

This guide creates a runnable starter game. If you only want an agent to install the engine and tools without generating game code,
use the [AI installation guide (Korean)](../../engine/ai-agent-install.md).

## Create a game from a release

Node.js 22 is recommended. Choose a [GitHub Release](https://github.com/silbaram/ferrum2d/releases) and copy the download URL for
its `ferrum2d-create-game-<version>.tgz` asset. Use the installable package rather than GitHub's automatically generated source archive.
If the intended release is not published, follow the [local package procedure (Korean)](../../development/operations/github-release.md).

```bash
ferrum_cli_url="<create-game .tgz download URL from the selected GitHub Release>"
npx --yes --allow-remote=root "$ferrum_cli_url" my-game
cd my-game
npm install
npm run dev
```

The generator pins engine and viewer package URLs from the same release and writes `FERRUM_INSTALL.md`.
Its `.npmrc` allows direct URL dependencies with npm 12. Ordinary development tools are installed from the npm registry.
Game projects using the distributed engine do not need Rust or wasm-pack.

## Validate the project

```bash
npm run ferrum:check
```

This runs validation, asset and authoring checks, gameplay/runtime replay checks, and a production build.
If it fails, inspect the JSON report's `failedStep`, diagnostic code, and `nextCommand`.

For more detail:

```bash
npm run ferrum:report
npm run ferrum:validate
```

Before deploying a static build:

```bash
npm run ferrum:deploy-report
npm run preview
```

A `ready` report means that the generated static output passes the supported relative-path checks,
the project's preview command responds locally, and Wasm is served as `application/wasm`.
It does not prove that another hosting service uses the same MIME settings or that every gameplay path works.
Use the preview URL rather than opening `dist/index.html` through `file://`.

Install the project's agent instructions explicitly:

```bash
npm run ferrum:agents
```

## Choose a template

Use the CLI URL from the same release selected above:

```bash
npx --yes --allow-remote=root "$ferrum_cli_url" --list-templates
npx --yes --allow-remote=root "$ferrum_cli_url" --list-templates --json
```

| Template | Starting point | Typical changes |
| --- | --- | --- |
| `minimal` | Small runtime starter | Public API integration, HUD/debug metrics, projectile and weapon authoring |
| `topdown` | Game Spec-based shooter | World size, enemy waves, weapons, prefabs, and camera |
| `platformer` | Built-in platformer starter | Jumping, movement, and platform collision |
| `breakout` | Built-in Breakout starter | Paddle, ball, bricks, and session flow |

To choose a template when creating a project:

```bash
npx --yes --allow-remote=root "$ferrum_cli_url" my-shooter --template topdown
```

Templates are starting points, not complete genre editors. `minimal` is a runnable example, not an empty project.

## Understand the runtime boundary

```text
Browser input
-> TypeScript input snapshot
-> Wasm engine update
-> Rust simulation, collision, and scene logic
-> Rust render command buffer
-> TypeScript rendering, audio, and UI
-> Browser frame
```

| Layer | Responsibility |
| --- | --- |
| Rust core | Game state, entities, physics, scene progression, and render command generation |
| Wasm boundary | Bulk frame buffers and low-frequency configuration APIs |
| TypeScript platform | Canvas, GPU APIs, input, audio, assets, Wasm loading, and presentation |
| Game project | Specifications, content, bootstrap code, and integration through public exports |

Keep the game simulation authoritative in Rust. Avoid per-entity JS/Wasm round trips in frame loops.
Use [public package subpaths](public-api.md) instead of importing engine source files or generated Wasm bindings.

## Find the right project file

| File | Purpose |
| --- | --- |
| `src/main.ts` | Canvas, runtime bootstrap, HUD, input, and starter integration |
| `src/styles.css` | Starter layout and surrounding UI |
| `public/game.json` | Shooter Game Spec in the `topdown` template |
| `public/scene-authoring.json` | Scene composition and behavior references |
| `public/gameplay-replay.fixture.json` | Authoring replay fixture |
| `public/gameplay-runtime-replay.fixture.json` | Runtime replay fixture |
| `scripts/ferrum-harness.mjs` | Reports, validation, and authoring/replay commands |
| `scripts/ferrum-check.mjs` | Standard project check sequence |
| `scripts/ferrum-deploy.mjs` | Static deployment readiness checks |

Read `project.runtimeInputs` in `ferrum:report` before changing a template.
Built-in starter adapters apply scene-specific position and behavior references; they do not behave like arbitrary Data Scene spawning.
See [Scene Authoring (Korean)](../../engine/data-scene-authoring.md) and [Native Runtime (Korean)](../../engine/data-scene-native-runtime.md).

## Work on the engine source

Building the engine repository requires Rust stable, the Wasm target, wasm-pack, Node.js, and pnpm.
Node.js 22 and pnpm 10.8.0 are recommended.

```bash
git clone https://github.com/silbaram/ferrum2d.git
cd ferrum2d
rustup default stable
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
corepack enable
corepack prepare pnpm@10.8.0 --activate
pnpm install
pnpm build
pnpm dev:starter-runtime
```

Try `pnpm dev:placement-viewer` for scene placement and pixel editing.
The [feature guide](showcase-hub.md) lists example commands and browser experiments.

Engine changes require checks appropriate to their scope; the [Smoke Check guide (Korean)](../../development/quality/smoke-check.md)
defines the maintained regression commands. Game projects use their own generated `npm run ferrum:check` workflow.

Continue with the [User Guide](user-guide.md) and [Public API](public-api.md).
