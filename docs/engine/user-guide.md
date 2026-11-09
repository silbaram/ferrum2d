# Ferrum2D 사용자 설명서

한국어 · [English](../en/engine/user-guide.md)

Ferrum2D는 **AI agent-first 2D · HD-2D 웹 게임 엔진**이다. Rust/Wasm이 게임 상태·충돌·씬 진행과
렌더 명령을 만들고, TypeScript가 브라우저 입력·에셋·오디오와 WebGL2/선택 WebGPU 렌더링을 담당한다.
AI agent가 spec과 코드를 수정하고, 배치 뷰어에서 씬과 실행 결과를 확인한다.

이 문서는 현재 개발 소스의 사용 흐름을 안내한다. 설치한 릴리스와 개발 소스의 기능은 다를 수 있으므로,
게임 프로젝트에서는 설치 버전의 타입과 해당 tag의 문서를 함께 확인한다.

## 목적에 맞게 시작하기

| 목적 | 시작점 | 다음 문서 |
| --- | --- | --- |
| 설치 없이 기능을 체험하기 | [GitHub Pages](https://silbaram.github.io/ferrum2d/)의 기능 실험실 | [30개 기능과 예제 지도](showcase-hub.md) |
| 새 게임 프로젝트 만들기 | GitHub Release의 create-game 패키지로 템플릿 생성 | [개발자 퀵스타트](developer-quickstart.md) |
| AI에게 개발 환경 설정 맡기기 | 엔진·개발 도구·consumer 지침 설치 | [AI 설치 지침](ai-agent-install.md) |
| 씬·에셋·카메라 작성하기 | Placement Viewer에서 Scene Authoring 문서 열기 | [Scene Authoring](data-scene-authoring.md) |
| 게임 요구사항에 맞는 API 찾기 | 기능별 공개 API와 입력 데이터 확인 | [AI 기능 안내](ai-feature-guide.md), [Public API](public-api.md) |

## 현재 할 수 있는 일

| 영역 | 확인할 기능 | 기준 문서 |
| --- | --- | --- |
| 2D 표현 | 스프라이트·애니메이션·타일맵·레이어·9-slice·픽셀 퍼펙트·팔레트·후처리 | [표현과 애니메이션](data-scene-presentation.md), [Core API](public-api/core.md) |
| HD-2D | 입체 지형·경사·층·정적 모델·빌보드·카메라·조명·그림자 | [공간 씬](data-scene-spatial.md) |
| 게임플레이 | 이동·길 찾기·트리거·대화·퀘스트·저장·전투·씬 전환 | [Native Runtime](data-scene-native-runtime.md), [기능 안내](ai-feature-guide.md) |
| 물리 | 바디·충돌체·재질·joint·CCD·query·controller·파괴 지형 | [물리 기능 맵](../development/architecture/physics-engine.md), [Physics Spec](physics-spec.md) |
| 배치·도트 제작 | 씬 탐색·배치·변형·레이어·게임 카메라·도트 편집·PNG 가져오기·노멀 생성 | [Scene Authoring](data-scene-authoring.md) |
| 에셋 연동 | atlas·Tiled/LDtk·Aseprite 데이터 가져오기, 로딩·캐시·자원 수명 | [Core API](public-api/core.md), [Authoring API](public-api/authoring.md) |

사용 조건과 제약은 링크된 계약을 기준으로 한다. TypeScript는 콘텐츠·UI·플랫폼을 연결하고,
게임 진행과 물리 상태의 기준은 Rust에 둔다. 자세한 책임 경계는 [아키텍처](../development/architecture/architecture.md)를 따른다.

## 예제 실행하기

[저장소 개발환경](https://github.com/silbaram/ferrum2d#소스-개발환경)을 준비한 뒤 루트에서 실행한다. 처음 실행하거나 Rust를 변경한 뒤에는
`pnpm build`로 Wasm과 패키지를 먼저 빌드한다. 접속 주소와 포트는 실행한 Vite 터미널에 표시된다.

| 예제 | 실행 명령 | 관찰할 내용 |
| --- | --- | --- |
| 엔진 기능 실험실 | `pnpm dev:starter-runtime` | 30개 독립 실험의 설정·조작·관찰 결과·구현 API |
| 2D 정원·HD-2D 마을 | `pnpm dev:placement-viewer` | `?scene=garden` / `?scene=village`로 배치·게임 미리보기 |
| 물리 실험실 | `pnpm dev:physics-sandbox` | 7개 심화 시나리오와 충돌·solver 진단 |
| Top-down Shooter | `pnpm dev:topdown` | 이동·조준·발사·wave·점수와 Game Spec |
| Breakout | `pnpm dev:breakout` | 반사·충돌 이벤트·벽돌 제거·파티클 |
| Platformer | `pnpm dev:platformer` | 점프·단방향 발판·이동 발판 |
| 작은 빛의 정원 | `pnpm dev:pixel-art` | 도트 원본·씨앗 수집·조명·팔레트·화면 효과 |

예제는 **주제별 기능 실험 → 게임 응용** 순서로 탐색한다. 제작 도구는 별도 영역에 있다.
통합 홈은 기능 검색·분류를 제공하고, 게임·실험 예제의 상단에는 같은 탐색 메뉴와 조작·관찰·관련 실험 안내가 있다.
전체를 로컬에서 보려면 `pnpm build && pnpm build:pages && pnpm preview:examples`를 실행한다.
단독 Vite 서버에서는 다른 앱으로 연결하지 않으며 통합 미리보기 실행 방법을 안내한다.
Minimal과 이전 `?mode=playground`/`?mode=starter`는 참고·검증용으로 유지하며 기본 목록에서 제외한다.
전체 목록과 조작법은 [Showcase Hub](showcase-hub.md)를 따른다.

## 뷰어에서 작성하고 실행하기

1. **파일 → 예제**에서 정원이나 마을을 열거나, 프로젝트의 Scene Authoring JSON을 연다.
2. 오브젝트를 선택하고 배치·변형·레이어·에셋을 수정한다. **내 변경**에서 원본 대비 변경을 검토한다.
3. **게임 미리보기**로 씬에 저장된 게임 카메라 구도를 확인하고 **실행**으로 지원하는 씬 동작을 체험한다.
4. **정지**하면 작성 위치·초안·편집 카메라로 돌아온다. 실행 중 캐릭터 위치를 배치 원본으로 저장하지 않는다.
5. 현재 문서에 표시된 저장 방식에 따라 저장하거나 JSON/patch를 내보낸다.

편집 카메라는 작업 화면을 탐색하는 도구다. 실제 게임 구도는 뷰어의 게임 카메라 설정으로 작성한다.
게임 미리보기는 Scene Authoring 런타임을 실행하며, 외부 프로젝트의 임의 TypeScript 진입점이나 자체 HUD를 자동으로 실행하지 않는다.

| 실행 환경 | 저장과 프로젝트 접근 |
| --- | --- |
| GitHub Pages·브라우저의 내장 예제 | 내보내기 전용. 원본 예제와 로컬 프로젝트를 자동으로 덮어쓰지 않는다. |
| 로컬 개발 서버 | 기본 저장은 비활성이다. 명시적으로 켠 저장 adapter/endpoint의 범위에서 저장한다. |
| 데스크톱 앱 | 사용자가 연 프로젝트·문서와 host가 허용한 에셋 경로에서 저장한다. |

씬·도트 원본의 실제 저장과 agent용 `.ferrum-placement-handoff.json`은 별도다.
Handoff는 선택·초안·에셋 참조를 전달하는 자료이며 씬 저장을 대체하지 않는다.
상세 조작·저장 권한·한영 UI·`Ctrl+K` 명령 검색은 [뷰어 안내](https://github.com/silbaram/ferrum2d/blob/main/apps/placement-viewer/README.md)를 따른다.

## 게임 프로젝트에서 수정할 파일

새 게임은 [개발자 퀵스타트](developer-quickstart.md)의 GitHub Release 설치 경로로 생성한다.
엔진 저장소의 예제를 수정하는 작업과 생성한 게임 프로젝트를 수정하는 작업은 경로가 다르다.

| 입력 | 생성 프로젝트의 경로 | 기준 |
| --- | --- | --- |
| Shooter 밸런스·wave·무기·카메라 | `topdown` 템플릿의 `public/game.json` | [Game Spec](../examples/topdown-shooter/game-spec.md) |
| 씬·prefab·배치·에셋 참조 | `public/scene-authoring.json` | [Scene Authoring](data-scene-authoring.md) |
| 이미지·소리·타일 원본 | `public/assets/`와 asset metadata | [Authoring API](public-api/authoring.md) |
| 엔진 초기화·HUD·플랫폼 연결 | `src/main.ts`와 `src/styles.css` | [Core API](public-api/core.md) |
| 물리 authoring 데이터 | 프로젝트의 Physics Spec 입력 | [Physics Spec](physics-spec.md) |

씬 파일이 실제 게임 실행에 어떻게 연결되는지는 템플릿과 bootstrap에 따른다.
뷰어에서 문서를 열었다는 사실만으로 별도의 게임 진입점에 자동 연결되지는 않는다.
`npm run ferrum:report`의 `project.runtimeInputs`와 [Native Runtime](data-scene-native-runtime.md)을 확인한다.

## 수정하고 검증하는 흐름

1. 원하는 기능을 [AI 기능 안내](ai-feature-guide.md)에서 찾아 설치 버전의 공개 API와 상세 계약을 확인한다.
2. spec·에셋·코드를 수정한다. 필요하면 뷰어의 배치 초안과 handoff를 함께 참고한다.
3. 생성 프로젝트에서 기본 검증을 실행한다.

```bash
npm run ferrum:check
```

`ferrum:check`는 validation·authoring/replay·production build를 순서대로 실행한다.
실패하면 JSON report의 실패 단계와 다음 명령을 먼저 확인한다.

4. `npm run dev`로 실제 입력·플레이·카메라·오디오를 확인한다.
5. 정적 배포를 준비할 때는 `npm run ferrum:deploy-report`와 `npm run preview`를 실행한다.

AI 지침 설치는 생성 프로젝트의 `npm run ferrum:agents`를 사용한다.
기본 설치·검증과 실제 게임 기능 구현은 별도 요청으로 진행할 수 있다.

## Top-down Shooter 예제 수정

엔진 저장소에서는 `examples/topdown-shooter/public/game.json`을 수정한다.
설정 필드·기본값·제약·preset은 [Game Spec 문서](../examples/topdown-shooter/game-spec.md)를 기준으로 한다.

```bash
pnpm validate:game-spec
pnpm dev:topdown
```

| 입력 | 동작 |
| --- | --- |
| Enter 또는 Space | 타이틀에서 시작 |
| W/A/S/D | 이동 |
| 마우스 이동 | 조준 |
| 마우스 왼쪽 버튼 또는 Space | 발사 |
| 게임 종료 후 Space | 재시작 |

예제 URL에 `?debug=true`를 붙이면 debug overlay를 확인할 수 있다.
터치·게임패드·가상 조작부와 action/context 설정은 [입력 액션](input-actions.md)을 따른다.
수동 플레이 확인은 [Shooter 점검표](https://github.com/silbaram/ferrum2d/blob/main/examples/topdown-shooter/SMOKE_CHECKLIST.md)를 참고한다.

## 지원 범위와 상세 계약

2D와 정적 모델을 사용하는 HD-2D를 제공하며, WebGL2가 기본 렌더러다.
WebGPU는 지원 환경에서 선택하고 기능별 조건을 확인한다.
도트 제작·씬 배치는 보조 도구의 범위이며, Behavior Recipe 본문·FSM/action graph를 UI에서 편집하는
범용 visual editor와 multiplayer·Wasm threads·스켈레탈 애니메이션은 별도 설계/승인 범위다.

| 자세히 확인할 내용 | 문서 |
| --- | --- |
| 공개 import·지원 수준·이전 방법 | [Public API](public-api.md), [Migration Guide](public-api/migration-guide.md) |
| 입력·오디오·에셋·초기화·자원 수명 | [Core API](public-api/core.md) |
| 애니메이션·카메라 표현·태양 그림자 | [Presentation](data-scene-presentation.md) |
| 지형·층·모델·조명·그림자·WebGPU | [공간 씬](data-scene-spatial.md) |
| Rust/TypeScript 역할과 Wasm 경계 | [아키텍처](../development/architecture/architecture.md) |
| 소스 수정 후 회귀 검증 | [Smoke Check](../development/quality/smoke-check.md) |
| 문서·예제 사이트 빌드와 배포 | [Pages 운영](../development/operations/demo-deploy.md) |
| 남은 개발 계획과 설계 후보 | [Planning](../planning/README.md) |
