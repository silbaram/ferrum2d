# Planning 문서

`docs/planning`은 Ferrum2D의 신규 기능 후보, 승인 필요 기능, 제품 방향 검토 메모를 관리하는 영역이다. 구현이 확정된 기능의 사용법, public contract, 검증 기준은 `docs/engine` 또는 `docs/development`로 옮긴다.

## 현재 문서

| 문서 | 역할 |
| --- | --- |
| [신규 기능 후보](feature-candidates.md) | 외부 2D 엔진 조사 기반 신규 기능 후보, 초보용 설명, 우선순위, 승인 필요 항목 |
| [리팩토링 로드맵](refactor-roadmap.md) | SOLID/Rust/TypeScript 원칙 기반 구조 분리와 성능 개선 진행 기준 |

## 관리 규칙

- 기능 후보는 사용자-facing 가치, Ferrum2D 제품 방향, 검증 가능성을 함께 기록한다.
- 개발을 시작하려면 후보 항목을 별도 task 또는 이슈로 분리하고 범위/검증 기준을 확정한다.
- 기능이 코드, 테스트, 문서까지 완료되면 planning 문서에서 후보 상태를 삭제하거나 확정 문서 링크로 바꾼다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 3D rendering은 별도 설계/승인 전 production 코드로 구현하지 않는다.
