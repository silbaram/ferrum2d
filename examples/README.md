# Ferrum2D 예제 안내

Pages 첫 화면은 새 예제 사이트(`site/`)다. Pixelforge 편집기형 틀(상단 막대·예제 목록·가운데 화면·상태 막대)에
2D 게임의 필수 기능을 하나씩 눈으로 확인하는 예제를 차례로 추가한다([예제 사이트 다시 만들기](../docs/planning/example-site-rebuild-plan.md)).
목록은 그리기·움직임과 화면·충돌과 물리·효과와 소리·게임 구성·게임 데모·도구로 나뉘고, 지금은 '스프라이트 그리기'(`?example=sprite`)와 '충돌과 트리거'(`?example=collision`)가 있다.
예제 화면은 재생 막대·실행 화면·아래 패널(설명·씬 파일·API·소스·엔진)·오른쪽 인스펙터(해 보기·볼 것)와 상태 막대의 엔진 수치로 이뤄진다.
넓은 화면에서는 목록·인스펙터·아래 패널의 경계선을 끌어 크기를 바꾸고, 목록과 인스펙터는 아이콘 줄로 접을 수 있다.
상단 언어 선택에서 **한국어** 또는 **English**를 고른다. 처음 방문할 때는 브라우저의 기본 언어가 한국어면 한국어, 그 외에는 영어를 표시한다.
선택한 언어는 새로고침 뒤에도 적용된다. 실행 중에 바꿔도 예제의 조작값과 열린 탭을 유지한다.
검색은 두 언어의 예제 이름과 설명을 찾으며, 상단 문서는 화면 언어에 맞는 문서로 연결된다.
예제 코드는 `site/src/examples/<id>/`에 있고, 틀과 주고받는 계약은 `site/src/example.ts`에 있다.

아래의 이전 예제(기능 실험실·물리 심화 실험실·게임 데모 4개)는 공개 사이트에서 빠졌다. 폴더는 그대로 두고 단독 실행할 수 있으며,
엔진 검사 데이터로 쓰인다(`topdown-shooter`의 Game Spec·골든 데이터, `minimal-game` 렌더 smoke, `physics-sandbox`의 Physics Spec 등).
옛 주소(`/starter-runtime/` 등)는 새 첫 화면으로 보내는 안내 페이지다.

## 예제 실행

저장소 루트에서 실행한다. Wasm·SDK·예제 dist를 처음 준비하거나 엔진 코드를 바꾼 경우 전체 빌드한다.

```bash
pnpm build
pnpm build:pages
pnpm preview:examples --host 0.0.0.0 --port 4173 --strictPort
```

`http://localhost:4173/`는 새 예제 사이트다. 사이트 틀만 고칠 때는 `pnpm --dir examples/site dev`로 연다.
이전 예제는 각 폴더의 단독 개발 명령(아래 표)으로 연다. 이전 예제 목록의 썸네일(`examples/shared/thumbnails/`)은 검사 데이터로 남긴다.

## 공개 예제의 역할

| 단계 | 디렉터리 | 이 예제로 배우는 것 | 단독 개발 실행 |
| --- | --- | --- | --- |
| 기능 학습 | [starter-runtime](starter-runtime/README.md) | 한 번에 한 기능을 바꾸는 독립 실험 31종 | `pnpm dev:starter-runtime` |
| 물리 심화 | [physics-sandbox](physics-sandbox/README.md) | 충돌체·접촉/센서·관절·CCD·공간 질의 등 7개 시나리오. 실험실 물리 주제의 확장이며 헤더에 "엔진 기능 실험실 › 물리"를 표시한다. | `pnpm dev:physics-sandbox` |
| 게임 응용 | [breakout](breakout/README.md) | 충돌 → 반사·벽돌 제거·점수·파티클 | `pnpm dev:breakout` |
| 게임 응용 | [platformer](platformer/README.md) | 이동 컨트롤러 → 점프·착지·단방향/이동 발판 | `pnpm dev:platformer` |
| 게임 응용 | [topdown-shooter](topdown-shooter/README.md) | Game Spec → 이동·사격·적 웨이브·HUD·조명·오디오 | `pnpm dev:topdown` |
| 게임 응용 | [pixel-art](pixel-art/README.md) | 도트 원본 → 애니메이션·팔레트・노멀 조명·후처리 | `pnpm dev:pixel-art` |
| 제작 도구 | [Ferrum2D Studio](../apps/studio/README.md) | 씬·에셋 작성, 오브젝트 배치·카메라·도트 편집 | `pnpm dev:studio` |

단독 개발 명령은 개별 Vite 서버다. 실행한 터미널 주소를 열며, 다른 예제 탐색은 통합 미리보기에서 한다.
게임·실험 앱 6종은 같은 상세 틀을 쓴다. 처음 화면에는 실행 화면 위의 제목과 한 문장, 오른쪽의 '해 보기'(버튼·조작·설정)와 '볼 것'(짧은 문장 2~3개)만 둔다.
설명, 데이터 파일, API, 코드 위치, 엔진 수치는 레이아웃 아래 '더 보기' 탭에 접혀 있다. 상단 막대에는 `Ferrum2D 예제 › 분류 › 이름` 경로가 있고, 앞 단계는 갤러리의 해당 분류로 돌아간다. 제작 도구는 자체 작업공간을 사용한다.
Breakout·Platformer는 `P/Esc`, 터치 이동·점프와 색상 안내를 제공한다. Shooter는 타이틀에서 시작한다.
게임 데모 4종은 1280px 이상에서 왼쪽에 게임 목록과 지금 게임의 체험할 기능을, 더 좁으면 실행 화면 위에 선택 상자를 둔다.
기능을 고르면 제목·한 문장과 해 보기·볼 것이 바뀌고 주소에 `?topic=`이 남는다. 실행 화면 바로 아래 한 줄에 이전·다음 게임이 있고,
'더 보기'는 게임 설명(작전 브리핑·도트 제작 과정·관련 기능 실험), Game Spec·씬 JSON이 있으면 그 탭, API, 코드 위치, 엔진 수치다.
물리 심화 실험실은 왼쪽 시나리오 목록(좁으면 선택 상자), 제목 옆 알려진 문제 표시, 해 보기(동작 버튼·선택한 물체·접힌 재질 값)와 볼 것,
실행 화면 아래 디버그 표시 줄과 이전·다음 시나리오를 둔다. '더 보기'의 Physics Spec은 시나리오를 바꾸면 따라 바뀌고, 실행 상태·물리 설정·물리 신호는 엔진 수치 탭에 있다.

