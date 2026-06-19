# npm 패키지 구성 전략

Ferrum2D npm 배포는 엔진 런타임, 프로젝트 생성기, AI 개발 보조 도구를 분리한다. 목적이 다른 파일을 한 package에 섞지 않아 사용자 설치 경로와 agent/skill 적용 범위를 명확하게 유지하기 위함이다.

## 패키지 역할

| package | 역할 | 사용자 |
| --- | --- | --- |
| `@ferrum2d/ferrum-web` | 브라우저 런타임 엔진, WebGL2 platform layer, generated Wasm artifact, public API | Ferrum2D 게임 앱 |
| `@ferrum2d/authoring-viewer` | placement viewer title/workflow/behavior binding evidence, DOM control/shell/panel primitive helper 같은 agent-first authoring viewer 공통 계약 | generated placement viewer와 공식 viewer host |
| `@ferrum2d/create-game` | 새 게임 프로젝트 생성 CLI. 템플릿과 `@ferrum2d/ferrum-web`, `@ferrum2d/authoring-viewer` dependency를 생성 프로젝트에 배치 | 새 프로젝트를 시작하는 개발자/AI agent |
| `@ferrum2d/agents` | Ferrum2D consumer game development용 Codex/Claude agent, shared skill, Gemini command 설치 CLI | AI로 게임을 개발하는 사용자 |

`@ferrum2d/ferrum-web`은 실행에 필요한 엔진 본체다. `@ferrum2d/authoring-viewer`는 placement viewer의 공통 계약과 반복 DOM control/shell/panel primitive 생성을 담는 작은 helper package다. `@ferrum2d/create-game`과 `@ferrum2d/agents`는 개발 도구이며, 엔진 런타임 artifact에 포함하지 않는다.

## 사용 흐름

