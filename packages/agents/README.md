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

Gemini CLI는 공식적으로 `GEMINI.md` context file과 `.gemini/commands/*.toml` custom command를 사용한다. 그래서 이 패키지는 `.gemini/agents` 또는 `.gemini/skills` wrapper를 설치하지 않고, project command가 shared `.agents/skills` 파일을 읽도록 구성한다.

설치된 harness는 `npm run ferrum:report`, `npm run ferrum:validate`, `npm run ferrum:smoke`를 기본 검증 루프로 권장한다. 최신 `@ferrum2d/create-game` 템플릿은 data-driven gameplay authoring을 위한 `npm run ferrum:authoring-report`와 deterministic replay 검증용 `npm run ferrum:replay-report`도 제공한다. consumer game-spec/gameplay agent는 `ProjectileDefinition`, `WeaponDefinition`, `compileWeaponProfiles(...)`, `behaviorRecipeCommandsForEntity(...)`, `applyGameplayBehaviorCommands(...)`, `setInputActionBinding(...)`, `builtInShooterPlayerHandle()` 같은 public authoring/runtime facade를 우선 사용하도록 안내한다. consumer gameplay/playtest agent는 이 report artifact를 우선 evidence로 사용하며, `format`, `version`, `ok`, 실패 시 `reports[].path/message/suggestion`을 확인한다. 프로젝트가 자체 artifact validator를 제공하면 report 생성 후 실행하지만, 일반 consumer 게임에 Ferrum2D 엔진 repo 전용 schema 파일이나 `pnpm` 명령을 강제하지 않는다.

프로젝트가 생성 직후 template surface replay를 넘어 실제 gameplay runtime replay fixture를 원하면 `.agents/harness/ferrum-runtime-replay.md`를 따른다. 이 harness는 `@ferrum2d/ferrum-web` public entrypoint에서 필요한 public helper를 import하도록 안내하며, replay 비교의 핵심 helper로 `createGameplayReplayRun(...)`, `compareGameplayReplayRuns(...)`, `hashGameStateSnapshot(...)`를 사용한다. `@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, `@ferrum2d/ferrum-web/src/*`, generated Wasm binding import는 금지한다.
