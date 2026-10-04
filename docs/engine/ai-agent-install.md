# AI 에이전트용 Ferrum2D 초기 설치 지침

이 문서는 사용자의 게임 프로젝트에 **엔진 패키지, 개발 도구, AI 지침만 설치하는 절차**다. 설치가 끝나면 게임 요구사항을 기다린다. 초기 설치 요청만으로 예제 게임, `src/`, `public/`, HTML 화면, 배치 뷰어, replay fixture를 만들거나 개발 서버를 시작하지 않는다.

`0.1.0-beta.7`의 `create-game`은 실행 가능한 예제 생성기다. `minimal`에도 슈팅 동작, HUD, authoring/replay 데이터와 viewer 코드가 들어 있다. **초기 설정에서는 어떤 `create-game` 템플릿도 실행하지 않고 엔진 tarball을 직접 설치한다.** 사용자가 예제 게임을 명시적으로 요청한 경우에만 [템플릿 퀵스타트](developer-quickstart.md)를 따른다.

## 사용자 요청 예시

대상 디렉터리를 AI 도구에서 열고 다음 요청을 전달한다.

```text
https://github.com/silbaram/ferrum2d/blob/main/docs/engine/ai-agent-install.md

이 문서를 따라 현재 디렉터리에 Ferrum2D 초기 개발 환경만 설치해줘.
엔진, TypeScript/Vite, AI 개발 지침을 설치하고 의존성을 검증해줘.
예제 게임, src 코드, 화면, 뷰어, 게임 데이터는 만들지 말고 설치 결과만 알려줘.
```

