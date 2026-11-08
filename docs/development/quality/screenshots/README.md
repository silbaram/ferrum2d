# Ferrum2D 스크린샷

루트 README와 Pages에서 사용하는 실제 실행 화면을 이 디렉터리에 둔다.
현재 이미지는 개발 소스의 production 빌드를 Chromium의 WebGL2/SwiftShader에서 실행해 캡처했다.
합성 이미지나 제품 UI 시안이 아니며, 공개 beta에 같은 기능이 포함되었다는 의미는 아니다.

정원·마을 세트는 2026-11-02에 엔진 소스 커밋 `7bc6504`의 빌드를 Chromium `148.0.7778.96`에서 캡처했다.
도트 쇼케이스는 2026-11-03에 `1b99e4f` 이후 작업 트리의 production 빌드를 같은 Chromium에서 캡처했다.
Shooter 세트는 2026-11-08에 `9dc5319` 이후 `feat/topdown-shooter-refresh` 작업 트리의 Neon Outpost production 빌드로 갱신했다.
기능 실험실 이미지는 2026-11-08에 `9dc5319` 이후 작업 트리의 9-slice 대화창 비교 production 빌드로 갱신했다.

Breakout·Platformer·Physics Lab 세트는 2026-11-08에 같은 작업 트리의 production 빌드를 UI로 일시정지한 뒤 캡처했다.

## 현재 이미지

| 파일 | 내용 |
| --- | --- |
| [placement-village.png](placement-village.png) | HD-2D 마을 Scene/Object Placement Viewer 전체 작업공간 |
| [garden-game-preview.png](garden-game-preview.png) | 2D 등불 정원 게임 미리보기, 실행 후 일시정지 |
| [village-game-preview.png](village-game-preview.png) | 씬에 저장된 게임 카메라를 적용한 HD-2D 마을, 실행 후 일시정지 |
| [topdown-shooter-title.png](topdown-shooter-title.png) | Neon Outpost 시작 안내·HUD·화면 설정 |
| [topdown-shooter-gameplay.png](topdown-shooter-gameplay.png) | Neon Outpost 실제 플레이·웨이브 HUD·조준·발사 |
| [pixel-art-showcase.png](pixel-art-showcase.png) | 작은 빛의 정원: 노멀 조명·장미 팔레트·일시정지 상태와 실제 조작 패널 |
| [breakout-demo.png](breakout-demo.png) | 충돌·반사 예제, native 실행 후 UI로 일시정지 |
| [platformer-demo.png](platformer-demo.png) | 점프·발판 예제, 색상 안내와 재생 조작 |
| [physics-lab.png](physics-lab.png) | 카메라를 맞춘 8개 물체와 native 충돌 선·재질·단일 스텝 UI |
| [engine-feature-lab.png](engine-feature-lab.png) | 기능 실험실: 같은 대화창의 일반 확대·9-slice 비교와 원본 9분할 |
| [example-hub.png](example-hub.png) | 기능 학습·게임 응용·제작 도구로 재편한 통합 홈과 검색·분류 |
| [pixel-art-demo.png](pixel-art-demo.png) | 공통 UI 테마와 탐색을 사용하는 도트 자산 응용 예제 |

캡처 기준은 `1440 × 1000`, DPR 1, 뷰어 한국어 UI다. 전체 작업공간은 body를,
정원·마을 게임 미리보기는 실제 canvas를 캡처하므로 이미지의 최종 크기는 서로 다르다.
Shooter는 시작·플레이 모두 body를 캡처해 게임 화면과 조작·설정을 함께 보여준다.
소프트웨어 렌더러의 캡처이며 성능 측정 자료로 사용하지 않는다.

## 재생성

저장소 루트에서 현재 production 빌드와 Chromium을 준비한 뒤 실행한다.

```bash
pnpm build
pnpm exec playwright-core install chromium
node scripts/tools/capture-readme-screenshots.mjs
# Shooter 두 장만 갱신할 때
node scripts/tools/capture-readme-screenshots.mjs --only=topdown-shooter
# 충돌/발판/물리 실험실 세 장만 갱신할 때
node scripts/tools/capture-readme-screenshots.mjs --only=guided-examples
# 공통 UI와 통합 홈·기능 실험실·게임 예제 여덟 장 갱신
pnpm build:pages
node scripts/tools/capture-readme-screenshots.mjs --only=example-suite
```

