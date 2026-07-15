# __PROJECT_TITLE__

Ferrum2D `create-game`으로 생성한 정적 웹 게임 프로젝트다.

## 개발

```bash
npm install
npm run dev
```

## 검증

```bash
npm run ferrum:report
npm run ferrum:validate
npm run ferrum:smoke
```

`ferrum:smoke`는 프로젝트 계약을 검증하고 production build를 생성한다.

## 배포 준비 확인

```bash
npm run ferrum:deploy-report
```

이 명령은 production build를 다시 만든 뒤 `ferrum2d.consumer.deploy-readiness.report` JSON을 출력한다. 다음 조건이 모두 맞아야 `ok: true`, `deployment.status: "ready"`가 된다.

- `dist/index.html`이 존재한다.
- HTML entry와 정적으로 판별 가능한 `fetch(...)`, `new URL(..., import.meta.url)`, CSS `url(...)` asset reference가 상대 base path를 사용한다.
- HTML `<base>` 요소는 사용하지 않으며, 상대 `fetch(...)`가 있으면 모든 HTML entry가 같은 디렉터리에 있어 document base가 모호하지 않다. 위반 시 각각 `FERRUM_DEPLOY_HTML_BASE_UNSUPPORTED`, `FERRUM_DEPLOY_FETCH_BASE_AMBIGUOUS`로 실패한다.
- build가 만든 HTML, JavaScript, CSS, Wasm과 asset 파일을 localhost의 가상 하위 경로에서 모두 읽을 수 있다.
- 생성 프로젝트의 실제 `preview` 명령을 localhost 임시 포트에서 실행하고, 이 서버가 정상 응답하며 Wasm을 `application/wasm`으로 제공하는지 판정한다.

로컬에서 production 결과를 직접 확인하려면 다음 명령을 사용한다.

```bash
npm run preview
```

브라우저에서 출력된 localhost URL을 연다. `dist/index.html`을 더블클릭하는 `file://` 실행은 Wasm, ES module, `fetch(...)`, MIME 정책 차이 때문에 지원하지 않는다.

`ferrum:deploy-report`는 배포 준비 상태를 검증할 뿐 GitHub Pages, Cloudflare Pages, Netlify 같은 외부 서비스에 파일을 업로드하지 않는다. `dist/`를 정적 호스팅에 올릴 때는 호스팅 서비스가 `.wasm`을 `application/wasm`으로 제공하고 프로젝트의 상대 asset path를 보존하는지 확인한다.
