export const collisionCopy = {
  title: { ko: "충돌과 트리거", en: "Collisions and Triggers" },
  summary: {
    ko: "단단한 벽은 막고, 트리거는 통과하며 들어감·나감을 알립니다.",
    en: "Solid walls block the robot; triggers let it through and report when it enters and leaves.",
  },
  observe: [
    {
      ko: "벽에 비스듬히 부딪히면 로봇이 멈추지 않고 벽을 따라 미끄러집니다.",
      en: "Move into a wall at an angle: the robot slides along it instead of stopping.",
    },
    {
      ko: "에너지와 빨간 구역은 트리거입니다. 막지 않고, 들어가고 나갈 때 '이벤트' 탭에 한 줄씩 남습니다.",
      en: "The energy cells and the red zone are triggers. They don't block; each entry and exit adds a line to the Events tab.",
    },
    {
      ko: "안쪽 벽을 트리거로 바꾸면 같은 자리를 지나가며 이벤트만 납니다.",
      en: "Switch the inner walls to triggers and the robot passes through them, reporting events instead.",
    },
  ],
  about: {
    useCase: {
      ko: "벽·바닥처럼 막는 물체와, 아이템·문턱·위험 지역처럼 닿았는지만 알면 되는 영역을 나눌 때",
      en: "Separate things that block, such as walls and floors, from areas you only need to detect, such as items, doorways, or hazards.",
    },
    steps: [
      { ko: "방향키나 WASD로, 또는 실행 화면을 누른 채로 로봇을 움직여 벽에 비스듬히 부딪혀 보세요.", en: "Move the robot with the arrow keys or WASD, or hold the pointer on the live view, and push into a wall at an angle." },
      { ko: "아래 '이벤트' 탭을 열고 에너지를 먹거나 빨간 구역을 드나들어 보세요.", en: "Open the Events tab below, then collect an energy cell or walk in and out of the red zone." },
      { ko: "안쪽 벽을 트리거로 바꾸고 같은 벽을 다시 지나가 보세요.", en: "Switch the inner walls to triggers and walk through them again." },
    ],
    reading: {
      ko: "'표시'의 충돌 모양은 엔진이 실제로 검사하는 모양입니다. 그림과 크기가 달라도 이 선을 기준으로 막히고 겹칩니다. "
        + "파랑은 고정된 벽, 보라는 로봇(kinematic), 주황은 트리거, 빨강은 접촉입니다. "
        + "예제는 로봇에 속도만 주고, 벽에 막혀 미끄러지는 것과 에너지 수집·제거는 엔진이 합니다. "
        + "상태 막대의 접촉과 트리거는 시작·끝 이벤트로 센, 지금 맞닿은 쌍과 겹친 쌍의 수입니다.",
      en: "Collision shapes under Show are the shapes the engine actually tests. Blocking and overlaps follow these lines, even where the picture is a different size. "
        + "Blue marks fixed walls, purple the kinematic robot, orange triggers, and red contacts. "
        + "The example only gives the robot a velocity. The engine stops it at walls, slides it along them, and collects and removes the energy cells. "
        + "In the status bar, Contacts and Triggers count the pairs touching or overlapping now, kept from the begin and end events.",
    },
  },
  api: [
    { name: "components.collider · isTrigger", text: {
      ko: "물체의 충돌 모양(사각형·원)과 막을지(false) 겹침만 알릴지(true)를 씬 문서에 적습니다.",
      en: "Sets each object's collision shape (box or circle) in the scene document, and whether it blocks (false) or only reports overlaps (true).",
    } },
    { name: "components.body", text: {
      ko: "벽은 static, 로봇은 kinematic body입니다. 엔진의 물리 단계가 로봇을 움직이고 벽에서 멈춥니다.",
      en: "Walls are static bodies and the robot is kinematic. The engine's physics step moves the robot and stops it at walls.",
    } },
    { name: "engine.setPhysicsBodyVelocity", text: {
      ko: "입력에 따라 매 프레임 로봇의 속도를 정합니다. 위치를 직접 옮기지 않습니다.",
      en: "Sets the robot's velocity from input every frame, without moving it directly.",
    } },
    { name: "frame.collisionEvents", text: {
      ko: "접촉·트리거의 시작과 끝 이벤트입니다(`includeCollisionEvents`). 이 예제는 머무는 동안의 이벤트는 기록하지 않습니다.",
      en: "Begin and end events for contacts and triggers (`includeCollisionEvents`). This example doesn't log the stay events.",
    } },
    { name: "collisionPickup · pickup", text: {
      ko: "동작 레시피입니다. 로봇이 에너지에 닿으면 엔진이 수집 이벤트를 내고 에너지를 지웁니다.",
      en: "Behavior recipes: when the robot touches an energy cell, the engine reports a pickup and removes the cell.",
    } },
    { name: "engine.configureDataSceneMovementAnimation", text: {
      ko: "로봇이 실제로 움직였는지에 따라 엔진이 걷기·서기 그림을 고릅니다. 벽에 막혀 멈추면 서 있는 그림이 됩니다.",
      en: "The engine picks the walk or idle frames from whether the robot actually moved. Blocked by a wall, it stands still.",
    } },
    { name: "engine.setPhysicsDebugOptions", text: {
      ko: "'표시' 메뉴에서 엔진이 그리는 충돌 모양과 접촉 선을 켜고 끕니다.",
      en: "Turns the engine's collision-shape and contact lines on and off from the Show menu.",
    } },
  ],
};

export const collisionControls = {
  speed: { ko: "속도", en: "Speed" },
  shape: { ko: "로봇 모양", en: "Robot Shape" },
  box: { ko: "사각형", en: "Box" },
  circle: { ko: "원", en: "Circle" },
  inner: { ko: "안쪽 벽", en: "Inner Walls" },
  solid: { ko: "단단함", en: "Solid" },
  trigger: { ko: "트리거", en: "Trigger" },
  moveHint: {
    ko: "방향키·WASD로 움직이거나, 실행 화면을 누르고 있으면 그쪽으로 갑니다.",
    en: "Move with the arrow keys or WASD, or hold the pointer on the live view to head there.",
  },
  colliders: { ko: "충돌 모양", en: "Collision Shapes" },
  contacts: { ko: "접촉", en: "Contacts" },
  contactCount: { ko: "접촉", en: "Contacts" },
  triggerCount: { ko: "트리거", en: "Triggers" },
  energy: { ko: "에너지", en: "Energy" },
  events: {
    enter: { ko: "접촉 시작", en: "Contact begin" },
    exit: { ko: "접촉 끝", en: "Contact end" },
    hit: { ko: "부딪힘", en: "Hit" },
    triggerEnter: { ko: "트리거 들어감", en: "Trigger enter" },
    triggerExit: { ko: "트리거 나감", en: "Trigger exit" },
    pickup: { ko: "에너지 수집", en: "Energy collected" },
  },
};
