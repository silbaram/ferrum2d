# npm 패키지 구성 전략

Ferrum2D npm 배포는 엔진 런타임, 프로젝트 생성기, AI 개발 보조 도구를 분리한다. 목적이 다른 파일을 한 package에 섞지 않아 사용자 설치 경로와 agent/skill 적용 범위를 명확하게 유지하기 위함이다.

## 패키지 역할

| package | 역할 | 사용자 |
| --- | --- | --- |
| `@ferrum2d/ferrum-web` | 브라우저 런타임 엔진, WebGL2 platform layer, generated Wasm artifact, public API | Ferrum2D 게임 앱 |
| `@ferrum2d/create-game` | 새 게임 프로젝트 생성 CLI. 템플릿과 `@ferrum2d/ferrum-web` dependency를 생성 프로젝트에 배치 | 새 프로젝트를 시작하는 개발자/AI agent |
| `@ferrum2d/agents` | Ferrum2D consumer game development용 Codex/Claude/Gemini agent와 skill 설치 CLI | AI로 게임을 개발하는 사용자 |

`@ferrum2d/ferrum-web`은 실행에 필요한 엔진 본체다. `@ferrum2d/create-game`과 `@ferrum2d/agents`는 개발 도구이며, 엔진 런타임 artifact에 포함하지 않는다.

## 사용 흐름

새 게임 프로젝트:

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
npm run dev
```

생성된 프로젝트의 `package.json`에는 `@ferrum2d/ferrum-web` dependency가 들어간다. 엔진 소스 코드는 복사하지 않는다.

AI agent/skill 설치:

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```

이 명령은 사용자 프로젝트 루트에 consumer 개발용 agent/skill만 설치한다. Ferrum2D 엔진 개발용 agent, release agent, package QA agent는 배포하지 않는다.

## 적용 범위

`@ferrum2d/agents`가 설치하는 범위:

- `.agents/skills/ferrum-consumer-*`
- `.codex/agents/consumer-*.toml`
- `.claude/agents/consumer-*.md`
- `.claude/skills/ferrum-consumer-*/SKILL.md`
- `.gemini/agents/consumer-*.md`
- 선택한 tool별 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` instruction block

Gemini는 `.agents/skills` workspace alias를 사용하므로 `.gemini/skills` wrapper를 만들지 않는다.

## 금지 기준

- `@ferrum2d/ferrum-web` tarball에 agent/skill 파일을 포함하지 않는다.
- `npm install @ferrum2d/ferrum-web`만으로 사용자의 `.agents`, `.codex`, `.claude`, `.gemini` 파일을 변경하지 않는다.
- `postinstall`로 agent/skill을 자동 주입하지 않는다.
- consumer agent는 엔진 내부 구현, npm publish, Git tag, release note, package allowlist를 다루지 않는다.

## 배포 단계

1. `@ferrum2d/ferrum-web`: 런타임 package 안정화와 beta publish guard를 먼저 유지한다.
2. `@ferrum2d/create-game`: 런타임 dependency를 포함한 starter project generator로 분리 배포한다.
3. `@ferrum2d/agents`: AI consumer 개발 환경을 명시적 `init` 명령으로 설치하는 도구로 분리 배포한다.

현재 저장소에서는 accidental publish 방지를 위해 세 package 모두 `private: true`를 유지한다. 실제 publish는 package별 release checklist가 추가되고 사용자 승인이 있을 때만 진행한다.

## 검증 명령

전체 package artifact 검증:

```bash
pnpm package:check
```

패키지별 artifact 검증:

```bash
pnpm package:check:ferrum-web
pnpm package:check:create-game
pnpm package:check:agents
```

publish 후보 검증은 대상 package의 `private: false` 전환과 beta semver 승인이 끝난 뒤에만 실행한다.

```bash
pnpm package:publish-check:ferrum-web
pnpm package:publish-check:create-game
pnpm package:publish-check:agents
```

`@ferrum2d/create-game` 검증은 실제 템플릿 생성 결과의 `package.json`, public API import, 필수 starter 파일을 확인한다. `@ferrum2d/agents` 검증은 consumer skill/agent frontmatter, Claude wrapper, Gemini `.agents/skills` alias 규칙, dry-run 무변경 동작, 실제 설치 결과를 확인한다.
