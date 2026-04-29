---
name: rust-game-engine-conventions
description: "Apply universal Rust community conventions and idiomatic patterns when writing, reviewing, or refactoring Rust code, with extra coverage for game engine development (ECS, game loop, asset handling, hot-path performance). Use this skill whenever Rust code is involved — writing new .rs files, reviewing PRs, refactoring, debugging borrow-checker, lifetime, or trait-bound errors, designing module structure or Cargo.toml, choosing between Result, Option, and panic!, deciding ownership vs borrowing, selecting traits to derive, organizing crates and workspaces, or designing public APIs. Trigger this for any mention of .rs, cargo, crate, trait, lifetime, borrow checker, Rust 코드, 러스트, ECS, game loop, or game engine architecture in a Rust context, even casual asks like 'this 함수 좀 봐줘' when the file is Rust. Err on the side of triggering — the cost of consulting this skill is small, the cost of producing un-idiomatic Rust is high."
---

# Rust Game Engine Conventions

이 스킬은 **범용 Rust 관례** + **게임엔진에서 특히 중요한 패턴**을 담고 있어. 프레임워크 중립 (Bevy / wgpu+winit / Macroquad / 자체 엔진 모두 적용 가능). 게임이 아닌 일반 Rust 작업에도 그대로 적용됨 — 게임 관련 절(節)은 해당될 때만 참조.

## 사용 원칙

이 스킬을 **읽었으면 적용해.** 사용자가 "관례대로 짜줘"라고 명시하지 않아도, Rust 코드를 생성/수정할 때 이 문서가 활성화되어 있다면 여기 적힌 관례를 기본값으로 따른다. 사용자가 명시적으로 다른 스타일을 요구할 때만 이탈한다.

코드를 쓰기 전에 (특히 큰 변경) 관련된 절을 다시 한 번 훑어. 이 스킬의 가치는 **결정 시점에서의 일관성**에 있음.

---

## 0. 의사결정 핵심 원칙

이 다섯 개를 충돌 시 우선순위 순서대로 적용:

1. **컴파일 타임 안전성 > 런타임 체크.** 타입과 lifetime으로 막을 수 있으면 막아라.
2. **명시적 > 암묵적.** 클론은 클론이라고 쓰고, 에러는 `Result`로 드러내라.
3. **표준 관례 > 개인 취향.** `rustfmt`, clippy default, [Rust API Guidelines]를 따른다. 의견이 갈리면 표준 쪽.
4. **Zero-cost abstraction은 핫패스에서만 따진다.** 일반 코드는 가독성 우선, 프로파일링 후 핫패스 식별되면 최적화.
5. **Idiomatic > clever.** 짧지만 낯선 코드보다 길지만 익숙한 코드가 낫다.

---

## 1. 도구 체인 (이게 깔려 있다고 가정한다)

- `cargo fmt` — 무조건 default config. `rustfmt.toml` 만들지 마라 (팀 컨벤션 아닌 이상).
- `cargo clippy -- -D warnings` — 워닝은 에러 취급. 게임엔진은 `-W clippy::pedantic` 일부 추가 권장하되, 시끄러운 lint는 `#[allow(...)]`으로 명시적 예외.
- `rust-analyzer` — IDE 지원 전제.
- `cargo test`, `cargo bench` (criterion 기반), `cargo flamegraph` — 게임엔진 성능 측정 시.

코드 작성 후 항상 머릿속에서 `cargo fmt && cargo clippy`를 돌려라. clippy가 잡을 만한 패턴 (`.clone()` 남발, 불필요한 `&`, `if let Some(x) = ... { ... }`로 줄일 수 있는 match 등)은 처음부터 피해.

---

## 2. 네이밍

| 대상 | 케이스 | 예시 |
|---|---|---|
| 변수, 함수, 모듈, 파일명 | `snake_case` | `update_physics`, `entity_id` |
| 타입, trait, enum, struct | `PascalCase` | `RenderPass`, `Component` |
| 상수, static | `SCREAMING_SNAKE_CASE` | `MAX_ENTITIES`, `TARGET_FPS` |
| Lifetime | 짧은 `snake_case` | `'a`, `'frame`, `'world` |
| 제네릭 타입 파라미터 | 한 글자 PascalCase 또는 의미있는 PascalCase | `T`, `K`, `V`, `Comp` |

