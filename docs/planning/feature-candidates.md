# Ferrum2D 차기 기능 후보

이 문서는 아직 구현을 시작하지 않았거나 별도 설계 승인이 필요한 신규 기능 후보만 기록한다.

구현이 코드, 테스트, 문서까지 완료된 기능은 이 문서에서 삭제하고 다음 문서로 옮긴다.

- 사용자-facing 기능과 public API: [Public API](../engine/public-api.md)
- 엔진 구조와 책임 경계: [Architecture](../development/architecture/architecture.md)
- 물리 기능 범위: [Physics Engine](../development/architecture/physics-engine.md)
- 검증 기준: [Smoke Check](../development/quality/smoke-check.md)

## 현재 활성 후보

현재 planning 문서에 남겨둘 미구현 신규 기능 후보는 없다.

새 후보를 추가할 때는 아래 형식을 사용한다.

```md
## 후보명

- 목적:
- 사용자-facing 가치:
- 제품 방향 적합성:
- 구현 범위:
- 제외 범위:
- 영향 파일:
- 검증 기준:
- 승인 필요 여부:
```

## 별도 승인 필요 범위

다음 항목은 Ferrum2D 현재 제품 범위 밖이므로, 구현 전에 별도 설계와 사용자 승인이 필요하다.

- 3D 렌더링
- 전체 게임 루프의 Web Worker 이전
- Wasm threads / SharedArrayBuffer 기본 빌드
- full visual editor 중심 개발 방식
- 멀티플레이어
- user scripting/plugin runtime
- skeletal animation
- soft body, cloth, fluid 같은 complex physics core 확장
