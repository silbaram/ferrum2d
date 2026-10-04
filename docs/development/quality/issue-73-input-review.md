# #73 B1 입력 API 구현·리뷰 기록

- 기준: 2026-10-04, `feat/73-input-actions-context` 작업 브랜치.
- 추적 이슈: [#73](https://github.com/silbaram/ferrum2d/issues/73).
- 이번 변경은 B1의 **엔진 API·검증·이행 문서**다. #73 전체 완료나 소비자 적용 완료가 아니다.
- 소비자 `game-test`의 beta.3 설치 및 입력/진행/UI 소스를 확인했다. 게임 파일과 설치 패키지는 수정하지 않았다.
- 이 기록은 로컬 리뷰 완료 시점의 결과다. 당시 푸시, PR, 릴리스, 이슈 체크박스/상태 변경은 실행하지 않았다.

## 변경과 이유

| 파일 | 변경 이유 |
| --- | --- |
| `packages/ferrum-web/src/inputProfile.ts` | JSON `code` binding, profile 전체 검증·복사, 기존 held `pressedActions` 의미 보존 |
| `packages/ferrum-web/src/inputManager.ts` | 임의 키/복수 키, named action/axis, edge 소비, enable/clear, source별 합성 및 수명주기 초기화 |
| `packages/ferrum-web/src/virtualControls.ts` | capture 해제, 복수 터치, 같은 가상 action의 OR 합성, 짧은 탭 구독 |
| `packages/ferrum-web/src/createFerrumRuntime.ts` | 입력 취소 콜백 예외에도 소유 자원 정리 지속, 초기화 실패 시 생성한 물리 scene 정리 |
| `packages/ferrum-web/src/core.ts`, `public/platformExports.ts` | 공개 core/root 타입·helper export |
| `packages/ferrum-web/test/inputManager.test.ts`, `inputProfile.test.ts` | 호환성·모달·창 전환·gamepad neutral·source isolation·재진입 회귀 |
| `packages/ferrum-web/test/virtualControls.test.ts`, `createFerrumRuntime.integration.test.ts` | 취소 콜백 실패·초기화 실패에서 종료 상태, 자원 정리와 외부 객체 소유권 검증 |
| `tests/smoke/input-context-browser-smoke.mjs` | 실제 tarball의 `/core`만 사용하는 Chromium 소비자 검사 |
| `package.json`, `.github/workflows/ci.yml` | 독립 smoke 명령, smoke:check 및 validate job 연결 |
| README, architecture, public API manifest/core 문서, smoke-check | 구현과 공개 사용법·검증 범위 동기화 |
| `docs/engine/input-actions.md` | beta.3에서 새 API로 이전하는 소비자 지침 |

Rust 시뮬레이션 상태나 render/input Wasm ABI를 변경하지 않는다. 원래의 9-field
`InputSnapshot`을 유지하고, TS가 플랫폼 입력 상태와 action 전환만 관리한다.
단일 gameplay enable gate를 제공하며 pause와 클릭 목표 취소는 앱이 담당한다.

## 리뷰에서 수정한 사례

1. 같은 control에 연결된 키 중 하나를 해제해도 다른 held 키는 유지한다.
2. clear 뒤 held gamepad가 다시 움직이지 않도록 모든 매핑 control의 중립 poll을 요구한다.
3. 취소 구독에서 `input.clear()`를 호출할 때 생기던 재귀를 차단하고 neutral 알림을 억제한다.
4. joystick 취소 알림 뒤 capture가 다시 잡히지 않도록 capture를 먼저 취득한다.
5. 창 밖에서 keyup이 유실돼도 다음 non-repeat keydown은 새 입력으로 처리한다.
6. 여러 가상 버튼이 같은 action에 연결되면 일부 해제로 다른 held 버튼이 지워지지 않는다.
7. 앞 binding이 true여도 뒤의 잘못된 binding 검증을 생략하지 않는다.
8. 마우스 좌우 버튼을 함께 누른 뒤 왼쪽 버튼만 놓아도 canvas, 가상 버튼, joystick의 primary 입력을 해제한다.
9. pointer gesture를 끈 touch fallback에서도 포인터 좌표는 갱신한다.
10. open Shadow DOM 안의 입력칸에서도 게임 키 처리가 텍스트 입력을 가로채지 않는다.
11. `null` profile과 sparse binding/key 배열을 조용히 받아들이거나 TypeError를 내지 않고 위치를 포함한 검증 오류로 거부한다.
12. iframe 등 canvas 소유 창의 gamepad를 사용하고, 처음부터 창에 포커스가 없으면 입력을 활성화하지 않는다.
13. 입력 취소 구독이 예외를 던지거나 재진입해도 InputManager/VirtualControls 종료 상태와 리스너·DOM 정리를 유지한다.
14. 입력 종료가 실패해도 상위 runtime의 나머지 소유 자원을 정리한다. 초기화 실패 중 정리 오류가 나도 최초 초기화 오류를 보존한다.
15. autostart 실패 시 runtime이 만든 physics scene의 body와 auto-step, streaming wrapper를 정리한다. 주입된 engine/renderer의 소유권은 유지한다.

수명주기·OR 합성·초기화 정리 경로와 마지막 가상 마우스 버튼 조합 수정을 다시 검토했고,
검토 범위 내에서 남아 있는 재현 가능한 결함은 확인하지 못했다.
이는 이슈 전체 또는 모든 하드웨어에 결함이 없다는 보장은 아니다.

## 실행한 검증

| 명령 | 결과와 범위 |
| --- | --- |
| `pnpm --filter @ferrum2d/ferrum-web lint` | 최종 소스/테스트 TypeScript 검사 통과 |
| `pnpm --filter @ferrum2d/ferrum-web test` | 추가 리뷰 후 806/806 통과, 실패·skip 0 |
| `pnpm build` | Wasm·workspace 전체 빌드 통과 |
| `pnpm package:check:ferrum-web` | Wasm 포함 tarball 검사 통과 |
| `node scripts/package/check-package-files.mjs --require-wasm-pkg --verify-pack` | 마지막 입력 수정 후 생성한 dist의 tarball 재검사 |
| `pnpm smoke:input-context` | packed `/core`, 1280×720/390×844 × DPR 1/2. 실제 키/마우스, native dialog, Shadow DOM, native lost capture, virtual 입력, simulated gamepad 검사 |
| `pnpm --filter @ferrum2d/minimal-game build` | 최종 입력 API를 사용하는 기존 예제 빌드 |
| `node tests/smoke/browser-render-smoke.mjs --mode=virtual-controls examples/minimal-game/dist` | 기존 가상 입력 예제 회귀 검사 |
| `pnpm validate:public-api-surface` | 공개 export, manifest, 소비자 import 규칙 통과 |
| `pnpm validate:docs-links` | 소스 문서 링크 검사 통과 |
| `pnpm build:pages`, `pnpm validate:pages-artifact` | 로컬 문서 HTML 생성·링크 검사. 원격 배포 아님 |
| `git diff --check` | whitespace 오류 없음 |

초기 작성 중 TypeScript의 Record 변환 및 테스트 event 타입 오류를 수정한 뒤 검사했다.
추가 리뷰에서는 결함을 회귀 테스트로 먼저 재현하고 수정 후 통과를 확인했다.
native capture 검사는 브라우저가 pending capture를 활성화한 뒤 해제 이벤트를 발생시키도록
순서를 보정했다. 합성 이벤트만으로 native capture 통과를 주장하지 않는다.
최초 검증은 `artifacts/issue73-b1-qa/`, 추가 리뷰 원본은
`artifacts/issue73-b1-review-qa/`, packed browser report는
`artifacts/input-context-consumer-*/report.json`에 남는다.

최종 packed input 검사는 `artifacts/input-context-consumer-QaQJiB/report.json`의
4개 viewport/DPR 조합 모두 통과했다. 실제 가상 버튼/joystick의 mouse chord 실패
재현은 `artifacts/issue73-b1-review-qa/virtual-chord-before.log`에 보존했다.

## 제외한 검증과 남은 범위

- Rust 소스·ABI 변경이 없어 별도 cargo fmt/clippy/test는 반복하지 않았다. Wasm 빌드는 실행했다.
- 루트 `format`은 현재 해당 패키지에 formatter script가 없어 실행하지 않았다.
- 실제 게임패드/실물 모바일 하드웨어를 사용하지 않았다. gamepad는 브라우저 대역,
  touchcancel/visibility는 단위 검사와 합성 DOM 이벤트로 보강했다.
- 원격 CI는 미실행이다. workflow에 연결한 것과 원격 성공은 구분한다.
- `game-test`의 `npm run ferrum:check`와 게임 화면 검수는 미실행이다. 이번에 게임은 변경하지 않았다.
- B1 소비자 전환은 이 API를 포함한 패키지 배포 후 진행한다. 설치된 beta.3에 API가 있다고 가정하지 않는다.
- A1(DialogueSession/QuestLog), A2(snapshot 저장 이전), A3(HUD/모달/vignette),
  A4(Data Scene navigation 실험)는 소비자 프로젝트 작업으로 남는다. B1 출시는 A 작업의 선행 조건이 아니다.
- B2 윤곽 그림자와 C1 고급 조명 설계는 이번 입력 변경에 포함하지 않았다.

소비자 작업의 시작점은 `src/game/exploration.ts`와 `src/runtime/createIslandRuntime.ts`의
진행 배열/localStorage를 A1 → A2 순서로 이전하는 것이다. 기존 저장과 이야기 문구를
보존하고, A3/A4는 각각 독립 검증한다. B1 입력 이행은 `src/runtime/controls.ts`의
중복 key/touch 수집을 줄이되 앱의 목표/경로·수동 pause 정책은 유지한다.
