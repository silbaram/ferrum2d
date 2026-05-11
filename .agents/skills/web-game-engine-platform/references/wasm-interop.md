# Wasm Interop 심화

Rust/Wasm ↔ TypeScript 경계의 구체적인 패턴들. SKILL.md §2의 결정 기준을 코드와 함정 사례로 풀어둔다.

## 목차

1. ptr / len 데이터 전달
2. 메모리 grow와 detach 처리
3. Input buffer — TS → Rust
4. Render command buffer — Rust → TS
5. Audio event buffer — Rust → TS
6. Generation handle — ABA 방지
7. wasm-bindgen vs raw ABI — 결정 기준
8. 모듈 로드 라이프사이클
9. 디버깅 함정

---

## 1. ptr / len 데이터 전달

### 1.1 Rust 측 노출

```rust
#[wasm_bindgen]
pub struct Engine {
    render_commands: Vec<SpriteRenderCommand>,
    input_state: InputState,
    audio_events: Vec<AudioEvent>,
}

#[wasm_bindgen]
impl Engine {
    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand {
        self.render_commands.as_ptr()
    }
    pub fn render_command_len(&self) -> usize {
        self.render_commands.len()
    }
    pub fn input_state_ptr(&mut self) -> *mut InputState {
        &mut self.input_state as *mut _
    }
    // 빌드 타임에 검증된 사이즈를 런타임에도 노출
    pub fn sprite_command_size_bytes(&self) -> usize {
        std::mem::size_of::<SpriteRenderCommand>()
    }
}
```

`*const T`는 wasm-bindgen 관점에서 `number` (offset)로 변환됨. JS는 이것을 Wasm linear memory의 byte offset으로 받는다.

### 1.2 TS 측 view 생성

```ts
// 매 프레임
const ptr = engine.render_command_ptr();
const len = engine.render_command_len();
const FIELDS = 12;  // size_of(SpriteRenderCommand) / 4

// 시작 offset과 element 수를 받음 (byte 수 아님)
const view = new Float32Array(wasmMemory.buffer, ptr, len * FIELDS);

renderer.consume(view, len);
```

**중요**: `Float32Array` 생성자의 세 번째 인자는 **element 수**, byte 수가 아니다. `Uint8Array`로 만들면 byte 수로 받는다.

### 1.3 mixed types — Float32Array + Uint32Array

`SpriteRenderCommand`에 `texture_id: u32`와 `x: f32`가 섞여 있으면, 둘 다 `Float32Array`로 보면 `texture_id` 비트가 float로 잘못 해석된다. 두 view를 같은 buffer에 만들어 인덱스로 골라 읽기:

```ts
const f32 = new Float32Array(wasmMemory.buffer, ptr, len * FIELDS);
const u32 = new Uint32Array(wasmMemory.buffer, ptr, len * FIELDS);

for (let i = 0; i < len; i++) {
  const base = i * FIELDS;
  const textureId = u32[base + 0];        // u32 필드
  const x = f32[base + 1];                // f32 필드
  const y = f32[base + 2];
  // ...
}
```

또는 `DataView`로 byte offset 수동 관리 — 명확하지만 코드량 증가.

---

## 2. 메모리 grow와 detach 처리

### 2.1 grow가 발생하는 자리

Wasm linear memory는 `Vec::push`가 capacity를 초과하거나 `Box::new`, `String::from` 등에서 동적 할당이 늘 때 grow한다. grow가 일어나면 `WebAssembly.Memory.buffer`가 **새 ArrayBuffer**로 교체되고, **이전 buffer를 참조하던 모든 TypedArray view는 detach** — 접근 시 `TypeError: Cannot perform %TypedArray%.prototype.length on a detached ArrayBuffer`.

### 2.2 안전한 패턴 — 매 프레임 view 새로 만들기

