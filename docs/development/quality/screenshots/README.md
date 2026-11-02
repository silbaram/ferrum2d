# Ferrum2D 스크린샷

루트 README와 Pages에서 사용하는 실제 실행 화면을 이 디렉터리에 둔다.
현재 이미지는 개발 소스의 production 빌드를 Chromium의 WebGL2/SwiftShader에서 실행해 캡처했다.
합성 이미지나 제품 UI 시안이 아니며, 공개 beta에 같은 기능이 포함되었다는 의미는 아니다.

현재 세트는 2026-11-02에 엔진 소스 커밋 `7bc6504`의 빌드를 Chromium `148.0.7778.96`에서 캡처했다.

## 현재 이미지

| 파일 | 내용 |
| --- | --- |
| [placement-village.png](placement-village.png) | HD-2D 마을 Scene/Object Placement Viewer 전체 작업공간 |
| [garden-game-preview.png](garden-game-preview.png) | 2D 등불 정원 게임 미리보기, 실행 후 일시정지 |
| [village-game-preview.png](village-game-preview.png) | 씬에 저장된 게임 카메라를 적용한 HD-2D 마을, 실행 후 일시정지 |
| [topdown-shooter-title.png](topdown-shooter-title.png) | 실제 Shooter 시작 화면과 시작 안내. 기존 정적 preview를 대체하며 Pages 홈에서도 사용 |
| [topdown-shooter-gameplay.png](topdown-shooter-gameplay.png) | 실제 Shooter 실행 중 조준·발사 화면 |

캡처 기준은 `1440 × 1000`, DPR 1, 뷰어 한국어 UI다. 전체 작업공간은 body를,
게임 미리보기·플레이는 실제 canvas를 캡처하므로 이미지의 최종 크기는 서로 다르다.
Shooter 시작 화면은 canvas와 같은 section의 제목·시작 안내를 함께 캡처한다.
소프트웨어 렌더러의 캡처이며 성능 측정 자료로 사용하지 않는다.

## 재생성

저장소 루트에서 현재 production 빌드와 Chromium을 준비한 뒤 실행한다.

```bash
pnpm build
pnpm exec playwright-core install chromium
node scripts/tools/capture-readme-screenshots.mjs
```

이미 설치된 Chromium을 사용하려면 `FERRUM_BROWSER_EXECUTABLE`에 실행 파일 경로를 지정한다.
캡처 도구는 로컬 임시 HTTP 서버만 열며 개발 서버, 외부 배포, 회귀 테스트 전용 fixture를 사용하지 않는다.
원본 씬이나 프로젝트를 저장하지 않으며 매 실행은 새 브라우저 작업공간에서 시작한다.

실행 시각, 소스 커밋, Chromium 버전, 객체·렌더 통계와 이미지 SHA-256은
`artifacts/readme-refresh/capture.json`에 남긴다. 이 report는 로컬 검증 산출물이며 Git에 포함하지 않는다.
게임 진행에 따라 Shooter의 적·발사체·점수와 이미지 해시는 달라질 수 있다.

갱신 후 모든 이미지를 열어 비어 있거나 잘린 영역과 오류 안내가 없는지 확인한다.
문서 링크와 Pages 이미지 복사도 검증한다.

```bash
pnpm validate:docs-links
pnpm build:pages
pnpm validate:pages-artifact
```

수동 캡처는 [Smoke Check](../smoke-check.md)의 해당 예제 절차를 따른다.
GameOver 등 다른 상태를 추가할 때는 `topdown-shooter-gameover.png`처럼 상태가 드러나는 파일명을 사용한다.
