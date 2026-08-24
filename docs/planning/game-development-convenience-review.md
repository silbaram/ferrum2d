# 게임 개발 편의성 실사용 재검토

상태: 재검토 완료, built-in Scene Authoring runtime 연결 반영, 후속 후보 2건 유지
기준일: 2026-08-25

이 문서는 Ferrum2D의 기능 수가 아니라 생성 프로젝트에서 콘텐츠를 바꾸고 검증하는 실제 작업량을
기준으로 개선 필요성을 판단한 planning 기록이다. 현재 사용법과 검증 계약은
[개발자 퀵스타트](../engine/developer-quickstart.md),
[사용자 설명서](../engine/user-guide.md),
[Smoke Check](../development/quality/smoke-check.md)가 기준이며 package 세부 설명은
`packages/create-game/README.md`에 둔다.

## 재검토 결론

Ferrum2D는 Game Spec, Scene Authoring, replay/report를 AI agent가 수정하고 검증하는 흐름에 더해,
generated built-in starter가 Scene Authoring의 위치와 Behavior Recipe를 실제 runtime entity에 적용하는
경로까지 연결됐다. browser-only build의 workspace 파일 저장은 계속 비활성화하고, 명시적 local save는
Tauri authoring host가 project-root allowlist 안에서 담당한다.

두 기능은 단순 누락으로 보지 않는다.

- built-in starter와 generic Data Scene은 entity/component 생성 계약이 다르다.
- scene별 compatibility adapter 없이 Scene Authoring을 자동 적용하면 기존 gameplay를 바꿀 수 있다.
- 브라우저 host가 workspace 파일을 쓰려면 경로 allowlist와 명시적 권한 모델이 필요하다.

generic Data Scene과 built-in scene을 같은 spawn 계약으로 합치지 않고 scene-specific adapter로 분리했다.
남은 편의성 후보는 asset 반복 작업과 read-only gameplay 진단이다.

## 재검토 결과와 처리 순서

| 순서 | 항목 | 판단 | 상태 |
| ---: | --- | --- | --- |
| 1 | Top-down runtime replay fixture drift | 현재 검증을 깨는 실제 회귀 | 완료: snapshot v19, hash `96a04068`로 재생성 |
| 2 | runtime 입력과 authoring fixture 역할 | source of truth가 파일명만으로 불명확 | 완료: report에 `runtimeInputs` 추가 |
| 3 | generated viewer 저장 표현 | memory-only 동작을 파일 저장으로 오해할 수 있음 | 완료: `Apply Memory`와 `saveMode: "memory"` 적용 |
| 4 | 기본 검증 진입점 | 사람이 필수 명령을 고르는 비용이 큼 | 완료: `ferrum:check` 추가 |
| 5 | `minimal/src/main.ts` 학습 표면 | 가장 작은 starter로는 책임이 너무 많음 | 완료: UI/HUD/startup helper 분리, 372줄에서 171줄로 축소 |
| 6 | Scene Authoring 자동 runtime 적용 | generic Data Scene과 built-in entity 계약 분리 필요 | 완료: built-in adapter + Playing/reset session 적용 |
| 7 | local host 파일 저장 | 권한과 allowlist 필요 | 완료: Tauri project-root save/handoff, browser-only는 export 유지 |
| 8 | Placement Viewer blank readback | 반복 실행에서 재현되지 않음 | 변경 없음: 현재 smoke 조건 유지 |

## 현재 제작 흐름 평가

점수는 제품 등급이 아니라 다음 개선 순서를 고르기 위한 상대 평가다.

| 제작 단계 | 편의성 | 현재 상태 |
| --- | ---: | --- |
| 프로젝트 생성·첫 실행 | 7/10 | 네 starter template과 Vite 실행 경로 제공 |
| Top-down 밸런스 조정 | 8/10 | `public/game.json`에서 world, wave, weapon, prefab 조정 가능 |
| 오브젝트 배치 | 5/10 | 선택, 이동, 추가, collider, 기존 behavior binding 지원 |
| 배치 결과의 게임 반영 | 6/10 | built-in 위치/Behavior Recipe 자동 반영; visual/collider는 generic Data Scene 경로 |
| 새로운 gameplay 제작 | 3/10 | 기존 recipe/FSM primitive 밖은 TypeScript glue 또는 core 확장 필요 |
| asset 반복 작업 | 5/10 | metadata 검증은 제공하지만 일반 runtime reimport/hot reload는 없음 |
| 오류 진단·회귀 검증 | 7/10 | `ferrum:check`, replay, smoke는 강하지만 interactive debugger는 없음 |
| 정적 웹 배포 | 7/10 | build, preview, deploy-readiness 계약 제공 |

