# 수정 중인 엔진을 게임 프로젝트에 로컬 설치

엔진 저장소에서 다음 명령 하나로 현재 Rust/Wasm·TypeScript 수정본을 게임에 설치한다.

```bash
pnpm engine:local --project 'C:\Users\psj\projects\game-test'
```

WSL의 `/mnt/c/Users/psj/projects/game-test` 경로도 사용할 수 있다. Linux의 npm 게임
프로젝트와 WSL에서 접근하는 Windows npm 게임 프로젝트를 지원한다. 대상에는 이미
`@ferrum2d/ferrum-web` dependency가 있어야 한다. pnpm/yarn 대상은 package manager
혼용을 막기 위해 거부한다. 엔진 저장소의 개발 도구는 먼저 설치되어 있어야 한다.

명령은 다음 순서로 실행한다.

1. 대상 npm 실행을 확인하고 Wasm과 `ferrum-web`만 빌드한다.
2. 기존 package allowlist와 실제 tarball을 검증한다.
3. 저장소 version과 `private: true`를 유지하며 staging에서 실행마다 고유한
   `0.1.0-local.<식별자>` 버전의 `.tgz`를 만든다.
4. 대상의 엔진·`package.json`·두 npm lockfile을 `.local-engine-backup/<식별자>/`에 백업한다.
5. `vendor/`에 패키지를 넣고 `file:vendor/...tgz` 의존성과 `ferrumLocalEngine` 기록을 갱신한다.
6. `npm install --offline --ignore-scripts --no-audit --no-fund`를 실행하고 설치된 JS/Wasm
   파일을 빌드 산출물과 비교한다. WSL의 Windows 경로에는 Windows npm/Node를 사용한다.
7. Vite 의존성 캐시를 지우고 공개 `/core`, `/authoring` import를 확인한다. 게임에
   `ferrum:check`, `ferrum:local-check`가 있으면 순서대로 실행한다.

설치·검증 실패 시 백업한 엔진과 package/lockfile을 복원한다. npm이 다른 의존성까지
변경한 경우 그 의존성 전체의 복원을 보장하지 않으므로 report와 설치 로그를 확인한다.
게임 소스, agent 지침, 저장 데이터는 수정하지 않는다. 이미 실행 중인 개발 서버는
사용자가 재시작한다.

```powershell
cd C:\Users\psj\projects\game-test
npm run dev -- --force
```

패키지·실행 로그·성공/실패 report는 엔진 저장소의
`artifacts/local-engine/<식별자>/`에 남는다. 성공 report는 게임의 백업 디렉터리에도
복사한다. 게임의 `package.json`에 있는 `ferrumLocalEngine`이 현재 설치 버전의 기준이다.
`vendor/`의 tarball은 `file:` 의존성 재설치에 필요하므로 유지한다. 로컬 설치는 엔진
자체 테스트나 수동 게임 플레이를 대체하지 않는다.

이미 최신 산출물을 빌드하고 검증했다면 `--skip-build`로 빌드 단계만 생략할 수 있다.
이 경우 변경한 소스가 이전 산출물에 반영됐는지 확인해야 한다. package·설치·게임 검증은
계속 실행한다. wasm-pack 캐시 경로가 제한된 환경에서는 `--wasm-cache <경로>`로
Wasm 빌드의 `XDG_CACHE_HOME`만 지정한다. pnpm의 캐시 환경은 변경하지 않는다.

```bash
pnpm engine:local --project /mnt/c/Users/psj/projects/game-test --wasm-cache /tmp/ferrum-door-cache
pnpm smoke:local-engine-install
```

`smoke:local-engine-install`은 빌드된 JS/Wasm이 있는 상태에서 실제 임시 npm 프로젝트에
오프라인 tarball 설치·공개 import·설치 파일 비교를 수행한다. 이후 게임 검증을 일부러
실패시켜 직전 엔진과 package/lockfile이 복원되는지도 확인한다. 원격 publish, push,
merge, Git tag, GitHub Release 작업은 실행하지 않는다.
