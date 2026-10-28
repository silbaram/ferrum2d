# Ferrum2D Placement Viewer

Data Scene 기반 Scene Placement/Object Authoring viewer를 실행하는 공식 authoring app이다. 목적은 사람이 위치, visual, collider, layer, ObjectDefinition, 기존 behavior recipe id reference를 확인/수정하고, agent가 같은 scene-authoring JSON과 handoff report를 기준으로 후속 작업을 이어가는 흐름을 제공하는 것이다.

이 app은 full visual editor가 아니다. Behavior Recipe 본문, FSM/action graph, animation timeline, tile painting은 이 viewer에서 편집하지 않는다.

기본 화면(`/`, `?scene=default`, `?scene=2d`)은 `public/placement.garden.scene-authoring.json`의 2D 정원이다.
파일 → 예제와 프로젝트 씬에는 **2D Lantern Garden**과 **HD-2D Village**를 제공한다. 기존 기본 2D·HD-2D 기초 예제는 배포에서 제거했다.

## 엔진·에디터 버전 업데이트

**파일 → 버전 및 업데이트**에서 현재·최신 버전을 확인한다. 패널을 열거나 **업데이트 확인**을 누를 때
공개된 GitHub beta 릴리스를 조회하며, Git push나 draft를 새 버전으로 취급하지 않는다.

- **프로젝트 엔진**: 데스크톱에서 **프로젝트 열기**로 연 npm/pnpm 게임의 Ferrum2D 패키지를 동일 릴리스로 갱신한다. Node와 해당 패키지 관리자가 필요하다. 단독 JSON/폴더 사본·엔진 monorepo·workspace/file/link 의존성은 자동 변경하지 않는다.
- **에디터 앱**: 공개키가 포함된 설치 앱에서 해당 OS의 서명 업데이트 파일을 확인·설치하고 재시작한다. 내장 미리보기 엔진도 함께 바뀐다. Linux 자동 교체는 AppImage에서 지원하며 `.deb`는 수동 재설치한다.
- **웹 뷰어**: 릴리스 정보와 데스크톱 사용 안내를 보여준다. 웹 앱 자체는 사이트 재배포로 바뀐다.

미저장 씬이 어느 탭에든 있거나 씬 실행/저장/편집 중이면 설치를 막는다. 설치 중에는 패널/앱을 닫지 않는다.
프로젝트 갱신은 `.ferrum-updates/<시각-id>/`에 원본 `package.json`·잠금 파일과 결과를 남긴다.
다운로드 SHA-256과 설치된 파일을 대조하며 lifecycle hook을 실행하지 않는다. 실패하면 복원을 시도하고,
외부 `package.json` 변경이나 복구 실패는 백업 경로와 함께 알린다. 다른 패키지 관리자 작업은 동시에 실행하지 않는다.
게임 코드·씬 migration·사용자 agent 파일을 바꾸거나 게임 검증을 자동 실행하지 않으므로 갱신 후 `npm run ferrum:check`를 수행한다.

