# Ferrum2D 로드맵

이 로드맵은 Codex가 한 번의 작업 요청으로 안정적으로 처리할 수 있는 단위를 기준으로 관리한다. 구현되지 않은 항목은 계획으로만 기록하며, 완료된 것처럼 표현하지 않는다.

상세 실행 순서와 각 작업 완료 기준은 [고도화 개발 계획](advanced-development-plan.md)을 따른다.

현재 단계는 **MVP 개발 완료, 상용제품 기능 개발** 이다. 제품 기능 우선순위는 [제품화 개발 순서](product-roadmap.md)를 따른다.

`package.json`의 현재 version은 `0.1.0`이다. 아래 `v0.2`, `v0.3`, `v0.4+` 표기는 공개 배포 버전이 아니라 기능 안정화 묶음을 추적하기 위한 로드맵 라벨이다.

## v0.1.0 MVP Baseline

상태: MVP 개발 완료, 상용제품 기능 개발 단계의 회귀 기준으로 유지

목표:

- Rust/Wasm/TypeScript/WebGL2 기반 수직 슬라이스 완성
- Top-down Shooter 예제로 입력, 게임 로직, 렌더링, 에셋, 오디오, 디버그, 테스트 검증
- GitHub에서 새 사용자가 README만 보고 실행할 수 있는 문서 상태 확보

완료된 작업:

- Phase 0: 저장소/문서 초기화
- Phase 1: Monorepo bootstrap
- Phase 2: Rust/Wasm bridge
- Phase 3: TypeScript GameLoop
- Phase 4: WebGL2 basic renderer
- Phase 5: Sprite renderer
- Phase 6: Render command buffer
- Phase 7: Input
- Phase 8: World/Entity
- Phase 9: AABB collision
- Phase 10: Top-down Shooter stabilization
- Phase 11: Asset loading
- Phase 12: Audio
- Phase 13: Scene state, DebugOverlay, tests
- Phase 14: Code review guide
- Phase 15: Release docs

최종 검증 완료 기준:

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `pnpm test`
- `pnpm build`
- Top-down Shooter manual smoke check
- README, architecture, 완료된 MVP 기준, docs 동기화

## v0.2 계획

상태: 완료

목표: 완료된 MVP API, 예제 품질, 관측 가능성을 제품 기능 개발 기반으로 안정화한다.

진행된 작업:

- DebugOverlay와 WebGL2Renderer stats에 render command 수, texture bind/switch 추정치, audio events/sec 지표 추가
- Public API 계약 문서화, `FrameHandler`/`InputProvider`/`ViewportProvider` export, deprecated `FrameState.renderCommands` 정책 정리
- AssetLoader, AudioManager, Game Spec validator의 오류 메시지 context를 `kind/name/url/id/path/detail` 형식으로 표준화
- Top-down Shooter 예제의 asset 적용 실패를 console과 HUD에서 확인할 수 있도록 보강
- `BrowserPlatformHost`로 asset/audio host 책임을 분리하고 `createEngine()` frame pipeline을 내부 함수로 정리
- renderer/audio/debug/input/engine lifecycle cleanup을 정리하고 `destroy()` 중복 호출을 no-op으로 고정
- DebugOverlay 표시명/단위/순서와 `RendererStats` 필드 계약을 테스트와 문서로 고정
- `pnpm smoke:check`와 `docs/smoke-check.md`로 로컬 smoke check와 브라우저 수동 확인 절차를 고정
- CI에서 Rust test, Wasm build, TypeScript lint/test/build를 실행하도록 검증 범위를 정리

후보 작업:

- npm package 공개 전 파일 구성 점검 (완료: `exports`, explicit `files`, `pnpm package:check`의 pack tarball 검증, [npm 베타 패키징](npm-release.md) 절차 추가. publish 여부는 `private: true` 유지 상태에서 별도 결정)

진행 순서:

1. public API 정리 (완료)
2. asset/error 진단 표준화 (완료)
3. renderer/audio/debug lifecycle cleanup (완료)
4. DebugOverlay/RendererStats naming 고정 (완료)
5. smoke check 자동화 기반 정리 (완료)

v0.2에서 하지 않을 것:

- WebGPU 구현
- Worker architecture
- tilemap runtime 구현
- 범용 navigation/pathfinding 구현
- generic animation graph 구현
- 복잡한 ECS 재설계
- 복잡한 physics engine
- editor
- multiplayer

## v0.3 계획

상태: 완료

목표: 완료된 MVP 구조를 유지하면서 카메라 연출과 콘텐츠 제작 기반을 늘린다.

후보 작업:

- camera preset API 초안과 Top-down Shooter 적용 (완료)
- 카메라 preset 범위: 기존 player-follow 일반화, dead-zone, look-ahead, 시간 기반 shake (완료)
- 카메라 계산은 Rust core가 담당하고 TypeScript는 viewport 전달과 renderer 적용만 담당 (완료)
- texture atlas metadata 포맷 설계와 작은 수동 atlas 예제 검토 (완료)
- atlas metadata 범위: frame name, texture id/name, UV/rect, frame size 검증 (완료)
- data-driven scene spec 확장 검토 (완료된 범위: enemy preset, wave timeline, static tilemap, navigation grid)
- scene spec 후보: spawn table, wave/event timeline, animation binding (완료된 범위: spawn/wave/static tilemap/navigation)
- tilemap runtime 최소 기능 설계 (완료)
- tilemap v1 범위: 정적 tile layer 렌더링, tile id -> UV 매핑, collision layer의 AABB 변환은 완료
- navigation grid v1 범위: `collision: true` layer를 chase enemy 4방향 grid navigation 장애물로 재사용하고, 경로가 없으면 direct chase로 fallback (완료)
- atlas/tilemap/scene spec 경계: TypeScript는 JSON/name/asset 검증과 id 해석을 담당하고, Rust는 숫자형 또는 buffer 설정을 받아 collision/render command를 생성한다.
- atlas/tilemap/scene spec hot path에서는 tile/entity별 JS/Wasm 왕복 호출을 만들지 않는다.
- tilemap v1 비범위: 내장 editor, 자동 타일링, isometric/hex tilemap, 복잡한 per-tile script
- audio volume/pitch 정책과 unlock UX 개선 (완료)
- WebGL2 renderer smoke test 자동화 가능성 검토
- docs site 또는 GitHub Pages 데모 배포 검토
- release packaging 절차 정리

진행 순서:

1. Camera Preset (완료)
2. Texture Atlas Metadata (완료)
3. Spawn/Wave Spec (완료)
4. Audio UX 개선 (완료)

v0.3에서 하지 않을 것:

- WebGPU는 별도 설계 문서와 성능 근거가 생기기 전까지 구현하지 않는다.
- Worker/멀티스레딩은 Wasm memory boundary와 asset pipeline이 안정화된 뒤 검토한다.
- scene graph와 editor는 상용제품 기능 로드맵에서 별도 마일스톤으로 분리한다.
- skeletal animation과 본격 animation blend tree는 상용제품 기능 로드맵에서 별도 설계로 분리한다.
- 2D lighting은 WebGL2 sprite/atlas/tilemap 경로가 안정화된 뒤 다시 판단한다.

## v0.4+ 계획

상태: 구현 대상으로 좁힌 항목은 완료. Rust-side hook, bulk-buffer render-prep extension, 배포/데모 자동화는 별도 설계가 필요한 후보로 유지한다.

목표: 콘텐츠 제작 기반 위에 AI 이동, 확장성, 운영성을 보강한다.

후보 작업:

- tilemap static render command path + collision AABB obstacle path (완료)
- lightweight navigation grid (완료)
- navigation v1 범위: 2D grid A*, obstacle layer 연동, 적이 장애물을 우회해 player를 추적하는 예제 (완료)
- navigation v1 비범위: 연속 공간 회피, crowd simulation, navmesh, 복잡한 steering
- scoped Physics v2 (완료): sweep-and-prune broadphase, layer pair query, swept AABB, 빠른 bullet/enemy 터널링 방지
- engine extension point 문서화 (부분 완료: TypeScript platform lifecycle hook)
- extension point 후보: Rust-side init/update hook, TypeScript platform lifecycle hook (완료), bulk-buffer render-prep extension
- extension point 원칙: Rust/TypeScript 책임 경계 유지, hot path에서 entity별 JS/Wasm 호출과 TypeScript simulation update hook 금지
- asset/audio 오류 진단 강화 (완료)
- 오류 진단 범위: v0.2 표준 에러 메시지 위에 diagnostic code, `DiagnosticReport`, 예제 bootstrap 실패 표시 방식을 추가 (완료)
- 회귀 방지용 smoke automation 정리 (부분 완료: headless smoke)
- smoke 범위: wasm build, example build, game spec validation, headless-friendly render command sanity check. `pnpm smoke:headless`는 Game Spec 적용 경로, collision/navigation 전제, representative render command buffer를 검증한다.
- enemy behavior preset 확장 (완료: `orbit`, Game Spec 기반 orbit radius/radialBand tuning)

다음 후보:

- WebGL2 실제 렌더링 smoke automation 가능성 검토 (완료: `pnpm smoke:browser`)
- docs site 또는 GitHub Pages 데모 배포 검토
- package publish 여부와 release tagging 절차 정리 (완료: [npm 베타 패키징](npm-release.md))
- Physics v3 설계 검토: rigid body solver 또는 외부 physics crate 도입 여부 판단

## 장기 후보

- WebGPU renderer
- editor
- scene file format 고도화
- generic animation state machine
- animation blend tree
- skeletal animation
- richer asset pipeline
- profiling tooling
- browser demo hosting
- 2D lighting

## 비교 기반 선별 기준

2026-05-06 기준 상용제품 기능 선별은 Godot 4.x, Unity 2D, Phaser, Bevy 공식 문서의 공통 강점을 참고하되 Ferrum2D의 현재 제품 경계를 우선한다.

- Godot/Unity/Phaser 모두 tilemap 기반 레벨 제작 흐름이 강하므로 Ferrum2D도 editor가 아니라 runtime 최소 계층부터 보강한다.
- Godot AnimationTree와 Unity 2D Animation은 강력하지만 Ferrum2D에는 이미 idle/move sprite sheet animation이 있으므로, 다음 단계는 generic graph가 아니라 atlas/scene binding 정리부터 진행한다.
- Godot 2D Navigation과 Bevy의 확장성 모델은 참고하되, Ferrum2D v0.4+에서는 grid A*와 hook 문서화 정도로 제한한다.
- Unity URP 2D lighting 같은 렌더링 고급 기능은 WebGL2 sprite batching, atlas, tilemap 경로가 안정화되기 전까지 장기 후보로 둔다.
- Phaser의 WebGL/Canvas fallback 모델은 Ferrum2D의 WebGL2 한정 원칙과 맞지 않으므로 현 단계에서는 Canvas renderer를 추가하지 않는다.