**Stuttering 피하기**: `game::game_state::GameState` → `game::state::State`. 모듈 경로가 이미 맥락을 주면 타입명은 중복하지 않는다.

**약어**: 두 글자 약어는 그대로 (`Io`, `Os`), 세 글자 이상은 한 단어처럼 취급 (`Http`, `Json`, not `HTTP`/`JSON`).

**boolean 함수/변수**: `is_*`, `has_*`, `can_*`, `should_*` 접두사. `entity_alive` 보다 `is_alive`.

**getter는 접두사 없이**: `fn name(&self)`, not `fn get_name(&self)`. setter는 `set_name`. 단, 변환/계산이 들어가면 `compute_*`, `to_*` 같은 명확한 이름.

---

## 3. 에러 처리 의사결정

```
실패 가능한가?
├── Yes → recoverable인가?
│   ├── Yes → Result<T, E>
│   │   ├── 라이브러리/크레이트 코드 → 타입화된 에러 (thiserror로 enum)
│   │   └── 바이너리/앱 코드 → anyhow::Error + .context(...)
│   └── No (프로그래밍 버그) → panic!() / unreachable!() / .expect("이유")
└── No, "값이 없을 수도 있다"면 → Option<T>
```

**핵심 규칙**:

- `?` 연산자가 기본. `match` for `Result`는 진짜 분기 처리할 때만.
- `unwrap()` / `expect()` 는 **테스트, 프로토타입, 또는 '절대 실패할 수 없음을 코드로 보장한 자리'에만**. 후자의 경우 반드시 주석으로 이유 설명: `let x = list.first().expect("list is non-empty by construction above");`
- 라이브러리 에러는 `thiserror`로 enum 정의:
  ```rust
  #[derive(Debug, thiserror::Error)]
  pub enum AssetError {
      #[error("asset not found: {0}")]
      NotFound(String),
      #[error("io error")]
      Io(#[from] std::io::Error),
  }
  ```
- 앱/바이너리에서는 `anyhow::Result<T>` + `.context("loading config")?` 패턴이 일반적.
- 게임엔진은 **라이브러리** 성격이므로 `thiserror` 우선. CLI 도구나 main()에서만 `anyhow`.

**왜?** 라이브러리 사용자는 에러를 분기해서 다루고 싶어 하고, 앱은 위쪽까지 전파해 로그/UI로 보여주는 게 일반적이기 때문이다. 둘을 섞으면 추후 패턴 매칭이 깨지거나, 다운캐스팅하느라 고생한다.

**금기**:
- `.unwrap()` 마음껏 뿌리고 "나중에 처리" — 거의 항상 거짓말.
- 에러를 `String`으로 보관 — 타입 정보 다 잃음.
- 모든 에러를 `Box<dyn Error>`로 — 스택트레이스/맥락 사라짐.

---

## 4. 소유권 / 차용 기본값

함수 시그니처를 짤 때 **가장 싼 참조**를 받아라:

| 하려는 일 | 받아야 할 타입 |
|---|---|
| 문자열 읽기 | `&str` (NOT `&String`) |
| 슬라이스 읽기 | `&[T]` (NOT `&Vec<T>`) |
| 경로 읽기 | `&Path` (NOT `&PathBuf`) |
| 임의 타입 읽기 | `&T` |
| 빌려서 수정 | `&mut T` |
| 소유권을 가져가야 할 때 | `T` |
| 유연한 입력 받기 | `impl AsRef<Path>` / `impl Into<String>` / `impl IntoIterator<Item = T>` |

**Clone은 명시적 도구.** 컴파일러가 화내서 `.clone()`을 박는 건 거의 항상 잘못된 신호. 멈추고 생각해:
1. 정말로 사본이 필요한가? → 그럼 clone, 변수명에 의도 드러내기 (`let owned_name = name.clone();`).
2. 차용으로 풀 수 있는가? → lifetime 도입 또는 함수 분할.
3. 데이터 흐름이 잘못된 건가? → 구조 자체를 다시 본다 (자주 있다).

