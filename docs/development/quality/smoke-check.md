# Ferrum2D Smoke Check

이 문서는 변경별 회귀 명령과 통과 기준을 관리한다. 실제 사용 계약은 [Public API](../../engine/public-api.md),
책임·버퍼 수명은 [아키텍처](../architecture/architecture.md)를 따른다.
명령의 정확한 실행 범위는 root `package.json`과 `tests/smoke/`가 기준이다.
과거 통과 횟수·작업 단계·임시 로그는 현재 검증 결과로 취급하지 않는다.

## 로컬 기본 검증

Node.js 22, pnpm 10.8, Rust stable과 wasm-pack을 준비한다. 브라우저 smoke에는 Playwright Chromium과
해당 OS 라이브러리가 필요하다. native 앱 조건은 [desktop 안내](https://github.com/silbaram/ferrum2d/blob/main/apps/studio-desktop/README.md)를 따른다.

```bash
pnpm install
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm build:wasm
pnpm --filter @ferrum2d/studio-kit build
pnpm lint
pnpm test:web
pnpm build
```

Studio Kit의 선언 타입은 `pnpm lint` 전에 생성한다. 이전 dist나 다른 commit의 Wasm으로 새 source 검증을 대신하지 않는다.
문서만 바뀌면 아래 문서 검사를 우선하고, runtime 전체 검사는 관련 코드·계약이 바뀐 경우에 실행한다.

```bash
pnpm validate:docs-links
pnpm validate:public-api-surface
pnpm build:pages
pnpm validate:pages-artifact
```

`pnpm smoke:check`는 넓은 로컬 회귀 묶음이다. 모든 선택형·실기기·native GUI 검증을 포함하는 명령은 아니다.
변경 영역에 해당하는 gate를 아래에서 선택한다. 선행 build를 생략하는 옵션은 같은 소스의 검증 결과가 있을 때만 사용한다.

## CI와 로컬 검증 차이

| Workflow | 현재 trigger와 범위 |
| --- | --- |
| `language-boundaries.yml` | PR·main push·수동 실행. 소유권 규칙/negative fixture, 현재 Wasm build, SDK tests, 실제 ABI·frame 수명 검사 |
| `ci.yml` | `workflow_dispatch` 수동 실행. Rust·native·package·SDK·browser 기본 검사와 선택형 확장 |
| `pages.yml` | 수동 Pages build·artifact 검증·배포 |
| `github-release-prepare.yml` | 수동 release 준비. 선택형 Studio OS 빌드와 서명 자료 준비; 공개 완료와 구분 |

아래의 **CI 기본 gate**는 `ci.yml`을 실행할 때 기본으로 포함되는 검사라는 뜻이다.
PR/main push마다 전체 CI·browser matrix·package consumer가 실행된다는 뜻이 아니다.
`consumer_smoke`, `extended_browser_smoke`는 명시적으로 켜는 입력이다.
기존 **tag/manual opt-in** 분류 역시 tag push 자동 실행을 뜻하지 않는다. 실제 trigger와 실행 입력을 보고서에 남긴다.

## 제품 Runtime Budget Readiness

| 영역 | 명령 | 통과 근거 |
| --- | --- | --- |
| profile·gate 정합 | `pnpm smoke:runtime-budgets`, `pnpm validate:runtime-budget-product` | profile/mode mapping·CI 연결·문서·artifact 경로 누락 거절 |
| Rust 대량 오브젝트 | `pnpm smoke:mass-objects` | 실제 scenario seed/frame/suite hash와 구조적 budget |
| 물리 | `pnpm smoke:physics`, `pnpm smoke:physics-replay` | fixed step·solid/tile candidate·CCD·debug line·collision pair와 replay state hash |
| WebGL2 기본 경로 | `pnpm smoke:starter-runtime`, `pnpm smoke:browser-budget` | 실제 렌더 frame의 metric·픽셀·입력·오디오와 budget report |
| 게임별 budget | `pnpm smoke:topdown-budget`, `pnpm smoke:topdown-mass-objects`, `pnpm smoke:topdown-tilemap-budget`, `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget` | 해당 시나리오의 native 상태·command·draw·프레임 측정 |
| WebGPU optional | `pnpm smoke:lighting-webgpu`, `pnpm smoke:material-webgpu` | capability-aware 결과. 미지원/fallback과 실제 WebGPU 통과를 구분 |

수치 상한은 `tests/smoke/runtime-budget-profiles.mjs`에 둔다. 문서에 과거 측정값을 새 상한으로 복제하지 않는다.
`RuntimeProfiler`는 실제 frame을 bounded sample로 수집한다. metric 누락이나 0으로 채운 가짜 frame을 성공으로 처리하지 않는다.
보고서 형식은 `ferrum2d.browser-smoke.runtime-budget-report`이며, 출력 위치는
`FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR`로 지정한다. CI 기본 출력은 `artifacts/browser-smoke-budgets/`다.

GPU timing의 미지원·disjoint·미측정은 숫자 0과 구분한다. Wasm capacity는 실제 사용량과 다르며,
work/sample 상한은 GPU 실행 시간과 다르다. software adapter/offscreen 결과는 실제 기기 성능이나 compositor 검증을 대체하지 않는다.
필수 WebGPU smoke에서 fallback을 성공으로 세지 않는다.

## Rust / TypeScript 역할 경계 회귀

```bash
pnpm test:language-boundaries
pnpm validate:language-boundaries
pnpm build:wasm
pnpm test:web
pnpm smoke:language-boundaries
```

실제 Wasm의 ABI·dispatch 수와 frame/sidecar 수명, native 메모리 증가, 외부 callback의 씬 교체·해제를 검사한다.
대화·퀘스트·파괴 지형의 진행을 TS가 다시 소유하거나 entity별 hot-path 호출을 추가하는 변경을 차단한다.
진단·오디오 native 작업은 borrow 전에 끝내고 effect는 GPU 소비 후 실행해야 한다.
custom renderer는 class private 상태 단언 없이 사용할 수 있어야 하며, 미지원 요청은 target 변경 전에 거절한다.
RAF 재진입, timer 종료, 외부 소유 자원 보존도 SDK integration 검사에 포함한다.

## Runtime·Data Scene·물리

| 변경 영역 | 검증 명령 | 유지할 기준 |
| --- | --- | --- |
| headless·공용 콘텐츠 | `pnpm smoke:headless`, `pnpm smoke:content-runtime` | 실제 native 상태와 lifecycle. mock 결과만으로 실행 성공 판정 금지 |
| Data Scene | `pnpm validate:data-scene-authoring`, `pnpm smoke:data-scene`, `pnpm smoke:data-scene-gameplay` | 적용/restore·stable instance id·실패 원자성·구 Wasm 진단 |
| clip·투영·태양 | `pnpm smoke:data-scene-presentation`, `pnpm smoke:sprite-animation-runtime` | 실제 frame UV·시간·이벤트·pause/완료·snapshot과 command/sidecar 정합 |
| 입력 context | `pnpm smoke:input-context`, `pnpm smoke:mobile-input` | packed 입력·modal 우선순위·release/cancel·pointer/viewport 좌표 |
| 공간 장면·전투 | `pnpm smoke:spatial-scene`, `pnpm smoke:hd2d-combat` | 높이/층·탐색·crowd·melee/dash·spawn·projectile의 native 진행과 bounded 작업 |
| 물리 작성·solver | `pnpm validate:physics-authoring`, `pnpm smoke:physics`, `pnpm smoke:physics-replay`, `pnpm smoke:physics-demo-suite` | 입력 검증, fixed step·query·joint/CCD 예산, 저장/replay 결정성 |
| gameplay 데이터·report | `pnpm validate:game-spec`, `pnpm validate:gameplay-authoring:report`, `pnpm smoke:gameplay-replay:report`, `pnpm validate:gameplay-report-artifacts` | report와 실제 실행·seed/hash·source/patch 근거 일치 |

물리의 상세 기능과 제외 범위는 [물리 기능 맵](../architecture/physics-engine.md)을 따른다.
선택형 replay Worker의 취소·stale 결과·종료 검증을 전체 게임 루프 Worker 이전의 증거로 사용하지 않는다.

## 브라우저 렌더·자원 수명

| 변경 영역 | 명령 | 핵심 기준 |
| --- | --- | --- |
| RenderTexture | `pnpm smoke:render-texture` | DPR 1/2, offscreen 1,024 sprite + main 1 sprite + fade의 3 draw, 픽셀 방향·상태 복원·resize·해제 |
| 자원 수명 | `pnpm smoke:gpu-resources` | 12회 씬 전환 후 warmup 기준값 복귀, resize·destroy와 profiler 예산 |
| 색공간 | `pnpm smoke:color-management` | legacy/linear-sRGB·alpha·조명·Bloom·fallback과 변환 중복 방지 |
| 로딩·오디오 | `pnpm smoke:asset-loading`, `pnpm smoke:spatial-audio` | 요청 공유·독립 취소·늦은 결과·resource 회수와 실제 native spatial binding |
| 셰이더 준비 | `pnpm smoke:shader-preparation` | 동기/비동기 픽셀 일치·실패 cleanup·runtime 로딩 UI. [상세 기준](shader-preparation.md) |
| 압축 텍스처 | `pnpm smoke:ktx2` | raw ESM/Vite, 실제 Worker·압축 upload·fallback·취소. [상세 기준](compressed-textures.md) |
| Spatial renderer | `pnpm smoke:spatial-webgpu-offscreen`, `pnpm smoke:spatial-webgpu-fallback` | 실제 backend별 geometry·모델·환경·효과·depth·OFF 복귀와 fallback |

### WebGPU 장치 손실 복구

`pnpm smoke:webgpu-recovery`는 실제 장치 손실 후 명시적 복구, 새 backend와 캐시 재준비,
픽셀 일치·기존 참조/handle 수명·재실패와 terminal destroy를 검사한다.
자동 재시도 UI나 모든 실제 드라이버의 복구 성공을 보장하는 검사는 아니다.

## Studio 작성·저장·업데이트

| 영역 | 명령 |
| --- | --- |
| 기본 편집·씬 탐색 | `pnpm smoke:studio`, `pnpm test:placement-scenes`, `pnpm test:placement-layers` |
| 저장·문서 수명 | `pnpm smoke:placement-document-store`, `pnpm smoke:studio-save` |
| 공간 편집·조명 UI | `pnpm smoke:placement-spatial-workspace`, `pnpm smoke:placement-village`, `pnpm test:placement-point-shadows`, `pnpm test:placement-flat-lighting` |
| 대량 편집·host assets | `pnpm smoke:studio-mass-authoring`, `pnpm smoke:studio-desktop-assets` |
| 도구·Inspector·레이아웃 | `pnpm smoke:placement-tools`, `pnpm smoke:placement-inspector`, `pnpm smoke:placement-layouts` |
| 언어·격자·카메라 | `pnpm test:placement-locale`, `pnpm smoke:placement-locale`, `pnpm test:placement-grid`, `pnpm smoke:placement-grid`, `pnpm test:placement-camera`, `pnpm smoke:placement-camera` |
| 업데이트 | `pnpm test:updates`, `pnpm test:github-release`, `pnpm smoke:studio` |

production 기본 화면과 별도 fixture build를 구분한다. 기본 화면을 테스트 fixture로 덮어쓰지 않으며,
보고서는 `productionDefault`와 `regressionBuild`의 근거를 각각 남긴다.

- picking·편집·레이어 숨김/잠금·patch·Undo/Redo와 실제 native command/화면 변화를 확인한다.
- 문서 교체·취소·실패·공유 자산의 참조 수명, 미저장 draft 보존과 stale 응답 차단을 검사한다.
- 조명 UI는 PCSS·두 점광원·Bloom·안개·빛줄기·프로브·채널을 실제 native 값·픽셀·draw로 확인한다.
  source/Undo·Play/Stop·초점을 둔 입력의 저장/재열기·잘못된 값 복원·KO/EN·390px도 검사한다.
- 숨김 객체는 렌더와 picking에서 제외되고 bulk 필터를 사용해야 한다. 언어·격자·카메라 표시 변경은 문서/history를 바꾸지 않는다.
- 저장은 source 비교·허용 경로·외부 충돌·동시 수정·실패 시 원본/임시 파일 보존을 검사한다.
  일반 browser export와 개발 서버 opt-in, native 프로젝트 저장을 구분한다.
- 업데이트는 beta 숫자 비교·draft/불완전 release 제외·checksum/URL 범위·실제 임시 consumer 설치·hook 미실행·metadata/lock 복구를 확인한다.
  Studio Kit의 이전/새 URL이 문자열이고 실제로 갱신되는지도 검사한다.

native 저장 계약은 `cargo test --manifest-path apps/studio-desktop/src-tauri/Cargo.toml`로 확인한다.
GUI 의존성이 없는 headless 계약은 `--no-default-features`로 실행할 수 있으며 실행 범위가 다름을 기록한다.
`fakeBridge`·mock Tauri·Xvfb process launch는 실제 OS picker·저장·asset protocol·interactive canvas·서명 검증을 대체하지 않는다.

### 복구 가능한 프로젝트 Catalog 정리

`pnpm test:placement-asset-usage`, `pnpm smoke:placement-asset-usage`,
`pnpm test:placement-asset-cleanup`, `pnpm smoke:placement-asset-cleanup`을 실행한다.
읽기 전용 조회의 분석 범위를 명시하고 원본/draft·동시 변경·로드 중 자산·stale 결과를 교차한다.
정리 대상 allowlist, backup·복원·재열기·Undo와 부분 실패를 검사한다.
조회에 보이지 않는 코드/외부 manifest 참조까지 안전한 삭제로 판정하지 않는다.

## 도트·외부 에셋·타일

현재 가져오기 한도·형식·저장 의미는 [Scene Authoring](../../engine/data-scene-authoring.md)에 둔다.
아래 검사는 원본과 변환 결과를 구분하고 동일 경로를 재열어 게임에서 실행하는 것을 요구한다.

| 영역 | 명령 |
| --- | --- |
| Aseprite 원본·애니메이션·trim/slice | `pnpm smoke:aseprite-assets`, `pnpm smoke:aseprite-project`, `pnpm smoke:aseprite-animation`, `pnpm smoke:aseprite-trim`, `pnpm smoke:aseprite-trim-normals`, `pnpm smoke:aseprite-slices` |
| 노멀 생성·pair·native 저장 | `pnpm smoke:sprite-normal-integration`, `pnpm smoke:aseprite-normals`, `pnpm smoke:aseprite-paired`, `pnpm smoke:aseprite-paired-project`, `pnpm smoke:native-normal-project` |
| 도트 제작·원본 저장 | `pnpm test:pixel-authoring`, `pnpm smoke:pixel-authoring`, `pnpm smoke:pixel-project` |
| 선택 편집·합성·내보내기 | `pnpm smoke:pixel-transform`, `pnpm smoke:pixel-history`, `pnpm smoke:pixel-opacity`, `pnpm smoke:pixel-blend`, `pnpm smoke:pixel-indexed`, `pnpm smoke:pixel-clipboard`, `pnpm smoke:pixel-merge`, `pnpm smoke:pixel-animation-export` |
| 외부 PNG·노멀·용량 | `pnpm smoke:pixel-import`, `pnpm smoke:pixel-normals`, `pnpm smoke:pixel-normals-project`, `pnpm smoke:pixel-capacity` |
| Tiled/LDtk | `pnpm test:tile-assets`, `pnpm smoke:tile-assets`, `pnpm smoke:tile-project`, `pnpm smoke:tile-external`, `pnpm smoke:tile-multi` |
| 전체 맵·오토타일·애니메이션 | `pnpm smoke:tile-map`, `pnpm smoke:tile-autotile`, `pnpm smoke:tile-animation` |

확정 편집·Undo/Redo·취소·원본 불변, Worker의 늦은 결과와 종료, pair/revision의 설치 참조를 검사한다.
trim은 원래 canvas·offset·pivot을 복원하고 같은 공간의 normal과 맞아야 한다. 자동 crop으로 원본을 덮어쓰지 않는다.
맵 적용은 한 번의 patch/Undo이며 미지원 입력·예산 초과가 기존 문서/catalog를 변경하지 않아야 한다.

도트 recovery는 실제 IndexedDB에서 checkpoint 호환·용량/기간 상한·scene/project 격리·다중 탭·quota/abort·pagehide를 검사한다.
미확정 stroke/선택 preview는 저장하지 않고 실패 시 이전 완료본과 수동 내보내기를 보존한다.
이 결과는 OS 전원 종료 직전 미완료 write나 실제 WebView storage 정책의 보장이 아니다.
64프레임 용량 gate는 성공 여부뿐 아니라 편집·내보내기·native 재열기와 메모리 상한을 검사한다.

## Flat 2D 표현

| 영역 | 명령 | 기준 |
| --- | --- | --- |
| normal | `pnpm smoke:sprite-normal-2d` | 실제 Wasm clip·UV·flip/회전·alpha·DPR·조명 OFF·GL 상태 복원 |
| 9-slice | `pnpm smoke:sprite-nine-slice` | 경계·작은 target·flip·clip/normal 정합과 실패 원자성 |
| 픽셀 퍼펙트 | `pnpm smoke:flat-pixel-perfect` | 정수 배율·letterbox·pointer·camera shake·snap·simulation/replay 불변 |
| 도트 후처리 | `pnpm smoke:pixel-postprocess` | target 크기·색상 수·dither·alpha/HUD·OFF 복귀·해제 |
| 도트 예제 | `pnpm smoke:pixel-showcase` | 실제 source/UI·픽셀과 예산, consumer 도트 profile과 구분 |

### PNG 아틀라스 가장자리 보호 gate

`pnpm smoke:atlas-extrusion`은 PNG 가장자리 extrusion과 실제 browser sampling을 검사한다.
인접 프레임의 색 번짐·투명 여백·회전/flip·fractional UV, normal atlas 정합과 원본 보존을 확인한다.
extrusion으로 내부 텍셀 선택의 mediump 오차까지 해결됐다고 판단하지 않는다.
큰 atlas·모바일 GPU·DPR 검증은 [후속 검증](../../planning/feature-candidates.md#평면-2d-픽셀-표현아틀라스-실기기-검증)에 별도로 남긴다.

### 평면 2D 팔레트 스왑

`pnpm smoke:sprite-palette`는 실제 WebGL2/WebGPU·DPR 1/2의 source/target 색, alpha·normal·조명,
변경/비활성 복귀, 마지막 binding의 실제 draw와 미지정 atlas sampling 보존을 확인한다.
장치 손실 후 복구·warm 자원 plateau·destroy 0을 함께 검사한다. 단순 설정 round-trip만으로 통과시키지 않는다.

## 실게임 품질과 복구·맵 작성 회귀

`pnpm smoke:village-game-quality`와 `pnpm smoke:placement-village`는 실제 마을에서
이동·전투·지형·조명·오디오·카메라와 작성/실행 전환을 확인한다.
고립된 API fixture 성공과 실제 콘텐츠의 통합 성공을 구분한다.

### 실제 마을 성능과 LOD 외형

원본/LOD를 같은 camera·해상도·효과로 비교한다. pivot·외곽선·cutout·그림자와 전환 튐을 확인하고
CPU/GPU·draw·프레임 분포를 함께 기록한다. 삼각형 수 감소를 FPS 개선으로 간주하지 않는다.
Blender tree/pine 후보는 FPS 개선이 확인되지 않아 기본 예제에 활성화하지 않는다.
목표 기기·장시간·LOD 수용 검증은 [기능 후보](../../planning/feature-candidates.md)에 남겨 둔다.

## 예제·package consumer·배포

`pnpm validate:example-catalog`, `pnpm smoke:feature-examples`, `pnpm smoke:engine-playground`,
`pnpm smoke:example-suite`로 기능 실험과 Pages의 통합 예제를 검증한다.
Start/Pause/Resume/Restart·P/Esc·터치 취소는 실제 native 시간/위치/HUD와 비교한다.
정지 중 게임 상태 불변, resize·letterbox pointer 좌표와 예제별 draw 예산을 유지한다.
Physics Lab의 `visibleBodyCount`는 조회한 body 수이며 화면 culling 측정값이 아니다.

package 변경은 `pnpm package:check` 또는 해당 package check로 tarball·declaration·Wasm·exports를 확인한다.
create-game/agents 변경에는 아래 생성/설치 검증을 추가한다.

```bash
pnpm package:check:create-game
pnpm package:check:agents
pnpm package:check:studio-kit
pnpm smoke:create-game-template-reports
pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke
pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke
```

- minimal/topdown/platformer/breakout의 실제 설치 tarball을 사용한다. workspace source import로 대체하지 않는다.
- 목적별 public subpath를 사용하고 내부 경로나 root aggregate 의존이 새로 생기지 않아야 한다.
- 생성 `studio.html`, `ferrum:studio`, `@ferrum2d/studio-kit`와 patch/handoff·공유 UI를 확인한다.
  consumer project와 consumer-smoke report는 Studio Kit 필드를 사용하는 version 2다.
- 실제 Playing 상태·entity·command·배경과 다른 픽셀을 확인한다. 12개 완료 render frame과 bounded readback 재시도를 기록하며,
  재시도 frame의 최대 draw도 예산에 포함한다. 잘못된 WebGL context·readback 실패를 성공으로 처리하지 않는다.
- 생성 프로젝트의 Vite 개발 서버와 배포 빌드를 각각 브라우저에서 확인한다. 개발 서버도 Wasm MIME·실제 프레임 기준을 적용하며,
  `developmentBrowser`에 기록한다. 공통 Vite 설정은 Wasm 상대 경로를 유지하도록 엔진 패키지를 사전 번들링에서 제외한다.
- deploy HTTP·Wasm MIME과 report artifact 검증을 수행한다. snapshot에 node_modules/dist를 포함하지 않는다.

릴리스의 SDK 네 tarball·Studio installer·checksum·서명/update metadata와 실제 native GUI 검증은
[GitHub Release 절차](../operations/github-release.md)를 따른다.
`pnpm test:github-release`, `pnpm smoke:github-release-install`, `pnpm smoke:local-engine-install`은
로컬 계약/설치 검증이며 원격 공개나 실제 OS GUI 검증의 증거가 아니다.

## 실패 기록과 증거 보관

결과에는 commit/dirty 상태, 명령·옵션, Node/Rust/Wasm/browser/backend, viewport/DPR, seed·hash,
성공·실패·skip, 실제/예상 metric, 실패 단계와 cleanup 결과를 남긴다.
미지원 capability·준비 실패·환경 부족을 성공으로 바꾸지 않는다. 실패 원인·영향·후속 조치를 함께 기록한다.

`artifacts/` 경로는 명령이 생성하는 로컬 출력 위치다. 문서에 경로가 있어도 현재 파일이 존재하거나 영구 보존된다는 뜻은 아니다.
진행 중 작업의 검토 자료와 실제 복구 backup을 유지하고, 완료 후 임시 설치·반복 로그는 정리한다.
과거 결과가 필요하면 해당 소스와 명령으로 재현한다. 화면 갱신은 [Screenshot 기준](screenshots/README.md)을 따른다.

## 조명·그림자 상세 회귀

Flat 기준선 `pnpm smoke:flat-lighting-contract`는 legacy 양 backend와 WebGL2 linear-sRGB를 DPR 1/2에서 검사한다.
검정/회색/흰 표면·빈 배경·cutout, 광원 A 차폐 시 B/ambient 보존·중복 union·HUD alpha·OFF byte 복귀를 비교한다.
legacy RGB 오차는 3 이내이며 GL premultiplied/GPU straight 차이는 각각의 독립 식으로 검증한다.
reference-only 수치 벡터와 실제 lit GPU 결과를 구분한다. 실패 주입도 부분 결과·해제·canvas 제거를 검사한다.
수학·합성 계약은 [Flat 합성](../architecture/flat-lighting-composition.md),
[Spatial 합성](../architecture/spatial-lighting-composition.md)에 둔다.
다음 세부 gate는 실제 픽셀·저장·자원 비용을 확인하며 실게임·실기기 수용은 별도다.

### Flat lit 표면 합성

최신 Wasm을 `pnpm build:wasm`으로 생성한 뒤 `pnpm smoke:flat-lit`으로 실제 양 backend의 legacy/linear-sRGB × DPR1/2를 검증한다.
색 수치·receiver/cutout·unlit 전경/HUD·광원별 차폐·OFF 비용·resize·기기 복구·destroy를 확인한다.
legacy 회귀는 `pnpm smoke:flat-lighting-contract`로 별도 유지한다. 보고서는 `artifacts/flat-lit-m2a/gpu-*/verification.json`이다.
두 명령은 수동 CI validate job에서 실행하며 보고서를 artifact로 남긴다. 이 headless 검증은 소프트웨어 WebGPU의
offscreen readback을 사용하므로 실물 GPU 성능·native canvas 표시 보장을 뜻하지 않는다.

Starter Runtime을 빌드한 뒤 `node tests/smoke/feature-examples-smoke.mjs --lighting-only`로 조명 학습 예제만 검사할 수 있다.
양 backend에서 실제 normal 반응과 새 합성 선택의 픽셀 변화, legacy 복귀, 조명 OFF, 좁은 화면과 해제 후 자원을 확인한다.
이 회귀는 기본 `pnpm smoke:feature-examples`에도 포함되며 좁은 실행의 보고서는 `artifacts/flat-lit-m2a/example/`에 남긴다.


### Flat HDR 출력 회귀

`pnpm smoke:flat-lit`은 기존 SDR fixture와 함께 Flat HDR fixture를 실행한다.
좁은 재현은 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --hdr-only`다.
실제 양 backend의 legacy/linear-sRGB × DPR1/2에서 float radiance2/4, 어두운 albedo,
노출·세 toneMapping, 선형 source/data·tint·normal/cutout, alpha·다중 월드·HUD를 수치로 검사한다.
잘못된 setter/sidecar와 활성 월드 resize는 framebuffer를 변경하기 전에 거절해야 한다.
OFF identity·추가 pass/target0, float target bytes, warm plateau, resize·pixelPerfect·WebGPU recovery,
destroy 후 자원0을 확인한다. HDR output pass는 HUD 이후에도 프레임 통계에 남아야 한다.
전체 보고서는 `artifacts/flat-lit-m2a/gpu-*/verification.json`, 좁은 실행은 `artifacts/lighting-remaining/m3b/gpu-*/verification.json`이다.
기존 CI workflow_dispatch validate job의 `smoke:flat-lit`에서 실행한다. 실게임·실기기 측정은 개발 완료 후 별도 진행한다.


### WebGPU 전역 선형 색공간 회귀

`pnpm smoke:flat-lit`은 SDR/HDR 행렬과 `webgpu-linear-browser-fixture.mjs`를 함께 실행한다.
일반 색·효과만 좁게 검사할 때는 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --color-only`를 실행한다.
양 backend × DPR1/2의 전체 RGBA readback을 비교하며 color/data/linear texture, 숫자 tint/material,
팔레트의 sRGB RGB8 키·선형 교체값, source alpha·투명 fade/vignette, Bloom threshold,
CRT/glitch/pixelArt와 효과 체인, PixelMaskTerrain 생성·patch·복구, pixelPerfect·resize·warm 자원을 검사한다.
managed 모드는 같은 backend의 기본 자원 위에 scene target1개(4 bytes/pixel)와 표시 draw1회를 추가한다.
기존 shadow fallback 같은 정적 attachment는 별도다. 이미지 업로드 texture는 target으로 집계하지 않는다.
표시 draw는 `postProcessDrawCalls`/전체 draw·texture bind에 포함하고 pixelPerfect에서는 확대 pass에 합친다.

`pnpm smoke:color-management`는 실제 WebGPU runtime의 authored 색을 Playing 상태와 native command로 검사하며
잘못된 설정/실제 adapter 초기화 실패의 fallback과 canvas 선택 경계를 유지한다.
`pnpm smoke:sprite-normal-2d`는 양 backend × 색공간 × DPR1/2에서 UV/flip/회전·가림·노멀 데이터·두 번의 장치 복구를 검사한다.

Spatial environment 회귀는 legacy/linear-sRGB 각각70개 상태 × 두 투영 × 양 backend × 두 화면 × DPR1/2다.
전체 `pnpm smoke:spatial-webgpu-offscreen`과 환경 전용 실행 모두 이 행렬을 유지한다.
선형 환경만 재현하려면 빌드 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --linear-environment-only --offscreen-target`를 실행한다.
normal/data texture, 모델 emissive/UV/reimport·저장/복원·그림자·AO/DOF/Bloom 성분 분리·HUD 뒤 최종 표시를 검사하며
허용 오차를 줄이거나 fixture를 생략해 managed 경로의 성공으로 대체하지 않는다. 실기기 성능·native canvas 표시는 개발 완료 후 별도 검증한다.


### Flat sprite Surface 재질 회귀

`pnpm smoke:flat-lit`은 SDR/HDR/색공간 회귀와 `flat-surface-browser-fixture.mjs`를 함께 실행한다.
좁은 재현은 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --surface-only`다.
실제 양 backend × legacy/linear-sRGB × DPR1/2에서 roughness GGX 수치, zero/ambient identity,
HDR emission, raw A specular·G roughness, emission sRGB 단일 변환·독립 albedo, cutout·unlit 전경,
atlas/flip/회전·normal, 두 colored point와 A만 차폐·중복 union, map 재import·warm 자원,
resize·pixelPerfect·device recovery·destroy 자원0을 확인한다.
실제 Wasm authored Playing 상태·정렬40-byte sidecar·2-frame 애니메이션과 정적 UV의 전체 이미지 일치,
안정적 asset 이름의 JSON 저장·fresh handle 복원 후 pixels 일치를 함께 검사한다.

SDK 단위 회귀는 atomic native batch·잘못된 ABI/범위/alias·memory growth·deferred copy,
잘못된 asset/profile 복원 전 기존 씬 보존·patch/Undo/Redo·map cache 무효화를 검사한다.
placement 사용처·cleanup은 세 map 이름/숫자 참조를 보호하며 desktop native cleanup도 검사한다.
단독 GPU 보고서는 `artifacts/lighting-remaining/m4b/gpu-*/verification.json`이다.
전체 명령은 기존 CI workflow_dispatch validate의 `smoke:flat-lit`에 연결되며 software adapter를 실물 성능 검증으로 세지 않는다.


Placement layer 브라우저 회귀는 개별 predicate뿐 아니라 root/child page의 locator action에도 기존 smoke timeout을 적용한다.
별도 page 정리는 같은 시간 안에 종료하며 앞선 assertion 오류를 보존한다. `pnpm test:placement-layers`는
닫기 거절·응답 없는 닫기와 기존 오류 보존을 함께 검사한다. 이 검사는 기존 수동 CI validate에 포함된다.


### Flat 독립 수신 mask 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --masks-only`로 좁게 실행한다.
`pnpm smoke:flat-lit`의 기본 행렬과 기존 수동 CI validate에도 포함된다.
양 backend × 두 색공간 × DPR1/2, SDR/HDR에서 light0/shadow0/일부/모든 채널,
점광원·태양 차폐 독립성, ambient/emission·bounded reflection, cutout/unlit 전경,
다중 packet·기본/OFF 추가 target/pass0와4-byte identity target 비용, invalid 원자성을 검사한다.
실제 Native Playing/sidecar와 JSON fresh-handle 복원 pixels, resize/pixelPerfect·device recovery·destroy도 확인한다.
단독 보고서는 `artifacts/lighting-remaining/m4c/gpu-*/verification.json`이다. 실기기 성능 증거로 확대하지 않는다.

공식 앱의 lit host 회귀는 `pnpm smoke:studio`에 포함된다. SDK/app build 후
`node tests/smoke/placement-tool-ui-runner.mjs --flat-lit`로 좁게 실행할 수도 있다.
실제 앱에서 lit 문서를 초기 적용하고 color/data 업로드, mask 편집 pixels, 늦은 map 역할 로딩,
실패한 preflight의 문서·handle·pixels 보존, 탭 복원과 Playing을 검사한다.
`pnpm test:placement-flat-lighting`은 열린 Flat/Spatial 문서의 색/data 역할 충돌·숫자 ID를 검사하며,
SDK build가 끝난 `smoke:studio` 단계에서 실행한다. 초기 scene discovery 검사는 SDK 산출물을 요구하지 않는다.

### Spatial 독립 수신 mask 회귀

SDK/Wasm build 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --receiver-masks-only --offscreen-target`로 실행한다.
기존 `pnpm smoke:spatial-webgpu-offscreen` 기본 행렬과 CI validate에 같은35개 상태를 포함한다.
양 backend·legacy/linear-sRGB·직교/원근·가로/세로·DPR1/2에서 terrain/billboard/model의
light0/shadow0/default255/부분 채널과 점광원/태양 그림자 독립성을 픽셀 기준 참조와 비교한다.
ambient/hemisphere·emission·GGX·unlit/cutout·separated AO/fog/Bloom·HUD 보존과
수신 mask를 바꿔도 caster work가 유지되는지 확인한다. 같은 asset의 서로 다른 model mask는 color instancing을 나눈다.
OFF 원본 설정의 표시 비활성, warm GPU allocation0·upload 예산, JSON fresh-handle 복원,
resize 왕복과 WebGPU loss/recovery도 검사한다. 보고서는 기존 spatial GPU `run-*/report.json`의
`environmentCases[].masks`와 `receiverChecks`에 기록한다. 소프트웨어 adapter 결과는 실기기 성능 검증으로 세지 않는다.

SDK unit은 새 receiver ptr/count/align/range·부분 ABI·memory growth·소유 복사, 생성 billboard가 authored 한도를
넘는 경우의 metadata 정렬, v7 source/selected 채널·OFF/invalid 원자성·구 Wasm의 cold 거절,
v8 patch/Undo/Redo·실제 Native Playing·JSON 새 handle 복원, 동적 uniform 할당 실패/기기 한도/수명과
color/shadow model batch 분리를 검사한다.

### Flat 2D spot 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --spots-only`로 실행한다.
기존 `pnpm smoke:flat-lit` 기본 행렬과 같은 수동 CI validate에도 포함한다.
양 backend·두 색공간·DPR1/2·SDR/HDR에서 원형360도 identity, 방향 안/밖과 penumbra,
타원 반경과 작은 방향의 world→ground projection, diffuse/GGX·emission·cutout/HUD 보존,
광원별 차폐·독립 수신 mask·선택 해제·실패한 setter 상태 보존·OFF 추가 pass/target0,
resize·WebGPU device recovery·destroy 자원0을 픽셀 비교한다.
새 Spot 보고서는 `artifacts/lighting-remaining/m4d/gpu-*/verification.json`이다.
SDK unit은 null/범위/벡터/float32 aspect·비활성 검증, JSON source와 실제 Native Playing·새 handle 복원,
구 legacy14/lit18 row의 channel/cone slot 정합성과 view 투영을 검사한다. 실제 장치 성능은 이 software adapter 결과로 판단하지 않는다.

### Flat 2D cookie 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --cookies-only`로 실행한다.
기존 `pnpm smoke:flat-lit`과 수동 CI validate의 기본 행렬에도 포함한다. 보고서는
`artifacts/lighting-remaining/m4d/cookie/gpu-*/verification.json`이며 양 backend·두 색공간·DPR1/2·SDR/HDR을 검사한다.
raw R*A의 수치 기대값, white identity·black 직접광0, rotation·UV flip·atlas 경계,
동일 이미지의 광원별 서로 다른 uniform offset, spot·수신 mask·광원별 그림자,
ambient/emission/GGX 독립성, 실패 setter 원자성·다중 packet·OFF·warm bytes·재import·resize·복구·destroy0을 비교한다.
GL은 불완전 외부 unit6 texture/mip sampler를 바인딩해 상태 복원과 기본 draw의 validation도 확인한다.

SDK unit은 source JSON·OFF·범위/float32 UV·뷰 투영과 이름→ID, 실제 Native Playing·새 handle 복원 시 재매핑,
구 capability 거절 후 자산 조회/native mutation0, invalid hash 보존을 검사한다.
GPU helper unit은32행 한도·동적 offset·warm 재사용·view 교체/퇴역, 동기 group/write 실패 재시도,
비동기 scope 실패의 자원 회수·오류 유지·destroy 수명을 검사한다.
Ferrum2D Studio의 `--flat-lit` 검사는 named cookie의 cold/늦은 data 역할, raw straight R*A 픽셀,
role 충돌 뒤 문서/handle/pixels 보존, 탭·Playing·원본 export를 검사한다.
`test:placement-flat-lighting`과 `test:placement-asset-usage`는 OFF/numeric cookie 역할과 정확한 asset pointer를 검사한다.
실게임·실기기 성능은 별도 수용 검증에서 확인한다.

### Flat 볼록 다각형 차폐 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --polygons-only`로 좁게 실행한다.
기존 `pnpm smoke:flat-lit`과 수동 CI validate의 기본 행렬에도 포함한다. 전용 보고서는
`artifacts/lighting-remaining/m4d/polygon/gpu-*/verification.json`이며 두 backend·색공간·DPR1/2·SDR/HDR에서 검사한다.
독립 ray/edge 교차 기준으로 body·그림자/비차폐 영역의 픽셀을 비교하고 raster edge의 작은 경계는 제외한다.
양 winding·max-union/부분 투과율·독립 광원/수신 mask·emission/GGX·spot/cookie·cutout/HUD,
사각형 후방 참조·내부/먼 도형 제외·in-place edit/fresh 참조·잘못된 setter 원자성·OFF/warm bytes·world 투영·resize·복구·destroy0을 검사한다.

SDK unit은 희소/교차/오목/중복/collinear/f32 퇴화·개수/좌표/투영 한도, warm shape match 검증 우회,
소유 복사·static CPU geometry revision·최대72-float clip 상한, source JSON·patch/Undo/Redo·실제 Native Playing·새 handle 복원,
구 capability 거절 후 asset lookup/native mutation0을 검사한다. Ferrum2D Studio의 `--flat-lit`은 도형 cold apply pixels와
source export·invalid import 뒤 씬/handle/history 보존·다중 문서 왕복을 함께 검사한다.
정적 GPU geometry 캐시 회귀도 같은 fixture에 포함한다. 두 광원의 warm 업로드0·vertex 양수·실제
픽셀 동등성을 검사하고, 실제 renderer 통계를 budget evaluator에 넣어 cold 업로드와 미측정을 거절한다.
여러 command packet의 vertex 합·HUD 뒤 보존·OFF·복구·destroy0을 함께 확인한다. mask draw는 계속 수행한다.
SDK unit은 GL32-source/2 MiB 한도 밖 fallback의 광원 보존·bounded 재진입, WebGPU32-source 밖 fallback,
geometry/색 무효화와 할당·쓰기 실패 후 이전 씬/재시도를 검사한다.
`FERRUM_FLAT_LIT_ARTIFACT_PARENT`로 보고서 상위를 지정할 수 있다. 선택형 `FERRUM_FLAT_LIT_PREPARED_PACKAGE`는
검증할 `dist/pkg` package snapshot을 고정한다. 보고서 `runtimePackageRoot`를 source 증거와 함께 기록하며,
미지정 시 workspace package를 읽으므로 실행 중 SDK를 다시 빌드하지 않는다.

### Native 광원 전환 회귀

`cargo test --manifest-path crates/ferrum-core/Cargo.toml light_selection`은 opt-in v8 source와
최대4개 native 슬롯의 경계 왕복·hysteresis·fade-out/swap/fade-in·전환 반전·큰/극소 dt를 검사한다.
fade 마지막 구간의 f32 나눗셈 반올림 뒤에도 capture가 restore 가능한 phase/weight를 유지하는지 확인한다.
render preview/반복 build·zero step·pause·render 생략은 이력을 진행하지 않으며 fixed-step 분할 결과가 일치해야 한다.
simulation pose로 선택하고 interpolation pose로 제출하는지, stale generation·재binding·camera cut·명시적 reset,
global OFF와 config OFF·v7 기본 동작, 같은 source/노출 편집의 이력 보존을 검사한다.

`cargo test --manifest-path crates/ferrum-core/Cargo.toml compound_light`는 normal/combat motion과
광원 history를 함께 복원하며 잘못된 history가 pose/source/기존 history를 바꾸지 않는지 확인한다.
SpatialScene clear 뒤 orphan history를 설치하지 않고 fresh handle로 combat/pose를 재매핑하는지 검사한다.
SDK의 `spatialLightSelection*.test.ts`는 source v8 ON/OFF·예약/범위·구/부분 Wasm의 자산 조회 전 거절,
diagnostic pointer/길이/슬롯/가중치·동일 buffer alias와 memory grow 뒤 재취득,
patch v9 guard·public 타입과 history JSON 소유 복사를 검사한다. 실제 Wasm에서 exploration/combat 중간 fade를
v11 JSON으로 저장하고 fresh runtime에 복원해 native history·선택 채널·감쇠 값을 비교한다.
signature/source/weight/누락/구 save version 거절 뒤 이전 progress 불변, pause 보존·정상 수렴·reset·clear도 확인한다.
실제 양 backend 전환 픽셀·profiler/report 연결은 다음 전용 gate로 검증한다. 실게임·실기기 수용 검증과 구분한다.

`pnpm smoke:spatial-light-selection`은 packed public API + 실제 Wasm의 controlled RAF clock으로
두 backend·색공간·직교/원근·DPR1/2·가로/세로 viewport·일반/pinned shadow 정책을 검사한다.
19상태의 initial/경계 왕복/각 fade leg/중간 저장·fresh handle 복원/pause/source edit/reset preview/OFF/
16 source/4 slots/resize를 실행하며, 작성된 원본 광원·native weight로 다시 만든 v7 기준 화면과 픽셀을 비교한다.
WebGPU는 동일 native history/packet의 장치 복구 픽셀도 비교한다. geometry upload0·pinned shadow warm pass0,
source별 사유와 실제 counter·resource 해제를 검사한다. 이 행렬은 기존 기본 `smoke:spatial-webgpu-offscreen`과 CI에 포함된다.
기본 viewport는640×360 CSS px 이내이며 DPR/viewport 행렬을 사용한다. 실물 장치의 실행 시간 예산을 뜻하지 않는다.

Node의 `spatial-light-selection-report.mjs`는 PNG 증거에서 fade-out/in의 실제 변화가 각각64 pixel을 넘고,
중간 복원·pause 그림이 정확히 일치하는지 추가 검사한다. 빈/변하지 않는 렌더가 상태·reference 비교만으로
통과하지 않도록 별도 negative gate test를 실행한다. 단계별 수치와 원본 PNG는 보고서에 남긴다.
실게임·실기기 수용 검증과 구분한다. shadow 작업 예산과 넓은 Bloom의 자동 검증은 각각 해당 회귀 절을 따른다.


native contribution 회귀는 `smoke:spatial-light-selection` 기본 행렬에 RGB0/direct mask0/frustum 밖
제외·실제 화면 조명 개선·dim high-intensity와 bright source 순위 대조를 추가한다. pinned owner 보존과
policy OFF의 구 순위를 같은 public source로 비교한다. authored/weight 기반 v7 픽셀 참조도 유지한다.
Native unit은 disabled v8/정확한 v7 순위, 보수적 frustum 경계·near/eye 교차·큰 반경과 pinned history 복원을 검사한다.

같은 행렬은 pixelArt512×64/64×512·snap 전환을 simulation update로 진행하여 base frustum과 실제 표시
frustum의 선택 불일치를 검사한다. native 실패 재현은 첫 render 이전 seed부터 검증한다.
좁은 재현은 SDK/Wasm build 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --offscreen-target --light-selection-presentation-only`다.
이 좁은 경로는 저장/복구를 수행했다고 보고하지 않으며, 해당 증거는 원래 전환 행렬에서 유지한다.

Presentation PNG gate는 wide view의 빨간 edge receiver가64pixel보다 많이 실제로 비춰졌는지도 검사한다.
빈/무변화 화면을 거절하는 negative unit은 기존 `test:spatial-light-selection-report`와 기본 offscreen CI에 포함된다.

### Spatial 넓은 HDR Bloom 회귀

`pnpm smoke:spatial-wide-bloom`은 패키지 public API와 실제 Wasm으로 선택형 `bloom.mode:"wide"`를 검사한다.
기존 gather는 유지하며 입력·효과 순서·비용은 [넓은 HDR Bloom 계약](../../engine/data-scene-spatial.md#선택형-넓은-hdr-bloom-개발-소스)을 따른다.
기본 `smoke:spatial-webgpu-offscreen`에도 같은 행렬과 `test:spatial-bloom-report`를 포함한다.
현재 `workflow_dispatch` CI validate가 그 aggregate를 호출하며 일반 push/PR 자동 실행을 뜻하지 않는다.

두 backend·두 색공간·직교/원근·DPR1/2·가로/세로 viewport에서 기본/안개/안개+AO의 각28상태를 검사한다.
안개 variant도 노출을 낮춘 post-fog HDR source를 독립 기준으로 사용하므로 geometry fog와 AO resolve fog 뒤의
Bloom 입력을 각각 검증한다. 안개만 좁게 검사하려면 빌드 후 `--offscreen-target --wide-bloom-fog-only`를 사용한다.
작은 HDR source와 sharp/gather/low/balanced/high, warm 재사용, strength0/OFF, threshold 소거,
exposure, 분수 반경37.5, 홀수127×95, resize 왕복, pixelArt 내부64×64 nearest 확대,
동일 frame 재제출·HUD, fresh state12 복원·구 저장 downgrade 거절, WebGPU 복구·clear/재활성화를 포함한다.
별도 합성 probe는 AO/fog/DOF 뒤 threshold와 HUD 경계·resize/복구를 검사한다.

Node gate는 기록한 PNG를 다시 해독한다. 노출을 낮춰 캡처한 HDR 입력에서 색 변환을 역산하고,
threshold를 각 source에 적용한 뒤 수직→수평 순으로 계산하는 독립 CPU 기준과 비교한다.
GPU는 수평→수직 순이다. 양자화 오차3 이내 일치, gather 반경 밖 실제 halo64pixel 초과,
입력의 비어 있지 않은 비포화 신호, OFF identity·저장/복원·복구 identity를 요구한다.
원근 홀수 extent에서 원본 raster edge가 backend마다 다르면 각 입력에 대한 oracle 차이0을 별도로 요구한다.
추가 binary-fraction source는 backend 입력 동일과 oracle 차이0을 모두 요구해 filter 오차를 이 분류로 숨기지 않는다.

품질별 실제 dedicated draw/target 수·알려진 texel bytes·texture-load 작업 상한을 공개 stats와 비교하고,
warm texture/buffer/pipeline/bind-group 할당0, OFF 추가 target/pass0, destroy 자원 해제를 검사한다.
동일 frame 두 packet의 draw/fetch 합산·target footprint 최대값과 Flat HUD 뒤 metric 보존도 확인한다.
빈 화면·halo 부재·누락 metric·warm 할당을 성공 flag만으로 통과시키지 않는 negative unit을 실행한다.
보고서는 기존 spatial GPU `run-*/report.json`의 `wideBloomCases`와 PNG다.

SDK unit은 environment v9 numeric584의 selection 존재 bit·예약 영역·raw/OFF 범위,
구 core의 자산 조회 전 거절, patch10 Undo/Redo·downgrade, state12의 exploration/combat history 원자 복원을 검사한다.
양 backend의 부분 target 할당 실패/쓰기 재시도·비동기 GPU 실패와 warm/OFF/destroy도 별도로 검사한다.
소프트웨어 adapter의 픽셀·작업량 검증이며 실게임·실물 GPU의 ms/FPS·품질 수용은 별도로 검증한다.


### Spatial 다중 점광원 그림자 회귀

`pnpm smoke:spatial-point-shadows`는 public 패키지·실제 Wasm과 WebGL2/WebGPU로
선택형 `lighting.pointShadows` 최대 2개를 검사한다. `test:spatial-point-shadows-report`의 독립 PNG 판정기
음성 테스트를 먼저 실행한다. 전체 `smoke:spatial-webgpu-offscreen`에도 같은 회귀와 판정기를 포함하며,
수동 실행 CI(`workflow_dispatch`)의 `validate` job이 해당 aggregate를 실행한다.
`extended_browser_smoke` 입력과 무관하며 일반 push/PR에서 자동 실행되지는 않는다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근을 교차한32 backend context에서976개 상태를 검사한다.
빨강·파랑 광원을 각각 차폐한 기준과 두 그림자 결과를 비교하고, 다른 광원·ambient·초록 발광 재질이 보존되는지
PNG를 다시 읽어 판정한다. terrain·cutout billboard·인스턴싱 모델2개, hard/PCF3, mask, 태양 그림자 동시13 pass,
16개 작성 광원의 owner 고정, legacy 단일/배열 단일, OFF 설정·state13 복원, resize/pixelArt,
다중→단일 설정 직후 프레임 재생성 전 모델 위치 조회,
WebGPU 실제 장치 파괴 후 복구를 포함한다. 정적 warm frame의 shadow draw/upload0과 해제 후 자원0을 요구한다.
WebGL2는 두 번째 cube 크기를 바꾼 직후 렌더 실패를 주입하고, 같은 프레임의 재시도가 해당6면을 다시 그리는지 검사한다.
SDK 회귀는 첫 cube·두 번째 cube·sun 타깃 각각의 실패 후 재시도, WebGPU abandoned encoder와 성공 후 warm 재사용을 확인한다.
실제 Wasm frame의 terrain stream을 native pointer/길이/revision이 같은 동안만 유지해 광원별 cache를 검사한다.
점광원 이동/개별 해상도6면, sun 이동/추가1면, sun 제거·sampling-only0면, owner 교환12면,
공통 caster revision/alpha texture 교체13면을 요구한다. 매 상태마다 동일 geometry의 terrain stream만 새로 만들어
강제 cold 전체12/13면 기준을 얻고 부분 갱신 PNG와 RGBA 전 채널을 비교한다.
Node 판정기는 cold PNG 누락·불완전 전체 갱신·stale pixels·잘못된 cache flag·초과 갱신도 거절한다.
model staging 단위 검사는 camera+선택 owner pass만 업로드하는 실제 byte 수를 확인한다.
같은 terrain buffer/revision에서 byteOffset만 다른 view를 제출해 GPU 업로드와 전체 cold PNG 일치를 검사한다.
SDK 회귀는 길이만 바뀌는 view도 확인하며, 효과 없는 Spatial frame의 고정 model cache 배열 할당은0이어야 한다.

보고서는 spatial GPU `run-*/report.json`의 `pointShadowCases`와 PNG다.
소프트웨어 adapter 실행은 실물 GPU 또는 제품 시간/FPS 수용 결과로 해석하지 않는다.
기존 단일 점광원·태양 그림자 회귀는 `--offscreen-target --shadows-only`로 별도 실행할 수 있다.

`pnpm test:placement-point-shadows`는 광원 삭제 후 인덱스와 설정 보존, 두 owner 상한·활성 예산,
Low/Balanced/High 품질 전환을 검사한다. `pnpm smoke:studio`와 CI에 이 단위 검증을 포함한다.
`pnpm smoke:placement-spatial-workspace`는 실제 Spatial 조명 패널 검증을 포함하며 기존 CI에서도 실행한다.
실제 패널에서 독립 offset, 세 번째 제한, Low 품질, owner/nonowner 삭제·Undo/Redo와 native 환경v10/592를 확인한다.

### Spatial 태양 PCSS 회귀

`pnpm smoke:spatial-sun-pcss`는 `test:spatial-sun-pcss-report`의 PNG 판정기 음성 테스트 뒤
public tarball·실제 Wasm·WebGL2/WebGPU를 실행한다. 전체 `smoke:spatial-webgpu-offscreen`에도
같은 테스트와 PCSS 행렬이 포함된다. 수동 실행 CI(`workflow_dispatch`)의 `validate` job이
해당 aggregate를 실행하며 `extended_browser_smoke` 입력과 무관하다.
브랜치 push만으로 해당 GPU 회귀가 자동 실행된다는 의미는 아니다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근·두 backend의32 context에서1,040개 상태를 확인한다.
수평 shadow-only 모델의 접촉0.25/중간16/분리64 world 높이, 얇은2-unit caster,
각도0/1/5·반경 제한2/16/32·해상도128/256/512/1024를 사용한다.
Node 판정기가 저장 PNG의577개 world-space 수신점 profile을 다시 읽어 접촉보다 분리 그림자가 넓고,
고정 PCF3와 구별되며 각도·반경 제한이 실제 픽셀에 반영되는지 요구한다.
각도0은 hard와 같은 PNG여야 한다. 노이즈 없는 고정 kernel의 warm frame과 카메라 복귀는 픽셀이 같아야 한다.
고정 sun center와 기본 camera-target 추적 모두 subtexel 카메라 이동은 depth map을 다시 그리지 않으며 같은 world profile의 폭을 유지한다.
경사/곡면 모델은 녹색 재질로 수신 영역을 구분해 독립 no-shadow PNG와 비교하고 self-shadow acne를 제한한다.

태양의 빨강 성분만 PCSS로 바꿔도 두 점광원의 초록/파랑은 그대로여야 한다.
sampling-only는0 shadow pass, 태양 해상도 변경은1, 두 점광원과 태양의 cold frame은13을 요구한다.
state14의 새 엔진 복원, 조명 OFF/재활성, WebGPU 장치 파괴·복구, 종료 후 자원0을 확인한다.
매 상태의 warm frame은 shadow pass/upload0이며 검사 대상의 receiver/caster geometry 통계가 양수여야 한다.
PNG 판정기는 상태 누락·빈 이미지·고정 blur·효과 없는 각도/반경·다른 색 성분 변경·warm redraw·model acne를 거절한다.
최대48 depth fetch는 shader loop의 정적 상한이며 실제 fragment 수나 GPU 시간 측정값이 아니다.

SDK/native 회귀는 환경v11 prefix·reserved tail·선택 정책·legacy/두 owner 동시 설정,
OFF 보존·입력 거절의 원자성·구 core의 자산 조회 전 거절·patch12/state14 downgrade를 확인한다.
WebGPU 두 uniform record의 PCSS tail·기존 frame 전환 시 초기화·추가 target 없음과 depth cache 재사용도 검사한다.
보고서는 Spatial GPU `run-*/report.json`의 `sunPcssCases`와 PNG다. 실게임/목표 GPU·브라우저의 FPS·품질 수용 검증은 별도다.

### Spatial 점광원 PCSS 회귀

`pnpm smoke:spatial-point-pcss`는 `test:spatial-point-pcss-report`의 독립 PNG 판정기 음성 테스트를
실행한 뒤 public tarball·실제 Wasm·WebGL2/WebGPU를 검증한다. 전체
`smoke:spatial-webgpu-offscreen`에도 포함하며 수동 CI(`workflow_dispatch`)의 `validate` job에서 실행한다.
`extended_browser_smoke` 입력과 무관하고 일반 push/PR 자동 실행을 뜻하지 않는다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근·두 backend의 32 context에서 1,264개 상태를 확인한다.
이 fixture의 canvas는 CSS 최대 640×480이며 세로 viewport에서는 390×480으로 좁아진다.
실제 drawing buffer는 DPR을 반영한다. 물체 높이 0.25/16/64, 광원 반지름 0/2/8,
기준 texel cap 2/16/32, cube 해상도 128/256/512/1024를 교차하고 width/height와 world profile을 기록한다.

PNG 판정기는 577개 world-space 수신점에서 각 위치의 no-shadow/ambient 기준으로 조명을 정규화한다.
접촉보다 분리된 그림자가 넓고, hard/PCF3와 구별되며 광원 반지름·cap이 실제 픽셀에 반영되어야 한다.
반지름 0은 hard와 같고, 해상도 변경과 subtexel camera 이동의 폭 변화는 허용 범위 이내여야 한다.
2-unit caster를 보존하며 녹색 모델 재질로 수신 영역을 구분해 경사/곡면 acne를 제한한다.
큐브 edge와 세 면 corner를 가로지르는 그림자는 중앙 누출 없이 번짐이 나타나야 한다.

빨강·초록 점광원에 PCSS를 각각 적용한 PNG와 둘 다 적용한 PNG를 대조한다.
다른 점광원과 파랑 태양 PCSS 성분이 보존되고, 두 owner의 필터가 실제로 작동해야 한다.
sampling-only 변경은 0 shadow pass, 단일 cube의 cold frame은 6, 두 cube+sun은 13을 요구한다.
매 상태의 warm frame은 shadow pass/upload 0과 동일 pixels, receiver/caster geometry 통계를 확인한다.
progress-only PCSS의 state15를 새 엔진에서 복원하고 OFF/재활성·WebGPU 실제 장치 파괴/복구·자원 0을 검증한다.
음성 테스트는 빈 신호·고정 blur·효과 없는 반지름/cap·owner 결합·두 번째 필터 무시·seam 누출·acne·warm redraw를 거절한다.

SDK/native 검증은 v12/608의 prefix·reserved tail·실제 owner 필요 조건, legacy 단일/배열 단일/두 owner,
태양 PCSS·선택·Bloom의 독립 조합, OFF source 보존과 입력 거절 원자성, 구 core의 자산 준비 전 거절,
patch13/state15 및 progress-only downgrade를 검사한다. GL uniform과 WebGPU 두 camera record의
owner 값·legacy 전환 초기화·추가 target 없음, sampling-only depth cache 재사용도 확인한다.
배열형 shadow owner의 1025개 authored billboard와 65개 terrain texture batch는 PCSS 유무 모두에서
작성/활성화 사전 검사로 거절한다. 이 회귀는 두 누락 경로를 실패 재현한 뒤 추가했다.
query당 최대 48 depth fetch는 정적 상한이며 GPU 시간 측정값으로 해석하지 않는다.
보고서는 Spatial GPU `run-*/report.json`의 `pointPcssCases`와 PNG다. 실제 게임/목표 기기의 수용 검증은 별도다.

### Spatial 높이 안개 회귀

`pnpm smoke:spatial-height-fog`는 report negative audit, Wasm/SDK build와 packed browser matrix를 실행한다.
기존 `pnpm smoke:spatial-webgpu-offscreen`에도 같은 높이 안개 행렬·DOF 순서 검사와 높이 안개/Bloom 조합이 포함된다.
현재 수동 CI(`workflow_dispatch`)의 `validate` job이 이 aggregate 명령을 실행한다.
좁은 재검증은 runner의 `--height-fog-only`, `--height-fog-precision-only`,
`--height-fog-composition-only`, `--wide-bloom-height-fog-only`를 사용한다.

두 backend × 원근/직교 × legacy/linear-srgb × desktop/모바일 크기 × DPR1/2를 검사한다.
AO fixture에는 실제 환경광을 켜고 접촉면이 어두워지는 픽셀을 요구한다. unlit 표면의 0인
indirect MRT를 합성 경로 검증으로 대신하지 않는다.
새 안개를 geometry에 적용하는 legacy/separated 경로와 separated AO resolve 경로에서
기본값·밀도0·감쇠0/미소값/큰 값·기준 높이 위/아래/교차·수평/상향 시선·시작/종료 구간을 변경한다.
별도 Node oracle은 알려진 terrain에 카메라 ray를 교차시킨 뒤 **4096구간 수치 적분**으로
PNG 혼합률을 검사한다. 셰이더의 해석적 식을 복제하지 않으며 단순 backend 일치만으로 통과시키지 않는다.
기존 선형 안개도 같은 계산으로 검사한다. 효과 target/MSAA 차이를 배제하도록 안개가 닿지 않는
선형 모드를 기준 이미지로 사용한다. 화면 안의 알려진 재질과 최소 수신점 수를 요구한다.

pixelArt의 가상 해상도·정수 확대·여백·표시 카메라를 반영한다. 두 점광원+태양 PCSS와 함께
높이 안개만 바꾸면 13개 깊이 면이 재생성되지 않아야 한다. 기존 거리 안개보다 target/buffer/pass가 늘지 않는다.
progress-only state16을 새 엔진에서 복원하고 안개 제거/재활성·WebGPU 장치 파괴/복구·destroy 자원0을 검사한다.
높이 안개/Bloom은 기존 독립 CPU Bloom reference로 gather·wide, AO, odd viewport, pixelArt,
HDR 노출·HUD·저장/복원·장치 복구를 검사한다. 작은 HDR source의 DOF 후 광도가 Bloom threshold 아래로
내려가는 별도 fixture로 높이 안개→DOF→Bloom 순서와 효과가 실제 적용된 신호를 확인한다.

`pnpm test:spatial-height-fog-report`는 빈 이미지, 무시한 밀도/감쇠/구간,
직교 시선 대신 중앙 eye ray 사용, 잘못 복원한 이미지, 빠진 상태, warm shadow redraw,
누락된 native v13과 추가 target/pass를 거절해야 한다.
같은 gate의 별도 float32 shader probe는 패키지에 실린 GLSL/WGSL helper를 직접 실행한다.
큰 기준 높이의 평행 이동, 원거리의 인접 float32 시작/종료 깊이, 얇은 아래쪽 기여, 잘린 구간의
기준 높이 교차를 독립 adaptive Simpson 적분과 비교한다. 양쪽 backend가 같은 오차를 내도 실패한다.
SDK/Rust 검증은 유한 범위·reserved tail·lighting OFF source 보존, 구 core의 자산 준비 전 거절,
patch14/state16의 downgrade 거절과 Undo/Redo, 양쪽 GPU uniform tail 초기화·두 번째 camera record를 포함한다.

현재 호스트 GPU fixture 통과는 사용자 실게임·목표 기기의 FPS 수용 검증과 구분한다.
실게임·실기기 수용 검증의 대기 조건은 [개발 후보](../../planning/feature-candidates.md#조명-수용-검증)를 따른다.

### 태양광 빛줄기 smoke

`pnpm smoke:spatial-light-shafts`는 독립 이미지 oracle의 negative audit, Wasm/SDK build와 packed browser matrix를 실행한다.
같은 행렬은 `pnpm smoke:spatial-webgpu-offscreen`과 현재 수동 CI(`workflow_dispatch`) validate job에 포함된다.
이미 준비된 패키지는 runner의 `--light-shafts-only`로 좁게 재검증할 수 있다.

WebGL2/WebGPU × 원근/직교 × legacy/linear-srgb × desktop/모바일 viewport × DPR1/2에서 검증한다.
low/balanced/high, 강도·색·밀도·거리·전방 분포, 강도0/밀도0/lighting OFF,
높이 안개·실제 ambient AO·pixelArt, progress-only 새 엔진 restore, OFF→ON 및 WebGPU device recovery가 포함된다.

Node oracle은 native camera로 시선을 구성하고, fixture의 box와 독립 ray 교차를 계산해 태양 차폐를 판정한다.
그림자 raster 경계의 불확실한 표본은 제외하고 최소 표본 수와 빛줄기의 실제 색 변화량을 요구한다.
시선 구간별 지수 적분과 저해상도 복원으로 계산한 색을 PNG와 비교하며 backend parity만으로 통과하지 않는다.
빈 결과·효과 무시·잘못된 tint·빈 배경 덮어쓰기·stale restore·빠진 상태·누락된 metric·추가 pass·warm shadow redraw를 negative audit에서 거절한다.

같은 gate는 packed GLSL/WGSL raymarch shader 전체에 통제된 depth/shadow texture를 입력하는 정밀도 검사도 실행한다.
작은 near와 원거리 depth, far plane, 거리 clamp, near 이전 종료, 매우 얇은/짙은 밀도, 직교 카메라,
비단위 native 태양 방향을 16/32/48 샘플별로 검사한다. 차폐가 없는 구간의 독립 지수 적분과 비교하며
`--light-shafts-precision-only`로 따로 실행할 수 있다. 기존 상쇄 오차·희미한 산란 누락·방향 길이에 따른 밝기 변화는
negative audit에서 거절한다. SDK 자원 테스트는 현재 오류의 target 해제와 교체·OFF 후 도착한 이전 오류의 격리를 검사한다.

별도 HDR fixture는 높이 안개+빛줄기+DOF 뒤의 sub-threshold 입력을 gather/wide Bloom이 읽는지 확인하고,
threshold0의 실제 반응·Bloom0 identity·AO 추가·resize/DPR 복원·device recovery를 검사한다.
실제 draw/target bytes/샘플/texture-load 상한이 report와 renderer/profiler에 전달되는지 확인한다.
source632/native v14·capability1·patch15/state17, 구 버전 reader와 downgrade 거절·Undo/Redo는 Rust/SDK 검사 대상이다.
실제 사용자 게임·목표 기기 품질/FPS 수용 검증은 개발 fixture 결과와 별도로 기록한다.

### 지역별 간접광 프로브 smoke

```bash
pnpm test:spatial-light-probes-report
pnpm smoke:spatial-light-probes
```

동일 검사는 `smoke:spatial-webgpu-offscreen` aggregate에도 연결된다. 이 aggregate를 호출하는
수동 GitHub Actions 경로가 gate이며, 모든 PR에서 실행된다고 주장하지 않는다.
실제 packed package를 사용하는 fixture는 WebGL2/WebGPU × orthographic/perspective ×
legacy/linear-srgb × 1280×720/390×844 × DPR1/2를 검사한다.

- 최대8개·단일·검정·겹침·역순·중복·위치 변경·영역 밖·hemisphere·조명OFF·legacy/separated·AO.
- 실제 Playing/1 entity·지형 제출, warm pixels 동일, 추가 draw/target0 및 shadow redraw/upload0.
  프로브 없이 조명 OFF·AO 경로를 먼저 준비해 WebGL2의 깊이 버퍼와 WebGPU의 지연 생성 MRT 파이프라인까지 기준 비용에 포함한다.
  texture/target/buffer/program 개수와 buffer bytes는 누락을 거절하고 복원·재활성화·device recovery까지 비교한다.
  device recovery로 AO 파이프라인 캐시가 줄어드는 것은 허용하되 추가 생성은 거절한다.
- authored 문서에는 프로브 없이 live progress만 state18로 저장한 뒤 fresh engine 복원, OFF/ON,
  WebGPU device recovery 후 픽셀 동일 및 destroy 후 texture/buffer0.
- Node의 독립 double-precision ray/box·구형 보간 oracle이 각 일반 상태에서 최소50개 위치의
  예상 RGB를 검사한다. native 지형 측면의65% vertex color와 색공간 변환도 반영한다.
- 별도 실제 모델 fixture는 diffuse 기준색, 법선 방향 독립성, unlit identity, emission·직접 diffuse·
  직접 specular 분리와 실제 model triangle 제출을 검사한다.
- 간접광만 있는 AO fixture는 접촉부가 어두워지는지와 선형 광량의10~100% 범위를 함께 검사한다.
  AO 이미지만 검게 지우거나 밝게 만드는 오류도 실패해야 한다.
- negative controls는 효과 누락·색 변경·stale restore·blank·AO 누락/검정/증광·상태 누락·cost 누락·
  전체 상태의 자원 지표 누락·추가 pass/target/buffer·shadow redraw·잘못된 count/version이 실패하는지 검사한다.

SDK/Rust는 environment v15/700·patch16/state18, bounds/reserved/unused, invalid transaction 불변,
OFF source 보존, 빈 배열, 이전 reader, 구형 core의 자원 준비 전 거절 및 GL/WebGPU uniform reset을 검사한다.
실제 문제 게임·목표 기기의 성능 인수는 이 fixture와 별도다.


### Spatial 환경 호환성 교차 검증

`pnpm --filter @ferrum2d/ferrum-web test`의 `spatialEnvironmentAbi.test.ts`는 실제 빌드된 Wasm과
독립적인15개 v1~v15 fixture를 사용한다. compiler→native→WasmBridge→renderer packet의 길이/버전
일치, 알 수 없는 버전/불일치 거절, 매 프레임 ABI getter1회와 v15→v1 전환을 확인한다.
`spatialEnvironmentFeatures.test.ts`는9개 기능의 개별 capability와 공통 채널 capability 누락을
ON/OFF 소스에서 검사한다. authoring preflight·setter·configure·progress 복원이 자산 조회나 mutation 전에
거절하는지, 지원 코어의 성공 경로·destroy 후 facade 거절·복합 patch/source/progress의 최대 저장 버전도 확인한다.
이 검사는 GPU 픽셀 회귀를 대체하지 않으며, native/renderer 경계 수정 시 기존 Spatial aggregate도 유지한다.
