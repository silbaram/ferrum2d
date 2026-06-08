# Planning 문서

`docs/planning`은 Ferrum2D의 미구현 신규 기능 후보, 승인 필요 기능, 리팩토링 후보를 관리하는 영역이다. 구현이 완료된 기능의 사용법, public contract, 검증 기준은 `docs/engine` 또는 `docs/development`로 옮기고 planning 문서에서는 삭제한다. 단, 장기 roadmap에서 다음 slice의 근거가 되는 결정 로그와 완료 기록은 남길 수 있으며, 이 경우 운영 계약의 source of truth는 확정 문서임을 명시한다.

## 현재 문서

| 문서 | 역할 |
| --- | --- |
| [신규 기능 후보](feature-candidates.md) | 아직 구현하지 않은 신규 기능 후보와 승인 필요 항목 |
| [리팩토링 로드맵](refactor-roadmap.md) | 아직 진행하지 않은 구조 분리와 성능 개선 후보 |

## 관리 규칙

- 기능 후보는 사용자-facing 가치, Ferrum2D 제품 방향, 검증 가능성을 함께 기록한다.
- 개발을 시작하려면 후보 항목을 별도 task 또는 이슈로 분리하고 범위/검증 기준을 확정한다.
- 기능이 코드, 테스트, 문서까지 완료되면 사용법/public contract/검증 기준은 확정 문서에만 남긴다. 후속 계획을 설명하는 데 필요한 완료 slice 기록은 결정 로그로 유지할 수 있지만, 확정 문서와 충돌하면 확정 문서가 우선한다.
- Wasm threads, full visual editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics, 3D rendering은 별도 설계/승인 전 production 코드로 구현하지 않는다.
