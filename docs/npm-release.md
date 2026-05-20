# npm 베타 패키징 절차

이 문서는 `@ferrum2d/ferrum-web`를 npm 베타 패키지로 공개하기 전 확인해야 하는 기준을 고정한다. 현재 저장소는 accidental publish를 막기 위해 `packages/ferrum-web/package.json`의 `private: true`를 유지한다.

## 목표

- 사용자가 `pnpm add @ferrum2d/ferrum-web@beta`로 browser runtime을 설치할 수 있는 패키지 형태를 만든다.
- Rust/Wasm generated package와 TypeScript dist가 같은 npm artifact 안에 들어가는지 검증한다.
- `beta` dist-tag와 prerelease semver를 사용해 안정 버전인 `latest`와 분리한다.
- 실제 `npm publish`는 별도 승인과 npm 권한 확인 이후에만 수행한다.

## 패키지 구성 기준

`@ferrum2d/ferrum-web` package artifact에는 다음 파일만 포함한다.

- `package.json`
- `README.md`
- `dist/**`
- `pkg/ferrum_core.js`
- `pkg/ferrum_core.d.ts`
- `pkg/ferrum_core_bg.wasm`
- `pkg/ferrum_core_bg.wasm.d.ts`
- `pkg/package.json`

다음 파일은 package artifact에 포함하지 않는다.

- `src/**`
- `test/**`
- `dist-test/**`
- `node_modules/**`
- `tsconfig*.json`
- `pkg/.gitignore`

`wasm-pack`이 생성하는 `pkg/.gitignore`는 `*`를 포함하므로, package allowlist는 `pkg` 디렉터리 전체가 아니라 필요한 generated artifact 파일을 명시한다.

## 베타 버전 규칙

베타 배포를 승인하면 `packages/ferrum-web/package.json`의 version은 다음 형식을 사용한다.

```text
0.1.0-beta.0
0.1.0-beta.1
0.1.0-beta.2
```

배포 tag는 `beta`만 사용한다. `latest`는 안정화 기준을 별도로 충족하기 전까지 사용하지 않는다.

```bash
npm publish --access public --tag beta
```

현재 package에는 `publishConfig.access: "public"`과 `publishConfig.tag: "beta"`를 둔다. 그래도 publish 명령에는 `--tag beta`를 명시한다.

## 배포 전 필수 검증

저장소 루트에서 실행한다.

```bash
pnpm lint
pnpm test
pnpm validate:game-spec
pnpm smoke:headless
pnpm package:check
pnpm build:web
```

브라우저가 설치된 로컬 환경에서는 WebGL2 black-frame 회귀 방지를 위해 다음도 실행한다.

```bash
pnpm smoke:browser
```

Rust/Wasm 경계를 바꾼 릴리스 후보는 추가로 Rust formatting과 clippy를 확인한다.

```bash
cargo fmt --manifest-path crates/ferrum-core/Cargo.toml --check
cargo clippy --manifest-path crates/ferrum-core/Cargo.toml -- -D warnings
```

## 로컬 pack 확인

`pnpm package:check`는 내부적으로 `pnpm pack`을 실행해 tarball contents를 검증한다. 사람이 직접 tarball을 남겨 확인해야 할 때만 다음을 실행한다.

```bash
pnpm build:wasm
pnpm --filter @ferrum2d/ferrum-web build
pnpm --filter @ferrum2d/ferrum-web pack --pack-destination ../../artifacts/npm
```

생성된 `.tgz`는 임시 소비자 프로젝트에서 설치해 import smoke를 확인한다.

```bash
pnpm add /path/to/ferrum2d-ferrum-web-0.1.0-beta.0.tgz
```

소비자 코드는 package entrypoint만 import한다.

```ts
import { createFerrumRuntime } from "@ferrum2d/ferrum-web";
```

`@ferrum2d/ferrum-web/dist/*`, `@ferrum2d/ferrum-web/pkg/*`, generated wasm-bindgen API는 public import 경로가 아니다.

## 실제 publish 절차

1. `CHANGELOG.md`의 `Unreleased` 내용을 베타 버전 섹션으로 정리한다.
2. `packages/ferrum-web/package.json` version을 `0.1.0-beta.N`으로 올린다.
3. `MIT OR Apache-2.0` license metadata와 package `LICENSE` 포함 상태를 확인한다.
4. publish 승인 후에만 `private: false`로 바꾼다.
5. 배포 전 필수 검증을 모두 통과시킨다.
6. publishable package guard를 실행한다.

```bash
pnpm package:publish-check
```

이 명령은 `private: false`, `0.1.0-beta.N` 형식 version, `beta` dist-tag 설정, 실제 pack artifact를 함께 확인한다.

이후 절차:

7. npm 로그인과 organization 권한을 확인한다.
8. `npm publish --access public --tag beta`를 `packages/ferrum-web`에서 실행한다.
9. Git tag는 `ferrum-web-v0.1.0-beta.N` 형식으로 만든다.
10. README 또는 릴리스 노트에 설치 명령과 known limitations를 기록한다.

## 실패와 롤백 기준

이미 publish된 npm version은 같은 version으로 덮어쓸 수 없다. 배포 후 치명적 문제가 발견되면 기존 version 수정에 의존하지 말고 다음 순서로 처리한다.

- 문제가 있는 version을 deprecated 처리한다.
- 수정 커밋을 만든다.
- `0.1.0-beta.N+1` 새 version으로 다시 배포한다.
- 실패 원인과 사용자 영향 범위를 `CHANGELOG.md` 또는 릴리스 노트에 남긴다.
