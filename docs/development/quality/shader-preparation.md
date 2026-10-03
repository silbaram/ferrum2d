# 셰이더 초기화 측정과 선택적 사전 준비

## 결정과 지원 범위

동기 생성 API를 유지하고 `WebGL2Renderer.create` 및 factory `shaderPreparation`을 추가했다.
로딩 UI가 renderer 준비 상태를 알 수 있고, `KHR_parallel_shader_compile` 지원 기기는
완료 상태를 확인한 뒤 link status와 uniform을 조회한다. 5개 프로그램을 미리 제출하고 재사용하므로
동기/비동기 경로 모두 program 5개, shader 10개만 만든다. frame hot path와 Rust ABI는 바뀌지 않는다.

[Khronos 확장 규격](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/)에 따라
확장 미지원에서는 status 조회의 blocking이 남는다. compile/link 호출 자체, 첫 draw의 driver 준비,
framebuffer 할당까지 제거하는 기능은 아니다. timeout은 동기 driver 호출을 중단할 수 없다.
총 wall time 단축을 기본 목표로 보장하지 않고 UI readiness/취소/해제 계약을 제공한다.

## 변경 전 기준 측정

2026-10-03 KST, WSL2 Chromium 148.0.7778.96, ANGLE Vulkan SwiftShader software GPU에서 측정했다.
KHR_parallel_shader_compile과 EXT_disjoint_timer_query_webgl2는 모두 미지원이었다.
4개 구성별 12개 fresh browser process, 각 process에서 새 context와 재사용 context로 총 96개
renderer/1,056 frames를 측정했다. canvas 128²/DPR 1, sprite 1,024개, preserveDrawingBuffer true다.

| 구성 | 새 context 생성자 median ms | 재사용 context 생성자 median ms | 첫 CPU 제출 median ms |
| --- | ---: | ---: | ---: |
| legacy 기본 | 24.51 | 5.23 | 0.72 |
| linear-srgb 기본 | 24.02 | 4.87 | 1.32 |
| legacy + 후처리 3개 | 24.46 | 4.88 | 2.20 |
| linear-srgb + 후처리 3개 | 24.64 | 4.86 | 2.22 |

생성자 수치에는 context 생성 약 6.5 ms, 버퍼·placeholder·상태 설정도 포함되어 순수 shader 시간은 아니다.
첫 frame의 동기 readPixels까지 포함한 wall time은 약 30~77 ms였지만 warm readback도 26~28 ms다.
따라서 이를 셰이더 컴파일 비용이나 GPU 실행 시간으로 간주하지 않는다.
[측정 방법과 집계 report](https://github.com/silbaram/ferrum2d/blob/main/tests/fixtures/shader-initialization-baseline.json)는 소스 artifact hash와
분포를 포함한다. GPU driver/system cache까지 제거한 cold hardware 측정은 아니다.

## 구현 후 검증

`pnpm smoke:shader-preparation`은 실제 Rust Playing Data Scene의 15-float command buffer를 사용한다.
DPR 1/2, legacy/linear-srgb, 기본/후처리 3개에서 동기/비동기 출력이 byte 단위로 같고
program 5개만 만들어지는지 검사한다. 기본 draw 1/2회, 후처리 draw 4회, steady 30 frames에서
추가 GPU 할당 0, destroy 뒤 Shader/Program/Buffer/VAO/Texture/Framebuffer 0을 확인한다.

현재 미지원 환경의 같은 browser 내 smoke에서는 동기 구성 약 5~16 ms, async 약 8~31 ms,
steady CPU 제출 P95 0.3~0.9 ms였다. async 경로에서 준비 중 timer callback 6회가 실행됐다.
이는 캐시·실행 순서·timer clamp 영향을 받는 기능 smoke 수치이며 변경 전 fresh-process 측정과
속도 비교를 하지 않는다. 미지원 환경에서 async가 더 느려질 수도 있다.
초기화 5초, CPU 제출 P95 100ms는 smoke의 hang/큰 회귀 방지 한계이며 frame SLA가 아니다.

native extension 지원 여부를 report하고 미지원 환경에서는 completion scheduling shim을 사용해
지원 분기와 실제 GL shader의 실패/취소/timeout/부분 버퍼·uniform 실패 cleanup을 검증한다.
shim은 native 병렬 컴파일 성능 검증이 아니다. 단위 테스트는 완료 전 blocking link 조회 금지,
context loss, callback 오류, partial shader allocation을 추가로 검사한다.
public runtime의 shaderPreparation과 LoadingOverlay 연결은 실제 browser로 확인한다.

모바일/실제 discrete·integrated GPU 및 native extension 지원 장치 측정은 이 환경에서 수행할 수 없어
후속 기기 matrix로 남긴다. 현재 결과만으로 모든 대표 기기의 지연 감소를 주장하지 않는다.
