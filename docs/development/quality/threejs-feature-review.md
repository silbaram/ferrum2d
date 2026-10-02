# three.js 참고 렌더링 기능 개발·리뷰 결과

2026-10-03 기준 #53~#57의 로컬 구현과 가용 환경 검증을 완료했다.
반복 리뷰에서 발견한 문제를 수정했으며, 확인한 범위에 미해결 코드 finding은 없다.
이 문서는 로컬 기능 검증 결과를 기록하며, 병합·배포·원격 CI 성공을 의미하지 않는다.

## 변경 파일과 이유

| 계획 | 주요 파일 | 결과와 이유 |
| --- | --- | --- |
| [#53 RenderTexture](https://github.com/silbaram/ferrum2d/issues/53) | `webgl2RenderTarget.ts`, `webgl2RenderTextureStore.ts`, `webgl2Renderer.ts`, `spriteBatch.ts` | offscreen 결과 재사용, framebuffer 방향·상태 복구 및 명시적 수명주기 |
| [#54 색 공간](https://github.com/silbaram/ferrum2d/issues/54) | `colorManagement.ts`, `webgl2FullscreenPass.ts`, `textureManager.ts`, renderer/runtime factory | 기존 legacy 출력 유지, 선택적 linear-srgb 계산과 최종 출력 변환 |
| [#55 GPU 통계](https://github.com/silbaram/ferrum2d/issues/55) | `rendererResources.ts`, `runtimeProfiler.ts`, `runtimeFrameRenderer.ts`, `debugOverlay.ts`, 자원 owner | 자원 누수·예산 회귀를 실제 texture/buffer/program/target 수와 byte 추정으로 확인 |
| [#56 KTX2/Basis](https://github.com/silbaram/ferrum2d/issues/56) | `ktx2Texture.ts`, `ktx2Transcoder.ts`, `ktx2Worker.ts`, `webgl2CompressedTexture.ts`, vendor/build/package 검사 | 큰 atlas의 전송량/GPU 저장량 감소, lazy Worker 변환과 이미지 fallback |
| [#57 셰이더 준비](https://github.com/silbaram/ferrum2d/issues/57) | `shaderPreparation.ts`, `webgl2ShaderPrograms.ts`, `webgl2ShaderSources.ts`, 각 batch/renderer, `loadingOverlay.ts` | 선택적 async readiness, 중복 컴파일 방지, 취소·오류·부분 생성 cleanup |

파일은 `packages/ferrum-web/src` 아래에 있다. root/core export, public API manifest·문서,
아키텍처, README, minimal 예제, smoke script 및 CI workflow의 수동 validate job을 함께 동기화했다.
렌더링/에셋 플랫폼 기능이며 Rust 시뮬레이션과 render command ABI는 유지한다.

## 반복 리뷰에서 수정한 항목

- RenderTexture 방향/UV, framebuffer·viewport·blend 상태 복구, pending asset ID 충돌과 rollback.
- 색 변환과 premultiplied alpha, 내부 target의 lazy 생성, native WebGPU 지원 경계.
- 공유 texture alias의 조기 삭제 방지, 불명확한 storage를 0으로 보고하지 않는 통계 계약,
  실제 frame sample과 profiler budget 연결.
- KTX2 input 크기 streaming 제한, 실제 alpha fixture 교정, 잘못된 decoder output/GPU upload 실패 cleanup,
  같은 ID load 경쟁 및 signal/evict/destroy 후 late upload 차단, 압축 byte 추정 보존.
- shader compile/link의 중간 자원 정리, 각 batch의 부분 constructor rollback,
  첫 buffer 및 마지막 fullscreen uniform 실패 시 모든 이전 owner 정리 검증.

## 실행한 검증

| 명령 | 결과 |
| --- | --- |
| `pnpm format` | exit 0. 하위 format script가 없어 formatter 실행은 없었음 |
| `pnpm lint` | PASS |
| `pnpm test:web` | PASS, 120개 test 파일, 실패/skip 0 |
| `pnpm build` | PASS, Wasm 및 예제 빌드 포함 |
| `pnpm package:check:ferrum-web` | PASS, Wasm와 실제 tarball 필수/금지 파일 확인 |
| `pnpm validate:docs-links` | PASS |
| `pnpm validate:public-api-surface` | PASS |
| `git diff --check` | PASS |
| `node tests/smoke/render-texture-browser-smoke.mjs` | PASS, DPR 1/2 |
| `node tests/smoke/color-management-browser-smoke.mjs` | PASS, DPR 1/2 × 34 시나리오 |
| `node tests/smoke/gpu-resources-browser-smoke.mjs` | PASS, DPR 1/2 × 2모드 × 씬 전환 12회, baseline 복귀 및 최종 자원 0 |
| `node tests/smoke/ktx2-browser-smoke.mjs` | PASS, 실제 Basis Worker/ASTC upload/화질/fallback/취소/해제 |
| `node tests/smoke/ktx2-browser-smoke.mjs --bundled` | PASS, Vite Worker·decoder JS/Wasm asset URL |
| `node tests/smoke/shader-preparation-browser-smoke.mjs` | PASS, 실제 Rust Playing 1,024 commands, 동기/async 픽셀 일치·실패 정리·runtime 로딩 UI |

추가로 runtime 디렉터리에서 `pnpm pack --pack-destination /tmp/ferrum-three-consumer`를 실행하고
새 임시 npm 프로젝트에 `npm install --offline --ignore-scripts --no-audit --no-fund`로 tarball을 설치했다.
기본 npm cache가 읽기 전용이라 `--cache /tmp/ferrum-three-consumer/npm-cache`로 변경했다.
core/authoring/quality public subpath import와 lazy decoder 생성/해제가 통과했다.
`node tests/smoke/ktx2-browser-smoke.mjs --bundled --package-root=/tmp/ferrum-three-consumer/node_modules/@ferrum2d/ferrum-web`
역시 통과해 설치된 tarball의 실제 browser 변환·업로드 경로를 확인했다.

초기 테스트의 alpha 원본 오류와 Vite harness API/TLA 문제는 수정 후 재실행했다.
최종 build 경고는 선택 Cargo repository 필드 누락 및 500 kB 초과 JS chunk다. 빌드 실패는 아니다.

## 한계와 후속 검증

- 현재 브라우저는 Chromium 148/WSL2/ANGLE SwiftShader다. native KHR_parallel_shader_compile
  지원 장치 및 실제 discrete/integrated/mobile GPU는 이 환경에서 사용할 수 없어 별도 실측하지 못했다.
  지원 분기는 completion shim + 실제 GL shader와 단위 테스트로 검증했다. 성능 개선 보장으로 해석하지 않는다.
- KTX2 decoder는 lazy load지만 배포 artifact에는 JS/Wasm 약 1.1 MB가 추가된다.
  native WebGPU는 이미지 fallback이며 작은 pixel sprite는 PNG 유지가 유리하다.
- 새 Rust source/ABI와 create-game/agents template 변경이 없어 Cargo fmt/clippy/test,
  `pnpm test`의 Rust 부분 및 consumer template full matrix는 이번 TS 추가분에서 재실행하지 않았다.
  기존 Wasm은 build/package 검사로 재생성·검증했다.
- Pages rendering 경로/템플릿 변경이 없어 `build:pages`는 실행하지 않았다. 원격 CI/배포/publish도 미실행이다.
- GitHub #55~#57에 로컬 구현·검증 상태를 반영했고 원격 코드 통합 전까지 open 상태를 유지한다.

상세 수치와 계약은 [압축 텍스처](compressed-textures.md), [셰이더 준비](shader-preparation.md),
[smoke 기준](smoke-check.md), [public core API](../../engine/public-api/core.md)를 따른다.
