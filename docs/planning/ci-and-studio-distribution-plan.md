# PR CI 정리와 Studio 배포 분리

상태: S1·S1b·S1c 완료(PR #113, 2026-11-27 main 머지). 결정 5(2026-11-28)로 S2 범위를 `browser-smoke` job 전체로 넓혔다. S2 분류표 완료, S2a 로컬 검증 완료. S2b-1 보강 6개와 확장 20단계 분류를 기록했다. S2b-2에서 새 테스트 12개와 확장 "보강" 4단계를 옮겼다. 확장 5단계(탑다운 3·물리 실험실 2)는 예제 앱 분리가 필요해 남겼다. S3(설치판에서 예제 제외) 로컬 검증 완료.

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
5. (2026-11-28 추가) CI는 단위 테스트로만 검증한다. `browser-smoke` job을 없애고, 그 검사 중 로직은 단위 테스트로 옮긴다(S2).
   실제 브라우저·GPU가 필요한 검사(렌더링 픽셀, WebGPU 복구, 레이아웃·포인터 등)는 CI에서 빼고, 스크립트는 로컬 수동 실행용으로 남긴다.
   - 배경: main 수동 실행(run 46017639730)에서 `browser-smoke`가 55분 동안 82단계 중 20단계만 진행했다. 소프트웨어 렌더링 때문에 장면 하나에 50분 넘게 걸린다.
   - `validate`에 있는 빠른 브라우저 smoke 6개(S1b)는 이 결정의 대상이 아니다. PR CI는 약 25분이다.

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
| `crates/ferrum-core/vendor/rapier3d -> target` | `test:physics3d-storage`·`test:physics3d-portability`의 독립 Rapier 매니페스트 |
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

## S1c: 로컬 Rust 빌드 폴더 자동 정리와 디버그 정보 축소

배경: 2026-11-27 로컬 네 target 폴더가 합계 약 72GB였다(Core 60.5GB 중 증분 캐시 29GB·옛 결과물 427개, Studio Desktop 7.0GB,
rapier3d 1.6GB, parry3d 2.8GB). Cargo는 `target`의 옛 결과물을 지우지 않는다. 기간·용량 기준 정리는 nightly 전용(`-Z`)이라 stable 1.97.1에서 쓸 수 없다.
`~/.cargo/registry`는 Cargo가 이미 자동 정리한다(3개월 미사용). 사용자 결정(2026-11-27): 날짜·용량 기준 자동 정리 스크립트와 디버그 정보 축소를 함께 한다.

범위: 새 Node 스크립트, 저장소 Cargo 설정, `package.json` 스크립트, 관련 문서. Rust/Wasm 소스와 vendor 파일은 바꾸지 않는다. 새 의존성(`cargo-sweep` 포함)은 쓰지 않는다.

**1. 디버그 정보 축소**
- 저장소 루트 `.cargo/config.toml`에 `[profile.dev] debug = "line-tables-only"`를 둔다(`test` profile은 `dev`를 상속한다).
  Cargo 설정은 실행 위치에서 위로 찾으므로 Core, Studio Desktop, vendor rapier3d·parry3d 매니페스트에 모두 적용된다. vendor `Cargo.toml`은 건드리지 않는다.
- Release profile, `wasm-pack` 설정, `[package.metadata.wasm-pack.profile.release]`는 바꾸지 않는다.
- 확인: 설정 전후 같은 명령(`cargo test --manifest-path crates/ferrum-core/Cargo.toml --no-run`)의 target 크기와 빌드 시간, 실패 테스트의 backtrace에
  파일·줄 번호가 남는지. 결정성 hash와 Wasm 출력이 바뀌지 않는지(`pnpm build:wasm` 전후 `ferrum_core_bg.wasm` 해시).

**2. 날짜·용량 기준 자동 정리 스크립트** (`scripts/tools/clean-rust-targets.mjs`)
- 대상: 네 매니페스트의 target 폴더(`cargo metadata --no-deps`의 `target_directory`로 찾는다. 하드코딩하지 않는다).
- 정리 단위: `target/[<triple>/]<profile>/` 아래의 `.fingerprint/`, `deps/`, `build/`, `incremental/`, `examples/`의 각 항목.
  항목의 마지막 사용 시각은 안의 파일 중 가장 늦은 atime·mtime으로 정한다.
- 날짜 기준: 마지막 사용이 N일(기본 14일)보다 오래된 항목을 지운다.
- 용량 기준: 날짜 정리 뒤에도 네 폴더 합계가 상한(기본 20GiB)을 넘으면, 상한 아래가 될 때까지 오래된 항목부터 지운다.
- 안전성: 지운 결과물은 Cargo가 fingerprint 검사에서 없다고 판단해 다시 빌드한다. 정리는 정확성을 바꾸지 않고 다음 빌드 시간만 늘린다.
  빌드 중 삭제를 막기 위해 각 profile 폴더의 `.cargo-lock`에 잠금을 걸 수 없으면 그 폴더를 건너뛴다(실행 중인 Cargo가 잠금을 잡고 있다).
  자동·오래된 결과물 정리는 Cargo와 같은 OS 파일 잠금을 사용할 수 있는 Linux에서 실행한다. `flock` 미설치, NFS나
  잠금 파일이 없는 profile은 보존한다. 다른 환경에서는 Cargo 자체의 `pnpm clean:rust`로 정리할 수 있다.
- 설정: `FERRUM_RUST_TARGET_MAX_AGE_DAYS`, `FERRUM_RUST_TARGET_MAX_GIB`, `FERRUM_RUST_TARGET_GC=0`(끄기). `--dry-run`은 지울 항목과 크기만 출력한다.
  `CI=true`에서는 아무것도 하지 않는다(CI는 `Swatinem/rust-cache`가 정리한다).
- 자동 실행: `scripts/build/build-wasm.mjs`와 `scripts/validate/run-native-wasi-tests.mjs` 시작 시 호출한다. 하루 한 번만 검사하도록
  `target` 밖의 기록 파일(예: `node_modules/.cache/ferrum2d/rust-target-gc.json`)에 마지막 실행 시각을 남긴다. 정리 결과는 한 줄로 출력한다.
- 수동 실행: `pnpm clean:rust`(네 폴더 `cargo clean`), `pnpm clean:rust:stale`(날짜·용량 기준 정리 즉시 실행, 하루 제한 무시).
- 한계: `cargo test`를 직접 실행하면 자동 정리가 돌지 않는다. 문서에 `pnpm clean:rust:stale`을 안내한다.
- 시험: 임시 폴더에 가짜 target 구조(오래된·최근 항목, 잠긴 profile 폴더)를 만들어 날짜 기준, 용량 기준, 잠금 건너뛰기, `--dry-run`, `CI=true`, 하루 제한을
  `node --test`로 확인한다. 실제 target에서는 `--dry-run` 결과를 보고한다.

**문서:** `AGENTS.md`의 검증 명령 실행 원칙 또는 Required Checks 근처, [Smoke Check](../development/quality/smoke-check.md)의 로컬 실행 안내에
자동 정리 동작·기본값·끄는 방법과 `pnpm clean:rust`·`pnpm clean:rust:stale`을 적는다.

### S1c 구현 및 검증 결과

- Rust 1.97.1, 같은 checkout과 6개 Cargo 작업을 사용해 각각 비어 있는 target에 Core의 `cargo test --no-run --locked --offline`을 실행했다.
  `du -sb` 기준 target 크기는 **5.17GiB → 3.00GiB(42.0% 감소)**, 경과 시간은 **98.76초 → 91.67초**였다.
  의도적으로 panic을 낸 임시 테스트는 두 설정 모두 backtrace에 파일·줄 번호를 표시했다.
- Core 결정성·golden 테스트 7개가 설정 전후 모두 통과했다. `pnpm build:wasm`의 Wasm SHA-256은 양쪽 모두
  `22836a7cd02fe236cc60049716177d55ac19b825a2af5a74839bebe2e0a57d0e`였다. 이 Wasm으로 Gameplay replay 17개와 스냅샷 94개가 통과했다.
- `node --test`로 정리·WASI 실행기·Wasm 빌드 래퍼 계약 18개를 확인했다. 나이·용량·최신 atime/mtime·하드링크·잠금·CI와 opt-out·하루 제한·
  dry run·전체 `cargo clean` 호출을 다뤘다. 별도 임시 프로젝트의 실제 Cargo 빌드 중에도 잠긴 profile을 건너뛰었고, 빌드가 끝난 뒤에는
  오래된 파일이 dry run에 나타났다. `pnpm validate:rust-test-harness`와 문서 링크 검사도 통과했다.
- 작업 트리의 기존 target 네 곳은 이 실행에서 비어 있었다. 별도로 빌드한 Core target은 기본값으로 dry run했을 때 약 3.0GiB,
  삭제 후보 0건이었다. 실제 작업 트리의 target은 삭제하지 않았다.

## S2: 브라우저 검사의 단위 테스트 전환

범위(결정 5로 확대): `.github/workflows/ci.yml`의 `browser-smoke` job에 있는 브라우저 검사 전체(41단계)다.
처음 범위였던 Studio HD-2D 두 smoke의 하위 검사도 포함한다. 분류는 단계마다 "로직 → 단위 테스트", "브라우저 필요 → 로컬 수동 스크립트"로 나눈다.
옮긴 뒤 `browser-smoke` job과 태그 실행 조건을 지우고, 릴리스 문서의 검사 목록을 고친다. 아래 1~4는 Studio 두 smoke의 처음 계획이며 같은 방식으로 나머지에도 적용한다.

처음 범위: 두 smoke가 부르는 하위 검사(`placement-spatial-workspace-smoke.mjs`, `placement-lighting*-smoke.mjs`, `placement-game-camera*-smoke.mjs`,
`placement-spatial-transforms-smoke.mjs`, `placement-threejs-upgrades-smoke.mjs`, `placement-model-picking-smoke.mjs`,
`placement-asset-usage-smoke.mjs`, `placement-six-panels-smoke.mjs`, `placement-village-smoke.mjs`와 그 하위 파일)를 분류한다.

1. 단언마다 "로직(문서·Undo·검증 규칙·계산)", "브라우저 필요(실제 렌더링·레이아웃·포인터 캡처·DPR)" 중 하나로 분류한 표를 먼저 만든다.
   표를 계획 문서에 올리고 통합 담당의 확인을 받은 뒤 옮긴다.
2. 로직 단언은 기존 방식(`ts.transpileModule`로 Studio 모듈을 불러오는 `node --test`)의 단위 테스트로 옮긴다.
   DOM이 필요한 모듈은 조작 함수와 문서 변경 함수를 분리할 수 있는지 먼저 보고하고, 필요한 리팩터링은 동작을 바꾸지 않는 범위로 한다.
3. 브라우저가 필요한 단언(실제 렌더링 픽셀, 좁은 화면 배치, 드래그 중 Esc·포인터 캡처 취소 등)은 CI에서 빼고 로컬 수동 스크립트로 남긴다(결정 5).
4. 옮긴 단위 테스트는 `validate`에 연결한다. PR CI 시간이 크게 늘면 보고한다.

지킬 것: 단언을 줄이지 않는다. 옮긴 단언과 원래 위치의 대응표를 보고에 넣는다. 제품 코드의 동작은 바꾸지 않는다.

검증: 새 단위 테스트, 기존 `placement-*.test.mjs`, 줄인 smoke의 실행 결과와 시간.

### S2 분류표 (통합 담당, 2026-11-28)

`browser-smoke` job의 브라우저 검사는 39단계(아래 1~39)다. 40·41은 별도 `consumer-smoke` job이다. 두 job 모두 수동·태그 실행에서만 돈다.
조사는 origin/main(`c931e948`) 기준으로 스크립트를 읽어서 했고, 단언 수는 grep으로 센 추정치다.

처리 방법은 세 가지다.
- **그냥 뺌**: 로직은 이미 `validate`의 단위 테스트에 있고, 남는 것은 브라우저가 필요한 부분뿐이다.
- **보강**: 기존 단위 테스트에 빠진 로직 단언을 옮긴다.
- **새 테스트**: 로직을 검사하는 단위 테스트가 없다. 필요하면 Node+Wasm(`packages/ferrum-web/test/*Wasm.test.ts` 방식)이나 Rust 테스트로 새로 만든다.

| # | 검사 | 처리 | CI에서 빠지면 잃는 것(로컬 수동 스크립트로 남김) |
| --- | --- | --- | --- |
| 1 | 통합 물리 패키지 브라우저 연결 | 보강. 대부분 `unifiedPhysics*Wasm.test.ts` 등에 이미 있다 | 압축한 tarball을 실제 브라우저에서 불러오기, 타일맵 픽셀, Studio 물리 편집 UI |
| 2 | Placement workspace | 보강. 로직 약 150개 → `placement-*.test.mjs`, `scenePlacement*.test.ts` | 포인터 드래그·제스처 취소, 폭별 레이아웃, 캔버스 픽셀 |
| 3 | Spatial Scene | 보강. 로직 약 88개 → `spatial*.test.ts` | 픽셀 차이 0, GL 객체 누수, DPR 화면 |
| 4 | Spatial WebGPU 오프스크린·fallback | 그냥 뺌 | 실제 WebGPU 렌더 결과, WebGL2↔WebGPU 픽셀 일치 |
| 5 | WebGPU 복구 | 그냥 뺌 | 실제 디바이스 손실 뒤 복구한 픽셀, GPU timing |
| 6 | Tiled·LDtk 맵 작성 | 그냥 뺌(`tile-assets.test.mjs` whole-map) | 런타임 캔버스 픽셀, GL 텍스처 해제 |
| 7 | 에셋 revision 정리 | 보강. snapshot·history 약 65개 | 렌더 픽셀, GL 텍스처 수, 레이아웃 |
| 8 | 트림 스프라이트 | 그냥 뺌(`aseprite-trim.test.mjs`, Rust trim) | 새 게임에서 렌더된 UV |
| 9 | 슬라이스·origin | 그냥 뺌(`aseprite-slices.test.mjs`) | DOM 컨트롤, GL 해제 |
| 10 | 2D 스프라이트 노멀 | 그냥 뺌(`spriteNormals.test.ts` 등) | 노멀 조명 픽셀, GL 상태 누수, 복구 |
| 11 | Flat lighting 합성 | 새 테스트: reference vector 검사(순수 Node)를 `validate`에 넣는다 | 셰이더 합성 결과, GL↔GPU 일치 |
| 12 | Flat lit receiver | 그냥 뺌(`flatLit.test.ts`) | lit 렌더 패스, 복구 뒤 픽셀 |
| 13 | Engine Playground | 새 테스트: 네이티브 상태 약 22개(엔티티 수, pause, 재질별 속도, reset) | 픽셀 변화, 화면→카메라 좌표, 좁은 화면 |
| 14 | 기능 예제 31개 | 새 테스트: 9-slice 재생성, `check-example-catalog`(지금 CI에 없음), snapshot 기반 네이티브 상태 약 280개 | 예제 실제 부팅·렌더, 탭·사이드바 UI, 오디오, 복구 |
| 15 | 예제 사이트 셸 | 새 테스트: 그룹·개수, 검색(먼저 `main.ts`에서 함수로 분리), ko/en, 화면 맞춤 | 레이아웃, 폰트, 드래그, 포커스, WebGL 컨텍스트 해제 |
| 16 | 9-slice | 그냥 뺌(`sprite_nine_slices.rs`, `spriteNineSlice.test.ts`) | 경계 픽셀, GL↔GPU 일치 |
| 17 | 스프라이트 팔레트 | 그냥 뺌(`spritePalette.test.ts`) | 팔레트 샘플링 픽셀, CPU 예산 |
| 18 | 픽셀 후처리 | 그냥 뺌(`pixel-postprocess-contract.test.mjs` 등) | 셰이더 출력, virtual pixel 메모리 |
| 19 | 픽셀 아트 쇼케이스 | 새 테스트: `validatePixelArtProfile`(순수 Node), 엔티티·수집 수 | 효과 픽셀, letterbox 포인터, 레이아웃 |
| 20 | 내장 픽셀 제작 | 그냥 뺌(`test:pixel-authoring`) | 캔버스 포인터·줌, 다운로드, 새 게임 렌더 |
| 21 | 픽셀 소스 저장 왕복 | 보강. JSON·revision·충돌 약 250개 | UI→저장→게임을 잇는 증거, 렌더 픽셀 |
| 22 | 64프레임 용량 | 그냥 뺌(`pixel-capacity.test.mjs`, `profile:pixel-capacity`) | 큰 시트 스크롤, 64 cel 픽셀 |
| 23 | 에셋 카탈로그 정리 | 새 테스트: 차단 사유를 `main.ts:2555-2561`에서 순수 함수로 분리 | 대화상자 흐름, 모달 레이아웃 |
| 24 | 타일맵 저장 왕복 | 그냥 뺌(`tile-assets.test.mjs`, Rust `tile_assets.rs`) | 4조합 실제 렌더 |
| 25 | 오토타일 | 보강(소량) | 프리뷰 픽셀, draw call·CPU 예산 |
| 26 | 타일 애니메이션 | 새 테스트: 시간→프레임 경계 계산(지금은 픽셀로만 검증) | 게임 루프 타이밍 픽셀 |
| 27 | 마을 품질 | 새 테스트: AI·사격·경사·체크포인트(지금 로직 검증이 어디에도 없음) | 오디오 2보이스, GPU 리소스 누수, 예산 |
| 28 | HD-2D 전투 전반 | 새 테스트: 모델 216개·적 32명 규모의 통합 시나리오(기능별 로직은 이미 있음) | 입력 좌표 변환(레터박스·DPR), GPU 예산, 프레임버퍼 동일성 |
| 29 | 투영·태양 | 그냥 뺌(`data_scene_projection_sun.rs`, `dataSceneSun.test.ts` 등) | WebGL2↔WebGPU 픽셀, 포인터 |
| 30 | 스프라이트 타이밍·방향 | 그냥 뺌(`data_scene_animation*.rs`, `dataSceneSpriteAnimation.test.ts`) | 실제 UV 픽셀 |
| 31 | RenderTexture | 새 테스트: 입력 검증·stats 불변 약 35개(`WebGL2Renderer.renderToTexture` 단위 테스트 없음) | FBO 샘플링 방향, alpha 합성 |
| 32 | 색 관리 | 새 테스트(소량): 작업 색 값, 모드 충돌 거부 약 10개 | GPU 셰이더 sRGB 정확도 |
| 33 | 픽셀 퍼펙트·Game Preview | 새 테스트: 설정 검증, 복구 뒤 설정 유지, `placementGameCamera.ts` 카메라 복원 | 백엔드 간 픽셀 일치, 실제 마우스·DPR |
| 34 | 아틀라스 extrusion | 그냥 뺌(`atlas-extrusion.test.mjs`) | 필터링 번짐 회귀 |
| 35 | GPU 리소스 수명 | 그냥 뺌(`runtimeProfiler`·`textureResources` 테스트 등) | 실제 GL 객체 수, timer query |
| 36 | 에셋 로딩 동시성 | 그냥 뺌(`assetLoadLifecycle.test.ts`) | 실제 fetch, 디코드 |
| 37 | 공간 오디오 | 그냥 뺌(`spatialAudio.test.ts`) | 실제 PannerNode 출력, 클릭 unlock |
| 38 | KTX2 | 그냥 뺌(`ktx2Texture.test.ts`) | 실제 Basis transcoder Worker, 압축 업로드 |
| 39 | 셰이더 준비 | 그냥 뺌(`shaderPreparation.test.ts`) | 실제 드라이버의 GLSL 컴파일(셰이더 문법 회귀) |
| 40 | 패키지 소비자(`consumer-smoke`) | 결정 필요. assert 약 500개 중 브라우저 구간은 약 38개이고, 나머지는 tarball 설치→생성 게임 빌드 Node E2E | 실제 설치부터 빌드까지 E2E, 배포 페이지 렌더 |
| 41 | 소비자 보고서 검증 | 그냥 뺌(`smoke:consumer-smoke-report`가 `validate`에 있음) | 없음 |

요약: 그냥 뺌 22개, 보강 6개, 새 테스트 12개, 결정 필요 1개(40).
CI에서 완전히 사라지는 것은 실제 렌더링·GPU 확인이다. 픽셀 일치, 디바이스 복구, 실제 드라이버 셰이더 컴파일, KTX2 transcoder,
오디오 출력, 포인터·DPR·레이아웃, GPU 누수 수, 브라우저에서 tarball 불러오기가 여기에 해당한다. 이 스크립트들은 로컬 수동 실행용으로 남긴다.

조사 중 찾은 PR CI(`validate`)의 빈틈과 중복. S2와 상관없이 바로 고칠 수 있다.
- `check-example-catalog.mjs`(assert 45개)가 어디에서도 돌지 않는다. `smoke:feature-examples`의 첫 단계인데, CI는 node 스크립트를 직접 실행한다(`ci.yml:526`).
- `test:placement-flat-lighting`이 CI에 없다(`package.json:77`).
- `pnpm test:tile-assets`가 세 번 돈다(`ci.yml:263, 290, 293`).

### S2a 결과 (통합 담당, 2026-11-28)

사용자 승인(2026-11-28): 패키지 소비자 smoke는 브라우저 부분만 빼고 릴리스 태그·수동 실행에 남긴다. `validate`의 빠른 브라우저 smoke는 그대로 둔다.

- **CI job 정리**: `browser-smoke` job과 `extended-browser-smoke` job, 수동 입력 `browser_smoke`·`extended_browser_smoke`를 지웠다.
  `ci.yml`에는 `validate`와 `consumer-smoke`만 남는다.
- **로컬 실행**: 지운 두 job의 명령을 `scripts/validate/browser-smoke-steps.json`으로 옮겼다. 준비 5, 검사 39, 확장 20단계다.
  `pnpm smoke:browser-local`(`scripts/validate/run-browser-smokes.mjs`)이 순서대로 실행하고 결과를 요약한다.
  `RUNNER_TEMP`와 `GITHUB_ENV`를 `artifacts/browser-smoke-local/`에 흉내 내므로 Studio 빌드 변형을 쓰는 단계도 그대로 돈다.
- **`validate`에 추가**: 지금까지 어디에서도 돌지 않던 검사를 넣었다.
  - `pnpm validate:example-catalog`
  - `pnpm test:placement-flat-lighting`
  - `pnpm test:browser-smoke-node-checks`: flat lighting 기준값(브라우저 스크립트에서 `flat-lighting-reference-vectors.mjs`로 분리), 기능 예제 재생성, 픽셀 아트 프로필, 로컬 실행 목록의 명령·스크립트 존재 확인
- **중복 제거**: 세 번 돌던 `pnpm test:tile-assets`를 한 단계로 합쳤다.
- **패키지 소비자**:
  - `package:consumer-smoke --skip-browser`는 생성 게임과 Placement Viewer의 Chromium 검사를 건너뛴다.
  - 보고서 검증은 `--allow-skipped-browser`를 줄 때만 이 보고서를 받는다. 이때 브라우저 항목은 false이거나 없어야 한다.
  - 검증 smoke에 네 사례를 추가했다.
- **문서**: `AGENTS.md`, `docs/development/quality/smoke-check.md`의 CI 설명과 "CI의 `browser-smoke`에서 실행한다" 문장을 모두 로컬 명령 기준으로 고쳤다.
- **병렬 분할**(사용자 승인 2026-11-28): 한 줄로 돌던 `validate` 66단계를 네 job으로 나눠 동시에 돌린다. 검사 내용과 순서는 그대로다.
  - `validate-rust`: Core Rust 형식·Clippy·전체 테스트, vendor 물리 회귀 3종(2026-11-28 Rapier 저장 기준값 추가), harness guard, 물리·budget·대량 객체 smoke
  - `validate-wasi`: WASI 실행기 계약과 Rust-only WASI 전체 테스트
  - `validate-studio-desktop`: 데스크톱 Linux 패키지 설치와 Studio desktop Rust 4단계
  - `validate`: 나머지(Wasm 빌드, SDK·TypeScript·패키지·짧은 브라우저 검사)
  - PR #114 실행의 단계별 시간 기준 예상은 가장 긴 `validate` 약 10분이다(이전 약 25분). 공개 저장소의 기본 runner라 비용은 없다.
  - 실측(통합 담당, 2026-11-28): PR CI 전체는 캐시가 빈 첫 실행(PR #115)에서 약 13분, 이후 PR #116~#120에서 약 9분 30초~10분이다.
    가장 긴 job은 `validate`(약 9분 30초)이고 `validate-rust`는 약 6분 40초다(PR #120).
- **분할 중 찾은 S2a 누락**:
  - `validate:runtime-budget-product`가 지운 job의 `extended_browser_smoke`·`artifacts/browser-smoke-budgets`를 `ci.yml`에서 찾아 실패했다. 이 두 항목은 로컬 실행 목록(`browser-smoke-steps.json`)에서 확인하도록 바꿨다.
  - 확장 20단계에 이전 job의 `FERRUM_BROWSER_SMOKE_TIMEOUT_MS=30000`과 `FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR`를 다시 넣었다. 실행기는 단계별 `env`를 적용하고, 테스트가 이를 확인한다.

검증(로컬, `chore/ci-unit-tests` worktree):
- actionlint 1.7.12와 YAML 해석
- `pnpm test:browser-smoke-node-checks`(6건)
- `pnpm validate:example-catalog`
- `pnpm test:placement-flat-lighting`(10건, SDK 빌드 후)
- `pnpm smoke:consumer-smoke-report`
- 바꾼 스크립트의 `node --check`
- `pnpm smoke:browser-local --list`(`--group extended` 포함)
- 문서 링크 검사
- 분할 뒤: 분할 전후 단계 66개가 빠짐·중복 없이 같은 내용인지 YAML로 대조했다. `validate` 안의 순서도 같다.
- 분할 뒤: `validate:runtime-budget-product`, `validate:rust-test-harness`, `smoke:runtime-budgets`, 공개 API·릴리스 후보 guard 등 빠른 Node 검사 18개
- `pnpm test:updates`는 로컬에서만 실패한다. 로컬 npm 12.0.2가 `--allow-scripts`를 거절하기 때문이고, 관련 파일은 main과 같다. CI의 Node 24 기본 npm에서는 PR #114 때 통과했다.

남은 일:
- 실제 `--skip-browser` 소비자 smoke 실행과 소요 시간 측정. 태그나 수동 실행 때 잰다.
- `extended-browser-smoke` 20개의 로직 분류. 분류표에 없던 job이라 S2b에서 같은 방식으로 나눈다.

### S2b-1 결과 (2026-11-29)

기준은 PR #121을 병합한 `7acc65fa`다. 아래 표의 회귀는 PR `validate`의 기존
`pnpm test:web`·`pnpm test:placement-scenes`·`pnpm test:placement-inspector`·
`pnpm test:placement-asset-cleanup`·`pnpm test:pixel-authoring`·`pnpm test:tile-assets`에서 실행된다.
원래 smoke의 단언은 로컬 스크립트에 유지했다.

| # | 원래 로직 단언 → 단위 테스트 | 기존 커버리지 | 브라우저에서 계속 검사할 부분 |
| --- | --- | --- | --- |
| 1 | `native-checked-error-probe.mjs`의 수동 2종·자동 RAF 사전 거절. 이전 CCD 통계·바디 word·시간·Native 파일 동일, 체크포인트 복원과 재진입 → `unifiedPhysicsCheckedErrorsWasm.test.ts`. `native-gameplay-navigation-probe.mjs`의 64명·405스텝 상태 해시 → `nativeGameplayNavigation.integration.test.ts` | `unifiedPhysics*Wasm.test.ts`의 바디·관절·조회·바인딩·관측, `engineFrameLifecycle.test.ts`의 실패 주입과 RAF 종료, `dataScenePhysics*.test.ts`의 씬 검증과 적용 | tarball의 실제 브라우저 로드, 타일맵 픽셀, Studio 물리 설정 UI. `native-gameplay-navigation-probe.mjs`의 64명 RAF 프레임 예산과 브라우저 핸들 연결 |
| 2 | `placement-workspace-smoke.mjs`의 2 MiB 및 열린 문서 8개 제한 → `placement-scene-catalog.test.mjs`. 같은 ID를 가진 두 문서의 선택·draft·Undo 격리 → `placement-component-edits.test.mjs` | `placement-workspace-preferences.test.mjs`의 레이아웃 저장, `scenePlacementViewer.test.ts`의 개별 편집·트랜잭션·Undo/Redo, `placement-document-store.test.mjs`의 외부 저장 충돌 | 폭별 레이아웃·픽셀·포인터 취소. 탭 전환의 같은 캔버스·런타임 복원, 리소스 로드 실패와 저장 중 입력 처리 |
| 3 | `spatial-navigation-browser-fixture.mjs`의 다리 경로 비용, 없는 층 거절 뒤 기존 경로·waypoint 유지, 다리 도착 높이, 일시정지 중 저장 후 기존 좌표와 idle 상태 복원 → `dataSceneSpatial.test.ts` | `spatialModelAssembly.test.ts`의 조립·경계 값, `spatialModelAssetCache.test.ts`의 대기·취소·해제, `dataSceneSpatial.test.ts`의 공간·카메라·저장 검증 | 실제 GL 오브젝트·버퍼 업로드, 픽셀 차이 0, DPR·캔버스 선택, 실제 HTTP CORS·gzip·로드 취소 |
| 7 | `aseprite-assets-smoke.mjs`의 미참조 revision 1개 제거, 이전·현재 revision과 Undo/Redo·패치 보존 → `placement-asset-cleanup.test.mjs`의 실제 viewer와 세션 revision 저장소 조합 | `scenePlacementViewer.test.ts`의 이력 참조, `aseprite-trim.test.mjs`의 원본·hash·복원, `placement-asset-cleanup.test.mjs`의 프로젝트 단위 보호와 백업 | 드로어 상태·crop 픽셀·실제 GL 텍스처 해제·DOM의 진단 노출 |
| 21 | `native-pixel-project-smoke.mjs`의 외부 catalog 충돌 뒤 기존 토큰으로 같은 JSON·PNG를 재시도 → `pixel-authoring.test.mjs`의 실제 Desktop 호출 어댑터와 저장 응답 검증 | `pixel-authoring.test.mjs`의 저장 형식·immutable revision·변형 JSON 복원, `pixel-indexed.test.mjs`·`pixel-history.test.mjs`의 indexed·이력, `pixel-ink.test.mjs`의 blend·opacity | 새 브라우저·Desktop 프로토콜·파일을 거치며 흘러가는 UI↔저장↔게임 부팅, 클립·렌더·다운로드 |
| 25 | `tile-autotile-smoke.mjs`의 공간 문서 거절과 원본 불변, 64·512·2,048 셀 및 충돌 행 → `tile-assets.test.mjs` | 같은 테스트의 Tiled·LDtk 규칙/리팩·Undo·collision override와 네이티브 원본 복원 | 프리뷰 픽셀, bitmap 경쟁·취소, 게임의 raycast·draw call·시간 예산, native 파일 선택과 다시 열기 |

**분리한 범위.** `placementWorkspaceDocumentLimits.ts`에 크기·문서 수 검사만 옮겼다.
`main.ts`에서 파일을 읽기 전과 새 탭을 만들기 전의 검사 순서 및 오류 문구를 유지했다.
열린 문서의 선택·draft·Undo는 기존 viewer에서 직접 검사한다. 문서 세션의 전환 롤백·save rebase는
다른 탭의 DOM, 리소스와 캔버스, 저장 중 포인터 종료까지 변경하므로 별도 세션 경계가 필요하다.
픽셀의 source commit 뒤 scene commit 실패·늦은 완료 억제도 `placementPixelTool.ts`의 UI 수명과
두 저장 호스트의 응답에 걸쳐 있다. 토큰과 전송 데이터는 단위 테스트로 검사하고 실제 실패·재연결 흐름은
원래 smoke에서 검사한다. 오토타일 preview bitmap의 요청 단일화는 현재 캔버스와 로더 수명에
묶여 있다. 규칙 계산·파일 입출력과 구분해 로컬 smoke에 남겼다.

#### 확장 브라우저 20단계 분류

`scripts/validate/browser-smoke-steps.json`의 `extended` 순서다. 처리 열은 후속 분류이며,
브라우저 단언은 로컬 스크립트에 유지한다. 그냥 뺌 11단계, 보강 9단계다. 표는 동작 단위로 작성했으며 단언 개수는 집계하지 않았다.

| # | 검사 | 처리 | 근거가 되는 기존 단위 테스트 | CI에서 빠지는 확인 |
| --- | --- | --- | --- | --- |
| 1 | `smoke:preload` | 그냥 뺌 | `assetPreload.test.ts`, `assetLoadLifecycle.test.ts`의 순서·진행률·캐시 | 실제 fetch/CacheStorage와 로딩 UI에서 complete로 넘어가는 흐름 |
| 2 | `smoke:mobile-input` | 그냥 뺌 | `virtualControls.test.ts`, `inputManager.test.ts`의 조이스틱·버튼 매핑과 취소 | 터치 포인터 캡처·릴리스와 실제 화면 속 게임 입력 |
| 3 | `smoke:lighting` | 그냥 뺌 | `lighting.test.ts`, `sceneLighting.test.ts`, `webgl2LightingPass.test.ts` | WebGL2의 밝은/가려진 픽셀과 렌더 상태 |
| 4 | `smoke:lighting-webgpu` | 그냥 뺌 | `webgpuLightingPass.test.ts`, `lighting.test.ts` | 실제 WebGPU 셰이더, 캔버스 픽셀과 백엔드 선택 |
| 5 | `smoke:material` | 그냥 뺌 | `spriteMaterial.test.ts`, `spriteNormals.test.ts`의 재질·샘플 값 | WebGL2 emissive/mask 픽셀과 실제 리소스 연결 |
| 6 | `smoke:material-webgpu` | 그냥 뺌 | `spriteMaterial.test.ts`, `webgpuSpritePass.test.ts`의 샘플러·draw 입력 | WebGPU 재질 픽셀과 실제 텍스처 바인딩 |
| 7 | `smoke:camera-postprocess` | 그냥 뺌 | `cameraPostProcessing.test.ts`의 추적·경계·보간·uniform, `pixelPerfect.test.ts` | 화면 이동과 순서대로 합성된 후처리 픽셀 |
| 8 | `smoke:particle-vfx` | 보강 | `particleVfx.test.ts`의 burst/loop/trail, `particlePreset.test.ts`의 값 검증 | 예제가 preset을 등록·발행하는 실제 프레임, 색·가시 픽셀 및 GPU draw |
| 9 | `smoke:topdown` | 보강 | Core `shooter_snapshots.rs`, `gameStateSnapshot.test.ts`, gameplay replay 검사 | 예제 입력→사격→적 flash·입자까지의 결합 상태와 실제 프레임 |
| 10 | `smoke:topdown-budget` | 그냥 뺌 | 9번의 상태 검사, `runtimeProfiler.test.ts`와 예산 프로필 검사 | 대규모 브라우저 프레임·렌더 시간·draw/texture 예산 |
| 11 | `smoke:topdown-save-load` | 보강 | Core `shooter_snapshots.rs`, `gameStateSnapshot.test.ts`, `validate:gameplay-report-artifacts` | 같은 예제의 사격 뒤 저장→새 상태→복원 replay와 저장 UI·브라우저 저장소 |
| 12 | `smoke:topdown-hd2d` | 보강 | `dataSceneNavigation.test.ts`, `dataSceneSpatial.test.ts`, `nativeGameplayNavigation.integration.test.ts` | 예제 Game Spec의 포털 경로 5-float stride·아래층 경로·arc의 결합 결과, 화면 투영 |
| 13 | `smoke:destructible-terrain-browser` | 보강 | Core pixel mask 지형 회귀. Node+Wasm `destructible-terrain-smoke.mjs`의 마스크 지우기·충돌 검사는 별도 명령으로 존재 | 기존 Node 검사를 CI에 연결하기 전까지 예제의 충돌·파괴 결합. 포인터 조준과 렌더 픽셀 |
| 14 | `smoke:breakout-effects` | 보강 | Core `breakout_tests.rs`와 `breakout_scene/runtime/phase_tests.rs`, `particleVfx.test.ts` | 예제 입력→벽돌 충돌→효과·입자·표시의 결합과 렌더 |
| 15 | `smoke:breakout-budget` | 그냥 뺌 | 14번의 Core 상태 회귀, `runtimeProfiler.test.ts` | 실제 프레임 시간·draw·텍스처 전환·collision 예산 |
| 16 | `smoke:platformer-effects` | 보강 | Core `platformer_tests.rs`·`platformer_scene/native_phase_tests.rs`, `particleVfx.test.ts` | 예제 점프/수집·충돌에서 효과까지의 결합과 화면 표시 |
| 17 | `smoke:platformer-budget` | 그냥 뺌 | 16번의 Core 상태 회귀, `runtimeProfiler.test.ts` | 실제 프레임·draw·텍스처·physics 비용 |
| 18 | `smoke:physics-sandbox` | 보강 | Core `sandbox_scene_tests.rs`와 `unifiedPhysics*Wasm.test.ts` | 기본 실험 장면의 긴 재생·정지/초기화 명령이 실제 SDK와 연결되는지와 DPR·라인·픽셀 |
| 19 | `smoke:physics-sandbox-budget` | 그냥 뺌 | 18번의 Core 상태 회귀, `runtimeProfiler.test.ts` | 실제 시뮬레이션/렌더 시간과 디버그 렌더 비용 |
| 20 | `smoke:physics-demo-suite` | 보강 | Core `sandbox_scene_tests.rs`의 개별 장면, `physicsSpec*.test.ts`의 스펙 검증 | 카탈로그 7개 전환 후 스텝·상태 이어짐과 충돌/센서·조회 표시, 실제 렌더 |

#### S2b-2의 새 테스트 12개 남은 범위

| # | S2a 또는 기존 `validate`에서 확인 | 남은 범위 |
| --- | --- | --- |
| 11 | `test:browser-smoke-node-checks`가 sRGB 수학 기준 벡터 6개를 검사 | 계획에 적힌 Node 이동은 완료. GL·GPU 합성과 픽셀 비교는 로컬 |
| 13 | `unifiedPhysics*Wasm.test.ts`의 강체 상태 및 `gameStateSnapshot.test.ts`의 pause/restore 계약 | Playground 시나리오를 실제 스펙으로 부팅해 엔티티 수·재질 속도·pause·reset을 한 번에 확인 |
| 14 | `validate:example-catalog`와 `test:browser-smoke-node-checks`가 카탈로그·9-slice/그림자 fixture 재생성 검사 | 기능 예제별 결정적 상태 표본. 보기·탭·오디오·복구 렌더는 로컬 |
| 15 | `validate:example-catalog`의 데이터 정합, SDK 화면 맞춤 단위 테스트 | 사이트 실제 그룹·검색·ko/en과 예제별 fit 선택. `main.ts`의 화면 이벤트와 필터 계산을 분리할 지점 확인 |
| 19 | `test:browser-smoke-node-checks`의 `validatePixelArtProfile` | 쇼케이스 고정 입력에서 엔티티·수집 수 확인 |
| 23 | `test:placement-asset-cleanup`의 참조 보호·진단·백업 | Studio 대화상자에서 쓰는 차단 사유와 우선순위를 순수 로직으로 분리해 검사 |
| 26 | `test:tile-assets`가 원본 프레임·duration·autotile 출력과 저장 metadata를 검사 | 실제 프레임 변환의 경계 전·경계·loop/no-loop 시각을 렌더 픽셀 없이 확인 |
| 27 | Core 경사·투사체·AI 회귀와 실제 Wasm 개별 기능 검사 | 마을 32명 입력으로 AI·발사·경사 트레이스와 저장/복원 연속성을 한 장면에서 확인 |
| 28 | `dataSceneNativeCombatNavigation.test.ts`, `spatialModelAssembly.test.ts`, Core 전투/투사체/경로 회귀 | 216개 모델/32명으로 장면 등록·시간 진행·히트 결과를 한 시나리오에서 확인 |
| 31 | `renderTexture.test.ts`의 자원 소유·입력·실패·통계 | `WebGL2Renderer.renderToTexture` 자체의 실패 원자성·stat·복구 설정의 빈 부분. 실제 FBO 방향·합성은 로컬 |
| 32 | `colorManagement.test.ts`의 변환·모드 충돌·입력·WebGPU context 전에 거절 | 작업 색 버퍼와 출력 옵션 전달이 테스트에서 이미 동일한 경로인지 대조한 뒤 비어 있는 값만 추가 |
| 33 | `pixelPerfect.test.ts`의 설정·DPR 좌표 계산·거절, `placement-spatial-camera.test.mjs`의 좌표 수학 | 복구 뒤 픽셀 설정 유지, Game Preview 종료 후 편집 카메라 복원. 실제 픽셀·DPR은 로컬 |


#### 검증과 CI 시간

- `pnpm test:web`은 기존 소스와 일치하는 Wasm으로 293개 SDK 테스트 파일을 통과했다(로컬 44.31초).
  별도 패턴 실행으로 추가 SDK 회귀 5건과 Node 회귀 6건을 확인했다.
- `node --test tests/smoke/placement-*.test.mjs`, `pnpm test:placement-scenes`,
  `pnpm test:placement-inspector`, `pnpm test:placement-asset-cleanup`, `pnpm test:tile-assets`,
  `pnpm test:pixel-authoring`(279건), Studio 빌드, 문서 링크 검사를 통과했다.
- `pnpm test:browser-smoke-node-checks`와 `pnpm validate:example-catalog`도 통과했다.
  로컬 샌드박스에서 임시 프로젝트의 자식 프로세스에 EPERM이 나므로 Node 검사와 픽셀 묶음은
  권한을 허용해 다시 실행했다.
- 추가 테스트 본문의 로컬 소요 시간은 합계 약 3.7초였다. 기존 단계와 파일을 재사용하므로
  PR `validate`의 증가량은 약 **3~8초**로 추정한다. GitHub 러너에서는 이번 커밋을 실행하지 않았다.

#### 원래 smoke의 로컬 결과

동일 소스의 기존 Wasm으로 Studio 표준·저장 활성 빌드를 준비했다. 브라우저는 로컬 Chromium 148이며,
시간은 준비 빌드를 제외한 벽시계 시간이다. 각 원래 명령에 30분 상한을 적용했고 명령과 단언은 유지했다.

| # | 실행 | 결과 | 시간 | 확인 내용 |
| --- | --- | --- | ---: | --- |
| 1 | `pnpm smoke:unified-physics-web` 첫 실행 | 실패 | 32초 | 군중 p95 스텝 11.38 ms(한도 11 ms). 다른 smoke와 함께 실행했다. |
| 1 | `pnpm smoke:unified-physics-web` 단독 재실행 | 통과 | 42초 | — |
| 1 | `pnpm smoke:scene-physics` | 통과 | 2분 54초 | 씬 물리와 Studio 편집/적용 둘 다 통과. |
| 2 | `browser-render-smoke.mjs --mode=studio apps/studio/dist` | 통과 | 15분 3초 | — |
| 3 | `spatial-scene-browser-smoke.mjs` | 통과 | 21분 59초 | 1280×720·390×844에서 DPR 1·2 조합 4개. |
| 7 | `aseprite-assets-smoke.mjs` | 실패 | 12분 32초 | HD-2D 새 페이지의 `/resume.html` 보고서 대기 30초 초과(`aseprite-assets-smoke.mjs:1090`). |
| 21 | `aseprite-project-smoke.mjs --pixels` | 실패 | 1분 13초 | 2D 저장·재열기 뒤 노멀 생성에서 `Asset unavailable`(`pixel-normals-smoke.mjs:45`). |
| 21 | `aseprite-project-smoke.mjs --pixels --pixel-opacity-only` | 통과 | 11분 28초 | — |
| 21 | `aseprite-project-smoke.mjs --pixels --pixel-blend-only` | 통과 | 7분 33초 | — |
| 21 | `aseprite-project-smoke.mjs --pixels --pixel-indexed-only` | 실패 | 16초 | 2D 노멀 생성에서 `Asset unavailable`(`pixel-indexed-smoke.mjs:40`). |
| 25 | `aseprite-assets-smoke.mjs --tiles --autotile` | 통과 | 2분 12초 | 64·512·2,048셀. |
| 25 | `aseprite-project-smoke.mjs --tiles --autotile` | 통과 | 20분 36초 | 저장 활성 Studio에서 Tiled·LDtk의 2D 저장·재열기와 HD-2D 조합 2개. |

처음 Studio 표준·저장 활성 빌드는 동작을 분리하기 전에 만들었으며, 분리 후 Studio 표준 빌드도
확인했다. Aseprite 재개 대기와 픽셀 노멀 생성 실패는 이 기준 빌드에서 재현됐다. indexed는 6초 걸린
재실행에서도 같은 `Asset unavailable`이 나왔다. 로컬 스크립트와 원래 단언을 그대로 두었으며
실패 이후의 브라우저 단언은 확인되지 않았다.

- **픽셀 노멀 생성 실패의 원인은 환경이다.** 이 smoke는 `placementNormalGeneratorPlugin()`으로 실제
  노멀 생성 도구를 제공한다. 실행한 PC에 도구 번들(`artifacts/tools/sprite-normals/<revision>/wasm-web`)이
  없어 경로가 503을 돌려줬고, Studio가 `Asset unavailable`을 표시했다. 다시 확인하려면 먼저
  `pnpm normals:install && pnpm normals:wasm:build`로 도구를 준비한다. 외부 소스를 받아 빌드한다.
  노멀을 거치지 않는 opacity·blend 변형은 통과했다.
- **Aseprite HD-2D 재개 대기 초과의 원인은 확인하지 못했다.** 동작 분리 전 빌드에서도 재현되므로
  S2b-1 변경과는 무관하다. 브라우저 검사가 CI에서 끝까지 돌지 않은 기간에 생긴 회귀일 수 있어
  별도로 조사한다.

### S2b-2 결과 (2026-11-29)

기준은 S2b-1 브랜치(`7d8e2372`)다. 새 테스트 12개를 모두 옮겼고, 확장 "보강" 9단계 중 4단계를
옮겼다. 원래 smoke와 단언은 로컬 스크립트에 그대로 두었다. Rust/Wasm·vendor·의존성은 바꾸지 않았다.

**브라우저 없이 렌더러를 돌리는 방법.** `packages/ferrum-web/test/fakeWebGL2TestHelper.ts`가 WebGL2
컨텍스트를 흉내 낸다. 렌더러가 저장·복원하는 상태(프레임버퍼, viewport, clear 색, mask, scissor)와 GPU
자원 생성·해제를 기록하고, 래스터화는 하지 않는다. 그래서 실제 `WebGL2Renderer`의 검증·상태 복원·통계·
자원 수명을 Node에서 확인할 수 있고, 픽셀 결과는 계속 브라우저 smoke가 본다. 게임 시나리오는 실제
네이티브 Wasm 엔진과 RAF를 손으로 돌리는 가상 시계로 실행한다.

| # | 원래 smoke | 단위 테스트 | 브라우저에 남는 확인 |
| --- | --- | --- | --- |
| 11 | `flat-lighting-contract-smoke.mjs` | S2a의 `test:browser-smoke-node-checks`(sRGB 기준 벡터) | 셰이더 합성, GL↔GPU 일치 |
| 13 | `engine-playground-smoke.mjs` | `enginePlaygroundScenario.test.ts`: 실제 놀이터 장면에서 키 1회 이동·걷기 클립, 일시정지 정지, 전지 3개 수집, 고무공 벽 충돌 뒤 계속 이동, 공 정지·재개, 점토가 고무보다 빨리 감속, 다시 시작 | 픽셀 변화(노멀·조명·효과), 화면→카메라 좌표, 좁은 화면 |
| 14 | `feature-examples-smoke.mjs` | `featureExamplesScenario.test.ts`: Data Scene 기능 장면 28개 모두 검증 통과, 네이티브 Playing 시작, 저작 인스턴스 수, 명령 400개 이하, 스프라이트 명령 또는 공간 패킷, 같은 프레임을 준 두 엔진의 결과 동일 | 예제 부팅·렌더, 탭·사이드바, 오디오, 복구, 기능별 조작(`featureExtras.ts`)과 Game Spec 슈터 3개 |
| 15 | `example-site-smoke.mjs` | `examples/site/src/listing.ts`로 목록·검색 분리, `test:example-site`: 그룹 순서·개수, 첫 화면 구역, 두 언어 검색, 카탈로그 데이터(문구·관찰 항목·소스·썸네일) | 레이아웃, 폰트, 포커스, 드래그, WebGL 해제 |
| 19 | `pixel-showcase-smoke.mjs` | `pixelShowcaseScenario.test.ts`: 실제 정원 장면에서 걷기 클립으로 씨앗 3개 수집(250→247), 다시 시작, 일시정지 정지 | 조명·팔레트·효과 픽셀, letterbox 포인터, 레이아웃 |
| 23 | `aseprite-project-smoke.mjs --cleanup` | `placementAssetCleanupGuard.ts`로 차단 사유 분리, `placement-asset-cleanup.test.mjs`: 사유 5개의 우선순위, 읽기 전용 분석의 조건, 차단 뒤 나머지 상태를 읽지 않음 | 대화상자 흐름, 모달 레이아웃 |
| 26 | `tile-animation-smoke.mjs` | 미리보기 프레임 계산을 `placementTileAnimation.ts`로 옮김, `tile-assets.test.mjs`: 실제 맵 패치의 클립으로 프레임·주기 경계(1001 ms 포함), 반복 없는 클립 유지, 잘못된 시간 거절 | 게임 루프 타이밍 픽셀 |
| 27 | `village-game-quality-browser-smoke.mjs` | `hd2dCombatScenario.test.ts`: 브라우저 픽스처를 그대로 Node에서 실행. 적 32명 AI·발사·입자, 경사로를 오르는 입력, 멈춘 프레임의 체크포인트 복원과 재개, 자원 증가 없음 | 공간 오디오 2보이스, GPU 시간, 느린 프레임 창, 예산 |
| 28 | `hd2d-combat-browser-smoke.mjs`(전투 구간) | 같은 파일: 모델 216개와 적 0·32명에서 AI·반복 발사·명중·처치·입자·투사체 빌보드, 일시정지, v9 체크포인트, 재설정 | 입력 좌표 변환(레터박스·DPR), GPU 예산, 프레임버퍼 동일성, 적 128명 |
| 31 | `render-texture-browser-smoke.mjs` | `webgl2RenderToTexture.test.ts`: 입력 거절 뒤 통계·이미지·바인딩 불변, 호출자 상태 복원(그리기 실패 포함), 업로드 경로, 샘플링 방향 플래그, ID 소유, 크기 변경·해제·재사용과 누수 없음 | FBO 방향, alpha 합성, 실제 픽셀 |
| 32 | `color-management-browser-smoke.mjs` | `colorManagementRuntime.test.ts`: 설정 경로 4가지의 Data Scene 작업 색(적용·reapply·transition), 모드 충돌 거부 뒤에도 재생 유지, 모드별 draw 예산과 프레임 중 할당 없음, WebGPU 실패 시 관리형 WebGL2 대체 | GPU 셰이더 sRGB 정확도, 투명 캔버스 출력 |
| 33 | `flat-pixel-perfect-smoke.mjs`, `flat-pixel-perfect-viewer-smoke.mjs` | `webgl2PixelPerfect.test.ts`: 정수 배율 표시 1회, 프레임 중 변경 거절, 캡처 격리, CSS 크기와 무관한 가상 메모리, 잘못된 설정·작은 화면. `placement-scene-presentation.test.mjs`: Game Preview 진입 시 게임 카메라, 문서별 편집 카메라 복원, fit 확대와 크기 변경, letterbox 포인터 거절 | 백엔드 간 픽셀 일치, 실제 마우스·DPR, WebGPU 장치 복구 |

**확장 "보강" 9단계 중 옮긴 것.**

| # | 검사 | 처리 |
| --- | --- | --- |
| 8 | `smoke:particle-vfx` | `exampleGameEffectsScenario.test.ts`: 네이티브 엔진의 motion-trail 이미터가 거리마다 터지고 입자가 렌더 명령에 들어간다 |
| 13 | `smoke:destructible-terrain-browser` | 근거로 적었던 `smoke:destructible-terrain`이 옮겨진 Rust 테스트 이름 때문에 0개를 돌며 늘 실패하고 있었다. 경로를 고쳐 3개가 다시 돈다. 이 Rust 테스트는 CI의 `cargo test`에서 이미 실행된다 |
| 14 | `smoke:breakout-effects` | 같은 파일: 시드를 고정한 재시작 뒤 내장 Breakout이 벽돌 충돌 입자를 렌더 명령에 낸다. 같은 시드면 같은 프레임 |
| 16 | `smoke:platformer-effects` | 같은 파일: 내장 Platformer가 착지 먼지 입자를 낸다 |

**남은 확장 5단계.** `smoke:topdown`·`smoke:topdown-save-load`·`smoke:topdown-hd2d`는
`examples/topdown-shooter/src/main.ts`(2,011줄), `smoke:physics-sandbox`·`smoke:physics-demo-suite`는
`examples/physics-sandbox/src/main.ts`(1,695줄)의 화면 코드가 시나리오를 구동한다. 로직을 떼어 내려면
예제 앱을 크게 나눠야 해서 이번에는 옮기지 않았다. 게임 규칙 자체는 Rust 회귀(`shooter_snapshots.rs`,
`sandbox_scene_tests.rs`)와 CI의 gameplay replay 검사가 본다. 브라우저 smoke는 예제와 SDK의 연결을 본다.

**제품 코드 변경.** 모두 동작을 바꾸지 않는 분리다.

- `apps/studio/src/placementAssetCleanupGuard.ts`: `main.ts`의 정리 차단 검사. 문구·순서·지연 읽기 동일.
- `apps/studio/src/placementTileAnimation.ts`: 미리보기 프레임 계산과 시간 범위 검사. 도구와 미리보기가 같은 함수를 쓴다.
- `examples/site/src/listing.ts`: 목록 그룹·첫 화면 구역·검색. `main.ts`는 렌더링만 한다.

**CI 연결.** 새 SDK 테스트 8개 파일은 `pnpm test:web`, 타일·정리 테스트는 기존 `test:tile-assets`·
`test:placement-asset-cleanup`, Game Preview 테스트는 `test:placement-camera`에 들어간다. 예제 사이트
테스트는 새 스크립트 `test:example-site`로 만들어 `validate`의 예제 카탈로그 단계에 추가했다.

**검증.** `pnpm test:web`(SDK 테스트 300개 파일), `test:tile-assets`, `test:placement-asset-cleanup`,
`test:placement-camera`, `test:example-site`, Studio·예제 사이트 타입 검사와 빌드, 문서 링크 검사가
통과했다. 주요 새 테스트는 제품 코드를 일부러 바꿨을 때 실패하는 것을 확인했다(RenderTexture 상태 복원·
feedback 거절, 색 모드 전달, 타일 프레임 경계). 새 SDK 테스트는 병렬로 돌며 가장 긴 HD-2D 전투가 약 3초다.
`pnpm test:web` 전체는 로컬에서 약 22초였다. PR `validate` 증가량은 약 5~10초로 추정한다.

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

### S3 결과 (2026-11-29)

**사용자 결정(2026-11-29).** 제품 빌드에서 예제 주소(`?scene=garden`, `2d`, `village`, `hd2d`)로 열면
빈 새 2D 장면으로 시작하고, 상태 표시줄에 "이 빌드에는 예제가 없습니다. 새 2D 장면으로 시작했습니다."를 표시한다.
오류 화면으로 막지 않는다.

| 빌드 | 명령·출력 | 예제 | 첫 화면 | 장면 목록 |
| --- | --- | --- | --- | --- |
| 제품 | `build` → `apps/studio/dist` | 없음, 파일 → 예제 메뉴 없음 | 저장되지 않은 새 2D 장면 | 비어 있음 |
| 웹 데모 | `build:demo`(`--mode demo`) → `apps/studio/dist-demo` | 정원·마을 32개 파일 | 2D 정원(465개 객체) | 정원·마을 |
| 테스트 | `--mode test` | 예제 + 회귀 fixture | 회귀 fixture | 예제 + fixture |
| 개발 서버 | `vite`(데스크톱 `tauri dev` 포함) | 정원·마을 | 2D 정원 | 정원·마을 |

**구현.**
- 예제 장면 2개와 에셋 폴더 2개를 `apps/studio/public/`에서 `apps/studio/examples/`로 옮겼다. 내부 구조를 그대로 둬서
  예제가 있는 빌드의 주소는 바뀌지 않는다. `public/`에는 모든 빌드에 넣는 글꼴만 남았다.
- `apps/studio/server/exampleContent.mjs`가 빌드 모드로 예제 포함 여부를 정한다(`demo`·`test`·개발 서버만 포함).
  개발 서버는 `examples/`를 제공하고, 포함 빌드는 파일을 그대로 출력에 넣는다. 장면 목록은 포함 빌드에서 `examples/`를,
  제품 빌드에서 `public/`(글꼴만 있음)을 훑어 비어 있다.
- 제품 빌드의 시작: 데스크톱 프로젝트나 파일을 지정하지 않으면 빈 문서를 메모리에서 만들고 예제를 요청하지 않는다.
  이 장면은 파일이 없어 내보내기만 할 수 있다. 저장은 프로젝트 폴더를 연 뒤 한다. 이전에는 데스크톱 설치판이 경로 없이 시작하면
  Rust가 빌드한 PC의 저장소 경로를 열려고 했다. 이 경로는 설치한 PC에 없다.
- 빈 장면은 오브젝트를 만들지 않아 Data Scene이 켜지지 않았고, 시작 중 지면 투영 설정이 실패했다. 시작 적용에서도
  다시 적용 경로처럼 빈 문서이면 Data Scene을 명시적으로 켠다.
- 데스크톱 Rust의 개발용 기본 경로(`sample_scene_document_path`)를 `apps/studio/examples/`로 옮겼다.
- 예제 생성기(`build-lantern-garden.py`, `build-rpg-village.py`)와 예제 경로를 읽는 테스트·스크립트의 경로를 바꿨다.
  `build-lantern-garden.py --check`와 기능 예제 재생성 검사가 새 경로에서 같은 결과를 낸다.
- Pages는 `apps/studio/dist-demo`를 복사한다. `pages.yml`에 웹 데모 빌드 단계를 추가했다. 데스크톱이 쓰는 `apps/studio/dist`와 섞이지 않는다.

**검사.**
- PR CI `Studio product and web demo build contents`: `pnpm test:studio-build-variants`(검사기 자체가 잘못된 빌드를 거절하는지)와
  `check-studio-build-variants.mjs apps/studio/dist <데모>`(제품에 예제 없음, 데모에 모든 예제 파일이 그대로 있음).
- `placement-production-default-smoke.mjs`: 제품 빌드에서 예제 파일 404, 빈 장면 목록, 예제 주소 6개의 새 장면 시작과 안내,
  예제 요청 없음, 파일 → 예제 메뉴 없음. 기존 단언(정원 465개, 마을 모델 42개, 예제 메뉴, 실행·정지)은
  `smokePlacementDemoDefault`로 옮겨 웹 데모 빌드에서 실행한다.
- 릴리스 준비(`prepare-studio-release.mjs`)와 `studio-desktop-package-smoke.mjs`가 설치 파일 frontend에 예제가 없는지 확인한다.
- garden 주소에 fixture를 넣는 smoke 3개(`scene-physics`, `native-authoring-studio`, `native-template-studio`)는 웹 데모 빌드를 쓴다.
  CI는 저장을 켠 웹 데모 빌드 하나(`studio-demo-save`)를 추가로 만들어 이 smoke와 데모 기본 검사에 함께 쓴다.

**검증(로컬).** 제품·데모 빌드의 파일 비교, `node tests/smoke/studio-build-variants-smoke.mjs`(실제 브라우저, 약 25초),
CI와 같은 빌드 4개로 `browser-render-smoke.mjs --mode=studio-save`(제품·데모 검사 모두 실행)와 `native-template-studio-smoke.mjs`,
`pnpm smoke:scene-physics`(데모 빌드를 직접 만드는 경로 포함), 개발 서버의 예제 제공, `pnpm test:web`(2,099건),
`pnpm lint`, 데스크톱 Rust `placement_document` 테스트 108개와 `cargo fmt`, `test:browser-smoke-node-checks`, `test:pages-build`,
`test:github-release`, `pnpm build:pages`, `pnpm validate:pages-artifact`, 문서 링크 검사가 통과했다.

**함께 고친 것.** `pnpm validate:pages-artifact`가 `example-site-rebuild-plan.md`의 `../../examples/README.md` 링크에서
실패하고 있었다(2026-11-24부터). `docs/` 밖의 파일이라 Pages에 없다. 다른 문서처럼 GitHub 주소로 바꿨다.
이 검사는 수동 Pages 배포에서만 돌아서, 다음 배포가 이 단계에서 멈췄을 것이다.

**남은 것.** 제품 빌드에는 새 장면을 파일로 저장하는 "다른 이름으로 저장"이 없다. 지금은 프로젝트 폴더를 열어 저장한다.
설치판의 새 장면 저장 흐름은 별도 제품 결정으로 남긴다.

## Codex 작업 지시

**먼저 읽을 것:** `AGENTS.md`, 이 문서, [C1e](runtime-startup-view-plan.md#리뷰-후속-c1e-hd-2d-작성-화면-smoke), `.github/workflows/ci.yml`, `.github/workflows/language-boundaries.yml`.

**작업 단위:** S1, S1b, S1c, S2, S3를 각각 별도 커밋으로 한다(S2는 하위 묶음별로 나눠도 된다). 앞 단계가 통합 담당의 검증을 통과한 뒤 다음으로 간다.
S2는 분류표를 먼저 보고한다.

**지킬 것:**
- 브랜치는 작업마다 통합 담당이 정한다(S2a는 `chore/ci-unit-tests`). 푸시, PR 갱신, Pages 배포, 릴리스는 하지 않는다.
- Rust/Wasm 소스, vendor 파일과 새 의존성은 바꾸지 않는다(`Swatinem/rust-cache` action 추가는 S1, 저장소 `.cargo/config.toml`의 dev profile 설정은 S1c 범위다).
- 코드 주석은 영어, 문서는 한국어.
- 설계가 이 문서와 달라져야 하면 구현 전에 이유를 보고하고 문서를 먼저 고친다.

**보고:** AGENTS "Review Rule" 형식(변경 파일, 이유, 실행한 명령, 못 한 명령과 사유, 위험·후속). 결과는 이 문서의 해당 절에 남긴다.
