# Ferrum2D 배포 전략 초기 계획

이 문서는 Ferrum2D 게임을 개발한 뒤 사용자에게 전달하는 배포 방식에 대한 초기 논의를 정리한다. 아직 확정된 운영 계약이 아니라 planning 문서이며, 실제 사용법과 검증 기준이 확정되면 `docs/engine` 또는 `docs/development/operations` 문서로 옮긴다.

## 결론

Ferrum2D의 기본 배포 모델은 **정적 웹 게임 배포**다.

- 개발 중에는 Vite dev server를 사용한다.
- 배포 시에는 production build로 생성된 `dist/` 정적 파일을 HTTP(S) 정적 호스팅에 올린다.
- 멀티플레이어, 계정, 서버 저장, 랭킹 같은 기능이 없으면 별도 게임 백엔드는 필요 없다.
- 사용자가 "앱처럼 더블클릭 실행"하는 경험이 필요하면 Electron/Tauri 같은 desktop wrapper를 별도 배포 옵션으로 검토한다.

즉, Ferrum2D core를 네이티브 앱으로 바꾸는 것이 아니라, **Rust/Wasm + TypeScript 웹 런타임 산출물을 어떤 형태로 포장하고 검증할지**가 배포 전략의 핵심이다.

## 배포 방식 후보

| 방식 | 목적 | 장점 | 단점 | 초기 판단 |
| --- | --- | --- | --- | --- |
| 정적 웹 배포 | 일반 사용자에게 URL로 게임 제공 | 가장 단순하고 Ferrum2D 구조와 잘 맞음 | 호스팅과 `.wasm` MIME/base path 검증 필요 | P0 기본 경로 |
| 로컬 정적 서버 실행 | 배포판을 내려받아 localhost에서 실행 | `file://` 문제를 피하면서 단순함 | 사용자가 서버 명령을 실행해야 함 | P1 보조 경로 |
| Electron wrapper | 데스크톱 앱처럼 배포 | 구현이 쉽고 웹 런타임 재사용 가능 | 앱 크기가 큼, 보안 설정/패키징 필요 | P2 실험 후보 |
| Tauri wrapper | 작은 데스크톱 앱 배포 | Electron보다 작고 OS 통합이 좋음 | 설정과 플랫폼별 빌드가 더 까다로움 | P2 비교 후보 |
| `file://` 직접 실행 | 더블클릭 실행 | 가장 단순해 보임 | Wasm, ES module, asset fetch, MIME 문제로 불안정 | 비권장 |

## 논의 내용

### 개발 서버와 배포 서버는 다르다

`pnpm dev:topdown` 같은 명령은 개발용이다. hot reload와 빠른 확인을 위한 Vite dev server이며, 사용자가 플레이하는 운영 배포 방식으로 보지 않는다.

배포 시에는 예제 또는 생성된 게임 프로젝트에서 production build를 만들고, 결과물을 정적 파일로 서빙한다.

```bash
pnpm --filter @ferrum2d/topdown-shooter build
```

생성된 `dist/`는 `.html`, `.js`, `.wasm`, 이미지, 오디오, JSON asset으로 구성된다.

### 정적 웹 호스팅이 1순위다

정적 웹 배포는 다음 호스팅에 올릴 수 있다.

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel
- S3 + CloudFront
- Nginx/Apache 정적 서버
- 자체 CDN

검증해야 할 핵심은 다음이다.

- `.wasm`이 `application/wasm`으로 서빙되는가?
- base path가 GitHub Pages 하위 경로에서도 깨지지 않는가?
- JS chunk, Wasm, 이미지, 오디오, JSON asset 경로가 production build에서 모두 로드되는가?
- browser smoke가 실제 HTTP(S) 또는 localhost 정적 서버에서 통과하는가?

### 로컬 배포판은 `file://`보다 localhost가 안전하다

`dist/index.html`을 더블클릭해 `file://`로 여는 방식은 비권장이다. 브라우저 보안 정책과 MIME 처리 때문에 다음 문제가 생길 수 있다.

