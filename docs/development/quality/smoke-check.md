# Ferrum2D Smoke Check

이 문서는 릴리스 후보나 큰 변경 후 실행할 smoke check 기준을 고정한다. 자동 검증은 빠른 회귀 확인을 담당하고, WebGL2 실제 렌더링/입력/오디오는 브라우저 수동 확인으로 보완한다.

## 로컬 자동 sanity check

권장 명령:

```bash
pnpm smoke:check
```

이 명령은 다음 순서로 실행한다.

1. `pnpm lint`
2. `pnpm test`
3. `pnpm validate:game-spec`
4. `pnpm validate:physics-authoring`
5. `pnpm smoke:physics`
6. `pnpm smoke:headless`
7. `pnpm build`

`pnpm smoke:check`는 WebGL2 실제 화면, 키보드/마우스 입력, 브라우저 오디오 unlock 상태를 확인하지 않는다. 이 항목은 아래 browser render smoke check와 수동 smoke check에서 확인한다.

WebGL2 실제 화면의 black-frame 회귀만 자동 확인하려면 별도 browser smoke check를 실행한다.

```bash
pnpm smoke:browser
```

## Physics smoke check

Rust 물리엔진의 대표 solver/CCD/query 회귀를 빠르게 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics
pnpm smoke:physics-replay
pnpm smoke:destructible-terrain
pnpm smoke:destructible-terrain-browser
```

이 명령은 `scripts/physics-smoke.mjs`가 canonical Rust test fixture를 scenario 단위로 실행하고, 각 scenario와 전체 suite의 seed/frame/suite hash를 출력한다. 이 hash는 실행한 scenario manifest와 통과 결과를 식별하는 smoke summary 값이다.
`pnpm smoke:physics-replay`는 같은 physics smoke suite를 2회 실행해 suite hash가 안정적으로 일치하는지 확인하고, Web public replay helper가 생성한 snapshot state hash(`stateReplayHash`)도 함께 비교한다. 실패 시 run, seed, frame, suite hash, scenario별 hash 차이를 출력한다.
`stateReplayHash`는 Web replay helper의 snapshot/restore/hash 계약을 Node deterministic harness에서 확인하는 값이며, Wasm physics state 전체를 직렬화한 hash는 아니다.
`pnpm smoke:destructible-terrain`은 tilemap rect edit가 collision query와 render command를 같은 tile occupancy source에서 갱신하고 collision obstacle cache를 dirty chunk 단위로 재빌드하는지 확인하며 seed/frame/suite hash를 출력한다. `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter production build에서 deterministic tile 제거를 실행해 browser query와 render command count가 함께 변하는지 확인한다.
Web public API의 `PhysicsReplayInputStream`은 frame/seed/fixed step/body event와 interval snapshot을 기록해 tooling 단위 rollback 검증에 사용한다.

현재 scenario:

- `physics:stacked-boxes`: stack 안정성, sleep/island stats, block solver
- `physics:joint-chain`: rope/spring/revolute/prismatic/weld joint constraint
- `physics:fast-projectile-ccd`: fast dynamic body CCD matrix
- `physics:tile-edge-snagging`: edge collider pair/contact/cast 회귀
- `physics:moving-platform-character`: moving platform carry와 platformer controller
- `physics:query-cast-matrix`: overlap/raycast/shape-cast matrix

Compound collider runtime apply는 Rust collision/solver unit test, Web physics authoring unit test, `compound-collider` sandbox fixture로 보장한다.
Destructible terrain prototype은 Rust tilemap/engine unit test와 `destructible-terrain:tile-rect-edit` smoke scenario로 보장한다.

개별 scenario 목록은 다음으로 확인한다.

```bash
node scripts/physics-smoke.mjs --list
```

Top-down Shooter의 particle burst와 non-lethal enemy tint flash가 production build의 browser render path에서 감지되는지 확인하려면 다음을 실행한다.

```bash
pnpm smoke:topdown
```