```ts
class WasmBridge {
  private wasm: InitOutput;

  // ❌ 멤버로 보관 — grow되면 detach
  // private renderView: Float32Array;

  readRenderCommands(engine: Engine): { view: Float32Array; len: number } {
    // ✅ 매 호출마다 fresh view
    const ptr = engine.render_command_ptr();
    const len = engine.render_command_len();
    return {
      view: new Float32Array(this.wasm.memory.buffer, ptr, len * FIELDS),
      len,
    };
  }
}
```

view 생성 자체는 매우 싸다 — header 객체만 만들고 underlying buffer는 공유. 매 프레임 새로 만들어도 보통 측정 불가.

### 2.3 grow 빈도 줄이기 — Rust 측 처리

`Vec::with_capacity` 사전 할당으로 push 시 grow 회피:

```rust
impl Engine {
    pub fn new() -> Self {
        Self {
            render_commands: Vec::with_capacity(4096),
            audio_events: Vec::with_capacity(64),
            // ...
        }
    }
}
```

매 프레임 `Vec::clear()` 후 다시 push — capacity 유지되므로 안정 상태에서 grow 0회.

### 2.4 grow 감지가 필요한 자리

view를 굳이 멤버로 보관해야 하는 드문 경우 (예: 워커로 보낼 메시지 준비), `WebAssembly.Memory`는 `grow` 이벤트가 없으므로 buffer identity를 비교:

```ts
class StaticBufferAccess {
  private cachedBuffer: ArrayBuffer | null = null;
  private cachedView: Float32Array | null = null;

  view(ptr: number, len: number): Float32Array {
    if (this.cachedBuffer !== this.wasm.memory.buffer || this.cachedView === null) {
      this.cachedBuffer = this.wasm.memory.buffer;
      this.cachedView = new Float32Array(this.wasm.memory.buffer);
    }
    return this.cachedView.subarray(ptr / 4, ptr / 4 + len);
  }
}
```

`subarray`는 같은 buffer의 다른 region view — 또 다른 fresh 객체지만 buffer는 공유. 보통 매 프레임 직접 생성보다 더 복잡한데 이득이 거의 없으니, **기본은 매 프레임 새로 만드는 것**.

---

## 3. Input buffer — TS → Rust

### 3.1 Rust 측 InputState

```rust
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct InputState {
    // 키 — 1이면 눌림, 0이면 떼짐 (boolean을 u32로 — 정렬/패딩 단순)
    pub key_w: u32,
    pub key_a: u32,
    pub key_s: u32,
    pub key_d: u32,
    pub key_space: u32,

    // 마우스
    pub mouse_x: f32,
    pub mouse_y: f32,
    pub mouse_buttons: u32,  // 비트마스크 (LMB=0x1, RMB=0x2, MMB=0x4)
}

const _: () = assert!(std::mem::size_of::<InputState>() == 32);
```

`bool`을 직접 쓰지 말고 `u32` — `repr(C)`에서 `bool` 크기는 1바이트지만 정렬 때문에 패딩이 끼어 카운트가 어렵다. `u32`로 통일하면 모든 필드 4바이트 align로 단순.

### 3.2 TS 측 쓰기

```ts
class WasmBridge {
  writeInput(snapshot: InputSnapshot, engine: Engine): void {
    const ptr = engine.input_state_ptr();
    const u32 = new Uint32Array(this.wasm.memory.buffer, ptr, 8);
    const f32 = new Float32Array(this.wasm.memory.buffer, ptr, 8);

    u32[0] = snapshot.keys.has("KeyW") ? 1 : 0;
    u32[1] = snapshot.keys.has("KeyA") ? 1 : 0;
    u32[2] = snapshot.keys.has("KeyS") ? 1 : 0;
    u32[3] = snapshot.keys.has("KeyD") ? 1 : 0;
    u32[4] = snapshot.keys.has("Space") ? 1 : 0;
    f32[5] = snapshot.mouseX;
    f32[6] = snapshot.mouseY;
    u32[7] = snapshot.mouseButtons;
  }
}
```

키 인덱스를 양쪽에서 일치시키는 게 손이 갈 수 있다. 대안:

### 3.3 비트마스크로 키 압축

