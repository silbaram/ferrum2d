# CHANGELOG

Ferrum2D의 공식 공개 릴리즈 변경 기록이다. 정식 공개 전 내부 개발 이력은 커밋, PR, 개발 문서에 남기고, 이 파일에는 사용자와 배포자가 알아야 할 릴리즈 단위 변경만 요약한다.

형식은 Keep a Changelog 관례를 참고한다. 공개 beta는 prerelease 버전으로 기록하며, 첫 정식 버전은 `1.0.0`을 목표로 한다.

## Unreleased

### Added

- `createFerrumRuntime`에서 시작 에셋을 Data Scene 적용 전에 읽고 진행률과 결과를 제공한다.
  시작을 `AbortSignal`로 취소할 수 있으며, 실제 렌더러 종류와 WebGPU 대체 정보를 조회할 수 있다.
- 평면 Data Scene에서 `display.fit`이나 런타임 `fit` 기본값으로 월드 사각형을 캔버스에 맞출 수 있다.
  `runtime.dataScene.view`는 씬을 다시 적용하거나 전환한 뒤에도 현재 카메라와 배율로 좌표를 변환한다.
- Ferrum2D Studio의 게임 미리보기와 실행에서 씬의 `display.fit`을 적용한다. 2D로 돌아오면 편집 카메라와 배율을 복원한다.
- `createFerrumRuntime({ releaseCanvasContext: true })`는 런타임 전용 캔버스의 GPU 컨텍스트를 종료하거나 시작에 실패할 때 해제한다.

### Changed

- 캐릭터·지정 경로·step-motion이 없는 통합 강체 월드는 Rapier 일반 스텝과 연속 충돌 검사를 사용한다.
  첫 접촉 틱에서 일시적으로 겹칠 수 있으며 이전 배포판과 물리 결과와 리플레이 해시가 달라질 수 있다.
- 물리 실험실의 강체 장면 4개가 연속 충돌을 켠 채 실행되며, 벽돌 깨기 예제에서도 연속 충돌을 다시 켰다.

### Fixed

- Data Scene 적용 중 조명 사전 검증이 이미 해석한 문서를 재사용해 중복 검증 비용을 줄였다.
- Data Scene을 적용하거나 장면 상태를 복원할 때 조명 사전 검증도 호출자가 선택한 프래그먼트에서 탐색 장애물을 확인한다.
- 공간 씬 아틀라스 스모크를 고정 시간 입력으로 실행하고 스프라이트 애니메이션 스모크를 게임 루프의 짧은 간격 누적과 지원되는 진행 저장 경로에 맞췄다.
- 공간 렌더링과 HD-2D 전투 스모크가 지원되는 장면 상태·진행 저장을 사용하도록 고쳤다. 장치 복구·픽셀·핸들 및 전투 체크포인트 회귀 검사를 유지한다.
- WebGPU 장치 복구 중 캔버스 크기가 바뀌면 복구 완료 후 최신 크기에 맞춰 배율을 갱신한다. 게임 카메라 위치와 일시 정지 상태를 유지한다.
- 픽셀 퍼펙트 스모크에서 타일 검사에 레거시 Shooter 스냅샷을 사용하고 `linear-srgb` 검사에서 WebGPU 출력을 확인하도록 고쳤다.
- 평면 native 물리에서 Data Scene 레시피의 HD-2D actor가 이동하도록 solid AABB 콜라이더를 명시하고 문서 예시도 맞췄다.
- Linux Studio `.deb`의 Debian 패키지 이름을 `ferrum2d-studio`로 고정했다. beta.10은 Tauri가 제품명에서 만든
  `ferrum2-d-studio`였으며, 새 패키지가 이 이름을 `Replaces`/`Conflicts`로 대체해 업그레이드 설치 시 함께 정리한다.
- SDK 게임 루프가 0.1ms보다 짧은 브라우저 프레임 간격을 받으면 native 가변 시계가 거부해 멈추던 문제를 고쳤다.
  짧은 간격은 다음 프레임까지 누적한다. beta.10에 포함된 회귀다.
- 통합 물리에서 회전하는 중심 공이 30Hz 같은 긴 고정 스텝으로 벽에 부딪칠 때 `UnresolvedMotion`으로 멈추던 문제를
  고쳤다.
- 통합 물리에서 `configureAutoRigidBodyStep({ ... })`가 중력·연속 충돌을 바꿔도 `frame.physics`의 중력·`continuous`
  표시가 이전 값으로 남던 문제를 고쳤다. native가 수용한 값으로 갱신한다.
- `physics`를 생략한 HD-2D Data Scene의 heightSpan/AABB 주인공과 전투 이동이 옵션 없이 만든 엔진에서 거부되던 문제를
  고쳤다. 내장 장면에서 처음 전환하고 엔진 기본 물리 설정을 바꾸지 않았다면 문서대로 호환 물리로 실행한다.
  이미 실행 중인 Data Scene의 native world나 명시한 통합 물리는 바꾸지 않는다.

## 0.1.0-beta.10 - 2026-11-22

