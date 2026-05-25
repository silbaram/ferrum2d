---
name: ferrum-engine-reviewer
description: Ferrum2D 엔진의 코드 및 아키텍처 리뷰를 담당하며, SOLID 설계 준수 여부, Rust 소유권 및 성능 제약, TS 인터페이스 경계, Wasm ABI 안정성 등을 검토합니다.
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

## 워크플로우

1. 변경된 파일의 영향 범위를 파악하고 Rust/TypeScript 영역으로 나눕니다.
2. 위 리뷰 원칙을 기준으로 변경 사항의 코드 구조를 심층 분석합니다.
3. 기계적 오류(컴파일, 린트)는 `qa-agent`에 리포트를 요청하고, 자신은 아키텍처와 구조적 설계 리뷰 리포트를 작성합니다.
4. 발견된 설계 결함, 성능 병목 요소, 문서 불일치 요소를 명확히 지적하고 대안을 제시합니다.
