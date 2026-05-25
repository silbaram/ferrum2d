# Planning 문서

`docs/planning`은 별도 설계/승인 전 제품 기능으로 구현하지 않는 항목만 남기는 영역이다. 구현이 끝난 기능, 완료 task, 과거 roadmap은 이 디렉터리에 남기지 않는다.

## 현재 문서

| 문서 | 역할 |
| --- | --- |
| [보류 기능 원장](deferred-features.md) | 별도 승인 전 구현하지 않는 기능, 보류 이유, 개발 진입 조건 |

## 관리 규칙

- `deferred-features.md`에는 별도 설계/승인 전 구현하지 않을 항목만 기록한다.
- 새 보류 항목은 구현 방법보다 보류 이유, 승인 조건, 검증 조건을 우선 기록한다.
- 개발을 시작하려면 먼저 보류 항목에서 제거하고 별도 task 또는 이슈로 분리한다.
- 기능이 코드, 테스트, 문서까지 완료되면 planning 문서에서 삭제하고 확정된 내용만 `docs/engine` 또는 `docs/development`로 옮긴다.
- Wasm threads, editor, multiplayer, scripting/plugin runtime, skeletal animation, complex physics 항목은 별도 설계/승인 전 production 코드로 구현하지 않는다.
