# Ferrum2D 엔진 기능 실험실

기본 진입은 기능별 독립 실험이다. `pnpm dev:starter-runtime`으로 실행하고 터미널 주소를 연다.
상단에서 조명·물리·카메라·스프라이트 등 10개 주제로 31개 실험을 선택한다. 물리·충돌 주제는 물리 심화 7종도 제공한다. 게임·제작 도구는 **예제 이동**에서 선택한다. 모바일에서는 분류된 선택 목록을 사용하며 현재 실험과 렌더러를 유지한다.
각 화면은 게임에서 쓰는 상황 → 직접 해보기 → 관찰할 차이 순서로 안내한다.
주요 실행 버튼은 화면 위에, 객체 역할은 실제 위치 옆에 표시한다. 화면 아래 범례와 결과 설명을 함께 읽고,
세부 설정·구현 API는 오른쪽 패널, 수치 진단은 접힌 ‘엔진 실행 정보’에서 확인한다.
공개 예제는 같은 탐색·학습 안내·UI 테마를 사용한다. 목록과 실행 방법은 [전체 예제 안내](../README.md)를 따른다.

[전체 기능과 실행 위치](../README.md)의 `?feature=<id>`로 바로 열 수 있다.
씬 파일은 [public/features](public/features/), 공통 화면은 [src/featureLab.ts](src/featureLab.ts), 타일·효과·입력 조작은 [src/featureExtras.ts](src/featureExtras.ts),
게임 구성 예제는 [src/featureGameplay.ts](src/featureGameplay.ts)와 [src/featureContent.ts](src/featureContent.ts),
픽셀 표시·스프라이트 표현·자원 관찰은 `featureDisplay.ts`, 영역 검색·형상 이동은 `featureQueries.ts`다.
후속 실험은 `featureProjectiles.ts`, `featureCutscene.ts`, `featureLoading.ts`, `featureStreaming.ts`이며,
기능 목록은 [featureCatalog.json](../shared/featureCatalog.json)에 있다.
`node scripts/assets/build-feature-examples.mjs`는 31개 실험 JSON과 직접 합성한 공간 오디오용 `beacon.wav`를 재생성한다.
HD-2D 5종만 다시 만들 때는 `node scripts/assets/build-hd2d-feature-scenes.mjs`를 쓴다.
이 생성기는 기존 마을의 수레·등불 GLB를 복사하고 원본 SHA-256을 authoring JSON에 기록한다.
텍스처는 기존 자체 제작 `public/playground/` 에셋을 재사용한다.

`실험 초기화`는 설정·씬·일시정지를 기본값으로 돌린다. 렌더러 선택과 주제 이동은 페이지를 다시 연다.
WebGL2 기본 / WebGPU 선택과 fallback을 표시한다. 화면의 수치는 실제 native 상태와 renderer stats다.
타일맵/입력 실험은 기존 Shooter 타일맵·플레이어 컨트롤러를 사용한다. 사격은 차단하고 적 생성 간격은 24시간으로 설정해 실험을 분리했다. 2D Data Scene 실험의 바닥은 sprite instance이며 HD-2D 실험은 공간 지형을 사용한다.

## 화면에서 비교하는 방법

상단 메뉴는 같은 스타일의 `주제`·`실험` 두 줄이다. 긴 목록은 가로로 스크롤하며 키보드로도 끝 항목까지 이동한다.
기본 화면에는 실험명·확인할 것·설정·실제 상태를 표시한다. 반복 설명은 줄이고 상세 설명과 주의사항은 `사용 안내`에 모았다.
긴 조작 순서는 설정 패널의 `사용 안내`에서 펼쳐 읽는다. 설정은 패널 안에서 별도로 스크롤되며,
페이지를 내려도 실험 화면이 상단에 남아 하단 설정의 변화를 비교할 수 있다.
좁은 화면에서는 실험 화면 바로 아래에 설정 패널을 배치한다.
9-slice처럼 세로로 긴 결과는 원래 비율을 유지하며 결과 영역 안에서 스크롤한다.