**Lifetime annotation**: elision으로 자동 추론되는 자리에는 쓰지 마. 명시할 때는 의미있는 이름 (`'frame`, `'world`) — 단순 `'a`, `'b`는 두 개 이상 얽힐 때 가독성 떨어진다.

**`Arc<Mutex<T>>` 남발 금지.** 멀티스레드에서 정말 공유 가변 상태가 필요한지 먼저 묻는다. 보통은:
- 메시지 패싱 (`std::sync::mpsc`, `crossbeam-channel`)
- Read-heavy면 `Arc<RwLock<T>>` 또는 immutable snapshot
- ECS는 system 스케줄러가 차용 충돌을 자동 처리

---

## 5. 반복 — Iterator 우선

`for i in 0..vec.len()` + `vec[i]` 패턴은 거의 항상 잘못된 선택. iterator chain으로:

```rust
// ❌ 인덱스 루프
let mut active = Vec::new();
for i in 0..entities.len() {
    if entities[i].alive {
        active.push(entities[i].id);
    }
}

// ✅ iterator chain
let active: Vec<_> = entities.iter()
    .filter(|e| e.alive)
    .map(|e| e.id)
    .collect();
```

**왜?** iterator는 fuse / inline 되어 종종 더 빠르다. 컴파일러가 bounds-check 제거하기 더 쉽다. 의도가 명확하다 ("filter then map" 한 줄로 읽힘).

**일반적인 변환 → iterator 매핑**:
- 변환: `.map()`
- 걸러내기: `.filter()`
- 누적: `.fold()` / `.sum()` / `.product()`
- 짝짓기: `.zip()` / `.enumerate()`
- 평탄화: `.flat_map()` / `.flatten()`
- 짧은 회로: `.any()` / `.all()` / `.find()`
- 그룹: `.chunks()` / `.windows()` (slice), `.group_by()` (itertools)

**`.collect::<Vec<_>>()` 무조건 부르지 마.** 다음 단계가 또 iterator 변환이면 그대로 chain. collect는 allocation이다.

**`for` 루프가 정당한 경우**: side effect만 있고 결과를 모으지 않을 때 (`for entity in entities { entity.tick(); }`), 또는 chain이 너무 복잡해져 가독성이 떨어질 때.

---

## 6. 타입 / API 설계

### 6.1 표준 trait derive

새 타입 정의 시 다음을 **습관적으로 검토**:

```rust
#[derive(Debug, Clone, PartialEq)]
pub struct Position { pub x: f32, pub y: f32 }
```

| Trait | 언제 |
|---|---|
| `Debug` | **거의 항상** (`{:?}` 디버깅용, public 타입 필수) |
| `Clone` | 복제 가능하면 |
| `Copy` | 진짜로 싸고 (≤16 bytes), value semantics가 자연스러울 때만 |
| `PartialEq` / `Eq` | 동등 비교가 의미 있으면 |
| `Hash` | HashMap key로 쓸 가능성 |
| `Default` | "비어있음" / "초기상태"가 자연스러울 때 |
| `PartialOrd` / `Ord` | 정렬 가능할 때 |

**`Copy` 신중히 박아라.** 한 번 박으면 빼기 어렵고 (사용자 코드 깨짐), 큰 구조체에 박으면 의도치 않은 복사로 성능 저하. 게임엔진에서는 `Vec3`, `EntityId`, `Color` 같은 작은 value type만.

### 6.2 Newtype 패턴

의미가 다른 primitive는 별개 타입으로 감싼다:

```rust
// ❌ 다 u32라 섞일 위험
fn spawn(entity_id: u32, prefab_id: u32) { ... }

// ✅ 컴파일 타임에 차단
pub struct EntityId(pub u32);
pub struct PrefabId(pub u32);
fn spawn(entity_id: EntityId, prefab_id: PrefabId) { ... }
```

