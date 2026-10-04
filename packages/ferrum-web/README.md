# @ferrum2d/ferrum-web

Ferrum2D browser runtime과 WebGL2 platform layer 패키지다.

이 패키지는 Rust/Wasm core가 게임 상태, 충돌, scene update, render command 생성을 담당하고 TypeScript가 browser input, asset/audio loading, WebGL2 draw, debug overlay를 담당하는 구조를 유지한다.

## 설치

기본 배포는 GitHub Releases의 버전별 `.tgz`다. npm은 설치 도구로 사용하며 npm 레지스트리 공개는 필수가 아니다.
[AI 초기 설치 지침](https://github.com/silbaram/ferrum2d/blob/main/docs/engine/ai-agent-install.md)을 따라
선택한 릴리즈의 runtime URL을 dependency에 고정한다. 엔진 소스/Rust 빌드 도구는 게임 프로젝트에 필요하지 않다.

AI가 기능을 선택할 때는 설치된 `.agents/harness/ferrum-feature-guide.md` 또는
[AI 게임 개발 기능 안내](https://github.com/silbaram/ferrum2d/blob/main/docs/engine/ai-feature-guide.md)를 읽는다.
기능 존재 여부는 이 패키지의 버전과 공개 `.d.ts`로 확인하고, 상세 문서는 같은 release tag의 것을 사용한다.
기능 안내서는 agents 패키지가 별도로 설치하며 runtime 의존성 설치만으로 AI 지침을 생성하지 않는다.

## 기본 사용

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web/core";

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

## Public entrypoints

신규 코드는 목적별 subpath를 우선 사용한다.

| Entry point | 용도 |
| --- | --- |
| `@ferrum2d/ferrum-web/core` | runtime, renderer, input/audio/asset, Physics Spec/API, 순수 2D 기하 변환 helper |
| `@ferrum2d/ferrum-web/authoring` | Scene Composition, Behavior Recipe, FSM, gameplay/physics authoring helper |
| `@ferrum2d/ferrum-web/starter-scenes` | Shooter Game Spec, starter input profile, starter scene helper |
| `@ferrum2d/ferrum-web/labs` | WebGPU, PixelMaskTerrain, lighting/material/VFX/atlas helper |
| `@ferrum2d/ferrum-web/quality` | diagnostic, runtime budget, screenshot summary, replay/report helper |
| `@ferrum2d/ferrum-web` | 기존 코드 호환용 aggregate entrypoint |

`environment: "development"`에서는 DebugOverlay가 기본 활성화되고, `environment: "production"` 또는 생략 상태에서는 기본 비활성화된다. `debug: true` 또는 `debug: false`를 명시하면 environment 기본값보다 우선한다.

기존 root aggregate import나 내부 `dist/*`, `pkg/*`, `src/*` import를 쓰는 프로젝트는 [Public API migration guide](https://github.com/silbaram/ferrum2d/blob/main/docs/engine/public-api/migration-guide.md)를 따라 목적별 subpath로 옮긴다.

point/body local-world 변환과 collider reference point 계산은 `core`의
`bodyLocalToWorld2D(...)`, `writePhysicsColliderWorldReferencePoints(...)` 등을 사용한다.
좌표축과 collider별 회전 규칙은 [좌표계와 2D 기하 변환](https://github.com/silbaram/ferrum2d/blob/main/docs/engine/coordinate-system.md)을 따른다.

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