- 애니메이션은 원본 4프레임과 현재 프레임, 카메라는 전체 월드와 현재 보는 영역을 함께 보여준다.
- HD-2D 조명은 점광원·태양·혼합, 태양 방위·고도·hard/PCF 그림자와 안개·Bloom·AO·DOF·ACES를 비교한다.
- 화면 효과는 원본과 6개 효과 및 강도를 비교한다. 카메라는 추적·확대·흔들림·월드 경계를 비교한다.
- 픽셀 표시는 가상 해상도·소수 위치·좌표 정렬, 스프라이트 표현은 팔레트·피격 색상·외곽선을 비교한다. 렌더링 실험은 명령/드로우 수와 검사용 텍스처 준비·해제를 관찰한다.
- 픽셀 실험의 ‘아틀라스 보호 여백 비교’는 실제 PNG 패킹의 투명 여백과 2px 가장자리 복제를 보여준다. 정상 nearest 샘플링에서 항상 외형 차이가 생기는 옵션은 아니며 내부 텍셀 정밀도와 구분한다.
- 조명은 원본 색상과 노멀맵, 위·아래·좌·우 광원을 비교한다. 물리는 ‘같은 힘으로 던지기’를 누른 뒤 재질별 속력과 충돌을 관찰한다.
- 대화·퀘스트와 HUD는 실제 엔진 UI를 게임 화면 안에 표시한다. 한국어는 함께 배포한 글꼴을 사용한다.
- 에셋 로딩·스트리밍은 실제 요청·캐시·구역 교체 상태를 화면 가운데 표시한다. 표시 중인 구역과 준비 중인 구역을 구분한다.
- 입력·HD-2D 이동·AI 전투의 가상 조이스틱은 게임 화면 바로 아래의 전용 영역에서 조작한다. HD-2D는 객체 이름표, 높이·탑승·부모 연결 상태를 함께 읽는다.

안내의 기준은 Catalog의 `lesson`이다. [featureLesson.ts](src/featureLesson.ts)는 공통 안내·범례·객체 이름표를,
[featureLessonVisuals.ts](src/featureLessonVisuals.ts)는 주제별 비교 그림을 담당한다.
이름표와 그림은 기존 native/platform 관측을 표시하며 게임 상태를 따로 계산하지 않는다.
2D 객체 위치는 낮은 빈도의 일괄 조회를 복사하고, HD-2D 투영은 해당 프레임의 카메라 숫자를 복사해 사용한다.
검증은 `pnpm smoke:feature-examples`이며 양 렌더러의 실제 동작·390px 배치·UI 영역·정리까지 검사한다.

## HD-2D 그림자 비교

`?feature=hd2d-shadow-proxy`는 정원의 실제 캐릭터·나무 atlas를 사용한다.
`부피 모델`, `표시 평면`, `그림자 없음`을 전환하고 카메라만 돌려 같은 지면의 그림자를 비교한다.
간소화 부피를 표시하면 그림자를 만드는 원본 모델이 보인다. 높이·위치·부피 회전과 네 프레임 재생은
기존 native body/attachment/animation 경로를 사용한다. 부피는 고정 근사이며 프레임마다 실루엣을 재생성하지 않는다.

`비교 사물`에서 나무·가로등·상자를 바꾼다. `캐릭터 자세 · 애니메이션`의 좌우·상하 반전은
표시 UV만 바꾸며 그림자 부피는 유지한다. `부피 정밀도`의 거리 LOD는 더 간단한 모델로 바꾸므로
그림자 모양도 달라질 수 있다. 기본은 고정 부피다. 카메라 거리를 100→200→130→100%로 바꿔
전환·유지를 비교한다. eye와 각 모델 원점 사이 600 단위에 ±10% 경계가 적용된다.
직교 카메라는 거리를 바꿔도 크기가 유지되며, `카메라 확대`로 크기를 바꾼다.
부피 표시·태양·회전·그림자 원본을 바꿔도 호환되는 애니메이션 단계와 LOD 선택은 유지한다.
다른 사물로 바꿀 때 캐릭터의 재생 단계는 유지하고 바뀐 모델의 LOD만 새로 시작한다.
정지 프레임·재생 클립을 명시적으로 바꾸거나 실험 초기화하면 해당 시작값을 적용한다.
모델 준비 실패는 이전 화면·설정·저장 문서를 유지하고 오류를 표시하며, 같은 조작을 다시 시도할 수 있다.

`태양 비교`에서 낮은 5°·높은 81.9°·천정 90°를 선택하거나 고도 0~90°와 방위를 조절한다.
`그림자 영역 표시`는 높이 0에서 실제 맵의 청록 외곽과 주황 fade 시작선을 그린다.
이는 물체의 그림자 윤곽이 아닌 유한 범위 안내다. 천정에서는 그림자가 짧아지고 지평선에서는 바닥 직접광이 0이 된다.
맵 범위 밖의 그림자나 표면별 normalBias/필터 결과를 선 하나로 보장하지 않는다. 진단선은 설정 JSON에 저장하지 않는다.