GitHub Release 설치용 열한 번째 beta 후보다. 2D·HD-2D 씬의 물리를 Rapier3D 기반 통합 물리로 확장하고,
코드 리뷰에서 확인한 저장 파일·프레임 오류 처리를 고쳤으며, 64명 군중 기준 물리 계산 시간을 절반 이하로 줄였다.
Ferrum2D Studio 데스크톱 설치 파일을 SDK와 함께 제공한다. 소스 package는 `0.1.0`/`private: true`를 유지하며,
GitHub staging의 네 설치 package는 `0.1.0-beta.10`으로 맞춘다.

### Added

- 기본 2D 씬과 공간 물리 씬에서 통합 물리(`physicsBackend()`가 `"unified-3d"`)를 사용한다. 강체, 캐릭터와
  움직이는 발판의 접촉, 관절, 지형, 충돌 쿼리와 진단을 연결했다. vendored Rapier3D 0.36.1/Parry3D 0.31.1을 쓴다.
- 게임 파일에 물리 상태와 자원을 함께 저장하고 복원한다. 바이너리 저장은 SDK와 Wasm의 빌드 정보를 확인한다.
- Ferrum2D Studio에서 Native 물리 씬을 작성하고 마을 씬을 플레이한다. Windows x64·macOS arm64·Linux x64 Studio
  설치 파일에 같은 릴리스의 Wasm을 내장한다.

### Changed

- `main` 대상 PR에서 CI 기본 검증을 실행하고, TypeScript 검사와 스모크가 같은 빌드 산출물을 사용한다.
- 예제 사이트의 스프라이트 그리기, 충돌과 트리거, 벽돌 깨기가 렌더러·에셋 준비, 화면 맞춤, 캔버스 컨텍스트 해제를 런타임에 맡긴다.
- Ferrum2D 개발·CI와 게임 생성·에이전트 CLI의 최소 버전을 Node.js 24로 올렸다.
  개발 저장소와 GitHub Actions는 Node.js 24 LTS를 사용한다.
- 출시 전 Studio 명칭을 패키지·명령·소스 경로·배포 파일에 적용했다. 보조 라이브러리는
  `@ferrum2d/studio-kit`, 앱은 `@ferrum2d/studio` / `@ferrum2d/studio-desktop`,
  생성 프로젝트는 `studio.html` / `ferrum:studio`를 사용한다. 이전 이름의 별칭은 제공하지 않는다.
- Studio 설치 식별자는 `com.ferrum2d.studio`, 업데이트 채널은 `studio-updater-*`다.
  설치 파일은 `ferrum2d-studio-*`, helper tarball은 `ferrum2d-studio-kit-*`로 생성한다.
  서명 키와 OS별 설치 검증은 계속 필요하다. 이미 공개한 beta.9 이하의 Assets/URL은 당시 이름 그대로다.
- dependency 필드명 변경에 맞춰 consumer project/consumer smoke report와 통합 distribution manifest를
  version 2로 올렸다. Studio Kit public helper 이름은 `StudioKit` / `FERRUM_STUDIO_KIT` 접두사를 사용한다.
- 군중 회피 판정을 바꿔 같은 입력에서도 64명 군중의 이동 궤적이 이전 빌드와 다르다. 405스텝 검사에서 목표 진행 합은
  1.3% 줄었고 최소 간격은 같다.
- Wasm은 약 10.5MB(gzip 3.7MB)다. 패키지 검사에 12MiB 상한을 두어 의도하지 않은 증가를 막는다.

### Fixed

- 회전 상자와 구의 연속 충돌 계산을 고쳤다. 물리 시간이 진행되기 전에 스텝이 거부되면 직전 틱의 진단과 저장 상태를 보존한다.
- 저장 파일 복원이 collider 형상·local pose에 공개 생성 API와 같은 범위를 다시 적용하고 solver hint를 contact graph와
  대조한다. half-extent를 1e30으로 바꾼 파일이 첫 update에서 Parry EPA를 중단시키던 문제를 `prepare` 단계 거부로 바꿨다.
- clock·native 준비·commit 실패로 native step을 건너뛴 frame update와 `stepRigidBodies`가 성공처럼 보이던 문제를 고쳤다.
  이제 `native physics step skipped` 오류를 던진다.
- 진행 0초로 거부된 tick의 legacy force/impulse/sleep 입력을 native rollback 안에서 되돌린다. Data Scene의 재시도는
  tween·scene update를 반복하지 않고 물리 단계부터 재개한다.
- 가변 시간 접촉 보정은 캐시된 fixture의 생성 frame 대신 world의 nominal step으로 계산한다.
- 일괄 충돌 query가 contact query와 같은 scene 계약을 따르고, 모든 행을 검증한 뒤에만 상태를 바꾼다.
- 군중 회피에서 Parry shape cast가 실제로 겹치는 경로를 놓치던 경우를 정확한 swept 캡슐 거리 계산으로 막는다.

### Performance

