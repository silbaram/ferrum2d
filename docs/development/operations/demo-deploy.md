# GitHub Pages 데모/문서 배포

Ferrum2D의 browser demo와 문서 사이트 배포는 GitHub Pages workflow로 관리한다. 목적은 starter와 장르별 production build, `docs/**/*.md` 기반 HTML 문서를 한 artifact로 묶어 새 사용자가 브라우저에서 바로 확인할 수 있게 하는 것이다.

## 배포 대상

`pnpm build:pages`는 `pnpm build`가 만든 예제 dist를 `dist-pages/` 아래로 복사하고, `docs/**/*.md`를 `dist-pages/docs/` HTML 문서 사이트로 렌더링한다.

| 경로 | 원본 |
| --- | --- |
| `/` | Pages home: 데모와 문서 진입점 |
| `/docs/` | `docs/**/*.md` 기반 HTML 문서 사이트 |
| `/starter-runtime/` | `examples/starter-runtime/dist` |
| `/topdown-shooter/` | `examples/topdown-shooter/dist` |
| `/breakout/` | `examples/breakout/dist` |
| `/platformer/` | `examples/platformer/dist` |

예제 package의 production build는 `vite build --base=./`를 사용한다. 이 설정은 GitHub Pages의 project subpath에서도 JS/CSS/Wasm asset을 상대 경로로 찾게 하기 위한 것이다.

## 문서 사이트 생성

문서 사이트는 별도 정적 사이트 generator 의존성을 두지 않고 `scripts/build/build-pages.mjs`에서 생성한다. 현재 지원 범위는 Ferrum2D 문서에 필요한 Markdown subset으로 제한한다.

- heading, paragraph, list, table, blockquote, fenced code block
- inline code, emphasis, link, image
- `*.md` 내부 링크를 대응하는 `*.html` 경로로 변환
- `docs/development/quality/screenshots/*` 같은 문서 asset 복사

문서 사이트의 기준 소스는 계속 `docs/**/*.md`다. `dist-pages/docs/`는 배포 artifact일 뿐 git에 포함하지 않는다.

## 로컬 확인

```bash
pnpm build
pnpm build:pages
pnpm validate:pages-artifact
```

`pnpm validate:pages-artifact`는 Pages 홈, docs index, quickstart, public API, Data Scene Authoring, Top-down Shooter Game Spec, Smoke Check, npm release 문서와 demo route HTML이 생성되었는지 확인하고 generated HTML의 로컬 링크를 검사한다. `dist-pages/`는 generated artifact이므로 git에 포함하지 않는다.

## Pages demo readiness checklist

Pages 배포 전에는 source 문서와 production demo artifact가 같은 기준을 통과해야 한다. 원격 배포는 수동 승인 후에만 실행한다.

| 항목 | 기준 | 확인 |
| --- | --- | --- |
| production build | Wasm package, packages, examples dist가 최신이다. | `pnpm build` |
| Pages artifact | Pages home, docs HTML, four public demo routes가 생성된다. | `pnpm build:pages` |
| route/link integrity | 주요 docs route와 generated HTML 로컬 링크가 깨지지 않는다. | `pnpm validate:pages-artifact` |
| artifact hygiene | `dist-pages/`는 generated output으로만 남고 커밋 대상이 아니다. | `git status --short --ignored dist-pages` |
| Starter Runtime route | `/starter-runtime/`가 WebGL2 기본 runtime demo를 제공한다. | `dist-pages/starter-runtime/index.html` |
| Top-down route | `/topdown-shooter/`가 공식 Game Spec 기반 demo를 제공한다. | `dist-pages/topdown-shooter/index.html` |
| Breakout route | `/breakout/`가 두 번째 장르 runtime/render path를 제공한다. | `dist-pages/breakout/index.html` |
| Platformer route | `/platformer/`가 platformer controller demo를 제공한다. | `dist-pages/platformer/index.html` |
| rendering-sensitive change | renderer/input/assets/audio/example behavior가 바뀐 경우 관련 browser smoke를 실행한다. | `pnpm smoke:browser`, `pnpm smoke:topdown`, `pnpm smoke:breakout`, `pnpm smoke:platformer` 중 변경 표면에 맞게 선택 |

## GitHub Actions

`.github/workflows/pages.yml`은 수동 실행(`workflow_dispatch`)에서만 동작한다. 일반 `main` push는 `CI` workflow만 실행하며, Pages 배포가 필요한 시점에 Actions UI에서 `Pages` workflow를 명시적으로 실행한다.

1. Rust stable과 `wasm32-unknown-unknown` target을 설정한다.
2. `wasm-pack`과 pnpm dependencies를 설치한다.
3. `pnpm build`로 Wasm package와 모든 예제를 빌드한다.
4. `pnpm build:pages`로 demo dist와 docs HTML을 포함한 `dist-pages/` artifact를 만든다.
5. `actions/upload-pages-artifact`와 `actions/deploy-pages`로 GitHub Pages에 배포한다.
6. 배포 직후 `page_url` 기준 `/`, `/docs/`, `/docs/engine/public-api.html`, `/starter-runtime/`, `/topdown-shooter/`, `/breakout/`, `/platformer/` route를 `curl --fail`로 확인한다.

이 workflow는 배포만 담당한다. PR 회귀 검증은 기존 `CI` workflow와 smoke 문서를 기준으로 유지한다.