현재 맵은 512²다. 반경 128이면 1 texel=0.5 world unit·fade 폭 2, 반경 256이면 1 texel=1·fade 폭 4다.
범위를 넓히면 같은 해상도에서 밀도가 낮아진다. 정원 비교에서는 extent·center를 명시하며 자동 확대하지 않는다.

`화면 밖 나무 그림자 보기`는 카메라를 이동·확대하고 영역 반경 128과 고정 월드 기준점을 설정한다.
나무가 보이지 않아도 화면 안 바닥에 그림자가 남는다. `그림자 영역 기준`을 카메라 추적으로 바꾸면
같은 반경의 영역 경계를 비교할 수 있다. 고정 월드 설정은 `directional.shadows.center`로 저장되며
반경·깊이는 유한하다. 모든 화면 밖 물체의 그림자나 무한 범위를 보장하지 않는다.

설정 JSON은 카메라·태양·그림자 모드·캐릭터 자세와 초기 애니메이션 클립을 보존한다.
부피의 월드 회전은 attachment의 `yawDegrees`이며 2D 그림 자체의 회전과 구분한다.
설정에는 runtime 반전·경과 시간을 포함하지 않는다. `재생 상태 JSON · 반전 포함`은 클릭 순간의
공개 게임 상태 snapshot을 저장한다. 별도 예제 전용 포맷이 아니며, 복원할 때 asset을 먼저 등록하고
`restoreGameStateSnapshot`을 사용한다. `scripts/assets/build-hd2d-feature-scenes.mjs`로 atlas/GLB/씬을 재생성하며
원본 atlas hash와 proxy content ID는 `public/features/spatial/shadow-assets.json`에 기록한다.

집중 검증은 `pnpm smoke:shadow-comparison`이다. 두 렌더러의 실제 월드 수신점과 부피 pose,
캐릭터·나무 각각의 그림자, 카메라에 따른 표시 평면 그림자의 변화, 태양 고도 10°/85°를 확인한다.
프레임 전환·일시정지·설정 JSON·390px 배치·자원 회수·초기 로딩 중 종료·렌더 오류 후 초기화 복구도 검사한다.
좌우/상하/동시 반전과 재생, native LOD content ID·hysteresis·그림자 캐시, 추가 사물의 발 피벗과
화면 밖 그림자도 실제 픽셀로 확인한다. GL/GPU의 나무·가로등·상자 수신점은 같은 RGB 허용 오차를 적용한다.
구현은 [featureSpatialShadows.ts](src/featureSpatialShadows.ts)와 [featureSpatialLab.ts](src/featureSpatialLab.ts)에 있다.

## 게임 UI 테두리 실험

`?feature=nine-slice`는 작은 테두리 이미지 한 장으로 대화창·가방을 만드는 예제다.
같은 크기·내용을 일반 확대와 9-slice로 나란히 보여준다. 너비·높이를 늘리면 일반 확대의 모서리는 길쭉해지고,
9-slice의 테두리는 설정한 두께를 유지한다. 원본 24×24 이미지의 9개 영역과 고정할 모서리도 확인할 수 있다.
좁은 화면에서는 비교 창이 위아래로 배치된다. Reset은 대화창·기본 크기·테두리·분할선 상태를 복구한다.

테두리는 Rust의 실제 sprite 렌더 명령이며 대화·아이템 텍스트는 사용 예를 설명하는 DOM 주석이다.
창 크기는 authoring document를 재적용하고 렌더링은 Rust/Wasm이 처리한다.
이 예제는 크기별 테두리 표현을 설명하며 완성된 인벤토리 로직이나 드래그 UI를 제공하지 않는다.
구현은 [featureNineSlice.ts](src/featureNineSlice.ts)에 있다.

## 애니메이션과 지형 실험

- **캐릭터 애니메이션**: `?feature=animation`. 기존 시트 재생의 속도/순서/반전을 유지한다. ‘이동과 대기’에서는 바닥 클릭·방향 버튼·WASD/방향키로 목적지를 정하면 Rust가 이동과 idle/walk 클립을 전환한다. 기존 로봇 시트를 재사용하므로 방향 표현은 좌우 반전이다. 프레임 2·4 진입은 화면 표식과 선택적인 합성 발소리로 표시한다. ‘한 번 재생과 완료’는 마지막 프레임을 유지하고 완료 이벤트를 한 번만 센다. 음원은 사용자 버튼으로 켜며 pause/reset/페이지 이탈은 소리와 대기 중 로딩을 중단한다.
- **지형 파괴와 충돌 갱신**: `?feature=destructible-terrain`. 128×48 마스크를 4배 월드 단위로 표시한다. 클릭은 원형으로 지형을 깎고, ‘중앙 구멍’은 지면을 관통해 공이 아래 기반암까지 떨어지게 한다. 텍스처 dirty 영역과 충돌 청크를 함께 갱신한다. 편집 전후 중력은 300으로 유지하며 한 번의 갱신은 최대 8청크다. pause 중 편집은 차단하고 Reset은 지형·공을 함께 복구한다. 작은 클릭 단위 편집 예제이며 대규모 연속 파괴 성능 보장은 아니다.

