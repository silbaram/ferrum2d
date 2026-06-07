# Ferrum2D Starter Runtime

`createFerrumRuntime(...)`로 Ferrum2D 브라우저 runtime을 시작하는 starter 예제다. 별도 texture, sound, Game Spec 없이 기본 Rust engine state와 placeholder texture만 사용하되, 첫 화면에서 runtime profile 전환과 snapshot/replay report를 확인할 수 있다.

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
pnpm smoke:starter-runtime
pnpm smoke:starter-runtime-budget
```

`pnpm smoke:starter-runtime`은 WebGL2 placeholder pixel readback, profile panel 렌더링, 실제 DOM profile/capture 버튼 클릭, profile별 projectile visual texture, snapshot/replay report hook을 함께 확인한다.

## 다음 단계

- texture/sound/JSON asset이 필요하면 `examples/topdown-shooter`의 manifest 흐름을 따른다.
- lighting, material, post-process, particle VFX를 확인하려면 현재 `examples/minimal-game`의 visual smoke mode를 참고한다.
- 새 Physics Spec fixture를 확인하려면 `examples/physics-sandbox`를 사용한다.
