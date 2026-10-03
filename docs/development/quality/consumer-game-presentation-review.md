# Consumer 게임 화면 지침 검수 — #59

검수일: 2026-10-03. 대상: [GitHub issue #59](https://github.com/silbaram/ferrum2d/issues/59), `fix/59-consumer-game-presentation`의 agents 지침 변경.

## 변경과 검토 결과

| 변경 파일/영역 | 이유 |
| --- | --- |
| `packages/agents/templates/shared/.agents/harness/ferrum-game-presentation.md` | 설치와 게임 제작 단계를 구분하고, 장르별 예외를 포함한 플레이 공간·카메라·HUD·에셋 설계 및 실제 브라우저 검수 기준을 한곳에서 관리한다. |
| 공유 game-development harness와 7개 consumer skill | 역할별 작업을 공통 기준으로 연결하고, 초기 설치에서 템플릿·게임 스크립트를 요구하던 문구를 제한한다. |
| Codex/Claude agent, Gemini command, agents CLI의 루트 지침 | 어느 도구로 시작해도 같은 기준에 도달하도록 한다. Claude wrapper는 기존 canonical skill 참조를 유지한다. |
| `scripts/package/check-agents-package.mjs` | 참조 누락, tarball 누락, 설치 시 게임 파일 생성, 재설치 시 사용자 지침 덮어쓰기를 회귀 검사한다. |
| consumer smoke 및 report validator/fixture | 설치된 공통 지침과 참조를 검사하고 기대 파일 수를 41개에서 42개로 동기화한다. |
| README와 smoke-check 문서 | 설치/게임 개발 구분, 기능 검증과 경험 검수의 차이, 기존 지침 업데이트 및 배포 상태를 설명한다. |

리뷰에서는 `ui: false`를 화면 레이아웃의 원인으로 취급하지 않는지, 설치 단계의 금지 조건이 다른 workflow의 템플릿/빌드 요구에 의해 무효화되지 않는지, 보드·카드·경영 등 장르에 탐험 화면을 강제하지 않는지 확인했다. Rust/Wasm, public API, 렌더러 동작과 기본 UI 설정은 변경하지 않았다.

### 추가 코드 리뷰와 수정

| 발견 사항 | 수정 및 확인 |
| --- | --- |
| 업데이트 문서는 비교·병합을 안내하지만 CLI는 기존 파일을 건너뛴 뒤 곧바로 `--force`를 권했다. | 기존 지침이 새 패키지와 다를 수 있음을 명시하고, 빈 디렉터리에 같은 도구 선택으로 설치한 뒤 비교·병합하도록 변경했다. 강제 교체의 범위도 설명한다. |
| 템플릿 조회의 주 명령이 npm registry를 가리키며 GitHub tarball 사용은 보충 설명에만 있었다. | 공유 harness의 Template Discovery를 GitHub Release URL과 `--allow-remote=root`가 포함된 실행 명령으로 통일하고 project skill/README는 이를 참조한다. 실제 공개 beta.0 패키지로 조회해 네 template catalog를 확인했다. |
| 새 디렉터리의 파일 목록 검사만으로는 빈 게임 디렉터리 생성이나 구형 지침과 게임 파일이 함께 있는 프로젝트의 보존을 검증하지 못했다. | 루트 디렉터리 allowlist와 기존 `package.json`·소스·데이터·managed block 전후 사용자 문구의 byte 보존, 기존 프로젝트 dry-run, 누락된 새 harness 추가 검사를 보강했다. |
| 포인터 매핑 지침을 넓게 해석하면 CSS 변환 후 bounding rect를 이용하는 정상 구현도 금지할 수 있었다. | 실제 카메라 변환을 반영하지 않는 매핑을 문제로 한정하고, 실제 클릭 도달로 판단하도록 수정했다. |

수정 후 `package:check:agents`, `smoke:consumer-smoke-report`, `lint`, `validate:docs-links`와 minimal tarball 설치/브라우저 smoke 및 report validator를 다시 실행해 통과했다. 로그는 `artifacts/issue59-review2-package-qa/`, 설치 보고서는 `artifacts/issue59-review2-consumer-smoke/consumer-smoke-report.json`에 있다. 실제 catalog 조회 결과는 `artifacts/issue59-review2-catalog/catalog.json`에 보존했다.

```bash
pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal --artifact-dir artifacts/issue59-review2-consumer-smoke
pnpm validate:consumer-smoke-report -- --report artifacts/issue59-review2-consumer-smoke/consumer-smoke-report.json --artifact-dir artifacts/issue59-review2-consumer-smoke --expect-status passed
ferrum_cli_url="https://github.com/silbaram/ferrum2d/releases/download/ferrum-web-v0.1.0-beta.0/ferrum2d-create-game-0.1.0-beta.0.tgz"
npx --yes --allow-remote=root "$ferrum_cli_url" --list-templates --json
```

추가한 package 검사도 제한된 환경에서 하위 프로세스 stdout이 비어 진단 문자열 assertion이 한 차례 실패했다. 동일 코드를 제한 밖에서 실행해 통과했고, 이후 QA 명령은 이 제약을 피한 환경에서 모두 통과했다. 최종 재검토에서 #59 변경 범위의 미해결 리뷰 지적은 없었다. 아래 기존 게임의 개선점과 미배포 상태는 별도 후속 작업으로 유지한다.

## 패키지·설치 검증

다음 명령이 통과했다. 패키지 QA 로그는 로컬 `artifacts/issue59-package-qa/`에 있으며, 문서 HTML 생성과 링크 검사도 로컬에서 확인했다.

```bash
pnpm package:check:agents
pnpm smoke:consumer-smoke-report
pnpm validate:docs-links
pnpm lint
pnpm build:pages
pnpm validate:pages-artifact
pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal --artifact-dir artifacts/issue59-consumer-smoke
pnpm validate:consumer-smoke-report -- --report artifacts/issue59-consumer-smoke/consumer-smoke-report.json --artifact-dir artifacts/issue59-consumer-smoke --expect-status passed
```

- 새 디렉터리에 agents를 설치하면 승인된 AI 설정/지침 42개만 생성된다. 게임 소스, HTML, 예제, package script는 생성하지 않는다. CLI는 서버를 실행하지 않는다.
- 설치된 template 내용이 원본과 일치하고, 사용자 문구를 추가한 루트 지침과 공통 harness는 재실행해도 보존된다. dry-run도 대상 디렉터리를 만들지 않는다.
- 실제 tarball 설치 후 Codex·Claude·Gemini의 참조와 public import/type/build/replay를 확인했다. 생성된 minimal 게임의 placement viewer와 배포 브라우저 검증도 통과했다. WebGL2 완료 프레임 12개, draw call 1/8, Wasm MIME 정상, 브라우저 오류 0건이었다.
- `smoke:consumer-smoke-report`는 제한된 실행 환경에서 validator 하위 프로세스의 진단 출력이 비어 두 차례 실패했다. 동일 명령을 제한 밖에서 실행하면 통과했다. 실패/재실행 로그를 보존했다.

설치-only 검사는 agents 설치의 파일 경계를 확인한다. minimal 게임 생성은 별도의 개발 회귀 검사이며 초기 설치 동작에 추가되지 않는다.

## 작은 섬 탐험 게임에 기준 적용

기존 로컬 작은 섬 게임의 소스/데이터 26개를 읽기 전용으로 복사하고 SHA-256 목록을 남겼다. 원본 게임은 수정하지 않았다. 사본에 새 consumer 지침을 설치하고 기준을 적용해 검수했다. 이 사본과 에셋은 엔진 패키지·초기 설치물에 포함되지 않는다.

- 엔진 패키지: 공개 `0.1.0-beta.0`. 기존 게임의 `ui: false`와 DOM 화면 구성을 유지했다.
- 실행 환경: Linux, Node 24.19.0, Vite 5.4.21, TypeScript 5.9.3, Chromium 148.0.7778.96 (`channel: chromium`, headless), DPR 1.
- URL: 검수 중 `http://127.0.0.1:21959/`. 검수 후 서버를 종료했다.
- viewport: desktop 1440×900, 좁은 화면 390×844. 키보드와 포인터를 실제 브라우저 이벤트로 입력했으며 게임 상태를 직접 조작하거나 순간이동하지 않았다.
- 한글 폰트가 없는 Linux 환경의 첫 캡처는 글자가 깨져 최종 증거로 사용하지 않았다. 최종 검수는 Windows의 로컬 맑은 고딕을 테스트 브라우저에만 제공했다. 게임 파일이나 패키지에 폰트를 추가하지 않았다. 원래 Google 웹폰트의 세부 타이포그래피 검수는 제외한다.

### 설계 관찰

장르는 2D 탐험이며 캐릭터를 움직여 네 장소를 조사하고 여섯 조개를 모은다. 첫 화면은 전체 섬 지도, 카드형 플레이 공간, 브랜드 헤더/소개문, desktop 상시 일지로 구성돼 있다. 확대 버튼은 1.65배 시야와 캐릭터 추적을 제공한다. 이 관찰은 기존 게임의 현재 구성을 설명하며, 해당 구성이 사용자 의도에 적합하다고 승인한 설계는 아니다.

### 기능 검증

사본에서 `npm run ferrum:check`가 통과했다. 내부의 authoring validation, runtime smoke, TypeScript/production build를 실행했다. runtime smoke는 여섯 조개의 도달·제거, 해안 충돌, pause/resume, reset을 확인했다. production JS가 500 kB를 넘는 Vite 경고는 남아 있다.

`node artifacts/issue59-island-review/review.mjs`로 아래 순서의 16개 동작/관측 기록과 8개 스크린샷을 생성했다. 브라우저 오류는 0건이었다.

1. 새 browser context에서 시작 화면을 캡처하고 탐험 시작 버튼을 누른다.
2. 시작 지점에서 `E`로 야영지를 조사하고 발견 이야기와 진행 증가를 확인한 뒤 닫는다.
3. 화면을 스크롤해 해변을 보이게 하고 월드 `(536, 730)`을 클릭해 첫 조개 수집과 피드백을 확인한다.
4. `D`를 300ms 눌러 이동을 확인하고 확대 후 `(640, 730)`을 클릭해 도달과 카메라 추적을 확인한다.
5. 390×844로 resize하고 `(680, 730)` 클릭 도달을 확인한다. 전체 지도 시야로 돌아와 `(700, 730)`에도 도달한다.
6. 일지를 열고 `D`를 400ms 누른 뒤 이동 여부를 기록한다. 일지를 닫고 `A`로 조작 복귀를 확인한다.
7. pause 상태에서는 `D`를 눌러도 좌표가 유지됨을 확인하고 resume한다.

### 플레이 경험 검수

기능 동작과 별도로 스크린샷을 열어 화면 구성을 검토했다. 아래 결과는 기존 게임에 대한 판정이며 지침 패키지의 검사 결과와 구분한다.

| 항목 | 결과 | 관측 및 남은 문제 |
| --- | --- | --- |
| 첫 화면·플레이 공간 | needs-revision | desktop 플레이 영역은 y=315부터 시작해 아래쪽이 viewport를 벗어난다. 소개문과 상시 일지가 큰 면적을 차지하며 시작 UI 일부를 보려면 스크롤해야 한다. |
| 실제 크기 가독성 | needs-revision | 좁은 화면의 플레이 영역은 약 364×243px, 전체 지도 캐릭터는 약 9.9×11.6px다. 확대해도 약 16.3×19.2px다. 캐릭터·목표와 작은 안내문을 읽기 어려워 탐험용 시야/레이아웃 재검토가 필요하다. |
| 이동·카메라 | pass (확인한 경로) | 키보드 이동과 걷기 피드백, 확대 중 추적 이동을 확인했다. 전체 지도 기본 시야의 적합성은 위 화면 문제에 포함한다. |
| 조사·수집 | pass (첫 장소/조개) | 이야기 패널, 발견 표시, 진행 10%→20%, 조개 1/6과 수집 toast가 즉시 보였다. 전체 콘텐츠의 경험 검수는 수행하지 않았다. |
| HUD·패널 입력 | needs-revision | 좁은 화면에서 일지가 플레이 공간을 가리지만 `D` 400ms 입력으로 x가 약 696→767로 이동한다. 가려진 게임의 입력 차단/일시정지 정책을 정해야 한다. 닫은 뒤 이동과 별도 pause/resume는 동작했다. |
| resize·zoom 좌표 | pass (클릭한 해변 경로) | 확대 전후와 resize 후 포인터 목표와 캐릭터의 도달 위치를 확인했다. resize 때 물리 장애물 전부를 대조한 것은 아니다. |
| 실제 터치·오디오·전체 환경 가림 | not-reviewed | desktop 브라우저의 viewport 변경과 키보드/포인터만 검수했다. 터치 기기, 오디오, 모든 전경/충돌 조합은 미검수다. |

일지 입력 문제를 확인한 뒤 공통 지침의 HUD 검수 항목을 포인터뿐 아니라 키보드, 이미 눌린 키와 남아 있는 이동 목표까지 포함하도록 보완했다.

### 로컬 증거 위치

- `artifacts/issue59-island-review/source-manifest.json`: 사본 소스 식별용 해시.
- `artifacts/issue59-island-review/functional-check.log`: 기존 게임의 기능 검증 로그.
- `artifacts/issue59-island-review/review.mjs`, `browser-report.json`: 재실행 가능한 로컬 조작 시나리오와 좌표/geometry 관측. 원본과 같은 게임 사본 및 위 환경이 필요하다.
- `artifacts/issue59-island-review/screenshots/01-desktop-start.png`부터 `08-narrow-resumed.png`까지: 시작, 조사, 수집, 확대, 좁은 화면, 일지, 재개 화면.
- `artifacts/issue59-consumer-smoke/consumer-smoke-report.json`: 패키지 검증 결과.

개인 게임의 소스와 스크린샷은 로컬 개발 증거로만 보존하고 저장소나 외부 서비스에 올리지 않는다.

## 미실행 범위와 후속 작업

- Rust/Cargo, `pnpm build`를 통한 전체 Wasm/예제 재빌드, 전체 template matrix는 실행하지 않았다. 변경이 consumer 지침과 검증 계약에 한정돼 기존 빌드 산출물과 minimal 설치 회귀로 확인했다.
- 도구별 설치 참조는 검증했지만 Codex·Claude·Gemini 각각에서 같은 프롬프트로 새 게임을 생성하는 비교 실험은 하지 않았다. 한 게임 검수로 모든 AI 결과의 개선을 보장하지 않는다.
- 기존 작은 섬 게임의 화면/입력 개선은 별도 consumer 게임 작업으로 남긴다. 이번 변경은 이 문제를 사전에 검토하고 완료 보고에서 드러내는 엔진 배포 지침의 보완이다.
- 기존 `0.1.0-beta.0` 원격 Release는 변경하지 않았다. 실제 설치에 보완된 지침을 제공하려면 새 agents 배포가 필요하다. 기존 프로젝트의 수정된 지침은 임시 디렉터리 설치 후 diff/병합한다.