구현은 [featureAnimation.ts](src/featureAnimation.ts)와 [featureTerrain.ts](src/featureTerrain.ts)에 있다.
지형 마스크 편집/청크 작성은 기존 TS helper를 사용하고 공의 낙하·충돌과 애니메이션 시간·전환은 Rust가 계산한다.

## 타일·효과·입력 실험

- **타일맵**: `?feature=tilemap`. WASD/방향키로 중앙 벽에 접근한 뒤 통로를 열어 통과한다. 캔버스 클릭으로 벽/바닥을 수정한다. 외곽 테두리와 캐릭터가 겹치는 칸은 보호한다. 통로 닫기는 캐릭터를 밖으로 옮긴 뒤 사용한다. 출발 위치에 벽을 놓았다면 바닥 브러시로 지워야 그 위치로 돌아갈 수 있다.
- **레이어**: `?feature=layers`. 로봇의 `instance.layer`를 바꿔 동일 위치·크기의 겹침을 비교한다. 씬을 재적용하는 낮은 빈도 예제이며 충돌 분류인 `components.layer`는 바꾸지 않는다.
- **파티클**: `?feature=particles`. 불꽃·먼지·잔상을 서로 다른 이미지와 기본값으로 비교한다. ‘불꽃·먼지 나란히’는 두 효과를 즉시 시작한다. 설정 변경은 선택 효과로 복귀하고 이전 입자를 비운다. 정지는 새 방출만 멈추고 기존 입자는 수명이 끝나면 사라진다.
- **공간 오디오**: `?feature=audio`. 사용자 클릭으로 Web Audio를 시작하고 음원의 좌우·앞쪽 거리·볼륨을 바꾼다. 듣는 위치는 로봇에 고정된다. 일시정지/초기화/페이지 이탈은 소리도 멈추고 재생은 다시 눌러 시작한다. 공간 처리 미지원이면 일반 재생 안내를 표시한다.
- **입력 전환**: `?feature=input`. 키보드/게임패드 왼쪽 스틱/화면의 가상 조이스틱을 같은 native 이동에 연결한다. 메뉴는 모달이고 입력란의 키가 게임에 전달되지 않는다. 닫은 뒤 키를 다시 누르거나 스틱을 중립으로 돌린 뒤 이동한다. 게임패드 연결을 브라우저가 인식하려면 장치 버튼을 한 번 눌러야 할 수 있다.

## 불꽃·먼지 비교

`?feature=particles`에서 **불꽃·먼지 나란히**를 누른다. 왼쪽은 작은 불꽃이 짧게 튀고,
오른쪽은 가장자리가 부드러운 흙색 먼지가 느리게 커지며 투명해진다. 비교는 고유 기본값을 사용한다.

| 효과 | 방출당 수량 | 최대 수명 | 최대 속도 | 표현 |
| --- | --- | --- | --- | --- |
| 불꽃 | 24 | 0.3초 | 220 | 밝은 별 모양·빠른 확산·수축 |
| 먼지 | 5 | 1.4초 | 40 | 불규칙 구름·느린 확산·팽창·흐려짐 |
| 잔상 | 2 | 0.5초 | 16 | 포인터가 지나간 위치에 남는 푸른 입자 |

수명·속도는 범위 안에서 무작위로 정한다. 효과 선택 시 해당 기본값을 적용하며 슬라이더로 바꿀 수 있다.
비교 중 불꽃은 1.4초 간격으로 재방출하고 먼지는 연속 방출한다. 일시정지는 둘 다 멈추고,
초기화는 비교를 끝내고 기본 불꽃 설정으로 돌아간다. 캐릭터의 발걸음에 자동 연결하는 예제는 아니다.

[featureParticles.ts](src/featureParticles.ts)는 예제 전용 프로필·방출기·비교 UI를 담당한다.
입자의 위치 적분·크기/색 보간·수명 만료·그리기는 기존 Rust/Wasm이 처리한다.
SDK의 `particleVfxPreset` 기본값·Wasm ABI는 변경하지 않는다.
전용 PNG 세 장은 외부 이미지 없이 [생성 스크립트](../../scripts/assets/build-particle-demo-textures.mjs)로 작성했다.
다시 만들 때는 루트에서 `node scripts/assets/build-particle-demo-textures.mjs`를 실행한다.

