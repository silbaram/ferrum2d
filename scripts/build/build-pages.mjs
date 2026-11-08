import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { githubHeadingId, stripInlineMarkdown } from "../lib/markdown-heading-ids.mjs";
import { loadExampleCatalog } from "../validate/check-example-catalog.mjs";

const outputDir = "dist-pages";
const docsSourceDir = "docs";
const docsOutputDir = path.join(outputDir, "docs");
const featureExamples = JSON.parse(readFileSync("examples/shared/featureCatalog.json", "utf8"));
const examples = loadExampleCatalog().filter(item => item.kind !== "reference");
const gettingStartedDocs = new Set([
  "README.md",
  "engine/ai-agent-install.md",
  "engine/ai-feature-guide.md",
  "engine/showcase-hub.md",
  "engine/developer-quickstart.md",
  "engine/user-guide.md",
]);
const documentationGroups = [
  { title: "시작하기", titleEn: "Getting started", matches: (file) => gettingStartedDocs.has(file) },
  { title: "공개 API", titleEn: "Public API", matches: (file) => file === "engine/public-api.md" || file.startsWith("engine/public-api/") },
  { title: "게임 제작", titleEn: "Making games", matches: (file) => file.startsWith("engine/") },
  { title: "공식 예제", titleEn: "Examples", matches: (file) => file.startsWith("examples/") },
  { title: "엔진 개발·검증", titleEn: "Engine development and quality", matches: (file) => file.startsWith("development/architecture/") || file.startsWith("development/quality/") },
  { title: "배포·운영", titleEn: "Deployment and operations", matches: (file) => file.startsWith("development/operations/") },
  { title: "개발 계획·후보", titleEn: "Plans and proposals", matches: (file) => file.startsWith("planning/") },
  { title: "기타 문서", titleEn: "Other documents", matches: () => true },
];

// Validate every example before replacing the last successful local preview.
const exampleBuilds = examples.map(example => {
  const source = example.source;
  const entry = path.join(source, "index.html");
  if (!existsSync(entry)) throw new Error(`Missing ${entry}. Run pnpm build before pnpm build:pages.`);
  const html = readFileSync(entry, "utf8");
  if (!/<head(?:\s[^>]*)?>/iu.test(html)) throw new Error(`Missing head in ${entry}. Rebuild the example before pnpm build:pages.`);
  return { example, source, html };
});

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, ".nojekyll"), "");
cpSync("apps/placement-viewer/public/fonts", path.join(outputDir, "fonts"), { recursive: true });
cpSync("apps/placement-viewer/src/fonts/NotoSansKR-UI.woff2", path.join(outputDir, "fonts/NotoSansKR-UI.woff2"));
writeFileSync(path.join(outputDir, "exampleTheme.css"), readFileSync("examples/shared/exampleTheme.css", "utf8").replace(/^@import[^;]+;\s*/u, ""));
for (const file of ["exampleHub.css", "exampleHub.mjs"]) cpSync(`examples/shared/${file}`, path.join(outputDir, file));

for (const { example, source, html } of exampleBuilds) {
  cpSync(source, path.join(outputDir, example.id), { recursive: true });
  const entry = path.join(outputDir, example.id, "index.html");
  writeFileSync(entry, html.replace(/<head(?:\s[^>]*)?>/iu,
    head => `${head}\n    <meta name="ferrum-example-suite" content="1" />`));
}

buildDocsSite();
writeFileSync(path.join(outputDir, "index.html"), pageHtml(examples));

