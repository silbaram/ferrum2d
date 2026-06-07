# 스크립트 구조

`scripts/`는 제품 runtime 코드가 아니라 repository-level tooling을 둔다.

| 디렉터리 | 용도 |
| --- | --- |
| `build/` | Wasm, Pages, generated ESM output 같은 빌드 helper |
| `package/` | npm package contents, release metadata, generated package QA helper |
| `tools/` | asset/spec authoring용 CLI helper |
| `validate/` | schema, report, authoring 검증 helper |

브라우저나 gameplay smoke test harness는 `tests/smoke/`에 둔다.
