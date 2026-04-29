# Ferrum2D 아키텍처 (MVP)

## 개요
Ferrum2D MVP는 다음 4개 레이어로 구성한다.

1. Rust core
2. WebAssembly 바인딩
3. TypeScript 플랫폼 레이어
4. WebGL2 렌더러

## 레이어별 역할 분리

### 1) Rust core
- 게임 루프, ECS/월드 상태(또는 이에 준하는 상태 관리), 물리/충돌의 핵심 로직 담당
- 플랫폼 독립적인 순수 엔진 도메인 로직 유지
- 렌더링 API의 직접 호출을 지양하고, 렌더링 명령/데이터를 중립 포맷으로 생성

### 2) WebAssembly 바인딩
- Rust core를 브라우저에서 호출할 수 있도록 인터페이스 노출
- 메모리 경계와 데이터 직렬화 정책 담당
- MVP에서는 단순한 데이터 교환 구조를 우선 적용

### 3) TypeScript 플랫폼 레이어
- 브라우저 이벤트(입력, 시간, 리사이즈 등) 수집
- WASM 모듈 로딩 및 Rust core 호출 순서 관리
- Rust core와 렌더러(WebGL2) 사이 어댑터 역할 수행

### 4) WebGL2 렌더러
- TypeScript 레이어가 전달한 렌더링 데이터를 실제 GPU draw call로 변환
- MVP에서는 2D 스프라이트/기본 도형 렌더링에 필요한 최소 기능만 고려

## 설계 원칙
- Rust core와 TypeScript 레이어의 책임을 명확히 분리한다.
- Rust core는 웹 API에 직접 의존하지 않는다.
- TypeScript 레이어는 플랫폼 의존 처리 전담 계층으로 유지한다.
- MVP 범위 밖 기능(WebGPU/Worker/3D/Editor)은 설계만 암시하고 구현 대상에서 제외한다.
