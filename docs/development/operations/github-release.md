# GitHub Release 기반 게임 개발 환경 배포

Ferrum2D는 npm 레지스트리에 공개하지 않고 GitHub Releases의 설치용 `.tgz` 파일을 `npx`/`npm install`로 사용하는 배포 경로를 제공한다. **로컬 묶음 준비와 원격 Release 공개는 별개다.** 이 문서의 `0.1.0-beta.0`은 명령 예시이며 공개 완료를 뜻하지 않는다.

## 게임 개발자 설치 흐름

초기 환경만 설치하는 요청은 [AI 에이전트용 초기 설치 지침](../../engine/ai-agent-install.md)을 따른다. 아래 생성기 명령은 실행 가능한 예제 게임을 요청한 경우에 사용하며 `minimal`도 빈 프로젝트는 아니다. 릴리스 묶음의 `INSTALL.md`도 두 흐름을 구분한다.

Node.js 22를 권장한다. 공개된 GitHub Release의 `ferrum2d-create-game-<버전>.tgz` 다운로드 링크를 사용한다.

```bash
ferrum_cli_url="<GitHub Release의 create-game .tgz 다운로드 URL>"
npx --yes --allow-remote=root "$ferrum_cli_url" my-game --template topdown
cd my-game
npm install
npm run dev
```

사용자는 엔진 소스를 clone하거나 Rust/wasm-pack을 설치할 필요가 없다. 생성기는 템플릿을 복사하고 엔진·authoring viewer를 동일 릴리스 URL에 고정한다. 일반 개발 도구(Vite, TypeScript 등)는 npm 레지스트리에서 설치한다. `minimal`, `topdown`, `platformer`, `breakout` 템플릿을 제공한다.

생성 프로젝트에는 다음이 추가된다.

- `package.json.ferrumGithubRelease`: 저장소, 정확한 beta 버전, Git tag.
- `.npmrc`: npm 12의 외부 URL 의존성 정책에 맞춘 `allow-remote=root`. 직접 dependency URL만 허용하며, 기존 파일은 `--force`에서도 덮어쓰지 않는다.
- `FERRUM_INSTALL.md`: 출처, 설치·재설치·진단 안내.
- `npm run ferrum:agents`: 같은 릴리스의 agents tarball로 Codex/Claude/Gemini 지침을 설치하는 선택형 명령. `npm install`이나 `postinstall`에서는 실행하지 않는다.

```bash
npm run ferrum:agents
npm run ferrum:check
npm run ferrum:deploy-report
npm run preview
```

