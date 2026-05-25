# Ferrum2D Physics Sandbox

Ferrum2D generic Physics Spec fixtures를 브라우저에서 실행하는 예제다.

## 실행

```sh
pnpm dev:physics-sandbox
```

## 포함 데모

- `physics.json`: collider, material, layer, joint 기본 샌드박스
- `demos/joint-playground.json`: distance, rope, spring, revolute, prismatic, gear joint 확인
- `demos/projectile-ccd.json`: 빠른 projectile과 얇은 collider 충돌 확인
- `demos/platformer-physics.json`: capsule player, slope, moving platform, step block 확인
- `demos/compound-collider.json`: body-local compound collider와 trigger sensor 확인
- `demos/weld-joint.json`: weld joint로 고정된 복합 rigid body fixture 확인

## 검증

```sh
pnpm --filter @ferrum2d/physics-sandbox build
pnpm smoke:physics-sandbox
pnpm smoke:physics-demo-suite
```
