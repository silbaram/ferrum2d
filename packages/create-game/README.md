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
npx @ferrum2d/create-game --list-templates --json
npx @ferrum2d/create-game my-shooter --template topdown
npx @ferrum2d/create-game my-platformer --template platformer
npx @ferrum2d/create-game my-breakout --template breakout
```

- `minimal`: runtime/HUD/debug metric과 `ProjectileDefinition`/`WeaponDefinition` authoring 예제를 포함한 가장 작은 starter
- `topdown`: Game Spec 기반 Top-down Shooter starter
- `platformer`: built-in platformer scene starter
- `breakout`: built-in Breakout scene과 runtime metric을 사용하는 arcade block breaker starter

`--list-templates --json`은 agent가 template별 `sceneAuthoring`, `gameplayReplay`, `runtimeGameplayReplay` 지원 상태를 읽을 수 있는 machine-readable catalog를 출력한다.

`minimal` 템플릿은 public `compileWeaponProfiles(...)`와 `behaviorRecipeCommandsForEntity(...)` 경로로 `standard`, `piercing`, `bounce` projectile profile을 컴파일한 뒤 built-in player에 적용한다. 또한 기본 템플릿의 `public/scene-authoring.json`은 `SceneComposition` + `BehaviorRecipe` fixture를 제공하고, `ferrum:authoring-report`가 public `resolveSceneAuthoringDocument(...)`와 `applySceneBehaviorRecipes(...)` helper로 envelope, scene instance handle, behavior command 연결을 검증한다. 브라우저에서 `?profile=piercing` 또는 `?profile=bounce` query를 붙이면 같은 Rust core 수정 없이 다른 projectile behavior를 확인할 수 있다.

생성된 프로젝트에는 AI agent-first 개발용 하네스 명령이 포함된다.

```bash
npm run ferrum:asset-report
npm run ferrum:asset-validate
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:authoring-report
npm run ferrum:replay-report
npm run ferrum:runtime-replay-report
npm run ferrum:runtime-replay-recipe
npm run pack:textures
npm run ferrum:smoke
```

모든 템플릿은 공통 asset scaffold를 포함한다. `public/assets/texture-atlas.input.json`은 raw sprite dimension metadata를 기록하는 시작점이고, `public/assets/audio.manifest.json`과 `public/assets/localization.manifest.json`은 sound manifest와 Game Spec localization 연결 상태를 agent가 읽는 시작점이다. `npm run pack:textures`는 public `@ferrum2d/ferrum-web` entrypoint의 `packTextureAtlas(...)`, `textureAtlasDocumentToShooterAtlas(...)`, `resolveShooterGameSpec(...)` helper로 `public/assets/atlas.json`을 생성하며 `public/game.json`이 있으면 `atlas.frames`에 병합한다. `npm run ferrum:asset-report`는 dependency import 없이 현재 asset scaffold, atlas metadata, Game Spec 존재 여부를 machine-readable JSON으로 출력한다. `npm run ferrum:asset-validate`는 public package entrypoint에서 `AudioAssetLoader`, `LocalizationBundle`, `resolveShooterGameSpec(...)`를 import해 audio/localization/Game Spec asset metadata를 검증한다.

`ferrum:authoring-report`는 Game Spec 등 data-driven authoring 입력을 machine-readable JSON으로 검증한다. `packages/create-game/templates/manifest.json`의 `sceneAuthoring` entry는 template별 authoring fixture 지원 상태를 catalog로 고정하고, configured template은 `public/scene-authoring.json` fixture를 템플릿 복사 전에 검증한다. `gameplayReplay` entry는 deterministic replay fixture 제공 여부를 고정한다. 모든 template은 `public/gameplay-replay.fixture.json`과 현재 template contract를 비교하는 `ferrum:replay-report`를 제공한다. `topdown`은 Game Spec 기반 replay contract를 비교하고, `minimal`/`platformer`/`breakout`은 생성 시 바뀌지 않는 template surface contract를 비교한다. replay fixture는 `public/gameplay-replay.coverage-tags.json`을 coverage vocabulary source로 참조하며, 이 vocabulary는 engine golden replay와 같은 shape인 `coverageTagDefinitions`, `coverageTagGroups`, `deprecatedCoverageTags`를 가진다. mismatch report는 `gameplayReplay.replayFixturePatches`에 `FERRUM_CONSUMER_REPLAY_FIXTURE_PATCH_CANDIDATE` 후보를 포함하므로 agent가 의도된 template/Game Spec 변경을 fixture 갱신으로 이어갈 수 있다. template 또는 `topdown` Game Spec을 의도적으로 바꾼 뒤 fixture를 갱신하려면 `npm run ferrum:update-replay-fixture`를 실행한다. `breakout`은 P3 genre starter scaffold로 공개되며, `public/scene-authoring.json`이 built-in Breakout paddle/ball runtime entity handle과 Behavior Recipe binding을 검증한다.

별도 runtime replay regression gate가 필요한 consumer project는 `scripts/ferrum-runtime-replay.mjs`를 사용한다. `minimal`/`topdown`/`platformer`/`breakout`은 public `createEngine(...)` + deterministic `requestAnimationFrame` shim + `captureGameStateSnapshot(...)` 기반 headless runtime replay fixture를 기본 제공하며, 생성 직후 `npm run ferrum:runtime-replay-report`가 `validated`를 반환한다. `topdown`은 `resolveShooterGameSpec(...)`와 `captureGameStateSnapshot(..., { includeBuiltInShooterState: true })`로 `public/game.json`과 built-in shooter state를 포함한다. `platformer`는 built-in platformer scene을 public `usePlatformerGame()`으로 boot하고, platformer 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.platformer` JSON으로 고정한다. `breakout`은 built-in Breakout scene을 public `useBreakoutGame()`으로 boot하고, Breakout 전용 built-in snapshot이 없으므로 canonical scene/runtime state를 `custom.breakout` JSON으로 고정한다. `npm run ferrum:runtime-replay-recipe`는 template별 fixed timestep, seed/input sequence, capture frame, canonical/excluded state 목록을 `ferrum2d.consumer.runtime-gameplay-replay.recipe` JSON으로 출력한다. 의도한 runtime behavior 변경 뒤에는 configured template에서 `npm run ferrum:update-runtime-replay-fixture`로 `public/gameplay-runtime-replay.fixture.json`을 갱신한다. 이 harness는 `@ferrum2d/ferrum-web` public entrypoint만 사용하며 generated Wasm binding이나 `dist/*`/`pkg/*`/`src/*` 내부 import를 사용하지 않는다.

AI agent/skill/command 템플릿은 별도 패키지로 명시적으로 설치한다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```
