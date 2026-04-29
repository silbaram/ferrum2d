# TypeScript 패턴 (엔진 레이어 특화)

`typescript` 스킬이 일반 TS를 다룬다. 이 파일은 **웹 게임엔진 플랫폼 레이어에서 자주 등장하는** TS idiom만 모은다.

## 목차

1. Branded type — 컴파일 타임 ID 분리
2. `as const` 배열 → union 타입
3. Discriminated union — 명령 / 이벤트
4. Factory 패턴 — 비동기 init
5. 리소스 핸들 + Disposable 패턴
6. Wasm 모듈 타입 활용
7. 모듈 export 전략 — public API surface
8. 에러 처리 — 타입화된 결과
9. Strict tsconfig 권장
10. 흔한 실수 — `any` / `as` / `enum`

---

## 1. Branded type — 컴파일 타임 ID 분리

```ts
type TextureId = number & { readonly __brand: "TextureId" };
type SoundId = number & { readonly __brand: "SoundId" };
type SceneId = number & { readonly __brand: "SceneId" };
type EntityHandle = number & { readonly __brand: "EntityHandle" };

// 생성자 헬퍼
const TextureId = (n: number): TextureId => n as TextureId;
const SoundId = (n: number): SoundId => n as SoundId;
```

런타임에는 그냥 `number`. 타입 시스템에만 보이는 brand. Rust newtype의 짝.

사용:

```ts
function drawSprite(tex: TextureId, x: number, y: number): void { /* ... */ }

const playerTex: TextureId = textureManager.idOf("player");
const shootSnd: SoundId = audioManager.idOf("shoot");

drawSprite(playerTex, 100, 200);  // OK
drawSprite(shootSnd, 100, 200);   // ❌ Type error — SoundId is not TextureId
drawSprite(42, 100, 200);         // ❌ Type error — number is not TextureId
```

raw `number`로 ID가 떠다니면 함수 인자 순서 / 종류 혼동이 생긴다. brand로 차단.

### 1.1 brand 변형 — symbol

```ts
declare const TextureIdBrand: unique symbol;
type TextureId = number & { [TextureIdBrand]: true };
```

string brand보다 충돌 가능성 더 낮음. 단, `unique symbol`은 `declare`로만 가능 — 약간 verbose.

string brand로 충분. 두 라이브러리가 같은 brand 문자열을 쓸 확률은 실질 0.

---

## 2. `as const` 배열 → union 타입

```ts
const RENDERER_TYPES = ["webgl2", "webgpu"] as const;
type RendererType = typeof RENDERER_TYPES[number];  // "webgl2" | "webgpu"

// 런타임 검증과 타입을 한 곳에서
function isRendererType(s: string): s is RendererType {
  return (RENDERER_TYPES as readonly string[]).includes(s);
}
```

런타임 값과 타입이 **single source**. enum과 비교:

```ts
// ❌ TS enum
enum RendererType { WebGL2 = "webgl2", WebGPU = "webgpu" }
// - 런타임 객체 생성 (tree-shake 어려움)
// - import 비용 — enum은 가져오면 통째로 들어옴
// - reverse mapping (numeric enum) 등 의도치 않은 동작
```

`enum` 사용 지양. const 배열 또는 union literal type이 정답.

### 2.1 키-값 매핑

```ts
const KEY_TO_BIT = {
  KeyW: 1 << 0,
  KeyA: 1 << 1,
  KeyS: 1 << 2,
  KeyD: 1 << 3,
  Space: 1 << 4,
} as const satisfies Record<string, number>;

type GameKey = keyof typeof KEY_TO_BIT;  // "KeyW" | "KeyA" | ...
```

`as const satisfies T` (TS 4.9+) — 타입 체크는 수행하되 타입은 좁히지 않음. 정확한 literal 타입 유지.

---

## 3. Discriminated union — 명령 / 이벤트

