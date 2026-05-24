# Ferrum2D 릴리스 노트 템플릿

이 문서는 `@ferrum2d/ferrum-web` beta release와 milestone release의 GitHub Release 본문 작성 기준이다. `CHANGELOG.md`는 저장소 변경 기록이고, 릴리스 노트는 사용자에게 전달할 설치/검증/제한 정보를 정리하는 배포 문서다.

## 사용 시점

- `CHANGELOG.md`의 `Unreleased` 항목을 `## x.y.z-beta.N - YYYY-MM-DD` 섹션으로 내린 뒤 사용한다.
- `packages/ferrum-web/package.json` version과 `ferrum-web-vx.y.z-beta.N` tag 이름이 맞는지 `pnpm release:check`로 확인한다.
- GitHub Release 작성 시 아래 섹션 구조를 본문으로 사용한다.
- GitHub의 generated release notes를 사용하는 경우 `.github/release.yml`의 label category를 먼저 확인하고, 아래 섹션에 맞춰 사람이 최종 편집한다.

## GitHub Release 제목

```text
@ferrum2d/ferrum-web x.y.z-beta.N
```

## Summary

- 한두 문장으로 이번 beta release의 사용자 관점 변화를 설명한다.
- 예: Asset pipeline과 Pages demo/docs 배포 경로를 안정화한 beta release.

## Install

```bash
pnpm add @ferrum2d/ferrum-web@beta
```

Package version: `x.y.z-beta.N`

Git tag: `ferrum-web-vx.y.z-beta.N`

## Highlights

- 사용자에게 바로 영향이 있는 기능을 3-5개만 적는다.
- public API, Game Spec, 예제, 배포 artifact 변화를 우선한다.

## Breaking Changes

- 없으면 `None`이라고 적는다.
- public import path, Game Spec field, generated artifact 구조가 바뀐 경우 migration을 함께 적는다.

## Upgrade Notes

- 기존 사용자가 적용해야 하는 변경을 적는다.
- 새 명령, 새 asset 경로, smoke check 변화가 있으면 포함한다.

## Verification

- `pnpm lint`
- `pnpm test`
- `pnpm validate:game-spec`
- `pnpm smoke:headless`
- `pnpm package:check`
- `pnpm release:check`
- `pnpm build`

Browser smoke, Pages deploy, npm publish 결과는 실제 실행한 경우만 추가한다.

## Known Limitations

- WebGPU, Worker, editor, multiplayer, complex physics는 현재 제품 범위가 아니다.
- WebGL2 실제 렌더링/입력/오디오는 자동 CI가 아니라 browser smoke 또는 수동 smoke로 확인한다.

## Links

- Changelog: `CHANGELOG.md`의 `x.y.z-beta.N` 섹션
- npm release procedure: `docs/development/operations/npm-release.md`
- demo/docs Pages artifact: GitHub Pages URL

## 작성 기준

- `CHANGELOG.md`의 모든 항목을 그대로 반복하지 않는다. 릴리스 노트는 사용자가 알아야 할 영향과 설치/검증 정보를 우선한다.
- 내부 구현 변경은 public API, Game Spec, 예제, artifact, 성능/안정성 영향이 있을 때만 적는다.
- `Breaking Changes`와 `Known Limitations`는 비어 있더라도 섹션을 유지한다.
- 검증 명령은 실제 실행한 것만 남긴다. 실패한 검증은 원인과 후속 조치를 함께 적는다.
- publish하지 않은 draft release에는 npm 설치 명령 대신 local tarball 확인 경로를 적는다.

## GitHub generated notes label 기준

`.github/release.yml`은 GitHub generated release notes의 PR label 분류만 담당한다. label이 없거나 모호한 변경은 `Other Changes`에 들어가므로, 최종 릴리스 본문은 사람이 위 템플릿 기준으로 편집한다.

| Category | Labels | 사용 기준 |
| --- | --- | --- |
| Breaking Changes | `breaking-change` | migration이 필요한 public 계약 변경 |
| Features | `feature`, `enhancement` | 사용자-facing 기능, API, 예제 추가 |
| Fixes | `bug`, `fix` | 회귀 수정, 안정성 수정 |
| Documentation | `documentation`, `docs` | 문서, guide, release note 변경 |
| Maintenance | `maintenance`, `ci`, `chore` | CI, packaging, release automation, 내부 정리 |
| Other Changes | `*` | 위 label이 없는 변경 |
