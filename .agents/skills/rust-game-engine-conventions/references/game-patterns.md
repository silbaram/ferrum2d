# Game Engine Patterns in Idiomatic Rust

Rust로 게임엔진을 짤 때 자주 마주치는 아키텍처 결정과 그에 대한 idiomatic 해법. 프레임워크 중립이지만 Bevy / hecs / specs / wgpu 등 주류 ecosystem의 관례를 반영.

## 목차

1. ECS — 왜 Rust에 잘 맞는가
2. ECS 구조 — 컴포넌트 / 시스템 / 리소스
3. ECS 직접 구현 vs 라이브러리 사용
4. 게임 루프 변형
5. 시간 / 델타타임 / 결정성
6. 자산 시스템
7. 입력 처리
8. 씬 / 트랜스폼 계층
9. 카메라와 투영
10. 직렬화 / 세이브
11. 핫리로드
12. 에디터 / 디버그 도구

---

## 1. ECS — 왜 Rust에 잘 맞는가

ECS (Entity-Component-System)는 게임 객체를 **데이터(컴포넌트)** 와 **로직(시스템)** 으로 분해하는 아키텍처. OOP의 `class Player extends Entity { ... }` 식 상속 트리를 거부하고, **합성(composition)** 을 컴파일 타임 + 런타임 모두에서 강제한다.

Rust borrow checker 관점에서:

- 객체지향 게임엔진은 보통 mutable graph (`player.target.owner.weapon.parent`)를 만들고 거기서 borrow 충돌이 폭발한다.
- ECS는 데이터를 type별로 떨어져 있는 storage (보통 archetype 기반)에 담고, 시스템은 자기가 필요한 컴포넌트 셋만 query한다.
- 시스템 스케줄러가 query의 borrow 패턴을 분석해 충돌 안 나는 시스템을 병렬로 돌린다 — Rust의 정적 분석과 자연스럽게 결합.

결과적으로 Rust에서 ECS는 단순한 취향이 아니라 **현실적으로 가장 빌리기 쉬운 아키텍처**다.

---

## 2. ECS 구조 — 컴포넌트 / 시스템 / 리소스

### 2.1 컴포넌트는 plain data

```rust
#[derive(Debug, Clone, Copy)]
pub struct Position(pub Vec2);

#[derive(Debug, Clone, Copy)]
pub struct Velocity(pub Vec2);

#[derive(Debug, Clone)]
pub struct Sprite {
    pub texture: Handle<Texture>,
    pub size: Vec2,
}
```

규칙:
- **메서드는 헬퍼 정도만**. 게임 로직 X.
- **다른 엔티티 직접 참조 금지** — `parent: Option<EntityId>` (ID로 간접).
- **거대한 컴포넌트 만들지 마**. 자주 바뀌는 필드와 안 바뀌는 필드를 분리하면 캐시 효율이 좋고 시스템이 좁게 query.

### 2.2 시스템은 함수

```rust
fn update_movement(world: &mut World, dt: Seconds) {
    for (pos, vel) in world.query_mut::<(&mut Position, &Velocity)>() {
        pos.0 += vel.0 * dt.0;
    }
}
```

또는 라이브러리 식 시그니처:

```rust
fn update_movement(query: Query<(&mut Position, &Velocity)>, time: Res<Time>) {
    for (mut pos, vel) in query.iter_mut() {
        pos.0 += vel.0 * time.delta();
    }
}
```

규칙:
- **상태는 인자로**. 함수 안에 정적 변수 X.
- **하나의 일만**. "충돌 검사 + 데미지 적용 + 사망 처리"보다 시스템 셋으로 분리.
- **순서 명시**. 시스템 A가 B의 결과를 읽으면 스케줄러에 의존성 알려주기.

### 2.3 리소스 — world-wide singleton

특정 컴포넌트가 아닌 글로벌 데이터:

```rust
pub struct Time {
    pub delta: Seconds,
    pub elapsed: Seconds,
}

pub struct AssetServer { /* ... */ }

pub struct InputState { /* ... */ }
```

리소스도 borrow 충돌이 정적으로 분석됨 — 두 시스템이 같은 리소스를 동시에 mutate하지 못함.

---

## 3. ECS 직접 구현 vs 라이브러리 사용

### 3.1 라이브러리 선택지

- **bevy_ecs** — Bevy의 ECS 코어. 단독 사용 가능. archetype 기반, 시스템 스케줄러 강력. 가장 활발.
- **hecs** — 미니멀, archetype 기반. 라이브러리/엔진에 임베드하기 좋음.
- **specs** — 오래됨, sparse set + archetype 혼합. 유지보수 둔화.
- **legion** — archetype + 그룹화. specs와 비슷한 스펙트럼.

