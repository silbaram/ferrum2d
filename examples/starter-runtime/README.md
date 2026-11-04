# Ferrum2D Engine Playground

엔진 기능을 직접 바꾸며 체험하는 작은 발전소 게임이다. `pnpm dev:starter-runtime`으로 실행하고 터미널의 로컬 주소를 연다. 로봇으로 전지 3개를 모은 뒤에도 실험을 계속할 수 있다.

| 체험 | 조작 / 엔진 동작 |
| --- | --- |
| 이동·장애물·수집 | 바닥 클릭, WASD/방향키, 전지 목적지 버튼. Rust 경로 탐색과 이동 애니메이션, trigger 기반 수집 변수 |
| 물리 | 공 던지기, 고무/점토 재질 전환. 고정 시간 간격 rigid body·CCD·반사·감속 |
| 조명 | 포인터로 작업등 이동, 원본 색상/조명 전환, 스프라이트 노멀맵 비교 |
| 카메라 | 전체 보기, 로봇 추적, 공 실험장 보기, 확대/축소 |
| 화면 효과 | 기본, bloom/vignette, CRT 비교 |
| 씬 수명 | 일시정지·계속하기·다시 시작. 화면 설정은 유지하고 게임 진행을 초기화 |
| 렌더러 | WebGL2 또는 WebGPU 선택. 미지원 환경은 WebGL2 fallback |
| 9-slice | 실험장과 수조 패널의 테두리를 유지하며 크기를 늘리는 실제 runtime 렌더링 |

씬은 [public/playground/scene.json](public/playground/scene.json), 결정론적 원본 에셋 생성기는 [build-engine-playground.mjs](../../scripts/assets/build-engine-playground.mjs)다. `node scripts/assets/build-engine-playground.mjs`로 에셋을 재생성한다. 바닥은 타일 모양의 sprite instance이며 별도 TileMap API 예제는 아니다. TS는 입력/UI와 화면 설정을, Rust는 이동·수집·물리를 소유한다.

기존 사격 프로필·snapshot/replay 예제는 **`?mode=starter`** 또는 ‘더 살펴보기’ 링크로 연다. 기존 `profile`, `reportSmoke`, `profilerSmoke` query도 그대로 지원한다. 아래 기술/콘솔 API 설명은 이 기존 모드에 해당한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Runtime bootstrap | canvas, renderer, input, audio host, frame loop를 `createFerrumRuntime(...)`로 생성한다. |
| Demo shell | `examples/shared`의 공통 shell로 canvas, controls, metric panel, smoke hook을 재사용한다. |
| Render command buffer | Rust가 만든 sprite command를 WebGL2 renderer가 소비한다. |
| UiOverlay | runtime frame state를 HUD/dialog로 표시한다. |
| Runtime profile panel | 캔버스 아래에서 `standard`, `piercing`, `bounce` weapon profile을 전환하고 현재 projectile 설정, visual, 적용 상태, report capture count를 보여준다. |
| DebugOverlay | development 환경에서 frame/render/physics metric을 표시한다. |
| Runtime profiler | `?profilerSmoke=true`로 browser budget smoke sample을 수집한다. |
| Snapshot/replay report | `captureGameStateSnapshot(...)`, `createGameplayReplayRun(...)`으로 현재 runtime 상태를 검증 가능한 report로 노출한다. |
| Weapon profile authoring | `projectile(...)`, `weapon(...)`, `compileWeaponProfiles(...)`로 빌트인 player 사격 profile을 낮은 빈도 경로에서 적용한다. |

## 실행

```bash
pnpm dev:starter-runtime
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/starter-runtime dev
```

DebugOverlay를 켜려면 `?debug=true`를 사용한다.
브라우저 콘솔이나 smoke harness에서는 `window.ferrumStarterRuntimeCaptureReport()`로 현재 frame의 snapshot/replay report를 다시 만들 수 있다.
`window.ferrumStarterRuntimeApplyWeaponProfile("bounce")`로 현재 runtime에서 profile을 바꿀 수 있다.
`window.ferrumStarterRuntimeWeaponProfile`에서 현재 적용된 사격 프로필을 확인할 수 있다.
패널 버튼을 누르면 `Status`, `Profile`, `Shot`, `Rate`, `Size`, `Tile`, `Visual`, `Replay`, `Reports` 값이 즉시 갱신된다. `Capture Report`는 현재 runtime snapshot/replay report를 다시 캡처해 replay hash와 report counter를 갱신하는 QA/디버그 버튼이며, weapon profile이나 게임플레이를 새로 적용하는 버튼은 아니다.

### 사격 프로필

초기 profile은 `?profile=standard|piercing|bounce` query로 지정할 수 있고, 실행 중에는 캔버스 아래 Weapon Profile 패널에서 전환한다. 모든 profile은 같은 primary action id에 설치되므로 input binding은 `Space`/마우스 왼쪽 버튼 하나만 유지한다. profile별 새 발사체는 서로 다른 texture id와 bullet prefab size를 사용해 색, 형태, 크기가 구분된다. 기본 starter 장면은 적과 타일 fixture가 없어서 관통/바운스 충돌 차이는 report에서 더 분명하고, 실제 탄 동작 차이는 충돌 대상이 있는 장면에서 더 크게 보인다.

- `standard`(기본): 작은 `6x6` green pellet이 빠르게 연사된다.
- `piercing`: 긴 `20x5` cyan spear가 중간 속도로 나가며 `passThrough` tile impact를 가진다.
- `bounce`: 큰 `18x18` amber orb가 느리게 나가며 `bounce` tile impact와 높은 피해량을 가진다.

## 검증

```bash
pnpm --filter @ferrum2d/starter-runtime lint
pnpm --filter @ferrum2d/starter-runtime build
pnpm smoke:engine-playground
pnpm smoke:starter-runtime
pnpm smoke:starter-runtime-budget
```

`pnpm smoke:engine-playground`는 새 기본 화면을 중첩 URL 경로에서 열어 실제 이동·수집·공 반사/감속·일시정지·초기화·광원/노멀/후처리 pixel 변화·카메라·390px 화면·GPU 자원 해제를 검증한다. WebGPU 검증은 Chromium 소프트웨어 offscreen target이며 하드웨어 성능/네이티브 표시 검증은 아니다.

`pnpm smoke:starter-runtime`은 `?mode=starter`에서 WebGL2 placeholder pixel readback, profile panel 렌더링, 실제 DOM profile/capture 버튼 클릭, profile별 projectile visual texture, snapshot/replay report hook을 함께 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/starter-runtime/`에 복사하고 Pages 홈의 Demos 목록에 노출한다.

## 참고 문서

- [Runtime extensibility](../../docs/engine/runtime-extensibility.md)
- [Public API](../../docs/engine/public-api.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- texture/sound/JSON asset이 필요하면 `examples/topdown-shooter`의 manifest 흐름을 따른다.
- lighting, material, post-process, particle VFX를 확인하려면 `examples/minimal-game`의 `visual-runtime-lab` profile을 참고한다.
- 새 Physics Spec fixture를 확인하려면 `examples/physics-sandbox`를 사용한다.
