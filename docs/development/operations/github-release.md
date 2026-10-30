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

## 엔진과 전체 뷰어 앱 분리 준비

`@ferrum2d/authoring-viewer` tarball은 공통 helper다. 독립 실행하는 전체 UI는 `apps/placement-viewer-desktop`의 Tauri 설치 파일로 제공한다. 엔진 SDK는 게임 프로젝트에 설치하고, 전체 뷰어 앱은 OS에 설치한다. 뷰어는 같은 릴리스의 미리보기 엔진을 내장한다.

아래 버전은 예시다. 실제 공개할 때는 새 beta 버전을 선택한다.

```bash
# 빌드 없이 버전·출력·현재 OS·필요 도구 확인
pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --plan

# SDK와 동반 도구 네 tgz: 기존 release:github:prepare 계약 유지
pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --component engine

# 현재 OS의 전체 뷰어 설치 파일
pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --component viewer --no-sign

# SDK + 현재 OS 설치 파일 + 통합 manifest/체크섬/안내
pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --component all --no-sign
```

기본 component는 `all`이다. 기본 출력은 `artifacts/distribution/ferrum-web-v<버전>/engine`, `viewer-<OS>-<arch>`, `all`이다. `--output <새 디렉터리>`, `--repository owner/repo`를 지원하며 기존 파일·디렉터리·심볼릭 링크는 덮어쓰지 않는다. tag/Release/npm publish와 업로드는 실행하지 않는다. 각 component를 별도로 준비한 뒤 합쳐도 된다.

```bash
pnpm release:distribution:assemble -- \
  --engine artifacts/distribution/ferrum-web-v0.1.0-beta.0/engine \
  --viewer artifacts/distribution/ferrum-web-v0.1.0-beta.0/viewer-linux-x64 \
  --output artifacts/distribution/ferrum-web-v0.1.0-beta.0/combined
pnpm release:distribution:verify -- --bundle artifacts/distribution/ferrum-web-v0.1.0-beta.0/combined
```

다른 OS에서 만든 결과도 `--viewer <디렉터리>`를 반복해 합친다. release 저장소·버전·tag·source commit이 같아야 하며 중복 OS/arch, 누락 파일, checksum 불일치, 경로 이탈은 거부한다. 기존 엔진의 `release-manifest.json`과 `SHA256SUMS`는 네 tgz 전용으로 보존한다.

| 추가 산출물 | 내용 |
| --- | --- |
| `ferrum2d-placement-viewer-<버전>-windows-<arch>.exe` | Windows NSIS 설치 파일 |
| `ferrum2d-placement-viewer-<버전>-linux-<arch>.deb` | Linux Debian 계열 설치 패키지 |
| `ferrum2d-placement-viewer-<버전>-macos-<arch>.dmg` | macOS 설치 이미지 |
| `viewer-manifest-<OS>-<arch>.json` | native target, installer SHA-256, 내장 frontend의 SDK Wasm 일치 검사, 수동 검증 대기 상태 |
| `VIEWER_SHA256SUMS-<OS>-<arch>`, `VIEWER_INSTALL-<OS>-<arch>.md` | 개별 뷰어 체크섬·설치 안내 |
| `distribution-manifest.json` | SDK·OS별 뷰어 manifest와 안내 파일 전체의 크기·SHA-256 목록 |
| `DISTRIBUTION_SHA256SUMS`, `DISTRIBUTION_INSTALL.md` | 통합 manifest 자신까지 포함한 체크섬과 분리 설치 안내 |

### Native 빌드 조건