```ts
type GameEvent =
  | { type: "score"; value: number }
  | { type: "playerDied" }
  | { type: "sceneChange"; to: SceneId }
  | { type: "achievement"; id: string; tier: 1 | 2 | 3 };

function handle(e: GameEvent): void {
  switch (e.type) {
    case "score":
      ui.updateScore(e.value);  // value는 number로 narrow
      break;
    case "playerDied":
      ui.showGameOver();
      break;
    case "sceneChange":
      engine.loadScene(e.to);  // to는 SceneId로 narrow
      break;
    case "achievement":
      ui.showAchievement(e.id, e.tier);
      break;
    default: {
      const _exhaustive: never = e;  // 새 variant 추가 시 컴파일 에러
      throw new Error(`Unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

`switch (e.type)`로 자동 narrowing. `default: const _: never = e;`는 exhaustiveness check — 새 case가 추가됐는데 핸들러를 안 쓰면 컴파일러가 잡아준다.

### 3.1 union vs class hierarchy

OOP 출신은 본능적으로 `class GameEvent` 추상 베이스 + 서브클래스로 짤 수 있다. TS에서는 union이 더 자연스러움 — `instanceof` 체크보다 `type` 필드 분기가 가볍고, 직렬화/역직렬화 (Wasm 경계, JSON) 직결.

---

## 4. Factory 패턴 — 비동기 init

생성자는 `async` 못 씀 (TS/JS 제약). 비동기 init이 필요한 클래스는 factory:

```ts
export class Engine {
  private constructor(
    private readonly wasm: InitOutput,
    private readonly engineCore: EngineCore,
    private readonly renderer: Renderer,
    private readonly audio: AudioManager,
    /* ... */
  ) {}

  static async create(opts: EngineOptions): Promise<Engine> {
    const wasm = await loadWasm();
    const engineCore = new wasm.EngineCore();
    const renderer = await createRenderer(opts.renderer ?? "webgl2", opts.canvas);
    const audio = new AudioManager();
    return new Engine(wasm, engineCore, renderer, audio);
  }
}

// 사용
const engine = await Engine.create({ canvas, /* ... */ });
```

또는 module-level factory 함수 (단순):

```ts
export async function createEngine(opts: EngineOptions): Promise<Engine> {
  // ...
  return new Engine(/* ... */);
}
```

`private constructor` — 외부에서 `new Engine(...)` 호출 차단. factory만이 정식 진입점임을 강제.

### 4.1 부분 초기화 객체 노출 금지

```ts
// ❌
const engine = new Engine();
await engine.init();  // 두 단계 — 사용자가 init 잊으면 망함
engine.start();

// ✅ create()가 fully initialized 객체 반환
const engine = await Engine.create({ /* ... */ });
engine.start();
```

"방금 만들었지만 아직 못 씀" 상태가 타입 시스템에 안 보이는 게 가장 위험.

---

## 5. 리소스 핸들 + Disposable 패턴

WebGL 자원, AudioContext source 등은 명시적 해제가 필요. TS 5.2+ `using`:

```ts
class Texture implements Disposable {
  constructor(private gl: WebGL2RenderingContext, private tex: WebGLTexture) {}
  [Symbol.dispose](): void {
    this.gl.deleteTexture(this.tex);
  }
}

function withTempTexture(gl: WebGL2RenderingContext, work: (tex: Texture) => void): void {
  using tex = new Texture(gl, gl.createTexture()!);
  work(tex);
  // 블록 끝에서 자동 dispose
}
```

`using` 키워드는 비교적 신기능 — 지원 환경 (Node 22+, 최신 브라우저, TS 5.2+) 확인. 게임엔진은 자원 lifetime이 게임 lifetime과 같은 경우가 많아 `using`보다 명시적 `destroy()` 메서드가 더 자연스러움. MVP에서는 `destroy()` 패턴.

```ts
class WebGL2Renderer implements Renderer {
  destroy(): void {
    for (const tex of this.textures.values()) this.gl.deleteTexture(tex);
    this.textures.clear();
    this.gl.deleteProgram(this.shader.program);
    // ...
  }
}
```

호출자가 `engine.destroy()`만 부르면 cascade로 모든 자원 해제.

---

## 6. Wasm 모듈 타입 활용

`wasm-pack`이 `.d.ts` 자동 생성. 직접 import + type alias:

