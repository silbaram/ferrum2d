# Ferrum2D MVP 범위

## MVP 목표

- Rust/WASM 기반 2D 웹 게임 엔진의 실사용 가능한 최소 기능 세트를 완성한다.
- 단일 예제 게임(2D 탑다운 슈터)으로 엔진 루프, 렌더링, 입력, 충돌, 게임 상태 흐름을 검증한다.

## MVP 포함 범위

- Rust core 업데이트 루프 + 월드/엔티티 상태 관리
- Rust/WASM ↔ TypeScript 간 bulk render command buffer 전달
- WebGL2 기반 스프라이트 렌더링
- 키보드/마우스 입력 수집 및 엔진 반영
- AABB 충돌 판정과 충돌 이벤트 반영
- Top-down shooter 예제(플레이어/적/투사체)
- 최소 게임 진행 상태(점수, 게임 오버, 재시작)

## MVP 제외 범위 (Out-of-Scope)

- WebGPU
- Worker/멀티스레딩
- 3D 렌더링
- 에디터
- 멀티플레이어
- 복잡한 물리 엔진(강체/관절/연속 충돌 등)

## 현재 구현 상태 (2026-04-29 기준)

| 항목                            | 상태    | 비고                                            |
| ------------------------------- | ------- | ----------------------------------------------- |
| Monorepo bootstrap              | 완료    | pnpm workspace + Rust/TS/example 구조 구성 완료 |
| Rust/Wasm bridge                | 완료    | command buffer 포인터/길이 전달 경로 동작       |
| TypeScript GameLoop             | 완료    | RAF 기반 루프와 엔진 update 호출 연결           |
| WebGL2 basic renderer           | 완료    | 기본 clear/draw 경로 구성                       |
| Sprite renderer                 | 완료    | 스프라이트 렌더링 경로 동작                     |
| Render command buffer           | 완료    | Rust 생성 → TS typed array 해석                 |
| Input (keyboard/mouse)          | 완료    | 이동/입력 반영 및 디버그 표시                   |
| World/Entity                    | 완료    | world vec-store 및 엔티티 라이프사이클 구성     |
| AABB collision                  | 완료    | bullet/enemy trigger 처리 포함                  |
| Shooter game state 완성도       | 완료    | score/game over/restart 기본 흐름 구현          |
| Bullet cooldown/lifetime 정교화 | 완료    | cooldown/lifetime 및 화면 밖 제거 정책 구현     |
| Enemy spawn/movement 고도화     | 완료    | 주기적 edge spawn 및 player chase 구현          |
| Audio/Assets 완성               | 미완료  | MVP Phase 11 대상                               |

## MVP 완료 기준 (업데이트)

- 탑다운 슈터 예제에서 플레이어 이동/발사/적 스폰/충돌/제거 루프가 동작한다.
- score, game over, restart 흐름이 사용자 관점에서 일관되게 동작한다.
- Rust가 render command를 생성하고 TypeScript/WebGL2가 이를 소비해 매 프레임 렌더링한다.
- 입력 지연/충돌 누락/엔티티 라이프사이클 오류 등 치명적 데모 결함이 없다.
- README/architecture/roadmap/AGENTS 문서가 실제 구현 상태와 동기화되어 있다.
