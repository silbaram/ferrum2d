# Ferrum2D 엔진 기능 실험실

기본 진입은 기능별 독립 실험이다. `pnpm dev:starter-runtime`으로 실행하고 터미널 주소를 연다.
상단에서 애니메이션·길 찾기·물리·조명·후처리·카메라·9-slice·타일맵·레이어·파티클·공간 오디오·입력·씬 전환·상호작용·저장·대화·HUD를 하나씩 선택한다.
각 화면은 조작, 관찰할 결과, 현재 엔진 수치와 구현 API를 함께 표시한다.

[전체 기능과 실행 위치](../README.md)의 `?feature=<id>`로 바로 열 수 있다.
씬 파일은 [public/features](public/features/), 공통 화면은 [src/featureLab.ts](src/featureLab.ts), 타일·효과·입력 조작은 [src/featureExtras.ts](src/featureExtras.ts),
게임 구성 예제는 [src/featureGameplay.ts](src/featureGameplay.ts)와 [src/featureContent.ts](src/featureContent.ts),
기능 목록은 [featureCatalog.json](../shared/featureCatalog.json)에 있다.
`node scripts/assets/build-feature-examples.mjs`는 17개 실험 JSON과 직접 합성한 공간 오디오용 `beacon.wav`를 재생성한다.
텍스처는 기존 자체 제작 `public/playground/` 에셋을 재사용한다.

`실험 초기화`는 설정·씬·일시정지를 기본값으로 돌린다. 렌더러 선택과 주제 이동은 페이지를 다시 연다.
WebGL2 기본 / WebGPU 선택과 fallback을 표시한다. 화면의 수치는 실제 native 상태와 renderer stats다.
타일맵/입력 실험은 기존 Shooter 타일맵·플레이어 컨트롤러를 사용한다. 사격은 차단하고 적 생성 간격은 24시간으로 설정해 실험을 분리했다. 다른 Data Scene 실험의 바닥은 sprite instance다.

## 타일·효과·입력 실험

- **타일맵**: `?feature=tilemap`. WASD/방향키로 중앙 벽에 접근한 뒤 통로를 열어 통과한다. 캔버스 클릭으로 벽/바닥을 수정한다. 외곽 테두리와 캐릭터가 겹치는 칸은 보호한다. 통로 닫기는 캐릭터를 밖으로 옮긴 뒤 사용한다. 출발 위치에 벽을 놓았다면 바닥 브러시로 지워야 그 위치로 돌아갈 수 있다.
- **레이어**: `?feature=layers`. 로봇의 `instance.layer`를 바꿔 동일 위치·크기의 겹침을 비교한다. 씬을 재적용하는 낮은 빈도 예제이며 충돌 분류인 `components.layer`는 바꾸지 않는다.
- **파티클**: `?feature=particles`. 효과/수량/수명/속도를 정하고 방출한다. 설정 변경은 입자를 비우며, 반복/잔상은 다시 방출해야 한다. 방출 정지는 기존 입자를 수명 종료까지 유지한다. 잔상 위치는 포인터, 입자 이동·수명은 Rust가 계산한다.
- **공간 오디오**: `?feature=audio`. 사용자 클릭으로 Web Audio를 시작하고 음원의 좌우·앞쪽 거리·볼륨을 바꾼다. 듣는 위치는 로봇에 고정된다. 일시정지/초기화/페이지 이탈은 소리도 멈추고 재생은 다시 눌러 시작한다. 공간 처리 미지원이면 일반 재생 안내를 표시한다.
- **입력 전환**: `?feature=input`. 키보드/게임패드 왼쪽 스틱/화면의 가상 조이스틱을 같은 native 이동에 연결한다. 메뉴는 모달이고 입력란의 키가 게임에 전달되지 않는다. 닫은 뒤 키를 다시 누르거나 스틱을 중립으로 돌린 뒤 이동한다. 게임패드 연결을 브라우저가 인식하려면 장치 버튼을 한 번 눌러야 할 수 있다.

## 게임 구성 실험