키 16개 이하면 `u32` 비트마스크 하나로 충분:

```rust
#[repr(C)]
pub struct InputState {
    pub keys: u32,           // 비트마스크
    pub mouse_x: f32,
    pub mouse_y: f32,
    pub mouse_buttons: u32,
}
```

```ts
const KEY_BITS: Record<string, number> = {
  KeyW: 1 << 0, KeyA: 1 << 1, KeyS: 1 << 2, KeyD: 1 << 3, Space: 1 << 4,
};

let keysBits = 0;
for (const code of snapshot.keys) {
  keysBits |= KEY_BITS[code] ?? 0;
}
u32[0] = keysBits;
```

키 매핑이 한 곳에 모임 — 추가/변경 쉬움.

---

## 4. Render command buffer — Rust → TS

### 4.1 명령 layout 결정

```rust
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SpriteRenderCommand {
    pub texture_id: u32,    // 0
    pub x: f32,             // 4
    pub y: f32,             // 8
    pub rotation: f32,      // 12
    pub scale_x: f32,       // 16
    pub scale_y: f32,       // 20
    pub src_x: f32,         // 24
    pub src_y: f32,         // 28
    pub src_w: f32,         // 32
    pub src_h: f32,         // 36
    pub color: u32,         // 40 (RGBA8 packed)
    pub layer: i32,         // 44
}
const _: () = assert!(std::mem::size_of::<SpriteRenderCommand>() == 48);
```

규칙:
- 모든 필드 4바이트 (`u32` / `f32` / `i32`) — 자연 정렬, 패딩 X.
- 하나라도 8바이트 (`f64`, `u64`)가 끼면 정렬 끼어듦, 검증 어려워짐.
- `color`는 packed `u32` — 4 × `f32` (16바이트) 보다 4배 압축.

### 4.2 Rust 측 build

```rust
impl Engine {
    pub fn update(&mut self, delta: f32) {
        self.world.update(delta);
        self.build_render_commands();
    }

    fn build_render_commands(&mut self) {
        self.render_commands.clear();  // capacity 유지
        // layer 정렬은 여기서 — TS sort는 비싸다 (boundary cost)
        let mut entries: Vec<&Sprite> = self.world.sprites().collect();
        entries.sort_by(|a, b| a.layer.cmp(&b.layer).then_with(|| a.texture_id.cmp(&b.texture_id)));
        for sprite in entries {
            self.render_commands.push(SpriteRenderCommand {
                texture_id: sprite.texture_id,
                x: sprite.transform.x,
                // ...
            });
        }
    }
}
```

**정렬은 Rust 안에서.** TS가 정렬하면 view를 sort 가능한 형태로 변환해야 하고 (TypedArray.sort는 element 단위지 record 단위가 아니다), boundary cost를 두 번 더 치른다.

### 4.3 TS 측 consume

```ts
class WebGL2Renderer {
  consume(view: Float32Array, count: number): void {
    const u32 = new Uint32Array(view.buffer, view.byteOffset, view.length);

    let curTex = -1;
    let batchStart = 0;

    for (let i = 0; i < count; i++) {
      const base = i * FIELDS_PER_CMD;
      const textureId = u32[base + 0];
      if (textureId !== curTex) {
        if (curTex !== -1) this.flushBatch(view, u32, batchStart, i);
        curTex = textureId;
        batchStart = i;
      }
    }
    if (curTex !== -1) this.flushBatch(view, u32, batchStart, count);
  }

  private flushBatch(f32: Float32Array, u32: Uint32Array, start: number, end: number): void {
    // staging buffer에 vertex 데이터 채움, bufferSubData, drawElements
    // (상세는 references/webgl2-renderer.md)
  }
}
```

---

## 5. Audio event buffer — Rust → TS

```rust
#[repr(C)]
#[derive(Clone, Copy)]
pub struct AudioEvent {
    pub sound_id: u32,
    pub volume: f32,
    pub pitch: f32,
    pub flags: u32,         // 1=looping, 2=stop_existing, ...
}
const _: () = assert!(std::mem::size_of::<AudioEvent>() == 16);
```

