# Ferrum2D Smoke Check

이 문서는 변경별 회귀 명령과 통과 기준을 관리한다. 실제 사용 계약은 [Public API](../../engine/public-api.md),
책임·버퍼 수명은 [아키텍처](../architecture/architecture.md)를 따른다.
명령의 정확한 실행 범위는 root `package.json`과 `tests/smoke/`가 기준이다.
과거 통과 횟수·작업 단계·임시 로그는 현재 검증 결과로 취급하지 않는다.

## 로컬 기본 검증

Node.js 24 이상, pnpm 10.8, Rust stable과 wasm-pack을 준비한다. CI는 Node.js 24를 사용한다. 브라우저 smoke에는 Playwright Chromium과
해당 OS 라이브러리가 필요하다. native 앱 조건은 [desktop 안내](https://github.com/silbaram/ferrum2d/blob/main/apps/studio-desktop/README.md)를 따른다.

아래 전체 검증 모음은 요청된 전체 개발과 통합이 완료된 뒤 실행한다. 개발 중에는 수정한 코드와
직접 영향받는 동작의 테스트만 선택하고, 그 실행에 필요한 컴파일·수정 파일 형식 확인을 수행한다.
원래 실패의 복구는 해당 원본 사례로 확인하며, 매 수정마다 전체 모음을 반복하지 않는다.

```bash
pnpm install
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/ferrum-core/Cargo.toml
pnpm build:wasm
pnpm --filter @ferrum2d/studio-kit build
pnpm lint
pnpm test:web
pnpm build
```

Studio Kit의 선언 타입은 `pnpm lint` 전에 생성한다. 변경된 source와 일치하지 않는 이전 dist/Wasm을 사용하지 않는다.
`gameplayObservation*.test.ts`는 Native simulation XYZ와 render offset의 분리, stale generation·순서·중복,
소유 복사본과 Shooter progress 읽기를 확인한다. Rust 회귀는 실제 wave 진행과 checkpoint 복원도 확인한다.
`smoke:topdown`에 연결된 showcase 검증은 legacy snapshot 편집 대신 실제 짧은 wave·pickup·enemy contact로
HUD, 점수, GameOver와 재시작을 검증한다. Native 파일 모드에서도 동일한 progress API로 wave HUD를 표시한다.
Terrain 회귀는 실제 셀 형상과 chunk/span별 quota, Native tile/vision query의 limit 전 flag 선택,
발판 turnaround/accepted prefix의 render 보간과 static mesh pointer/capacity 재사용을 확인한다.
Typed terrain impulse/projectile의 실제 XYZ·세대·gameplay sidecar·audio/particle 및 저장 복원/손상 거절을 검사한다.
`terrainImpacts.test.ts`와 frame snapshot 회귀는 24-word ABI, memory.grow와 u32/f32 alias·signed zero 보존을 확인한다.
64/1024/4096 셀 시나리오는 실제 body/collider·저장·교체 비용을 측정한다. Count만으로 프레임 비용 수용을 대신하지 않는다.
중간 검증은 실행할 테스트 이름과 변경과의 관련성을 먼저 정하고 선별 실행한다. 전체 lint/test/build/package/browser
matrix는 전체 개발·통합 완료 후 모아 실행한다. 실패 수정 뒤에는 영향받은 검사부터 재실행하며, 서브에이전트가
같은 전체 matrix를 중복 실행하지 않는다. 변경 없는 Rust/Wasm 등의 결과는 해당 source·빌드/도구 설정·산출물 해시가 모두 일치할 때
재사용하고 이번 직접 실행과 구별해 기록한다. 검증 범위는 유지하며 시점과 중복 실행만 최적화한다.
CI validate job도 Core Rust 전체 검증 뒤 `pnpm test:web`를 실행해 같은 Core suite를 `pnpm test`로 중복 실행하지 않는다.
같은 job의 Wasm은 `pnpm build:wasm` 한 번으로 생성하고, texture 준비와 `pnpm build:web` 뒤
각 browser/package probe를 직접 실행해 standalone smoke wrapper의 Wasm·Web·예제 재빌드도 중복하지 않는다.
Wrapper가 포함하던 report contract·public type·tarball 검사와 WebGPU/번들 옵션은 유지한다.
create-game package 검사의 내부 재빌드도 같은 checkout에서 공통 빌드를 끝낸 CI에 한해 `--skip-build`로
생략한다. 필수 파일과 generated Wasm factory/SDK source·dist identity 검사는 계속 수행한다.
Native 검사는 실제 Wasm의 파일 header에 들어 있는 기존 Core/target fingerprint를 현재 `build.rs` 입력의
계산값과 비교해 오래된 Wasm을 거절한다. 이는 compiler/flags·재현 가능한 binary나 전체 제품 수용의 증명이
아니므로 선행 공통 빌드는 유지한다. `native-wasm-source-identity.test.mjs`의 경로 순서·소스 변경·header/target
회귀도 CI package 단계에서 실행한다. 지문 입력에는 Core·vendored Rapier/Parry·vendored libm 소스가 들어간다.
지문은 경로를 `/` 구분자로 계산해 Windows 로컬 빌드도 Linux와 같은 값을 낸다.
`tests.rs`·`*_tests.rs`와 그 하위 module은 `cfg(test)` 전용이라 지문에서 제외하므로 테스트만 고쳐도 기존 `.f2d`가
유지된다. 같은 테스트가 제외 대상 전부의 `#[cfg(test)]` 선언을 실제 소스에서 확인하며, 이름만 비슷한 상류 production
module(`soft_body_crossing_tests.rs`)은 `build.rs`와 mirror의 예외 목록에 둔다.
`package:check:ferrum-web`은 `pkg/ferrum_core_bg.wasm`이 12MiB 예산 이하인지도 확인한다. 예산을 올릴 때는 크기 증가 사유를 함께 기록한다.
Runtime tarball의7개 Wasm/glue/factory/선언·metadata 파일은 검증한
workspace 산출물과 bytes가 같아야 한다. 실제 검사만 필요하면 `node scripts/package/native-wasm-source-identity.mjs`를 쓴다.
네 생성 템플릿의 headless replay도 기본 Native backend를 검사하고 공개 Native 파일 저장의 전체 SHA256과
byteLength를 `custom.nativeRuntime`에 보존한다. capture는 pause/resume 사이에서 실행하며 resume의 첫 RAF는
같은 timestamp로 초기화해 물리 tick·입력 frame을 더 소비하지 않는다. Legacy Shooter JSON으로 대체하지 않는다.
파일의 같은-build 식별자도 hash에 포함하므로 SDK 변경 뒤에는 의도한 변경을 확인해 fixture를 갱신한다.
`gameLoop.test.ts`와 `engineFrameLifecycle.test.ts`는 update 경계의 예외가 audio/render/public frame으로
진행하지 않고 RAF·busy 상태를 정리하는지, 원래 오류 전달과 checkpoint·재시작·해제가 가능한지 검사한다.
frame pipeline/manual step 회귀는 checked entry를 한 번만 호출하고 거부 시 output/stat 읽기를 하지 않는지
검사한다. Packed `native-checked-error-probe.mjs`는 공개 SDK로 빠른 CCD 상자를 유효한 경사 mesh 쪽으로
보내 실제 충돌 검사에서 논리 작업량 한도를 초과시킨다. automatic/default manual/configured manual
세 경로의 실제 Wasm 거부와 첫 구간의 pose·속도·시간 보존, public frame 미발행,
새 Rust query·checkpoint 복원·장애물 제거 후
RAF 재시작·중복 destroy를 확인한다. `smoke:unified-physics-web`에 연결하며 실제 실행 결과는
새 공통 build의 package/Wasm 해시와 함께 판정한다. JS 오류 주입 결과나 RSS 한도 검증으로 대체하지 않는다.
`nativeGameFile.test.ts`는 동기 Wasm 컴파일이 거절되는 환경에서도 공개 파일 저장과 복원이 성공하는지 검사한다.
Native 기본 생성 회귀는 raw/Web의 backend 생략·가변 시간·씬 전환과 저장된 legacy 정책 보존을 검사한다.
`planar_navigation::default_tests`와 `combat_navigation::dense_tests`는 Native-only shape·local offset·render anchor 분리,
실제 cached connector의 꺾임점, 64 actor의 순환 서비스·목표 거리 진전과 Native 파일 continuation을 검사한다.
Packed `native-default-backend-probe.mjs`와 `native-gameplay-navigation-probe.mjs`는 실제 공개 SDK·RAF·WebGL renderer를
사용한다. Dense browser gate는 `native-crowd` budget(최댓값과 warm p95)을 적용하며 실제 solver 위치와 작업량도 함께 확인한다.
문서만 바뀌면 변경한 링크·명령·계약에 해당하는 검사부터 선택한다. 아래 명령 전체를 매 문서 수정마다
실행하지 않으며, Pages 전체 빌드·산출물 검사는 렌더링·배포 계약을 확인할 완료 단계에 수행한다.

```bash
pnpm validate:docs-links
pnpm validate:public-api-surface
pnpm build:pages
pnpm validate:pages-artifact
```

`pnpm smoke:check`는 넓은 로컬 회귀 묶음이다. 모든 선택형·실기기·native GUI 검증을 포함하는 명령은 아니다.
변경 영역에 해당하는 gate를 아래에서 선택한다. 선행 build를 생략하는 옵션은 같은 소스의 검증 결과가 있을 때만 사용한다.

## CI와 로컬 검증 차이

| Workflow | 현재 trigger와 범위 |
| --- | --- |
| `language-boundaries.yml` | PR·main push·수동 실행. 소유권 규칙/negative fixture, 현재 Wasm build, SDK tests, 실제 ABI·frame 수명 검사 |
| `ci.yml` | `main` 대상 PR과 수동 실행에서 기본 검증. 수동 입력·태그 ref에서 소비자·확장 브라우저 검사 |
| `pages.yml` | 수동 Pages build·artifact 검증·배포 |
| `github-release-prepare.yml` | 수동 SDK·Studio 빌드 및 설치 검증. `attach_to_draft` 선택 시 세 OS 설치 파일과 SDK를 릴리스 초안에 첨부하고 원격 파일 목록·크기·해시를 대조 |

아래의 **CI 기본 gate**는 `main` 대상 PR과 수동 실행에서 돌아가는 `validate` 검사다.
브랜치 ref 수동 실행에서는 `consumer_smoke`, `extended_browser_smoke` 입력으로 해당 job을 켠다.
`ferrum-web-v*` 태그 ref를 선택해 수동 실행하면 두 job이 활성화된다. 실제 trigger와 실행 입력을 보고서에 남긴다.

## 제품 Runtime Budget Readiness

기존 2D 입력 속도·AI의 통합 물리 이전은 `cargo test --manifest-path crates/ferrum-core/Cargo.toml automatic_planar`로
native-only 벽 slide·중복 적분 방지·cold import·물리 목표 위치·AI 속도 누적·예약 impulse 순서·mask/sensor/enable/height·
route handoff·pause/remainder·checkpoint byte replay·이동 중 주기 공격·후순위 이동 거절 복구와 legacy navigation 조합 거절을 검증한다.
빌드 후 `pnpm smoke:unified-physics-web`의 `automatic-movement-native-probe.mjs`는 packed 공개 API로
수동 속도 설정의 충돌 이동, 기존 component AI의 실제 RAF 이동, native/component 출력과 backend step·Rust frame 시간을 검사한다.
상태·규모·실행 비용의 유한성 확인이며 밀집 성능 수용이나 상대 운동·회전 CCD의 통과 근거는 아니다.

자동 controller의 높이 한도·source 형상 확장은
`cargo test --manifest-path crates/ferrum-core/Cargo.toml controller_extension_`으로 검증한다.
계단·경사·낙차·ledge 한도와 캐릭터별 설정 교체/reset, invalid/stale/소유권 거절과 이전 설정 보존,
같은 Engine checkpoint 복원, 원·OBB·캡슐·볼록 다각형·복합 fixture의 실제 형상 검색을 확인한다.
형상 검색 자체의 회귀는 `cargo test --manifest-path crates/ferrum-core/Cargo.toml planar_controller_geometry_`로 실행한다.
복합 source의 두 번째 solid fixture·fixture 사이 빈 공간, source sensor/disable/mask와 새 높이의 전체 fixture 도착 검사도 대상이다.
빌드 후 같은 packed `pnpm smoke:unified-physics-web`의 `controller-extension-native-probe.mjs`는 공개 설정 API로
높이 한도·형상별 이동을 실행하고 native/component 출력·실제 backend step·Rust frame 시간을 확인한다.
이 검증은 수동 HD-2D·XY route의 기존 단일 AABB 계약, 일반 기본 씬 이전이나 동적 결합·회전 CCD 수용과 구분한다.

| 영역 | 명령 | 통과 근거 |
| --- | --- | --- |
| profile·gate 정합 | `pnpm smoke:runtime-budgets`, `pnpm validate:runtime-budget-product` | profile/mode mapping·CI 연결·문서·artifact 경로 누락 거절 |
| Rust 대량 오브젝트 | `pnpm smoke:mass-objects` | 실제 scenario seed/frame/suite hash와 구조적 budget |
| 물리 | `pnpm smoke:physics`, `pnpm smoke:physics-replay` | fixed step·solid/tile candidate·CCD·debug line·collision pair와 replay state hash |
| WebGL2 기본 경로 | `pnpm smoke:starter-runtime`, `pnpm smoke:browser-budget` | 실제 렌더 frame의 metric·픽셀·입력·오디오와 budget report |
| 게임별 budget | `pnpm smoke:topdown-budget`, `pnpm smoke:topdown-mass-objects`, `pnpm smoke:topdown-tilemap-budget`, `pnpm smoke:breakout-budget`, `pnpm smoke:platformer-budget`, `pnpm smoke:physics-sandbox-budget` | 해당 시나리오의 native 상태·command·draw·프레임 측정 |
| WebGPU optional | `pnpm smoke:lighting-webgpu`, `pnpm smoke:material-webgpu` | capability-aware 결과. 미지원/fallback과 실제 WebGPU 통과를 구분 |

수치 상한은 `tests/smoke/runtime-budget-profiles.mjs`에 둔다. 문서에 과거 측정값을 새 상한으로 복제하지 않는다.
`RuntimeProfiler`는 실제 frame을 bounded sample로 수집한다. metric 누락이나 0으로 채운 가짜 frame을 성공으로 처리하지 않는다.
보고서 형식은 `ferrum2d.browser-smoke.runtime-budget-report`이며, 출력 위치는
`FERRUM_BROWSER_SMOKE_BUDGET_ARTIFACT_DIR`로 지정한다. CI 기본 출력은 `artifacts/browser-smoke-budgets/`다.

GPU timing의 미지원·disjoint·미측정은 숫자 0과 구분한다. Wasm capacity는 실제 사용량과 다르며,
work/sample 상한은 GPU 실행 시간과 다르다. software adapter/offscreen 결과는 실제 기기 성능이나 compositor 검증을 대체하지 않는다.
필수 WebGPU smoke에서 fallback을 성공으로 세지 않는다.

## Rust / TypeScript 역할 경계 회귀

```bash
pnpm test:language-boundaries
pnpm validate:language-boundaries
pnpm build:wasm
pnpm test:web
pnpm smoke:language-boundaries
```

실제 Wasm의 ABI·dispatch 수와 frame/sidecar 수명, native 메모리 증가, 외부 callback의 씬 교체·해제를 검사한다.
엔티티 1·128·1,024개에서 한 프레임에 `update_frame_checked`를 한 번 호출하고, 해당 export를
숨긴 호환성 검사에서는 `update_frame`을 한 번 호출한다. 엔티티 수가 늘어도 메서드별 호출 횟수는
같아야 한다. 기본 호출 상한 21회와 별도로 지형 충격 버퍼·통합 물리 진단·조명 버퍼의 지정된
호출을 개별 검사한다. 지형 충격이 없는 씬에서는 빈 버퍼와 실제 물리 1스텝·접촉 0건을 확인한다.
대화·퀘스트·파괴 지형의 진행을 TS가 다시 소유하거나 entity별 hot-path 호출을 추가하는 변경을 차단한다.
진단·오디오 native 작업은 borrow 전에 끝내고 effect는 GPU 소비 후 실행해야 한다.
custom renderer는 class private 상태 단언 없이 사용할 수 있어야 하며, 미지원 요청은 target 변경 전에 거절한다.
RAF 재진입, timer 종료, 외부 소유 자원 보존도 SDK integration 검사에 포함한다.

## Runtime·Data Scene·물리

개발 중인 [통합 3D 물리](../../planning/unified-3d-physics-plan.md)의 Rust 회귀는
`cargo test --manifest-path crates/ferrum-core/Cargo.toml physics3d`로 실행한다. 지형 위 낙하·정착·이음새 횡이동,
메시 밑면 충돌, 수정 직후 ray/sweep/overlap, query 전후 시뮬레이션 일치와 키네마틱 목표 보존,
삭제/재생성 시 event identity·중복 방지·overflow, 평면 축 잠금을 검사한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml hd2d_native_`은 native-only 벽/corner의 slide, ramp 보간,
step/ledge/drop·다리 아래·층 변경, 새 높이의 도착 장애물 rollback, pending impulse/clock/속도/누적 각도와 checkpoint를 검사한다.
Collision tilemap의 wrong-scene/정확한 payload·정의 참조, capacity 실패 보존과 교체 revision·clear도 포함한다.
`hd2d_kinematic`의 기존 legacy 회귀를 함께 유지한다. Packed `smoke:unified-physics-web`의 `hd2dNative`는 실제 public SDK로
충돌 grid를 설정하고 slide·ramp·step 제한·점유 도착 rollback·checkpoint·bridge/clear를 확인한다. Playing/native RAF step과
유한한 Rust 시간을 확인하며 밀집 성능/실기기 수용을 대신하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml planar_actor_native_`은 component actor의 native-only 곡면 장애물·반복 막힘/탈출, sensor/mask/enable/floor, 실제 source 회전·offset과 누적 각도, 지형 변경·기존 AABB 보정 미실행, 정확한 코너/도착·pause/입력 취소·4방향 애니메이션, pending impulse·identity·clock 및 메모리 checkpoint continuation을 검사한다. Invalid native batch는 blocked이며 legacy fallback을 하지 않아야 한다.
Packed `smoke:unified-physics-web`의 `planarActorNative`는 Physics Spec의 기본 rigid 연결과 제어된 실제 RAF에서 native-only sphere 차단·2D/XYZ 상태 일치·장애물 제거 후 재요청·진행 경로 rollback·정확한 도착을 검사한다. Playing 상태·native step·hit/candidate 작업량과 유한한 Rust 시간을 확인하며 밀집 성능 budget gate는 아니다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml physics_spec_native_`은 rigid Spec의 native 설정·즉시 import, 자동/수동 실행과 clock 보존, 같은 설정의 추가 그룹, 잘못된 mode·scene·payload 거절을 검사한다. 읽기 전용 2D 행의 layout·예약 impulse 보존과 native-only/stale 거절도 포함한다.
`pnpm smoke:unified-physics-web`의 `physicsSpecNative` probe는 실제 packed SDK에서 명시적 native 설정 없이 rigid Spec을 적용하고 즉시 XYZ/2D 조회, manual RAF 정지·수동 step, runtime RAF native step, memory rollback, JSON 저장·mode downgrade 거절을 확인한다. Sandbox는 같은 2D 읽기 경로를 매 frame 사용한다. 이는 전체 backend 이전·파일 importer·성능 수용을 증명하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml arcade_native_`은 collider-only의 implicit kinematic/fixed 선택,
초기·후속 틱의 단일 적분·0속도 역할 유지·명시적 body 우선권과 collider 없는 일반 이동을 검사한다.
Packed `smoke:unified-physics-web`의 `arcade-native-probe.mjs`는 명시적/생략 mode의 arcade가 실제 native를
사용하는지, arcade metadata·manual RAF 정지와 고정/가변 직접 step·runtime RAF/AI 단일 실행·checkpoint,
none downgrade·연결된 world의 nominal 불일치 사전 거절·native JSON 저장 거절을 검사한다. 기존 legacy JSON fixture만
명시 legacy runtime에 geometry를 staging하여 복원하며 새 가변 Spec authoring의 backend 선택과 구분한다. 실제 Playing 상태·body 규모·native step과 유한한 Rust 시간을
함께 확인한다. Raw 기본 생성·physics 생략 씬·built-in 전용 controller의 전체 이전이나 밀집 성능 수용 근거는 아니다.
SDK의 Physics Spec/snapshot 회귀는 arcade 기본 payload와 arcade/rigid의 native 범위(반복1..32·f32 nominal step0.0001..0.1·각 중력 성분의 유한성/절댓값1,000,000 이하) 사전 거절과, 실제 backend가 legacy여도
rigid/고정 arcade Spec의 JSON capture/restore를 staging·clear·transaction 전에 거절하는지 검사한다.
Backend getter 누락·unknown과 arcade의 누락·비boolean clock의 fail-closed 거절도 검사한다. 명시적 variable arcade/none legacy JSON 경로는 유지하며 기존 fixed-arcade 파일 migration을 검증한 것으로 해석하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml shooter_native_`와 `shooter_phases_` 회귀는 내장 Shooter의
planar opt-in, pre/native/post 단일 이동·actor Wall mask와 overlap 게임 반응, Title/restart 상태 전환,
같은 Shooter reset/authoring·다른 scene 전환, legacy snapshot 거절과 memory checkpoint를 검사한다.
정지 actor 아래 solid tile을 추가한 초기 겹침의 native 복구도 Rust 회귀에서 검사한다.
Packed `smoke:unified-physics-web`의 `shooter-native-probe.mjs`는 공개 `configureUnifiedPhysics`를 사용해 실제 Shooter의
native 이동·gameplay 연결과 solver step을 검사한다. Playing 상태·객체 규모·native step·유한한 Rust 시간을 함께 확인한다.
기본 trigger actor의 native solid Wall 차단과 World overlap 피해·pickup을 함께 확인한다.
Bullet의 native sensor 이동과 기존 Shooter swept gameplay/tile pierce/bounce/despawn 정책을 구분하며,
이 검증을 모든 query 이전·Breakout/Platformer 이전이나 최종 밀집 성능 수용의 근거로 사용하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml breakout_native_`와 `breakout_phases_` 회귀는 명시적 planar 선택,
Title/restart 무이동·paddle clamp와 명령 속도 보존·ball 단일 이동, scene target ID와 동시 hit 순서, paddle ContactOffsetX 반사,
wall 이탈 재충돌 방지·brick effect/피해/점수/despawn·종료 판정, manual 명령과 직접 step, collider 제거 뒤 native 소유권,
잘못된 clock·관리 mover의 rigid type 사전 거절, reset/scene 전환·memory checkpoint를 검사한다.
Native targeted sweep의 fixture·filter 검증과 실제 초기 침투/표면 이탈 경계도 별도 Rust 회귀로 확인한다.
Packed `smoke:unified-physics-web`의 `breakout-native-probe.mjs`는 실제 public SDK와 제어된 RAF에서 planar opt-in,
start/restart 무이동·paddle clamp·wall 이탈·접촉 offset 반사·brick HIT/점수/particle/despawn을 검사한다.
Playing·entity/render 규모·native step·유한한 Rust 시간과 exact checkpoint continuation, manual update 정지·직접 step의
이동/brick 반응, reset/동일 scene 선택·다른 scene 전환도 확인한다.
이는 Platformer·일반 default/variable-step 이전, 회전 CCD·밀집 성능·native 파일 저장 수용을 뜻하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml planar_platformer_`는 native fixture의 정확한 geometry·offset·tie 순서,
one-way 방향/시작 feet 필터·지지 normal을 먼저 고르는 ground probe, carry의 support 제외와 다른 장애물 차단,
mask·sensor·enable·span과 잘못된 source/space/offset 거절을 검사한다.
`platformer_state_step_`와 `platformer_phases_` 회귀는 legacy/native 공통 속도·coyote·buffer·낙하 상한, held Space 시작,
입력 재샘플링 없는 plan과 성공 후 score/time·landing·loss/restart를 검사한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml platformer_native_`는 실제 Engine의 floor/ceiling·one-way·coyote/buffer·step,
carry/벽 차단·authored tuning, manual jump queue의 성공 소비·실패 rollback·checkpoint, reset/query owner·scene 전환을 검사한다.
Packed `smoke:unified-physics-web`의 `platformer-native-probe.mjs`는 공개 SDK의 제어된 RAF에서8개 물체의 Playing·render 규모·
native step·유한한 Rust 시간, 중력/수평 단일 이동·held Space·one-way landing·carry·landing particle을 확인한다.
Exact checkpoint continuation과 queued jump replay, manual update 정지·직접 step의 jump 단일 소비, loss/restart·reset 직후 query·
동일 scene 선택·다른 scene 전환도 검사한다. 회전 carry·각운동 CCD·동적 지지체 전체·밀집 비용·파일 저장 수용과 구분한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml default_policy_`는 기존 raw/variable 경로·scene-local 설정과 구분한 생성 정책을 검사한다.
Cross-scene native profile·cold query·generation, same-scene world 보존, manual 실행·clock step 복귀와 frame/step 상한 유지,
잘못된 설정/현재 authoring·후속 cold fixture 거절, 기본 policy를 포함한 checkpoint의 이후 씬 선택과 기존 숫자 payload bridge를 포함한다.
SDK의 physicsDefaults 회귀는 legacy metadata·명시 clock·unified 가변 시간 선택과 none/range·이전 Wasm 거절, apply 전 target world와 Game Spec 비교,
private 생성 baseline과 반환 Spec의 분리·암묵적 씬 metadata 갱신/동일 scene override를 검사한다. Runtime checkpoint 회귀는
frame 없는 capture의 metadata 동기화와 Spec/scene stamp 복원을 검사한다. Frame metadata 추출은 policy 관측 호출로 물리 tick을 추가하지 않는다.
기존 고정 시간 policy probe의 결과만으로 가변 실행을 검증한 것으로 처리하지 않으며 아래 별도 가변 시간 회귀를 함께 사용한다.
전역 Native 기본값은 위의 별도 생성 회귀로, 외부 파일은 public Native 파일 세션 회귀로 검증한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml native_snapshot`은 native checkpoint의
복원 직후 상태와 동일 입력 continuation을 검사한다. 평면/공간 접촉 stack·13종 관절·캐릭터 예약 점프와
발판, force/target·dirty query·삭제/재사용 세대, 충돌/파손 overflow, 지형을 포함한 7종 형상,
층/one-way/컨베이어/접촉 보정, 발판 정지·회전 구간 motion의 projectile query를 포함한다.
정확한 encoded 한도·한 바이트 초과 거절과 손상/버전/길이/후행 payload 거절도 확인한다.
실패한 restore는 현재 world를 바꾸지 않는다. 이 검증은 Rust core opaque checkpoint 범위이며
Engine/Data Scene·Web 진행 저장/replay의 지원 또는 밀집 메모리/시간 수용을 증명하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml query_snapshot`은 독립적으로 decode한 native
world와 직렬화한 검색·캐시의 유효성 일치를 검사한다. 같은 값 교체·원래 형상으로 되돌리기·fixture 세대
재사용은 이전 검색을 무효화하고, 잘못된 형상·변경 번호 초과는 상태를 바꾸지 않는다. sparse 기록 정리,
source mesh를 보관하지 않는 수명, mesh 크기와 무관한 query 기록 크기와 fixed-only 범위도 검사한다.
이는 파일 importer의 손상/복잡도 제한이나 Engine 전체 파일 저장 지원을 증명하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml runtime_checkpoint`은 메모리 rollback을 검사한다.
평면/공간의 예약 force/target·fixed remainder·entity 세대, built-in 출력과 반복 rollback,
foreign/transaction/revision overflow 원자성, pending native A*·shared route/Seek/Accelerate intent,
발판 phase/queued jump/보간과 projectile 입력 edge·피해·퇴장을 실제 같은 입력 continuation으로 비교한다.
World ownership·joint free-list와 빈 bounded action/contact queue의 예약 공간도 검사한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml engine_serialization`은 전체 Engine byte schema의
평면/공간·built-in 왕복, header 포함 정확한 byte 한도·1 byte 초과, source/target/CRC/길이·후행 payload 거절,
Vec 예약 공간·HashMap 정렬과 duplicate 거절, 공개 sprite sequence/tile layer의 private 불변식을 검사한다.
손상된 complete token의 실패는 원본 상태 전체와 revision을 보존해야 한다. 일반 `runtime_checkpoint` 회귀도
전체 byte 인코딩/복원을 사용하며 큰 스택 환경변수 없이 기본 테스트 스택에서 통과해야 한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml decode_admission`은 동적 길이 선언과 zero-wire
큰 element의 생성 전 거절, 재귀 enum·정확한 값 예산·zero-sized sequence 한도, 빈 예약 공간의 누적 예산,
native blob의 예산 상속·nested root 초기화 거절·무시한 오류의 sticky 실패·scope 정리와 문자열 입력을 검사한다.
저예산 complete candidate 거절은 기존 Engine 전체 인코딩과 revision을 유지해야 한다. 이는 할당 작업
admission 검사이며 실제 RSS 한도·모든 upstream constructor 또는 외부 파일의 native 구조 안전성을 증명하지 않는다.

`cargo test --manifest-path crates/ferrum-core/Cargo.toml decode_budget_storage_`는 중첩 default/명시적 읽기의
정확 Usage·한 단위 부족, nested root 거절 뒤 동일한 외부 예산, 정상/오류 반환 뒤 scope 해제와 input/depth/value/
allocation 오류 우선순위를 검사한다. 별도 `native-file-decode-budget-storage/measurement/`의 test-only 계측은
생산 decoder 한 파일만 다른 두 source를 Native/WASI Node22/24에서 비교한다.11종×3환경의 결과/논리 Usage는
같고 관리용 요청104/52B는0이어야 한다. Vec16B/String5B 같은 실제 출력 할당은 남는다. Native unwind는 별도
child로 검사하며 WASI에서 unwind를 실행했다고 주장하지 않는다. 이 requested-layout 계측은 allocator metadata·
TLS 고정 공간·host/RSS cap을 검증하지 않는다. 계측용 global allocator는 Main/production에 설치하지 않는다.
근거는 `artifacts/physics-3d/goal-closure/native-file-decode-budget-storage/`다.

`decode_admission_native_arena` 회귀는 실제 bounded Postcard reader에서 손상된 길이·빈 슬롯 연결을
거절하고 세대와 삽입 순서를 보존하는지 검사한다. vendor의 `arena_serde` 회귀는 동일한 거절을
bincode/JSON에서도 검사하고 기존 binary 필드 표현, 비어 있는/가득 찬/clear 후 생성 상태를 확인한다.
모든 native 구조 검증이나 세대 번호 소진 처리를 완료했다는 의미는 아니다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml native_snapshot_backend`는 현재 형식 5의 비지원
multibody/soft-body 표식이 내부 payload decode 전에 거절되는지 검사한다. 초기 persistent state 왕복,
생성 후 삭제한 set의 이력 거절, empty 생성 전 작업 예산 거절과 형식 2·3·4 거절도 확인한다. 유효 CRC를 가진
잘못된 표식의 실패 후 평면/공간 world의 전체 encoded 상태와 예약 force가 보존되어야 한다.
기존 `native_snapshot`·`runtime_checkpoint` 검사를 함께 실행해 지원하는 접촉·13종 joint·형상·예약 명령과
AI/발판/투사체의 continuation을 유지하는지 확인한다. 이는 외부 파일 importer 전체 안전성의 증명이 아니다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml geometry_admission`은 고정 Parry의 BVH·Array2·
VecMap·HeightField 손상 거절과 정상 wire 보존을 검사한다. Binned/PLOC, empty/single tree, free 순서,
최적화 후 retired 노드, partial update(마진 0/양수) 후 refit, scale·삭제 cell·ray 결과를 비교한다.
전체 rebuild 후 retired leaf가 다시 나타나면 실패한다. 실제 재현은 16개 leaf가 41개로 증가했으며,
수정 후에는 Binned/PLOC rebuild의 모든 live ID별 AABB·overlap 결과와 정확한 저장/복원을 유지해야 한다.
generic BVH는 pending refit의 stale ancestor
bounds를 보존하므로 형상별 containment·수치/mesh topology 검증 완료를 뜻하지 않는다.
vendor source/Cargo가 변경됐으므로 Rapier의 Serde 비활성/활성·parallel feature와 기존 native/WASI
snapshot portability를 새로 검사한다. Parry 원본 archive와 양쪽 fork 변경·라이선스 고지도 검증한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml shape_admission`은 mesh/convex/compound의
정상 wire·optional cache와 손상된 index/topology/incidence/pose/flag/bounds의 거절을 검사한다.
immutable shape BVH는 generic BVH에서 허용하는 stale refit 상태도 거절해야 한다.
비균일·8종 축 반사의 convex winding·질량·ray feature와 mesh의 재계산 pseudo-normal을 확인한다.
primitive SharedShape의 비음수 크기·유한값/unit normal 검사도 포함한다. native와 실제 WASI에서
검사하며 전체 볼록성·모든 shape variant·실제 할당 예산이나 외부 파일 importer의 검증을 대신하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml bvh_depth`는 유효한 깊이 16,384 저장 트리의
depth 계산·자기/두 subtree 교차 검색을 기본 스택으로 실행한다. 저장 bytes를 유지하고 모든 예상 pair를
정확한 callback 순서로 반환해야 한다. empty/singleton 의미와 Binned/PLOC·4개 seed·갱신 전후·change filter
조합의 32개 기존 반환 순서도 검사한다. 해당 golden은 수정 전 native 실행에서 기록했고 brute-force AABB
pair 집합과 대조했으므로 변경된 순서를 통과시키기 위해 다시 만들면 안 된다.
parallel feature의 실제 callback 순서와 warm workspace의 할당 재사용도 별도로 확인한다.
이 검사는 BVH build/refit의 다른 재귀나 모든 검색의 전체 자원 수용을 대신하지 않는다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml bvh_refit`은 깊이 16,384의 resolving/flag-preserving/
in-place refit을 기본 스택으로 실행하고 모든 leaf ID/AABB·대표 overlap query·저장/복원 continuation을
비교한다. 수정 전 기록한 layout/flag/churn 40개와 empty/singleton/root 경계 24개의 전체 encoded hash를
유지해야 한다. sparse leaf map과 사용하지 않는 root-parent metadata도 확인한다.
actual native parallel refit은 deep chain과 큰 grid에서 순차 refit의 전체 저장 bytes와 일치해야 하며,
순차 warm buffer refit의 Rust allocator 호출도 별도로 측정한다. Parry 자체 기본/parallel Serde unit,
엄격한 vendor Clippy와 기존 native/WASI snapshot portability를 함께 확인한다.
이 refit 보강이 남은 build 경로·전체 CPU/할당 예산이나 외부 파일 importer 수용을 대신하지 않는다.
Web unit은 old capability·RAF 실행 중·다른 owner/위조/disposed token과 JSON 직렬화 거절,
native 거절 시 host physics metadata 유지와 Engine 파괴 이후의 독립 dispose를 확인한다.
packed `smoke:unified-physics-web`은 두 공간에서 public API를 실제 Wasm과 제어된 browser RAF timestamp로
진행한다. 60-frame 입력/시간 경로의 body/identity·AI·clock·렌더 배열을 rollback 전후 정확히 비교하고
미래 entity 제거/재사용·외부 Engine·중복 dispose를 확인한다. 기존 실시간 RAF 회귀도 함께 유지한다.
같은 packed gate에서 1,400개 고정 센서로 실제 pending A*를 만든다. 1,402개 entity body의 words/floats,
clock·scheduler·렌더 명령/billboard를 12-frame continuation과 replay에서 비교한다. 정상 검색은 취소되지
않아야 하며, 같은 값의 형상으로 교체한 뒤 scheduler가 관측하기 전에 저장한 stale 검색은 복원 후에도
취소되어야 한다. 시간은 이 functional 검사로 밀집 성능 수용을 주장하지 않는다.
파일/JSON native 저장·외부 자원 복원이나 GPU 픽셀·밀집 성능 수용을 이 검사로 주장하지 않는다.
`physics3d::character_tests`는 capsule의 지형 이동·경사/계단 한계·점프/낙하·다리 위/아래,
이동/승강/수평 회전 발판의 운반·환경 차단, 빠른 캐릭터 간 관통과 같은 방향 그룹의 속도,
접지 캐시·입력 원자성·controller 소유권을 검사한다. 떨어진 캐릭터들의 pair cast가 0인 구조적 검사와
실제 밀집 장면의 시간 budget 검증을 구분한다.
`physics3d::joint_tests`는 7종 관절의 실제 위치·거리·각도, 압축/늘어남·겹친 anchor 복구,
limit·motor 출력 상한, substep 힘 단위·순간 파손·sleep/비활성화, 두 dynamic body의 중심 보존,
연결 충돌 필터, update 원자성·용량·삭제/재생성·event overflow를 검사한다.
관절이 있는 경로에서도 query 후 키네마틱 목표·이동/회전 속도와 캐릭터의 발판 운반·보행 입력을 함께 검사한다.
여러 substep의 물리 결과 검사는 밀집 관절 장면의 시간 budget 검증을 대신하지 않는다.
`engine::unified_physics`는 새 native Data Scene body가 실제 Engine fixed tick·렌더 명령에 반영되는지 검사한다.
공간 낙하/착지·elevation 투영, pause/resume과 character 입력, entity slot 재사용·scene reset,
렌더 보간/teleport, 기존 solver·clock·snapshot 혼합 거부도 포함한다.
최소 timestep에서도 0초/반 틱 입력이 물리를 진행하지 않는지, entity 삭제 직후 새 tick 없이 body 용량을 회수하는지도 검사한다.
`web_bridge::collisions::tests`는 collider enter/exit와 entity telemetry 독립성, planar/spatial sensor,
삭제·재사용 세대, enable/reset, native/public queue overflow와 full snapshot, query로 제거한 tile/surface identity를 검사한다.
Web 회귀는 잘못된 ABI/포인터, 실제 Wasm 메모리 확장 후 view 재취득과 삭제/overflow를 검사한다.
packed Chromium은 실제 64개 sensor pair에서 maxEvents=16의 native 누락 48/public 누락 1,
63개 active snapshot 복구와 다음 제거의 옛 세대 exit를 확인한다. 시간은 기록하되 밀집 성능 합격으로 해석하지 않는다.
`web_bridge::observations::tests`는 현재 접촉면의 양쪽 XYZ witness/category 방향과 whole-patch output 제한,
geometry query의 target 보존, 실제 solved impulse/마찰/접근 속도, tile/surface identity와 overflow,
frame 초반 terrain CCD와 마지막 tick 통계의 차이 및 제거 후 관측 보존을 검사한다.
Web은 실제 Wasm geometry/impulse/CCD와 포인터·capability·memory growth를 검사한다. FrameState는 native counters를
자동 제공하고 Runtime renderer 회귀가 overlay/profiler/trace 전달, 입력 수정에 대한 기록 보존과 native-only extrema를 검사한다.
packed Chromium은 64 planar body의 자동 native step 합계와 body gauge, 실제 XYZ 접촉면/충격량/제거 후 보존을 확인한다.
`engine::unified_physics::planar_tests`는 기존 2D component의 실제 Engine tick·질량/관성·force/impulse 1회 소비,
지면 착지/sleep·실행 중 수정·disable/enable·component 제거·세대 수명·invalid batch 원자성을 검사한다.
7종 legacy shape의 body-local 회전/offset은 기존 canonical ray와 native ray의 hit distance를 대조한다.
`physics3d::body_control_tests`는 명시적 질량, 회전 잠금의 직접 setter 우회 방지와 step 전 query 활성화를 검사한다.
발판 비활성화 직후의 접지 해제·공중 점프 차단은 character 회귀에 포함한다.
`physics3d::ratio_joint_tests`는 gear의 양수/음수/분수 ratio·여러 바퀴 회전, pulley의 비율/중력/slack,
기존 접촉과의 동작·침투/줄 길이/잔류 반동, frequency spring의 질량 정규화, ratio 파손/수명을 검사한다.
`engine::unified_physics::planar_joint_tests`는 기존 World 관절의 실제 Engine 결과, endpoint 변경·세대 재사용,
force/거리 파손, event overflow 뒤 재생성 방지, 기존 하중 진단과 turn count 보존을 검사한다.
`physics3d::continuous_hinge_tests`는 양방향 여러 바퀴 limit, position/velocity motor, 범위 밖 teleport 복구,
키네마틱 endpoint의 상대 회전, 접촉과 limit 동시 실행, 파손·하중·실행 중 갱신과 비활성화를 검사한다.
off-center anchor는 여러 시작각에서 일반/continuous hinge의 목표 속도와 anchor 오차를 함께 검사한다.
하중 회귀는 실제 외력 10·레버 길이 2·외부 토크 5에 대해 anchor force 10과 couple 25를 planar/spatial에서 검사한다.
외부 토크 5의 파손 기준 4/6, pulley의 off-center force와 couple 0, 재활성화 후 정상 하중도 함께 확인한다.
기존 World의 continuous_limit 연결·수정·파손·실패 원자성은 `planar_joint_tests`의 실제 Engine tick으로 확인한다.
`physics3d::spring_tests`와 `engine::unified_physics::planar_spring_tests`는 normalized Spring/Distance/Rope/Gear/Pulley의
실제 궤적·정적 하중에 따른 늘어남·반작용, 질량 배율, stiffness/damping 변경과 순수 감쇠를 검사한다.
두 계수 0 또는 frequency 0에서 자유 속도를 유지하는지, 느슨한 줄이 밀지 않는지, position-kinematic 목표 속도를 반영하는지도 포함한다.
invalid batch가 body 용량과 미소비 impulse를 보존하고, 실행 중 rigid/elastic/frequency 변경·파손이 identity를 지키는지 확인한다.
hinge/prismatic/weld는 stiffness 1일 때 유효한 damping 값으로 실제 구속을 유지해야 한다.
`physics3d::frame_spring_tests`와 `engine::unified_physics::planar_frame_tests`는 독립적인 선형/회전 탄성,
선택한 축만 zero gain으로 해제하기, local anchor의 힘과 couple, 파손 경계와 실행 중 rigid 복귀를 검사한다.
일반/continuous hinge motor가 limit에서 정지하고 반대 방향으로 다시 이동하는지,
회전된 slider 축·reference angle·motor/limit이 탄성과 함께 작동하는지도 확인한다.
`physics3d::contact_policy_tests`와 `engine::unified_physics::planar_contact_policy_tests`는 실제 컨베이어 이동/반전,
마찰 감속·반발 속도, 층·높이에 따른 접촉 여부와 sensor 전이, 고속 CCD, 즉시 ray/sweep/overlap 필터를 검사한다.
캐릭터 층 변경은 jump 처리 전 접지를 해제하며, 다른 층 캐릭터 사이에는 relative cast를 실행하지 않아야 한다.
평면 마찰은 Simplified/Coulomb 두 모델 모두 확인한다. vendor의 `tangent_mass_tests`는
rank 0/1 및 full-rank 역행렬과 큰 질량 배율을 검사하고, 상류 전체 lib 테스트도 회귀에 포함한다.
마찰·층 필터 단계 결과는 `artifacts/physics-3d/contact-policy-qa/report.json`에 보존한다.
접촉 보정 단계 결과는 `artifacts/physics-3d/contact-correction-qa/report.json`에 보존한다.
`contact_correction` 회귀는 공간/평면·두 마찰 모델의 위치/속도 보정 분리, cap/split/slop,
보정 0에서 접근 차단·반발 유지, live 변경/해제와 세대 정리를 검사한다. 실제 Engine에서는
네 가지 material scale, 전역 설정 변경, invalid batch의 impulse 보존과 중력 아래 stack 정착을 검사한다.
기존 default slop 0.01이 반영된 정착 위치를 검사하며, 과거 미적용 상태의 정확한 표면 위치와 혼동하지 않는다.
`solver_settings` 회귀는 중력 변경의 wake, 느린 충돌의 반발 threshold, 전체 CCD off,
실제 chain의 반복 횟수별 오차/에너지, Engine 자동 중지·수동 step·one-shot 설정 복구·고정 accumulator
보존·invalid 입력 원자성·spatial XYZ·씬 전환 설정 복구를 검사한다. 최신 전체 결과는
`artifacts/physics-3d/solver-settings-qa/report.json`에 기록한다.
`cargo test --manifest-path crates/ferrum-core/Cargo.toml query_tests`는 native 및 Engine 조회 회귀를 실행한다.
새 ray 전체 결과의 거리/identity 정렬·상한·compound 첫 표면, 점 조회의 실제 geometry·비활성화·잘못된 입력 보존을 검사한다.
Engine 회귀는 기존 ray/segment/point의 native 연결, render anchor 제외, category-only·sensor·height span,
fixture별 ray/엔티티별 point, 수정·삭제·세대 재사용, pending force/impulse와 fixed accumulator 보존,
실패 시 이전 solver fallback 금지, spatial XYZ 조회와 XY-only 거부를 검사한다.
조회 단계 전체 결과는 `artifacts/physics-3d/query-integration-qa/report.json`에 기록한다.
`shape_query_tests`는 native의 모든 sweep 결과·projection·deterministic overlap 상한과 Engine 영역/shape cast 각 5종을 검사한다.
회전된 target의 world surface witness/normal, mesh·heightfield·compound, 폭 0의 AABB, 이동 거리 0의 접촉,
nearest 내부 점·거리 경계·fixture offset·entity tie와 높이/category/sensor 필터를 확인한다.
기존 shape cast 결과는 표면점이 아니라 이동한 reference point여야 한다. 큰 world offset의 convex query,
잘못된 polygon·자기 교차 ring 거부, stale output 정리, native geometry 사용과 pending 입력 보존도 검사한다.
전체 결과는 `artifacts/physics-3d/shape-query-integration-qa/report.json`에 기록한다.
`engine::unified_physics::collision_event_tests`는 native contact/sensor를 기존 24-byte event로 전달하는 경로를 검사한다.
복합 fixture 중복 방지·마지막 접촉 종료, solid/sensor 동시 채널·실행 중 전환, 삭제/재생성 세대,
수동 step의 일시적 Enter/Exit 보존, 자동 중지/거부/0초의 가짜 Stay 방지와 프레임 전체 출력 상한을 확인한다.
상한 초과 뒤 전체 pair 복구, telemetry off에서도 아이템 획득, 실제 높이 분리와 visual offset 무관성,
기존 2D collider import·floor filter·query 시 component 제거도 포함한다.
`physics3d::event_tests`는 active snapshot의 전체성·정렬·삭제 반영과 조회가 전이 queue를 소비하지 않는지 검사한다.
전체 결과는 `artifacts/physics-3d/collision-lifecycle-qa/report.json`에 기록한다.
`contact_query_tests`는 즉시 접촉/manifold의 native·Engine 연결을 검사한다. 실행 전·직접 수정/삭제 후 접촉,
양방향 category/mask·sensor·floor·disable, 회전된 compound의 subshape/world witness, triangle/heightfield 지형,
query 전후 kinematic target·force·event 보존과 세대별 정렬/fixture 구분을 확인한다.
Engine에서는 깊은 2D box/polygon 겹침의 XY 법선과 실제 tick 분리, authored mass/inertia/impulse 보존,
최대 XY 치수의 extrusion, 첫 표면점과 최대 두 XY 점, visual offset 제외, stale output 정리와 XYZ 호출을 검사한다.
XY-only 결과로 표현할 수 없는 명시적 3D 법선은 오류가 관찰되어야 하며 조용한 miss로 숨기지 않는다.
extrusion 변경 후 기존 8단 stack의 두 split 모드 위치/속도 기준을 유지한다. 평면 solver는 중복 XY 접촉을 합치며,
두 마찰 모델에서 Z 반두께 0.5/1.7/100 변경이 질량·관성을 고정한 XY 운동에 영향을 주지 않는지 확인한다.
전체 결과는 `artifacts/physics-3d/contact-query-qa/report.json`에 기록한다.
위 geometry 조회 검증은 solver 충격량 검증을 대신하지 않는다.
`physics3d::contact_impulse_tests`는 두 마찰 모델·공간/평면·warm-start 계수·관절 substep 유무에 대해
보고 impulse와 실제 운동량 변화가 일치하는지 확인한다. 회전만 있는 충돌, CCD budget 1/4,
수면/sensor/삭제 후 과거 impulse 미재생, 수집 한도와 반복 조회가 운동을 바꾸지 않는지도 검사한다.
`engine::unified_physics::contact_impulse_tests`는 native/기존 authored body의 40-byte 결과와 소리 효과,
실제 접촉 fixture category, impact reporting과 feedback의 독립성, XYZ와 화면 투영, 여러 고정 tick의
frame 보고, 수동 step·실패·세대 재사용·overflow를 검사한다. 추가 회귀는 native 6개·Engine 7개이며
전체 검증은 `artifacts/physics-3d/contact-impulse-qa/report.json`에 기록한다.
위 충격량 검증만으로 CCD work/geometry나 solver 통계가 검증되는 것은 아니다.
`physics3d::statistics_tests`는 실제 CCD pair cast·pose clamp와 witness, sensor/mask/floor 제외,
compound 대 mesh, CCD off/시간 분할, 출력 상한과 동일한 운동, 수면/각운동/island gauge,
접촉 깨움과 자동 수면, 여러 관절 pass의 작업 합계와 이벤트 overflow에 독립적인 파손 수를 검사한다.
`engine::unified_physics::statistics_tests`는 step/frame 집계, 초기 tick CCD의 기존 디버그 선 버퍼 유지,
수동/실패/zero dt/조회/자동 off, XYZ 화면 투영·세대·native overflow, 기존 지표 초기화·sleep와 authored 파손,
실제 4,100회 clamp에서 4,096개 출력 한도와 누락 수를 검사한다. 신규 회귀는 native 9개·Engine 6개다.
전체 QA는 `artifacts/physics-3d/statistics-qa/report.json`에 기록한다. vendor CCD 경로 변경 때문에
기존 상류 CCD integration 6종과 pipeline counter target도 함께 검사한다.
이전 solver 전용 row-operation 수는 native에서 미측정이다. native 지표의 Web 공개 계약, 브라우저에서의
실제 native debug 렌더링의 현재 회귀 범위는 다음 단락을 따른다. 전투/projectile 이전과 공간 파티클 elevation 표현은 별도 수용 검증 대상이다.
`native_debug_` 회귀는7종 shape·13종 joint의 실제 pose/frame, parent/local teleport·convex/mesh/heightfield/compound 순회,
sensor/disabled/sleeping style, cached contact·CCD witness의 비소비, 지원하지 않는 형상과 line/work/sink/고정 stack 한도를 검사한다.
Sparse arena의 빈 slot도 work로 세고 geometry+retained frame CCD가 같은 예산을 쓰는지 검사한다. Contacts는 cached local 재투영이며
CCD는 이른 fixed tick·entity 없는 terrain을 포함한다. Native/frame 관측 누락도 truncated를 표시하는지 별도 Engine 회귀로 확인한다.
`unified_debug_` 회귀는 Engine cold component/terrain admission·예약 입력/clock 보존, XY/XZ/XYZ adapter·중복 flat 억제,
engine-only marker/depth·native admission 거절·truncation·off 정리·메모리 checkpoint의 geometry/statistics continuation을 검사한다.
SDK/renderer 회귀는 owned debug 통계·잘못된4u32/직접 setter·소비 guard와 passive 설정 허용·profiler 복사, 공간/flat 제출 선 합계와 기존 budget,
WebGL2/WebGPU depth/overlay·빈 truncated packet 상태를 검사한다. 전체 Rust/Wasm/WASI·실제 GL/GPU·packed browser 수용은 최종 root 기록을 따른다.
Core의65,536 work cap에 Engine cold import·spatial metadata 순회 비용을 넣지 않는다. Broadphase AABB를 BVH proxy로,
CCD marker를 전체 trajectory로, flat footprint를3D 렌더 검증으로 해석하지 않는다. 실게임·실기기 수용은 별도 후속 범위다.
`engine::unified_physics::gameplay_tests`는 실제 `Engine.update`에서 native pair 기반 피해,
이벤트 출력 off/overflow·compound 중복·entity 세대, XYZ 범위 피해와 보조 fixture category,
planar floor 필터, 넉백의 native 속도·다음 tick 운동·거부 시 원자성, 기존 authored 2D body 이전,
시각 offset에 독립적인 상호작용·3D 최근접 입력·once·비물리 marker 높이를 검사한다.
신규 회귀 12개와 전체 검증은 `artifacts/physics-3d/gameplay-qa/report.json`에 기록한다.
이 검사는 collision reaction과 근접 interaction 경로이며 projectile/melee/dash 또는 character 외력 수용을 증명하지 않는다.
`engine::unified_physics::projectile_tests`는 생성된 native 투사체의 실제 fixed tick 이동, pause/resume,
고속 구간 sweep·XYZ 높이·mask·planar floor/무범위 대상·source 제외·최근접 선택, native triangle mesh 벽,
수용량 실패 시 cooldown/spawn 보존, 수명·재설정·세대, 수동 hit 보존·첫 충돌 지점 정지, 기존 authored tile과의
최근접 판정, 기존 2D target, 물리 위치로 향하는 timer 발사 및 같은 tick의 pending authored pose를 검사한다.
두 공간의 교차 이동·같은 속도로 이동하는 뒤쪽 대상·XYZ 높이 교차·회전 막대·틱 내부 반전에 더해
native authored 지형의 다리 아래 통과/데크 충돌과 projectile flag를 검사한다. 틱 내부에서 출발 위치로 돌아오는 이동 발판과의 실제 충돌까지 Engine 회귀는 23개다.
`physics3d::step_motion_tests`의 11개 회귀는 움직이는 대상과 정지 query의 충돌 시점·world witness,
회전하는 offset fixture의 질량 중심, 초기 겹침, 삭제·세대·빈 world 후 재등록, mask/sensor/exclusion,
조인트 pass별 hit의 중복 제거와 limit, 위치 보정 후 경로 불변을 검사한다. 경로 기록 유무에 따라 120틱의
solver 상태·지속 힘·pending kinematic target·통계가 일치해야 한다.
추가로 solver가 한 바퀴 돌아 끝 자세가 같아진 경우와 가속도로 틱 내부에서 반전한 경우의 hit를 검사한다.
다회전 테스트는 backend의 fast-rotation opt-in을 사용하며 기본 각속도 상한을 변경했다는 의미는 아니다.
CCD 시간 구간을 1개/4개로 실행해 버려진 overshoot에서는 hit가 없고 승인된 경로에서는 hit가 있어야 한다.
진단 한도 1개가 넘쳐도 필수 motion 기록은 누락되지 않아야 한다.
`physics3d::body_control_tests::prescribed_kinematic_linear_motion_keeps_speed_while_dynamic_bodies_are_capped`는
두 공간과 두 kinematic 종류에서 6,000 units/s의 위치·속도가 두 tick 유지되고 dynamic의 400 × length_unit
상한은 유지되는지 확인한다. vendor 포함 검증은 `artifacts/physics-3d/projectile-qa/report.json`,
발사 직전 pose 수정 검증은 `artifacts/physics-3d/projectile-pose-qa/report.json`, 상대 운동 추가 후 검증은
`artifacts/physics-3d/projectile-motion-qa/report.json`을 따른다.
solver 내부 기록과 vendor callback 추가 후 검증은 `artifacts/physics-3d/solver-motion-qa/report.json`을 따른다.
`engine::unified_physics::terrain_tests`의 8개 회귀는 실제 tick에서 tile 강체 차단, cell 편집/삭제/generation,
Spatial ramp 높이·법선과 bridge의 underside, walkable deck 착지, admission 실패 시 기존 world/output 불변,
2D slope 선분·일방통행 상승/낙하, 빠른 상승/낙하 CCD, movement/projectile mask·논리 floor를 검사한다.
Spatial capsule이 authored one-way ramp를 오르고 삭제 시 접지를 잃는지, surface 순서를 바꿔도 handle을
보존하고 가득 찬 world에서 삭제 후 새 지형을 수용하는지도 확인한다. 지형 단계 검증은
`artifacts/physics-3d/terrain-qa/report.json`에 기록하며 기존 vendor 코드는 변경하지 않는다.
`engine::unified_physics::platform_tests`의 5개 회귀는 XYZ 이동·왕복 운반, query 사이의 지지면 handle 보존,
pause/자동 OFF/수동 틱/거절 시 phase 보존, 한 틱의 전체 왕복·운반 집계, 점프 해제·live path 수정을 검사한다.
`physics3d::kinematic_paths::tests`의 3개 회귀는 경로 분할 시 다른 target·지속 힘·관절 하중·CCD motion 시간,
잘못된 경로 거절과 pending target 보존, 120틱 단일 구간의 기존 step 대비 body 상태·통계 일치를 검사한다.
경로/운반 연결 검증은 `artifacts/physics-3d/platform-motion-qa/report.json`을 따른다.
`engine::unified_physics::platform_blocking_tests`의 6개 회귀는 벽에서 phase 정지/장애물 제거 후 재개,
천장 squeeze 방지·접지 유지, 두 발판의 상대 접촉, 틱 내 왕복 전 차단, 접근하는 승강기/천장,
대각선 운반의 첫 측면 접촉을 검사한다. `physics3d::kinematic_limit_tests`의 8개 회귀는
충돌 시점의 motion trace와 다른 body의 지속 힘/target, sensor·disabled·mask·floor 필터,
접촉면에서 이탈/접선 운동, 회전 막대, 두께 없는 mesh끼리의 sweep, one-way 상승/하강을 검사한다.
controller preview 유무에 따라 120틱의 점프·dynamic push·body/controller 상태도 정확히 일치해야 한다.
preview 쌍 검사는 실제 호출당 한 번 집계하고 backend CCD와 분리하며, 한 frame의 여러 틱에서 path 작업량을 합산한다.
검증 기록은 `artifacts/physics-3d/platform-blocking-qa/report.json`에 남긴다. path/preview 비용은 backend CCD에 합치지 않는다.
`physics3d::character_tests::rotating_rider_with_locomotion_meets_wall_in_one_tick`은 직접 각속도를 준 발판을
양방향으로 돌린다. 벽이 없을 때 캡슐이 지나가는 경로에 벽을 놓고 같은 틱을 실행한다. 캐릭터는 벽 앞의
접촉 여유를 유지하면서 남은 시간 동안 벽을 따라 걸어야 한다. 발판의 최종 회전은 벽이 없을 때와 같고,
캐릭터의 지지가 유지되며 실패한 충돌 검사와 누락된 접촉은 모두 0이어야 한다.
`physics3d::character_motion_tests`의 9개 회귀는 같이 움직이는 지지체/벽과 멀어지는 벽의 이전 위치 무시,
고속 접근 벽의 idle capsule 밀기·접선 보행 유지, 새 승강기 포착, sensor/mask/disabled/floor와 Planar 충돌 뒤 Z=0,
velocity-kinematic query 비용, COM/fixture offset 및 angular winding 경로, 움직이는 one-way를 검사한다.
Engine의 추가 co-moving 회귀는 8틱의 carry·phase·grounded·blocked·preview 비용을 함께 확인한다.
기존 opposing elevator/ceiling 회귀도 유지해 상대 response 도입 후 관련 경로가 함께 정지하는지 확인한다.
새 검증은 `artifacts/physics-3d/character-motion-qa/report.json`에 기록한다. 각 query의 native 기하학적 회전 경로가
맞다는 검사이며 backend 고속 회전/CCD 전체 수용을 증명하지 않는다.
`physics3d::character_squeeze_tests`의 9개 회귀는 외부 position/velocity 명령의 벽 압착 정지,
PlanarXy의 Z 고정과 비정상 접선 이동 방지, 양쪽 이동 벽·천장 아래 승강기, 소비된 명령의 재입력/재개,
20개 독립 이동체의 서로 다른 정지 시점, 다른 body의 힘/target·전체 틱 trace 시점,
preview 이후 점프/이동 입력과 translation 합산, 세 접촉면과 거의 평행한 면의 수치 조건을 검사한다.
기존 수평 발판 회귀는 막힌 탑승자 아래로 발판이 계속 이동할 수 있는지 확인한다.
Engine의 추가 external squeeze 회귀는 두 틱 frame의 실제 정지·진단 누적과 update(0)의 frame 초기화를 검사한다.
검증 기록은 `artifacts/physics-3d/character-squeeze-qa/report.json`이다. `kinematic_character_stops`는 틱 내
정지한 body 수이며, preview contact 비용은 sweep 시작 검사와 이전 접촉 갱신을 모두 포함한다.
20개 회귀는 기능 검사이며 밀집 시간/메모리 예산을 통과했다는 뜻이 아니다.
`physics3d::character_coupling_tests`의 9개 회귀와 Engine 회귀 1개는 공통 접촉 시점의 capsule 밀림 전달,
고정 벽 압착 정지, 자유 공간의 8/16/32명 연쇄 밀림, 접선 입력/PlanarXy 잠금, 비스듬한 벽,
멀리 있는 고속 body와 무관한 국소 허용 오차, 실제 이동으로 제한한 carry, 필터/비활성 body를 검사한다.
Engine은 실제 정지와 여러 틱의 preview 비용 합산·update(0) 초기화를 검사한다.
`character_preview_pair_contacts`는 pair당 검사 수, `character_preview_coupling_visits`는 참여자별 제약 방문 수다.
`character_preview_coupling_limits`는 풀이 한도에 도달한 preview 참여자 수이며 해의 부재나 성능 수용의 증거가 아니다.
검증 기록은 `artifacts/physics-3d/character-coupling-qa/report.json`이다.
상대 밀림의 dynamic impulse 결합 응답, dynamic carry, 회전 장애물 수용,
terrain 표시 보간과 밀집 비용 수용은 별도 미완료 항목이다.
투사체 sweep은 별도의 게임 query이며 Rapier pipeline CCD 진단 횟수로 더하지 않는다.
dynamic/velocity-kinematic은 각 실제 적분의 두 pose를 보간하므로 전체 pass에서 누적된 회전을 보존한다.
position-kinematic은 정확한 target의 pass별 보간이다. native CCD 자체의 고속 회전 한계와 position target의
내부 solver 근사와 authored tile/HD terrain의 밀집 비용 검증은 미완료다.
극단 각속도/충돌의 turn count 수용 검증은 남아 있다.
탄성 row와 공간 gyro·접촉·밀집 구속의 결합 검증도 별도로 필요하다.
이 결과는 Physics Spec 전체 이전·기본 backend 전환·Web API·Studio의 통합 검증을 대체하지 않는다.

Web bridge 회귀는 `engine::unified_physics::web_bridge::tests`, `unifiedPhysics.test.ts`,
`unifiedPhysicsWasm.test.ts`에서 설정 실패 원자성, stale/controller/rotation lock,
마지막 행 오류의 전체 거부, 실제 Wasm 이동, native 메모리 확장과 입력 alias를 검사한다.
`pnpm smoke:unified-physics-web`은 build 뒤 실행하며, 로컬 tarball의 공개 `/core`를 Chromium에서 불러온다.
64개 planar body의 Playing 상태·RAF/fixed tick·실제 이동량·Z 고정·잘못된 batch 거부와
native 설정에 맞는 frame mode/중력/고정 틱 표시를 확인한다.
64명 군중 장면은 일반 브라우저 프레임과 50ms 고정 입력으로 각각 검사한다. 고정 입력 검사는
새 브라우저 컨텍스트에서 가장 먼저 실행한다. 첫 프레임의 물리 5스텝을 포함해 81프레임 전체의
Rust 업데이트 최댓값이 125ms 이하여야 한다. 두 검사는 `native-crowd` 예산을 쓰며 첫 프레임을 뺀 warm 프레임의
Rust 업데이트 p95가 43ms 이하, native step당 p95가 11ms 이하여야 한다. 2026-11-22 로컬 Chromium 측정은
성능 개선 전 5스텝 프레임 p95 66~72ms·스텝당 13.2~14.4ms, wasm32 하드웨어 제곱근·캐릭터 쌍 정확 가지치기·
해석적 군중 회피·캡슐–상자 면 접촉 정확 계산 적용 후 28.3~28.9ms·5.66~5.78ms(일반 브라우저 프레임은 스텝당
6.75~7.3ms)다. 이 값은 회귀 방지선이고
60fps 수용 근거가 아니다. 405스텝 뒤 64명의 위치와 경로 탐색 통계를
기준 해시와 대조하고(해석적 군중 회피 적용으로 2026-11-22 갱신) 체크포인트 복원 뒤 6스텝을 재생한다. 보고서의
`nativeGameplayNavigationFixed50ms`에 첫 프레임 시간과 이후 프레임의 최댓값을 따로 기록한다.
`CI`의 `validate` job 및 `smoke:check`에 연결하며 원격 실행 성공을 주장하지 않는다.
보고서는 `artifacts/physics-3d/web-bridge-browser/report.json`이다.

저장·복원, 회전 충돌, 지형과 자원 결합은 `pnpm smoke:physics-sdk-integration`으로 검사한다.
`CI`의 `validate` job은 공통 빌드 뒤 이 검사를 실행하고 보고서를 artifact로 올린다.
배포용 Wasm과 Web SDK를 빌드한 뒤 실행한다. 현재 Rust 소스 지문을 확인하고 SDK를 패킹한 다음,
Chromium에서 그 패키지의 공개 API와 Wasm을 불러온다. 개발 중에는 필요한 이름만 지정할 수 있다
(`pnpm smoke:physics-sdk-integration rotation` 등). 전체 실행은 세 그룹의 결과와 패키지·Wasm SHA-256을
`artifacts/physics-3d/sdk-integration-acceptance/run-*/report.json`에 기록한다.

- `limits`는 실제 게임에서 캡처한 파일로 복원 한도의 경계와 필수 호스트 콜백을 확인한다.
  복원이 거부되면 원본 세션에서 게임을 계속 실행할 수 있어야 한다.
- `rotation`은 자세가 고정된 형상 이동 쿼리와 틱 도중 실제로 회전하는 바디를 각각 검사한다.
  회전 바디에서는 틱 양끝이 비어 있어도 중간에 장애물에 닿는 배치와 끝까지 비껴가는 배치를 대조하고,
  체크포인트 복원 뒤 같은 입력을 재생한다. 연속 틱 회귀는 회전 상자와 고정 구를 한 쌍 또는
  두 쌍으로 배치해 100ms 틱 32개를 실행한다. 첫 틱의 충돌 대상·시각, 매 수동 틱의 완료 횟수,
  복원 뒤 각 틱의 강체·충돌·진단 일치를 검사한다.
- `terrain`은 64·1,024·4,096셀 장면에서 물체가 벽에 닿아 미끄러지는 동안 PNG·WAV·수정한 JSON과
  WebGL2 렌더 타깃을 함께 저장·복원한다. 타일 ID, 바디 상태, 화면과 렌더 타깃의 픽셀,
  복원 뒤 6스텝의 재생을 확인한다.

`pnpm smoke:unified-physics-web`의 오류 복구 검사는 4,096면 지형과 빠른 상자로 실제 작업량 상한에
도달한다. 수동 실행 두 방식에서는 정상 CCD 틱을 먼저 완료해 둔다. 다음 틱의 진행 시간이 0초인
오류를 받은 뒤 직전 `step` 진단과 저장 파일 전체가 같은지 확인하고, 장애물을 제거해 물리를 다시 진행한다.

`web_bridge::spatial_tests`는 7종 shape 생성/제거·malformed payload의 무생성·XZ 보행·1회 점프·support,
잘못된 마지막 입력에도 기존 이동/대기 점프 유지, 해제·재설정·stale·Planar 입력 제약을 검사한다.
`unifiedPhysicsSpatial.test.ts`는 과대/중첩 형상·손실되는 index의 native 호출 전 거부와 character memory.grow를 확인한다.
실제 Wasm의 `unifiedPhysicsWasm.test.ts`와 같은 tarball browser gate는 spatial capsule 입력/접지/점프/제거도 실행한다.
이 검증은 Physics Spec/Studio 저작이나 공간 이벤트·쿼리·저장 전체 수용을 대신하지 않는다.
`web_bridge::command_tests`는 teleport의 즉시 투영, 고정 틱 target과 회전 잠금, 지속 force/clear,
선형·각 impulse·planar 축 잠금, sleep/wake, 늦은 오류의 무변경과 중복 명령 합산을 실제 body로 검사한다.
`unifiedPhysicsCommands.test.ts`는 capability·크기·수명 검사와 메모리 확장 전 두 입력 복사를 검사한다.
`unifiedPhysicsWasm.test.ts`는 두 공간 모드에서 같은 공개 명령을 실행하고 native view alias를 입력으로 재사용한다.
packed Chromium gate는 Playing/바디 2개/실제 RAF 소비 시간 대비 힘의 속도 변화, 목표 pose, force clear,
충격·sleep·잘못된 후행 명령의 무변경과 시간을 확인한다. 이 관측을 성능 budget 통과로 해석하지 않는다.
`web_bridge::queries::tests`는 5종 query의 거리/비율/geometry와 truncation, 즉시 생성·teleport·제거,
sensor/mask/exclusion/stale, 원래 tile id와 planar floor/height를 검사한다. pending target과 simulation clock을 소비하지 않는다.
`unifiedPhysicsQueries.test.ts`는 count/aggregate hit capacity·boolean·f32·convex 계약, 생략 floorId의 기본값 0,
네 입력 alias의 growth 전 복사와 output stride/summary bounds를 검사한다.
실제 Wasm 회귀는 mixed geometry·버퍼 재사용·memory.grow·세대 필터를 실행한다.
packed Chromium은 64개 mixed query/65 hits, closest/truncation, 대기 target 보존/다음 tick 실행,
삭제 직후 61 hits, 잘못된 후행 query 거부와 query 실행 시간을 검사한다.

| 변경 영역 | 검증 명령 | 유지할 기준 |
| --- | --- | --- |
| headless·공용 콘텐츠 | `pnpm smoke:headless`, `pnpm smoke:content-runtime` | 실제 native 상태와 lifecycle. mock 결과만으로 실행 성공 판정 금지 |
| Data Scene | `pnpm validate:data-scene-authoring`, `pnpm smoke:data-scene`, `pnpm smoke:data-scene-gameplay` | 적용/restore·stable instance id·실패 원자성·구 Wasm 진단·solid AABB actor의 HD-2D 이동 |
| 런타임 시작 | `pnpm smoke:data-scene`, `pnpm smoke:asset-loading` | 포장된 SDK의 이름 텍스처 실제 픽셀, WebGPU 요청의 WebGL2 대체와 실제 백엔드, 느린 요청 취소 뒤 프레임 0 |
| 런타임 캔버스 해제 | `pnpm smoke:data-scene`, SDK 테스트 | 전용 캔버스 생성·종료 20회 뒤 활성 WebGL2 컨텍스트 0, 시작 실패·취소 시 해제, 기본 경로 캔버스 재사용, WebGPU 구성 해제와 복구 중 재구성 방지 |
| Data Scene 화면 맞춤 | `pnpm smoke:data-scene`, SDK 테스트 | DPR 2의 두 캔버스 크기에서 사각형 비율·네 모서리 픽셀·포인터 변환·view 재사용, 실패 시 씬과 카메라 추적 복원 |
| clip·투영·태양 | `pnpm smoke:data-scene-presentation`, `pnpm smoke:sprite-animation-runtime` | 실제 frame UV·시간·이벤트·pause/완료·snapshot과 command/sidecar 정합 |
| 입력 context | `pnpm smoke:input-context`, `pnpm smoke:mobile-input` | packed 입력·modal 우선순위·release/cancel·pointer/viewport 좌표 |
| 공간 장면·전투 | `pnpm smoke:spatial-scene`, `pnpm smoke:hd2d-combat` | 높이/층·탐색·crowd·melee/dash·spawn·projectile의 native 진행과 bounded 작업 |
| 물리 작성·solver | `pnpm validate:physics-authoring`, `pnpm smoke:physics`, `pnpm smoke:physics-replay`, `pnpm smoke:physics-demo-suite` | 입력 검증, fixed step·query·joint/CCD 예산, 저장/replay 결정성 |
| gameplay 데이터·report | `pnpm validate:game-spec`, `pnpm validate:gameplay-authoring:report`, `pnpm smoke:gameplay-replay:report`, `pnpm validate:gameplay-report-artifacts` | report와 실제 실행·seed/hash·source/patch 근거 일치 |

`smoke:spatial-scene`의 아틀라스 재생은 실제 GameLoop에 50ms 간격을 여섯 번 입력해 프레임 1의 픽셀과 일시 정지를 검사한다.
`smoke:sprite-animation-runtime`은 0.1ms 미만 간격을 다음 RAF에 누적하는 동작과 경계의 프레임·이벤트를 검증한다.
이 검사의 JSON 애니메이션 진행 저장은 레거시 물리에서 실행한다.

물리의 상세 기능과 제외 범위는 [물리 기능 맵](../architecture/physics-engine.md)을 따른다.
선택형 replay Worker의 취소·stale 결과·종료 검증을 전체 게임 루프 Worker 이전의 증거로 사용하지 않는다.

## 브라우저 렌더·자원 수명

| 변경 영역 | 명령 | 핵심 기준 |
| --- | --- | --- |
| RenderTexture | `pnpm smoke:render-texture` | DPR 1/2, offscreen 1,024 sprite + main 1 sprite + fade의 3 draw, 픽셀 방향·상태 복원·resize·해제 |
| 자원 수명 | `pnpm smoke:gpu-resources` | 12회 씬 전환 후 warmup 기준값 복귀, resize·destroy와 profiler 예산 |
| 색공간 | `pnpm smoke:color-management` | legacy/linear-sRGB·alpha·조명·Bloom·fallback과 변환 중복 방지 |
| 로딩·오디오 | `pnpm smoke:asset-loading`, `pnpm smoke:spatial-audio` | 요청 공유·독립 취소·늦은 결과·resource 회수와 실제 native spatial binding |
| 셰이더 준비 | `pnpm smoke:shader-preparation` | 동기/비동기 픽셀 일치·실패 cleanup·runtime 로딩 UI. [상세 기준](shader-preparation.md) |
| 압축 텍스처 | `pnpm smoke:ktx2` | raw ESM/Vite, 실제 Worker·압축 upload·fallback·취소. [상세 기준](compressed-textures.md) |
| Spatial renderer | `pnpm smoke:spatial-webgpu-offscreen`, `pnpm smoke:spatial-webgpu-fallback` | 실제 backend별 geometry·모델·환경·효과·depth·OFF 복귀와 fallback |

### WebGPU 장치 손실 복구

`pnpm smoke:webgpu-recovery`는 실제 장치 손실 후 명시적 복구, 새 backend와 캐시 재준비,
픽셀 일치·기존 참조/handle 수명·재실패와 terminal destroy를 검사한다.
일시 정지한 평면 런타임에서 장치 손실 및 복구 중 캔버스 크기를 바꿔 복구 직후
최신 맞춤 배율·좌표 변환과 게임 카메라 위치를 확인한다.
빌드가 준비되어 있으면 화면 맞춤 사례만 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --fit-recovery-only --offscreen-target`로 실행할 수 있다.
자동 재시도 UI나 모든 실제 드라이버의 복구 성공을 보장하는 검사는 아니다.

## Studio 작성·저장·업데이트

| 영역 | 명령 |
| --- | --- |
| 기본 편집·씬 탐색 | `pnpm smoke:studio`, `pnpm test:placement-scenes`, `pnpm test:placement-layers` |
| 저장·문서 수명 | `pnpm smoke:placement-document-store`, `pnpm smoke:studio-save` |
| 공간 편집·조명 UI | `pnpm smoke:placement-spatial-workspace`, `pnpm smoke:placement-village`, `pnpm test:placement-point-shadows`, `pnpm test:placement-flat-lighting` |
| 대량 편집·host assets | `pnpm smoke:studio-mass-authoring`, `pnpm smoke:studio-desktop-assets` |
| 도구·Inspector·레이아웃 | `pnpm smoke:placement-tools`, `pnpm smoke:placement-inspector`, `pnpm smoke:placement-layouts` |
| 언어·격자·카메라 | `pnpm test:placement-locale`, `pnpm smoke:placement-locale`, `pnpm test:placement-grid`, `pnpm smoke:placement-grid`, `pnpm test:placement-camera`, `pnpm smoke:placement-camera` |
| 업데이트 | `pnpm test:updates`, `pnpm test:github-release`, `pnpm smoke:studio` |

production 기본 화면과 별도 fixture build를 구분한다. 기본 화면을 테스트 fixture로 덮어쓰지 않으며,
보고서는 `productionDefault`와 `regressionBuild`의 근거를 각각 남긴다.

- picking·편집·레이어 숨김/잠금·patch·Undo/Redo와 실제 native command/화면 변화를 확인한다.
- 문서 교체·취소·실패·공유 자산의 참조 수명, 미저장 draft 보존과 stale 응답 차단을 검사한다.
- 조명 UI는 PCSS·두 점광원·Bloom·안개·빛줄기·프로브·채널을 실제 native 값·픽셀·draw로 확인한다.
  source/Undo·Play/Stop·초점을 둔 입력의 저장/재열기·잘못된 값 복원·KO/EN·390px도 검사한다.
- 숨김 객체는 렌더와 picking에서 제외되고 bulk 필터를 사용해야 한다. 언어·격자·카메라 표시 변경은 문서/history를 바꾸지 않는다.
- 저장은 source 비교·허용 경로·외부 충돌·동시 수정·실패 시 원본/임시 파일 보존을 검사한다.
  일반 browser export와 개발 서버 opt-in, native 프로젝트 저장을 구분한다.
- 업데이트는 beta 숫자 비교·draft/불완전 release 제외·checksum/URL 범위·실제 임시 consumer 설치·hook 미실행·metadata/lock 복구를 확인한다.
  Studio Kit의 이전/새 URL이 문자열이고 실제로 갱신되는지도 검사한다.

native 저장 계약은 `cargo test --manifest-path apps/studio-desktop/src-tauri/Cargo.toml`로 확인한다.
GUI 의존성이 없는 headless 계약은 `--no-default-features`로 실행할 수 있으며 실행 범위가 다름을 기록한다.
`fakeBridge`·mock Tauri·Xvfb process launch는 실제 OS picker·저장·asset protocol·interactive canvas·서명 검증을 대체하지 않는다.

### 복구 가능한 프로젝트 Catalog 정리

`pnpm test:placement-asset-usage`, `pnpm smoke:placement-asset-usage`,
`pnpm test:placement-asset-cleanup`, `pnpm smoke:placement-asset-cleanup`을 실행한다.
읽기 전용 조회의 분석 범위를 명시하고 원본/draft·동시 변경·로드 중 자산·stale 결과를 교차한다.
정리 대상 allowlist, backup·복원·재열기·Undo와 부분 실패를 검사한다.
조회에 보이지 않는 코드/외부 manifest 참조까지 안전한 삭제로 판정하지 않는다.

## 도트·외부 에셋·타일

현재 가져오기 한도·형식·저장 의미는 [Scene Authoring](../../engine/data-scene-authoring.md)에 둔다.
아래 검사는 원본과 변환 결과를 구분하고 동일 경로를 재열어 게임에서 실행하는 것을 요구한다.

| 영역 | 명령 |
| --- | --- |
| Aseprite 원본·애니메이션·trim/slice | `pnpm smoke:aseprite-assets`, `pnpm smoke:aseprite-project`, `pnpm smoke:aseprite-animation`, `pnpm smoke:aseprite-trim`, `pnpm smoke:aseprite-trim-normals`, `pnpm smoke:aseprite-slices` |
| 노멀 생성·pair·native 저장 | `pnpm smoke:sprite-normal-integration`, `pnpm smoke:aseprite-normals`, `pnpm smoke:aseprite-paired`, `pnpm smoke:aseprite-paired-project`, `pnpm smoke:native-normal-project` |
| 도트 제작·원본 저장 | `pnpm test:pixel-authoring`, `pnpm smoke:pixel-authoring`, `pnpm smoke:pixel-project` |
| 선택 편집·합성·내보내기 | `pnpm smoke:pixel-transform`, `pnpm smoke:pixel-history`, `pnpm smoke:pixel-opacity`, `pnpm smoke:pixel-blend`, `pnpm smoke:pixel-indexed`, `pnpm smoke:pixel-clipboard`, `pnpm smoke:pixel-merge`, `pnpm smoke:pixel-animation-export` |
| 외부 PNG·노멀·용량 | `pnpm smoke:pixel-import`, `pnpm smoke:pixel-normals`, `pnpm smoke:pixel-normals-project`, `pnpm smoke:pixel-capacity` |
| Tiled/LDtk | `pnpm test:tile-assets`, `pnpm smoke:tile-assets`, `pnpm smoke:tile-project`, `pnpm smoke:tile-external`, `pnpm smoke:tile-multi` |
| 전체 맵·오토타일·애니메이션 | `pnpm smoke:tile-map`, `pnpm smoke:tile-autotile`, `pnpm smoke:tile-animation` |

확정 편집·Undo/Redo·취소·원본 불변, Worker의 늦은 결과와 종료, pair/revision의 설치 참조를 검사한다.
trim은 원래 canvas·offset·pivot을 복원하고 같은 공간의 normal과 맞아야 한다. 자동 crop으로 원본을 덮어쓰지 않는다.
맵 적용은 한 번의 patch/Undo이며 미지원 입력·예산 초과가 기존 문서/catalog를 변경하지 않아야 한다.

도트 recovery는 실제 IndexedDB에서 checkpoint 호환·용량/기간 상한·scene/project 격리·다중 탭·quota/abort·pagehide를 검사한다.
미확정 stroke/선택 preview는 저장하지 않고 실패 시 이전 완료본과 수동 내보내기를 보존한다.
이 결과는 OS 전원 종료 직전 미완료 write나 실제 WebView storage 정책의 보장이 아니다.
64프레임 용량 gate는 성공 여부뿐 아니라 편집·내보내기·native 재열기와 메모리 상한을 검사한다.

## Flat 2D 표현

| 영역 | 명령 | 기준 |
| --- | --- | --- |
| normal | `pnpm smoke:sprite-normal-2d` | 실제 Wasm clip·UV·flip/회전·alpha·DPR·조명 OFF·GL 상태 복원 |
| 9-slice | `pnpm smoke:sprite-nine-slice` | 경계·작은 target·flip·clip/normal 정합과 실패 원자성 |
| 픽셀 퍼펙트 | `pnpm smoke:flat-pixel-perfect` | 정수 배율·letterbox·pointer·camera shake·snap·simulation/replay 불변 |
| Studio 화면 맞춤 | `node tests/smoke/flat-pixel-perfect-viewer-smoke.mjs` | fit 문서 열기·미리보기와 실행·크기 변경 시 게임 카메라 유지·2D 편집 카메라와 선택 좌표계 복원·작성 이력 보존 |
| 도트 후처리 | `pnpm smoke:pixel-postprocess` | target 크기·색상 수·dither·alpha/HUD·OFF 복귀·해제 |
| 도트 예제 | `pnpm smoke:pixel-showcase` | 실제 source/UI·픽셀과 예산, consumer 도트 profile과 구분 |

픽셀 퍼펙트 브라우저 검사는 WebGL2와 WebGPU의 실제 출력을 비교하고 `linear-srgb` 사례에서 실제 WebGPU를 확인한다.
타일 맞춤 사례만 레거시 Shooter 스냅샷으로 카메라 위상을 설정한다. Wasm이 만든 타일 명령을 그려 이음새와 배칭,
렌더링 전후의 스냅샷 불변을 검사한다.
Studio 화면 맞춤 검사는 `pnpm smoke:flat-pixel-perfect`에 포함되며 준비된 Studio 빌드로도 실행할 수 있다.

### PNG 아틀라스 가장자리 보호 gate

`pnpm smoke:atlas-extrusion`은 PNG 가장자리 extrusion과 실제 browser sampling을 검사한다.
인접 프레임의 색 번짐·투명 여백·회전/flip·fractional UV, normal atlas 정합과 원본 보존을 확인한다.
extrusion으로 내부 텍셀 선택의 mediump 오차까지 해결됐다고 판단하지 않는다.
큰 atlas·모바일 GPU·DPR 검증은 [후속 검증](../../planning/feature-candidates.md#평면-2d-픽셀-표현아틀라스-실기기-검증)에 별도로 남긴다.

### 평면 2D 팔레트 스왑

`pnpm smoke:sprite-palette`는 실제 WebGL2/WebGPU·DPR 1/2의 source/target 색, alpha·normal·조명,
변경/비활성 복귀, 마지막 binding의 실제 draw와 미지정 atlas sampling 보존을 확인한다.
장치 손실 후 복구·warm 자원 plateau·destroy 0을 함께 검사한다. 단순 설정 round-trip만으로 통과시키지 않는다.

## 실게임 품질과 복구·맵 작성 회귀

`pnpm smoke:village-game-quality`와 `pnpm smoke:placement-village`는 실제 마을에서
이동·전투·지형·조명·오디오·카메라와 작성/실행 전환을 확인한다.
고립된 API fixture 성공과 실제 콘텐츠의 통합 성공을 구분한다.

Studio 마을의 렌더 예산은 일반 드로 호출 160, 방향광 그림자 호출 128, 모델 삼각형 60,000으로
각각 검사한다. 같은 편집 화면에서 관측한 201개 호출 중 99개는 방향광 그림자 호출이었다.
보행 검사는 통합 3D 캐릭터의 접촉 여유를 고려해 지면·다리·경사로의 높이와 장애물 정지를 검사한다.
마을 전투 검사는 적 32명을 배치하고 환경 효과와 모델 LOD의 네 조합을 각각 두 번 실행한다.
경사로 입력과 같은 게임 시계로 최소 2.5초를 측정하며 각 프레임의 실제 Rust 업데이트·렌더 시간도 기록한다.
이동 입력을 놓은 뒤에도 전투를 1초간 진행한다. 같은 정지 프레임에서 스크린샷 촬영과 체크포인트
복원을 검사하고, 복원한 시뮬레이션이 고정 틱 두 번에 해당하는 시간만큼 다시 진행되는지 확인한다.
프레임별 허용 범위는 Rust 업데이트 250ms 미만, 렌더 1,000ms 미만, 드로 호출 256회 이하, 모델 업로드 0바이트다.

### 실제 마을 성능과 LOD 외형

원본/LOD를 같은 camera·해상도·효과로 비교한다. pivot·외곽선·cutout·그림자와 전환 튐을 확인하고
CPU/GPU·draw·프레임 분포를 함께 기록한다. 삼각형 수 감소를 FPS 개선으로 간주하지 않는다.
Blender tree/pine 후보는 FPS 개선이 확인되지 않아 기본 예제에 활성화하지 않는다.
목표 기기·장시간·LOD 수용 검증은 [기능 후보](../../planning/feature-candidates.md)에 남겨 둔다.

## 예제·package consumer·배포

`pnpm smoke:example-site`는 빌드된 Pages(중첩 경로)에서 새 예제 사이트를 검사한다. 상단 막대(첫 화면 링크·문서·GitHub), 창 높이에 맞는 틀,
예제 목록 일곱 분류와 접기, 도구 링크(Studio 200 응답), 첫 화면 카드·썸네일, 검색과 `/` 단축키, 없는 예제(`?example=`) 안내,
옛 예제 주소 6개의 첫 화면 이동, 1024px 목록과 390/320px 서랍(초점 이동·Esc·바깥 누르기), 가로 넘침, 콘솔 오류를 확인한다.
브라우저 기본 언어, 선택 저장과 새로고침, 한국어·영어 검색, 영문 문서 링크, 320px 언어 선택과 영문 예제 화면을 확인한다.
예제 화면은 '스프라이트 그리기'로 확인한다. 카드에서 새로고침 없이 열리는지, 경로·목록 표시·인스펙터 설정 행, 5:3 캔버스 비율,
상태 막대의 엔진 수치(오브젝트 3·그리기 명령 11·드로우 콜 2), 설정을 바꾸면 그림과 씬 파일 탭의 표시 항목이 함께 바뀌는지,
언어 전환 중 캔버스와 그리기, 렌더러, 조작값, 열린 탭과 씬 JSON을 유지하는지,
캔버스 끌기, 엔진 탭, 리셋, 아래 패널 열고 닫기,
패널 경계선의 크기 조절(끌기·화살표·두 번 누르기, 8px 단위), 목록·인스펙터 접기와 아이콘 줄, 새로고침 뒤 유지, 좁은 화면에서 접힘을 쓰지 않는지, 렌더러 전환 시 새 캔버스로 다시 시작하는지(WebGPU가 없으면 WebGL2로 대신 실행),
렌더러를 전환하거나 예제를 떠날 때 런타임의 `releaseCanvasContext`로 이전 WebGL2 컨텍스트가 해제되고 그리기가 멈추는지 검사한다.
시작 후 0·50·250ms에 떠나는 경우와 텍스처 요청을 보류한 채 떠나는 경우를 확인한다. 보류한 요청은 시작용 `AbortSignal`로 취소되어야 한다.
뒤로/앞으로 이동, 1024/390/320px의 넘침과 쌓이는 순서를 확인하고, 세 예제의 씬 파일에 `display.fit`이 나타나는지 검사한다.
'충돌과 트리거'는 이전 예제의 '다음' 버튼으로 연다. 방향키로 움직여 에너지 수집, 벽 접촉, 빨간 구역 트리거 들어감·나감이 이벤트 탭과 상태 막대에 나오는지,
같은 안쪽 벽이 단단함일 때 막고 트리거로 바꾸면(씬 파일에 반영) 통과하며 트리거 이벤트를 내는지, '표시' 메뉴로 충돌 모양을 끄면 그림이 바뀌고 Esc로 닫히는지,
리셋을 확인한다.
'벽돌 깨기'는 그 다음 버튼으로 연다. Space로 발사해 첫 벽돌(brick_4_5)이 깨지고 점수·남은 벽돌이 바뀌는지, 일시정지 동안 그림이 멈추고 안내가 나오는지,
계속한 뒤 놓침으로 목숨이 주는지, 패들 너비를 바꾸면 씬 파일에 반영된 새 판이 시작되는지, 리셋과 떠날 때의 자원 해제를 확인한다.
`pnpm test:pages-build`는 사이트·Studio 빌드 누락이나 잘못된 HTML이 기존 Pages를 지우기 전에 거절되는지와 발행 구성을 확인한다.

이전 예제 앱은 공개하지 않지만 엔진 검사 데이터로 남아 다음 검사가 그대로 쓴다.
`pnpm validate:example-catalog`, `pnpm smoke:feature-examples`, `pnpm smoke:engine-playground`가 기능 실험의 native 상태·픽셀·상호작용·자원을 검증한다.
Start/Pause/Resume/Restart·P/Esc·터치 취소는 실제 native 시간/위치/HUD와 비교한다.
정지 중 게임 상태 불변, resize·letterbox pointer 좌표와 예제별 draw 예산을 유지한다.
Physics Lab의 `visibleBodyCount`는 조회한 body 수이며 화면 culling 측정값이 아니다.
`pnpm smoke:feature-examples`는 실험마다 제목·한 문장·볼 것과 해 보기, 닫힌 더 보기, 설명 탭과 씬 JSON·API·소스 링크, 게임 목록의 기능 전환과
`이 위치에서 실험`, 충돌 영역 다시 시작을 확인한다.
물리 실험실 smoke(`--mode=physics-sandbox`, `--mode=physics-demo-suite`)는 `physicsExamples.json`의 `knownIssue` 시나리오만
멈춤을 허용하고, 그 경우에도 화면에 오류가 표시돼야 한다.

package 변경은 `pnpm package:check` 또는 해당 package check로 tarball·declaration·Wasm·exports를 확인한다.
create-game/agents 변경에는 아래 생성/설치 검증을 추가한다.

```bash
pnpm package:check:create-game
pnpm package:check:agents
pnpm package:check:studio-kit
pnpm smoke:create-game-template-reports
pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke
pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke
```

- minimal/topdown/platformer/breakout의 실제 설치 tarball을 사용한다. workspace source import로 대체하지 않는다.
- 목적별 public subpath를 사용하고 내부 경로나 root aggregate 의존이 새로 생기지 않아야 한다.
- 생성 `studio.html`, `ferrum:studio`, `@ferrum2d/studio-kit`와 patch/handoff·공유 UI를 확인한다.
  consumer project와 consumer-smoke report는 Studio Kit 필드를 사용하는 version 2다.
- 실제 Playing 상태·entity·command·배경과 다른 픽셀을 확인한다. 12개 완료 render frame과 bounded readback 재시도를 기록하며,
  재시도 frame의 최대 draw도 예산에 포함한다. 잘못된 WebGL context·readback 실패를 성공으로 처리하지 않는다.
- 생성 프로젝트의 Vite 개발 서버와 배포 빌드를 각각 브라우저에서 확인한다. 개발 서버도 Wasm MIME·실제 프레임 기준을 적용하며,
  `developmentBrowser`에 기록한다. 공통 Vite 설정은 Wasm 상대 경로를 유지하도록 엔진 패키지를 사전 번들링에서 제외한다.
- deploy HTTP·Wasm MIME과 report artifact 검증을 수행한다. snapshot에 node_modules/dist를 포함하지 않는다.

릴리스의 SDK 네 tarball·Studio installer·checksum·서명/update metadata와 실제 native GUI 검증은
[GitHub Release 절차](../operations/github-release.md)를 따른다.
`pnpm test:github-release`, `pnpm smoke:github-release-install`, `pnpm smoke:local-engine-install`은
로컬 계약/설치 검증이며 원격 공개나 실제 OS GUI 검증의 증거가 아니다.

## 실패 기록과 증거 보관

결과에는 commit/dirty 상태, 명령·옵션, Node/Rust/Wasm/browser/backend, viewport/DPR, seed·hash,
성공·실패·skip, 실제/예상 metric, 실패 단계와 cleanup 결과를 남긴다.
미지원 capability·준비 실패·환경 부족을 성공으로 바꾸지 않는다. 실패 원인·영향·후속 조치를 함께 기록한다.

`artifacts/` 경로는 명령이 생성하는 로컬 출력 위치다. 문서에 경로가 있어도 현재 파일이 존재하거나 영구 보존된다는 뜻은 아니다.
진행 중 작업의 검토 자료와 실제 복구 backup을 유지하고, 완료 후 임시 설치·반복 로그는 정리한다.
과거 결과가 필요하면 해당 소스와 명령으로 재현한다. 화면 갱신은 [Screenshot 기준](screenshots/README.md)을 따른다.

## 조명·그림자 상세 회귀

Flat 기준선 `pnpm smoke:flat-lighting-contract`는 legacy 양 backend와 WebGL2 linear-sRGB를 DPR 1/2에서 검사한다.
검정/회색/흰 표면·빈 배경·cutout, 광원 A 차폐 시 B/ambient 보존·중복 union·HUD alpha·OFF byte 복귀를 비교한다.
legacy RGB 오차는 3 이내이며 GL premultiplied/GPU straight 차이는 각각의 독립 식으로 검증한다.
reference-only 수치 벡터와 실제 lit GPU 결과를 구분한다. 실패 주입도 부분 결과·해제·canvas 제거를 검사한다.
수학·합성 계약은 [Flat 합성](../architecture/flat-lighting-composition.md),
[Spatial 합성](../architecture/spatial-lighting-composition.md)에 둔다.
다음 세부 gate는 실제 픽셀·저장·자원 비용을 확인하며 실게임·실기기 수용은 별도다.

### Flat lit 표면 합성

최신 Wasm을 `pnpm build:wasm`으로 생성한 뒤 `pnpm smoke:flat-lit`으로 실제 양 backend의 legacy/linear-sRGB × DPR1/2를 검증한다.
색 수치·receiver/cutout·unlit 전경/HUD·광원별 차폐·OFF 비용·resize·기기 복구·destroy를 확인한다.
legacy 회귀는 `pnpm smoke:flat-lighting-contract`로 별도 유지한다. 보고서는 `artifacts/flat-lit-m2a/gpu-*/verification.json`이다.
두 명령은 `CI`의 `validate` job에서 실행하며 보고서를 artifact로 남긴다. 이 headless 검증은 소프트웨어 WebGPU의
offscreen readback을 사용하므로 실물 GPU 성능·native canvas 표시 보장을 뜻하지 않는다.

Starter Runtime을 빌드한 뒤 `node tests/smoke/feature-examples-smoke.mjs --lighting-only`로 조명 학습 예제만 검사할 수 있다.
양 backend에서 실제 normal 반응과 새 합성 선택의 픽셀 변화, legacy 복귀, 조명 OFF, 좁은 화면과 해제 후 자원을 확인한다.
이 회귀는 기본 `pnpm smoke:feature-examples`에도 포함되며 좁은 실행의 보고서는 `artifacts/flat-lit-m2a/example/`에 남긴다.


### Flat HDR 출력 회귀

`pnpm smoke:flat-lit`은 기존 SDR fixture와 함께 Flat HDR fixture를 실행한다.
좁은 재현은 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --hdr-only`다.
실제 양 backend의 legacy/linear-sRGB × DPR1/2에서 float radiance2/4, 어두운 albedo,
노출·세 toneMapping, 선형 source/data·tint·normal/cutout, alpha·다중 월드·HUD를 수치로 검사한다.
잘못된 setter/sidecar와 활성 월드 resize는 framebuffer를 변경하기 전에 거절해야 한다.
OFF identity·추가 pass/target0, float target bytes, warm plateau, resize·pixelPerfect·WebGPU recovery,
destroy 후 자원0을 확인한다. HDR output pass는 HUD 이후에도 프레임 통계에 남아야 한다.
전체 보고서는 `artifacts/flat-lit-m2a/gpu-*/verification.json`, 좁은 실행은 `artifacts/lighting-remaining/m3b/gpu-*/verification.json`이다.
`CI`의 `validate` job의 `smoke:flat-lit`에서 실행한다. 실게임·실기기 측정은 개발 완료 후 별도 진행한다.


### WebGPU 전역 선형 색공간 회귀

`pnpm smoke:flat-lit`은 SDR/HDR 행렬과 `webgpu-linear-browser-fixture.mjs`를 함께 실행한다.
일반 색·효과만 좁게 검사할 때는 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --color-only`를 실행한다.
양 backend × DPR1/2의 전체 RGBA readback을 비교하며 color/data/linear texture, 숫자 tint/material,
팔레트의 sRGB RGB8 키·선형 교체값, source alpha·투명 fade/vignette, Bloom threshold,
CRT/glitch/pixelArt와 효과 체인, PixelMaskTerrain 생성·patch·복구, pixelPerfect·resize·warm 자원을 검사한다.
managed 모드는 같은 backend의 기본 자원 위에 scene target1개(4 bytes/pixel)와 표시 draw1회를 추가한다.
기존 shadow fallback 같은 정적 attachment는 별도다. 이미지 업로드 texture는 target으로 집계하지 않는다.
표시 draw는 `postProcessDrawCalls`/전체 draw·texture bind에 포함하고 pixelPerfect에서는 확대 pass에 합친다.

`pnpm smoke:color-management`는 실제 WebGPU runtime의 authored 색을 Playing 상태와 native command로 검사하며
잘못된 설정/실제 adapter 초기화 실패의 fallback과 canvas 선택 경계를 유지한다.
`pnpm smoke:sprite-normal-2d`는 양 backend × 색공간 × DPR1/2에서 UV/flip/회전·가림·노멀 데이터·두 번의 장치 복구를 검사한다.

Spatial environment 회귀는 legacy/linear-sRGB 각각70개 상태 × 두 투영 × 양 backend × 두 화면 × DPR1/2다.
전체 `pnpm smoke:spatial-webgpu-offscreen`과 환경 전용 실행 모두 이 행렬을 유지한다.
선형 환경만 재현하려면 빌드 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --linear-environment-only --offscreen-target`를 실행한다.
normal/data texture, 모델 emissive/UV/reimport·저장/복원·그림자·AO/DOF/Bloom 성분 분리·HUD 뒤 최종 표시를 검사하며
허용 오차를 줄이거나 fixture를 생략해 managed 경로의 성공으로 대체하지 않는다. 실기기 성능·native canvas 표시는 개발 완료 후 별도 검증한다.


### Flat sprite Surface 재질 회귀

`pnpm smoke:flat-lit`은 SDR/HDR/색공간 회귀와 `flat-surface-browser-fixture.mjs`를 함께 실행한다.
좁은 재현은 SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --surface-only`다.
실제 양 backend × legacy/linear-sRGB × DPR1/2에서 roughness GGX 수치, zero/ambient identity,
HDR emission, raw A specular·G roughness, emission sRGB 단일 변환·독립 albedo, cutout·unlit 전경,
atlas/flip/회전·normal, 두 colored point와 A만 차폐·중복 union, map 재import·warm 자원,
resize·pixelPerfect·device recovery·destroy 자원0을 확인한다.
실제 Wasm authored Playing 상태·정렬40-byte sidecar·2-frame 애니메이션과 정적 UV의 전체 이미지 일치,
안정적 asset 이름의 JSON 저장·fresh handle 복원 후 pixels 일치를 함께 검사한다.

SDK 단위 회귀는 atomic native batch·잘못된 ABI/범위/alias·memory growth·deferred copy,
잘못된 asset/profile 복원 전 기존 씬 보존·patch/Undo/Redo·map cache 무효화를 검사한다.
placement 사용처·cleanup은 세 map 이름/숫자 참조를 보호하며 desktop native cleanup도 검사한다.
단독 GPU 보고서는 `artifacts/lighting-remaining/m4b/gpu-*/verification.json`이다.
전체 명령은 `CI`의 `validate`의 `smoke:flat-lit`에 연결되며 software adapter를 실물 성능 검증으로 세지 않는다.


Placement layer 브라우저 회귀는 개별 predicate뿐 아니라 root/child page의 locator action에도 기존 smoke timeout을 적용한다.
별도 page 정리는 같은 시간 안에 종료하며 앞선 assertion 오류를 보존한다. `pnpm test:placement-layers`는
닫기 거절·응답 없는 닫기와 기존 오류 보존을 함께 검사한다. 이 검사는 `CI`의 `validate`에 포함된다.


### Flat 독립 수신 mask 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --masks-only`로 좁게 실행한다.
`pnpm smoke:flat-lit`의 기본 행렬과 `CI`의 `validate`에도 포함된다.
양 backend × 두 색공간 × DPR1/2, SDR/HDR에서 light0/shadow0/일부/모든 채널,
점광원·태양 차폐 독립성, ambient/emission·bounded reflection, cutout/unlit 전경,
다중 packet·기본/OFF 추가 target/pass0와4-byte identity target 비용, invalid 원자성을 검사한다.
실제 Native Playing/sidecar와 JSON fresh-handle 복원 pixels, resize/pixelPerfect·device recovery·destroy도 확인한다.
단독 보고서는 `artifacts/lighting-remaining/m4c/gpu-*/verification.json`이다. 실기기 성능 증거로 확대하지 않는다.

공식 앱의 lit host 회귀는 `pnpm smoke:studio`에 포함된다. SDK/app build 후
`node tests/smoke/placement-tool-ui-runner.mjs --flat-lit`로 좁게 실행할 수도 있다.
실제 앱에서 lit 문서를 초기 적용하고 color/data 업로드, mask 편집 pixels, 늦은 map 역할 로딩,
실패한 preflight의 문서·handle·pixels 보존, 탭 복원과 Playing을 검사한다.
`pnpm test:placement-flat-lighting`은 열린 Flat/Spatial 문서의 색/data 역할 충돌·숫자 ID를 검사하며,
SDK build가 끝난 `smoke:studio` 단계에서 실행한다. 초기 scene discovery 검사는 SDK 산출물을 요구하지 않는다.

### Spatial 독립 수신 mask 회귀

SDK/Wasm build 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --receiver-masks-only --offscreen-target`로 실행한다.
기존 `pnpm smoke:spatial-webgpu-offscreen` 기본 행렬과 CI validate에 같은35개 상태를 포함한다.
양 backend·legacy/linear-sRGB·직교/원근·가로/세로·DPR1/2에서 terrain/billboard/model의
light0/shadow0/default255/부분 채널과 점광원/태양 그림자 독립성을 픽셀 기준 참조와 비교한다.
ambient/hemisphere·emission·GGX·unlit/cutout·separated AO/fog/Bloom·HUD 보존과
수신 mask를 바꿔도 caster work가 유지되는지 확인한다. 같은 asset의 서로 다른 model mask는 color instancing을 나눈다.
OFF 원본 설정의 표시 비활성, warm GPU allocation0·upload 예산, JSON fresh-handle 복원,
resize 왕복과 WebGPU loss/recovery도 검사한다. 보고서는 기존 spatial GPU `run-*/report.json`의
`environmentCases[].masks`와 `receiverChecks`에 기록한다. 소프트웨어 adapter 결과는 실기기 성능 검증으로 세지 않는다.

SDK unit은 새 receiver ptr/count/align/range·부분 ABI·memory growth·소유 복사, 생성 billboard가 authored 한도를
넘는 경우의 metadata 정렬, v7 source/selected 채널·OFF/invalid 원자성·구 Wasm의 cold 거절,
v8 patch/Undo/Redo·실제 Native Playing·JSON 새 handle 복원, 동적 uniform 할당 실패/기기 한도/수명과
color/shadow model batch 분리를 검사한다.

### Flat 2D spot 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --spots-only`로 실행한다.
기존 `pnpm smoke:flat-lit` 기본 행렬과 같은 `CI`의 `validate`에도 포함한다.
양 backend·두 색공간·DPR1/2·SDR/HDR에서 원형360도 identity, 방향 안/밖과 penumbra,
타원 반경과 작은 방향의 world→ground projection, diffuse/GGX·emission·cutout/HUD 보존,
광원별 차폐·독립 수신 mask·선택 해제·실패한 setter 상태 보존·OFF 추가 pass/target0,
resize·WebGPU device recovery·destroy 자원0을 픽셀 비교한다.
새 Spot 보고서는 `artifacts/lighting-remaining/m4d/gpu-*/verification.json`이다.
SDK unit은 null/범위/벡터/float32 aspect·비활성 검증, JSON source와 실제 Native Playing·새 handle 복원,
구 legacy14/lit18 row의 channel/cone slot 정합성과 view 투영을 검사한다. 실제 장치 성능은 이 software adapter 결과로 판단하지 않는다.

### Flat 2D cookie 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --cookies-only`로 실행한다.
기존 `pnpm smoke:flat-lit`과 `CI`의 `validate`의 기본 행렬에도 포함한다. 보고서는
`artifacts/lighting-remaining/m4d/cookie/gpu-*/verification.json`이며 양 backend·두 색공간·DPR1/2·SDR/HDR을 검사한다.
raw R*A의 수치 기대값, white identity·black 직접광0, rotation·UV flip·atlas 경계,
동일 이미지의 광원별 서로 다른 uniform offset, spot·수신 mask·광원별 그림자,
ambient/emission/GGX 독립성, 실패 setter 원자성·다중 packet·OFF·warm bytes·재import·resize·복구·destroy0을 비교한다.
GL은 불완전 외부 unit6 texture/mip sampler를 바인딩해 상태 복원과 기본 draw의 validation도 확인한다.

SDK unit은 source JSON·OFF·범위/float32 UV·뷰 투영과 이름→ID, 실제 Native Playing·새 handle 복원 시 재매핑,
구 capability 거절 후 자산 조회/native mutation0, invalid hash 보존을 검사한다.
GPU helper unit은32행 한도·동적 offset·warm 재사용·view 교체/퇴역, 동기 group/write 실패 재시도,
비동기 scope 실패의 자원 회수·오류 유지·destroy 수명을 검사한다.
Ferrum2D Studio의 `--flat-lit` 검사는 named cookie의 cold/늦은 data 역할, raw straight R*A 픽셀,
role 충돌 뒤 문서/handle/pixels 보존, 탭·Playing·원본 export를 검사한다.
`test:placement-flat-lighting`과 `test:placement-asset-usage`는 OFF/numeric cookie 역할과 정확한 asset pointer를 검사한다.
실게임·실기기 성능은 별도 수용 검증에서 확인한다.

### Flat 볼록 다각형 차폐 회귀

SDK build 후 `node tests/smoke/flat-lit-browser-smoke.mjs --polygons-only`로 좁게 실행한다.
기존 `pnpm smoke:flat-lit`과 `CI`의 `validate`의 기본 행렬에도 포함한다. 전용 보고서는
`artifacts/lighting-remaining/m4d/polygon/gpu-*/verification.json`이며 두 backend·색공간·DPR1/2·SDR/HDR에서 검사한다.
독립 ray/edge 교차 기준으로 body·그림자/비차폐 영역의 픽셀을 비교하고 raster edge의 작은 경계는 제외한다.
양 winding·max-union/부분 투과율·독립 광원/수신 mask·emission/GGX·spot/cookie·cutout/HUD,
사각형 후방 참조·내부/먼 도형 제외·in-place edit/fresh 참조·잘못된 setter 원자성·OFF/warm bytes·world 투영·resize·복구·destroy0을 검사한다.

SDK unit은 희소/교차/오목/중복/collinear/f32 퇴화·개수/좌표/투영 한도, warm shape match 검증 우회,
소유 복사·static CPU geometry revision·최대72-float clip 상한, source JSON·patch/Undo/Redo·실제 Native Playing·새 handle 복원,
구 capability 거절 후 asset lookup/native mutation0을 검사한다. Ferrum2D Studio의 `--flat-lit`은 도형 cold apply pixels와
source export·invalid import 뒤 씬/handle/history 보존·다중 문서 왕복을 함께 검사한다.
정적 GPU geometry 캐시 회귀도 같은 fixture에 포함한다. 두 광원의 warm 업로드0·vertex 양수·실제
픽셀 동등성을 검사하고, 실제 renderer 통계를 budget evaluator에 넣어 cold 업로드와 미측정을 거절한다.
여러 command packet의 vertex 합·HUD 뒤 보존·OFF·복구·destroy0을 함께 확인한다. mask draw는 계속 수행한다.
SDK unit은 GL32-source/2 MiB 한도 밖 fallback의 광원 보존·bounded 재진입, WebGPU32-source 밖 fallback,
geometry/색 무효화와 할당·쓰기 실패 후 이전 씬/재시도를 검사한다.
`FERRUM_FLAT_LIT_ARTIFACT_PARENT`로 보고서 상위를 지정할 수 있다. 선택형 `FERRUM_FLAT_LIT_PREPARED_PACKAGE`는
검증할 `dist/pkg` package snapshot을 고정한다. 보고서 `runtimePackageRoot`를 source 증거와 함께 기록하며,
미지정 시 workspace package를 읽으므로 실행 중 SDK를 다시 빌드하지 않는다.

### Native 광원 전환 회귀

`cargo test --manifest-path crates/ferrum-core/Cargo.toml light_selection`은 opt-in v8 source와
최대4개 native 슬롯의 경계 왕복·hysteresis·fade-out/swap/fade-in·전환 반전·큰/극소 dt를 검사한다.
fade 마지막 구간의 f32 나눗셈 반올림 뒤에도 capture가 restore 가능한 phase/weight를 유지하는지 확인한다.
render preview/반복 build·zero step·pause·render 생략은 이력을 진행하지 않으며 fixed-step 분할 결과가 일치해야 한다.
simulation pose로 선택하고 interpolation pose로 제출하는지, stale generation·재binding·camera cut·명시적 reset,
global OFF와 config OFF·v7 기본 동작, 같은 source/노출 편집의 이력 보존을 검사한다.

`cargo test --manifest-path crates/ferrum-core/Cargo.toml compound_light`는 normal/combat motion과
광원 history를 함께 복원하며 잘못된 history가 pose/source/기존 history를 바꾸지 않는지 확인한다.
SpatialScene clear 뒤 orphan history를 설치하지 않고 fresh handle로 combat/pose를 재매핑하는지 검사한다.
SDK의 `spatialLightSelection*.test.ts`는 source v8 ON/OFF·예약/범위·구/부분 Wasm의 자산 조회 전 거절,
diagnostic pointer/길이/슬롯/가중치·동일 buffer alias와 memory grow 뒤 재취득,
patch v9 guard·public 타입과 history JSON 소유 복사를 검사한다. 실제 Wasm에서 exploration/combat 중간 fade를
v11 JSON으로 저장하고 fresh runtime에 복원해 native history·선택 채널·감쇠 값을 비교한다.
signature/source/weight/누락/구 save version 거절 뒤 이전 progress 불변, pause 보존·정상 수렴·reset·clear도 확인한다.
실제 양 backend 전환 픽셀·profiler/report 연결은 다음 전용 gate로 검증한다. 실게임·실기기 수용 검증과 구분한다.

`pnpm smoke:spatial-light-selection`은 packed public API + 실제 Wasm의 controlled RAF clock으로
두 backend·색공간·직교/원근·DPR1/2·가로/세로 viewport·일반/pinned shadow 정책을 검사한다.
19상태의 initial/경계 왕복/각 fade leg/중간 저장·fresh handle 복원/pause/source edit/reset preview/OFF/
16 source/4 slots/resize를 실행하며, 작성된 원본 광원·native weight로 다시 만든 v7 기준 화면과 픽셀을 비교한다.
WebGPU는 동일 native history/packet의 장치 복구 픽셀도 비교한다. geometry upload0·pinned shadow warm pass0,
source별 사유와 실제 counter·resource 해제를 검사한다. 이 행렬은 기존 기본 `smoke:spatial-webgpu-offscreen`과 CI에 포함된다.
기본 viewport는640×360 CSS px 이내이며 DPR/viewport 행렬을 사용한다. 실물 장치의 실행 시간 예산을 뜻하지 않는다.

Node의 `spatial-light-selection-report.mjs`는 PNG 증거에서 fade-out/in의 실제 변화가 각각64 pixel을 넘고,
중간 복원·pause 그림이 정확히 일치하는지 추가 검사한다. 빈/변하지 않는 렌더가 상태·reference 비교만으로
통과하지 않도록 별도 negative gate test를 실행한다. 단계별 수치와 원본 PNG는 보고서에 남긴다.
실게임·실기기 수용 검증과 구분한다. shadow 작업 예산과 넓은 Bloom의 자동 검증은 각각 해당 회귀 절을 따른다.


native contribution 회귀는 `smoke:spatial-light-selection` 기본 행렬에 RGB0/direct mask0/frustum 밖
제외·실제 화면 조명 개선·dim high-intensity와 bright source 순위 대조를 추가한다. pinned owner 보존과
policy OFF의 구 순위를 같은 public source로 비교한다. authored/weight 기반 v7 픽셀 참조도 유지한다.
Native unit은 disabled v8/정확한 v7 순위, 보수적 frustum 경계·near/eye 교차·큰 반경과 pinned history 복원을 검사한다.

같은 행렬은 pixelArt512×64/64×512·snap 전환을 simulation update로 진행하여 base frustum과 실제 표시
frustum의 선택 불일치를 검사한다. native 실패 재현은 첫 render 이전 seed부터 검증한다.
좁은 재현은 SDK/Wasm build 후 `node tests/smoke/spatial-webgpu-browser-smoke.mjs --offscreen-target --light-selection-presentation-only`다.
이 좁은 경로는 저장/복구를 수행했다고 보고하지 않으며, 해당 증거는 원래 전환 행렬에서 유지한다.

Presentation PNG gate는 wide view의 빨간 edge receiver가64pixel보다 많이 실제로 비춰졌는지도 검사한다.
빈/무변화 화면을 거절하는 negative unit은 기존 `test:spatial-light-selection-report`와 기본 offscreen CI에 포함된다.

### Spatial 넓은 HDR Bloom 회귀

`pnpm smoke:spatial-wide-bloom`은 패키지 public API와 실제 Wasm으로 선택형 `bloom.mode:"wide"`를 검사한다.
기존 gather는 유지하며 입력·효과 순서·비용은 [넓은 HDR Bloom 계약](../../engine/data-scene-spatial.md#선택형-넓은-hdr-bloom-개발-소스)을 따른다.
기본 `smoke:spatial-webgpu-offscreen`에도 같은 행렬과 `test:spatial-bloom-report`를 포함한다.
`CI`의 `validate`가 그 aggregate를 실행한다.

두 backend·두 색공간·직교/원근·DPR1/2·가로/세로 viewport에서 기본/안개/안개+AO의 각28상태를 검사한다.
안개 variant도 노출을 낮춘 post-fog HDR source를 독립 기준으로 사용하므로 geometry fog와 AO resolve fog 뒤의
Bloom 입력을 각각 검증한다. 안개만 좁게 검사하려면 빌드 후 `--offscreen-target --wide-bloom-fog-only`를 사용한다.
작은 HDR source와 sharp/gather/low/balanced/high, warm 재사용, strength0/OFF, threshold 소거,
exposure, 분수 반경37.5, 홀수127×95, resize 왕복, pixelArt 내부64×64 nearest 확대,
동일 frame 재제출·HUD, fresh state12 복원·구 저장 downgrade 거절, WebGPU 복구·clear/재활성화를 포함한다.
별도 합성 probe는 AO/fog/DOF 뒤 threshold와 HUD 경계·resize/복구를 검사한다.

Node gate는 기록한 PNG를 다시 해독한다. 노출을 낮춰 캡처한 HDR 입력에서 색 변환을 역산하고,
threshold를 각 source에 적용한 뒤 수직→수평 순으로 계산하는 독립 CPU 기준과 비교한다.
GPU는 수평→수직 순이다. 양자화 오차3 이내 일치, gather 반경 밖 실제 halo64pixel 초과,
입력의 비어 있지 않은 비포화 신호, OFF identity·저장/복원·복구 identity를 요구한다.
원근 홀수 extent에서 원본 raster edge가 backend마다 다르면 각 입력에 대한 oracle 차이0을 별도로 요구한다.
추가 binary-fraction source는 backend 입력 동일과 oracle 차이0을 모두 요구해 filter 오차를 이 분류로 숨기지 않는다.

품질별 실제 dedicated draw/target 수·알려진 texel bytes·texture-load 작업 상한을 공개 stats와 비교하고,
warm texture/buffer/pipeline/bind-group 할당0, OFF 추가 target/pass0, destroy 자원 해제를 검사한다.
동일 frame 두 packet의 draw/fetch 합산·target footprint 최대값과 Flat HUD 뒤 metric 보존도 확인한다.
빈 화면·halo 부재·누락 metric·warm 할당을 성공 flag만으로 통과시키지 않는 negative unit을 실행한다.
보고서는 기존 spatial GPU `run-*/report.json`의 `wideBloomCases`와 PNG다.

SDK unit은 environment v9 numeric584의 selection 존재 bit·예약 영역·raw/OFF 범위,
구 core의 자산 조회 전 거절, patch10 Undo/Redo·downgrade, state12의 exploration/combat history 원자 복원을 검사한다.
양 backend의 부분 target 할당 실패/쓰기 재시도·비동기 GPU 실패와 warm/OFF/destroy도 별도로 검사한다.
소프트웨어 adapter의 픽셀·작업량 검증이며 실게임·실물 GPU의 ms/FPS·품질 수용은 별도로 검증한다.


### Spatial 다중 점광원 그림자 회귀

`pnpm smoke:spatial-point-shadows`는 public 패키지·실제 Wasm과 WebGL2/WebGPU로
선택형 `lighting.pointShadows` 최대 2개를 검사한다. `test:spatial-point-shadows-report`의 독립 PNG 판정기
음성 테스트를 먼저 실행한다. 전체 `smoke:spatial-webgpu-offscreen`에도 같은 회귀와 판정기를 포함하며,
`CI`의 `validate` job이 해당 aggregate를 실행한다.
`validate`는 `extended_browser_smoke` 입력과 무관하게 실행된다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근을 교차한32 backend context에서976개 상태를 검사한다.
빨강·파랑 광원을 각각 차폐한 기준과 두 그림자 결과를 비교하고, 다른 광원·ambient·초록 발광 재질이 보존되는지
PNG를 다시 읽어 판정한다. terrain·cutout billboard·인스턴싱 모델2개, hard/PCF3, mask, 태양 그림자 동시13 pass,
16개 작성 광원의 owner 고정, legacy 단일/배열 단일, OFF 설정·state13 복원, resize/pixelArt,
다중→단일 설정 직후 프레임 재생성 전 모델 위치 조회,
WebGPU 실제 장치 파괴 후 복구를 포함한다. 정적 warm frame의 shadow draw/upload0과 해제 후 자원0을 요구한다.
WebGL2는 두 번째 cube 크기를 바꾼 직후 렌더 실패를 주입하고, 같은 프레임의 재시도가 해당6면을 다시 그리는지 검사한다.
SDK 회귀는 첫 cube·두 번째 cube·sun 타깃 각각의 실패 후 재시도, WebGPU abandoned encoder와 성공 후 warm 재사용을 확인한다.
실제 Wasm frame의 terrain stream을 native pointer/길이/revision이 같은 동안만 유지해 광원별 cache를 검사한다.
점광원 이동/개별 해상도6면, sun 이동/추가1면, sun 제거·sampling-only0면, owner 교환12면,
공통 caster revision/alpha texture 교체13면을 요구한다. 매 상태마다 동일 geometry의 terrain stream만 새로 만들어
강제 cold 전체12/13면 기준을 얻고 부분 갱신 PNG와 RGBA 전 채널을 비교한다.
Node 판정기는 cold PNG 누락·불완전 전체 갱신·stale pixels·잘못된 cache flag·초과 갱신도 거절한다.
model staging 단위 검사는 camera+선택 owner pass만 업로드하는 실제 byte 수를 확인한다.
같은 terrain buffer/revision에서 byteOffset만 다른 view를 제출해 GPU 업로드와 전체 cold PNG 일치를 검사한다.
SDK 회귀는 길이만 바뀌는 view도 확인하며, 효과 없는 Spatial frame의 고정 model cache 배열 할당은0이어야 한다.

보고서는 spatial GPU `run-*/report.json`의 `pointShadowCases`와 PNG다.
소프트웨어 adapter 실행은 실물 GPU 또는 제품 시간/FPS 수용 결과로 해석하지 않는다.
기존 단일 점광원·태양 그림자 회귀는 `--offscreen-target --shadows-only`로 별도 실행할 수 있다.

`pnpm test:placement-point-shadows`는 광원 삭제 후 인덱스와 설정 보존, 두 owner 상한·활성 예산,
Low/Balanced/High 품질 전환을 검사한다. `pnpm smoke:studio`와 CI에 이 단위 검증을 포함한다.
`pnpm smoke:placement-spatial-workspace`는 실제 Spatial 조명 패널 검증을 포함하며 기존 CI에서도 실행한다.
실제 패널에서 독립 offset, 세 번째 제한, Low 품질, owner/nonowner 삭제·Undo/Redo와 native 환경v10/592를 확인한다.

### Spatial 태양 PCSS 회귀

`pnpm smoke:spatial-sun-pcss`는 `test:spatial-sun-pcss-report`의 PNG 판정기 음성 테스트 뒤
public tarball·실제 Wasm·WebGL2/WebGPU를 실행한다. 전체 `smoke:spatial-webgpu-offscreen`에도
같은 테스트와 PCSS 행렬이 포함된다. `CI`의 `validate` job이
해당 aggregate를 실행하며 `extended_browser_smoke` 입력과 무관하다.
브랜치 push만으로 해당 GPU 회귀가 자동 실행된다는 의미는 아니다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근·두 backend의32 context에서1,040개 상태를 확인한다.
수평 shadow-only 모델의 접촉0.25/중간16/분리64 world 높이, 얇은2-unit caster,
각도0/1/5·반경 제한2/16/32·해상도128/256/512/1024를 사용한다.
Node 판정기가 저장 PNG의577개 world-space 수신점 profile을 다시 읽어 접촉보다 분리 그림자가 넓고,
고정 PCF3와 구별되며 각도·반경 제한이 실제 픽셀에 반영되는지 요구한다.
각도0은 hard와 같은 PNG여야 한다. 노이즈 없는 고정 kernel의 warm frame과 카메라 복귀는 픽셀이 같아야 한다.
고정 sun center와 기본 camera-target 추적 모두 subtexel 카메라 이동은 depth map을 다시 그리지 않으며 같은 world profile의 폭을 유지한다.
경사/곡면 모델은 녹색 재질로 수신 영역을 구분해 독립 no-shadow PNG와 비교하고 self-shadow acne를 제한한다.

태양의 빨강 성분만 PCSS로 바꿔도 두 점광원의 초록/파랑은 그대로여야 한다.
sampling-only는0 shadow pass, 태양 해상도 변경은1, 두 점광원과 태양의 cold frame은13을 요구한다.
state14의 새 엔진 복원, 조명 OFF/재활성, WebGPU 장치 파괴·복구, 종료 후 자원0을 확인한다.
매 상태의 warm frame은 shadow pass/upload0이며 검사 대상의 receiver/caster geometry 통계가 양수여야 한다.
PNG 판정기는 상태 누락·빈 이미지·고정 blur·효과 없는 각도/반경·다른 색 성분 변경·warm redraw·model acne를 거절한다.
최대48 depth fetch는 shader loop의 정적 상한이며 실제 fragment 수나 GPU 시간 측정값이 아니다.

SDK/native 회귀는 환경v11 prefix·reserved tail·선택 정책·legacy/두 owner 동시 설정,
OFF 보존·입력 거절의 원자성·구 core의 자산 조회 전 거절·patch12/state14 downgrade를 확인한다.
WebGPU 두 uniform record의 PCSS tail·기존 frame 전환 시 초기화·추가 target 없음과 depth cache 재사용도 검사한다.
보고서는 Spatial GPU `run-*/report.json`의 `sunPcssCases`와 PNG다. 실게임/목표 GPU·브라우저의 FPS·품질 수용 검증은 별도다.

### Spatial 점광원 PCSS 회귀

`pnpm smoke:spatial-point-pcss`는 `test:spatial-point-pcss-report`의 독립 PNG 판정기 음성 테스트를
실행한 뒤 public tarball·실제 Wasm·WebGL2/WebGPU를 검증한다. 전체
`smoke:spatial-webgpu-offscreen`에도 포함하며 `CI`의 `validate` job에서 실행한다.
`validate`는 `extended_browser_smoke` 입력과 무관하게 실행된다.

가로/세로 viewport·DPR1/2·두 색공간·직교/원근·두 backend의 32 context에서 1,264개 상태를 확인한다.
이 fixture의 canvas는 CSS 최대 640×480이며 세로 viewport에서는 390×480으로 좁아진다.
실제 drawing buffer는 DPR을 반영한다. 물체 높이 0.25/16/64, 광원 반지름 0/2/8,
기준 texel cap 2/16/32, cube 해상도 128/256/512/1024를 교차하고 width/height와 world profile을 기록한다.

PNG 판정기는 577개 world-space 수신점에서 각 위치의 no-shadow/ambient 기준으로 조명을 정규화한다.
접촉보다 분리된 그림자가 넓고, hard/PCF3와 구별되며 광원 반지름·cap이 실제 픽셀에 반영되어야 한다.
반지름 0은 hard와 같고, 해상도 변경과 subtexel camera 이동의 폭 변화는 허용 범위 이내여야 한다.
2-unit caster를 보존하며 녹색 모델 재질로 수신 영역을 구분해 경사/곡면 acne를 제한한다.
큐브 edge와 세 면 corner를 가로지르는 그림자는 중앙 누출 없이 번짐이 나타나야 한다.

빨강·초록 점광원에 PCSS를 각각 적용한 PNG와 둘 다 적용한 PNG를 대조한다.
다른 점광원과 파랑 태양 PCSS 성분이 보존되고, 두 owner의 필터가 실제로 작동해야 한다.
sampling-only 변경은 0 shadow pass, 단일 cube의 cold frame은 6, 두 cube+sun은 13을 요구한다.
매 상태의 warm frame은 shadow pass/upload 0과 동일 pixels, receiver/caster geometry 통계를 확인한다.
progress-only PCSS의 state15를 새 엔진에서 복원하고 OFF/재활성·WebGPU 실제 장치 파괴/복구·자원 0을 검증한다.
음성 테스트는 빈 신호·고정 blur·효과 없는 반지름/cap·owner 결합·두 번째 필터 무시·seam 누출·acne·warm redraw를 거절한다.

SDK/native 검증은 v12/608의 prefix·reserved tail·실제 owner 필요 조건, legacy 단일/배열 단일/두 owner,
태양 PCSS·선택·Bloom의 독립 조합, OFF source 보존과 입력 거절 원자성, 구 core의 자산 준비 전 거절,
patch13/state15 및 progress-only downgrade를 검사한다. GL uniform과 WebGPU 두 camera record의
owner 값·legacy 전환 초기화·추가 target 없음, sampling-only depth cache 재사용도 확인한다.
배열형 shadow owner의 1025개 authored billboard와 65개 terrain texture batch는 PCSS 유무 모두에서
작성/활성화 사전 검사로 거절한다. 이 회귀는 두 누락 경로를 실패 재현한 뒤 추가했다.
query당 최대 48 depth fetch는 정적 상한이며 GPU 시간 측정값으로 해석하지 않는다.
보고서는 Spatial GPU `run-*/report.json`의 `pointPcssCases`와 PNG다. 실제 게임/목표 기기의 수용 검증은 별도다.

### Spatial 높이 안개 회귀

`pnpm smoke:spatial-height-fog`는 report negative audit, Wasm/SDK build와 packed browser matrix를 실행한다.
기존 `pnpm smoke:spatial-webgpu-offscreen`에도 같은 높이 안개 행렬·DOF 순서 검사와 높이 안개/Bloom 조합이 포함된다.
`CI`의 `validate` job이 이 aggregate 명령을 실행한다.
좁은 재검증은 runner의 `--height-fog-only`, `--height-fog-precision-only`,
`--height-fog-composition-only`, `--wide-bloom-height-fog-only`를 사용한다.

두 backend × 원근/직교 × legacy/linear-srgb × desktop/모바일 크기 × DPR1/2를 검사한다.
AO fixture에는 실제 환경광을 켜고 접촉면이 어두워지는 픽셀을 요구한다. unlit 표면의 0인
indirect MRT를 합성 경로 검증으로 대신하지 않는다.
새 안개를 geometry에 적용하는 legacy/separated 경로와 separated AO resolve 경로에서
기본값·밀도0·감쇠0/미소값/큰 값·기준 높이 위/아래/교차·수평/상향 시선·시작/종료 구간을 변경한다.
별도 Node oracle은 알려진 terrain에 카메라 ray를 교차시킨 뒤 **4096구간 수치 적분**으로
PNG 혼합률을 검사한다. 셰이더의 해석적 식을 복제하지 않으며 단순 backend 일치만으로 통과시키지 않는다.
기존 선형 안개도 같은 계산으로 검사한다. 효과 target/MSAA 차이를 배제하도록 안개가 닿지 않는
선형 모드를 기준 이미지로 사용한다. 화면 안의 알려진 재질과 최소 수신점 수를 요구한다.

pixelArt의 가상 해상도·정수 확대·여백·표시 카메라를 반영한다. 두 점광원+태양 PCSS와 함께
높이 안개만 바꾸면 13개 깊이 면이 재생성되지 않아야 한다. 기존 거리 안개보다 target/buffer/pass가 늘지 않는다.
progress-only state16을 새 엔진에서 복원하고 안개 제거/재활성·WebGPU 장치 파괴/복구·destroy 자원0을 검사한다.
높이 안개/Bloom은 기존 독립 CPU Bloom reference로 gather·wide, AO, odd viewport, pixelArt,
HDR 노출·HUD·저장/복원·장치 복구를 검사한다. 작은 HDR source의 DOF 후 광도가 Bloom threshold 아래로
내려가는 별도 fixture로 높이 안개→DOF→Bloom 순서와 효과가 실제 적용된 신호를 확인한다.

`pnpm test:spatial-height-fog-report`는 빈 이미지, 무시한 밀도/감쇠/구간,
직교 시선 대신 중앙 eye ray 사용, 잘못 복원한 이미지, 빠진 상태, warm shadow redraw,
누락된 native v13과 추가 target/pass를 거절해야 한다.
같은 gate의 별도 float32 shader probe는 패키지에 실린 GLSL/WGSL helper를 직접 실행한다.
큰 기준 높이의 평행 이동, 원거리의 인접 float32 시작/종료 깊이, 얇은 아래쪽 기여, 잘린 구간의
기준 높이 교차를 독립 adaptive Simpson 적분과 비교한다. 양쪽 backend가 같은 오차를 내도 실패한다.
SDK/Rust 검증은 유한 범위·reserved tail·lighting OFF source 보존, 구 core의 자산 준비 전 거절,
patch14/state16의 downgrade 거절과 Undo/Redo, 양쪽 GPU uniform tail 초기화·두 번째 camera record를 포함한다.

현재 호스트 GPU fixture 통과는 사용자 실게임·목표 기기의 FPS 수용 검증과 구분한다.
실게임·실기기 수용 검증의 대기 조건은 [개발 후보](../../planning/feature-candidates.md#조명-수용-검증)를 따른다.

### 태양광 빛줄기 smoke

`pnpm smoke:spatial-light-shafts`는 독립 이미지 oracle의 negative audit, Wasm/SDK build와 packed browser matrix를 실행한다.
같은 행렬은 `pnpm smoke:spatial-webgpu-offscreen`과 `CI`의 `validate` job에 포함된다.
이미 준비된 패키지는 runner의 `--light-shafts-only`로 좁게 재검증할 수 있다.

WebGL2/WebGPU × 원근/직교 × legacy/linear-srgb × desktop/모바일 viewport × DPR1/2에서 검증한다.
low/balanced/high, 강도·색·밀도·거리·전방 분포, 강도0/밀도0/lighting OFF,
높이 안개·실제 ambient AO·pixelArt, progress-only 새 엔진 restore, OFF→ON 및 WebGPU device recovery가 포함된다.

Node oracle은 native camera로 시선을 구성하고, fixture의 box와 독립 ray 교차를 계산해 태양 차폐를 판정한다.
그림자 raster 경계의 불확실한 표본은 제외하고 최소 표본 수와 빛줄기의 실제 색 변화량을 요구한다.
시선 구간별 지수 적분과 저해상도 복원으로 계산한 색을 PNG와 비교하며 backend parity만으로 통과하지 않는다.
빈 결과·효과 무시·잘못된 tint·빈 배경 덮어쓰기·stale restore·빠진 상태·누락된 metric·추가 pass·warm shadow redraw를 negative audit에서 거절한다.

같은 gate는 packed GLSL/WGSL raymarch shader 전체에 통제된 depth/shadow texture를 입력하는 정밀도 검사도 실행한다.
작은 near와 원거리 depth, far plane, 거리 clamp, near 이전 종료, 매우 얇은/짙은 밀도, 직교 카메라,
비단위 native 태양 방향을 16/32/48 샘플별로 검사한다. 차폐가 없는 구간의 독립 지수 적분과 비교하며
`--light-shafts-precision-only`로 따로 실행할 수 있다. 기존 상쇄 오차·희미한 산란 누락·방향 길이에 따른 밝기 변화는
negative audit에서 거절한다. SDK 자원 테스트는 현재 오류의 target 해제와 교체·OFF 후 도착한 이전 오류의 격리를 검사한다.

별도 HDR fixture는 높이 안개+빛줄기+DOF 뒤의 sub-threshold 입력을 gather/wide Bloom이 읽는지 확인하고,
threshold0의 실제 반응·Bloom0 identity·AO 추가·resize/DPR 복원·device recovery를 검사한다.
실제 draw/target bytes/샘플/texture-load 상한이 report와 renderer/profiler에 전달되는지 확인한다.
source632/native v14·capability1·patch15/state17, 구 버전 reader와 downgrade 거절·Undo/Redo는 Rust/SDK 검사 대상이다.
실제 사용자 게임·목표 기기 품질/FPS 수용 검증은 개발 fixture 결과와 별도로 기록한다.

### 지역별 간접광 프로브 smoke

```bash
pnpm test:spatial-light-probes-report
pnpm smoke:spatial-light-probes
```

동일 검사는 `smoke:spatial-webgpu-offscreen` aggregate에도 연결된다. 이 aggregate를 호출하는
수동 GitHub Actions 경로가 gate이며, 모든 PR에서 실행된다고 주장하지 않는다.
실제 packed package를 사용하는 fixture는 WebGL2/WebGPU × orthographic/perspective ×
legacy/linear-srgb × 1280×720/390×844 × DPR1/2를 검사한다.

- 최대8개·단일·검정·겹침·역순·중복·위치 변경·영역 밖·hemisphere·조명OFF·legacy/separated·AO.
- 실제 Playing/1 entity·지형 제출, warm pixels 동일, 추가 draw/target0 및 shadow redraw/upload0.
  프로브 없이 조명 OFF·AO 경로를 먼저 준비해 WebGL2의 깊이 버퍼와 WebGPU의 지연 생성 MRT 파이프라인까지 기준 비용에 포함한다.
  texture/target/buffer/program 개수와 buffer bytes는 누락을 거절하고 복원·재활성화·device recovery까지 비교한다.
  device recovery로 AO 파이프라인 캐시가 줄어드는 것은 허용하되 추가 생성은 거절한다.
- authored 문서에는 프로브 없이 live progress만 state18로 저장한 뒤 fresh engine 복원, OFF/ON,
  WebGPU device recovery 후 픽셀 동일 및 destroy 후 texture/buffer0.
- Node의 독립 double-precision ray/box·구형 보간 oracle이 각 일반 상태에서 최소50개 위치의
  예상 RGB를 검사한다. native 지형 측면의65% vertex color와 색공간 변환도 반영한다.
- 별도 실제 모델 fixture는 diffuse 기준색, 법선 방향 독립성, unlit identity, emission·직접 diffuse·
  직접 specular 분리와 실제 model triangle 제출을 검사한다.
- 간접광만 있는 AO fixture는 접촉부가 어두워지는지와 선형 광량의10~100% 범위를 함께 검사한다.
  AO 이미지만 검게 지우거나 밝게 만드는 오류도 실패해야 한다.
- negative controls는 효과 누락·색 변경·stale restore·blank·AO 누락/검정/증광·상태 누락·cost 누락·
  전체 상태의 자원 지표 누락·추가 pass/target/buffer·shadow redraw·잘못된 count/version이 실패하는지 검사한다.

SDK/Rust는 environment v15/700·patch16/state18, bounds/reserved/unused, invalid transaction 불변,
OFF source 보존, 빈 배열, 이전 reader, 구형 core의 자원 준비 전 거절 및 GL/WebGPU uniform reset을 검사한다.
실제 문제 게임·목표 기기의 성능 인수는 이 fixture와 별도다.


### Spatial 환경 호환성 교차 검증

`pnpm --filter @ferrum2d/ferrum-web test`의 `spatialEnvironmentAbi.test.ts`는 실제 빌드된 Wasm과
독립적인15개 v1~v15 fixture를 사용한다. compiler→native→WasmBridge→renderer packet의 길이/버전
일치, 알 수 없는 버전/불일치 거절, 매 프레임 ABI getter1회와 v15→v1 전환을 확인한다.
`spatialEnvironmentFeatures.test.ts`는9개 기능의 개별 capability와 공통 채널 capability 누락을
ON/OFF 소스에서 검사한다. authoring preflight·setter·configure·progress 복원이 자산 조회나 mutation 전에
거절하는지, 지원 코어의 성공 경로·destroy 후 facade 거절·복합 patch/source/progress의 최대 저장 버전도 확인한다.
이 검사는 GPU 픽셀 회귀를 대체하지 않으며, native/renderer 경계 수정 시 기존 Spatial aggregate도 유지한다.


통합 물리의 Web 설정/충돌체 회귀는 다음을 확인한다.

- Rust `web_bridge::controls::tests`: atomic admission, 잠금과 planar DOF, 질량/관성 즉시 적용,
  기존 component 소유권, 캐릭터·terrain 제한, fixture 삭제·재사용 이후 이벤트 식별자.
- Web `unifiedPhysicsControls*.test.ts`: capability/strict flag 검증, 실제 Wasm 질량/잠금/활성화,
  공간 조회에 반영되는 geometry 교체, foreign/stale 거부, owned handle 목록과 JS 경계.
- `pnpm smoke:unified-physics-web`: 실제 pack tarball을 Chromium에서 가져와 질량 2/관성 4에
  impulse 4/8을 적용한 속도 2/2, 회전 잠금의 각속도 0, disabled/enabled 조회 0/1,
  collider 교체·종료 이벤트·generation 갱신을 assert한다. 성능 수용 검증은 별도다.


통합 관절 Web 회귀는 `web_bridge::joints::tests`와 `unifiedPhysicsJoints*.test.ts`를 사용한다.
13종 kind/optional motor·spring 전달, 잘못된 수정의 atomic 거부, bulk 순서/중복/stale 출력 초기화,
실제 모터 이동·반력과 force/torque 파손, body 삭제 전 identity 보존, native/public 누락 수,
전체 생존 snapshot, Web drain과 legacy 파손 진단의 독립성을 검증한다.
`pnpm smoke:unified-physics-web`의 packed Chromium probe도 모터의 실제 이동/반력,
잘못된 수정 후 반력 유지, disabled update의 반력 초기화, 동시 force/torque 파손,
body 삭제 시 native 누락 2와 Web 누락 1 및 전체 snapshot 복구를 assert한다.

통합 물리의 기존 시각 객체 연결 회귀는 `web_bridge::bindings::tests`와
`unifiedPhysicsBindings*.test.ts`에서 검사한다. 같은 entity에 대한 planar/XYZ 이동,
잘못된 연결의 원자성, 기존 소유권 거부, 해제 후 객체 유지와 충돌/관절 identity를 확인한다.
`pnpm smoke:unified-physics-web`은 packed `/core`와 `/authoring`으로 sprite를 만들고
두 공간 모드의 실제 RAF render command 이동량을 native 소비 시간과 비교한다.
해제 후에도 sprite가 한 번만 출력되고 좌표가 고정되며 같은 entity에 재연결되는지 확인한다.
전체 Studio 3D schema·rendered GPU 결과·밀집 성능 검증을 대신하지 않는다.

Scene 물리 작성 회귀는 `dataScenePhysics.test.ts`에서 실제 Wasm으로 검사한다.
같은 entity의 planar/XYZ 진행, native 형상·축·용량 실패 전 원래 씬 보존,
배치 patch의 좌표·회전·scale과 실제 query geometry, 미완료 physics 진행 저장 거부를 확인한다.
`docs/engine/samples/data-scene-physics.scene-authoring.json`은 spatial terrain과 sphere를 함께 작성하는 fixture다.

`pnpm smoke:unified-physics-web`은 같은 fixture를 실제 tarball에서 읽고 낙하·접촉 후 정지,
잘못된 형상 적용 실패 시 기존 entity 유지, 미완료 snapshot 거부를 검사한다.
`pnpm smoke:scene-physics`는 빌드된 Studio에서 fixture를 로드하여 실제 render 제출,
XYZ 진단, Play의 낙하·바닥 접촉, Stop의 작성 위치 복원, 배치 이동·크기 변경 후
native pose와 patch 보존을 확인한다. 높이 입력·Undo의 native XYZ 반영, spatial 섹션 없는
평면 문서의 편집 정지·Play/Stop·배치 수정도 검사한다. 사전에 `pnpm smoke:studio` 또는 전체 빌드가 필요하다.
CI validate는 전체 빌드 뒤 두 검사를 직접 실행하며 보고서와 Studio 화면을 artifact로 남긴다.
`dataScenePhysicsConstraints.test.ts`는 authored capsule의 planar/spatial 낙하·접지·이동·점프,
13종 관절의 실제 native 생성과 planar 전용 kind 제한, 모터 이동·반력, endpoint scale,
잘못된 참조·설정·character/joint 용량 초과 시 기존 씬 보존을 검사한다.
`data-scene-constraints.scene-authoring.json`을 두 browser smoke에서도 사용한다.
packed browser는 native 접지·점프·모터 위치·관절 identity 보존을, Studio는 실제 렌더 제출과
접지 진단·모터 구속·Stop 복원·캐릭터 설정을 유지하는 배치 수정까지 검사한다.
`dataScenePhysicsActor.test.ts`는 native actor 기본값·유효하지 않은 설정의 원자적 거부·cold 이동·경로 요청을 검사한다.
packed browser는 public input provider와 실제 RAF로 정규화된 WASD·점프 보존·목적지 도착,
진행 상태·entity 규모·native step 수·Rust 시간을 검사한다. Studio에서는 실제 D 키 입력으로
선택 캡슐의 위치가 변하는지 확인한다. native 테스트는 경사 층 이동·장애물 우회·취소·교체·
저속 입력·새 장애물 정지·cold query의 상태/입력 보존도 검사한다.
이 검사는 기본 물리 전환·AABB actor 데이터 자동 변환·solver snapshot·밀집 성능 수용을 대신하지 않는다.

통합 melee 회귀는 `engine::unified_physics::combat_action_tests`에서 실제 Engine 고정 tick으로 검사한다.
렌더 offset 제외, XYZ 범위, 상호 mask·sensor·disabled 벽·faction, secondary fixture의 local pose,
복합 대상 중복 피해 방지와 노출된 fixture 선택, 시작 중심 유지, planar floor/지면 시야,
입력/타이머·쿨다운·pause·사망 및 예산 거절의 원자성을 검증한다.
`dataSceneCombatActions.test.ts`는 shape body의 authoring 승인과 범위 초과/몸체 누락 거절을 검사한다.
`dataScenePhysics.test.ts`는 5개 collision layer의 native category 기본값과 명시적 0/사용자 category 우선순위를 실제 Wasm에서 검사한다.
`pnpm smoke:unified-physics-web`은 tarball의 공개 `/core`·`/authoring`과 실제 RAF로 두 공간 모드의
melee 레시피를 실행한다. 가까운 적만 피해를 받고 높은/가려진 적은 보존되며, 재입력 쿨다운과
타이머 반격, 이벤트 source/target, playing 상태·entity 수·native step 수·Rust 시간을 확인한다.
이 melee 검증은 AI 이동·snapshot·최종 밀집 성능 수용을 대신하지 않는다.

통합 대시는 `engine::unified_physics::dash_tests`에서 검사한다. 실제 fixed tick의 속도/position target 보존,
visual offset 제외, sensor actor의 solid sweep, 이동 벽 정지, 완전/부분 차단과 쿨다운, 타이머의 물리 위치 조준,
첫 tick planar import, capsule 입력·점프 보존과 맞대시 결합,16개 경로 한도, 동적 몸체 거절,
대시 중간 투사체 피격과 큰 각도 회전 경로를 검증한다.
`dataSceneCombatActions.test.ts`는 native kinematic body 승인과 kind/속도 한도 거절을 검사한다.
packed `smoke:unified-physics-web`의 dash probe는 두 공간 모드와 spatial capsule에서 실제 RAF로 입력 대시,
벽 앞 정지·쿨다운·타이머 대시·점프 보존을 검사하고 playing·entity 수·backend step·Rust 시간과
spatial render-command 제출 수를 확인한다. 전투 AI 전체 이동·물리 snapshot·밀집 성능 수용은 별도다.


통합 전투 직접 이동은 `engine::unified_physics::combat_movement::tests`에서 검증한다.
공간별 XYZ/XY 변환·renderOffset 분리, native category/faction/tag/primary 표적,
height/floor·stale generation, 이전 속도와 중력/각속도 보존, capsule 벽·점프·pause,
별도 spatial.actor 입력 소유권, invalid speed 원자성·512 actor 상한을 검사한다.
packed `smoke:unified-physics-web`은 공개 authoring의 Chase recipe를 실제 RAF로 실행하여
planar/spatial 이동 거리와 capsule 벽 정지·점프·접지, playing/entity/backend-step/render-command를 검증한다.
이 검사는 다중 AI의 native 경로 탐색·crowd나 GPU pixel·실기기·밀집 성능 수용을 대체하지 않는다.


native 길찾기의 재개 가능한 검색 커널은 `native_navigation_slices` 회귀로 검사한다.
작은 slice와 전체 요청의 경로·expanded node·probe 수가 일치하는지, 긴 edge를 prefix 재실행 없이
이어가는지, 두 actor의 frontier를 번갈아 처리해도 서로 오염되지 않는지 확인한다.
query 전 작업 승인, queued jump/pose 보존, 요청 전체 한도, 동일 collider 수에서의 pose/shape/filter/
enabled/sensor/one-way/controller 설정 변경과 generation 교체에 따른 취소를 검증한다.
검색 생성과 첫 slice 사이의 source pose/controller/support 변경도 첫 query 전에 거절해야 한다.
기존 spatial.actor의 벽 우회·ramp·목표 도착·중간 장애물·input 취소와 packed 브라우저 경로도 유지해야 한다.
현재 회귀는 검색 커널이며 다중 전투 AI의 scheduler·공유 캐시·crowd 완료를 증명하지 않는다.


native Chase 실행은 `native_combat_navigation` 회귀에서 고정 벽 우회·solid target 도착 반경,
다중 actor 검색 token·outer update/fixed substep 공유 예산, moving obstacle의 실제 정지,
manual step/pause·전투 해제·pattern 제거·target generation 교체·공중 경로 추종·외부 teleport 취소를 검사한다.
1,400개 원거리 sensor가 있는 씬에서는 검색이 실제 fixed tick을 넘어 pending 상태로 이어지고
움직이는 peer 때문에 취소되지 않는지 확인한다. `native_navigation_fixed_graph`는 mobile pose 변경 허용과
fixed shape/pose 변경 취소를 구분한다. 기존 exact spatial.actor 검색의 취소 계약도 유지해야 한다.
packed `smoke:unified-physics-web`은 native Chase JSON을 직접 적용하고 실제 RAF에서 벽을 우회해 목표 반경에
도달하는지와 playing/entity/render command/search/work 지표를 검사한다. 전용 capability가 없는 facade와
native controller 한도를 넘은 문서가 기존 native handle/position을 보존하며 거절되는지도 확인한다.
별도 spatial.actor가 같은 Chase recipe를 가져도 maxAgents1/개별 stopDistance binding에 들어가지 않아야 한다.
기본 arrivalRadius0.5와 개별 stopDistance1을 구분하고 aiSteps가 실제 backend step 수와 일치해야 한다.
`dataSceneNativeCombatNavigation.test.ts`는 native/구형 capability, shape/controller/up/limit 검증과 source 용량을 검사한다.
공유 cache와 bounded crowd·all-pattern은 아래 회귀로 검사하며 전체 밀집 성능은 별도 수용 대상이다.


native 공유 경로는 `native_route_cache` 회귀에서 검사한다. 호환된 두 actor가 A* 한 번과 성공한 connector로
같은 목표 반경에 도달해야 하며, capsule 크기/local pose/controller/group이 다른 경우에는 별도 검색이 필요하다.
막힌 합류는 pose를 바꾸거나 hit로 집계하지 않고 이후 전체 A* 우회로 복구해야 한다. 고정 geometry 변경,
one-way/enable/shape/pose 변경과 target generation 제거는 cache를 무효화한다. 실제10개 profile 요청에서
cache peak가8을 넘지 않는지도 확인한다. fixed/kinematic 집합 교환은 collider 수가 같아도 cache와 pending
검색 모두 취소되어야 한다. 기존 native spatial actor의 route/animation 진단도 유지해야 한다.
packed `smoke:unified-physics-web`은 두 native Chase actor의 실제 cacheHit와 이동, 별도 입력 actor 제외,
개별 정지 거리·old facade 거절·미지원 옵션 거절 및 aiSteps=backendSteps×2를 검증한다.


Native 군중 회피는 `native_crowd` 회귀에서 실제 capsule sweep/상대 속도와 기존 padding overlap 탈출,
로컬 collider offset·높이·양방향 mask·controller 해제·제거 generation을 검사한다. 정지 peer 우회와
경사면의 지지점은 hypothetical body pose와 실제 capsule local 배치를 반영하며, 수평 offset이 있는
capsule의 ramp 이동도 승인해야 한다.
두 head-on actor의 통과는 실제 pose의 비관통·도착을 요구한다. 좁은 지형에서 떨어지지 않고, 둘러싸인
actor는 반복 A* 없이 대기해야 한다. 예산 부족 시 probe/pose를 바꾸지 않으며 queued jump와 전투 해제도 검사한다.
Packed 브라우저는 native crowd JSON을 직접 적용해 정지 peer 우회·실제 도착·최소 간격/높이·회피 진단,
playing/entity/render 규모·outer frame 작업량과 aiSteps=backendSteps×2를 확인한다. Native crowd 전용
capability가 없는 facade의 거절은 기존 native handle/position을 보존해야 한다. 이 검증은 전체 밀집
성능·임의 moving body 예측이나 실기기 검증을 대체하지 않는다.


Native all-pattern은 `native_patterns` 회귀로 검사한다. Seek의0/부분/1 turnRate, 실제 벽 우회·도착과
이전 Chase binding 배제, 틱당 가속1회·양축 speed cap, 벽/낭떠러미 정지·crowd 우회와 momentum 분리,
세 패턴의 fixed substep 공유 예산/입력 actor 제외, jump/공중 이동, teleport reset·pattern 해제,
고속 stop-circle 진입·예산 보류 시 가속 비누적과 native source/설정의 atomic 거절을 요구한다.
수평 offset capsule의 A*와 Seek가 실제 ramp support를 따라 도착해야 한다. 기존 sliced A*의 경로/probe
일치와 geometry 변경 취소, 기존 spatial.actor·cache·crowd 회귀도 유지한다.
Packed `smoke:unified-physics-web`은 all-pattern JSON의 세 AI와 별도 입력 actor를 실제 RAF에서 실행한다.
Seek/Chase 도착·실제 cache hit, Accelerate 이동/speed cap, 입력 actor 정지, render 규모와 예산,
aiSteps=backendSteps×3을 검사한다. Native movement capability가 없는 facade를 거절한 뒤에도
기존 handle/position/velocity가 보존되어야 한다. Native checkpoint/default backend/밀집 성능의 완료 증거는 아니다.


## Native 씬·Spec의 합산 작성 admission

`kinematicControllerAuthoring.test.ts`는 두 JSON 경로의 선택 객체·기본값·f32 경계·알 수 없는 필드,
명시적 enabled kinematic/solid convex source, arcade/rigid의 고정·가변 허용과 none·잘못된 source·spatial component 경계 거절을 검사한다.
`dataScenePhysics` 회귀와 Rust `aggregate_authoring`은 기존 component와 shape body·지형·관절의 cold admission,
합산 capacity 실패와 clock·예약 입력 비소비를 검사한다. Native Spec apply 실패는 기존 world의 clear 상태도 보존해야 한다.

`explicit_spatial_models`·`native_models` 회귀는 pitch/roll·local yaw·균일 scale·world offset/elevation과 bounds,
현재 위치/회전의 일관성·teleport·checkpoint 복원을 검사한다. 모델의 80바이트 ABI와 기존 보간은 유지한다.
`placement-physics-summary.test.mjs`와 `placement-inspector-originals.test.mjs`는 native quaternion/각속도,
조회 전 복사·4 Hz 상한·잘못된/stale 행의 unavailable·작성 controller JSON의 runtime unknown 표시와 elevation 원본 복원을 검사한다.

Packed `pnpm smoke:unified-physics-web`의 `aggregate-native-authoring-probe.mjs`는 공개 SDK로 controller Spec,
planar 혼합 body·collision-only grid·named joint를 구성한다. 실제 capacity 초과 뒤 scene/clock·variables·registry·
기존 handle과 clear 동작이 보존되고, controller 이동의 checkpoint continuation이 일치해야 한다.
명시적 spatial dynamic 모델은 full pose matrix·offset/local yaw/scale·teleport/rollback과 모델 command stride·삼각형 수를 확인한다.
이는 모델 matrix·native 실행 검증이며 GPU 픽셀·전체 자원/시간 budget·실기기 수용을 대신하지 않는다.
검증 결과는 이번 실행의 `artifacts/physics-3d/aggregate-authoring-review.json`을 따르며 과거 다른 단계의 통과 횟수를 재사용하지 않는다.

`pnpm smoke:scene-physics`는 기존 native 문서의 Play/Stop·높이 편집과 작은 native 모델의 작성 UI 회귀를 실행한다. 모델 시나리오는 조명 전체 matrix와 분리해 선택 bounds·원본 복원·물리 회전을 확인한다. 실제 검사 항목과 결과는 `aggregate-authoring-review.json`의 원본 로그를 따른다.

`pnpm smoke:studio-native-templates`는 저장을 활성화한 별도 QA 빌드를 만들고 local component catalog fixture를 실제 Studio에서 연다.
Paused 2D의 native body/controller/이름 기반 joint, canvas picking, 공유 component 편집 거절,
위치·layer Undo/Redo, Play/Stop, 실제 저장·재열기와 raw catalog/ref 보존을 검사한다.
등록된 그래픽 타일의 실제 render command와 Asset Usage/handoff의 원본 JSON pointer도 확인한다.
저장 host는 QA artifact만 쓰며 기본 제품의 저장 권한을 바꾸지 않는다. CI는 기존 저장 활성 빌드를 재사용해
`FERRUM_NATIVE_TEMPLATE_STUDIO_ROOT="$RUNNER_TEMP/studio-save" node tests/smoke/native-template-studio-smoke.mjs`를 실행한다.
결과는 `artifacts/physics-3d/goal-closure/studio-native-authoring/browser/`에 남긴다.

### 그래픽 격자·템플릿·캐릭터 외력 통합

`dataSceneGraphicalTilemap`·`graphicalTilemapAuthoring` 회귀는 v1 packet 보존, v2 capability,
asset/UV/tint 경계, spatial 조합 거절과 검증 packet의 실제 적용 재사용을 검사한다.
`dataScenePhysicsTemplates`·`dataSceneTemplateContinuity`는 catalog snapshot의 inline 동작 일치,
named joint·controller·material·actor 연결과 animation/LOD 연속성·epoch·실패 복구를 확인한다.
외력 회귀는 중복 누적 한도·late invalid row의 원자성, 입력 view 동시 복사, force/impulse/clear·checkpoint 소유권을 검사한다.

Packed `pnpm smoke:unified-physics-web`은 `graphical-tilemap-authoring-probe.mjs`에서 공개 SDK로
그래픽/충돌 전용 타일을 함께 작성하고 실제 WebGL2 framebuffer의 두 atlas 색, template controller의
충돌·checkpoint replay, 실패한 apply의 handle/graphics 보존과 clear를 검사한다.
`character-dynamic-forces-probe.mjs`는 두 공간 모드에서 actual Wasm view를 입력으로 쓰고,
외력·한 번의 impulse·clear, 잘못된 batch 이후 정확한 replay와 동적 물체의 유한 질량 반응·운동량을 검사한다.
같은 기존 smoke 명령에 연결되므로 CI 연결 범위는 그 명령의 기존 workflow 조건을 따른다.
이번 결과는 `artifacts/physics-3d/goal-closure/`의 실행별 로그를 확인하며, 이 기능 검증을
전체 밀집 비용·기기 검증 또는 upstream V8 자체의 수정으로 판단하지 않는다. Node22 실행기 우회는 아래 별도 근거를 따른다.

### 실제 kernel 경로와 승인된 feedback

`physics3d::solver_trajectory` 회귀는 native f32 kernel·저장 endpoint와 private f64 domain을 구분하고,
observer 절대 시각의 F32 1ULP보다 작은 첫 접촉 bracket도 원래 skin과 full-shape witness로 확인한다.
`solver_trajectory::query_work_tests`는 finite contact 특수 분기가 미사용 proxy GJK를 준비·청구하지 않는지,
보고된 iteration0에서도 실제 simplex와 종료 단계를 실행 전에 승인하는지 확인한다. Cold·warm·overlap의
원 결과와 simplex cache 비트, 각 단계의 거절 후 cache 불변, 정확 quota·한 단위 부족 및 원본 bytes를 검사한다.
Native fallback 회귀는9종 point-cloud leaf의 양방향 Ball query와 원 dispatch 결과 비트, leaf 쌍의
원 GJK/EPA 결과, 실제 EPA 각 admission 거절 후 입력 bytes, phase·요청 공간을 공유하는 정확/한 단위
부족·overflow allowance를 검사한다. Degenerate zero-support의 원6방향 bootstrap과 실제 overlap의
기하급수 backing 요청도 확인한다. 내부 임시 workspace 자체의 rollback이나 allocator/RSS 상한을
주장하지 않는다. 원 Parry library 회귀와 함께 검증하며 실제 결합 회귀와 전체 제품 수용을 구분한다.
Cuboid 겹침은 선택한 유한 SAT 면에서 signed gap을 보존한다. 유한 상태 분기는 Anchored의 carrier/상대 시간 조합,
Constant/CCD/저장 endpoint, 가능한 모든 pose 쌍의 기존 full-shape 판정, 정확 work/한 단위 부족과 source bytes를 검사한다.
일부 시점 검사로 전체 kernel image를 대신하지 않는다.
회전0·고정 회전의 F32 좌표 범위 검사는 원래 낙하·접지·걷기, 가로 이동 중 높이 반올림 구간,
벽 차단 대조, 저장 endpoint/정규화 회전 불일치 거절, 정확 work/한 단위 부족과 원본 bytes 보존을 포함한다.
`rounded::output::tests`는 raw quaternion 출력이 여러 값이어도 원래 scalar norm²가 bit singleton인 구간의
모든 F32 dt와 support 범위를 확인한다. norm² 변화·0·비유한 값·잘못된 sample은 인증하지 않으며,
private domain과 native 적분 시간이 다른 대조, stored endpoint, signed zero와 원래 local radius 회전도 포함한다.
범위 quaternion을 유한 pose Cartesian 판정에 사용해서는 안 된다.
Ball/Ball의 반지름 크기 차이가 큰 반례는 원래 `(length - radiusA) - radiusB`와 Native 상대 frame 식을
따로 검사한다. 기존 cube·analytic·plane·linear 우회와 상위 cast까지 확인하며, 출력 image 인증이 실제
거리0이 양수 여유값을 위반할 때 승인하지 않아야 한다. 여유값0의 비침투 경계는 원래대로 허용하는
대조를 함께 유지한다. raw norm이 여러 값인 경우에는 원래 dot·reciprocal 정규화의 전체 출력 범위와
기존 exact pose/singleton 분기, norm0·비유한 값 거절을 검사한다. Cuboid/Capsule은 구간 전체 finite face와 실제 normal family의
조건, face 조건이 성립하지 않는 대조, 기존 한도와 원본 bytes를 확인한다. 이 집중 회귀를 generic
Capsule/GJK의 모든 실제 이동·여유 검사 회귀나 전체 제품 수용의 증거로 사용하지 않는다.

축 준비 공유 회귀는 원래 순서와 첫 축 가격, 미래 축의 오류 지연, 준비 전 정확/한 단위 부족 예산,
원래 transform의 Bound 연산 순서와 bytes 보존을 검사한다. `rounded::common_phase::tests`는 실제
Native 입력 단계가 같은 자세만 연결하는 full-shape 대조, Anchored의 독립 logical-relative map,
다른 clock key·압축 대표 image의 제외를 확인한다. 유한/선형 닫힌 unit-axis 경계와 inward 음성,
저장 over-norm Capsule의 local 반경·under-norm Ball의 원 world 반경, 양수 clearance 및 원 bytes도
함께 검사한다. 일부 시각 표본으로 전체 image를 대신하지 않는다. 닫힌 경계 회귀는 유한 F64 항등식과
endpoint별 정확 차·비단일 구간의 비상쇄, 단위 norm, 양수 margin의 등호와 실제 inward 음성을 포함한다.
`existing_tangent_contact_refines_its_certified_prefix_before_later_native_rotation`은 실제 Native 곡선의
인증된 양의 prefix와 후행 충돌 bracket을 확인하며 strict·초기 inward의 시각0 정책도 대조한다.

`rounded::common_timeline::tests`의10개 회귀는 동일 시간의 lossless key·단조 전이와 원 pose를 확인한다.
서로 다른 domain/물리 h, 독립 Anchored 상대 시간, 저장/정규화/CCD 분기, signed zero·0 교차와 마지막 key,
17개 F64 cell 전수 대조·guard 초과·실제 inward·닫힌 여유0 정책, 정확/한 단위 부족 Work와 bytes를 포함한다.
기록된 회전 천장 구간의 원 F32 입력 전수 oracle 대조는 boolean 동등성 검사다. oracle이 false여도 이 검사는
통과할 수 있으므로 최소 gap/certified 값을 기록하고 실제 Engine clearance 성공·기존 실패 해결과 분리한다.
근접 회전 fixture의 통과도 전체 원래 이동·운반 경로의 수용을 대신하지 않는다.
첫 접촉 후보는 원 witness·정확한 F64 predecessor·원 cast 결과의 시각 일치, 정확/한 단위 부족 Work와
너무 좁은 time tolerance 거절을 검사한다. 첫 cell 접촉·닫힌 여유0·outgoing 정책도 기존 proof로 대조한다.

`rounded::output::support::capsule::tests`의6개 회귀는 GJK endpoint normal과 전체 core 분리면의 차이,
새 후보의 원 전체 support 인증, tangent no-hit·실제 inward bracket·원 contact 비트와 bytes 보존을 검사한다.
비평행·길이0 core·실제 overlap·후행 회전 crossing, 후보 준비와 support의 정확/한 단위 부족 비용,
앞선 인증 성공·비캡슐의 추가 비용0과 기존 axis plan을 대조한다. 방향 후보만으로 끝점이나 후행 구간을 승인하지 않는다.

반경 회귀는 Native 정규화 뒤 길이가 정확히1이 아닌 quaternion과 움직이는 core를 사용한다.
Box/Ball의 양수 clearance 위반과 여유0의 비침투, 실제 overlap을 구분하고, 좌표8192에서 반경2^-12가
단순 F32 가감에 사라져도 엄격한 인증을 통과하지 않아야 한다. F64에서도 사라지는 매우 작은 값은
private extent helper의 산술 대조이며 제품의 모든 shape 크기가 허용된다는 증거가 아니다.

`rounded::output::bounds::tests`의6개 회귀는 전체 원 F32 절대 이동 범위를 확인한다. 허용 수치 안의
Anchored 상쇄에서 같은 끝점 사이의 실제 중간 이동, 저장 끝 자세와 비단위 회전·반경, convex 내부점,
Compound 합성 순서·TriMesh·HeightField, 정규화 구간의 적응 분할을 포함한다. 정확/한 단위 부족 Work와
typed failure·원본 bytes도 검사하며 endpoint 표본만으로 전체 구간을 승인하지 않는다.
상대 derivative 범위나 legacy non-exact 경로의 별도 인증으로 집계하지 않는다.

`queries::step_motion::finish::tests`의5개 회귀는 실제 tick의 소비 원장을 초기화 없이 이어받는지,
정확/한 단위 부족·중간 bounds 실패 뒤 유효한 tree 정리와 unavailable capture, 초기 승인 실패의 기존 tree bytes,
cold snapshot·6tick 재실행을 확인한다. 저장 BVH는 끝점이 같은 상쇄 경로의 내부도 포함해야 한다.
실패한 capture 조회는 원래 output을 보존하고 `InvalidQuery`를 반환해야 한다. 비활성·legacy·singleton의
기존 범위도 대조한다. 이는 논리 Work와 capture 실패 계약의 회귀이며 전체 allocator/RSS 수용을 뜻하지 않는다.

`character_motion::feedback::tests`는 질량0과 양의 질량에 같은 승인 이동을 게시하는 대조로
translation·carry·차단 상태를 유지하면서 외부 운동량 소유권을 구분하고 snapshot capture/restore·byte identity를 확인한다.
원래 queued-jump/platform snapshot과 controller file-candidate의6tick continuation도 같은 통합 단위에 포함한다.
구현·통합 뒤 공통 영향 검사를 한 번 실행하고, 과거 source와 현재 source의 결과를 구분해 보존한다.

`character_motion::backend::momentum_tests`는 바닥과 다른 방향의 동시 충돌, 실제 유한 질량 반응과 접선 속도,
선형·회전 carrier의 실제 접촉점 속도, 추가 physical J와 geometry-only 출력0을 대조한다.
같은 controller 안에서 실제 Dynamic carrier가 벽 응답으로 멈추는 회귀는 상대 입력0/반대 방향 입력과
한쪽만 운반되는 캐릭터 pair를 구분한다. donor에서 peer로 전달된 이동의 재계획, accepted-prefix carry 보고,
finite J의 보존과 원본 snapshot bytes도 확인한다. 동시 바닥·수평 충돌의 하중 보정은 새 수직 이동을
만들지 않아야 하고, 소비한 보정을 초과하는 실제 상승 충격은 승인 endpoint에 반영되어야 한다.
압착 재시도에서는 pending 원장을 복원하며 실제 운동량·J를 유지한다. 성공을 기대하는 이동은 checked step과 전체 시간 완료를
함께 확인하고, PASS 이름과 거절 단계 로그가 함께 남으면 의도된 음성 사례인지 소스로 구분한다.

실제 support point와 기하 phase 분리의3개 회귀는 nonzero-time 유한 J, 명시/암묵 anchor·carry·snapshot 독립성,
same-axis의 접선 보존과 잘못된 축 제외, 첫 inverse 거절 후 후속 cell 방문을 검사한다. Adversarial phase의 물리
독립성을 확인한 사실이 그 descriptor의 미래 Engine admission 성공을 뜻하지 않는다. 원 실제11-family 회귀와
일반 finite/rotating·raw Native 운동량 수용은 실제 공통 결과로 따로 판단한다.

수치적으로 보이지 않는 법선 post-add의 지지 유지 회귀는 원래 점프·표현 가능한 상승·경사·접촉 조건,
실제 XZ carry·physical J·snapshot bytes를 함께 확인한다. 비지지 reference는 순간 속도가 같더라도
미래 접선 이동을 만들면 거절한다. Zero angular velocity의 저장 quaternion과 정규화 interior 작용이
다른 대조도 포함하며, 기하 후보는 실제 속도로 모든 동시 행을 다시 검사한다.

`backend::active_constraints::tests`는 Box driver와 새 Capsule peer를 동시에 투영해 원 free plan을
유지하면서 접선 입력·실제 끝 자세·physical J0을 확인한다. 원 full-shape safe/hit gap과 고정 envelope를
검사하고, 재계획한 실제 suffix의 domain에서 범위를 벗어난 후행 witness가 보관 제약을 해제해야 한다.
분리·filter·disabled pair·세대·형상·enable 변경, 양의 질량·회전 제외, reserve 전 work/scratch 부족과
context clear·snapshot bytes를 구분한다. 기존 coupling·승강기/천장 압착 회귀도 함께 확인한다.
이미 검증한 기하 행은 기존 pressure stop/retarget에서 빠지지 않아야 하며 physical history로 재사용하면 안 된다.

정확한 support tuple의 관찰 회귀는 초기 leaf gap·preferred skin·원래 support proof margin을 따로
기록한다. 시각별 양수 gap 손실은 그 시각의 관측이며, 샘플이 양수라는 사실이나 관찰용 PASS를 전체
구간 안전·실제 Engine tick 성공으로 집계하지 않는다. 이 경로의 동적 결합·회전 CCD 수용은 아직
미완료다. 기능 안정화 뒤 전체 Native/WASI·새 production Wasm·SDK·Studio·4종 consumer·package·품질
검증을 모아 수행하며, 실게임·실기기 검증은 개발 완료 뒤 진행한다.

Native 출력 cell 회귀는 내부의 실제 충돌을 보존하면서 완전한 NoHit 검색의 비용을 대조한다.
회전 face 접촉은 기존 Native 우선, 원 반경·법선 cone·접선 clamp 제외와 실제 최초 cell의 승인 prefix를
확인한다. 이미 찾은 midpoint보다 늦은 hit를 반환하면 안 된다. 전체 Box slab과 Capsule 반경의 분리
회귀는 실제 접촉·부분 slab·한 단위 부족 Work를 거절해야 한다. 이 보조 검사와 별도로 원 밀집16/32,
회전 발판 전체 회전, 유한 질량의 운동량·토크·접선·J 중복 방지 검사를 복구해야 하며 현재 미완료다.

정지 COM memo 회귀는 실제 scene의 시간 라벨·물리 h 재계획 뒤 cast 재실행 없이 같은 NoHit를
재사용하는지와 snapshot bytes를 확인한다. 비0 이동·회전, 저장/내부 정규화 차이와 부호0, 표현 가능한
내부 dt가 없는 최소 h를 구분한다. 초기 정책·coverage·context·work/scratch의 기존 거절 검사도 유지한다.
기존 접촉 band 재사용은 초기 COM·속도 비트와 원 정책이 같은 하위 구간을 cold cast와 대조하고, inward
입력 변경은 다시 검사해야 한다. 공통 Native 곱 회귀는 실제 F32 반올림·전체 binade·Box 면/내부 범위와
두 반경을 검사한다. 회전 격자는 일부 출력이나 한 단위 부족 Work로 전체 구간을 승인하면 안 된다.
충돌 검색을 통과한 사실과 이후 반응·운동량·J 및 전체 tick 완료는 별도 단계로 기록한다.

`contact_impulses::actual::tests`는 mark/rewind·seal·실제 commit prefix·중복 게시 방지, 기존 stream과 합친
용량·drop 집계, 정확/한 단위 부족 work·요청 bytes, 잘못된 수치·identity·시각의 거부를 검사한다.
실제 Native codec 복원 후에는 작은 body 한도와 큰 `max_events`를 함께 사용해 출력 backing 준비와 저장 bytes 보존을 확인한다.
`actual_backend_curve_query_is_readonly_and_retains_full_shape_pose_kernel`은 kinematic-only 관측도 원래 kernel을 사용하고
cold query가 입력·force·시간·snapshot을 바꾸지 않는지 검사한다.
같은 시각·pose의 query/manifold/Native PointQuery를 비교하는 별도 진단은 수치 차이의 원인을 찾기 위한 관측이다.
이 진단의 통과를 원래 angular CCD의 전체 tick 승인·clamp·진단·후속 snapshot 수용으로 판단하지 않는다.

`character_motion::native_ccd::tests`와 원래 `angular_ccd_bounds_tests`는 전체 원래 kernel의 승인 prefix,
f64 cutoff·Constant suffix, 현재 최단 cutoff로 제한한 검색, 작은 각도·큰 offset의 500개 후보와 분리된 평면을 검사한다.
Endpoint AABB만으로 분리를 결정하지 않아야 하며 전체 support 인증 비용도 기존 작업 한도에 포함한다.
기존 Native fast·sensor/pseudo·group·hook과 관절의 접촉 제외 쌍을 유지하고, clamp 없는 고속 pass의 통계도 검사한다.
이동 측 준비 재사용 회귀는 lazy 준비·정확/한 단위 부족 비용·원 bytes, clipped 시간 키·8슬롯 교체와
새 입력의 cache scope, target·clearance 독립성을 검사한다. 끝 자세가 분리됐어도 중간의 실제 충돌이
가려지지 않아야 한다. 원 작은 각도3개×평면2개의 500대상 회귀를 별도 기준 완화 없이 유지한다.
관측을 끈 선형 Sphere·회전 잠금 Box와 force 대조는 내부 actual 경로와 원래 Native 운동량이 유지되는지 확인한다.
관절 대조는 마지막 outer pass에서만 무관한 벽에 접촉하도록 구성해, clamp 뒤 후속 solve의 반응과 clamp 자체를 구분한다.

`snapshot::tests::actual_paths`와 `engine::file_candidate::tests::actual_native_ccd`의 Native CCD 회귀는 실제 producer가 만든
원래 kernel과 분할된 Constant 구간 전체의 연속성을 검사한다. 독립 geometry oracle, checkpoint·전체 파일 복원 후
6tick 재실행, 유효 CRC를 유지한 원래 end-law 손상 거절, 정확/한 단위 부족 byte·decode 예산을 포함한다.
Engine fixture는 실제로 살아 있는 발사체와 step-motion 관측 활성화까지 확인한다.
요청된 origin sensor의 실제 회전 경로는 기하 정지와 J0을 검사하고 target sensor·dynamic 제외 대조를 유지한다.
이 집중 회귀를 전체 운반·압착·지형 navigation 또는 현재 제품 matrix의 완료 증거로 확대하지 않는다.

유한 feature 접촉 회귀는 Box–Box의 큰 평행면과 Box–Capsule의 양수·0·음수 signed gap, A/B 교환과
원래 world witness를 확인한다. 기존 kernel·shape·skin을 유지한 채 근접 거리와 법선이 같은 feature를 가리켜야 한다.
지지체 재부착은 nonzero 시각·상대 접선 속도에서 원래 carrier domain/h와 prefix를 보존하고,
재부착 pose의 연속성·남은 endpoint·운동량을 함께 검사한다. Jump·분리 impulse·ledge·유효하지 않은 ground 대조를 유지한다.
`planar_span_filters_fast_ccd_without_clamping_to_other_floors`는 위치만 검사하지 않고 `step_checked` 성공과 전체 tick 완료를 요구한다.
오류로 제자리에 남은 body가 blocked 조건만 만족해 통과하는 결과는 CCD 수용 근거가 아니다.

### Native 고정·가변 시간 실행

`variable_clock_tests`는 actual/nominal dt의 구간 소유권, 자동·수동·내장 게임의 시간 소비,
캐릭터 외력·한 번의 impulse·지형 이동과 checkpoint continuation을 검사한다.
특히 첫 실제 구간의 외력 peak와 전체 승인 시간의 끝을 모두 검사하며, 첫 진입 실패의 simulation 불변과
이후 진입 실패의 완료 구간만 기록하는 동작을 구분한다. 잘못된 시간·상한 초과·0초 frame의 새 통계도 검사한다.
`nativePhysicsClock`·`physicsSpecNativeRuntime` SDK 회귀는 capability와 checked setter 실패의 원자성,
실제 mode·nominal·저장된 다음 scene mode의 metadata, 동일 Spec의 accumulator·입력·상한·보간 보존을 확인한다.

`pnpm smoke:unified-physics-web`에 연결한 `native-variable-clock-probe.mjs`는 실제 공개 패키지·Wasm과 소유한 RAF로
7/13/21ms의 실제 소비 시간, 두 공간의 수동 이동·force/impulse·checkpoint replay를 검사한다.
고정·가변 전환과 이후 scene 선택, positive→zero frame의 통계 초기화,
동일 Spec 재적용 사이의 반 틱 누적·예약 입력·사용자 frame/step 상한 보존도 회귀 조건이다.
구현 연결과 실행 결과는 구분하며, 현재 통합의 native/WASI/Wasm 로그는
`artifacts/physics-3d/goal-closure/native-variable/integrated/`, 공개 패키지 probe 결과는 해당 실행의 browser report를 따른다.
이 검증은 무옵션 native 기본 전환·외부 파일 import·밀집/실기기 수용을 증명하지 않는다.

`checkpoint_decode`의 shape-boundary 회귀는 지원7종의 wire/query/continuation을 유지하고,
지원 밖 enum tag와 Compound child를 payload 생성 전에 거절하는지 확인한다.
일반 vendor Serde의 더 넓은 형상과 malformed primitive 검사는 별도로 유지한다.
이 경계만으로 전체 cross-arena·공유 geometry topology·실제 allocator/RSS 또는 외부 파일 저장 수용을 완료 처리하지 않는다.

`native_workspace_boundary_`는 실제 empty/populated5종 query workspace를 bounded reader로 왕복하고,
이후6회 query의 bytes가 원본과 같은지 검사한다. Voxel workspace3종과 Custom/범위 밖 tag는 payload 생성 전에
거절하며 별도 vendor Serde는 기존 Voxel payload를 계속 수용한다. 이 tag 검사와 뒤의 내부 cache 검사는
별도 경계이며, 두 검사의 통과도 실제 allocator 검증의 완료를 뜻하지 않는다.

### Native checkpoint 저장 참조 검증

`physics3d::snapshot::tests::stored_references`는 서로 다른 세대의 broad/narrow phase를 붙인 후보와
존재하지 않는 세대를 참조하는 joint graph를 capture·restore 모두에서 거절하는지 검사한다.
유효한 envelope·CRC를 가진 private 손상 fixture를 사용하며 거절 뒤 live world와 원본 후보의 byte가 같아야 한다.
실제 방문 작업의 정확한 한도와 한 단위 부족, scratch 0 한도를 구분하고 예약 kinematic 명령의 다음 step 일치를 확인한다.
Vendor `stored_` 회귀는 graph inverse·actual solver bucket 중복·inactive Coarena alias와
정상 TYPE·overflow/generic·pending MAX-generation·수면/epoch 이력의 수용을 별도로 검사한다.
Core는 기본 `cargo test`와 Rust-only WASI 전체 gate에 포함된다. Vendor 집중 회귀는
`pnpm test:physics3d-storage`로 별도 manifest에서 실행하며 `CI`의 `validate` job에도 연결한다.
Core 전체 통과만으로 vendor unit suite 실행을 주장하지 않는다. 이 검증은 전체 numerical/island 구조,
실제 allocator/RSS·외부 파일·SDK 바인딩 수용의 완료가 아니다.
Storage 명령은 libtest의 `stored_`와 `shape_edits_` OR 필터를 함께 전달한다. 후자의7종 static/5종 dynamic,
양 방향148개 실제 shape 교체와 ghost impulse·graph 재구성·None root 검사가 `CI`의 `validate`에도 포함돼야 한다.
Core `native_shape_edits_`는 같은 collider의 공개 교체,6 tick 자유 이동, contact/sensor lifecycle과 pending
checkpoint, 유효 CRC root 손상의 실패 원자성을 검사한다. 브라우저 `native-shape-edit-probe.mjs`도 실제
tarball에서 양 공간/양 순서의 동일 collider 교체와 ghost impulse 없음·6 tick checkpoint replay를 검사한다.

`native_island_`는 첫 step 후 공개 API로 생성한 pending joint의 즉시 저장 bytes와6 step continuation,
sleep membership 누락의 capture/restore 거절·실패 원자성, 별도 island 방문 한도의 정확한 경계와
한 단위 부족·scratch0을 검사한다. Vendor의 `stored_islands_`도 storage gate에 포함되며 정상 연결 cycle,
순서가 있는 rewire/remove/reuse·modified flag·sleep/wake/type history의 bytes를 보존해야 한다.
`smoke:unified-physics-web`의 pending joint 회귀는 실제 tarball SDK에서 평면/공간의 관절 생성 직후
checkpoint를 복원하고6 step의 body/joint/통계를 비교한다. 전체 persistent bytes 비교는 Core 회귀가 담당한다.
`native_island_scheduler_high_stamp_`는 실제 Core checkpoint에서 일반/최대 clock·양 공간의 수면 진입과
이후6 step bytes를 비교한다. 여러 독립 component의 동시 수면 뒤 지정된 빈 awake container도 보존해야 한다.
Vendor `stored_scheduler_`는 제거/합산 포화, sleeping/hot/실제 search budget 초과 branch,
세 split producer의16 scan cooldown과 MAX 경계·stale workspace stamp·기본0/expired deadline을 검사한다.
일반 범위는 수정 전 tick0..6 digest를 유지하며 capture/admission은 숫자를 바꾸지 않는다.
Empty awake의 wake/remove/reuse와 다른 empty chunk의 거절도 검사한다.
`native_island_current_joint_requires_stored_link_`는 실제 공개 joint를 유지한 채 정상 remove/step donor의
body/island 상태를 붙인 유효 CRC 후보를 capture/restore 전에 거절하고 원본/live bytes가 보존되는지 검사한다.
Vendor eligibility 회귀는 안정된 active joint/contact와 저장 owner의 불일치, 정상 pending TYPE/ENABLED·
삭제·재사용 이력을 구분한다. 전체 component 재구성·pending provenance·다른 backend 정수 산술·실제
allocator/RSS 검증을 이 회귀만으로 완료 처리하지 않는다.

### Native 수치 admission과 착지 회귀

`native_snapshot_integration_`는 실제 backend 설정의 잘못된 값42개×두 공간을 거절하고,
정상 CCD·마찰·warm-start tuning과 actual interval 후 nominal 복구·checkpoint replay를 보존한다.
`native_body_numeric_`와 `native_joint_numeric_`는 정상 envelope/CRC의 예약 target·force·mass·반복 수,
실제 joint frame/limit/motor/impulse·ratio cache 손상을 capture/restore 전에 거절하는지 확인한다.
거절 뒤 live/source bytes가 보존돼야 하며 signed/disabled history·예약 이동·bounded tuning은 정상 재실행돼야 한다.
Vendor body/collider 전필드 회귀도 `pnpm test:physics3d-storage`의 `stored_` 필터에 포함한다.

`native_contact_`는 실제 plain manifold와 solver cluster, float/CID를 capture·candidate 생성·restore 경계에서
검사한다. 기존 guard가 수용한21개 payload×양 공간42건과 실제 compound cluster6건을 새 경계에서 거절하고,
유효 CRC와 실패 후 source/live bytes 보존을 확인한다. Soft/ready-empty/solver point 초과의 통합 거절과
정확한 작업 한도/한 단위 부족도 검사한다. 정상 sleep·pending pose/shape/force·signed history는 원본과 동일하게 이어져야 한다.
Vendor `stored_contact_numerics_`는 역할별 quaternion/normal·recycle cache와7종 shape/clustering 조합을 추가로 검사한다.

`physics3d::snapshot::tests::contact_workspaces`는 실제5종 workspace의 map/manifold index·역참조·shape 역할과
TriMesh interference/bounds 모순을 capture/복원 경계에서 검사한다. 정상 query/step/recycle·pending SHAPE
cache의 byte continuation, 별도 작업/scratch 한도와 유효 CRC의 실패 원자성을 구분한다.
Vendor `stored_workspaces_`도 storage gate에서 실행한다. 모든 feature 의미·공유 topology와 실제
allocator/RSS 상한을 이 회귀의 범위로 확대하지 않는다.
`native_pending_removals_`는 step 후 collider/body 삭제 직후와 slot 재사용의32개 정상 공개 경로에서
cleanup tick 없이 저장하고6 tick의 bytes/관측을 비교한다. Vendor의 pending-removal 회귀는 지원5 cache의
삭제 이력과 내부 손상을 구분하며, 정확/한 단위 부족 작업·scratch 한도를 검사한다.
`automatic_planar_removed_wall_checkpoint_`는 실제 자동 slide→벽 삭제→actor/target/chase 준비 직후의
Engine checkpoint와15 tick 재실행을 비교한다. 기존 packed browser의 같은 자동 이동 checkpoint도 통과해야 한다.

`near_skin_tests`는 positive-gap 바닥 누락, 실제 구간별 이동·preview/force/jump/impulse replay와
저장 byte 보존을 검사한다. `landing_trajectory_tests`는 별도의 within-skin 접선 정체와
착지 뒤 벽·동일 compound 벽·one-way·step/ceiling·경사/ledge·접촉 기록 및 bounded cast 작업을 검사한다.
`pnpm test:physics3d-queries`는 Parry의7개 near-origin support-map 회귀를 실행하고 `CI`의 `validate`에도 연결한다.
`tight_clearance_tests`는 실제 반경을 유지한 zero/tiny/0.002 여유의512개 fit 조합과 장기 drift,
oblique gravity·compound wall·one-way·filter·jump·dynamic impulse·snap·pending checkpoint를 검사한다.
경사진 고정 바닥과 천장에서는 두 간격과 여섯 시간 간격으로 각각 1,200틱의 접선 이동 및 리플레이를 검사한다.
추가 단위 테스트는 캡슐이 구간 중간에 면을 통과하거나 유한한 면의 가장자리를 벗어나는 경우와, 큰 월드 좌표에서 반올림 때문에 실제 두 형상이 겹치는 경우를 검사한다.
여유가 충분한64개 query/contact의 수정 전 bytes와, endpoint 둘은 안전해도 중간에 벽/얇은 edge를 지나는
경우를 구분한다. Native down miss 주입은 테스트 dispatcher에만 적용하며 추가 배치의 continuous certificate
거절을 검사한다. 실제 shape의 최소 크기 검증을 우회하지 않는다.
`smoke:unified-physics-web`의 `native-landing-continuity-probe.mjs`는 실제 tarball SDK로 capsule의 바닥 접촉,
열린 공간과 실체가 들어가는 좁은 천장 아래의 남은 접선, 실제 전방벽 차단과 pending impulse checkpoint
replay를 검증한다.3 tick의 바닥/천장/벽 실체 경계도 검사하며 가까운 벽의 기존 작은 skin 후퇴는 구분한다.
공통 `browser-render-smoke.mjs`는 Chrome이 없을 때 다른 package/Studio gate와 같은
`channel: "chromium"`의 full Chromium으로 fallback한다. Channel 생략은 별도 headless executable을 선택하므로
같은 브라우저 실행으로 취급하지 않는다. 이 선택은 예제의 assertion·물리/렌더 threshold를 바꾸지 않는다.
이전 headless 조건의 초기 context-loss 기록은 별도로 보존하며 엔진의 일반 context-recovery 완료로 표현하지 않는다.
작업 상한은 pipeline cast·각 GJK support pair·BVH scan과 각 scan의 실제 leaf 작업을 구분한다.
정지 box 외의 일반 통로, 전체 piecewise/회전 CCD, 전체 numeric/allocator 및 밀집 성능 수용은
이 회귀만으로 완료 처리하지 않는다.

### 외부 파일 기반 내부 회귀

아래 검사는 공개 파일 importer의 완료 증거가 아니라 파일 기능에 연결할 내부 경계의 회귀다.
모두 기본 Core/SDK test gate에 포함하며 최종 합산 source/Wasm의 실제 실행 결과는
`artifacts/physics-3d/goal-closure/native-file-foundation/integrated/`에 기록한다.

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml engine::file_envelope::tests`:
  독립 생성295-byte 기준 파일과 encoder bytes, version/build/word 크기·예약 bit·모든 구역 범위·CRC와
  정확/한 단위 부족 한도를 검사한다. 실제 Engine 구역은 새 owner에서6 step을 이어가지만 다른 SDK 구역은
  placeholder이므로 완전한 게임 파일 복원으로 해석하지 않는다.
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml world::persistence_admission::tests`:
  sparse/reset/reuse/pending 정상 이력, 실제 private codec의 잘못된 candidate35개, entity/joint/work/scratch의
  exact/one-below 한도와 거절 뒤 원본 bytes 보존을 검사한다. Component 값 전체의 검증은 아니다.
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml world::joints::incident_prefix_tests` 및 같은
  명령의 `--release`: private generation seed 후 실제 reset/spawn/joint/codec/despawn으로 MAX-hole 오류의
  수정 전 실패/수정 후 통과와 일반3종 World payload byte 보존을 검사한다. 수십억 public 호출을 실행한 증거가 아니다.
- `cargo test --manifest-path crates/ferrum-core/Cargo.toml engine::unified_physics::file_admission::tests`:
  entity/body/fixture/terrain/joint/projectile 교차 소유권과 cold 작업/scratch 경계를 검사한다.
  World/native admission이 선행조건이며 전체 Engine payload 검증으로 확대하지 않는다.
- SDK `dataSceneVariableBindings.test.ts`: metadata capture/attach의 native 호출0, 선언/slot 대조·오류 및
  stale prepared attach 거절을 검사한다. 기존 native 값을 다시 configure하는 복원으로 대신하지 않는다.
- SDK `nativeFileJson.test.ts`: byte/UTF-8/syntax/depth/값/member/string/number 한도, escape로 같은 key를
  만든 중복과 비유한 수 거절, `-0`·Unicode·`__proto__`의 JSON 의미 보존을 검사한다.

Core는 실제 Node22/24 Rust-only WASI에서도 실행한다. Vendor 소스가 같은 경우 이전 집중 결과는 exact
해시 대조 후 상속 여부를 명시하며 재실행으로 표시하지 않는다. 최신 Wasm 뒤 Web build·SDK 전체 test/lint·
실제 tarball browser·Studio 저장/재열기·생성 프로젝트 검증을 구분한다. 공유 자원·handle/epoch·실패 원자성을
포함한 새 프로세스 전체 세션 복원은 아직 별도 미완이다.

`validate:rust-test-harness`는 World 소유 모듈 내부의 저장소 손상/예약 공간 fixture와 Engine 등 외부 호출자
테스트를 구분한다. 소유 모듈 내부 접근은 허용하지만 외부 테스트의 직접 storage 접근은 계속 거절한다.
명령은 분류·오류 위치 회귀를 먼저 실행하며 `CI`의 `validate` job의 같은 명령에 연결한다.

`engine::file_candidate::tests`는 실제 framed Engine bytes에서 새 owner를 만들고 World/변수/root/native 소유권
검사 순서를 연결한다. 유효 CRC의 NaN 변수·render offset·World velocity·elapsed 거절, strict profile·decode/
합산 work/scratch/CRC 한도, 원본 bytes 보존과 실제6 tick continuation을 검사한다. Engine getter/실행/publication을
외부로 제공하지 않으며 잘못된 SDK 구역 bytes도 아직 parse하지 않는다는 경계를 별도 회귀로 확인한다.
극대 FPS의 실제 template-spawned sprite도 capture/decode 뒤 Engine tick을 이어가며 UV 변경과 bytes를 비교한다.

`engine::file_native_roster::tests`의11회귀는 actual variable default/type/scope, live flags·texture role·clip·model LOD·
native body binding, despawn/reuse·reset-never-spawn·MAX retirement, 원래 handle이 없는 old-epoch handoff를 검사한다.
같은 값의 distinct Arc와 실제 공유 Arc/COW를 구분하고 실제 file/Engine bytes 보존·6 tick continuation과
leaf/합산 work·scratch의 exact/one-below를 확인한다. MAX 테스트는 World 소유 boundary fixture 이후 실제 lifecycle
실행이며 수십억 회 생성 이력을 재현한 것이 아니다. 마지막 metadata pass가 추가된 Candidate quota 회귀는
최종 `NativeRoster`의 정확한 한도 오류를 확인한다. 과거 실존이나 삭제된 자원 내용을 추정하는 검사는 아니다.

SDK `nativeFileResourceBudget.test.ts`의7회귀는 한 ledger의 누적 한도·remainder, intrinsic typed copy·signed zero·
finite 검사, shared/detached/proxy view 거절, accessor를 실행하지 않는 limits/record 검사를 확인한다.
알려진 필드뿐 아니라 hidden unknown·Symbol 필드도 거절한다. Bounded reader 이후의 논리 요청 한도이며
JS reflection 임시 할당·동시 GPU/host 메모리의 실제 상한은 별도다. 실제 resource owner/session 복원은 이 기반의
단위 회귀만으로 검증됐다고 판단하지 않는다.

`checkpoint_codec::tests::fallible_sequences`6개는 legacy4 helper wire/capacity·independent Serde, hostile length
hint, shared exact/one-below quota, truncation 뒤 부분 값 Drop/input bytes, 실제 reservation error와 논리 quota의
구분·first/sticky failure/scope cleanup을 검사한다. 결정적 layout overflow 테스트를 실제 OS OOM으로 부르지 않는다.
별도 `native-file-fallible-sequences/measurement/`의 test-only System delegate는 selected alloc/realloc에서
null을 반환한다. 수정 전 Native4경로의 allocator message+SIGABRT를 확인하고 수정 후 Native/Node22/24 WASI
각18개 실패를 typed Allocation으로 반환하며 tracked live payload0·다음 scalar decode 정상임을 확인한다.
Native 정상4case의 payload/논리 Usage/요청 수도 전후 같다. WASI 이전 null matrix나 process RSS cap 검증을
수행한 것으로 확대하지 않는다. Main/production에 global allocator나 새 unsafe를 추가하지 않는다.

`engine::file_native_resources::tests`17개는 실제 candidate의 resource domain/owner/role/sentinel, 현재·미래 prefab·
retained snapshot/cache·pending spawn의 captured IDs, raw fraction/signed/-0 packet·duplicate, base/미래 LOD/옛 draw,
bitmap font·glyph cache·cleared HashMap capacity, codeconstant/Alpha-cache shader와 non-render tile owner를 검사한다.
Shared/equal-distinct Arc·memory/file bytes·COW,8회 fresh decode deterministic output/Usage, leaf/합산 exact·one-below와
손상 선행 거절·원본6tick도 확인한다. Candidate의 마지막 quota 오류는 NativeResources Work/Scratch여야 한다.
Metadata 사실 추출을 loaded resource content·역사적 entity 인증·SDK 세션 Ready의 검증으로 대신하지 않는다.

`physics3d::angular_ccd_bounds_tests`6개와 vendor `angular_bounds_`7개는 실제 public45도 mid-tip 누락 전후,
shape/compound/COM-offset·cap/damping/force·snapshot continuation·record capacity와 작은 각도 비용을 검사한다.
기존 linear12조건의 payload/다음 tick24개·state/order/counters를 전후 비교하고 angle0 union bits를 보존한다.
특정 small-angle/offset matrix에서 off-plane500 target의 checks0을 확인하며 전체 밀집 성능 수용으로 확대하지 않는다.
독립 vendor의 opt-in full-turn narrowphase와 전체 piecewise 회전 경로는 별도 미완으로 기록한다.
작업자 vendor 결과를 재사용할 때는 해당 vendor source 전수 SHA와 원명령·실제 종료를 대조하고 Root 재실행으로
표시하지 않는다. 합성 Main은 별도 전체 Native/WASI와 fresh packed runtime으로 검증한다.

`kinematic-accepted-motion/`은 solver와 같은 angular cap/COM/damping/pass writeback으로 preview/path/carry를
예측한다. Core8개·vendor2개 회귀와 linear8조건×7tick의56개 payload, authored angular 입력·actorless 실제
출력 보존을 확인한다. Joint COM의1ULP 차이를 tolerance로 숨기지 않는다. Main1725 전체 Native3094개와
실제 Node22/24 WASI각3094개 통과를 기록하며 production Wasm/SDK의 후속 통합 검증과 구분한다.
충돌 이벤트가 선택한 짧은 dt의 prefix 운동 및 전체 구간별 회전 수용은 이 결과만으로 완료 처리하지 않는다.

SDK `nativeFileResourceCodec.test.ts`17개는 f64/-0·raw f32 bits, object/view/backing alias와 equal-distinct,
offset·전체 backing·prototype·lone surrogate·undefined 보존, 손상 참조/범위/byte order/한도와 getter 비호출을
확인한다. Primitive leaf 깊이와 공유 graph의 가장 긴 경로도 검사하며33개 node로 지수 개 경로를 표현한 DAG를
경로별로 반복 순회하지 않는다. Node22/24 집중 검증과 resource owner의 실제 GPU/audio 준비 검증을 구분한다.

`test:wasm-bindings-factory`와 `wasmNamespace.test.ts`/`wasmMemoryLimit.test.ts`는 생성기 입력 변경 시 fail-closed,
memory section만의 최대치 축소, 독립 Engine/메모리·same-input promise·different-input 거절·초기화 중/완료 직전
dispose와 trap 뒤 호출/finalizer 차단을 검사한다. SDK build는 factory를 생성하고 package check는 정확한 최신
생성물 두 파일의 포함을 확인한다. 실제 allocator trap·held source view와 다음 tick 보존, Node22/24/Chromium,
packed consumer/public declaration/default import graph 증거는 `native-file-isolated-target-review/implementation/`에
별도로 기록한다. 이전 Core1724 기반 작업자 실행을 새로운 Main1725 production 실행으로 표시하지 않는다.
독립 namespace 기반 자체를 전체 파일 importer·Ready·세션 publication 완료로 판단하지 않는다.

`engine::file_prepare::tests`는 실제 파일 candidate의 bulk metadata, SDK 구역 복사/repack, 누적 한도와
대상 owner/revision·한 번 설치·설치 후 checkpoint 소유권을 검사한다. Context 회귀는 발판이 이동한 Data Scene의
raw/configuration revision 차이와 Builtin의 저장 Data epoch/현재 epoch 차이를 보존한다.
`nativeFileNativeFacts.test.ts`는 독립 schema fixture와 실제 packet의 table 범위·layout·enum·한도를 검사한다.
`nativeFileRuntimeNative.test.ts`는 fresh production Wasm에서 Native 설치 뒤6 tick의 물리·출력·재포착 파일 bytes를
비교한다. 잘못된 SDK build/CRC·선복사 quota와 실제 제한 메모리 constructor trap에서 원본의 전체 메모리·보유
view·checkpoint replay를 확인한다. 더미 SDK 구역을 사용하는 Native participant 검증은 전체 Ready 증거가 아니다.

`nativeFileMetadataAdmission.test.ts`는 candidate 사실만으로 작성/변수 metadata를 admission한 뒤 실제 SDK
factory의 canonical adapter에 한 번 연결한다. 저장 baseline을 현재 Native 값으로 고치지 않으며, Native-only
rollback 뒤 slot/type/scope/default와 맞지 않는 operational 변수 metadata는 거절한다.
`nativeFileRuntimeHost.test.ts`는 실제 facade의 초기/current 물리 metadata, 옵션·frame의 부재/undefined/-0·alias,
등록 callback 역할과 source/registry fence를 검사한다. Callback 실행으로 identity를 추정하지 않는다.
`nativeFilePhysicsNamespace.test.ts`는 기본 Wasm 미초기화 상태에서도 독립 대상의 geometry/tile/joint preflight와
mask 생성이 가능한지 확인한다. 실제 malloc trap 뒤 대상 poison·late free 차단과 default/peer 전체 메모리 보존을
검사한다. Typed validation 실패와 실제 allocator trap을 구분한다.

`nativeFileAuthoringResolvers.test.ts`는 actual factory의 canonical resolver, 예약됐지만 미로딩/해제된 texture 이름,
등록된 opaque wrapper, provider의 성공 시 materialization을 실제 파일 candidate 설치와 함께 검사한다.
Capture/admit/attach에서 callback/provider를 실행하지 않고, namespace·registry·host 등록 변경은 기존 cut을
무효화해야 한다. 설치 뒤 metadata 연결에 실패해도 새 대상 metadata는 비어 있고 원본 Native bytes는 유지한다.

`nativeFileRuntimeSession.test.ts`는 전체 구역 capture/admit/install/commit과6 tick 재실행, 손상된 SDK 구역의
유효 CRC 거절, stale/discard와 차용 자원 정리 순서, 새 callback 연결 및 외부 함수 참조의 재저장을 검사한다.
일반 자원 graph의 기본 한도/Usage는 유지하면서 작성 metadata는 별도 고정16 MiB profile을 사용한다.
Coordinator의 브라우저 검증은 실제 WebGL2 texture·mutable JSON/-0·font·두 audio intent와 작성 registry/변수,
원래 clip3과 현재 clip6의 분리·재저장을 확인한다. 두 번째 GPU 할당 실패와 실제 AudioBufferSourceNode.start
실패에서 기존 pointer/epoch·font membership/order·오디오 가용성을 확인한다. 일반 host 등록이 font fence와
충돌하던 실패는 보존하고 private owner 분리 뒤 같은 probe를 다시 실행한다. 작업 사본의 이전 Wasm 증거와
현재 tarball에서 실제 로드한 Wasm digest를 확인하는 Root 검증을 구분한다.

`kinematic-relative-contact-timeline/`은 최초 회전 접촉 후 남은 구간을 고정 접선 속도로 밀어내던 결함을
검증한다. 실제 구간 끝 형상의 분리 plane을 기존 제한된 timeline에서 다시 cast하며 단일/복수 character 경로를
함께 확인한다. 기존108조건의 관통24건 수정, 원래 skin의 양수 간격, snapshot 재실행과 linear56개 payload·출력·
순서·counter 보존을 대조한다. 이 행렬을 전체 회전 trajectory·밀집 성능 수용으로 확대하지 않는다.

Standalone `dialogue_quest::file_state::tests`5개와 SDK `nativeFileDialogueQuest.test.ts`11개는 실제 공유 Rc의
wrapper 삭제 후 진행·NativeAbsent·같은 값의 distinct owner·6회 continuation을 검사한다. 성공한 같은 값 restore와
registry/lifecycle/준비 graph alias 변경은 기존 fence를 무효화해야 하며 one-use consume·foreign owner·discard를
확인한다. Probe16/32B와 body 크기를 같은 ledger에 선청구하고 stale header는 본문 생성 전에 거절한다.
Strict native Unicode flag 순서·중복 거절, 정상 임의 stage/중복 objective 보존, immutable content의 prototype key·
alias/cycle/undefined/sparse/-0와 실제 native packet의 입력 byte 동일성도 포함한다. 부분 factory 실패는 새 native
wrapper의 실제 free와 source 불변을 확인하는 JS fault 주입이며 실제 OOM 회귀가 아니다.

해당 Main 통합의 `native-file-dialogue-quest-admission/integrated/run-dialogue-browser.mjs`는 fresh production
Wasm을 포함한 실제 packed runtime의 internal owner를 별도 Chromium에서 실행한다. 로드된 Wasm/tarball SHA,
shared Quest wrapper 삭제·NativeAbsent·6회 진행·prepared alias stale와 page/console error0을 확인한다.
원래 package browser smoke와 구분한 수동 통합 검증이며 전체 Engine importer 또는 원격 CI gate 완료를 뜻하지 않는다.

`engine::file_frame_admission::tests`는23-field 출력의 실제 memory codec roundtrip과 정상 과거 handle·HDR·signed 값,
정수 event payload 및 actor height 부재 NaN을 보존한다. Material alignment·triangle/경로 stride·audio pose count,
각 출력 family의 손상 수치, animation overflow 인덱스/종류/sentinel과 정확 work 경계를 검사한다. Default/Data
실제 frame60회와 복원 후6 tick도 포함한다. Candidate 회귀는 유효 CRC의 잘못된 overflow index가 반환 전에
거절되며 원본 file/Engine bytes가 유지되는지 검사한다. 이 범위를 전체 출력 provenance나 자원 승인으로 보지 않는다.

`engine::file_engine_section::tests`는 file-only prefix/version/reserved·CRC·trailing 오류, 기존 memory bytes 보존과
실제6 tick continuation, 양쪽 table을 포함한 단일 누적 decode allowance의 exact/one-below를 검사한다.
독립 default scope를 시작하지 못하는 중첩 decoder도 확인한다. 여기의 generic table codec 검증은 실제 Arc
공유 관계 복원 검증과 구분하며, 해당 조립 전 단계 기록은 `artifacts/physics-3d/goal-closure/native-file-sharing/integrated/`
아래 `root-stage-qa/`를 따른다. 이 단계는 새 public SDK/배포 Wasm 검증이 아니다.

공유 table을 연결한 뒤의 최신 소스·검증은 같은 경로의 `alias-stage/` 기록을 따른다. 그 전 Root-only/generic
codec 결과를 현재 typed table 전체 결과로 바꾸어 부르지 않는다. Candidate의 실제 shared clip/shape와 같은 값의 별도
Arc,6 tick bytes·COW·late shape failure 격리, clip-only/no-native와 forged presence, 실제 table의 누적 decode exact/
one-below를 검사한다. Root/compare/work/scratch를 각 owner에 새로 주지 않고 합산 차감하는 회귀도 포함한다.

`engine::file_shared_arcs::tests`는8개 owner root의 실제 route cache/agent/connector·prefab/prototype/World/continuity
producer와 private table 손상을 구분한다. 같은 파일24회 fresh decode의 Usage·graph·bytes와 정렬8크기×5주소 패턴을
검사해 주소가 quota 성공에 영향을 주지 않아야 한다. `physics3d::file_shared_shapes::tests`는 실제 vendor 공유 producer,
같은 값의 별도 shape·Compound parent/child·7종 geometry·stale proof/Custom Shape tag spoof와144-byte table golden을 검사한다.

`physics3d::broad_phase_reuse_tests`는 alias를 호출하지 않는 삭제→동일 slot/new generation→다음 step의 원래 실패를
검사한다. Pair/adjacency reciprocal 관계·old generation 제거·exit/enter·이후6 tick snapshot/query가 유지되어야 한다.
재사용하지 않는2공간×6 lifecycle×6 tick의 broad-phase/pair event/Core event21,724-byte golden도 보존한다.

Tilemap 회귀는 저장11필드·navigation8 collection과 CRC를 다시 맞춘 실제 Engine malformed heap의 거절, 정상 heap
48크기 wire 보존과 logical quota를 검사한다. Center가 overflow하는5개 query는 false를 반환하고 이후 정상 query/
codec/tick을 이어갈 수 있어야 한다. Layer width는 저장에서 정규화하지 않는다. 연결 candidate는 decode 자체가 이미
검사하는 layer와 구분해 실제 post-decode definition payload의 valid-CRC NaN 거절도 확인한다.

`engine::navigation_distance::tests`는 finite center에 대한5개 public query의 기존 infinite distance를 재현하고,
정상 f32 bits·추가 순회 없음·wide multi-segment 거리·f32 MAX 반올림 경계·표현 불가능한 total을 검사한다.
실패 직후 codec와 이후 정상 query를 이어가며 path 실패의 출력 clear와 waypoint 실패의 기존 path history 보존을 구분한다.

`engine::file_data_movement_admission::tests`와 candidate의 `data_movement_integration`은 실제 Data Scene grid/장애물/
route/animation producer를 memory codec와 연결한다. 겹친 explicit/automatic overlay, 현재 World와 달라진 과거 collider,
grid clear/교체 직후의 이전 search·route, 삭제된 actor/binding, 실제 음수 거리 credit의 bytes와6 tick을 검사한다.
유효 CRC의 수치/cursor/facing/coverage 손상과 nested sweep debug history는 clear하지 않고 거절해야 한다.
최대64개 automatic obstacle의4096-cell coverage를 순회하기 전에 work를 청구하며, 모든 owner의 work/scratch를
candidate의 하나의 allowance에서 차감하는 exact/one-below 경계도 검사한다. 현재 증거와 미실행 gate는
`artifacts/physics-3d/goal-closure/native-file-data-movement/integrated/`를 따른다. Scratch worker의 격리 결과나
앞선1575 소스의 production Web/Wasm/Studio/consumer 결과를 새 조립 소스의 전체 실행 결과로 사용하지 않는다.

`file_gameplay_authoring_`와 candidate의 `authoring_snapshot_integration`은14필드 작성 스냅샷의 실제 public
capture/restore·16개 행동/반응/변수 trigger와6 tick, 유효 CRC의 숨은 수치/backing 손상 거절을 검사한다.
공통 gameplay predicate 추출은 World의 기존 entity admission 예산과 정책을 유지해야 한다.
`physics3d::snapshot::controller_contract_tests`는 public enable과 같은 capsule skin·현재 body/local 축 조건,
정상 경계·반대 축·local 보상·예약 target history·6 tick을 검사한다. 전체 CharacterRuntime 검증으로 확대하지 않는다.

별도 `character_runtime_admission_`18회귀는 Runtime 저장12필드와 Preview/합산 사본,48종 runtime 손상·20종 사본
손상 및 config·raw characters map 순서/중복을 실제 Native CRC codec로 검사한다. 공개1024 controller와 추가63
sensor, 실제 preview cohort의 정확 work/한 단위 부족·scratch0·원본 bytes를 확인한다. Grounded jump·대기 외력·
입력/관측의 signed zero, 삭제된 support/stop, clear/re-enable 뒤 이전 사본, 명령 상한을 넘는 결과 속도와 실제
2-knot ceiling 접촉 뒤 하강을 보존한다. Nested native decoder의 기존 누적 values/allocation allowance도 검사한다.
이 native character 논리 방문 한도는 candidate의 post-decode 한도와 독립이며 실제 allocator/RSS 상한이 아니다.

`runtime_order_`6회귀는 public producer로 만든 실제 Engine/file 후보와6 tick, binding/inverse/terrain4곳의
원시 swap/duplicate8개 valid-CRC 거절을 검사한다. 관련 runtime 저장 map/set11곳에 적용한 adapter의 정상
standard Serialize·empty/single/sparse/None/Some·signed zero, 기존 decode 청구량 동등·exact/one-below·실패 뒤
fresh scope와 duplicate value를 읽기 전 거절도 확인한다. 전체 Runtime32 payload 의미 검사를 대신하지 않는다.
게임플레이 foundation8회귀는 공통 queue/contact/cache/template의 정상 history·손상 거절·예산을 검사한다.
이 조립의 실제 Source·종료 결과는 `artifacts/physics-3d/goal-closure/native-file-runtime-admission/integrated/`의
`main-qa/`와 `main-wasi/`를 따른다. 이전1639의 production SDK 결과와 새 Main Rust/WASI 결과를 구분한다.

`engine::file_spatial_admission::tests`는40종 struct/259필드 census를 기준으로 공간 씬/환경/모델/지형/navigation/
continuity의 실제 codec와 producer를 검사한다. 저장 heap·6종 ordered map/set의 raw 순서/중복은 정규화 전에
거절해야 한다. 정상 standard Serialize bytes, empty/single/sparse·역순 public 입력·누적 decode exact/one-below·
실패 뒤 fresh scope를 검사한다. Candidate의 `spatial_integration`은 실제 렌더 상태와6 tick, 유효 CRC의 camera/
frame/mask 손상, terrain clear 직후 history와 공통 allowance 경계를 검사한다.

`controller_admission_`은 실제 actor route·native search/cache/crowd·query snapshot·one-way 계약을 검사한다.
동일 값의 별도 Arc와 공유 복원, stale token·pending connector·거절된 high-floor 요청 이력을 구분한다.
`engine::file_physics_output_admission::tests`는40개 출력 root의 정상 history·static 무한 값·bulk 중복/순서·
13종 native joint·수치/길이/코드 손상과 논리 work/scratch 경계를 검사한다. Candidate의
`controller_output_integration`은 실제 파일의 route/중복 출력과6 tick, 공유 복원 뒤 controller 손상 거절,
물리 출력4종 손상의 유효 CRC 거절과 원본 Engine/file 보존, 합산 exact/one-below를 확인한다.
현재 조립 소스의 명령·종료·범위는 `artifacts/physics-3d/goal-closure/native-file-gameplay-snapshot/integrated/`의
`combined-owners-qa/`와 `combined-owners-wasi/`를 따른다. 담당 mirror의 개별 통과나 앞선 production 검증을
현재 Main 전체 제품 검증으로 대체하지 않는다.

`file_data_gameplay_`와 descriptor/ActorPrototype 회귀는 실제 전투·검색 대기·일시정지·prefab 원본 삭제·
현재 설정과 다른 과거 경로의 bytes와6 tick을 검사한다. 유효 CRC의 숨은 수치·중복 key·합산 work/scratch
손상을 거절해야 한다. `runtime_observation_admission_`16회귀는 내부11 owner의 수치·길이·순서와 event overflow,
최대 설정 backing·query max64·삭제 뒤 history를 검사한다. 원본 World를 query하거나 통계를 재계산하지 않는다.
Candidate의 `stored_owners_integration`은 공개 melee·query와6 tick, 유효 CRC의 gameplay 손상6종,
공개 출력 clear 뒤 남은 내부 cache 손상2종 및 공통 exact/one-below allowance를 확인한다.

`file_candidate::tests::builtin_integration`은 비활성 내장 scene을 포함한30종 손상과 native leaf6종,
정상 codec·6 tick·누적 quota를 검사한다. Platformer player의 한 손상은 기존 root 검사가 먼저 거절한다.
`native_ray_sphere_center_`는 실제19-word public query의 유한0 법선과 invalid followup의 내부 cache를 검사한다.
Vendor `query::ray::ray_ball::ferrum_tests`는 원래 유한했던 법선·TOI의 비트와 중심/zero-direction fallback을
직접 비교한다. Vendor lib 결과와 Core/실제 WASI 및 production SDK 결과는 별도 source·명령 근거로 구분한다.
현재 조립의 근거는 `artifacts/physics-3d/goal-closure/native-file-data-gameplay-admission/integrated/`이며
구 중심 NaN의 수정 전 재현과 vendor 명령은 `artifacts/physics-3d/goal-closure/native-ray-sphere-normal/`이다.
개별 저장 검사 통과를 전체 public importer·실제 메모리 한도·resource/session Ready 완료로 확대하지 않는다.

`runtime_payload_`는 나머지 runtime16의 정상 pending prefix·platform default suffix·stale/unbound 설정,
raw 이전 config·spatial dash history와 숨은21종 손상을 검사한다. Main에서는 실제 유효 CRC의 파일 prepare가
21종 모두 `RuntimePayload`로 거절하는지 추가 확인한다. Candidate의 `runtime_payload_integration`은 정상
전체 planar cache와 spatial source의 bytes/6 tick, 모든 후속 검사까지 포함한 정확 quota·한 단위 부족을 검사한다.
원본 owner의 격리 결과와 Main 연결·테스트 전용 delta를 구분한 근거는
`artifacts/physics-3d/goal-closure/native-file-runtime-payload-admission/integrated/payload-stage/`를 따른다.

`packages/ferrum-web/test/nativeFileHostBindings.test.ts`는 실제 source identity와 새 host의 typed symbol 해소,
명시적 alias·미등록/foreign/위조 type/다른 버전·getter/코드 metadata 거절, stale/reused 준비 token·해제/재등록,
공유 work/metadata quota의 exact/one-below를 검사한다. 파일을 읽거나 준비할 때 등록 guard나 adapter를 호출하지
않고 실패가 기존 binding을 교체/폐기하지 않아야 한다. 이 내부 registry의 단위 검증을 실제 GPU/font adapter나
전체 대화/퀘스트·Engine 세션 복원으로 대신하지 않는다. 근거는
`artifacts/physics-3d/goal-closure/native-file-host-bindings/`이다.

`file_presentation_` 회귀는5개 owner의 실제 private codec과 public producer, glyph/fallback/kerning·text cache,
중복/과거 tween target·impact pair/deadline·particle capacity/RNG0·raw preset finite 정책을 검사한다.
문자열 byte 사전 청구·one-below work/scratch·compacted Clone backing과 이후 실제 tick의 bytes도 포함한다.
Candidate 회귀는5개 owner 각각의 유효 CRC 손상을 연결된 guard가 반환 전에 거절하는지 확인한다.
조립 후 current-source native/WASI 근거는 같은 경로의 `presentation-stage-qa/`를 따르며, 앞선 격리18회귀와
Root frame-only 단계의 결과를 최신 전체 조립 실행으로 바꾸어 부르지 않는다.

`world::payload_admission::tests`는45종 component/8종 joint의209개 named NaN 후보, 숨은 backing/count/packed/
중복·guard, clip/timeline 관계와 정상 pending·stale 참조·30 tick replay를 검사한다. Empty1024와 실제 Some에만
추가하는 작업 예산, nested-item/work/scratch의 정확 경계도 포함한다. Source history를 정리하거나 raw geometry의
유한 퇴화값을 모두 거절하는 검사로 바꾸지 않는다.
`gameplay_variables::file_admission::tests`는 실제64-slot slab의 default/current를 검사한 뒤 layout을 추출하며
48개 private codec 손상과 sparse7/2/64·full64·canonical zero·원본 값/bytes 보존을 검사한다.
`engine::file_root_admission::tests`는37개 실제 private codec 후보와 정상 음수 legacy elapsed·epsilon accumulator·
stale clock/camera/scene handle·raw auto config 보존,24/25/26 work 경계를 검사한다. Root 설정 범위이며 전체 Engine은 아니다.

`components::sprite::advance_tests`는 기존 bounded f32 reference와 일반360조합/128 tick 및4096회 경계 bytes를
비교한다. 같은 public `horizontal(2, f32::MAX)`/1⁄60 입력의 기존 child는2초에 반환하지 않아 owned process를
종료했으며 새 child는 정상 반환해야 한다. 극대 FPS·tiny FPS·overflow·cast-to-period 보정·u32MAX count와
state switch/invalid dt, 실제 codec continuation을 검사한다. Native/실제 WASI phase144word/576bytes도 대조한다.
이 child 시간은 개별 함수의 성능 benchmark나 전체 frame budget으로 사용하지 않는다.

SDK `nativeFileAuthoringBindings.test.ts`는 실제 직렬화 DTO·removed/shared instance·model/texture 대응, getter와
tree/reference 확장 한도, foreign/stale/reused attach와 실제 Wasm의 source capture 불변을 검사한다.
Caller-provided roster 검사와 실제 native/resource admission·fresh Engine file import를 구분한다. 기존 continuity/
registry/document/snapshot 및 physics JSON-progress 거절 회귀도 유지한다. 현재 통합의 소스·실제 명령/종료/Wasm·
SDK·Studio·consumer 증거는 `artifacts/physics-3d/goal-closure/native-file-candidate/integrated/`를 따른다.

### Rust-only WASI 실행기

`rustup target add wasm32-wasip1` 후 `pnpm test:rust-wasi`는 기본 unit·integration 전체를 실제 WASI로 실행한다.
Node/target 디렉터리를 고정하려면 `--node <node-path>`와 `--target-dir <directory>`를 사용하고,
`--` 뒤에 Rust test filter·옵션을 전달한다. Cargo runner는 shell 없이 TOML 인수 배열로 구성한다.
`node --test tests/smoke/native-wasi-runner.test.mjs`는 import 거절·WASI 설정·경로 인수 계약을 검증한다.
`CI`의 `validate`에서 두 명령을 실행한다.

실행기는 WASI `env`·`preopens`를 비우고, 선언된 wasm-bindgen placeholder는 호출 시 거절한다.
공개 `Result<_, JsValue>` capture 회귀가 링크하는 Debug/drop의 cold import도 같은 거절 stub을 사용한다.
이 import의 선언 수용은 JS 실행 허용이 아니며, 실행기 회귀는 각각을 실제 호출하면 실패하는지도 검사한다.
성공한 Rust-only 실행은 `deniedBindingCalls:0`과 실제 거절 capability 목록을 출력해야 한다.
Node22에서 관측한 `fd_write` FastAPI→V8 GC host fault는 같은 출력 함수를 얇은 JS forwarding 함수로
호출해 우회한다. 다른 WASI 함수·권한·Rust assertion·기본 stack을 바꾸지 않으며 upstream V8 자체의 수정은 아니다.
Node24 통과를 Node22 해결 근거로 대신하지 않는다. 원본 SIG11·우회 A/B·별도 panic=abort trap·최종 전체 실행을 구분한다.


### Studio 문서-local component templates 회귀

`pnpm test:placement-flat-lighting`은 `placement-template-authoring.test.mjs`도 실행한다.
문서-local catalog와 collision tile graphic의 color/data texture 역할, 원본 JSON pointer의 에셋 사용처,
공유 component의 read-only 경계를 실제 SDK source bundle로 확인한다.
`packages/ferrum-web/test/dataSceneLocalComponentTemplates.test.ts`는 resolve/apply/viewer/patch/save/handoff가
raw reference와 root catalog를 보존하는지, 외부 override의 이름별 한 번 lookup과 사전 거절이 기존 native scene을 유지하는지 검사한다.
기존 template physics/animation continuity 테스트와 함께 실행한다.

브라우저 functional fixture는 `tests/fixtures/placement.native-templates.scene-authoring.json`이다.
기존 Studio의 문서 열기로 불러와 shared native body·controller·named joint와 등록된 `floor` tile texture를 확인하고,
선택/picking·transform patch·Undo/Redo·Play/Stop 뒤 authored catalog/reference가 보존되는지 검사한다.
이 fixture는 새 visual body/tile editor나 renderer 성능 gate를 제공하지 않는다.


실제 Native 시간선과 응답의 후속 회귀는 같은 완성 소스 묶음에서 실행한다.

- `queries::step_motion::logical_clock_tests`는 물리 F32 fragment 합이 전체 tick과 다른 실제 입력을 사용한다.
  같은 fragment·force·각속도로 실행한 원 Native control의 pose/velocity/force 비트와 대조하면서 정확한 tick 끝,
  global curve domain·저장 query fraction·연속성을 검사한다. Nonzero 시작에서 실제 여러 CCD pass와 prepared
  constant suffix가 같은 경계를 사용해야 한다. Native physical h와 logical D가 다른 suffix 및 원본 bytes도 대조한다.
- 앞 CCD slice 승인 후 뒤 slice 거절·재시도에서는 승인 prefix가 trace reset 전에 보존돼야 한다. 미승인 suffix를
  승인하거나 뒤 이동을 tick0부터 재생해서는 안 되며, normalized fraction 왕복의 오차가 producer 시작 시각을 바꾸면 안 된다.
- `backend::physical_momentum::tests`와 실제 impulse seed 회귀는 같은 row의 cached raw seed·독립 질량/관성 J·
  raw writeback을 대조한다. Different h/D·nonzero global domain·변경 없는 회전 물체 bytes와 기하 전용 J0을 구분한다.
- `backend::classification::tests`는 선택된 stop만 미리 분류하고 unrelated/지원 밖 body·세대·Work/scratch·rollback
  수명을 지키는지 검사한다. 실제 Native 실행 감소는 원 case-tagged 호출·승인·promotion 기록으로 판단한다.
- `representable::self_reference::tests`는 원 계단의 safe/hit·exact rate·full-shape cast/endpoint를 유지한다.
  첫 offset fit과 인접 inverse cell의 차이를 확인하며, 일반 support/J 권한이나 전체 계단 Engine 성공으로 확대하지 않는다.
- `character_contacts::solver::strict_geometry::tests`는 실제 cap 포함3행의 정체와 한 ULP 후보, 전체 행 동시 만족,
  공정 pair·unrelated actor·Planar Z·진짜 infeasible·원본/한도 오류를 검사한다. 기존 strict 성공과 물리 tolerance는 유지한다.
- `rounded::finite_image::tests`와 `rounded::output::query_image::tests`는 원 shape/leaf 결과, provenance와 Cartesian
  image 분리, 후행 다른 plane의 반박, typed error 순서, 정확/한 단위 부족 Work와 bytes를 대조한다. 캐시 hit에서
  실행하지 않은 중복 작업만 절감하고 다른 interval의 증명으로 재사용하지 않아야 한다.

- `backend::clock_phase::tests`는 실제 회전 cap의 재접촉·기하 위상 후보와 전체 tick credit·실제 stop 시각·
  저장 query·6tick snapshot continuation을 검사한다. 먼 driver 음성 대조는 공식 fast-rotation 설정으로 명령40을
  명시하고 독립 Native-only 전체 body state와 비교한다. 기본 회전 cap을 contact stop으로 오인하지 않아야 한다.
- `solver_trajectory::cardinal_tests`는 원 축 순서와14칸 한도를 지키는 후행 world 방향, 원 F32 full-shape 판정,
  닫힌 skin·기존 initial margin·inward/outgoing·오류·exact/한 단위 부족 Work를 확인한다.
- `rounded::output::axial_image::tests`는 실제 계단 실패의 원 Kernel·h/domain·형상·구간을 보존한다. 변하는 접선의
  유한 F32 출력 전수를 원 full leaf와 대조하고 같은 구간 cast를 검사한다. 축 permutation·양쪽 순서·skin 바로
  아래/같음/바로 위, 실제 inward, 회전/다른 좌표 변화/box 원점/유한 slab/비축 core의 인증 거절도 대조한다.
  정확·한 단위 부족·overflow Work와 원 motion bytes·실패 cache 비게시를 검사한다. 이 구간의 증명만으로
  원 계단 Engine 전체 성공을 주장하지 않으며, 기존 checked stairs의 실제 전체 이동도 별도로 통과해야 한다.

- 회전 경로의 pre-tip 충돌 분율 회귀는 공식 per-body fast-rotation 설정을 명시해 실제 quarter-turn을 검사한다.
  기본 cap 대조는 별도 Native-only raw 각속도와 원 target endpoint를 확인하고, 제한된 연속 경로와 마지막
  position target projection의 충돌을 구분한다. 원 도형의 full-shape gap과 full tick credit도 확인하며, 관측용 F32
  fraction이1로 반올림된 결과를 중간 시각의 충돌이나 기본 회전 cap 해제로 해석하지 않는다.

- 실제36-context 경계 oracle은 Native producer와 같은 fraction-first 독립 scalar 식 및 정확한 양 끝 비트를 쓴다.
  곱셈/나눗셈 순서의1ULP 반례와 actual trace 경계를 분리하고, 원3body·extra32·curve 및6tick bytes를 유지한다.
- 회전 suffix의 실제 곡선 회귀는 Native context 경계와 응답으로 추가된 actor breakpoint를 구분한다. Actor의
  기록 개수를 Native cadence와 같다고 가정하거나 양 끝 자세를 lerp하지 않고 원 Kernel/Anchored/Constant의
  겹치는 실제 구간과 명시적 순간 배치를 검사한다. 기존 원 full-shape sampling·정지 없음·endpoint 조건과
  checked full tick·이후6tick 저장/복원 일치를 함께 확인한다.
- 동시 CG carry 회귀는 실제 pair-wall 정지와 반대 입력·접선·순수 pusher·physical 행 제외·순서/64-chain,
  PGS 전 canonical identity·oblique 반올림, 실행 Work의 정확/한 단위 부족·scratch·재시도를 대조한다.
  원 Engine 이동/정지 case의 checked full tick·J0·입력·snapshot을 함께 검사한다.
- 반복 pair 검색은 실제40-body prescribed 장면과 원 후행 충돌/changed-curve/초기 grazing 대조를 유지한다.
  재사용 자격·새 초기 leaf·scratch 실제 capacity·epoch/filter·오류/bytes/정확 Work를 같은 완성 단위에서 검사한다.
- Backend origin의 tight-ground 검사 비용은 지원면 없음·미지원 actor·filter·compound·충분한 overhead를
  원 판정과 대조한다. 두 scan의 기존 합산 단가와 실제 실행 전 선청구, 정확·한 단위 부족 Work, 비활성 actor와
  완성된 census 재사용을 검사한다. 새 census의 후행 WorkLimit·NonFinite·stale ID 실패에서는 부분 목록만
  무효화하고 used·원 pending 상태·세계 bytes와 재시도 결과를 보존해야 한다. 이 지역 비용 검사와 원40/새40의
  실제 checked full tick·20개 정지·저장/복원 성공은 별도 조건이다.
- 초기 support와 normal suffix는 같은 실제 safe pose에 다른 polynomial/clock을 부여한 대조, 원 full radius,
  local COM·비단위 q·양수/0/overlap·oblique positive gap·부분 cloud 거절, 원 실제 ground cell의 full-future cast를
  검사한다. 유효 instantaneous Constant와 near-start/큰 좌표 보정 크기도 확인하며 skin이나 기대값을 낮추지 않는다.
- 초기 noninward 수치 안정 대역은 정적 기하 gap과 별도로 검사한다. 기록된 elevator·같은 속도 벽의 원 전체
  후행 query, 동일 자세 표현,0·음수 overlap·큰 좌표의 비침투, strict/inward 및 skin 밖 대조를 유지한다.
  새 cell/축 방문의 정확·한 단위 부족 Work와 입력 bytes도 검사한다. Same-pose의 원 leaf distance/witness와
  full-support 인증을 구분한다. Strict no-hit만으로 노이즈가 있는 초기 leaf가 skin 밖이었다고 추론하지 않는다.
  별도의 명시적 안쪽/바깥쪽 Constant 배치는 원 leaf gap을 먼저 확인한 뒤 strict 초기 hit/no-hit를 대조한다.
  기존 Engine elevator·접선/축 잠금 회귀의 assertion도 함께 통과해야 한다.

- Actual row 작업량은64개 이미 만족한 군중의 독립 방문 합계, legacy bit/iteration 일치, 실제 CG·strict 재방문,
  역입력·physical 제외·64 pusher 태그, 정확·한 단위 부족·offset retry·memory/bytes 원자성을 확인한다.
- Whole-bound cache는 같은 query의 fresh/warm bound·scene order·first-hit bits를 대조하고 다른 하위 구간은
  원 계산과 같아야 한다. 원 Native clock별 재시도·Constant domain·shape/gen/force 변경·실패 비게시와
  실제 retained capacity·growth 이전 backing 해제의 요청 메모리를 검사한다. CPU/RSS 상한으로 부르지 않는다.
- NoHit와 leaf 관측 metadata를 구분한다. AABB gross-skip은 실제 gap이 skin 밖이어도 observed strict-prefix를
  만들지 않는다. 같은 원 Box/Capsule의 AABB가 겹치는 모서리 대조에서는 실제 Native gap을 먼저 확인한 뒤
  strict-prefix 자격과 재사용을 검사한다. Lowered-margin NoHit를 요청 skin의 prefix로 올리지 않는다.
- 유한 질량 응답의 캐시는 실제 전체 구간의 분리를 먼저 확인한다. 같은 순서와 궤적, 구간에서 충돌 시각
  허용 오차를 바꿨을 때 두 번째 검사가 생략되어야 한다. 부착 자세, 궤적, 구간을 바꾸거나 엄격한 분리
  증명이 없으면 원 검사를 유지한다. 정면 충돌의 원래 위치·속도·운동량 검사로 Box 반올림 경계와 전체
  물리 틱 완료를 검증한다. 반대 방향 충돌과 동시 충돌은 각각 원 사례로 확인한다.
- 회전 Box의 움직이는 면은 기록된 공유 X 이동 구간과 독립 이동의 전체 후속 구간을 검증한다.
  원 분리 간격의 성공, 더 큰 간격의 거절, 정확·한 단위 부족 Work를 확인한다. 반대 방향의
  원 엔진 사례는 두 틱의 선운동량 전달, 충돌로 생긴 회전, 접선 이동 거리, 밀림 지속을 검증한다.
- Positive initial support 재평가는 기록된 elevator의 원 Native/local-radius와 world-radius graph를 보존한다.
  기존 same-cell 대역 포함 여부, 원 Hit 뒤 wholefuture NoHit, lowered-margin의 strict-prefix metadata 거절,
  strict/inward/overlap/genuine-clear 및 후행 실제 회전 Hit·정확/한 단위 부족 Work·입력 bytes를 확인한다.
- 원 하강 reversal의 h=.004166667·원 F64 safe/hit·동일 Native Kernel과 full pair future를 검사한다.
  순간 개선 뒤 다음 cell의 재접촉을 무시하지 않고, normal phase 변경은 원 전체 COM 보정·safe7bits·rate·
  접선을 지켜야 한다. 실제 Engine 승강 반복의 checked step·grounded·gap assertion도 그대로 통과해야 한다.
- Opposed-rider 정지는 자기 support만 있는 원 수치 보정과 독립 fixed/moving/rotating/dynamic/stopped/peer
  장애물을 구분한다. 현재/visible active·sensor/outgoing·원 normalized-Euler rate·finite/Work/bytes를
  확인하고 원 authored150tick 방향 전환·천장/벽/대각 운반·압착·연쇄 정지의 실제 실행을 함께 검사한다.
- Co-rotating support 회귀는 기록된 두 실제 clock의 전체 moving prefix와 원3us near-skin 구간을
  구분한다. 원 exact F64 interval·원 margin에서 child/public separated/strict cast를 함께 검사하며,
  원 whole future/later-rotation·ceiling 회귀를 그대로 유지한다. Cubic 내부 음수·stored nonunit endpoint·
  actual inward·두 closed slab 전체 포함/각 binade RN 오차·큰 COM에서 지워지는 local 반경과 남는 world real-radius·clock/h/anchor/frame/multi-axis
  불일치·원 Native reciprocal의 subnormal 출력·정확/한 단위 부족 Work·원 bytes를 대조한다.
- 같은 축 회전의 응답 회귀는 원 안전 자세 비트와 접선 속도를 유지하는 앵커 범위의 끝을 검사한다.
  관측한 지점만 통과하고 이후 접촉하는 기존 후보는 거절하고, 새 후보의 전체 후속 분리를 확인한다.
  공통 F32 곱의 완전한 출력 하한, 홀수 격자 이동의 동률, 두 반경, 정확·한 단위 부족 Work를
  대조한다. 기록된 구간의 회귀 통과와 원 엔진의 한 바퀴 완료는 별도로 판단한다.
- 회전의 연속 분리 구간은 기록된 공통 물리 시간과 독립 수직 이동을 각각 사용한다. 이전 실패
  범위를 넘는 마지막 분리 시각과 바로 다음 F64 시각의 실제 접촉, 역순 입력과 한 단위 부족
  Work를 확인한다. 접촉이 없는 긴 구간은 원래 적분 끝까지 두 반경의 분리를 확인한다.
  저장된 순수축 회전의 스칼라 끝값을 원 사원수 연산의 비트와 대조한다. 네 번째 틱에서 기록한
  분리 구간의 작업량 기준과 다섯 번째 틱의 응답 전체 구간을 재검증한다. 간격을 높인 대조에서는
  같은 경계 분할로 전체 구간을 승인할 수 없어야 한다.
  다섯 번째 틱의 마지막 응답은 시간 분할 전 전체 구간의 분리, 원 요청 간격의 캐시 자격과
  작업량 상한을 확인한다. 축 방향이 같은 비단위 법선, 다축 법선, 더 큰 간격을 대조한다.
  여섯 번째 틱의 기존 앵커 후속 구간과 일곱 번째 틱의 독립 수직 이동에서 검증한 경계를
  대조한다. 저장 끝 자세와 두 반경을 포함해 원 간격을 검사하고, 더 큰 간격으로 전체 분리가
  불가능한 경우를 확인한다.
- 여덟 번째 틱의 회전 발판 응답은 기존 앵커 후보의 실제 후속 접촉 시각을 재현한다. 같은 시각에서
  인접한 오프셋 후보를 적은 작업량으로 다시 검사하고, 분리된 표면 기준 후보를 전체 구간에서 확인한다.
  중복 후보 제거의 효과는 두 발판 방식과 기존 반경·접지 조건을 가진 원 한 바퀴 테스트로 확인한다.
- 14번째 틱의 회전 발판 응답은 정규화 계수가 일정한 구간을 묶어 검사한다. 기록된 원 궤적과
  요청 간격으로 최초 충돌 직전의 안전 시각과 바로 다음 F64 충돌 시각을 재현하고, 작업량을 대조한다.
- 16번째 틱의 첫 충돌 검색은 Box와 캡슐의 독립 적분 시각으로 전체 분리를 검증한다. 형상 순서를
  뒤집은 경우, 캡슐을 F32 한 단계 낮춘 실제 접촉, 저장 끝 자세에서만 접촉하는 경우를 대조한다.
- 24번째 틱의 회전 발판과 앵커 연결 캡슐은 좌표의 F32 지수 구간이 달라도 원 간격에서 전체 분리를
  입증해야 한다. 앵커 오프셋을 낮춘 경우 원 저장 끝 자세에서 월드 반경 접촉을 확인한다.
- 28·29번째 틱의 발판 면 근접 앵커는 두 곱의 반올림 차이를 합쳐 두 반경의 전체 분리를 검증한다.
  곱의 차이 하한이 한 단계와 같은 동률 경계와, 오프셋을 낮춘 실제 끝점 접촉을 대조한다.
- 33번째 틱은 발판 반높이보다 한 F32 단계 낮은 앵커의 전체 후속 분리를 검증한다. 오프셋을
  더 낮춘 대조에서 저장 끝 자세의 실제 월드 반경 접촉을 확인한다.
- 35번째 틱의 회전 응답은 이전 후보와 다른 시각에서만 확인되는 실제 접촉을 재현한다.
  인접한 회전 경계의 제한된 비용과 분리된 후보의 전체 구간 검사 경로를 함께 확인한다.
- 36번째 틱은 첫 곱의 F32 간격이 최종 덧셈의 절반인 상태에서 전체 분리를 검증한다. 오프셋을
  한 F32 단계 낮춘 대조에서 저장 끝점의 실제 월드 반경 접촉을 확인한다.
- 38번째 틱의 수직 접근은 전체 회전 범위로 분리된 시간을 건너뛴 뒤 마지막 안전 시각과 바로 다음
  F64 값의 최초 접촉을 재현한다. 형상 순서를 뒤집은 경우와 같은 속도로 멀어지는 전체 분리도 확인한다.
- 39번째 틱의 발판 면 보정은 정밀한 회전 출력 범위로 원래 허용 거리와 전체 후속 분리를 확인한다.
  정확한 안전 자세를 재현하는 앵커 경계도 검증한다. 안전 자세와 속도, 접선 오프셋을 대조하고
  허용 거리를 낮춘 경우 후보가 탈락하는지 확인한다.
- 40번째 틱의 세 번째 적분은 반올림된 회전 입력값으로 가능한 F32 축 성분을 검사한다.
  마지막 안전 시각과 바로 다음 F64 시각의 실제 월드 접촉을 작업량 650만 미만으로 재현한다.
  네 번째 적분은 저장 끝 자세를 포함해 원 간격에서 전체가 분리되며 작업량은 900만 미만이다.
- 49번째 틱의 세 번째 적분은 기존 최초 접촉 직전의 자세를 보존하며 실제 충돌 시각의 높이를
  F32 한 단계 조정한다. 접선 좌표와 속도를 대조하고 원 간격에서 전체 후속 구간의 분리를
  확인한다. 허용 보정 거리를 낮추면 후보가 전체 형상 검사 전에 탈락해야 한다.
- 61번째 틱의 세 번째 적분은 음수 회전 스케일과 법선 이동을 함께 적용한다. 최초 접촉 직전의
  안전 시각과 바로 다음 F64 시각의 월드 접촉을 작업량 300만 이내에서 재현한다. Box의 F32
  내부 좌표가 윗면보다 높게 반올림되는 반례도 상한에 포함한다.
- 61번째 틱의 정지 응답은 첫 일반 탐색 지점보다 이른 실제 재접촉을 확인하고, 같은 안전 자세의
  인접 후보가 저장 끝 자세까지 원 간격에서 분리되는지 대조한다. 네 번째 적분에서 면 출력이
  공유되는 후보는 작업량 50만 이내로 전체 분리를 확인한다.
- 62번째 틱의 세 번째와 네 번째 적분은 기준의 양쪽 오프셋과 새 앵커를 조합한다. 기존 안전
  자세와 접선 좌표, 속도를 보존하며 최초 접촉 시각의 간격이 개선되고 저장 끝 자세까지
  분리되어야 한다. 허용 보정 거리를 낮추면 후보가 탈락하는지 확인한다.
- 66번째 틱의 첫 번째 적분은 기준에서 여섯 F32 단계 떨어진 오프셋을 포함한다. 기존 안전 자세와
  접선 이동을 보존하고 최초 접촉 시각의 실제 간격과 저장 끝 자세까지의 분리를 검사한다.
- 67번째 틱의 네 번째 적분은 두 응답 후보가 서로 다른 시각에 실제로 재접촉하는지 확인한다.
  같은 안전 자세를 만드는 인접 앵커는 저장 끝 자세까지 원 간격에서 분리되어야 한다. 세 후보의
  재접촉과 후속 분리 검증은 공통 작업량 39만 이내에 끝나야 한다.
- 68번째 틱의 네 번째 적분은 발판 내부 좌표의 두 회전 곱을 함께 제한해 높이 상한을 구한다.
  정지 후보는 저장 끝 자세를 포함한 후속 구간에 걸쳐 두 반경이 분리되어야 하며, 검증 작업량은
  50만 이내여야 한다.
- 69번째 틱의 두 번째 적분은 앞선 후보의 접촉 시각보다 일찍 재접촉하는 정지 후보를 검사한다.
  실제 월드 형상으로 두 재접촉을 확인하고, 같은 안전 자세를 만드는 면 인접 후보의 저장 끝 자세까지
  분리를 입증한다. 세 후보의 검증은 공통 작업량 50만 이내에 끝나야 한다.
- 70번째 틱의 첫 적분은 느린 하강과 회전 발판의 첫 접촉을 검사한다. 원 물리 시간의 F32 입력을
  대조하고, 마지막 안전 시각과 바로 다음 F64 시각의 접촉을 실제 월드 형상으로 확인한다.
  최초 접촉 검증은 공통 작업량 1,600만 이내에 끝나야 한다.
- 같은 적분의 정지 응답은 물리 입력의 회전 상태에서 뒤늦은 재접촉을 찾아 실제 월드 형상으로 확인한다.
  같은 안전 자세를 유지하는 면 앵커는 저장 끝 자세까지 분리되어야 한다. 재접촉 확인과 전체 분리는
  공통 작업량 300만 미만에서 검증한다.
- 70번째 틱의 네 번째 적분은 Box 내부 좌표가 바깥면보다 높아지는 반올림 상태를 재현한다.
  실제 월드 반경 안의 접촉점을 확인하고, 하강과 정지 상태에서 같은 인접 F64 접촉 경계를 얻는지
  비교한다. 접촉점 조회에서도 같은 형상과 법선을 얻어야 한다.
- 위치 지정 방식의 세 번째 틱은 발판의 원 물리 적분 위치와 저장 끝 자세의 높이가 다른 경우다.
  최초 접촉의 원 물리 입력과 마지막 안전 시각을 대조하고, 접촉점과 캡슐 반경을 확인한다. 응답 후
  캡슐의 별도 적분은 저장 끝 자세까지 분리되어야 하며 검사 작업량은 20만 이내여야 한다.
- 속도 방식의 73번째 틱은 첫 세 적분에서 발판 면과 앵커에 적용되는 회전 곱의 반올림을 확인한다.
  각 응답은 저장 끝 자세까지 원 간격에서 분리되어야 하며, 세 검사에 공통 작업량 100만을 적용한다.
- 속도 방식의 79번째 틱은 음수 회전 스케일의 발판과 별도 적분되는 캡슐의 분리를 검사한다.
  발판 내부 높이 증가를 반영하고 저장 끝 자세까지 공통 작업량 50만 이내에서 분리되어야 한다.
- 속도 방식의 81번째 틱 세 번째 적분은 같은 각속도 입력에서 나온 두 회전 성분의 범위를 함께 검사한다.
  원 간격과 저장 끝 자세를 포함한 후속 분리를 작업량 1,200만 이내에서 확인한다. 캡슐 오프셋을
  한 F32 단계 낮춘 대조는 실제 접촉을 반환해야 한다.
- 같은 틱의 네 번째 적분은 캡슐의 최저 높이와 발판의 최고 높이에서 전체 분리를 확인한다.
  저장 끝 자세를 포함한 검사는 공통 작업량 50만 이내여야 한다.
- 속도 방식의 93번째 틱은 음수 스케일의 내부 최고점을 포함한 후속 분리를 원 간격과 저장 끝 자세에서
  공통 작업량 1,200만 이내에 확인한다.
- 위치 지정 방식의 52번째 틱은 새로 투영된 작은 속도로 자세가 그대로인 캡슐을 검사한다. 인접
  평가 높이를 사용해 안전 자세·속도·접선 좌표를 유지하고 실제 접촉 시각의 간격을 개선한 뒤,
  공통 작업량 60만 이내에 전체 후속 분리를 확인한다.
- 위치 지정 방식의 70번째 틱은 독립 적분에서 캡슐이 접선 방향으로 이동해도 법선 높이가 같은
  구간을 검사한다. 원 발판 회전에서 안전 시각과 바로 다음 F64 값의 최초 접촉을 공통 작업량
  60만 이내에 재현한다.
- 위치 지정 방식의 80번째 틱은 독립 적분의 캡슐이 고정 높이에 머무는 후속 구간과 저장 끝 자세에서
  원 간격의 분리를 검사한다. 속도 방식의 103번째 틱은 여러 입력이 같은 반올림된 회전 작용으로
  이어지는 구간을 검사한다. 두 회귀 검사는 각각 공통 작업량 1,200만 이내에서 끝나야 한다.
- 위치 지정 방식의 22번째 틱은 인접한 두 발판 높이와 캡슐의 미세한 상대 법선 속도를 사용한다.
  안전 자세와 원 속도를 보존하고 접촉 시각의 캡슐 높이가 개선돼야 한다. 저장 끝 자세를 포함한
  후속 분리 검사는 공통 작업량 1,500만 이내에서 확인한다. 두 회전 방식의 240틱 수용은 원본 테스트로 확인한다.
- Scalar displacement 인증은 원 `RN(origin+P)` 전체 image와 저장 endpoint, T/P 기존 성공·가격 우선,
  모든 coarsest node의 tie-free/실제 tie 대조와256 cap을 검사한다. 미지원 P cell의 mapped T union은
  Clear만 재사용하고 단방향·최대 두 활성 stack·공통 Work를 유지해야 한다. 두 radius의 strict 분리와
  실제 contact/false probe, 후보별 초기 정책·선택 margin, 정확·한 단위 부족 quota와 원 bytes도 대조한다.
  최종 RN 오차 하한은 zero/exact-grid 합과 half-ULP를 구분하고, 실제 출력 binade 경계·진짜 contact·
  tight offset의 기존 경로 우선을 대조한다. 새 Native 구간 전체도 이미 사용한 원 Work를 유지해 검사한다.
  작은 cell·부분 binade의 성공은 기록된 C71 FullFuture 전체 구간이나 원 Engine elevator의 checked tick·
  grounded·gap 수용을 대신하지 않는다. 변경한 경로와 직접 계약을 검증하고 전체 제품 검증과 구분한다.
- Capsule/Capsule 양성 관측은 C74의 원 Kernel·h·Domain·양 끝 비트와 left/mid/right 접촉을 재현한다.
  유효 axial clamp·양 segment cone·각 ball membership·개별 반경의 directed 상한, 선택 margin의
  strict/equality·unsupported 회전/축·서로 다른 길이/높이와 operand 순서를 대조한다. 기존 Box
  결과·가격, Native/초기/response census 우선, 정확·한 단위 부족 Work·원 bytes도 유지해야 한다.
  작은 fullcast의 prefix·tolerance와 원 free8/16/32·fixed2/8 Engine 수용을 구분하고 접선·축 잠금 및
  실제 infeasible 이후 stop 권한을 보존한다. None 관측은 새 분리·정지 권한을 만들지 않는다.
- 같은 속도의 Native Integrated라도 서로 다른 COM binade에서 실제 F32 접촉이 생기는 원 반례를
  검증한다. 이상적인 상대 직선 간격으로 그 접촉을 refute하지 않고 실제 시각·radius membership과
  fullcast의 원 prefix/tolerance를 대조한다. Peer 값 참조의 원 clock/저장 endpoint/접선 graph·safe
  pose·보정 상한 및 비용 경계를 확인하고, 기존 external/support/carry/J와 live 갱신 경로를 보존한다.
- Native qI 분리 증명은 원 공통 F32 dt와 서로 다른 속도를 사용하며 product·COM·pole RN shell과
  원 stored endpoint의 XYZ 비트 일치를 확인해야 한다. Far/approach 구간과 실제 RN 접촉 반례, 자격 밖의
  clock·회전·local frame·축 및 정확/한 단위 부족 Work를 대조하고 원 free/wall/tangent 수용을 확인한다.
  같은 Native dt의 완전 입력 image는 근접 prefix의 모든 F32 값과 양 끝 밖/중간 접촉 반례,
  fixed cap·원 Work 선청구·첫 실제 hit의 시간 상한을 대조한다. 기존 affine 성공 가격은 유지한다.
- 동시 충돌에서 기록한 두 캡슐의 시작 자세와 실제 적분 시간을 사용해 초기 분리를 검증한다. 같은
  적분 시간 격자라도 두 속도 곱의 반올림 차이를 포함한다. 원 국소 반경에서 후속 접촉이 있으면 분리 판정을
  거절해야 한다. 입력 순서를 바꾼 결과와 작업량 경계도 대조한다. 전체 틱과 충격량은 원 엔진 테스트로 확인한다.
- 캡슐과 Box의 적분 시작 시각이 다를 때는 초기 분리, 후속 접촉이 있는 전체 구간, 캡슐이 다시
  시작한 뒤의 분리를 각각 원 궤적으로 검사한다. 시작 근처의 양성 관측은 실제 반경과 시각을 확인해야
  검색 상한을 좁힐 수 있다. 기존 충돌 브래킷과 전체 틱의 위치·운동량 검사를 유지한다.
- 같은 물리 적분의 관측용 라벨이 다를 때 캡슐 바깥쪽 좌표가 F32 격자 경계를 넘는 경우도 검사한다.
  두 캡슐이 한 동적 물체를 미는 원 엔진 사례로 세 물체의 최종 속도, 총운동량과 충돌 후 간격을 확인한다.
- 서로 다른 Native/논리 clock의 Anchored 캡슐쌍에서는 단조 전체 prefix와 실제 접촉이 있는
  full future를 구분한다. 반대 rate의 양 끝은 같아도 내부가 달라지는 RN 반례·저장 XYZ·실수 반경을
  보존하고, Capsule쌍 밖의 기존 성공 가격과 정확/한 단위 부족 Work·입력 bytes를 대조한다.
- 현재의 무질량 driver phase 보존은 실제 C79 peer 응답에서 기존 curve bytes·canonical 접선과
  물리 Origin/J를 유지하고, 원 전체 scene suffix가 유한한 응답 수 안에 완료되는지 확인한다.
  driver 제거/정지/세대·shape·필터 변경·새 입력·carry·유한 질량·다른 정확 행과 예산 거절도 대조한다.
- Inverse 후보 방문은 기존 후보 순서·첫 선택 비트·None/중복 slot·행의 조기 거절과 정확/한 단위 부족
  Work·offset retry·원 bytes를 확인한다. 전체 후보를 방문하지 않아도 미실행 후보 비용을 청구하지 않아야 한다.
- Passive angular graze의 마지막 제안은 실제 기록된 same-clock/anchor0 곡선과 동시 plane을 보존한다.
  원 safe7bits·원 skin 보정 상한·잠금·pair 전체미래와 실제 후행 blocker 거절, callback/Work 오류 및
  real-anchor/nonangular 거절을 검사한다. 기존 whole-engine angular first/tail/replay·ceiling 조건도 필요하다.

이 집중 검증은 현재 전체 Native·WASI·Wasm·SDK·예제·Studio·consumer/package·성능·실기기 수용과 구분한다.
긍정 실행의 PASS와 거절 로그가 함께 있으면 실제 완료 시각과 원본 assertion을 대조해 의도된 음성 사례인지 확인한다.
