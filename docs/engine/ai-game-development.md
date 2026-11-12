# AI 게임 개발 안내

한국어 · [English](../en/engine/ai-game-development.md)

대상은 **Ferrum2D를 설치한 게임 프로젝트에서 기능을 구현·수정하는 AI agent**다.
이 문서는 작업 진입점과 검증 순서를 정의한다. API 동작은 [공통 상세 참조](../README.md#공통-상세-참조),
기능별 선택 기준은 설치된 `.agents/harness/ferrum-feature-guide.md`를 사용한다.

사람에게는 [간단 사용법](user-guide.md)을 안내한다. 엔진 저장소 자체를 고치는 작업은
저장소의 `AGENTS.md`와 [개발 문서](../development/architecture/architecture.md)를 따른다.

## 1. 요청과 프로젝트 확인

| 요청 | 시작할 작업 |
| --- | --- |
| 환경 설치만 | [AI 설치 지침](ai-agent-install.md). 게임 코드·예제 생성과 기능 개발은 포함하지 않음 |
| 새 게임 생성 | [첫 게임 실행하기](developer-quickstart.md)의 같은 릴리스 생성기 사용. 장르에 맞는 템플릿 선택 |
| 기존 게임 수정 | 기존 파일·지침·사용자 변경을 먼저 확인. 템플릿으로 프로젝트를 덮어쓰지 않음 |

프로젝트의 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` 중 사용 도구에 해당하는 지침과 설치된 consumer harness를 읽는다.
consumer harness는 이 엔진을 사용하는 게임용이다. 엔진 자체의 배포·package QA 지침과 혼용하지 않는다.

다음 자료로 현재 설치를 확인한다.

- `package.json`, lockfile, `FERRUM_INSTALL.md`: 실행 명령·package manager·설치 출처
- 설치된 `@ferrum2d/ferrum-web/package.json`과 공개 `.d.ts`: 실제 버전과 제공 API
- 기존 게임의 진입점·spec·에셋 및 미커밋 변경: 현재 동작과 수정 범위

현재 웹 문서는 개발 소스 기준일 수 있다. 해당 tag의 문서·설치 타입을 함께 확인하고
없는 API를 최신 문서만 보고 호출하지 않는다. 필요 기능이 없으면 지원하는 대안 또는 업그레이드 범위를 설명한다.

현재 소스의 작성 helper는 `@ferrum2d/studio-kit`, 경량 페이지는 `studio.html` / `ferrum:studio`다.
beta.9 이하의 `authoring-viewer` / `placement-viewer.html` / `ferrum:placement-viewer`는 해당 릴리스의 이름이다.
과거 릴리스 URL을 새 이름으로 치환하지 않는다.

## 2. 실제 실행 입력 찾기

생성 프로젝트에 명령이 있으면 프로젝트 루트에서 실행한다.

```bash
npm run ferrum:report
```

`project.runtimeInputs`로 실제 게임이 읽는 파일과 연결 방식을 확인한다.
`public/scene-authoring.json`이 존재하거나 Studio에서 열렸다는 사실만으로 게임에 연결됐다고 판단하지 않는다.
사용자가 직접 만든 프로젝트에 명령이 없다면 기존 bootstrap·scripts를 읽고 동등한 검증 경로를 찾는다.

| 변경 의도 | 먼저 볼 입력 | 상세 참조 |
| --- | --- | --- |
| 슈터 밸런스·무기·wave | `topdown`의 `public/game.json` | [Game Spec](../examples/topdown-shooter/game-spec.md) |
| 배치·prefab·component·기존 동작 참조 | 실제 연결된 Scene Authoring JSON | [Scene Authoring](data-scene-authoring.md) |
| 게임 이동·상호작용·전투·진행 저장 | 문서의 gameplay 설정과 native 실행 연결 | [Native Runtime](data-scene-native-runtime.md), [Authoring API](public-api/authoring.md) |
| clip·2D 재질·빛·화면 효과 | scene visual/lighting과 runtime 표현 설정 | [화면 표현](data-scene-presentation.md) |
| HD-2D 지형·모델·카메라·환경 | `spatial`과 에셋 등록/준비 | [공간 씬](data-scene-spatial.md) |
| 물리·입력 | Physics Spec, action/context 설정과 bootstrap | [물리](physics-spec.md), [입력](input-actions.md) |
| 이미지·소리·타일 원본 | `public/assets/`, 실제 manifest·registry | [Core API](public-api/core.md), [Authoring API](public-api/authoring.md) |
| 초기화·HUD·브라우저 연결 | `src/main.ts`, `src/styles.css`와 프로젝트 모듈 | [Core API](public-api/core.md) |

표의 파일명은 생성 템플릿 기준이다. 설치 버전과 프로젝트에서 확인한 실행 입력을 우선한다.
새 기능을 찾을 때는 [AI 기능 찾기](ai-feature-guide.md)에서 설치된 기능 안내서와 상세 참조로 이동한다.

## 3. 변경 구현

1. 요청을 관찰 가능한 완료 조건으로 바꾼다. 예: 이동 속도 증가, 벽 통과 방지, 저장 후 같은 위치 복원.
2. 기존 spec·에셋·공개 API로 표현할 수 있는지 확인하고 필요한 파일만 수정한다.
3. 작성한 데이터를 실제 bootstrap·registry·runtime 입력에 연결한다.
4. 저장·씬 교체·취소·자원 수명 등 변경과 관련된 실패 조건을 확인한다.

[Public API](public-api.md)의 목적별 subpath를 사용한다. 게임 코드에서 엔진의 `src/*`, `dist/*`, `pkg/*`
내부 모듈을 직접 import하지 않는다. Rust가 제공하는 게임 진행·물리·애니메이션 상태를 TS frame loop에서 중복 계산하지 않는다.
기능이 부족하면 별도 엔진 변경이 필요한 경계를 밝힌다. Studio가 recipe 본문/FSM을 편집하거나 임의 게임 진입점을 실행한다고 가정하지 않는다.

Studio에서 전달받은 patch/handoff는 대상 문서·에셋 참조·원본과 대조한 뒤 적용한다.
handoff를 저장된 씬 자체로 간주하지 않는다. 변경한 파일이 게임에서 사용되는지 다시 확인한다.

## 4. 검증

생성 프로젝트의 기본 검증은 다음이다. 사용 중인 package manager와 실제 `package.json` 명령을 따른다.

```bash
npm run ferrum:check
```

validation·asset·authoring·replay·build를 순서대로 실행하며 첫 실패를 보고한다.
실패 시 `check.failedStep`, `check.nextCommand`와 실패한 `check.steps[]`의 `diagnosticCodes`·출력을 읽는다.
원인을 고친 뒤 해당 단계와 전체 검증을 확인한다.
세부 진단은 필요한 것만 실행한다.

| 명령 | 확인하는 것 |
| --- | --- |
| `ferrum:validate` | Game Spec과 생성 프로젝트의 기본 입력 |
| `ferrum:asset-report`, `ferrum:asset-validate` | 에셋·atlas·audio·localization 입력과 참조 |
| `ferrum:authoring-report` | Scene Authoring과 Behavior Recipe 연결 |
| `ferrum:replay-report` | authoring/gameplay replay fixture |
| `ferrum:runtime-replay-report` | 실제 runtime replay와 기대 상태 |
| `ferrum:smoke` | 생성 프로젝트의 validate/build 묶음 |
| `ferrum:deploy-report` | build·상대 asset 경로·실제 preview HTTP·Wasm MIME |

각 명령은 `npm run <명령>`으로 실행한다. 없는 script를 있다고 가정하지 않는다.
`pnpm smoke:studio`, 엔진 전체 package check 등 저장소 개발 명령을 consumer 프로젝트의 필수 gate로 쓰지 않는다.

게임 변경으로 replay가 달라졌다면 첫 차이·입력·seed·기대 결과를 확인한다.
오류를 감추려고 snapshot/hash를 일괄 갱신하지 않는다. 의도한 동작 변경으로 확인된 경우에만
해당 `ferrum:update-replay-fixture` 또는 `ferrum:update-runtime-replay-fixture`로 기준을 갱신하고 재검증한다.

## 5. 실행 화면과 배포 결과 확인

`npm run dev`로 변경 기능을 실제 조작하고 예상 결과와 비교한다.
로딩 성공·설정값 round-trip·report 생성만으로 플레이 성공을 판정하지 않는다.
자동화하지 못한 조작·오디오·실기기 확인은 미검증으로 남긴다.

배포가 요청되면 다음 로컬 준비부터 수행한다.

```bash
npm run ferrum:deploy-report
npm run preview
```

`ready`는 지원하는 정적 경로 검사와 로컬 HTTP/Wasm 응답의 성공이다.
HTML `<base>`와 여러 디렉터리의 HTML에서 상대 literal `fetch(...)`를 사용하는 조합은 현재 배포 검사의 제한을 따른다.
상세 조건은 [배포 계약](../development/operations/npm-package-strategy.md)을 참조한다.
대상 호스팅의 실행·MIME·입력 확인과 원격 공개는 별도이며, 로컬 결과를 공개 완료로 보고하지 않는다.

## 6. 사람에게 결과 전달

- 바뀐 동작과 주요 수정 파일
- 실행한 검증과 실패·생략한 검사, 이유
- 게임 실행 명령과 사람이 확인할 조작·예상 결과
- 남은 문제와 필요한 환경

첫 안내에서는 내부 report 필드나 ABI 설명보다 실제 결과와 실행 방법을 먼저 쓴다.
사람이 더 자세히 확인하려 할 때 관련 report와 [공통 상세 참조](../README.md#공통-상세-참조)를 제공한다.
