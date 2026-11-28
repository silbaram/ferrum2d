# GitHub Pages 데모/문서 배포

Ferrum2D의 browser demo와 문서 사이트 배포는 GitHub Pages workflow로 관리한다. 목적은 starter와 장르별 production build, `docs/**/*.md` 기반 HTML 문서를 한 artifact로 묶어 새 사용자가 브라우저에서 바로 확인할 수 있게 하는 것이다.

## 배포 대상

`pnpm build:pages`는 `pnpm build`가 만든 예제 사이트와 Studio를 `dist-pages/`로 복사하고, `docs/**/*.md`를 `dist-pages/docs/` HTML 문서 사이트로 렌더링한다.

| 경로 | 원본 |
| --- | --- |
| `/` | `examples/site/dist` · 예제 사이트([다시 만들기 계획](../../planning/example-site-rebuild-plan.md)) |
| `/docs/` | `docs/**/*.md` 기반 HTML 문서 사이트 |
| `/studio/` | `apps/studio/dist` |
| `/starter-runtime/`, `/physics-sandbox/`, `/breakout/`, `/platformer/`, `/topdown-shooter/`, `/pixel-art/` | 옛 예제 주소. 새 첫 화면(`../`)으로 보내는 안내 페이지 |

이전 예제 앱(기능 실험실·물리 심화 실험실·게임 데모 4개)은 공개하지 않고 엔진 검사 데이터로 남긴다. 사이트와 Studio의 production build는
`vite build --base=./`를 사용한다. GitHub Pages의 project subpath에서도 JS/CSS/Wasm asset을 상대 경로로 찾게 하기 위한 것이다.

## 문서 사이트 생성

문서 사이트는 별도 정적 사이트 generator 의존성을 두지 않고 `scripts/build/build-pages.mjs`에서 생성한다. 현재 지원 범위는 Ferrum2D 문서에 필요한 Markdown subset으로 제한한다.

- heading, paragraph, list, table, blockquote, fenced code block
- inline code, emphasis, link, image
- `*.md` 내부 링크를 대응하는 `*.html` 경로로 변환
- `docs/development/quality/screenshots/*` 같은 문서 asset 복사
- 뷰어의 한국어 subset WOFF2·OFL 라이선스·출처 정보를 `dist-pages/fonts/`에 복사하고, 중첩 문서에서 상대 경로로 참조. 한글 글꼴이 없는 환경에서도 외부 CDN 없이 표시한다.

문서 사이트의 기준 소스는 계속 `docs/**/*.md`다. `dist-pages/docs/`는 배포 artifact일 뿐 git에 포함하지 않는다.

기본 주소는 예제 사이트다. Pixelforge 편집기형 틀(상단 막대·예제 목록·가운데 화면·상태 막대)이며, 넓은 화면은 창 높이에 고정하고
패널마다 따로 스크롤하고, 900px 이하는 한 줄로 쌓고 예제 목록은 서랍으로 연다. 예제는 사이트 안의 모듈로 하나씩 추가해 `?example=<id>`로 연다.
첫 화면에는 지금까지 넣은 예제(스프라이트 그리기, 충돌과 트리거, 벽돌 깨기) 카드와 문서·Studio·이전 예제 코드(GitHub) 링크가 있다. 없는 예제 주소는 안내를 보인다.
스타일은 Studio와 같은 Pixelforge 토큰을 쓰고 외부 글꼴·CDN 없이 한국어 subset 글꼴과 Lucide 아이콘 일부(ISC)를 함께 발행한다.
상단에서 **한국어** 또는 **English**를 고를 수 있다. **문서**는 선택한 언어의 문서 지도(`/docs/` 또는 `/docs/en/`)로 이어진다.
문서 메뉴는 간단 사용법·AI 게임 개발을 먼저 구분하고, 공통 API 참조·공통 데이터/기능 참조·예제 계약·엔진 개발/검증·배포/운영·개발 계획/후보로 묶는다.
사이트는 배포한 개발 소스의 문서·예제이며 GitHub Release 설치 파일의 버전과 별개다.
사이트와 Studio의 `index.html`과 `head`를 출력 교체 전에 확인한다. 이 입력 검증 실패는 마지막 정상 `dist-pages`를 보존한다.
`pnpm test:pages-build`가 이 실패 경로와 첫 화면·Studio·옛 주소 안내를 검사하고, `pnpm smoke:example-site`가 빌드된 사이트를 브라우저로 검사한다.
간단 사용법과 현재 문서의 그룹을 기본으로 펼친다. `<details>`를 사용하므로 별도 JavaScript 없이
마우스와 키보드로 다른 그룹을 펼칠 수 있다. 새 문서는 경로에 따라 해당 그룹에 자동 포함된다.
모바일 상단에는 **본문으로 바로 가기**를 표시한다. 데스크톱에서도 첫 Tab으로 같은 링크를 사용할 수 있으며 본문으로 스크롤·키보드 초점을 옮긴다.
넓은 표는 키보드로도 접근 가능한 자체 가로 스크롤 영역에 표시해 모바일에서 문서 전체 폭이 늘어나지 않게 한다.

## 영문 문서

영문 Markdown은 `docs/en/`에 두며 한국어 문서와 같은 상대 경로·파일명을 사용한다.
`docs/en/README.md`는 `dist-pages/docs/en/index.html`로, 영문 엔진 문서는 `dist-pages/docs/en/engine/*.html`로 생성한다.