게임엔진에서 특히 강력: `Seconds(f32)`, `Pixels(u32)`, `TextureHandle(u32)`, `MeshId(u32)`. ID 섞임으로 인한 버그를 컴파일러가 잡아준다.

### 6.3 Builder 패턴

선택 필드가 3개 넘으면 builder:

```rust
let window = WindowBuilder::new()
    .title("Game")
    .size(1280, 720)
    .vsync(true)
    .build()?;
```

작은 구조체나 필드가 다 필수면 그냥 `new()`로 충분. 과용하지 마.

### 6.4 trait object vs 제네릭

- **제네릭** (`<T: Trait>`): 핫패스, 타입을 알고 있을 때, 모노모피제이션이 좋을 때.
- **trait object** (`Box<dyn Trait>`, `&dyn Trait`): 런타임 다형성 필요, 이질적 컬렉션, 동적 디스패치 비용 무시 가능할 때.

게임엔진 예: 컴포넌트 storage는 제네릭 (`ComponentStorage<T>`), 씬그래프 노드 같은 이질적 자식은 `Vec<Box<dyn Node>>`.

`dyn Trait`는 `Send + Sync` 같은 추가 bound를 자주 까먹게 한다. 멀티스레드 시스템에서는 명시적으로: `Box<dyn Trait + Send + Sync>`.

### 6.5 From / Into / TryFrom

변환은 `From` 구현으로 양방향 자동 (`Into`는 자동 derive됨). 실패 가능한 변환은 `TryFrom`.

```rust
impl From<(f32, f32)> for Vec2 {
    fn from((x, y): (f32, f32)) -> Self { Vec2 { x, y } }
}
// 이제 Vec2::from((1.0, 2.0)) 또는 (1.0, 2.0).into() 가능
```

함수 시그니처에서 `impl Into<Vec2>`를 받으면 호출자가 편해진다. 단, 너무 남발하면 타입 추론 복잡해지니 핵심 API에만.

상세는 `references/api-design.md`.

---

## 7. 모듈 / 크레이트 구조

- **기능 기반 모듈 (feature-based)**, 종류 기반 (kind-based) 아님. `vec`, `traits`, `enums` 모듈은 안티패턴. `physics`, `render`, `input`이 자연스러움.
- **`lib.rs`는 public API의 진열장**: `pub use` re-export로 내부 경로를 숨김. 사용자가 `engine::Renderer`로 쓰지 `engine::render::pipeline::Renderer`로 쓰지 않게.
- **내부는 `pub(crate)`**: 의도치 않은 public API 노출 방지.
- **워크스페이스로 분할**: 게임엔진은 보통 멀티 크레이트 — `engine-core`, `engine-render`, `engine-physics`, `engine-assets` 등. `Cargo.toml` 워크스페이스 root에서 모두 관리.
- **테스트**:
  - 단위 테스트: 같은 파일 안 `#[cfg(test)] mod tests { ... }`.
  - 통합 테스트: `tests/` 디렉토리.
  - 벤치마크: `benches/` (criterion).
  - 게임엔진은 통합 테스트가 더 가치 큼 — 시스템 간 상호작용이 핵심.

---

## 8. 문서화

- 모든 public 항목에 `///` doc comment. 한 문장 요약 + 빈 줄 + 상세.
- 모듈/크레이트 루트에는 `//!`로 모듈 차원 설명.
- Doc comment의 코드블록은 **doctest로 실행**되니 컴파일 가능하게.
- `# Errors`, `# Panics`, `# Safety`, `# Examples` 절을 적절히:

```rust
/// Loads a texture from disk.
///
/// # Errors
///
/// Returns `AssetError::NotFound` if the path does not exist,
/// or `AssetError::Io` for read failures.
///
/// # Examples
///
/// ```
/// # use myengine::Texture;
/// let tex = Texture::load("assets/player.png")?;
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// ```
pub fn load(path: impl AsRef<Path>) -> Result<Texture, AssetError> { ... }
```

---

## 9. 게임엔진 패턴

### 9.1 ECS 기본 사상

ECS는 단순한 아키텍처 선택이 아니라 **Rust borrow checker가 선호하는 구조**다. 컴포넌트(데이터)와 시스템(로직)을 분리하면 차용 충돌을 스케줄러가 정적으로 분해할 수 있다.

규칙:
- **컴포넌트는 plain data만**. 메서드는 query 헬퍼 정도. 게임 로직 X.
- **시스템은 컴포넌트 셋에 대한 함수**. 상태는 인자(world / query)로 받는다.
- **컴포넌트 간 직접 참조 금지**. 관계는 ID로 (`parent: Option<EntityId>`).

세부는 `references/game-patterns.md`.

### 9.2 게임 루프 구조

표준 패턴:

```rust
let mut accumulator = Duration::ZERO;
let fixed_dt = Duration::from_secs_f32(1.0 / 60.0);
let mut last = Instant::now();

loop {
    let now = Instant::now();
    let frame_dt = now - last;
    last = now;
    accumulator += frame_dt;

    process_input(&mut world);

    while accumulator >= fixed_dt {
        fixed_update(&mut world, fixed_dt);  // 물리 / 시뮬레이션
        accumulator -= fixed_dt;
    }

    let alpha = accumulator.as_secs_f32() / fixed_dt.as_secs_f32();
    render(&world, alpha);  // 보간
}
```

**왜 분리?** 물리는 결정적이고 안정적이어야 하고 (네트워크 동기화, 리플레이), 렌더는 디스플레이 주사율에 맞춰야 한다. 둘을 같은 timestep으로 묶으면 결정성과 부드러움 둘 다 잃는다.

### 9.3 시간 처리

- 측정: `std::time::Instant`.
- 표현: `std::time::Duration` (canonical 타입).
- 시스템 안 계산은 `f32` 초 또는 newtype `Seconds(f32)`로 변환해 사용.
- delta time을 raw `f32`로 던지면 단위 혼동이 생긴다 — 모듈 경계를 넘기면 newtype 추천.

### 9.4 자산 핸들

게임 객체에 `Texture`, `Mesh`를 직접 박지 마라. **typed handle**로 간접 참조:

```rust
pub struct Sprite {
    pub texture: Handle<Texture>,
    pub size: Vec2,
}

let tex = assets.get(&sprite.texture)?;
```

이유: 핫리로드 가능, 직렬화 용이, 메모리 한 곳 관리, GPU 자원 RAII가 한 곳.

### 9.5 GPU 자원 RAII

GPU buffer / texture / shader 래퍼는 `Drop`을 구현해 자동 해제. 공유는 `Arc`. raw handle을 game logic에 노출시키지 말 것.

### 9.6 입력 — 이벤트 기반

매 프레임 polling보다 event queue:

```rust
pub enum InputEvent {
    KeyPress(KeyCode),
    MouseMove { dx: f32, dy: f32 },
    Resize { width: u32, height: u32 },
}
```

상태 추적이 필요하면 별도 `InputState` 리소스에 누적. 이벤트와 상태는 분리.

---

## 10. 핫패스 성능 idiom

핫패스는 보통 **렌더 frame** 안의 시스템들. 그 외에는 가독성 우선.

- **사전 할당**: `Vec::with_capacity(estimate)`. 매 프레임 `Vec::new()` 후 push 반복은 안티패턴.
- **버퍼 재사용**: 매 프레임 `Vec` 새로 만들지 말고, 멤버로 보관 후 `.clear()`.
- **SmallVec / ArrayVec**: 스택 할당 가능한 작은 컬렉션 (`smallvec` crate).
- **SoA > AoS**: 일괄 처리 시 struct-of-arrays가 캐시 친화적. ECS의 archetype storage가 자연스럽게 SoA.
- **`Box`/`Rc`/`Arc` 핫루프 회피**: 한 번 만들어두고 빌리기.
- **iterator도 allocation 만들 수 있다**: `.collect()` 빈도 체크.
- **`#[inline]`은 신중히**: 작은 hot 함수에만. 무차별 인라인은 코드사이즈만 늘림.
- **측정 후 최적화**: 추측은 자주 틀린다. `cargo flamegraph`, `puffin`, `tracy`.

상세 idiom 모음은 `references/performance.md`.

