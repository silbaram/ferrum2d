import type { ExampleStart } from "./example";
import { spriteCopy } from "./examples/sprite/messages";
import type { LocalizedText } from "./locale";

/** Groups of the example list, in order: the essential features, then games and tools
 * (docs/planning/example-site-rebuild-plan.md, "예제 목록"). */
export const groups = [
  { id: "drawing", title: { ko: "그리기", en: "Rendering" }, icon: "image" },
  { id: "motion", title: { ko: "움직임과 화면", en: "Movement & View" }, icon: "move" },
  { id: "physics", title: { ko: "충돌과 물리", en: "Collision & Physics" }, icon: "atom" },
  { id: "effects", title: { ko: "효과와 소리", en: "Effects & Audio" }, icon: "sparkles" },
  { id: "systems", title: { ko: "게임 구성", en: "Game Systems" }, icon: "puzzle" },
  { id: "games", title: { ko: "게임 데모", en: "Game Demos" }, icon: "gamepad-2" },
  { id: "tools", title: { ko: "도구", en: "Tools" }, icon: "wrench" },
] as const;

export type GroupId = (typeof groups)[number]["id"];

/** An example that runs inside the site, opened with `?example=<id>`. Everything here is data the frame
 * shows; the module behind `load` runs the engine. */
export interface SiteExample {
  id: string;
  group: Exclude<GroupId, "tools">;
  title: LocalizedText;
  /** One sentence: what this example shows. */
  summary: LocalizedText;
  thumbnail?: string;
  /** The world the canvas shows; the frame keeps this aspect ratio. */
  world: { width: number; height: number };
  /** "볼 것": two or three short sentences. */
  observe: readonly LocalizedText[];
  /** The "설명" tab. */
  about: { useCase: LocalizedText; steps: readonly LocalizedText[]; reading: LocalizedText };
  /** The "API" tab: the calls this example makes. */
  api: readonly { name: string; text: LocalizedText }[];
  /** Repository paths of this example's files. */
  sources: readonly string[];
  load(): Promise<ExampleStart>;
  /** The main source file, shown in the "소스" tab. */
  code(): Promise<string>;
}

export const examples: readonly SiteExample[] = [
  {
    id: "sprite",
    group: "drawing",
    ...spriteCopy,
    // Captured from this example at 402 × 241 (rotation −18°, scale 1.6, blue).
    thumbnail: "thumbs/example-sprite.jpg",
    world: { width: 640, height: 384 },
    sources: [
      "examples/site/src/examples/sprite/index.ts",
      "examples/site/src/examples/sprite/scene.json",
      "examples/site/src/examples/sprite/messages.ts",
    ],
    load: () => import("./examples/sprite/index").then(module => module.default),
    code: () => import("./examples/sprite/index.ts?raw").then(module => module.default),
  },
];

/** Tools are their own apps or pages, so the list links to them instead of running them here. They open in a
 * new window to keep the example site where it was. */
export interface SiteLink {
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  href: string;
  thumbnail?: string;
}

export const tools: readonly SiteLink[] = [
  { id: "studio", title: { ko: "Ferrum2D Studio", en: "Ferrum2D Studio" }, summary: {
    ko: "씬과 에셋을 만들고 오브젝트를 배치하는 제작 도구입니다.", en: "Create scenes and assets and place objects.",
  }, href: "studio/", thumbnail: "thumbs/tool-studio.jpg" },
  { id: "recipes", title: { ko: "코드 레시피 · Data Scene", en: "Code Recipes · Data Scene" }, summary: {
    ko: "HD-2D 공간, 이동 발판, 화면 표현을 코드만으로 구성하는 예제 파일입니다.",
    en: "Browse code examples for HD-2D scenes, moving platforms, and rendering.",
  },
    href: "https://github.com/silbaram/ferrum2d/tree/main/examples/data-scene-native" },
];

const REPOSITORY = "https://github.com/silbaram/ferrum2d";
export const links = {
  repository: REPOSITORY,
  /** Source files on the default branch. */
  source: (path: string) => `${REPOSITORY}/blob/main/${path}`,
  /** The last published state of the previous examples (PR #112). */
  previousExamples: `${REPOSITORY}/tree/845cc29eaa9f6bde0ac2ab493965647f0eef99db/examples`,
};
