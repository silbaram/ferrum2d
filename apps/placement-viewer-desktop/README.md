# Ferrum2D Placement Viewer Desktop

Desktop asset inspection은 image와 `public/assets/*.glb` model catalog를 분리한다.
각 파일의 optional `contentRevision`은 경로와 실제 bytes에서 만든 host session cache fingerprint다.
이는 모델 SHA-256 contentId나 보안 digest가 아니다. 같은 revision은 GPU upload를 생략하고 변경 texture만 갱신한다.
Protocol의 revision query는 폴더가 다른 동일 ID를 분리하며, 재검사 이후 bytes가 바뀐 revision 요청은 409로 거절한다.
기존 revision URL은 탭 복원을 위해 세션에 보관하며 registry는 16,384개 항목으로 제한한다.
공식 app은 metadata 검사와 texture decode 취소, 문서 revision 검사로 오래된 비동기 결과를 폐기한다.

Tauri 기반 placement viewer desktop wrapper다. 이 app은 `apps/placement-viewer` production/dev frontend를 재사용하고, desktop shell은 consumer project의 `scene-authoring` JSON을 로컬 파일로 읽고 저장하며 agent handoff JSON을 프로젝트 루트에 남기는 command를 제공한다.

이 app은 full visual editor가 아니다. Behavior Recipe 본문, FSM/action graph, animation timeline, tile painting은 여전히 agent/spec 소유다.