- `.wasm` 로딩 실패
- ES module import 실패
- JSON/image/audio `fetch` 실패
- 브라우저별 동작 차이

로컬 실행이 필요하면 작은 정적 서버를 쓰는 방식을 문서화한다.

```bash
python3 -m http.server 8000 -d dist
```

```text
http://localhost:8000
```

또는 Node 기반 preview/serve 명령을 create-game template에 포함할 수 있다.

### Desktop wrapper는 별도 포장 계층이다

Electron/Tauri 배포는 Ferrum2D 엔진 코드를 네이티브로 바꾸는 일이 아니다. production web build 결과물을 데스크톱 앱 안에 포함하고, 앱 shell이 Chromium/WebView를 통해 로드하는 방식이다.

예상 구조:

```text
game project
  dist/
    index.html
    assets/*.js
    assets/*.wasm
    assets/*

desktop wrapper
  Electron 또는 Tauri shell
  dist를 app resource로 포함
```

Electron에서 `file://`로 바로 로드하면 웹 배포와 비슷한 asset/MIME 문제가 다시 생길 수 있다. 안정적인 방향은 다음 중 하나다.

- custom protocol, 예: `app://...`
- 앱 내부 정적 서버
- wrapper가 제공하는 asset protocol

보안 기본값은 다음을 기준으로 한다.

- `nodeIntegration: false`
- `contextIsolation: true`
- 게임 runtime과 Node API 직접 연결 금지
- preload API는 필요한 경우 최소 surface만 제공

## 구현 Slice

현재 상태:

- **Slice 0 완료**: GitHub Pages 데모/문서 배포 기준은 [GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md)로 확정했다. 이 planning 문서는 남은 로컬 preview, create-game 배포 안내, desktop wrapper 후보만 추적한다.
- **Slice 1 완료**: 모든 create-game template은 `vite build --base=./` 기반 `build`, `vite preview` 기반 `preview`, generated README의 `file://` 비지원 안내를 제공한다. `ferrum:deploy-report`는 HTML과 정적으로 판별 가능한 runtime/CSS asset 경로와 asset HTTP status를 가상 하위 경로에서 검사하고, 생성 프로젝트의 실제 `preview` 명령으로 index HTTP와 Wasm MIME을 machine-readable report로 검증한다. HTML `<base>`와 여러 디렉터리 HTML entry에서 기준 문서를 확정할 수 없는 상대 literal `fetch(...)`는 구조화된 진단으로 거부하며, preview MIME/절대 runtime path를 포함한 음성 fixture를 유지한다.
- **Slice 2 완료**: generated project report는 `project.deployment`와 deploy recommended command를 제공한다. consumer smoke는 `ferrum:deploy-report`를 파싱하고 실제 `dist/index.html`을 Chromium 가상 하위 경로에서 열어 Wasm MIME, Playing 상태, 엔티티·sprite·render command 규모와 배경색 외 WebGL2 픽셀을 검증한다. draw call은 완료된 renderer frame 정확히 12개에서 최대값을 집계해 등록된 template runtime budget profile과 비교하며 physics debug와 post-process 비용도 포함한다. pixel readback은 production `preserveDrawingBuffer` 없이 12번째 frame 뒤 같은 RAF에서 수행한다.
- **Slice 3 부분 완료**: `apps/placement-viewer-desktop` Tauri spike는 공식 placement viewer frontend를 desktop window에서 열고 project/scene document open·save, native file/folder dialog, asset folder inspect, `ferrum-asset://` custom protocol, runtime texture 등록·reload, handoff sync까지 구현했다. `pnpm smoke:placement-viewer-desktop-assets`가 browser-side desktop bridge 계약을 검증한다. 실제 packaged `.app`, Top-down Shooter wrapper, Electron 비교는 아직 진행하지 않았다.
- **Slice 4 미진행·승인 필요**: desktop app packaging과 CI/release gate 편입은 외부 배포 범위를 확정한 뒤 진행한다.

