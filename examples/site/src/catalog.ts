/** Groups of the example list, in order. */
export const groups = [
  { id: "games", title: "게임 데모", icon: "gamepad-2" },
  { id: "features", title: "기능 실험", icon: "flask-conical" },
  { id: "physics", title: "물리", icon: "atom" },
  { id: "tools", title: "도구", icon: "wrench" },
] as const;

export type GroupId = (typeof groups)[number]["id"];

/** An example that runs inside the site, opened with `?example=<id>`. Examples are added one at a time
 * (docs/planning/example-site-rebuild-plan.md); the list starts empty. */
export interface SiteExample {
  id: string;
  group: Exclude<GroupId, "tools">;
  title: string;
  /** One sentence: what this example shows. */
  summary: string;
}

export const examples: readonly SiteExample[] = [];

/** Tools are their own apps or pages, so the list links to them instead of running them here. They open in a
 * new window to keep the example site where it was. */
export interface SiteLink {
  id: string;
  title: string;
  summary: string;
  href: string;
  thumbnail?: string;
}

export const tools: readonly SiteLink[] = [
  { id: "studio", title: "Ferrum2D Studio", summary: "씬과 에셋을 만들고 오브젝트를 배치하는 제작 도구입니다.", href: "studio/", thumbnail: "thumbs/tool-studio.jpg" },
  { id: "recipes", title: "코드 레시피 · Data Scene", summary: "HD-2D 공간, 이동 발판, 화면 표현을 코드만으로 구성하는 예제 파일입니다.",
    href: "https://github.com/silbaram/ferrum2d/tree/main/examples/data-scene-native" },
];

const REPOSITORY = "https://github.com/silbaram/ferrum2d";
export const links = {
  repository: REPOSITORY,
  docs: "docs/",
  /** The last published state of the previous examples (PR #112). */
  previousExamples: `${REPOSITORY}/tree/845cc29eaa9f6bde0ac2ab493965647f0eef99db/examples`,
};
