// Static example gallery for the Pages root. Every card and link works without JavaScript;
// gallery.mjs only adds group filtering and search. The data comes from the shared catalogs,
// so the gallery never keeps a second example list.

// Topic icons and engine-domain colors come from featureTopics.json (shared with the lab navigation).
const RECIPE_URL = "https://github.com/silbaram/ferrum2d/tree/main/examples/data-scene-native";
const REPOSITORY_URL = "https://github.com/silbaram/ferrum2d";

const escapeHtml = value => String(value ?? "").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

/** Render the gallery page. `thumbnail(name)` returns the card image URL for a thumbnail file name. */
export function renderExampleGallery({ catalog, features, topics, physics, icons, thumbnail }) {
  const icon = (name, className = "icon") => {
    const body = icons[name];
    if (!body) throw Error(`Missing gallery icon ${name}`);
    return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  };
  const topicOf = id => topics.find(topic => topic.id === id);
  const dot = id => `<span class="dot" data-domain="${topicOf(id).domain}"></span>`;
  const games = catalog.filter(item => item.kind === "game");
  const tools = catalog.filter(item => item.kind === "tool");
  const featureLab = catalog.find(item => item.id === "starter-runtime");
  const physicsLab = catalog.find(item => item.id === "physics-sandbox");
  const featuresOf = topic => features.filter(item => item.topic === topic);
  const toolCount = tools.length + 1;
  const total = games.length + features.length + physics.length + toolCount;
  const search = (...parts) => escapeHtml(parts.flat().filter(Boolean).join(" "));

  const card = ({ href, thumb, title, body, meta = "", searchText, badge = "", external = false, group }) =>
    `<a class="card" href="${escapeHtml(href)}" data-gallery-card data-group="${group}" data-search="${searchText}"${external ? ' target="_blank" rel="noreferrer"' : ""}>
      <span class="thumb">${thumb}${badge}</span>
      <span class="card-body"><span class="card-title">${escapeHtml(title)}</span>${body}${meta ? `<span class="card-meta">${meta}</span>` : ""}</span></a>`;
  const image = name => `<img src="${escapeHtml(thumbnail(name))}" alt="" width="640" height="400" decoding="async">`;
  const chip = text => `<span class="chip">${escapeHtml(text)}</span>`;

  const gameCards = games.map(item => {
    const [name, learn] = item.title.split(" · ");
    return card({ href: `./${item.path}`, thumb: image(`game-${item.id}.jpg`), title: name, group: "games",
      body: `${learn ? `<span class="badge learn">배우는 기능 · ${escapeHtml(learn)}</span>` : ""}<span class="card-use">${escapeHtml(item.summary)}</span>`,
      searchText: search(item.title, item.summary, item.observe) });
  }).join("");

  const topicSections = topics.map(topic => {
    const cards = featuresOf(topic.id).map(item => card({
      href: `./${featureLab.path}?feature=${item.id}`, thumb: image(`feature-${item.id}.jpg`), title: item.title, group: `topic:${topic.id}`,
      body: `<span class="card-use">${escapeHtml(item.lesson.useCase)}</span>`,
      meta: `<span class="chip">${dot(topic.id)}${escapeHtml(topic.title)}</span>${item.tags.map(chip).join("")}`,
      searchText: search(item.title, item.summary, item.lesson.useCase, item.api, topic.title, item.tags),
    })).join("");
    return `<div class="topic" id="topic-${topic.id}" data-gallery-section="topic:${topic.id}">
      <h3 class="topic-head">${dot(topic.id)}${icon(topic.icon)}<span>${escapeHtml(topic.title)}</span><small>${escapeHtml(topic.summary)}</small></h3>
      <div class="grid">${cards}</div></div>`;
  }).join("");

  const physicsCards = physics.map(item => card({
    href: `./${physicsLab.path}?demo=${item.id}`, thumb: image(`physics-${item.id}.jpg`), title: item.title, group: "physics",
    body: `<span class="card-use">${escapeHtml(item.summary)}</span>`,
    badge: item.knownIssue ? `<span class="badge issue" title="${escapeHtml(item.knownIssue)}">${icon("triangle-alert", "icon small")}알려진 문제</span>` : "",
    meta: item.knownIssue ? `<span class="issue-note">${escapeHtml(item.knownIssue)}</span>` : "",
    searchText: search(item.title, item.summary, item.knownIssue, "물리"),
  })).join("");

  const toolCards = tools.map(item => card({ href: `./${item.path}`, thumb: image(`${item.kind}-${item.id}.jpg`), title: item.title, group: "tools",
    body: `<span class="card-use">${escapeHtml(item.summary)}</span>`, searchText: search(item.title, item.summary) })).join("")
    + card({ href: RECIPE_URL, external: true, group: "tools", title: "코드 레시피 · Data Scene",
      thumb: `<span class="code-thumb"><span><b>import</b> { createEngine } <b>from</b> <i>"@ferrum2d/ferrum-web"</i>;</span><span class="comment">// spatial.mjs · moving-platforms.mjs</span></span>`,
      body: `<span class="card-use">HD-2D 공간, 이동 발판, 화면 표현을 코드만으로 구성하는 예제 파일입니다.</span>`,
      meta: `<span class="chip">${icon("file-code", "icon small")}GitHub</span>`, searchText: search("코드 레시피 Data Scene data-scene-native spatial moving-platforms") });

  const navItem = (group, label, count, lead, sub = false) =>
    `<a class="side-item${sub ? " sub" : ""}" href="#${group === "all" ? "examples" : group.startsWith("topic:") ? `topic-${group.slice(6)}` : group}" data-gallery-filter="${group}"${group === "all" ? ' aria-current="true"' : ""}>${lead}<span class="label">${escapeHtml(label)}</span><span class="count">${count}</span></a>`;
  const nav = navItem("all", "전체", total, icon("layout-grid"))
    + navItem("games", "게임 데모", games.length, icon("gamepad-2"))
    + navItem("features", "기능 실험", features.length, icon("flask-conical"))
    + topics.map(topic => navItem(`topic:${topic.id}`, topic.title, featuresOf(topic.id).length, dot(topic.id), true)).join("")
    + navItem("physics", "물리 심화 실험실", physics.length, icon("atom"))
    + navItem("tools", "도구·코드 레시피", toolCount, icon("wrench"));

  const section = (id, iconName, title, count, description, body, gridClass = "grid") =>
    `<section class="group" id="${id}" data-gallery-section="${id}" aria-labelledby="${id}-title">
      <div class="group-head">${icon(iconName)}<h2 id="${id}-title">${escapeHtml(title)}</h2><span class="count">${count}</span><p>${description}</p></div>
      ${gridClass ? `<div class="${gridClass}">${body}</div>` : body}</section>`;

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Ferrum2D 엔진의 게임 데모와 기능 실험 ${total}개를 실제 화면과 함께 둘러봅니다." />
  <title>Ferrum2D 예제</title>
  <link rel="stylesheet" href="./gallery/gallery.css" />
  <script type="module" src="./gallery/gallery.mjs"></script>
</head>
<body>
<header class="topbar">
  <a class="brand" href="./"><strong>Ferrum2D</strong><span>예제</span></a>
  <nav class="topnav" aria-label="사이트"><a href="./" aria-current="page">예제</a><a href="./docs/">문서</a><a href="${REPOSITORY_URL}" target="_blank" rel="noreferrer">GitHub</a></nav>
  <label class="search" data-gallery-search hidden>${icon("search")}<input type="search" placeholder="예제 검색 · 이름·용도·API" aria-label="예제 검색" /><kbd>/</kbd></label>
</header>
<div class="shell" data-example-gallery>
  <nav class="sidebar" aria-label="예제 분류"><div class="side-label">탐색</div>${nav}</nav>
  <main class="content" id="examples">
    <section class="intro">
      <div><h1>예제</h1><p>엔진 기능을 하나씩 바꿔 보며 배우는 실험과, 여러 기능을 엮은 게임 데모입니다. 카드마다 어떤 때 쓰는 기능인지 적었습니다.</p></div>
      <dl class="stats"><div><dt>게임 데모</dt><dd>${games.length}</dd></div><div><dt>기능 실험</dt><dd>${features.length}</dd></div><div><dt>물리 시나리오</dt><dd>${physics.length}</dd></div><div><dt>주제</dt><dd>${topics.length}</dd></div></dl>
    </section>
    <p class="result" data-gallery-result role="status" aria-live="polite" hidden></p>
    ${section("games", "gamepad-2", "게임 데모", games.length, "여러 기능을 엮어 실제 게임 흐름으로 보여줍니다.", gameCards, "grid wide")}
    ${section("features", "flask-conical", "기능 실험", features.length, `한 번에 한 기능만 바꿔 화면과 엔진 상태를 비교합니다. <a href="./${featureLab.path}">실험실 열기</a>`, topicSections, "")}
    ${section("physics", "atom", "물리 심화 실험실", physics.length, `${escapeHtml(physicsLab.summary)} <a href="./${physicsLab.path}">실험실 열기</a>`, physicsCards)}
    ${section("tools", "wrench", "도구·코드 레시피", toolCount, "편집 도구와, 화면 없이 읽는 코드 예제입니다.", toolCards, "grid wide")}
    <p class="empty" data-gallery-empty hidden>검색 결과가 없습니다. 검색어를 지우거나 전체를 선택하세요.</p>
  </main>
</div>
<footer class="footer"><span>Ferrum2D 예제 ${total}개</span><a href="./docs/">문서</a><a href="./gallery/LICENSE-lucide.txt">아이콘 라이선스</a></footer>
</body>
</html>
`;
}
