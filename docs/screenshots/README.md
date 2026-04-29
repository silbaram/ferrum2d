# Ferrum2D 스크린샷

릴리스 문서에서 사용하는 스크린샷은 이 디렉터리에 둔다.

## 현재 대상

- `topdown-shooter-title.png`: README에 표시하는 Top-down Shooter MVP 릴리스 preview

현재 파일은 headless WebGL2 캡처가 안정적이지 않은 환경에서도 GitHub README가 깨지지 않도록 만든 정적 preview 이미지다. 실제 브라우저 실행 화면을 캡처할 수 있으면 같은 파일명으로 교체한다.

## 수동 캡처 절차

1. `pnpm build:wasm`
2. `pnpm --filter @ferrum2d/topdown-shooter dev`
3. 브라우저에서 Vite URL 접속
4. Title 화면과 DebugOverlay가 보이는 상태를 캡처
5. 파일을 `docs/screenshots/topdown-shooter-title.png`로 저장

GameOver나 score 증가 화면을 추가로 캡처하는 경우 파일명은 `topdown-shooter-gameover.png`처럼 상태가 드러나게 지정한다.
