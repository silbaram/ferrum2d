# Ferrum2D Agent Instructions

이 문서는 Ferrum2D 저장소에서 Codex(에이전트)가 따라야 할 작업 기준이다.
목표는 반복 실수를 줄이고, MVP 범위 내에서 일관된 산출물을 만드는 것이다.

## Project Summary

Ferrum2D는 Rust + WebAssembly 기반의 2D 웹 게임 엔진이다.

아키텍처 원칙:
- Rust core: 게임 상태, 엔티티 저장, 수학/충돌, 씬 로직, 렌더 커맨드 생성 담당
- TypeScript platform layer: 브라우저 API, canvas, WebGL2, 입력 이벤트, 오디오, 에셋 로딩, Wasm 로딩 담당
- 첫 렌더러는 WebGL2로 한정
- WebGPU는 차기 단계에서 검토하되 MVP에서 구현 금지

## Repository Layout

현재 저장소의 기준 디렉터리 구조는 다음을 따른다.
- `crates/ferrum-core`
- `packages/ferrum-web`
- `examples/topdown-shooter`
- `docs`
- `scripts`

위 경로를 기준으로 문서/코드/예제를 배치하며, 구조 변경이 필요할 경우 먼저 문서 합의를 수행한다.

## Wasm Boundary Rules

Rust/Wasm ↔ TypeScript 경계에서 다음 규칙을 반드시 지킨다.
- 프레임 루프 hot path에서 entity별 JS/Wasm 왕복 호출을 금지한다.
- 데이터 교환은 개별 호출보다 bulk buffer(배열/버퍼) 기반 방식을 우선한다.
- Rust/TypeScript가 공유하는 struct는 ABI 안정성을 위해 `#[repr(C)]`를 사용한다.
- hot path에서 string/object 전달은 지양하고, 숫자형/버퍼 중심 포맷을 사용한다.
- Rust는 렌더러 API를 직접 호출하지 않고 render command 생성까지만 담당한다.
- TypeScript는 typed array view를 통해 command buffer를 소비하고 플랫폼 API를 호출한다.

## Current Milestone

현재 다음 개발 단계는 **monorepo bootstrap** 이다.

허용 범위:
- pnpm workspace 구성
- Rust crate 초기 구성
- TypeScript package 초기 구성
- Vite example 초기 구성

금지 범위:
- WebGL2 renderer 구현
- input 시스템 구현
- collision 시스템 구현
- audio 시스템 구현
- 실제 game logic 구현

## MVP Scope

MVP에서 지원해야 하는 항목:
- Rust/Wasm 엔진 업데이트 루프
- TypeScript 게임 루프
- WebGL2 스프라이트 렌더링
- Rust → TypeScript 렌더 커맨드 버퍼 전달
- 키보드/마우스 입력
- AABB 충돌
- 기본 에셋 로딩
- 기본 오디오 재생
- 씬 전환
- 2D 탑다운 슈터 예제

MVP에서 구현하지 않는 항목:
- 3D 렌더링
- WebGPU 렌더러
- 에디터
- 멀티플레이어
- Web Workers
- Wasm threads
- 복잡한 물리 엔진
- 스켈레탈 애니메이션

## Working Rules

- 한 작업(한 요청)에는 한 가지 논리적 변경만 포함한다.
- 현재 마일스톤에 필요하지 않은 대규모 추상화는 도입하지 않는다.
- 새 프로덕션 의존성은 필요성과 대안을 설명하기 전에는 추가하지 않는다.
- Rust와 TypeScript 책임 경계를 엄격히 유지한다.
- MVP에서 Rust가 WebGL API를 직접 호출하면 안 된다.
- TypeScript는 브라우저/플랫폼 상태를 제외한 게임 시뮬레이션 상태를 소유하지 않는다.
- "영리한 설계"보다 단순하고 테스트 가능한 구현을 우선한다.

## Required Checks

Rust 변경 후:
- `cargo fmt`
- `cargo clippy`
- `cargo test`

TypeScript 변경 후:
- `pnpm format` (사용 가능한 경우)
- `pnpm lint` (사용 가능한 경우)
- `pnpm test` (사용 가능한 경우)
- `pnpm build`

Wasm 브리지 변경 후:
- `wasm-pack build`
- `pnpm build`
- 가능하면 예제 실행 검증

검증 명령 실행 원칙:
- 실행 불가능한 명령은 생략하지 말고 "왜 실행 불가능한지"를 명시한다.
- 실패한 검증이 있으면 원인/영향/후속 조치를 함께 기록한다.

## Documentation Rule

아키텍처 또는 public API가 바뀌면 반드시 동기화한다:
- `docs/architecture.md`
- `docs/mvp.md` (MVP 범위 변경 시)
- `README.md` (설치/사용/구조 변경 시)

문서 작성 원칙:
- 기본 언어는 한국어를 사용한다.
- 코드 요청이 없는 단계에서는 코드보다 문서와 구조를 우선한다.

## Review Rule

작업 종료 전 반드시 포함할 내용:
- 변경 파일 요약
- 각 변경의 이유
- 실행한 명령 목록
- 실행하지 못한 명령과 사유
- 리스크 또는 후속 작업

## Commit Rule

- 커밋 메시지는 변경 의도를 분명히 드러낸다.
- 서로 무관한 변경을 한 커밋에 섞지 않는다.
- 문서 전용 변경은 문서 커밋으로 분리하는 것을 우선 고려한다.
