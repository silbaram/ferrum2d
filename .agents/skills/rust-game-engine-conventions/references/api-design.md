# Rust API Design Patterns (심화)

타입과 trait, public API의 모양을 결정할 때 참조하는 파일. SKILL.md의 §6에서 다룬 내용을 더 깊이 풀어둔다.

## 목차

1. trait 설계 — generic vs trait object
2. Builder 패턴 — 변형들
3. Newtype 패턴 — 활용 사례
4. Sealed trait — public이지만 외부 구현 차단
5. Typestate 패턴 — 컴파일 타임 상태 추적
6. Marker trait과 PhantomData
7. `From` / `Into` / `TryFrom` / `TryInto`
8. Extension trait 패턴
9. 인자 다형성 (`impl Trait` 활용)
10. 반환 다형성

---

## 1. trait 설계 — generic vs trait object

### 1.1 generic (정적 디스패치)

```rust
pub fn process<R: Renderer>(renderer: &mut R, scene: &Scene) {
    renderer.draw(scene);
}
```

- 모노모피제이션: 호출하는 모든 `R`마다 별개 함수가 생성됨.
- **장점**: zero-cost, 인라인 가능, generic bound로 풍부한 표현력.
- **단점**: 컴파일 시간 증가, 코드 사이즈 증가, 런타임에 다른 `R`을 한 자리에 못 섞음.

언제: 핫패스, 타입을 컴파일 타임에 확정 가능, 성능 민감.

### 1.2 trait object (동적 디스패치)

```rust
pub fn process(renderer: &mut dyn Renderer, scene: &Scene) {
    renderer.draw(scene);
}

let renderers: Vec<Box<dyn Renderer>> = vec![
    Box::new(WgpuRenderer::new()),
    Box::new(SoftwareRenderer::new()),
];
```

- vtable 기반 dispatch (간접 호출 1회).
- **장점**: 이질적 컬렉션, 런타임 다형성, 컴파일 시간 짧음.
- **단점**: 인라인 못함, vtable 통한 호출 비용 (보통 무시 가능), object-safe 제약.

언제: 콜백/플러그인, 씬그래프 노드 같은 이질적 자식, 런타임에 결정되는 변형.

### 1.3 object-safe 제약

`dyn Trait`로 쓰려면 trait이 object-safe해야:
- 메서드가 `Self: Sized`를 요구하지 않음.
- generic 메서드를 갖지 않음 (vtable로 표현 불가).
- `Self`를 반환하지 않음 (size 모름).

```rust
trait Animal {
    fn name(&self) -> &str;          // OK
    fn clone_box(&self) -> Box<dyn Animal>;  // OK (Self 반환 X)
    // fn dup(&self) -> Self;        // ❌ object-unsafe
}
```

generic 메서드가 필요하면 분리:

```rust
trait Renderer {
    fn draw(&mut self, scene: &Scene);  // dyn-friendly
}

trait RendererExt: Renderer {
    fn draw_with<F: Fn(&Scene)>(&mut self, scene: &Scene, customize: F) {
        // 기본 구현
    }
}
impl<T: Renderer + ?Sized> RendererExt for T {}
```

### 1.4 enum이 더 나을 때

변형이 **닫혀 있으면** (라이브러리 내부에서 다 알고 있음) trait보다 enum:

```rust
pub enum Renderer {
    Wgpu(WgpuRenderer),
    Software(SoftwareRenderer),
}
```

- vtable 없음, 인라인 가능, 패턴매칭으로 분기.
- 추가 시 모든 호출지점 수정 필요 — 변형 자주 늘면 부담.

게임엔진 안에서는 종종 enum이 정답. 외부 플러그인 받으려면 trait.

---

## 2. Builder 패턴 — 변형들

### 2.1 기본 builder (consuming)