Breakout 예제의 두 번째 장르 runtime/render path를 확인하려면 다음을 실행한다. Brick hit particle burst까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:breakout
pnpm smoke:breakout-effects
```

Platformer 예제의 controller/runtime/render path를 확인하려면 다음을 실행한다. Landing dust까지 자동 관측하려면 effect smoke를 실행한다.

```bash
pnpm smoke:platformer
pnpm smoke:platformer-effects
```

Physics Spec 기반 generic rigid body sandbox와 demo fixture suite를 브라우저에서 확인하려면 다음을 실행한다.

```bash
pnpm smoke:physics-sandbox
pnpm smoke:physics-demo-suite
```

## Headless smoke check

브라우저를 열지 않고 Top-down Shooter 설정과 platform 적용 경로만 확인하려면 다음을 실행한다.

```bash
pnpm smoke:headless
```

이 명령은 Wasm 패키지와 `@ferrum2d/ferrum-web`을 빌드한 뒤 `scripts/headless-smoke.mjs`를 실행한다. 검증 범위는 다음과 같다.

- 예제 `game.json`이 `resolveShooterGameSpec(...)`를 통과한다.
- `applyShooterGameSpec(...)`가 resolved config, orbit tuning, camera, audio policy, tilemap, wave, atlas frame을 fake engine target에 빠짐없이 전달한다.
- `collision: true` layer에 navigation obstacle로 쓸 양수 tile과 walkable `0` tile이 함께 존재한다.
- tilemap 기반 representative render command buffer가 비어 있지 않고 `decodeRenderCommands(...)`, `rendererStatsForCommands(...)` 계약을 통과한다.
- Rust/Wasm runtime을 headless로 로드해 particle preset 등록, shooter hit preset binding, burst spawn, particle count 증가/만료, render command append를 확인한다.

이 검증은 WebGL2 draw를 실행하지 않는다. 실제 화면은 browser render smoke check와 수동 smoke check로 보완한다.

## Browser render smoke check

`pnpm smoke:browser`는 `examples/minimal-game` production build를, `pnpm smoke:topdown`은 `examples/topdown-shooter` production build를, `pnpm smoke:breakout`/`pnpm smoke:breakout-effects`는 `examples/breakout` production build를, `pnpm smoke:platformer`/`pnpm smoke:platformer-effects`는 `examples/platformer` production build를, `pnpm smoke:physics-sandbox`/`pnpm smoke:physics-demo-suite`는 `examples/physics-sandbox` production build를 정적 서버로 띄운 뒤 Playwright Core로 설치된 Chrome/Chromium을 실행한다. 검증 범위는 다음과 같다.

- `createFerrumRuntime(...)` 또는 예제 bootstrap이 browser runtime을 초기화한다.
- WebGL2 canvas가 생성되고 Rust/Wasm render command를 소비한다.
- canvas pixel readback에서 placeholder texture의 녹색 픽셀이 일정 수 이상 검출된다.
- `pnpm smoke:topdown`은 smoke 전용 URL parameter로 deterministic enemy hit를 만들고, particle count와 enemy tint flash render command가 관측되는지 확인한다.
- `pnpm smoke:breakout-effects`는 `resetGame()` 이후 자연 ball/brick hit에서 scene-internal particle burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:platformer-effects`는 `resetGame()` 이후 player landing transition에서 scene-internal dust burst와 render command 증가가 관측되는지 확인한다.
- `pnpm smoke:physics-sandbox`는 Physics Spec fixture가 body/joint를 생성하고 physics debug line을 렌더링하는지 확인한다.
- `pnpm smoke:physics-demo-suite`는 sandbox, joint playground, weld joint, projectile CCD, platformer physics, compound collider fixture를 순서대로 로드해 debug line, CCD metric, summary를 확인한다. Rust unit test는 CCD hit marker line을 직접 검증한다.
- `pnpm smoke:destructible-terrain-browser`는 Top-down Shooter의 collision tile 하나를 제거하고 같은 frame 경로에서 query hit 제거와 render command 감소를 확인한다.
- browser console error와 page error가 발생하지 않는다.

기본 브라우저 채널은 `chrome`이다. 환경에 따라 다음 환경 변수를 사용할 수 있다.

```bash
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:browser
FERRUM_BROWSER_EXECUTABLE=/path/to/browser pnpm smoke:browser
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:topdown
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:breakout-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:platformer-effects
FERRUM_BROWSER_CHANNEL=chromium pnpm smoke:physics-demo-suite
```

