# Ferrum2D libm 수정 기록

libm 0.2.16 원본은 `UPSTREAM.json`의 crates.io archive SHA-256와 파일별 해시로 고정한다.
glam의 `libm` 기능이 가져오는 기존 의존성을 같은 버전 그대로 `[patch.crates-io]` local path로 연결한다.
MIT 라이선스(`LICENSE.txt`)와 원본 고지를 보존한다. 수정한 파일은 첫 줄에 Ferrum2D 수정 고지를 둔다.

- `src/math/sqrt.rs`, `src/lib.rs`: stable Rust의 wasm32에서 `sqrtf`/`sqrt`가 비트 단위 소프트웨어 구현
  (`generic::sqrt`)으로 내려가지 않게 한다. 원본은 nightly 전용 `unstable-intrinsics`일 때만 wasm
  `f32.sqrt`/`f64.sqrt` 명령을 쓴다. 0 이상 입력(`-0.0`, `+inf` 포함)은 `std`의 제곱근, 즉 같은 하드웨어
  명령으로 계산한다. IEEE 754 제곱근은 두 경로 모두 정확히 반올림하므로 결과 비트가 같다. 음수와 NaN은
  원래 generic 경로를 그대로 써서 NaN 비트도 바뀌지 않는다. 같은 조건에서 두 함수에 `#[inline]`을 붙여 glam의 inline wrapper가 호출 없이 명령에 닿게 한다.
  Rust는 부동소수 연산을 합치지 않으므로 inline은 결과 비트를 바꾸지 않는다. 다른 target과 함수는 바꾸지 않는다.
- `src/lib.rs`: path 의존성은 lint cap이 적용되지 않아, 최신 Rust가 경고하는 상류 코드의 표준 라이브러리
  이름 충돌(`unstable_name_collisions`)을 허용한다. 상류 코드는 바꾸지 않는다.
- 이유: 64명 Native 군중 profile에서 glam 경유 `libm::sqrtf`가 브라우저 CPU 시간의 약 21%를 차지했다.
  x86 native build는 원래부터 SSE `sqrtss`를 쓰므로 native 검사에서는 드러나지 않았다.
- 검증: 전체 f32 비트 패턴(2^32)에 대해 원본 libm과 수정본의 결과 비트가 같은지 wasm32-wasip1에서 비교한다.
  f64는 특수값과 무작위 표본으로 비교한다. 기존 결정성 회귀(64명 군중 405스텝 해시 등)도 그대로 통과해야 한다.