```rust
pub struct Window { /* private fields */ }

pub struct WindowBuilder {
    title: String,
    size: (u32, u32),
    vsync: bool,
}

impl WindowBuilder {
    pub fn new() -> Self {
        Self { title: "Window".into(), size: (800, 600), vsync: true }
    }
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = title.into();
        self
    }
    pub fn size(mut self, w: u32, h: u32) -> Self {
        self.size = (w, h);
        self
    }
    pub fn vsync(mut self, on: bool) -> Self {
        self.vsync = on;
        self
    }
    pub fn build(self) -> Result<Window, WindowError> {
        // 검증 + 생성
        Ok(Window { /* ... */ })
    }
}
```

- 모든 setter가 `self`를 소비하고 반환 → 메서드 체이닝.
- `build()`가 `Result` 반환 — 검증 가능.

### 2.2 borrow builder (`&mut self`)

```rust
impl WindowBuilder {
    pub fn title(&mut self, title: impl Into<String>) -> &mut Self {
        self.title = title.into();
        self
    }
}

let mut b = WindowBuilder::new();
b.title("Game");
if dynamic_condition { b.size(1920, 1080); }
let win = b.build()?;
```

조건부로 setter 호출하기 편함. consuming builder는 한 번 분기되면 분기마다 builder를 들고 다녀야 함.

### 2.3 typestate builder

필수 필드를 컴파일 타임에 강제:

```rust
pub struct WindowBuilder<HasTitle = ()> {
    title: HasTitle,
    size: (u32, u32),
}

impl WindowBuilder<()> {
    pub fn new() -> Self {
        Self { title: (), size: (800, 600) }
    }
    pub fn title(self, title: String) -> WindowBuilder<String> {
        WindowBuilder { title, size: self.size }
    }
}

impl WindowBuilder<String> {
    pub fn build(self) -> Window { /* title 보장됨 */ }
}

// build()는 title이 설정된 후에만 호출 가능
```

복잡도 vs 안전성. 게임엔진의 RenderPipelineBuilder 같이 필수 stage가 여럿일 때 유용. 단순한 경우엔 과함.

---

## 3. Newtype 패턴 — 활용 사례

### 3.1 ID 혼동 방지

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityId(pub u32);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ComponentId(pub u32);

fn link(entity: EntityId, component: ComponentId) { ... }
// link(component_id, entity_id) 컴파일 에러
```

### 3.2 단위 추적

```rust
#[derive(Debug, Clone, Copy)]
pub struct Seconds(pub f32);

#[derive(Debug, Clone, Copy)]
pub struct Pixels(pub i32);

impl std::ops::Add for Seconds {
    type Output = Seconds;
    fn add(self, other: Seconds) -> Seconds { Seconds(self.0 + other.0) }
}
```

`Seconds` + `Pixels` 같은 무의미한 연산을 컴파일러가 차단.

### 3.3 외부 trait 구현 우회 (orphan rule)

`Vec<T>`에 우리 crate의 trait을 직접 구현 못하지만 (orphan rule), newtype으로 감싸면 가능:

```rust
pub struct EntityList(pub Vec<Entity>);

impl Serialize for EntityList { /* ... */ }
```

### 3.4 invariant 강제

생성자에서 검증하면 그 이후로는 invariant 보장:

```rust
pub struct NormalizedVec3(Vec3);

impl NormalizedVec3 {
    pub fn new(v: Vec3) -> Option<Self> {
        if (v.length_squared() - 1.0).abs() < 1e-5 {
            Some(NormalizedVec3(v))
        } else {
            None
        }
    }
    pub fn get(&self) -> Vec3 { self.0 }
}
```

이 타입을 받는 함수는 정규화 검사 생략 가능.

### 3.5 Deref 사용 시 주의

newtype을 투명하게 쓰고 싶어 `Deref` 구현하는 경우:

```rust
impl Deref for EntityList {
    type Target = Vec<Entity>;
    fn deref(&self) -> &Vec<Entity> { &self.0 }
}
```

**비추**. `Deref`는 smart pointer (`Box`, `Rc`, `Arc`)용으로 의도된 trait. newtype에 박으면 의도치 않은 메서드 노출, 타입 추론 혼란 발생. 메서드를 직접 forward하는 게 명시적:

```rust
impl EntityList {
    pub fn len(&self) -> usize { self.0.len() }
    pub fn iter(&self) -> std::slice::Iter<'_, Entity> { self.0.iter() }
}
```

---

## 4. Sealed trait — public이지만 외부 구현 차단

라이브러리에서 trait을 공개하고 싶지만, 사용자가 멋대로 구현하지 못하게 하고 싶을 때 (예: 미래에 메서드 추가하면 break change):

```rust
mod private {
    pub trait Sealed {}
}