`package-lock.json`을 버전 관리에 포함하고 재설치에는 `npm ci`를 사용한다. EALLOWREMOTE가 발생하면 기존 `.npmrc`/사용자 정책을 확인하고 의도한 직접 URL 설치에는 `npm install --allow-remote=root`를 사용한다. npm 12 이전 버전은 이 설정을 모른다는 경고를 표시할 수 있다. [npm URL 설치 정책](https://docs.npmjs.com/cli/using-npm/config/#allow-remote)을 참고한다.

## CLI 호환 계약

GitHub Release용으로 준비한 생성기 tarball은 자신의 `ferrumGithubRelease` metadata를 읽어 자동으로 릴리스를 선택한다. 저장소의 source CLI에도 다음 옵션을 사용할 수 있다.

```bash
node packages/create-game/bin/create-game.mjs ../my-game \
  --github-release 0.1.0-beta.0 \
  --github-repository silbaram/ferrum2d
```

`--github-release`는 `x.y.z-beta.N` 또는 `ferrum-web-vx.y.z-beta.N`만 받는다. `latest`, 버전 범위, URL은 받지 않는다. `--github-repository`는 `owner/repo` 형식이다. 생성기 package의 embedded metadata는 자신의 package version/tag와 일치해야 한다. 릴리스 모드와 개별 `--ferrum-version`/`--authoring-viewer-version` override를 섞으면 디렉터리를 생성하기 전에 실패한다.

릴리스 metadata/옵션이 없는 source CLI는 기존 registry 범위 기본값을 유지한다. npm 미공개 상태에서 source CLI를 사용하는 기존 로컬 tarball 경로는 두 dependency를 명시해야 한다.

## 배포자 로컬 준비

엔진을 빌드할 수 있는 Rust stable, Wasm target, wasm-pack, Node.js, pnpm 환경에서 실행한다.

```bash
pnpm install
pnpm test:github-release
pnpm release:github:prepare -- --version 0.1.0-beta.0
```

기본 출력은 `artifacts/github-release/ferrum-web-v0.1.0-beta.0/`다. `--output <새 디렉터리>`와 fork용 `--repository owner/repo`를 지원한다. 이미 존재하는 출력 디렉터리는 덮어쓰지 않는다.

준비 명령은 Wasm/runtime/viewer build와 네 package 검사를 실행한다. 이미 같은 소스에서 검증한 경우에만 `--skip-build --skip-package-check`를 사용할 수 있으며 생략 사실은 manifest에 기록된다. source package는 모두 `private: true`이고 같은 base version이어야 한다. 임시 staging 복사본의 버전만 요청한 beta로 바꾸므로 tracked package version, lockfile, Git tag, npm 레지스트리는 수정하지 않는다.

| 산출물 | 내용 |
| --- | --- |
| `ferrum2d-ferrum-web-<버전>.tgz` | JS/타입 선언/빌드된 Wasm과 runtime 에셋 |
| `ferrum2d-authoring-viewer-<버전>.tgz` | viewer helper |
| `ferrum2d-create-game-<버전>.tgz` | 릴리스 출처 metadata를 포함한 생성기·템플릿 |
| `ferrum2d-agents-<버전>.tgz` | consumer AI 지침 설치 CLI·템플릿 |
| `release-manifest.json` | package/version/URL/크기/SHA-256, source commit/dirty 여부, 실행한 준비 검사 |
| `SHA256SUMS` | 네 설치 패키지의 SHA-256 |
| `INSTALL.md` | 이 버전에 맞춘 설치 명령 |

자동 제공되는 GitHub Source code.zip/tar.gz는 설치용 패키지가 아니다. 위 네 `.tgz`를 릴리스 Assets로 제공해야 한다.

## 검증과 CI

```bash
pnpm smoke:github-release-install -- --bundle-dir artifacts/github-release/ferrum-web-v0.1.0-beta.0
pnpm package:consumer-smoke -- --skip-build --skip-package-check --artifact-dir artifacts/consumer-smoke-github-release
pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke-github-release/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke-github-release --expect-status passed
```

HTTP 설치 smoke는 SHA-256을 확인하고 localhost에서 네 패키지의 다운로드/302 redirect를 제공한다. 실제 tarball의 생성기를 `npx <tarball-url>`로 실행해 원래 GitHub dependency URL을 먼저 검증한 후 테스트용 origin으로만 치환한다. `npm install`, lock integrity, `npm ci`, 명시적 agent 설치, `ferrum:check`, production build와 preview/Wasm MIME을 검증한다. 보고서는 묶음 디렉터리의 `github-install-smoke-report.json`이며 `liveGithubDownloadVerified: false`를 명시한다. 검증 시작 시 이전 성공 보고서를 무효화하고, manifest 파싱·파일 누락·checksum 실패도 `status: "failed"`와 오류로 기록한다. 릴리스 정보를 해석하지 못하면 `release: null`이며, 네 파일의 무결성 검증을 모두 통과했을 때만 `checks.bundleIntegrity: true`를 기록한다. 개별 설치 명령은 5분으로 제한하고 시간 초과 시 하위 프로세스까지 종료한다. 실제 GitHub 접근 권한/공개 여부를 검증한 결과로 해석하면 안 된다.

전체 consumer smoke는 기존 source 패키지를 사용해 네 템플릿의 게임 실행과 placement viewer까지 검사한다. 릴리스 metadata에 의한 네 템플릿 URL 생성은 `test:github-release`에서 별도로 검증한다.

`.github/workflows/github-release-prepare.yml`은 수동 실행으로 이 준비·HTTP 설치·전체 consumer matrix를 실행하고 Actions artifact를 업로드한다. `contents: read` 권한만 사용하며 Git tag/GitHub Release/npm 공개는 하지 않는다. 기존 수동 CI validate에도 `test:github-release`를 연결한다. tag ref에서 실행해도 npm 공개를 요구하지 않도록 `private: true` candidate/tag 검사와 일반 package 검사를 사용한다. npm publish 전용 검사는 별도 npm 절차에서 실행한다.

## 실제 공개와 업데이트

준비 결과, 검사 보고서, source commit/dirty 상태를 검토하고 공개할 소스를 커밋한 뒤 같은 소스로 최종 묶음을 다시 만든다. 명시적 사용자 승인 후 `ferrum-web-v<버전>` tag의 GitHub prerelease에 네 tarball과 manifest/checksum/설치 안내를 올린다. tag는 manifest의 source commit과 일치해야 한다. GitHub 전용 배포에는 npm publish용 `private: false` 전환이나 `release:publish-check`가 필요 없다.

공개 후에는 `INSTALL.md`의 실제 URL을 빈 디렉터리에서 실행해 프로젝트 생성·설치·게임 검증을 다시 확인한다. 공개한 버전의 파일을 교체하는 대신 새 beta 버전을 만든다. 업데이트 시 게임 `package.json`의 engine/viewer URL, `ferrum:agents` URL, 출처 metadata를 같은 릴리스로 함께 변경한 뒤 `npm install`과 `ferrum:check`를 실행한다.