이미 설치된 Chromium을 사용하려면 `FERRUM_BROWSER_EXECUTABLE`에 실행 파일 경로를 지정한다.
캡처 도구는 로컬 임시 HTTP 서버만 열며 개발 서버, 외부 배포, 회귀 테스트 전용 fixture를 사용하지 않는다.
원본 씬이나 프로젝트를 저장하지 않으며 매 실행은 새 브라우저 작업공간에서 시작한다.

실행 시각, 소스 커밋, Chromium 버전, 객체·렌더 통계와 이미지 SHA-256은
`artifacts/readme-refresh/capture.json`에 남긴다. 선택 캡처는 `capture-guided.json` / `capture-topdown.json`에도 기록한다. 이 report는 로컬 검증 산출물이며 Git에 포함하지 않는다.
게임 진행에 따라 Shooter의 적·발사체·점수와 이미지 해시는 달라질 수 있다.

도트 쇼케이스는 다음 명령으로 별도 캡처한다. production 예제를 project subpath에서 열어 실제
이동·수집·애니메이션·화면 효과를 검사한 뒤 데스크톱(1440×1000)·모바일(390×844) 전체 페이지를 저장한다.

```bash
pnpm smoke:pixel-showcase
```

실행 폴더는 `artifacts/pixel-showcase/verification.json`의 `run`이다. 그 안의
`pixel-showcase-desktop.png`를 이 디렉터리의 `pixel-art-showcase.png`로 복사한다.
화면을 직접 확인한 캡처의 run·환경·해시는 `artifacts/pixel-workflow-next-six/showcase-capture.json`에 남긴다.
소프트웨어 WebGPU 검증은 offscreen readback을 사용하며 README 이미지는 WebGL2 canvas 캡처다.

갱신 후 모든 이미지를 열어 비어 있거나 잘린 영역과 오류 안내가 없는지 확인한다.
공통 UI 재편 뒤 기능 실험실·정원·통합 홈도 `--only=example-suite`로 직접 캡처한다.
WebGL2·1440×1000·DPR 1이며 기능 실험실은 9-slice 대화창 기본 설정을 보여준다.
전체 예제 캡처의 출처·native 상태·SHA-256은 `artifacts/readme-refresh/capture-suite.json`에 남긴다.
9-slice 설명 보강 후 `engine-feature-lab.png`는 별도 검증의 `nine-slice.png`로 갱신했다.
재생성은 starter-runtime 빌드 후 `node tests/smoke/feature-examples-smoke.mjs --nine-slice-only`를 실행하고,
`artifacts/nine-slice-example/browser/verification.json`의 `run`에서 `nine-slice.png`를 복사한다.
26개 기능의 공통 학습 안내를 적용한 뒤에는 홈과 기능 실험실 이미지만 함께 갱신한다.

```bash
node scripts/tools/capture-readme-screenshots.mjs --only=feature-lab
```

`pnpm build:pages`를 먼저 실행한다. 이 옵션은 다른 게임 이미지를 변경하지 않는다.
현재 홈·기능 실험실 이미지의 환경·출처는 `artifacts/readme-refresh/capture-feature-lab.json`,
전수 검토의 소스 hash·결과는 `artifacts/feature-learning-clarity/verification.json`을 따른다.
이 단독 검증 캡처는 정적 대화창을 실행 중인 상태이며 모바일 세로 비교도 함께 저장한다.
문서 링크와 Pages 이미지 복사도 검증한다.

```bash
pnpm validate:docs-links
pnpm build:pages
pnpm validate:pages-artifact
```

수동 캡처는 [Smoke Check](../smoke-check.md)의 해당 예제 절차를 따른다.
GameOver 등 다른 상태를 추가할 때는 `topdown-shooter-gameover.png`처럼 상태가 드러나는 파일명을 사용한다.
