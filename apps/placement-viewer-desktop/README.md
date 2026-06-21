# Ferrum2D Placement Viewer Desktop Spike

Tauri 기반 placement viewer desktop wrapper spike다. 이 app은 `apps/placement-viewer` production/dev frontend를 재사용하고, desktop shell은 consumer project의 `scene-authoring` JSON을 로컬 파일로 읽고 저장하며 agent handoff JSON을 프로젝트 루트에 남기는 command를 제공한다.

이 app은 full visual editor가 아니다. Behavior Recipe 본문, FSM/action graph, animation timeline, tile painting은 여전히 agent/spec 소유다.

## 실행

```bash
pnpm dev:placement-viewer-desktop
```

이 명령은 Wasm을 빌드한 뒤 Tauri dev shell을 실행하고, Tauri `beforeDevCommand`가 `@ferrum2d/placement-viewer` Vite dev server를 띄운다.

기본값은 `apps/placement-viewer/public/placement.scene-authoring.json` 샘플 문서다. 다른 로컬 문서를 열려면 절대 경로를 환경변수로 넘긴다.

```bash
FERRUM_PLACEMENT_SCENE_DOCUMENT=/absolute/path/to/placement.scene-authoring.json pnpm dev:placement-viewer-desktop
```

앱 내부 `Inspector`의 `source` 행은 현재 로드한 문서 경로를 보여준다. `save` 행은 desktop file/dev endpoint/save disabled 상태를 표시한다.
`project` 행은 연 프로젝트 루트를 표시하고, `handoff` 행은 `.ferrum-placement-handoff.json` 저장 대상 또는 마지막 저장 경로를 표시한다. `project` 입력칸에 consumer project root 절대 경로를 직접 넣고 `Open Project`를 누르면 해당 폴더의 `public/scene-authoring.json`을 자동 로드한다. `Choose` 버튼은 같은 동작을 위한 Tauri native directory dialog fallback이다. `Browse` 버튼은 Tauri native file dialog를 열고, 선택한 JSON을 다시 로드한다. `document` 경로를 직접 입력한 뒤 `Open Path`를 눌러도 같은 경로로 다시 로드한다. Handoff 섹션의 `Save Handoff`는 현재 selected/draft/migration/asset diagnostic payload를 프로젝트 루트의 `.ferrum-placement-handoff.json`에 저장한다.

## 현재 spike 범위

- Tauri window에서 `apps/placement-viewer` 화면을 연다.
- 기본 샘플 문서 또는 `FERRUM_PLACEMENT_SCENE_DOCUMENT`로 지정한 scene-authoring JSON을 Rust command로 읽는다.
- `project` 직접 경로 입력 또는 Tauri native directory dialog `Choose` 버튼으로 consumer project folder를 선택하고 `public/scene-authoring.json`을 자동 탐색해 로드한다.
- Tauri native file dialog `Browse` 버튼으로 로컬 scene-authoring JSON을 선택해 다시 로드한다.
- viewer `Save` action이 Rust command로 병합된 scene-authoring JSON을 같은 로컬 파일에 저장한다.
- Handoff 섹션의 `Save Handoff` action이 Rust command로 `.ferrum-placement-handoff.json`을 프로젝트 루트 또는 scene-authoring 문서에서 추론한 프로젝트 루트에 저장한다.
- frontend는 Tauri command에 명시 문서 경로 또는 프로젝트 폴더 경로를 넘길 수 있고, desktop shell은 빈 경로, scene-authoring 문서가 없는 프로젝트 폴더, 잘못된 authoring 문서, 잘못된 handoff envelope를 거부한다.
- 현재 프로젝트 경로, 문서 경로, handoff 경로, 저장 모드를 Inspector에 표시한다.

## 검증

```bash
pnpm --filter @ferrum2d/placement-viewer-desktop check
pnpm --filter @ferrum2d/placement-viewer-desktop test
pnpm --filter @ferrum2d/placement-viewer build
```

패키징은 아직 spike 범위 밖이다. 배포용 desktop bundle 검증은 별도 승인 후 `pnpm --filter @ferrum2d/placement-viewer-desktop tauri:build`로 다룬다.
