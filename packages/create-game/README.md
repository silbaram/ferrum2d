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
npm run ferrum:smoke
```

AI agent/skill/command 템플릿은 별도 패키지로 명시적으로 설치한다.

```bash
npx @ferrum2d/agents init --tools codex,claude,gemini
```