게임엔진을 처음 짜면 **bevy_ecs를 컴포넌트로 사용**하는 것이 가장 안전. 자체 구현은 학습 목적이거나 매우 특수한 요구사항이 있을 때.

### 3.2 자체 구현 가이드

작은 엔진이면 archetype storage를 직접:

```rust
pub struct World {
    entities: Vec<EntityRecord>,
    archetypes: HashMap<TypeIdSet, Archetype>,
}

struct Archetype {
    entities: Vec<EntityId>,
    components: HashMap<TypeId, Box<dyn ComponentVec>>,
}

trait ComponentVec: Any {
    fn push_default(&mut self);
    fn swap_remove(&mut self, index: usize);
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
}

impl<T: Component> ComponentVec for Vec<T> { /* ... */ }
```

핵심은:
- entity는 `(archetype_index, row_index)` 매핑.
- archetype은 component type 셋 단위로 분리.
- 컴포넌트 추가/제거는 archetype 이동.

이 정도 직접 구현은 책 한 권 분량 — 진지하게 할 거면 [Bevy ECS 소스](https://github.com/bevyengine/bevy/tree/main/crates/bevy_ecs)와 [Specs Book](https://specs.amethyst.rs/docs/tutorials/) 참조.

---

## 4. 게임 루프 변형

### 4.1 Fixed timestep (권장 기본)

```rust
let mut accumulator = Duration::ZERO;
let fixed_dt = Duration::from_secs_f32(1.0 / 60.0);
let mut last = Instant::now();

while running {
    let now = Instant::now();
    let frame_dt = now - last;
    last = now;

    // 스파이럴 오브 데스 방지
    let frame_dt = frame_dt.min(Duration::from_millis(250));
    accumulator += frame_dt;

    poll_events(&mut input);

    while accumulator >= fixed_dt {
        fixed_update(&mut world, fixed_dt);
        accumulator -= fixed_dt;
    }

    let alpha = accumulator.as_secs_f32() / fixed_dt.as_secs_f32();
    render(&world, alpha);
}
```

핵심:
- **누산기(accumulator)** 로 실제 경과시간을 모아 fixed_dt 단위로 잘라서 시뮬레이션.
- **clamp**: frame_dt가 너무 크면 (디버거 stop, 화면 hide 후 복귀) 누산기가 폭주해 simulation을 끝없이 돌리는 "spiral of death". 250ms 정도로 자른다.
- **alpha 보간**: 렌더는 마지막 두 시뮬레이션 상태 사이를 alpha로 lerp해 부드럽게.

### 4.2 Variable timestep (빠른 프로토타입)

```rust
while running {
    let dt = last.elapsed();
    last = Instant::now();
    update(&mut world, dt.as_secs_f32());
    render(&world);
}
```

- 단순. 결정성 없음. 물리 / 네트워크 동기화엔 부적합.
- 캐주얼/로컬 게임 프로토타입엔 OK.

### 4.3 Render-driven (브라우저 / requestAnimationFrame)

```rust
// wasm-bindgen + requestAnimationFrame
fn frame(timestamp_ms: f64) {
    let dt = (timestamp_ms - last) / 1000.0;
    last = timestamp_ms;
    update(&mut world, dt as f32);
    render(&world);
    request_next_frame();
}
```

브라우저는 RAF를 호출 빈도로 결정. fixed timestep을 원하면 RAF 안에서 accumulator 패턴 동일 적용.

---

## 5. 시간 / 델타타임 / 결정성

### 5.1 캐노니컬 타입

- 측정: `std::time::Instant::now()`.
- 차이: `std::time::Duration`.
- 시뮬레이션 안 계산: `f32` 또는 `f64` 초. fixed-point가 필요하면 `i64` 마이크로초.

### 5.2 newtype 추천

```rust
#[derive(Debug, Clone, Copy)]
pub struct Seconds(pub f32);

impl Seconds {
    pub const ZERO: Self = Seconds(0.0);
    pub fn from_duration(d: Duration) -> Self { Seconds(d.as_secs_f32()) }
}
```

raw `f32` 초가 모듈 경계를 넘기면 곧 단위 혼동이 생긴다.

### 5.3 결정성 (deterministic simulation)

리플레이, 네트워크 lockstep, 디버깅 가능성에 중요.

- 모든 random은 시드 + 명시적 RNG 인스턴스 (`rand::SeedableRng`).
- floating point 연산은 IEEE 754면 보통 결정적이지만, 컴파일러 최적화로 미세 차이 발생 가능 — 진짜 lockstep이면 fixed-point 또는 `f64` 사용.
- 시뮬레이션 입력은 명시적 — `dt`, RNG state, 입력 이벤트만으로 결정되어야.
- 시스템 실행 순서가 결정적이어야 함 — `HashMap` 순회는 비결정적, `BTreeMap` 또는 명시적 정렬.

---

## 6. 자산 시스템

### 6.1 핸들 기반

```rust
pub struct Handle<T> {
    id: u32,
    generation: u32,
    _marker: PhantomData<T>,
}

pub struct Assets<T> {
    storage: Vec<Option<T>>,
    generations: Vec<u32>,
    free_list: Vec<u32>,
}

impl<T> Assets<T> {
    pub fn add(&mut self, asset: T) -> Handle<T> { /* ... */ }
    pub fn get(&self, handle: Handle<T>) -> Option<&T> { /* ... */ }
    pub fn remove(&mut self, handle: Handle<T>) { /* ... */ }
}
```

`Handle<T>`는 `Copy`, 게임 로직에서 자유롭게 들고 다님. 실제 데이터는 `Assets<T>` 한 곳에서 관리.

`generation`은 ABA 문제 회피: handle이 stale인지 (제거된 후 같은 슬롯이 다른 자산에 할당됐는지) 검증.

### 6.2 비동기 로딩

```rust
pub enum AssetState<T> {
    Loading,
    Loaded(T),
    Failed(AssetError),
}

pub struct AssetServer {
    pending: Vec<JoinHandle<...>>,
    // ...
}

impl AssetServer {
    pub fn load<T: Asset>(&self, path: impl AsRef<Path>) -> Handle<T> {
        let handle = self.next_handle::<T>();
        // 백그라운드 스레드 또는 task로 디스크 I/O
        handle
    }
}
```

게임 루프 안에서는 절대 blocking I/O 하지 마. WASM에서는 `wasm-bindgen-futures`로 promise → future 변환.

### 6.3 자산 의존성

mesh가 material에 의존하고 material이 texture에 의존 — 로드 순서를 트래킹:

```rust
pub struct AssetDependencies {
    pending: HashMap<HandleId, Vec<HandleId>>,
}
```

또는 단순히 자식이 부모의 handle을 들고 있어 lazy resolve. 큰 게임엔진은 dependency graph를 명시적으로 관리.

---

## 7. 입력 처리

### 7.1 이벤트 기반 vs 상태 기반

**이벤트**: 매 프레임 입력 변화 목록.

```rust
pub enum InputEvent {
    KeyPressed(KeyCode),
    KeyReleased(KeyCode),
    MouseMoved { dx: f32, dy: f32 },
    MouseWheel { delta: f32 },
    Resize { width: u32, height: u32 },
}
```

**상태**: 현재 프레임의 누적 상태.

```rust
pub struct InputState {
    keys_held: HashSet<KeyCode>,
    mouse_pos: Vec2,
    mouse_delta: Vec2,
}
```

두 가지 다 필요. 이벤트는 "이번 프레임에 키가 처음 눌림" 같은 edge 감지에, 상태는 "키가 지금 눌려 있는가" 같은 level 체크에.

```rust
fn update(events: &[InputEvent], state: &mut InputState) {
    for event in events {
        match event {
            InputEvent::KeyPressed(k) => { state.keys_held.insert(*k); }
            InputEvent::KeyReleased(k) => { state.keys_held.remove(k); }
            InputEvent::MouseMoved { dx, dy } => { state.mouse_delta += Vec2::new(*dx, *dy); }
            _ => {}
        }
    }
}
```

### 7.2 액션 매핑

키와 게임 액션을 분리해 리매핑 가능하게:

```rust
pub enum Action { Jump, Shoot, MoveForward, /* ... */ }

pub struct ActionMap {
    bindings: HashMap<Action, Vec<KeyCode>>,
}

impl ActionMap {
    pub fn is_active(&self, action: Action, state: &InputState) -> bool {
        self.bindings.get(&action)
            .is_some_and(|keys| keys.iter().any(|k| state.keys_held.contains(k)))
    }
}
```

게임 코드는 `if action_map.is_active(Action::Jump, ...)`만 — 키 변경에 영향 없음.

---

## 8. 씬 / 트랜스폼 계층

### 8.1 부모-자식 트랜스폼

```rust
pub struct Transform {
    pub local: Mat4,
}

pub struct GlobalTransform {
    pub world: Mat4,
}

pub struct Parent(pub EntityId);
pub struct Children(pub Vec<EntityId>);
```

매 프레임 한 시스템이 부모→자식 순으로 `world = parent.world * local`을 계산. 직접 그래프 순회보다 ECS query + topological 처리.

### 8.2 변경 감지 (dirty flag)

매 프레임 모든 transform 재계산은 비효율. dirty flag 또는 change detection (Bevy의 `Changed<T>` query) 활용:

```rust
fn propagate_transforms(
    changed: Query<(EntityId, &Transform), Changed<Transform>>,
    mut globals: Query<&mut GlobalTransform>,
    children: Query<&Children>,
) {
    // 변경된 노드와 그 자손만 재계산
}
```

---

## 9. 카메라와 투영

```rust
pub struct Camera {
    pub view: Mat4,
    pub projection: Projection,
}

pub enum Projection {
    Perspective { fov_y_radians: f32, aspect: f32, near: f32, far: f32 },
    Orthographic { left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32 },
}
```

규칙:
- **right-handed coordinate system** (OpenGL/Vulkan 표준; DirectX는 left-handed).
- **column-major matrix** (glam, GLSL 표준).
- 행렬 곱셈 순서: `view * projection * vertex` (vertex shader에서) — 일반적으로 `proj * view * model` 합쳐서 vertex에 곱.
- aspect는 `width / height` (가로 / 세로). resize 이벤트에서 갱신.

좌표계와 매트릭스 컨벤션은 한 번 정해서 엔진 전체에 일관되게. 여기서 흔들리면 모든 graphics 코드에 미친 버그가 생긴다.

---

## 10. 직렬화 / 세이브

### 10.1 serde 기반

```rust
#[derive(Serialize, Deserialize)]
pub struct SaveGame {
    pub version: u32,
    pub player: PlayerData,
    pub entities: Vec<EntitySnapshot>,
}
```

규칙:
- **버전 필드 필수**. 포맷 변경 시 마이그레이션 코드.
- **외부 타입 (handle, ID) 직렬화**: handle을 raw로 저장하지 말고 path 또는 stable ID로.
- **포맷 선택**: 사람이 읽을 (JSON, RON, YAML) vs 바이너리 (bincode, postcard, MessagePack). 게임 세이브는 보통 바이너리, 에디터 자산은 사람 읽을 수 있는 포맷.

### 10.2 entity 직렬화

ECS world 전체를 직렬화하는 건 까다로움 — handle이 다음 실행 때 다른 ID를 받기 때문. 보통:
- "prefab"으로 정의된 템플릿을 ID 안정성 있는 path로.
- 런타임 인스턴스는 prefab + override 쌍으로 저장.

Bevy는 `bevy_reflect`로 type-erased 직렬화 인프라 제공. 직접 구현은 노력 큼.

---

## 11. 핫리로드

자산 (텍스처, 셰이더, 스크립트) 파일 변경 감지 후 재로드:

```rust
pub struct HotReloader {
    watcher: notify::RecommendedWatcher,
    rx: Receiver<DebouncedEvent>,
}

fn poll_reloads(reloader: &HotReloader, assets: &mut AssetServer) {
    for event in reloader.rx.try_iter() {
        if let DebouncedEvent::Write(path) = event {
            assets.reload(&path);
        }
    }
}
```

핸들 기반 자산 시스템이면 핫리로드는 자연스러움 — 같은 핸들의 데이터를 교체하기만 하면 됨.

코드 핫리로드는 어려움. dynamic library (`libloading`) 또는 스크립트 언어 (Lua/Rhai/WASM 게스트) 임베드.

---

## 12. 에디터 / 디버그 도구

### 12.1 GUI

- **egui** — 가장 인기. immediate mode. 빠르게 디버그 패널 만들기 좋음.
- **iced** — retained mode, Elm-like.
- **dear imgui** — C++ 인기 라이브러리, Rust binding 있음. immediate mode.

게임엔진 디버그/에디터에는 **egui** 추천. 통합 쉬움 (`egui_winit`, `egui_wgpu`), 게임 ecosystem과 잘 맞음.

### 12.2 디버그 시각화

- 충돌 박스, 카메라 frustum, 경로 등 wireframe 그리는 시스템 분리.
- `cfg(debug_assertions)` 또는 feature flag로 release에서 빠지게.

```rust
#[cfg(debug_assertions)]
fn draw_debug_gizmos(world: &World, painter: &mut DebugPainter) { /* ... */ }
```

### 12.3 로깅

```rust
use log::{info, warn, error, debug, trace};

info!("loaded {} entities", count);
warn!("texture {} fallback to default", name);
```

`log` crate + `env_logger` 또는 `tracing` (구조화 로깅, span 지원). 게임엔진에서는 `tracing`이 점점 표준 — performance span을 그대로 프로파일러에 던질 수 있음 (`tracing-tracy`).

---

## 참고

- [Game Programming Patterns](https://gameprogrammingpatterns.com/) — 언어 중립적 게임 아키텍처 바이블.
- [Bevy Engine 소스](https://github.com/bevyengine/bevy) — Rust ECS 게임엔진의 사실상 표준.
- [Fix Your Timestep!](https://gafferongames.com/post/fix_your_timestep/) — 게임 루프 결정판.
- [Data-Oriented Design Book](https://www.dataorienteddesign.com/dodbook/) — Mike Acton의 DOD 사상, ECS와 직결.