현재 OS의 x64/arm64 Rust host를 사용한다. cross compilation은 제공하지 않으며 CI도 각 OS에서 직접 빌드한다. Node.js 22, pnpm 10.8, Rust stable, `wasm32-unknown-unknown`, wasm-pack과 [Tauri OS별 필수 도구](https://v2.tauri.app/start/prerequisites/)가 필요하다. Windows는 MSVC C++ build tools와 WebView2 환경, macOS는 Xcode command line tools가 필요하다. Linux Debian/Ubuntu 예시는 다음과 같다.

```bash
sudo apt-get install pkg-config libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

스크립트는 Linux GTK/WebKitGTK와 native Rust host를 먼저 확인한다. 누락 시 Wasm 빌드나 출력 생성 전에 실패하며 OS 패키지를 자동 설치하지 않는다. Wasm/SDK 빌드 → 기존 Pixelforge 로고의 native icon 생성 → 임시 config의 beta 버전으로 Tauri release build → 새 installer와 frontend Wasm 확인 순서로 진행한다. source package/Cargo/Tauri 버전은 바꾸지 않는다. 기존 installer를 이번 빌드의 결과로 재사용하지 않는다.

`--no-sign`은 검토용 unsigned 빌드다. 생략하면 기존 플랫폼 signing 설정을 사용하지만 스크립트가 서명·notarization을 검증하지는 않는다. 빌드 성공은 native GUI 성공을 의미하지 않으므로 manifest에 `nativeGui: "not-run"`, `signing: "not-verified"`와 [desktop 수동 release gate](https://github.com/silbaram/ferrum2d/blob/main/apps/placement-viewer-desktop/README.md)를 남긴다. 실제 설치·project/file picker·저장/재열기·asset protocol·handoff·interactive canvas와 OS별 서명 상태를 공개 전에 별도로 확인한다.

`--skip-engine-build`, `--skip-engine-package-check`는 이미 같은 소스에서 수행한 엔진 검사를 재사용할 때만 사용한다. 생략 사실은 기존 엔진 manifest에 기록되며 viewer native build는 생략하지 않는다. dirty source도 준비는 가능하지만 통합 manifest에 보존한다. 공개 후보는 커밋한 깨끗한 소스에서 다시 준비한다.

설치한 뷰어에서 **속성 → 문서 → 프로젝트 열기**로 게임 폴더를 선택하면 `public/scene-authoring.json`과 `public/assets`를 사용한다. SDK/Node/Rust는 뷰어 실행을 위해 따로 설치하지 않아도 된다. 게임의 임의 `main.ts`/HUD를 자동 실행하는 기능은 아니며, 실제 게임 실행은 해당 게임 프로젝트의 실행 명령을 사용한다.

## 버전 확인과 업데이트

전체 뷰어의 **파일 → 버전 및 업데이트**는 앱/내장 엔진과 게임 프로젝트 SDK를 따로 표시한다.
GitHub `/releases/latest`는 beta를 제외하므로 공개 release 목록을 최대 5페이지 조회하고 exact beta를 숫자로 비교한다.
draft·source archive·단순 Git push는 새 버전으로 선택하지 않는다. API 제한/오프라인은 오류를 표시하며 설치를 시작하지 않는다.

프로젝트 갱신은 [create-game의 CLI](https://github.com/silbaram/ferrum2d/blob/main/packages/create-game/README.md)로도 실행할 수 있다.
기존 Ferrum runtime/viewer/generator/agents dependency만 같은 릴리스 URL로 고정하고,
생성기 metadata 없이 공식 SDK tgz URL을 직접 설치한 게임도 정확한 URL에서 출처를 복원한다.
`release-manifest.json`과 tgz의 크기/SHA-256 및 설치된 package 파일을 대조한다.
기존 표준 `ferrum:agents` 명령은 URL만 맞추며 사용자 agent 템플릿은 덮어쓰지 않는다.
custom command·혼합 lock·workspace/file/git 의존성은 수동 처리를 요구한다.
`package.json`과 lock은 `.ferrum-updates/<시각-id>/`에 보관하고 `result.json`에 복원 성공 여부를 남긴다.
실패 중의 metadata도 `failed-*`에 남기며 외부 package 변경은 덮어쓰지 않는다.
package manager 설치 hook을 생략하므로 실제 게임 검증과 migration은 갱신 후 별도로 수행한다.
같은 프로젝트에서 npm/pnpm을 동시에 실행하지 않는다. 비정상 종료로 `active.lock`이 남으면 백업과 설치 상태를 먼저 확인한다.

앱 자동 업데이트를 준비할 때는 **운영자가 별도로 관리하는** Tauri updater 키를 사용한다.
키 생성·원격 secret 등록·릴리스 공개는 준비 스크립트가 수행하지 않는다.

```bash
# FERRUM_UPDATER_PUBLIC_KEY: base64 minisign public-key document
# TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PASSWORD: Tauri signing environment
pnpm release:distribution:prepare -- --version 0.1.0-beta.0 --component viewer --with-updater
```

위 버전은 예시이며 실제 새 버전을 사용한다. `--with-updater`는 필수 키가 없으면 빌드 전에 실패한다.
앱 updater는 공식 `silbaram/ferrum2d` 저장소를 사용한다. fork의 signed updater 준비는 거절하며 별도의 앱 배포 설정이 필요하다.
Tauri의 `--no-sign`은 updater 서명도 생략하므로 두 옵션의 조합은 거부한다.
현재 OS의 installer에 더해 Linux `.AppImage`, macOS `.app.tar.gz`, Windows installer `.exe`와 `.sig`,
`viewer-updater-<linux|macos|windows>-<x64|arm64>.json`을 같은 release에 첨부할 수 있게 준비한다.
metadata는 정확한 version·Tauri platform key·고정 GitHub release artifact URL·signature를 포함한다.
통합 assembler는 updater 파일/체크섬/metadata 일치를 검증한다. SDK manifest의 네 tgz 계약은 유지한다.
앱 버전·공개키와 frontend release version은 임시 config/env로 주입하며 source 버전/키를 바꾸지 않는다.
키와 맞지 않거나 변조된 파일은 설치 시 공식 updater에서 거절한다.
업데이트 서명은 Windows/macOS code-signing/notarization을 대신하지 않으며 기존 native release gate도 유지한다.

수동 workflow의 `include_viewer`와 `signed_updates`를 함께 켜면 위 환경변수와 같은 이름의
repository secrets를 읽어 OS별 자료를 준비한다. unsigned 후보는 기존처럼 `signed_updates=false`를 사용한다.
워크플로는 준비 artifact만 만들며 Release에 자동 첨부/공개하지 않는다.

최초에는 이 기능과 올바른 공개키가 들어간 앱을 직접 설치해야 한다. 그 이후 더 높은 버전의 signed artifact로
갱신할 수 있다. Linux `.deb`는 AppImage 자동 교체 경로를 사용하지 않으므로 수동 재설치한다.
키 없는 개발 앱/브라우저/미지원 OS에는 설치 버튼을 활성화하지 않는다.
2026-10-28 조회한 공개 beta.8은 SDK 묶음만 제공하므로 앱 자동 업데이트 자료가 없는 상태다.
[Tauri updater](https://v2.tauri.app/plugin/updater/)와 [GitHub release API](https://docs.github.com/en/rest/releases/releases)의 계약을 따른다.

## 검증과 CI

```bash
pnpm smoke:github-release-install -- --bundle-dir artifacts/github-release/ferrum-web-v0.1.0-beta.0
pnpm package:consumer-smoke -- --skip-build --skip-package-check --artifact-dir artifacts/consumer-smoke-github-release
pnpm validate:consumer-smoke-report -- --report artifacts/consumer-smoke-github-release/consumer-smoke-report.json --artifact-dir artifacts/consumer-smoke-github-release --expect-status passed
```

HTTP 설치 smoke는 SHA-256을 확인하고 localhost에서 네 패키지의 다운로드/302 redirect를 제공한다. 실제 tarball의 생성기를 `npx <tarball-url>`로 실행해 원래 GitHub dependency URL을 먼저 검증한 후 테스트용 origin으로만 치환한다. `npm install`, lock integrity, `npm ci`, 명시적 agent 설치, `ferrum:check`, production build와 preview/Wasm MIME을 검증한다. 보고서는 묶음 디렉터리의 `github-install-smoke-report.json`이며 `liveGithubDownloadVerified: false`를 명시한다. 검증 시작 시 이전 성공 보고서를 무효화하고, manifest 파싱·파일 누락·checksum 실패도 `status: "failed"`와 오류로 기록한다. 릴리스 정보를 해석하지 못하면 `release: null`이며, 네 파일의 무결성 검증을 모두 통과했을 때만 `checks.bundleIntegrity: true`를 기록한다. 개별 설치 명령은 5분으로 제한하고 시간 초과 시 하위 프로세스까지 종료한다. 실제 GitHub 접근 권한/공개 여부를 검증한 결과로 해석하면 안 된다.

전체 consumer smoke는 기존 source 패키지를 사용해 네 템플릿의 게임 실행과 placement viewer까지 검사한다. 릴리스 metadata에 의한 네 템플릿 URL 생성은 `test:github-release`에서 별도로 검증한다.

`.github/workflows/github-release-prepare.yml`은 수동 실행으로 이 준비·HTTP 설치·전체 consumer matrix를 실행하고 Actions artifact를 업로드한다. `include_viewer`를 켜면 Windows/Linux/macOS native matrix와 통합 검증을 추가해 `distribution-candidate` artifact를 만든다. 기본값은 기존 SDK 준비만 수행한다. macOS의 arch는 runner의 native Rust host를 따른다. CI viewer는 unsigned 검토용 빌드이며 GUI/서명 증거는 별도다. `contents: read` 권한만 사용하며 Git tag/GitHub Release/npm 공개는 하지 않는다. 기존 수동 CI validate에도 `test:github-release`를 연결한다. 이 테스트는 CLI·Windows 명령 실행 방식·세 OS의 모의 빌드 산출물 계약·변조/구버전 파일 거부·통합 검증을 검사하며 실제 native 설치 테스트를 대체하지 않는다. tag ref에서 실행해도 npm 공개를 요구하지 않도록 `private: true` candidate/tag 검사와 일반 package 검사를 사용한다. npm publish 전용 검사는 별도 npm 절차에서 실행한다.

## 실제 공개와 업데이트

준비 결과, 검사 보고서, source commit/dirty 상태를 검토하고 공개할 소스를 커밋한 뒤 같은 소스로 최종 묶음을 다시 만든다. 명시적 사용자 승인 후 `ferrum-web-v<버전>` tag의 GitHub prerelease에 네 tarball과 manifest/checksum/설치 안내를 올린다. 전체 뷰어도 제공하는 릴리스는 통합 묶음의 OS별 설치 파일과 개별/통합 manifest·체크섬·안내를 함께 첨부한다. tag는 manifest의 source commit과 일치해야 한다. GitHub 전용 배포에는 npm publish용 `private: false` 전환이나 `release:publish-check`가 필요 없다.

공개 후에는 `INSTALL.md`의 실제 URL을 빈 디렉터리에서 실행해 프로젝트 생성·설치·게임 검증을 다시 확인한다. 공개한 버전의 파일을 교체하는 대신 새 beta 버전을 만든다. 업데이트 시 게임 `package.json`의 engine/viewer URL, `ferrum:agents` URL, 출처 metadata를 같은 릴리스로 함께 변경한 뒤 `npm install`과 `ferrum:check`를 실행한다.