## 반영 완료 항목

### 통합 검증 명령

생성 프로젝트는 `npm run ferrum:check`로 다음 단계를 순서대로 실행한다.

```text
validation
-> asset validation
-> Scene Authoring report
-> gameplay replay
-> runtime replay
-> production build
```

첫 실패에서 중단하고 `ferrum2d.consumer.check.report`의 `failedStep`, diagnostic code,
`nextCommand`를 제공한다. 상세 report와 deploy/browser 검증 명령은 독립 명령으로 유지한다.

### Runtime 입력 소유권

project report와 authoring report의 `runtimeInputs`는 다음을 구분한다.

- local gameplay 구성 source
- `@ferrum2d/ferrum-web/starter-scenes` runtime 구현
- browser bootstrap
- `public/scene-authoring.json`의 runtime placement/behavior와 authoring/validation 역할
- Scene Authoring의 game runtime 자동 적용 여부

`public/scene-authoring.json`은 generated built-in starter의 첫 Playing frame과 명시적 reset 뒤에
`applyBuiltInSceneAuthoringDocument(...)`로 적용된다. Data Scene variable/visual/collider는 이 adapter가
받지 않고 generic Data Scene 경로를 사용한다.

### Generated Viewer 저장 상태

`Apply Memory`는 draft를 현재 viewer session에만 적용한다. 프로젝트의
`public/scene-authoring.json`을 쓰지 않으며, 파일 반영에는 `Copy Patch` 또는 `Copy Handoff` 결과를
사용한다. 실제 저장 기능은 opt-in host 또는 desktop host 경계에서만 다룬다.

### Minimal starter 구조

DOM shell, metric HUD, input queue, startup diagnostic은 template 내부
`src/minimal-template-shell.ts`로 분리했다. Weapon profile은 public authoring API 학습 예제로서
`main.ts`에 유지한다.

## 남은 개선 후보

### 1. Asset 반복 작업 단축

다음 기능은 자체 이미지 편집기보다 Aseprite, Tiled, LDtk import/reimport 연결을 우선한다.

- asset folder 변경 감지
- atlas metadata 재생성
- 개발 runtime texture reload
- missing frame/texture diagnostic의 game preview 노출

### 2. Read-only gameplay 진단

full visual scripting 대신 다음 진단 surface를 후보로 유지한다.

- selected entity handle, variable, FSM state, cooldown
- 최근 gameplay/collision/effect event timeline
- behavior command와 source JSON path 연결
- replay mismatch 첫 frame과 관련 instance id

Rust simulation state는 계속 source of truth를 소유하고, TypeScript UI에는 bulk telemetry 또는 낮은 빈도
query만 허용한다.

## 별도 범위

- npm public onboarding은 package publish/release 승인 범위에서 결정한다.
- 신규 public demo와 desktop packaging은 각각 해당 planning 문서에서 결정한다.
- full visual editor, Behavior Recipe Body Editor, FSM/action graph editor, scripting/plugin runtime,
  multiplayer, 3D, complex physics는 이 편의성 개선에 포함하지 않는다.

## 검증 기록

- `pnpm smoke:create-game-template-reports`: 네 template report/replay와 `ferrum:check` 실패 경로 통과
- `pnpm package:check:create-game`: generated scaffold와 tarball 계약 통과
- `pnpm package:consumer-smoke -- --skip-build --skip-package-check`: 네 template 전체 통과
- shared built-in authoring session 수정 후 minimal consumer production/browser smoke와 report validator 재통과
- `pnpm smoke:placement-viewer`: 공식 smoke 통과
- 같은 build의 Placement Viewer browser-only smoke 재실행 통과
- `pnpm lint`, `pnpm test`, `pnpm build`: 통과
- `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`: 통과

최초 Placement Viewer blank readback은 반복 실행에서 재현되지 않았다. 재현 없이 pass 조건을
완화하면 실제 blank frame을 숨길 수 있으므로 Placement Viewer smoke의 판정 조건은 유지했다. 별도로
generated consumer deployment smoke에서 WebGL swap timing에 따른 단발성 빈 readback이 확인되어, 완료된
runtime frame 뒤 최대 8 RAF의 bounded readback만 허용하고 계속 비어 있으면 실패하도록 안정화했다.