새 게임 프로젝트:

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
npm run dev
```

생성된 프로젝트의 `package.json`에는 `@ferrum2d/ferrum-web`과 `@ferrum2d/authoring-viewer` dependency가 들어간다. 엔진 소스 코드는 복사하지 않는다.

AI agent/skill 설치:

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

이 명령은 사용자 프로젝트 루트에 consumer 개발용 agent/skill만 설치한다. Ferrum2D 엔진 개발용 agent, release agent, package QA agent는 배포하지 않는다.

생성 프로젝트가 `@ferrum2d/create-game` 최신 템플릿을 사용하면 AI 개발 하네스 명령도 함께 제공한다.

```bash
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:smoke
```

`ferrum:report`는 `ferrum2d.consumer.project.report` JSON envelope로 package dependency, generated file, internal import를 요약하고 최상위 `recommendedCommands`를 제공한다. `ferrum:smoke`는 생성 프로젝트 안에서 validate/build를 실행하는 기본 소비자 검증 gate다.

## 적용 범위

`@ferrum2d/agents`가 설치하는 범위:

- `.agents/skills/ferrum-consumer-*`
- `.agents/harness/ferrum-game-development.md`
- `.codex/config.toml`
- `.codex/agents/consumer-*.toml`
- `.claude/agents/consumer-*.md`
- `.claude/skills/ferrum-consumer-*/SKILL.md`
- `.gemini/commands/ferrum/*.toml`
- 선택한 tool별 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` instruction block

Codex는 공식 subagent 파일인 `.codex/agents/*.toml`과 repo skill 위치인 `.agents/skills`를 사용한다. Claude는 공식 project subagent/skill 위치인 `.claude/agents/*.md`, `.claude/skills/*/SKILL.md`를 사용한다. Gemini CLI는 공식 context/custom command 위치인 `GEMINI.md`, `.gemini/commands/*.toml`을 사용하므로 `.gemini/agents` 또는 `.gemini/skills` wrapper를 만들지 않는다.

## 금지 기준

- `@ferrum2d/ferrum-web` tarball에 agent/skill 파일을 포함하지 않는다.
- `npm install @ferrum2d/ferrum-web`만으로 사용자의 `.agents`, `.codex`, `.claude`, `.gemini` 파일을 변경하지 않는다.
- `postinstall`로 agent/skill을 자동 주입하지 않는다.
- consumer agent는 엔진 내부 구현, npm publish, Git tag, release note, package allowlist를 다루지 않는다.

## 배포 단계

1. `@ferrum2d/ferrum-web`: 런타임 package 안정화와 beta publish guard를 먼저 유지한다.
2. `@ferrum2d/authoring-viewer`: generated placement viewer와 공식 viewer host가 공유하는 lightweight helper package로 분리 배포한다.
3. `@ferrum2d/create-game`: 런타임/authoring viewer dependency를 포함한 starter project generator로 분리 배포한다.
4. `@ferrum2d/agents`: AI consumer 개발 환경을 명시적 `init` 명령으로 설치하는 도구로 분리 배포한다.

현재 저장소에서는 accidental publish 방지를 위해 네 package 모두 `private: true`를 유지한다. 실제 publish는 package별 release checklist가 통과하고 사용자 승인이 있을 때만 진행한다. 첫 public beta 후보는 네 package가 같은 base version을 공유하는 lockstep 후보로 다룬다. 예를 들어 root와 네 package가 모두 `0.1.0` base이면 release 후보는 `0.1.0-beta.N` 계열로 검증한다. package별 독립 versioning은 별도 release policy가 생기기 전까지 사용하지 않는다.

## 검증 명령

전체 package artifact 검증:

```bash
pnpm package:check
```

기본 PR/main CI의 validate job은 `pnpm validate:public-api-surface`, `pnpm release:candidate-check`, `pnpm package:check`를 실행한다. 이 조합은 public API tier/allowlist, beta candidate metadata, 네 package tarball allowlist, Wasm artifact, create-game template matrix, agents installer package contract를 함께 검증한다. 실제 consumer 프로젝트 설치/빌드 matrix인 `pnpm package:consumer-smoke`는 tag 또는 명시적 workflow dispatch에서 실행한다.

패키지 소비자 프로젝트 smoke 검증:

```bash
pnpm package:consumer-smoke
```

로컬 release 리허설:

```bash
pnpm release:local-check
```

`pnpm release:local-check`는 `private: true` 상태에서 `pnpm release:candidate-check`, `pnpm package:check`, local tarball 기반 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke-release-local`, `pnpm validate:consumer-smoke-report`를 순서대로 실행한다. 이 명령은 npm publish, Git tag, GitHub Release 같은 외부 상태를 바꾸지 않는다. 목적은 실제 배포 전에 네 package tarball과 generated consumer project install/build/smoke 경로가 같은 후보 세트로 동작하는지 확인하는 것이다.

패키지별 artifact 검증:

```bash
pnpm package:check:ferrum-web
pnpm package:check:authoring-viewer
pnpm package:check:create-game
pnpm package:check:agents
```

publish 후보 검증은 대상 package의 `private: false` 전환과 beta semver 승인이 끝난 뒤에만 실행한다.

```bash
pnpm package:publish-check:ferrum-web
pnpm package:publish-check:authoring-viewer
pnpm package:publish-check:create-game
pnpm package:publish-check:agents
```

`@ferrum2d/create-game` 검증은 `templates/*` 전체 matrix의 생성 결과를 대상으로 `package.json`, public API import, AI 개발 하네스 스크립트, 필수 starter 파일, generated placement viewer module 파일을 확인한다. 별도 `pnpm smoke:create-game-template-catalog` gate는 `--list-templates --json` machine-readable catalog가 manifest의 `sceneAuthoring`, `gameplayReplay`, `runtimeGameplayReplay` 계약과 일치하는지, 잘못된 manifest를 JSON catalog로 내보내기 전에 거부하는지 빠르게 확인한다. `@ferrum2d/agents` 검증은 consumer skill/agent frontmatter, Claude wrapper, Gemini custom command 규칙, dry-run 무변경 동작, 실제 설치 결과를 확인한다.

`pnpm package:consumer-smoke`는 네 package를 로컬 tarball로 pack한 뒤 임시 consumer 환경에서 `@ferrum2d/create-game`과 `@ferrum2d/agents` bin을 설치해 실행한다. 설치된 `@ferrum2d/create-game`의 `--list-templates --json`도 먼저 실행해 tarball 내부 template catalog를 `consumer-smoke-report.json`의 `createGameCatalog` summary로 남긴다. 기본값은 `packages/create-game/templates/*` 전체를 생성하고, 특정 범위만 보려면 `--templates minimal,topdown`처럼 지정한다. 생성된 게임 프로젝트는 `@ferrum2d/ferrum-web`과 `@ferrum2d/authoring-viewer` tarball을 dependency로 설치하고 public entrypoint import, 내부 `dist/*` import 차단, `ferrum:report`, `ferrum:validate`, authoring/replay/runtime replay report, generated placement viewer smoke, `ferrum:smoke`, production build를 확인한다. 의존성 store가 준비된 CI 환경에서는 `pnpm package:consumer-smoke -- --offline`으로 registry resolution 없이 실행할 수 있다. 성공/실패 원인과 소비자 프로젝트 상태를 보존해야 할 때는 `pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke`를 사용한다. 이 경로에는 `consumer-smoke-report.json` machine-readable summary, tarball, `node_modules`/`dist`를 제외한 가벼운 consumer project snapshot이 남는다. CI는 smoke 직후 `pnpm validate:consumer-smoke-report`로 report format/version/status, tarball-installed `createGameCatalog`, `requestedTemplates`와 실제 template report matrix의 일치, 템플릿별 checks/reports, tarball 존재, snapshot 정리 상태를 검증하고 성공/실패 모두 artifact를 업로드한다. `pnpm smoke:consumer-smoke-report`는 초기 실패 report, 템플릿 중간 실패 report, passed report의 catalog 누락/불일치, snapshot 오염 실패를 synthetic artifact로 검증해 failed report path와 passed report schema가 CI에서 유지되도록 한다.
