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

목표: MVP API와 예제 품질을 안정화한다.

후보 작업:

- `FerrumEngine` public API 정리와 deprecated API 축소
- render command compatibility path의 hot path allocation 제거
- renderer/audio/debug lifecycle cleanup 재점검
- 예제의 manual smoke checklist와 screenshot/GIF 갱신 절차 정리
- CI에서 TypeScript test와 lint 실행 여부 정리
- DebugOverlay 표시 항목과 renderer stats naming 안정화
- error message 표준화
- asset loading 실패 케이스 테스트 보강
- WebGL2 renderer manual smoke guide 보강
- npm package 공개 전 파일 구성 점검

v0.2에서 하지 않을 것:

- WebGPU 구현
- Worker architecture
- 복잡한 ECS 재설계
- 복잡한 physics engine
- editor
- multiplayer

## v0.3 계획

목표: MVP 구조를 유지하면서 렌더링과 에셋 파이프라인의 실사용성을 늘린다.

후보 작업:

- sprite batching 통계와 texture_id 정렬 정책 개선
- texture atlas 설계 문서 작성 및 작은 수동 atlas 예제 검토
- camera/viewport API 초안
- 더 큰 예제 scene을 위한 data-driven 설정 검토
- audio volume/pitch 정책과 unlock UX 개선
- WebGL2 renderer smoke test 자동화 가능성 검토
- docs site 또는 GitHub Pages 데모 배포 검토
- release packaging 절차 정리

v0.3에서도 신중히 볼 것:

- WebGPU는 별도 설계 문서와 성능 근거가 생기기 전까지 구현하지 않는다.
- Worker/멀티스레딩은 Wasm memory boundary와 asset pipeline이 안정화된 뒤 검토한다.
- scene graph와 editor는 MVP 계열 안정화 이후 별도 마일스톤으로 분리한다.

## 장기 후보

- WebGPU renderer
- editor
- scene file format
- animation system
- richer asset pipeline
- profiling tooling
- browser demo hosting
