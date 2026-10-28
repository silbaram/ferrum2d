# Ferrum2D 코드 리뷰 기준

## 목적
- MVP 개발 완료 이후 상용제품 기능 개발 단계의 일관된 코드 품질을 유지한다.
- 아키텍처 경계(Rust core / TS layer / WebGL2)를 침범하지 않도록 검증한다.
- Codex가 만든 변경사항을 다시 리뷰할 때 동일한 기준으로 결함, 리스크, 테스트 공백을 찾는다.

## 리뷰 체크리스트

### 1) 범위 적합성
- 변경사항이 현재 제품 목표, 로드맵, 사용자-facing 가치와 연결되는가?
- 별도 설계/승인 없는 Out-of-Scope(전체 게임 루프 Worker 이전/3D/Editor)가 섞여 있지 않은가?
- networking, multiplayer, complex ECS, complex physics가 승인된 제품 기능 범위 없이 끼어들지 않았는가?

### 2) 아키텍처 경계
- Rust core가 웹 플랫폼 API에 직접 의존하지 않는가?
- Rust core가 simulation state, entity, collision, game state를 소유하는가?
- TypeScript 레이어가 browser API, input, asset/audio loading, Wasm 호출 순서를 담당하는가?
- WebGL2 구현 세부사항이 renderer 내부에 캡슐화되어 있는가?
- Rust에서 render/audio command만 만들고 WebGL/Web Audio를 직접 호출하지 않는가?

### 3) JS/Wasm 경계와 ABI
- 프레임 hot path에서 entity별 JS/Wasm 왕복 호출이 없는가?
- render/audio command는 ptr/len + typed array 기반으로 소비되는가?
- Rust/TypeScript 공유 struct는 `#[repr(C)]`와 size/float count 검증을 갖추는가?
- command buffer 필드 순서, 타입, alignment 변경이 Rust/TS 양쪽에 반영되었는가?
- deprecated compatibility API가 hot path에서 과도한 allocation을 만들지 않는가?

### 4) 단순성/유지보수성
- 과도한 추상화나 조기 최적화가 없는가?
- 상용제품 기능 개발 단계에 필요한 범위 안에서 단순하고 유지보수 가능하게 작성되었는가?
- public API가 작고 명확한가?
- destroy/cleanup에서 event listener, WebGL resource, AudioContext 등 platform resource를 해제하는가?
- package entrypoint export, `exports`, `files` allowlist가 public API 문서와 일치하는가?

### 확장성·SOLID 경계

- 구현 선택을 맡는 조합 지점은 구체 class를 생성해도 된다. 외부 주입 포트에는 그 class의 private 상태를 요구하지 않는다.
- 소비자가 사용하지 않는 asset·수명 관리 method를 구현하도록 강제하지 않는다. frame renderer는 그리기 capability만 받는다.
- backend 공통 통계·카메라 계약은 중립 모듈에 둔다. WebGPU 또는 공통 API가 WebGL2 구현 파일을 계약의 소유자로 삼지 않는다.
- 미지원 capability는 일부 출력이나 GPU 상태를 바꾸기 전에 명시적으로 거부한다. 외부 소유 자원을 임의로 해제하지 않는다.
- custom 구현·테스트 대역을 구조적 객체로 연결하고 불필요한 `as unknown as` 없이 타입 검사되는지 확인한다.
- 파일 길이만 보고 분리하지 않는다. 공유 closure/소유권을 깨는 기계적 이동이나 한 구현체를 위한 registry/framework는 피한다.
- stable 공개 타입의 보장 범위를 바꾸면 Unreleased 변경 기록·migration 방법·public reference를 함께 갱신한다.

### 5) 테스트와 검증
- collision, game state, render command generation/parsing 테스트가 있는가?
- TypeScript platform 기능은 Node test runner 또는 적절한 smoke test로 검증되는가?
- WebGL2 실제 렌더링은 manual/smoke check로 문서화되어 있는가?
- Game Spec, tilemap, wave, atlas, audio policy 변경은 `pnpm validate:game-spec`와 `pnpm smoke:headless`로 확인했는가?
- 변경 후 성격에 맞게 `cargo fmt`, `cargo clippy`, `cargo test`, `pnpm lint`, `pnpm test`, `pnpm package:check`, `pnpm build`를 실행했는가?

### 6) 문서 동기화
- 구조/정책 변경 시 README 및 docs가 함께 갱신되었는가?
- 새로 합의된 제약사항이 AGENTS.md에 반영되었는가?

## 리뷰 코멘트 원칙
- 문제 지적 시 "왜 필요한지"를 함께 제시한다.
- 대안이 있다면 최소 1개 이상 제안한다.
- 제품 우선순위와 사용자 영향도를 기준으로 Must/Should/Nice-to-have를 구분한다.

## 출력 형식
- 치명적 문제
- 수정 권장 사항
- 괜찮은 점
- 바로 수정할 patch 제안