pub trait MyTrait: private::Sealed {
    fn do_thing(&self);
}

// 라이브러리 내에서만 구현
impl private::Sealed for Foo {}
impl MyTrait for Foo {
    fn do_thing(&self) { /* ... */ }
}

// 외부에서 impl MyTrait for Bar { ... }는 컴파일 안 됨
// (Sealed를 impl할 수 없으므로)
```

게임엔진의 `RenderResource`, `Component` 같은 trait에 유용 — 외부에서 구현 가능하면 ABI / 안정성 부담 큼.

---

## 5. Typestate 패턴 — 컴파일 타임 상태 추적

상태를 타입으로 표현해 잘못된 호출을 컴파일러가 차단:

```rust
pub struct RenderPass<State> {
    inner: RawRenderPass,
    _state: PhantomData<State>,
}

pub struct Open;
pub struct Closed;

impl RenderPass<Open> {
    pub fn draw(&mut self, mesh: &Mesh) { /* ... */ }
    pub fn end(self) -> RenderPass<Closed> {
        RenderPass { inner: self.inner, _state: PhantomData }
    }
}

impl RenderPass<Closed> {
    pub fn submit(self, queue: &Queue) { /* ... */ }
}
```

`RenderPass<Closed>`에서는 `draw()`가 컴파일 안 됨. `submit()`은 닫힌 pass에서만.

비용: 약간 verbose해짐. 보상: 런타임 체크 / panic 제거.

---

## 6. Marker trait과 PhantomData

### 6.1 Marker trait

메서드 없는 trait — 타입에 "이런 성질이 있다"를 표시:

```rust
pub trait Component: 'static + Send + Sync {}

impl Component for Position {}
impl Component for Velocity {}

fn add_component<C: Component>(entity: EntityId, component: C) { ... }
```

`Send`, `Sync`, `Sized`가 표준 marker trait. ECS의 `Component`, `Resource` 같은 게 게임엔진의 전형.

### 6.2 PhantomData — 사용하지 않는 타입 파라미터

```rust
pub struct Handle<T> {
    id: u32,
    _marker: PhantomData<T>,
}
```

`Handle<Texture>`와 `Handle<Mesh>`를 다른 타입으로 만들지만, 실제 데이터는 `id`만 보관. `T`는 타입 추적용으로만 사용.

`PhantomData<T>`가 없으면 unused type parameter 경고. `PhantomData<fn() -> T>`는 variance를 contravariant하게 — drop check / variance 미세 조정 시 알아둘 가치.

---

## 7. `From` / `Into` / `TryFrom` / `TryInto`

### 7.1 표준 변환 trait

```rust
impl From<(f32, f32)> for Vec2 {
    fn from((x, y): (f32, f32)) -> Self { Vec2 { x, y } }
}

// 자동 derive 효과:
let v: Vec2 = (1.0, 2.0).into();
let v: Vec2 = Vec2::from((1.0, 2.0));
```

`From`을 구현하면 `Into`는 자동. 반대는 안 됨 (Rust 1.41 이전 호환성 이유). 항상 `From`을 구현해라.

### 7.2 `TryFrom` for 실패 가능 변환

```rust
impl TryFrom<i32> for EntityId {
    type Error = InvalidEntityId;
    fn try_from(n: i32) -> Result<Self, Self::Error> {
        if n >= 0 && n < MAX_ENTITY as i32 {
            Ok(EntityId(n as u32))
        } else {
            Err(InvalidEntityId(n))
        }
    }
}
```

### 7.3 함수 인자에서 활용

```rust
fn spawn(position: impl Into<Vec2>, name: impl Into<String>) {
    let pos: Vec2 = position.into();
    let n: String = name.into();
    // ...
}

