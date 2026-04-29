# Hot-Path Performance Idioms

핫패스 (매 프레임 / 시뮬레이션 안 / 렌더 inner loop)에서 자주 등장하는 성능 idiom 모음. **핫패스가 아닌 코드에는 적용하지 마라** — 가독성을 잃고 얻는 것은 0.

핵심 원칙: **측정 후 최적화.** 추측은 자주 틀린다. `cargo flamegraph`, `puffin`, `tracy`로 실제 병목을 찾고 그 자리만 손댄다.

## 목차

1. Allocation 회피
2. Vec / String / HashMap 활용
3. SoA vs AoS
4. Branch prediction / cache 친화성
5. Iterator vs manual — 성능 특성
6. Inlining
7. SIMD 진입점
8. unsafe — 언제 정당한가
9. 프로파일링 도구
10. 빌드 / 컴파일러 설정

---

## 1. Allocation 회피

힙 할당은 게임 핫패스의 가장 흔한 적. 매 프레임 60Hz로 반복되는 자리에서:

### 1.1 사전 할당

```rust
// ❌ 매 프레임 새 Vec
fn collect_visible(entities: &[Entity]) -> Vec<EntityId> {
    let mut visible = Vec::new();
    for e in entities { if is_visible(e) { visible.push(e.id); } }
    visible
}

// ✅ 호출자가 버퍼 제공
fn collect_visible(entities: &[Entity], out: &mut Vec<EntityId>) {
    out.clear();
    out.extend(entities.iter().filter(|e| is_visible(e)).map(|e| e.id));
}
```

호출자는 버퍼를 멤버로 보관해 매 프레임 `clear` + 재사용:

```rust
struct Renderer {
    visible_buffer: Vec<EntityId>,  // 영속
}

impl Renderer {
    fn frame(&mut self, world: &World) {
        collect_visible(&world.entities, &mut self.visible_buffer);
        // 사용...
    }
}
```

`Vec::clear()`는 길이만 0으로 — capacity 유지. 다음 프레임에 같은 양 push해도 재할당 없음.

### 1.2 capacity hint

새로 만들 때 크기를 알 수 있으면:

```rust
let mut v = Vec::with_capacity(1024);
let mut s = String::with_capacity(256);
let mut m = HashMap::with_capacity(128);
```

`Vec::push`로 자라다가 capacity 초과하면 보통 2배로 재할당 + 복사. 알고 있는 대략의 크기를 hint로 주면 그 비용 0회.

### 1.3 SmallVec / ArrayVec

대부분 N개 이하지만 가끔 더 — 스택 N개 + 넘으면 힙:

```rust
use smallvec::{SmallVec, smallvec};
let neighbors: SmallVec<[EntityId; 8]> = smallvec![];
// 8개까지 스택, 9번째부터 힙
```

`ArrayVec`은 스택 고정 — 초과하면 panic 또는 push 실패. 상한이 명확할 때.

### 1.4 String allocation

```rust
// ❌
let s = format!("Entity {}", id);

// ✅ 재사용 가능 buffer
use std::fmt::Write;
buffer.clear();
write!(&mut buffer, "Entity {}", id).unwrap();
```

또는 정수 `id`를 직접 들고 다니고, 표시할 때만 format. 디버그 출력 외 핫패스에 String을 동적 생성하는 건 거의 항상 잘못된 신호.

---

## 2. Vec / String / HashMap 활용

### 2.1 `swap_remove` for unordered

순서 안 중요하면 `remove(i)` (O(n)) 대신 `swap_remove(i)` (O(1)):

```rust
let dead_entities: Vec<_> = world.dead_entities();
for i in dead_entities.iter().rev() {  // 뒤에서부터 처리 (인덱스 변경 회피)
    world.entities.swap_remove(*i);
}
```

ECS의 archetype storage는 swap_remove + entity index 갱신이 표준 패턴.

### 2.2 `retain` for in-place 필터

```rust
// ❌
entities = entities.into_iter().filter(|e| e.alive).collect();

// ✅ 원본 vec 그대로 수정
entities.retain(|e| e.alive);
```