첫 사용에는 이 기능이 포함된 앱과 서명 업데이트 자료의 공개가 필요하다.
키 없는 개발 빌드나 아직 installer/metadata가 없는 릴리스는 설치를 제공하지 않는다.
[서명 자료 준비와 CLI 사용법](../../docs/development/operations/github-release.md#버전-확인과-업데이트)을 따른다.

## 프로젝트 씬 탐색기

**파일 → 프로젝트 씬**을 누르거나 왼쪽 도크의 **프로젝트 씬** 탭을 선택한다.
기존 오브젝트 트리는 같은 도크의 **오브젝트** 탭에 있다. 검색은 파일·폴더 경로를 대상으로 하며,
한 번 클릭해 선택하고 더블클릭·Enter·**열기**로 문서를 연다. 방향키와 Home/End로 목록을 이동한다.
**씬 실행**은 선택한 문서를 열고 플레이하며, 이미 열린 씬은 기존 탭·초안·Undo를 유지한다.
잘못된 문서는 원인을 표시하고 열기·실행을 막는다. 열기 실패 후 이전 씬을 실행하지 않는다.
동시에 열 수 있는 문서는 기존과 같이 최대 8개다.

- 데스크톱: **폴더 선택**으로 프로젝트를 연 뒤 `public/` 아래의 Scene Authoring JSON을 탐색한다.
  프로젝트 기본 문서는 `public/scene-authoring.json` 또는 `public/placement.scene-authoring.json`이어야 한다.
  목록 조회는 읽기 전용이며, 실제 열린 개별 씬만 기존 저장 권한을 얻는다. 단독 JSON 열기는 프로젝트 탐색 권한을 주지 않는다.
  같은 프로젝트에서 검증·저장된 Aseprite/타일/노멀 에셋은 여러 씬에서 참조할 수 있다.
  처음 연 씬을 닫아도 프로젝트 에셋은 현재 작업공간이 끝날 때까지 유지하며, 미저장 에셋은 문서별로 유지·해제한다.
  추가 씬의 배치 저장은 지원하지만, 새 원본 에셋의 **Save Project**는 기존 기본 문서 권한을 유지한다.
  임의 JSON이나 다른 프로젝트가 같은 에셋 ID만으로 접근 권한을 얻지는 않는다.
- 공식 웹/개발 서버: 앱 `public/`에서 생성한 `placement-scenes.json` 목록을 사용한다.
  개발 서버의 새로고침은 다시 탐색하고, 정적 배포 목록은 빌드 시 확정한다. 공개할 씬·에셋만 `public/`에 둔다.
  개발 중 `public/**/*.json` 변경은 HMR reload를 일으키지 않는다. 목록은 새로고침하고, 이미 열린 문서는 초안을 유지한다.
- 브라우저 **폴더 선택**: 사용자가 선택한 파일 사본에서 문서를 찾고 Export Only로 연다.
  새로고침은 폴더를 다시 선택한다. 에셋 폴더 전체를 자동 업로드하거나 게임 코드를 실행하지 않으므로,
  문서가 참조하는 에셋은 이미 뷰어에서 사용할 수 있어야 한다. 같은 폴더를 다시 선택하면 새 사본으로 취급한다.

탐색은 일반 `.json`도 format/version으로 식별한다. 알려진 `*.scene-authoring.json`의 오류는 목록에 표시하며,
실제 열기에서 기존 전체 문서 검증을 수행한다. `assets`, `node_modules`, `dist`, `target`, 숨김 디렉터리는 탐색하지 않는다.
native/개발 서버는 symlink도 건너뛴다.
native/개발 서버는 깊이 8, 디렉터리 항목 4,096개, JSON 후보 512개, 씬 256개, 문서당 2 MiB·총 읽기 32 MiB로 제한한다.
브라우저 폴더 입력도 같은 파일·씬·읽기 예산을 적용하며 경로는 10개 segment 이하다.
지원하지 않는 경로 문자나 예산 초과로 일부 항목을 생략하면 한도 안내를 표시한다.
읽을 수 없거나 탐색 도중 삭제된 하위 경로는 정상 씬 목록을 유지한 채 최대 32개 읽기 실패 진단으로 알린다.
상태 안내와 툴팁에서 경로·오류 코드를 확인한다. 명시적 탐색 루트의 접근 오류는 목록 조회 실패로 구분한다.
이 기능은 Scene Authoring runtime 미리보기다. 프로젝트의 임의 TypeScript 게임 진입점·HUD 실행이나 게임 중 씬 전환은 게임 프로젝트에서 구현한다.

## 예제 실행

**파일 → 예제 → 2D 등불 정원**은 타일·레이어·픽셀 캐릭터·물 애니메이션·충돌·길 찾기·수집·조명과 그림자를 보여준다.
`http://localhost:5173/?scene=garden` 또는 `?scene=2d`로 바로 열 수도 있다.
실행을 누른 뒤 바닥을 클릭하면 캐릭터가 이동하고 정원 토큰 3개를 수집한다. 벽·건물·운하는 통과할 수 없으며
운하는 다리로 건넌다. 이동·충돌·걷기/정지 애니메이션·수집은 Rust 런타임이 처리한다.
일시정지 버튼은 재개로 전환되며 정지는 원래 위치와 토큰을 복원한다. 편집 중에는 게임 진행을 멈춘다.

바닥 타일 432개는 실수로 옮기지 않도록 처음에 잠그며, 잠금 해제 후 기존 배치 도구로 편집할 수 있다.
집·나무·소품과 캐릭터도 기존 선택·변형·Undo 경로를 사용한다. **보기 → 조명**에서 등불과 환경광을 바꿀 수 있다.
예제는 별도 문서 탭으로 열고 기존 탭의 초안을 보존한다. 내장 예제는 Export Only이며 원본 JSON을 자동으로 덮어쓰지 않는다.
같은 메뉴의 **HD-2D 마을**과 **기본 2D**로 다른 예제도 연다. 기본 2D의 작은 검증용 씬은 유지한다.

원본 에셋과 JSON은 Python 표준 라이브러리만 사용하는 `scripts/assets/build-lantern-garden.py`로 재생성한다.
재생성은 예제 JSON 수정을 덮어쓰므로 에셋/구성의 원본을 바꿀 때 generator를 함께 수정한다.

```bash
python3 scripts/assets/build-lantern-garden.py --check  # 파일을 쓰지 않고 재현성 확인
python3 scripts/assets/build-lantern-garden.py          # atlas/manifest/예제 JSON 재생성
```

## 확인 기술

현재 작업공간은 2D·HD-2D·Game Preview 모드를 공유한다. 2D에서는 대표 객체의 pivot을 기준으로
그룹 회전·균일 scale을 gizmo/숫자/handle의 방향키로 적용한다. 회전 방향키는 15도(Shift 1도),
scale 방향키는 10%(Shift 1%)다. 드래그 snap은 15도/0.1배이며 한 gesture가 한 Undo가 된다.
선택 객체의 실제 visual 테두리 옆에 이름·**회전/크기** 버튼과 현재 각도/백분율을 한곳에 표시한다.
버튼을 좌우로 드래그하면 회전(1px당 1°) 또는 균일 크기(오른쪽 120px당 2배)가 바뀐다.
선택 테두리 밖에 도구를 놓고 canvas 안에 유지한다. 이름은 객체와 함께 회전하지 않으며,
화면 밖 객체·화면 이동·에셋 배치·게임 실행 중에는 도구를 숨긴다. 잠긴 선택은 이름/잠금 안내만 표시한다.
진행 중인 변형으로 객체가 화면 밖에 나가도 잡은 도구는 유지하며, Escape는 변형 전체를 취소한다.
기본 선택에는 시각 요소의 얇은 테두리만 표시한다. **보기 → 충돌 영역**을 켜면 별도 점선과
`충돌 영역` 이름표·위치 이동 핸들이 나타난다. 이 표시는 문서·이력과 별개인 현재 보기 설정이다.
충돌 위치 핸들을 드래그하면 기존 collider offset을 수정하고, primitive의 모서리 핸들은 visual/collider 크기를 함께 수정한다.
Asset preview를 viewport로 드래그하면 선택한 sprite/frame과 기본 collider를 기존 Add Sprite 경로로 배치한다.

HD-2D에서는 다층·경사 surface, authored model bounds·billboard를 선택하고 XY·body 높이/층·시각 offset,
model yaw/scale과 sprite 회전/크기를 편집한다. `선택 / Select`에서 오브젝트를 드래그하면 XY가 바뀌며,
`속성 / Properties → 공간 배치 / Spatial Placement`에서 회전(도)·크기·좌표를 숫자로 수정한다.
선택 객체 옆의 **높이 아이콘**을 위아래로 드래그하면 높이가 바뀌고, **회전 아이콘**을 좌우로 드래그하면
모델 yaw 또는 sprite 면 안의 회전이 바뀐다. 회전은 화면 1px당 1°이며 Shift를 누르면 15° 단위로 맞춘다.
아이콘에 포커스한 뒤 방향키로 높이/각도를 1단위씩 조절한다. 높이는 좌표 정렬 사용 시 격자 간격을 따르고,
Shift+방향키는 높이 10배·회전 15°다. 드래그 한 번은 Undo 한 건이며 Escape·포인터 캡처 해제로 취소한다.
에셋 배치 대기 중 높이·회전 아이콘을 조작하면 배치 대기를 종료한다. 이후 Escape 한 번으로 해당 변형 전체를 취소한다.
아이콘에는 한영 이름과 툴팁이 있고, 객체가 일부만 보이면 canvas 안에 유지된다. 객체가 완전히 화면 밖으로 나가면 숨기고,
다시 화면 안으로 들어오면 복원한다. 화면 이동·게임 미리보기·선택 해제·잠금 시에도 숨긴다.
생략된 model yaw/scale/시각 높이도 기본값 0°/1/0에서 편집할 수 있다. Sprite 회전은 billboard 면 안의
이미지 회전이며, 캐릭터의 바라보는 방향 애니메이션은 게임 로직이 정한다. `spatial.actor` 플레이어는
이동 컨트롤러가 회전하지 않은 AABB를 요구하므로 회전 입력을 비활성화하고 이유를 표시한다.
지형 surface의 회전 아이콘도 비활성화한다. 모델 yaw를 바꿔도 충돌 프록시는 자동으로 회전하지 않는다.
플레이어의 위치·크기는 수정할 수 있다. Sprite 변형은 기존 instance transform 경로로 충돌체에도 반영된다.
Height handle은 surface top/end/base 또는 body 높이를 함께 이동한다.
2D·HD-2D의 `선택 / Select`에서 빈 공간을 클릭하면 기존 선택과 선택 외곽선·변형 아이콘·속성 값을 비운다.
HD-2D의 지형도 선택 해제 대상이며, 화면 이동·에셋 배치 도구의 클릭은 해당 도구 동작을 유지한다.
선택 해제는 배치 문서·편집 카메라·Undo/Redo 이력을 변경하지 않는다.
중간 버튼/Alt drag와 Orbit/Zoom/Reset은 문서와 분리한 탭별 편집 camera를 조작한다.
**보기 → 편집 시점 → 위에서 보기 / 낮게 보기**는 내려다보는 각도를 10°씩 조절한다.
같은 메뉴의 **내려다보는 각도** 슬라이더는 1~89°를 1° 단위로 조절하며 현재 각도를 표시한다.
작은 각도는 수평에 가까운 시점, 큰 각도는 위에서 내려다보는 시점이다. 씬 중심·탐색 카메라 거리·화각과
작업 평면 높이를 유지하고 직교/원근 모두 지원한다. 카메라 초기화는 문서의 원래 각도로 돌아간다.
각도는 탭별 편집 상태이며 JSON·patch·Undo에 기록하지 않는다. Game Preview는 작성된 씬 camera를 사용하고 정지하면 편집 각도를 복원한다.

뷰포트 상단의 **게임 카메라** 버튼을 누르면 게임을 일시정지하고 화면 옆에 실시간 조절 패널을 연다.
HD-2D 편집과 실행 중인 게임 미리보기 모두에서 진입할 수 있다. 패널은 외부 클릭으로 닫히지 않으며,
게임 화면을 가리지 않도록 별도 공간을 사용한다. 각도 슬라이더와 위치·확대 수치 입력 중 실제 native 게임
카메라가 즉시 갱신된다. 숫자 입력은 Enter/포커스 이동, 슬라이더는 드래그 종료 시 한 건의 변경으로 확정한다.
입력 중 Escape는 미확정 구도를 취소한다. 잘못된 값은 기존 구도로 복원하고 패널 안에 오류를 표시한다.
입력 확정 시 작성 문서를 native 런타임에 다시 적용한다. 게임 진행 상태를 이어서 확인할 때는 구도를 먼저 확정한 뒤 실행한다.

게임 카메라 미리보기에서는 화면을 **왼쪽 드래그**하여 회전하고, **중간 버튼 또는 Space+왼쪽 드래그**로
화면을 이동하며, **휠**로 확대/축소한다. 이동은 실제 게임 프레임의 CSS 픽셀을 기준으로 하므로 pixelArt
여백·직교/원근·화면 배율에 관계없이 마우스를 움직인 거리와 일치한다.
패널의 **숫자 이름**을 좌우로 드래그하면 값을 조절한다. `Shift`는 0.1배 미세 조절,
`Ctrl/Cmd`는 10배 빠른 조절이다. 직접 숫자를 입력하는 방식도 유지한다.
미리보기 진입 시 뷰포트로 포커스를 옮긴다. Space 이동은 뷰포트에 포커스가 있을 때 적용해 버튼과 접기 메뉴의 기본 키보드 조작을 유지한다.
드래그 종료마다 한 건의 카메라 변경을 기록하고, 연속 휠 입력은 180ms 동안 추가 입력이 없을 때 한 건으로 확정한다.
드래그 중에는 저장을 차단한다. Escape·포인터 취소·포커스 상실은 미확정 구도를 복원하며,
native 복원이 거절되면 제스처 소유권을 유지하고 Escape로 다시 시도한다. 재개와 편집 전환도 미확정 드래그를 취소한다.
이 조작은 [Unity Scene 탐색](https://docs.unity3d.com/Manual/SceneViewNavigation.html)과
[Godot Inspector 숫자 조절](https://docs.godotengine.org/en/stable/tutorials/editor/inspector_dock.html)의 직접 조작 방식을 참고했다.

기존 **보기 → 편집 시점 → 게임 카메라**에서도 실제 게임에 저장할 구도를 작성한다. 내려다보는 각도·수평 방향·중심 X/Y/높이를
조절하며, 직교는 `화면 범위`가 작을수록 확대된다. 원근은 `카메라 거리`와 `화각`을 사용한다.
확대/축소 버튼도 게임 카메라의 값으로 기록된다. `카메라 고급 설정`에서 위치와 near/far를 조절할 수 있다.
게임 카메라 각도는 -90° 초과 90° 미만이며, 0° 수평 시점과 음수 각도도 지원한다. 편집 탐색의 1~89° 제한과 구별한다.
화면 범위·거리·near/far는 양수이며, 작은 값은 지수 표기로 표시할 수 있다. 0과 수직 각도 ±90°는 거절한다.
투영 방식을 바꿀 때는 중심에서의 수직 화면 범위를 기준으로 직교/원근 초기 구도를 맞춘다.
새 중심 거리가 클리핑 범위를 벗어날 때만 near/far를 넓히며, 이미 중심을 포함하는 값은 유지한다.
클리핑 보정도 같은 카메라 변경의 Undo/Redo·저장에 포함된다.

`현재 시점 적용`은 편집 시점을 게임 카메라에 복사하고 한 건 Undo로 기록한다. 작업 격자 표시를 위한
임시 eye/far 보정값은 저장하지 않는다. 게임 카메라 수치 변경은 편집용 탐색 시점을 유지한다.
`게임 카메라 보기`도 같은 실시간 조절 패널과 실제 게임 카메라·pixelArt 설정을 적용한 **일시정지 미리보기**를 연다.
점선 `게임 화면 범위`는 native가 전달한 실제 viewport 영역을 CSS 좌표로 표시한다.
`재개`는 실행을 시작하며 카메라 패널을 닫고 편집을 잠근다. **게임 카메라**를 다시 누르면 현재 실행을 일시정지하고
조절을 계속한다. `정지` 또는 `편집으로 돌아가기`는 이전 편집 시점으로 돌아온다. 카메라 Undo/Redo는 편집으로
돌아온 뒤 기존 문서 이력에서 수행하며, 확정한 구도는 기존 저장/내보내기로 유지한다.

카메라 변경은 spatial patch v5의 씬 수준 `setCamera` operation이며, 기존 export/handoff·desktop 저장과
다시 열기에 포함된다. browser-only 모드에서는 저장 상태 표시와 같이 명시적으로 export해야 한다.
포커스를 옮기지 않고 프로그램 저장 명령을 호출해도 입력 중인 게임 카메라 값을 먼저 검증·확정한다.
이 입력이 잘못됐거나 native 적용이 거절되면 저장을 보류하고 입력값·포커스와 기존 초안을 보존한다.
값을 고친 뒤 다시 저장할 수 있으며, 이미 확정한 값은 뒤늦은 blur에서 중복 적용하지 않는다.
잘못된 입력과 native 준비 실패는 카메라 초안·이력을 보존한다. 플레이어 추적·복수 카메라 전환은 포함하지 않는다.

XY와 camera pan은 시작 높이 평면을 기준으로 움직여 경사면에서도 이벤트 수에 따라 이동량이 달라지지 않는다.
원근 Height는 화면 handle 이동을 역투영한다. 객체를 이동하는 동안 camera 조작은 멈춘다.
Attachment 소유 위치는 agent가 원본에서 수정하며 model pose로 collider를 추정 이동하지 않는다.
Attachment 소유 Height handle도 숨긴다. Model 선택은 전체 LOD의 보수적 bounds 기준이다.
클릭 위치에서 실제로 교차하는 bounds 면의 깊이를 비교하므로 넓은 바닥 배경이 앞의 집·캐릭터 선택을 가로채지 않는다.
움직이는 게임 geometry의 정밀 identity picker로 사용하지 않는다.

HD-2D의 `Spatial Placement → Add Object`에서 Sprite 또는 등록된 Model을 선택한다.
`Place`를 누른 뒤 지형을 클릭하거나 asset 미리보기를 지형으로 드래그하면 새 오브젝트를 만든다.
Sprite frame과 선택적 Object ID를 지정할 수 있고, 빈 ID는 자동 생성한다. GLB는 `Import Model`로 먼저 등록한다.
bridge/경사면의 실제 높이·floor와 기존 snap 설정을 반영하며 지형 밖 배치는 거절한다.
Escape·Cancel·모드/탭 전환은 아직 배치하지 않은 미리보기만 정리한다. 한 배치는 한 번의 Undo/Redo로 복원한다.
Sprite는 발 pivot·기본 collider·static body를 만들고 Model은 배경 visual로 추가하여 collider를 추론하지 않는다.
선택한 이미지의 URL·크기·프레임이 바뀌면 미리보기를 갱신하고 진행 중인 배치 대기·드래그를 취소한다.
다시 배치를 누르면 갱신된 크기와 프레임을 사용한다. 다른 이미지의 갱신이나 기존 오브젝트의 작성 크기는 그대로 유지한다.
Model은 지형 높이를 visual offset으로 저장하며 물리 body/floor는 만들지 않는다.
behavior binding이 없는 ObjectDefinition을 기반으로 생성한다. 그런 definition이 없으면 catalog에서 먼저 추가한다.
native 거절·중복 ID는 초안과 이력을 보존한다. 결과는 Copy Patch/Handoff 및 저장 가능한 host의 Save로 전달한다.
같은 문서의 asset ID가 다른 GLB contentId를 이미 참조하면 배치를 거절한다. 이때 다른 asset ID로 import한다.
visual-only spatial map은 composition과 함께 rename/duplicate/remove한다. gameplay/navigation/actor/attachment/recipe 참조가 있으면 owning agent migration이 필요하다.

GLB는 asset ID/contentId가 맞는 resource를 공개 loader로 import한다. Desktop 프로젝트의
`public/assets/*.glb` catalog는 모델 문서를 열 때 자동 로드하며 저장 JSON에는 원래 asset ID를 유지한다.
직접 import와 catalog load 모두 model cache 16개/128 MiB 예산을 지킨다.
Standalone/browser 문서의 외부 모델은 먼저 Import Model로 불러온다.
Game Preview를 종료하면 작성 초안·history·편집 camera를 복원한다.
`보기 → 격자`는 2D/HD-2D 배치 기준선을 기본 표시한다. 옆 숫자는 월드 단위 기본 간격이며
Snap과 공유하지만 표시 여부와 좌표 정렬은 독립적이다. 줌 아웃에서는 선분 512개 이하와 최소 표시 간격을 유지하도록
기본 간격의 배수로 줄이고 실제 표시 간격을 `units`로 표시한다. 원근 화면의 먼 격자는 투명도를 낮춘다. 5칸마다 큰 구획과 원점 축을 구분한다.
HD-2D 작업 격자는 지형 유무와 독립해 화면 밖까지 이어지는 X/Y 평면을 표시한다. 기본 높이·층은 0이며
`보기 → 작업 평면 높이 / 작업 평면 층`에서 문서별 작업 기준을 지정한다. 카메라 target 높이나 층 보기 필터가
작업 높이를 자동으로 바꾸지 않는다. 카메라 frustum 안의 범위만 계산하고 원점 정렬·512선 상한을 유지한다.
직교 편집에서는 작업 평면이 화면 위아래까지 보이도록 렌더용 eye와 앞뒤 표시 범위를 보정한다.
축소하거나 낮은 각도로 보더라도 격자가 가운데 띠로 줄어들지 않으며, 오브젝트의 화면 위치·배율과
탭별 탐색 카메라는 유지한다. 낮은 각도의 격자 간격은 투영된 선 사이의 수직 거리를 기준으로 조절해 촘촘한 교차 무늬를 줄인다.
작업 좌표 범위 ±1,000,000 안에서 표시하며 원근 화면의 지평선 위에는 작업 평면을 그리지 않는다.
`지형 높이 격자`는 기본 꺼짐이며 켜면 작업 평면과 높이가 다른 바닥·경사로·다리에 청록색 격자와 외곽선을 표시한다.
어두운 작업 격자와 색을 구분하고, 격자 간격에 맞지 않는 지형 경계도 표시한다. 같은 평면·색의 중복선은 합친다.
모든 공간 격자는 지형·모델·sprite의 depth 가림을 따르므로 실제 바닥보다 낮은 작업 격자는 바닥 아래로 가려질 수 있다.
속성 패널의 `배치 → 배치 기준`은 기본 `지형 표면`이다. 빈 공간에 추가하려면 `작업 평면`을 선택한 뒤
에셋을 클릭 배치하거나 드래그한다. ghost에 작업 높이·층과 `실제 지지면 없음`을 표시하며 snap 좌표를 그대로 patch에 기록한다.
작업 평면 자체는 terrain·collider·보행 바닥을 만들지 않는다. 배치한 sprite는 기존 static collider 정책을 따르고,
충돌체 없는 모델은 시각 높이만 기록하며 물리 층을 추가하지 않는다. 실행 중 이동·착지는 실제 native 지형/물리 설정을 따른다.
Grid 조작은 문서·patch·Undo를 만들지 않으며 Game Preview에서는 숨기고 편집 복귀 시 복원한다.
HD-2D 선은 전체 편집 해상도에서 투명도를 혼합하며 지형·건물의 깊이 가림을 유지한다.
공식 app의 WebGL2 preview에 제공하며 engine public renderer API와 WebGPU 경로는 변경하지 않는다.
하단 Assets / Problems / Runtime / Agent Changes 탭은 한 번에 한 패널을 넓게 표시한다.
Runtime 탭에서 선택 native entity 진단과 원본 경로를, Agent Changes에서 JSON 경로별 변경을 확인한다.
상단 Play/Pause/Resume/Stop은 native Data Scene 진행을 제어하며 렌더링은 계속한다.
Stop은 직전 2D/HD-2D 편집 모드와 작성 초안·이력을 복원한다.

| 기술 | 설명 |
| --- | --- |
| Data Scene preview | 기본 `public/placement.garden.scene-authoring.json`을 로드해 `createDataSceneRuntimeTarget(...)`로 Rust `World`에 배치 instance를 spawn한다. |
| Engine-style authoring shell | `@ferrum2d/authoring-viewer` app chrome helper로 top toolbar, left object list, center viewport, right inspector, bottom runtime/status bar 구조를 만든다. |
| Workspace docks | Scene/Inspector/Panels 접기, Focus, pointer·keyboard 크기 조절과 프로젝트별 localStorage 설정을 제공한다. 문서 patch는 바꾸지 않는다. |
| Scene document tabs | 최대 8개 문서의 초안·선택·Undo 이력을 분리하며 단일 canvas/runtime을 재사용한다. |
| Multi-selection and locks | modifier/영역 선택과 그룹 XY 이동·삭제, 개별/집합 편집 잠금을 제공한다. 집합 변경은 전체 사전검증과 한 건 Undo를 사용한다. |
| 2D viewport navigation | 중간 버튼·Space drag·Pan 도구, 커서 기준 zoom, Frame/Fit Scene과 탭별 편집 카메라를 제공한다. 실제 Rust camera와 renderer를 함께 갱신한다. |
| Sectioned inspector | 고정 선택 이름·종류 아래 Properties/Placement 탭으로 속성과 배치 도구를 나눈다. 유효한 공간 필드만 표시하고 Document는 기본으로 접는다. 모델 import는 하단 Assets에, camera 도구는 canvas 밖 고정 toolbar에 둔다. |
| Placement viewer state | `createScenePlacementViewer(...)`가 selected instance, entity handle, bounds, draft patch, diagnostics를 machine-readable state로 노출한다. |
| Transform patch | numeric input, snap grid, keyboard nudge, pointer drag가 `ScenePlacementPatch` draft로 기록된다. |
| Document history | Undo/Redo와 Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z 또는 Ctrl/Cmd+Y. drag와 transform input은 작업 단위로 묶고 Escape로 취소한다. 선택과 camera 탐색은 이력을 만들지 않는다. |
| ObjectDefinition catalog | sprite/primitive/prefab object를 추가하고 ObjectDefinition 기반 prefab reference를 draft patch로 만든다. |
| Component inspector | visual kind, sprite frame, collider shape, collision layer, size/offset 값을 `props.components` 경로로 편집한다. |
| Behavior binding inspector | 기존 recipe id reference attach/detach만 `updateBehaviorBinding` patch로 처리하고 recipe 본문은 보존한다. |
| Agent handoff | `createScenePlacementAgentHandoff(...)`로 selected object, draft patch, ownership field, diagnostics summary를 남기고, Handoff 섹션에서 Copy Patch/Copy Handoff/Save Draft 상태를 분리해 보여준다. |
| Save boundary | 기본 저장은 비활성이다. host save adapter와 dev endpoint는 명시 opt-in에서만 사용한다. |

## 실행

상단 `Language / 언어` 선택에서 **한국어 / English**를 전환한다. 새로고침 없이 패널·버튼·안내·접근성 이름을
바꾸며 작성 초안·선택·Undo/Redo·카메라·열린 문서는 유지한다. 선택한 언어는 UI 전용 localStorage에 저장한다.
저장값이 없거나 잘못되면 브라우저의 기본 언어가 한국어일 때 한국어, 나머지는 영어로 시작한다.
한국어·영어 모두 2D에서는 변형·오브젝트·외형·충돌체·행동 연결 항목을 표시하고 HD-2D/게임 미리보기에서는 숨긴다.
저장소를 사용할 수 없어도 현재 페이지에서 전환할 수 있다. 오브젝트·에셋·레시피 ID, 파일명/경로,
JSON·patch·handoff·입력값과 원본 엔진 진단은 번역하지 않는다. OS 파일 선택창 등 브라우저 기본 UI는 실행 환경 언어를 따른다.

한글 글꼴이 없는 환경에도 표시하도록 Noto Sans KR의 한글 subset WOFF2를 app에 포함한다. 런타임 외부 CDN 요청은 없다.
원본 commit·hash·변환 범위는 `public/fonts/NotoSansKR.source.json`, 배포 라이선스는
`public/fonts/NotoSansKR-OFL.txt`에 보관한다. public engine package나 generated consumer viewer의 언어 계약은 바꾸지 않는다.

```bash
pnpm dev:placement-viewer
```

개발 서버에서 `/`는 2D 정원을, `/?scene=hd2d`와 `/?scene=village`는 HD-2D 마을을 연다.
공간 데이터가 있는 문서는 HD-2D로 시작하며 상단 **2D / HD-2D**로 모드를 전환한다.
HD-2D 마을 원본은 `public/placement.village.scene-authoring.json`이다. 이전의 지형·발판·사각 sprite 기초 씬은 테스트 입력으로만 유지한다.
브라우저 마을 편집은 export를 사용하며 정원 문서 저장 endpoint에 쓰지 않는다.

### Blender 중세 마을 예제

`http://localhost:5173/?scene=village`에서 90년대 16비트 RPG 분위기의 중세 마을을 연다.
Blender로 직접 만든 목조 여관·상점·주택·종탑·우물·수레·나무·울타리·꽃밭·다리와 하천/돌길을 배치했다.
남서쪽 나무 아래에는 높이 24의 정원 단과 높이 0→24 경사길이 있다. `보기 → 지형 높이 격자`를
켜면 이 구역의 높은 바닥·경사면에 기준선이 추가된다. 기본 작업 격자는 높이 0에 유지된다.
실행 시 남쪽 돌길에서 왼쪽으로 경사길을 따라 정원 단을 오르내릴 수 있다.
Blender 외형과 native 보행면은 같은 치수를 사용하며 평지는 겹치지 않게 나눈다.
14종 GLB를 42개 모델로 재사용하며 픽셀 인물 4명까지 총 46개 native entity를 구성한다.
게임 미리보기는 384×256 고정 해상도와 nearest 텍스처, 태양광/그림자·색 보정을 사용한다.
HD-2D 편집은 픽셀 해상도/정수 배율 letterbox를 해제하고 전체 canvas 해상도를 사용한다.
패널을 접거나 화면 크기를 바꿔도 캔버스 안의 숨은 사각 영역에서 오브젝트가 잘리지 않는다.
원본 JSON의 `pixelArt`는 유지하며 게임 미리보기로 전환하면 다시 적용한다.
초기 마을 카메라는 기본 패널 배치에서도 외곽 지형·나무를 볼 수 있게 설정했다.
게임의 각도·크기는 씬 JSON의 `spatial.camera`에서 정한다. `position`에서 `target`을 향하는 방향이 각도이며,
직교 `height`는 화면에 담는 월드 세로 범위다(작을수록 확대). 마을 기본값은 약 37°·`height: 660`이다.
원근 카메라는 `fovDegrees`와 target까지의 거리로 구도를 정한다. `pixelArt`의 384×256은 게임 렌더 해상도다.
편집 각도·확대율·표시 거리 보정은 원본 게임 카메라에 저장하지 않는다.

- **실행 → WASD**: 파란 옷 주인공 이동·방향별 걷기, 건물·나무 줄기 충돌, 다리에서 강 건너기.
- **일시정지 / 재개 / 정지**: 정지하면 작성 위치·초안·편집 카메라로 돌아온다. 플레이 위치는 JSON에 저장하지 않는다.
- **HD-2D**: 기존 배치/카메라 도구로 모델·인물의 위치를 수정한다. 편집 격자는 기본 표시하며 `보기 → 격자`에서 전환한다.
- **내보내기**: 마을은 export 전용 예제다. 퀘스트·NPC 대화·전투·건물 내부 전환은 구현하지 않았다.

원본은 [rpg-village.blend](assets/rpg-village/rpg-village.blend),
[제작 스크립트](../../scripts/assets/build-rpg-village.py),
[씬 JSON](public/placement.village.scene-authoring.json),
[에셋 hash·출처 manifest](public/assets/rpg-village/manifest.json)이다.
이미지/모델은 외부 게임에서 가져오지 않은 프로젝트 원본이며 저장소와 같은 MIT OR Apache-2.0 조건을 따른다.
Blender 파일은 각 모델의 export scene과 전체 배치 `Village_Overview` scene을 포함한다.

Blender 5.2.2 LTS에서 다음 명령으로 모델·PNG·manifest·씬 JSON·원본을 함께 재생성한다.
출력 파일을 덮어쓰므로 수동 수정은 생성 스크립트에 반영한다. 새 production 의존성은 없다.

```bash
blender --background --factory-startup --python scripts/assets/build-rpg-village.py
```

WSL에서 Windows Blender를 사용하는 경우:

```bash
'/mnt/c/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python '\\wsl.localhost\Ubuntu\home\psj\projects\ferrum2d\scripts\assets\build-rpg-village.py'
```

표준 Y-up GLB export, 정적 diffuse 재질과 명시적 AABB/보행면을 사용한다.
시뮬레이션·충돌·sprite clip 선택은 기존 Rust runtime에서 처리한다.
마을 asset catalog는 공식 app 내부에서만 로드하며 engine public API나 consumer template은 변경하지 않는다.
`pnpm smoke:placement-village`는 production build의 실제 픽셀·hash·보행/충돌·복원·렌더 예산을 검사한다.

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/ferrum-web build
pnpm --filter @ferrum2d/placement-viewer dev
```

저장 adapter smoke를 확인할 때만 opt-in 환경을 사용한다.

```bash
VITE_FERRUM_PLACEMENT_VIEWER_SAVE=true pnpm --filter @ferrum2d/placement-viewer dev
```

## Assets 노멀맵 도구

`pnpm normals:wasm:build`로 선택형 생성기를 준비한 뒤 dev 또는 새 preview 서버를 시작한다.
서버는 고정 cache를 읽기 전용으로 제공하며 기본 build가 생성기를 설치하거나 포함하지 않는다.
정적/외부 host는 `window.ferrumPlacementNormalAssetHost.generator`에 고정 manifest URL/hash를 제공한다.
상세 계약은 [브라우저 생성기](../../docs/engine/data-scene-spatial.md#선택형-브라우저-노멀맵-worker)를 따른다.

Assets의 sprite `Normal` 버튼 또는 `Generate Normal`을 열어 PNG/GIF/APNG를 선택한다.
Settings에는 7개 설정·Default/Soft/Crisp preset·균일 PNG grid·명시적 animation/loop가 있다.
Preview는 color/normal과 Flat/Normal 조명, Fixed/Moving Light를 비교한다. Expand/Restore는
Assets 영역을 도구에 집중하며 문서나 저장된 dock 크기를 바꾸지 않는다.
조명 비교는 별도 asset 시각화이며 최종 씬의 그림자·톤 매핑과 같은 renderer 결과를 보장하지 않는다.
Preview는 full source atlas를 표시한다. clip 재생은 Apply 후 native 씬에서 확인한다.

Generate/Regenerate는 씬을 바꾸지 않는다. Apply는 선택한 unlocked HD-2D sprite billboard에만
검증한 combined patch를 한 건의 Undo로 적용한다. 2D에서는 생성·비교·내보내기를 사용할 수 있다.
설정/원본 변경 후에는 다시 Generate해야 Apply할 수 있다. 오류/Cancel은 기존 draft를 보존한다.
문서 전환/모드 변경은 진행 작업을 취소하고 탭별 원본·설정·결과를 분리한다.
활성 조명 preview는 1개이며 문서 닫기/페이지 종료에서 Worker·URL·GPU 자원을 해제한다.
전체 source cache는 64 MiB, 생성 pair는 8건/64 MiB/8,388,608 pixel 상한이다.
다른 탭의 session 생성 참조를 그대로 가져오는 JSON은 거절한다. 먼저 project catalog에 등록하고 다시 연다.

`Export Assets`는 `ferrum2d.sprite-normal.assets` v1 JSON을 내려받는다. PNG base64/실제 SHA-256,
report·metadata·선택형 descriptor, binding과 이름/색 공간을 가진 texture manifest가 포함된다.
export는 project 파일 저장 완료가 아니다. agent/host가 파일을 독점 생성하고 manifest를 등록한다.
`Save Assets`는 `window.ferrumPlacementNormalAssetHost.saveAssets` 또는 명시적으로 연 desktop 프로젝트의 기본 host를 사용한다.
이 app 전용 adapter 계약은 `src/placementNormalAssets.ts`다. bundle의 `overwrite:false`를 지키고
파일 생성과 project catalog의 이름·색 공간 등록을 함께 수행한 뒤 `{registered:true,textures}`를 반환한다.
`textures`는 binding 이름→durable HTTP(S)/ferrum-asset URL map이다. URL의 실제 bytes/hash·decode 크기를
다시 검사한 뒤에만 저장 완료로 인정한다. host는 충돌/부분 실패를 정리하고 AbortSignal을 따라야 한다. 이미 확정한 native 파일 transaction은 취소 뒤에도 남을 수 있다.
기본 browser/desktop host의 쓰기 권한을 자동 확대하지 않으며, 미저장 생성 에셋을 참조하는 Scene Save는 거절한다.
파일을 설치할 host가 없으면 export bundle을 agent에게 넘겨 프로젝트에 반영한 뒤 다시 연다.
bundle과 함께 Copy Patch/handoff를 보관한다. bundle에는 문서 키만 있고 씬 JSON은 들어 있지 않다.
agent는 실제 PNG hash/크기를 확인해 stable 이름과 color=`srgb`/normal=`none`을 catalog에 등록하고,
동반 patch를 씬에 반영한 뒤 새 세션에서 다시 연다. [재개 절차](../../docs/engine/data-scene-spatial.md#export-bundle로-agent-작업-재개)를 따른다.
Settings/Preview는 방향키·Home/End, Cancel은 Enter/Space로 조작한다. 생성 pair 한도에 도달하면
문서를 닫아 자원을 해제한다. 이전 pair로 Undo/Redo할 때 해당 생성 근거도 handoff에 복원한다.

## Tiled/LDtk 타일 프레임

Assets → **Import Tile Frames**에서 포맷, 논리 asset 이름과 JSON을 고른 뒤 **Tileset** 목록에서 이름/파일명을 확인하고 해당 PNG를 선택한다.
외부 Tiled tileset은 **External TSJ Files**에서 참조된 `.tsj`를 모두 선택한다. 상대 source의 basename과 파일명이 일치해야 하며 중복 basename/누락/추가 파일은 거절한다. 경로 자동 읽기는 하지 않는다.
LDtk는 0부터 시작하는 Level Index로 embedded level 하나를 고른다. Inspect 후 Preview에서 사용 중인 frame을 확인한다.

- **Register**: 문서 세션 catalog/GPU와 Assets 목록에 등록한다. 씬은 바꾸지 않는다.
- **Apply Frame**: 선택한 unlocked sprite의 texture/UV를 한 Undo로 교체한다.
- **Reimport**: 같은 포맷·논리 이름의 이전 revision을 참조하는 활성 fragment를 frame 이름으로 대응시켜 한 Undo로 갱신한다.
- **Save Project**: desktop Open Project 기본 문서의 원본·catalog를 저장하고 실제 파일 재검증 후 씬을 저장한다. 재열기 시 프레임을 원본에서 복원한다.
- **Export Assets**: 원본 JSON/PNG·SHA-256·manifest·재현 가능한 atlas/tilemap·LDtk entity metadata와 현재 scene/patch를 내보낸다.

Assets의 frame 선택·클릭 배치/드래그는 기존 2D/HD-2D Add Sprite 경로를 사용한다.
Apply/Reimport는 작성한 size/pivot/pose/collider/body/behavior와 billboard 설정을 유지한다.
normal binding, animated/legacy sprite, 잠긴 대상, 누락/모호한 frame은 거절한다. tileset 또는 LDtk level identity가 바뀌면 frame을 명시적으로 적용한다.
전체 level·collision·entity를 Data Scene에 자동 적용하지 않는다. 변환된 맵은 agent가 Game Spec에 연결한다.

지원 범위는 **원본 tileset 1..8개, import당 선택 tileset 1개/PNG 1개**, finite orthogonal Tiled의 embedded/외부 TSJ tileset·비압축 data 배열,
LDtk embedded level의 Tiles/AutoLayer·entity metadata다. 외부 TSX·LDtk external level, IntGrid, flip/회전은 지원하지 않는다. 다중 tileset 선택에서 Tiled group layer는 먼저 평탄화한다.
다중 tileset의 변환 map은 선택 범위의 부분 결과다. 제외한 타일 수를 표시하며 원본 map JSON과 TSJ는 그대로 보존한다. TSJ만 변경해도 새 revision이 되며 native 저장·재열기와 export에도 원본을 포함한다.
선택 key는 native catalog와 export/handoff에 포함되고 재열기 때 이름/UID로 복원한다. 여러 선택을 각각 가져올 때는 논리 asset 이름을 구분한다.
map+TSJ JSON 합계 1 MiB, PNG 16 MiB·4096 side·4MP, used frame 1..256, layer 최대 16, layer 전체 grid 합계 65,536 cell을 허용한다.
세션은 staged/등록 revision 8건·원본 합계 64 MiB다. Undo/다른 fragment의 이전 revision을 자동 삭제하지 않는다.

등록은 세션 메모리 작업이며 미설치 tile 참조의 scene Save를 차단한다.
Open Project 기본 문서는 Save Project로 `.ferrum-tiles`에 원본·source-only catalog를 보존하고 scene CAS를 실행한다.
다른 문서/host는 export의 stable 이름과 color=`srgb` manifest를 설치한 뒤 동반 scene/patch를 적용한다.
문서/모드 전환과 Cancel은 진행 작업을 취소하고, 문서 닫기/종료는 소유한 URL/GPU texture를 해제한다.
[상세 계약](../../docs/engine/data-scene-authoring.md#tiledldtk-타일-프레임-assets)을 따른다.

## Aseprite Assets 가져오기·재import

Assets의 `Import Aseprite`에서 Aseprite JSON과 해당 PNG를 명시적으로 선택하고 논리적인 asset 이름을 입력한다.
JSON의 `meta.image` basename과 선택한 PNG 파일명이 같아야 한다. JSON 경로를 따라 파일을 자동으로 읽거나 fetch하지 않는다.
`Inspect`는 실제 PNG 크기/SHA-256과 JSON frame rect/name을 확인하고 선택 프레임을 보여준다. 파일 선택과 Inspect는 씬을 바꾸지 않는다.

| 작업 | 결과 |
| --- | --- |
| Register | 세션 catalog/GPU에 등록한다. Assets의 atlas/frame 선택·배치에서 사용할 수 있으며 씬과 Undo 이력은 바뀌지 않는다. |
| Apply Frame | 선택한 unlocked sprite에 프레임을 한 건의 Undo로 적용한다. 작성한 size/pivot/pose/collider/body/behavior는 유지한다. |
| Reimport | 같은 논리 이름의 이전 revision을 참조하는 **활성 fragment**를 프레임 이름으로 대응시켜 한 건의 Undo로 갱신한다. |
| Apply Animation | 선택 sprite에 모든 frameTag를 기존 `animationSet`으로 연결한다. Preview에서 시작 태그와 새 clip의 loop를 선택한다. |
| Reimport Animation | 활성 fragment의 이전 animated revision을 명시적으로 migration한다. 기존 numeric clip ID·시작 clip·loop를 유지한다. |
| Generate Normals | 선택한 unlocked HD-2D billboard에 선택 frame과 새 노멀을 한 건의 Undo로 적용한다. |
| Reimport Normals | 활성 fragment의 이전 atlas 참조를 이름으로 대응시켜 color/UV·노멀을 한 건의 Undo로 교체한다. |
| Apply Paired | 선택 HD-2D billboard에 태그 애니메이션과 생성 노멀을 한 건의 Undo로 적용한다. |
| Reimport Paired | 활성 fragment의 이전 animated revision과 노멀을 함께 교체한다. 기존 clip ID·시작 clip·loop를 유지한다. |
| Save Normals | normal asset host의 파일/catalog 등록과 실제 bytes 검증 후에만 저장을 인정한다. 기본 desktop project host도 제공한다. |
| Save Project | 데스크톱에서 연 프로젝트의 원본/manifest를 확정하고 기존 씬 저장을 실행한다. 파일 충돌과 외부 씬 변경을 검사한다. |
| Export Assets | 등록한 문서 revision들의 원본 JSON/PNG·hash·frame·manifest가 든 agent bundle을 내보낸다. 프로젝트 파일 저장 완료가 아니다. |

JSON hash/array frame export, 정수 rect의 비회전·비트림 프레임을 지원한다. frame ID는 확장자까지 원래 이름을 유지한다.
frameTags/duration은 명시적 Apply Animation/Reimport Animation에서 native animation으로 변환한다. 일반 Apply Frame/Reimport는 animated/legacy sprite 교체를 거절한다.
normal binding이 있는 대상의 일반 Apply Frame/Reimport도 차단한다. 정적 대상은 Generate Normals/Reimport Normals,
애니메이션 대상은 Apply Paired/Reimport Paired로 노멀을 함께 교체한다.
원본 `.ase` 파일 편집·Tiled/LDtk UI 연결·백그라운드 자동 재생성은 포함하지 않는다.

애니메이션은 1..64개 태그와 forward/reverse/pingpong/pingpong_reverse를 지원한다. 정수 ms duration의 GCD로
반복 UV를 만들며 native 32 frame/FPS 한도를 넘으면 근사하지 않고 거절한다. 유한 repeat, 누락/이름 변경된 태그,
모호하거나 원본과 대응하지 않는 수동 수정 clip도 진단한다. 노멀 연결 대상은 Apply Paired/Reimport Paired를 사용한다.
paired 작업은 clip 전체에서 최대 32개 unique frame UV를 지원한다. 반복 timing tick은 같은 UV를 공유한다.
Save Project 후 새 실행에서도 애니메이션과 노멀 binding evidence를 복원한다.
[애니메이션 import/migration 계약](../../docs/engine/data-scene-authoring.md#aseprite-애니메이션-import와-migration)을 따른다.

추가/변경/삭제 frame과 PNG 변경을 비교한다. 씬에는 frame 이름 대신 UV가 있으므로 이전 revision의 UV에서 frame 이름을 찾는다.
이름이 삭제되었거나 같은 UV를 여러 frame이 공유해 대응이 모호하면 재import를 막는다. `Apply Frame`으로 대상을 명시해 옮길 수 있다.
다른 fragment와 Undo/Redo가 참조하는 이전 revision은 그대로 보관한다. 새 revision은 내용 기반의 별도 texture 이름을 쓰므로
실패/취소된 업로드가 기존 이미지를 덮어쓰지 않는다. 잠금/문서/선택 변경과 native 적용 실패도 이전 씬을 유지한다.
2D 작성 화면은 기존 overlay 경로를 유지하며 실제 native 결과는 Game Preview에서 확인한다. HD-2D는 작성 preview에도 적용한다.

JSON 1 MiB, PNG 16 MiB·한 변 4096/4 megapixel, 1~256 frame을 허용한다. 세션은 staged/등록 revision 합계 8건/64 MiB다.
문서 전환·Game Preview 진입은 진행 작업을 취소하고, 닫기/종료는 그 문서의 Blob URL과 GPU texture를 해제한다.
Source/Preview 탭은 방향키/Home/End로, Cancel은 Enter/Space로 조작한다.

app 전용 handoff 확장 `asepriteImports[]`는 현재 씬에서 참조하는 revision의 논리 이름·asset ID·원본 파일명·hash·frame을 제공한다.
엔진의 `ScenePlacementAgentHandoff` 함수 결과나 Data Scene schema를 변경하는 필드는 아니다.
현재 원본과 씬에서 유일하게 식별 가능한 애니메이션에는 `asepriteImports[].animations[]`도 제공한다. Export Assets의 `animations[]`와 같은 tag 이름/clip ID·duration·반복 UV tick·native float32 FPS 오차 근거이며 Undo/재열기 때 다시 계산한다. 수동 수정되거나 모호한 animation은 검증된 import evidence로 표시하지 않는다.
`ferrum2d.aseprite.assets` v1 bundle에는 `overwrite:false`, 문서 키, `revisions`, `manifest`, `files`가 있다.
`files`의 base64를 decode하고 SHA-256·PNG 크기·JSON frame을 다시 검증한 뒤 프로젝트 안에 기존 파일을 덮어쓰지 않고 설치한다.
manifest의 stable texture 이름과 `srgb` 색 공간을 유지해 catalog에 등록하고, **동반 Copy Patch/handoff**를 씬에 반영한다.
원본 JSON/PNG bytes는 그대로 보관한다. bundle의 문서 키는 씬 JSON이 아니며, bundle만 설치해도 씬이 자동으로 바뀌지 않는다.
새 세션에서는 catalog를 `loadAssets`로 로드한 뒤 씬을 열어 확인한다. 미저장 session 참조의 scene-only Save와 다른 문서 복사는 막는다.

데스크톱에서 `Open Project`로 연 기본 프로젝트 문서에는 **Save Project**를 제공한다. 저장 순서는 다음과 같다.

1. 원본 byte/SHA-256·PNG decode·frame·이름·색 공간을 native host에서 검증한다.
2. `public/assets/.ferrum-aseprite/<assetId>.png`, `<assetId>.json`을 독점 생성한다. 같은 원본은 재시도에서 재사용하며 다른 bytes를 덮어쓰지 않는다.
3. `catalog.json`을 원자적으로 확정하고 durable protocol URL의 원본을 app이 다시 검증한다.
4. 기존 Scene Save의 기준 JSON 비교 후 교체를 실행한다. 외부 씬이 바뀌었으면 보존하고 실패를 표시한다.

씬 충돌 시 이미 확정한 에셋/catalog는 보관한다. 충돌 해결 후 같은 revision으로 재시도할 수 있다.
Cancel/문서 전환은 늦은 UI 적용과 후속 씬 저장을 막는다. 이미 시작한 native 파일 transaction은 완료될 수 있다.
새 실행은 catalog의 원본/hash·frame·revision identity를 검증해 GPU에 로드한 뒤 씬을 적용한다. Assets frame과 재import 연결도 복원한다.
handoff의 `persisted:true`는 검증된 프로젝트 파일이 있다는 뜻이며, 씬 저장 성공은 별도로 확인한다.
처음 제공하는 프로젝트 catalog 한도는 8 revision/원본 합계 64 MiB다. 문서 닫기로 디스크 catalog가 줄어들지 않으며 자동 삭제하지 않는다.
한도 확대·미사용 revision 정리는 후속 범위다. 다른 문서의 세션 에셋 복사와 직접 연 임의 문서의 프로젝트 저장은 계속 제한한다.
browser-only에는 파일 쓰기 경로를 추가하지 않는다. Export Assets와 동반 patch를 agent에게 전달할 수 있다.
게임 runtime에서는 [저장 catalog 로딩](../../docs/engine/data-scene-authoring.md#aseprite-프로젝트-저장과-runtime-로딩)을 따른다.

### Aseprite 노멀 재생성

HD-2D에서 atlas를 Inspect한 뒤 Preview의 frame을 선택하고 Generate Normals를 실행한다.
업데이트된 JSON/PNG를 Inspect한 뒤 Reimport Normals를 실행하면 활성 fragment의 이전 atlas 참조들을 갱신한다.
기존 Generate Normal 도구의 수치 설정을 사용하되 PNG Grid/Export Animation은 사용하지 않는다. Aseprite rect가 프레임 경계다.
각 rect를 별도 Worker 입력으로 생성한 뒤 원래 좌표에 RGBA8 바이트로 합성한다. 투명 픽셀의 RGB도 보존하며 color atlas와 UV 배치는 바꾸지 않는다.
서로 다른 rect가 겹치면 거절하고, 완전히 동일한 rect는 한 번 생성한다. 색상 입력 한도에 더해 Aseprite 노멀 store는 8 revision/64 MiB/8,388,608 pixel을 제한한다.
생성 실패/Cancel·잠금 변경·upload/preview 실패는 기존 씬과 이력을 보존한다. 이전 normal texture는 Undo/Redo 동안 유지한다.
브라우저에 CompressionStream/DecompressionStream과 기존 optional 생성기가 필요하다. 생성기 설치는 [Assets 노멀맵 도구](#assets-노멀맵-도구)를 따른다.

Export Assets는 참조 중인 노멀의 `normalAssets[]`와 현재 씬의 `normalBindings[]`를 Aseprite v1 bundle에 추가한다.
각 normalAssets는 기존 `ferrum2d.sprite-normal.assets` v1이며, report는 `ferrum2d.aseprite-normal.report` v1이다.
report에는 원본 PNG/JSON hash, 설정, 각 rect의 실제 Worker report, 합성 PNG hash, pipeline config hash가 있다.
agent는 일반 생성 report와 구분하고 각 파일 hash/크기와 color=`srgb`/normal=`none` manifest를 확인한다.
normal binding은 기존 public 형식을 사용한다. handoff에는 정적 frame UV 또는 paired animationSet/unique UV layout을 명시한다.
bundle에는 씬 JSON이 없으므로 Copy Patch/handoff도 함께 전달한다.

Save Normals는 `ferrumPlacementNormalAssetHost.saveAssets` 또는 기본 desktop project host가 있을 때 활성화한다. 잘못된 durable 파일 응답은 저장 완료로 표시하지 않는다.
Save Project도 참조 중인 미저장 노멀을 먼저 같은 host에 저장·확인한 뒤 원본/catalog·씬 저장을 진행한다.
기본 Tauri project host는 `.ferrum-normals` catalog에 생성 PNG pair·report/descriptor를 저장하고 새 실행에서 복원한다.
기존 Normal tool의 Save Assets도 같은 host를 사용한다. color=`srgb`/normal=`none`, 실제 PNG hash·크기와 생성 근거를 다시 확인한다.
Aseprite 원본의 color texture는 hash/색 공간이 같을 때 공유하고, 복원된 Assets/handoff와 Export Assets도 현재 씬을 따른다.
프로젝트 한도는 8 pair/PNG 64 MiB/decoded color+normal 8,388,608 pixel이다. 입력 GIF/APNG와 생성 폼 전체는 복원하지 않는다.
browser-only는 Export Assets와 동반 patch를 사용하며 미설치 참조의 scene Save는 계속 차단한다.
[native 저장·재열기 계약](../../docs/engine/data-scene-authoring.md#생성-노멀의-native-프로젝트-저장재열기)을 따른다.

## 검증

```bash
pnpm --filter @ferrum2d/placement-viewer build
pnpm test:placement-locale
pnpm smoke:placement-locale
pnpm smoke:placement-viewer
pnpm smoke:placement-spatial-workspace
pnpm smoke:placement-viewer-save
pnpm smoke:placement-viewer-mass-authoring
pnpm smoke:placement-document-store
pnpm smoke:sprite-normal-ui
pnpm smoke:sprite-normal-integration
pnpm smoke:aseprite-assets
pnpm smoke:aseprite-project
pnpm test:aseprite-normal-png
pnpm smoke:aseprite-normals
```

`pnpm smoke:placement-viewer`는 production build를 열고 canvas nonblank, selected id/entity handle, draft patch, Project Assets Add Sprite, ObjectDefinition 생성, Behavior Binding attach/detach reference patch, Handoff copy/save action 상태를 확인한다. `pnpm smoke:placement-viewer-mass-authoring`은 1,024개 추가 object scene에서 selection/patch/handoff summary와 render/runtime 규모를 확인한다.
`smoke:sprite-normal-ui`는 선택형 Wasm bundle·빌드한 ferrum-web JS/엔진 Wasm·Chromium이 필요하다.
테스트 전용 save-enabled app을 빌드하고 실제 Worker·UI/Undo·export·host 충돌/hash·문서 분리·자원 해제를 검사한다.
host 파일 쓰기는 전용 artifact 디렉터리에서만 수행한다. 공식 app의 source/기존 프로젝트 파일은 수정하지 않는다.
통합 명령은 고정 CLI도 필요하며 renderer/frame/flip/rotation/DPR·WebGPU/fallback과 부분 실패·새 세션 재개·자원 한도를 검사한다.
`FERRUM_REQUIRE_WEBGPU=1`이면 WebGPU adapter가 없는 환경도 실패한다. 테스트 후 기본 app build를 다시 실행한다.

## 문서 이력과 저장 충돌

상단에 Undo/Redo 아이콘을 제공하고 툴팁에 단축키를 표시한다. 문서 탭의 수정 표시와 하단 상태 바로 변경 여부를 확인한다.
저장 상태와 전체 문서 경로는 `파일` 메뉴에서 확인한다. 파일 저장이 불가능한 문서는
`Export Only`와 초안 변경 수를 독립 표시하며 Copy Patch/Handoff로 변경을 보관한다.
텍스트 입력 중 Ctrl/Cmd+Z는 입력칸의 기본 동작을
유지하며 focus를 벗어나면 transform input을 한 건으로 확정한다. 이력은 문서당 최대 100건/8 MiB의
직렬화 snapshot으로 제한한다. Revert도 되돌릴 수 있다. 탭을 오가도 이력을 유지하고 저장에 성공한 탭만 이력을 초기화한다.
미저장 문서의 이탈을 확인하며 저장 중에는 UI 편집과 중복 저장을 막는다.
드래그 중이거나 마지막 pointer 입력의 프레임 반영을 기다리는 동안에는 저장을 시작하지 않는다.
gesture가 끝난 뒤 저장하면 최종 좌표를 포함한다. 숫자 입력은 확정한 뒤 patch를 캡처한다.
마지막 pointer 반영을 기다리는 동안 탭 전환·활성 문서 닫기도 보류하여 마지막 이동을 버리지 않는다.
native preview가 숫자 입력·Undo/Redo·취소를 거절하면 정상 초안과 이력 위치를 복구하고 Problems에 표시한다.
취소 복구도 거절되면 직전 정상 초안과 진행 중 작업을 유지한다. 복구 native 적용까지 실패하면 오류를 표시하고
stale handle이 선택되지 않도록 registry를 비운다. 취소/실패한 Revert는 아직 유효한 객체의 편집 잠금을 보존한다.
HD-2D drag 취소가 거절되면 모드·탭 전환을 멈추며, Escape나 마우스 해제로 취소를 다시 시도할 수 있다.
오류 안내는 별도 행에 표시하여 viewport 조작을 가리지 않는다.

## 작업공간 조작

- 데스크톱의 `보기 → 화면 구성 / Layout`에서 `Scene`, `Inspector`, `Panels`를 접거나 복원한다. 같은 메뉴의 `Focus`는 기존 설정을 보존하고 viewport에 집중한다.
- 뷰포트 도구 행의 `화면 확장 / Expand View`는 좌우·하단 패널을 함께 접고 `화면 복원 / Restore View`로 원래 구성을 돌린다.
  `보기` 안에는 실제 canvas 크기를 CSS 픽셀로 표시한다. 좌우·하단 경계의 손잡이를 드래그해 보는 공간을 조절하며 방향키로 미세 조절할 수 있다.
  좁은 화면에서는 기존 패널 서랍과 닫기 버튼을 사용한다.
- panel 경계를 drag하거나 focus 후 방향키로 8px, Shift+방향키로 32px 조절한다. Home/End는 최소/최대,
  Escape는 진행 중인 크기 조절을 취소한다. `화면 구성 → Reset Layout`은 기본 배치로 복원한다.
- 860px 이하에서는 Viewport/Scene/Inspector/Panels 탭으로 한 번에 하나의 서랍을 연다. canvas는 계속 표시한다.
  Close 또는 Escape로 닫으면 연 버튼으로 focus가 돌아간다. 패널 탭은 방향키/Home/End로 전환한다.
  입력칸과 진행 중 gesture의 Escape 처리를 우선한다. desktop은 viewport 360px을 우선 확보하고 panel 폭을 조정한다.
- 서랍 전환은 desktop 크기·접힘 설정을 덮어쓰지 않는다. 좁은 창에서도 상단 동작 버튼은 줄바꿈해 표시한다.
  주 도구는 한 줄로 유지하고 패널 탭을 필요한 행에 배치한다. 남은 높이에 맞춰 서랍을 줄여 canvas 공간을 확보한다.
- 크기·접힘 상태만 프로젝트별 localStorage에 저장한다. storage가 막히거나 설정 JSON이 손상돼도 기본값으로 동작한다.
- 고정 상태 행의 변경/문제 수 옆 `Review`는 Agent Changes를, `Export`는 Inspector의 Handoff를 연다.
  Copy Patch/Handoff와 Save는 기존 참조 보호와 host 권한을 따른다. Export Only host에서는 파일 저장이 비활성화된다.
- `파일 → Open JSON`은 2 MiB 이하의 2D·HD-2D Scene Authoring JSON을 새 탭으로 연다. 가져온 파일은 Copy Patch/Handoff를 사용하며
  개발 endpoint나 desktop 파일에 자동 저장하지 않는다. HD-2D 모델은 일치하는 GLB를 먼저 import한다.
- desktop의 Browse/Open Path는 열린 canonical 문서 탭으로 이동하거나 새 탭을 만든다. `Open Project`는 전체 프로젝트 전환이다.
- 문서는 최대 8개, 최소 1개 탭을 유지한다. 탭에서 좌우 방향키/Home/End를 사용할 수 있고 미저장 탭을 닫을 때 확인한다.
- 비활성 탭은 JSON 초안·선택·이력·Inspector와 asset/host 문맥만 유지한다. runtime을 추가 생성하거나 게임 진행을 복제하지 않는다.
  전환 시 native preview는 해당 기준 문서로 재설정하며 저장 성공도 다른 탭을 reload하지 않는다.

탭 초안은 페이지 세션에만 존재한다. 페이지 이탈 경고는 비활성 탭까지 포함한다.
이탈을 취소한 화면의 runtime은 유지하고 실제 `pagehide`에서 자원을 정리한다.

## 씬 조명

**보기 → 조명**에서 씬 조명을 켜고 끄고 환경광, 태양의 밝기·색·방향, 점광원의 위치·반경·밝기·색과 그림자를 조절한다.
HD-2D는 점광원 최대 4개와 한 점광원의 그림자를 지원한다. 태양 그림자는 별도다. 2D는 점광원 최대 32개이며
차폐 그림자는 문서의 `lighting.tileOccluders`를 사용한다. 태양의 지면 그림자는 visual에 작성된 `shadow`를 사용한다.
그림자 checkbox만으로 없는 caster/차폐 데이터를 생성하지 않는다.

OFF는 광원 설정을 지우지 않는다. HD-2D의 pixelArt·안개·색 보정 등 다른 환경 설정도 보존한다.
숫자는 Enter/blur로 반영하며 방향키로 증감한다. Shift는 정밀, Ctrl/Cmd는 빠른 증감이다. 입력 중 Escape는 수정 전 값으로 되돌린다.
게임 실행 중에는 편집을 잠근다. 정지하면 편집할 수 있고, 공간 조명은 HD-2D에서 작성한다.
설정은 문서 초안과 Undo/Redo, JSON patch, Save Draft/내보내기에 포함된다. 저장 명령은 초점을 둔 숫자 입력도 검증해 반영하며
잘못된 값은 저장을 막고 수정할 수 있게 남긴다. browser-only의 Export Only 저장 정책은 같다.

2D는 `lighting`, HD-2D는 `spatial.environment.lighting`이 원본이다. 관련 버전/수치 범위는
[authoring API](../../docs/engine/public-api/authoring.md#2d-scene-lighting-placement-patch)를 따른다.

## 2D 화면 탐색

데스크톱 상단은 36px 두 줄로 구성한다. 첫 줄은 파일 메뉴·가운데 작업 모드·오른쪽 Undo/Redo와 언어·실행 제어다.
둘째 줄은 문서 탭과 **선택/화면 이동 아이콘 → 게임 카메라 → 보기 → 화면 확장 아이콘**이다.
문서 이름은 탭에 표시하고 전체 경로·저장 상태는 `파일` 메뉴에서 확인한다. 버튼에는 접근성 이름과 툴팁을 유지한다.
**보기**에는 선택/전체 씬 맞춤, **편집 시점**의 회전·확대·초기화, 층, 격자·정렬,
화면 구성과 사용 안내를 모은다. 2D의 현재 배율/100% 복귀와 HD-2D의 상하 각도도 편집 시점 메뉴에 있다.
방향키/Home/End는 주 도구 행의 focus를 이동하며 실행하지 않는다. 메뉴 내부 입력칸의 기본 키는 유지한다.
현재 조작과 Space 안내는 하단 상태 바로 옮긴다. 배치 대기 중에는 상단에 취소 아이콘을 제공한다.

`사용 안내 / Controls`는 배치·속성 편집·화면 이동·맞춤 단축키·실행·변경 보관 방법을 설명한다.
편집 카메라와 씬에 설정된 게임 카메라의 차이도 확인할 수 있다. 실행 전에는 `Play`, 실행 중에는 `Pause/Resume`와 `Stop`을 표시한다.
편집 시점·화면 구성·사용 안내는 Enter/Space로 열고 Escape로 닫아 원래 버튼에 focus를 돌린다.
바깥 클릭·focus 이동으로 닫히며 창 크기가 바뀌면 닫아 잘못된 위치의 메뉴가 남지 않게 한다.
배치 대기 중 Escape는 안쪽 메뉴부터 닫고 배치 대기는 유지한다. 메뉴를 모두 닫은 뒤 Escape로 배치를 취소한다.
보기 패널을 스크롤해 안쪽 메뉴의 기준 버튼이 움직이면 해당 팝업을 닫는다. 메뉴 안의 안내문 스크롤은 메뉴를 닫지 않는다.
좁은 화면에서는 패널 탭을 유지하고 메뉴는 창 안에 맞춰 표시한다.

이 구성은 [Godot의 작업 화면·문맥 도구 분리](https://docs.godotengine.org/en/stable/getting_started/introduction/first_look_at_the_editor.html),
[Unity의 Tools / Grid and Snap / View Options / Orientation 구분](https://docs.unity3d.com/Manual/default-overlays-reference.html),
[Unreal의 카메라·변형·보기 메뉴 그룹](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-toolbar)을 참고했다.
기존 배치 보조 기능을 그룹화하며 새로운 게임 편집 계약이나 외부 의존성을 추가하지 않는다.

`보기 / View`에서 격자 표시와 공통 간격, HD-2D 충돌·높이 표시/좌표 정렬을 조절한다. 격자와 snap은
별도로 켜되 간격은 하나를 공유한다. 보기 설정은 Enter/Space로 열고 Escape/닫기로 focus를 돌려주며,
바깥 클릭·focus 이동·작업공간 모드 전환으로 닫는다. 작은 화면에서도 보기 버튼은 고정하고 도구만 가로로 스크롤한다.
구성은 [Godot 2D 작업공간](https://docs.godotengine.org/en/stable/tutorials/2d/introduction_to_2d.html)의 도구·툴팁·세부 설정,
[Unity Scene navigation](https://docs.unity3d.com/Manual/SceneViewNavigation.html)의 탐색 도구와 단축키 구분을 참고한다.

- 중간 버튼 drag 또는 canvas에서 Space+왼쪽 drag로 화면을 이동한다. `Pan`/H는 왼쪽 drag를 화면 이동으로,
  `Select`/V는 객체 선택·이동으로 사용한다. Pan 모드의 방향키는 객체를 움직이지 않는다.
- wheel은 커서 아래 월드 좌표를 유지하며 확대/축소한다. `Out`/`In`과 배율 버튼은 화면 중심 기준으로 조절한다.
  배율 범위는 12.5–800%이며 배율 버튼은 100%로 복원한다.
- `Frame`/F는 선택 객체에 맞추고 `Fit Scene`/Home은 전체 작성 객체를 화면에 맞춘다.
  회전·scale·sprite pivot을 적용한 visual bounds를 사용하며 visual이 없는 객체는 작은 위치 표시 범위를 사용한다.
  선택이 없으면 Frame은 비활성이다. 배율 한계보다 큰 scene은 일부가 화면 밖에 남을 수 있다.
- `Reset`/0은 초기 카메라 중심과 100%로 돌아간다. 단축키는 viewport에 focus가 있을 때 적용하고 입력칸의 기본 동작은 유지한다.
- pan 중 Escape·pointer 취소·포커스 상실은 시작 카메라로 복원한다. 객체 gesture 중 zoom/pan으로 좌표계를 바꾸지 않는다.
- 탭별 카메라 중심·배율은 페이지 메모리에 유지하며 저장·탭 왕복·열기 실패·dock resize에도 보존한다.
  문서 JSON·patch/history·localStorage에는 기록하지 않는다. 카메라 중심은 각 축 ±10,000,000으로 제한한다.

`pnpm smoke:placement-viewer`는 실제 canvas 픽셀·DPR 2·탭 복원과 확대 상태의 pointer/숫자/keyboard 좌표 일치를 검사한다.
mass smoke는 Fit Scene 뒤 1,030개 render command·draw 상한·초안 보존과 동기 작업 500ms 상한도 확인한다.

## 다중 선택과 편집 잠금

- viewport에서 Shift/Ctrl/Cmd+클릭으로 선택을 추가/해제한다. 목록에서는 Ctrl/Cmd로 toggle,
  Shift로 대표 객체에서 클릭한 행까지 선택한다. 마지막 선택이 Inspector의 대표 객체다.
- 빈 공간에서 drag하면 visual 사각형이 완전히 들어간 객체를 선택한다. Shift/Ctrl/Cmd+영역 선택은 기존 집합에 추가한다.
  Escape·pointer capture 상실·포커스 상실은 진행 중인 영역 선택을 취소한다.
- `All` 또는 canvas에서 Ctrl/Cmd+A는 잠기지 않은 객체를 모두 선택한다. `Clear`/Escape는 선택을 비운다.
- 여러 객체의 drag·숫자 XY·방향키 이동은 대표 객체를 기준으로 이동한다. snap은 대표 객체에만 적용해 상대 간격을 유지한다.
  집합 전체가 한 건의 Undo이며 Escape는 전체 이동을 취소한다. `Remove` 또는 canvas의 Delete/Backspace도 집합을 한 번에 삭제한다.
- 다중 선택의 scale/rotation은 대표 pivot 기준 그룹 변경이다. layer·component/binding/rename/definition의 개별 편집은 비활성이다.
  `Frame`은 대표 객체 하나 대신 선택 전체의 bounds를 사용한다.
- 목록의 `Lock`/`Unlock`은 개별 객체, viewport 하단 버튼은 선택 집합의 편집 잠금을 조절한다.
  잠긴 객체는 canvas picking·영역/전체 선택에서 제외한다. 목록에서는 검사·잠금 해제가 가능하며
  직접 transform/component/binding/rename/remove는 거부한다. 잠긴 항목이 섞인 그룹 이동/삭제도 전체를 거부한다.
- 선택/잠금은 탭 왕복과 저장 후에도 유지하며 문서 JSON·patch·localStorage에 쓰지 않는다.
  Undo/Redo는 당시 선택과 문서 변경을 복원하지만 잠금 변경은 이력으로 기록하지 않는다.
  외부 writer·ObjectDefinition 변경·전체 Undo/Revert를 막는 파일 권한은 아니다.

## 에셋·다층 배치와 모델 proxy

Scene은 검색·종류·layer 필터, 기존 fragment별 그룹과 Frame Selected를 제공한다. 필터와 그룹 접기는 문서나 선택·잠금을 바꾸지 않는다.
하단 `Assets`는 2D/HD-2D 공통 검색, Sprite/Model/Recent/Favorites 필터와 Sprite frame·GLB geometry 썸네일을 제공한다.
Inspector의 Properties에서 선택 속성을, Placement에서 새 객체의 자산·회전·배율·반복 배치를 설정한다.
최근 사용 24개·즐겨찾기 128개만 프로젝트별 localStorage에 보관한다. 최대 300개를 표시하며 검색으로 좁힌다.
별 버튼은 즐겨찾기다. 배치할 에셋은 카드 테두리와 pressed 상태로 표시하고 canvas 위 고정 도구 행에
에셋 이름·배치/drag 상태·Cancel/Escape 안내를 표시한다. 취소·배치 확정·모드/문서 전환에 따라 함께 갱신한다.
GLB 미로드 항목은 클릭하면 공개 loader로 불러오며 로드 후 drag할 수 있다. 썸네일은 diffuse 기반 정적 근사다.
에셋 선택 또는 drag는 기존 배치 경로를 사용한다. `Keep Placing`, rotation(degrees), scale(0.01–100)을
배치 전에 정하며 클릭마다 한 건 Undo다. Escape·모드/문서 전환은 pending을 정리한다.
2D 배치 대기 중 sprite/frame·prefab·회전·배율을 바꾸면 대기를 취소한다. 새 설정으로 배치하려면 에셋이나 추가 버튼을 다시 선택한다.
성공한 모드 전환 후에는 이전 배치가 되살아나지 않는다. native 적용이 거절된 전환은 기존 모드와 배치 대기를 유지한다.

HD-2D Inspector는 대상에 유효한 공간 필드를 표시한다. viewport 상단은 현재 표시 층, 선택 객체의 물리 높이/높이 범위와 visual offset, 배치 지지면 층/높이를 구별한다.
HD-2D도 `화면 이동 / Pan` 버튼 또는 H를 선택한 뒤 왼쪽 드래그로 이동한다. `선택 / Select` 또는 V로 객체 편집에 돌아간다.
Space를 누른 동안에는 임시 화면 이동이며 중간 버튼·Alt 드래그도 유지한다. Escape·포커스 상실로 이동을 취소한다.
에셋을 드래그할 때 지형이 없거나 현재 각도에서 작업 평면을 가리킬 수 없으면 커서 옆에 배치 불가 이유를 표시하고
드롭 커서를 금지 상태로 바꾼다. 맵 밖에는 배치 기준을 `작업 평면`으로 바꾼 뒤 배치한다.
유효한 위치로 돌아오면 기존 미리보기와 복사 커서로 복원하며, Escape·드래그 종료·문서/모드 전환 시 안내를 지운다.
오브젝트가 화면 밖으로 일부 나가 미리보기를 그리지 못하더라도 배치 위치가 유효하면 드롭할 수 있다.
휠과 확대/축소 버튼은 편집 카메라의 화면 중심을 기준으로 확대·축소한다. 객체 드래그 중에는 휠로 카메라를 바꾸지 않는다.
화면 이동·확대·패널 크기 조절은 객체 크기·배치 JSON·Undo/Redo 이력을 변경하지 않는다.
지지면 정보는 기존 native picking 결과를 재사용한다. 툴바에서 활성 층을 선택하거나 층 표시 Inspector를 열고,
`보기`에서 충돌·높이 표시, 좌표 정렬과 격자 간격을 제어한다.
`Frame`/F, `Fit Scene`/Home은 편집 카메라만 바꾼다. Floor Visibility에서 층을 숨기거나 한 층만 볼 수 있다.
Ghost Other Floors는 숨긴 층의 authored bounds를 흐린 점선으로 보여준다. 반투명 재질 렌더링은 제공하지 않는다.
숨긴 terrain/object는 편집 picking에서 제외하지만 native physics/support는 유지한다.
겹친 위치에서 오른쪽 클릭하면 후보 목록으로 선택한다. 일반 클릭은 native terrain의 가장 가까운 표면을 사용한다.

선택 모델의 Collision Proxy는 명시적인 AABB/OBB width/depth/height, elevation/floor/yaw/offset을 작성한다.
mesh에서 collider를 자동 추론하지 않는다. proxy 적용/제거는 시각 높이를 보존하고 한 건 Undo로 묶는다.
Show Proxy Overlay는 native collider/heightSpan 진단선을 켠다. attachment-owned 모델은 편집할 수 없다.
Rename/Duplicate/Remove는 spatial visual metadata를 보존하며 보호 참조는 명시적으로 거절한다.
삭제·rename한 원본 ID는 저장 전까지 예약한다.

하단 Runtime 탭을 열면 선택 entity의 FSM state ID, health, timer, action cooldown과 global/scene 변수를
최대 4 Hz로 읽는다. FSM 부재는 state 0과 구분한다. 최근 event는 펼친 동안 최대 64건을 복사하고
선택·문서·모드·native 재적용 시 비운다. variable은 최대 32개, action cooldown은 최대 16개를 표시한다.
편집/게임 preview 문맥을 표시하며 recipe/FSM 편집은 제공하지 않는다.
주요 값은 요약 행으로 먼저 표시하고 변수·이벤트 목록과 Raw JSON은 별도로 펼친다.
요약 표시는 기존 진단 snapshot만 사용하며 추가 native 조회를 만들지 않는다.

Desktop Asset Changes의 Check Changes 또는 opt-in Watch Folder(3초)는 파일 revision 차이를 감지하기만 한다.
Apply Changes가 texture/GLB를 명시적으로 다시 가져온다. GLB SHA-256은 실제 바이트로 계산하고 authored asset ID를 유지한다.
같은 asset의 root/LOD 참조는 한 건 Undo로 교체하며 이전 resource를 cache 예산 안에 유지해 Undo를 지원한다.
missing/잘못된 GLB·오래된 문서 응답·업로드 실패는 초안 변경을 확정하지 않으며 감지 후보를 재시도할 수 있다.
원래 파일 revision이 더 이상 존재하지 않으면 texture 복구도 실패할 수 있으며 Problems에서 알린다.
페이지를 닫으면 watch를 해제한다. 일반 browser/Pages에는 native 폴더 watch가 없다.

## 저장 host 계약

저장 요청은 `{ document, expectedDocument }`이며 개발 endpoint의 UTF-8 body 상한은 2 MiB다.
native도 실제 저장할 UTF-8 JSON(들여쓰기·마지막 줄바꿈 포함)이 2 MiB를 넘으면 파일 교체 전에 거절한다.
작게 압축된 입력을 열었더라도 저장 시 한도를 넘으면 원본과 초안을 보존하므로, 내용을 줄이거나 패치를 내보내 조정한다.
현재 파일이 마지막으로 읽은 JSON과 다르면 HTTP 409로 거부하고 초안과 이력을 보존한다.
충돌 시 Copy Patch/Copy Handoff로 작업을 보관한 뒤 최신 문서를 열어 agent와 변경을 조정한다.
개발 서버의 문서/임시 저장 파일 변경은 HMR에서 제외해 자동 reload가 미저장 초안을 버리지 않게 한다.
공백·key 순서는 충돌로 보지 않는다. 임시 파일 교체와 host 내 직렬화를 사용하지만 독립 프로세스의
동시 쓰기까지 완전한 transaction으로 보호하지는 않는다. 자동 rebase/강제 덮어쓰기는 제공하지 않는다.
브라우저 save smoke는 실제 재개방, 저장 중 UI 잠금, 중복 요청 차단과 충돌 후 보존을 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/placement-viewer/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## Desktop host

`apps/placement-viewer-desktop`는 이 app의 production/dev frontend를 Tauri window에서 열고, Tauri command가 있을 때 정원 샘플 `placement.garden.scene-authoring.json`을 로컬 파일로 읽고 저장한다. Tauri가 없는 일반 브라우저와 Pages에서는 기존 fetch/Vite dev endpoint 흐름을 유지한다. 문서 전환 전에 draft patch가 남아 있으면 기존 변경을 버릴지 확인한다.

## 참고 문서

- [Showcase Hub](../../docs/engine/showcase-hub.md)
- [Data Scene Authoring](../../docs/engine/data-scene-authoring.md)
- [Authoring public API](../../docs/engine/public-api/authoring.md)
- [완료된 Object Authoring 개발 기록](https://github.com/silbaram/ferrum2d/issues/46)
- [Smoke Check](../../docs/development/quality/smoke-check.md)

## 다음 단계

- generated consumer project viewer 동작은 `pnpm package:consumer-smoke`와 `pnpm smoke:create-game-template-reports`로 검증한다.
- recipe 본문 편집, FSM/action graph, timeline UI가 필요하면 visual-editor급 별도 승인 범위로 다룬다.
- 완료 planning 문서에서 이관한 후속 후보는 [GitHub 이슈 #47](https://github.com/silbaram/ferrum2d/issues/47)에서 추적한다.