## 기능 실험 31종

| 주제 | 실험 |
| --- | --- |
| 조명·그림자 | 노멀맵과 점광원, HD-2D 조명·그림자·안개, 실제 캐릭터·나무의 그림자 원본 비교 |
| 물리·충돌 | 물리 재질과 반사, 지형 파괴와 충돌 갱신, 영역 검색과 형상 이동 · 물리 심화 7종 |
| 카메라·화면 효과 | 화면 후처리, 카메라 추적과 확대, 픽셀 해상도와 좌표 정렬 |
| 스프라이트·애니메이션 | 스프라이트 애니메이션, 레이어와 앞뒤 정렬, 스프라이트 색상과 외곽선 |
| 맵·공간·이동 | 길 찾기와 장애물, 타일맵과 타일 충돌, HD-2D 공간 이동, 부모·자식 연결 |
| 파티클·VFX | 파티클·VFX |
| 게임 로직·씬 | 씬 전환과 페이드, 상호작용과 트리거, 저장과 불러오기, 대화와 퀘스트, 사격과 벽 충돌, 컷신과 동작 감소, AI 추적과 전투 |
| UI·입력 | 게임 UI 테두리 · 9-slice, 입력 장치와 메뉴 전환, HUD·다국어·접근성 |
| 오디오 | 공간 오디오 |
| 에셋·실행 환경 | 에셋 로딩과 캐시, 레벨 스트리밍, 렌더링과 GPU 자원 |

각 실험의 조작과 API는 [기능·예제 지도](../docs/engine/showcase-hub.md)를 따른다.

## 코드 레시피

실행 앱이 아니라 게임에 복사해 쓰는 공개 API 코드 예시다. 엔진 문서가 링크하고 브라우저 검사가 같은 코드를 실행한다.

| 경로 | 내용 |
| --- | --- |
| [data-scene-native](data-scene-native/README.md) | Data Scene 기본 구성·화면 표현·HD-2D 공간 지형·이동 발판·공간 오디오 레시피와 검증용 glTF 모델 |

## 참고·자동 검증용으로 유지하는 경로

아래는 기본 예제 목록에 표시하지 않는다. 기존 URL과 검증은 유지한다.

| 경로 | 유지 이유 | 공개 학습 경로 |
| --- | --- | --- |
| [minimal-game](minimal-game/README.md) | 최소 bootstrap 및 preload/input/content/UI fixture | 기능 실험실, 새 프로젝트는 create-game 템플릿 |
| `starter-runtime/?mode=starter` | 사격 프로필·리플레이·reset 회귀(호환 물리로 실행) | 사격 실험 → Neon Outpost |
| `starter-runtime/?mode=playground` | 이전 이동·수집·물리 통합 회귀 | 해당 기능 실험 → 도트 정원 |

## 목록과 검증 관리

- `shared/exampleCatalog.json`: 공개/참고 역할, 경로, 목적, 조작·관찰, 실행 명령, 관련 기능, 상위 실험실 주제(`parent`). 게임 이름은 `<게임 이름> · <배우는 기능>` 형식이다.
- `shared/featureCatalog.json`: 독립 실험의 이름, 주제·2D/HD-2D 태그, 조작·관찰·API.
- `shared/featureTopics.json`, `physicsExamples.json`: 공통 주제 순서·설명과 물리 시나리오의 직접 진입점. `physicsExamples.json`은 물리 시나리오 이름의 단일 원본이며 물리 실험실도 이 이름을 쓴다.
- `shared/exampleHeader.ts`, `exampleTheme.css`: 공개 예제 공통 탐색과 화면 토큰.
- `pnpm validate:example-catalog`: 중복 ID/경로·없는 명령·관련 기능·씬 파일 검사. Pages 빌드에도 포함된다.
- `pnpm test:pages-build`: 사이트·Studio 빌드가 없거나 HTML이 잘못되면 기존 Pages를 지우기 전에 거절하는지, 사이트가 첫 화면이고 옛 예제 주소가 안내 페이지인지 검사한다.
- `pnpm smoke:example-site`: 빌드된 Pages에서 새 사이트 틀·예제 목록·검색·언어 전환·없는 예제 안내·옛 주소 이동·좁은 화면 서랍·넘침과,
  예제마다 화면·조작·씬 파일·리셋·렌더러 전환·떠날 때 자원 해제(시작 중 이동 포함)를 검사한다.
- `pnpm smoke:feature-examples`: 기능별 native 상태·픽셀·상호작용·자원 회귀.

게임 규칙은 Rust, 입력·렌더링·메뉴는 TypeScript 플랫폼 계층이 담당한다. 공통 UI가 시뮬레이션 상태를 소유하지 않는다.
통합 탐색은 Pages 빌드가 발행 HTML에 넣는 표식으로 활성화한다. 개별 dist를 같은 이름의 폴더에 단독 호스팅해도 다른 앱으로 잘못 연결하지 않는다.