### 2.3 `Vec::drain` for 이동

```rust
// 처음 절반만 처리
for item in self.queue.drain(..midpoint) {
    process(item);
}
```

`drain` iterator를 다 소비하면 그 범위가 vec에서 제거됨. 새 Vec 만들 필요 없음.

### 2.4 HashMap 접근 패턴

```rust
// ❌ 두 번 lookup
if !map.contains_key(&key) {
    map.insert(key, default());
}
let v = map.get_mut(&key).unwrap();

// ✅ 한 번 lookup
let v = map.entry(key).or_insert_with(default);
```

`Entry` API는 한 번의 lookup으로 insert / update / get 가능.

### 2.5 HashMap → 다른 hasher

기본 `std::collections::HashMap`은 SipHash — DoS 저항 있지만 느림. 게임 내부 데이터 (보안 무관)는 더 빠른 hasher:

```rust
use ahash::AHashMap;
let map: AHashMap<EntityId, Component> = AHashMap::new();
```

`fxhash`, `ahash`, `rustc-hash` 모두 fast hasher. 사용자 입력 키를 신뢰 못하는 자리 (네트워크 receive)에는 기본 hasher 유지.

---

## 3. SoA vs AoS

### 3.1 차이

```rust
// AoS — Array of Structs
struct Particle { pos: Vec3, vel: Vec3, color: u32, lifetime: f32 }
let particles: Vec<Particle> = ...;

// SoA — Struct of Arrays
struct Particles {
    pos: Vec<Vec3>,
    vel: Vec<Vec3>,
    color: Vec<u32>,
    lifetime: Vec<f32>,
}
```

### 3.2 언제 SoA가 빠른가

배치 처리 시: "모든 particle의 position 갱신"을 할 때, AoS는 메모리에서 `pos, vel, color, lifetime, pos, vel, ...` 순으로 읽음 — `vel`/`color`/`lifetime`까지 캐시에 끌어들이지만 안 씀. SoA는 `pos`만 연속으로 읽어 캐시 효율 100%.

또한 SoA는 SIMD 친화적 — 같은 연산을 여러 element에 동시 적용 가능.

### 3.3 ECS는 자연스럽게 SoA

archetype 기반 ECS는 컴포넌트 type별로 `Vec<T>`에 저장 — SoA. 시스템이 한 컴포넌트 set만 query하면 그 컴포넌트들의 SoA 슬라이스를 받는다.

### 3.4 트레이드오프

- 단일 entity 접근은 AoS가 더 직관적.
- entity 추가/제거 비용은 비슷 (둘 다 vec에 push / swap_remove).
- 직접 SoA 짤 일은 거의 없고 ECS가 알아서 함.

---

## 4. Branch prediction / cache 친화성

### 4.1 데이터 정렬

같은 종류의 일은 모아서. 필터링 후 처리:

```rust
// ❌
for entity in entities {
    if entity.alive { update(entity); }
    if entity.collidable { check_collision(entity); }
}

// ✅ — 두 시스템으로 분리, 각각 query
fn update_alive(world: &World) { /* 살아있는 것만 query */ }
fn check_collisions(world: &World) { /* collidable만 query */ }
```

ECS의 query 기반 시스템은 자연스럽게 이 패턴.

### 4.2 작은 enum의 분기 비용

```rust
match entity.kind {
    Kind::Player => { /* ... */ }
    Kind::Enemy => { /* ... */ }
    Kind::Pickup => { /* ... */ }
}
```

CPU branch predictor는 패턴이 있으면 잘 예측, 무작위면 못함. 같은 kind들을 모아서 처리하면 예측 적중률 ↑.

### 4.3 prefetch

표준 라이브러리에 명시적 prefetch는 없음. 보통 데이터를 캐시 라인 정렬 + 순차 접근으로 자연스러운 prefetch 유도.

`#[repr(align(64))]`로 구조체 정렬 강제 가능 (cache line 64 bytes에 맞춤). 측정 없이 박지 마 — 메모리 낭비 증가.

