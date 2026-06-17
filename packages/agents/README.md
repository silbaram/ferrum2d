# @ferrum2d/agents

Ferrum2D consumer game development용 AI agent, skill, Gemini command, shared harness를 프로젝트에 설치하는 CLI다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

이 패키지는 Ferrum2D 엔진 개발용 agent를 설치하지 않는다. 설치 대상은 `@ferrum2d/ferrum-web`을 사용하는 게임 프로젝트다.

설치 내용:

- Codex: `.codex/config.toml`, `.codex/agents/consumer-*.toml`, `.agents/skills/ferrum-consumer-*`
- Claude: `.claude/agents/consumer-*.md`, `.claude/skills/ferrum-consumer-*/SKILL.md`
- Gemini CLI: `.gemini/commands/ferrum/*.toml`, `GEMINI.md`
- Shared harness: `.agents/harness/ferrum-game-development.md`, `.agents/harness/ferrum-runtime-replay.md`

## Agent Template Showcase

`agent-template-showcase`는 별도 example app이나 Pages demo로 만들지 않는다. 이 README가 consumer agent/skill/template showcase의 문서 진입점이고, 실제 설치 파일은 `packages/agents/templates/**`가 source of truth다.

| 영역 | 설치 경로 | 역할 |
| --- | --- | --- |
| Codex agents | `.codex/agents/consumer-*.toml` | 프로젝트 setup, architecture, Game Spec, asset, gameplay, playtest, build 작업을 역할별 subagent로 분리한다. |
| Shared Codex skills | `.agents/skills/ferrum-consumer-*` | Codex와 Gemini command가 함께 읽는 consumer workflow source of truth다. |
| Claude agents/skills | `.claude/agents/consumer-*.md`, `.claude/skills/ferrum-consumer-*/SKILL.md` | Claude project agent와 skill wrapper가 같은 consumer workflow를 사용하게 한다. |
| Gemini commands | `.gemini/commands/ferrum/*.toml`, `GEMINI.md` | Gemini CLI 공식 context/custom command 표면으로 Ferrum workflow를 노출한다. |
| Shared harness | `.agents/harness/ferrum-game-development.md`, `.agents/harness/ferrum-runtime-replay.md` | `ferrum:report`, `ferrum:validate`, `ferrum:smoke`, replay report 루프를 tool-neutral 기준으로 설명한다. |

이 showcase는 `@ferrum2d/ferrum-web`을 사용하는 consumer game project에만 적용한다. Ferrum2D 엔진 자체 개발, release, package QA, Pages 배포 작업에는 저장소의 `.agents/skills/*`, `.codex/agents/*`, `.claude/agents/*`, `.gemini/commands/*` 개발용 설정을 사용한다.

검증 기준은 `pnpm package:check:agents`, `pnpm package:check`, `pnpm package:consumer-smoke`다. 이 검증은 template allowlist, frontmatter/wrapper 규칙, Gemini command 규칙, dry-run 무변경 설치, tarball 포함 파일, consumer project 설치 결과를 확인한다. 신규 consumer agent나 skill을 추가하면 `scripts/package/check-agents-package.mjs`의 role 목록과 이 표를 함께 갱신한다.

설치된 harness의 기본 루프는 `npm run ferrum:report`, `npm run ferrum:validate`, `npm run ferrum:smoke`다. `ferrum:report`는 `ferrum2d.consumer.project.report` JSON envelope로 project file, dependency, internal import를 요약하고 최상위 `recommendedCommands`를 제공한다. `ferrum:smoke`는 consumer project 안에서 validate/build gate를 실행한다. `pnpm package:consumer-smoke`는 tarball로 생성한 프로젝트에 agents를 설치한 뒤 이 report/smoke 루프가 실제로 동작하는지 확인한다.

Gemini CLI는 공식적으로 `GEMINI.md` context file과 `.gemini/commands/*.toml` custom command를 사용한다. 그래서 이 패키지는 `.gemini/agents` 또는 `.gemini/skills` wrapper를 설치하지 않고, `/ferrum:architecture` 같은 project command가 shared `.agents/skills` 파일을 읽도록 구성한다.

새 프로젝트나 더 가까운 시작 템플릿을 고를 때는 `npx @ferrum2d/create-game --list-templates --json`으로 `sceneAuthoring`, `gameplayReplay`, `runtimeGameplayReplay` 지원 상태를 먼저 확인한다. 실제 게임 코드가 커질 때는 consumer architecture agent/skill이 `src/main.ts`를 bootstrap-only로 유지하고 `src/runtime`, `src/game`, `src/assets`, `src/ui`, `src/dev` 경계를 잡도록 안내한다. consumer asset agent/skill은 raw sprite/audio/localization/Tiled/LDtk/Aseprite 입력을 프로젝트 소유 pack/import script 또는 public `@ferrum2d/ferrum-web` helper(`packTextureAtlas(...)`, `textureAtlasDocumentToShooterAtlas(...)`, `importAsepriteAtlas(...)`, `importTiledGameSpec(...)`, `importLDtkGameSpec(...)`, `AudioAssetLoader`, `LocalizationBundle`)로 변환하고, 생성된 atlas/tilemap/localization/audio manifest를 Game Spec 또는 app manifest에 병합한 뒤 `npm run ferrum:validate`와 build/smoke로 확인하는 `import -> validate -> Game Spec` 루프를 안내한다. 최신 `@ferrum2d/create-game` 템플릿은 data-driven gameplay authoring을 위한 `npm run ferrum:authoring-report`, 사람이 placement id를 확인하고 patch를 export하는 `npm run ferrum:placement-viewer`, deterministic replay 검증용 `npm run ferrum:replay-report`도 제공한다. `ferrum:authoring-report`의 `gameplayAuthoring.sceneAuthoring.summary.placementAuthoring.instances[]`는 placement viewer에서 사람이 선택한 `instanceId`를 agent-owned `behaviorRecipes` target으로 연결하는 evidence다. consumer game-spec/gameplay agent는 `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles(...)`, `behaviorRecipeCommandsForEntity(...)`, `applyGameplayBehaviorCommands(...)`, `setInputActionBinding(...)`, `builtInShooterPlayerHandle()`, `previewScenePlacementBindingMigration(...)` 같은 public authoring/runtime facade를 우선 사용하도록 안내한다. consumer gameplay/playtest agent는 이 report artifact를 우선 evidence로 사용하며, `format`, `version`, `ok`, 실패 시 `reports[].path/message/suggestion`을 확인한다. 프로젝트가 자체 artifact validator를 제공하면 report 생성 후 실행하지만, 일반 consumer 게임에 Ferrum2D 엔진 repo 전용 schema 파일이나 `pnpm` 명령을 강제하지 않는다.

프로젝트가 생성 직후 template surface replay를 넘어 실제 gameplay runtime replay fixture를 원하면 `.agents/harness/ferrum-runtime-replay.md`를 따른다. 이 harness는 `@ferrum2d/ferrum-web` public entrypoint에서 필요한 public helper를 import하도록 안내하며, replay 비교의 핵심 helper로 `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`를 사용한다. `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, `@ferrum2d/ferrum-web/src/*`, generated Wasm binding import는 금지한다.
