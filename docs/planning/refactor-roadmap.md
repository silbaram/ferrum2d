# 리팩토링 로드맵 템플릿

이 문서는 아직 진행하지 않은 구조 리팩토링과 성능 개선 후보를 작성할 때 사용하는 템플릿이다. 실제 활성 작업은 별도 task 또는 이슈로 범위와 검증 기준을 확정한 뒤 진행한다. 완료된 분리, 최적화, 테스트 정리는 planning에 남기지 않고 코드 구조와 `docs/development` 문서, 테스트 결과로 확인한다.

## 적용 원칙

- Rust core는 게임 상태, 충돌, 물리, 씬 로직, render/audio/query buffer 생성을 소유한다.
- TypeScript platform layer는 브라우저 API, Wasm loading, renderer, input, audio, asset loading을 소유한다.
- Wasm ABI와 public API는 리팩토링 중에도 유지한다.
- 공유 buffer layout을 바꿔야 할 때는 Rust size function, TypeScript decoder, 테스트를 같은 변경으로 수정한다.
- SRP와 DIP를 우선한다. 한 파일이나 타입이 여러 변경 이유를 가지면 기능 단위 module로 분리한다.
- Rust hot path는 allocation, string/object 생성, 동적 디스패치를 피하고 bulk buffer와 재사용 scratch storage를 우선한다.
- TypeScript hot path는 작은 GC 압력도 누적 비용으로 본다. renderer upload 경로는 preallocated staging buffer와 offset/length API를 우선한다.

## 템플릿 상태

현재 이 템플릿 파일에 남겨둘 미완료 리팩토링 후보는 없다.

새 리팩토링 후보를 추가할 때는 아래 형식을 사용한다.

```md
## 후보명

- 문제:
- 목표:
- 유지할 public contract:
- 영향 파일:
- 성능/아키텍처 기대 효과:
- 검증 기준:
- 롤백 기준:
```

## 검증 기준

- Rust core 변경: `cargo fmt --manifest-path crates/ferrum-core/Cargo.toml -- --check`, `cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings`, `cargo test --manifest-path crates/ferrum-core/Cargo.toml`
- TypeScript platform 변경: `pnpm --filter @ferrum2d/ferrum-web lint`, `pnpm --filter @ferrum2d/ferrum-web test`
- Wasm/API 변경: `pnpm build`, `pnpm smoke:headless`, `pnpm package:check`
- Game Spec/예제 영향: `pnpm validate:game-spec`
