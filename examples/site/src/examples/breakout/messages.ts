export const breakoutCopy = {
  title: { ko: "벽돌 깨기", en: "Breakout" },
  summary: {
    ko: "패들로 공을 받아 벽돌을 깨는 작은 게임입니다. 반사는 엔진이, 점수와 규칙은 예제 코드가 맡습니다.",
    en: "Bounce the ball off the paddle to clear the bricks. The engine handles the bounces; the example code keeps score and enforces the rules.",
  },
  observe: [
    {
      ko: "공이 벽과 벽돌에서 튕기는 것은 엔진의 물리입니다. 예제는 공의 빠르기만 일정하게 맞춥니다.",
      en: "The engine's physics bounces the ball off walls and bricks. The example only keeps its speed constant.",
    },
    {
      ko: "패들의 가운데에 맞으면 위로, 끝에 맞을수록 비스듬히 날아갑니다. 이 각도는 예제 코드가 정합니다.",
      en: "A hit near the paddle's center sends the ball straight up; hits toward the ends send it at an angle. The example code sets this angle.",
    },
    {
      ko: "벽돌이 사라지는 순간 '이벤트' 탭에 충돌 한 줄이 생기고 점수가 오릅니다.",
      en: "Each time a brick disappears, a collision line appears in the Events tab and the score increases.",
    },
  ],
  about: {
    useCase: {
      ko: "물리와 충돌 이벤트 위에 점수·목숨·승패 같은 게임 규칙을 얹을 때",
      en: "Build game rules such as score, lives, winning, and losing on top of physics and collision events.",
    },
    steps: [
      { ko: "실행 화면을 누르거나 Space로 공을 발사하고, 마우스나 방향키·A/D로 패들을 움직이세요.", en: "Click the live view or press Space to launch the ball, then move the paddle with the mouse, the arrow keys, or A/D." },
      { ko: "'이벤트' 탭을 열고 벽돌·패들·놓침 줄이 언제 생기는지 보세요.", en: "Open the Events tab and watch when brick, paddle, and miss lines appear." },
      { ko: "공 속도를 올리거나 '표시'에서 충돌 모양을 켜고, 재생 막대의 일시정지로 멈춰 보세요.", en: "Raise the ball speed or turn on collision shapes under Show, then pause the game from the play bar." },
    ],
    reading: {
      ko: "패들은 kinematic body라 속도로 움직이고 양옆 벽에서 엔진이 멈춥니다. 공은 dynamic body(중력 0, 튕김 1, 마찰 0)입니다. "
        + "벽돌을 지우는 일, 점수, 목숨은 예제 코드가 엔진의 접촉 시작 이벤트를 받아 처리합니다. 아래의 빨간 선은 놓침을 알리는 트리거입니다. "
        + "일시정지는 씬의 물리만 멈추고 그리기는 계속하므로, 멈춘 채 충돌 모양을 켜 볼 수 있습니다.",
      en: "The paddle is a kinematic body. It moves by velocity, and the engine stops it at the side walls. The ball is a dynamic body with no gravity, full bounce, and no friction. "
        + "The example code removes bricks and tracks score and lives in response to the engine's contact-begin events. The red line at the bottom is a trigger that reports a miss. "
        + "Pausing stops only the scene's physics. Drawing continues, so you can turn on collision shapes while paused.",
    },
  },
  api: [
    { name: "components.body · dynamic", text: {
      ko: "공의 질량·중력 배율·튕김·마찰을 씬 문서에 적습니다. 반사는 엔진의 물리 단계가 계산합니다.",
      en: "Sets the ball's mass, gravity scale, bounce, and friction in the scene document. The engine's physics step calculates the bounces.",
    } },
    { name: "frame.collisionEvents", text: {
      ko: "공과 벽돌·패들의 접촉 시작, 놓침 선의 트리거 들어감을 받아 게임 규칙을 실행합니다.",
      en: "Runs the game rules from contact-begin events for the ball with bricks and the paddle, and from the miss line's trigger-enter event.",
    } },
    { name: "engine.despawnPhysicsEntity", text: {
      ko: "맞은 벽돌을 그림과 충돌체째 지웁니다.",
      en: "Removes a hit brick, including its sprite and collider.",
    } },
    { name: "engine.setPhysicsBodyVelocity", text: {
      ko: "패들을 움직이고, 발사·패들 반사 때 공의 방향을 정하며, 매 프레임 공 빠르기를 맞춥니다.",
      en: "Moves the paddle, sets the ball's direction on launch and when it bounces off the paddle, and keeps its speed constant every frame.",
    } },
    { name: "runtime.dataScene.pause · resume", text: {
      ko: "재생 막대의 일시정지입니다. 씬 시뮬레이션만 멈춥니다.",
      en: "Pauses and resumes from the play bar. Only the scene simulation stops.",
    } },
  ],
};

export const breakoutControls = {
  speed: { ko: "공 속도", en: "Ball Speed" },
  paddle: { ko: "패들 너비", en: "Paddle Width" },
  narrow: { ko: "좁게", en: "Narrow" },
  normal: { ko: "보통", en: "Normal" },
  wide: { ko: "넓게", en: "Wide" },
  rows: { ko: "벽돌 줄", en: "Brick Rows" },
  rowCount: (count: number) => ({ ko: `${count}줄`, en: String(count) }),
  finalScore: (score: number) => ({ ko: `점수 ${score}`, en: `Score ${score}` }),
  hint: {
    ko: "마우스·방향키·A/D로 패들을, 클릭이나 Space로 발사합니다. 패들 너비와 벽돌 줄을 바꾸면 새 판을 시작합니다.",
    en: "Move the paddle with the mouse, the arrow keys, or A/D, and launch with a click or Space. Changing the paddle width or brick rows starts a new game.",
  },
  colliders: { ko: "충돌 모양", en: "Collision Shapes" },
  contacts: { ko: "접촉", en: "Contacts" },
  score: { ko: "점수", en: "Score" },
  lives: { ko: "목숨", en: "Lives" },
  bricks: { ko: "벽돌", en: "Bricks" },
  messages: {
    ready: { ko: "클릭하거나 Space를 눌러 발사", en: "Click or press Space to launch" },
    paused: { ko: "일시정지", en: "Paused" },
    won: { ko: "모두 깼습니다! 클릭해서 새 판", en: "All clear! Click for a new game" },
    lost: { ko: "게임 오버. 클릭해서 새 판", en: "Game over. Click for a new game" },
  },
  events: {
    brick: { ko: "벽돌 깨짐", en: "Brick broken" },
    paddle: { ko: "패들 반사", en: "Paddle bounce" },
    miss: { ko: "놓침", en: "Missed" },
    launch: { ko: "발사", en: "Launch" },
    won: { ko: "클리어", en: "Clear" },
    lost: { ko: "게임 오버", en: "Game over" },
  },
};
