# 첫 게임 실행하기

한국어 · [English](../en/engine/developer-quickstart.md)

이 안내에서는 **탑다운 슈팅 게임을 만들고, 실행한 뒤, 캐릭터 이동 속도를 바꿔봅니다.**
AI에게 작업 전체를 맡기려면 [AI 게임 개발 안내](ai-game-development.md)를 전달하세요.

## 1. 설치 파일 준비

Node.js 22와 npm이 필요합니다. 게임 프로젝트에는 Rust나 wasm-pack을 따로 설치하지 않아도 됩니다.
[GitHub Releases](https://github.com/silbaram/ferrum2d/releases)에서 사용할 버전을 선택하고,
Assets의 **`ferrum2d-create-game-<버전>.tgz`** 다운로드 링크를 복사하세요.
설치 방법은 선택한 릴리스의 안내를 기준으로 합니다.

아래 명령은 Bash·WSL·macOS 터미널 예시입니다. PowerShell에서는 URL을 `npx` 명령에 직접 넣어도 됩니다.

```bash
ferrum_cli_url="<복사한 create-game .tgz 다운로드 URL>"
npx --yes --allow-remote=root "$ferrum_cli_url" my-game --template topdown
cd my-game
npm install
```

성공하면 `my-game` 폴더에 게임 코드와 설정이 생성됩니다. 설치 출처와 재설치 방법은 폴더 안의 `FERRUM_INSTALL.md`에 있습니다.

## 2. 게임 실행

```bash
npm run dev
```

터미널에 표시된 로컬 주소를 브라우저에서 여세요. 현재 템플릿은 게임이 자동으로 시작됩니다.
시작 화면이 표시되는 버전에서는 **Start**를 누르세요.

| 조작 | 결과 |
| --- | --- |
| W/A/S/D | 캐릭터 이동 |
| 마우스 이동 | 조준 방향 변경 |
| 마우스 왼쪽 버튼 또는 Space | 발사 |

이 템플릿은 기능을 추가하며 시작할 수 있는 작은 게임입니다. 웹사이트의 꾸며진 슈터 예제와 화면이 다를 수 있습니다.
서버는 터미널의 `Ctrl+C`로 종료합니다.

## 3. 이동 속도 바꾸기

`my-game/public/game.json`을 열고 `player` 안의 `speed` 값을 찾아 `280`으로 바꿉니다.
아래는 바꿀 부분만 보여줍니다. 파일의 다른 설정은 유지하세요.

```json
"player": {
  "speed": 280
}
```

저장한 뒤 브라우저를 새로고침하세요. 시작 화면이 나타나면 **Start**를 누르세요.
기본 템플릿의 `210`보다 빠르게 이동하는지 확인합니다.
설정을 확인하려면 새 터미널에서 `my-game` 폴더로 이동해 실행합니다.

```bash
npm run ferrum:validate
```

다른 설정을 바꾸고 싶으면 AI에게 원하는 플레이를 설명하거나 [슈터 설정 참조](../examples/topdown-shooter/game-spec.md)를 확인하세요.

## 4. AI에게 이어서 맡기기

GitHub Release로 생성한 프로젝트에서 AI 지침을 설치합니다.

```bash
npm run ferrum:agents
```

AI가 프로젝트 폴더와 [AI 게임 개발 안내](ai-game-development.md)를 읽게 한 뒤 요청하세요.

```text
이 프로젝트의 이동 속도를 280으로 바꿨어.
원하는 변경이 맞는지 확인하고 전체 검증을 진행해줘.
리플레이 기준이 달라졌다면 차이를 확인한 뒤 필요한 기준만 갱신해줘.
실행 방법과 직접 확인할 내용을 알려줘.
```

전체 검증은 `npm run ferrum:check`입니다. 게임 동작을 바꾸면 이전 리플레이 기대값과 달라질 수 있습니다.
AI가 원인을 확인하고 변경 의도와 대조하도록 하세요.

## 다음에 할 일

| 하고 싶은 일 | 방법 |
| --- | --- |
| 씬과 에셋을 눈으로 확인 | [Studio 간단 사용법](user-guide.md#studio에서-씬을-바꿔보기) |
| 다른 장르로 시작 | 생성 명령의 `--template topdown`을 `platformer`, `breakout`, `minimal`로 변경 |
| 배포용 결과 확인 | `npm run ferrum:deploy-report` 후 `npm run preview`로 표시된 주소 열기 |
| 기능 찾아보기 | [기능과 예제](showcase-hub.md) |

`minimal`도 실행 가능한 예제입니다. 게임 코드를 만들지 않고 환경만 준비하려면 [AI 설치 지침](ai-agent-install.md)을 사용하세요.

생성 프로젝트의 경량 Studio는 현재 소스에서 `npm run ferrum:studio`로 엽니다.
공개 beta.9 이하에서는 `ferrum:placement-viewer` 이름을 사용하므로, 설치한 프로젝트의 `package.json`과 안내를 따르세요.
독립 Studio 앱과 경량 페이지는 제공하는 기능이 다릅니다.