---

## 11. 안티패턴 (코드에서 발견하면 제거 또는 정당화)

- `.clone()`을 borrow checker 우회 도구로 사용 — 설계가 잘못된 신호.
- `.unwrap()` / `.expect()` 산재 — 거의 항상 `?`로 바꿀 수 있음.
- `String` 인자 (대신 `&str` 또는 `impl Into<String>`).
- `&Vec<T>` 인자 (대신 `&[T]`).
- `Box<dyn Error>`로 모든 에러 통합 — context 잃음.
- 한 함수에 generic bound 4개 이상 (`fn f<A:B+C, D:E+F+G>(...)` ) — 분해하거나 trait object 검토.
- `unsafe` 없이도 가능한데 성능 신화로 `unsafe` 사용 — 정당한 경우에만 (FFI, 검증된 raw pointer 패턴, 측정으로 입증된 핫패스).
- 매크로 남용 — 함수로 충분하면 함수.
- `.clone().clone().clone()` 체인 — 대부분 한 번이면 됨.
- `loop { ... break }`로 `while` 흉내 — `while` 또는 `loop { let x = ...; if cond { break x; } }` 패턴.
- 튜플 struct 필드 4개 이상 — 명명 struct로.
- `pub` 남발 — `pub(crate)` 기본, 진짜 외부 노출만 `pub`.

---

## 12. 코드 리뷰 체크리스트

리뷰/리팩터링 시 이 순서로 훑는다:

1. **컴파일 / clippy clean한가?** (`cargo clippy --all-targets`)
2. **`unwrap()` / `expect()` / `panic!` 정당한가?** 그 자리 주석 있는가?
3. **함수 시그니처가 가장 싼 참조를 받는가?** (`&str`, `&[T]`, `&Path`)
4. **불필요한 `.clone()` 있는가?**
5. **iterator로 표현 가능한 manual loop 있는가?**
6. **public API에 `Debug` 빠진 타입 있는가?**
7. **public 항목에 doc comment 있는가? 예제 testable한가?**
8. **lifetime이 elision 가능한데 명시했는가?**
9. **에러 타입이 적절한 추상화 수준인가?** (라이브러리는 enum, 앱은 anyhow)
10. **모듈이 기능 기반인가, 종류 기반(`utils`, `helpers`)인가?**
11. **테스트가 있는가?** 게임엔진은 시스템 통합 테스트 우선.
12. **(게임엔진) 핫패스에 매 프레임 allocation 있는가?**
13. **(게임엔진) ID/handle이 newtype인가, raw `u32`인가?**

---

## 13. 참조 파일

깊이 들어가야 할 때:

- **`references/idioms.md`** — 네이밍, 에러, 소유권, iterator의 상세 예제 모음.
- **`references/api-design.md`** — trait 선택, builder, newtype, From/Into, sealed trait 등 API 설계 패턴.
- **`references/game-patterns.md`** — ECS 구조, 게임루프 변형, 자산 시스템, 씬그래프, 카메라/투영, 시간/난수.
- **`references/performance.md`** — 핫패스 idiom, allocation 회피, SoA, SIMD 진입점, 프로파일링.

이 파일들은 SKILL.md에서 다룰 수 없는 길이/세부에 해당하는 내용이 들어 있다. 특정 주제를 깊게 다룰 때 해당 파일을 `view` 해서 읽어라. 매번 다 읽을 필요 없음 — 관련 절만.

---

## 참고 표준

- [The Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) — 본 스킬의 많은 부분이 이 문서를 따른다.
- [Rust Style Guide](https://doc.rust-lang.org/nightly/style-guide/) — `rustfmt` 기본값의 출처.
- [The Rustonomicon](https://doc.rust-lang.org/nomicon/) — `unsafe` 작성 시 필수.
- [Game Programming Patterns](https://gameprogrammingpatterns.com/) — 언어 중립적 게임 아키텍처.

이 문서들과 충돌하면 일반적으로 **이 SKILL.md가 우선** (게임엔진 특화 결정이 들어 있으므로). API Guidelines와 충돌하면 거기 따른다.