# @ferrum2d/ferrum-web

Ferrum2D browser runtime과 WebGL2 platform layer 패키지다.

이 패키지는 Rust/Wasm core가 게임 상태, 충돌, scene update, render command 생성을 담당하고 TypeScript가 browser input, asset/audio loading, WebGL2 draw, debug overlay를 담당하는 구조를 유지한다.

## 설치

현재 저장소에서는 accidental publish를 막기 위해 `private: true`를 유지한다. 베타 배포가 승인된 뒤에는 다음 형태로 설치한다.

```bash
pnpm add @ferrum2d/ferrum-web@beta
```

## 기본 사용

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("Missing #game canvas.");
}

const runtime = await createFerrumRuntime({
  canvas,
  autostart: true,
  environment: "production",
});

runtime.engine.setTextureIds({ player: 0, enemy: 0, bullet: 0 });
```

게임 규칙과 simulation state는 Rust/Wasm core가 소유한다. 앱 코드는 `createFerrumRuntime(...)`, `createEngine(...)`, `BrowserPlatformHost`, `InputManager`, `WebGL2Renderer`처럼 package entrypoint에서 export하는 API만 사용한다.

`environment: "development"`에서는 DebugOverlay가 기본 활성화되고, `environment: "production"` 또는 생략 상태에서는 기본 비활성화된다. `debug: true` 또는 `debug: false`를 명시하면 environment 기본값보다 우선한다.

## 패키지 산출물

npm package에는 다음 파일만 포함한다.

- `LICENSE`
- `dist`: TypeScript build output과 declaration files
- `pkg/ferrum_core.js`
- `pkg/ferrum_core.d.ts`
- `pkg/ferrum_core_bg.wasm`
- `pkg/ferrum_core_bg.wasm.d.ts`
- `pkg/package.json`
- `README.md`

## 라이선스

`@ferrum2d/ferrum-web`는 `MIT OR Apache-2.0` 듀얼 라이선스로 배포한다. package tarball에는 `LICENSE` 파일을 포함한다.

배포 후보를 만들기 전 저장소 루트에서 다음 명령을 실행한다.

```bash
pnpm package:check
```

이 명령은 Wasm package와 TypeScript dist를 생성한 뒤 실제 `pnpm pack` 결과에 필요한 파일이 포함되고 source/test/cache 파일이 빠져 있는지 확인한다.

실제 publish 직전에는 저장소 문서의 npm 베타 패키징 절차를 따르고 `pnpm package:publish-check`로 `private: false`와 beta semver 상태를 별도로 확인한다.