- **씬 전환·페이드**: `?feature=scenes`. 카운터를 올리고 A/B 공간을 왕복한다. `transition`은 씬 카운터를 초기화하고 전역 카운터를 유지한다. 암전 중 재입력은 무시하고, 일시정지·초기화는 전환에도 적용한다.
- **상호작용·트리거**: `?feature=interaction`. 이동 후 64 단위 안에서 Space 또는 상호작용 버튼을 누른다. 스위치는 한 번 작동하고 문 사용 조건을 해제한다. 아래 패널 구역의 진입/이탈은 실제 native collision event다. 문은 조건부 상호작용 표식이며 물리 벽 개폐는 타일맵 예제에 있다.
- **저장·불러오기**: `?feature=save-load`. 에너지를 수집하고 저장한 뒤 초기화/새로고침 후 불러온다. 위치·변수·수집으로 사라진 아이템을 함께 복원한다. 일반 2D 좌표는 snapshot의 custom state에 기록하고, 수집 진행은 Data Scene progress로 저장한다. 슬롯은 `ferrum2d.feature-lab.save-load.v1`이며 다른 저장 키는 건드리지 않는다. 브라우저·사이트 주소별 로컬 저장으로 서버/클라우드 저장이 아니다. 손상 데이터·다른 씬뿐 아니라 진행/변수 누락, 캐릭터 제거·비활성화, 수집 수와 아이템 상태 불일치도 씬 변경 전에 거절한다. 저장소 접근 실패는 화면에 안내하며 기존 저장을 유지한다. 일시정지 중 저장 작업은 차단하고 실험 초기화는 슬롯을 유지한다.
- **대화·퀘스트**: `?feature=dialogue`. 캔버스 아래 실제 `UiOverlay`에서 부탁을 거절/수락하고 소포를 챙겨 전달한다. 조건 플래그가 전달 선택지를 열고 `QuestLog`에 목표/완료를 기록한다. Tab/Enter 선택, 화면 갱신 후 포커스 유지와 초기화를 지원한다. 이 예제의 대화 진행은 새로고침하면 초기화된다.
- **HUD·다국어·접근성**: `?feature=hud`. native 체력 변수에 피해/회복을 적용하고 HUD만 한영·14/18/22px·고대비로 바꾼다. 체력은 0~100이며 progressbar의 접근성 값과 이름도 함께 갱신한다. 실험실 전체의 언어 전환 기능은 아니다.

## 이전 통합 게임 (`?mode=playground`)

여러 기능을 연결한 작은 발전소 게임은 `?mode=playground` 또는 ‘통합 예제도 보기’로 연다. 로봇으로 전지 3개를 모은 뒤에도 실험을 계속할 수 있다.

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
pnpm smoke:feature-examples
pnpm smoke:engine-playground
pnpm smoke:starter-runtime
pnpm smoke:starter-runtime-budget
```

`pnpm smoke:feature-examples`는 기능 17종 × 렌더러 2종에서 실제 native 상태·GPU pixel 변화, 타일 충돌, 입자 수명, Web Audio 좌우 출력·감쇠, 메뉴 입력 차단, 씬 변수 수명/페이드, 거리·조건부 상호작용, 저장 후 새로고침 복원/손상 거절, 대화·퀘스트 조건/키보드 포커스, HUD locale/접근성 값, 초기화, pause, 390px 화면, 중첩 경로, 자원 해제를 확인한다. 게임패드는 하드웨어 polling만 모사하며 실물 장치/스피커 청취를 검증한 것은 아니다.
추가로 초기 씬/텍스처 로딩 중 페이지 이탈과 로드 실패 시 GPU 자원 해제, DPR 2·390px 화면에서 터치 타일 편집과 조이스틱 이동을 검사한다. 터치는 브라우저에서 모사한다. 레이어·조명·후처리·오디오 비교 씬의 로봇은 고정 프레임으로 표시해 무관한 애니메이션 변화가 결과에 섞이지 않게 한다.

`pnpm smoke:engine-playground`는 통합 게임 `?mode=playground`를 중첩 URL 경로에서 열어 실제 이동·수집·공 반사/감속·일시정지·초기화·광원/노멀/후처리 pixel 변화·카메라·390px 화면·GPU 자원 해제를 검증한다. WebGPU 검증은 Chromium 소프트웨어 offscreen target이며 하드웨어 성능/네이티브 표시 검증은 아니다.

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
