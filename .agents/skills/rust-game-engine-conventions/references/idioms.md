# Rust Core Idioms (심화)

SKILL.md에서 요약한 관례의 **상세 예제와 근거**를 모은 파일이다. 특정 주제로 막히거나 사용자가 "왜 이렇게 짜야 하지?"를 물을 때 해당 절을 참조.

## 목차

1. 네이밍 심화
2. 에러 처리 패턴
3. 소유권 / 차용 — 일반적인 함정
4. Lifetime 가독성
5. Iterator 심화
6. 표준 trait 구현 가이드
7. `Option` / `Result` 메서드 사전
8. `match` vs `if let` vs `let else`

---

## 1. 네이밍 심화

### 1.1 모듈 경로와 stuttering

```rust
// ❌ stutter — 사용자가 game::game::Game::new()
mod game {
    pub mod game {
        pub struct Game { ... }
    }
}

// ✅ 모듈이 맥락 → 타입은 짧게
mod game {
    pub struct State { ... }   // 사용 시 game::State
}
```

규칙: 사용 시점에서 경로 + 타입명을 합쳐 봤을 때 같은 단어가 반복되지 않게.

### 1.2 약어 케이스

| 잘못         | 맞음                      | 이유                              |
| ------------ | ------------------------- | --------------------------------- |
| `HTTPClient` | `HttpClient`              | 약어 3+자는 한 단어 취급          |
| `parseJSON`  | `parse_json`              | 함수는 snake_case, JSON도 한 단어 |
| `IOError`    | `IoError`                 | 2자 약어도 한 단어 취급 (관례)    |
| `ID`         | `Id` (타입) / `id` (변수) |                                   |

### 1.3 동사 / 명사 구분

- 메서드 이름: 동사로 시작 (`spawn`, `update`, `find_by_id`).
- getter는 명사 그대로 (`fn name(&self) -> &str`).
- mutating method는 명령형 (`push`, `insert`, `clear`).
- 변환은 `to_*` (참조→소유 사본), `into_*` (소유 변환), `as_*` (참조→참조 변환):

```rust
let s: String = "hi".to_string();        // borrowed → new owned
let bytes: Vec<u8> = s.into_bytes();     // owned → owned (consume)
let slice: &str = s.as_str();            // owned → borrowed view
```

### 1.4 boolean 메서드

`is_*`, `has_*`, `can_*`, `should_*` 접두사. 부정형은 피하고 (`not_empty()` 보다 `is_empty()` 쓰고 `!`로 부정).

---

## 2. 에러 처리 패턴

### 2.1 thiserror로 라이브러리 에러

```rust
use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum AssetError {
    #[error("asset not found: {path}")]
    NotFound { path: PathBuf },

    #[error("unsupported format: {extension}")]
    UnsupportedFormat { extension: String },

    #[error("io error reading {path}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("decode failed")]
    Decode(#[from] image::ImageError),
}
```

핵심:
- 변형(variant)마다 명확한 에러 메시지 (`#[error("...")]`).
- 외부 에러를 감쌀 때 `#[from]`으로 자동 변환 (한 변형당 하나만).
- 부가 정보 (path, line number)를 변형에 담아서 사용자가 분기 가능하게.
- `source` 체인은 `#[source]` 또는 `#[from]`으로 보존.

### 2.2 anyhow로 앱 에러

```rust
use anyhow::{Context, Result};

fn load_config() -> Result<Config> {
    let raw = std::fs::read_to_string("config.toml")
        .context("reading config.toml")?;
    let config: Config = toml::from_str(&raw)
        .context("parsing config.toml")?;
    Ok(config)
}
```

`.context(...)`로 호출 체인을 누적시키면 사용자에게 의미 있는 메시지가 만들어진다:

```
Error: reading config.toml

Caused by:
    No such file or directory (os error 2)
```

### 2.3 `?`의 자동 변환

`?`는 `From` 구현을 통해 에러를 자동 변환한다:

```rust
fn load(path: &Path) -> Result<Asset, AssetError> {
    let bytes = std::fs::read(path)?;  // io::Error → AssetError (via #[from])
    let asset = decode(&bytes)?;       // ImageError → AssetError
    Ok(asset)
}
```

복잡해지면 `.map_err(...)`로 명시적 변환:

```rust
let parsed = serde_json::from_slice(&bytes)
    .map_err(|e| AssetError::Decode(format!("json: {e}")))?;
```

### 2.4 `unwrap()` / `expect()`의 정당한 사용

- **테스트**: `let x = some_op().unwrap();` 자유롭게.
- **빌드 타임 보장**: `let regex = Regex::new(r"...").expect("invalid regex literal");` (literal regex가 잘못됐다면 컴파일 후 즉시 발견됨)
- **방금 검증한 invariant**:
  ```rust
  if v.is_empty() { return None; }
  let first = v.first().expect("non-empty checked above");
  ```

`unwrap()`보다 `expect("이유")`를 선호. panic 메시지가 디버깅에 도움된다.

### 2.5 `Result`를 `Option`으로 / 반대

```rust
let opt: Option<u32> = result.ok();              // Result → Option (에러 버림)
let opt2: Option<u32> = result.err();            // 반대로 에러를 Option으로
let res: Result<u32, MyErr> = opt.ok_or(MyErr::NotFound);
let res2: Result<u32, MyErr> = opt.ok_or_else(|| MyErr::NotFound);  // lazy
```

`ok_or_else`는 에러 생성 비용이 있을 때 (`.context()` 등).

---

## 3. 소유권 / 차용 — 일반적인 함정

### 3.1 함수 인자 — 가장 싼 참조

```rust
// ❌
fn print_name(name: &String) { println!("{}", name); }

// ✅
fn print_name(name: &str) { println!("{}", name); }
```

`&String`은 `String`만 받지만 `&str`은 `String`, `&str`, `&'static str` 다 받는다 (deref coercion).

같은 원리로:
- `&Vec<T>` → `&[T]`
- `&PathBuf` → `&Path`
- `&Box<T>` → `&T`

### 3.2 반환 — 보통 owned

함수가 새로 만든 값을 반환할 때는 owned 타입:

```rust
fn make_greeting(name: &str) -> String {       // ✅
    format!("Hello, {name}")
}

fn make_greeting<'a>(name: &'a str) -> &'a str {  // ❌ 거의 불가능
    ...
}
```

내부 데이터의 view를 반환할 때만 lifetime 도입:

```rust
impl Game {
    pub fn player_name(&self) -> &str {  // self의 lifetime 자동 추론 (elision)
        &self.player.name
    }
}
```

### 3.3 두 값을 동시에 빌릴 때

가변 빌림 두 개가 충돌하면 split borrow 또는 `split_at_mut`:

```rust
// ❌ 컴파일 에러
let a = &mut vec[0];
let b = &mut vec[1];

// ✅ split_at_mut
let (left, right) = vec.split_at_mut(1);
let a = &mut left[0];
let b = &mut right[0];

// ✅ struct field-level borrow는 자동 분해됨
struct Two { a: i32, b: i32 }
let mut t = Two { a: 1, b: 2 };
let pa = &mut t.a;
let pb = &mut t.b;  // OK — 다른 필드
```

### 3.4 `clone()` 검토 체크리스트

`.clone()`을 추가하기 전에:

1. 이 함수가 진짜로 별개 사본이 필요한가, 아니면 잠깐 빌리면 되는가?
2. `Rc` / `Arc`로 공유하면 안 되는가?
3. 호출자가 두 번 쓰는 거면 호출자가 clone하게 하는 게 맞지 않은가?
4. 데이터 흐름 자체가 불필요하게 sharing을 요구하는 건 아닌가?

가끔은 그냥 clone이 정답이다. 하지만 자동 반사로 박지 말고 1초만 멈춰서 점검.

### 3.5 `Cow<str>`로 양다리

```rust
use std::borrow::Cow;

fn normalize(s: &str) -> Cow<str> {
    if s.contains(' ') {
        Cow::Owned(s.replace(' ', "_"))   // 변환 필요 → 새 String
    } else {
        Cow::Borrowed(s)                  // 그대로 → allocation 없음
    }
}
```

대부분 입력이 그대로 통과하고 일부만 변환되는 경우 `Cow`가 유용. 게임엔진의 asset path normalization, identifier sanitization 같은 곳.

---

## 4. Lifetime 가독성

### 4.1 Elision이 가능하면 생략

