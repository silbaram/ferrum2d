# 데모 게임 포트폴리오 후속 계획

상태: 신규 public 노출 후보 결정 대기
기준일: 2026-10-30

이 문서는 이미 구현된 데모의 사용법을 반복하지 않고, smoke/report 중심의 기능을 public
showcase로 노출할지 결정하기 위한 planning 기록이다. 현재 route와 운영 계약은
[Showcase Hub](../engine/showcase-hub.md)와
[GitHub Pages 데모/문서 배포](../development/operations/demo-deploy.md)가 기준이다. 기존 여섯 demo route는 해당 문서에서 관리하며 다시 만드는 후보로 등록하지 않는다.

## 남은 public 노출 후보

| 검토 순서 | 후보 | 결정할 내용과 최소 확인 범위 |
| ---: | --- | --- |
| 1 | Content/UX | 기존 route 연결과 별도 demo 중 선택. HUD·locale·dialogue/quest·cutscene·reduced motion을 한 흐름에서 설명하고 keyboard/accessibility 검증 유지 |
| 2 | Renderer/WebGPU Lab | 별도 lab의 가치와 표시 범위 결정. 기존 조명·후처리·GPU 계측·복구를 재사용하고 WebGL2 기본/WebGPU 선택·fallback 상태 설명 |
| 3 | Level Streaming | 조작 가능한 demo와 report 중 선택. chunk load/unload·asset 수명·runtime 예산을 확인할 수 있어야 함 |
| 4 | Agent Workflow | report/docs 경로의 필요성 판단. create-game → `ferrum:check` → replay/report와 consumer agent 흐름을 설명하고 실제 공개·설치 상태 구분 |
| 5 | Visual polish | 기존 route에 필요한 screenshot/thumbnail 결정. 새 asset의 용량·라이선스·생성 방식 확인 |

후보는 구현 우선순위가 아니라 제품 노출 결정을 위한 검토 순서다. 현재 smoke가 있다는 이유만으로
새 route를 만들지 않는다.

현재 기능의 위치와 재현 명령은 [Showcase Hub](../engine/showcase-hub.md)와
[Smoke Check](../development/quality/smoke-check.md)를 따른다. 이 계획에 별도 기능 목록이나 완료 기록을 유지하지 않는다.

## 착수 판단 기준

새 demo나 report route를 시작하려면 다음 질문에 먼저 답한다.

1. 기존 route나 Showcase Hub 설명만으로 기능을 이해할 수 없는가?
2. 사용자가 브라우저에서 직접 조작해야만 가치가 드러나는가?
3. 기존 primary demo의 플레이 목표를 흐리지 않는가?
4. public API와 제품 지원 수준이 lab/demo 노출을 감당할 만큼 안정적인가?
5. replay, browser smoke 또는 report로 drift를 잡을 수 있는가?
6. Pages artifact 크기와 CI runtime budget 증가를 수용할 것인가?

하나라도 불명확하면 구현 전에 별도 task에서 사용자-facing 목표와 acceptance를 확정한다.

## 비목표와 승인 경계

- full visual editor나 Behavior Recipe Body Editor를 데모 명목으로 추가하지 않는다.
- 새 시각 asset은 용량, 라이선스, 생성 방식 승인 전 추가하지 않는다.
- Pages 실제 배포는 별도 사용자 승인 없이는 실행하지 않는다.
- 기본 CI gate 확대는 route 구현과 별도로 runtime/비용을 검토한다.
- 기존 대표 gameplay에 기능을 계속 누적하거나, demo를 위해 Rust render command ABI·WebGL2 fallback을 변경하지 않는다.

## 다음 결정

가장 먼저 Content/UX를 public route로 승격할 실사용 가치가 있는지 판단한다. 가치가 불명확하면 신규
route 대신 Showcase Hub의 기능 coverage와 smoke/report 링크만 보강한다. Renderer/Streaming/Agent
Workflow도 같은 기준을 순서대로 적용한다.
