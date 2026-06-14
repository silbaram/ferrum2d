# Top-down Shooter Manual Smoke Checklist

이 문서는 Ferrum2D Top-down Shooter 예제(`examples/topdown-shooter`)를 브라우저에서 수동 점검할 때 사용하는 기준 체크리스트다. 자동/CI 검증과의 관계는 [Smoke Check](smoke-check.md)를 따른다.

## 목적

- WebGL2 실제 렌더링, 입력, 오디오, DebugOverlay를 자동 테스트 바깥에서 빠르게 검증한다.
- 릴리스 전/후 회귀(regression)를 같은 기준으로 비교한다.

## 사전 준비

1. 의존성 설치 또는 확인

```bash
pnpm install
```

2. 자동 sanity check

```bash
pnpm smoke:check
pnpm smoke:topdown
```

3. Wasm 빌드

```bash
pnpm build:wasm
```

4. 예제 실행

```bash
pnpm --filter @ferrum2d/topdown-shooter dev
```

## 체크리스트 (제품 회귀 범위)

### A. 부팅/화면 진입

- [ ] 브라우저에서 Vite URL 진입 시 캔버스가 깨지지 않고 표시된다.
- [ ] Title 화면이 표시되고 canvas가 비어 있지 않다.
- [ ] 기본 URL에서 DebugOverlay가 게임 화면을 가리지 않는다.
- [ ] `?debug=true`로 접속하면 DebugOverlay가 표시되고 canvas와 겹치지 않은 상태로 값이 갱신된다.
- [ ] DebugOverlay에 `fps`, `frame time`, `rust update`, `render`, `entities`, `sprites`, `draw calls`, `batches`, `render commands`, `texture binds`, `texture switches`, `audio events`, `fixed steps`, `kinematic hits`, `tile checks`, `collision events`, `physics debug lines`, `mouse`, `camera`, `state`, `score` label이 표시된다.
- [ ] `?physicsDebugLines=true`로 접속하면 collider broadphase bounds와 overlap contact normal line이 sprite 위에 표시된다.

### B. 입력/플레이 전환

- [ ] `Enter` 또는 `Space`로 Title → Playing 전환이 된다.
- [ ] `W/A/S/D`로 플레이어 이동이 된다.
- [ ] 이동 중 플레이어가 `game.json`의 `prefabs.player.animation.atlas` frame sequence에 따라 애니메이션된다.
- [ ] camera 좌표가 `look-ahead` preset에 따라 이동 방향 앞쪽으로 변한다.
- [ ] 마우스 위치를 기준으로 발사 방향이 바뀐다.

### C. 전투/점수

- [ ] 마우스 좌클릭 또는 `Space` 시 총알이 발사된다.
- [ ] `game.json`의 `atlas.frames["bullet.default"]` 설정이 적용되어 bullet이 atlas frame size/UV로 렌더링된다.
- [ ] 적이 `game.json`의 wave 설정에 따라 runner/bruiser/orbiter 순서로 spawn되고 각 behavior에 맞게 이동한다.
- [ ] 총알-적 충돌 시 particle hit burst가 보인다.
- [ ] 체력이 남는 적은 짧게 밝아졌다가 원래 tint로 돌아온다.
- [ ] 총알-적 충돌 시 적이 제거되고 score가 증가한다.

### D. 게임오버/재시작

- [ ] 플레이어-적 충돌 시 game over 상태로 전환된다.
- [ ] game over 직후 재시작 안내가 표시된다.
- [ ] `Space`로 재시작하면 score와 상태가 초기화된다.

### E. 오디오/에셋

- [ ] 첫 key/pointer 입력 이후 발사/피격/game over 효과음이 정상 재생된다.
- [ ] `audio.events.*`의 volume/pitch 설정이 과도하게 크거나 낮게 들리지 않는다.
- [ ] 텍스처 누락(핑크/검은 사각형 등) 없이 스프라이트가 표시된다.
- [ ] `game.json`의 정적 tilemap 배경이 표시된다.
- [ ] `game.json`의 `collision: true` tile을 player/enemy가 통과하지 못한다.
- [ ] chase enemy가 `collision: true` tile 장애물 주변으로 우회해 player를 추적한다.
- [ ] orbit enemy wave에서 적이 `enemies.orbit.radius` 근처로 player 주변을 접선 방향으로 돌며 접근/이탈 보정을 한다.

### F. DebugOverlay/렌더러 지표

- [ ] FPS, frame time, Rust update time, render time이 숫자로 갱신된다.
- [ ] entity/sprite count가 플레이 상태 변화(스폰/제거)에 맞게 변한다.
- [ ] render command 수, texture bind/switch 추정치, audio events/sec가 비정상적으로 고정되지 않는다.
- [ ] 새로고침 후 console에 bootstrap, asset, WebGL, audio, cleanup 관련 오류가 없다.

## 캡처/증적 저장

- Title + DebugOverlay 화면을 `docs/development/quality/screenshots/topdown-shooter-title.png`로 갱신한다.
- 필요 시 `topdown-shooter-gameover.png`, `topdown-shooter-score.png`를 추가한다.
- 캡처 규칙은 `docs/development/quality/screenshots/README.md`를 따른다.

## 실패 기록 템플릿

문제가 있으면 아래 형식으로 기록한다.

- 증상:
- 재현 절차:
- 기대 결과:
- 실제 결과:
- 환경(브라우저/OS):
- 로그/스크린샷 경로:
