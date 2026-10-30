# 배포 후속 검증 후보

기준일: 2026-10-29
상태: 실제 native 설치·GUI·서명 증거와 추가 host 필요성 검토. 원격 공개 상태를 뜻하지 않는다.

현재 운영 계약은 [정적 웹 배포](../development/operations/demo-deploy.md),
[엔진·뷰어 분리 준비](../development/operations/github-release.md#엔진과-전체-뷰어-앱-분리-준비),
[버전 확인과 업데이트](../development/operations/github-release.md#버전-확인과-업데이트)가 기준이다.
OS별 설치 조건과 수동 GUI 점검은 [desktop README](https://github.com/silbaram/ferrum2d/blob/main/apps/placement-viewer-desktop/README.md)를 따른다.

## 기존 준비 경로와 남은 검증 구분

- Production build·preview·deploy report와 Pages artifact 생성은 기존 경로를 사용한다.
- `github-release-prepare.yml`의 `include_viewer`는 Windows/Linux/macOS 준비 matrix를 제공한다.
  CI 경로를 새로 만드는 작업으로 등록하지 않는다. unsigned 빌드 성공과 실제 GUI/서명 검증은 구분한다.
- 프로젝트 SDK와 앱/내장 엔진의 버전 확인·업데이트, signed updater 준비도 제공한다.
  업데이트를 신규 미구현 기능으로 등록하지 않는다. 배포 키·실제 자료 공개·설치 검증은 별개다.

## 남은 검증 후보

| 후보 | 완료 조건 |
| --- | --- |
| Release artifact의 실제 GUI | 대상 OS에 실제 설치한 앱에서 project/file picker, save·재열기, asset protocol·reload, handoff, interactive canvas를 확인하고 artifact hash·환경·조작·캡처 보존 |
| 실제 앱 업데이트 | 이전 설치 앱과 새 signed 자료를 준비한 환경에서 확인·설치·재시작, 변조/서명 불일치 거절과 실패 상태를 검증. 프로젝트 SDK 업데이트와 구분 |
| 플랫폼 서명·notarization | Windows/macOS 대상과 키 관리·서명 검증·배포 정책을 별도 결정. updater 서명으로 대체하지 않음 |
| Native GUI 검증의 CI 편입 | 로컬 package smoke/headless transport와 GUI 상호작용을 구분하고 runner·권한·실패 artifact·실행 비용을 정한 뒤 선택 |

`pnpm smoke:placement-viewer-desktop-package`의 artifact/startup 확인과 Rust headless transport는
실제 packaged GUI/IPC 검증을 대신하지 않는다. 자동 검증의 범위를 늘리더라도 기존 native release gate를 유지한다.
원격 배포·Release 공개·키 설정은 해당 작업을 요청받았을 때 운영 절차에 따라 수행한다.

## 요구가 확인되면 검토할 범위

| 후보 | 결정할 내용 |
| --- | --- |
| Generated game desktop wrapper | 실제 게임의 필요가 있는지, web runtime을 감싼 host의 파일/입력/asset 권한과 package acceptance를 별도 정의 |
| 추가 정적 hosting 지원 | base path·Wasm MIME·cache/header·SPA fallback 차이가 기존 상대 경로/preview 검증으로 해결되지 않을 때 전용 문서/adapter 검토 |
| Store 제출·Linux 저장소·PWA | 사용자 요구와 운영 비용을 확인한 뒤 각각 분리. 현재 배포 준비에 자동 포함하지 않음 |

Desktop host는 Rust core를 native renderer로 바꾸지 않는다. simulation과 render command는 계속 Rust가,
WebView·local file/asset capability는 platform host가 맡는다. project-root allowlist와 browser-only 저장 경계를 유지한다.
