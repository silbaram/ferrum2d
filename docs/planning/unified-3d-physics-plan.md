# 2D·HD-2D 통합 물리 고도화

상태: 개발 진행 중. 공개 Web 연결의 제한된 범위는 Core API 문서에 명시하며, 전체 통합 완료로 간주하지 않는다.

## 현재 수용 현황

2026-11-16 통합 기록에 2026-11-21의 군중 브라우저, CCD 오류 복구, 복합 충돌·대형 지형 및 최신 빌드 제품 검증을 반영했다.
이전 실행의 소스와 검증 범위는 로컬 `artifacts/physics-3d/progress.json`에 기록돼 있다.
아래 9개 범주의 최종 완료는 아직 아니다.

| 범주 | 현재 구현·범위 검증 | 남은 수용 |
| --- | --- | --- |
| 1. 통합 물리 기본 실행 | 무옵션 Rust/Web의 Native PlanarXy·자동 가변 시간 정책, 내장 씬·이동·경로 탐색, Rust 및 Chromium의 64명 군중 회귀 | 최신 SDK·브라우저와 전체 실행 경로의 최종 통합 |
| 2. 작성 경로 | 그래픽 타일맵, Native component template·prefab 상속, Studio에서 실제 GLB 불러오기와 물리 씬 저장·재열기, 기본 마을의 Native 공간 물리와 Play/Stop, 설치된 템플릿 4종 | Studio 편집·기본 마을 브라우저 회귀 통과. 검증 빌드는 아래 기록 참조 |
| 3. 외부 파일 저장·복원 | 바이너리 파일과 세션 교체, 실제 자원 복원, 손상·한도 초과 시 기존 게임 유지, 설치 템플릿 4종 재실행 | 검증한 공개 한도와 자원 종류는 아래 기록 참조. 전체 capability·할당 경계의 최종 수용 |
| 4. 동적 물체·캐릭터 결합 | 유한 질량·관성, 접촉 응답·운반·외력, 실제 지지점, 동시에 미는 물체와 끼임, 회전 발판과 고정 벽의 틱 내 접촉 후 보행 | 검증한 복합 접촉 사례와 실행 범위는 아래 기록 참조 |
| 5. 실제 경로·회전 CCD | 원 Native kernel·piecewise 경로, F32 경계와 틱 작업량, 회전 발판에서 고정 벽에 닿은 뒤의 잔여 이동 | 회전·근접 접촉의 전체 수용 범위는 검증된 형상·이동 조합별로 판정 |
| 6. 지형 통합 | 보간·query/시야·impact/feedback·chunk/span grouping, Chromium 64·1,024·4,096셀의 저장·복원·재생 | 전체 자원·경로의 통합 검증 |
| 7. 자원·물리 품질 | 64명 일반 프레임 통합 검사와 50ms 고정 입력 첫 업데이트, 32명 마을 전투, 지형 3종의 스텝·저장·복원 시간과 Wasm 선형 메모리 측정 | 64명 장면의 125ms 상한 통과. 목표 기기 검증은 9번에서 진행 |
| 8. 전체 제품 | Native·WASI·Clippy, 배포 Wasm·SDK, 패키지 4종과 설치 템플릿 4종, 64명 통합 브라우저, Studio 기본 마을 플레이와 적 32명 전투 | 원격 CI 실행 |
| 9. 실게임·실기기 | Top-down Shooter 예제로 Windows 11·Chrome·Radeon 8060S에서 예행 검증 | 개발 완료 뒤 실제 게임 프로젝트와 목표 기기에서 최종 검증 |

2026-11-21에 배포용 Wasm과 SDK를 새로 빌드해 Chromium에서 64명 군중을 검증했다. Rust 업데이트
최댓값은 일반 프레임 102.6ms, 50ms 고정 프레임 122.5ms로 기존 125ms 상한을 통과했다.
50ms 조건에서 수정 전후의 64명 위치와 경로 탐색 통계가 일치했고, 체크포인트를 복원한 뒤의
6스텝 재생과 Rust 선별 회귀 11건이 통과했다.

초기 통합 검사에서 CCD 오류 복구용 상자가 실제 작업량 한도를 넘지 않았다. 상자가 한 틱 안에
경사 메시를 가로지를 속도로 장면을 조정해 실제 한도 초과를 재현했다. 자동과 두 수동 실행에서
첫 구간이 적용되기 전에 거절됐고, 위치·속도·시간 보존과 체크포인트 복원, 장애물 제거 후 재시작을
확인했다. 같은 Wasm으로 `pnpm smoke:unified-physics-web` 전체가 통과했다.
군중 원본 측정과 복구 실행 로그는 로컬 `artifacts/physics-3d/wasm-crowd-performance/`와
`artifacts/physics-3d/ccd-error-recovery/`에 각각 기록했다.

복합 충돌·지형 Rust 회귀 113건과 지형 규모별 비용 시험을 통과했다. 4,096셀은 고정 바디
64개로 묶이며, 한 셀을 교체한 뒤에도 인접 셀의 충돌체 식별자가 유지됐다.
Chromium 파일 저장에서 8 MiB를 넘는 배포 Wasm의 동기 컴파일이 거절돼 메모리 한도를 적용한
독립 모듈을 비동기로 컴파일하도록 SDK를 수정했다. 관련 SDK 선별 회귀 48건이 통과했다.

수정한 SDK를 패킹해 각 크기를 새 Chromium 컨텍스트에서 3회 실행했다. 모든 실행에서 공개
게임 파일의 복원과 6스텝 재생 결과가 일치했다. 4,096셀의 120개 수동 물리 스텝 p95
중앙값은 9.1ms였다. 저장 시간 중앙값은 381.7ms, 복원은 221.9ms였고 파일은
1,723,782바이트였다. 원본 엔진의 확보된 Wasm 선형 메모리는 실행 후 10.875 MiB,
저장 후 19.125 MiB였다. 측정 원본은 로컬 `artifacts/physics-3d/complex-contact-terrain/`에 기록했다.
같은 패키지로 `pnpm smoke:unified-physics-web`을 다시 실행해 전체 통과를 확인했다.

Top-down Shooter 예제의 배포판을 Windows 11의 Chrome 158에서 예행 검증했다. WebGL2는
Radeon 8060S와 Direct3D 11을 사용했다. 브라우저 키보드·마우스 입력으로 엄폐물에서의 정지와
우회, 첫 웨이브에서의 명중·득점과 피격 후 재시작을 확인했다. 통합 물리 모드에서 전투 중
`.f2d` 파일을 저장하고 열어 게임 시간·점수·플레이어 위치와 에셋을 확인했다. 손상 파일은
현재 게임을 보존한 채 거절됐다. 브라우저 입력과 측정 기록은 로컬
`artifacts/physics-3d/topdown-device-rehearsal/`에 있다.

### 첫 제품 검증

Core Native 단위 3,735건과 통합 1건, Clippy 및 외부 저장소 검사, Rapier 저장 102건과 Parry
쿼리 7건이 통과했다. 독립 Rapier 잠금 파일을 포함해 새 체크아웃에서도 `--locked`로 해당 검사를
실행할 수 있다. 배포 Wasm은 소스 지문 `52ba4449ee8df0c3`과 일치했다. Node 22의 SDK 테스트
2,037건, Web 제품 빌드, 패키지 4종의 tarball 검사와 Wasm 라이선스 고지 검증이 통과했다.

Minimal, Top-down, Platformer, Breakout 설치 검사와 보고서 검증이 통과했다. 각 실행에서 `.f2d`의
손상 파일이 실행 엔진을 보존한 채 거절됐고, 유효한 파일을 복원해 다시 저장한 SHA-256과 길이가
일치했다. 이어서 6프레임 동안 게임 시간이 전진했다. Studio에서 실제 GLB 모델 불러오기와
별도의 저장 허용 빌드에서 Native 물리 씬 저장·재열기를 확인했다. Top-down 오브젝트 밀집과
타일맵 성능 검사도 통과했다.

- WASI에서는 회전 발판 테스트가 `response_at`의 작업량 한도에 도달해 `CapacityExceeded`로 중단됐다.
  같은 WASI 바이너리와 Node 22·24에서 재현했다. 중단 뒤 남은 시험을 같은 바이너리로 이어서
  실행해 단위 3,734건 통과, 1건 실패, 2건 제외를 확인했다. 통합 1건과 의도한 중단 검사의
  격리 실행은 통과했다.
- Chromium 통합 검사에서 64명 전진과 체크포인트 재생은 일치했다. Rust 업데이트 최댓값이
  두 번의 통합 실행에서 130ms와 181.6ms로 125ms 상한을 넘었다. 같은 Chromium의 선별 50ms
  고정 프레임 비교에서도 이전 Wasm은 157.5ms, 현재 Wasm은 156.9ms였다. 통합 검사에서 중단 뒤
  실행되지 않은 기능은 동일 tarball에서 이어서 확인했다.
- Studio 기본 `hd2d`·`village` 경로는 마을 문서의 공간 액터 구성에서 거절됐다. 입력 문서는
  기존 kinematic·heightSpan 정의를 사용하며, 현재 Native 공간 액터에는 공간 물리와 등록된
  캐릭터가 필요하다. 진단 서버에서 공간 액터 항목만 제거했을 때 46개 인스턴스가 로드되고
  렌더가 시작됐다. 기본 마을의 플레이를 위해 Native 작성 데이터 전환이 필요하다.

검증에는 `cargo fmt`, `cargo clippy`, `cargo test`, `pnpm test:physics3d-storage`,
`pnpm test:physics3d-queries`, `pnpm test:rust-wasi`의 실행 스크립트, `pnpm lint`, `pnpm test:web`,
`pnpm build:wasm`, `pnpm build:web`, `pnpm smoke:unified-physics-web`, `pnpm smoke:scene-physics`,
Studio 저장·템플릿 브라우저 검사와 `pnpm package:consumer-smoke`를 사용했다. 실행 로그와 보고서는
로컬 `artifacts/physics-3d/product-verification/`에 있다. GitHub Actions의 수동 CI는 이 변경의
원격 실행 기록이 아직 없다.

### 회전 발판과 64명 브라우저 후속 수정

회전 발판의 정규화 스케일이 음수인 구간에서 원래 좌표 격자 계산이 일찍 끝나면, 남은 좌표를 더
비싼 시간 순서 탐색으로 검사했다. 원래 두 좌표 집합의 범위를 같은 공통 작업 예산에서 계속
검증하도록 수정했다. 기존 안전 자세, 발판의 운동과 캐릭터의 접선 운동, 후보의 남은 전체
이동 경로, 공유 작업량 상한을 검증한다. 실패 구간의 기록을 재현하는 테스트를 추가했고,
Native·WASI Node 22의 선별 57건과 Node 24의 원본 한 바퀴 테스트를 통과했다.

캐릭터 간 접촉 계산에서는 같은 풀이 중 두 콜라이더의 자세, 속도, 남은 시간의 비트가 일치하는
경우 이미 충돌이 없다고 확인한 직선 검사 결과를 재사용한다. 50ms 프레임으로 비교한 64명
장면의 Rust 업데이트 최댓값은 수정 전 91.3~95.8ms, 수정 후 65.9~68.8ms였다. 두 빌드의
위치·경로 탐색 상태 해시가 일치했고 각각 체크포인트를 복원한 뒤 6스텝을 정확히 재생했다.
소스 지문 `24aaca382489e1c2`의 배포 tarball에서 통합 브라우저 검사와 125ms 성능 상한을
통과했다. 이 실행의 Rust 업데이트 최댓값은 88.9ms였다.

통합 소스에서 Native와 WASI의 단위 테스트가 각각 3,736건, 통합 테스트가 각각 1건 통과했다.
WASI의 의도된 중단 검증, Clippy, SDK 2,037건, 패키지 검사와 템플릿 4종의 재생 보고서도 통과했다.
실행 기록은 로컬
`artifacts/physics-3d/wasi-rotating-platform/`와 `artifacts/physics-3d/crowd-optimization/`에 있다.

### Studio 마을 후속 수정

기본 `hd2d`·`village` 문서와 Blender 생성 스크립트에 공간 물리, 캡슐 캐릭터와 명시적
장애물 충돌체를 적용했다. 평지의 상단 높이를 유지하면서 바닥 충돌체에 두께를 주고 다리
바깥 강둑에 충돌체를 추가했다. 같은 배포 Wasm을 사용한 Studio Play에서 건물·우물 앞 정지,
다리 횡단, 강둑 정지와 경사로 왕복을 확인했다. Stop과 Undo 뒤에는 작성 문서가 재생 전과
일치했다. 마을 로드 검사에서 두 주소 모두 모델 42개와 등록된 Native 캐릭터를 확인했다.
이전 문서에서 실행 액터만 제외해 렌더한 편집 화면과 전환한 문서에서 모델 삼각형 13,812개와
드로 호출 201개가 일치했다. 두 실행 모두 99개가 방향광 그림자 호출이었다.
브라우저 실행 기록은 `artifacts/physics-3d/studio-native-village/`에 있다.

같은 Wasm(`1f66410d…`)으로 Studio 편집 브라우저 검사와 마을 전체 검사가 통과했다.
마을 검사는 Chromium 153·Radeon 8060S에서 DPR 1·2의 지형·격자·카메라, 배치와 Undo,
장애물 앞 정지, 다리 횡단, 문서 재열기를 확인했다. 관련 Studio 단위 검사는 94건이 통과했다.

별도의 마을 전투 품질 검사에서 적 32명과 투사체를 함께 실행했을 때, 초기 빌드는 약 1.1초에
물리 작업량 상한에 도달했다. 중단 직전 투사체 56개 생성과 명중 1건을 기록했다.
적 32명의 시작 위치를 Native 물리 쿼리로 검사해 장애물과의 겹침 및 바닥 지지를 확인하도록 했다.
투사체 상자와 캐릭터 캡슐의 연속 충돌 검사를 수정한 뒤 같은 입력을 7.20초까지 재생해
투사체 392개와 명중 79건을 확인했다.

브라우저 프레임 간격에 따라 별도로 재현된 건물 수직 모서리, 캡슐 끝 사이의 높이 차,
경사로 옆 모서리에서도 이동 구간의 분리와 실제 접촉을 판정하도록 수정했다. 기존 작업량 상한에서
Radeon의 실패 기록 255프레임과 SwiftShader의 실패 기록 118프레임을 끝까지 재생했다.
후자에서 이동 입력을 놓은 상태로 9프레임 더 진행했을 때 게임 시간 6.2834초, 적 32명,
투사체 336개와 명중 76건을 기록했다.

소스 지문 `35c0c766fc508d52`로 만든 배포 Wasm은 SDK 패키지와 Studio 빌드에서 SHA-256이
일치했다(`1f3a3152ddac20e4…`). 이 패키지로 Chromium 153·Radeon 8060S에서 환경 효과와
모델 LOD를 각각 켜고 끈 네 조합을 두 번씩 실행했다. 8회 모두 적 32명의 AI, 발사·명중,
경사로 왕복, 입력 해제 후 1초간 전투, 체크포인트 복원·재개와 자원 회수를 통과했다.
측정 구간의 Rust 업데이트 최댓값은 41.0ms, 렌더 최댓값은 11.5ms였다.
같은 Chromium에서 SwiftShader로 실행한 8회도 통과했다. Rust 업데이트 최댓값은 75.8ms,
렌더 최댓값은 188.9ms였다. 두 환경 모두 드로 호출은 프레임당 최대 203회였고 측정 중 모델
업로드는 0바이트였다. 로컬 보고서는 `artifacts/village-game-quality/run-NdnjJx/report.json`과
`artifacts/village-game-quality/run-XofTm4/report.json`에 있다.
최종 Studio 빌드로 편집 브라우저 검사와 기본 마을 전체 검사를 다시 통과했다.
마을에서 엔티티 46개와 모델 42개를 로드했으며, 같은 Radeon에서 DPR 1과 2를 검사했다.

같은 소스에서 Native와 WASI 단위 테스트가 각각 3,742건, 통합 테스트가 각각 1건 통과했다.
WASI의 의도된 중단 검사, Clippy, Web 패키지의 공개 타입·tarball과 템플릿 4종의 체크포인트
재생도 통과했다. 배포 패키지로 64명 군중의 Rust 업데이트 최댓값은 77.4ms였으며,
체크포인트 복원 뒤 6스텝이 일치했다.

### 복합 접촉과 저장·자원 검증

회전 발판에 선 캐릭터가 60Hz 한 틱 도중 고정 벽에 처음 닿는 경우, 벽이 없으면 정상적으로 이동했고
벽을 놓으면 그 틱을 반영하기 전에 이동이 거부됐다. 벽·캡슐 사이의 실제 간격을 계산할 때
같은 시간에 일어나는 발판 회전과 캐릭터의 상대 이동을 함께 평가하도록 수정했다. 양방향 회전에서
벽 앞의 접촉 여유 0.01과 지지를 유지하고, 남은 시간의 접선 보행과 발판 회전을 마치는 Rust 회귀를 추가했다.
최신 배포 SDK를 설치한 Chromium에서도 벽이 있는 장면의 한 틱이 끝까지 진행됐고,
실패한 충돌 검사와 누락된 접촉은 모두 0이었다. 체크포인트를 복원해 같은 입력을 주었을 때
벽이 있는 경우와 없는 경우 모두 위치·접지·발판 회전이 각자의 첫 실행과 일치했다.

수정 전(`1f3a3152ddac20e4…`)과 수정 후(`ee7420c398a3a9c0…`)의 배포 Wasm을
Chromium 153에서 같은 지형으로 비교했다. 각 빌드와 지형 크기마다 독립된 브라우저 컨텍스트 3개를 사용했다.
각각 9회 모두 저장 직전과 복원 직후의 바디 상태와 지형 조회 결과가 일치했고,
이어진 6스텝에서도 원본과 복원 바디의 상태가 같았다.

| 지형 크기 | 물리 스텝 p95 (수정 전 → 후) | 저장 (수정 전 → 후) | 복원 (수정 전 → 후) | 저장 파일 |
| --- | ---: | ---: | ---: | ---: |
| 64셀 | 0.3 → 0.3ms | 325.5 → 348.0ms | 59.5 → 65.9ms | 39,744바이트 |
| 1,024셀 | 2.4 → 2.6ms | 370.9 → 454.9ms | 112.0 → 128.4ms | 441,124바이트 |
| 4,096셀 | 8.9 → 9.9ms | 386.6 → 451.7ms | 222.2 → 211.5ms | 1,723,782바이트 |

시간은 3회 결과의 중앙값이며 물리 스텝은 매회 120회 측정했다. 앞선 빌드와 각 크기의 바디 상태,
저장 파일 길이, 측정 시점별 Wasm 선형 메모리가 일치했다. 4,096셀에서 원본 엔진의 확보된 선형 메모리는
실행 후 10.875MiB, 저장 후 19.125MiB였다. 세 지형 크기의 시간은 별도 합격 상한 없이 측정했다.

두 빌드 모두 패키지를 설치한 Chromium에서 PNG·WAV·수정한 JSON·렌더 타깃을 저장한 뒤 원본 에셋 URL을
차단해도 복원됐다. 파일 손상, 파일 한도 1바이트 부족, Native 엔티티 슬롯 한도 0,
SDK GPU 요청 예산 0바이트, 자원 수 한도 0의 다섯 경우에는 복원이 거부됐고 기존 게임이 계속 진행됐다.
파일 길이와 한도가 정확히 같을 때는 복원 준비 후 폐기가 가능했다. 복원 전후의 바디는 6스텝 동안
일치했고, 두 대상의 정리 후 확보한 GPU 자원 수는 모두 0이었다. 여기서 SDK 예산은 요청량,
Wasm 메모리는 확보된 선형 메모리다. 결과는 `artifacts/physics-3d/motion-resource-acceptance/`에 있다.
이 파일의 재저장에서는 7개 구역 중 6개의 바이트가 일치했다. 자원 목록에는 새 소유자의
세대·버전과 오디오 컨텍스트 상태가 반영됐다. Native 엔티티 슬롯 한도 초과는 공개 API에서
`DATA`로 보고됐다. 이전 패키지의 파일·자원 SDK 선별 검사 109건, 최신 빌드의 SDK 테스트
2,037건과 설치 템플릿 4종의 브라우저 검사가 통과했다.
각 템플릿의 저장 사례에서 손상 파일을 거부하고, 정상 파일을 복원해 다시 저장한 바이트가 일치했으며
6프레임 더 실행한 뒤 게임 시간이 전진했다.

배포 Wasm의 소스 지문은 `bfe4edafe8e682a8`이다. Native와 WASI에서 각각 단위 테스트
3,743건과 통합 테스트 1건이 통과했다. Clippy와 WASI의 의도된 중단 검사도 통과했다.
동일 패키지로 마을의 적 32명 전투를 Radeon 8060S와 SwiftShader에서 각각 8회 실행해
16회 모두 통과했다. 측정 구간의 Rust 업데이트 최댓값은 각각 102.5ms와 75.4ms였다.

64명 군중의 일반 브라우저 통합 검사는 다른 검증과 동시에 실행할 때 Rust 업데이트가 135.8ms로
125ms 상한을 넘었고, 단독 실행에서는 최댓값 71.0ms로 통과했다. 별도의 50ms 고정 입력 검사에서는
수정 전 139.9·143.2ms, 수정 후 151.3·151.8ms로 상한을 넘었다. 같은 입력을 준 두 빌드에서
64명의 위치와 경로 탐색 통계가 일치했고 각각 체크포인트 복원 뒤 6스텝을 정확히 재생했다.
최신 빌드의 81프레임을 따로 기록한 실행에서 첫 프레임은 물리 5스텝에 141.6ms였고
이후 80프레임의 최댓값은 64.7ms였다. 진단용으로 Chromium의 Wasm 지연 컴파일을 끈 실행에서는
같은 405스텝의 첫 프레임이 64.3ms, 전체 최댓값이 65.7ms였다. 이 빌드에서는 기본 Chromium의
50ms 고정 입력 조건이 미통과였다.

### 64명 군중의 첫 업데이트

배포용 Wasm을 만들 때 Binaryen이 호출 지점이 하나뿐인 큰 함수를 호출자 안으로 합치던 범위를
제한했다. 컴파일된 모듈에서 가장 큰 함수 본문은 464,878바이트에서 34,544바이트로 줄었다.
물리 계산과 경로 탐색에는 기존 Rust 코드를 그대로 사용한다.

Chromium 153을 매번 새로 실행하고 이전·최신 SDK 패키지에 같은 50ms 입력을 주었다.
첫 업데이트가 처리한 물리 스텝은 5회였다. 이전 패키지의 두 실행은 134.0·132.3ms,
최신 패키지의 세 실행은 60.3·55.0·59.6ms였다. 최신 빌드에서 이후 80프레임의 최댓값은
67.7ms였다. 81프레임의 물리·탐색 카운터, 405스텝 뒤 64명의 위치와 탐색 통계가
수정 전후에 일치했다. 모든 실행에서 체크포인트 복원 뒤 6스텝의 위치가 일치했다.
같은 패키지의 `pnpm smoke:unified-physics-web`에서도 50ms 고정 입력의 첫 업데이트는
59.1ms, 전체 최댓값은 69.1ms였다. 일반 브라우저 프레임에서의 최댓값은 66.7ms였다.
SDK 테스트 2,037건과 설치 템플릿 4종이 통과했다. Radeon 8060S에서 같은 패키지로 실행한
32명 마을 전투도 8회 모두 통과했다.
소스 지문은 `429ff2f9f42f308f`이며 비교 기록은 `artifacts/physics-3d/crowd-first-update/`에 있다.

이하 단계별 기록은 각 시점의 소스와 검증 범위에 대한 이력이다. 과거 절의 “미지원”·“남은 작업”을
현재 구현 상태로 읽지 않으며, 현재 동작은 위 표와 연결된 엔진/API 문서를 우선한다.

## 요청과 완료 범위

사용자는 3개 조사 자료를 제공하고, 오픈소스를 내려받아 현재 엔진과 비교하면서
3D 물리를 도입해 2D·HD-2D에 함께 사용하고 부족하거나 잘못된 구현을 고도화하도록 승인했다.
기존의 별도 승인 대상인 3D 물리 도입이 이번 요청 범위에 포함된다.
전체 게임 루프 Worker 이전·Wasm threads·멀티플레이어·별도의 visual editor 승인은 아니다.

목표는 라이브러리 추가나 별도 테스트 데모만이 아니라 실제 게임 작성·실행·진단에서 쓸 수 있는 통합 물리다.
기존 2D 경로를 그대로 두고 새 3D API의 단위 테스트만 통과한 상태는 완료가 아니다.
외부 엔진의 모든 분야(유체·천·연체 등)를 복제하는 의미로 "완성"을 해석하지 않는다.
이번 수용 범위는 게임용 강체·캐릭터·지형·관절·쿼리와 그 작성/실행/검증 경로다.

## 조사 자료에서 바로잡을 점

- 3D 바디의 축 잠금은 평면 운동을 만든다. 2D 전용 솔버와 접촉·질량·관성·수치 오차가 같다는 보장은 없다.
- HD-2D는 표현 방식이다. 특정 상용 게임의 실제 물리 설정을 엔진 이름만으로 단정하지 않는다.
- 외부 3D 엔진 하나를 채택해도 기존 API·씬·저장 데이터 연결 작업은 필요하다. 코드가 자동으로 작아지지는 않는다.
- Box2D의 현재 소스는 C17이다. Chipmunk의 기본 broadphase는 BBTree이며 spatial hash는 선택 경로다.
- upstream README의 기능 목록을 Ferrum2D가 제공하는 기능 목록으로 전사하지 않는다. 실제 연결·검증한 기능만 공개한다.

## 비교 소스와 판단

비교 소스는 `artifacts/physics-3d/upstream/`에 clone했고 commit은 다음에 고정해 기록했다.
이 디렉터리는 조사 자료이며 제품 패키지나 Git 이력에 포함하지 않는다.

