# Ferrum2D Placement Viewer Desktop

Tauri 기반 placement viewer desktop wrapper다. 이 app은 `apps/placement-viewer` production/dev frontend를 재사용하고, desktop shell은 consumer project의 `scene-authoring` JSON을 로컬 파일로 읽고 저장하며 agent handoff JSON을 프로젝트 루트에 남기는 command를 제공한다.

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
`project` 행은 연 프로젝트 루트를 표시하고, `asset folder` 행은 asset folder 상태와 이미지 파일 수를 표시하며, `handoff` 행은 `.ferrum-placement-handoff.json` 저장 대상 또는 마지막 저장 경로를 표시한다. `project` 입력칸에 consumer project root 절대 경로를 직접 넣고 `Open Project`를 누르면 해당 폴더의 `public/scene-authoring.json`을 자동 로드하고 `<project>/public/assets`를 기본 asset folder로 inspect한다. `assets` 입력칸에 직접 경로를 넣고 `Use Assets`를 누르거나 `Choose` directory dialog로 다른 asset folder를 지정할 수 있다. `Browse` 버튼은 Tauri native file dialog를 열고, 선택한 JSON을 다시 로드한다. `document` 경로를 직접 입력한 뒤 `Open Path`를 눌러도 같은 경로로 다시 로드한다. 명시 프로젝트 또는 명시 문서 경로를 연 상태에서는 selected/draft/migration/asset folder/asset diagnostic payload가 debounce 후 `.ferrum-placement-handoff.json`에 자동 sync된다. Handoff 섹션의 `Save Handoff`는 같은 payload를 즉시 저장하는 수동 action이다.

Rust host는 성공적으로 연 scene 문서의 canonical 경로와 project root만 write registry에 등록한다. Scene save는 등록된 정확한 문서에만, handoff save는 등록된 project root의 고정 파일에만 허용되며 열지 않은 sibling/임의 경로와 handoff 심볼릭 링크 대상은 거부한다.

## 현재 제품 후보 범위

- Tauri window에서 `apps/placement-viewer` 화면을 연다.
- 기본 샘플 문서 또는 `FERRUM_PLACEMENT_SCENE_DOCUMENT`로 지정한 scene-authoring JSON을 Rust command로 읽는다.
- `project` 직접 경로 입력 또는 Tauri native directory dialog `Choose` 버튼으로 consumer project folder를 선택하고 `public/scene-authoring.json`을 자동 탐색해 로드한다.
- project 기본 `<project>/public/assets` 또는 명시 asset folder를 inspect해 이미지 파일 목록, `texture-atlas.input.json` 존재 여부, missing/not-directory diagnostic을 handoff evidence로 남긴다.
- official viewer는 inspected image의 `ferrum-asset://...` URL을 저빈도 decode해 실제 pixel width/height를 asset provider와 handoff evidence에 연결하고, Add Sprite visual/AABB collider 기본 크기로 사용한다.
- Tauri native file dialog `Browse` 버튼으로 로컬 scene-authoring JSON을 선택해 다시 로드한다.
- viewer `Save` action이 Rust command로 병합된 scene-authoring JSON을 같은 로컬 파일에 저장한다.
- 명시 프로젝트 또는 명시 scene-authoring 문서 경로를 연 상태에서 handoff payload를 debounce 후 `.ferrum-placement-handoff.json`에 자동 sync하고, Handoff 섹션의 `Save Handoff` action이 같은 payload를 수동 저장한다.
- frontend는 Tauri command에 명시 문서 경로 또는 프로젝트 폴더 경로를 넘길 수 있고, desktop shell은 빈 경로, scene-authoring 문서가 없는 프로젝트 폴더, 잘못된 authoring 문서, 잘못된 handoff envelope를 거부한다.
- 현재 프로젝트 경로, 문서 경로, handoff 경로, 저장 모드를 Inspector에 표시한다.

## 검증

```bash
pnpm --filter @ferrum2d/placement-viewer-desktop check
pnpm --filter @ferrum2d/placement-viewer-desktop test
pnpm --filter @ferrum2d/placement-viewer lint
pnpm --filter @ferrum2d/placement-viewer build
pnpm smoke:placement-viewer-desktop-assets
pnpm smoke:placement-viewer-desktop-package
```

`pnpm smoke:placement-viewer-desktop-package`는 Linux debug deb, 실행 파일, embedded production
frontend/Wasm을 검증하고, 같은 frontend에 desktop asset browser smoke를 실행한다.
`--launch`는 Xvfb 아래 조기 종료 여부까지 확인한다. 자동 gate와 별개로 release
전 native picker/save, `ferrum-asset://`, handoff sync, nonblank interactive canvas를 실제 GUI에서 확인한다.
package smoke는 명시적 CSP도 먼저 검사한다. 정책은 로컬 번들, Wasm 실행, Tauri IPC와 등록된
`ferrum-asset` 이미지 경로를 허용한다. 기본 텍스처는 `data:` PNG를 `fetch`로 읽으므로 `img-src`뿐
아니라 `connect-src`에도 `data:`를 허용하며, 원격 script/object load는 허용하지 않는다.
`pnpm smoke:placement-viewer-desktop-assets`는 `tauri.conf.json`의 CSP를 HTML 응답에 그대로 적용한
Chromium에서 texture load, nonblank canvas, asset folder reload, Add Sprite와 handoff metadata를 검증한다.
같은 이름/URL의 이미지를 가진 폴더 전환과 같은 폴더 재검사에서도 실제 canvas 픽셀이 갱신되는지,
늦게 끝난 이전 upload가 최신 폴더 이미지를 덮어쓰지 않는지 확인한다. Viewer는 명시적 asset folder
검사마다 runtime texture를 순차 재로딩한다.
report의 `desktopCsp`는 적용한 정책과 설정 경로를 기록한다. 이 browser smoke는 fake Tauri bridge를
사용하므로 native picker나 실제 custom protocol 검증을 대신하지 않는다.
macOS/Windows signing, notarization, store 제출은 명시적 release 승인 전 범위에 포함하지 않는다.
