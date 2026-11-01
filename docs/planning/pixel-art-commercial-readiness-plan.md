# 도트 게임 상용 수준 개선 계획

기준일: 2026-11-01
상태: 개발 계획 후보·미착수. 항목별로 착수 승인과 열린 설계 결정을 확정한 뒤 단계적으로 진행한다.
순서와 우선순위는 구현 승인이나 완료를 뜻하지 않는다.

2026-11-01 도트 기능 분석에서 확인한 상용 수준 격차를 다음 개선 작업으로 정리한 문서다.
현재 지원 범위와 저장·복구 계약은 [Scene Authoring](../engine/data-scene-authoring.md#에디터-내장-도트-제작),
공간 pixelArt 계약은 [공간 계약](../engine/data-scene-spatial.md), 검증 명령은
[Smoke Check](../development/quality/smoke-check.md)를 따른다. 이 문서는 아직 없는 기능과 남은 격차만 관리한다.

## 현재 평가 요약

| 영역 | 수준 | 격차의 핵심 |
| --- | --- | --- |
| 내장 도트 편집기의 엔지니어링 품질 | 높음 | 문서 검증·트랜잭션 Undo·복구·해시 저장·단위 테스트는 상용급이다. |
| 내장 도트 편집기의 기능 폭 | 보통 이하 | 규모 한도(한 변 256·프레임 16·레이어 8)와 표현 도구(디더·그라데이션·블렌드)가 좁다. |
| Aseprite·Tiled 임포트 | 제한적 | `.ase` 바이너리·trim/rotate·슬라이스·오토타일·타일 애니메이션이 없다. |
| 런타임 렌더링 | 혼합 | NEAREST 고정·인스턴싱·노멀맵 조명은 강점이지만 평면 2D의 픽셀 퍼펙트가 없다. |
| 런타임 애니메이션 | 미흡 | 클립당 균일 fps·32프레임 한도이며 핑퐁·프레임별 시간·이벤트가 없다. |
| 도트 전용 효과 | 미흡 | 팔레트 스왑·디더·포스터라이즈가 없고 WebGPU 후처리는 fade뿐이다. |
| 제품 성숙도 | 낮음 | 도트 기능이 CHANGELOG·릴리스에 없고 예제 아트는 플레이스홀더 3장이다. |

가장 큰 격차는 **평면 2D 런타임의 픽셀 퍼펙트**(PX-01~03)다. 내장 편집기는 Aseprite 대체가 목표가 아니므로
편집 기능 확장보다 외부 산출물을 안전하게 들여오는 임포트와 런타임 정합이 우선이다.

## 범위와 경계

- Rust core는 게임 상태와 render command 생성을, TypeScript는 canvas·WebGL2/WebGPU·입력·에셋 로딩을 소유한다.
  스냅·스케일이 시뮬레이션 상태를 바꾸지 않는 render-only 변환이어야 한다(`Camera2D.ground_y_scale` 선례).
- Rust/Wasm 경계에서 entity별 호출을 만들지 않는다. 이벤트·텔레메트리는 bulk buffer로 교환한다.
- render command ABI(`#[repr(C)]`, 현재 15 float)와 WebGPU의 WebGL2 fallback 유지가 기본 제약이다.
  ABI를 바꿔야 하면 해당 항목에서 근거를 제시하고 `buffer_layout`·문서·`wasm-pack build`를 함께 갱신한다.
- 새 프로덕션 의존성은 필요성과 대안을 설명한 뒤에만 추가한다.
- visual editor·타임라인 편집·스켈레탈 애니메이션·Behavior Recipe 편집으로 확대하지 않는다.
- 이미 등록된 후보는 다시 올리지 않고 링크한다.
  - [추가 도트 변형](game-development-convenience-review.md#도트-제작-후보): 임의 각도/확대, indexed source, 레이어 blend/opacity, OS 클립보드, 차분 Undo
  - [AI 도트 생성](game-development-convenience-review.md#도트-제작-후보)
  - [외부 맵 확대](game-development-convenience-review.md#asset-반복-작업): flip·animation·TSX·외부 level·IntGrid 어댑터

## 근거 수준 (착수 전 재확인)

- 직접 확인: 도트 단위 테스트 165개 통과, 편집기 코어(`placementPixelDocument.ts` 등) 읽기, 기능 부재 grep,
  평면 2D 정수 배율·스냅 부재, 스프라이트 텍스처 NEAREST 고정(`textureManager.ts`), `Camera2D`의 필드.
- 정적 코드 리딩만 한 항목: 런타임 세부(셰이더 UV, SpritePlayback, 파티클·shake, 후처리), Tiled/LDtk/패커/Tauri 호스트 세부.
  각 항목 착수 시 대상 코드를 다시 읽고 이 문서의 한계 설명을 먼저 정정한다.
- 실행하지 않음: 브라우저 smoke(`smoke:pixel-authoring` 등), Rust 테스트, 실제 렌더 육안 확인.
- 미확인: 타일 API가 `set_shooter_tilemap_*` 이름이며 Data 씬 모드에서 조기 반환한다. Data Scene에 별도 타일 경로가 있는지는 확인하지 못했다.
- 줄 번호는 코드 이동으로 어긋나므로 적지 않았다. 파일명과 심볼을 기준으로 찾는다.

## P0 — 평면 2D 픽셀 퍼펙트 런타임

### PX-01 가상 해상도와 정수 배율

- 사용자 가치: 해상도·DPR·창 크기와 무관하게 도트가 균일한 크기로 보인다. Unity Pixel Perfect Camera, Godot 정수 스케일, Phaser `pixelArt`에 해당하는 기본 기능이다.
- 현재 한계: `environment.pixelArt`(`width`/`height`/`snapCamera`)는 HD-2D 공간 경로(`spatialEnvironment.ts`, `spatial_scene.rs`의 `presented_camera`)에서만 동작한다.
  평면 2D는 canvas 크기가 CSS 크기×`devicePixelRatio`이고 줌이 임의 float(0.0001~10000)이며 fit·letterbox가 없다.
- 열린 설계 결정:
  - 옵션 위치: 런타임 renderer 옵션, Data Scene environment, 또는 기존 spatial `pixelArt` 계약의 확장.
  - 기존 spatial 구현과 계약·검증을 공유할지 별도 평면 경로를 둘지.
  - 소수 DPR·소수 줌에서의 정책(내림 정수 배율, 1 미만일 때 fallback)과 letterbox 색.
  - 포인터 좌표→월드 변환, `renderToTexture`, 후처리, 조명 패스와 해상도 관계. Placement Viewer의 Game Preview와 결과가 같아야 한다.
- 완료 조건:
  - opt-in이며 끄면 기존 게임의 출력이 바뀌지 않는다.
  - 정수 배율·여백·포인터 정확도를 DPR 1/1.5/2와 리사이즈에서 browser smoke로 검증한다.
  - WebGL2/WebGPU가 같은 결과이고 기존 `smoke:color-management`·`smoke:sprite-normal-2d`·`smoke:runtime-budgets`를 통과한다.
  - 내부 target 메모리 비용을 측정해 기록하고 Core API·Scene Authoring·Smoke Check 문서를 갱신한다.

### PX-02 카메라와 스프라이트 픽셀 스냅

- 사용자 가치: 카메라가 서브픽셀로 움직여도 도트가 흔들리지(shimmer) 않는다.
- 현재 한계: `Camera2D`는 x, y, viewport만 가지며 스냅이 없다. 스프라이트 위치는 float 그대로 셰이더에 전달된다.
  파티클과 camera shake도 스냅하지 않아 서브픽셀로 번진다.
- 열린 설계 결정:
  - 스냅 위치: Rust의 render-only 변환 또는 TypeScript 셰이더/투영.
  - 스냅 단위는 PX-01의 가상 픽셀이다.
  - 회전 스프라이트·bitmap text·파티클·shake의 정책(스냅 제외 또는 포함 선택).
- 완료 조건:
  - 시뮬레이션 상태와 replay golden이 바뀌지 않는다(render-only).
  - 서브픽셀 카메라 이동 fixture에서 정지한 스프라이트의 프레임 간 픽셀 변화가 없음을 측정한다.
  - 스냅 off 기본값 회귀가 없다.

### PX-03 아틀라스 가장자리 번짐 방지

- 사용자 가치: 회전·소수 스케일·소수 위치에서도 이웃 프레임 픽셀이 섞이지 않는다.
- 현재 한계: 스프라이트 셰이더가 half-texel inset 없이 UV를 보간하고, 패커는 투명 padding 2px만 두며 extrusion이 없다.
  KTX2 압축은 도트 PNG에 부적합하다(손실·4의 배수 제약).
- 열린 설계 결정:
  - 패커 extrusion 옵션(`pack-textures.mjs`, `textureAtlas.ts`)과 렌더러 inset 중 선택 또는 병행.
  - 기존 아틀라스·manifest 호환과 노멀 pair의 UV 일치.
- 완료 조건:
  - 회전·소수 스케일 fixture에서 번짐 픽셀 수를 측정해 개선을 확인한다.
  - 기존 UV 계약과 아트가 바뀌지 않는다.
  - 도트 PNG에 KTX2를 권장하지 않는다는 안내를 문서에 둔다.

## P1 — 애니메이션과 편집 규모

### PX-04 런타임 클립 확장

- 사용자 가치: Aseprite 애니메이션이 변환 손실 없이 재생되고 걷기·공격 사이클처럼 긴 시트를 쓸 수 있다.
- 현재 한계: `SpritePlayback`은 클립당 균일 `fps`와 `looping`뿐이다. 핑퐁·프레임별 시간·이벤트·완료 콜백이 없고 클립당 32프레임·entity당 64클립 한도가 있다.
  Aseprite 임포트는 reverse/pingpong/프레임별 시간을 GCD tick으로 펼쳐 32를 넘으면 거절한다.
  `animationTimeline.ts`는 네이티브 재생 경로가 아닌 별도 TS 상태 머신이다.
- 열린 설계 결정:
  - GCD 확장을 유지할지 프레임별 duration·방향을 네이티브로 옮길지.
  - 프레임·완료 이벤트는 hot path 왕복 없이 bulk event buffer로 전달.
  - 한도 상향이 command·메모리·ABI·Data Scene schema 버전과 마이그레이션에 미치는 영향.
- 완료 조건:
  - 90/180ms 같은 비균일 타이밍과 핑퐁이 확장 없이 보존된다.
  - 8방향×다프레임 시트 fixture를 재생한다.
  - 기존 replay golden이 바뀌지 않고 `validate:data-scene-authoring`·Rust 테스트·`wasm-pack build`를 통과한다.
  - schema 문서와 호환 노트를 동기화한다.

### PX-05 내장 도트 편집기 규모 한도 재검토

- 사용자 가치: 실제 게임 시트(예: 32×32 다방향 사이클)를 편집기 안에서 다룰 수 있다.
- 현재 한계: `PIXEL_LIMITS`가 한 변 256·레이어 8·프레임 16·태그 16·Undo 64단계/16MiB이다.
  atlas는 최대 4×4이며 클립 32프레임 한도가 별도로 겹친다. cel 합계 예산(2,097,152픽셀) 자체는 32×32×64프레임에도 충분하다.
- 선행: PX-04. 편집기 프레임 한도만 올려도 런타임 클립 한도에서 막힌다.
- 열린 설계 결정: 필요한 프레임 수를 실제 사용 사례로 측정, 문서 v6 필요 여부, 메모리·Undo 상한 유지.
- 완료 조건:
  - 대표 시트의 편집·저장·재열기·내보내기 시간과 메모리를 측정한다.
  - v1~v5 읽기·복구 호환과 `test:pixel-authoring`·`smoke:pixel-authoring`·`smoke:pixel-project`를 유지한다.

## P2 — 임포트 파이프라인

### PX-06 Aseprite 임포트 확장

단계별로 독립 승인한다. 앞 단계일수록 가치 대비 비용이 낮다.

| 단계 | 내용 | 열린 결정과 완료 조건 |
| --- | --- | --- |
| a | trim 프레임 허용 | 현재 trim/rotate 프레임은 거절한다. `sourceSize`·offset으로 원본 크기를 복원하고 pivot을 보존. rotate는 계속 거절해도 된다. fixture와 거절 진단 유지 |
| b | 슬라이스·pivot·9-slice | 슬라이스를 pivot/크기 메타데이터로 매핑할 대상(ObjectDefinition, 스프라이트 origin)을 정한다. 기존 작성한 size/pivot 보존 규칙과 충돌하지 않아야 함 |
| c | `.ase` 바이너리 직접 읽기 | 이미 JSON+PNG 내보내기 경로가 있으므로 필요성부터 판단한다. 새 파서·의존성은 승인 사항이며 압축 폭탄·크기 상한·보안 검증이 필요하다 |
| d | 저장 시 자동 재임포트 | 현재 폴더 감시는 3초 polling과 명시적 Apply다. 자동 적용으로 확대할지, 변경 감지 후 명시 Apply를 유지할지 결정한다 |

- 공통 완료 조건: 기존 상한(JSON 1MiB·PNG 16MiB·한 변 4096·256프레임)과 Undo 단일 트랜잭션 계약을 유지하고 `smoke:asset-pipeline`·`smoke:placement-viewer`를 통과한다.

### PX-07 타일 런타임: 오토타일과 타일 애니메이션

- 사용자 가치: 지형 작성 반복을 줄이고 물·횃불 같은 움직이는 타일을 쓸 수 있다.
- 현재 한계: 오토타일은 오프라인 helper(`applyTileRules`)와 LDtk 베이크 결과 소비뿐이고, 타일 애니메이션은 `bakeAnimatedTileLayer`의 CPU 재베이크뿐이다.
  네이티브 렌더러에는 개념이 없고, 타일은 visible 타일마다 SpriteRenderItem을 만든다.
- 선결 확인: 타일 API가 슈터 씬 전용인지, Data Scene 경로가 따로 있는지.
- 열린 설계 결정: AI agent-first 흐름에서는 작성 시점 규칙 해석(베이크)으로 충분할 수 있다. 런타임 규칙 해석이 실제로 필요한지 사례로 판단한다.
  import 어댑터(flip·animation·TSX·IntGrid)는 [기존 후보](game-development-convenience-review.md#asset-반복-작업)와 순서를 맞춘다.
- 완료 조건: 선택한 방식에서 대규모 맵의 draw·CPU 비용을 `smoke:tile-map`·`smoke:topdown-tilemap-budget`으로 측정하고 충돌·저장 계약을 유지한다.

## P3 — 도트 전용 효과와 편집 보강

### PX-08 팔레트 스왑 재질

- 사용자 가치: 한 스프라이트로 팀 색·상태 색 변형을 만든다.
- 현재 한계: 재질 preset은 `unlit`/`flash`/`additive`/`outline`뿐이다. 팔레트 스왑과 사용자 셰이더 API가 없다.
- 열린 설계 결정: 팔레트 LUT texture + material 변형 방식, 15 float command를 늘릴지 재질 id로 풀지, sRGB/linear 색 처리, 노멀 pair와의 결합, WebGPU 동등성.
- 완료 조건: WebGL2/WebGPU 결과가 허용 오차 안이고, 미지원 환경은 진단과 fallback을 제공하며 끈 상태의 추가 비용이 0이다.
  `webgl2.gpuTiming`으로 GPU 시간을 측정한다.

### PX-09 도트 후처리와 WebGPU 동등성

- 사용자 가치: 디더·포스터라이즈·정수 정렬 CRT로 도트 룩을 만든다.
- 현재 한계: 후처리는 `fade`/`bloom`/`crt`/`vignette`/`glitch`이고 WebGPU는 `fade`만 지원하며 나머지는 throw한다.
  CRT 스캔라인은 가상 해상도가 아닌 `gl_FragCoord` 기준이다.
- 선행: PX-01(가상 해상도 기준).
- 열린 설계 결정: 신규 효과 범위, 기존 WebGPU 미지원 효과를 동등하게 만들지 명시적으로 미지원으로 둘지.
- 완료 조건: 두 renderer의 지원 범위를 문서와 진단에서 일치시키고 `smoke:webgpu-recovery`·`smoke:gpu-resources`를 유지한다.

### PX-10 내장 편집기 보강 후보 (보조 도구 범위 안)

[기존 후보](game-development-convenience-review.md#도트-제작-후보)에 없는 항목만 둔다. 각각 독립 승인한다.

| 후보 | 가치와 조건 |
| --- | --- |
| 팔레트 파일 가져오기(`.gpl`/`.hex`, 필요 시 Lospec 형식) | 외부 팔레트 재사용. 비용이 낮다. 기존 `ferrum2d.pixel-palette` v1(256색·16KiB)과 순서·중복·RGBA 보존 규칙 유지 |
| 태그 재생 방향(reverse·pingpong) | 현재 태그는 프레임 목록과 loop 플래그뿐이다. PX-04와 함께 설계하고 문서 버전·마이그레이션을 정한다 |
| 디더·그라데이션 브러시 | 도트 표현 보강. 선택 마스크·대칭·Undo 단일 트랜잭션 규칙을 따른다 |
| 어니언 스킨 범위 확대 | 현재는 앞뒤 1프레임이다. UI 상태만 변경하며 원본 계약에 영향이 없다 |
| GIF/APNG/Aseprite JSON 내보내기 | 공유·외부 도구 연동용으로 런타임 가치는 낮다. 필요성이 확인될 때만 진행 |

- 공통 제약: Aseprite 대체 편집기로 확장하지 않는다. 기존 정수 변형·RGBA 원본·복구를 보호한다.

## P4 — 에이전트·예제·릴리스

### PX-11 도트 전용 agent skill과 검증기

- 사용자 가치: AI agent가 도트 에셋 규칙을 어기지 않고 게임을 만든다(agent-first 제품 목표와 일치).
- 현재 한계: consumer 템플릿에는 범용 asset pipeline skill만 있고 도트 전용 규칙·검증이 없다.
- 후보 검증: 팔레트 색 수, 타일 크기 정합, 비정수 배율 사용, 아틀라스 번짐 위험, NEAREST 전제 확인.
  `ferrum:asset-validate`에 pixel-art profile을 추가하는 방식을 먼저 검토한다.
- 선행: PX-01~03(검증 대상 계약이 확정돼야 한다).
- 완료 조건: `pnpm package:check:agents`, `pnpm package:check:create-game`, `pnpm smoke:create-game-template-reports`와 필요한 범위의 `package:consumer-smoke`를 통과한다.

### PX-12 도트 쇼케이스 예제와 릴리스 노트

- 사용자 가치: 도트 제작·노멀 조명·픽셀 퍼펙트 기능을 실제 게임으로 보여 주고 사용자가 변경을 알 수 있다.
- 현재 한계: `topdown-shooter` 아트는 16~32px 플레이스홀더 PNG 3장이다. 도트 제작·Aseprite 기능이 CHANGELOG에 한 줄도 없고 최신 릴리스 `0.1.0-beta.8`에 반영되지 않았다.
- 결정 필요: 새 public route는 [데모 포트폴리오 후보](demo-game-showcase-plan.md)의 판단 기준을 먼저 통과해야 한다. 새 에셋의 용량·라이선스·생성 방식을 확인한다.
- 승인 경계: CHANGELOG 문안은 문서 작업이지만 릴리스·Git tag·GitHub Release·npm publish는 명시적 사용자 승인 전 실행하지 않는다.

## 의존 관계

```
PX-01 ─┬─ PX-02 ── PX-03
       ├─ PX-09
       └─ PX-11 (PX-02·03 이후)
PX-04 ─┬─ PX-05
       └─ PX-10 태그 방향
PX-06a·b, PX-07, PX-08, PX-10 나머지: 독립
PX-12: 마지막 (PX-01~03 결과를 쇼케이스로 사용)
```

## 공통 검증 조건

- Rust 변경: `cargo fmt`, `cargo clippy`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`.
  Wasm 경계 변경이면 `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`와 `pnpm build`.
- 렌더링 변경: `pnpm smoke:sprite-normal-2d`, `smoke:color-management`, `smoke:render-texture`, `smoke:gpu-resources`, `smoke:webgpu-recovery`, `smoke:runtime-budgets`.
- 도트 편집·임포트 변경: `pnpm test:pixel-authoring`, `smoke:pixel-authoring`, `smoke:pixel-project`, `smoke:asset-pipeline`, `smoke:placement-viewer`.
- 새 계약마다 픽셀 퍼펙트 전용 browser smoke를 추가하고 [Smoke Check](../development/quality/smoke-check.md)에 기록한다.
- public API 변경: `pnpm validate:public-api-surface`와 [Core API](../engine/public-api/core.md)·`docs/development/architecture/architecture.md` 동기화.
- 문서 변경: `pnpm validate:docs-links`, `pnpm build:pages`, `pnpm validate:pages-artifact`.
- 실행하지 못한 명령은 생략하지 않고 사유를 기록한다.

## 비목표

- Aseprite를 대체하는 전체 도트 편집기와 타임라인·visual editor 제품화
- 스켈레탈 애니메이션, 복잡한 물리(Tiled 충돌 폴리곤 포함), Wasm threads, 멀티플레이어
- 외부 상태 변경(릴리스·tag·publish·원격 Pages 배포)을 승인 없이 수행하는 것

## 착수 전 사용자 결정 사항

1. 평면 2D 픽셀 퍼펙트를 renderer opt-in 옵션으로만 둘지 Data Scene 계약까지 포함할지(PX-01)
2. render command ABI와 Data Scene schema 버전 변경의 허용 범위(PX-04·PX-08)
3. `.ase` 파서와 신규 의존성의 필요성(PX-06c)
4. 타일 오토타일·애니메이션을 작성 시점 베이크로 충분히 볼지(PX-07)
5. 도트 쇼케이스 public 노출과 릴리스 노트 반영 시점(PX-12)
