# __PROJECT_TITLE__

Ferrum2D `create-game`으로 생성한 정적 웹 게임 프로젝트다.

## 개발

```bash
npm install
npm run dev
```

GitHub Release 생성기로 만든 프로젝트는 `FERRUM_INSTALL.md`에서 엔진 버전과 설치 출처를 확인한다. AI 개발 지침은 선택적으로 `npm run ferrum:agents`를 실행해 설치한다. 생성된 `package-lock.json`을 버전 관리에 포함하면 `npm ci`로 같은 의존성을 재설치할 수 있다.

## 검증

```bash
npm run ferrum:check
```

`ferrum:check`는 project/spec validation, asset validation, Scene Authoring report, gameplay/runtime
replay fixture와 production build를 순서대로 확인한다. 결과는
`ferrum2d.consumer.check.report` JSON이며, 실패하면 첫 실패 단계와 다음 실행 명령을 알려준다.
세부 진단이 필요하면 `npm run ferrum:report`, `npm run ferrum:validate`,
`npm run ferrum:authoring-report`, `npm run ferrum:replay-report`,
`npm run ferrum:runtime-replay-report`를 개별 실행한다.

## Runtime 입력과 Scene Authoring

`npm run ferrum:report`의 `project.runtimeInputs`가 이 템플릿의 gameplay 구성 source와
`starter-scenes` runtime 구현, browser bootstrap, authoring fixture의 역할을 구분한다. `public/scene-authoring.json`은 Placement
Viewer, validation, patch/handoff의 입력이자 built-in starter runtime의 위치·Behavior Recipe source다.
생성 프로젝트의 저빈도 scene adapter가 첫 Playing frame과 명시적 reset 뒤에 이 문서를 현재 built-in
entity handle에 적용한다. built-in adapter는 위치와 Behavior Recipe만 지원하며, Data Scene visual/collider
component는 generic Data Scene runtime 계약을 사용해야 한다. health/lifetime/pickup-despawn/
collision-despawn처럼 scene-owned entity 수명을 깨뜨릴 수 있는 recipe command는 preflight diagnostic으로
거부된다.

generated Placement Viewer의 `Apply Memory`는 draft를 현재 viewer session에만 적용한다. 프로젝트의
`public/scene-authoring.json`을 쓰지 않으므로 파일 반영에는 `Copy Patch`/`Copy Handoff` 결과를 사용한다.

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

## 도트 제작 검증

도트 작업은 `.agents/skills/ferrum-consumer-pixel-art/SKILL.md`를 참고한다. `public/assets/pixel-art.profile.json`을 두면 기존 `ferrum:asset-validate`와 `ferrum:check`가 도트 PNG도 검사한다.
명시적으로 요구하려면 `npm run ferrum:asset-validate -- --profile pixel-art`를 사용한다. 파일이 없으면 실패한다.

```json
{
  "format": "ferrum2d.consumer.pixel-art-profile",
  "version": 1,
  "scale": 3,
  "filter": "nearest",
  "palette": ["#00000000", "#ffffffff"],
  "assets": [{"source": "public/assets/hero.png", "tileWidth": 16, "tileHeight": 16}]
}
```

실제 파일·색상·배율을 적는다. 최대64자산, 프로필64 KiB, PNG 한 변2048px·16 MiB·비인터레이스 RGBA8를 지원한다.
일반 파일과 프로젝트 안의 심볼릭 링크를 읽으며 FIFO 같은 특수 파일·검사 중 교체된 파일은 진단한다.
경로와 열린 파일의 동일성을 검사하지만, 검증 중 프로젝트 루트·상위 폴더를 악의적으로 계속 교체하는 환경의 보안 sandbox는 아니다.
팔레트는1~256개 `#RRGGBBAA`이며 자산별 `palette`로 대체할 수 있다. 투명 RGB까지 실제 픽셀과 대조한다.
기본은 PNG 치수가 tile 치수의 배수인지 검사한다. 여백 atlas는 자산별 `atlas:{padding:1,extrude:1,frames:[{x:1,y:1,width:16,height:16}]}`로 content rect를 지정한다.
정수 rect·범위·중첩·타일 치수·실제 가장자리 복제 픽셀을 확인한다. padding은 각 rect 사방의 예약 여백이며 PNG 밖으로 나가거나 다른 rect의 예약 여백과 겹치면 실패한다. 팔레트 검사는 content rect 안만 대상으로 한다.
프로필의 정수 scale(1~16)·nearest 선언은 제작 의도다. 실행 중 renderer 설정을 읽지 않으므로 report의 `runtimeVerified`는 false이며 실제 게임은 별도 `ferrum:smoke`와 화면 비교로 확인한다.
오류는 JSON report의 `assetPipeline.reports[]`에 `FERRUM_PIXEL_*` 코드와 경로로 기록되고 종료코드는1이다. 원본·PNG·manifest를 수정하지 않는다.