```rust
// ❌ 불필요
fn first<'a>(s: &'a str) -> &'a str { &s[0..1] }

// ✅ elision으로 충분
fn first(s: &str) -> &str { &s[0..1] }
```

elision 규칙:
1. 입력 참조마다 별개 lifetime 부여.
2. 입력이 정확히 하나면 그 lifetime이 모든 출력에 적용.
3. `&self` / `&mut self`가 있으면 self의 lifetime이 모든 출력에 적용.

이 셋으로 안 풀리면 명시.

### 4.2 명시할 때는 의미있는 이름

```rust
// ❌ 추적 어려움
struct Renderer<'a, 'b> {
    device: &'a Device,
    queue: &'b Queue,
}

// ✅ 같은 lifetime이면 하나로
struct Renderer<'gpu> {
    device: &'gpu Device,
    queue: &'gpu Queue,
}
```

다른 lifetime을 의미할 때만 분리. 의미 없는 `'a, 'b`보다 `'frame`, `'world` 같은 이름이 추적하기 쉽다.

### 4.3 `'static`의 함정

`'static`은 "프로그램 끝까지 산다"가 아니라 "그렇게 살 수 있다"의 의미. `T: 'static`은 `T`가 빌린 참조를 갖지 않는다는 뜻 — 정의상 owned이거나 `&'static T`.

게임엔진에서 thread spawn 시 `Send + 'static`이 흔히 나오는데, 이는 데이터가 다른 스레드로 옮겨가면서 무한히 살아남을 수 있어야 한다는 의미.

---

## 5. Iterator 심화

### 5.1 lazy evaluation

iterator는 `.next()`가 호출되기 전까지 아무것도 안 한다:

```rust
let it = (0..1_000_000).map(|x| { println!("{x}"); x * 2 });
// 여기까지 출력 0개

let first_three: Vec<_> = it.take(3).collect();
// 0, 1, 2 만 출력
```

그래서 `.collect()`로 끝까지 흘릴 때 비용이 발생. `.take()`, `.find()`, `.any()` 같은 short-circuit으로 일부만 흘리는 게 자주 정답.

### 5.2 `collect::<Vec<_>>()` 외 형태

```rust
let map: HashMap<u32, &Entity> = entities.iter().map(|e| (e.id, e)).collect();
let set: HashSet<EntityId> = ids.iter().copied().collect();
let s: String = words.iter().copied().collect::<Vec<_>>().join(" ");
let tuple: (Vec<_>, Vec<_>) = numbers.iter().partition(|&&n| n > 0);
let result: Result<Vec<_>, _> = items.iter().map(|i| parse(i)).collect();
```

`collect`는 `FromIterator` trait에 의존하므로 받는 타입이 다양. `Result<Vec, _>`로 collect하면 첫 에러에서 short-circuit.

### 5.3 자주 쓰이는 조합

```rust
// 인덱스가 필요한 변환
items.iter().enumerate().map(|(i, item)| ...)

// 두 컬렉션 동시 순회
keys.iter().zip(values.iter()).for_each(|(k, v)| ...)

// 누적 합
nums.iter().fold(0, |acc, x| acc + x)
nums.iter().sum::<i32>()  // 더 짧음

// 그룹화 (itertools)
use itertools::Itertools;
items.iter().group_by(|i| i.category)
    .into_iter()
    .for_each(|(key, group)| ...)

// 평탄화
nested.iter().flat_map(|inner| inner.iter())

// 처음/마지막
items.iter().next()         // first
items.iter().last()         // last (전체 순회 — slice면 .last() 직접)
items.iter().rev().next()   // 역순 첫 = 마지막
```

### 5.4 사용자 정의 Iterator

```rust
struct EntityIter<'a> {
    entities: &'a [Entity],
    index: usize,
}

impl<'a> Iterator for EntityIter<'a> {
    type Item = &'a Entity;
    fn next(&mut self) -> Option<Self::Item> {
        let item = self.entities.get(self.index)?;
        self.index += 1;
        Some(item)
    }
}
```

대부분 `.iter()`, `.iter_mut()`로 충분하지만, 필터링 + 페이지네이션 + 캐시 등 복잡한 cursor 로직은 별도 iterator 타입이 깔끔.

---

## 6. 표준 trait 구현 가이드

### 6.1 `Default`

