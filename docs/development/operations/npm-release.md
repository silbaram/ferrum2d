# npm 베타 패키징 절차

이 문서는 `@ferrum2d/ferrum-web`를 npm 베타 패키지로 공개하기 전 확인해야 하는 기준을 고정한다. 현재 저장소는 accidental publish를 막기 위해 `packages/ferrum-web/package.json`의 `private: true`를 유지한다. npm package 역할 분리는 [npm 패키지 구성 전략](npm-package-strategy.md)을 따른다.

## 목표

- 사용자가 `pnpm add @ferrum2d/ferrum-web@beta`로 browser runtime을 설치할 수 있는 패키지 형태를 만든다.
- Rust/Wasm generated package와 TypeScript dist가 같은 npm artifact 안에 들어가는지 검증한다.
- `beta` dist-tag와 prerelease semver를 사용해 안정 버전인 `latest`와 분리한다.
- GitHub Release 본문은 [릴리스 노트 템플릿](release-notes-template.md)을 기준으로 작성한다.
- 실제 `npm publish`는 별도 승인과 npm 권한 확인 이후에만 수행한다.

## 패키지 구성 기준

`@ferrum2d/ferrum-web`는 런타임 엔진 package다. `@ferrum2d/create-game` 프로젝트 생성 CLI와 `@ferrum2d/agents` AI agent/skill 설치 CLI는 별도 package로 관리하며, `@ferrum2d/ferrum-web` artifact에 포함하지 않는다.

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
pnpm package:check:ferrum-web
pnpm package:consumer-smoke
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

## 릴리스 메타데이터 자동 검증

릴리스 후보는 changelog, package version, Git tag 이름이 서로 맞아야 한다. 기본 확인은 현재 저장소의 release metadata와 `CHANGELOG.md` 구조를 검증한다.

```bash
pnpm release:check
```

`ferrum-web-v*` tag push가 발생하면 CI가 같은 검증을 실행하고 package consumer smoke를 별도 job으로 gate한다. PR이나 일반 push에서는 무겁기 때문에 기본 실행하지 않으며, 수동 `workflow_dispatch`에서 `consumer_smoke` input을 켜면 같은 job을 opt-in으로 실행한다. tag 기반 검증에서는 다음 조건을 추가로 요구한다.

- `packages/ferrum-web/package.json` version이 `x.y.z-beta.N` 형식이다.
- Git tag가 정확히 `ferrum-web-vx.y.z-beta.N` 형식이며 package version과 일치한다.
- `CHANGELOG.md`에 `## x.y.z-beta.N - YYYY-MM-DD` release section이 있다.
- publish 후보 metadata로 `private: false`가 설정되어 있다.

실제 publish 직전에는 release metadata check와 package publish guard를 함께 실행한다.

```bash
pnpm release:publish-check
```

## 로컬 pack 확인

`pnpm package:check:ferrum-web`는 내부적으로 `pnpm pack`을 실행해 tarball contents를 검증한다. 전체 package 역할 분리까지 함께 확인하려면 `pnpm package:check`를 실행한다. 사람이 직접 tarball을 남겨 확인해야 할 때만 다음을 실행한다.

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

세 package를 함께 검증할 때는 사람이 직접 임시 프로젝트를 만들기보다 다음 명령을 우선 사용한다.

```bash
pnpm package:consumer-smoke
```

이 명령은 `@ferrum2d/ferrum-web`, `@ferrum2d/create-game`, `@ferrum2d/agents`를 로컬 tarball로 pack하고, 임시 consumer project에서 tool package 설치, `create-game` template matrix 생성, agents dry-run, runtime tarball install, public import smoke, production build를 한 번에 확인한다. 기본값은 `packages/create-game/templates/*` 전체이며, 좁은 확인이 필요하면 `pnpm package:consumer-smoke -- --templates minimal`처럼 실행한다.

CI에서 consumer smoke가 실패하면 `artifacts/consumer-smoke`에 failure report, tarball, node_modules/dist를 제외한 tool/generated project snapshot을 남기고 `actions/upload-artifact`로 업로드한다. 로컬에서도 같은 보존 정책을 쓰려면 다음을 실행한다.

```bash
pnpm package:consumer-smoke -- --artifact-dir artifacts/consumer-smoke
```

## 실제 publish 절차

1. `CHANGELOG.md`의 `Unreleased` 내용을 베타 버전 섹션으로 정리한다.
2. `packages/ferrum-web/package.json` version을 `0.1.0-beta.N`으로 올린다.
3. `MIT OR Apache-2.0` license metadata와 package `LICENSE` 포함 상태를 확인한다.
4. publish 승인 후에만 `private: false`로 바꾼다.
5. 배포 전 필수 검증을 모두 통과시킨다.
6. release metadata와 publishable package guard를 함께 실행한다.

```bash
pnpm release:publish-check
```

이 명령은 `@ferrum2d/ferrum-web` 기준 changelog release section, Git tag 규칙, `private: false`, `0.1.0-beta.N` 형식 version, `beta` dist-tag 설정, 실제 pack artifact를 함께 확인한다. `@ferrum2d/create-game`, `@ferrum2d/agents` publish 후보는 각각 `pnpm package:publish-check:create-game`, `pnpm package:publish-check:agents`로 별도 확인한다.

이후 절차:

7. npm 로그인과 organization 권한을 확인한다.
8. `npm publish --access public --tag beta`를 `packages/ferrum-web`에서 실행한다.
9. Git tag는 `ferrum-web-v0.1.0-beta.N` 형식으로 만든다.
10. tag push 후 CI의 `Release metadata check`가 통과하는지 확인한다.
11. [릴리스 노트 템플릿](release-notes-template.md)에 맞춰 GitHub Release 본문을 작성한다.

## GitHub generated release notes

`.github/release.yml`은 GitHub가 자동 생성하는 PR 목록을 Breaking Changes, Features, Fixes, Documentation, Maintenance, Other Changes로 분류한다. 이 분류는 초안 생성을 돕는 보조 기준이며, 최종 본문은 [릴리스 노트 템플릿](release-notes-template.md)의 Summary, Install, Highlights, Breaking Changes, Upgrade Notes, Verification, Known Limitations, Links 구조로 편집한다.

## 실패와 롤백 기준

이미 publish된 npm version은 같은 version으로 덮어쓸 수 없다. 배포 후 치명적 문제가 발견되면 기존 version 수정에 의존하지 말고 다음 순서로 처리한다.

- 문제가 있는 version을 deprecated 처리한다.
- 수정 커밋을 만든다.
- `0.1.0-beta.N+1` 새 version으로 다시 배포한다.
- 실패 원인과 사용자 영향 범위를 `CHANGELOG.md` 또는 릴리스 노트에 남긴다.