| 소스 | 조사 commit | Ferrum2D 적용 판단 |
| --- | --- | --- |
| [Rapier](https://github.com/dimforge/rapier) | `475caa3ff4646fd9a796b67d14116256f4962bc7` | Rust 코어 안에서 3D·축 잠금·CCD·캐릭터·query를 실행할 우선 후보 |
| [Jolt](https://github.com/jrouwe/JoltPhysics) | `dc2afef0554e90d6e7e8c318634dba650c6c2c7e` | `AllowedDOFs::Plane2D`, 지형/캐릭터 설계 비교. C++/Wasm 연결과 별도 빌드 비용 필요 |
| [ReactPhysics3D](https://github.com/DanielChappuis/reactphysics3d) | `7000610a244ea85377e4f4c9bcdf68af0159b595` | C++ 강체·지형·필터·관절 비교. CCD/캐릭터 요건을 별도 평가해야 함 |
| [Box2D](https://github.com/erincatto/box2d) | `dd8bd3fb525f0f33f1079f8ca3c5770783c44a53` | 2D 스택·접촉·CCD·단위/관성의 비교 기준. 3D 백엔드 후보는 아님 |
| [Chipmunk2D](https://github.com/slembcke/Chipmunk2D) | `f2f3d66220b8bb1568b8402c6d194d73d4e477d1` | 2D 공간 인덱스·접촉 수명·query 비교 기준 |

주요 근거 파일:

- Rapier `src/pipeline/physics_world.rs`, `src/control/character_controller.rs`, `src/dynamics/rigid_body.rs`
- Jolt `Jolt/Physics/Body/AllowedDOFs.h`, `Jolt/Physics/Character/CharacterVirtual.h`
- Box2D `src/solver.c`, `src/contact.c`, `src/dynamic_tree.c`
- ReactPhysics3D `README.md`, `src/engine/PhysicsWorld.cpp`
- Chipmunk `src/cpSpace.c`, `src/cpBBTree.c`, `src/cpArbiter.c`

도입 버전은 `rapier3d = 0.36.1`, Apache-2.0이다. Rust/Wasm 안에서 직접 실행할 수 있어 선택했다.
현재는 평면 마찰 결함 수정을 위해 동일 버전을 `crates/ferrum-core/vendor/rapier3d`에 보존하고 Cargo path dependency로 사용한다.
Rust 통합과 Engine/Scene 연결을 확장 중이며, Web에서는 명시적 world 설정·공간 body 생성·캐릭터 입력/상태를 제공한다.
Scene JSON의 `physics`와 shape body·capsule controller·named joint 작성, Studio 배치·높이 수정·재생·XYZ 진단을 연결했다.
Y-up native capsule에 HD actor의 WASD·지형 경로 추종·cold 이동을 연결했다. 실제 3D 캡슐 probe와
고정 tick의 이동/접지 판정을 공유한다. 계약과 제한은 [공간 이동](../engine/data-scene-spatial.md#통합-3d-물리의-캐릭터-이동)을 따른다.
Data Scene melee를 native 도형 범위·XYZ 시야·실제 fixture mask에 연결했다. shape body의 authoring preflight도
기존 AABB/heightSpan 요구 없이 허용한다. 문서 collision layer가 생략한 native category의 기본값을 정하고
명시적 category는 보존한다. 쿨다운과 다중 대상 피해는 전체 조회 성공 후 적용한다.
대시도 native fixed tick에 연결했다. controller의 이동/점프와 합성하고 일반 키네마틱은 이동 발판과 같은
swept 경로를 사용하며 원래 속도를 복구한다. 투사체는 대시 중간 경로도 판정한다.
전투 직접 이동은 물리 좌표 기반 표적 선택과 native controller/velocity/position target으로 연결했다.
렌더 오프셋, 실제 높이·평면 층, 캡슐 점프/벽과 입력 소유권을 검사한다. 기존 다층 AI의
검색 스케줄러와 공유 경로 캐시·bounded local 군중 회피는 아래 native Chase 경로에 연결했다.
이를 위한 native A* 커널을 재개 가능한 frontier/edge 상태로 분리했다. 작은 slice와 단일 실행의 경로·probe가
일치하고, 두 actor 검색의 교차 실행·예산 승인·실제 query 입력 변경 취소를 검증한다. 공개 single-actor 요청은
같은 커널을 사용한다. 이후 native Chase의 pending job을 자동 tick의 순환 검색·경로 추종에 연결했다.
고정 geometry 검색은 moving peer와 분리하고 실제 controller는 모든 움직이는 몸체와 계속 충돌한다.
명령형 gameplay API와 실제 packed 브라우저까지 검증했다. Native JSON admission과 별도 capability gate도 연결했으며, 8개 shared route cache와 profile/고정 geometry 검증·budgeted connector까지 연결했다. Native crowd는 실제 capsule/filter/높이·관측 속도 예측, 지형 범위/높이 검사와 budgeted local steering을 연결했다. 별도 capability로 구형 빌드를 거절한다. Native all-pattern도 별도 movement capability와 native source admission으로 연결했다. SeekTarget의 경로/보간·검증된 shortcut과 Accelerate의 틱당 가속·지형 검사는 같은 source/work/crowd를 공유한다. A* 지지점은 실제 capsule local pose와 plane support로 계산한다. 기본 backend 이전은 현재 코드에 반영했으며, 최신 소스의 snapshot/replay·브라우저와 전체 밀집 성능 수용은 별도로 남아 있다.

현재 동일 Engine의 opaque 메모리 checkpoint와 제한된 바이너리 Native 게임 파일 API를 제공한다.
파일 복원은 Native·SDK·자원·host binding의 선행 검증과 단계별 준비를 거쳐 게임 세션을 교체한다.
임의 Native JSON 진행 저장과 버전 간 이전은 별도 미지원이며, 구현된 바이너리 파일 API와 구분한다.
무옵션 Rust/Web 생성은 Native PlanarXy·자동 가변 시간 정책을 사용한다. 명시적 legacy 선택과 저장된 기존 정책은
각 계약에 따라 보존한다. Rigid/arcade Physics Spec과 가변 시간 Native 실행은 연결했고,
최신 소스의 전체 snapshot/replay·제품 수용은 아직 남아 있다. 임의 mesh/body 지지면의 경로 탐색,
이동 발판의 실제 미래 경로, debug의 밀집 비용도 최종 수용 범위에 포함한다.

Rapier 도입은 성능 우위가 확인됐다는 뜻이 아니다. 다른 백엔드와 같은 조건의 측정 없이 우위를 주장하지 않는다.
`enhanced-determinism`을 켜고 `parallel`·`simd8`·thread pool은 활성화하지 않는다.
실제 crate·전이 의존성과 라이선스, Wasm 크기·초기화·프레임 비용을 확인한다.
공식 설정 기준: [Getting started](https://rapier.rs/docs/user_guides/rust/getting_started/).

## 현재 엔진과의 차이

| 영역 | 시작 상태 | 필요한 결과 |
| --- | --- | --- |
| 강체 | 자체 XY 솔버, static/kinematic/dynamic, 8종 관절 | 한 3D 백엔드로 공간·평면 강체 실행, 기존 계약의 연결/이전 명시 |
| HD-2D 지형 | 2D Tilemap + height span, substep 이동, 전용 surface/connection 규칙 | 실제 3D 지형 충돌과 캡슐 이동, 계단/경사/다리 아래/낙하/이동 발판 |
| 모양 | AABB·circle·capsule·OBB·convex·edge·chain·compound | 3D box/sphere/capsule/convex/mesh/heightfield/compound와 평면 모양 매핑 |
| query | XY ray·shape cast와 높이 필터 | 3D ray·shape cast·overlap, 필터와 생성/이동/삭제 직후 일관성 |
| 작성 | Physics Spec 및 Scene Authoring | 명시적 공간/평면 설정, 엄격한 validation, 실제 native 입력 연결 |
| 브리지 | 기존 숫자 API·bulk state/query buffer | 세대 핸들, 검증된 bulk command/state/event/debug ABI, 매 프레임 entity별 호출 금지 |
| 재현 | 2D snapshot/replay와 Worker replay | 새 backend state의 snapshot/restore, 동일 입력 재현과 손상/다른 버전 거부 |
| 표현 | 2D/HD-2D 렌더와 보간 | 물리 pose를 Rust에서 기존 표현에 연결. TS가 별도 시뮬레이션을 소유하지 않음 |

## 구현 순서와 수용 증거

각 항목은 구현 + 해당 범위의 실행 증거가 있어야 완료 처리한다.

- [x] 조사 자료 읽기, 공식 upstream 소스 내려받기와 commit/라이선스 확인.
- [x] 변경 전 native baseline: Rust 단위 1,691개 + 통합 1개 통과, all-targets Clippy 경고 없음.
- [x] 도입 검증: 고정 버전의 native/Wasm 빌드, 평면·공간 자유낙하/접촉/CCD, 메모리·산출물 크기 기록.
- [ ] Rust 통합 world: 공간/평면 설정, 단위·중력, 바디/콜라이더 수명·세대·compound·필터·센서·힘/충격·sleep.
- [ ] 지형/이동: mesh·heightfield·convex, 캡슐 sweep/slide, 경사 제한, 계단, 접지/낙하, 이동/회전 발판.
- [ ] 관절: fixed/revolute/prismatic/spherical/distance/rope/spring, limit/motor/break와 기존 pulley/gear 계약 처리.
- [ ] query/event: ray·sweep·overlap, 제거/재생성·센서/접촉 enter/exit, overflow와 큰 입력/비유한 값 거부.
- [ ] Wasm/TS 공개 API와 versioned bulk buffer. 메모리 증가 후 view 재취득·오래된 핸들·잘못된 stride 검증.
- [ ] Physics Spec/Scene Authoring/schema/Studio에서 공간·평면 작성과 실제 런타임 연결. 저장 round-trip만으로 통과하지 않음.
- [ ] 기존 2D 강체 및 HD-2D 지형/캐릭터 경로를 동일 백엔드에 연결. 중복 시뮬레이션·조용한 fallback 금지.
- [ ] snapshot/restore/replay와 fixed-step 보간. restore 후 continuation, 삭제된 핸들, 버전/손상 거부 검증.
- [ ] 눈으로 확인할 예제와 브라우저 smoke: 스택·CCD·경사·계단·bridge-under·낙하·2D 축 고정 및 비용 측정.
- [ ] public API manifest/문서/README·패키지 라이선스·실제 소비자 tarball/CI gate 동기화.
- [ ] 완료 감사: 전체 기존 테스트/빌드/관련 브라우저·패키지 검증, 항목별 증거 확인. 미검증을 완료로 표기하지 않음.

현재 `physics3d` Rust 모듈은 바디·평면 입력 검증·세대 핸들·fixed step에 이어 아래 경로를 구현했다.

- Collider: body별 추가/삭제/교체, local pose·material·category/mask, 변경 직후 질량 갱신.
- Geometry: box/sphere/capsule·convex hull·compound·triangle mesh·heightfield. 지형은 fixed/kinematic에만 허용한다.
- Query: ray·convex sweep·convex overlap. 생성/이동/콜라이더 수정/삭제 직후 조회, sensor 선택·body/collider 제외,
  비유한 값/퇴화 geometry/오래된 제외 핸들 거부, overlap 결과 상한과 truncation 표시.
- Event/dynamics: contact/sensor enter/exit, 삭제된 세대의 종료 이벤트, bounded queue와 dropped count,
  persistent force/torque·impulse·명시적 sleep/wake. 밀도 0 센서를 추가해도 본체의 질량은 바뀌지 않는다.
  평면 모드의 금지 축은 계속 잠근다.
- Character: position-kinematic capsule의 fixed-step 입력·중력·점프, 경사/계단/천장/낙하,
  다리 위·아래 이동, 키네마틱 이동·승강·수평 회전 발판, 동적 물체에 대한 선택적 밀기 충격.
  XY 평면의 Y-down 중력과 캐릭터 간 상대 이동 충돌도 Rust 경로에서 검사한다.
- Joint: fixed/revolute/prismatic/spherical/distance/rope/spring, hinge/slider limit·force-based motor,
  force/torque 파손, 비활성화·설정 교체·body 삭제·clear·세대 핸들과 bounded lifecycle event.
  pulley/gear와 frequency spring을 추가하고 기존 Engine 관절 identity·수정·삭제·파손·진단에 연결했다. 아래에 남은 tuning 이전 범위를 명시한다.
- Native Engine: Data Scene의 명시적 새 body 생성 경로를 기존 Engine fixed tick에 연결했다.
  body state를 World transform/height span과 렌더 명령·보간에 반영하고, 기존 속도 적분의 중복 실행을 막는다.

Native planar Engine은 기존 2D rigid component·collider·관절·surface velocity·height/floor를 같은 backend로 가져온다.
접촉 보정 재질·전역 solver 설정은 native Engine까지 이전했으며, Physics Spec 전체 이전과 공개 Web API·Studio 연결은 남아 있다. 도입 실험의 Node Wasm 결과는
전체 엔진/브라우저의 결정성이나 실제 게임 전환 완료를 증명하지 않는다.

### Rust 충돌체·조회 계약과 확인한 결함

Heightfield는 Z 행·X 열의 row-major 높이 배열을 받는다. `size`는 셀 크기가 아니라 전체 X/Z 폭이다.
최대 sample/mesh vertex는 65,536, mesh triangle은 131,072, convex hull point는 256,
compound part와 body별 collider는 각각 64개다. 중첩 compound와 dynamic mesh/heightfield는 진단으로 거부한다.
직접 생성한 native collider의 density는 3D 체적 기준이다. 기존 2D component 이전은 fixture density를 0으로 두고
RigidBody의 질량·극관성을 명시적 mass properties로 전달한다. 2D 면적 밀도를 3D 체적 밀도로 다시 해석하지 않는다.

Mesh의 기본 내부 이음새에서 낙하한 구가 평평한 지형을 따라 옆으로 밀리는 결함을 확인했다.
`FIX_INTERNAL_EDGES_TWO_SIDED`를 사용해 이음새 법선을 보정하면서 다리 밑면 충돌을 유지한다.
Heightfield에도 내부 이음새 보정을 켠다. 회귀는 최종 높이뿐 아니라 수평 이동 오차·정착 속도·밑면 관통을 검사한다.

`PhysicsWorld::detect_collisions`를 조회 갱신에 사용하면 새 바디의 물리 변경 기록이 먼저 소비돼
다음 step의 키네마틱 목표가 적용되지 않는 사례를 확인했다. 현재 조회는 collider world pose와 BVH bounds만 갱신한다.
원래 physics pipeline의 변경 기록·관절·접촉 캐시는 유지한다. 생성 직후 키네마틱 목표 보존과
240 tick 동안 조회 유무에 따른 동적 바디 상태 일치를 검사한다.

접촉·센서 진입/종료는 `step`에서 생성한다. `drain_collision_events`와 query는 물리 시간을 진행시키지 않는다.
명시적 collider/body 제거·clear는 이미 감지된 쌍의 종료 이벤트를 즉시 큐에 넣으며,
slot 재사용 뒤에도 이전 body/collider generation을 보존한다. 이벤트 상한 초과는 dropped count로 드러낸다.
Web bulk event buffer와 overflow 후 게임 상태 재동기화 계약은 아직 연결 단계에 남아 있다.

### Rust 캐릭터 실행 계약

`enable_character`는 position-kinematic body의 단일 solid capsule에 controller를 붙인다.
추가 sensor fixture는 허용하지만 controller 소유 solid collider를 제거하거나 다른 모양으로 바꾸려면 먼저 비활성화해야 한다.
`set_character_input`의 이동 속도는 `up`에 수직이며 점프 입력은 다음 고정 틱에서 한 번만 소비한다.
중력은 world gravity의 `up` 방향 성분에 body gravity scale을 적용한다. 접지되지 않은 점프 요청은 버린다.
`set_pose` teleport는 가능하지만 기울어진 capsule은 거부하고 이전 접지·수직 속도를 초기화한다.
일반 velocity/kinematic-target setter가 controller의 이동을 동시에 덮어쓰는 것은 거부한다.

지상 이동에 매 틱 하강 속도를 합치면 평지에서도 이동 거리가 줄어드는 사례를 확인했다.
접지 중 하강 성분은 지면 snap으로 처리하고, 지지면을 잃으면 이미 적분한 중력 속도로 낙하를 계속한다.
공중에서는 snap을 비활성화해 아직 접지하지 않은 캐릭터가 바닥으로 당겨지지 않도록 한다.

Rapier controller의 속도 기반 발판 마찰은 접촉이 갱신되지 않는 틱에서 운반을 건너뛰었고,
수평 회전 시에도 목표 위치와 큰 차이가 났다. Ferrum은 controller 호출의 dt를 0으로 해 속도 기반 운반량을 제거하고
발판의 현재→다음 pose 변환으로 운반량을 계산한 뒤 환경과 다시 sweep한다.
이는 별도 물리 solver가 아니라 같은 Rapier world의 query를 이용한 캐릭터 이동 계산이다.
지지면 조회는 backend step 이후의 실제 발판 위치에서 수행한다. 발판 삭제·teleport·collider 수정은
이전 접지 캐시를 무효화하므로 삭제된 발판을 밟고 점프하거나 계속 운반되지 않는다.

서로 움직이는 캐릭터는 이전 pose를 고정 장애물로 취급하지 않는다. 모든 목표를 계산한 뒤
swept BVH 후보에 상대 이동 cast를 적용해 빠른 맞은편 이동의 관통과 같은 방향 그룹의 감속을 막는다.
후속 캐릭터로 이동 제한을 전파하는 반복은 live character 수로 제한하고,
`blocked_by_character`·`character_pair_casts`·`failed_pair_casts`를 상태로 남긴다.
controller 수 기본 상한은 128이며 설정 범위는 1–1,024다. 대규모 밀집 장면의 시간·메모리 budget은
향후 실제 Engine/Web 연결과 성능 단계에서 검증한다. 개수 상한만으로 프레임 시간 보장을 주장하지 않는다.

현재 native 회귀는 평지 이동, Y-down 평면, 벽 slide, 점프/천장, 계단 높이·headroom,
경사 한계, bridge-under, 낙하, 발판 시작/정지/역전·승강·수평 한 바퀴 회전·벽 차단,
동적 물체 밀기, 캐릭터 간 상대 이동·따라가는 그룹, 입력/수명/용량 계약을 검사한다.
일반 동적 강체에 대한 자동 운반·캐릭터 적재 하중, 기울어지는 회전 발판과 밀집 군중의 비용은 별도 수용 검증이 남아 있다.
단계별 실제 실행 결과는 `artifacts/physics-3d/character-qa/report.json`에 기록한다.

관절과 캐릭터를 같이 실행하는 회귀에서, 이동 발판 위를 걷는 중 작은 skin 간격 오차 때문에
반복 slide가 소진돼 보행 입력이 멈추는 사례도 확인했다. dt=0이어도 상류의 접촉 법선 방향 투영은 남는다.
접지 중 수평 이동을 시작하기 전에 skin의 10%와 `length_unit × 0.001` 중 작은 값 이내를 위로 sweep해 여유를 확보한다.
이동 후 같은 거리 이내의 하향 sweep으로 복귀하므로 ground snap을 꺼도 보정 높이가 매 틱 누적되지 않는다.
천장과의 sweep 없이 위치를 올리지 않는다. 관절 유무와 ground snap 활성/비활성 네 조합에서
이동·승강 발판 운반과 상대 보행 속도를 함께 검사한다.

### Rust 관절 실행 계약

`JointId`는 body/collider와 별도의 세대 핸들이다. 서로 다른 live body 두 개 중 최소 하나가 dynamic이어야 한다.
관절 수 기본 상한은 16,384, 설정 범위는 1–131,072다. local frame의 위치는 body-local anchor이며,
fixed/hinge/slider는 frame 회전도 사용한다. hinge와 slider의 자유 축은 각 frame의 local X다.
XY 모드 hinge는 두 local X가 같은 방향의 Z축을 가리켜야 하며, slider/fixed frame은 평면 회전만 허용한다.
Spherical/radial 관절은 frame 회전으로 회전을 구속하지 않는다.

일반 hinge limit은 라디안 [-pi, pi], slider limit은 engine unit이다. `ContinuousRevolute`는 planar 전용이며
두 body의 전체 `angle_b - angle_a`를 [-1,000,000, 1,000,000] 안의 limit/position target과 비교한다.
이 종류의 local X는 양의 Z이며, frame twist는 기준각 offset을 추가하지 않는다.
motor는 force-based stiffness/damping,
position/velocity target, 최대 힘 또는 토크를 받는다. `update_joint`는 입력을 먼저 검증한 뒤 설정과
warm-start impulse를 교체한다. 양 끝 body 교체는 삭제 후 재생성해야 한다. 실패한 update는 기존 상태를 보존한다.

상류 `limit_linear_coupled`는 현재 최대 길이만 처리하며 min limit은 구현돼 있지 않다.
따라서 `limits=[length,length]`를 coupled axis에 넣는 것만으로 distance 관절을 만들지 않는다.
Distance는 매 substep 실제 두 anchor 방향을 local X로 설정한 bilateral linear row를 사용한다.
Spring도 같은 radial frame의 force-based motor를 사용한다. anchor가 겹치면 이전 방향을 유지하고,
아직 이전 방향이 없으면 world X를 사용한다. 0 길이 distance는 spherical constraint로 처리한다.
Rope는 최대 길이 제한을 사용해 slack 상태에서 힘을 가하지 않는다.
압축/늘어남·겹친 anchor의 복구·공간 회전·두 dynamic body의 중심 보존을 회귀로 검사한다.

상류는 마지막 내부 solver substep의 impulse만 공개한다. 이를 한 번만 읽으면 초기 충돌 하중을 놓친다.
관절이 있는 world는 기본 4회 solver substep을 같은 수의 단일 solver pass로 실행하고 매번 파손을 확인한다.
각 pass의 실제 dt로 locked/limit/motor impulse를 힘·토크로 환산하며, tick의 최대 표본을 `JointState`에 남긴다.
이는 연속 시간의 정확한 최대 충격력이 아니라 timestep에 의존하는 수치 추정이다.
Position-kinematic 목표는 pass별로 보간해 발판·캐릭터가 첫 pass에서 전체 거리를 이동하지 않도록 한다.
한 틱의 시간은 그대로 유지하지만 broadphase/contact 갱신 횟수는 늘어나므로,
밀집 관절 장면의 native/Wasm 비용 수용 검증은 남아 있다. 현재 backend는 continuous 활성 시 CCD pass 1회(비활성 시 0회)와 body별 추가 solver iteration 0을 사용한다.

파손은 force/torque/동시 초과를 구분하고, 명시적 관절 삭제와 body 삭제는 별도 사유로 기록한다.
이벤트는 삭제 전 body/joint 세대를 보존한다. queue는 collision event와 독립적으로 `max_events` 상한을 사용하며,
초과 개수는 drain 결과로 드러난다. 재생성·clear 후 이전 핸들은 거부한다.
실행 증거는 `artifacts/physics-3d/joint-qa/report.json`에 기록한다.

기존 pulley의 두 world anchor까지 거리 합과 비율, gear의 body 각도 비율은 아래 ratio constraint로 이전했다.
Rapier generic joint의 상대 축 구속만으로 이 둘의 계약을 표현할 수 없어 같은 Rapier body와 substep에 전용 Jacobian을 적용한다.
기존 Engine 기본 경로의 전체 전환은 아직 남아 있다. 2D 질량·관성과 기존 관절 작성 연결은 아래 adapter에 정리한다.

### Native Engine 연결의 현재 범위

`Engine::configure_unified_physics`와 entity 기반 body/character 명령은 Rust native에서 먼저 제공한다.
새 `PhysicsWorld3d`를 `Engine.update()`의 기존 고정 틱에서 실행하며 별도 accumulator를 추가하지 않는다.
`create_unified_body`는 body 입력 검증 이후에만 World entity를 생성하고, 세대가 포함된 entity→body binding을 보관한다.
이 binding을 가진 entity는 기존 `PhysicsSystem::integrate`와 `integrate_legacy_velocities`에서 제외한다.
씬의 렌더링·sprite animation 등에 필요한 projected velocity는 유지하되 이를 두 번째 물리 위치 적분에 쓰지 않는다.

평면 pose는 World XY/rotation으로, 공간 pose는 World `[x,-z]`와 `HeightSpan.elevation=y`로 투영한다.
visual anchor offset은 body center와 sprite 발 위치의 차이를 표현한다. 공간 billboard의 화면 회전은 유지하며,
3D quaternion은 native body state에 남는다. model mesh 회전·SpatialScene 지형/actor authoring 연결은 아직 남아 있다.
World의 기존 render history가 새 body의 XY·회전·elevation도 보간한다. Native pose는 보간하지 않으며 teleport는
이전 render sample과 일치하지 않으므로 보간 대신 새 pose를 사용한다.

현재 이 모드는 Data Scene 전용이다. `PlanarXy`는 기존 rigid component와 collider-only 고정 지형을 가져오며,
실행 중 생성·삭제·옵션·geometry·pose·velocity·질량·관성 변경을 같은 backend에 반영한다.
`Spatial`의 기존 2D component는 아직 좌표·높이 작성 계약을 이전하지 않아 `LegacyBodiesPresent`로 거부한다.
명시적으로 만든 native entity에 기존 rigid component/collider를 중복 부착하면 소유권 충돌로 거부한다.
기존 public 2D 기본 경로가 옛 솔버를 쓰는 상태는 전체 목표의 완료가 아니다.
HD-2D actor·tilemap·공개 query/event/diagnostic·snapshot 계약까지
옮긴 뒤 기본 경로를 전환해야 하며, 이 과도기 경계를 최종 제품 제한으로 바꾸지 않는다.

새 body가 있는 동안 fixed clock을 비활성화하거나 다른 step으로 바꾸려는 기존 명령은 설정을 보존하고
native 진단 `ClockMismatch`를 남긴다. entity despawn/scene reset의 오래된 binding은 새 body 생성·world 재설정 또는 다음 fixed tick 전에 제거하며,
slot 재사용 시 이전 body가 새 entity를 덮어쓰지 않는다. built-in scene으로 전환하면 새 runtime과 소유 entity를 해제한다.
기존 physics snapshot/restore는 새 backend state를 누락하므로 성공으로 반환하지 않는다.
새 snapshot 형식과 이어지는 실행의 재현 검증은 별도 구현이 남아 있다.

최소 native timestep `0.0001`초에서 기존 fixed clock의 고정 epsilon도 `0.0001`초여서
`Engine.update(0)`이 tick을 한 번 실행하는 오류를 재현했다. epsilon을 기존 값과 timestep의 1% 중
작은 값으로 제한한다. 기본 60Hz의 기존 허용값은 유지하며, 최소 timestep의 0초·반 틱·완전한 한 틱을 검사한다.

`engine::unified_physics::tests`는 실제 Engine update·렌더 명령, 공간 낙하·착지와 elevation 투영,
character 입력/점프와 pause/resume, entity 수명, 렌더 보간/teleport, clock/solver/snapshot 혼합 거부를 검사한다.
이는 Web bulk bridge, Physics Spec/Studio 작성 또는 브라우저 실행 검증을 대체하지 않는다.
단계별 결과는 `artifacts/physics-3d/engine-qa/report.json`에 기록한다.

### 기존 2D component의 planar 이전

`engine/unified_physics/planar.rs`는 모든 입력과 arena 용량을 먼저 검사하고 나서 binding을 갱신한다.
잘못된 collider가 한 개 있어도 다른 body의 impulse를 먼저 소비하거나 일부 body만 생성하지 않는다.
steady tick에는 collider source를 비교하고, 수정된 geometry만 다시 구성한다. 입력 scratch vector는 재사용한다.

- Dynamic/Static/Kinematic과 collider-only 고정 body, collider 없는 body를 지원한다.
- 2D 질량·극관성은 zero-density fixture 위에 명시적 mass properties로 설정한다. 보조 fixture·sensor 추가로 질량이 바뀌지 않는다.
- force/torque는 한 fixed tick, impulse/angular impulse는 한 번 소비한다. 설정 직후에는 기존 pending impulse를 소비하지 않는다.
- body 잠금·활성화·sleep·CCD·damping과 실행 중 pose/velocity 수정, component 제거·entity generation 재사용을 반영한다.
- AABB/circle/oriented-box/capsule/edge/chain/convex-polygon 및 compound를 변환한다. edge의 반경은 기존 query epsilon인 `0.0001`이다.
- 새 backend에 바인딩된 fixture는 **모든 offset·방향을 body-local**로 해석한다. AABB도 body 회전을 따른다.
  기존 canonical 충돌 query의 shape 구성도 같은 좌표로 변환하며, 7종 shape의 회전·offset ray 결과를 native query와 대조한다.
  기존 비활성 unified 모드의 geometry 의미는 유지한다. 전체 query facade·debug·공개 이벤트/진단의 전환 검증은 남아 있다.
- 직접 각속도 설정과 position-kinematic target이 회전 잠금을 우회하지 못하게 한다.
  body 비활성화/재활성화는 step 전 query에도 반영한다. 비활성화한 발판은 즉시 접지 캐시에서 제거한다.

기존 joint의 rigid 설정, frequency/normalized spring, Distance/Rope/Gear/Pulley 및 hinge/prismatic/weld의 탄성 설정은
아래 adapter로 연결했다. 접촉 보정의 비기본 material scale도 아래 manifold 응답으로 이전했다.
Rapier damping/접촉 결합 결과와 기존 솔버의 수치적 동등성을 주장하지 않는다.
나머지 solver tuning 및 authoring/diagnostic 계약은 기본 전환 전 검토·구현 대상이다.
새 통합이 켜진 동안 두 rigid solver를 동시에 실행하거나 실패 시 옛 솔버로 fallback하지 않는다.

`engine::unified_physics::planar_tests`는 실제 Engine update에서 질량·관성·입력 1회 처리, 지면 착지·sleep,
실행 중 속도/pose/질량/회전 잠금/활성화/fixture 변경, compound 밀도, batch 거부, component 제거와 세대 수명을 검사한다.
`physics3d::body_control_tests`는 첫 step 전 명시적 mass, 회전 잠금, 즉시 query 활성화와 invalid-input 원자성을 검사한다.
전체 Rust/Clippy/wasm32/fmt의 이번 단계 증거는 `artifacts/physics-3d/planar-qa/report.json`에 기록한다.
이 결과는 기본 backend 전환, 실제 Web/Studio, 새 snapshot/replay, 브라우저 비용, package 배포 검증을 대체하지 않는다.

### 기존 관절과 ratio constraint 연결

`engine/unified_physics/planar_joints.rs`는 기존 World 관절의 kind/index/generation을 native JointId에 연결한다.
관절 설정·endpoint·용량을 body/impulse 적용 전에 검사하고, 수정된 설정만 native에 전달한다.
endpoint 교체는 내부 관절을 재생성하되 기존 World handle은 유지하며, 삭제·body 제거·slot 재사용은 세대로 구분한다.

| 기존 관절 | 현재 연결한 계약 |
| --- | --- |
| Distance / Rope | local anchor, 길이, enabled, normalized stiffness/damping, force/torque/거리 파손 |
| Spring | frequency/damping ratio 또는 frequency 없는 normalized 모드. native acceleration-based radial motor 사용 |
| Revolute | local anchor, [-π,π] 또는 continuous multi-turn limit, torque 제한 velocity motor, normalized linear stiffness/damping |
| Prismatic | local axis·reference angle·anchor, translation limit, force 제한 velocity motor, 독립 linear/angular stiffness/damping |
| Weld | local anchor·reference angle, 독립 linear/angular stiffness/damping, 거리/각도 파손 |
| Gear | Z축 `angle_b + ratio × angle_a - reference_angle`의 위상 구속, 양수·음수·분수 ratio, normalized stiffness/damping |
| Pulley | `length_a + ratio × length_b`, world/local anchor, slack 또는 양방향 구속, normalized stiffness/damping |

Gear/Pulley의 Jacobian과 effective mass 식은 다운로드한 Jolt의 `GearConstraintPart`·`IndependentAxisConstraintPart`와 비교했다.
엔진의 geometry·contact·CCD·통합은 하나의 Rapier world를 계속 사용한다. 전용 row는 같은 고정 substep에서 처리한다.
ratio joint가 있을 때 substep마다 bounded Gauss-Seidel sweep을 수행하고, ratio joint가 없는 경로는 이를 건너뛴다.
밀집 ratio/joint/contact 조합의 실제 프레임 비용과 극단적인 ratio 검증은 후속 수용 기준으로 남아 있다.

처음 velocity bias로 줄 길이 오차를 보정했을 때 바닥 충돌 뒤 약 `0.209` units/s의 불필요한 반동이 남았다.
`artifacts/physics-3d/ratio-contact-before.log`에 실패를 보존했다. 속도 구속과 split position correction을 분리했고,
위치 보정은 각 substep의 correction velocity budget 내에서 제한한다. 보정 후 query bounds도 갱신한다.
회귀는 최대 바닥 침투 `0.015` 미만, 줄 길이 오차 `0.04` 미만, 충돌 후 속도 `0.05` 미만을 함께 검사한다.
이 한 시나리오가 모든 고속/얇은 지형/밀집 구속의 안정성을 증명하지 않는다.

Planar body의 전체 회전각을 quaternion과 함께 보존한다. 여러 바퀴 회전·분수 gear ratio와 기존 World position 변경 후
turn count를 검사한다. quaternion 차이와 마지막 angular velocity를 이용한 unwrap이며, 매우 높은 각속도에서 강한 충돌이
동시에 발생하는 경우의 turn count 수용 검증은 남아 있다.

Continuous hinge는 매 native substep 양쪽 frame의 회전을 현재 world +Z 방향으로 맞추고,
현재 전체 상대각에서 뺀 limit/position target을 [-π/2, π/2] 구간에 옮긴다. 여러 바퀴 떨어진 위반도
복구 방향을 보존하고 native correction speed 안에서 회복한다. anchor·motor·contact는 같은 Rapier solver가 처리한다.
상·하한이 같은 경우에는 한 각도에 고정하는 bilateral row를 사용해 두 unilateral 경계가 교대로 작동하지 않게 한다.
큰 오차에서 angular lock이 보정 속도 상한을 우회하지 않도록 softness와 quaternion Jacobian으로 target 상한을 계산한다.
`artifacts/physics-3d/continuous-hinge-zero-width-before.log`의 한 tick 약 2.99 rad 이동 실패를 보존하며,
범위형/고정각 limit 모두 같은 한 tick 0.051 rad 미만의 복구 기준으로 검사한다(60 Hz, unit scale 1).
공간 모드와 잘못된 축/limit은 body/impulse commit 전 거부한다. position/velocity motor, 양쪽 경계,
off-center anchor, 회전 키네마틱 상대각, 접촉, teleport·limit 수정, disable/enable·파손을 검사한다.

off-center hinge 회귀에서 body의 평면 잠금과 중복된 관절 row가 수치 오차로 Z 회전을 방해했다.
실패 기록은 `artifacts/physics-3d/continuous-hinge-engine-before.log`이며, 같은 4초 시험에서 27 rad 목표 대신
약 24.09 rad에 머물렀다. planar hinge의 local LinX/AngY/AngZ row를 제거해 body 잠금이 해당 축을 담당하게 했다.
일반 hinge와 continuous hinge 모두 세 시작각에서 목표 속도·anchor 오차·평면 유지 회귀를 통과해야 한다.
endpoint 비활성화 시 남아 있는 backend impulse를 현재 반작용으로 읽는 문제도 수정했다.
`artifacts/physics-3d/continuous-hinge-disabled-before.log`의 과거 5 torque가 비활성화 뒤 0으로 보고되는지 검사한다.

재활성화 검증 중 native scalar impulse의 단순 norm이 실제 반작용과 다르다는 문제도 확인했다.
angular lock은 quaternion 미분을 사용하고, native solver가 무제한 row를 질량 기준으로 직교화하므로
`joint_reactions.rs`는 substep 전에 같은 Jacobian·row 순서를 저장하고 impulse를 실제 힘/anchor couple로 변환한다.
이 경로는 고정한 Rapier 0.36.1의 내부 row 계약에 의존하므로 backend 업그레이드 때 다시 확인해야 한다.
cache는 관절별 재사용하며 밀집 장면의 비용·메모리 수용 검증에 포함해야 한다.
외력 10, 레버 길이 2, 외부 토크 5를 가한 fixed joint는 planar/spatial·60/120 Hz에서 force 10과 couple 25를 보고한다.
토크 5에 대한 threshold 4/6 파손 경계도 검사한다. pulley의 off-center cable force가 만드는 body 회전과
anchor 자체의 couple은 구분하며, cable은 couple 0을 보고한다.
이전 재활성화 실패 기록은 `artifacts/physics-3d/continuous-hinge-qa/attempts/reactivation-load-failure/`에 보존한다.

Native force/torque 파손은 substep 하중을 사용하고 기존 World의 break queue로 전달한다. 거리/각도 기반 파손은
Engine fixed tick 전·후에 검사한다. native event가 overflow해도 모든 live binding을 확인해 파손된 World joint를 제거하므로
다음 tick에 관절이 재생성되지 않는다. 명시적 삭제·geometry break의 native Removed 이벤트는 실제 step 전에 소비해
solver 파손 알림의 용량을 차지하지 않게 한다. solver event 누락 수는 기존 진단에 반영한다.
기존 joint diagnostic buffer에도 native force/torque/error를 넣으며 매 tick 초기화한다.

기존 8종 관절의 normalized tuning은 아래 변환식으로 연결했으며 `LegacyJointTuningUnsupported` 거부 경로는 제거했다.
나머지 config·공간 게임플레이·Web 계약과 비용/안정성 수용 기준을 검증한 뒤 기본 backend를 전환해야 한다.
검증: `physics3d::ratio_joint_tests`와 `engine::unified_physics::planar_joint_tests`.
continuous hinge 검증은 `physics3d::continuous_hinge_tests`와 실제 Engine의 `planar_joint_tests`에 포함한다.
최신 전체 검사 증거는 `artifacts/physics-3d/frame-springs-qa/report.json`에 기록한다.
직전 normalized Spring/Distance/Rope/Gear/Pulley 단계는 `artifacts/physics-3d/normalized-joints-qa/report.json`에 보존한다.

### 정규화 탄성과 감쇠 이전

기존 `stiffness`/`damping`은 solver 보정 비율이며 물리 단위 계수가 아니다. 입력 `k`, `d`는 유한한 `[0,1]` 값이어야 한다.
실제 tick rate나 옛 solver iteration 수에 따라 계수가 바뀌지 않도록 60 Hz authoring 기준으로 변환한다.

| 입력 | 새 backend의 변환 |
| --- | --- |
| frequency 없는 Spring | 가속도 강성 `K = 3600k`, 감쇠 `D = 60kd` (`k = 0`이면 `D = 60d`) |
| Spring 외의 관절, `k < 1` | 가속도 강성 `K = 3600k`, 감쇠 `D = 60d`. linear/angular 값은 각각 변환 |
| Spring 외의 관절, `k = 1` | 해당 좌표는 rigid 구속. 유효한 `d`는 허용하지만 별도 탄성 감쇠는 적용하지 않음 |
| frequency가 있는 Spring | 기존 frequency/damping ratio를 사용하며 normalized `k`, `d`는 사용하지 않음 |

`K`는 `1/s²`, `D`는 `1/s` 단위다. 양쪽 질량·관성을 같은 배율로 바꿔도 같은 응답을 내도록 effective mass로 정규화한다.
이 변환은 입력의 강약과 감쇠 의미를 유지하기 위한 새 계약이며, 기존 iteration 기반 궤적·에너지와 동등하지 않다.
기존 콘텐츠의 움직임은 전환 시 다시 확인하고 필요하면 값을 조정해야 한다.
두 계수 0은 자유 운동, 강성 0·감쇠 양수는 순수 damper다. native zero/zero motor가 속도를 잠그는 문제를 피하도록
두 계수가 0인 radial spring은 motor row 자체를 제거한다. frequency 0도 같은 경로로 자유 속도를 보존한다.

Distance와 Spring은 native radial motor를 사용한다. `ElasticRope`와 elastic Gear/Pulley는 같은 Rapier body에
누적 impulse를 포함한 implicit row를 적분 전에 적용하며, 반복 sweep이 탄성을 rigid 구속으로 만들지 않게 한다.
탄성 row에는 split position correction을 적용하지 않아 실제 하중에 따른 늘어남이 남는다.
Rope와 slack Pulley는 늘어난 상태에서만 당기고 느슨한 상태에서는 힘을 주지 않는다.
적분 전후에 탄성 힘을 중복 적용했을 때 정착 위치에서도 속도가 남았던 실패를
`artifacts/physics-3d/normalized-spring-before-phase.log`에 보존했다.
적용을 적분 전 한 번으로 제한하고, backend가 이어서 적분할 중력·사용자 힘/토크와 position-kinematic 목표 속도를
row의 예상 속도에 반영해 이 실패를 수정했다. 힘의 실제 적분은 Rapier에서 한 번만 수행한다.
비선형 공간 gyro와 접촉 impulse를 같은 예측식에서 함께 풀지는 않으므로, 이 결합과 밀집 구속의 수용 검증은 남아 있다.

검증은 `physics3d::spring_tests`와 `engine::unified_physics::planar_spring_tests`에 있다.
정적 하중 아래 실제 늘어남·잔류 속도·힘/토크, 질량 1/100 배율, 30/60/120 Hz의 순수 감쇠,
양수/음수/분수 gear ratio, slack/양방향 pulley, planar/spatial rope와 움직이는 키네마틱 anchor를 검사한다.
Engine에서는 기존 World 입력으로 강성·감쇠, zero gain, rigid/elastic/frequency 전환, invalid batch 원자성·파손을 확인한다.
rigid Rope는 장력이 없으면 짧아질 수 있으므로, rigid 전환 뒤 정확한 최대 길이 검사는 계속 바깥쪽 하중을 가한 상태에서 한다.

Frame joint의 `linear_spring`/`angular_spring`은 locked axis에만 적용한다. 해당 lock을 native acceleration motor로
바꾸며 원래 free axis의 limit/actuator는 유지한다. zero/zero는 motor row도 생성하지 않고 해당 축만 자유롭게 한다.
Spherical과 planar hinge처럼 구속된 회전축이 없는 경우 angular response를 거부하며 radial/ratio 종류는 이 옵션을 받지 않는다.
평면 body 잠금과 중복되는 fixed/prismatic/spherical row도 제거해 작은 quaternion 오차가 남은 축을 방해하지 않게 한다.
Angular response는 최단 상대각을 사용한다. continuous hinge의 전체 회전각 limit과는 별도 좌표다.

Off-center 탄성 frame은 한 번의 native PGS/relax에서 작은 잔류 회전이 남았다.
`artifacts/physics-3d/frame-spring-before-iterations.log`와 `frame-spring-debug.log`에 실패를 보존했다.
탄성 frame이 있는 world의 각 substep에서 PGS와 relax를 각각 4회 수행해 같은 0.001 rad/s 미만의 정착 기준을 충족한다.
이 설정은 그 world의 접촉에도 적용되므로 밀집 관절/접촉 비용 검증 대상이며, 해당 관절이 없는 world는 기존 횟수를 유지한다.
반작용은 여러 motor row의 실제 Jacobian을 합산해 anchor force/couple로 복원한다.

일반 hinge motor는 limit에 닿은 뒤에도 relaxed solve에서 바깥쪽 속도를 만들었다.
상류 linear motor의 limit 처리와 같이 매 substep 목표 속도를 남은 각도/dt로 제한하고 목표 위치도 허용 구간으로 제한한다.
Continuous hinge는 recentered frame의 limit을 사용하므로 같은 처리를 공유한다. equal-bound의 bilateral lock은 그대로 유지한다.
기존 실패 속도 약 0.04167 rad/s를 기록했으며, 새 검사는 경계에서 0.003 rad/s 미만과 반대 방향 재출발을 함께 확인한다.
관련 회귀는 `physics3d::frame_spring_tests`와 `engine::unified_physics::planar_frame_tests`이며,
planar/spatial·질량 1/100·60/120 Hz 정적 응답, off-center couple, 독립 gain·순수 감쇠·설정 교체·파손,
30/60/120 Hz hinge의 position/velocity motor·양쪽 경계, 실제 Engine의 rotated slider와 continuous hinge를 포함한다.

### CCD 접촉 설정

고속 충돌은 최초 충돌 다음 60프레임의 침투 깊이와 정착 속도도 검사한다.
상류 기본 static contact frequency `60`에서 최대 약 `0.042` 단위 침투를 확인했고,
27개 설정 실험에서 `240`은 같은 사례를 약 `0.0062` 이내로 줄였다.
기초 모듈의 static contact frequency에 `240`을 사용하고 공간/평면 8단 스택 정착도 함께 검증한다.
단위·접촉 재질·다양한 지형/크기·성능에 대한 나머지 수용 검증은 위 체크리스트에서 계속 수행한다.

## 책임과 안전성

### 접촉 재질과 평면 층 필터

`ColliderDesc.surface_velocity`는 world-space 속도이며 접선 성분만 마찰 목표로 사용한다.
바디나 콜라이더를 이동시키지 않고, normal 성분으로 물체를 들어 올리지 않는다. 실행 중 fixture 변경으로 반전/해제할 수 있다.
일반 마찰은 `sqrt(mu_a × mu_b)`, 반발력은 `max(e_a, e_b)`를 사용한다.
마찰 계수의 제곱근을 native collider에 저장하고 native Multiply combine을 적용해 기본 재질에 hook 비용을 추가하지 않는다.
surface velocity가 있는 collider만 contact modifier를 활성화하며, 별도 세대 map은 fixture/body 삭제 시 함께 제거한다.

`PlanarCollisionSpan`은 논리 floor/elevation/height다. 두 span이 있으면 같은 층이며 닫힌 높이 구간이 겹쳐야 충돌한다.
한쪽 span이 없으면 기존 무필터 바디와 충돌한다. 반면 `QueryFilter.planar_span`을 명시한 조회는
span이 없는 target을 제외한다. 기존 높이 query와 같은 구분이며 ray/sweep/overlap에 공통 적용한다.
공간 world에 span을 지정하면 거부한다. 공간 actor/terrain의 실제 3D 높이를 이 논리 필터로 대체하지 않는다.

층 변경은 geometry를 옮기지 않고 native narrow phase를 dirty 처리해 정지한 sensor pair도 다음 step에 다시 검사한다.
contact와 CCD는 같은 hook, sensor는 대응 intersection hook을 사용한다.
native 캐릭터의 이동/접지/발판 cast와 캐릭터 간 상대 이동도 같은 조건을 사용한다.
캐릭터 또는 발판의 층이 바뀌면 jump 입력 전에 접지 캐시를 해제한다.
기존 Engine World height span과 material의 변경은 전체 batch 검증 뒤 적용하며 invalid 값은 impulse를 소비하지 않는다.

검증: native 7개와 실제 Engine 3개의 contact policy 회귀, 원본 대비 vendor 수정 범위, 상류 lib 테스트.
이 단계 전체 Rust 검사는 `artifacts/physics-3d/contact-policy-qa/report.json`에 보존한다.
접촉 보정의 기존 네 가지 scale과 global solver 설정은 아래 단계에서 이전했다. default runtime/Web 전환은 아직 완료하지 않았다.

### 상류 평면 마찰 결함과 로컬 수정

Rapier3D 0.36.1의 두 3D 마찰 모델은 접선 effective-mass 2×2 행렬의 역행렬을 사용한다.
XY 평면 잠금에서는 한 접선 방향의 질량이 0이라 행렬이 특이해지며, 기하 마찰과 컨베이어 모두 힘을 내지 않는 회귀를 확인했다.
`artifacts/physics-3d/contact-policy-before-planar-friction.log`와 `contact-policy-coulomb.log`가 두 모델의 실패 증거다.
축 잠금이나 충돌체를 우회하지 않고, 같은 solver 안에서 rank-one 행렬의 pseudoinverse를 사용하도록 수정했다.
고정 버전의 원본은 `crates/ferrum-core/vendor/rapier3d`에 보존하고 version+path dependency로 연결한다.
엔진 manifest의 `[patch.crates-io]`는 다른 Rust 프로젝트가 엔진을 dependency로 가져올 때 적용되지 않으므로 사용하지 않는다.
별도 consumer crate의 `cargo metadata`에서도 동일한 vendor 경로를 선택하는지 확인한다.
원본 archive checksum은 기존 Cargo.lock의 checksum과 대조했다. 마찰 수정은
`src/dynamics/solver/contact_constraint/contact_constraint_element.rs`에 있으며 두 마찰 모델이 같은 함수를 사용한다.
접촉 보정 확장을 포함한 현재 vendor diff는 상류 원본 324개 중 12개 수정과 Rust 파일 1개 추가다.
상세 파일 목록·변경 목적은 vendor의 `FERRUM-PATCHES.md`를 따른다.
행렬을 최대 대각값으로 정규화하고, determinant가 `4 × Real::EPSILON × trace²`보다 크면 coupled inverse를,
그 이하면 rank-one pseudoinverse를 사용한다. 완전히 잠긴 경우 impulse는 0이다.
극단적인 조건수의 작은 eigenvalue는 수치적으로 잠긴 방향으로 처리되므로 고질량비 수용 검사에도 포함해야 한다.
Apache-2.0 license·출처·변경 내역을 함께 기록하며, backend 업데이트 시 원본 diff와 회귀를 재검증한다.
이 소스 추가는 새로운 물리 backend나 두 번째 적분 루프를 도입하지 않는다.

- 물리 상태·step·충돌·캐릭터 계산은 Rust가 소유한다. TS는 입력 검증/전송·에셋·UI·buffer 소비 담당.
- upstream body/collider handle을 공개 엔진 API의 entity handle로 그대로 재사용하지 않는다.
- collider 변경/clear/remove/씬 교체 직후 query와 event가 오래된 객체를 참조하면 실패다.
- planar 모드도 3D solver를 실제 실행한다. DOF lock 외에 shape 두께·질량·관성·좌표축을 문서화한다.
- Rapier 원시 API에서 축 잠금과 금지 축의 초기 속도를 함께 지정하면 평면 밖으로 이동했다.
  Ferrum2D는 생성·속도 변경·teleport·restore·kinematic target에 동일한 평면 invariant를 검증해야 한다.
- 기존 API가 지원하던 기능은 이전 표와 검증 없이 삭제하거나 무시하지 않는다. 불가능한 입력은 진단으로 거부한다.
- fixed timestep의 catch-up 상한과 남은 시간/드롭 정책을 관측 가능하게 유지한다.
- 관통 방지·안정성 검증은 `isFinite` 또는 count 검사로 대체하지 않는다. 예상 위치/접지/침투/속도/시간을 assert한다.
- 브라우저/플랫폼 간 결정성은 같은 입력의 실제 결과를 비교한 범위만 주장한다.
- 도입 전 기준은 `artifacts/physics-3d/baseline-qa/report.json`; 추가 실행 증거도 `artifacts/physics-3d/`에 둔다.


### 접촉 보정 재질과 전역 설정 이전

`ColliderDesc.contact_correction`의 선택적 `ContactCorrection`은 backend 타입을 노출하지 않는다.
수치 필드는 유한한 `0..=1,000,000` 범위이며, 잘못된 값은 collider 생성/변경 전 거부한다.
둘 다 지정하면 각 수치의 최솟값과 split 설정의 OR를 사용한다. 하나만 지정하면 그 응답을,
둘 다 생략하면 기존 native softness를 사용한다. 따라서 native 기본 접촉은 변경하지 않는다.

기존 planar Engine fixture는 아래 변환으로 명시적 응답을 만든다. `dt`는 solver 내부 substep이
아닌 Engine 고정 tick이다. 전역 config는 기존 solver와 같은 sanitizer를 적용하고,
재질 scale은 유한·비음수여야 하며 곱한 결과도 native 범위에 들어야 한다.

| 기존 설정 | native 응답 |
| --- | --- |
| contact bias factor × material bias scale / dt | velocity rate |
| maximum bias speed × material max-speed scale | velocity cap |
| position percent × material position scale / dt | position rate |
| position slop × material slop scale | position deadzone |
| position slop | velocity-bias deadzone |
| contact split impulse | 속도 편향을 위치에만 반영할지 결정 |

두 collider의 변환값을 최솟값으로 합성하므로 기존 material의 최소 scale 합성 규칙을 유지한다.
위치 적분 전에는 위치 보정과 속도 편향을 더하고, relaxation에서는 split이 false일 때만 속도
편향을 유지한다. 위치 보정에는 native corrective speed budget이 계속 적용된다. 접촉 기하,
추측 접촉의 접근 제약, 마찰, restitution은 그대로 별도 처리한다. 기존 iteration별 궤적을
동일하게 재현하는 변환은 아니다. 기존 default slop `0.01`도 이제 실제 정착 위치에 반영된다.

재질·전역 설정의 실행 중 변경은 fixture cache를 갱신한다. sparse response map은 collider/body
삭제 시 세대와 함께 정리한다. hook을 제거하면 기존 manifold 응답을 초기화한다.
현재는 explicit response가 있는 collider가 contact hook을 사용하므로, Engine planar fixture의
contact recycling·dense scene 비용 영향도 최종 성능 검증 대상이다.

회귀는 위치 보정의 잔류 속도, velocity cap, split, 독립 slop, zero gain의 충돌·반발 유지,
실행 중 변경/해제, 삭제 세대, 실제 Engine의 네 material scale과 invalid batch 입력 보존을 검사한다.
최신 검증은 `artifacts/physics-3d/contact-correction-qa/report.json`에 기록한다.
iteration·restitution threshold·gravity/step API 연결은 다음 절을 따른다. 기본 backend 전환,
HD-2D 게임플레이, Web/Studio, snapshot/replay, package/license와 최종 수용 검증은 계속 진행한다.


### 전역 solver 설정과 자동·수동 실행 통합

`WorldConfig.solver`와 `PhysicsWorld3d.set_runtime_settings(gravity, solver)`는 고정 tick·capacity를
재생성하지 않고 XYZ 중력과 `SolverSettings`를 변경한다. 유효 범위는 각 iteration `1..=32`,
restitution threshold `0..=1,000,000`이며 중력은 기존 유한·범위·평면 제약을 적용한다.
중력 변경은 동적 body를 깨운다. planar adapter는 마지막으로 World에 쓴 sleep 값을 기억해
변하지 않은 projection을 새 sleep 명령으로 취급하지 않는다.

| 설정 | 공통 native 경로 |
| --- | --- |
| velocity iterations | 고정 substep별 PGS 반복 횟수 |
| position iterations | 고정 substep별 relaxation 반복 횟수 |
| restitution velocity threshold | constraint 생성 시 접촉점 접근 속도에 적용. 각속도를 포함하며 임계값과 같으면 반발하지 않음 |
| continuous | body별 CCD와 별개인 전체 CCD on/off. native 자동 CCD에도 적용 |
| gravity | native 적분과 capsule controller가 함께 사용하는 XYZ 벡터 |

native 기본값은 PGS/relax 1회, 내부 substep 4회, restitution threshold 0이다. elastic frame은
두 반복 횟수에 최소 4회를 요구하지만 사용자가 더 높은 값을 지정하면 낮추지 않는다.
ratio/cable adapter의 전용 Gauss–Seidel pass는 기존 8회를 유지하며, 위 반복 설정은 native constraint에 적용한다.
기존 `RigidBodyStepConfig`의 반복 횟수와 trajectory를 동일하게 재현한다는 뜻은 아니다.
threshold는 반발 속도가 아니라 restitution 계수를 곱하기 전 접근 속도에 적용한다.
추가 query나 per-contact hook 없이 native constraint 생성 단계에 연결한다.

`configure_unified_physics`는 자동 실행을 켜고 명시한 native 중력·solver 설정을 기존 자동 설정에
동기화한다. contact correction 설정은 그대로 보존한다. native 모드 진입 전 자동 설정은 별도로
보관하고, native world를 버려 다른 씬으로 전환하면 복구한다. 이후 기존
`configure_auto_rigid_body_step(false, ...)`는 자동 native step도 멈춘다.
이 2성분 중력 API는 native X/Y를 설정하고 spatial Z는 유지한다. 전체 XYZ 변경은
`Engine.set_unified_runtime_settings`를 사용한다.

native 모드에서 기존 `step_rigid_bodies(dt)`는 현재 설정으로 같은 native world를 한 번 진행한다.
`step_rigid_bodies_with_config`는 해당 호출의 설정만 적용한 뒤 자동 설정을 복구한다. 두 함수는
Engine 고정 accumulator나 gameplay 시계를 소비하지 않으며, 호출 후 render interpolation을
현재 물리 상태로 맞춘다. `dt == 0`은 no-op이고, 나머지는 유한하고 설정된 고정 tick과 맞아야 한다.
틀린 시간이나 config는 진단으로 거부하며 다른 solver로 fallback하거나 pending impulse를 소비하지 않는다.
오류 진단은 정상 tick에서도 유지하며 `take_unified_physics_error`로 명시적으로 소비한다.
이렇게 설정 거부가 다음 정상 frame에서 사라지는 것을 방지한다.

`solver_settings` 회귀는 느린 충돌의 반발 억제·낮은 restitution에서의 올바른 threshold,
중력 변경과 sleep 복구, CCD on/off, 반복 횟수 증가에 따른 chain error/잔류 에너지 감소,
실제 Engine 자동 중지/수동 실행·one-shot 설정·clock 보존·잘못된 입력·spatial XYZ·씬 전환을 검사한다.
최신 전체 검증은 `artifacts/physics-3d/solver-settings-qa/report.json`에 기록한다.
공개 stats/event/feedback의 native 매핑과 Physics Spec 전체 적용, 기본 backend 전환,
HD-2D 게임플레이·Web/Studio·snapshot/replay·브라우저/성능/package 수용 검증은 계속 남아 있다.


### 기존 ray·segment·point 조회 연결

통합 planar world가 설정되면 기존 Engine `raycast_bodies`, `segment_cast_bodies`, `query_point_bodies`와
각 height-span 변형은 native broadphase/shape를 조회한다. 기존 28-byte ray hit·8-byte entity hit ABI는 유지한다.
body→entity 역매핑은 생성·component 제거·despawn·세대 재사용 때 함께 갱신한다. 조회 전 authored body/fixture를
검증·동기화하고, 물리 tick·힘/충격량 소비·고정 accumulator 진행은 수행하지 않는다. 따라서 tick 전 생성·이동·shape 변경도
보이며, 조회가 많아져도 impulse를 반복 적용하지 않는다. native body의 render anchor/보간은 물리 조회에 적용하지 않는다.

기존 조회 계약은 category-only 선택과 sensor 포함이다. `QueryFilter.respect_target_mask`의 기본값 true는
기존 native 대칭 필터를 유지하며, planar adapter는 false로 target category만 검사한다. mask가 0인 sensor도
해당 category를 조회하면 결과에 포함한다. 명시한 height span은 같은 floor·겹치는 구간만 선택하고, span 없는 body는 제외한다.
비활성 native body/fixture는 결과에 포함하지 않는다.

`PhysicsWorld3d.cast_ray_all`은 거리·collider identity 순으로 정렬한 뒤 가장 가까운 `limit`개를 보존하고
생략 여부를 반환한다. `overlap_point`는 collider identity 순이다. 수집 버퍼는 world collider capacity까지 성장할 수 있으며
출력 limit 자체가 임시 메모리 상한은 아니다. 유효하지 않은 요청은 호출자가 전달한 출력 버퍼를 보존한다.
ray는 collider당 첫 표면 하나를 반환하고, compound/chain의 내부 segment 전체를 별도 hit로 늘리지 않는다.
Engine의 점 조회는 같은 entity에 속한 fixture를 하나로 합친다. ray는 여러 fixture의 hit를 유지하며,
동일 거리는 entity identity·collider identity로 정렬한다. 기존 chain segment별 ray 개수와는 차이가 있다.

공간 world의 ray는 native Rust `Engine.cast_unified_ray_all`과 `UnifiedRayHit`로 XYZ 좌표·법선과 entity identity를 전달한다.
2D ray/segment/point API를 spatial world에서 호출하면 `SpatialQueryRequires3d` 진단과 빈 결과를 반환한다.
임의 높이의 평면으로 추측하거나 legacy XY 충돌 결과로 fallback하지 않는다. 이 Rust API는 아직 Web 공개 ABI가 아니다.

추가 회귀는 native 4개·Engine 7개이며 전체 검증은 `artifacts/physics-3d/query-integration-qa/report.json`에 기록한다.
현재 authored 동기화는 query마다 World body 목록을 확인하므로 대량 batch query 비용 측정과 변경 추적 최적화가 남아 있다.
영역/nearest/shape cast 연결은 다음 절에서 이어졌다. 접촉/manifold와 lifecycle/impact/feedback/stat의 native 연결,
기본 backend 전환·HD-2D 게임플레이·Web/Studio·snapshot/replay·최종 브라우저/성능/package 검증은 계속 진행한다.


### 영역·최근접·형상 이동 조회 연결

기존 Engine의 AABB·circle·oriented box·capsule·convex polygon 영역 조회 및 shape cast와
`query_nearest_body`의 기본/height-span 경로를 통합 planar world에 연결했다. collider/component 변경은
이전 ray·point adapter와 같은 사전 동기화를 사용하고, 힘/충격량·fixed clock은 소비하지 않는다.
영역 조회는 entity별 하나, shape cast는 fixture별 첫 hit를 반환한다. spatial world의 XY-only 요청은
`SpatialQueryRequires3d`로 거부하며 기존 2D 충돌 계산으로 fallback하지 않는다.

`PhysicsWorld3d.sweep_all`은 이동 전후 AABB를 합친 범위에서 native broadphase 후보를 얻고,
실제 convex-vs-target cast를 수행해 fraction·collider identity 순으로 정렬한 뒤 상한을 적용한다.
좌표/법선은 target의 local witness를 world로 변환한다. Engine의 기존 bulk 결과는 target 표면점이 아닌
**충돌 시점의 이동한 도형 기준점**을 유지한다. AABB/box/circle는 중심, capsule은 끝점 평균,
convex polygon은 기존 계약대로 vertex 산술평균을 기준점으로 쓴다.

이동 벡터가 0이면 GJK 방향 기반 cast가 초기 겹침을 놓치는 현상을 재현했다. 이 경우에는 native contact를
조회하여 fraction 0의 접촉점을 반환한다. 단건 `sweep`에도 같은 처리를 적용했다. 이 수정은 물리를 step하지 않는다.
query용 box는 폭/높이/깊이 0을 허용해 기존 degenerate AABB를 지원하지만, 실제 body collider의 양수 크기·질량 조건은 유지한다.
나머지 shape는 현재 native 크기·좌표 한도를 적용한다. convex polygon query는 world 위치를 기준점으로 분리한 뒤
local hull을 만들어 큰 world offset 때문에 shape-local 범위를 초과하지 않도록 한다.

`PhysicsWorld3d.project_point_all`은 요청 거리의 AABB 후보에서 실제 최근접 표면점을 계산하고 Euclidean 거리로 거른다.
solid 내부 점은 입력점과 거리 0을 반환한다. 결과는 거리·collider identity 순이며, Engine nearest는 같은 거리에서
entity identity를 우선한다. overlap도 전체 결과를 정렬한 뒤 작은 collider identity부터 상한을 적용해 BVH 순서 의존을 없앴다.
각 수집 버퍼는 world collider capacity까지 커질 수 있고 반환 limit은 임시 메모리 상한이 아니다.

기존 convex ring 검증은 연속한 세 점의 회전 방향만 검사해 자기 교차 별 모양을 허용했다. 실패 테스트로 재현한 뒤
모든 나머지 vertex가 각 edge의 동일한 내부 반평면에 있어야 하는 조건을 추가했다. 이 검증을 query 및 기존 planar
polygon fixture 이전에 함께 적용해 잘못된 polygon을 convex hull로 조용히 채우지 않는다. 직접 작성한 native 3D
`Shape::ConvexHull`의 점 집합은 별도 계약이므로 unordered point-cloud 사용을 제한하지 않는다.

새 회귀는 native 5개·Engine 7개다. 회전 target의 GJK witness는 접선 방향 근사 오차를 고려하되,
impact fraction·surface normal은 더 엄격한 오차로 검증한다. 수정 전 실패와 최종 전체 결과는
`artifacts/physics-3d/shape-query-integration-qa/report.json` 및 해당 단계 로그에 보존한다.

접촉/manifold·impact/feedback/stats/diagnostic 이전, 기본 backend 전환과 실제 HD-2D 지형/게임플레이,
Web/Studio/schema·native snapshot/replay·최종 브라우저/성능/package/license 수용 검증은 남아 있다.
이 단계는 공개 Web 물리 backend 전체 전환 완료를 뜻하지 않는다.


### Engine 충돌 lifecycle과 아이템 획득 연결

`engine/unified_physics/collision_events.rs`가 native collider 전이를 기존 entity identity로 변환한다.
콜라이더 쌍마다 entity 쌍을 기억하고 참조 수를 유지해 복합 fixture의 중복 Enter와 이른 Exit를 방지한다.
solid와 sensor 채널은 독립적이므로 한 entity 쌍이 두 채널을 동시에 가질 수 있다.
body 삭제·World despawn 정리·planar component 제거에서는 body→entity 매핑을 지우기 전에 전이를 회수한다.
종료 이벤트는 삭제된 세대를 유지한다. 기존 `CollisionEvent` 24-byte ABI는 바꾸지 않았다.

Stay는 완료된 native step에서만 생성한다. 자동 step off·잘못된 수동 dt·0초 update는 Stay를 만들지 않는다.
수동 step과 명시적 삭제에서 쌓인 이벤트는 다음 일반 lifecycle flush까지 보관한다.
쿼리가 fixture를 제거하면 상태와 대기 전이는 갱신하지만 frame buffer로 전달하거나 물리를 진행하지 않는다.
telemetry 재활성화/히스토리 reset 시 현재 접촉을 Enter로 다시 시작한다.

native `max_events`는 collider 전이 queue와 entity 대기 queue, 한 Engine frame의 native lifecycle 출력 각각에 적용한다.
게임플레이 Hit 이벤트를 이 상한으로 잘라내지는 않는다. `unified_collision_event_diagnostics()`는
native 전이 누락과 entity 출력 누락을 구분한다. `PhysicsWorld3d.active_collision_pairs()`와
`Engine.unified_collision_pairs()`는 마지막 완료 tick 및 회수한 명시적 삭제 기준의 전체 상태를 제공한다.
상한 초과 시 adapter는 전체 snapshot으로 내부 상태를 복구한다. 이미 누락된 일시적 접촉의 이력을 복원하지는 못한다.
전체 active pair 저장과 복구 snapshot 크기는 `max_events`가 아니라 실제 접촉 쌍 수에 비례하며,
밀집 world의 메모리/시간 수용 검증 대상이다. static-static solid의 단순 기하 중첩은 native contact event가 아니고,
센서는 static-static도 검사한다. 즉시 overlap query와 마지막 물리 tick의 lifecycle 상태를 구분한다.

Data Scene pickup은 telemetry on/off와 무관하게 이 전체 pair 상태를 사용한다. solid/sensor 중복은
획득 후보에서 합치고 기존 combat-enabled 경로의 4096 pair 제한은 유지한다. 화면 투영/visual anchor를 다시 충돌 검사하지 않아
같은 화면 좌표의 다른 높이에서 잘못 줍는 현상을 막는다. 이벤트 queue가 넘쳐도 현재 접촉 상태로 획득을 처리한다.
실제 tick 종료 시점에 이미 떨어진 일시적 sensor 접촉을 소급해 획득으로 처리하지는 않는다.
기존 전투·projectile·상호작용 거리·HD-2D 캐릭터/지형 전체 이전은 아직 남아 있다.

추가 회귀는 Engine 16개와 native snapshot 1개이며 실제 `Engine.update`와 수동 step을 통해 검증한다.
집중 로그는 `artifacts/physics-3d/collision-events-expanded.log`, 전체 QA는
`artifacts/physics-3d/collision-lifecycle-qa/report.json`에 보존한다.
접촉/manifold·충격/효과/진단과 기본 backend 전환, Web/Studio/schema·native snapshot/replay,
최종 브라우저/성능/package/license 수용 검증까지 마쳐야 전체 목표를 완료할 수 있다.


### 즉시 접촉/manifold 조회와 평면 extrusion 보정

`PhysicsWorld3d.query_contact_manifolds`는 현재 collider bounds를 갱신하고 BVH 후보에서 Parry의 접촉면 계산을 사용한다.
물리 tick을 실행하거나 narrow-phase cache/이벤트/kinematic target/힘을 소비하지 않는다.
category A/B로 방향을 정하며 양쪽 collision mask와 planar floor/height 조건을 적용한다. sensor는 옵션이다.
고정 바디끼리의 기하 접촉도 조회하므로 마지막 solver contact/lifecycle과 같다고 해석하지 않는다.
관절의 collision-disable 및 simulation collision-type 선택은 이 기하 조회의 필터가 아니다.

결과는 collider/subshape identity 순이고 각 patch에 first→second world normal, 양쪽 XYZ surface witness와
penetration을 보관한다. prediction distance는 0이며 떨어진 예측 접촉은 제외한다. 서로 다른 pair에서
접촉 feature/workspace를 재사용하지 않아 다른 geometry의 이전 manifold가 섞이지 않도록 한다.
전체 후보·접촉 patch와 내부 point vector의 크기/할당 비용은 실제 geometry 수에 비례한다.
명시적 전체 조회를 `max_events`로 잘라내지는 않으며 dense query 수용 측정은 남아 있다.

`Engine.query_unified_contact_manifolds`는 entity 세대를 추가해 XYZ 결과를 제공한다.
기존 `query_body_contacts`와 `query_body_manifolds`는 unified planar world에서 같은 native geometry를 사용한다.
36-byte contact 및 56-byte manifold ABI는 유지한다. contact point는 첫 collider 표면의 대표점이며,
manifold는 XY로 투영한 first-surface witness의 접선 양 끝을 최대 두 점으로 유지한다.
Z축 양 끝에서 같은 XY로 투영된 점은 중복으로 세지 않는다. 공간 world의 XY-only 호출은 기존처럼 거부하며,
명시적 3D geometry가 planar world에서 Z 법선을 만들면 `OutOfPlane`을 기록해 조용한 누락을 막는다.
실패한 기존 bulk 호출은 해당 출력 버퍼를 비우고 Rust typed 호출은 caller output을 보존한다.

조회 연결 중 이전 2D box/hull을 반두께 0.5로 변환한 결함을 재현했다. 깊은 XY 겹침에서
3D 접촉 계산이 더 짧은 Z 방향을 선택하면 축 잠금 때문에 XY 분리로 이어지지 않는다.
기존 2D box·OBB·convex polygon과 대응 query는 Z 반두께를 XY 외접 반경 + 1로 변환한다.
각 도형의 어떤 XY support radius보다 커서 Z 접촉이 선택되지 않으며, body-local 회전·offset은 유지한다.
이 derived extrusion을 위해 planar box/hull의 Z 범위만 30000까지 허용했다. XY 및 spatial 범위 10000은 유지한다.
직접 작성한 3D `Shape`는 입력 치수를 보존한다. legacy fixture는 density 0과 명시적 authored mass/inertia를 사용하므로
extrusion 변경으로 기존 2D 질량·관성이 변하지 않는다. 실제 깊은 겹침의 틱 분리와 최대 XY 치수를 검사한다.

extrusion 변경 후 전체 회귀에서 기존 8단 stack의 잔류 수평 속도가 0.2757로 기준 0.05를 초과했다.
anchor Z 투영만으로는 같은 실패가 유지됐다. planar contact hook에서 world XY 순서로 접촉을 정렬하고,
양쪽 surface의 XY 및 접촉 거리가 같은 중복 접촉을 합친 뒤 Z anchor를 평면에 투영해 수정했다.
공간 world에는 이 축소를 적용하지 않는다. 기존 stack의 두 split 모드 검사 기준은 변경하지 않았다.
동일 질량/관성으로 Z 반두께 0.5/1.7/100을 바꿔도 두 native 마찰 모델의 정착 위치/회전이 일치하는 회귀를 추가했다.
최초 전체 실패는 QA의 `attempts/stack-settling-failure/`, projection 단독 실패는
`artifacts/physics-3d/contact-query-stack-projection.log`, 수정 뒤 집중 성공은
`artifacts/physics-3d/contact-query-stack-dedup.log`와 `contact-query-depth-invariance.log`에 보존한다.

새 회귀는 native 6개·Engine 7개다. 첫 깊은 box 접촉 실패는
`artifacts/physics-3d/contact-query-before.log`, 집중 성공은 `artifacts/physics-3d/contact-query-focused-final.log`,
전체 검증은 `artifacts/physics-3d/contact-query-qa/report.json`에 기록한다.
이 조회는 solver impulse를 제공하지 않는다. 충격량/impact/feedback 연결은 아래 별도 단계에서 수행했다.
solver stats/CCD debug·기본 backend와 실제 게임 이동/전투,
Web/Studio/schema·snapshot/replay 및 최종 성능/브라우저/package/license 수용 검증은 계속 남아 있다.


### solver 충격량·충돌 보고·효과 연결

`PhysicsWorld3d.contact_impulses`는 마지막 완료 고정 tick의 실제 solver 접촉을 제공한다. geometry query나
warm-start cache snapshot이 아니다. callback은 solver-active pair에 대해서만 실행하고, manifold의
solver contact id를 사용해 평면 dedup으로 제외한 과거 접촉점을 다시 세지 않는다. 센서는 포함하지 않는다.
내부 solver substep의 impulse 누계를 한 번씩 수집하며 CCD와 관절의 별도 solve callback은 같은 tick buffer에
추가한다. 정상적인 warm-start 재적용은 해당 step의 실제 impulse에 포함하되 이전 step의 저장 값을 중복 가산하지 않는다.

`ContactImpulse`에는 collider/body 세대, 실제 두 fixture의 category 합집합, 생성 시점 world-space 접촉점,
첫 collider에서 두 번째로 향한 법선, normal impulse 누계, 두 번째 body에 적용된 friction impulse XYZ,
접촉점 접근 속도가 들어간다. 접근 속도는 warm-start/적분 전 constraint 생성 시점에 각속도까지 포함해 계산한다.
동일 constraint 내부에서 나중에 증가한 속도의 최대값이라는 뜻은 아니다. 두 friction 모델 모두 실제 누계를
world basis로 변환한다. Simplified 모델은 manifold 중심의 공유 friction impulse를 solver point 수로 나눠
보고 합계가 실제 하중과 일치하도록 한다. 별도의 twist friction 각충격은 선형 impulse vector에 포함하지 않는다.

이 정보를 얻기 위해 vendor의 normal constraint와 `ContactData`에 transient observation을 추가했다.
solver 계산식과 warm-start 입력은 바꾸지 않는다. `solved` 필드는 serde에서 제외하며 이 변경이 native
snapshot/replay 구현을 뜻하지는 않는다. 수정 범위와 라이선스 고지는 vendor의 `FERRUM-PATCHES.md`를 따른다.

`max_events`는 collision transition, solver contact observation의 각 버퍼에 독립적으로 적용한다.
`ContactImpulseDiagnostics`는 상한 적용 전 관측 수와 누락 수를 제공한다. 반복 조회는 drain하거나 step하지 않는다.
새 tick은 이전 관측을 교체한다. 자동 실행 off, zero dt, 검증 거부, geometry query는 마지막 관측을 보존한다.
수집 상한과 보고 설정은 시뮬레이션 결과를 바꾸지 않는다. 엔진의 추가 frame impact 버퍼는 기존 4096개 상한이다.
수집 단계에서 먼저 누락된 관측의 속도/프로파일을 알 수 없으므로, 켜진 impact/feedback 소비자에는 이 누락을
보수적으로 전부 합산한다. 진단 수가 프로파일에 맞는 효과의 정확한 누락 수라는 뜻은 아니다.

`Engine.unified_contact_impulses`는 entity 세대를 추가한 XYZ 관측을 읽는다. 기존 `query_rigid_contact_impulses`와
`query_physics_contact_impacts`의 40-byte ABI도 같은 결과를 사용한다. normal과 friction, 위치는 planar에서 XY,
spatial에서 X/-Z로 투영한다. spatial의 투영 법선은 길이가 1이라는 보장이 없으며 수직 충돌이면 0이다.
법선 충격량은 원래 3D 크기를 유지하고, 2D tangent scalar는 투영 법선의 수직 방향과 friction vector의 내적이다.
공간 법선/elevation을 사용하는 로직은 반드시 XYZ 관측을 사용한다. visual anchor offset은 충격점을 옮기지 않는다.

자동·수동 정상 step은 World의 마지막 step 보고와 Engine의 frame impact 보고를 갱신하고 효과를 처리한다.
여러 고정 tick이 한 frame에 실행되어도 초기 tick의 impact를 보존한다. invalid/zero step은 재방출하지 않는다.
기존 접근 속도 조건(보고: 설정값 초과, feedback: 1 초과), 최소 normal impulse 및 pair cooldown을 유지한다.
효과 profile의 category는 실제 접촉한 fixture에서 가져온다. primary collider가 없거나 다른 secondary fixture에
category가 있어도 잘못 추론하지 않는다. impact reporting을 꺼도 feedback은 동작한다.
공간 소리·파티클 발동과 화면 좌표 투영은 연결했지만 기존 2D particle buffer가 elevation을 표현하는 것은 아니다.
공간 파티클 표현은 후속 renderer/API 연결에서 별도로 다룬다.

회귀는 native 6개와 Engine 7개다. 두 모델/공간/관절 유무에서 normal+friction impulse를 실제 운동량 변화와 비교하며,
warm-start 계수 0/0.5/1, 회전 접근, 센서/수면, overflow, 자동/수동 step과 category/세대/좌표 경계를 포함한다.
CCD budget 1은 첫 tick에 위치만 TOI로 제한하고 다음 tick에 접촉을 풀 수 있다. 이 위치 제한이나 별도의
400×length-unit 속도 상한에 의한 운동량 감소를 충돌 impulse로 꾸며 보고하지 않는다. 테스트는 속도 상한 아래에서
budget 1과 4의 각 tick에 대해 하중과 운동량을 비교한다.
집중 로그는 `artifacts/physics-3d/contact-impulse-focused.log`, 전체 QA는
`artifacts/physics-3d/contact-impulse-qa/report.json`에 기록한다.

접촉 observation count를 solver iteration/CCD 검사 횟수로 대신하지 않는다. native 실측 통계/CCD debug 연결은
아래 단계에서 추가했다. 증가한 contact/constraint 저장 공간과 force callback의 밀집 비용도 최종 budget 측정 대상이다.
기본 backend 전환·실제 HD-2D 게임/지형/전투·Web/Studio/schema·native snapshot/replay·최종 브라우저/성능/package/license
검증은 계속 남아 있으며 native opt-in 통과만으로 전체 물리 개발을 완료 처리하지 않는다.


### native 실측 통계와 CCD 표시 연결

`PhysicsWorld3d.step_statistics`는 마지막 완료 tick의 `StepStatistics`를 제공한다. `backend_steps`는
실제 native pipeline 호출 수이며 native 내부 PGS 반복 수가 아니다. `solver_contacts`는 solver에 제출된
contact point 수, `solver_constraints`는 contact manifold와 impulse joint 수다. 이 작업 수와 native CCD
substep 수는 관절을 위한 외부 pass·CCD 시간 분할을 모두 합산한다. `tracked_contact_pairs`는 마지막
backend pass의 narrow-phase 보유 pair 수이며 touching pair 수와 다르다.

body/island gauge는 tick 종료 상태다. enabled dynamic body 수(수면 포함), 회전 가능한 inverse inertia가
있는 dynamic 수, 잠든 dynamic 수, enabled dynamic/kinematic의 persistent island 수·최대 크기를 제공한다.
수면 전이는 tick 시작/종료의 상태 차이이며 authored 설정으로 step 전에 깨운 body나 tick 내부에서 깨었다
다시 잠든 중간 이력을 세지 않는다. native island id는 외부 안정 핸들로 노출하지 않고 내부 집계에만 사용한다.
관절 파손은 native step 전후 joint 수의 차이로 세므로 제한된 joint event queue의 누락과 무관하다.

CCD가 호출하는 collider-pair cast를 직접 센다. 시간 구간 선택을 위한 `ccd_prediction_checks`와 solve 뒤
이동 검사인 `ccd_clamp_checks`를 구분하며, compound child/GJK 내부 반복은 별도 check가 아니다.
센서 검사는 check에 포함할 수 있지만 이동을 제한하지 않는다. mask/floor filter에서 탈락한 pair는
cast 전 제외되므로 세지 않는다. `ccd_clamps`는 실제 body pose를 제한한 횟수다. 위치를 제한해도 속도를
그대로 보존하고 다음 tick에서 접촉 impulse를 풀 수 있으므로 이를 충돌 충격량으로 간주하지 않는다.

vendor CCD의 결과 전달형에 이미 계산된 fraction·witness point·normal과 collider identity를 보존했다.
proxy/composite 결과는 target에서 moving shape로 향하는 world normal을 사용한다. nonlinear fallback은
자체 반환한 witness와 normal을 world space로 변환한다. 진단 때문에 추가 geometry query를 수행하거나
기존 fraction 선택·motion clamp 계산을 바꾸지 않는다. 변경 파일은 이전 12개에 CCD 3개와 dynamics
re-export 1개를 추가한 총 16개이며 추가 Rust 파일은 기존 contact correction 1개다.

`PhysicsWorld3d.ccd_clamps`는 마지막 tick의 제한된 XYZ 증거다. 각 항목의 fraction은 그 CCD sweep
구간 안의 비율이며 전체 frame/tick의 절대 시간이 아니다. 실제 sweep duration을 함께 제공한다.
각 backend call 직전에 CCD 진단을 초기화하고 결과를 전체 tick buffer로 합친다. `max_events`는 이
buffer에도 독립적으로 적용하며 초과해도 실제 검사·clamp 횟수와 운동은 유지한다. transient 진단은 serde에서 제외한다.

`Engine.unified_physics_step_statistics`, `unified_physics_frame_statistics`, `unified_ccd_clamps`는
native Rust API다. frame 통계는 작업 수를 누적하고 body/island gauge는 마지막 완료 tick의 값을 보존한다.
frame에 native tick이 없으면 frame 통계는 0이며 마지막 step 통계는 유지한다. 성공한 수동 tick도 현재
frame에 누적하고 invalid/zero dt·geometry query·자동 실행 off는 재집계하지 않는다.

기존 `RigidBodyStepStats`에는 body/island gauge, 수면 전이, backend 호출 수(`substeps`), CCD check 합계,
실제 clamp 수(`ccd_hits`), 파손 수만 매핑한다. warm-start 횟수·block solves·correction rows·legacy cache
entries 같은 이전 solver 구현 전용 수는 native에서 미측정이며 매 tick 0으로 초기화해 과거 값을 재사용하지 않는다.
이 0을 native 작업이 없다는 증거로 사용해서는 안 된다. Web에 native mode를 공개할 때는 typed native
지표와 지원 여부를 함께 연결해야 한다. 접촉 point 수를 impulse 적용 횟수/iteration 횟수로 바꿔 부르지 않는다.
legacy frame의 sleeping_bodies는 기존과 같이 각 tick gauge의 합이며 native frame gauge와 구분한다.

기존 CCD 디버그 cross/normal 선은 같은 witness에서 생성한다. planar XY와 spatial X/-Z 투영이며
visual offset을 적용하지 않는다. spatial 높이·법선 전체는 XYZ API를 사용한다. 한 frame 안 여러 tick의
초기 CCD를 보존한다. Engine frame 증거는 4,096개로 제한하고 native tick 누락과 frame 초과를 합친
`ccd_observations_dropped`를 별도로 제공한다. 표시 한도와 무관하게 검사/제한 횟수는 계속 누적한다.
기존 planar distance/angle 파손은 native force 파손과 분리한 `authored_joint_breaks`로 보고하고,
legacy 파손 지표에는 둘을 합친다.

native 9개·Engine 6개 신규 회귀로 측정/좌표/필터·수면/깨움·관절 pass·overflow/세대·frame 경계를 검증한다.
실제 수동 tick에서 4,100개의 clamp를 만들어 4,096개 증거·4개 누락·4,100회 통계가 유지되는지 확인한다.
집중 로그는 `artifacts/physics-3d/statistics-focused.log`, 전체 QA와 vendor CCD integration 결과는
`artifacts/physics-3d/statistics-qa/report.json`에 기록한다. body 순회/island 정렬, CCD evidence 저장의
밀집 장면 비용은 최종 성능 수용 검사에서 측정해야 한다.

다음은 실제 게임 실행 경로의 이전 범위를 확인하고 기본 backend·HD-2D 이동/지형·전투와 authoring/저장 계약을
연결하는 작업이다. Web의 native 통계 지원 표시와 geometry/debug 전체 연결, native snapshot/replay,
최종 Wasm/browser/Studio/package/license/성능·실게임·실기기 검증까지 완료해야 전체 목표를 달성한 것이다.


### Data Scene 충돌 반응·상호작용의 물리 기준 이전

`engine/unified_physics/gameplay.rs`와 기존 Data Scene post-physics 실행 경로를 연결했다.
통합 world에서 combat의 일반 충돌 반응은 native active pair snapshot을 사용한다. 기존 contact tracker의
Enter 기반 소리/효과 규칙과 gameplay 상한(2,048 entity index, 4,096 pair)은 유지한다. 같은 entity의
복합 fixture 및 solid/sensor 채널은 pair 한 개로 합친다. native event queue의 출력 상한이나
collision telemetry off는 실제 피해 대상 선택을 줄이지 않는다. 제거된 세대는 반응 처리 전에 제외한다.

공통 reaction 실행기는 `CollisionReactionPhysics`를 통해 범위 피해와 넉백에 필요한 물리 연산만 분리한다.
기존 faction/guard/피해/사망/이벤트 적용은 같은 코드에서 처리한다. 이 인터페이스는 Rust 내부 경계이며
새 JS/Wasm per-entity 호출이나 별도의 TypeScript simulation을 만들지 않는다.

범위 피해는 source body의 실제 중심을 기준으로 native sphere overlap을 수행한다. Spatial은 full XYZ이며
PlanarXy는 논리 floor/height를 유지한다. 대상은 기존 `target_layer`에 해당하는 실제 fixture category로
선택한다. 따라서 World의 대표 2D collider가 없는 명시적 native body와 보조 fixture의 category도 작동한다.
기존 범위 query 의미에 맞춰 sensor를 포함하고 target mask와 관계없이 category를 검사한다.
같은 body의 여러 fixture는 entity당 한 번만 피해를 준다. 기존 반응당 피해 수 상한과 entity 순서는 유지한다.
query 오류는 sticky native 진단으로 남기고 legacy geometry로 재시도하지 않는다.

넉백은 실제 body 중심을 잇는 XYZ 방향으로 native 속도를 더하고 World 표현도 갱신한다. 기존 `impulse`
필드는 물리 단위 N*s가 아니라 속도 증가량이라는 의미를 유지하므로 질량으로 나누지 않는다.
dynamic 및 velocity-kinematic body에 적용하며 fixed·position-kinematic/character-controlled body는 거부한다.
실패하면 native/World 속도에 부분 적용하지 않는다. character의 별도 외력/넉백 입력 지원은 남은 개발 항목이다.
반응 결과의 기존 2D impulse 표시는 PlanarXy의 XY 또는 Spatial의 X/-Z 투영이며 실제 수직 속도는 native에 보존한다.

근접 상호작용 역시 native body 중심 사이의 거리를 사용한다. render offset과 보간된 화면 위치는 제외한다.
Spatial은 XYZ 거리로 높이 차이를 판단하며 논리 floor 번호 자체로 떨어뜨리지 않는다. body가 없는 marker는
World의 `(x, elevation, -y)` 위치를 사용한다. PlanarXy는 XY와 기존 논리 floor/height 필터를 유지한다.
입력 없는 proximity·입력 시 가장 가까운 한 대상·guard·once·프레임 중복 방지 규칙은 유지한다.

실제 Engine 고정 tick 회귀 12개는 `engine/unified_physics/gameplay_tests.rs`에 있다.
명시적 native body와 기존 authored planar body, event overflow, 여러 fixture, 수직 거리, 잘못된 visual
방향, 다음 tick까지 이어지는 넉백, stale entity 재사용, 입력/once/marker를 검사한다.
검증 증거는 `artifacts/physics-3d/gameplay-qa/report.json`을 따른다.

이 단계는 전투 전체 이전 완료가 아니다. 생성 projectile의 body ownership·지속 이동·sweep/terrain impact,
melee/line-of-sight, dash/navigation, 실제 HD-2D actor·terrain 및 character 외력은 계속 이전해야 한다.
기본 backend 전환, Web/schema/Studio, native snapshot/replay, 최종 비용·패키지·실게임/실기기 수용도 남아 있다.


### 생성 투사체의 native ownership·이동·첫 hit 연결

`engine/unified_physics/projectiles.rs`를 실제 Data Scene 입력/타이머 발사와 고정 tick에 연결했다.
생성한 entity를 native velocity-kinematic sensor body에 등록한 뒤 이전 World collider를 제거한다.
등록은 World 적분과 cooldown 성공 처리 전에 수행한다. 실패 시 생성한 entity를 회수하며 성공 event,
cooldown, native body를 남기지 않고 action failure와 sticky native 오류를 기록한다. 기존 일반 강체의
동작이나 모든 collider-only body를 움직이는 방식으로 우회하지 않는다.

PlanarXy는 기존 AABB의 XY 크기를 유지하는 native box와 논리 span을 사용한다. Spatial은 기존 수평
footprint를 X/Z에, projectile span 높이를 Y 두께에 배치한다. source가 native body면 물리 중심에서
발사하며 render offset을 spawn/목표/방향에 넣지 않는다. 입력은 물리 높이 평면을, timer는 물리 target
좌표를 사용한다. billboard elevation은 표현 속성이다. 기존 action은 수평 발사이며 새 XYZ aim schema를
완료한 것은 아니다.

backend step 직전에 시작 pose를 저장하고 실제 완료 pose까지 native box sweep을 수행한다.
fixture category/mask·sensor·source entity 제외를 적용하고 entity 세대와 거리 순으로 첫 hit를 선택한다.
Planar span은 검사 query의 `missing 제외`가 아니라 body collision의 `missing wildcard` 계약을 사용한다.
일반 2D authoring에서 가져온 대상과 명시적 native XYZ 대상 및 triangle mesh 벽을 같은 query로 검사한다.
첫 hit에서 body를 실제 접촉 위치로 옮기고 속도를 0으로 만든다. hit는 다음 gameplay phase까지 보관하므로
여러 수동 step이나 진단 조회가 소비하지 않는다. 일반 update의 damage/despawn/tile-impact 규칙으로 한 번
처리하며 재사용된 target generation에는 피해를 주지 않는다. output pair cap에 도달한 projectile도
정지한 채 영구 잔류하지 않도록 제거한다. 수명 종료/재설정/씬 교체와 entity 삭제 시 native ownership을 회수한다.

Rapier 0.36.1의 기존 선형 상한은 velocity-kinematic 명령까지 400 × length_unit으로 감속시켰고,
position-kinematic은 목표 pose와 보고 속도가 서로 달라졌다. 고정한 vendor의 solver-body flag에
kinematic 종류를 보존하고 선형 상한에서만 제외했다. dynamic/soft-frame의 선형 상한과 각속도 상한은
유지한다. 실제 고속 투사체의 여러 tick과 직접 native 두 공간·두 kinematic 종류에서 회귀 검증한다.
원본 17개 파일 수정·Rust 파일 1개 추가이며 provenance/license와 cumulative diff를 QA에 기록한다.

초기 projectile 이전은 기존 tile hit와 native entity hit의 거리를 비교하는 중간 단계였다. 아래 지형 등록
단계에서 이 우회 판정을 제거했다. native entity sweep은 아래 상대 운동 query와 solver 내부 기록으로 확장했다.
이 sweep을 Rapier pipeline CCD 횟수/위치 제한 통계로 합산하지 않는다. 밀집 query 비용도 아직 수용하지 않았다.

기존 planar body의 World pose 수정은 native tick 시작에 반영되므로, 발사 phase에서는 해당 pending authoring
위치를 먼저 읽는다. 이 경로에는 render offset이 없다. 명시적 native body는 계속 실제 물리 pose를 읽는다.
이 차이를 빠뜨리면 같은 tick에 actor를 100에서 200으로 옮겼을 때 projectile이 이전 위치 100에서 발사되는
문제가 재현됐다. 수정 전 실패는 `artifacts/physics-3d/projectile-pending-pose-before.log`에 보존한다.
추가 회귀는 Engine 15개·native 1개다. vendor 포함 원본 QA는 `artifacts/physics-3d/projectile-qa/report.json`,
pose 수정 후 최종 core QA는 `artifacts/physics-3d/projectile-pose-qa/report.json`에 기록한다.
이후 solver 내부 궤적 기록·tile/HD terrain·melee/dash/navigation·실제 character 이동/외력, 기본 backend 전환,
Web/schema/Studio, native snapshot/replay, 최종 Wasm/browser/CI/package/performance·실게임/실기기 검증을 계속한다.

### 투사체와 이동·회전 대상의 상대 운동 query

`physics3d/queries/step_motion.rs`는 활성 투사체가 있는 tick에서 대상 collider의 backend pass별 pose를
기록한다. 위치 authoring을 먼저 반영하되 solver를 추가 실행하거나 pending force/kinematic target을 소비하지
않는다. 여러 조인트 pass는 각각 시간 구간을 보존한다. 별도 BVH와 작업 버퍼를 재사용하고 전체 tick에서
동일한 대상 경로를 조회하므로, 먼저 맞은 투사체의 `set_pose`가 나중 판정에 영향을 주지 않는다.

선형 운동은 양쪽 이동을 함께 cast하고, 회전은 실제 질량 중심을 pivot으로 하는 nonlinear cast를 사용한다.
회전하는 도형과 offset fixture는 시작/종료 AABB만 합치지 않고 pivot 기준 외접 구의 이동 범위를 포함한다.
충돌 시점의 world witness/normal을 반환하고 같은 collider의 여러 구간 hit는 가장 이른 하나로 합친 뒤
시간·collider 순으로 정렬한다. 기존 source/entity generation/mask/sensor/planar span 규칙은 유지한다.

기존 코드에서 평면 교차 대상이 피해를 받지 않는 실패를
`artifacts/physics-3d/projectile-motion-before.log`에 보존했다. Engine 추가 4개·native 추가 8개는 교차/동행/수직
이동, 회전 막대와 offset fixture, 충돌 시점·witness, 초기 겹침, 삭제/재사용과 빈 world, query 필터/입력 보존,
조인트 구간 중복 제거·limit, 120틱 solver 상태 동일성을 검사한다. QA는
`artifacts/physics-3d/projectile-motion-qa/report.json`을 따른다. 이번 변경은 vendor를 수정하지 않는다.

이 구현은 각 backend pass의 실제 시작/종료 pose 사이를 질량 중심 이동과 최단 회전으로 보간한다.
pass 내부의 접촉 후 반전·CCD clamp 전후 궤적이나 한 pass에서 여러 바퀴 도는 운동은 끝 pose만으로
복원할 수 없다. 이 공백을 아래 solver 내부 기록으로 확장했다. 고밀도 시간/메모리 예산,
기본 backend 전환·native terrain·Web/Studio/schema·snapshot/replay와 최종 제품 검증도 여전히 미완료다.

### 실제 solver 적분 구간과 CCD 제한 경로 기록

고정한 Rapier의 기본 비활성 motion observer를 통해 dynamic/velocity-kinematic body가 실제로 적분한
COM pose와 시간 구간을 받는다. 기존 선형/각속도 제한을 적용한 뒤 적분 전후의 pose를 복사한다.
각 적분을 따로 보존하므로 한 backend pass에서 방향이 바뀌거나 여러 바퀴 돌아도 끝 pose 하나로 압축하지 않는다.
solver 계산식·속도 제한·적분은 바꾸지 않으며 callback은 Rust 내부에서만 실행한다.
observer mask·MotionTrace·StepMotion·BVH 버퍼를 재사용하고 활성 투사체가 없으면 기록하지 않는다.

CCD는 실제 clamp 적용 후 시작/제한된 COM pose와 fraction을 별도 callback으로 전달한다.
그 시간 구간의 제한 전 solver 경로를 버리고 승인된 이동과 남은 시간의 정지를 기록한다. 같은 body의 반복 clamp는
fraction을 곱한다. 이 데이터는 bounded 진단 출력과 독립적이므로 report overflow가 게임 판정을 바꾸지 않는다.
조인트의 마지막 위치 투영은 시간이 없는 endpoint로 검사하며 순간 보정을 별도 이동 시간으로 만들지 않는다.
서로 다른 worker의 기록은 body/time 순으로 정렬한다. worker에서 RigidBodySet의 concurrent 읽기나 새 unsafe를
추가하지 않으며, 이 observer는 multibody link·soft-frame·soft particle을 대상으로 하지 않는다.

position-kinematic은 solver의 근사 중간 pose 대신 정확히 지정된 target의 backend pass별 보간을 유지한다.
각 solver interval 안의 궤적은 두 실제 pose 사이의 보간이다. 새로운 연속시간 적분법이나 native CCD 알고리즘으로
교체한 것이 아니며, 고속 회전에서 CCD 자체의 정확성과 position target의 내부 solver 근사는 추가 수용 대상이다.
기본 angular cap도 유지한다. 극단 회전 회귀는 backend fast-rotation opt-in을 사용한 내부 시험이다.

수정 전 full-turn·틱 내부 반전 누락은 `artifacts/physics-3d/solver-motion-before.log`에 보존했다.
native 추가 3개와 Engine 추가 1개는 두 회귀, CCD 1/4 time slice와 diagnostic overflow, 실제 Data Scene tick의
반전 대상 피해/소멸을 검사한다. 기존 120틱 기록 on/off 물리 상태·통계 동일성도 유지해야 한다.
최종 검증은 `artifacts/physics-3d/solver-motion-qa/report.json`을 따른다. vendor는 원본 22개 수정·Rust 1개 추가이며
UPSTREAM/LICENSE 및 cumulative diff를 별도로 확인한다. 이후 native terrain·기본 backend·Web/Studio/schema,
snapshot/replay와 실제 빌드/browser/CI/package/performance 검증을 계속한다. 수동 실게임/실기기는 개발 완료 후 진행한다.


### Authored 지형의 native 등록과 편집 — 부분 완료

main tile과 SpatialScene surface를 native fixed body/collider로 등록해 강체·capsule·투사체가 같은 geometry를
사용한다. main tile의 collision layer만 포함하며 tile 수정·definition·clear는 physics revision을 갱신한다.
SpatialScene은 실제 surface의 base/top/ramp를 사용한다. 기존 파생 Tilemap만 사용하면 walkable 바닥의 두께와
다리 아래 빈 공간이 없어지므로 XYZ world에서는 원본 surface를 변환한다. 같은 tile 좌표/surface id는 handle을
유지하고, 삭제 후 다시 만든 geometry는 이전 세대의 ground/hit와 구분한다. surface 배열 순서와 impact layer도 분리한다.

기존 body batch와 지형의 최종 capacity·형상을 먼저 검증하고 지형 삭제 → body 변경 → 지형 변경/생성을 적용한다.
오류 시 기존 지형·body 입력을 적용하지 않으며 예전 solver로 fallback하지 않는다. 지형 수집도 configured capacity에서
중단한다. revision이 같으면 geometry 재생성을 건너뛰고, 변경된 revision에서도 같은 descriptor는 native 갱신하지 않는다.
즉시 ray/shape/contact query에도 지형을 동기화하되 물리 tick·force·kinematic target·lifecycle 출력을 소비하지 않는다.

- Planar: cell box의 Z extrusion, 기존 slope segment의 양면 mesh, 선택한 논리 floor/span을 사용한다.
- Spatial 일반 tile: 명시한 span의 elevation~elevation+height가 벽이다. span이 없으면 0~tile-height의 유한 벽이다.
  기존의 높이 무제한 wildcard를 실제 XYZ geometry로 간주하지 않는다.
- Spatial walkable HD tile: elevation을 지지면 높이로 사용하고 ramp는 명시한 양 끝 높이를 사용한다.
  평면의 movement 차단 여부와 수직 지지의 의미를 구분한다. 상세 bridge 두께는 SpatialScene base/top으로 작성한다.
- SpatialScene: 실제 base부터 top까지 box/wedge, 두께 0인 지지면은 양면 mesh다. bridge의 밑면을 0까지 늘리지 않는다.
- One-way: collider-local plane과 상대 convex/compound의 정확한 최저 지지점을 native contact/CCD/controller에 공통 적용한다.
  검사 ray와 projectile sensor는 양면이며 one-way 정책을 제거하면 기존 충돌체 identity를 유지한다.
- Projectile: 기존 `projectile_aabb_blocking_tile_hit` 비교를 제거하고 native swept hit에서 cell/surface impact 정보를 얻는다.
  category/mask와 planar span을 적용하고 정확히 같은 시점이면 terrain을 entity보다 우선한다.
- Rust terrain ray API: `cast_unified_terrain_ray_all`, `UnifiedTerrainSource`, `UnifiedTerrainRayHit`.
  기존 entity 전용 ray 결과에 가짜 entity를 넣지 않는다. Web ABI는 아직 추가하지 않았다.

신규 terrain 회귀 8개와 projectile 회귀 2개는 실제 Engine 고정 tick·capsule·query를 사용한다. 지형 단계의
전체 테스트/lint/wasm32 check/consumer 및 source hash는 `artifacts/physics-3d/terrain-qa/report.json`에 기록한다.
기존 vendor patch(원본 22개 수정·Rust 1개 추가)는 이 단계에서 바꾸지 않았다.

이 단계의 이동 surface는 fixed geometry 재배치였다. 아래 이동 발판 단계에서 kinematic motion/relative projectile trace와
native capsule carry를 연결했다. tile별 body/collider 비용을 chunk/mesh로 줄이는 설계와 대형 지형 성능 검증,
시야 차단·나머지 tile query·terrain contact/impulse/impact 보고와 저장 계약도 미완료다.
전체 목표의 기본 backend 전환, melee/dash/navigation·HD actor 외력, Web/bulk/schema/Studio, native snapshot/replay,
최종 Wasm/browser/CI/package/license·성능 수용을 계속한다. 실게임·실기기 수동 검증은 개발 완료 후 진행한다.


### 이동 발판의 native 경로·고정 틱·capsule 운반 — 부분 완료

기존 Data Scene 업데이트의 `step_moving_platforms`는 native world가 없을 때만 실행한다. native world에서는
지형을 등록한 뒤 해당 surface를 position-kinematic body로 이동시킨다. actor 운반은 기존 World 좌표를 직접
옮기는 방식 대신 native capsule의 지지체 transform과 충돌 검사를 사용한다. 이동 발판의 shape는 원점 geometry를
재사용하고 body pose만 진행시켜 매 틱의 shape 갱신/teleport가 접지를 무효화하지 않게 한다.

발판 phase에서 다음 고정 틱의 목표와 모든 왕복 반전 시점을 준비한다. `kinematic_paths.rs`는 이 시점들을 모아
한 고정 틱을 구간으로 나누며, 같은 physics world의 body·joint·controller를 실제 구간 시간만큼 진행한다.
그동안 다른 position-kinematic target도 원래 틱의 목표에 맞춰 보간하고, native motion trace는 전체 틱의 시간으로
기록한다. 출발 위치로 돌아오는 발판도 중간 경로가 사라지지 않아 projectile sweep이 실제 교차를 검출한다.

통계/접촉 impulse/관절 peak는 고정 틱 시작에 한 번 초기화한다. controller의 translation·carry·ceiling·pair query
집계는 구간 전체를 합치고, grounded/vertical speed는 마지막 구간의 실제 상태다. `CharacterState.carried_by`와
`carry_translation`은 실제 수용된 운반 결과를 보고한다. 기존 `spatial_moving_platform_stats`의 carried는 해당
발판에 실제 운반된 native capsule 수이며 한 틱의 왕복 순변위가 0이어도 운반을 누락하지 않는다.

모든 입력/shape/capacity 검증 뒤 물리를 진행하고 성공 시에만 surface와 phase를 갱신한다. query·pause·자동 물리 OFF·
유효하지 않은 수동 틱은 phase를 진행시키지 않는다. 수동 유효 틱은 자동 틱과 같은 경로를 사용한다.
path 제거는 현재 위치의 fixed 지지면으로 전환하며, 같은 surface id와 collider handle을 보존한다.
핫패스의 path/target/cut/character 누적 버퍼를 재사용한다. authored 한도 16개와 기존 duration/고정 tick 범위를 유지한다.

추가 회귀는 Engine platform 5개 + projectile 1개 + native path 3개다. 기존 단일 구간 target 방식과 120틱의
body 상태·통계가 정확히 같고, 반전 구간과 관절이 함께 있는 tick에서도 목표 위치·힘·하중·motion 시간을 확인한다.
최종 명령/소스 해시는 `artifacts/physics-3d/platform-motion-qa/report.json`에 기록한다. vendor 변경은 없다.

이 단계에서 연결한 것은 장애물 없는 authored 경로의 운동·운반이었다. 발판 자체/탑승자 squeeze의
진행 제한과 native blocked 집계는 아래 후속 단계에서 연결한다. dynamic 지지체 운반, moving terrain 표시 보간,
Planar 모드의 시간에 따라 바뀌는 논리 height span 정책과 대형 지형 비용도 별도 수용이 필요하다.
기본 backend·나머지 HD actor/gameplay·Web/bulk/schema/Studio·snapshot/replay·최종 build/browser/package/성능의
전체 목표를 유지하며, 이 부분 구현을 물리엔진 완료로 판정하지 않는다.


### 이동 발판의 충돌 시점·진행 제한 — 부분 완료

`kinematic_limits.rs`가 발판 및 탑승자의 swept bounds를 BVH에 반영하고 collider-pair cast로 가장 이른
차단을 구한다. 고정 벽과 서로 접근하는 authored 발판, 탑승자가 천장/측면 벽에 끼는 경우에 해당 경로를
실제 충돌 시점에서 정지시킨다. 왕복 반전 이전의 충돌도 사라지지 않으며 움직이는 천장과 탑승자의 상대
이동을 검사한다. 정지한 발판은 다음 틱에 다시 검사하므로 장애물을 제거하면 같은 phase에서 재개한다.

충돌 시점까지만 실제 물리를 진행한 후 해당 경로를 멈추고 남은 틱은 계속 실행한다. 다른 body의 target과
지속 힘, projectile trace의 전체 틱 기준 시간은 유지한다. 영시점 접촉은 입력을 소비하거나 dt=0으로
적분하지 않고 새 경로를 정지시킨다. 한 틱에서 경로별 정지는 최대 한 번이며, 경로 수 16개 한도를 유지한다.

캐릭터 preview는 입력·상태를 보존/복구하고 dynamic push를 생략한다. 실제 구간에서만 점프를 소비하고
힘을 적용한다. `StepStatistics`의 `kinematic_path_casts`/`kinematic_path_failures`/`kinematic_path_stops`,
`character_preview_passes`/`character_preview_pair_casts`는 실측 작업량이며 frame에 합산한다.
지원하지 않는 cast는 해당 경로를 보수적으로 정지시키고 실패 수를 기록한다. 기존 backend CCD 수에 합치지 않는다.
`spatial_moving_platform_stats`의 blocked는 이번 틱에서 정지한 authored 경로 수다.

회귀 14개(Engine 6개, native 8개)를 추가했다. 충돌 이후의 접지·phase·재개, 상대 접근/대각선 운반,
필터·일방통행·mesh·회전, 다른 body의 전체 틱과 실제 projectile 충돌 시점을 검사한다.
preview와 일반 step의 120틱 비교로 점프·dynamic push가 중복 적용되지 않는지 검증한다.
preview pair cast는 양쪽 참가자에 기록된 합계를 2로 나눠 실제 호출 수로 집계하고, path 작업량의 여러 틱 frame 합산도 확인한다.
전체 명령·테스트·소스 해시는 `artifacts/physics-3d/platform-blocking-qa/report.json`에 기록한다.

이 변경은 native authored 경로의 제한이었다. 일반 controller의 moving obstacle 응답은 아래 후속 단계에서
연결한다. 외부에서 직접 지정한 kinematic 명령의 squeeze 상호 정지 정책도 아래 후속 단계에 기록한다.
dynamic 지지체 운반은 아직 미완료다.
지형 표시 보간·시간에 따라 바뀌는 Planar height span·chunk/mesh 비용·terrain query/contact/impulse/저장,
기본 single-backend runtime·melee/dash/navigation·외력, Web/bulk/schema/Studio, native snapshot/replay,
최종 Wasm/browser/CI/package/license·시간/메모리/크기 검증을 계속한다. 실게임·실기기 검증은 개발 완료 후다.


### 일반 capsule의 prescribed 이동 장애물 상대 응답 — 부분 완료

기존 controller는 주변 kinematic의 이전 pose를 고정 장애물로 검사했다. 같은 속도로 이동하는 벽에도 운반이
중단되고, 빠른 접근 벽/승강기는 정지한 capsule을 통과했다. `character_motion_tests`의 최초 5개 실패 로그를
`artifacts/physics-3d/character-motion-before.log`에 보존했다.

다운로드한 Jolt `CharacterVirtual.cpp`의 접촉 상대 속도·충돌 시점·법선 투영 처리와 비교했다. Ferrum은 기존
Rapier 경사/계단 controller를 유지하면서, 다른 moving kinematic은 그 보행/운반의 static query에서 제외한다.
자신의 지지체 위 보행은 기존 local 경로로 계산하고, `character_motion.rs`에서 swept BVH 후보와 relative cast로
접근 시점을 구한다. 접촉 뒤 장애물의 법선 속도를 반영해 밀림을 계산하고 접선 이동은 보존한다.
움직이는 one-way는 query 시점의 target pose로 정책을 검사하며 sensor·mask·disabled·planar floor를 유지한다.

`kinematic_motion.rs`는 path와 controller가 공유하는 geometry 경로다. position target은 body origin 보간,
velocity target은 질량 중심 회전과 linvel/angvel을 사용한다. endpoint quaternion에서 회전을 역산하지 않아
velocity 명령의 angular winding을 보존한다. 0~1 구간의 양 끝을 포함한 17개 시점의 pose를 backend velocity 예측과 비교했다.
이는 기하 query의 검증이며 native solver 각속도 제한/CCD 또는 극단 회전 전체 수용을 뜻하지 않는다.

캐릭터 상태에는 relative cast/실패 수·장애물 반응 여부·12회 반복 한도 도달 여부를 추가했다. 고정 틱이 여러
구간으로 나뉘면 이 작업량과 상태를 합산한다. preview의 obstacle cast 수는 별도 native step/frame 지표다.
carry도 허용된 법선/접선 성분만 누적하며, carry를 제한한 장애물 body를 보존해 서로 접근하는 authored 발판의
경로를 함께 정지시킨다. preview는 입력/상태를 복구하며 실제 밀기/점프 소비는 실제 구간에서만 수행한다.

회귀는 native 9개와 실제 Engine co-moving 1개를 추가했다. 기존 platform squeeze와 캐릭터/경사/계단/관절
회귀를 포함한 전체 검증·strict Clippy·wasm32·fmt·consumer 및 source hashes는
`artifacts/physics-3d/character-motion-qa/report.json`에 기록한다. vendor/Cargo 변경은 없다.

외부 kinematic 명령의 압착 정지는 아래 후속 단계에서 보강한다. relative push의 dynamic impulse와
다른 controller 응답 결합, dynamic 지지체 운반/외력, 회전 장애물·지형의 밀집 성능/실제 motion trace 수용은
아직 완료하지 않았다. 반복 한도 진단은 안전한 squeeze 해결의 증거가 아니다.
기본 single-backend runtime·나머지 gameplay/HD actor, 지형 query/contact/impulse/표시 보간/저장,
Web/bulk/schema/Studio·snapshot/replay·최종 Wasm/browser/CI/package/license/성능 검증의 전체 목표를 유지한다.
실게임·실기기 수동 검증은 개발 완료 후 진행한다.

### Capsule 간 공통 접촉 시점과 연쇄 밀림 — native 검증 완료, 전체 통합 미완료

독립적으로 계산한 이동량을 pair TOI 비율로 줄이는 방식은 벽이 계속 진행할 때 캐릭터를 관통시키고,
앞의 캐릭터가 뒤의 캐릭터를 밀지 못했다. 여러 controller의 swept BVH와 공통 접촉 시점을 사용하고,
캐릭터 쌍의 대칭 속도 제약 및 외부 이동체의 법선 속도를 함께 푼다. 단일 controller의 경로는 유지한다.
다운로드한 Jolt `CharacterVirtual.cpp`의 다른 캐릭터 속도/접촉 identity 보존과 비교했으며,
Ferrum의 응답 구현은 기존 Rapier/Parry 기반이다. 새 backend나 vendor 변경은 없다.

재사용 scratch의 제한된 PGS와 matrix-free conjugate gradient를 결합한다. 가속 후보는 유한한 값,
비음수 impulse, 모든 접촉 조건을 만족할 때만 수용하며, 거의 종속인 방향은 거부한다.
반복 한도에 도달하면 관련 prescribed 이동체를 보수적으로 정지시키고 진단한다.
이 한도는 수학적으로 움직일 수 없다는 증명이 아니다. 자유 공간의 32명 연쇄 밀림 통과도 밀집 예산 수용을 대신하지 않는다.

캡슐 축의 최근접 점과 box 면 내부의 실제 법선을 사용한다. local 이동은 입력·up·접촉 법선의 공간에
투영해 미세한 면 바깥 오차가 연쇄 접촉에서 옆 방향 탈출로 커지는 것을 막는다. 실제 경사/모서리는 유지한다.
허용 오차는 접촉 상대의 속도만 사용하고, 필터와 비활성 body를 반영하며, carry는 최종 허용 이동으로 줄인다.
native 상태에는 pair 접촉 검사·제약 방문 수·한도 진단을 추가했고 preview/tick/frame의 비용도 구분한다.

새 native 회귀 9개와 Engine 회귀 1개를 포함해 전체 2,073개가 통과했다.
strict Clippy·wasm32 check·fmt·외부 consumer 및 소스 920개의 해시는
`artifacts/physics-3d/character-coupling-qa/report.json`에 기록한다.
dynamic push는 아직 local 이동 단계에서 적용되므로 최종 결합 이동에 맞춘 impulse 응답은 미완료다.
dynamic support/외력, backend가 실제로 따르는 character 구간별 경로, 회전 장애물/angular CCD도 남아 있다.
기본 single-backend runtime·Web/bulk/schema/Studio·snapshot/replay와 전체 제품 검증을 계속 진행한다.


### 외부 prescribed 명령의 capsule 압착 정지 — 부분 완료

외부 position target과 velocity 명령은 authored 발판 경로와 별개여서, capsule이 고정 벽에 막힌 뒤에도
그대로 진행해 캐릭터를 압착했다. 일반 `step()`도 이동 kinematic과 controller가 함께 있을 때 기존
고정 틱 구간 분할을 사용한다. capsule의 동시 접촉면별 법선 속도 조건을 풀고 양립할 수 없으면
가장 이른 시점까지 물리를 진행한 뒤 관련 이동체의 target·선속도·각속도를 정지시킨다.
이는 generic kinematic의 모든 환경 충돌을 막는 정책이 아니라 capsule 압착 제약이다.

정지한 외부 명령은 소비한다. 장애물이 없어져도 새 target/속도를 주기 전에는 재개하지 않는다.
기존 authored 경로는 정지 phase를 유지하고 다음 틱에 진행을 다시 시도하는 계약을 유지한다.
수평 발판은 막힌 탑승자 아래로 미끄러져 지나갈 수 있다. 일반 carry가 막혔다는 이유만으로 발판을
정지시키지 않으며, own support도 실제 상대 접촉 검사에 포함해 승강기의 수직 압착을 검출한다.
외부 명령에는 authored 경로의 16개 제한을 적용하지 않는다. 각 정지 이벤트가 새 body를 한 번 이상
정지시키므로 영시점에서 무한 재시도하지 않고 남은 고정 틱을 진행한다.

다운로드한 Jolt `CharacterVirtual.cpp::SolveConstraints`의 접촉 시점 순서, 이전 접촉면 유지,
거의 평행한 법선의 cross-product 제외 처리를 비교했다. Ferrum은 동일 알고리즘을 복제하지 않고
작은 동시 제약 집합의 가능한 속도를 계산하며, 불가능한 압착은 해당 native 명령의 진행 제한으로 연결한다.

다중 정지 회귀에서 접촉 경계의 directional cast가 늦은 충돌 시점·불안정한 법선을 반환하는 사례를 확인했다.
이동 검사 전에 같은 geometry의 근접 접촉을 확인해 경계 재시작을 처리한다. 또한 평면 Z 제약과 거의
반대인 두 접촉 법선을 함께 풀 때 작은 오차가 Y축 674,747 단위 이동으로 증폭되는 결함을 확인했다.
2면·3면 해법의 독립성 기준을 같은 제곱 기준으로 적용해 이러한 수치적 탈출을 거부한다.
실패 증거는 `character-squeeze-expanded2.log`, `character-squeeze-planar-before.log`에 보존했다.

동시 접촉과 정지 요청은 controller별 12칸 stack scratch를 사용하며 world의 정지/preview scratch는 재사용한다.
query 실패 시 관측된 이동 제약을 보수적으로 멈추고 실패 수를 기록한다. native `CharacterState`에는
sweep 시작/접촉 갱신 수·실패 수를, `StepStatistics`에는 `kinematic_character_stops`,
`character_preview_obstacle_contacts`, `character_preview_obstacle_failures`를 추가했다.
실제 구간과 preview의 작업량을 구분하고 Engine frame에서는 여러 고정 틱의 작업량을 합산한다.

native 회귀 9개와 Engine 회귀 1개를 추가했다. 두 공간 모드의 벽 압착, 양쪽 벽·승강기 정지,
명령 소비/재입력/장애물 제거 후 재개, 20개 독립 정지 시점, 다른 body의 지속 힘·원래 target·motion trace 시간,
preview 이후 점프/입력 및 translation 보존, 제약 수치 안정성, Engine의 두 틱 진단 누적을 검사한다.
전체 Rust·strict Clippy·wasm32·fmt·외부 consumer 명령과 소스 해시는
`artifacts/physics-3d/character-squeeze-qa/report.json`에 기록한다. vendor/Cargo 변경은 없다.

이번 선형 벽·승강기 회귀는 회전 장애물의 실제 응답·angular CCD, 다른 controller/dynamic impulse의 결합,
dynamic carry·character 외력, 밀집 시간/메모리 예산 수용까지 증명하지 않는다.
기본 single-backend runtime·나머지 gameplay/HD actor·지형 query/contact/impulse/표시 보간/저장,
Web/bulk/schema/Studio·native snapshot/replay·최종 Wasm/browser/CI/package/license/성능 검증을 계속한다.
실게임·실기기 수동 검증은 개발 완료 후 진행한다.

### Web 설정·상태/속도 batch 연결 — 제한된 공개 경로, 전체 이전 진행 중

native 전용 경로를 실제 `FerrumEngine`에서 선택할 수 있도록 `configureUnifiedPhysics`를 연결했다.
설정의 숫자 배열은 version 1 계약으로 검증하고, 기존 planar authoring의 body/fixture/joint를 같은 native world로 가져온다.
`queryUnifiedPhysicsBodyStates`는 id/generation, sleeping, XYZ 위치, XYZW 회전, 선형/각속도를
16-word/64-byte `repr(C)` 행으로 반환한다. `setUnifiedPhysicsVelocities`는 핸들별 6개 f32를 받고,
전체 핸들·유한값·평면/회전 잠금·controller 소유권을 확인한 후 적용한다. 중복 핸들은 마지막 행을 적용한다.
Rust 단일 setter와 batch가 같은 validation을 사용하며 TS는 게임 simulation을 복제하지 않는다.

TS는 version/stride와 출력 범위를 검사하고 native 호출 후 현재 memory에서 view를 재생성한다.
같은 Wasm memory에 있는 입력은 allocation 전에 복사한다. 반환 view의 수명과 snapshot 거부는 공개 API 문서에 명시한다.
기존 body를 설정 후 생성하면 다음 유효 physics step에서 연결되며 그 전 state query는 unbound로 거부한다.

native 회귀 5개, TS 계약 회귀 3개, 실제 generated Wasm의 공개 API 통합 회귀 1개를 추가했다.
별도 패키지 소비자 타입 검사에서 import가 `esnext.disposable` 참조보다 앞서 참조를 무효화한 문제를 발견해 수정했다.
브라우저 추가 검사에서는 frame mode가 `arcade`로 남는 문제를 재현했고, 설정 성공 이후에만 수용된
f32 중력·고정 틱과 mode/continuous 진단을 갱신했다. 실패 로그는 `web-bridge-package-types.log`와
`web-bridge-telemetry-before.log`에 보존한다.
`web-bridge-qa/report.json`의 전체 Rust 테스트는 2,078개 통과이며 strict Clippy·wasm32·fmt·consumer와
실제 wasm-pack build를 포함한다. Web package의 1,600개 테스트는 실제 이동·실패 원자성·메모리 확장까지 검사한다.
`pnpm smoke:unified-physics-web`은 로컬 tarball의 공개 core 경로를 Chromium에서 실행한다.
Playing 상태의 64개 바디, 실제 RAF/fixed clock의 소비 시간과 이동량, Z 고정, batch 거부를 검사하며
`artifacts/physics-3d/web-bridge-browser/report.json`에 기록한다. 수동 CI validate job과 aggregate smoke에 연결했다.
이 브라우저 회귀의 시간/메모리 관측은 최종 밀집 성능 예산 통과를 뜻하지 않는다.

남은 Web 범위는 spatial body/shape authoring, controller 입력, 전체 command/event/query/debug/지표다.
기본 backend 전환·Physics Spec/Studio·snapshot/replay·나머지 gameplay/terrain 계약과
dynamic/회전 motion 및 최종 밀집 성능·패키지 라이선스 수용도 계속 진행해야 한다.
실게임·실기기 수동 검증은 개발 완료 후 진행한다.


### Web 공간 바디·7종 형상·캡슐 controller 연결 — 전체 제품 이전 진행 중

`spawnUnifiedPhysicsBody`/`removeUnifiedPhysicsBody`로 native 바디와 entity의 수명을 연결했다.
box/sphere/capsule/convex hull/triangle mesh/heightfield/convex compound를 숫자 wire로 생성한다.
형상별 count, 전체 payload 길이, 중첩, 정수 index 및 native geometry 조건을 검사한 뒤 생성하며
오류 시 entity/body를 남기지 않는다. body pose·velocity·damping·CCD, collider local pose·material·filter·sensor와
renderOffset을 함께 설정한다. density는 두 공간 모드 모두 3D 부피 기준이다.

`configureUnifiedPhysicsCharacter`는 기존 native 캡슐 controller를 활성화/초기화/해제한다.
`setUnifiedPhysicsCharacterInputs`는 핸들당 속도 XYZ와 점프 속력 4개 f32를 일괄 전달하고,
전체 입력 검증 후 적용하므로 마지막 행 오류가 앞 캐릭터의 대기 중 점프를 지우지 않는다.
`queryUnifiedPhysicsCharacterStates`는 28-word/112-byte `repr(C)` 행으로 접지·천장·슬라이딩·차단·풀이 한도,
support/carry identity, 이동·속도·질의 비용을 제공한다. support/carry는 native physics object 핸들이며
entity 핸들과 구분한다. 메모리 확장 이후 view를 다시 얻고 같은 Wasm memory 입력은 호출 전 복사한다.

Rust 회귀 5개를 추가했으며 `web-spatial-qa/report.json`에서 전체 2,083개 통과,
strict Clippy·wasm32·fmt·외부 consumer·실제 wasm-pack build를 확인했다. Web 회귀 4개를 추가해
`web-spatial-ts-tests-final.log`에서 전체 1,604개가 통과했다. 초기 TypeScript optional 값 처리 오류와
공간 바디를 기존 2D 전용 snapshot으로 조회하던 잘못된 테스트는 각각
`web-spatial-ts-tests.log`, `web-spatial-ts-tests-fixed.log`에 실패 근거를 보존했다.
공간 pose는 새 bulk API로, 표시 높이는 HeightSpan으로 확인한다. 기존 2D `getPhysicsEntity`에
존재하지 않는 rigid-body component를 합성하지 않으며 이 조회의 `undefined` 계약을 문서화했다.
XY 투영은 native wire 회귀에서 직접 검증한다.

브라우저 smoke는 64개 planar body 검사에 실제 RAF의 공간 capsule 이동·접지·점프·잘못된 입력의
원자성·제거 후 stale handle 거부를 추가한다. 실행 시간 제한과 실제 tarball/Wasm 해시를 기록한다.
최종 실행 결과는 `web-spatial-review.json`에서 package/type/build/browser 증거와 함께 확인한다.
이 단계의 범위는 직접 Web 생성과 입력/상태 연결이며, Physics Spec/Studio 작성 기능·기본 backend 전환·
native snapshot/replay·전체 이벤트/공간 쿼리/힘·target·collider/joint 제어·시각 자산 연결은 계속 개발한다.
캐릭터의 최종 dynamic impulse/carry·회전 obstacle/angular CCD·실제 구간별 motion·지형 보간 및
밀집 시간/메모리/크기 수용도 남아 있다. 실게임·실기기 수동 검증은 개발 완료 후 진행한다.


### Web body 명령 batch — 위치·목표·힘·충격·sleep 연결

이전 Web 공간 생성/캐릭터 단계는 실제 Wasm·packed Chromium까지 검증했고
`artifacts/physics-3d/web-spatial-review.json`에 소스/패키지/로그 해시를 보존했다.
이번에는 `FerrumUnifiedPhysicsCommandApi`를 연결해 pose teleport, position-kinematic target,
지속 force/torque의 추가·제거, linear/angular impulse, sleep/wake를 공개한다.
capability v1 숫자 명령은 한 종류의 command를 최대 65,536개 entity에 적용하며 TS의 per-entity 호출은 없다.

native 단일 setter의 pose/target/dynamic validation을 공유해 전체 batch를 먼저 검사한다.
늦은 잘못된 quaternion·평면 입력·kind·controller 소유권·회전 잠금·stale identity가 있어도
앞 body의 pose·velocity·force·대기 target·sleep을 바꾸지 않는다. pose/target의 중복은 마지막 행,
force/impulse의 중복은 합산이다. pose는 즉시 표시 위치를 갱신하고 target은 다음 tick에서 실행한다.
force는 명시적 clear까지 지속하며 clear는 이미 얻은 속도를 지우지 않는다.
동적 힘/충격은 잠긴 축을 inverse mass/inertia로 제한하고, 직접 velocity/pose 입력의 평면 제약은 유지한다.

Rust 회귀 5개는 공간·평면 실제 물리 진행, 목표 지연/보존, 회전 잠금, 지속력/clear, 질량·관성에 따른
선형/각 충격, sleep/wake와 오류 원자성을 검사한다. 최초 test fixture의 없는 `ColliderDesc::default` 호출을
`ColliderDesc::new`로 수정한 뒤 focused 5개가 통과했다. 전체 Rust QA와 실제 generated Wasm 증거는
`web-commands-qa/report.json`, Web/패키지/Chromium 통합 증거는 `web-commands-review.json`에 기록했다.
전체 Rust 2,088개, Web 1,606개 테스트와 Web workspace build·실제 tarball·ES2022 consumer 타입 검사가 통과했다.
packed Chromium은 0.11초의 물리 소비 시간에 힘 2가 질량 1 body의 X 속도를 약 0.22로 만들고,
clear 이후 유지·추가 충격 3 이후 약 3.22·각 impulse 이후 각속도 6·target `[21,2,1]`을 확인했다.
이 숫자는 기능 회귀의 입력/출력이며 밀집 성능 예산 수용을 뜻하지 않는다.
Web 회귀는 ABI/길이/수명, input alias 보존, 두 공간 모드의 실제 명령 결과를 검사한다.
Chromium에서는 실제 RAF 소비 시간 대비 가속도와 목표 위치, clear 이후 속도 유지, 충격·sleep의 결과를 확인한다.

mutable body options/collider/joint와 공간 query/event/debug/지표, Physics Spec/Studio/시각 연결,
native snapshot/replay·기본 backend 전환은 계속 진행한다. native dynamic coupling·carry·회전 CCD·
실제 구간별 motion·지형 보간·최종 밀집 시간/메모리/크기 수용과 전체 제품 검증도 남아 있다.
실게임·실기기 검증은 개발 완료 후 진행한다.


### Web 혼합 공간 query batch — ray·overlap·sweep·nearest 연결

이전 Web body 명령 단계는 `web-commands-review.json`의 소스/패키지/브라우저 증거로 보존했다.
이번 단계는 `createUnifiedPhysicsQueryBatch`로 입력을 준비하고 `queryUnifiedPhysics`로 최대 256개의
ray·point overlap·convex overlap·convex sweep·nearest 요청을 한 번에 실행한다.
요청별 limit 합은 65,536 이하이며 12-u32 metadata/13-f32 값과 별도 convex shape stream을 사용한다.
반복 조회는 값 버퍼를 재사용한다. native query shape 생성 비용과 collider-capacity scratch는 여전히 존재한다.

결과는 19-word/76-byte `repr(C)` hit와 query별 3-u32 offset/count/truncation이다.
entity와 native body/collider identity를 구분하며 entity가 없는 타일/공간 표면도 원래 layer/tile/surface id와 함께 반환한다.
기존 native 정렬·sensor/category/mask·제외 핸들·planar span을 유지한다. 제외 핸들이 오래됐으면 오류다.
생성·teleport·삭제와 pending authoring geometry는 query preparation으로 반영하지만 simulation clock·대기 target/input은 소비하지 않는다.
후행 query 오류도 public output 전체를 비운다. 이 규칙은 authoring synchronization rollback을 뜻하지 않는다.

native 회귀 5개는 혼합 geometry/비율·정렬/truncation·즉시 변경과 세대·센서/마스크·2D 층/높이·tile identity,
zero-motion sweep·inside nearest·target/clock 보존과 malformed/capacity 거부를 검사한다.
`web-queries-qa/report.json`에서 전체 Rust 2,093개 및 strict Clippy·wasm32·fmt·외부 consumer·실제 wasm-pack build가 통과했다.
Wasm 산출물은 4,525,136 bytes다. Web 회귀 4개를 추가해 `web-queries-ts-tests-final.log`의 전체 1,610개가 통과했다.
최초 suite 통과 뒤 정적 검토에서 optional floorId 생략 시 예외를 재현했고(`web-queries-floor-before.log`),
기존 HeightSpan 계약대로 기본값 0을 적용하고 회귀에 포함했다.

실제 Wasm은 5종 geometry, view growth 후 재취득, input buffer 재사용, sensor·generation filter를 검사한다.
packed Chromium은 64개 혼합 query/65 hits, 60개 ray의 closest/truncation, point/convex overlap·sweep·nearest,
대기 target 보존/다음 tick 적용, 제거 직후 61 hits와 query 시간을 검사한다.
최종 package/type/build/browser와 소스 해시는 `web-queries-review.json`에 기록한다.

contact/sensor event·debug/전체 지표, mutable body/collider/joint API, Physics Spec/Studio/시각 연결,
native snapshot/replay와 기본 single-backend 전환은 미완료다. native dynamic coupling/carry·회전 CCD·
실제 구간별 motion·지형 보간·밀집 시간/메모리/크기 및 전체 제품 수용도 계속 진행한다.
실게임·실기기 검증은 사용자 요청대로 개발 완료 후 진행한다.

### Web 콜라이더 접촉·센서 stream — 지형과 overflow 복구

공간 query 단계는 `web-queries-review.json`에 실제 Wasm·패키지·Chromium 결과와 정확한 소스 해시를 보존했다.
이어 기존 entity lifecycle reducer와 독립적인 collider enter/exit stream을 추가했다.
`setUnifiedPhysicsCollisionEventsEnabled`로 수집을 켜고 `drainUnifiedPhysicsCollisionEvents`로 소비한다.
`queryUnifiedPhysicsCollisionPairs`는 마지막 step과 명시적 제거를 반영한 전체 active snapshot이다.

단일 native event drain에서 두 소비자에 전달한다. World entity가 없는 tile/surface도 22-u32/88-byte
`repr(C)` 참가자 record에 source id와 native body/collider 세대를 넣는다. terrain retirement가 매핑을 지우기
전에 capture하므로 삭제 exit의 지형 신원이 사라지지 않는다. query/read가 시간을 진행하거나 예약 입력을 소비하지 않는다.
stream은 기본 off이며 켜짐 상태가 바뀌면 자신의 queue만 비운다. 기존 entity telemetry 토글은 이 queue를 지우지 않는다.

native transition queue와 public pending queue는 각각 maxEvents로 제한한다. 누락 수를 따로 제공하고 drain에서 초기화한다.
active snapshot은 maxEvents로 자르지 않으며, 누락된 과거의 일시적 접촉을 재현하지 않는다.
stream/storage는 재사용하되 활성 pair 전체 snapshot은 실제 접촉 수만큼 커질 수 있다. 밀집 메모리/시간 수용은 별도다.

native 회귀 6개는 planar/spatial의 solid/sensor 채널, 두 consumer 독립성, 삭제/재사용 세대,
두 단계 overflow와 full snapshot, tile/surface 제거 identity, enable 및 world reset 경계를 검사한다.
전체 Rust 2,099개와 strict Clippy·wasm32·fmt·외부 consumer·실제 wasm-pack가 통과했다.
새 Wasm은 4,527,411 bytes이며 Rust/Cargo 933개 소스를 검사했다. Web 새 회귀 3개를 포함해 전체 1,613개가 통과했다.
초기 world reset fixture는 남은 body 때문에 거부됐고, 실제 계약대로 제거 뒤 reset하도록 고쳤다.
첫 TS build는 아직 갱신 전인 generated Wasm declaration에서 새 export를 찾지 못했다.
실제 wasm-pack 이후 전체 TS suite 통과를 확인했으며 두 초기 실패 로그를 보존한다.

packed Chromium은 64 sensor pair와 maxEvents=16으로 native 누락 48/public 누락 1,
63 pair snapshot 복구와 그 뒤 제거한 객체의 이전 세대 exit를 검증한다.
최종 package/type/build/browser와 해시 기록은 `web-collisions-review.json`에서 관리한다.

전체 목표는 계속 미완료다. Web의 native contact manifold/XYZ impulse·debug/전체 지표, mutable body/collider/joint,
Physics Spec·Scene Authoring·Studio·시각 바인딩, native snapshot/replay 및 기본 single-backend 전환이 남아 있다.
dynamic impulse/carry/외력 결합, 실제 구간별 character motion·회전 CCD, 지형 보간·남은 tile/vision/impact/storage,
밀집 시간/메모리/크기와 전체 제품 수용도 계속 진행한다. 실게임·실기기 검증은 개발 완료 후 진행한다.

이 단계의 최종 `build:web`, actual tarball allowlist, strict public consumer types와 packed Chromium이 모두 통과했다.
Chromium의 64 pair/16 retained/48 native drops/1 pending drop/63 recovered pair 및 제거 세대 검사가 통과했으며,
이전 공간 query·body 명령·planar 64 body·spatial capsule probe도 같은 패키지에서 통과했다.
`web-collisions-browser-report.json`을 별도로 보존해 다음 실행이 이 단계의 증거를 덮지 않도록 했다.
이는 기능 검증이며 첫 RAF 비용이나 한 번의 collision 시간으로 전체 성능 수용을 주장하지 않는다.

### Web 접촉면·solved impulse·CCD 관측과 native frame 진단

이전 goal turn은 collider stream 구현과 실제 패키지/브라우저 검증을 완료한 progress다.
이번 시작 시 `web-collisions-review.json`의 Rust933/consumer3/product1021/docs8 해시를 실제 파일과 대조했다.
조사 자료 3개도 다시 읽었으며, 단일 3D backend를 2D/HD-2D의 기본 실제 runtime까지 연결하는 목표를 유지한다.

현재 geometry manifold/양쪽 표면 witness를 Web에서 조회하고, solve 당시 impulse와 frame CCD를 따로 읽는
`FerrumUnifiedPhysicsObservationApi`를 추가했다. entity 없는 tile/surface까지 모두 포함한다.
충격량·CCD의 참가자와 지형 identity는 solve 직후 저장해, 삭제/geometry 갱신 후 읽어도 과거 관측이 바뀌지 않는다.
접촉면 27-word, point 7-word, impulse 32-word, CCD 28-word의 repr(C)와 typed view를 검증한다.
geometry 출력은 완전한 patch prefix를 maxManifolds/maxPoints로 제한하고, 전체 개수/생략 여부를 제공한다.
이 제한은 native geometry 계산·임시 메모리 비용의 제한이 아니다.

71-word 진단은 backend/capability header, native 마지막 tick과 현재 Engine frame의 32개 직접 측정을 담는다.
allocation-free 진단 refresh를 FrameState에 연결했고, JS 소유 값으로 Runtime debug metrics·profiler·trace에 전달한다.
Profiler는 native sample만의 counter extrema와 sample 수를 반환한다. 기록 후 입력 변경이 과거 native 값을 덮지 않는다.
기존 solver row operation을 접촉 수로 대신 계산하지 않으며 `legacySolverRowMetricsAvailable`은 false다.
legacy/unconfigured frame에는 native 진단을 넣지 않는다. 이 연결은 성능 예산의 합격 선언이 아니다.

native 새 회귀 5개는 XYZ witness/category 방향·whole patch cap·target 보존, solved normal/friction/접근 속도,
지형 source/overflow/삭제 후 보존, frame 초반 CCD와 마지막 tick 구분 및 무설정 오류를 검사한다.
전체 Rust 2,104개 및 strict Clippy·wasm32·fmt·외부 consumer·실제 wasm-pack가 통과했다.
Rust/Cargo 936개를 검사했고 Wasm은 4,531,524 bytes다. Web 회귀 4개 추가 후 전체 1,617개가 통과했다.
초기 native fixture의 `<-` spacing/없는 helper 호출, face witness가 4가 아닌 8인 기대 오류를 수정했다.
최초 Web suite의 새 overlay4행 계약 기대목록 누락도 수정해 전체 재검증했으며 모든 최초 실패 로그는 보존한다.

Web build, 실제 tarball allowlist와 strict consumer types가 통과했다.
packed Chromium은 실제 자동 RAF에서 64 body의 native backend step 누계/동적 body gauge와,
XYZ 접촉면·solved impulse·geometry 삭제 뒤 관측 보존을 검사한다.
최종 browser 및 정확한 소스/산출물 해시 기록은 `web-observations-review.json`에서 관리한다.

전체 목표는 미완료다. 기본 single-backend runtime, Physics Spec/Scene Authoring/Studio/시각 바인딩,
Web mutable body/collider/joint, 전체 debug geometry 시각화, native snapshot/restore/replay가 남아 있다.
dynamic impulse/carry/외력 결합과 실제 구간별 character motion·회전 CCD, 지형 보간·tile/vision/impact/storage,
밀집 시간/메모리/크기와 전체 게임/예제/CI/패키지 수용도 계속 진행한다. 수동 실게임·실기기는 개발 완료 후다.

최종 packed Chromium도 통과했다. 실제 RAF 5 frame에 native 진단이 모두 들어왔고,
64 dynamic body의 11 backend step 누계가 실제 fixed step 수와 일치했다.
접촉면은 1 patch/8 witness, solved impulse는 4 observations였으며 물체 제거 뒤 기록이 보존됐다.
기존 body/character/command/query/collision probe도 같은 tarball에서 통과했다.
`web-observations-browser-report.json`에 이 실행을 별도로 보존한다. 실제 WebGL 화면의 전체 디버그 geometry,
모든 예제·실게임·실기기·최종 밀집 성능/메모리 예산까지 통과했다는 의미는 아니다.

### Web 물체 설정·질량·충돌체 변경 연결

`unifiedPhysicsControls.ts`와 `web_bridge/controls.rs`를 연결해 runtime 물체 설정 전체 교체,
additive mass/inertia, collider 목록 조회·추가·교체·삭제를 제공한다. 공간 생성과 collider 편집은
동일한 Rust collider decoder/검증을 사용한다. 위치·힘 같은 매 틱 입력은 기존 bulk API를 유지한다.

- 설정 교체는 kind/활성화/중력/선형·각 감쇠/sleep/CCD/회전 잠금이다. 모든 필드를 명시하며
  lockRotation은 각속도를 지운다. planar DOF는 잠금 해제 뒤에도 유지된다.
- 질량은 collider-derived mass에 더해진다. exact total mass를 지정할 때는 모든 fixture density=0을
  사용한다. collider 변경 직후 inertia/mass를 재계산해 다음 impulse에도 적용한다.
- collider 전체 교체는 generation을 보존한다. 삭제·재사용에는 이전 generation이 거부되며,
  collider owner와 entity generation 양쪽을 검증한다. 삭제된 fixture의 exit를 재사용 전에 수집한다.
- imported component body는 원본 설정 소유권을 유지하고 직접 설정/fixture 편집을 거부한다.
  이는 전체 Physics Spec 이전 완료가 아니다. controller 주 capsule·추가 solid 제한도 native가 적용한다.

Rust 신규 회귀 5개와 전체 2,109개(2,108 unit + 1 integration), strict Clippy/fmt/wasm32,
외부 native consumer 및 실제 wasm-pack가 통과했다. 기존 수동 timing benchmark 1개는 ignored다.
생성 Wasm은 4,538,107 bytes다. Web 신규 4개를 포함한 전체 1,621개와 TypeScript lint도 통과했다.
최초 TS lint는 새 generated Wasm 선언을 생성하기 전 실행해서 신규 7개 메서드를 찾지 못했다.
실제 wasm-pack 생성 뒤 같은 lint를 통과했으며 최초 로그도 보존했다. generated 파일은 수동 수정하지 않았다.

검증 근거는 `artifacts/physics-3d/web-controls-qa/report.json`, `web-controls-ts-tests.log`,
`web-controls-ts-lint-final.log`다. 제품 빌드·tarball·consumer types·실제 Chromium 결과와
최종 소스 해시는 `web-controls-review.json`에 기록한다.

전체 목표의 남은 범위는 유지한다: Web 관절 생성/수정/상태/이벤트와 전체 debug geometry,
기본 single-backend runtime 및 gameplay/HD actor/visual binding 이전, Physics Spec/Scene Authoring/Studio,
native snapshot/restore/replay, dynamic impulse/carry/외력 결합, 실제 구간별 character motion·회전 CCD,
지형 보간·tile/vision/impact/storage와 밀집 시간/메모리/크기·전체 예제/CI/패키지 수용이다.
실게임·실기기 수동 검증은 사용자 지시에 따라 개발 완료 후 진행한다.

제품 `build:web`, 실제 tarball allowlist, strict public consumer types도 통과했다.
Chromium 148.0.7778.96에서 해당 tarball의 공개 API를 실행해 linear/angular velocity=2/2,
회전 잠금 후 angular=0, disabled/enabled point hit=0/1, geometry 교체 후 hit=1을 확인했다.
foreign/stale collider 거부, 교체 identity 유지, 삭제 exit 및 새 generation도 모두 통과했다.
`web-controls-browser-report.json`은 이 실행을 보존한다. Vite chunk 크기 경고 8건과
최초 RAF Rust update 약 101ms도 그대로 기록하며 최종 밀집 성능 통과로 해석하지 않는다.

### Web 관절 생성·수정·관측 연결

`unifiedPhysicsJoints.ts`와 `web_bridge/joints`를 통해 native 13종 관절 생성/전체 설정 교체/삭제,
명시적 bulk 또는 전체 생존 state, opt-in 파손/삭제 event를 연결했다. Frame/motor/spring/break
설정은 숫자 payload로 넘기고 실제 검증·solve는 기존 native solver가 담당한다.
state/event는 14-word `repr(C)`이며 entity/native body/joint generation과 sampled force/torque를 담는다.

`joint_stream`은 하나의 native drain에서 legacy 진단용 pending과 Web 큐를 독립적으로 채운다.
body 제거 전에 capture해 endpoint entity가 없어져도 이전 identity가 남는다. 두 소비자는 서로의
기록을 소비하지 않으며 native 큐 누락과 Web 큐 누락을 구분한다. 전체 생존 조회는 큐 복구용이다.
기존 component 소유 관절은 읽되 원본 component로 수정하며, 직접 Web 관절은 endpoint 교체를 거부한다.

검증 중 다음 실제 문제를 수정했다.

- 최초 focused compile은 `JointBinding.native`의 sibling 접근 가시성이 부족해 E0616이었다.
  이 필드를 `pub(super)`로 제한 공개해 component 소유권 검사를 연결했다.
- 최초 전체 suite에서 `explicit_joint_removals_do_not_displace_solver_break_events`가 실패했다.
  pre-solve의 기존 direct drain이 legacy pending에 explicit removal을 남겨 maxEvents=1에서
  실제 solver break가 밀렸다. pre-solve도 stream capture를 거쳐 Web 기록을 보존하고,
  이미 World에 적용된 제거의 legacy pending/drop만 초기화해 solve용 공간을 확보했다.
  기존 회귀에 Web removed event 1/native drop 1/public drop 1도 검증하도록 추가했다.
- 신규 13종 테스트의 expected는 동일 decoder 재호출 대신 독립 native JointKind 및 모든
  optional/body/frame 필드 literal 검사로 강화했다. 이 마지막 변경은 `#[cfg(test)]` 파일 하나다.

Rust 신규 회귀 7개는 13종 설정, atomic 수정 거부, force/torque 파손, body/관절 슬롯 재사용,
큐 누락·전체 복구, component 소유권, Web drain 뒤 legacy 파손 처리를 검증한다.
수정 후 unified integration 210개, 전체 Rust 2,116개(2,115 unit + 1 integration)가 통과했다.
독립 fixture 보완 뒤 focused 7개도 통과했으며 최종 full 검증과 production 소스 동일성은
`web-joints-final-qa/report.json`에서 관리한다. 초기 실패·중간 해시 변경 결과는 별도로 보존한다.
Web 신규 5개를 포함한 전체 1,626개와 TypeScript lint도 통과했다.

최종 production Wasm은 `web-joints-fixed-qa`의 실제 wasm-pack가 생성했다.
이후 test-only 변경에서 production source/generated hash 동일성을 검증해 해당 build 근거를 재사용한다.
코어 실행 코드가 바뀐 최초 실패 시도의 Wasm은 재사용하지 않는다.
제품 빌드·실제 tarball·consumer types·packed Chromium 및 최종 해시는 `web-joints-review.json`을 따른다.

전체 목표는 여전히 미완료다. 다음은 Physics Spec/Scene Authoring/Studio의 native 저작 연결과
기본 single-backend runtime/남은 gameplay·HD actor 이전이다. 기존 시각 entity의 native body
연결/해제 API는 준비됐으며, 이를 실제 JSON 작성과 Studio 실행에 적용하는 작업은 남아 있다. 전체 debug geometry,
native snapshot/restore/replay, dynamic impulse/carry/외력 결합, 실제 구간별 character motion·회전 CCD,
지형 보간·tile/impact/vision/storage, 밀집 시간/메모리/크기·전체 예제/CI/패키지 수용도 남아 있다.
실게임·실기기 수동 검증은 사용자 요청대로 개발 완료 후 진행한다.

최종 native QA는 독립 fixture 보완 후 full test/Clippy/fmt를 통과하고 나머지 Rust/Cargo 941개,
consumer 3개, generated 7개의 동일성을 확인했다. 최종 Wasm은 4,553,335 bytes다.
제품 `build:web`, 실제 tarball allowlist, strict consumer types도 통과했다.
Chromium 148.0.7778.96에서 모터 body의 X=2.227741, 속도=1.722591, 반력=2.987394를 관측했고,
잘못된 수정은 그 반력을 보존하며 disabled update는 반력을 0으로 초기화했다.
동시 force/torque 파손은 각각 10을 기록했고, body 삭제의 native 누락 2/Web 누락 1,
이전 endpoint generation, 전체 생존 조회 0도 모두 검증했다.
`web-joints-browser-report.json`에 실제 tarball/Wasm hash와 결과를 보존한다.
Vite chunk 크기 경고 8건은 남아 있으며 최종 밀집 시간·메모리·크기 수용을 주장하지 않는다.


### Native core opaque checkpoint — 전체 저장 이전 진행 중

기본 backend 전환을 확인하던 중 기존 Engine restore transaction과 solver snapshot이 native world를
명시적으로 거부하는 것을 확인했다. 이 거부를 우회하지 않고 먼저 실제 backend 상태 보존을 구현했다.
위치/속도만 재생성하면 접촉 warm-start·arena 세대·예약 명령이 손실되므로 Rapier의 `serde-serialize`,
기존 전이 의존성과 같은 Serde 1.0.229, alloc-only Postcard 1.1.3을 사용한다. 새 의존성/feature의
빌드·라이선스 검토와 Wasm/제품 회귀는 이 단계의 수용 범위이며 최종 전체 제품 검증을 대신하지 않는다.

`PhysicsWorld3d`의 private remote schema로 backend world, character 입력/점프/접지·carry,
13종 joint runtime/연속각, 충돌/파손 큐와 누락 수, 접촉 보정/층/one-way/컨베이어 policy,
마지막 step의 충격량/CCD/통계와 projectile 상대 운동 segment/BVH를 보존한다.
발판 경로 scratch의 정지 시간은 즉시 조회 가능하므로 저장하고, 다음 step 전에 재구성되는 controller
작업 배열·joint Jacobian과 upstream pipeline/CCD workspace는 제외한다. CCD 진단 제한은 복원 시 다시 설정한다.

`capture_snapshot[_with_limit]`은 입력을 소비하거나 시간을 진행하지 않는다. 최대 64 MiB encoded 상한과
선택적 더 작은 제한을 적용하고 32-byte envelope에 magic/version/source schema fingerprint/길이/CRC를 둔다.
이는 전체 world·decode 메모리 상한이나 장기 저장 format 보장이 아니다. 공개 arbitrary-byte importer와
live world의 `Deserialize`는 제공하지 않는다. 복원은 opaque packet으로 candidate를 만든 뒤
constructor와 같은 config/용량·유한 상태·body/fixture/controller/joint 소유권을 검사하고 성공 시에만 교체한다.
핸들은 저장 시점의 native 세대로 돌아가며 Engine entity epoch와 외부 핸들 수명 계약은 별도 연결이 필요하다.

13개 직접 회귀는 두 공간의 warm-contact continuation, 모든 13종 관절, 예약 점프/발판 운반,
force/target/dirty collider query와 arena 재사용, collision/joint overflow, 7종 geometry query,
floor/one-way/surface/contact-correction, path stop/회전 segment query, 성공한 rollback과 원자적 실패,
정확한 byte 한도·손상/version/후행 payload 거부를 포함한다. 수용 근거는
`artifacts/physics-3d/native-snapshot-review.json` 및 해당 단계 QA 로그에 기록한다.
Continuation은 body/통계 관측에 더해 checkpoint의 전체 encoded bytes도 비교해 arena/free-list/contact cache
차이를 검사한다. 새 Serde feature의 상류 portability 기준은 Ferrum의 기존 저장 layout 확장으로 달랐다.
같은 lock의 수정 없는 상류가 원래 기준값을 통과하는 것을 확인하고, Ferrum의 실제 x86_64와 wasm32-wasip1이
동일한 bytes/digest를 생성한 뒤 vendored 기준값을 갱신했다. backend bincode portability 검사이며
Engine/Web 저장이나 버전 간 Postcard 파일 호환성 수용으로 확대하지 않는다.

다음은 Engine의 entity/native mapping·terrain/source ownership·고정 clock·렌더 보간·AI route/velocity/cache,
projectile/pending hit·진단/이벤트를 함께 보존하고 restore transaction/실제 Web 저장과 replay에 연결하는 작업이다.
기본 backend·기존 Physics Spec/AABB authoring 이전, dynamic impulse/carry/외력·실제 character trajectory/
회전 CCD, terrain 표시 보간/남은 query·전체 debug geometry·밀집 시간/메모리/크기·제품/예제/CI/package/license
수용도 전체 목표에 유지한다. 수동 실게임·실기기 검증은 사용자 요청대로 개발 완료 후 진행한다.


### Engine 메모리 checkpoint와 native continuation — 파일 저장 이전 진행 중

Core opaque physics checkpoint를 전체 Rust Engine 실행 상태와 연결했다. Engine/World/native adapter를
필드 전체 match로 복사해 누락을 컴파일 시 검토하게 한다. native solver는 기존 직렬화를 재사용하고
collider generation·형상 변경 번호를 보존해 pending A*/fixed geometry cache가 복원 직후 취소되지 않게 한다.
검색 기록은 SharedShape 주소와 과거 mesh 소유권에 의존하지 않으며 private 직렬화가 가능하다.
World ownership·세대/allocator, render history, clock/input latch, Data Scene gameplay/FSM/AI/search/cache,
terrain/platform phase, projectiles/pending hit, particles/tweens/camera, query/event/frame 출력도 함께 보존한다.
World Vec 예약 공간과 bounded action/contact queue의 빈 예약 공간을 유지한다.

Web public memory token은 version1 capability, RAF pause/stop, 동일 SDK/Engine owner와 dispose를 검사한다.
SDK physics metadata도 candidate commit과 함께 되돌린다. 새 JSON/native file importer는 아니며
기존 `captureGameStateSnapshot`의 native 진행 저장 거절은 유지한다. 외부 JS/asset/GPU/authoring registry와
별도 dialogue/quest 객체는 포함하지 않는다. 전체 파일 저장은 외부 binding/asset 상태와 함께 별도 계약으로 완성해야 한다.
기존 generation·Data Scene epoch는 rollback되고 별도 revision은 단조 증가한다. 미래 handle은 호스트가 폐기해야 하며
revision을 기존 handle에 자동 붙이는 것은 아니다.

직접 회귀는 실제 같은 입력 continuation에서 World/native 전체 encoded bytes와 clock·AI·보간·렌더/출력을
비교한다. pending 검색·shared cache/Seek/Accelerate momentum, terrain phase/queued jump,
projectile 입력 edge·피해·퇴장, 예약 force/target·fixed remainder·generation, 기존 built-in 상태와 반복 복원,
foreign/restore transaction/revision overflow의 원자성 및 예약 공간 보존을 포함한다.
public packed Web 검사는 실제 Wasm과 제어된 browser RAF에서 두 공간의 60-frame 결과를 정확히 비교한다.
이 단계 수용 근거는 `artifacts/physics-3d/runtime-checkpoint-review.json`에 기록한다.

다음은 버전/손상·크기/복잡도 제한을 갖춘 파일 persistence와 SDK authoring/외부 상태의 복원 경계를
완성하고 기존 Physics Spec/AABB authoring·기본 single3D backend 전환을 계속하는 것이다.
전체 debug geometry, dynamic impulse/carry/외력, 실제 character trajectory/회전 CCD,
terrain 표시 보간과 남은 query·밀집 시간/메모리/크기·제품/예제/CI/package/license 수용은 남아 있다.
실게임·실기기는 사용자 요청대로 개발 완료 후 검증한다.

### 파일 persistence 준비: query geometry 변경 번호

파일 복원 후 검색·캐시의 형상 참조를 다시 연결해야 하는 문제를 조사했다. 해당 query snapshot은
이전 geometry를 계산에 재사용하지 않고 변경 유무만 검사하므로 실제 형상 graph를 중복 저장하지 않는다.
각 collider의 generation과 sparse u64 형상 변경 번호를 비교하고 native checkpoint 형식 2에 함께 저장한다.
같은 값 교체·원래 값으로 되돌리기도 번호를 증가시키며, 초과는 모든 물리 변경 전에 거절한다.
fixture/body 삭제 시 sparse 기록을 정리한다. query 기록은 metadata만 저장하므로 과거 mesh를 붙잡지 않는다.
Engine 메모리 checkpoint도 이제 직렬화로 복원한 collider set을 그대로 사용한다.

private query 기록과 native world를 서로 독립적으로 직렬화·복원하고 source shape Arc가 다른 상태에서
유효성 일치와 stale 거절을 검사한다. 이것은 전체 Engine 파일 저장 완료를 뜻하지 않는다. 전체 Engine
상태 schema, 외부 SDK binding, 손상/복잡도/크기 제한·호환성과 handle/epoch 정책은 계속 구현해야 한다.

packed release Wasm 브라우저 회귀에도 1,400개 고정 센서와 pending A*를 추가했다. 정상 검색 및 같은 값
형상 교체 직후의 stale 검색을 각각 12-frame continuation/replay로 비교한다. 기존 CI의
`smoke:unified-physics-web`에서 실행하며, 이는 밀집 시간/메모리 budget 수용을 대신하지 않는다.
추가 WASI32 debug 검사는 Node 24.19.0에서 query snapshot 7개와 runtime checkpoint 11개를 확인한다.
Node 22.23.2에서는 query snapshot 7개는 통과하지만 대규모 pending 검색의 debug 바이너리가
SIGSEGV로 종료되어 호환성 원인을 후속 조사해야 한다. 해당 실패를 브라우저 제품 검사 성공으로 덮지 않는다.

### 전체 Rust Engine byte schema — 외부 파일 importer 이전

메모리 token의 내부 표현을 Box<Engine> 복제에서 전체 실행 상태의 byte 데이터로 전환했다. 단일 Engine
필드 목록·exhaustive match와 private World schema로 저장 누락을 검토한다. native 솔버는 기존 opaque
checkpoint를 포함하며, AI frontier/cache·terrain/platform·projectile·input/clock·렌더/출력 상태도 직렬화한다.
전체 인코딩은 outer header를 포함해 64 MiB이며 source/target·길이·CRC를 검사한다. Vec 예약 공간,
lookup map의 canonical 순서와 실제 실행에 쓰는 private 불변식을 보존한다. large aggregate의 stack overflow는
후보를 heap에 두고 필드별 cold decode frame으로 나누어 기본 테스트 스택에서 해결한다.

공개 memory API의 owner/frame/revision/disposal 계약과 JSON 저장 거부는 유지한다. 이 내부 codec는
임의 bytes를 받는 API가 아니다. 외부 파일용 전체 구조/복잡도·총 allocation 검증, SDK authoring/variable/
dialogue/quest/asset binding, 버전/배포 artifact 호환성과 handle/epoch 정책은 계속 구현해야 한다.
immutable Arc 데이터의 원래 sharing topology까지 직렬화하는 것은 아니므로 복원 후 공유·밀집 비용도
최종 자원 수용에서 검토한다. 실게임·실기기 검증은 개발 완료 뒤 진행한다.

### 외부 파일 준비: 누적 decode admission

전체 codec와 native opaque snapshot decode에 같은 cold reader를 연결했다. 동적 collection의 선언 길이를
그대로 사전 할당하지 않고, element 생성 전 typed 작업량·예약 공간·문자열과 재귀 깊이/처리 값 수를 검사한다.
thread-local scope 안의 native payload는 예산을 새로 만들지 않으며 nested root 교체와 오류 삼키기를 거부한다.
native blob은 outer 입력에서 borrow해 읽고 같은 wire 형식으로 bulk 인코딩한다. 제한 초과는 candidate를
교체하지 않으며 다음 decode의 예산을 오염시키지 않는다.

이 지표는 보수적인 할당 작업 admission이며 실제 process/RSS 또는 모든 의존성의 계산 할당을 인증하는
상한은 아니다. native arena/free list/BVH·shape·행렬의 구조·수치 불변식과 upstream Deserialize의 연산 검증은
별도로 마쳐야 한다. 특히 의존성의 동적 행렬 dimension 연산 등은 허용된 snapshot graph의 도달 경로와 함께
감사해야 하며, 자원 quota만으로 안전한 파일 import가 됐다고 간주하지 않는다. SDK 외부 binding과 distribution/
handle·epoch 정책도 남아 있어 임의 bytes importer와 기존 native JSON 저장 거부는 유지한다.

### 외부 파일 준비: native arena 구조 검사

Rapier의 `Arena<T>` 역직렬화에서 점유 원소 수와 빈 슬롯 전체 연결을 검사하도록 보강했다.
잘못된 head/link·순환·도달하지 않는 빈 슬롯과 성장 불가능한 0-slot 상태를 반환 전에 거부한다.
검사는 slot 수에 비례하며 별도 scratch가 없고, 기존 wire와 세대·재사용 순서는 보존한다.
vendor bincode/JSON과 Ferrum bounded Postcard의 손상/정상 continuation 회귀로 검증한다.
이 단계가 처리하는 것은 개별 arena의 count/free-chain뿐이다. entry 내부·arena 간 참조, 세대 소진,
BVH·형상·행렬·비지원 storage와 SDK 외부 binding 검증은 계속 필요하며 전체 파일 저장 완료로 보지 않는다.

### 외부 파일 준비: 지원하는 backend state와 비지원 payload 경계

native checkpoint를 형식 3으로 올리고 private backend remote schema를 연결했다. 바디·collider·일반
impulse joint, island/broad/narrow phase와 설정은 보존한다. 생성 API가 없는 multibody/soft-body는
전체 persistent 인코딩이 초기 empty와 같을 때만 0 표식으로 저장한다. 단순 live count만 검사하지 않으므로
삭제 후 남은 세대·queue·epoch를 조용히 버리지 않는다. 비교 버퍼는 각각 256 bytes로 제한한다.
복원은 표식과 초기 arena의 누적 작업 예산을 검사한 뒤 빈 set을 만들며, 해당 set/entry의 native Deserialize를
호출하지 않는다. 기존 multibody→동적 행렬의 untrusted payload 경로는 이 private 형식에서 제외했다.
vendor 일반 Serde/물리 기능은 그대로 두며, 지원하는 상태의 continuation과 유효 envelope의 잘못된 표식
실패 후 전체 live 상태 보존을 검사한다. 형식 2는 호환되지 않는 것으로 거절한다.
이는 남은 cross-arena/BVH/형상·수치 검증, 실제 할당 admission, SDK binding/distribution·handle 정책과
외부 파일 importer를 완료했다는 의미가 아니다. 전체 목표의 나머지 개발·수용 조건을 유지한다.

### 외부 파일 준비: geometry storage와 BVH rebuild

기존 Parry3D 0.31.1을 원본 archive SHA-256·파일별 해시/라이선스와 함께 저장소에 고정했다.
새 dependency나 solver를 추가하지 않으며 Rapier의 동일 버전 의존성을 local path로 연결한다.
Array2는 checked 차원과 data 길이, VecMap은 occupied count, HeightField는 grid/status/삼각형 수와
유한한 scale/값·bounds/spacing·flags를 검사한다. BVH는 root·부모/자식·leaf map·count/free 저장 구조를
stackless 순회로 검증하고 임시 parent bit를 성공 전에 복원한다. 검증용 추가 allocation은 없다.

초기 검증기는 정상 optimization의 unreachable 이전 노드를 과하게 거절했다. 해당 상태를 보존하도록
분리했으며 조사 중 기존 전체 rebuild가 retired leaf까지 모으는 오류를 실제로 재현했다(16→41).
rebuild가 rooted leaf만 기존 저장 순서로 모으도록 수정하고, workspace Vec mask에 최대 4 bytes/node를
추가한다. 이는 solver 계산식을 바꾸지 않지만 재빌드 비용은 최종 dense 수용 대상이다.
마진 0의 partial update는 dirty flag 없이 ancestor bounds를 stale하게 둘 수 있다. generic Deserialize는
그 합법적인 예약 상태를 보존하며, 형상별 containment 및 실제 query 전 refit 여부는 별도 검증이 필요하다.
native/Engine fingerprint는 양쪽 vendor의 전체 소스와 고정 Cargo·target 입력을 공유한다.
mesh/convex/compound의 전체 기하 의미·cross-arena·query 깊이·실제 할당/SDK binding·distribution/epoch와
외부 파일 importer 등 남은 전체 목표는 유지하며 이번 단계만으로 완료로 보지 않는다.

### 후속 진행: 형상 저장 구조와 스케일링

TriMesh의 index/half-edge topology/component permutation·pseudo-normal 저장,
ConvexPolyhedron의 vertex/edge/face incidence, Compound의 pose·child type·part bounds를 검사한다.
immutable shape BVH에는 연속 geometry ID와 실제 geometry/ancestor containment를 추가로 검사한다.
정상 데이터는 wire와 feature ID를 유지하고 generic BVH의 정상 pending refit은 계속 허용한다.

실제 재현한 두 오류를 수정한다. convex의 비균일 scale normal은 inverse transpose가 필요하고,
반사는 face winding을 뒤집어야 한다. mesh의 angle-weighted pseudo-normal은 단순 scale·정규화로
보존할 수 없어 scaled geometry에서 재계산한다. 수정 전 실패 로그와 수정 후 native/WASI 및
제품 재검증 결과는 `artifacts/physics-3d/shape-admission-*`에 기록한다.
전체 볼록성, Polyline/Voxels 등 미검사 variant·cross-arena·수치/실제 할당·파일 importer·SDK/배포 호환성과
실게임/실기기 검증은 여전히 전체 목표에 포함한다. 이 단계만으로 물리엔진 완료로 판단하지 않는다.

### 후속 진행: 깊은 BVH의 충돌 쌍 검색

구조적으로 유효한 깊이 16,384 저장 트리를 bounded decode한 뒤 depth 계산·BVTT 검색을 실행하면
기존 재귀가 기본 테스트 스택을 소진하는 것을 재현했다. 자기 순회와 depth 계산은 부모 링크로,
두 subtree 교차 검색은 재사용 workspace frame으로 반복한다. 정상 트리를 임의 depth cap으로 거절하거나
저장 구조를 다시 만들지 않으며, pair 순서와 change filter는 수정 전 native 결과 32종과 비교한다.
pair frame의 최대 깊이 증가에 따른 workspace 예약 비용과 전체 CPU/메모리 수용은 유지한다.
다른 build/refit 재귀·모든 검색/형상/cross-arena 검증, 전체 파일/SDK 호환성, 기본 backend/authoring 전환과
기존 전체 목표는 계속 진행 대상이다. Node22 WASI의 같은 바이너리 간헐 SIG11 원인은 아직 확정하지 않았다.

### 후속 진행: 깊은 BVH refit과 병렬 소유권

검색 보강 후에도 resolving/flag-preserving/in-place refit의 기존 재귀가 유효한 깊이 16,384 저장 트리에서
기본 스택을 소진하는 것을 각각 재현했다. destination buffer와 parent link의 반복 순회로 갱신하며,
기존 layout·flags·sparse leaf mapping·사용하지 않는 root metadata를 보존한다. 수정 전 native의 전체
encoded hash 64개와 갱신 후 저장/복원 continuation을 비교한다.
optional native parallel 경로는 전체 가변 Vec/VecMap을 raw pointer로 공유하는 구조를 제거하고,
분리된 mutable slice를 bounded task로 처리한다. join 후 leaf map을 갱신하는 추가 O(node count) pass와
기존 target buffer의 필요 시 성장 비용은 계속 성능 수용 대상이다.
남은 build 경로와 전체 shape/cross-arena/수치/작업 예산·파일/SDK 호환성, 기본 single3D backend 및 기존
Physics Spec/actor 전환과 전체 제품/실기기 수용을 계속 진행한다. 이번 단계만으로 물리엔진 완료로 보지 않는다.

### Physics Spec rigid의 기본 native 경로 — 부분 이전

기존 2D Physics Spec의 rigid 그룹을 모두 생성한 뒤 같은 planar Rapier3D backend에 연결한다. 고정 tick·iteration·중력·CCD를 적용하고 동일 config 재적용은 기존 clock·identity를 유지한다. Scene profile의 수동/자동 모드를 보존하고 전역 sleep off는 body 설정보다 우선한다. capability·clock·mode 사전 검사는 replacement clear 전에 수행한다. 모든 실패에 대한 원자적 replacement를 보장하지는 않는다.

읽기 전용 component bulk projection은 native prepare를 한 번 수행하며 기존 행 ABI를 유지한다. Native-only XYZ 바디는 별도 조회를 사용한다. 실제 backend getter로 legacy JSON 저장을 거절하며 메모리 runtime checkpoint만 제공한다. PixelMask terrain chunk는 geometry만 추가해 전역 world 설정을 덮어쓰지 않는다.

이 단계는 일반 Engine 생성·arcade·기존 actor/HD-2D 전체의 기본 전환, 전체 debug geometry, 파일/SDK 복원·수치/자원 수용, 동적 carry·외력, 구간별 motion/회전 CCD, 지형·밀집 비용·gyro와 최종 제품 검증을 완료하지 않는다. Node22 대규모 pending checkpoint SIGSEGV와 기존 BVH refit 성능 regression은 열린 항목으로 유지한다. 실게임·실기기는 개발 완료 후 검증한다.

### 기존 2D AABB 주인공의 native 목적지 이동 — 부분 이전

`moveDataSceneActorTo`의 기존 component 소유 단일 AABB kinematic actor를 같은 planar world의 실제 shape query에 연결했다. 활성 native world에서는 target의 World AABB 유무와 무관하게 native 형상을 검색한다. Source의 회전·offset과 누적 각도를 유지하고 mask·sensor/enable·native pair floor/height 정책을 적용한다. waypoint별 예산·코너·float32 목적지·도착/막힘/취소와 4방향 애니메이션은 기존 Rust route 소유자를 유지한다.

검색용 준비는 씬 step당 한 번 수행하고 예약 force/impulse나 fixed clock을 소비하지 않는다. 병진 pose를 native와 World에 반영하며 이후 기존 AABB 타일 보정을 생략한다. 같은 Engine의 checkpoint는 진행 route와 native 상태를 함께 복원한다. 직접 native-only actor·capsule·compound actor를 이 API에 추가하지 않으며 기존 spatial capsule 이동 경로와 구분한다.

이 단계는 Scene JSON에 physics를 생략한 모든 actor의 기본 backend, 일반 입력/AI 전체와 HD-2D height controller의 이전, native 장애물의 grid 자동 등록, 상대 motion/동적 밀기·회전 CCD, native 파일 저장 및 최종 밀집/실기기 수용을 완료하지 않는다. Node22 WASI 오류·BVH refit 성능 regression과 기존 전체10개 미완 범주는 유지한다.

### HD-2D 수동 controller와 Data Scene 충돌 grid — 부분 이전

기존 수동 HD-2D API를 native shape sweep/slide와 공통 floor/height surface 처리에 연결했다. 실제 geometry는 native만 사용한다. 새 높이의 도착 penetration은 별도로 확인하고 막힌 전환을 복구한다. 속도·누적 각도·clock·다른 body의 예약 입력과 checkpoint를 보존한다. 일반 입력/AI orchestrator의 자동 이전·동적 밀기/회전 CCD는 아직 남았다.

공개 Shooter tile setter가 Data Scene을 거절하므로, 별도 collision-only bulk grid API를 추가했다. 256×256/정의256 한도와 exact packet·참조·f32 bounds를 검사하고 native geometry/current capacity를 확인한 뒤 publish한다. 동일 크기 교체도 단조 revision으로 query 갱신을 보장한다. Scene JSON·Studio UI·그래픽 타일 확장으로 취급하지 않는다. 전체 aggregate/pending-component/자원 수용과 native 파일 importer, 기존 Node22 WASI 오류·BVH refit 성능 regression 및 전체10개 미완 범주는 유지한다.


### 기존 2D 입력 속도·AI 자동 실행 — 범위를 제한한 native 연결

기존 component AI는 import 뒤 새 물리 상태로 steering/target을 계산하며 예약 force/impulse를 그 뒤 적용한다.
새 native body AI와 같은 평가 경로를 사용한다. 입력 코드가 설정한 기존 component velocity도 활성 단일 solid AABB
kinematic에서는 고정 틱당 최대4회 native sweep/slide로 처리한다. 선형 적분을 중복 실행하지 않고 명령 속도·회전·
checkpoint 재생을 유지한다. route/dash/projectile/attachment의 별도 소유권을 보존한다.
병렬 리뷰에서 발견한 이동자의 timer skip과 후순위 거절 시 앞 이동의 잔류를 failing 테스트로 재현하고 수정했다.
주기 projectile action을 유지하고 자동 이동 배치의 pose/span/속도를 실패 시 복구하며 예약 impulse의 중복 적용을 방지한다.

자동 step/drop 한도0·ledge drop 비허용이며, 더 큰 높이 전환은 수동 HD-2D API가 담당한다. 다른 형상·trigger·
명시적 native body에는 이 AABB controller를 자동 부착하지 않는다. WASD→속도는 게임 입력 코드의 책임이다.
통합 world에서 legacy 공간 combat navigation 조합은 거절하며 일반 XY 목적지 grid는 유지한다.

이 단계로 물리 없는 기본 씬·모든 형상/배치의 controller·자동 높이 전환 한도 설정·상대 운동·동적 결합·회전 CCD·
native 파일 저장·밀집 비용·실기기 검증을 완료했다고 판단하지 않는다. 전체 목표의 미완10개 범주는 유지한다.
검증 명령·실패 이력·최종 수치는 `artifacts/physics-3d/automatic-movement-native-review.json`에 기록한다.


### 자동 controller 높이 한도와 convex source 확장 — 범위 검증 완료, 전체 목표 진행 중

부모 우선순위1의 첫 작업으로 캐릭터별 자동 계단·낙차 한도와 source 형상 범위를 확장했다. 해당 범위의 검증 완료 기록은 `artifacts/physics-3d/controller-extension-review.json`을 따른다.
`configureDataSceneKinematicController(handle, PhysicsKinematicControllerOptions | false)`는 runtime 설정이며
Physics Spec/Scene JSON 필드나 Studio UI를 추가하지 않는다. mask 기본all, 반복 기본4(1..8), step/drop 기본0
(유한 f32 0..65536), ledge drop 기본비허용이다. 옵션은 전체 교체하고 false는 기본값을 복원한다.
잘못된 JS 입력은 호출 전 거절하며 native admission 실패는 이전 설정을 보존한다. 설정은 세대별 handle과
같은 Engine의 메모리 checkpoint 소유권을 따른다.
초기화는 현재 세대·planar native·component 소유권을 유지하는 entity라면 source가 비활성·미지원 또는 dynamic으로
변경된 뒤에도 허용한다. 새 옵션을 설정할 때는 지원하는 활성 kinematic source가 필요하다.

자동 component kinematic source를 AABB·OBB·원·캡슐·볼록 다각형 및 여러 convex fixture의 복합 충돌체까지
확장한다. 검색은 활성 solid fixture마다 실제 native geometry를 사용하고 source sensor/disable·상호 mask·pair span을
적용한다. 새 height/floor의 도착 겹침도 전체 solid fixture로 검사한다. 수동 HD-2D와 XY 목적지 route의
기존 단일 AABB source 계약은 유지한다. Edge·chain·mesh source와 직접 native body의 controller 자동 부착은 범위 밖이다.
지형 surface 참조점은 단일 AABB collider 중심과 그 외 형상·복합의 body/entity 원점이며 전체 footprint rasterization은 하지 않는다.

이전 자동 이동 단계의 명령 속도·회전·고정 clock·예약 force/impulse·timer/action·dash/projectile/attachment 소유권과
배치 실패 복구 계약을 유지한다. 새 `controller_extension_` Rust 회귀와 packed `controller-extension-native-probe.mjs`의
검증 결과는 실행 완료 후 `artifacts/physics-3d/controller-extension-review.json`에 기록한다.
과거 단계의2,365개 등 통과 수치를 이번 확장의 결과로 재사용하지 않는다.

일반 Engine·arcade·물리 없는 기본 씬의 전체 backend 이전은 부모 우선순위1의 후속 작업으로 남는다.
비볼록 source·arbitrary support·밀집 비용, 상대 운동·회전 CCD·동적 결합·native 파일 저장 및 최종 실기기 수용도 남으며,
전체 목표의 기존10개 미완 범주는 유지한다. 이번 절만으로1번 또는 전체 물리 고도화를 완료했다고 판단하지 않는다.


### 고정 시간 arcade와 collider-only 이동 소유권 — 범위 검증 완료, 전체 목표 진행 중

활성 Data Scene에 실제로 적용하는 고정 시간 arcade Physics Spec의 native 연결과 collider-only 소유권을 반영했다. 해당 범위의 완료 기록은 `artifacts/physics-3d/arcade-native-review.json`을 따른다.
Mode를 생략한 Spec도 기본 arcade/fixed=true이므로 포함한다. Mode 표시와 기본 중력0·CCD 꺼짐·solver1/1·sleep 꺼짐은
유지하고 rigid와 같은 planar native backend를 사용한다. Manual/runtime profile이 자동 실행을 결정하며 native 물체의
수동 profile은 직접 step까지 정지한다. 가변 시간 arcade·none은 기존 backend 경로를 유지한다. 빈 none runtime의
기존 autoStep=true 반환도 바꾸지 않는다.

Raw Engine 생성·useDataScene·Scene Authoring의 physics 생략 자체가 native 활성화 명령은 아니다.
Native 활성 중 none/가변 시간 arcade downgrade는 기존 world·그룹 제거 전에 거절한다. 고정 시간 arcade와 rigid 사이의
native 요청은 허용하되 연결된 body가 있는 world의 다른 전역 설정 제한은 유지한다. Native를 쓰는 arcade도 JSON
물리/진행 저장은 거절하고 같은 Engine의 메모리 checkpoint를 사용한다.
JSON physics capture/restore는 현재 Engine의 backend가 legacy여도 world/snapshot Spec이 native를 선택하면
staging·clear·transaction 전에 거절한다. 옛 fixed-arcade 파일 자동 migration과 legacy solver 변환은 이번 범위가 아니다.
Legacy JSON helper 대상은 가변 시간 arcade/none이며, 고정 시간 arcade와 rigid는 실제 native WorldConfig 범위를
사전 검증한다. 반복 수는 각각1..32, f32 변환 뒤 step은0.0001..0.1이며 각 중력 성분은 유한하고 절댓값1,000,000 이하이다.
가변 시간 arcade의 기존 legacy solver 허용 범위는 유지한다.
Legacy JSON은 backend getter의 명시적 legacy 결과와 none 또는 fixedTimestep이 명시적 false인 arcade를 요구한다.
Getter 누락·unknown·native 결과와 arcade의 누락·비boolean clock을 legacy 가변 시간 경로로 내리지 않는다.

기존 importer가 collider-only 이동자를 Fixed로 가져와 정지시키던 소유권도 정리한다. 0이 아닌 선형·각속도나 Static 이외의
AI movement pattern이 있는 collider-only source는 implicit kinematic, 그렇지 않은 source는 fixed로 가져온다. 한번 implicit mover가 된 body는
0속도에서도 역할을 유지하고 명시적 body type이 붙으면 그 type을 우선한다. Native 이후 생성한 collider-only mover의
초기 World/native 중복 적분을 막으며, 지원하는 convex implicit mover는 기본 자동 controller를 사용한다.
Custom controller 설정은 명시적 rigid component가 있는 kinematic에만 허용하며 component 제거 뒤 다음 native 준비에서
custom override도 삭제한다. Rigid body·collider가 모두 없는 일반 velocity entity의
World 이동은 유지한다.

신규 `arcade_native_` Rust 회귀와 packed `arcade-native-probe.mjs`의 실제 결과는
`artifacts/physics-3d/arcade-native-review.json`에 기록한다. 이 단계만으로 built-in Shooter·Breakout·Platformer의 전용
controller, 가변 시간 arcade, physics 없는 기본 씬의 전체 default backend 이전이 완료되었다고 판단하지 않는다.
전체 물리 목표의 기존10개 미완 범주는 유지하며 기능·성능·실기기 수용은 각 검증 범위를 따른다.


### 내장 Shooter의 planar native opt-in — 범위 검증 완료, 전체 목표 진행 중

기존 `configureUnifiedPhysics` API가 활성 built-in Shooter의 planar-xy 선택도 받는다. 새 메서드·옵션 필드·buffer ABI는
추가하지 않는다. Raw Engine 기본값은 legacy이며 spatial built-in의 native 설정은 거절한다. Breakout·Platformer의 후속 opt-in은 다음 절들을 따른다.
Physics Spec의 자동 native 설정은 Data Scene 경계를 유지한다.

Shooter Playing tick을 pre input/action/AI/spawn 의도, native import/move, post clamp·bullet lifetime/arc·damage/pickup으로
나눈다. Post 뒤 query preparation으로 변경을 동기화하며 extra tick이나 예약 force/impulse를 소비하지 않는다.
Player/Enemy/Bullet 레이어는 초기0속도에도 kinematic으로 import한다. Actor controller는 Wall mask만 사용해 overlap
접촉 피해·pickup을 유지한다. 기본 actor의 World trigger flag는 유지하고 native fixture는 solid로 매핑한다.
Native actor 접촉은 ENTER/STAY/EXIT, Bullet sensor는 TRIGGER_*로 보고하며 피해·점수의 World HIT 정책과 구분한다.
정지 actor의 solid tile 초기 겹침은 mask·floor를 유지한 최대8회 native 복구로 처리하며 실패 시 이동 batch를 되돌린다.
Bullet은 native sensor/kinematic으로 이동하지만 기존 Shooter swept gameplay·tile impact·
pierce/bounce/despawn 정책은 그대로 유지하며 전체 native query 이전 완료로 취급하지 않는다.

Title 시작·GameOver 재시작을 누른 tick은 상태 전환만 수행하며 같은 활성 Shooter의 authoring/reset은 native를 보존한다.
다른 built-in/Data Scene으로 전환하면 Shooter native world를 폐기한다. Native Shooter의 legacy snapshot capture/restore는
상태 mutation 전에 거절하며 같은 Engine memory checkpoint만 지원한다. Native JSON 파일 저장·migration은 별도 미완이다.

Auto=false에서도 Engine update는 unmoved 현재 pose에서 intent·timer·post gameplay를 실행한다. 직접 fixed dt step은
native 이동만 하며 Shooter gameplay callback을 수행하지 않으므로 자동 실행을 기본 권장 경로로 문서화한다.
신규 `engine::unified_physics::shooter_tests`와 packed `shooter-native-probe.mjs`의 실제 검증 결과는 root의 최종 기록을 따른다.

Shooter 범위의 완료 기록은 `artifacts/physics-3d/shooter-native-review.json`을 따른다. 후속 Breakout·Platformer 이전은 다음 절들이며, 일반 default/variable-step 정책·전체 projectile/query 이전과
회전 CCD·동적 결합·native 파일 저장·밀집 비용·실게임/실기기 수용 등 기존10개 미완 범주는 유지한다.


### 내장 Breakout의 planar native opt-in — 범위 검증 완료, 전체 목표 진행 중

기존 `configureUnifiedPhysics`가 활성 built-in Breakout의 planar-xy 선택도 허용한다. 새 API·옵션 필드·ABI는 추가하지
않으며 raw defaults는 legacy, spatial built-in 설정은 거절한다. Physics Spec 설정은 Data Scene 전용이며 후속 Platformer opt-in은 다음 절을 따른다.

Scene 소유 paddle·ball은 정지·collider 제거에도 native kinematic을 유지하고 일반 자동 controller에서 제외한다. 명시적 rigid
component가 있으면 enabled kinematic만 허용하며 configure mutation 전과 step admission에서 검사한다. World trigger flag는
보존하고 알려진 Player·Bullet·Enemy·Wall 레이어의 native fixture는 solid로 가져온다.
Paddle의 clamp endpoint를 native에 먼저 반영한 뒤 ball의 실제 fixture를 scene 소유 target ID에 sweep한다. 같은 hit 시각은
paddle·walls vector·bricks vector 순서를 유지하며 ball은 hit fraction만큼 한 native fixed tick에서 이동한다. 원래 명령 속도를
복구한 뒤 기존 ContactOffsetX paddle 반사·brick 효과/피해/점수/despawn과 종료 판정을 실행하고 남은 dt는 사용하지 않는다.
표면에서 멀어지는 접촉의 반복 hit는 제외하되 실제 초기 침투는 보존한다. 후처리는 추가 tick 없는 query sync로 반영한다.

Title/restart tick은 level·launch만 재구성하고 이동하지 않는다. 같은 활성 Breakout 선택/reset은 native를 보존하며 다른
built-in/Data Scene 전환은 폐기한다. 동일 Engine memory checkpoint는 지원하고 native 전체 JSON 파일 저장은 별도 미완이다.
Breakout auto=false의 Playing update는 입력 명령만 저장하고 직접 fixed step이 이동·반사·HIT·점수·종료 판정까지 수행한다.
직접 step은 입력 샘플·Title/restart 전환·일반 timer를 실행하지 않으며 Shooter·Data Scene manual 계약은 유지한다.

검증 기준은 신규 `breakout_native_`·`breakout_phases_` 회귀, native targeted sweep과 packed `breakout-native-probe.mjs`의
실제 결과를 따른다. Probe는 public SDK의 native RAF·게임 반응·manual step·checkpoint·scene 전환을 검사하며, 단계 전체의 수치와
최종 acceptance는 `artifacts/physics-3d/breakout-native-review.json` 기록을 따른다.
후속 Platformer native 이전은 다음 절이다. 일반 default/variable-step·전체 projectile/query·회전 CCD·동적 결합·파일 저장·
밀집 비용·실게임/실기기 수용 등 기존10개 미완 범주는 유지하며 이번 opt-in만으로 전체 물리 고도화를 완료하지 않는다.


### 내장 Platformer의 planar native opt-in — 범위 검증 완료, 전체 목표 진행 중

기존 `configureUnifiedPhysics`로 Shooter·Breakout·Platformer 내장3종의 planar opt-in을 제공한다. Spatial built-in은 거절하며
무옵션 raw default·가변 시간 arcade 선택과 Physics Spec의 Data Scene 전용 경계는 바꾸지 않는다. 후속 생성 정책은 다음 절을 따른다.
새 API·옵션 필드·ABI는 추가하지 않는다.

기본8개 level body와 player28×36 AABB를 유지한다. 속도210·중력900·점프420·낙하 상한760·probe2·step12·coyote0.08초·
buffer0.10초와 authored tuning을 legacy/native 공통 순수 state-step helper로 처리하고 충돌 geometry만 native로 대체한다.
One-way Enemy fixture의 방향·시작 feet/top 조건과 ground support normal을 closest 선택 전에 필터링한다. 이동 전 ground가
scene 소유 moving platform일 때만 platform을 제외하고 rider delta를 검사하고, platform endpoint 반영 뒤 player controller를
실행한다. Native 위치를 먼저 commit하고 소유 물체 선속도를0으로 둔 공통 tick으로 중복 이동을 막으며 실패 시 복구한다.
정지·collider 제거 뒤에도 player/platform은 kinematic 소유권을 유지한다. 명시 rigid component는 enabled kinematic만 허용한다.
이 범위는 capsule·회전 carry·angular CCD·전체 dynamic support나 legacy fallback을 추가하지 않는다.

Title/restart rebuild tick은 이동하지 않으며 held Space를 자동 jump로 재사용하지 않는다. 같은 Platformer 선택/reset은 native를
보존하고 public query 전에 새 소유 entity를 갱신한다. 다른 built-in/Data 전환은 native를 폐기한다.
Manual auto=false update는 axis와 OR jump edge만 저장하며 직접 fixed step이 이동·carry·coyote/buffer·물리 시간/점수·landing·
종료 판정을 실행한다. 직접 step은 입력 샘플링·Title 전환을 하지 않고 성공 시에만 jump queue를 소비한다. Queue도 동일 Engine
memory checkpoint로 보존하며 native 전체 파일 저장은 미완이다.

Geometry·shared state-step·scene phase 회귀와 Engine 통합·packed `platformer-native-probe.mjs`의 실제 검증 결과를
`artifacts/physics-3d/platformer-native-review.json`의 완료 기록을 따른다. 이 범위의 검증과 전체 물리 목표의 완료는 구분한다.
Probe는 native RAF의8개 entity/render·단일 이동, held Space·one-way landing·carry, checkpoint와 manual queued jump replay·reset 직후 query·scene 전환을 확인한다.
후속 기본 정책은 다음 절이며 무옵션 전역 기본값 변경·가변 시간 native 실행은 남는다. 기존10개 미완 범주와 전체 projectile/query·회전 CCD·
동적 결합·파일 저장·밀집 비용·실게임/실기기 수용은 유지하며 내장3종 opt-in만으로 전체 물리 고도화를 완료하지 않는다.


### Engine 생성의 지속 native 기본 정책 — 범위 검증 완료, 전체 목표 진행 중

`CreateEngineOptions.physicsBackend`의 기본값 legacy는 유지하고 unified를 명시하면 Rust가 저장한 planar fixed/auto 기본값을
현재와 이후 scene에 적용한다. `physicsBackend()`의 실제 legacy/unified-3d 결과와 옵션 정책은 구분한다. None·variable clock은
Wasm 생성 전에 거절하고 이전 Wasm의 policy version1 capability 누락도 거절한다. 생성 physicsMode/fixedTimestep에서 world를
resolve하며 옵션 없는 legacy 생성의 metadata는 실제 variable clock을 나타낸다.

다른 built-in/Data scene 전환은 저장 기본값의 새 native world를 설치하고 physics 없는 Data Scene도 상속한다. 같은 scene reset은
현재 world·auto=false·fixed frame/step 상한을 유지한다. 기존 명시 configureUnifiedPhysics는 scene-local이며 생성 policy 안의
현재 Data world를 별도 설정해도 다음 다른 scene은 생성 default로 돌아간다. Cold shape 거절은 native 오류이며 legacy로 내리지 않는다.
SetGameSpec의 physics 생략은 같은 Shooter의 현재 설정을 유지하고 다른 scene에서 전환할 때는 생성 default를 상속한다. 명시 physics는
해당 target 설정과 비교하며 mode override 후 none/variable·불일치는 scene/entity 변경 전에 거절한다. Debug만 적용하고 생성 clock override를 재실행하지 않는다.
Aggregate 작성의 명시 physics 요건은 바꾸지 않는다. Rust memory checkpoint가 저장 policy와 이후 scene 선택도 보존하며 파일 import는 미완이다.

단계 범위의 완료 기록은 `artifacts/physics-3d/default-policy-review.json`을 따르며 소스·문서 대조는 `artifacts/physics-3d/default-policy/`에 남긴다. 전역 기본값을
unified로 바꿨거나 가변 시간 native를 지원한다고 판단하지 않는다. 전역 생성 기본값은 legacy를 유지하며 전체 projectile/query·
회전 CCD·동적 결합·native 파일 저장·밀집 비용·실게임/실기기 수용 등 기존10개 미완 범주를 유지한다.


### Native 물리 debug geometry·비용 관측 — 구현과 검증 범위

실제 native7종 shape·13종 joint·cached contact·저장 CCD witness를 기존6개 debug bit로 추출한다. Body×fixture pose를 사용하며
curve16분할·고정64 work stack·최대16,384선/65,536 방문 work로 제한한다. Broadphase는 shape AABB이며 BVH proxy/node가 아니고
CCD는 marker/normal이지 전체 trajectory가 아니다. Engine의 cold component/terrain admission은 tick/force를 소비하지 않지만
추출 work cap 밖이다. 빈 arena slot도 work로 세며 geometry와 frame CCD가 한 예산을 공유한다. 미지원/한도 초과는 truncated, admission 오류는 rejected이며 legacy geometry로 내리지 않는다.
Contacts는 cached local manifold를 현재 pose로 재투영해 다음 tick까지 남을 수 있다. CCD는 이른 fixed tick·entity 없는 terrain도 보존하며 frame4,096개/native 누락은 truncated로 표시한다.

공간 camera에서는 native Spatial XYZ 또는 Planar[x,z,-y]를 기존11-float packet으로만 보내고 flat 중복을 없앤다. Planar 높이는
backend numerical extrusion이며 authored heightSpan이 아니다. 공간 camera가 없으면 XY 또는 XZ footprint이며3D 표시와 구분한다.
Legacy collider/contact 중복은 억제하고 terrain/billboard/floor label은 metadata로 유지한다. Engine-only native 출력과 depth-only
선택을 지원하되 marker256은 output-only다. Renderer/shader ABI·schema·의존성·Studio UI·backend 기본 선택은 바꾸지 않는다.

선택 debug 통계는 fixed4u32/version1의 두 additive Wasm getter에서 owned SDK 객체로 읽는다. Off는0상태/객체 생략이며 메모리
checkpoint는 geometry/stats도 보존한다. Profiler는 nested debug를 복사·freeze하고 Runtime physicsDebugLineCount는 flat+spatial
전체 제출 선을 합산해 기존 budget에3D 비용을 포함한다. 이전 Wasm의 debug 미지원과 debug-off native 실행은 구분한다.
Active native의 직접 debug setter와 출력 소비는 guard를 적용하되 passive Spec 적용은 설정 자체를 거절하지 않는다.

Core/Engine/SDK/renderer 소스 회귀를 반영했으며 전체 Rust·Wasm/WASI·실제 GL/GPU·packed browser 수용 결과는
`artifacts/physics-3d/native-debug-review.json`의 최종 기록을 따른다. Debug 범주의 종료는 이 자동 검증 기록으로 판단하며
실게임·실기기 수용은 사용자가 정한 후속 시점에 진행한다. 회전 CCD·동적 결합·전체 query·파일 저장·밀집 비용 등 남은 목표도 유지한다.


### 합산 native 작성·controller JSON·모델 pose — 구현 반영, 수용 검증 진행 중

Physics Spec과 기존 Scene component kinematic body에 선택 `kinematicController` 객체를 연결했다.
기존 순수 검증·기본값과 runtime 설정을 공유하며 false는 runtime 초기화 전용이다. Spec은 rigid/고정 시간 arcade,
Scene JSON은 명시적 planar physics와 enabled solid convex source를 요구한다. Prefab controller 상속 전체는 별도 검토 대상이다.

Planar Scene JSON은 기존 body·collider-only 객체와 명시적 native shape body를 같은 월드에 작성하고,
선택 `physics.collisionTilemap`으로 기존 collision-only grid를 구성한다. Spatial은 기존 2D encoding과 이 grid를 거절한다.
이 절은 이전 단계의 Scene JSON 미연결 기록을 갱신한다. 그래픽 타일맵·새 UI 편집 폼을 추가한 범위는 아니다.

내부 scene-authoring version1과 cold finalize는 terrain·component·joint를 합산 admission하며 tick·예약 입력을 소비하지 않는다.
Canonical SDK apply는 전체 Rust checkpoint와 physics metadata로 보호하고 Scene 실패의 variables·registry·progress context,
Spec 실패의 기존 world clear 상태를 복원한다. 외부 자원/custom callback·전체 자원 비용 수용은 별도다.

명시적 spatial binding의 모든 body kind에 모델을 연결하고 현재 native XYZ/quaternion × local yaw/scale을 사용한다.
World-space renderOffset과 모델 elevation을 더하며 위치·회전 보간은 제공하지 않는다. 기존 모델 ABI80바이트와
legacy/billboard/planar 보간은 유지한다. Studio는 native quaternion/각속도와 정확한 controller 작성 JSON을
읽기 전용으로 표시하며 runtime 적용 여부와 조회 불가 상태를 구분한다. Native elevation의 원본 복원도 맞췄다.

소스·문서 대조와 이번 Rust/SDK/packed browser 검증은 `artifacts/physics-3d/aggregate-authoring-review.json`에 기록한다.
이 절 작성 시 최종 수용은 진행 중이며 aggregate authoring 범주나 전체 물리 고도화를 완료로 표시하지 않는다.
전체 자원·그래픽 타일맵·prefab 상속·native JSON 파일 import·최종 밀집 성능/실기기 수용 등 남은 목표는 유지한다.

### 전체9개 범주 마무리 — 개발·통합 검증 진행 중

전체 범위와 완료 증거는 `artifacts/physics-3d/goal-closure/requirements.json`에 별도로 추적한다.
앞선 개별 단계의 통과가 범주 전체 완료를 의미하지 않는다. 실게임·실기기 검증은 사용자 지시대로 개발 이후에 진행한다.
앞선 절의 fixed-only·variable 후속 표기는 해당 단계의 기록이며, 현재 구현과 미완 범위는 아래 갱신을 따른다.

선택 그래픽 타일 정의는 기존 collision v1 packet을 유지하고 별도 v2 visual buffer를 사용한다.
Cold texture/color compile 결과를 native probe와 실제 적용에 재사용하며 기존 planar Tilemap renderer로 표시한다.
Native component template는 catalog를 한 번 복사해 inline과 같은 사전 검증·적용에 사용한다.
작성 JSON 참조를 보존하고 animation/LOD preview는 별도 epoch 검증 metadata로 이어간다.
Native 파일 importer나 catalog JSON 진행 저장을 허용하는 변경은 아니다.

캐릭터 동적 결합은 승인된 native 구간의 접촉점·유한 질량/관성을 처리하고, 외력 bulk API는 별도 capability를 사용한다.
앞선 작성·외력 통합의 native 2,580개 테스트와 Node22/24 WASI 전체 테스트, 해당 Wasm을 넣은 공개 패키지 브라우저 검증이 통과했다.
Runtime prefab의 물리/controller 상속과 별도 capability, 그래픽 타일·외력의 실제 공개 API도 해당 브라우저에서 검증했다.
Studio local component catalog는 공유 원본 편집 경계를 유지하며 실제 위치·layer 수정/Undo/Redo·Play/Stop·저장/재열기와
타일 render command·asset evidence까지 통과했다. 같은 이전 Wasm의 예제·Studio·package 검증도 수행했으나
product-v2 전체 gate는 Rust test-harness의 직접 저장소 접근6건에서 중단했다. 검사 기준은 유지하고 fixture를 World accessor로
수정한 뒤 대상 native466개 회귀가 통과했다. 이 이전 결과를 아래 가변 시간 통합의 전체 제품 수용으로 재사용하지 않는다.
BVH refit의 기존 성능 regression은 동일 조건 5개 mode/120개 sample에서 해결을 확인했으며 전체 엔진 성능 수용과 구분한다.
Node22 WASI의 V8 GC/fd_write FastAPI 경로 오류에는 fd_write만 JS forwarding하는 영구 QA runner를 적용했다.
기존 재현 binary의 A/B 검사와 앞선 통합의 전체 Node22/24 WASI 검증이 통과했으며 upstream V8 자체를 수정한 것은 아니다.

Native 가변 시간의 Rust·SDK·schema 구현을 현재 작업 브랜치에 통합했다. `rigid`와 `arcade` 모두 같은 native world에서
고정/가변 clock을 선택한다. 실제 승인 시간을 scene·이동·지형·캐릭터·backend에 함께 적용하고, 구간 이후에는 nominal dt를 복구한다.
첫/최종 외력 peak 사전 검증, 구간 진입 실패의 실제 소비 기록, zero frame의 새 통계,
동일 Spec의 accumulator·예약 입력·frame 상한·보간 보존을 통합 전 리뷰에서 보강했다.
해당 통합의 전체 native 2,612개, Node22/24 WASI 각각 2,612개, SDK 1,801개 테스트와
공개 패키지 브라우저 검증이 통과했다. 전체 build·4개 package 검사·6개 예제·대상 Studio 검증도 통과했다.
생성 프로젝트 검증은 필수 `validatePhysicsRuntime`가 빠진 테스트용 엔진을 보완한 뒤 minimal의
import·타입·빌드·개발/배포 브라우저·Studio와 보고서 검증이 통과했다. headless와 물리 smoke 9개 시나리오/57개 테스트도 통과했다.
처음 중단된 제품 검증과 후속 성공 결과는 별도 디렉터리로 보존했다. 검증은
`artifacts/physics-3d/goal-closure/native-variable/integrated/`와 해당 browser report의 실제 종료·source/binary hash로 판단한다.
이 결과는 해당 소스·Wasm의 기능 검증이며 전체 consumer template matrix·remote CI·밀집 성능·실기기 수용 완료를 뜻하지 않는다.
초기 생성 override의 nominal 제약은 유지하되 성공한 명시 clock 변경 이후의 Spec mode 검증은 실제 Rust mode를 따른다.

외부 파일의 선행 경계로 Ferrum reader의 지원7종 shape tag·Compound child 검사를 추가했다.
미지원 payload의 생성 전 거절과 정상 wire/query/continuation을 검사하며 vendor의 일반 Serde는 유지한다.
이는 임의 byte importer·전체 cross-arena/numeric·공유 geometry topology·실제 할당량 한도·외부 SDK 바인딩·epoch 정책 완료가 아니다.
저장 참조 검증은 별도 리뷰의 두 우회를 수정한 뒤 현재 작업 브랜치의 native checkpoint capture/restore에 연결했다.
Vendor 집중 32개와 관련 기존 11개, core의 손상 후보·방문/scratch 한도·실패 원자성 3개 회귀가 통과했다.
새 통합의 전체 native 2,615개, Node22/24 WASI 각각 2,615개와 Wasm 빌드·공개 패키지 브라우저·실제 tarball/타입 검사가 통과했다.
소스·binary 대조와 실제 종료 결과는 `artifacts/physics-3d/goal-closure/native-cross-arena/core-integration/`에 기록한다.
기존 SDK 1,801개 결과는 SDK 소스가 같음을 대조한 범위에서 유지하며, 이 단계에서 다시 실행한 것으로 표시하지 않는다.
Vendor 집중 회귀를 별도 명령과 수동 CI에 연결했다. 원격 CI를 실행하거나 배포했다는 뜻은 아니다.
정상 pending 이력을 보존하는 범위의 참조 검사이며 수치 payload·전체 island·실제 메모리 상한과 외부 파일 API는 남는다.
이후 실제 backend integration 설정22개, body/collider 수치와 추가 반복 상한, 실제 joint/ratio cache 수치 검증을 연결했다.
정상 config 뒤에 숨은 다른 반복 수, 예약 target/force NaN과 작성 명세만 정상인 backend joint NaN을 cold 경계에서 거절한다.
유효한 pending·sleep/disabled/quarantine·signed warm-start 이력과 정상 tuning은 보존한다.
별도의 near-skin GJK 수정과 within-skin landing continuation도 결합했다. 실제 positive-gap 바닥 누락과
거의 평평한 정지 바닥의 착지 접선 정체를 구분해 해결하며, 동일 query/filter의 벽·compound·one-way·천장 clearance를 유지한다.
결합 소스의 전체 native 2,642개, Node22/24 WASI 각각2,642개와 공개 패키지 브라우저·실제 tarball/타입 검사가 통과했다.
새 브라우저 회귀는 보존한 수정 전 Wasm에서 y0.411175의 바닥 통과를 재현하고,
새 Wasm에서는 y약0.51의 접촉·열린 공간의 접선 이동·낮은 천장의 안전 정지와 checkpoint replay를 확인한다.
Vendor 저장 회귀41개와 near-origin7개도 수동 CI에 연결했다. 현재 소스 증거는
`artifacts/physics-3d/goal-closure/native-admission-landing/integrated/`를 따른다. 같은 Wasm의 전체 웹 빌드,
현재 공통 launcher의6개 예제, Studio 물리/모델·template 저장/재열기, minimal consumer와 정확한 report 검증도 통과했다.
예제 smoke의 기존 channel 생략 fallback에서 초기 WebGL context loss가 새·이전 Wasm 모두에 재현됐다.
다른 gate와 같은 full Chromium fallback으로 맞춘 뒤 같은 assertion·기본 환경의 원래 명령이 통과했다.
이전 실패/동결 위반0-command 시도/관측/A-B/채널 조건 비교를 삭제하지 않고 `product*` 하위에 보존한다.
Contact/manifold 수치와 전체 island/event·공유 topology·실제 allocator·외부 파일/SDK 계약은 계속 남으며,
전체 authoritative piecewise trajectory·회전 장애물/angular CCD와 tight-ceiling 접선 정체의 일반 해법을 완료한 것은 아니다.
후속 조사에서는 persistent island와 대기 중 joint event의 저장 계약 누락을 vendor에서 재현해 독립 후보로 수정 중이다.
후속 수정은 native 형식 5와 cold island 검증으로 현재 작업 브랜치에 통합했다. 공개 Core API로 첫 step 뒤
관절을 생성한 직후의 저장·복원은 즉시 bytes와6 step continuation을 비교한다. 기존 awake-only 참조 검사에서
통과한 sleep membership 누락을 capture/restore 전에 거절하고 live/source bytes를 보존한다.
전체 native/WASI·새 Wasm·공개 패키지 검증 결과는 `artifacts/physics-3d/goal-closure/native-island-admission/integrated/`
에서 추적한다. 통합 소스의 전체 native 2,645개, Node22/24 WASI 각각2,645개와 vendor 저장52개,
native/WASI portability golden이 통과했다. 새 Wasm의 공개 패키지·타입·전체 웹 빌드,
Studio 물리/모델·template 저장/재열기, minimal consumer와 정확한 report 검증도 통과했다.
보존한 이전 E076 패키지는 새 pending-joint 브라우저 회귀에서 복원 후 persistent island가2개로 남아 실패하며,
현재 패키지는 평면/공간 모두1개로 합쳐져6 step의 body/joint/진단 통계가 일치한다.
브라우저 회귀의 최초 누락된 진단 필드와 잘못된 backend substep 기대값은 수정하고 실패 기록을 보존했다.
전체 component 의미·counter overflow·외부 파일 계약은 계속 남는다.
후속 contact cold admission과 지원 workspace tag 경계를 현재 작업 브랜치에 통합했다.
기존 capture/restore가 수용한21개 실제 접촉 payload×양 공간42건과 compound raw/cluster 손상을 거절하고,
실패 후 원본 bytes와 정상 sleep/pending continuation을 보존한다. 지원5종 workspace는 실제 query 왕복과
후속6회 query를 비교하고, Voxel/Custom tag는 내용 생성 전에 거절한다. 통합 소스의 전체 native2,652개,
Node22/24 WASI 각각2,652개, vendor 저장66개와 native/WASI portability golden이 통과했다.
새 Wasm의 공개 패키지·타입·전체 웹 빌드·Studio 물리/모델/template 저장·재열기와 minimal consumer/
정확한 report 검증도 통과했다. 검증 기록은 `artifacts/physics-3d/goal-closure/native-contact-admission/integrated/`를 따른다.
Workspace 내부 cache/manifold 참조·shape context,
counter 경계·완전한 component 의미와 외부 파일/SDK/자원 계약은 별도로 남는다.
Persistent island의 removal count 포화와 sleep/split clock headroom 전환도 현재 작업 브랜치에 통합했다.
최댓값의 overflow와 복원 시0 stamp alias를 별도 재현했고, 저장 자체는 원래 숫자를 보존한다.
Core 통합 중에는 여러 독립 component의 동시 수면이 남기는 정상 empty awake container의 과잉 거절을
추가 발견해 지정 awake id에 한해서 수용했다. 일반/최대 clock·양 공간의 실제 checkpoint 후 수면과6 step
재실행이 통과했으며 native 전체2,653개와 vendor 저장75개가 통과했다. 최종 Wasm/WASI/제품 검증은 진행 중이다.
지원5종 workspace의 내부 map/manifold·shape 역할과 TriMesh interference/bounds 검증, 안정된 enabled
joint/active contact의 island link/owner 검증도 통합했다. 실제 pending geometry·joint/type/enable 이력과
정상 query/step/recycle 순서를 유지하며 유효 CRC 손상 후보의 capture/restore 실패 원자성을 검사한다.
Counter/empty-awake와 결합한 중간 소스는 native 전체2,657개·vendor 저장97개와 Clippy가 통과했다.
이 중간 소스의 새 Wasm/WASI/제품 검증은 아직 실행하지 않았으며 앞의2,652개/BED binary 증거와 구분한다.
실행 중 shape 교체의 오래된 manifold/solver graph 문제와 좁은 천장의 접선 이동 수정은 독립 후보에서 검증 중이다.
두 후속 후보도 현재 작업 브랜치에 통합했다. 직접 backend의 SHAPE 소비는 이전 contact cache와 solver graph를
정리하고 collider identity/event 전이는 유지한다. 물리적으로 들어가는 정지 box 통로는 실제 capsule 반경을 유지한
continuous support-plane 증거와 양의 query margin으로 접선 이동을 이어간다.512개 fit 조합과 충분 여유64개의
수정 전 query/contact bytes,3개 실제 공개 shape 교체/수명주기·pending checkpoint 회귀를 추가했다.
통합 소스1,517개에서 native 전체2,680개와 Node22/24 WASI 각각2,680개가 통과했다. Vendor storage는 새
`shape_edits_` OR 필터까지 공식 명령에 연결해100개, 전체 Rapier lib193개와 Clippy, Parry7개가 통과했다.
새 Wasm은7,475,028 bytes이며 ABI936개 서명을 유지한다. 실제 소스·로그·hash와 이후 packed SDK/Studio/
consumer 결과는 `artifacts/physics-3d/goal-closure/native-state-semantics/integrated/`에서 추적한다.
Native 파일의 다음 개발은 전체 Engine candidate 의미/자원 검증과 SDK registry 바인딩이다. 현재 메모리
checkpoint의 physics metadata 외 변수 이름/slot, authoring document/instance, 모델/texture ID 대응은 JS에 있고
quest/dialogue는 별도 native resource이므로 Engine byte만 내보내는 것으로 완료할 수 없다.
이1,517개 소스의 최초 packed browser에서는 자동 이동 후 벽 제거 직후의 정상 checkpoint가 거절됐다.
삭제된 collider가 다음 tick까지 contact graph에 남는 대기 상태인데 workspace 검사에서 현재 collider를
무조건 요구한 것이 원인이다. 별도 Engine 회귀와 native guard 진단으로 기존 references/islands/numerics는
통과하고 workspace Context 오류가 나는 것을 재현했다. 이전 통과 로그와 이 browser 실패는 보존하며,
정확한 삭제 큐 generation을 대조하고 내부 cache 검사는 유지하는 후속 수정은
`artifacts/physics-3d/goal-closure/native-state-semantics/integrated-v2/`에서 별도로 검증한다.
해당 후속 수정도 통합했다. 정확한 삭제 큐 generation에 대해서만 현재 geometry 비교를 생략하고 내부 cache는
검사한다. 소스1,518개에서 native2,682개와 Node22/24 WASI 각각2,682개, storage102개·Rapier lib195개와
Clippy가 통과했다. 이전과 Parry444파일이 같아 기존 query7개 증거는 명시적으로 상속하며 재실행으로 표기하지 않는다.
Engine의 정상 slide/remove/spawn/chase 저장은 수정 전 실제 거절됐고 수정 후15 tick의 동일 재실행을 확인했다.
새 Wasm은7,473,767 bytes이며936개 export의 이름/종류/함수 서명이 같다. 브라우저/제품 결과는 위 v2 경로의
실제 종료·tarball/served Wasm hash로 판단하며 최초 실패와 구분한다. 같은 SDK shape 교체 시나리오는
이전 BED에서도 통과했으므로 그 검사를 backend SHAPE-only ghost impulse의 수정 전 실패 증거로 사용하지 않는다.
Wasm dependency notice의 원문·vendor 수정 기록과 실제 tarball 누락/내용 검사를 연결했으며,
이 source inventory는 전체 법적 호환성·실제 링크 집합·표준 라이브러리·font/asset 수용과 구분한다.

무옵션 native 기본 실행, 외부 파일 저장/복원, 전체 실제 이동 경로·회전 CCD·지형 나머지 연결,
밀집/전체 제품·consumer 수용·실게임/실기기 검증은 전체 목표에 계속 남아 있다.

### Native 외부 파일 기반 구현 — 내부 경계 통합, 전체 importer 미완

별도 v1 파일 framing, World 저장 구조 admission, Engine/native 소유권 admission, SDK의 bounded JSON
reader와 native 값을 건드리지 않는 변수 metadata 연결을 현재 작업 코드에 통합했다. 파일은7개 필수 구역의
길이/build/word 크기/CRC를 검사하지만 구역 내용 전체를 검증하는 기능은 아니다. 전체 Engine 의미·공유
Arc topology·native variable layout 추출·작성 정보/에셋/quest graph와 세션 fence/epoch/단일 publication을
연결하기 전까지 임의 파일을 받는 공개 importer는 제공하지 않는다.

World 구조 검사 개발 중 retired MAX entity 뒤의 reset→spawn이 lazy joint incident prefix를 잘못 쓰는
실제 producer 오류를 발견해 gap만 default count로 채우도록 수정했다. 격리 debug/release의 수정 전 실패와
수정 후 통과, 일반 append/reuse/reset-prefix payload bytes 보존을 각각 기록했다. Private 경계 seed를
사용한 검사이며 전체 entity 세대 소진이나 전체 Engine payload admission 완료를 주장하지 않는다.

통합 전 각각의 집중 회귀와 main 적용 receipt는
`artifacts/physics-3d/goal-closure/native-file-foundation/integrated/`에서 추적한다. 최종 합산 native/WASI,
새 Wasm과 SDK 전체 test/lint·tarball browser·Studio/consumer의 완료 여부는 해당 경로의 실제 종료 report를
따른다. 앞선1,518개 source 결과를 최신 수정 전체의 실행 증거로 재사용하지 않는다.9개 범주 목표는 계속 진행 중이며
실게임·실기기 검증 순서는 기존 사용자 지시대로 개발 완료 이후다.

### Native 파일 candidate 준비와 저장 payload 검사 — 전체 목표 진행 중

다음 단계는 framing과 실제 decode 후보를 연결하고 World payload/Engine root 설정·native 변수 layout을 검사하는
내부 sealed candidate다. Engine을 반환하거나 실행/query/render/publish하지 않으며 검증 전 SDK6구역도 Ready로
간주하지 않는다.45종 component/8종 joint 필드 검사는 각 owner의 숨은 backing/배열·timeline/FSM을 포함하고,
empty entity까지 최대 고정배열 비용을 곱하지 않도록 실제 Some에서만 해당 비용을 선청구한다.
정상 signed/HDR/sentinel·pending/미해결 참조 이력과 일반 저장 bytes를 보존한다.

SDK 쪽은 실제 문서/continuity/ordered registry/resource 대응의 metadata-only capture/prepare/attach를 구현한다.
기존 Scene apply/spawn이나 native 진행 값을 다시 쓰지 않는다. 아직 실제 admitted roster 추출과 materialized
document/catalog 보관 hook·host-binding key의 새 host 해소·자원 bytes/allocator/GPU 준비·별도 quest/dialogue graph와
전체 owner/fence/epoch/단일 publication을 연결해야 한다. 이 미완을 callback 없는 현재 helper 범위로 축소하지 않는다.

Payload 검토 중 valid 극대 FPS가 legacy animation while에서 subtraction 비진행을 만드는 문제도 별도 재현했다.
FPS 범위를 임의로 제한하는 대신 일반 f32 path의 byte 보존과 bounded fallback을 구분해 수정한다. 실제 public child의
수정 전 timeout/수정 후 반환과 native/WASI phase를 보존하며 전체 엔진 성능 수용과 구분한다.

현재 source의 정확한 조립 receipt와 native/WASI/Wasm/SDK·패키지/Studio/전체 consumer template 검증 여부는
`artifacts/physics-3d/goal-closure/native-file-candidate/integrated/`의 실제 종료 report를 따른다.
전체 Engine84필드의 subsystem/cache/output·공유 Arc topology/실제 allocator와 완전한 파일/session importer는
계속 미완이다. 전역 native 기본값·남은 navigation/경로/회전 CCD·지형·밀집/제품/실기기 목표도 유지한다.

### 파일 공유 관계와 나머지 출력 상태 — 진행 중

기존 memory wire를 유지하는 file-only Engine wrapper와 단일 누적 decode scope를 구현했다. 실제 route/clip/shape
공유 관계의 typed table과 owner 내부 재연결은 별도 담당 구현·검증을 마친 뒤 candidate에 합산 연결한다.
generic table codec 통과만으로 공유 graph 복원이 완료됐다고 하지 않는다.

먼저23-field frame output 검사를 sealed candidate에 연결했다. Animation overflow event index의 직접 참조를
검사하고 material 길이·triangle/경로 stride·수치·audio pose/telemetry 숨은 필드도 readonly로 확인한다.
과거 handle·NaN height sentinel·정수 payload·정상 bytes를 보존하며 복원 중 frame을 재생성하지 않는다.
이 단계의 실제 명령/종료와 source 범위는 `artifacts/physics-3d/goal-closure/native-file-sharing/integrated/root-stage-qa/`
기록을 따른다. 공유 관계·나머지 Engine owner·자원/SDK/세션 원자적 교체를 포함한 원래 파일 목표와9개 범주 목표는 유지한다.

Particles/presets/bitmap text/tweens/impact의5개 leaf도 owner 패치를 exact SHA로 조립하고 candidate의 같은
post-decode work/scratch에서 차감하도록 연결했다. 각각의 malformed owner가 유효 CRC여도 거절되는 연결 회귀를
추가했다. 격리 검증은18개 신규 회귀를 포함하지만 최신 Main 조립 결과는 별도 `presentation-stage-qa/`를 따른다.
공유 관계 복원·Tilemap/남은 Engine owner·SDK/resource/session 전체 파일 목표는 아직 진행 중이다.

### 실제 공유 관계와 Tilemap 통합 — 전체 목표 진행 중

원본 Engine의 route/clip Arc와 native SharedShape table을 file-only Engine wrapper에 연결했다. 새 detached Engine에서
전체 root census/값/graph를 대조하고 두 owner가 같은 work/scratch/roots/compare quota를 사용한다. 같은 값의 별도
allocation은 유지하며 source/live Engine을 수정하지 않는다. 주소 순서가 같은 파일의 quota 수용을 바꾸던 문제는
정렬 상한을 사전 청구하도록 고쳤다. 아직 SDK 자원/host/owner/fence/epoch·Ready·단일 publish를 연결한 결과는 아니다.

Tilemap11필드·별도 scratch8 collection과 원래 heap 순서 검사를 연결했다. Native collider slot 재사용 뒤 old adjacency가
남는 BroadPhase producer 결함도 기존 canonical 처리 순서를 유지해 수정했다. 큰 tile center/거리의 nonfinite 출력은
정상 f32 연산을 유지하면서 기존 실패 경로 또는 overflow 한정 wide 계산으로 처리한다. 정상 저장 값을 clamp하거나
잘못된 file 상태를 rebuild해 통과시키지 않는다.

앞선 공유 관계 조립은 Core1575개이며 full native2838·fmt/Clippy가 통과했다. 실제 전체 WASI와 production Wasm/후속 SDK·Studio·
consumer/package 검증의 현재 여부는 `artifacts/physics-3d/goal-closure/native-file-sharing/integrated/alias-stage/`의
실제 종료 report를 따른다. 이전1550/1540 단계 결과를 이 소스의 전체 제품 검증으로 간주하지 않는다. 남은 Engine
subsystem/cache/query·실제 자원/SDK/세션 전체 importer와 원래9개 범주 목표는 계속 유지한다.

### Data Scene 이동·전용 물리 scratch 저장 검사 — 통합 검증 진행 중

Data Scene.navigation과 NavigationObstacles·Movement·MovementAnimation, 내부 search/sweep를 실제 candidate의
누적 work/scratch에 연결했다. 현재 overlay의 내부 coverage·grid 비용·cursor/facing/수치를 검사하되 현재 World로
캐시를 다시 만들지 않는다. Collider 변경/삭제, grid 교체 후의 이전 route, stale actor/binding과 음수 반올림 credit을
보존한다. 전용 collision scratch2개·rigid-step scratch도 같은 candidate budget에 연결했다.

Root1592개 조립의 관련 `file_`128회귀 후 scratch23회귀와 candidate 연결 회귀를 추가했다. 이 단계의1595개 소스는
full native2873·fmt/Clippy와 실제 WASI Node22/24의 선택 `file_`152회귀씩을 통과했다. WASI 전체 테스트나 새 production
Web/Wasm/SDK 검증으로 확대 해석하지 않는다. 실제 source·명령·결과는
`artifacts/physics-3d/goal-closure/native-file-data-movement/integrated/` 및 scratch 담당 delivery를 따른다.
이 단계의1595개 조립에는 Native controller/navigation과 SpatialScene/환경/공간 navigation/continuity를 포함하지
않았다. 당시 나머지 Engine gameplay/내장 scene/query/output owner·실제 allocation/RSS·SDK/resource/session/public importer와
원래9개 범주는 계속 미완이다. 실게임·실기기는 기존 지시대로 개발 완료 후 진행한다.

이 단계에서 별도 실제 codec 반례로 native capsule의 skin 저장 검사와 public enable 계약의 차이를 확인했고
upright 조건도 후속 검토 대상으로 남겼다. 아래1639개 통합 단계에서 두 조건을 보강했다.
이 검토도 controller owner/전체 Engine 검사·SDK/resource/session/public importer의 완료를 대신하지 않는다.

### 작성 스냅샷·공간 씬·컨트롤러·물리 출력 통합 — 전체 목표 진행 중

14필드 작성 스냅샷을 World와 같은 gameplay 수치 정책으로 검사하고 native capsule의 skin/현재 축 계약을
public enable과 일치시켰다. 공간 씬/환경/navigation/continuity, native actor/search/cache/combat controller,
legacy34개와 native6개 물리 출력 root를 같은 detached candidate의 누적 work/scratch에 연결했다.
공간 씬의6개 ordered map/set은 실제 valid-CRC 반례12개에서 발견한 조용한 정렬/중복 소거를 decode 단계에서
거절한다. 정상 Serialize wire·과거 출력·stale/pending 이력·bulk 요청 순서와 중복은 유지한다.

이 단계의1639개 Core 소스는 fmt/Clippy와 전체 native2945회귀를 통과했다. Root 신규 테스트의 camera/grounding 준비,
optional mask 손상과 새 typed budget 오류 기대값을 고친 test-only delta 및 최초 실패 로그를 보존했다.
실제 전체 WASI Node22/24도 각각2945회귀를 통과했고 새 production Wasm과 SDK1839회귀·lint·Web 빌드·실제 packed
public runtime 브라우저/패키지/타입 검증이 통과했다. Source·명령·정확한 범위는
`artifacts/physics-3d/goal-closure/native-file-gameplay-snapshot/integrated/`를 따른다. 이전1595의 선택 WASI나
1575의 production 검증 결과를 이 소스의 최종 전체 제품 수용으로 대신하지 않는다.

이 단계에서 남긴 DataScene gameplay/전투·prefab/progress와 내장3개 scene, CharacterRuntime/저장 preview/path 사본은
후속 owner 작업으로 이어갔다. 남은 UnifiedPhysicsRuntime owner, 실제 할당/RSS, SDK 자원/host/대화·퀘스트,
owner/fence/epoch·Ready·단일 publication과 public importer는 계속 남는다. 원래9개 범주 전체와 개발 완료 후
실게임·실기기 검증 순서는 유지한다.

### 실제 대화·퀘스트 공유 graph의 파일 복원 — Engine 전체 연결 진행 중

Main에 standalone Dialogue/Quest의 actual constructor/lifecycle·공유 native Rc graph를 통합했다.
고정16/32B header probe와 expected-header 대조 뒤 body를 읽으며, linked cold restore는 초기 Quest update를
다시 실행하지 않는다. 기존936 Wasm export signature를 유지하고 standalone cold3개만 추가했다.
명시 root에서 도달하는 공유를 보존하고 같은 값의 별도 Quest는 합치지 않는다. 삭제된 Quest facade라도 live
Dialogue가 유지하는 진행은 실제 linked packet으로 읽으며, 선언 graph에 native owner가 없으면 진행 없는
NativeAbsent를 보존한다. 저장 provenance를 새 runtime revision으로 주입하지 않으며 성공한 같은 값 restore도
기존 fence를 무효화한다. SDK의 graph token은 전체 Engine/session Ready가 아니다.

현재1713개 Core freeze SHA는 `6b20c751f088aa4370defe816f304c8ccb2cb6ff419dd9f6fe5e949fc10aacb6`이다.
이전1711의 Native 작성 정보·직접 TLS·공통 ResourceBudget/host registry를 보존하고 소유9파일을 exact 통합했다.
전체 native3057/실제 전체 WASI Node22·24 각각3057, 새Rust5개/SDK11개 회귀가 통과했다.
Fresh production Wasm7,484,579B의 SHA는 `32f627d5f55595754f2832fa06b6ace1ad5779d2464a42fd74acbb28073135e0`이다.
Web build·SDK lint/전체1866·actual packed runtime package/types·품질8 gate가 통과했다. 같은 tarball/Wasm의
별도 Chromium148에서도 shared Quest wrapper 삭제·NativeAbsent·6회 진행·prepared alias stale와
page/console error0을 확인했다. 원본 명령·종료·source/byte hash는
`artifacts/physics-3d/goal-closure/native-file-dialogue-quest-admission/integrated/`를 따른다.

실제 allocator/OOM·전체 native/JS/GPU/host 메모리 상한, 전체 Native resource inventory와 SDK resource/active audio,
모든 participant를 묶는 owner/fence/epoch·Ready·원자적 게임 세션 교체·public importer는 남는다.
주입한 factory 실패 회귀를 실제 OOM 검증으로 사용하지 않는다. 마지막 전체 Studio/4개 consumer 제품 matrix1575와
current runtime1713을 구분하며 원래9개 범주 전체·개발 완료 뒤 실게임/실기기 순서는 그대로 유지한다.

### Native 자원 참조·fallible decode·회전 CCD 검색 합성 — 전체 목표 진행 중

Native84 저장 field/하위44 persistent struct의 현재·미래 정의·pending·retained resource ID inventory를
동일 admitted Candidate에 연결했다. Source-owned Texture/Model/Font/DirectSound/Preset/Effect/Clip namespace와
raw f32 bits·order·duplicate·sentinel·codeconstant/non-render provenance를 보존한다. Metadata는 resource content나
SDK owner/session Ready를 증명하지 않는다.

Codec4 helper는 첫 Vec materialization부터 fallible reservation을 사용하고 실제 TryReserveError를 logical quota와
분리한 sticky Allocation으로 기록한다. 저장 capacity/wire·first-failure·정리 의미는 유지한다. 격리 allocator-null
시험에서 이전 Native4경로의 abort를 재현하고 수정 후 Native/실제 WASI Node22·24 각각18개(총54) 예약 실패를
오류 반환·tracked live payload0·다음 decode 정상으로 확인했다. Native 정상4case의 payload/논리 Usage/요청 수도 같다.
이는 physical OOM/전체 allocator/RSS cap 검증이 아니며 Main/production에 global allocator나 unsafe를 추가하지 않았다.

별도 완료된 CCD local bound 수정도 최종 배치에 포함했다. 실제 COM/local offset과 nlerp curvature/rotation-axis
범위로45도 회전 mid-tip 누락을 고쳤고 zero-angular old union·linear12조건 payload/다음tick24개·state/order/counters를
보존했다. 기존 TOI·skin·solver cap을 완화하지 않았다. Full-winding endpoint narrowphase와 actual character
piecewise/kinematic accepted-cap 모델은 계속 미완이며 실제4.12m phantom push 재현은 다음 구현에서 처리한다.

합성 Main1724 source freeze SHA는 `9b8bfc415b14c5923ca3572504eff0dc22a5f81109578be4228a98b24658d2e1`이다.
전체 native3086와 실제 전체 WASI Node22·24 각각3086, 새Core29개(자원17/codec6/CCD6)가 통과했다.
798개 vendor source 전수 일치로 작업자의 실제 library202/기존CCD11/새vendor7 actual WASI22·24 결과를 상속하며
Root 재실행으로 표시하지 않는다. Fresh production Wasm7,555,845B/SHA
`d7829a30d62e5f946d3c58736fce42932625af7bf386c83ef9504179e68f0d6e`, 기존939 signature 유지, Web build·SDK1866·
actual packed runtime/package/types/DQ browser·품질8 gate도 통과했다. 현재 세 변경은 최종 SDK matrix를 한 번 실행했다.
원본 명령·종료·source/byte hash는 `artifacts/physics-3d/goal-closure/native-file-fallible-sequences/combined-angular/`를 따른다.
중간1722 Rust/WASI/build 결과와 isolated1714/1715 allocator 실험을 현재 전체 메모리/제품 수용으로 바꾸어 사용하지 않는다.

전체 SDK resource bytes/aliases·두 section codec·host·독립 namespace의 실패 격리 실구현·owned NativePrepare·
handle/epoch/fence·Ready·원자적 세션 교체·public importer는 남는다. 최종 Studio/4consumer/밀집/remoteCI 및
개발 완료 뒤 실게임·실기기도 계속 미완이다. 마지막 full product1575와 current runtime1724를 구분하고 원래9개 목표를 유지한다.

### Native character 저장·runtime 원시 key 순서·공통 gameplay 기반 — 전체 목표 진행 중

CharacterRuntime12필드와 Preview/합산 상태 사본, characters map 순서를 native capture/restore 경계에서 검사한다.
실제 public producer의1024 controller·추가 sensor·외력/점프·stale support와2-knot 접촉 이력을 보존한다.
명령 입력과 결과 수치의 서로 다른 범위, native 독립 논리 방문 한도와 post-decode budget을 구분한다.

UnifiedPhysicsRuntime 내부 map/set11곳은 원래 순서/중복을 검사한다. 실제 Engine의4개 map에서 CRC가 유효한
변조8개가 조용히 정규화되는 Before를 확보한 뒤 거절하도록 바꿨다. 정상 wire·기존 누적 decode 청구량은 같다.
공통 trigger/contact/cache와 EntityTemplate의 readonly 검사 기반도 연결했으며 아직 전체 gameplay owner는 아니다.

현재1653개 Main 소스는 fmt/Clippy·전체 native2977 및 실제 전체 WASI Node22/24 각각2977회귀를 통과했다.
직전1639 대비 Rust14개 추가·14개 수정, 신규32회귀이며 이전 회귀의 이름/상태를 유지한다. 실제 명령·로그·source는
`artifacts/physics-3d/goal-closure/native-file-runtime-admission/integrated/`를 따른다. 새 production Wasm/SDK 검증은
이번 단계에 다시 실행하지 않았으며 마지막 해당 검증은1639 소스, Studio/전체 consumer matrix는1575 소스다.

나머지 Runtime 출력/이벤트11 owner, DataScene 전투·prototype/progress와 내장 scene/두 native leaf는 병렬 개발 중이다.
Runtime의 pending/planar/terrain/dash/automatic payload, 실제 allocation/RSS·SDK/resource/session/public importer와
나머지9개 범주 전체는 계속 남는다. 실게임·실기기는 기존 지시대로 개발 완료 후 진행한다.

### Data Scene 전투·내장 씬·runtime 관측 저장 검사 — 통합 진행 중

DataSceneGameplay/Combat의 queue·scratch·navigation·prefab/progress·작성 사본과 ActorPrototype/BodyPrototype·
controller descriptor 검사를 연결했다. Native controller 검사는 기존 별도 pass를 재사용한다. 내장3개 씬의
비활성 슬롯과 두 native body-cache owner도 검사하며, 정상 pending/stale history를 현재 World로 재작성하지 않는다.
Runtime observation11 owner는 공개 출력 clear 뒤 남은 내부 cache까지 검사한다. 각 pass가 쓴 work/scratch를
후속 allowance에서 차감하며 실제 allocation/RSS 측정과 구분한다.

검증 과정에서 실제 공개 sphere ray의 중심 시작이 NaN 법선을 만드는 결함을 재현했다. 공개 출력이 남아 있으면
기존 저장 검사가 거절하고, 출력 clear 뒤에는 내부 cache에만 NaN이 남았다. Vendor 계산의 zero-vector fallback을
수정했으며 저장의 유한값 검사는 유지한다. 기존 유한 법선/TOI 비트 비교와 vendor lib89·195회귀가 통과했다.
처음 vendor 단독 명령의 누락된 `alloc` feature로 인한 컴파일 실패와 수정된 명령의 결과를 각각 보존했다.

현재1694개 Core 소스는 fmt/Clippy·전체 native3028 및 실제 전체 WASI Node22/24 각각3028회귀를 통과했다.
신규51회귀이며 이전 테스트 이름/상태를 유지했다. 같은 source의 새 production Wasm·Web 빌드·SDK1839·실제
packed Chromium runtime·runtime package/types도 통과했다. Export936개의 이름/kind/함수 signature를 유지한다.
Studio/전체4개 consumer matrix의 마지막 근거1575와 이번1694 runtime 근거를 구분한다. 종료 결과는
`artifacts/physics-3d/goal-closure/native-file-data-gameplay-admission/integrated/`를 따른다.
Runtime pending/planar/terrain/dash payload, 실제 메모리·SDK 자원·host/대화·퀘스트·owner/fence/epoch·Ready·
단일 publication·공개 importer 및 원래9개 범주의 미완 항목은 계속 남는다.

### 나머지 Runtime 저장 검사·외부 host binding 기반 — 전체 목표 진행 중

Runtime16의 이전 config·legacy/pending descriptor·joint·projectile·terrain/platform motion·dash·automatic
payload 검사를 같은 sealed candidate의 잔여 budget에 연결했다. 유효 CRC의21종 손상을 실제 prepare가
거절하며 정상 pending prefix·유한 large pose/default suffix·stale/unbound 설정과6 tick의 bytes를 보존한다.
기존 scope를 포함해 현재 Runtime32 저장 필드의 검사 경로를 분류했으며, 전체 Engine/자원/세션 Ready의
증명과 구분한다. 설정 map의 무제한 세대 누적은 실제 source로 입증되지 않았고, native body 한도를 넘는
live-unbound batch와 다음 retirement 전의 stale 이력을 근거로 남겼다.

SDK의 공통 host binding registry는 실제 외부 객체 identity와 사전등록 typed adapter를 연결한다. 파일의
kind/version/symbol로 새 host의 값을 해소하며 registry의 준비·해소 과정은 guard/adapter를 호출하지 않는다. 독립 리뷰에서
빈 registry가 등록 후 해제로 다시 비면 이전 fence가 유효해지는 경계 문제를 발견해 tombstone/revision으로
수정했다. 실제 GPU/font와 대화·퀘스트의 owner별 연결은 별도 진행 중이며 공통 registry만으로 완료하지 않는다.

현재1705개 Core 소스는 fmt/Clippy·전체 native3037 및 실제 전체 WASI Node22/24 각각3037회귀를 통과했다.
직전1694 대비 신규9회귀·source11개 추가/12개 수정이다. 새 production Wasm·Web 빌드·SDK1848·실제 packed
Chromium runtime·runtime package/types도 통과했고 export936개 이름/kind/함수 signature를 유지한다.
`artifacts/physics-3d/goal-closure/native-file-runtime-payload-admission/integrated/payload-stage/`를 따른다.

별도 메모리 audit는1694 기준에 test-only 계측4파일을 더한1696 소스에서 Native14·WASI각14와 새 인스턴스6개를
검증했다. 요청 payload/live peak·process RSS·committed Wasm pages는 서로 다른 지표다. 이 결과를 현재1705의
실제 상한 증명으로 사용하지 않는다. 논리 한도0에도 Rc budget metadata의 실제 요청이 있었으며 전체 실제 cap,
infallible constructor/allocator failure·동시 자원과 세션 경계는 계속 미완이다. SDK resources/host/대화·퀘스트,
actual roster·owner/fence/epoch·Ready·단일 publication·public importer와 원래9개 범주는 유지한다.

### Decode 예산 관리용 힙 할당 제거 — 전체 메모리 한도는 진행 중

앞선 계측에서 확인한 관리용 Rc 요청을 없앴다. Scalar budget을 const TLS에 직접 보관하고 중첩 decoder는
동일한 상태를 borrow한다. Scope 정리는 borrow 뒤에 실행돼 정상/오류/native unwind 뒤 상태를 해제한다.
새 unsafe·생산 allocator·의존성·serde 필드를 추가하지 않았다. 입력 검사와 기존 논리 quota/오류 우선순위는 같다.

별도 test-only source1708의 전후 비교는 decoder 한 파일만 다르고 Native와 WASI Node22/24의11종 결과/Usage가
전부 일치했다. Scalar/거절 경로의 실제 요청은 native104B·WASI52B에서0, 거절된 nested root 시도는 그 두 배에서0이
됐다. 출력 Vec16B/String5B는 유지한다. Native unwind도 전후 각각 통과했다. 이는 해당 관리용 요청 제거의
증거이며 TLS 고정 공간이나 전체 allocator/RSS 상한의 증명은 아니다.

현재1706개 Main 소스는 fmt/Clippy·전체 native3041 및 실제 전체 WASI Node22/24 각각3041회귀를 통과했다.
신규4회귀, source1개 추가·2개 수정이며 이전 이름/상태를 유지한다. 새 production Wasm·Web 빌드·SDK1848·
실제 packed Chromium runtime·runtime package/types도 통과했고 export936개 이름/kind/함수 signature가 같다.
`artifacts/physics-3d/goal-closure/native-file-decode-budget-storage/`를 따른다. Serializer 필드 계약은 바꾸지 않았지만
기존 정책대로 source 변경은 build fingerprint를 바꾸므로 cross-build 파일 바이트/호환성이 같다는 주장은 아니다.

실제 메모리 cap/infallible allocation·Native의 실제 roster·SDK resource/host/대화·퀘스트·전체 owner/fence/epoch/
Ready·단일 publication·public importer와 원래9개 범주는 계속 진행 중이다. 실게임·실기기는 개발 완료 뒤 진행한다.

### 실제 Native 작성 정보와 SDK 공통 자원 예산 — 전체 저장 기능 진행 중

동일한 admitted Candidate에서 실제 변수 layout·저장 slot generation/alive·live component/texture/clip·저장 model/LOD·
native body binding·unkeyed continuity를 추출하는 private roster를 통합했다. 두 immutable scan의 count/reserve/fill과
Candidate 수명 동안 유지되는 output Vec를 공통 post-decode work/scratch에 합산한다. 현재 alive/generation 동등만
LiveExact이며 불일치·MAX retirement·낮은 세대나 wrapping epoch로 과거 실존·삭제된 자원·세션 freshness를 발명하지 않는다.
Metadata borrow getter는 Engine 실행·query/render·Ready나 public importer가 아니다.

SDK `ResourceBudget`도 한 ledger의 resource/work/metadata/source/decoded/GPU 논리 요청을 누적하도록 추가했다.
Root 검토에서 hidden unknown/Symbol 필드 누락을 수정하고 getter 실행 없이 거절하는 회귀를 추가했다.
Bounded reader 이후의 record 검사이며 reflection 임시 key 배열이나 allocator/host/GPU/RSS cap 증명이 아니다.

Main1711개 Core source freeze는 `345bef8a881af060b323340843c23c3de67d5c825135bcd761de92672b006358`이다.
정확한 owned16파일 패치를 통합하고 Main1706의 관리용 Rc 제거와4회귀를 보존했다. 전체 native3052와 실제 전체
WASI Node22/24 각각3052, 새 roster11회귀·SDK 예산7회귀가 통과했다. Fresh production Wasm7,463,586B의 SHA는
`9ca5b5b7bd33b1b60a10a1faa4e833d5f560fe7999c57abfd540283726ff4377`이며 export936 signature는 같다.
Web build·SDK lint/전체1855·actual packed Chromium/runtime package/public types 및 품질8 gate도 통과했다.
원본 명령·종료·source/byte 해시는 `artifacts/physics-3d/goal-closure/native-file-roster-admission/integrated/`를 따른다.

전체 현재·미래 생성용·retained resource inventory, SDK 자원/active audio/host·별도 대화/퀘스트의 Main 통합,
actual 메모리 상한·owner/fence/epoch·Ready·원자적 세션 교체·공개 파일 API는 계속 미완이다. 이번에 전체 Studio/4개
consumer 기능 matrix를 반복하지 않았으며 마지막 전체 제품 단계1575와 구분한다. 원래9개 범주와 개발 완료 뒤
실게임·실기기 검증 순서는 유지한다.
