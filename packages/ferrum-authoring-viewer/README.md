# Ferrum2D Authoring Viewer

`@ferrum2d/authoring-viewer`는 Ferrum2D의 agent-first object authoring viewer를 위한 공유 패키지다.

현재 범위는 공식 placement viewer와 후속 consumer viewer가 공통으로 써야 하는 운영 계약, 표시 헬퍼, app chrome, DOM control/shell/panel primitive 헬퍼다.

- viewer 제목과 권장 npm script 이름
- placement/behavior 소유권 문자열
- behavior profile 표시 헬퍼
- behavior binding report path/evidence 생성 헬퍼
- top file strip/status bar 기반 app chrome 생성 헬퍼
- inspector와 panel을 묶는 disclosure section 생성 헬퍼
- key-value row, number/text/select/textarea/checkbox control 생성 헬퍼
- viewer shell/section 생성 헬퍼
- message, action button, summary card 생성 헬퍼
- number input read/write/format 헬퍼

이 패키지는 full visual editor가 아니다. Behavior recipe 본문, FSM/action graph, timeline, tile paint, polygon/path 전문 편집은 별도 승인 전 범위에 포함하지 않는다.

## 현재 상태

- workspace-private 패키지로 시작한다.
- 공식 `apps/placement-viewer` host가 이 패키지의 공통 title, app chrome, disclosure section, behavior 표시, DOM control 헬퍼를 사용한다.
- `packages/create-game`의 generated viewer와 harness가 이 패키지의 공통 title, behavior 표시, DOM key-value/number control, viewer shell, panel primitive, workflow ownership, behavior binding evidence helper를 사용한다.
- 실제 npm publish 전까지는 `private: true`를 유지하고, package/consumer smoke는 로컬 tarball dependency로 검증한다.

## 패키지 계약

- public entrypoint는 `@ferrum2d/authoring-viewer` 하나만 제공한다.
- 배포 파일은 `LICENSE`, `README.md`, `dist/**`만 포함한다.
- `src/**`, `node_modules/**`, `tsconfig.json`은 tarball에 포함하지 않는다.
- runtime dependency, peer dependency, CLI bin을 추가하지 않는다.
- 생성 프로젝트는 내부 workspace path가 아니라 package dependency로만 이 helper를 사용한다.

## 검증

```bash
pnpm package:check:authoring-viewer
pnpm package:check:create-game
```
