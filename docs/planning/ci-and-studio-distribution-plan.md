# PR CI 정리와 Studio 배포 분리

상태: 사용자 결정 완료(2026-11-27), S1 완료·S1b 로컬 검증 완료·S1c 진행 중. 작업 단위 S1→S1b→S1c→S2→S3를 Codex가 구현하고 통합 담당이 검증한다.

## 배경

[런타임 시작·화면 맞춤](runtime-startup-view-plan.md)의 C1에서 `main` 대상 PR에 `CI`의 `validate`를 연결했다.
PR #113에서 세 번 실행한 결과는 [C1e](runtime-startup-view-plan.md#리뷰-후속-c1e-hd-2d-작성-화면-smoke)에 있다.

- `validate`는 단계 약 120개를 한 job에서 차례로 실행한다. Rust 빌드 캐시가 없어 브라우저 검사 전에만 약 20분이 걸린다.
- `HD-2D authoring workspace browser smoke`(`node tests/smoke/browser-render-smoke.mjs --mode=placement-spatial-workspace apps/studio/dist`)는
  로컬에서만 약 2시간이다. CI에서는 71분 뒤 `placement-asset-usage-smoke.mjs:82`의 15초 대기 한도로 실패했다.
- `Blender HD-2D village browser smoke`(`node tests/smoke/placement-village-smoke.mjs`)는 로컬에서 62분 뒤 DPR 2 구간에서 실패했다.
  `9187c1f`부터 실패 스크린샷 오류가 원래 오류를 가리지 않는다.
- 두 smoke의 단언은 대부분 "UI 조작 → 내보낸 문서 JSON·Undo 기록"이다. 주요 파일에서 문서 읽기 44회, Undo 확인 59회,
  필드 입력·선택 76회, 마우스 드래그 113회에 비해 실제 픽셀 확인은 1회다. C1e에서 고친 세 실패도 모두 데이터 계약 문제였다.
- Studio TypeScript 모듈을 Node에서 바로 불러 시험하는 단위 테스트가 이미 23개 있다(`tests/smoke/placement-*.test.mjs`, 예: `placement-point-shadows.test.mjs`).

## 결정 (2026-11-27)

1. PR CI에서 두 Studio smoke(위 두 단계)를 뺀다. 시간 한도 문제는 고치지 않는다. 로직 검사는 단위 테스트로 옮기고
   브라우저 검사는 렌더링·레이아웃·포인터 동작만 보는 얇은 smoke로 줄인다(S2).
2. `validate`에 Rust 빌드 캐시를 추가한다.
3. GitHub Releases에서 내려받아 설치하는 Studio에는 예제 장면(garden 2D, village HD-2D)을 넣지 않는다. 설치판을 처음 실행하면 빈 새 2D 장면이 열린다.
   Pages의 웹 Studio(`/studio/`, 데모 사이트)는 두 예제를 유지한다(S3).
4. (S1 PR 실행 후 추가) PR 검사에서 오래 걸리는 브라우저 검사를 모두 뺀다. 뺀 검사는 수동 실행과 `ferrum-web-v*` 태그 실행에서만 돈다.
   매일 자동 실행은 하지 않는다(S1b).

## S1: PR CI 정리

범위: `.github/workflows/ci.yml`의 `validate` job과 관련 문서만 바꾼다.

- `validate`에서 `HD-2D authoring workspace browser smoke`와 `Blender HD-2D village browser smoke` 단계를 뺀다.
  스크립트 파일과 `pnpm smoke:placement-spatial-workspace`·`pnpm smoke:placement-village`·`smoke:check` 연결은 그대로 둔다.
  두 단계만 쓰는 artifact 업로드 단계가 있으면 함께 정리한다.
- `Setup Rust` 다음에 `Swatinem/rust-cache@v2`를 추가한다. `language-boundaries.yml`의 설정(`cache-on-failure: true`)을 따르고,
  `validate`가 실제로 쓰는 target 디렉터리를 모두 `workspaces`에 넣는다. 최소 `crates/ferrum-core -> target`,
  `apps/studio-desktop/src-tauri -> target`이며, vendor manifest 테스트(`test:physics3d-storage`, `test:physics3d-queries`)와
  `test:rust-wasi`(`scripts/validate/run-native-wasi-tests.mjs`)가 쓰는 target 위치를 확인해 포함한다.
  `cargo install wasm-pack` 단계가 캐시된 바이너리로 건너뛰어지는지 확인한다.
