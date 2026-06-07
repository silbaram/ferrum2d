---
name: ferrum-engine-reviewer
description: Ferrum2D 엔진의 코드 및 아키텍처 리뷰를 담당하며, SOLID 설계 준수 여부, Rust 소유권 및 성능 제약, TS 인터페이스 경계, Wasm ABI 안정성, browser smoke/runtime budget/CI gate 무결성을 검토합니다.
---

# Ferrum Engine Reviewer

이 스킬은 Ferrum2D 엔진의 아키텍처, 성능, 코드 설계 품질을 리뷰할 때 사용합니다. 단순한 빌드 및 린트 성공 여부(qa-agent 영역)를 넘어, 엔진 설계의 일관성과 최적화를 유지하는 역할을 합니다.

## 검토 기준 (Source Of Truth)

- 아키텍처 문서: `docs/development/architecture/architecture.md`
- 공용 API 규격: `docs/engine/public-api.md`
- Rust ECS 및 규약: `.agents/skills/rust-game-engine-conventions/SKILL.md`
- Web 플랫폼 규약: `.agents/skills/web-game-engine-platform/SKILL.md`

## 주요 리뷰 원칙

### 1. TypeScript (플랫폼 레이어) 설계 원칙
- **SOLID / SRP (단일 책임 원칙)**: `Renderer`, `AssetLoader`, `AudioManager`, `InputManager` 등의 모듈 책임이 하나로 유지되고 섞이지 않았는지 검토합니다.
- **DIP / 추상화**: 구체적인 구현 클래스보다 인터페이스/추상 계약에 의존하는지 확인합니다.
- **상태 분리**: WebGL2/WebGPU 렌더러가 게임 시뮬레이션 상태를 직접 소유하거나 수정하지 않고, 전달받은 렌더 커맨드 버퍼만 소비하는지 확인합니다.
- **시뮬레이션 배제**: 게임의 물리/상태 업데이트 로직이 TypeScript 영역에 노출되거나 중복 작성되지 않았는지 검토합니다.

### 2. Rust (코어 레이어) 설계 원칙
- **단일 책임**: `World`, `EntityStore`, `CollisionSystem`, `RenderCommandBuffer` 등의 시스템이 독립적으로 동작하는지 확인합니다.
- **명시적 소유권(Ownership)**: 데이터의 소유, 대여(Borrow), 수명이 컴파일러와 런타임 성능 관점에서 명확히 설계되었는지 확인합니다.
- **에러 핸들링**: 라이브러리/엔진 코드 전반에 `unwrap()`이나 `panic!`이 무분별하게 퍼져 있지 않고, `Result`와 `Option`을 통해 명시적으로 처리하는지 검토합니다.
- **Zero-Cost Abstraction**: 핫패스(Hot Path) 루프 내에서 불필요한 메모리 할당(Allocation)이나 동적 디스패치(Dynamic Dispatch)가 발생하지 않는지 확인합니다.

### 3. Wasm 경계 및 인터페이스 (Wasm Boundary)
- **벌크 전송(Bulk Buffer) 최적화**: 핫패스에서 Entity별로 JS/Wasm 간 왕복 호출을 하지 않고, 대용량 버퍼(Typed Array)를 통해 데이터를 주고받는지 확인합니다.
- **안정성 (repr)**: Rust와 TypeScript가 공유하는 구조체가 `#[repr(C)]` 선언과 크기 검증(Alignment/Size)을 가지고 있는지 확인합니다.
- **구현 누수 차단**: 내부 구현(`dist/*`, `pkg/*` 등)이 외부 public API에 직접 노출되어 강한 의존성을 만들지 않는지 검증합니다.

### 4. 테스트 및 문서화
- 변경 사항에 대한 단위 테스트 또는 스모크 테스트 누락 여부를 검토합니다.
- API나 아키텍처 구조의 변경이 생겼을 때, README 및 개발 문서의 동기화 여부를 체크합니다.

### 5. Browser smoke / runtime budget 검증 무결성
브라우저 runtime, renderer, 예제 smoke, profiler, CI gate가 바뀌면 다음을 별도 리뷰 항목으로 확인합니다.

- **Smoke pass 조건**: 단순 count만 보지 말고 실제 의도한 runtime 상태(`Playing`, scene loaded, restored 등)와 비용 지표(draw call, texture switch, frame/render/Rust update time, collision pair 등)를 함께 assert하는지 확인합니다.
- **Metric 연결성**: `runtime-budget-profiles.mjs`에 budget field가 추가되어도 `DebugOverlayMetrics`/`RuntimeProfiler.recordFrame(...)` sample에 실제 값이 들어가지 않으면 검증되지 않는 것으로 판단합니다.
- **Browser context 경계**: Playwright `page.waitForFunction(...)` predicate는 browser context에서 실행되므로 Node-side 상수/함수를 직접 참조하지 않고 argument로 전달하거나 literal/페이지 전역 값만 사용해야 합니다.
- **CI 연결성**: `package.json` script에 추가된 smoke가 GitHub Actions validate job 또는 의도한 aggregate script에서 실제 실행되는지 확인합니다. `smoke:check`에만 들어 있고 CI가 `smoke:check`를 호출하지 않으면 gate가 아닙니다.
- **성능 경로 포괄성**: smoke가 최적화한 hot path만 통과하고, 별도 effect/debug/post-process 경로의 O(N) pass를 회피하지 않는지 확인합니다. 회피한다면 별도 smoke/profile을 요구하거나 리스크로 기록합니다.

### 6. 서브에이전트 위임 기준
리뷰에서 서브에이전트를 사용할 때는 전체 리뷰를 통째로 맡기지 말고, 결과가 병렬로 유효한 작은 질문으로 제한합니다.

- 좋은 위임: `browser smoke가 runtime budget field를 실제 sample에 기록하는지 확인`, `renderer 변경이 WebGL2/WebGPU parity를 깨는지 확인`, `Wasm ABI/public API 노출 여부 확인`.
- 나쁜 위임: `성능/아키텍처 전체를 리뷰해줘`처럼 범위가 넓고 라인 근거가 늦게 나오는 요청.
- 서브에이전트 결과가 늦으면 최종 판단을 지연하지 말고, 로컬에서 확인한 file:line 근거만 리뷰 결과에 포함합니다.
- 서브에이전트 산출물은 참고 자료이며, 최종 finding에는 반드시 직접 확인한 파일/라인 근거를 사용합니다.

## 워크플로우

1. 변경된 파일의 영향 범위를 파악하고 Rust/TypeScript 영역으로 나눕니다.
2. 위 리뷰 원칙을 기준으로 변경 사항의 코드 구조를 심층 분석합니다.
3. 브라우저 runtime/smoke/profiler/CI가 관련되면 `Browser smoke / runtime budget 검증 무결성` 체크리스트를 별도로 적용합니다.
4. 기계적 오류(컴파일, 린트)는 `qa-agent`에 리포트를 요청하고, 자신은 아키텍처와 구조적 설계 리뷰 리포트를 작성합니다.
5. 발견된 설계 결함, 성능 병목 요소, 문서 불일치 요소를 명확히 지적하고 대안을 제시합니다.