"비어있음" 또는 "초기상태"가 자연스러우면:

```rust
#[derive(Default)]
pub struct Config {
    pub vsync: bool,           // false
    pub max_fps: Option<u32>,  // None
    pub volume: f32,           // 0.0
}
```

값을 0이 아닌 기본값으로 두려면 직접 구현:

```rust
impl Default for Config {
    fn default() -> Self {
        Self { vsync: true, max_fps: Some(60), volume: 0.5 }
    }
}
```

`Default`가 의미 없는 타입 (예: 반드시 명시적 인자 필요)에는 derive하지 마. 강제로 Default 만들면 사용자가 `Config::default()`로 만들고 잊어먹을 수 있다.

### 6.2 `Debug` 직접 구현

derive로 충분하지 않을 때 (예: 큰 buffer를 요약하고 싶음):

```rust
impl std::fmt::Debug for VertexBuffer {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        f.debug_struct("VertexBuffer")
            .field("len", &self.vertices.len())
            .field("usage", &self.usage)
            .finish()
    }
}
```

### 6.3 `Display` vs `Debug`

- `Debug` (`{:?}`): 개발자 / 로그용. 디버깅 정보 풍부.
- `Display` (`{}`): 사용자에게 보여줄 때. 깔끔.

에러 타입은 `Display`도 구현 (thiserror가 자동으로 함). 일반 데이터 타입은 `Debug`만 보통 충분.

### 6.4 `PartialEq` / `Eq` / `Hash`

- `PartialEq` derive — 모든 필드가 `PartialEq`이면 OK.
- `Eq`는 reflexive equality (`x == x`가 항상 참) — `f32`/`f64`는 NaN 때문에 `Eq` 불가.
- `Hash`는 `Eq`와 일관되어야 함 — 두 값이 `==`이면 hash도 같아야.

NaN 가능한 float 필드가 있는 타입에 `Eq` derive하면 컴파일 에러. fixed-point newtype 또는 `OrderedFloat`로 우회하거나 `Eq`를 포기.

---

## 7. `Option` / `Result` 메서드 사전

자주 쓰는 메서드 (외울 가치 있음):

| 메서드                             | 의미                                        |
| ---------------------------------- | ------------------------------------------- |
| `Option::map(f)`                   | `Some(x) → Some(f(x))`, `None → None`       |
| `Option::and_then(f)`              | flatMap. `Some(x) → f(x)` (f가 Option 반환) |
| `Option::unwrap_or(default)`       | `None`이면 default                          |
| `Option::unwrap_or_else(\|\| ...)` | lazy default                                |
| `Option::ok_or(err)`               | `Option<T> → Result<T, E>`                  |
| `Option::filter(\|x\| ...)`        | predicate 안 맞으면 None                    |
| `Option::take()`                   | Option에서 값 꺼내고 `None`으로 만듦        |
| `Option::replace(v)`               | 새 값으로 바꾸고 이전 값 반환               |
| `Result::map(f)`                   | Ok값에만 적용                               |
| `Result::map_err(f)`               | Err값 변환                                  |
| `Result::and_then(f)`              | flatMap, chain                              |
| `Result::ok()`                     | `Result<T, E> → Option<T>`                  |

체이닝 예:

```rust
let port = std::env::var("PORT").ok()
    .and_then(|s| s.parse::<u16>().ok())
    .filter(|&p| p > 1024)
    .unwrap_or(8080);
```

---

## 8. `match` vs `if let` vs `let else`

```rust
// 한 변형만 처리
if let Some(value) = optional {
    use_value(value);
}

// 한 변형이면 진행, 아니면 조기 반환 — let else
let Some(value) = optional else {
    return Err(MyError::Missing);
};
use_value(value);  // 이후에 value 그대로 사용 가능

// 모든 변형 처리해야 할 때
match result {
    Ok(value) => process(value),
    Err(MyError::NotFound) => log_warn(),
    Err(other) => return Err(other),
}
```

`let else`는 빠른 조기 반환을 깔끔하게 — 들여쓰기 줄이는 데 유용. Rust 1.65부터.

---

## 참고

- [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- [Rust by Example](https://doc.rust-lang.org/rust-by-example/) — 기초 idiom 모음
- [Rust Patterns](https://rust-unofficial.github.io/patterns/) — design pattern 카탈로그