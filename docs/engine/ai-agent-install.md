# AI 에이전트용 Ferrum2D 설치 지침

이 문서는 Codex, Claude, Gemini 등 터미널을 사용할 수 있는 AI 에이전트가 **사용자의 게임 프로젝트 디렉터리에 Ferrum2D를 설치하고 실행을 검증하는 절차**다. 사용자가 이 문서를 따라 설치하라고 요청하면 설명에 그치지 말고 아래 단계를 실행한다. 사용자가 지정한 경로, 템플릿, 기존 프로젝트 지침을 우선한다.

## 사용자 요청 예시

빈 게임 디렉터리를 AI 도구에서 열고 다음 요청을 전달한다.

```text
https://github.com/silbaram/ferrum2d/blob/main/docs/engine/ai-agent-install.md

이 문서를 읽고 현재 빈 디렉터리에 Ferrum2D 게임 개발 환경을 설치해줘.
topdown 템플릿과 AI 개발 지침을 설치하고, 게임 검사와 배포 준비 검사를 실행해줘.
개발 서버를 실행한 뒤 접속 주소와 검증 결과를 알려줘.
```

원문을 읽어야 하는 도구는 [Raw Markdown](https://raw.githubusercontent.com/silbaram/ferrum2d/main/docs/engine/ai-agent-install.md)을 사용한다. 이 문서를 설치 대상 폴더에 먼저 저장하면 폴더가 비어 있지 않게 된다. 원격으로 읽거나 대상 폴더 밖에 보관한다.

## 설치 기준

| 항목 | 기준 |
| --- | --- |
| 설치 버전 | `0.1.0-beta.0` |
| Git tag | `ferrum-web-v0.1.0-beta.0` |
| 공개 릴리스 | [Ferrum2D 0.1.0-beta.0](https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.0) |
| 실행 환경 | Node.js 22 권장, npm과 npx, WebGL2 지원 브라우저 |
| 다운로드 | Ferrum2D 패키지는 GitHub Release, Vite·TypeScript 등 개발 도구는 npm 레지스트리 |
| 기본 템플릿 | 사용자가 지정하지 않았다면 이 지침에서는 `topdown` 사용 |

빌드된 Wasm이 패키지에 포함되어 있으므로 게임 프로젝트에 Rust, wasm-pack, pnpm이나 엔진 소스 clone은 필요하지 않다. npm에 공개된 패키지 이름으로 설치하는 대신 아래의 **버전이 고정된 GitHub tarball URL**을 사용한다. GitHub의 자동 생성 Source code 압축 파일은 설치용 패키지가 아니다.

## 1. 대상 디렉터리와 실행 환경 확인

사용자가 지정한 게임 디렉터리에서 실행한다. 각 명령의 종료 상태를 확인하고 실패한 단계가 있으면 원인을 해결한 뒤 다음 단계로 진행한다.

```bash
node --version
npm --version
node -e "console.log(process.cwd()); console.log(require('node:fs').readdirSync('.'))"
```

- 새 프로젝트 생성 대상은 빈 디렉터리여야 한다. `.git`, `.vscode`, `AGENTS.md` 같은 숨김 파일이나 지침 파일만 있어도 생성기는 비어 있지 않은 것으로 판단한다.
- 파일이 있다면 먼저 내용을 확인한다. 이미 생성된 Ferrum2D 프로젝트라면 아래 재설치 절차를 사용한다. 새 프로젝트가 필요하면 사용자가 지정한 새 경로나 비어 있는 하위 디렉터리를 사용한다.
- 사용자 파일을 삭제하거나 `--force`로 덮어써서 빈 디렉터리 검사를 우회하지 않는다. 대상이 불명확하면 충돌 내용과 필요한 경로 선택을 알린다.
- Node.js/npm을 실행할 수 없다면 누락된 도구와 설치 필요 사항을 알린다. 기존 전역 개발 환경을 임의로 교체하지 않는다.

## 2. 현재 디렉터리에 게임 프로젝트 생성

아래 명령의 `.`은 현재 디렉터리다. 명령은 한 줄로 실행하며 Bash와 PowerShell에서 같은 형태로 사용할 수 있다.

```bash
npx --yes --allow-remote=root https://github.com/silbaram/ferrum2d/releases/download/ferrum-web-v0.1.0-beta.0/ferrum2d-create-game-0.1.0-beta.0.tgz . --template topdown
```

새 하위 디렉터리에 만들려면 `.`을 `my-game`처럼 원하는 이름으로 바꾸고 생성 후 해당 디렉터리로 이동한다. 공백이 있는 경로는 따옴표로 감싼다. 이후 모든 명령은 생성된 `package.json`이 있는 디렉터리에서 실행한다.

| 템플릿 | 시작점 |
| --- | --- |
| `topdown` | Game Spec 기반 탑다운 슈터 |
| `minimal` | 가장 작은 runtime starter |
| `platformer` | 이동·점프 중심 플랫폼 게임 starter |
| `breakout` | 패들·공·벽돌 중심 아케이드 starter |

템플릿은 위 명령의 `--template` 값으로 선택한다. 생성 후 `package.json`과 `FERRUM_INSTALL.md`를 읽고 다음을 확인한다.

- `ferrumGithubRelease`의 저장소는 `silbaram/ferrum2d`, 버전은 `0.1.0-beta.0`, 태그는 `ferrum-web-v0.1.0-beta.0`이다.
- `@ferrum2d/ferrum-web`, `@ferrum2d/authoring-viewer` 의존성과 `ferrum:agents` 스크립트의 다운로드 URL은 모두 같은 릴리스를 가리킨다.
- `.npmrc`에 `allow-remote=root`가 있다. npm 12에서 직접 URL 의존성을 설치하기 위한 설정이다.

## 3. 엔진과 개발 도구 설치

```bash
npm install
npm ls --depth=0
```

엔진과 viewer의 설치 버전이 `0.1.0-beta.0`인지 확인한다. 게임 자체의 `package.json.version`은 게임 프로젝트 버전이므로 엔진 버전과 같을 필요가 없다. 생성된 `package-lock.json`을 보존하고 버전 관리에 포함한다.

## 4. AI 게임 개발 지침 설치

```bash
npm run ferrum:agents
```

이 단계는 AI로 게임을 개발할 때 명시적으로 실행한다. `npm install`만으로는 지침을 설치하지 않는다. 위 사용자 요청 예시에는 이 단계가 포함되어 있다.

설치 후 현재 사용하는 도구의 진입 지침, 공통 `.agents/harness/ferrum-game-development.md`, 작업에 해당하는 consumer skill을 읽고 이후 게임 개발에 적용한다.

| 도구 | 진입 지침 | 설치 디렉터리 |
| --- | --- | --- |
| Codex | `AGENTS.md` | `.codex/agents/`, `.agents/skills/` |
| Claude | `CLAUDE.md` | `.claude/agents/`, `.claude/skills/`, `.agents/skills/` |
| Gemini | `GEMINI.md` | `.gemini/commands/`, `.agents/skills/` |

이 파일들은 게임 프로젝트용 지침이다. 엔진 저장소 루트의 `AGENTS.md`와 개발용 agent 설정을 게임 프로젝트에 복사하지 않는다. 현재 세션에서 도구가 새 설정을 자동 발견하지 못하면 진입 지침을 직접 읽고, 도구 재시작이 필요한 경우 그 사실을 알린다.

## 5. 설치와 게임 검증

```bash
npm run ferrum:report
npm run ferrum:check
npm run ferrum:deploy-report
```

- `ferrum:report`: 생성 프로젝트 구조와 `project.runtimeInputs`에서 실제 게임 입력 파일을 확인한다.
- `ferrum:check`: validation, asset, authoring, replay와 production build를 검사한다. 종료 코드 0과 check 보고서의 `status: "passed"`를 확인한다.
- `ferrum:deploy-report`: 종료 코드 0, `ok: true`, `deployment.status: "ready"`를 확인한다. production build, 정적 asset 경로, 실제 preview HTTP 응답과 Wasm MIME을 검사한다.

검사가 실패하면 `failedStep`, diagnostic, `nextCommand`를 읽고 원인을 해결한다. 검사를 건너뛰거나 replay fixture를 무조건 갱신해 성공으로 만들지 않는다. HTTP 배포 준비 검사 통과와 브라우저에서 직접 게임을 조작한 결과는 구분해 보고한다.

## 6. 개발 서버 실행과 완료 보고

```bash
npm run dev
```

이 명령은 계속 실행되는 서버다. 에이전트 도구의 지속 실행 세션으로 시작하고 로그에 출력된 실제 접속 URL을 확인해 사용자에게 알려준다. 사용 중인 포트에 따라 URL이 달라지므로 `5173`이라고 단정하지 않는다. `dist/index.html`을 `file://`로 여는 대신 HTTP 주소를 사용한다.

브라우저 도구가 있으면 게임 화면과 입력을 확인한다. 사용할 수 없으면 서버 기동·HTTP 확인 결과와 브라우저 조작 미검증 사실을 구분한다. 서버를 유지할 수 없는 도구라면 사용자가 실행할 명령과 작업 디렉터리를 알려준다.

완료 보고에는 다음을 포함한다.

- 프로젝트 절대 경로, 선택한 템플릿, 엔진 버전과 릴리스 URL
- AI 지침 설치 결과와 적용한 진입 지침
- 실행한 검증 명령과 성공·실패 결과, 미실행 항목과 사유
- 개발 서버 접속 URL과 유지 여부, 다음에 수정할 게임 파일

`topdown`의 게임 설정은 `public/game.json`, scene/behavior authoring은 `public/scene-authoring.json`, 브라우저 runtime 조립은 `src/main.ts`에서 시작한다. 이후 기능 개발은 생성된 지침과 [개발자 퀵스타트](developer-quickstart.md), [Public API](public-api.md)를 따른다. 공개 import는 `@ferrum2d/ferrum-web/core`, `.../authoring`, `.../starter-scenes` 등 목적별 경로를 사용한다.

## 재설치와 오류 대응

기존 게임 프로젝트는 생성기를 다시 실행하지 않는다. `package-lock.json`이 있으면 `npm ci`, 없다면 `npm install` 후 `ferrum:check`를 실행한다. 새 버전으로 업데이트하는 경우에는 [GitHub Release 설치·업데이트 절차](../development/operations/github-release.md)를 따른다.

| 증상 | 다음 조치 |
| --- | --- |
| `Target directory is not empty` | 숨김 파일을 포함한 기존 내용을 확인하고 빈 설치 대상을 선택한다. 자동 `--force` 사용 금지. |
| tarball 다운로드 404/접근 실패 | 위 고정 버전의 공개 릴리스와 파일명, GitHub 네트워크 접근을 확인한다. 임의 버전·npm 패키지로 대체하지 않는다. |
| `EALLOWREMOTE` | 프로젝트 `.npmrc`와 기존 정책을 확인한다. 직접 URL 설치가 허용된 환경에서는 `npm install --allow-remote=root`로 실행한다. |
| npm 12 이전 버전의 `allow-remote` 관련 경고 | 경고와 종료 코드를 구분한다. 이 설정을 모르는 구버전의 경고만으로 설치 실패를 단정하지 않는다. |
| `ferrum:check` 실패 | 첫 실패 단계의 진단과 권장 명령을 따라 수정하고 해당 검사부터 다시 실행한다. |
| 서버는 실행되지만 게임 화면이 나오지 않음 | 브라우저 console, asset/Wasm 요청과 WebGL2 지원을 확인하고 관찰한 오류를 보고한다. |