먼지의 사용 상황은 [Unity 먼지 사례](https://docs.unity3d.com/6000.0/Documentation/Manual/PartSysInheritVelocity.html),
크기·색·수명 구분은 [Unity 입자 튜토리얼](https://learn.unity.com/course/2d-magic-spells/tutorial/modifying-gravity-color-size-lifetime-of-particle-systems)과
[Godot 2D 입자 안내](https://docs.godotengine.org/en/stable/tutorials/2d/particle_systems_2d.html)를 참고했다.
구현은 기존 엔진 기능으로 표현한 자체 설정이다.

## 게임 구성 실험

- **씬 전환·페이드**: `?feature=scenes`. 카운터를 올리고 A/B 공간을 왕복한다. `transition`은 씬 카운터를 초기화하고 전역 카운터를 유지한다. 암전 중 재입력은 무시하고, 일시정지·초기화는 전환에도 적용한다.
- **상호작용·트리거**: `?feature=interaction`. 이동 후 64 단위 안에서 Space 또는 상호작용 버튼을 누른다. 스위치는 한 번 작동하고 문 사용 조건을 해제한다. 아래 패널 구역의 진입/이탈은 실제 native collision event다. 문은 조건부 상호작용 표식이며 물리 벽 개폐는 타일맵 예제에 있다.
- **저장·불러오기**: `?feature=save-load`. 에너지를 수집하고 저장한 뒤 초기화/새로고침 후 불러온다. 위치·변수·수집으로 사라진 아이템을 함께 복원한다. 일반 2D 좌표는 snapshot의 custom state에 기록하고, 수집 진행은 Data Scene progress로 저장한다. 슬롯은 `ferrum2d.feature-lab.save-load.v1`이며 다른 저장 키는 건드리지 않는다. 브라우저·사이트 주소별 로컬 저장으로 서버/클라우드 저장이 아니다. 손상 데이터·다른 씬뿐 아니라 진행/변수 누락, 캐릭터 제거·비활성화, 수집 수와 아이템 상태 불일치도 씬 변경 전에 거절한다. 저장소 접근 실패는 화면에 안내하며 기존 저장을 유지한다. 일시정지 중 저장 작업은 차단하고 실험 초기화는 슬롯을 유지한다.
- **대화·퀘스트**: `?feature=dialogue`. 캔버스 아래 실제 `UiOverlay`에서 부탁을 거절/수락하고 소포를 챙겨 전달한다. 조건 플래그가 전달 선택지를 열고 `QuestLog`에 목표/완료를 기록한다. Tab/Enter 선택, 화면 갱신 후 포커스 유지와 초기화를 지원한다. 이 예제의 대화 진행은 새로고침하면 초기화된다.
- **HUD·다국어·접근성**: `?feature=hud`. native 체력 변수에 피해/회복을 적용하고 HUD만 한영·14/18/22px·고대비로 바꾼다. 체력은 0~100이며 progressbar의 접근성 값과 이름도 함께 갱신한다. 실험실 전체의 언어 전환 기능은 아니다.

## 사격·컷신·로딩·스트리밍

- **사격과 벽 충돌**: `?feature=projectiles`. 중앙의 실제 충돌 벽에 한 발씩 발사한다. 속도 220·수명 4초를 고정해 `despawn`/`passThrough`/`bounce` 차이만 비교한다. 여기서 관통은 **벽 통과**이며 적 다중 관통을 뜻하지 않는다. 궤적 수치는 Rust render buffer의 낮은 빈도 표본이고 TS가 탄 이동을 계산하지 않는다. 기존 `?mode=starter` 사격 패널에서 이 실험으로 연결한다.
- **컷신**: `?feature=cutscene`. 재생 버튼이 오디오를 준비한 뒤 카메라·자막·효과음을 순서대로 실행한다. 일시정지하면 연출 시간도 멈추며 소리를 정지한다. 건너뛰기는 남은 명령을 실행하지 않고 중앙 구도로 복귀한다. 동작 감소는 카메라 보간을 끄며 자막 읽기 시간은 유지한다. 오디오 잠금·준비 실패는 화면에 표시하고 무음으로 시각 연출을 유지한다. 건너뛰기·초기화는 진행 중 사운드 요청을 취소하며, 늦게 완료된 이전 요청은 새 연출에 적용하지 않는다.
- **에셋 로딩**: `?feature=asset-loading`. 이미지 2개·씬 JSON 1개를 실제 `preloadAssetManifest`로 읽는다. 두 번째 실행은 이 실험의 **세션 메모리 캐시**를 사용하며 fetch 호출/캐시 적중을 표시한다. IndexedDB나 브라우저 HTTP 캐시 성능 측정은 아니다. 각 요청 앞 300ms 지연과 실패 버튼의 네트워크 오류는 실험용 주입이다. 취소 시 이미 완료된 캐시는 유지하고, 캐시 비우기·실험 초기화·새로고침은 비운다. 씬 일시정지와 네트워크 작업 수명은 별개다.
- **스트리밍**: `?feature=streaming`. 3개 구역을 오가며 실제 텍스처 업로드/해제를 확인한다. `LevelChunkStreamer`가 필요한 구역을 계산하고 `AssetLoader`가 자원을 관리한다. 각 구역은 전용 텍스처 1개와 공유 바닥을 사용한다. 로딩 중 구역 변경/초기화는 이전 작업을 취소하고 완료된 최신 구역만 씬에 적용한다. 로딩 실패 시 기존 구역과 공유 텍스처를 유지하며 같은 구역 버튼으로 재시도할 수 있다. 표시된 구역의 sprite들을 재적용하는 작은 예제로, 대규모 연속 월드·물리 청크 접합의 성능 보장을 뜻하지 않는다.

## HD-2D 공간·게임플레이 실험

- **공간 이동**: `?feature=hd2d-movement`. 경사로에서 목적지 이동과 층·높이 변화를 확인한다. 승강 발판과 수평 발판으로 전환해 탑승 시 캐릭터가 함께 이동하는지 비교한다. WASD/방향키와 가상 조이스틱도 지원한다.
- **AI 추적과 전투**: `?feature=ai-combat`. 추적은 중앙 장애물 우회, 근접은 접근 후 피해, 원거리는 발사체와 적중을 보여준다. 원거리 모드는 벽에 가리지 않는 발사선에서 시작한다. 체력·발사·적중 수치를 관찰하며 캐릭터가 사망해도 초기화할 수 있다.
- **부모·자식 연결**: `?feature=attachments`. 수레의 위치·회전 슬라이더로 등불과 상자의 상대 위치를 확인한다. 연결을 해제하면 자식은 마지막 위치에 머물고, 다시 연결하면 저장된 상대 위치로 돌아온다. 정적인 모델 연결 예제이며 스켈레탈 애니메이션은 아니다.

- **HD-2D 조명·그림자·안개**: `?feature=hd2d-environment`. 마름모 광원 표식을 좌우로 옮기고 조명·그림자·거리 안개를 개별 비교한다. 공간 지형과 빌보드가 실제 그림자를 만들고 받는다. 이 장면은 정적이므로 설정·크기 변경 때만 GPU에 다시 제출한다. 일시정지는 시뮬레이션을 멈추며 비교 설정은 계속 바꿀 수 있다.

공통 화면은 [featureSpatialLab.ts](src/featureSpatialLab.ts), 모드별 작성 설정은 [featureSpatialScenes.ts](src/featureSpatialScenes.ts)에 있다.
이동·전투·발판·연결 계산은 Rust가 수행한다. WebGPU 모델은 GPU 사전 로드를 마친 뒤 씬을 적용한다.
JSON 다운로드는 현재 모드의 작성 설정이다. 부모·자식 연결과 조명·그림자·안개 실험은
슬라이더로 바꾼 정적 배치도 반영하며, 연결 해제된 자식은 마지막 월드 위치를 보존한다.
진행 중인 캐릭터 위치나 이동 발판의 phase를 담는 게임 저장 파일은 아니다.

## 이전 통합 게임 (`?mode=playground`)

이전 발전소 게임은 참고·회귀용 `?mode=playground` 경로로만 연다. 기본 메뉴에서는 제외하며 기능 학습은 독립 실험, 게임 응용은 도트 정원을 따른다.

| 체험 | 조작 / 엔진 동작 |
| --- | --- |
| 이동·장애물·수집 | 바닥 클릭, WASD/방향키, 전지 목적지 버튼. Rust 경로 탐색과 이동 애니메이션, trigger 기반 수집 변수 |
| 물리 | 공 던지기, 고무/점토, 30/60/120 Hz와 표시 보간 비교. rigid body·CCD·반사·감속 및 실제 충격 횟수/충격량 |
| 조명 | 포인터로 작업등 이동, 원본 색상/조명 전환, 스프라이트 노멀맵 비교. 공의 상하좌우 중 광원이 있는 면이 밝아진다. |
| 카메라 | 전체 보기, 로봇 추적, 공 실험장 보기, 확대/축소 |
| 화면 효과 | 기본, bloom/vignette, CRT 비교 |
| 씬 수명 | 일시정지·계속하기·다시 시작. 화면 설정은 유지하고 게임 진행을 초기화 |
| 렌더러 | WebGL2 또는 WebGPU 선택. 미지원 환경은 WebGL2 fallback |
| 9-slice | 실험장과 수조 패널의 테두리를 유지하며 크기를 늘리는 실제 runtime 렌더링 |

씬은 [public/playground/scene.json](public/playground/scene.json), 결정론적 원본 에셋 생성기는 [build-engine-playground.mjs](../../scripts/assets/build-engine-playground.mjs)다. `node scripts/assets/build-engine-playground.mjs`로 에셋을 재생성한다. 바닥은 타일 모양의 sprite instance이며 별도 TileMap API 예제는 아니다. TS는 입력/UI와 화면 설정을, Rust는 이동·수집·물리를 소유한다.

기존 사격 프로필·snapshot/replay fixture는 **`?mode=starter`**로 직접 연다. 기본 메뉴에서는 제외한다. 기존 `profile`, `reportSmoke`, `profilerSmoke` query도 그대로 지원한다. 아래 기술/콘솔 API 설명은 이 참고 모드에 해당한다.

`?mode=starter`의 기본 재생 버튼은 상태에 맞게 표시한다. 일시정지 후 Reset을 눌러도 진행하며,
Reset·게임 종료 후 다시 시작·Space 재시작 모두 선택한 weapon profile을 새 native player에 다시 적용한다.
프로필 표시만 남고 실제 projectile action이 사라지는 상태를 브라우저 회귀로 검증한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Runtime bootstrap | canvas, renderer, input, audio host, frame loop를 `createFerrumRuntime(...)`로 생성한다. |
| Demo shell | `examples/shared`의 공통 shell로 canvas, controls, metric panel, smoke hook을 재사용한다. |
| Render command buffer | Rust가 만든 sprite command를 WebGL2 renderer가 소비한다. |
| UiOverlay | runtime frame state를 HUD/dialog로 표시한다. |
| Runtime profile panel | 캔버스 아래에서 `standard`, `piercing`, `bounce` weapon profile을 전환하고 현재 projectile 설정, visual, 적용 상태, report capture count를 보여준다. |
| DebugOverlay | development 환경에서 frame/render/physics metric을 표시한다. |
| Runtime profiler | `?profilerSmoke=true`로 browser budget smoke sample을 수집한다. |
| Snapshot/replay report | `captureGameStateSnapshot(...)`, `createGameplayReplayRun(...)`으로 현재 runtime 상태를 검증 가능한 report로 노출한다. |
| Weapon profile authoring | `projectile(...)`, `weapon(...)`, `compileWeaponProfiles(...)`로 빌트인 player 사격 profile을 낮은 빈도 경로에서 적용한다. |

## 실행

```bash
pnpm dev:starter-runtime
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/starter-runtime dev
```

DebugOverlay를 켜려면 `?debug=true`를 사용한다.
브라우저 콘솔이나 smoke harness에서는 `window.ferrumStarterRuntimeCaptureReport()`로 현재 frame의 snapshot/replay report를 다시 만들 수 있다.
`window.ferrumStarterRuntimeApplyWeaponProfile("bounce")`로 현재 runtime에서 profile을 바꿀 수 있다.
`window.ferrumStarterRuntimeWeaponProfile`에서 현재 적용된 사격 프로필을 확인할 수 있다.
패널 버튼을 누르면 `Status`, `Profile`, `Shot`, `Rate`, `Size`, `Tile`, `Visual`, `Replay`, `Reports` 값이 즉시 갱신된다. `Capture Report`는 현재 runtime snapshot/replay report를 다시 캡처해 replay hash와 report counter를 갱신하는 QA/디버그 버튼이며, weapon profile이나 게임플레이를 새로 적용하는 버튼은 아니다.

### 사격 프로필

초기 profile은 `?profile=standard|piercing|bounce` query로 지정할 수 있고, 실행 중에는 캔버스 아래 Weapon Profile 패널에서 전환한다. 모든 profile은 같은 primary action id에 설치되므로 input binding은 `Space`/마우스 왼쪽 버튼 하나만 유지한다. profile별 새 발사체는 서로 다른 texture id와 bullet prefab size를 사용해 색, 형태, 크기가 구분된다. 기본 starter 장면은 보고서 계약을 유지한다. 벽 충돌 차이는 패널의 “벽 표적에서 일반·관통·반사 비교하기” 링크로 연다.

- `standard`(기본): 작은 `6x6` green pellet이 빠르게 연사된다.
- `piercing`: 긴 `20x5` cyan spear가 중간 속도로 나가며 `passThrough` tile impact를 가진다.
- `bounce`: 큰 `18x18` amber orb가 느리게 나가며 `bounce` tile impact와 높은 피해량을 가진다.

## 검증

```bash
pnpm --filter @ferrum2d/starter-runtime lint
pnpm --filter @ferrum2d/starter-runtime build
pnpm smoke:feature-examples
pnpm smoke:engine-playground
pnpm smoke:starter-runtime
pnpm smoke:starter-runtime-budget
```

`pnpm smoke:feature-examples`는 기능 31종 × 렌더러 2종에서 실제 native 상태·GPU pixel 변화, 타일 충돌, 입자 수명, Web Audio 좌우 출력·감쇠, 메뉴 입력 차단, 씬 변수 수명/페이드, 거리·조건부 상호작용, 저장 후 새로고침 복원/손상 거절, 대화·퀘스트 조건/키보드 포커스, HUD locale/접근성 값, 사격의 실제 소멸/관통/반사 궤적, 컷신 시간/카메라/음원 시작, 실제 fetch와 캐시/취소/실패, 구역 전환 후 텍스처 수 복귀, 초기화, pause, 390px 화면, 중첩 경로, 자원 해제를 확인한다. 게임패드는 하드웨어 polling만 모사하며 실물 장치/스피커 청취를 검증한 것은 아니다.
HD-2D 경사로 층 전환·발판 탑승·AI 우회/근접/원거리 피해·부모 회전/연결 해제를 native 상태로 검사한다. 사망 후 초기화와 일회성 렌더 오류 복구도 두 렌더러에서 확인한다.
애니메이션 클립/방향·프레임/완료 이벤트·실제 AudioBufferSource 시작과 실패/취소 후 재시도, 지형 편집 전후 실제 낙하 가속도·관통·복구·DPR 2 터치, 공간 조명/그림자/안개의 pixel 변화와 정적 장면의 중복 제출 방지도 확인한다.
추가로 초기 씬/텍스처/모델 로딩 중 페이지 이탈과 로드 실패 시 GPU 자원 해제, DPR 2·390px 화면에서 터치 타일 편집과 조이스틱 이동을 검사한다. 터치는 브라우저에서 모사한다. 레이어·조명·후처리·오디오 비교 씬의 로봇은 고정 프레임으로 표시해 무관한 애니메이션 변화가 결과에 섞이지 않게 한다.

`pnpm smoke:engine-playground`는 통합 게임 `?mode=playground`를 중첩 URL 경로에서 열어 실제 이동·수집·공 반사/감속·일시정지·초기화·광원/노멀/후처리 pixel 변화·카메라·390px 화면·GPU 자원 해제를 검증한다. WebGPU 검증은 Chromium 소프트웨어 offscreen target이며 하드웨어 성능/네이티브 표시 검증은 아니다.

`pnpm smoke:starter-runtime`은 `?mode=starter`에서 WebGL2 placeholder pixel readback, profile panel 렌더링, 실제 DOM profile/capture 버튼 클릭, profile별 projectile visual texture, snapshot/replay report hook을 함께 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/starter-runtime/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## 참고 문서

- [Runtime extensibility](../../docs/engine/runtime-extensibility.md)
- [Public API](../../docs/engine/public-api.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- texture/sound/JSON asset이 필요하면 `examples/topdown-shooter`의 manifest 흐름을 따른다.
- lighting, material, post-process, particle VFX를 확인하려면 `examples/minimal-game`의 `visual-runtime-lab` profile을 참고한다.
- 새 Physics Spec fixture를 확인하려면 `examples/physics-sandbox`를 사용한다.

물리 기능 예제(`?feature=physics`)에서는 회전 고정, 충돌 소리·입자, 파손 관절을
비교할 수 있다. ‘왼쪽 벽에 파손 관절 연결’ 뒤 ‘같은 힘으로 던지기’를 누르면
force 제한에 따라 연결이 끊어진다. 소리는 던지기 클릭으로 활성화한다.
진단 표시에는 CCD 상한과 파손 수, 4방향 batch 탐색 결과가 나온다.

HD-2D 이동 보행면은 `../data-scene-native/moving-platforms.mjs`의
`startMovingPlatformScene(canvas)` consumer recipe에 있다. WASD로 승강 바닥과
수평 이동 다리에 오르내리고, 반환 객체의 `save()`/`restore(snapshot)`로
탑승 위치와 왕복 phase를 복원한다.