원문이 필요한 도구는 [Raw Markdown](https://raw.githubusercontent.com/silbaram/ferrum2d/main/docs/engine/ai-agent-install.md)을 읽는다. 사용자가 지정한 경로와 기존 프로젝트 지침을 우선하며, 설치 설명에 그치지 말고 아래 절차를 실행한다.

## 1. 환경과 기존 파일 확인

사용자가 지정한 프로젝트 디렉터리에서 실행한다.

```bash
node --version
npm --version
node -e "console.log(process.cwd()); console.log(require('node:fs').readdirSync('.'))"
```

Node.js 22를 권장한다. npm/npx와 GitHub·npm 레지스트리 네트워크 접근이 필요하다. 빌드된 Wasm을 설치하므로 Rust, wasm-pack, 엔진 저장소 clone은 필요하지 않다.

`.git`이나 기존 AI 지침이 있어도 초기 설치는 가능하다. 기존 `package.json`, `.npmrc`, `.gitignore`, 지침 파일은 읽고 필요한 설정만 병합한다. 사용자가 작성한 코드와 지침을 덮어쓰거나 예제 정리 명목으로 삭제하지 않는다. Node.js/npm이 없으면 누락된 도구를 알리고, 기존 전역 환경을 임의로 교체하지 않는다.

## 2. 프로젝트 설정 작성

새 프로젝트에서는 아래 `package.json`을 작성한다. `name`은 실제 디렉터리에 맞는 npm package name으로 바꾼다. 기존 프로젝트에는 필요한 dependency와 script만 병합한다. `authoring-viewer`와 `create-game`은 초기 설치에 추가하지 않는다.

```json
{
  "name": "my-game",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "ferrum:setup-check": "node --input-type=module -e \"await import('@ferrum2d/ferrum-web/core'); console.log('Ferrum2D setup OK')\"",
    "ferrum:agents": "npx --yes --allow-remote=root --package=https://github.com/silbaram/ferrum2d/releases/download/ferrum-web-v0.1.0-beta.7/ferrum2d-agents-0.1.0-beta.7.tgz ferrum2d-agents init --tools codex,claude,gemini"
  },
  "dependencies": {
    "@ferrum2d/ferrum-web": "https://github.com/silbaram/ferrum2d/releases/download/ferrum-web-v0.1.0-beta.7/ferrum2d-ferrum-web-0.1.0-beta.7.tgz"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vite": "^5.4.19"
  },
  "ferrumGithubRelease": {
    "repository": "silbaram/ferrum2d",
    "version": "0.1.0-beta.7",
    "tag": "ferrum-web-v0.1.0-beta.7"
  }
}
```

설치 대상은 [Ferrum2D 0.1.0-beta.7](https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.7)다. 해당 Release와 설치 파일이 공개되어 있는지 확인한 뒤 진행한다. 엔진과 agents URL은 같은 버전으로 고정한다. `latest`나 npm registry package name으로 임의 치환하지 않는다. 게임 자체의 `version`은 엔진 버전과 별개다.

새 `.npmrc`에는 다음을 기록한다. 기존 정책과 충돌하면 파일을 덮어쓰지 말고 충돌을 알린다.

```ini
allow-remote=root
```

새 `.gitignore`에는 다음을 기록한다. 기존 파일에는 없는 항목만 추가한다.

```gitignore
node_modules/
dist/
```

이 단계에서 `dev`, `build`, `preview`, `ferrum:check`, `ferrum:deploy-report` 스크립트나 TypeScript/Vite 설정 파일을 임의로 만들지 않는다. 이들은 실제 게임의 entrypoint와 검증 요구가 정해진 뒤 추가한다.

## 3. 패키지와 AI 지침 설치

각 명령의 종료 코드를 확인하고 성공한 뒤 다음 명령을 실행한다.

```bash
npm install
npm run ferrum:agents
```

엔진은 GitHub Release에서, TypeScript와 Vite는 npm 레지스트리에서 설치한다. `package-lock.json`을 보존하고 버전 관리에 포함한다. 기존 lockfile과 의존성이 바뀌지 않은 재설치는 `npm ci`를 사용한다.

`ferrum:agents`는 게임 코드 없이 consumer AI 지침만 설치한다.

| 도구 | 진입 지침 | 설치 디렉터리 |
| --- | --- | --- |
| Codex | `AGENTS.md` | `.codex/agents/`, `.agents/skills/` |
| Claude | `CLAUDE.md` | `.claude/agents/`, `.claude/skills/`, `.agents/skills/` |
| Gemini | `GEMINI.md` | `.gemini/commands/`, `.agents/skills/` |

`FERRUM_INSTALL.md`에 릴리스 URL, 엔진 버전, 재설치 명령과 아래 프로젝트 상태를 기록한다. 설치된 각 진입 지침에도 기존 내용과 managed block을 보존하면서 `FERRUM_INSTALL.md`를 먼저 읽으라는 안내와 아래 초기 설정 범위를 추가한다. 이 문구는 실제 게임 개발 요청이 들어오면 해당 요구사항에 맞게 갱신한다.

```text
현재 프로젝트는 Ferrum2D 의존성과 AI 지침만 설치한 초기 설정 상태다.
초기 설치 검증은 npm run ferrum:setup-check를 사용한다.
설치를 완료한다는 이유로 src/, public/, HTML, 예제 게임, viewer, replay 데이터 또는 누락된 게임 검증 스크립트를 생성하지 않는다.
사용자가 게임 개발을 요청한 뒤 필요한 코드와 설정, 게임 검증 명령을 추가한다.
```

게임 개발용 skill의 build/report 절차는 해당 게임 파일과 명령이 실제로 존재할 때 적용한다. 초기 설정 단계에서 없는 파일을 검사 실패로 취급하고 예제를 복사해 보충하지 않는다. 엔진 저장소의 개발용 `AGENTS.md`나 release agent를 게임 프로젝트에 복사하지 않는다.

게임 개발을 요청받으면 [AI 게임 개발 기능 안내](ai-feature-guide.md)를 통해 요구사항에 맞는
공개 API와 설치 버전의 reference를 확인한다. `0.1.0-beta.6` agents부터
`.agents/harness/ferrum-feature-guide.md`가 함께 설치되며 root 지침과 공통 harness에서 참조한다.
기존 프로젝트의 지침은 자동 교체되지 않으므로 새 파일을 빈 임시 디렉터리에 설치해 사용자 수정과
비교·병합한다. beta.5 이하 지침에 안내서가 없다는 이유로 예제나 게임 파일을 추가하지 않는다.

## 4. 설치 검증과 종료

```bash
npm ls --depth=0
npm run ferrum:setup-check
```

엔진 버전이 `0.1.0-beta.7`이고 TypeScript/Vite가 정상 설치되었는지 확인한다. `ferrum:setup-check`는 설치한 엔진의 공개 `/core` JavaScript entrypoint를 import한다. **브라우저 렌더링, Wasm 초기화, 게임 실행을 검증한 결과는 아니다.** 별도 `src` 파일이나 검사 스크립트 파일은 생성하지 않는다.

새 프로젝트의 정상적인 완료 형태는 다음과 같다.

```text
game-project/
  package.json
  package-lock.json
  .npmrc
  .gitignore
  FERRUM_INSTALL.md
  AGENTS.md / CLAUDE.md / GEMINI.md
  .agents/ / .codex/ / .claude/ / .gemini/
  node_modules/
```

프로젝트 루트에 `src/`, `public/`, `scripts/`, `index.html`, `placement-viewer.html`, `dist/`가 없어도 정상이다. `node_modules/` 안의 설치 패키지 파일은 게임 프로젝트에 예제를 생성한 것으로 간주하지 않는다.

완료 보고에는 프로젝트 경로, 설치 버전, AI 지침 설치 여부, 실행한 검증 결과를 적는다. **초기 설정 완료·게임 코드는 아직 생성하지 않음**을 명시하고 여기서 종료한다. 개발 서버 주소나 게임 배포 준비 완료를 보고하지 않는다. 이후 게임 개발 요청을 받으면 [Public API](public-api.md)와 설치된 consumer 지침을 읽고 필요한 코드부터 작성한다.

## 기존 예제 프로젝트와 오류 대응

- 이미 `create-game`으로 예제가 생성된 폴더라면 이 초기 설치를 다시 실행한다고 파일이 사라지지는 않는다. 정리를 요청받은 경우 기존 수정 여부를 확인하고, 예제 코드·설정·데이터와 기존 package/lock을 프로젝트 밖에 백업한 뒤 초기 설정으로 전환한다. 사용자 코드와 자산은 보존한다.
- GitHub 다운로드가 실패하면 위 버전의 릴리스 공개 상태, 파일명, 네트워크 접근을 확인한다.
- npm 12에서 `EALLOWREMOTE`가 발생하면 `.npmrc`와 기존 정책을 확인한다. 직접 URL 설치가 허용된 환경에서는 `npm install --allow-remote=root`를 사용할 수 있다. npm 12 이전 버전의 알 수 없는 설정 경고와 실제 실패 종료 코드를 구분한다.
- `ferrum:setup-check`가 실패하면 Node 버전, lockfile, 실제 설치된 dependency와 공개 import 경로를 확인한다. 예제 게임 생성으로 우회하지 않는다.