```ts
import init, { Engine as WasmEngine, type InitOutput } from "../wasm/pkg/engine_core.js";

export type { WasmEngine, InitOutput };

let wasm: InitOutput | null = null;

export async function loadWasm(): Promise<InitOutput> {
  if (wasm) return wasm;
  wasm = await init();
  return wasm;
}

export function getWasmMemory(): WebAssembly.Memory {
  if (!wasm) throw new Error("Wasm not initialized");
  return wasm.memory;
}
```

- `import init` — default export, `init(url?)` 함수.
- `Engine` — Rust `#[wasm_bindgen]` struct에 대응. 메서드 시그니처가 자동 생성됨.
- `InitOutput` — `init()` 반환값 타입, `memory: WebAssembly.Memory` 등 포함.

### 6.1 `.d.ts` 안 보이는 경우

`wasm-pack build`의 `--target web`이 `.d.ts`도 생성. tsconfig에 wasm 폴더가 포함돼 있는지 확인:

```json
{
  "include": ["src/**/*", "wasm/pkg/*.d.ts"]
}
```

또는 wasm 폴더를 typescript project reference로 분리.

---

## 7. 모듈 export 전략 — public API surface

라이브러리로 publish하는 `engine-web` 패키지의 public API는 신중히:

```ts
// src/index.ts — public API
export { createEngine, type EngineOptions } from "./engine.js";
export type { AssetManifest } from "./assets/manifest.js";
export type { GameEvent } from "./events.js";
export type { Camera2D } from "./renderer/Camera2D.js";

// 내부 implementation은 노출 안 함:
// WebGL2Renderer, WasmBridge, GameLoop 등은 export 안 됨
```

내부 모듈은 `index.ts`에서 re-export하지 않음. 사용자가 `import { WebGL2Renderer } from "engine-web/internals"` 같은 deep import를 시도하지 못하게 — `package.json`의 `exports` 필드로 차단:

```json
{
  "name": "@engine/web",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./package.json": "./package.json"
  }
}
```

`exports`에 명시 안 된 path는 import 거부됨 (Node 12+, TS `moduleResolution: "node16"` 또는 `"bundler"`).

### 7.1 내부 vs 공개 타입

- 공개: 사용자 코드에 직접 등장하는 타입 (`Engine`, `EngineOptions`, `AssetManifest`, `Camera2D`).
- 내부: 구현 디테일 (`WasmBridge`, `RenderCommandView`, `SpriteBatch`).

내부 타입을 공개 API에 노출하지 마 — 한 번 노출되면 그 시그니처가 SemVer 책임이 됨.

---

## 8. 에러 처리 — 타입화된 결과

핫패스가 아닌 곳 (자산 로딩, 씬 전환 등) 의 에러는 `Error` 서브클래스 또는 discriminated union:

```ts
export class AssetError extends Error {
  constructor(message: string, public readonly url: string, public readonly kind: "network" | "decode" | "type") {
    super(message);
    this.name = "AssetError";
  }
}

try {
  await engine.loadAssets(manifest);
} catch (e) {
  if (e instanceof AssetError) {
    console.error(`자산 로드 실패: ${e.url} (${e.kind})`);
    showErrorScreen(e);
  } else {
    throw e;  // 모르는 에러는 다시 던짐
  }
}
```

또는 Result-like:

```ts
type LoadResult =
  | { ok: true; assetCount: number }
  | { ok: false; error: AssetError };
```

throw vs Result 선택은 호출자가 분기 처리할 가능성에 따라. 거의 모든 에러가 fatal이면 throw, 대부분 복구 가능하면 Result.

### 8.1 비동기 에러는 잊기 쉬움

```ts
// ❌ unhandled rejection
fetch("/api/scores").then((r) => r.json());

// ✅ await 또는 .catch
try {
  const r = await fetch("/api/scores");
  const json = await r.json();
} catch (e) {
  console.error(e);
}
```

`tsconfig`의 `"noUncheckedIndexedAccess": true`처럼 ESLint `@typescript-eslint/no-floating-promises` 활성화 권장.

---

## 9. Strict tsconfig 권장