```ts
class AudioManager {
  dispatch(view: Float32Array, count: number): void {
    const u32 = new Uint32Array(view.buffer, view.byteOffset, view.length);
    const FIELDS = 4;
    for (let i = 0; i < count; i++) {
      const base = i * FIELDS;
      const soundId = u32[base + 0];
      const volume = view[base + 1];
      const pitch = view[base + 2];
      const flags = u32[base + 3];
      this.play(soundId, volume, pitch, flags);
    }
  }
}
```

### 5.1 Rust 측이 buffer를 비우는 시점

```rust
pub fn clear_events(&mut self) {
    self.audio_events.clear();
    // render_commands는 매 update 시작에 clear되므로 여기서 X
}
```

TS가 dispatch한 후 `engine.clear_events()` 호출. 안 비우면 다음 프레임에 사운드 재생 중복.

---

## 6. Generation handle — ABA 방지

엔티티/자산 ID를 raw `u32`로 쓰면, entity가 죽고 같은 ID가 새 entity에 재할당된 뒤 옛 reference로 접근하는 ABA 버그 발생. generation으로 방어:

```rust
#[repr(C)]
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct EntityHandle {
    pub index: u32,
    pub generation: u32,
}
```

자료구조:

```rust
pub struct EntityStore {
    slots: Vec<Slot>,
    free_list: Vec<u32>,
}

struct Slot {
    generation: u32,
    alive: bool,
    // ...
}

impl EntityStore {
    pub fn get(&self, handle: EntityHandle) -> Option<&Slot> {
        let slot = self.slots.get(handle.index as usize)?;
        if slot.alive && slot.generation == handle.generation { Some(slot) } else { None }
    }
    pub fn destroy(&mut self, handle: EntityHandle) {
        if let Some(slot) = self.slots.get_mut(handle.index as usize) {
            if slot.generation == handle.generation {
                slot.alive = false;
                slot.generation = slot.generation.wrapping_add(1);
                self.free_list.push(handle.index);
            }
        }
    }
}
```

TS 측은 보통 raw 핸들만 들고 다님 — ID로 다시 query할 때 stale 검출이 자동.

---

## 7. wasm-bindgen vs raw ABI — 결정 기준

### 7.1 wasm-bindgen이 적합한 경우

- 한 번 호출되는 init / load_scene / load_assets.
- String, Vec<String>, JsValue 같은 풍부한 타입이 자연스러운 자리.
- 디버그 / 개발 도구 — 핫패스 아님.

```rust
#[wasm_bindgen]
impl Engine {
    pub fn load_scene(&mut self, name: &str) -> Result<(), JsValue> {
        // String 인자 자동 변환
    }
    pub fn debug_dump(&self) -> JsValue {
        // 임의 JSON 자동 변환
    }
}
```

### 7.2 raw ptr/len이 적합한 경우

- 매 프레임 호출 (`update`, `read_commands`).
- 큰 배열 / struct 묶음 전달.
- 측정으로 확인된 핫패스.

```rust
#[wasm_bindgen]
impl Engine {
    pub fn update(&mut self, delta: f32) { /* ... */ }
    pub fn render_command_ptr(&self) -> *const SpriteRenderCommand { /* ... */ }
}
```

### 7.3 변환 비용 — 직관

| 호출                                     | 비용                                |
| ---------------------------------------- | ----------------------------------- |
| `engine.update(delta)` (`f32` 1개)       | 매우 낮음                           |
| `engine.render_command_ptr()`            | 매우 낮음 (정수 반환)               |
| `engine.do_thing("name")` (`&str`)       | 낮음 — UTF-8 검증, 메모리 복사      |
| `engine.do_thing(jsObject)` (`JsValue`)  | 중간 — JS 객체 조작                 |
| `engine.entities()` (`Vec<Entity>` 반환) | **높음** — 모든 element marshalling |

마지막은 핫패스에서 절대 피해야 할 패턴. raw ptr/len으로 전환.

