# 배포 후속 계획

상태: 정적 웹 배포 계약 완료, desktop 제품 범위 결정 대기
기준일: 2026-08-21

이 문서는 완료된 정적 웹 배포 절차를 반복하지 않고, desktop packaging과 추가 hosting 지원 여부를
결정하기 위한 planning 기록이다. 현재 운영 계약은
[GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md),
[npm 패키지 구성 전략](../development/operations/npm-package-strategy.md), 생성 프로젝트 README가
기준이다.

## 확정된 배포 기준

Ferrum2D 게임의 기본 배포 모델은 Rust/Wasm + TypeScript production build를 HTTP(S) 정적 호스팅에
올리는 방식이다.

| 항목 | 상태 | 확정된 기준 |
| --- | --- | --- |
| Production build | 완료 | create-game template의 `vite build --base=./` |
| Local preview | 완료 | `npm run preview`; `file://` 직접 실행은 지원하지 않음 |
| Deploy readiness | 완료 | `npm run ferrum:deploy-report`로 상대 asset path, referenced file, preview HTTP와 Wasm MIME 검증 |
| Consumer browser smoke | 완료 | 가상 하위 경로, Playing 상태, WebGL2 pixel, runtime budget, Wasm MIME 검증 |
| GitHub Pages artifact | 완료 | `pnpm build:pages`, `pnpm validate:pages-artifact` |
| Placement Viewer desktop spike | 부분 완료 | Tauri host의 project/scene save, dialog, local asset protocol/reload, handoff sync |
| Packaged desktop app | 미진행 | 실제 `.app`/installer와 release gate 없음 |

정적 웹 계약이 이미 있으므로 다른 hosting provider나 desktop wrapper를 기본 제품 범위로 자동 확장하지
않는다.

## 남은 결정 순서

### 1. Desktop 범위 결정

먼저 desktop이 필요한 대상을 선택해야 한다.

| 선택지 | 의미 | 현재 판단 |
| --- | --- | --- |
| Authoring tool 전용 | Placement Viewer가 local project와 asset을 다루는 desktop host | 현재 Tauri spike와 가장 잘 맞음 |
| Generated game optional wrapper | consumer game을 desktop 앱으로 packaging | 별도 사용자 요구와 template/release 설계 필요 |
| Ferrum2D 전체 desktop 제품 | editor, game packaging, updater까지 포함 | 현재 범위 밖 |

범위를 선택하지 않은 상태에서는 Electron 비교, generated game desktop template, CI package gate를
구현하지 않는다.

### 2. Tauri packaged app 검증 승인

Authoring tool desktop 경로를 계속한다면 다음 slice는 실제 packaged app 검증이다.

최소 acceptance:

1. production frontend와 Wasm/JS/assets가 packaged app에서 로드된다.
2. project directory picker가 `public/scene-authoring.json`을 연다.
3. 명시적 save가 허용된 project path 안에서만 동작한다.
4. `ferrum-asset://` image가 올바른 MIME/CORS로 표시된다.
5. asset folder 변경 후 runtime texture와 handoff evidence가 갱신된다.
6. canvas가 nonblank이고 입력 가능한 실제 GUI window를 확인한다.
7. 실패 log 또는 screenshot artifact 기준을 정한다.

macOS notarization, Windows code signing, store 제출은 이 acceptance에 포함하지 않는다.

### 3. 추가 정적 hosting 지원

GitHub Pages 외 provider는 실제 사용자 요구가 확인될 때만 운영 문서를 추가한다. provider별로 검토할
차이는 다음으로 제한한다.

- base path 설정
- `.wasm` `application/wasm` MIME
- cache/header 정책
- SPA fallback과 정적 JSON/image/audio asset 경로

현재 상대 경로와 preview HTTP 검증으로 충분한 provider에는 전용 adapter를 만들지 않는다.

## Desktop 설계 경계

Desktop wrapper는 Ferrum2D core를 네이티브 렌더러로 바꾸는 기능이 아니다. production web runtime을
Tauri WebView 같은 host가 로드하고, 필요한 local file/asset capability만 최소 bridge로 제공한다.

- Rust core는 simulation과 render command 생성을 계속 소유한다.
- TypeScript frontend는 platform/authoring UI만 소유한다.
- file save는 선택된 project root 내부 allowlist를 벗어나지 않는다.
- browser-only production build에는 workspace write capability를 노출하지 않는다.
- local asset protocol은 path traversal, MIME, CORS를 검증한다.

## 제외 범위

- Electron과 Tauri를 동시에 제품화
- multiplayer/계정/랭킹/클라우드 저장 backend
- app store 제출 자동화
- notarization, code signing, Linux package repository
- offline cache/PWA를 desktop packaging과 함께 자동 도입
- visual editor 제품화

이 항목은 요구가 확인되면 별도 planning과 승인 절차로 분리한다.

## 다음 결정

다음 개발 전 필요한 결정은 하나다. Placement Viewer용 Tauri spike를 정식 authoring desktop 후보로
승격해 실제 packaged GUI 검증까지 진행할지 승인받는다. 승인하지 않으면 정적 웹 배포 계약을 기본값으로
유지하고 desktop 관련 코드는 spike 상태로 남긴다.