function buildDocsSite() {
  const markdownFiles = collectFiles(docsSourceDir)
    .filter((filePath) => filePath.endsWith(".md"))
    .map((filePath) => toPosix(path.relative(docsSourceDir, filePath)))
    .sort(compareDocs);
  const docPages = markdownFiles.map((sourceRelativePath) => {
    const source = readFileSync(path.join(docsSourceDir, sourceRelativePath), "utf8");
    return {
      sourceRelativePath,
      language: sourceRelativePath.startsWith("en/") ? "en" : "ko",
      outputRelativePath: outputPathForMarkdown(sourceRelativePath),
      title: firstHeading(source),
      source,
    };
  });

  for (const filePath of collectFiles(docsSourceDir)) {
    if (filePath.endsWith(".md")) {
      continue;
    }
    const relativePath = toPosix(path.relative(docsSourceDir, filePath));
    const target = path.join(docsOutputDir, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(filePath, target);
  }

  for (const page of docPages) {
    const target = path.join(docsOutputDir, page.outputRelativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, docPageHtml(page, docPages));
  }
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    const entryStat = statSync(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...collectFiles(entryPath));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function compareDocs(a, b) {
  const priority = [
    "README.md",
    "engine/ai-agent-install.md",
    "engine/ai-feature-guide.md",
    "engine/showcase-hub.md",
    "engine/developer-quickstart.md",
    "engine/user-guide.md",
    "engine/public-api.md",
    "engine/public-api/core.md",
    "engine/public-api/authoring.md",
    "engine/public-api/starter-scenes.md",
    "engine/public-api/labs.md",
    "engine/public-api/quality.md",
    "engine/public-api/migration-guide.md",
    "engine/runtime-extensibility.md",
    "engine/data-scene-authoring.md",
    "engine/data-scene-native-runtime.md",
    "engine/data-scene-presentation.md",
    "engine/data-scene-spatial.md",
    "engine/input-actions.md",
    "engine/coordinate-system.md",
    "engine/physics-spec.md",
    "examples/topdown-shooter/game-spec.md",
    "development/architecture/architecture.md",
    "development/architecture/physics-engine.md",
    "development/quality/smoke-check.md",
    "development/quality/code-review.md",
    "development/operations/demo-deploy.md",
    "development/operations/github-release.md",
    "development/operations/local-engine-install.md",
    "development/operations/npm-package-strategy.md",
    "development/operations/npm-release.md",
    "development/operations/release-notes-template.md",
    "planning/README.md",
    "planning/feature-candidates.md",
    "planning/game-development-convenience-review.md",
    "planning/deployment-roadmap.md",
  ];
  const aIndex = priority.indexOf(a.replace(/^en\//u, ""));
  const bIndex = priority.indexOf(b.replace(/^en\//u, ""));
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? priority.length : aIndex) - (bIndex === -1 ? priority.length : bIndex);
  }
  return a.localeCompare(b);
}

function outputPathForMarkdown(sourceRelativePath) {
  if (sourceRelativePath === "README.md") {
    return "index.html";
  }
  if (sourceRelativePath.endsWith("/README.md")) {
    return `${sourceRelativePath.slice(0, -"README.md".length)}index.html`;
  }
  return sourceRelativePath.replace(/\.md$/u, ".html");
}

function firstHeading(markdown) {
  const match = /^#\s+(.+)$/mu.exec(markdown);
  return match ? stripInlineMarkdown(match[1].trim()) : "Ferrum2D Docs";
}

function pageHtml(items) {
  const card = item => `<a class="tile" data-example-card="${escapeAttribute(item.id)}" href="./${escapeAttribute(item.path)}"><span class="tile-title">${escapeHtml(item.title)}</span><span class="tile-description">${escapeHtml(item.summary)}</span></a>`;
  const featureLinks = featureExamples.map(item => `<a class="tile" data-feature-card="${escapeAttribute(item.id)}" data-feature-category="${escapeAttribute(item.group)}" href="./starter-runtime/?feature=${escapeAttribute(item.id)}"><span class="tile-category">${escapeHtml(item.group)}</span><span class="tile-title">${escapeHtml(item.title)}</span><span class="tile-description">${escapeHtml(item.summary)}</span><span class="tile-use-case">${escapeHtml(item.lesson.useCase)}</span></a>`).join("");
  const filters = ["all", ...new Set(featureExamples.map(item => item.group))].map(group => `<button type="button" data-feature-group="${escapeAttribute(group)}" aria-pressed="${group === "all"}">${group === "all" ? "전체" : escapeHtml(group)}</button>`).join("");
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Ferrum2D · 엔진 예제</title>
  <style>${siteCss()}</style>
  <link rel="stylesheet" href="./exampleTheme.css" />
  <link rel="stylesheet" href="./exampleHub.css" />
  <script type="module" src="./exampleHub.mjs"></script>
</head>
<body>
<main class="home-shell" data-example-hub>
  <nav class="hub-topbar" aria-label="예제와 문서"><strong>Ferrum2D / 엔진 예제</strong><a href="./docs/engine/user-guide.html">엔진 안내</a><a href="./docs/">문서</a><a href="./docs/en/" lang="en" hreflang="en">English docs</a></nav>
  <header class="intro">
    <p class="eyebrow">Rust + WebAssembly · 2D / HD-2D</p>
    <h1>작은 실험에서 게임 구성까지</h1>
    <p class="lead">기능 하나를 바꿔 결과를 확인하고, 같은 기능이 게임에서 연결되는 과정을 살펴보세요. 각 예제에서 조작 방법과 관찰할 결과를 안내합니다.</p>
    <nav class="learning-path" aria-label="추천 학습 순서"><a href="#learn"><strong>01 · 기능 하나씩</strong><span>독립 실험 ${featureExamples.length}종과 물리 심화</span></a><a href="#games"><strong>02 · 게임에 연결</strong><span>충돌 반응 → 이동 → 전투 → 도트 자산</span></a><a href="#tools"><strong>03 · 내 씬 만들기</strong><span>배치·카메라·에셋 작성과 프로젝트 시작</span></a></nav>
  </header>
  <section class="section" id="learn" aria-labelledby="learn-heading">
    <div class="section-heading"><h2 id="learn-heading">01 · 기능별 실험</h2><output data-feature-count role="status" aria-live="polite">${featureExamples.length} / ${featureExamples.length}개 기능</output></div>
    <p class="section-description">처음이라면 애니메이션·카메라부터 시작하세요. <a href="./starter-runtime/">기능 실험실 열기</a>에서 설정 하나를 바꾸고 초기화해 비교할 수 있습니다.</p>
    <label class="hub-search">어떤 기능을 찾으세요?<input type="search" data-feature-search placeholder="예: 조명, 충돌, 저장" aria-label="기능 예제 검색" /></label>
    <fieldset class="feature-filter"><legend>기능 분류</legend>${filters}</fieldset>
    <p data-feature-empty hidden>검색 결과가 없습니다. 검색어를 지우거나 전체 분류를 선택하세요.</p>
    <div class="grid">${featureLinks}</div>
  </section>
  <section class="section" aria-labelledby="physics-heading"><div class="section-heading"><h2 id="physics-heading">물리를 더 자세히</h2></div>${items.filter(item => item.id === "physics-sandbox").map(card).join("")}</section>
  <section class="section" id="games" aria-labelledby="games-heading">
    <div class="section-heading"><h2 id="games-heading">02 · 게임 응용</h2></div>
    <p class="section-description">각 게임의 역할을 나눴습니다. 먼저 관련 기능 실험을 보고, 실제 플레이에서 조합된 결과를 확인하세요.</p>
    <div class="grid">${items.filter(item => item.kind === "game").map(card).join("")}</div>
  </section>
  <section class="section" id="tools" aria-labelledby="tools-heading">
    <div class="section-heading"><h2 id="tools-heading">03 · 씬과 에셋 작성</h2></div>
    <div class="grid">${items.filter(item => item.kind === "tool").map(card).join("")}</div>
    <div class="hub-tools"><a href="./docs/engine/developer-quickstart.html">새 프로젝트 시작</a><a href="./docs/engine/data-scene-authoring.html">씬·에셋 작성 안내</a><a href="./docs/engine/public-api.html">공개 API</a><a href="./docs/engine/showcase-hub.html">기능·소스 지도</a><p>웹 뷰어의 내장 예제는 내보내기 전용입니다. 실제 프로젝트 저장 방법은 씬·에셋 작성 안내를 확인하세요.</p></div>
  </section>
  <p class="site-note">문서와 예제는 배포한 개발 소스 기준입니다. 설치 패키지는 해당 릴리스의 문서를 확인하세요.</p>
</main>
</body>
</html>`;
}

function docPageHtml(page, pages) {
  const isEnglish = page.language === "en";
  const currentDir = path.posix.dirname(page.outputRelativePath);
  const rootHref = relativeHref(currentDir, isEnglish ? "en/index.html" : "index.html");
  const siteRootHref = relativeHref(path.posix.join("docs", currentDir), "index.html");
  const counterpartSource = isEnglish ? page.sourceRelativePath.slice(3) : `en/${page.sourceRelativePath}`;
  const counterpart = pages.find((item) => item.sourceRelativePath === counterpartSource);
  const languageHref = relativeHref(currentDir, counterpart?.outputRelativePath ?? (isEnglish ? "index.html" : "en/index.html"));
  const languageLabel = counterpart ? (isEnglish ? "한국어" : "English") : (isEnglish ? "한국어 문서" : "English docs");
  const alternateLinks = counterpart ? [page, counterpart].map((item) =>
    `<link rel="alternate" hreflang="${item.language}" href="${escapeAttribute(relativeHref(currentDir, item.outputRelativePath))}" />`
  ).join("\n    ") : "";
  const groups = documentationGroups.map((group) => ({
    ...group,
    title: isEnglish ? group.titleEn : group.title,
    pages: [],
  }));
  for (const item of pages.filter((item) => item.language === page.language)) {
    const referencePath = item.sourceRelativePath.replace(/^en\//u, "");
    groups.find((group) => group.matches(referencePath)).pages.push(item);
  }
  const nav = groups.filter((group) => group.pages.length > 0).map((group, index) => {
    const active = group.pages.some((item) => item.outputRelativePath === page.outputRelativePath);
    const links = group.pages.map((item) => {
      const href = relativeHref(currentDir, item.outputRelativePath);
      const current = item.outputRelativePath === page.outputRelativePath ? " aria-current=\"page\"" : "";
      return `<a href="${escapeAttribute(href)}"${current}>${escapeHtml(item.title)}</a>`;
    }).join("\n              ");
    return `<details class="nav-group"${active || index === 0 ? " open" : ""}>
            <summary>${escapeHtml(group.title)}</summary>
            <div class="nav-links">${links}</div>
          </details>`;
  }).join("\n          ");
  const content = markdownToHtml(page.source, page.sourceRelativePath, page.outputRelativePath);

  return `<!doctype html>
<html lang="${page.language}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(page.title)} | Ferrum2D Docs</title>
    ${alternateLinks}
    <style>${siteCss(relativeHref(path.posix.join("docs", currentDir), "fonts/NotoSansKR-UI.woff2"))}</style>
  </head>
  <body>
    <div class="docs-layout">
      <aside class="docs-nav" aria-label="${isEnglish ? "Documentation navigation" : "문서 탐색"}">
        <a class="brand" href="${escapeAttribute(rootHref)}">Ferrum2D Docs</a>
        <nav>${nav}
        </nav>
      </aside>
      <main class="docs-content">
        <div class="docs-topbar">
          <a href="${escapeAttribute(siteRootHref)}">${isEnglish ? "Demos and home" : "기능·예제 홈"}</a>
          <a href="${escapeAttribute(rootHref)}">${isEnglish ? "Documentation index" : "문서 지도"}</a>
          <a href="${escapeAttribute(languageHref)}" lang="${isEnglish ? "ko" : "en"}" hreflang="${isEnglish ? "ko" : "en"}">${languageLabel}</a>
        </div>
        <article>
${content}
        </article>
      </main>
    </div>
  </body>
</html>
`;
}

function markdownToHtml(markdown, sourceRelativePath, outputRelativePath) {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks = [];
  const headingSlugCounts = new Map();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = /^```\s*([^`]*)\s*$/u.exec(line);
    if (fence) {
      const language = fence[1].trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/u.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const className = language ? ` class="language-${escapeAttribute(language)}"` : "";
      blocks.push(`<pre><code${className}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = githubHeadingId(stripInlineMarkdown(title), headingSlugCounts);
      blocks.push(`<h${level} id="${escapeAttribute(id)}">${parseInline(title, sourceRelativePath, outputRelativePath)}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && lines[index].includes("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(tableToHtml(tableLines, sourceRelativePath, outputRelativePath));
      continue;
    }

    if (/^\s*-\s+/u.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*-\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*-\s+/u, ""));
        index += 1;
      }
      blocks.push(`<ul>\n${items.map((item) => `  <li>${parseInline(item, sourceRelativePath, outputRelativePath)}</li>`).join("\n")}\n</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/u.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/u.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/u, ""));
        index += 1;
      }
      blocks.push(`<ol>\n${items.map((item) => `  <li>${parseInline(item, sourceRelativePath, outputRelativePath)}</li>`).join("\n")}\n</ol>`);
      continue;
    }

    if (/^>\s?/u.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/u.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/u, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${parseInline(quoteLines.join(" "), sourceRelativePath, outputRelativePath)}</blockquote>`);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim() !== "" && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${parseInline(paragraph.join(" "), sourceRelativePath, outputRelativePath)}</p>`);
  }
  return blocks.map((block) => `          ${block}`).join("\n");
}

function isBlockStart(lines, index) {
  const line = lines[index];
  return /^```/u.test(line)
    || /^(#{1,6})\s+/u.test(line)
    || /^\s*-\s+/u.test(line)
    || /^\s*\d+\.\s+/u.test(line)
    || /^>\s?/u.test(line)
    || isTableStart(lines, index);
}

function isTableStart(lines, index) {
  if (index + 1 >= lines.length) {
    return false;
  }
  return lines[index].includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(lines[index + 1]);
}

function tableToHtml(lines, sourceRelativePath, outputRelativePath) {
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return `<div class="table-scroll" tabindex="0" aria-label="표 가로 스크롤"><table>\n  <thead><tr>${header.map((cell) => `<th>${parseInline(cell, sourceRelativePath, outputRelativePath)}</th>`).join("")}</tr></thead>\n  <tbody>\n${rows.map((row) => `    <tr>${row.map((cell) => `<td>${parseInline(cell, sourceRelativePath, outputRelativePath)}</td>`).join("")}</tr>`).join("\n")}\n  </tbody>\n</table></div>`;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map((cell) => cell.trim());
}

function parseInline(value, sourceRelativePath, outputRelativePath) {
  const codeSpans = [];
  let html = value.replace(/`([^`]+)`/gu, (_, code) => {
    const token = `@@CODE${codeSpans.length}@@`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });
  html = escapeHtml(html);
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (_, alt, href) => {
    const src = rewriteLink(href, sourceRelativePath, outputRelativePath);
    return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(unescapeHtml(alt))}" />`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_, label, href) => {
    const target = rewriteLink(href, sourceRelativePath, outputRelativePath);
    return `<a href="${escapeAttribute(target)}">${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/gu, "<em>$1</em>");
  for (const [index, code] of codeSpans.entries()) {
    html = html.replace(`@@CODE${index}@@`, code);
  }
  return html;
}

function rewriteLink(href, sourceRelativePath, outputRelativePath) {
  if (/^(https?:|mailto:)/iu.test(href) || href.startsWith("#")) {
    return href;
  }
  const [targetPath, hash = ""] = href.split("#");
  const sourceDir = path.posix.dirname(sourceRelativePath);
  const outputDirname = path.posix.dirname(outputRelativePath);
  if (targetPath.endsWith(".md")) {
    const targetSource = path.posix.normalize(path.posix.join(sourceDir, targetPath));
    const targetOutput = outputPathForMarkdown(targetSource);
    return `${relativeHref(outputDirname, targetOutput)}${hash ? `#${hash}` : ""}`;
  }
  const targetOutput = path.posix.normalize(path.posix.join(sourceDir, targetPath));
  return `${relativeHref(outputDirname, targetOutput)}${hash ? `#${hash}` : ""}`;
}

function relativeHref(fromDir, toPath) {
  const normalizedFrom = fromDir === "." ? "" : fromDir;
  let href = path.posix.relative(normalizedFrom, toPath);
  if (!href) {
    href = path.posix.basename(toPath);
  }
  return href;
}

function siteCss(fontHref = "./fonts/NotoSansKR-UI.woff2") {
  return `@font-face {
  font-family: "Ferrum Korean UI";
  src: url("${escapeAttribute(fontHref)}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  unicode-range: U+1100-11FF, U+3130-318F, U+A960-A97F, U+AC00-D7FF;
}
:root {
  color-scheme: light;
  font-family: Inter, "Ferrum Korean UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f6f8fb;
  color: #1e2933;
}
* { box-sizing: border-box; }
body { margin: 0; background: #f6f8fb; }
a { color: #0f6f72; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
.home-shell { width: min(1120px, calc(100vw - 32px)); margin: 0 auto; padding: 32px 0 56px; }
.intro { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 460px); gap: 28px; align-items: center; min-height: 360px; border-bottom: 1px solid #d9e2ec; }
.eyebrow { margin: 0 0 10px; color: #c2541a; font-size: 0.82rem; font-weight: 700; letter-spacing: 0; text-transform: uppercase; }
h1 { margin: 0 0 12px; color: #14212b; font-size: clamp(2.3rem, 6vw, 5rem); line-height: 0.95; letter-spacing: 0; }
.lead { max-width: 660px; margin: 0; color: #526575; font-size: 1.08rem; line-height: 1.7; }
.site-note { color: #526575; font-size: 0.9rem; line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 14px; border: 1px solid #9fb3c2; border-radius: 8px; color: #1e2933; font-weight: 700; text-decoration: none; background: #ffffff; }
.button.primary { border-color: #0f6f72; color: #ffffff; background: #0f6f72; }
.preview { width: 100%; border: 1px solid #cad6e0; border-radius: 8px; background: #16202a; box-shadow: 0 14px 40px rgba(32, 43, 54, 0.16); }
.section { margin-top: 34px; }
.section-heading { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
h2 { margin: 0; color: #14212b; font-size: 1.35rem; letter-spacing: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.tile { display: grid; gap: 10px; min-height: 124px; padding: 18px; border: 1px solid #d3dee8; border-radius: 8px; background: #ffffff; color: inherit; text-decoration: none; }
.tile:focus-visible, .tile:hover { border-color: #0f6f72; outline: 3px solid rgba(15, 111, 114, 0.16); }
.tile-title { color: #14212b; font-size: 1.04rem; font-weight: 800; }
.tile-description { color: #526575; line-height: 1.5; }
.docs-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
.docs-nav { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 22px 18px; border-right: 1px solid #d9e2ec; background: #eef3f8; }
.brand { display: block; margin-bottom: 18px; color: #14212b; font-size: 1.08rem; font-weight: 900; text-decoration: none; }
.docs-nav nav { display: grid; gap: 10px; }
.nav-group summary { padding: 8px 10px; color: #14212b; font-size: 0.92rem; font-weight: 800; cursor: pointer; }
.nav-group summary:focus-visible { outline: 2px solid #0f6f72; outline-offset: 2px; border-radius: 6px; }
.nav-links { display: grid; gap: 4px; margin-top: 4px; }
.docs-nav nav a { display: block; padding: 8px 10px; border-radius: 8px; color: #394b59; text-decoration: none; line-height: 1.35; }
.docs-nav nav a:hover, .docs-nav nav a[aria-current="page"] { background: #ffffff; color: #0f6f72; }
.docs-content { min-width: 0; padding: 22px min(64px, 6vw) 64px; }
.docs-topbar { display: flex; flex-wrap: wrap; gap: 14px; justify-content: flex-end; margin-bottom: 20px; font-size: 0.92rem; }
article { max-width: 920px; overflow-wrap: anywhere; }
article h1 { font-size: clamp(2rem, 5vw, 3.6rem); line-height: 1; }
article h2 { margin-top: 34px; padding-top: 18px; border-top: 1px solid #d9e2ec; }
article h3, article h4, article h5, article h6 { margin-top: 26px; color: #14212b; letter-spacing: 0; }
article p, article li { color: #2f3f4c; line-height: 1.72; }
article li + li { margin-top: 4px; }
article code { border-radius: 5px; padding: 0.12em 0.34em; background: #e8eef4; color: #99430d; font-size: 0.92em; }
pre { overflow: auto; padding: 16px; border-radius: 8px; background: #18232e; color: #e7eff7; }
pre code { padding: 0; background: transparent; color: inherit; }
.table-scroll { max-width: 100%; overflow-x: auto; margin: 18px 0; }
.table-scroll:focus-visible { outline: 2px solid #0f6f72; outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; background: #ffffff; overflow-wrap: normal; }
th, td { padding: 10px 12px; border: 1px solid #d9e2ec; text-align: left; vertical-align: top; }
th { background: #edf3f7; color: #14212b; }
blockquote { margin: 18px 0; padding: 10px 16px; border-left: 4px solid #c2541a; background: #fff7f0; color: #394b59; }
article img { max-width: 100%; height: auto; border-radius: 8px; }
@media (max-width: 780px) {
  .intro { grid-template-columns: 1fr; padding-bottom: 28px; }
  .docs-layout { display: block; }
  .docs-nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid #d9e2ec; }
  .docs-content { padding: 18px 16px 48px; }
  .docs-topbar { justify-content: flex-start; }
}`;
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

function escapeHtml(value) {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/gu, "&#39;");
}

function unescapeHtml(value) {
  return value
    .replace(/&quot;/gu, '"')
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}