spawn((0.0, 0.0), "player");           // tuple, &str 모두 OK
spawn(Vec2::ZERO, String::from("foo"));
```

호출자 친화적. 단, 타입 추론 부담이 있으니 모든 인자에 박지 말고 핵심 1-2개만.

---

## 8. Extension trait 패턴

표준 라이브러리 또는 외부 crate 타입에 메서드를 추가하고 싶을 때:

```rust
pub trait SliceExt {
    fn first_two(&self) -> Option<(&Self::Item, &Self::Item)>;
}

impl<T> SliceExt for [T] { ... }
```

orphan rule 때문에 외부 trait을 외부 타입에 직접 impl 못하므로, 본인의 trait 정의 후 impl. 유즈 사이트에서 `use myengine::SliceExt;`로 가져와야 메서드 보임.

게임엔진 예: `glam::Vec3`에 우리만의 헬퍼 (`to_world_space`, `project_onto_plane` 등).

---

## 9. 인자 다형성 (`impl Trait` 활용)

### 9.1 함수 인자 — 가독성 vs 명시성

```rust
// 짧음
fn print(items: impl Iterator<Item = i32>) { ... }

// 명시적 (turbofish 필요할 수 있음)
fn print<I: Iterator<Item = i32>>(items: I) { ... }
```

선호: bound가 단순하면 `impl Trait`, 복잡하거나 trait 안에 있으면 명시.

### 9.2 흔한 인자 idiom

```rust
fn open(path: impl AsRef<Path>) { ... }
fn rename(name: impl Into<String>) { ... }
fn from_iter<I: IntoIterator<Item = T>>(it: I) { ... }
fn callback<F: Fn(u32) -> bool>(f: F) { ... }
fn callback_mut<F: FnMut(u32)>(mut f: F) { ... }
fn callback_once<F: FnOnce()>(f: F) { ... }
```

`AsRef<Path>`는 `Path`, `PathBuf`, `&str`, `String` 모두 받음. 파일 API에 거의 표준.

`Fn` / `FnMut` / `FnOnce` 차이: 호출 시 클로저 환경을 어떻게 캡처/접근하는가. 가장 약한 trait을 받는 게 호출자에게 유연:
- `FnOnce`: 한 번만 호출, owned data 캡처 가능.
- `FnMut`: 여러 번, 가변 캡처.
- `Fn`: 여러 번, 불변 캡처 (스레드 공유 가능).

---

## 10. 반환 다형성

### 10.1 `impl Trait` 반환

```rust
fn make_iter() -> impl Iterator<Item = i32> {
    (0..10).map(|n| n * 2)
}
```

- 호출자는 정확한 타입 모름, `Iterator` interface만 사용 가능.
- 한 함수에서 여러 다른 타입을 반환할 수 없음 (가지마다 같은 타입이어야).

### 10.2 trait object 반환

```rust
fn make_iter(kind: Kind) -> Box<dyn Iterator<Item = i32>> {
    match kind {
        Kind::Even => Box::new((0..10).filter(|n| n % 2 == 0)),
        Kind::Odd => Box::new((0..10).filter(|n| n % 2 == 1)),
    }
}
```

분기마다 다른 타입을 반환 가능. heap alloc 비용 있음.

### 10.3 enum으로 정적 통일

```rust
pub enum NumIter<A, B> {
    Even(A),
    Odd(B),
}

impl<A, B> Iterator for NumIter<A, B>
where A: Iterator<Item = i32>, B: Iterator<Item = i32>,
{
    type Item = i32;
    fn next(&mut self) -> Option<i32> {
        match self {
            NumIter::Even(it) => it.next(),
            NumIter::Odd(it) => it.next(),
        }
    }
}
```

verbose하지만 zero-cost. `either` crate가 일반적인 경우 (`Either<A, B>`) 제공.

---

## 참고

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/) — 본 문서가 따르는 표준.
- [Rust Patterns Book](https://rust-unofficial.github.io/patterns/) — 패턴 카탈로그.
- [The Sealed Trait Pattern](https://predr.ag/blog/definitive-guide-to-sealed-traits-in-rust/) — sealed trait 심화.