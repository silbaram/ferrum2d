# Ferrum2D Top-down Shooter

Ferrum2D의 대표 Game Spec 기반 예제다. `public/game.json`으로 atlas animation, tilemap collision, wave, audio, camera, authored gameplay behavior를 구성하고, Rust core의 built-in Shooter scene을 browser runtime에서 검증한다.

현재 기본 화면은 **Neon Outpost**다. 청록색 수비대, 붉은 드론, 금속 바닥·환기구·엄폐물,
에너지 탄환을 재현 가능한 pixel atlas로 표시한다. `src/showcase.ts`는 DOM/HUD와 조작을,
`src/presentation.ts`는 화면 조명을 담당한다. 이동·충돌·발사·웨이브·점수·게임 종료는 기존 Rust core가 처리한다.

## 플레이와 화면 설정

- **출격하기 / Enter / Space**: 시작. **WASD** 이동, **마우스** 조준, **클릭 / Space** 발사.
- **일시정지 / P / Esc**: 멈추거나 같은 상태에서 계속한다. 다른 탭으로 이동하면 자동 일시정지한다.
- **처음부터 다시 시작 / 다시 출격**: native 시작 체크포인트를 복원하고 점수·웨이브를 초기화한다. 일시정지와 게임 종료 상태에서도 사용할 수 있다.
- **HUD**: native 점수와 현재 추적·중장갑·선회 웨이브, 출현 수, 경과 시간을 표시한다. 웨이브는 정해진 시간 또는 출현 수에 도달하면 넘어가며 세 번째 뒤에는 첫 번째로 순환한다. 승리/클리어 판정은 없다.
- **화면과 소리**: 아레나 점광원, bloom·vignette, 피격 흔들림 줄이기, 음소거를 바꾼다. 동작 감소는 OS 설정을 초기값으로 사용한다. 일시정지 중 시각 설정은 계속하기 후 렌더링에 반영된다.
- **작은 화면**: 게임 비율을 유지하고 설명·설정을 아래로 배치한다. 플레이 중 가상 조이스틱으로 이동하고 화면을 터치해 조준, 발사 버튼으로 사격할 수 있다.
- **이 예제의 엔진 기능**: 오른쪽 펼침 영역에서 관찰 항목과 충돌 영역 표시 링크를 확인한다. 충돌 표시 링크는 query를 바꾸고 씬을 다시 시작한다.

HUD는 250ms 간격으로 owned native snapshot을 읽고 named accessor를 재사용한다. TypeScript에서 웨이브 타이머나 엔티티 이동을 별도로 계산하지 않는다.
화면 설정은 저장되지 않으며 새로 열면 기본값으로 돌아간다. 이 UI는 Behavior Recipe/FSM 편집 또는 variant 선택 도구가 아니다.
한글 UI는 기존 Noto Sans KR subset을 재사용하며 OFL 고지를 `public/fonts/`에 포함한다.

## 도트 에셋 재생성

`public/assets/outpost/`의 PNG 네 개는 저장소가 직접 생성한 예제 에셋이다. 외부 아트나 새 패키지 의존성을 사용하지 않는다.

```bash
python3 scripts/assets/build-topdown-outpost.py
python3 scripts/assets/build-topdown-outpost.py --check
```

`operator.png`는 4열 × 2행의 idle/move sheet, `sentinel.png`는 드론, `pulse.png`는 탄환,
`arena.png`는 floor/panel/accent/block 네 프레임이다. manifest의 `player`·`enemy`·`bullet`·`arena` 이름과
`game.json`의 UV/texture 참조가 연결된다. 기존 `assets/player.png` 등은 다른 smoke fixture에서 사용하므로 유지한다.

## 확인 기술

