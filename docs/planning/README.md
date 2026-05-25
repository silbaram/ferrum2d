# Planning 문서

`docs/planning`은 아직 제품 기능으로 구현하지 않기로 한 항목과 다음 개발 후보만 남기는 임시 영역이다. 이미 구현된 기능의 사용법, public contract, 검증 기준은 `docs/engine`과 `docs/development`를 기준으로 한다.

## 현재 문서

| 문서 | 역할 |
| --- | --- |
| [보류된 물리 기능](deferred-physics-features.md) | 다음 개발 후보, 보류 사유, 진입 조건, 중단 기준 |

## 관리 규칙

- 완료된 task 체크리스트와 과거 roadmap은 이 디렉터리에 남기지 않는다.
- 새 개발을 시작할 때는 `deferred-physics-features.md`에서 항목 하나를 골라 별도 task 문서로 분리한다.
- task가 코드, 테스트, 문서에 반영되면 해당 task 문서는 삭제하고 확정된 내용만 `docs/engine` 또는 `docs/development`로 옮긴다.
- 별도 설계/승인이 필요한 Worker, WebGPU, complex physics 항목은 승인 전 production 코드로 구현하지 않는다.