- 고정한 `CI_RUST_TOOLCHAIN`, PR 트리거·concurrency, 수동 입력, 태그 조건, 두 선택형 job의 조건과 `pages.yml`은 바꾸지 않는다.
- 문서: [Smoke Check](../development/quality/smoke-check.md)의 CI 기본 gate 설명, 두 smoke를 CI가 실행한다고 적은 문장을 고친다.
  두 smoke는 로컬·수동 검사로 남고 S2에서 단위 테스트로 옮긴다고 적는다.

검증: `actionlint`(없으면 YAML 파싱과 사유), 바꾼 단계 목록과 캐시 `workspaces`의 근거, 문서 링크 검사.
실제 시간 단축은 PR 실행에서 통합 담당이 확인한다.

### S1 구현 및 검증 결과

- `validate`에서 `HD-2D authoring workspace browser smoke`와 `Blender HD-2D village browser smoke`를 제거했다.
  두 단계 전용 artifact 업로드는 없었다. 두 smoke는 로컬 개별 명령과 `pnpm smoke:check`에서 실행할 수 있다.
- `Setup Rust` 뒤에 `Cache Rust build dependencies`를 추가했다. `Swatinem/rust-cache@v2`에서 `cache-on-failure: true`를 설정했다.
  아래 네 경로는 CI와 같은 Rust 1.97.1의 `cargo metadata --locked --offline --no-deps`로 확인했다.

| 캐시 `workspaces` | 사용하는 명령 |
| --- | --- |
| `crates/ferrum-core -> target` | Core Clippy·테스트, 물리·대량 객체 smoke, `wasm-pack build`, `test:rust-wasi`. WASI는 `--target-dir` 없이 `--target wasm32-wasip1`을 넘겨 Core `target` 아래에 쓴다. |
| `apps/studio-desktop/src-tauri -> target` | Studio Desktop Clippy·저장 계약과 native 프로젝트 smoke |
| `crates/ferrum-core/vendor/rapier3d -> target` | `test:physics3d-storage`의 독립 Rapier 매니페스트 |
| `crates/ferrum-core/vendor/parry3d -> target` | `test:physics3d-queries`의 독립 Parry 매니페스트 |

