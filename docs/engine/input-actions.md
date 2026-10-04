# 키 바인딩과 입력 context

이 문서는 #73 B1 구현의 입력 계약이다. `0.1.0-beta.3` 이후 소스에 추가된 API이며,
기존 beta.3 설치에는 없다. 해당 변경을 포함한 패키지로 업그레이드한 뒤 사용한다.
공개 import 경로는 `@ferrum2d/ferrum-web/core`다.

## 게임 입력 연결

```ts
import { InputManager, resolveInputActionProfile } from "@ferrum2d/ferrum-web/core";

const input = new InputManager(canvas, {
  keyBindings: {
    w: ["KeyW", "ArrowUp"], a: ["KeyA", "ArrowLeft"],
    s: ["KeyS", "ArrowDown"], d: ["KeyD", "ArrowRight"],
  },
  actionProfile: resolveInputActionProfile({
    actions: {
      left: [{ control: "a" }], right: [{ control: "d" }],
      interact: [{ code: "KeyE" }, { control: "space" }, { virtualButton: "interact" }],
      sprint: [{ code: "ShiftLeft" }, { code: "ShiftRight" }],
    },
    axes: { moveX: { negative: "left", positive: "right" } },
  }),
});

// 애플리케이션 입력 update에서 한 번 읽는다.
const state = input.actionSnapshot();
const legacyInput = state.input;
const sprinting = state.actions.sprint;
const interactOnce = state.justPressedActions.includes("interact");
```

`keyBindings`, `actionProfile`은 JSON에 저장할 수 있다. `code`는 문자 `e`가 아닌
물리 키 식별자 `KeyE`이며 키보드 배열의 영향을 받지 않는다. binding 하나에는
`control`, `code`, `virtualButton` 중 하나만 지정한다. 빈 배열은 허용하며 해당
control/action을 비활성화한다. 잘못된 binding과 존재하지 않는 axis action 참조는
다른 binding의 현재 입력값과 무관하게 거절한다. 명시적인 `actionProfile: null`과
JavaScript 배열의 빈 슬롯도 오류 경로를 포함해 거절한다. manager는 생성 시 검증하고 복사한다.
`resolveInputActionProfile`도 독립된 복사본을 반환한다.

`keyBindings`에서 생략한 control은 기존 WASD/Space/Enter 설정을 유지한다.
같은 control에 여러 키를 연결하면 하나라도 눌린 동안 true다. 방향키나 E·Shift를
기본 게임에 자동 추가하지 않는다. 축 값은 양수 action − 음수 action으로 -1/0/1이다.
`control`은 키보드·게임패드·터치 등 합쳐진 legacy 입력, `code`는 키보드만 참조한다.

## held와 이벤트 소비

| API/필드 | 의미 |
| --- | --- |
| `snapshot()` | 기존 9개 필드 그대로 반환. 액션 edge를 소비하지 않음 |
| `actionSnapshot().input` | 같은 sample의 legacy 입력. 이 값을 사용하면 중복 poll을 피할 수 있음 |
| `actions` / `pressedActions` | 현재 held 상태 / held action id 목록. 기존 `pressedActions` 의미 유지 |
| `justPressedActions` / `releasedActions` | 직전 `actionSnapshot()` 이후 발생한 누름 / 해제 id. 읽으면 소비 |
| `clear()` | held와 대기 중 edge를 취소. 인위적인 release 이벤트는 생성하지 않음 |

프레임 사이의 짧은 키·가상 버튼 탭도 edge에 남는다. 한 action을 여러 번 탭해도
각 edge 목록에는 한 번만 나타나며 두 목록 사이의 시간 순서는 제공하지 않는다.
게임패드는 poll 사이의 전환을 관찰할 수 없다. 여러 소비자가 있다면 애플리케이션이
`actionSnapshot()` 한 번의 결과를 공유한다. 별도 `resolveInputActionState(...)`는
상태 없는 helper이며 edge를 만들지 않는다. `options.keys`로 held code Set을 전달할 수 있다.

## 모달·포커스·재시작

```ts
// 앱은 클릭 이동 목표와 실제 pause 정책을 별도로 취소/적용한다.
input.setEnabled(false); // 모달 열기: 게임 입력 초기화 + DOM 기본 동작 허용
input.setEnabled(true);  // 모달 닫기: 새 입력부터 수신
input.clear();           // 씬 재시작 등에서 입력만 초기화
```

`enabled: false`로 생성할 수도 있다. `setEnabled`는 같은 값이면 아무 일도 하지 않는다.
단일 gameplay gate를 제공하며 UI는 자신의 DOM 이벤트를 처리한다. context stack이나
UI/gameplay 간 action 우선순위 router는 제공하지 않는다. 입력 비활성화 자체는 엔진
시뮬레이션을 pause하지 않으므로 수동 pause와 모달 pause 상태를 앱에서 유지한다.

- 비활성, window blur, document hidden 동안 snapshot은 중립이다. blur/focus,
  visibilitychange에서 held/edge/가상 입력/pointer capture를 초기화한다.
- 초기화 때 눌려 있던 키와 비활성 중 누른 키는 release 뒤 새 press로 재개한다.
  keyup은 비활성 상태에도 처리하고 repeat만으로 입력을 되살리지 않는다. 창 밖에서
  keyup이 유실돼도 다음 `repeat: false` keydown은 새 press로 인식한다.
