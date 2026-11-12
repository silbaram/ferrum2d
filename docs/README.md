# Ferrum2D 문서

한국어 · [English](en/README.md)

**엔진을 간단히 사용하려는 사람**과 **엔진으로 게임을 개발하는 AI**를 위한 안내를 나눴습니다.
목적에 맞는 안내부터 읽고, 정확한 설정값이나 API가 필요할 때 공통 참조를 확인하세요.

## 사람을 위한 간단 사용법

| 하고 싶은 일 | 읽을 문서 |
| --- | --- |
| 엔진이 무엇인지 알고 Studio를 사용해 보기 | [간단 사용법](engine/user-guide.md) |
| 내 컴퓨터에서 첫 게임을 실행하고 수정하기 | [첫 게임 실행하기](engine/developer-quickstart.md) |
| 조명·물리·애니메이션 등을 설치 없이 체험하기 | [기능과 예제 둘러보기](engine/showcase-hub.md) |

처음이라면 **간단 사용법 → 첫 게임 실행하기** 순서로 읽으세요.
AI에게 게임 개발을 맡길 때는 아래 개발 안내를 전달하면 됩니다.

## AI가 엔진으로 게임을 개발할 때

진입점은 **[AI 게임 개발 안내](engine/ai-game-development.md)**입니다.
작업 범위·설치 버전을 확인하고, 실제 게임에 연결된 파일을 수정한 뒤 검증하는 순서를 설명합니다.

| 작업 | 기준 문서 |
| --- | --- |
| 환경만 설치하고 게임 코드는 만들지 않기 | [AI 설치 지침](engine/ai-agent-install.md) |
| 요구사항을 지원 기능과 연결하기 | [AI 기능 찾기](engine/ai-feature-guide.md) |
| 수정할 파일·실행 연결·검증 명령 판단 | [AI 게임 개발 안내](engine/ai-game-development.md) |

게임 프로젝트에 설치된 agent 지침과 공개 타입을 우선 확인합니다.
엔진 자체의 CI·릴리스 명령을 소비자 게임 프로젝트에 그대로 적용하지 않습니다.

## 공통 상세 참조

사람과 AI가 같은 동작·설정 계약을 참조합니다. 아래 문서는 필요한 항목을 찾아 읽는 자료입니다.

| 내용 | 문서 |
| --- | --- |
| 공개 API·import·호환성 | [Public API](engine/public-api.md), [이전 안내](engine/public-api/migration-guide.md) |
| 씬·오브젝트·에셋·도트 원본 | [Scene Authoring](engine/data-scene-authoring.md) |
| 2D 애니메이션·재질·조명 | [화면 표현](engine/data-scene-presentation.md) |
| HD-2D 지형·모델·카메라·그림자 | [공간 씬](engine/data-scene-spatial.md) |
| 이동·게임 동작·확장 | [Native Runtime](engine/data-scene-native-runtime.md), [Runtime Extensibility](engine/runtime-extensibility.md) |
| 입력·좌표·물리 | [입력](engine/input-actions.md), [좌표계](engine/coordinate-system.md), [Physics Spec](engine/physics-spec.md) |
| 슈터 설정·성능 진단 | [Game Spec](examples/topdown-shooter/game-spec.md), [Quality API](engine/public-api/quality.md) |

## 엔진 자체를 개발·운영할 때

게임 개발과 별도의 내부 문서입니다.
[아키텍처](development/architecture/architecture.md), [회귀 검증](development/quality/smoke-check.md),
[릴리스](development/operations/github-release.md), [Pages 운영](development/operations/demo-deploy.md),
[개발 후보](planning/README.md)를 확인하세요.

## 문서 버전과 관리

- 개발 소스와 공개 릴리스는 기능이 다를 수 있습니다. 설치한 버전의 안내·타입·문서를 함께 확인하세요.
- 한국어와 영어의 시작 안내는 같은 흐름을 제공합니다. 미번역 상세 참조는 한국어 문서로 표시합니다.
- 간단 사용법에는 조작·예상 결과를, AI 안내에는 작업 순서·검증을 둡니다. API 계약은 공통 참조에만 정의합니다.
- `development/`는 엔진 내부 기준, `planning/`은 미완료 후보입니다. 완료 작업 로그를 사용법에 누적하지 않습니다.
- Markdown 수정 후 `pnpm validate:docs-links`, `pnpm validate:public-api-surface`, `pnpm build:pages`, `pnpm validate:pages-artifact`로 확인합니다. `dist-pages/`는 생성 결과입니다.