- 64명 군중(로컬 Chromium, 고정 50ms 입력)의 warm p95를 5스텝 프레임 66~72ms→28.3~28.9ms,
  스텝당 13.2~14.4ms→5.66~5.78ms로 줄였다.
  - wasm32 제곱근을 하드웨어 명령으로 계산한다(vendored libm 0.2.16, 결과 비트 동일).
  - 접촉 해결에서 이번 tick 안에 닿을 수 없는 캐릭터 쌍을 정확히 건너뛴다(결과 비트 동일).
  - 군중 회피와 캐릭터–상자 면 접촉을 GJK 대신 정확한 기하 계산으로 판정한다.

### Upgrade Notes

- 게임 생성·에이전트 도구와 생성 프로젝트는 Node.js 24 이상을 사용한다. 엔진, Studio Kit, 생성기·에이전트 도구의
  GitHub Release URL을 같은 beta.10으로 맞추고 JS/Wasm을 같은 tarball에서 갱신한다.
- 빌드 정보가 다른 바이너리 저장 파일은 복원하지 않는다. 버전을 바꾸기 전에 저장 파일을 백업한다.
- 옵션 없이 만든 엔진은 자동 강체 step이 켜져 있다. loop 실행 중 `stepRigidBodies`를 같이 호출하면 같은 frame에
  solver가 두 번 돈다. `configureAutoRigidBodyStep(false)`나 scene 일시 정지 뒤 사용한다. SDK는 처음 감지할 때 한 번 경고한다.

### Known Limitations

- Studio 설치 파일은 beta다. OS별 실제 설치와 GUI, 코드 서명·공증 상태는 별도로 확인한다. 이 버전의 Studio는 다음
  설치 파일을 직접 받아 업데이트한다.
- 군중 성능 수치는 로컬 Chromium 측정이다. 실제 게임 프로젝트와 목표 기기의 물리 성능은 별도로 확인해야 한다.

## 0.1.0-beta.9 - 2026-11-12

GitHub Release 설치용 열 번째 beta다. HD-2D 공간 렌더링, 조명·그림자, 픽셀 아트·애니메이션 제작과 프로젝트 업데이트
도구를 포함한다. 전체 변경과 설치·검증 정보는 GitHub Release 노트에 있고, 아래는 이 파일에 기록한 항목이다.

### Changed

- Ferrum2D Studio의 하단 패널을 기본 서랍으로 바꿨다. 탭 줄만 표시해 viewport를 넓히고,
  탭을 누르면 canvas 크기를 바꾸지 않고 펼친다. 핀 버튼으로 기존처럼 고정할 수 있다.
  Assets 탭은 에셋 격자만 표시하고 도구는 `Import`/`Manage` 메뉴에서 한 번에 하나씩 연다.
- Ferrum2D Studio에서 변경이나 문제가 있으면 상단에 `변경 N` 버튼을 표시하고, 누르면 My Changes(내 변경)를 연다.
  하단 탭 이름 Agent Changes(에이전트 변경)를 My Changes(내 변경)로 바꿨다. 에이전트에게 넘길 사용자 편집 내역이다.
  My Changes는 JSON 경로 대신 오브젝트·항목·이전/이후 값으로 보여 주며, 행을 누르면 그 오브젝트를 선택한다.
- Handoff `authoringEvidence`의 변경 목록이 씬 인스턴스를 id로 짝지어 비교한다. 중간 오브젝트를 지우면
  뒤 오브젝트가 모두 바뀐 것처럼 기록되던 문제가 없어지고, 삭제 한 건으로 기록된다.
- Ferrum2D Studio의 명령 검색을 `Ctrl+K`(Mac은 `⌘K`)로도 연다. `F3`도 그대로 동작한다.
  하단 상태 바에 현재 모드와 선택 상태에서 실제로 동작하는 단축키를 표시한다.