| 기술 | 설명 |
| --- | --- |
| Game Spec runtime | `examples/topdown-shooter/public/game.json`을 읽어 Shooter config, texture/audio id, wave, tilemap, animation을 적용한다. |
| WebGL2 renderer | Rust render command buffer를 WebGL2 sprite renderer가 소비한다. |
| Shooter gameplay | player movement, projectile, enemy waves, score, GameOver, audio event를 검증한다. |
| Authored behavior variant | `public/authored-behavior.variant.json`으로 SceneComposition, Behavior Recipe, FSM, gameplay actions를 낮은 빈도 경계에서 적용한다. |
| Snapshot/replay | built-in Shooter snapshot, save/load, deterministic gameplay replay hash를 검증한다. |
| Runtime budget | Top-down effects, mass object, HD2D/destructible terrain smoke로 browser/runtime budget을 확인한다. |

## 실행

```bash
pnpm dev:topdown
```

직접 package만 실행하려면 다음 명령을 사용한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

## 검증

```bash
pnpm --filter @ferrum2d/topdown-shooter build
pnpm validate:game-spec
pnpm validate:topdown-authored-behavior-variant
pnpm smoke:headless
pnpm smoke:topdown # 출격·정지·재시작·native HUD·화면 설정·모바일 이동
pnpm smoke:topdown-save-load
pnpm smoke:gameplay-replay
pnpm smoke:topdown-authored-behavior-runtime
pnpm smoke:topdown-mass-objects
```

변경 범위가 renderer/runtime budget이면 `pnpm smoke:topdown-budget`, HD2D면 `pnpm smoke:topdown-hd2d`, destructible terrain이면 `pnpm smoke:destructible-terrain-browser`도 함께 확인한다.

## Pages 노출

`pnpm build:pages`는 production build를 `dist-pages/topdown-shooter/`에 복사하고 Pages 홈의 primary demo link로 노출한다.

## Runtime Extensibility 노출 범위

Top-down Shooter의 public demo surface는 기본 `game.json` 기반 Shooter runtime이다. Runtime extensibility showcase는 기본 화면에 별도 profile selector를 추가하지 않고, 다음 두 경계로 제한한다.

| 경계 | 노출 방식 | 용도 |
| --- | --- | --- |
| Variant summary | production build가 `authored-behavior.variant.json`을 preload/load하고 `window.ferrumTopdownAuthoredBehaviorVariant` summary를 만든다. | agent/smoke가 variant와 replay 계약을 확인한다. |
| Variant apply toggle | `?authoredBehaviorVariantApply=true`가 있을 때만 scene load 이후 낮은 빈도 경로에서 variant instance와 behavior/FSM command를 Rust component storage에 적용한다. | browser smoke와 manual QA가 authored gameplay 흐름을 실제 runtime에서 확인한다. |
| Window-only helpers | `ferrumTopdownAuthoredBehaviorStart()`, `ferrumTopdownAuthoredBehaviorApplyCurrentStateCommands()`, `ferrumTopdownAuthoredBehaviorResetAndReapply()`를 smoke 전용 helper로 노출한다. | state command apply, reset/reapply, stale handle 회귀를 검증한다. |

현재 노출 범위에는 frame hot path callback, visual editor, state-entry 자동 apply runtime, 사용자용 in-app profile switcher를 포함하지 않는다. 이 범위를 넓힐 때는 public API 계약, `pnpm smoke:topdown-authored-behavior-runtime`, replay fixture/hash 영향을 함께 갱신한다.

## 참고 문서

- [Top-down Shooter Game Spec](../../docs/examples/topdown-shooter/game-spec.md)
- [Public API](../../docs/engine/public-api.md)
- [Top-down Shooter smoke checklist](SMOKE_CHECKLIST.md)
- [Smoke Check](../../docs/development/quality/smoke-check.md)
- [GitHub Pages 배포](../../docs/development/operations/demo-deploy.md)

## 다음 단계

- Game Spec field를 바꾸면 schema, `docs/examples/topdown-shooter/game-spec.md`, validation, smoke를 함께 갱신한다.
- Runtime extensibility profile 노출을 늘릴 때는 public API와 agent smoke가 검증할 수 있는 낮은 빈도 authoring 경계로 유지하고, 기본 demo UI와 smoke-only helper를 섞지 않는다.
