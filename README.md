# Ferrum2D

Ferrum2D는 **Rust + WebAssembly + TypeScript + WebGL2** 조합으로 구성하는 2D 웹 게임 엔진 프로젝트다.

## 프로젝트 목적
- 웹 환경에서 실행 가능한 2D 게임 엔진의 최소 실행 가능 제품(MVP) 기반을 구축한다.
- 엔진 핵심 로직은 Rust로 작성하고, 브라우저 연동은 TypeScript 레이어에서 담당한다.
- MVP 단계에서 2D 탑다운 슈터 예제를 통해 아키텍처 타당성을 검증한다.

## 현재 상태
- 현재는 저장소 초기화 단계이며, 실제 엔진 기능 코드는 아직 포함하지 않는다.
- 문서와 디렉터리 구조를 먼저 확정하여 이후 구현 작업의 기준으로 사용한다.

## 저장소 구조
- `docs/`: 아키텍처, MVP 범위, 로드맵, 코드리뷰 기준 문서
- `crates/`: Rust 코어 및 관련 crate 위치
- `packages/`: TypeScript 패키지 및 웹 플랫폼 레이어 위치
- `examples/`: 예제 프로젝트 위치 (MVP: 2D 탑다운 슈터)
- `scripts/`: 개발/빌드 보조 스크립트 위치

## MVP 제외 범위
- WebGPU
- Worker/멀티스레딩
- 3D
- 에디터