---

## 8. 모듈 로드 라이프사이클

```ts
import init, { Engine, type InitOutput } from "../wasm/pkg/engine_core.js";

let wasm: InitOutput | null = null;

export async function loadWasm(): Promise<InitOutput> {
  if (wasm) return wasm;
  wasm = await init();
  return wasm;
}

export function wasmMemory(): WebAssembly.Memory {
  if (!wasm) throw new Error("Wasm not loaded — call loadWasm() first");
  return wasm.memory;
}
```

**`init()`은 한 번만.** 두 번 호출해도 cached promise 반환되도록 module-level singleton. `--target web`은 `init(url?)`로 wasm 파일 URL을 받음 — 명시 안 하면 `engine_core_bg.wasm` 상대 경로 사용.

### 8.1 Custom URL — Vite 빌드와 통합

```ts
import wasmUrl from "../wasm/pkg/engine_core_bg.wasm?url";
import init from "../wasm/pkg/engine_core.js";

await init(wasmUrl);
```

Vite의 `?url` import로 빌드 시 fingerprinted 파일명을 받음. CDN 배포 호환.

### 8.2 Worker에서 로드

OffscreenCanvas를 워커에서 쓰려면 워커 안에서 init을 해야 함 — 메인스레드의 wasm instance를 공유 못함 (각 워커는 독립 Wasm instance). 같은 모듈을 두 번 컴파일하는 비용 있음 (보통 무시 가능).

---

## 9. 디버깅 함정

### 9.1 ptr가 0

`Vec::with_capacity(0)` 또는 `Vec::new()` 후 push가 없으면 ptr = 0 ("dangling pointer for empty Vec"). 빈 Vec에 대한 view는 zero-length지만 `new Float32Array(buffer, 0, 0)`는 valid — 그래서 보통 문제 없음. 하지만 `view[0]`을 무심코 접근하면 다른 데이터를 읽음.

가드:

```ts
if (len === 0) return;
```

### 9.2 size mismatch — silent corruption

Rust struct에 필드를 추가했는데 TS의 `FIELDS_PER_CMD` 상수를 안 고치면, 다음 명령부터 데이터가 한 칸씩 밀려 읽힘. 스프라이트가 "거의 맞지만 미묘하게 이상한" 위치에 그려진다.

방어: init에서 size 검증 (위 §1.1, SKILL.md §2.3) — 첫 프레임에 즉시 발견.

### 9.3 endianness

Wasm은 항상 little-endian. JS의 `TypedArray`도 host endian (현실적으로 모든 데스크톱/모바일 little-endian). big-endian 머신은 무시 가능. `DataView`의 `getInt32(offset)`은 기본 big-endian이므로 `getInt32(offset, true)` (littleEndian = true) 명시 — 안 그러면 모든 정수가 거꾸로.

### 9.4 detached buffer 에러

```
TypeError: Cannot perform %TypedArray%.prototype.length on a detached ArrayBuffer
```

→ view를 멤버로 보관했고, Wasm memory가 grow됐다. 매 프레임 새로 만드는 패턴으로 전환.

### 9.5 Wasm grow 디버깅

크롬 DevTools → Memory → "Wasm memory" — grow 이벤트 / 사용량 확인. Rust 측 `console::log_1` 또는 `log` crate + `console_log` adapter로 capacity 변화 추적:

```rust
log::info!("render_commands capacity = {}", self.render_commands.capacity());
```

---

## 참고

- [`wasm-bindgen` Guide](https://rustwasm.github.io/docs/wasm-bindgen/) — 공식 문서.
- [`wasm-bindgen` Reference: ABI](https://rustwasm.github.io/wasm-bindgen/contributing/design/describe.html) — marshalling 비용 이해.
- [Rust and WebAssembly Book](https://rustwasm.github.io/docs/book/) — Conway's Game of Life 튜토리얼이 ptr/len 패턴의 표준 예제.
- [WebAssembly.Memory](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory) — grow / buffer 동작.