### Slice 0: 정적 웹 배포 기준 문서화 (완료)

확정 문서: [GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md)

산출물:

- GitHub Pages 기준 데모/문서 배포 가이드 작성
- `.wasm` MIME, base path, asset 경로 체크리스트 작성
- Pages artifact 생성/검증 기준 문서화

검증:

- `pnpm build`
- `pnpm build:pages`
- `pnpm validate:pages-artifact`
- route/link integrity 검증

### Slice 1: 로컬 preview 경로 정리 (완료)

산출물:

- production `dist/`를 localhost에서 실행하는 명령 문서화
- `file://` 직접 실행 비권장 사유 문서화
- create-game template README에 preview 명령 포함 여부 결정

검증:

- 정적 서버로 `dist/` 서빙 후 browser smoke
- asset/Wasm 로딩 실패 시 machine-readable 오류를 남기는 smoke 보강

### Slice 2: create-game 배포 안내 (완료)

산출물:

- 생성 프로젝트 README에 build/preview/deploy 흐름 추가
- agent가 배포 전 확인할 checklist와 recommended commands 추가
- consumer report에 build output, deploy readiness, browser runtime sampling/budget evidence 포함

검증:

- `pnpm package:consumer-smoke`
- create-game template report smoke
- generated game production build smoke

### Slice 3: Desktop wrapper 비교 spike (Tauri placement viewer 부분 완료)

산출물:

- Electron vs Tauri 비교 문서
- monorepo 내부 example wrapper로 둘지, create-game optional template로 둘지 결정
- `app://` custom protocol 또는 internal static server 중 하나를 실험
- Top-down Shooter `dist/`를 wrapper에 포함해 앱 실행 확인

검증:

- macOS local packaged app smoke
- 앱 내부에서 `.wasm`, JS chunk, JSON/image/audio asset 로딩 확인
- 기본 보안 설정 검토

### Slice 4: Desktop package smoke 자동화 후보

산출물:

- Electron/Tauri 중 선택된 wrapper의 packaged app smoke script 후보
- CI에서 실행할지, 수동 release gate로 둘지 결정
- screenshot 또는 log artifact 기준 정의

검증:

- packaged app boot
- canvas nonblank
- Wasm loaded
- input start 가능
- asset load complete

## 제외 범위

초기 배포 계획에서 다음은 제외한다.

- Ferrum2D core를 네이티브 렌더러로 재작성
- 멀티플레이어 서버
- 계정/랭킹/클라우드 저장 백엔드
- 앱스토어 제출 자동화
- macOS notarization, Windows code signing, Linux package repository 운영
- offline cache/PWA 전략
- visual editor 배포 제품화

이 항목들은 필요하면 별도 planning 문서와 승인 절차로 분리한다.

## 열린 질문

- placement viewer용 Tauri spike를 정식 desktop 배포 후보로 승격할 것인가?
- desktop wrapper를 authoring tool에만 한정할 것인가, generated game optional template까지 확장할 것인가?
- 실제 packaged `.app` GUI 검증을 수동 release gate로 둘 것인가, 자동 smoke로 승격할 것인가?
- GitHub Pages 외에 공식 문서에서 우선 지원할 정적 호스팅은 무엇인가?
- generated game의 base path 설정을 agent가 안전하게 조정하는 helper가 필요한가?

## 다음 작업 추천

다음 작업은 완료된 정적 웹 배포 계약과 Tauri spike를 기준으로 남은 범위를 좁힌다.

1. Tauri placement viewer의 실제 GUI/package 검증을 release 범위에 넣을지 승인받는다.
2. GitHub Pages 외에 공식 지원할 정적 호스팅이 필요하면 provider별 base path/헤더 차이만 별도 운영 문서로 확정한다.
3. generated game의 비루트 base path 요구가 확인되면 기존 상대 경로 검증 위에 agent용 설정 helper를 추가할지 판단한다.
4. Electron 비교나 generated game desktop template은 Tauri 결과로 해결되지 않는 요구가 확인될 때만 별도 spike로 연다.
