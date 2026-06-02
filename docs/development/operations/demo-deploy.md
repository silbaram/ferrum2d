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

문서 사이트는 별도 정적 사이트 generator 의존성을 두지 않고 `scripts/build-pages.mjs`에서 생성한다. 현재 지원 범위는 Ferrum2D 문서에 필요한 Markdown subset으로 제한한다.

- heading, paragraph, list, table, blockquote, fenced code block
- inline code, emphasis, link, image
- `*.md` 내부 링크를 대응하는 `*.html` 경로로 변환
- `docs/development/quality/screenshots/*` 같은 문서 asset 복사

문서 사이트의 기준 소스는 계속 `docs/**/*.md`다. `dist-pages/docs/`는 배포 artifact일 뿐 git에 포함하지 않는다.

## 로컬 확인

```bash
pnpm build
pnpm build:pages
```

`dist-pages/`는 generated artifact이므로 git에 포함하지 않는다.

## GitHub Actions

`.github/workflows/pages.yml`은 `main` push와 수동 실행에서 동작한다.

1. Rust stable과 `wasm32-unknown-unknown` target을 설정한다.
2. `wasm-pack`과 pnpm dependencies를 설치한다.
3. `pnpm build`로 Wasm package와 모든 예제를 빌드한다.
4. `pnpm build:pages`로 demo dist와 docs HTML을 포함한 `dist-pages/` artifact를 만든다.
5. `actions/upload-pages-artifact`와 `actions/deploy-pages`로 GitHub Pages에 배포한다.

이 workflow는 배포만 담당한다. PR 회귀 검증은 기존 `CI` workflow와 smoke 문서를 기준으로 유지한다.