`engine-web` 패키지의 `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  },
  "include": ["src/**/*", "wasm/pkg/*.d.ts"],
  "exclude": ["node_modules", "dist"]
}
```

각 옵션 의미:

- `strict: true` — `noImplicitAny`, `strictNullChecks` 등 묶음.
- `noUncheckedIndexedAccess` — `array[i]`, `record[key]`가 `T | undefined` 반환. 게임엔진의 컴포넌트 lookup에서 특히 중요.
- `noImplicitOverride` — `override` 키워드 강제. 부모 메서드 시그니처 변경 시 안전.
- `verbatimModuleSyntax` — `import type { ... }` 명시 강제. 빌드 시 type-only import 자동 제거.
- `isolatedModules` — 각 파일을 독립 컴파일 가능하게. esbuild/swc 같은 빠른 transpiler 호환.
- `lib: ["WebWorker"]` — OffscreenCanvas / Worker 환경에서 동작하는 코드 작성 시 필요. 단순 메인스레드면 빼도 됨.

### 9.1 `noUncheckedIndexedAccess` 영향

```ts
const arr: number[] = [1, 2, 3];
const x = arr[0];  // x: number | undefined (이 옵션 켜면)
```

처음에는 귀찮지만, 사실상 모든 `array[i]` 접근이 unsafe임을 인정하는 것. 다음 같은 버그를 잡아준다:

```ts
const entities: Entity[] = world.entities();
const player = entities[playerIndex];  // undefined일 수 있음
player.update(dt);  // ❌ Object is possibly undefined
```

`if (player)` 체크 또는 `entities[playerIndex]!` 명시.

---

## 10. 흔한 실수 — `any` / `as` / `enum`

### 10.1 `any` 대안

```ts
// ❌
function handleEvent(e: any): void { /* ... */ }

// ✅ unknown + 가드
function handleEvent(e: unknown): void {
  if (typeof e === "object" && e !== null && "type" in e) {
    // 여기부터 narrow
  }
}

// ✅ 또는 정확한 union
function handleEvent(e: GameEvent): void { /* ... */ }
```

`any`가 들어가는 순간 그 변수와 그로부터 파생된 모든 값이 타입 안전성 0. 정말 모르겠으면 `unknown` 후 좁힘.

### 10.2 `as`의 정당한 자리

```ts
// ✅ branded type 생성
const id: TextureId = n as TextureId;

// ✅ DOM lookup narrowing
const canvas = document.querySelector("#game") as HTMLCanvasElement;

// ✅ 타입 시스템이 모르는 invariant (반드시 주석)
// hot 경로 — 첫 프레임에서 size 검증 통과한 후로는 항상 같은 layout
const view = wasmMemory.buffer as ArrayBuffer;
```

그 외 `as`는 보통 잘못됐거나 게으른 우회.

### 10.3 `as unknown as T` — 마지막 수단

```ts
const x = somethingMysterious as unknown as MyType;
```

이중 단언은 "TS, 이 변환을 진짜 모르겠지만 강제로" — 거의 항상 더 나은 방법이 있다. 정말 필요하면 그 자리에 주석으로 이유.

### 10.4 `enum` 대신 const 배열

이미 §2 다룸. 반복: enum 쓰지 마. `as const` 배열 + union literal로.

### 10.5 `void` 함수에 값 반환

```ts
// ❌ 의도치 않은 반환 — TS는 허용하지만 가독성 ↓
const arr: number[] = [];
[1, 2, 3].forEach((n) => arr.push(n));  // push 반환값 무시되지만 명시 안 됨

// ✅
[1, 2, 3].forEach((n) => { arr.push(n); });
```

`@typescript-eslint/no-confusing-void-expression` 활성화 권장.

---

## 참고

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — 공식.
- [type-fest](https://github.com/sindresorhus/type-fest) — 자주 쓰는 type helper 모음 (Branded, Opaque 포함).
- [TSConfig Reference](https://www.typescriptlang.org/tsconfig) — 모든 옵션의 의미.
- [`@typescript-eslint`](https://typescript-eslint.io/) — TS 전용 lint 규칙. game engine 코드에 강력 권장.