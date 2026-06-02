# @ferrum2d/create-game

Ferrum2D 게임 프로젝트 생성 CLI다.

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
npm run dev
```

생성된 프로젝트는 `@ferrum2d/ferrum-web`을 dependency로 사용한다. 엔진 소스 코드를 복사하지 않고, npm package entrypoint만 import한다.

템플릿은 `--template`으로 고른다. 현재 기본 템플릿은 `minimal`이다.

```bash
npx @ferrum2d/create-game my-game --template minimal
```

사용 가능한 템플릿:

```bash
npx @ferrum2d/create-game --list-templates
npx @ferrum2d/create-game my-shooter --template topdown
npx @ferrum2d/create-game my-platformer --template platformer
```

- `minimal`: runtime/HUD/debug metric을 확인하기 위한 가장 작은 starter
- `topdown`: Game Spec 기반 Top-down Shooter starter
- `platformer`: built-in platformer scene starter

생성된 프로젝트에는 AI agent-first 개발용 하네스 명령이 포함된다.

```bash
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:authoring-report
npm run ferrum:replay-report
npm run ferrum:runtime-replay-report
npm run ferrum:runtime-replay-recipe
npm run ferrum:smoke
```

`ferrum:authoring-report`는 Game Spec 등 data-driven authoring 입력을 machine-readable JSON으로 검증한다. `packages/create-game/templates/manifest.json`의 `gameplayReplay` entry는 각 template이 deterministic replay fixture를 기본 제공하는지 catalog로 고정한다. 모든 기본 template은 `public/gameplay-replay.fixture.json`과 현재 template contract를 비교하는 `ferrum:replay-report`를 제공한다. `topdown`은 Game Spec 기반 replay contract를 비교하고, `minimal`/`platformer`는 생성 시 바뀌지 않는 template surface contract를 비교한다. replay fixture는 `public/gameplay-replay.coverage-tags.json`을 coverage vocabulary source로 참조하며, 이 vocabulary는 engine golden replay와 같은 shape인 `coverageTagDefinitions`, `coverageTagGroups`, `deprecatedCoverageTags`를 가진다. mismatch report는 `gameplayReplay.replayFixturePatches`에 `FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE` 후보를 포함하므로 agent가 의도된 template/Game Spec 변경을 fixture 갱신으로 이어갈 수 있다. template 또는 `topdown` Game Spec을 의도적으로 바꾼 뒤 fixture를 갱신하려면 `npm run ferrum:update-replay-fixture`를 실행한다.

별도 runtime replay regression gate가 필요한 consumer project는 `scripts/ferrum-runtime-replay.mjs`를 사용한다. 모든 기본 template은 public `createEngine(...)` + deterministic `requestAnimationFrame` shim + `captureGameStateSnapshot(...)` 기반 headless runtime replay fixture를 기본 제공하며, 생성 직후 `npm run ferrum:runtime-replay-report`가 `validated`를 반환한다. `topdown`은 `resolveShooterGameSpec(...)`와 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`로 `public/game.json`과 built-in shooter state를 포함한다. `platformer`는 built-in platformer scene을 public `usePlatformerGame()`으로 boot하고, platformer 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.platformer` JSON으로 고정한다. `npm run ferrum:runtime-replay-recipe`는 template별 fixed timestep, seed/input sequence, capture frame, canonical/excluded state 목록을 `ferrum2d.consumer.runtime-gameplay-replay.recipe` JSON으로 출력한다. 의도한 runtime behavior 변경 뒤에는 `npm run ferrum:update-runtime-replay-fixture`로 `public/gameplay-runtime-replay.fixture.json`을 갱신한다. 이 scaffold는 `@ferrum2d/ferrum-web` public entrypoint만 사용하며 generated Wasm binding이나 `dist/*`/`pkg/*`/`src/*` 내부 import를 사용하지 않는다.

AI agent/skill/command 템플릿은 별도 패키지로 명시적으로 설치한다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```