이 검증은 Web Audio unlock, 키보드/마우스 조작감, 전체 Top-down Shooter 게임플레이를 대체하지 않는다. 해당 항목은 여전히 수동 smoke check에서 확인한다.

Rust 코드나 Rust/Wasm 경계를 바꾼 경우에는 `pnpm smoke:check`와 별도로 다음을 실행한다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

## CI와 로컬 검증 차이

GitHub Actions CI는 main push/PR에서 headless 환경으로 실행된다. `ferrum-web-v*` tag push에서는 release metadata check도 실행한다.

현재 CI 기준:

1. `pnpm install`
2. `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
3. `pnpm smoke:physics`
4. `wasm-pack build crates/ferrum-core --target web --out-dir ../../packages/ferrum-web/pkg`
5. `pnpm lint`
6. `pnpm test`
7. `pnpm build`

로컬 릴리스 후보 검증은 CI 명령에 더해 Game Spec 검증과 브라우저 수동 확인을 포함한다.

- `pnpm lint`로 TypeScript source/test type check를 확인한다.
- `pnpm test`로 TypeScript Node tests와 Rust tests를 모두 실행한다.
- `pnpm validate:game-spec`로 예제 `game.json`이 runtime validator와 같은 경로를 통과하는지 확인한다.
- `pnpm validate:physics-authoring`으로 `physicsEditor` 샘플이 runtime Physics Spec으로 compile되고 resolver를 통과하는지 확인한다.
- `pnpm smoke:physics`로 물리 solver/CCD/query 대표 scenario와 suite hash를 확인한다.
- `pnpm smoke:physics-replay`로 physics smoke suite hash와 Web replay helper state hash 재현성을 확인한다.
- `pnpm smoke:destructible-terrain`으로 tilemap rect edit의 query/render 동기화, dirty chunk collision cache, suite hash를 확인한다.
- `pnpm smoke:destructible-terrain-browser`로 Top-down Shooter browser path의 deterministic tile 제거 demo를 확인한다.
- `pnpm smoke:headless`로 Game Spec 적용 경로, collision/navigation 전제, representative render command buffer를 확인한다.
- `pnpm smoke:topdown`으로 Top-down Shooter production build에서 particle burst와 non-lethal enemy tint flash가 browser render path에 도달하는지 확인한다.
- `pnpm smoke:physics-demo-suite`로 Physics Spec apply/sandbox fixture browser path를 확인한다.
- `pnpm package:check`로 runtime package entrypoint, create-game scaffold, agents template, files allowlist, generated Wasm artifact, 실제 `pnpm pack` tarball 구성을 확인한다.
- `pnpm release:check`로 changelog, beta version, release tag metadata 구조를 확인한다.
- `pnpm build`로 Wasm package와 Top-down Shooter production build를 확인한다.
- `pnpm build:pages`로 GitHub Pages demo/docs artifact 구성과 문서 HTML 생성을 확인한다.
- 브라우저 수동 smoke check로 WebGL2, 입력, 오디오, DebugOverlay 표시를 확인한다.

CI는 브라우저 실제 렌더링, 사용자 입력, Web Audio 재생, screenshot 갱신을 검증하지 않는다.

## Top-down Shooter 수동 smoke check

사전 조건:

- `pnpm install`이 완료되어 있어야 한다.
- `wasm-pack`과 Rust `wasm32-unknown-unknown` target이 설치되어 있어야 한다.
- WebGL2를 지원하는 브라우저에서 확인한다.

실행:

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/topdown-shooter dev
```

브라우저에서 Vite URL에 접속한 뒤 [Top-down Shooter 수동 체크리스트](topdown-shooter-smoke-checklist.md)를 따른다. 이 문서는 자동/CI/수동 검증의 관계만 유지하고, 실제 브라우저 확인 항목은 체크리스트 문서를 기준으로 한다.

## Screenshot 갱신

README preview용 스크린샷 절차는 [screenshots README](screenshots/README.md)를 따른다. smoke check에서 화면이 바뀐 것을 의도했다면 `docs/development/quality/screenshots/topdown-shooter-title.png` 갱신 여부를 함께 판단한다.

## 실패 기록 형식

검증 실패가 있으면 작업 결과에 다음을 남긴다.

- 실패 명령 또는 수동 확인 항목
- 실패 원인
- 사용자 영향
- 후속 조치 또는 보류 사유
