export const spriteCopy = {
  title: { ko: "스프라이트 그리기", en: "Drawing a Sprite" },
  summary: {
    ko: "이미지 한 장의 위치·회전·크기·색·투명도를 바꿔 그립니다.",
    en: "Draw an image and change its position, rotation, scale, tint, and opacity.",
  },
  observe: [
    {
      ko: "흐린 로봇이 처음 자리입니다. 바꾼 값은 이 자리와 비교해 보세요.",
      en: "The faded robot marks the starting position. Use it to compare your changes.",
    },
    {
      ko: "회전과 크기는 기준점을 중심으로 바뀝니다. 기준점을 발밑으로 바꾸면 발을 축으로 돕니다.",
      en: "Rotation and scaling use the same pivot. Move it to the feet to rotate the robot around that point.",
    },
    {
      ko: "값을 바꿔도 텍스처는 다시 읽지 않습니다. 상태 막대의 텍스처 수가 그대로입니다.",
      en: "The textures stay loaded as you change settings. Watch the texture count in the status bar.",
    },
  ],
  about: {
    useCase: {
      ko: "캐릭터·아이템·배경처럼 그림 한 장을 화면에 놓을 때",
      en: "Place a single image on screen, such as a character, item, or background.",
    },
    steps: [
      { ko: "위치와 회전을 바꾸거나, 실행 화면에서 로봇을 끌어 옮기세요.", en: "Adjust position and rotation, or drag the robot in the live view." },
      { ko: "크기를 키운 채 기준점을 발밑으로 바꾸고 다시 회전해 보세요.", en: "Scale the robot up, set the pivot to its feet, and rotate it again." },
      { ko: "색과 투명도를 바꿔 뒤의 판이 비치는지 보세요.", en: "Adjust tint and opacity to see the panel behind the robot." },
    ],
    reading: {
      ko: "주황 십자가 기준점입니다. 위치는 기준점의 좌표이고, 회전과 크기도 이 점을 중심으로 적용됩니다. 월드는 640 × 384이고 y는 아래로 커집니다. "
        + "상태 막대의 그리기 명령 11개는 배경판 9조각(9-slice)과 로봇 둘이고, 같은 텍스처끼리 묶여 드로우 콜은 2번입니다.",
      en: "The orange cross marks the pivot. Position gives its coordinates, and rotation and scale are applied around it. The world is 640 × 384 and y increases downward. "
        + "The status bar shows 11 draw commands for the nine slices of the background panel and the two robots. Batching by texture reduces them to two draw calls.",
    },
  },
  api: [
    { name: "createRenderer", text: {
      ko: "WebGL2 또는 WebGPU 렌더러를 만듭니다. 고른 백엔드를 못 쓰면 다른 쪽으로 바꿉니다.",
      en: "Creates a WebGL2 or WebGPU renderer and falls back when the selected backend is unavailable.",
    } },
    { name: "AssetLoader.loadAssets", text: {
      ko: "로봇 시트와 배경판 텍스처를 한 번 읽어 둡니다.",
      en: "Loads the robot sprite sheet and background panel texture once.",
    } },
    { name: "createFerrumRuntime({ dataScene })", text: {
      ko: "씬 문서로 엔진을 시작합니다. 그리기와 정렬은 Rust 엔진이 맡습니다.",
      en: "Starts the engine from a scene document. The Rust engine sorts sprites and generates draw commands.",
    } },
    { name: "createDataSceneView", text: {
      ko: "월드 640 × 384를 캔버스에 맞추고, 포인터 좌표를 월드 좌표로 바꿉니다.",
      en: "Fits the 640 × 384 world to the canvas and converts pointer positions to world coordinates.",
    } },
    { name: "runtime.dataScene.reapply", text: {
      ko: "바꾼 씬 문서를 다시 적용합니다. 이 예제는 설정을 바꿀 때만 부릅니다.",
      en: "Applies the edited scene document whenever a setting changes.",
    } },
  ],
};

export const spriteControls = {
  x: { ko: "위치 X", en: "Position X" },
  y: { ko: "위치 Y", en: "Position Y" },
  rotation: { ko: "회전", en: "Rotation" },
  scale: { ko: "크기", en: "Scale" },
  pivot: { ko: "기준점", en: "Pivot" },
  center: { ko: "가운데", en: "Center" },
  feet: { ko: "발밑", en: "Feet" },
  tint: { ko: "색", en: "Tint" },
  original: { ko: "원본", en: "Original" },
  red: { ko: "빨강", en: "Red" },
  orange: { ko: "주황", en: "Orange" },
  green: { ko: "초록", en: "Green" },
  blue: { ko: "파랑", en: "Blue" },
  opacity: { ko: "불투명도", en: "Opacity" },
  ghost: { ko: "처음 자리", en: "Start Position" },
  dragHint: { ko: "실행 화면에서 로봇을 끌어 옮길 수 있습니다.", en: "Drag the robot in the live view to move it." },
};