---

## 5. Iterator vs manual — 성능 특성

### 5.1 zero-cost가 사실인 경우

```rust
let sum: i32 = vec.iter().sum();
// ↓ 사실상 동일
let mut sum = 0;
for x in &vec { sum += x; }
```

LLVM이 iterator chain을 풀어서 manual loop과 동일한 코드 생성 — vectorize까지 해주는 경우 많음.

### 5.2 zero-cost가 깨지는 경우

- `.collect::<Vec<_>>()` 중간 단계 — allocation 발생.
- closure에 mutable state 캡처 — inlining 어려워질 수 있음.
- 복잡한 chain (5+ adapter) — 가끔 LLVM이 못 풀어냄. 측정해보고 manual로.

### 5.3 `Vec::extend` vs `.collect()` + 합침

```rust
// ❌ 새 Vec 만들고 합침
let mut all = existing.clone();
all.extend(new_items.iter().cloned());

// ✅ 직접 extend
existing.extend(new_items.iter().cloned());
```

---

## 6. Inlining

### 6.1 자동 inline

같은 crate 안의 작은 함수는 LLVM이 알아서 inline. cross-crate는 관습적으로 안 함 (codegen unit 분리).

### 6.2 `#[inline]` 사용처

- 매우 작은 함수가 다른 crate에서 호출됨 (getter, math 헬퍼).
- generic 함수 — `#[inline]` 없으면 cross-crate inline이 제한적.

```rust
#[inline]
pub fn dot(a: Vec3, b: Vec3) -> f32 {
    a.x * b.x + a.y * b.y + a.z * b.z
}
```

### 6.3 `#[inline(always)]` 신중히

진짜로 강제 inline. 큰 함수에 박으면 코드 사이즈 폭증, 캐시 미스 증가로 오히려 느려짐. 측정 후에만.

---

## 7. SIMD 진입점

### 7.1 자동 vectorize

LLVM은 단순한 loop을 자동 SIMD화. 도와주는 패턴:
- 길이가 컴파일 타임 또는 미리 알려짐.
- 의존성 없음 (각 iteration이 독립적).
- 데이터가 정렬된 메모리에 연속.

```rust
fn add_arrays(a: &[f32], b: &[f32], out: &mut [f32]) {
    for i in 0..a.len() {
        out[i] = a[i] + b[i];
    }
}
```

이 정도면 LLVM이 SSE/AVX 자동 활용. iterator 버전도 같음.

### 7.2 명시적 SIMD

`std::simd` (nightly) 또는 `wide` / `glam` (안정):

```rust
use glam::Vec4;
let a = Vec4::new(1.0, 2.0, 3.0, 4.0);
let b = Vec4::splat(2.0);
let c = a + b;  // SSE/NEON 사용
```

게임엔진은 `glam`, `nalgebra` 같은 검증된 math crate 사용 권장 — 직접 SIMD intrinsic 박지 마.

### 7.3 WASM SIMD

WebAssembly SIMD (`wasm32-unknown-unknown` + simd128 feature)로 브라우저에서도 SIMD 활용 가능. `RUSTFLAGS="-C target-feature=+simd128"`.

---

## 8. unsafe — 언제 정당한가

### 8.1 정당한 경우

- **FFI**: C 라이브러리 binding (raw API는 unsafe).
- **검증된 raw pointer 패턴**: lock-free 자료구조, 특수 allocator.
- **측정으로 입증된 핫패스**: bounds check 제거가 의미 있음을 증명한 경우 (`unsafe { v.get_unchecked(i) }`).
- **소유권 모델로 표현 못하는 그래프**: 자기참조 구조체, intrusive linked list.

### 8.2 부당한 경우

- **귀찮아서**: borrow checker와 싸우기 싫음 → 설계 다시.
- **추측으로**: "unsafe가 더 빠를 거야" → 측정 없으면 근거 없음.
- **clone 회피**: 거의 항상 안전한 대안 존재.

### 8.3 unsafe 작성 규칙