**파일 → 프로젝트 씬**에서 명시적으로 연 프로젝트의 `public/` 아래 Scene Authoring 문서를 검색·열기·실행한다.
`list_placement_project_scenes`는 Open Project 권한만 허용하며, 단독 Open JSON이 추론한 프로젝트 경로로는 호출할 수 없다.
목록 조회로 다른 씬의 쓰기 권한을 추가하지 않는다. 사용자가 실제 연 개별 문서만 기존 scene allowlist에 등록한다.
프로젝트/문서 열기 응답은 canonical 경로를 반환해 `.`·symlink 별칭으로 같은 문서가 중복되는 것을 방지한다.
씬을 전환해도 최신 프로젝트 자산 폴더 문맥을 보존하고 저장은 활성 문서 경로와 expectedDocument를 사용한다.
검증된 동일 프로젝트의 저장 에셋은 씬 간 공유하고 초기 문서가 닫혀도 유지한다. 미저장·다른 프로젝트 참조는 계속 차단한다.
native 저장은 줄바꿈을 포함한 실제 UTF-8 직렬화 크기가 2 MiB를 넘으면 원본을 교체하지 않는다.
탐색 도중 읽지 못한 하위 경로는 최대 32개 `diagnostics`로 반환하며 정상 씬 목록을 유지한다. 루트 접근 실패는 오류로 반환한다.
목록·문서 읽기 한도와 웹/폴더 입력 차이는 [씬 탐색기 사용법](../placement-viewer/README.md#프로젝트-씬-탐색기)을 따른다.

## 설치 파일 준비

저장소 루트에서 `pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --component viewer --no-sign`으로 현재 OS용 release 설치 파일을 준비한다. `--component engine`은 SDK 묶음, `--component all`은 SDK와 현재 OS 뷰어를 함께 준비하며 `--plan`은 빌드 없이 계획만 출력한다. beta 버전은 예시이며 원격 공개는 수행하지 않는다.

Windows `.exe`/Linux `.deb`/macOS `.dmg`는 각 OS에서 빌드한다. Node/pnpm/Rust/Wasm 및 Tauri native 개발 도구가 필요하다. source 버전을 바꾸지 않고 임시 config와 `app-icon.svg`에서 생성한 아이콘을 사용한다. 뷰어에는 미리보기 엔진이 포함되어 설치한 사용자는 SDK/Node/Rust를 별도로 설치하지 않아도 된다. 프로젝트 열기에는 `public/scene-authoring.json`과 `public/assets`가 있는 게임 폴더를 선택한다. 임의 게임 코드/HUD의 실행은 게임 프로젝트에서 수행한다.

준비 성공과 실제 설치/GUI/서명 확인은 별개다. OS별 조건, checksum·통합 manifest와 수동 CI의 `include_viewer` 사용법은 [엔진·뷰어 분리 배포 절차](../../docs/development/operations/github-release.md#엔진과-전체-뷰어-앱-분리-준비)를 따른다.

## 실행

프로젝트 문서의 Assets → Import Aseprite → **Save Project**는 원본 PNG/JSON과
`public/assets/.ferrum-aseprite/catalog.json`을 저장한 뒤 기존 씬 저장을 실행한다.
프로젝트를 다시 열면 원본·manifest·frame과 재import 연결을 검증해 복원한다.
한도·충돌/취소·runtime 로딩 계약은 [Aseprite 프로젝트 저장](../../docs/engine/data-scene-authoring.md#aseprite-프로젝트-저장과-runtime-로딩)을 따른다.
browser-only와 직접 연 임의 문서에는 이 프로젝트 쓰기 기능을 노출하지 않는다.

```bash
pnpm dev:placement-viewer-desktop
```

GUI 라이브러리가 없는 환경에서는 아래 명령으로 같은 파일 저장·protocol 로직을 검사할 수 있다.
기본 desktop feature와 실제 GUI 검증을 대체하는 명령은 아니다.

```bash
cargo test --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features
cargo clippy --manifest-path apps/placement-viewer-desktop/src-tauri/Cargo.toml --no-default-features --all-targets -- -D warnings
pnpm smoke:aseprite-project
```

이 명령은 Wasm을 빌드한 뒤 Tauri dev shell을 실행하고, Tauri `beforeDevCommand`가 `@ferrum2d/placement-viewer` Vite dev server를 띄운다.

기본값은 `apps/placement-viewer/public/placement.scene-authoring.json` 샘플 문서다. 다른 로컬 문서를 열려면 절대 경로를 환경변수로 넘긴다.

```bash
FERRUM_PLACEMENT_SCENE_DOCUMENT=/absolute/path/to/placement.scene-authoring.json pnpm dev:placement-viewer-desktop
```

앱 내부 `Inspector`의 `source` 행은 현재 로드한 문서 경로를 보여준다. `save` 행은 desktop file/dev endpoint/save disabled 상태를 표시한다.
`project` 행은 연 프로젝트 루트를 표시하고, `asset folder` 행은 asset folder 상태와 이미지 파일 수를 표시하며, `handoff` 행은 `.ferrum-placement-handoff.json` 저장 대상 또는 마지막 저장 경로를 표시한다. `project` 입력칸에 consumer project root 절대 경로를 직접 넣고 `Open Project`를 누르면 해당 폴더의 `public/scene-authoring.json`을 자동 로드하고 `<project>/public/assets`를 기본 asset folder로 inspect한다. `assets` 입력칸에 직접 경로를 넣고 `Use Assets`를 누르거나 `Choose` directory dialog로 다른 asset folder를 지정할 수 있다. `Browse` 버튼은 Tauri native file dialog를 열고, 선택한 JSON을 다시 로드한다. `document` 경로를 직접 입력한 뒤 `Open Path`를 눌러도 같은 경로로 다시 로드한다. 명시 프로젝트 또는 명시 문서 경로를 연 상태에서는 selected/draft/migration/asset folder/asset diagnostic payload가 debounce 후 `.ferrum-placement-handoff.json`에 자동 sync된다. Handoff 섹션의 `Save Handoff`는 같은 payload를 즉시 저장하는 수동 action이다.

Rust host는 성공적으로 연 scene 문서의 canonical 경로와 project root만 write registry에 등록한다. Scene save는 등록된 정확한 문서에만, handoff save는 등록된 project root의 고정 파일에만 허용되며 열지 않은 sibling/임의 경로와 handoff 심볼릭 링크 대상은 거부한다.

Browse/Open Path는 페이지를 reload하지 않고 새 문서 탭을 열거나 기존 canonical 경로 탭으로 이동한다.
탭별 초안·선택·Undo 이력과 desktop 문서/asset/handoff 문맥을 유지하며 저장은 활성 탭의 경로와 기준 문서만 사용한다.
공통 frontend의 2D pan/zoom·Frame/Fit Scene을 사용하며 탭별 편집 카메라 중심·배율은 저장과 문서 왕복 뒤에도 유지한다.
편집 카메라는 페이지 세션의 UI 상태이며 scene JSON이나 native 저장 계약에 필드를 추가하지 않는다.
선택 집합·개별/집합 편집 잠금도 공통 frontend에서 제공하며 탭 왕복과 활성 탭 저장 후 유지한다.
이 상태는 파일의 권한이나 native lock이 아니며 scene JSON/저장 envelope에 필드를 추가하지 않는다.
단독 문서 열기는 기존처럼 프로젝트 asset folder를 자동 상속하지 않는다. 저장 성공 시 해당 탭만 기준 문서를 갱신한다.
`Open Project`는 전체 페이지 전환이며 다른 탭의 미저장 작업까지 확인한다.
`Open JSON`으로 가져온 파일은 export 전용이며 native scene/handoff 저장 권한을 부여하지 않는다.

`save_placement_scene_document`는 `document`와 `expectedDocument`를 필수로 받는다. 원본을 읽은 뒤 외부에서
JSON 내용이 바뀌면 저장을 거부하고 UI 초안과 이력을 보존한다. 공백·key 순서만 바뀐 경우는 허용한다.
host 내 scene 저장은 직렬화하며 기존 권한을 유지한 같은 디렉터리 임시 파일을 sync하고 재확인한 뒤 교체한다.
독립 외부 writer와 비교/교체 사이의 경쟁을 완전히 잠그는 transaction은 아니다.
Undo/Redo·gesture 취소·저장 중 UI 잠금은 재사용하는 frontend가 담당한다.

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

## Tiled/LDtk 원본 저장

Open Project 기본 문서의 Import Tile Frames → **Save Project**는 `.ferrum-tiles`에 immutable 원본 map JSON/외부 TSJ/PNG와 source-only catalog/manifest를 저장한다.
`load_placement_tile_assets`/`save_placement_tile_assets` command와 실제 protocol URL을 사용하며, frontend가 원본을 다시 import해 frame/UV를 검증한 뒤 씬 CAS를 실행한다.
외부 TSJ는 명시적으로 선택한 파일만 참조와 연결하고 `<revision>.dep.<index>.tsj`로 보존한다. map+TSJ 합계 1 MiB를 제한하며 catalog에는 source/name/hash만 저장한다.
다중 embedded/외부 TSJ tileset 문서는 선택 key를 catalog에 저장하고 재실행 때 같은 이름/UID를 찾아 자산을 scene보다 먼저 복원한다. 기존 단일 tileset catalog도 유지한다. 파일 충돌·symlink·byte/hash 변조·8 revision/64 MiB 예산은 native 저장에서 거절한다.
Cancel은 뒤따르는 scene 저장을 막으며 이미 끝난 원본 저장은 retry로 재사용한다. 일반 scene-only 열기와 추가 탭은 export 경로를 사용한다.
[상세 계약](../../docs/engine/data-scene-authoring.md#타일-자산의-native-저장재열기)을 따른다.

## 검증

명시적으로 연 project의 기본 문서는 생성 노멀의 Save Assets/Save Normals와 재열기를 지원한다.
`load_placement_normal_assets`/`save_placement_normal_assets`는 `.ferrum-normals`의 immutable PNG·ordered provenance와 catalog/manifest를 관리한다.
color=`srgb`, normal=`none`, 실제 PNG hash/크기를 검증하고 scene 적용 전에 복원한다. 기존 Aseprite source color의 GPU 소유권은 공유한다.
프로젝트 8 pair/PNG 64 MiB/decoded color+normal 8,388,608 pixel 한도와 파일 충돌·외부 catalog 변경·symlink 거절을 적용한다.
일반 scene-only 열기에는 project asset 쓰기 권한을 주지 않는다. [상세 계약](../../docs/engine/data-scene-authoring.md#생성-노멀의-native-프로젝트-저장재열기)을 따른다.

```bash
pnpm --filter @ferrum2d/placement-viewer-desktop check
pnpm --filter @ferrum2d/placement-viewer-desktop test
pnpm --filter @ferrum2d/placement-viewer lint
pnpm --filter @ferrum2d/placement-viewer build
pnpm smoke:placement-viewer-desktop-assets
pnpm smoke:placement-viewer-desktop-package
pnpm test:native-normal-project
pnpm smoke:native-normal-project
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
늦게 끝난 이전 upload가 최신 폴더 이미지를 덮어쓰지 않는지 확인한다. Viewer는 native content revision이
달라진 texture만 순차 재로딩하고 취소된 decode/upload를 폐기한다. Revision을 제공하지 않는 구 host는
명시적 재검사 시 전체 texture를 갱신한다.
report의 `desktopCsp`는 적용한 정책과 설정 경로를 기록한다. 이 browser smoke는 fake Tauri bridge를
사용하므로 native picker나 실제 custom protocol 검증을 대신하지 않는다.
문서 탭별 native save의 경로·expectedDocument와 이전 탭의 초안/asset folder 복원, 실패한 문서 열기도 같은 fake bridge로 확인한다.
macOS/Windows signing, notarization, store 제출은 명시적 release 승인 전 범위에 포함하지 않는다.