- 캐시 액션은 기본값으로 Cargo 바이너리 디렉터리를 복원한다. `Install wasm-pack`은 `PATH`에서 바이너리가 발견되면 버전만 출력한다.
  격리한 `PATH`에서 바이너리 유무를 모의 실행해 각각 `wasm-pack --version`, `cargo install wasm-pack`만 호출되는 것을 확인했다.
  [Rust Cache 동작 문서](https://github.com/Swatinem/rust-cache#cache-details)
- `actionlint` 1.7.12, YAML 변경 범위 비교, `pnpm validate:docs-links`, `pnpm validate:runtime-budget-product`, `git diff --check`가 통과했다.
  실제 GitHub 캐시 적중과 시간 단축은 PR 실행에서 확인한다. 전체 Rust 빌드와 브라우저 smoke는 S1 로컬 검증 범위에서 제외했다.

### S1 PR 실행 결과 (통합 담당, 2026-11-27)

`c65cf82`의 PR #113 실행(run 45921553643)은 2시간 40분 동안 `validate` 125단계 중 51단계만 끝내 통합 담당이 취소했다.
실패한 단계는 없었다. Rust 캐시(`v0-rust-validate-…`, 1.8GB)는 취소 시점에 PR ref로 저장됐다.

| 단계 | 시간 |
| --- | --- |
| `Spatial Scene browser smoke` | 53.0분 |
| `Spatial WebGPU geometry/models offscreen and pre-context fallback` | 51.9분 이상(취소) |
| `Placement workspace browser smoke` | 19.1분 |
| `Unified physics public package browser bridge` | 5.0분 |
| 브라우저를 쓰지 않는 단계 전체(1~48번 중) | 28.8분(캐시 없음, Rust 약 20분 포함) |

남은 74단계 중 약 55단계가 브라우저 검사다. 두 Studio smoke를 뺀 것만으로는 PR 검사가 끝나지 않는다.

## S1b: PR 검사에서 브라우저 검사 분리

범위: `.github/workflows/ci.yml`과 관련 문서만 바꾼다. 검사 스크립트, 검사 내용, 단언은 바꾸지 않는다.

**`validate`에 남길 것 (PR 검사, 목표 30분 이내):**
- 브라우저를 쓰지 않는 단계 전부: Rust fmt·Clippy·테스트, vendor 물리 계약, WASI, 물리·예산 smoke, wasm 빌드, `Test Web packages`,
  TypeScript 빌드·lint, 예제 harness guard, `Placement camera, grid, locale, layer and command contracts`,
  `Data Scene gameplay packed Wasm smoke`, `Data scene authoring sample validation`부터 `Topdown template replay report smoke`까지.
- 이번 실행에서 1분 안에 끝난 브라우저 검사만 얇은 브라우저 gate로 남긴다:
  `Top-down browser mass object smoke`, `Top-down browser tilemap budget smoke`, `Native physics SDK file acceptance`,
  `Placement save and layer state browser smoke`(필요한 `Build Studio smoke variants`, `Upload native template Studio report` 포함),
  `Packed input context browser smoke`, `Data Scene packed runtime browser smoke`.
  이 단계가 실제로 이 순서·의존(빌드 산출물, `$GITHUB_ENV` 값)대로 동작하는지 확인한다.

**새 job `browser-smoke`로 옮길 것:**
- 위에 남긴 것을 뺀 나머지 브라우저 검사와 그 `Upload … evidence`·`Upload … report` 단계. 이번 실행 기준으로
  `Unified physics public package browser bridge`, `Placement workspace browser smoke`, `Spatial Scene browser smoke`,
  `Spatial WebGPU …`부터 `Shader preparation smoke`까지의 브라우저 단계다. 판정은 단계 명령이 Playwright/Chromium을 실행하는지로 한다.
- 실행 조건: `startsWith(github.ref, 'refs/tags/ferrum-web-v') || (github.event_name == 'workflow_dispatch' && inputs.browser_smoke)`.
  새 수동 입력 `browser_smoke`(boolean, 기본 false)를 추가한다. PR에서는 건너뛴다. 매일 자동 실행(`schedule`)은 추가하지 않는다.
- `needs: validate`는 두지 않는다(수동 실행에서 같이 돈다). job 안에서 필요한 준비(Rust 고정 버전·캐시, wasm 빌드, TypeScript 빌드,
  Playwright 설치, Studio 빌드·smoke variant 빌드)를 다시 한다. 단계 순서는 `validate`에 있던 순서를 유지한다.
- 이 job과 `validate`의 각 브라우저 단계에 `timeout-minutes`를 둔다. 기준은 이번 실행 시간의 약 2배(최소 10분)이고, 측정이 없는 단계는 20분으로 둔다.
  job에도 전체 한도를 둔다.

**Rust 캐시 크기:** S1 캐시는 압축 후 1.8GB다. 네 target 폴더가 같은 의존성을 각자 빌드하고, Core는 호스트·`wasm32-unknown-unknown`·`wasm32-wasip1`
세 대상으로 빌드하며, Tauri 의존성이 크다. 디버그 정보 축소는 S1c의 저장소 Cargo 설정으로 CI와 로컬에 함께 적용한다. S1b에서 따로 `env`를 두지 않는다.

**바꾸지 않을 것:** `CI_RUST_TOOLCHAIN`, PR 트리거·concurrency, 기존 `consumer_smoke`·`extended_browser_smoke` 입력과 두 job, `pages.yml`,
`language-boundaries.yml`, 로컬 `pnpm smoke:*`와 `smoke:check` 연결.

**문서:** [Smoke Check](../development/quality/smoke-check.md)의 CI 기본 gate 설명에 PR 검사와 `browser-smoke` job의 범위·실행 방법을 적는다.
`AGENTS.md`의 CI 설명(`consumer-smoke`·`extended-browser-smoke` 문장)에 `browser-smoke`를 추가한다. 개발 중에는 바꾼 기능의 단위 테스트와
관련 smoke만 로컬에서 실행하고, 무거운 브라우저 검사는 PR 병합 전 수동 실행이나 릴리스 태그 실행에 맡긴다는 점을 기존 "검증 명령 실행 원칙"에 맞춰 적는다.

검증: `actionlint`, 옮기기 전후 단계와 검사 명령 비교, 문서 링크 검사. 혼합 단계는 Node 검사와 브라우저 명령으로 나누고,
독립 job의 빌드 준비와 분할한 artifact 업로드는 별도로 셈한다.
실제 PR 시간과 수동 `browser-smoke` 실행은 통합 담당이 확인한다.

### S1b 구현 및 검증 결과

- 기존 `validate` 120단계를 `validate` 74단계와 수동 선택형 `browser-smoke` 77단계로 나눴다. 브라우저 단계 39개와 기존 증거 업로드 23개가 이동했다.
  혼합 단계의 Node 검사들은 `validate`에 두고, 공유 업로드에서 native SDK 파일 검사의 경로를 분리해 `validate`에 연결했다.
  독립 job은 자체 Wasm·SDK·예제·Studio 변형을 빌드하고 native Studio smoke의 오프라인 Cargo 준비를 수행한다.
- [PR #113 실행 기록](https://github.com/silbaram/ferrum2d/actions/runs/45921553643)의 실측값으로 PR 브라우저 단계 6개에 10분씩,
  통합 물리 10분·Studio workspace 39분·Spatial Scene 106분·Spatial WebGPU 104분을 줬다. Spatial WebGPU는 취소까지의 경과 시간을 사용했다.
  나머지 브라우저 단계는 20분이다. job 전체 한도는 각각 60분과 360분이다.
- `actionlint` 1.7.12와 YAML 비교가 통과했다. 기존 단계 이름과 검사 명령 전체, artifact 경로 45개를 확인했다.
  테스트를 실행하지 않는 native 타일 빌드 준비만 두 job에서 실행한다. 문서 링크와 `pnpm validate:runtime-budget-product`도 통과했다.
- 기존 패키지·예제 빌드와 Chromium으로 `validate`의 브라우저 검사 6개를 실제 순서로 실행했다. Studio 변형 빌드가 생성한
  `FERRUM_STUDIO_TEST_DIST`와 `FERRUM_STUDIO_SAVE_TEST_DIST`를 다음 단계에 넘겼고, 6개 검사 모두 통과했다.
  GitHub의 전체 PR 시간과 수동 job 완주는 통합 검증에 남았다.

## S2: Studio HD-2D 검사의 단위 테스트 전환

범위: 두 smoke가 부르는 하위 검사(`placement-spatial-workspace-smoke.mjs`, `placement-lighting*-smoke.mjs`, `placement-game-camera*-smoke.mjs`,
`placement-spatial-transforms-smoke.mjs`, `placement-threejs-upgrades-smoke.mjs`, `placement-model-picking-smoke.mjs`,
`placement-asset-usage-smoke.mjs`, `placement-six-panels-smoke.mjs`, `placement-village-smoke.mjs`와 그 하위 파일)를 분류한다.

1. 단언마다 "로직(문서·Undo·검증 규칙·계산)", "브라우저 필요(실제 렌더링·레이아웃·포인터 캡처·DPR)" 중 하나로 분류한 표를 먼저 만든다.
   표를 계획 문서에 올리고 통합 담당의 확인을 받은 뒤 옮긴다.
2. 로직 단언은 기존 방식(`ts.transpileModule`로 Studio 모듈을 불러오는 `node --test`)의 단위 테스트로 옮긴다.
   DOM이 필요한 모듈은 조작 함수와 문서 변경 함수를 분리할 수 있는지 먼저 보고하고, 필요한 리팩터링은 동작을 바꾸지 않는 범위로 한다.
3. 브라우저 smoke는 DPR 1의 짧은 시나리오로 줄인다. 실제 렌더링 픽셀, 좁은 화면 배치, 드래그 중 Esc·포인터 캡처 취소처럼 브라우저가 필요한 것만 남긴다.
4. 옮긴 단위 테스트는 `validate`에 연결한다. 줄인 브라우저 smoke는 실행 시간을 재서 PR에 넣을지 보고한다.

지킬 것: 단언을 줄이지 않는다. 옮긴 단언과 원래 위치의 대응표를 보고에 넣는다. 제품 코드의 동작은 바꾸지 않는다.

검증: 새 단위 테스트, 기존 `placement-*.test.mjs`, 줄인 smoke의 실행 결과와 시간.

## S3: Studio 배포 분리 (설치판에서 예제 제외)

현재: `4915aca`(2026-10-28)부터 garden·village 장면 파일과 에셋(`assets/lantern-garden`, `assets/rpg-village`)이 `apps/studio/public/`에 있어
모든 빌드에 복사된다. 장면 목록 `placement-scenes.json`은 빌드 때 `public/`을 훑어 만든다(`apps/studio/server/sceneCatalog.mjs`).
Studio는 `?scene=`이 없으면 garden을, `?scene=hd2d`이면 village를 연다(`apps/studio/src/main.ts`의 `placementSceneDocumentUrl`).
File 메뉴에 Examples(`placementWorkspaceChrome.ts`)가 있다. 데스크톱은 같은 빌드를 쓴다
(`apps/studio-desktop/src-tauri/tauri.conf.json`의 `beforeBuildCommand`는 `pnpm --filter @ferrum2d/studio build`, `frontendDist`는 `../../studio/dist`).
Pages는 `scripts/build/build-pages.mjs`가 `apps/studio/dist`를 복사한다. `placement-production-default-smoke.mjs`는 제품 빌드에 두 예제가 있다고 단언하며,
`browser-render-smoke.mjs`의 regression 빌드 검사(수동 `browser-smoke`의 `Placement workspace browser smoke` 포함)에서 실행된다.

목표:

| 빌드 | 사용처 | 예제 | 첫 화면 |
| --- | --- | --- | --- |
| 제품(기본 `build`) | 데스크톱 Tauri, GitHub Release | 없음, Examples 메뉴 없음 | 빈 새 2D 장면 |
| 데모 | Pages 웹 Studio | garden·village | 지금과 같음 |
| 테스트(`--mode test`) | smoke | garden·village와 테스트 fixture | 지금과 같음 |

- 예제 파일을 `public/` 밖의 예제 전용 폴더로 옮기고, 데모·테스트 빌드에서만 출력과 장면 목록에 넣는다.
  기본값은 "예제 없음"이어서 릴리스 빌드에 실수로 들어가지 않게 한다.
- 제품 빌드에서 `?scene=garden|village|hd2d`의 처리(무시하고 빈 장면, 또는 안내)를 정해 보고한다.
- `build-pages.mjs`가 데모 빌드를 별도 출력 폴더에서 받게 하고, 데스크톱 빌드가 쓰는 `apps/studio/dist`와 섞이지 않게 한다.
- 검사: `placement-production-default-smoke.mjs`를 제품 빌드 기준으로 바꾼다(예제 파일 404, 빈 장면 목록, Examples 메뉴 없음, 빈 2D 장면으로 시작).
  데모 빌드에 두 예제가 있는지 확인하는 검사를 추가한다. 릴리스 준비(`scripts/package/prepare-distribution.mjs` 또는 Studio 패키지 검사)에서
  설치 파일에 예제 장면·에셋이 없는지 확인한다. `?scene=village`를 쓰는 smoke는 테스트 빌드를 계속 쓴다.
- 문서: Studio 사용 문서, [데모 배포](../development/operations/demo-deploy.md)의 데모·제품 구분, [Smoke Check](../development/quality/smoke-check.md), CHANGELOG.

검증: 세 빌드의 출력 파일 목록 비교, 바꾼 production default smoke, 데모 예제 검사, `pnpm build:pages`, `pnpm validate:pages-artifact`, 릴리스 준비 검사의 예제 제외 확인.
Pages 배포와 릴리스는 이 작업에서 실행하지 않는다.

## Codex 작업 지시

**먼저 읽을 것:** `AGENTS.md`, 이 문서, [C1e](runtime-startup-view-plan.md#리뷰-후속-c1e-hd-2d-작성-화면-smoke), `.github/workflows/ci.yml`, `.github/workflows/language-boundaries.yml`.

**작업 단위:** S1, S1b, S1c, S2, S3를 각각 별도 커밋으로 한다(S2는 하위 묶음별로 나눠도 된다). 앞 단계가 통합 담당의 검증을 통과한 뒤 다음으로 간다.
S2는 분류표를 먼저 보고한다.

**지킬 것:**
- 브랜치는 `feat/example-site-rebuild`. 푸시, PR 갱신, Pages 배포, 릴리스는 하지 않는다.
- Rust/Wasm 소스, vendor 파일과 새 의존성은 바꾸지 않는다(`Swatinem/rust-cache` action 추가는 S1, 저장소 `.cargo/config.toml`의 dev profile 설정은 S1c 범위다).
- 코드 주석은 영어, 문서는 한국어.
- 설계가 이 문서와 달라져야 하면 구현 전에 이유를 보고하고 문서를 먼저 고친다.

**보고:** AGENTS "Review Rule" 형식(변경 파일, 이유, 실행한 명령, 못 한 명령과 사유, 위험·후속). 결과는 이 문서의 해당 절에 남긴다.