- **`unsafe` 블록은 작게**. 한 줄이 이상적, 최대 한 함수.
- **`# Safety` doc comment 필수**: 호출자가 지켜야 할 invariant 명시.
- **테스트 우선**: miri (`cargo +nightly miri test`)로 UB 검증.

```rust
/// # Safety
///
/// `index` must be `< len`. Caller guarantees this via earlier check.
#[inline]
pub unsafe fn get_unchecked(&self, index: usize) -> &T {
    debug_assert!(index < self.len);
    unsafe { &*self.ptr.add(index) }
}
```

---

## 9. 프로파일링 도구

### 9.1 `cargo flamegraph`

```bash
cargo install flamegraph
cargo flamegraph --bin mygame
```

CPU flamegraph 생성. Linux는 perf, macOS는 dtrace, Windows는 별도 도구. release 빌드 + debug symbols (`[profile.release] debug = true`).

### 9.2 puffin

frame-based 프로파일러, 게임 친화적:

```rust
puffin::profile_function!();
puffin::profile_scope!("render_pass");
```

GUI viewer 별도. 프레임당 시간 분포 시각화에 좋음.

### 9.3 tracing + tracy

`tracing` 매크로로 span을 표시, `tracing-tracy`로 [Tracy](https://github.com/wolfpld/tracy) 프로파일러에 전송. 게임엔진에서 점점 표준.

```rust
#[tracing::instrument]
fn update_physics(world: &mut World, dt: Seconds) { ... }
```

### 9.4 `criterion`

벤치마크 — micro-benchmark용:

```rust
// benches/movement.rs
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_movement(c: &mut Criterion) {
    let mut world = setup();
    c.bench_function("update_movement", |b| {
        b.iter(|| update_movement(black_box(&mut world), Seconds(0.016)))
    });
}
criterion_group!(benches, bench_movement);
criterion_main!(benches);
```

`black_box`로 컴파일러 최적화에 의한 사라짐 방지. statistical analysis 자동.

---

## 10. 빌드 / 컴파일러 설정

### 10.1 release profile 튜닝

`Cargo.toml`:

```toml
[profile.release]
opt-level = 3        # 기본
lto = "thin"         # link-time optimization (빌드 시간 ↑, 성능 ↑)
codegen-units = 1    # cross-unit 인라인, 더 좋은 최적화 (빌드 더 느림)
panic = "abort"      # panic 시 unwinding 제거 (코드 크기 ↓)
strip = true         # debug symbol 제거 (배포용)
```

`debug = true`도 추가하면 프로파일러용 symbol 유지 — 배포 안 할 때.

### 10.2 dev profile 가속

기본 dev는 opt-level 0이라 게임이 안 돌아갈 만큼 느림. 종속 crate만 최적화:

```toml
[profile.dev.package."*"]
opt-level = 3
```

내 코드는 빠른 컴파일 (디버깅 가능), 의존성은 최적화. 게임엔진에서 거의 필수.

### 10.3 target-cpu

```bash
RUSTFLAGS="-C target-cpu=native" cargo build --release
```

빌드한 머신의 CPU instruction set 풀 활용. 배포 시 부적절 (다른 CPU에선 안 도는 binary 가능). 본인 개발 빌드에만.

### 10.4 WASM 사이즈 최적화

```toml
[profile.release]
opt-level = "s"     # 또는 "z" — 사이즈 우선
lto = true
strip = true
```

추가로 `wasm-opt` (binaryen tool) 후처리. WASM 게임은 페이지 로드 시간 = 사이즈 직결.

---

## 참고

- [The Rust Performance Book](https://nnethercote.github.io/perf-book/) — 종합 가이드.
- [Algorithms with Iterators](https://web.mit.edu/rust-lang_v1.25/arch/amd64_ubuntu1404/share/doc/rust/html/std/iter/index.html) — std::iter 적응자 카탈로그.
- [Tracy Profiler](https://github.com/wolfpld/tracy) — frame profiler.
- [Mike Acton's "Data-Oriented Design"](https://www.youtube.com/watch?v=rX0ItVEVjHc) — DOD 입문 강연.