- Ferrum2D Studio 상단에 `File`/`Edit`/`View`/`Window`/`Tools`/`Run`/`Help` 메뉴바를 추가했다. 메뉴는 기존 명령을 호출만 하며, 860px 이하 좁은 화면은 기존 구성을 유지한다.
- Ferrum2D Studio 인스펙터의 회전 입력을 도 단위로 통일했다. 저장 형식은 `rotationRadians` 그대로다. 오브젝트 목록의 잠금은 아이콘으로 바꿔 평소에는 조용히 표시하고, 입력 컨트롤의 글꼴·높이 기본값을 맞췄다.
- Ferrum2D Studio의 도트 편집기 탭에서는 씬·인스펙터 패널이 탭 줄로 자동으로 접혀 캔버스가 넓어진다. 씬 탭으로 돌아가면 복원되며 저장된 레이아웃은 바뀌지 않는다.
- Ferrum2D Studio의 조명 설정을 보기 드롭다운에서 오른쪽 패널의 `Lighting` 탭으로 옮겼다. 좌·우·아래 패널은 접을 수 있고, 접으면 가장자리에 탭 줄이 남아 누르면 해당 탭이 열린다.
- `FerrumRuntimeRenderer`를 WebGL2/WebGPU 구체 클래스 교차 타입에서 구조적 렌더러 계약으로 분리했다.
  평면 custom renderer는 private GPU 상태나 모델·픽셀 마스크 기능 없이 주입할 수 있다.
  기존 `runtime.renderer`에서 백엔드 기능을 직접 호출하던 TypeScript 코드는 capability 확인이 필요하다.
  raw GPU texture 반환형과 URL-only texture load는 구체 renderer 참조를 사용한다.
  기본 renderer 선택과 public import 이름, Rust/Wasm ABI는 유지한다.
  [이전 방법](docs/engine/public-api/migration-guide.md#custom-renderer-계약-이전)을 참고한다.

## 0.1.0-beta.8 - 2026-10-12

GitHub Release 설치용 아홉 번째 beta 후보다. GPU 실행 시간과 Wasm 확보 용량을 공개 진단 API,
DebugOverlay 및 RuntimeProfiler에서 확인한다. 소스 package는 `0.1.0`/`private: true`를 유지하며,
GitHub staging의 네 설치 package는 `0.1.0-beta.8`로 맞춘다.

### Added

- `webgl2.gpuTiming: true`로 비동기 GPU timer를 켠다. 공식 runtime은 clear, sprite, 조명,
  physics debug 및 후처리 구간을 측정한다. 이전 frame의 유효한 결과만 밀리초와 frame ID로 제공한다.
- `engine.memoryStats().wasmLinearMemoryBytes`와 full frame sample에서 Wasm 모듈 전체의
  linear memory 확보 용량을 읽는다. memory growth 뒤의 새 buffer를 사용한다.
- `maxGpuFrameTimeMs`/`maxWasmLinearMemoryBytes` budget과 GPU sample 수·평균·최대값을 제공한다.
  미측정 frame을 0ms로 계산하지 않으며 측정값이 없는 budget은 `missingMetric`으로 실패한다.
- `/core`에서 `EngineMemoryStats`와 `RendererGpuTimingStats`를 export한다.

### Fixed

- GPU 진단의 query 수를 최대 4개로 제한하고 재사용한다. disjoint/context loss 결과는 폐기하며,
  render 예외에도 query를 종료하고 renderer destroy에서 해제한다.
- 실제 Wasm bytes 및 GPU query 결과가 DebugOverlay/profiler까지 전달되는 브라우저 회귀를 보강했다.
  두 색 공간과 DPR 1/2, 반복 자원 생성·해제, 미지원 환경을 함께 검사한다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 beta.8로 맞추고 JS/Wasm을 같은 tarball에서 갱신한다.
- GPU timer는 기본 비활성이다. 필요한 경우 `webgl2: { gpuTiming: true }`를 지정한다.
  renderer를 직접 사용할 때는 모든 측정 대상 pass를 `beginGpuTiming()`/`endGpuTiming()` 사이에 배치한다.
- public import 경로, 15-float/60-byte render command ABI와 Data Scene state version 3을 유지한다.
  custom renderer의 timer capability는 선택 사항이다.

### Known Limitations

- GPU 시간은 WebGL2 `EXT_disjoint_timer_query_webgl2` 지원 환경에서만 측정한다. native WebGPU timer는 미지원이다.
  GPU가 느리면 측정을 생략할 수 있으므로 상태와 sample 수를 함께 확인한다.
- Wasm bytes는 모듈의 확보 용량이다. 실제 사용 중인 Rust/JS heap이나 VRAM, 인스턴스별 사용량과 누수 여부는 측정하지 않는다.
- SwiftShader 브라우저 검증은 계측 연결의 근거이며 실물 GPU 성능 기준이 아니다. 실제 섬 게임과 실물 모바일 검수는 별도다.
- beta.7 이후의 문 collider/navigation obstacle binding, progress v5 및 로컬 엔진 설치 도구는
  현재 main에 커밋되지 않아 이 beta.8 후보에 포함하지 않는다.

## 0.1.0-beta.7 - 2026-10-04

GitHub Release 설치용 여덟 번째 beta다. Data Scene으로 탐험 게임을 만들 때 필요한 조사·수집,
길찾기·자동 이동·이동 애니메이션과 진행 저장·복원을 제공한다. 소스 package는 `0.1.0`/`private: true`를
유지하며 staging의 네 package를 `0.1.0-beta.7`으로 배포한다.

### Added

- `gameplay.primaryActor`와 선택적 입력 action으로 주인공, 근접/입력 조사 및 범용 아이템 수집을 실행한다.
  지원하지 않는 Data Scene 행동은 apply 전에 진단한다.
- 단일 XY navigation grid, 비용 변경과 `moveDataSceneActorTo`/`cancelDataSceneMove`/`dataSceneMoveStatus`를
  제공한다. Rust가 A* 경로와 AABB 충돌을 처리하고 pause/resume, 입력 취소, grid 변경 재탐색을 지원한다.
- `configureDataSceneMovementAnimation`으로 주인공의 idle/walk 네 방향을 기존 clip에 연결한다.
  같은 clip의 flip 변경은 재생 시간을 유지하며 수동 playback 명령은 자동 연결을 해제한다.
- `includeDataSceneProgress`로 제거된 authored entity, 소비된 once interaction, 현재 navigation을
  변수·lifecycle과 함께 복원한다. 문서 재적용 후 새 generation handle로 연결한다.
- 설치 문서와 consumer AI 안내서에 beta.7의 지원 범위, 설정 및 업그레이드 계약을 반영했다.

### Fixed

- Data Scene의 기본 playing 상태, 조사·수집 실행, recipe 지원 진단 및 reset 시 stale handle/grid 처리를 보완했다.
- 경로 이동이 작은 격자의 코너를 건너뛰거나 미소 속도에서 멈추는 문제, 큰 변위가 목적지를 넘는 문제를 수정했다.
  float32 셀 중심이 다른 칸으로 반올림되는 경로는 기존 이동을 보존하고 거절한다.
- 장애물 접촉 뒤 이동을 반복 요청해도 벽을 관통하지 않으며 접촉면에서 분리·접선 이동을 허용한다.
- 저장 payload의 잘못된 ID/중복/버전/격자와 오래된 apply metadata를 거절하고 이전 씬을 보존한다.

### Upgrade Notes

- engine/viewer/agents URL과 출처 metadata를 beta.7로 함께 맞추고 JS/Wasm을 같은 tarball에서 갱신한다.
  초기 설정 프로젝트에는 예제·viewer를 추가하지 않는다. 기존 AI 지침은 별도 디렉터리에 풀어 비교·병합한다.
- 기존 Data Scene의 주인공 조사·수집은 `gameplay.primaryActor`를 명시한다. 자동 이동에는 활성 native
  kinematic body, non-trigger AABB 하나와 navigation이 필요하다. 애니메이션 연결은 별도로 opt-in한다.
- 바깥 `GameStateSnapshot` version은 2, 신규 Data Scene state는 3이다. 기존 Data Scene v2를 읽지만
  이전 엔진은 새 v3 저장 파일을 읽지 못한다. 수동 animation 명령 뒤와 전체 reapply/restore 뒤에는 자동 연결을 다시 설정한다.
- public import 경로와 15-float/60-byte render command ABI는 유지한다.

### Known Limitations

- 자동 이동·애니메이션은 primary actor 한 명, 길찾기는 최대 4096칸의 수동 XY grid를 대상으로 한다.
  collider에서 격자를 자동 생성하거나 원/다각형/compound 전체 및 층간 경로를 회피하지 않는다.
- 진행 저장은 기본 binding으로 전체 apply한 단일 문서를 대상으로 한다. 위치·속도·이동 경로·runtime playback,
  timer/FSM·추가 spawn은 저장하지 않는다. 실제 섬 게임의 전체 플레이 검증은 포함하지 않는다.
- normal map, 높이별 shadow receiver, 차폐 광선, view-depth/DOF와 3D 렌더링은 추가되지 않는다.

## 0.1.0-beta.6 - 2026-10-04

GitHub Release 설치용 일곱 번째 beta다. AI가 설치된 엔진의 기능을 찾고 사용하는 안내서를
consumer agents에 포함한다. runtime API와 Rust/Wasm 동작은 beta.5와 같다. (#76)
소스 package는 `0.1.0`/`private: true`를 유지하고 staging의 네 package를 같은 beta.6으로 배포한다.

### Added

- 28개 게임 요구사항을 공개 API·사용 조건·상세 문서로 연결하는 `.agents/harness/ferrum-feature-guide.md`를 추가했다. 최근 기능의 최소 버전, 설정 예시 3개, 미지원/후속 설계와 검증 절차를 포함한다.
- Codex/Claude/Gemini의 root 지침과 공통 harness에서 기능 구현 전에 안내서, 설치된 runtime 타입, 같은 버전의 reference를 확인하도록 연결했다.

### Changed

- 설치 문서와 runtime README를 GitHub Assets 설치 흐름에 맞추고 beta.6을 기본 설치 대상으로 안내한다. 초기 설정에는 게임 코드·예제·viewer를 생성하지 않는다.
- 패키지 검사와 실제 consumer smoke에서 기능 안내서의 포함·내용·참조를 확인한다. report validator와 fixture의 필수 AI 파일 수를 43개로 맞췄다.

### Upgrade Notes

- 사용 중인 engine/viewer URL, `ferrum:agents` URL과 출처 metadata를 같은 beta.6으로 맞춘다. 초기 설정 프로젝트에 viewer나 예제를 추가하지 않는다.
- 기존 agents 파일은 재설치만으로 교체되지 않는다. beta.6 agents를 빈 임시 디렉터리에 설치해 새 안내서와 root/development/presentation 연결 지침을 사용자 수정과 비교·병합한다. 무조건 `--force`로 덮어쓰지 않는다.
- 새 안내서의 기능 설명/링크 기준은 runtime beta.5이며 beta.6 API도 같다. 설치 버전과 공개 타입을 최종 확인한다. 런타임 동작이나 공개 import 경로의 breaking change는 없다.

### Known Limitations

- 기능 안내서는 API 전수 명세나 자동 capability 판별기가 아니다. 이전 runtime의 지원 여부는 설치 타입과 같은 버전의 reference로 확인한다.
- normal map, 높이별 shadow receiver, 차폐 광선, view-depth/DOF와 3D 엔진 기능은 이번 배포에 추가되지 않는다.

## 0.1.0-beta.5 - 2026-10-04

GitHub Release 설치용 여섯 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고,
배포 staging의 네 package를 `0.1.0-beta.5`로 고정한다. #73 B2 alpha 그림자와 C1 후속 설계,
리뷰 수정을 포함한다. (#75)

### Added

- Data Scene의 `visual.shadow.shape: "alpha"`로 현재 atlas frame의 투명 윤곽을 지면에 투영한다.
  프레임·UV 반전·회전·원점·scale을 따르며 기존 ellipse/box와 caster budget을 유지한다. (#73 B2)
- normal map, receiver 높이·층, 차폐 광선, view-depth/DOF의 범위·비용·fallback을 독립 후속 설계로 정리했다.
  이 네 효과의 런타임 구현이나 consumer A1~A4 이식을 포함하지 않는다. (#73 C1)

### Fixed

- 태양 방향과 지면 압축을 렌더 명령과 함께 확정해 다음 frame 설정 변경이 현재 frame의 그림자 투영을 바꾸지 않도록 했다.
- 렌더 검증용 snapshot에서 projection metadata도 복사해 엔진 파괴·메모리 재사용 뒤 저장한 값이 바뀌지 않도록 했다. RenderTexture의 alpha 픽셀과 잘못된 metadata 거절 후 기존 이미지 보존 검증을 추가했다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않으며 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 기본 ellipse/box와 공개 import 경로, 15-float/60-byte render command layout을 유지한다. `shape: "alpha"`는 선택 기능이며 JS와 Wasm은 같은 runtime tarball로 함께 업데이트한다.
- custom renderer는 flag 32와 `groundShadowProjection` metadata를 함께 처리해야 한다. 보관하는 frame은 command buffer뿐 아니라 projection typed array도 복사한다.

### Known Limitations

- alpha 그림자는 2D 이미지의 지면 투영 근사다. normal map, 높이·층별 receiver, 차폐 광선, view-depth/DOF는 C1 설계이며 런타임 구현은 포함하지 않는다. #73 A1~A4의 별도 게임 이식도 포함하지 않는다.
- WebGL2 legacy/linear-sRGB 및 WebGPU legacy를 검증했다. WebGPU linear-sRGB는 기존 WebGL2 fallback을 사용하며, 실물 GPU/mobile 성능 검증은 별도다.

## 0.1.0-beta.4 - 2026-10-04

GitHub Release 설치용 다섯 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.4`로 고정한다. #73 B1 입력 API와 후속 리뷰 수정을 포함한다. (#74)

### Added

- `InputManager`에 임의 키·복수 키 바인딩과 JSON action/axis profile을 추가했다. `actionSnapshot()`으로 현재 입력과 프레임 사이의 짧은 누름·해제를 함께 읽을 수 있다.
- `setEnabled()`/`clear()`로 모달·포커스 전환·씬 재시작 때 gameplay 입력을 취소하고, `setVirtualInput()`으로 앱의 가상 입력을 source별로 합성한다.
- `VirtualControls.subscribe()`와 실제 tarball의 `/core`를 사용하는 입력 browser smoke를 추가했다.

### Fixed

- 키·포인터·게임패드·가상 입력을 함께 사용할 때 일부 해제가 다른 source를 지우거나, 모달·창 전환 뒤 held 입력이 다시 살아나던 문제를 수정했다.
- canvas와 가상 버튼/joystick의 마우스 버튼 조합, open Shadow DOM 입력칸, touch fallback 좌표, canvas 소유 창의 gamepad 처리와 잘못된 profile 검증을 보완했다.
- 입력 취소 콜백이 실패해도 리스너·DOM과 runtime 소유 자원 정리를 계속한다. 초기화 실패 시 생성한 physics scene/streaming wrapper를 정리하고 원래 오류와 외부 객체 소유권을 보존한다.

### Upgrade Notes

- 사용 중인 engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않으며, 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 공개 import 경로, 기존 9-field `InputSnapshot`과 Wasm ABI는 유지한다. `pressedActions`는 기존처럼 held 목록이며, 한 번의 누름 처리는 `justPressedActions`를 사용한다.
- `actionSnapshot()`의 edge는 읽으면 소비하므로 프레임마다 한 번 읽고 여러 처리기가 공유한다. `clear()`는 대기 중 edge도 취소한다.
- 입력 비활성화는 시뮬레이션 pause나 클릭 이동 목표를 바꾸지 않는다. 앱의 pause·경로 취소 정책을 함께 연결하고, 초기화된 게임패드는 매핑된 모든 control의 중립 상태를 한 번 확인한 뒤 다시 활성화한다.

### Known Limitations

- context는 단일 gameplay enable gate다. context stack이나 UI/gameplay action 우선순위 router는 제공하지 않는다. 게임패드 poll 사이의 짧은 전환은 관찰할 수 없다.
- #73의 소비자 게임 작업 A1~A4, B2/C1과 기존 게임의 입력 이행은 이 릴리스에 포함하지 않는다. 실물 모바일·게임패드 조합 검증은 남아 있다.

## 0.1.0-beta.3 - 2026-10-04

GitHub Release 설치용 네 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.3`으로 고정한다. #68~#70 구현과 후속 리뷰 수정을 포함한다. (#71)

### Added

- Data Scene 캐릭터마다 독립적인 atlas animation set과 clip/frame/방향/일시정지 전환을 제공한다. 같은 texture를 공유하면서 여러 entity를 하나의 batch로 갱신하고, 잘못되거나 stale한 handle이 있으면 batch 전체를 거부한다. (#68)
- `groundYScale`과 ground/upright sprite로 2.5D 지면 투영을 제공한다. 카메라·입력·조명·문자·particle·collider debug가 같은 투영을 사용하고, world/physics 데이터는 그대로 유지한다. (#69)
- 태양 방향광과 ellipse/box 지면 그림자를 제공한다. sprite의 발 위치·회전·이동과 연결하며, 정적 그림자 cache와 화면 culling, caster 상한으로 비용을 제어한다. (#70)
- 공개 API recipe와 packed runtime의 WebGL2 및 WebGPU offscreen 픽셀·자원·비용 검증을 추가했다.

### Fixed

- 지면 투영에서 원점이 다른 직립 sprite와 world text의 깊이 정렬이 화면의 발·문자 block 위치를 따르도록 수정했다.
- 타원형 점광원의 세로 반경을 그림자 거리·외삽·차폐물 culling과 geometry cache에 반영했다.
- 최소 `groundYScale: 0.01`이 Wasm f32로 반올림된 뒤 renderer 검증에서 거부되던 문제를 수정했다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않는다. 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 기본 `groundYScale: 1`과 기존 animation은 유지한다. `animation`과 `animationSet`은 동시에 지정할 수 없다. reapply 뒤 새 entity handle로 animation/camera/label을 다시 연결한다.
- 투영과 태양 그림자는 선택 기능이다. `createDataSceneView`의 snapshot/lighting을 같은 frame에 공유하고, 사용자 renderer는 투영 capability와 새 render flag를 지원해야 한다.
- 공개 import 경로와 15-float/60-byte render command ABI는 유지한다. 새 frame metadata와 render flag가 있으므로 JS와 Wasm은 동일한 release tarball로 함께 업데이트한다.

### Known Limitations

- 2.5D는 평면 world의 지면 투영과 직립 sprite 표현이다. 3D renderer, PBR/normal map, sprite alpha 윤곽 그림자나 임의 높이의 그림자 수신면은 제공하지 않는다.
- WebGPU 검증은 실제 device/WGSL/queue/readback을 사용하는 offscreen 방식이다. headless native canvas presentation과 실물 GPU/mobile 성능 검증은 포함하지 않는다. linear-sRGB는 WebGL2 fallback을 사용한다.

## 0.1.0-beta.2 - 2026-10-04

GitHub Release 설치용 세 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.2`로 고정한다. #62~#65 구현과 후속 리뷰 수정을 포함한다. (#66)

### Added

- Data Scene sprite와 같은 entity에 optional static/kinematic body와 heightSpan을 연결한다. 물리 이동과 sprite 위치를 별도로 동기화할 필요가 없다. (#64)
- Rust camera follow/bounds/smoothing과 `createDataSceneView`를 추가해 camera, zoom, pointer, world label/light/occluder 좌표를 같은 viewport에 연결한다. (#65)
- 공개 API recipe와 실제 runtime tarball 기반 Data Scene browser 검증을 추가했다.

### Fixed

- sprite origin, tint/alpha, sortOrder를 렌더링에 반영하고 회전된 pivot의 culling을 수정했다. (#62)
- Data Scene은 render layer를 먼저 정렬하고 `depthSort: "hd2d"`를 명시한 sprite에만 높이·발 위치 정렬을 적용한다. heightSpan만 추가해 배경 순서가 바뀌던 문제를 수정했다. (#63)
- Placement Viewer와 생성 프로젝트의 선택 영역·표시가 origin/rotation/scale을 반영하며 회전된 primitive의 크기 조절과 runtime body/depth/tint metadata 보존을 수정했다.
- renderer별 색 공간 옵션을 Data Scene 초기 적용/reapply/transition에 동일하게 전달하고 충돌하는 옵션은 적용 전에 거부한다.
- Data Scene reset/reapply 후 이전 entity handle이 새 객체를 가리키지 않도록 generation을 유지·증가시킨다.

### Upgrade Notes

- engine/viewer/agents URL과 릴리스 출처 metadata를 같은 버전으로 맞춘다. 초기 설정 프로젝트에는 viewer나 예제를 추가하지 않는다. 기존 AI 지침은 별도 디렉터리에 설치해 비교·병합한다.
- 수동 sprite origin/색조 보정 코드는 중복 적용되지 않도록 확인한다. Data Scene 색은 `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`만 허용하며 다른 CSS 색 표현은 오류로 진단한다.
- 높이·Y 정렬을 사용할 sprite에는 `depthSort: "hd2d"`를 지정한다. reset/reapply 뒤 새 entity handle로 camera follow와 label anchor를 다시 연결한다.
- 공개 import 경로와 15-float render command ABI는 유지한다. JS와 Wasm은 동일한 release tarball로 함께 업데이트한다.

## 0.1.0-beta.1 - 2026-10-03

GitHub Release 설치용 두 번째 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.1`로 고정한다.

### Changed

- 초기 설치 지침은 엔진·개발 도구·AI 지침만 설치하고 게임 제작 요청을 기다리도록 정리했다. Release 설치 안내에서 이 경로와 선택형 예제 생성을 구분한다.
- consumer 공통 지침에 플레이 공간·카메라·HUD·에셋 설계와 장르별 예외를 추가하고 Codex·Claude·Gemini가 같은 기준을 참조하도록 했다. 기능 검증과 실제 브라우저 플레이 경험 검수를 분리한다. (#59, #60)
- 기존 AI 지침은 자동으로 덮어쓰지 않는다. 업데이트 시 빈 디렉터리 설치 후 비교·병합하도록 CLI 안내와 설치 보존 검사를 보강했다.

### Fixed

- consumer template catalog 조회를 설치 버전에 맞는 GitHub Release tarball 경로로 안내하고 npm 12의 외부 URL 정책을 반영했다.
- 초기 설치의 게임 파일/빈 디렉터리 생성 방지, 기존 게임 소스·데이터·사용자 지침 보존, 패키지에 포함된 공통 지침 참조 검사를 보강했다.
- 문서 사이트의 저장소 증거 링크를 수정했다.

### Upgrade Notes

- 엔진 public API와 Wasm ABI 변경은 없다. 엔진·viewer·agents URL과 릴리스 출처 metadata는 같은 버전으로 맞춘다.
- `ferrum:agents` 재실행은 기존 파일을 보존한다. 새 지침을 별도 빈 디렉터리에 설치해 기존 skill/agent/command와 루트 managed block을 비교·병합한다.
- 기존 게임의 화면을 자동으로 재설계하지 않으며, 게임 제작·변경 요청 시 새 검수 기준을 적용한다.

## 0.1.0-beta.0 - 2026-10-03

GitHub Releases의 설치 패키지로 제공하는 첫 공개 beta다. 소스 package는 `0.1.0`/`private: true`를 유지하고, 배포 staging의 네 package를 `0.1.0-beta.0`으로 고정한다.

### Added

- GitHub Releases의 tarball로 게임 프로젝트를 생성하고 동일 버전의 엔진·뷰어·선택형 AI 도구를 연결하는 설치 경로와 로컬 배포 묶음 검증을 추가했다.
- WebGL2 RenderTexture, opt-in linear-sRGB 색 공간, GPU 자원 통계와 씬 전환 누수 검증을 추가했다.
- KTX2/Basis 압축 텍스처의 Worker 변환과 이미지 fallback, 선택형 비동기 셰이더 준비와 로딩 진행 표시를 추가했다.
- Rust + WebAssembly 기반 2D browser game runtime과 TypeScript platform layer를 제공한다.
- WebGL2 기본 렌더러와 선택형 WebGPU renderer fallback 구조를 제공한다.
- Top-down Shooter, Minimal, Platformer, Breakout starter/template 흐름을 제공한다.
- Game Spec, Physics Spec, Scene Composition, Behavior Recipe, deterministic replay 기반의 data-driven authoring 흐름을 제공한다.
- `@ferrum2d/create-game`으로 새 consumer game project를 생성하는 CLI 흐름을 제공한다.
- `@ferrum2d/agents`로 Codex, Claude, Gemini용 consumer game development agent/skill/command를 설치하는 흐름을 제공한다.
- 생성 프로젝트의 `ferrum:report`, `ferrum:validate`, `ferrum:smoke`, authoring/replay/runtime replay report 루프를 제공한다.
- npm package, consumer smoke, browser smoke, runtime budget, release metadata 검증 흐름을 제공한다.

### Changed

- 프로젝트 기준을 MVP baseline에서 상용제품 기능 개발 단계로 정리했다.
- consumer project는 `@ferrum2d/ferrum-web` public entrypoint만 사용하도록 package/import 경계를 정리했다.
- visual editor 중심이 아니라 AI agent-first 2D game engine 방향에 맞춰 spec, template, validation, smoke artifact 중심의 개발 루프를 정리했다.

### Fixed

- 프로젝트 경로의 셸 인용, 설치 smoke의 실패 보고서 갱신과 시간 초과 시 하위 프로세스 정리를 보완했다.
- consumer browser smoke가 실제 렌더 완료 직후 픽셀과 비용을 측정하도록 수정하고, Chrome 미설치 시 전체 Chromium을 사용하도록 했다.

### Known Limitations

- 정식 `1.0.0` 공개 전까지 public API, package 구조, template contract는 변경될 수 있다.
- visual editor, multiplayer, full game loop Worker migration, Wasm threads, complex physics, 3D rendering은 별도 설계/승인 전 제품 범위에 포함하지 않는다.
- Windows 네이티브 Placement Viewer 검증과 native KHR 지원 실물 GPU/mobile 성능 검증은 남아 있다. 새 renderer 기능별 native WebGPU 지원 범위는 각 API 문서의 fallback 정책을 따른다.
