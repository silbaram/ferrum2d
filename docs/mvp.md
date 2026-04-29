# Ferrum2D MVP 범위

## MVP 목표
- Rust/WASM 기반 2D 웹 게임엔진의 실행 가능한 최소 골격을 검증한다.
- 단일 예제 게임(2D 탑다운 슈터)으로 엔진 구조의 유효성을 확인한다.

## 포함 범위
- 저장소 구조 확립
- 아키텍처 문서화
- Rust core ↔ WASM ↔ TypeScript ↔ WebGL2 책임 분리 정의
- MVP 예제(2D 탑다운 슈터) 요구사항 정의

## 예제 검증 시나리오(문서 기준)
- 플레이어 이동
- 기본 발사/투사체 표현
- 단순 적 개체 및 충돌 판정
- 점수 또는 생존 시간 등 최소한의 게임 진행 지표

## 제외 범위 (MVP Out-of-Scope)
- WebGPU
- Worker/멀티스레딩
- 3D
- 에디터
- 고급 툴체인(레벨 에디팅, 리소스 파이프라인 자동화 등)

## 완료 기준
- README에 프로젝트 목적 명시
- `docs/architecture.md`에 Rust core와 TypeScript 레이어 역할 분리 명시
- `docs/mvp.md`에 MVP 포함/제외 범위 명시
- AGENTS.md에 Codex 작업 규칙 명시
