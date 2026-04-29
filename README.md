# Ferrum2D

Ferrum2D는 **Rust + WebAssembly + TypeScript + WebGL2** 조합으로 구성하는 2D 웹 게임 엔진 프로젝트다.

## 프로젝트 목적
- 웹 환경에서 실행 가능한 2D 게임 엔진의 최소 실행 가능 제품(MVP) 기반을 구축한다.
- 엔진 핵심 로직은 Rust로 작성하고, 브라우저 연동은 TypeScript 레이어에서 담당한다.
- MVP 단계에서 2D 탑다운 슈터 예제를 통해 아키텍처 타당성을 검증한다.

## 현재 단계
- **현재 단계:** 저장소/문서 초기화 완료
- **다음 단계:** Monorepo Bootstrap
  - pnpm workspace 구성
  - Rust crate 초기 구성
  - TypeScript package 초기 구성
  - Vite 기반 예제 초기 구성

> 현재 저장소에는 실제 엔진 코드, pnpm workspace, Rust crate, TypeScript package가 아직 포함되어 있지 않다.

## 저장소 구조(목표)
- `crates/ferrum-core`: Rust 코어 crate 위치
- `packages/ferrum-web`: TypeScript 웹 플랫폼 패키지 위치
- `examples/topdown-shooter`: MVP 예제 프로젝트 위치
- `docs/`: 아키텍처, MVP 범위, 로드맵, 코드리뷰 기준 문서
- `scripts/`: 개발/빌드 보조 스크립트 위치

## MVP 제외 범위
- WebGPU
- Worker/멀티스레딩
- 3D
- 에디터
