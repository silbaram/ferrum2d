# Ferrum2D 로드맵 (Codex 작업 단위)

아래 로드맵은 기능 덩어리 중심이 아니라, Codex가 한 번의 작업 요청으로 안정적으로 처리 가능한 단위 기준으로 세분화했다.

## Phase 0: 저장소/문서 초기화 (완료)

- 프로젝트 목적 및 MVP 범위 합의
- 아키텍처 문서 초안 확정
- 초기 문서 세트 정비

## Phase 1: Monorepo Bootstrap (완료)

- `pnpm-workspace.yaml` 기준 구조 확정
- `crates/ferrum-core` Rust crate 초기화
- `packages/ferrum-web` TypeScript 패키지 초기화
- `examples/topdown-shooter` Vite 예제 초기화
- 공통 스크립트 실행 기준 및 기본 개발 명령 문서화

## Phase 2: Rust/Wasm Bridge (완료)

- Rust core와 Wasm export 최소 인터페이스 정의
- JS ↔ Wasm 메모리 경계 규칙(버퍼/포인터/길이) 확정
- command buffer 전달 포맷의 초기 타입 정의

## Phase 3: TypeScript GameLoop (완료)

- 브라우저 진입점과 엔진 부트스트랩 연결
- requestAnimationFrame 기반 게임 루프 골격 구성
- 프레임 타임(step/delta) 전달 및 lifecycle 정리

## Phase 4: WebGL2 Basic Renderer (완료)

- WebGL2 context 초기화 및 상태 관리 최소 구현
- clear/draw 기본 파이프라인 골격 구성
- 디버그용 최소 렌더 확인 경로 확보

## Phase 5: Sprite Renderer (완료)

- 스프라이트 전용 셰이더/버텍스 포맷 정의
- 텍스처 로딩 결과와 드로우 경로 연결
- MVP용 기본 스프라이트 렌더링 검증

## Phase 6: Render Command Buffer (완료)

- Rust에서 render command 생성
- TypeScript에서 typed array view로 command 해석
- draw call 배치 및 최소 검증 케이스 추가

## Phase 7: Input (완료)

- 키보드/마우스 입력 수집 계층 구현
- 입력 상태 스냅샷을 엔진 업데이트 루프에 전달
- 예제에서 이동/발사 입력 연결

## Phase 8: World/Entity (완료)

- 월드/엔티티 저장 구조 도입
- 기본 컴포넌트(Transform 등) 배치
- 프레임 업데이트 순서 정책 정리

## Phase 9: AABB Collision (완료)

- AABB 자료구조 및 충돌 판정 루틴 구현
- 충돌 이벤트 반영 규칙 정의
- 예제 게임 오브젝트 충돌 검증

## Phase 10: Top-down Shooter Stabilization (완료)

- 플레이어/적/투사체 최소 루프 안정화
- score/game over/restart 상태 흐름 완성
- bullet cooldown/lifetime, enemy spawn/movement 튜닝
- 디버그 overlay 가독성 및 검증 정보 정리

## Phase 11: Audio/Assets (미완료)

- 기본 오디오 재생 인터페이스 연결
- 이미지/오디오 에셋 로더 경로 정리
- 에셋 수명주기(로딩/실패/재시도) 최소 정책 확정

## Phase 12: Debug/Test/Docs (진행 중)

- Rust/TS 테스트 및 린트 루틴 정리
- 성능/디버그 로그 최소 도구 정비
- 아키텍처/README/로드맵 동기화 및 릴리스 체크리스트 정리