- input/textarea/select/button/contenteditable의 키는 gameplay가 소비하지 않는다.
  open Shadow DOM 내부 입력칸도 같은 규칙을 따른다. 키를 놓지 않은 채 canvas로
  포커스를 옮겨도 repeat가 새 입력이 되지 않는다.
- 게임패드는 초기화·재활성화·관찰된 연결 해제/교체 후 **매핑된 모든 축·버튼이
  중립인 poll**을 한 번 거쳐야 다시 동작한다. deadzone 안의 축은 중립이다.
  초기 생성 시 포커스가 있는 canvas의 창에서는 연결된 게임패드를 즉시 읽는다.
  입력 이벤트와 gamepad 모두 canvas를 소유한 창을 사용하며, 처음부터 포커스가 없는
  창에서는 poll하지 않는다.
- pointercancel/lostpointercapture/touchcancel은 해당 pointer source만 해제한다.
  키보드·게임패드·다른 가상 source의 held 상태는 유지한다. 마우스 좌우 버튼을 함께
  누른 뒤 왼쪽만 놓아도 primary 입력은 해제한다. `pointerGestures: false`는 이동
  gesture만 끄며 touch fallback의 pointer 좌표는 계속 갱신한다.
- `destroy()`는 중립화·리스너 해제 후 멱등이다. 이후 snapshot은 중립이며 게임패드를
  poll하지 않는다. `setEnabled`/`setVirtualInput`은 destroy 뒤 호출하면 오류다.
  취소 구독 콜백이 예외를 던져도 리스너 정리를 끝내고 오류를 호출자에게 전달한다.

## 가상 입력의 소유권

커스텀 터치 버튼은 pointer별 source id를 사용한다. 애플리케이션에 키 held Set을
중복 구현할 필요가 없다. source의 상태를 교체할 때는 그 source의 전체 상태를 전달한다.

```ts
input.setVirtualInput(`touch:${pointerId}`, {
  controls: { w: true }, buttons: { interact: true },
});
input.setVirtualInput(`touch:${pointerId}`); // 이 source만 제거
```

서로 다른 source는 OR로 합친다. 비활성 중 설정은 버리며 `clear`는 모든 source를
제거한다. 커스텀 어댑터는 새 pointerdown에서만 source를 만들고, up/cancel/lostcapture와
앱 reset에서 자기 pointer 추적도 해제해야 한다. 앱 의미인 클릭 이동 목표 취소는 앱 책임이다.

기존 `VirtualControls`는 `new InputManager(canvas, { virtualControls })`로 연결한다.
manager가 상태 전환을 구독해 짧은 탭을 기록하고 clear 때 `releaseAll()`로 capture도
해제한다. joystick와 서로 다른 버튼은 동시에 터치할 수 있다. 마우스 버튼 조합에서도
왼쪽 버튼을 놓으면 버튼/joystick의 pointer 입력만 해제하며 다른 held source는 유지한다.
manager는 외부 controls를
소유하지 않으므로 destroy 때 구독만 해제한다. 생성한 앱이 `virtualControls.destroy()`를
호출한다. `VirtualControls.destroy()`도 구독 콜백의 예외와 무관하게 DOM/capture를
정리하며 이후 setter는 거절한다. `VirtualControls.subscribe(listener)`의 반환값은 구독 해제 함수다.
이미 연결한 controls를 `inputTransform`에서 다시 합치지 않는다.

`createFerrumRuntime().destroy()`는 입력 취소 등이 실패해도 자신이 소유한 나머지
자원 정리를 모두 시도한 뒤 첫 오류를 전달한다. 초기화 실패 도중의 정리도 모두 시도하며
그때는 원래 초기화 오류를 유지한다. 생성한 physics scene의 body/auto-step과 streaming
wrapper도 정리한다. 주입한 외부 renderer/input/engine의 소유권은 유지한다.

## beta.3 게임의 이행 순서

1. 변경을 포함한 패키지를 설치하고 공개 타입/API 존재를 확인한다. 설치된 `node_modules`는 수정하지 않는다.
2. 앱의 WASD·방향키 별도 Set을 `keyBindings`, E/Shift 처리를 `actionProfile`로 옮긴다.
3. 프레임에서 `actionSnapshot()`을 한 번 읽고 같은 결과를 이동·조사 UI에 전달한다.
4. 모달/수동 pause/새 게임 경로에 `setEnabled`와 목표 취소를 함께 연결한다.
5. 커스텀 터치 UI는 pointer별 `setVirtualInput`으로 교체한다. UI 단축키는 앱에서 유지한다.
6. 짧은 조사 키, 복수 이동 키, 열린 모달에서 keyup, held gamepad, capture 취소,
   blur/visibility, destroy/recreate를 검사한다.

`pnpm smoke:input-context`는 실제 pack 결과의 `/core`만 import하여 Chromium에서
1280×720/390×844, DPR 1/2로 키·포인터·native dialog·Shadow DOM 입력칸·수명주기를 검증한다.
게임패드는 브라우저의 `getGamepads` 대역이며 실제 기기 검증을 대신하지 않는다.
