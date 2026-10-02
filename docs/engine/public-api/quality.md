# Quality Public API

`@ferrum2d/ferrum-web/quality`는 smoke, replay, profiler, diagnostic, screenshot/report helper를
모은 preview entrypoint다. 제품 runtime 자체보다 검증과 agent workflow에 초점을 둔다.

```ts
import {
  RuntimeProfiler,
  evaluateRuntimeProfilerBudget,
  createGameplayReplayRun,
  diagnosticReport,
} from "@ferrum2d/ferrum-web/quality";
```

## Runtime Profiler

| API | 계약 |
| --- | --- |
| `RuntimeProfiler` | frame time, render time, Rust update, draw call, entity count, physics candidate count 같은 sample을 수집한다. |
| `evaluateRuntimeProfilerBudget(...)` | profiler snapshot을 runtime budget profile과 비교한다. |
| `runtimeDiagnosticsFrameSample(...)` | debug overlay와 report에 쓰는 frame sample을 만든다. |
| `evaluateRuntimeDiagnosticsSample(...)` | frame sample을 diagnostic budget과 비교한다. |

budget field를 추가하면 smoke runner가 실제 sample에 값을 기록하는지 같이 확인한다.

### GPU 자원 예산

WebGL2 runtime은 다음 값을 DebugOverlay와 `RuntimeProfiler.recordFrame(...)`에 실제로 전달한다.

| frame sample 필드 | budget/snapshot 최대값 필드 | 단위 |
| --- | --- | --- |
| `gpuTextureCount` | `maxGpuTextureCount` | count |
| `gpuBufferCount` | `maxGpuBufferCount` | count |
| `gpuProgramCount` | `maxGpuProgramCount` | count |
| `gpuRenderTargetCount` | `maxGpuRenderTargetCount` | count |
| `gpuEstimatedBytes` | `maxGpuEstimatedBytes` | bytes |

`gpuEstimatedBytes`는 GPU 저장량 추정치이며 실제 VRAM 측정값이 아니다.
[집계 범위와 계산식](core.md#gpu-자원-통계)을 따른다.
GPU snapshot 최대값은 보관 중인 frame window 전체가 측정된 경우에만 제공한다.
빈 window나 하나라도 해당 값이 없는 window는 최대값을 `undefined`로 유지한다.
해당 budget을 설정하면 `missingMetric`으로 실패하므로 native WebGPU/custom renderer의
미지원 상태를 0으로 오인하지 않는다. budget을 설정하지 않은 기존 사용은 영향을 받지 않는다.
`reset()`은 sample window만 비우며 renderer 자원을 해제하지 않는다.

## Diagnostics

| API | 계약 |
| --- | --- |
| `diagnosticReport(...)` | agent가 읽기 쉬운 diagnostic report envelope를 만든다. |
| `formatDiagnosticReport(...)` | report를 사람이 읽는 text로 변환한다. |
| `FerrumDiagnosticError` | diagnostic report를 포함하는 error type이다. |
| `gameplayActionDiagnosticReports(...)` | action failure telemetry를 path/expected/actual/suggestion report로 바꾼다. |
| `gameplaySpawnDiagnosticReports(...)` | spawn telemetry를 activity/mismatch report로 바꾼다. |

diagnostic helper는 runtime을 되돌려 호출하지 않는다. Rust-owned telemetry와 decoded frame event를
agent가 수정 제안에 사용하기 쉬운 형태로 요약한다.

## Replay And Snapshot

| API | 계약 |
| --- | --- |
| `createGameplayReplayRun(...)` | deterministic gameplay replay run artifact를 만든다. |
| `compareGameplayReplayRuns(...)` | replay result drift를 비교한다. |
| `compareBehaviorStateMachineReplay(...)` | FSM replay 결과를 비교한다. |
| `createPhysicsReplayInputStream(...)` | physics replay input stream을 만든다. |
| `verifyPhysicsReplayRollback(...)` | physics world snapshot/restore rollback을 검증한다. |
| `PhysicsReplayWorkerClient` | opt-in worker replay client다. |

Replay helper는 CI와 agent workflow의 evidence를 만들기 위한 API다. public gameplay runtime에서
매 frame callback 대신 replay artifact를 검증 기준으로 사용한다.

## Debug Gizmo And Screenshot

| API | 계약 |
| --- | --- |
| `DebugOverlay` | runtime metric과 debug 정보를 표시한다. 기본은 fixed overlay이며, 예제/도구 화면에서는 `layout: "inline"`으로 canvas와 겹치지 않게 배치할 수 있다. |
| `buildDebugGizmoLines(...)` | debug gizmo line spec을 runtime line buffer로 변환한다. |
| `DebugGizmoLineBufferWriter` | 기존 physics debug line buffer에 동적 line/polyline/arrow/circle을 추가하는 재사용 writer다. `reset()` 후 frame 안에서 사용한다. |
| `resolveScreenshotCaptureSpec(...)` | screenshot capture 옵션을 검증한다. |
| `summarizeScreenshotPixels(...)` | screenshot pixel summary를 만든다. |
| `compareScreenshotSummaries(...)` | visual smoke summary를 비교한다. |

Screenshot과 debug gizmo helper는 smoke evidence와 저빈도 debug authoring 보조용이다. gameplay simulation이나 visual editor를 의미하지 않는다.
