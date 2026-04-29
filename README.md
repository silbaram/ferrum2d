# Ferrum2D

Ferrum2D는 **Rust + WebAssembly + TypeScript + WebGL2** 기반의 2D 웹 게임 엔진 프로젝트다.

## 현재 상태

현재 저장소는 **AABB Collision 시스템 연결 단계**까지 포함한다.

포함된 구성:
- Rust `World`가 transforms/sprites/velocities/colliders Vec store 관리
- `AabbCollider`, `CollisionPair`, `CollisionSystem` 구현
- O(n^2) broad phase로 trigger collision pair 생성
- bullet vs enemy 충돌 시 trigger event로 제거 처리
- World의 transform+sprite로 render command 생성

## Command Buffer ABI 주의사항

`SpriteRenderCommand`는 Rust에서 `#[repr(C)]`로 선언되어 C ABI 레이아웃을 강제한다.
현재 포맷은 `f32` 12개(총 48 bytes, align 4)이며, TypeScript는 동일 순서로 `Float32Array`를 해석한다.
필드 순서/타입/정렬이 바뀌면 JS 해석 코드도 함께 수정해야 한다.

## 빌드 순서

```bash
pnpm install
pnpm build
```

수동 단계로 나눠 실행하려면:

```bash
pnpm build:wasm
pnpm build:web
```

## 예제 실행

```bash
pnpm --filter @ferrum2d/topdown-shooter dev
```

브라우저에서 다음을 확인한다.
- W/A/S/D로 player sprite 이동
- mouse 좌표 overlay 표시
- 100개 sprite 렌더링
