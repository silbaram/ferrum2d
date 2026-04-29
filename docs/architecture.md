# Ferrum2D 아키텍처 (MVP)

## 개요

Ferrum2D MVP는 다음 4개 레이어로 구성한다.

1. Rust core
2. WebAssembly 바인딩
3. TypeScript 플랫폼 레이어
4. WebGL2 렌더러

현재 상태는 **AABB + Render Command 기반 기술 데모를 통과했고, Top-down Shooter MVP를 안정화하는 단계**다.

## 레이어별 역할 분리

### 1) Rust core

- 게임 루프, 월드/엔티티 상태, 이동/충돌의 핵심 로직 담당
- 플랫폼 독립적인 순수 엔진 도메인 로직 유지
- 렌더링 API를 직접 호출하지 않고, 렌더링 명령 버퍼를 중립 포맷으로 생성

### 2) WebAssembly 바인딩

- Rust core를 브라우저에서 호출할 수 있도록 인터페이스 노출
- 메모리 경계와 데이터 전달 정책 담당
- hot path에서 entity 단위 왕복 대신 bulk buffer 교환을 우선

### 3) TypeScript 플랫폼 레이어

- 브라우저 이벤트(입력, 시간, 리사이즈 등) 수집
- WASM 모듈 로딩 및 Rust core 호출 순서 관리
- Rust core가 생성한 render command buffer를 typed array로 해석
- 예제 루프에서 score/game-over/restart 등 UI/상태 표시 계층과 연결

### 4) WebGL2 렌더러

- TypeScript 레이어가 전달한 렌더링 데이터를 실제 GPU draw call로 변환
- MVP에서는 2D 스프라이트 렌더링과 디버그 표현에 필요한 최소 기능만 유지

## 구현된 핵심 데이터 경로

1. 입력 계층이 키보드/마우스 상태를 수집한다.
2. TypeScript가 프레임마다 `set_input` + `update(delta)`를 호출한다.
3. Rust core가 월드 업데이트, 충돌 판정, 엔티티 생명주기 반영을 수행한다.
4. Rust core가 `SpriteRenderCommand` 배열을 생성한다.
5. TypeScript/WebGL2가 command buffer를 소비해 draw를 수행한다.

## 안정화 대상(Phase 10)

- shooter game state의 일관성(플레이 상태 ↔ game over ↔ restart)
- score 반영 타이밍과 표시 정책
- bullet cooldown/lifetime 튜닝
- enemy spawn/movement 튜닝
- debug overlay의 검증 정보 정리

## 설계 원칙

- Rust core와 TypeScript 레이어의 책임을 명확히 분리한다.
- Rust core는 웹 API에 직접 의존하지 않는다.
- TypeScript 레이어는 플랫폼 의존 처리 전담 계층으로 유지한다.
- MVP 범위 밖 기능(WebGPU/Worker/3D/Editor/멀티플레이어)은 구현 대상에서 제외한다.
