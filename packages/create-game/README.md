# @ferrum2d/create-game

Ferrum2D 게임 프로젝트 생성 CLI다.

```bash
npm create @ferrum2d/game my-game
cd my-game
npm install
npm run dev
```

생성된 프로젝트는 `@ferrum2d/ferrum-web`을 dependency로 사용한다. 엔진 소스 코드를 복사하지 않고, npm package entrypoint만 import한다.

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
