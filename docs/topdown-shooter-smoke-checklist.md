# Top-down Shooter Manual Smoke Checklist

이 문서는 Ferrum2D MVP 예제(`examples/topdown-shooter`)를 수동으로 점검할 때 사용하는 최소 체크리스트다.

## 목적

- WebGL2 실제 렌더링, 입력, 오디오, DebugOverlay를 자동 테스트 바깥에서 빠르게 검증한다.
- 릴리스 전/후 회귀(regression)를 같은 기준으로 비교한다.

## 사전 준비

1. 의존성 설치

```bash
pnpm install
```

2. Rust core 테스트

```bash
cargo test --manifest-path crates/ferrum-core/Cargo.toml
```

3. Wasm 빌드

```bash
pnpm build:wasm
```

4. 예제 실행

```bash
pnpm --filter @ferrum2d/topdown-shooter dev
```

## 체크리스트 (MVP 범위)

### A. 부팅/화면 진입

- [ ] 브라우저에서 Vite URL 진입 시 캔버스가 깨지지 않고 표시된다.
- [ ] Title 화면 텍스트가 보인다.
- [ ] DebugOverlay가 표시되고 값이 갱신된다.

### B. 입력/플레이 전환

- [ ] `Enter` 또는 `Space`로 Title → Playing 전환이 된다.
- [ ] `W/A/S/D`로 플레이어 이동이 된다.
- [ ] 마우스 위치를 기준으로 발사 방향이 바뀐다.

### C. 전투/점수

- [ ] 마우스 좌클릭(또는 엔진 기본 발사 입력) 시 총알이 발사된다.
- [ ] 적이 주기적으로 스폰되고 이동한다.
- [ ] 총알-적 충돌 시 적이 제거되고 score가 증가한다.

### D. 게임오버/재시작

- [ ] 플레이어-적 충돌 시 game over 상태로 전환된다.
- [ ] game over 직후 재시작 안내가 표시된다.
- [ ] `Space`로 재시작하면 score와 상태가 초기화된다.

### E. 오디오/에셋

- [ ] 발사/피격/game over 효과음이 정상 재생된다.
- [ ] 텍스처 누락(핑크/검은 사각형 등) 없이 스프라이트가 표시된다.

### F. DebugOverlay/렌더러 지표

- [ ] FPS, frame time, Rust update time, render time이 숫자로 갱신된다.
- [ ] entity/sprite count가 플레이 상태 변화(스폰/제거)에 맞게 변한다.
- [ ] render command 수, texture bind/switch 추정치, audio events/sec가 비정상적으로 고정되지 않는다.

## 캡처/증적 저장

- Title + DebugOverlay 화면을 `docs/screenshots/topdown-shooter-title.png`로 갱신한다.
- 필요 시 `topdown-shooter-gameover.png`, `topdown-shooter-score.png`를 추가한다.
- 캡처 규칙은 `docs/screenshots/README.md`를 따른다.

## 실패 기록 템플릿

문제가 있으면 아래 형식으로 기록한다.

- 증상:
- 재현 절차:
- 기대 결과:
- 실제 결과:
- 환경(브라우저/OS):
- 로그/스크린샷 경로:
