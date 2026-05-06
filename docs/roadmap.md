# Ferrum2D 로드맵

이 로드맵은 Codex가 한 번의 작업 요청으로 안정적으로 처리할 수 있는 단위를 기준으로 관리한다. 구현되지 않은 항목은 계획으로만 기록하며, 완료된 것처럼 표현하지 않는다.

## v0.1.0 MVP

상태: 릴리스 준비

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

릴리스 전 체크:

- `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- `pnpm test`
- `pnpm build`
- Top-down Shooter manual smoke check
- README, architecture, MVP, CHANGELOG 동기화

## v0.2 계획

목표: MVP API, 예제 품질, 관측 가능성을 안정화한다.

진행된 작업:

- DebugOverlay와 WebGL2Renderer stats에 render command 수, texture bind/switch 추정치, audio events/sec 지표 추가

후보 작업:

- `FerrumEngine` public API 정리와 deprecated API 축소
- render command compatibility path의 hot path allocation 제거
- renderer/audio/debug lifecycle cleanup 재점검
- 예제의 manual smoke checklist와 screenshot/GIF 갱신 절차 정리
- CI에서 TypeScript test와 lint 실행 여부 정리
- DebugOverlay 표시 항목과 renderer stats naming 안정화
- FPS, frame time, Rust update time, render time, entity/sprite count 같은 기존 지표의 표시명과 단위를 고정
- error message와 asset/audio loading 실패 리포트 형식 표준화
- asset loading 실패 케이스 테스트 보강
- WebGL2 renderer manual smoke guide 보강
- npm package 공개 전 파일 구성 점검

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

목표: MVP 구조를 유지하면서 카메라 연출과 콘텐츠 제작 기반을 늘린다.

후보 작업:

- camera preset API 초안과 Top-down Shooter 적용
- 카메라 preset 범위: 기존 player-follow 일반화, dead-zone, look-ahead, 시간 기반 shake
- 카메라 계산은 Rust core가 담당하고 TypeScript는 viewport 전달과 renderer 적용만 담당
- texture atlas metadata 포맷 설계와 작은 수동 atlas 예제 검토
- atlas metadata 범위: frame name, texture id/name, UV/rect, frame size 검증
- data-driven scene spec 확장 검토
- scene spec 후보: spawn table, wave/event timeline, animation binding
- tilemap runtime 최소 기능 설계
- tilemap v1 범위: 정적 tile layer 렌더링, tile id -> UV 매핑, collision layer의 AABB 변환
- atlas/tilemap/scene spec 경계: TypeScript는 JSON/name/asset 검증과 id 해석을 담당하고, Rust는 숫자형 또는 buffer 설정을 받아 collision/render command를 생성한다.
- atlas/tilemap/scene spec hot path에서는 tile/entity별 JS/Wasm 왕복 호출을 만들지 않는다.
- tilemap v1 비범위: 내장 editor, 자동 타일링, isometric/hex tilemap, 복잡한 per-tile script
- audio volume/pitch 정책과 unlock UX 개선
- WebGL2 renderer smoke test 자동화 가능성 검토
- docs site 또는 GitHub Pages 데모 배포 검토
- release packaging 절차 정리

v0.3에서 하지 않을 것:

- WebGPU는 별도 설계 문서와 성능 근거가 생기기 전까지 구현하지 않는다.
- Worker/멀티스레딩은 Wasm memory boundary와 asset pipeline이 안정화된 뒤 검토한다.
- scene graph와 editor는 MVP 계열 안정화 이후 별도 마일스톤으로 분리한다.
- skeletal animation과 본격 animation blend tree는 MVP 이후 별도 설계로 분리한다.
- 2D lighting은 WebGL2 sprite/atlas/tilemap 경로가 안정화된 뒤 다시 판단한다.

## v0.4+ 계획

목표: 콘텐츠 제작 기반 위에 AI 이동, 확장성, 운영성을 보강한다.

후보 작업:

- lightweight navigation grid
- navigation v1 범위: 2D grid A*, obstacle layer 연동, 적이 장애물을 우회해 player를 추적하는 예제
- navigation v1 비범위: 연속 공간 회피, crowd simulation, navmesh, 복잡한 steering
- engine extension point 문서화
- extension point 후보: Rust-side init/update hook, TypeScript platform lifecycle hook, bulk-buffer render-prep extension
- extension point 원칙: Rust/TypeScript 책임 경계 유지, hot path에서 entity별 JS/Wasm 호출과 TypeScript simulation update hook 금지
- asset/audio 오류 진단 강화
- 오류 진단 범위: v0.2 표준 에러 메시지 위에 에러 코드, 실패 리포트 수집, 예제 표시 방식을 추가
- 회귀 방지용 smoke automation 정리
- smoke 후보: wasm build, example build, game spec validation, headless-friendly render command sanity check

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

2026-05-06 기준 post-MVP 기능 선별은 Godot 4.x, Unity 2D, Phaser, Bevy 공식 문서의 공통 강점을 참고하되 Ferrum2D의 MVP 경계를 우선한다.

- Godot/Unity/Phaser 모두 tilemap 기반 레벨 제작 흐름이 강하므로 Ferrum2D도 editor가 아니라 runtime 최소 계층부터 보강한다.
- Godot AnimationTree와 Unity 2D Animation은 강력하지만 Ferrum2D MVP에는 이미 idle/move sprite sheet animation이 있으므로, 다음 단계는 generic graph가 아니라 atlas/scene binding 정리부터 진행한다.
- Godot 2D Navigation과 Bevy의 확장성 모델은 참고하되, Ferrum2D v0.4+에서는 grid A*와 hook 문서화 정도로 제한한다.
- Unity URP 2D lighting 같은 렌더링 고급 기능은 WebGL2 sprite batching, atlas, tilemap 경로가 안정화되기 전까지 장기 후보로 둔다.
- Phaser의 WebGL/Canvas fallback 모델은 Ferrum2D MVP의 WebGL2 한정 원칙과 맞지 않으므로 현 단계에서는 Canvas renderer를 추가하지 않는다.