- 문서의 언어 전환에서 **English docs**로 영문 문서 지도를 연다.
- 문서 메뉴는 현재 언어의 문서만 표시하며 영문 페이지는 `lang="en"`과 영문 메뉴를 사용한다.
- 한국어·영문 대응 문서가 있으면 언어 전환과 `hreflang`이 같은 문서를 연결한다.
- 대응 번역이 없으면 **English docs**는 영문 문서 지도로 이동한다. 미번역 문서의 영문판이 있는 것처럼 표시하지 않는다.
- 영문 가이드의 미번역 상세 계약 링크는 **Korean**으로 표시한다. 문서 언어를 바꿔도 데모·뷰어의 UI 언어는 바꾸지 않는다.

현재 영문 범위는 문서 지도, 사용자 설명서, 퀵스타트, 기능·예제 안내, 공개 API 개요다.
한국어 문서의 사용 계약을 바꿀 때는 대응 영문 가이드도 함께 확인한다.

## 로컬 확인

```bash
pnpm build
pnpm build:pages
pnpm validate:pages-artifact
```

`pnpm validate:pages-artifact`는 진입 연결, docs index, AI 설치·기능 안내, Showcase Hub, quickstart, public API, Data Scene Authoring·공간 기반, Top-down Shooter Game Spec, Smoke Check, npm release 문서와 demo route HTML이 생성되었는지 확인하고 generated HTML의 로컬 링크를 검사한다. 한글 글꼴·라이선스·출처 파일의 포함도 요구한다. `dist-pages/`는 generated artifact이므로 git에 포함하지 않는다.

## Pages demo readiness checklist

Pages 배포 전에는 source 문서와 production demo artifact가 같은 기준을 통과해야 한다. 원격 배포는 수동 승인 후에만 실행한다.

| 항목 | 기준 | 확인 |
| --- | --- | --- |
| production build | Wasm package, packages, examples dist가 최신이다. | `pnpm build` |
| Pages artifact | 진입 연결, docs HTML, 7개 demo routes가 생성된다. | `pnpm build:pages` |
| route/link integrity | 주요 docs route와 generated HTML 로컬 링크가 깨지지 않는다. | `pnpm validate:pages-artifact` |
| artifact hygiene | `dist-pages/`는 generated output으로만 남고 커밋 대상이 아니다. | `git status --short --ignored dist-pages` |
| Starter Runtime route | `/starter-runtime/`의 `?feature=`가 독립 실험 31종을 제공한다. 이전 통합 게임은 `?mode=playground`, 사격 예제는 `?mode=starter`다. | `dist-pages/starter-runtime/index.html`, `pnpm smoke:feature-examples` |
| Top-down route | `/topdown-shooter/`가 공식 Game Spec 기반 demo를 제공한다. | `dist-pages/topdown-shooter/index.html` |
| Ferrum2D Studio route | `/studio/`가 Ferrum2D Studio 씬·에셋 편집 도구를 제공한다. | `dist-pages/studio/index.html` |
| Physics Sandbox route | `/physics-sandbox/`가 Physics Spec scenario catalog와 debug overlay를 제공한다. | `dist-pages/physics-sandbox/index.html` |
| Breakout route | `/breakout/`가 두 번째 장르 runtime/render path를 제공한다. | `dist-pages/breakout/index.html` |
| Platformer route | `/platformer/`가 platformer controller demo를 제공한다. | `dist-pages/platformer/index.html` |
| Pixel Art route | `/pixel-art/`가 도트 원본·native 이동/수집·조명/팔레트/효과 비교를 제공한다. | `dist-pages/pixel-art/index.html`, `pnpm smoke:pixel-showcase` |
| rendering-sensitive change | renderer/input/assets/audio/example behavior가 바뀐 경우 관련 browser smoke를 실행한다. | `pnpm smoke:browser`, `pnpm smoke:topdown`, `pnpm smoke:studio`, `pnpm smoke:physics-sandbox`, `pnpm smoke:breakout`, `pnpm smoke:platformer` 중 변경 표면에 맞게 선택 |

## GitHub Actions

`.github/workflows/pages.yml`의 **Pages 배포는 수동 실행(`workflow_dispatch`) 전용**이다.
`CI`의 기본 검증은 `main` 대상 PR과 수동 실행에서 돌아간다.
`Language boundaries`는 PR 생성·갱신과 `main` push에서 Rust/TypeScript 책임 경계·Wasm ABI·SDK 회귀를 자동 검증한다.
자동 검증의 성공은 Pages 배포 완료를 뜻하지 않는다.

문서 변경이 `main`에 병합되고 배포 승인을 받으면 Actions UI에서 `Pages` workflow의 `main`을 선택해 실행한다.
로컬 소스와 원격 배포가 같은 버전인지 보려면 workflow의 `headSha`를 확인하고, 성공 후 공개 URL을 다시 연다.

1. Rust stable과 `wasm32-unknown-unknown` target을 설정한다.
2. `wasm-pack`과 pnpm dependencies를 설치한다.
3. `pnpm build`로 Wasm package와 모든 예제를 빌드한다.
4. `pnpm build:pages`로 demo dist와 docs HTML을 포함한 `dist-pages/` artifact를 만든다.
5. `actions/upload-pages-artifact`와 `actions/deploy-pages`로 GitHub Pages에 배포한다.
6. 배포 직후 `page_url` 기준 `/`, `/docs/`, `/docs/engine/public-api.html`, `/starter-runtime/`, `/topdown-shooter/`, `/studio/`, `/physics-sandbox/`, `/breakout/`, `/platformer/`, `/pixel-art/` route를 `curl --fail`로 확인한다.

이 workflow는 build·artifact 검증·배포·공개 route 확인을 담당한다.
PR 자동 검증은 `CI`의 기본 gate(`validate`, `validate-rust`, `validate-wasi`, `validate-studio-desktop`)와 `Language boundaries`가 담당한다.
선택형 브라우저·패키지 검사는 [Smoke Check](../quality/smoke-check.md)의 수동 입력과 태그 ref 조건을 따른다.
