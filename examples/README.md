# Ferrum2D 예제 안내

예제는 **주제별 기능 실험 → 게임 응용** 순서로 체험한다. 제작 도구는 게임과 구분한다.
기본 주소는 기능 실험실을 연다. 10개 기능 주제를 고르거나 상단의 **예제 이동**으로 게임·물리 심화·제작 도구를 연다. 물리 7개 시나리오는 물리·충돌 주제에서도 선택한다. 화면은 공통 글꼴·색상·조작·관찰 안내를 사용한다.
각 기능 화면에는 게임에서 쓰는 상황을 표시한다. 31개 기능 학습 화면은 조작 순서·객체 역할·범례와 실제 상태를 함께 보여준다.

## 예제 실행

저장소 루트에서 실행한다. Wasm·SDK·예제 dist를 처음 준비하거나 엔진 코드를 바꾼 경우 전체 빌드한다.

```bash
pnpm build
pnpm build:pages
pnpm preview:examples --host 0.0.0.0 --port 4173 --strictPort
```

`http://localhost:4173/`는 기능 실험실로 바로 이동한다. 다른 앱은 상단의 **예제 이동**에서 선택한다. 이미 빌드했다면 마지막 명령만 실행하면 된다.
기능 실험실은 `/starter-runtime/`, 개별 실험은 `?feature=lighting`처럼 직접 연다.

## 공개 예제의 역할

| 단계 | 디렉터리 | 이 예제로 배우는 것 | 단독 개발 실행 |
| --- | --- | --- | --- |
| 기능 학습 | [starter-runtime](starter-runtime/README.md) | 한 번에 한 기능을 바꾸는 독립 실험 31종 | `pnpm dev:starter-runtime` |
| 물리 심화 | [physics-sandbox](physics-sandbox/README.md) | 충돌체·접촉/센서·joint·CCD·공간 질의 등 7개 시나리오 | `pnpm dev:physics-sandbox` |
| 게임 응용 | [breakout](breakout/README.md) | 충돌 → 반사·벽돌 제거·점수·파티클 | `pnpm dev:breakout` |
| 게임 응용 | [platformer](platformer/README.md) | 이동 컨트롤러 → 점프·착지·단방향/이동 발판 | `pnpm dev:platformer` |
| 게임 응용 | [topdown-shooter](topdown-shooter/README.md) | Game Spec → 이동·사격·적 웨이브·HUD·조명·오디오 | `pnpm dev:topdown` |
| 게임 응용 | [pixel-art](pixel-art/README.md) | 도트 원본 → 애니메이션·팔레트・노멀 조명·후처리 | `pnpm dev:pixel-art` |
| 제작 도구 | [Placement Viewer](../apps/placement-viewer/README.md) | 씬·에셋 작성, 오브젝트 배치·카메라·도트 편집 | `pnpm dev:placement-viewer` |

단독 개발 명령은 개별 Vite 서버다. 실행한 터미널 주소를 열며, 다른 예제 탐색은 통합 미리보기에서 한다.
게임·실험 앱 6종은 목적, 직접 해보기, 관찰할 결과, 관련 기능 실험을 같은 형식으로 안내한다. 제작 도구는 자체 작업공간을 사용한다.
Breakout·Platformer는 `P/Esc`, 터치 이동·점프와 색상 안내를 제공한다. Shooter는 타이틀에서 시작한다.

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

## 참고·자동 검증용으로 유지하는 경로

아래는 기본 예제 목록에 표시하지 않는다. 기존 URL과 검증은 유지한다.

| 경로 | 유지 이유 | 공개 학습 경로 |
| --- | --- | --- |
| [minimal-game](minimal-game/README.md) | 최소 bootstrap 및 preload/input/content/UI fixture | 기능 실험실, 새 프로젝트는 create-game 템플릿 |
| `starter-runtime/?mode=starter` | 사격 프로필·리플레이·reset 회귀 | 사격 실험 → Neon Outpost |
| `starter-runtime/?mode=playground` | 이전 이동·수집·물리 통합 회귀 | 해당 기능 실험 → 도트 정원 |

## 목록과 검증 관리

- `shared/exampleCatalog.json`: 공개/참고 역할, 경로, 목적, 조작·관찰, 실행 명령, 관련 기능.
- `shared/featureCatalog.json`: 독립 실험의 이름, 주제·2D/HD-2D 태그, 조작·관찰·API.
- `shared/featureTopics.json`, `physicsExamples.json`: 공통 주제 순서·설명과 물리 시나리오의 직접 진입점.
- `shared/exampleHeader.ts`, `exampleTheme.css`: 공개 예제 공통 탐색과 화면 토큰.
- `pnpm validate:example-catalog`: 중복 ID/경로·없는 명령·관련 기능·씬 파일 검사. Pages 빌드에도 포함된다.
- `pnpm test:example-catalog-build`: 누락된 예제 입력·잘못된 HTML이 기존 Pages를 지우기 전에 거절되는지, 통합 탐색 표식이 발행 복사본에만 들어가는지 검사한다.
- `pnpm smoke:example-suite`: 빌드된 전체 예제를 전제로 기능 실험실 진입·공통 이동 메뉴·모바일·키보드·중첩 경로·단독 실행과 실제 게임 입력 검사.
- `pnpm smoke:feature-examples`: 기능별 native 상태·픽셀·상호작용·자원 회귀.

게임 규칙은 Rust, 입력·렌더링·메뉴는 TypeScript 플랫폼 계층이 담당한다. 공통 UI가 시뮬레이션 상태를 소유하지 않는다.
통합 탐색은 Pages 빌드가 발행 HTML에 넣는 표식으로 활성화한다. 개별 dist를 같은 이름의 폴더에 단독 호스팅해도 다른 앱으로 잘못 연결하지 않는다.
