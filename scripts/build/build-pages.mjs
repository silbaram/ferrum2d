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

const outputDir = "dist-pages";
const docsSourceDir = "docs";
const docsOutputDir = path.join(outputDir, "docs");
const examples = [
  {
    id: "starter-runtime",
    title: "Starter Runtime",
    description: "Smallest createFerrumRuntime flow with WebGL2, UiOverlay, DebugOverlay, and profiler smoke.",
  },
  {
    id: "topdown-shooter",
    title: "Top-down Shooter",
    description: "Game Spec driven shooter with atlas animation, tilemap collision, waves, audio, and debug overlay.",
  },
  {
    id: "breakout",
    title: "Breakout",
    description: "Second genre example using the same runtime API and collision events.",
  },
  {
    id: "platformer",
    title: "Platformer",
    description: "Kinematic controller example with one-way platforms, moving platforms, slopes, and physics stats.",
  },
];
const documentationHighlights = [
  {
    href: "./docs/engine/developer-quickstart.html",
    title: "Developer Quickstart",
    description: "Start a project and follow the AI agent-first development loop.",
  },
  {
    href: "./docs/engine/public-api.html",
    title: "Public API",
    description: "Supported imports, API support tiers, and compatibility policy.",
  },
  {
    href: "./docs/engine/data-scene-authoring.html",
    title: "Data Scene Authoring",
    description: "Generic scene composition and behavior recipe contract for agent-authored content.",
  },
  {
    href: "./docs/examples/topdown-shooter/game-spec.html",
    title: "Top-down Shooter Spec",
    description: "Official example Game Spec fields, defaults, and validation rules.",
  },
  {
    href: "./docs/development/quality/smoke-check.html",
    title: "Smoke & Runtime Budgets",
    description: "Automatic, browser, and performance evidence gates for release candidates.",
  },
  {
    href: "./docs/development/operations/npm-release.html",
    title: "Release Readiness",
    description: "Beta package, changelog, tag, tarball, and publish gate procedure.",
  },
];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, ".nojekyll"), "");

for (const example of examples) {
  const source = path.join("examples", example.id, "dist");
  if (!existsSync(source)) {
    throw new Error(`Missing ${source}. Run pnpm build before pnpm build:pages.`);
  }
  cpSync(source, path.join(outputDir, example.id), { recursive: true });
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
    "engine/developer-quickstart.md",
    "engine/user-guide.md",
    "engine/public-api.md",
    "engine/public-api/core.md",
    "engine/public-api/authoring.md",
    "engine/public-api/starter-scenes.md",
    "engine/public-api/labs.md",
    "engine/public-api/quality.md",
    "engine/runtime-extensibility.md",
    "engine/data-scene-authoring.md",
    "engine/physics-spec.md",
    "examples/topdown-shooter/game-spec.md",
    "development/architecture/architecture.md",
    "development/architecture/physics-engine.md",
    "development/quality/smoke-check.md",
    "development/quality/code-review.md",
    "development/operations/demo-deploy.md",
    "development/operations/npm-package-strategy.md",
    "development/operations/npm-release.md",
    "development/operations/release-notes-template.md",
    "planning/README.md",
    "planning/demo-game-showcase-plan.md",
    "planning/deployment-roadmap.md",
  ];
  const aIndex = priority.indexOf(a);
  const bIndex = priority.indexOf(b);
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

function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_~]/gu, "");
}

function pageHtml(items) {
  const demoLinks = items.map((item) => `
          <a class="tile" href="./${escapeAttribute(item.id)}/">
            <span class="tile-title">${escapeHtml(item.title)}</span>
            <span class="tile-description">${escapeHtml(item.description)}</span>
          </a>`).join("");
  const docsLinks = documentationHighlights.map((item) => `
          <a class="tile" href="${escapeAttribute(item.href)}">
            <span class="tile-title">${escapeHtml(item.title)}</span>
            <span class="tile-description">${escapeHtml(item.description)}</span>
          </a>`).join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ferrum2D</title>
    <style>${siteCss()}</style>
  </head>
  <body>
    <main class="home-shell">
      <section class="intro">
        <div>
          <p class="eyebrow">Rust + WebAssembly 2D web game engine</p>
          <h1>Ferrum2D</h1>
          <p class="lead">Production builds and documentation for the current Ferrum2D browser runtime.</p>
          <div class="actions">
            <a class="button primary" href="./docs/">Docs</a>
            <a class="button" href="./topdown-shooter/">Top-down Shooter</a>
          </div>
        </div>
        <img class="preview" src="./docs/development/quality/screenshots/topdown-shooter-title.png" alt="Top-down Shooter title screen preview" />
      </section>
      <section class="section">
        <div class="section-heading">
          <h2>Demos</h2>
          <a href="./docs/development/operations/demo-deploy.html">Deploy notes</a>
        </div>
        <div class="grid">${demoLinks}
        </div>
      </section>
      <section class="section">
        <div class="section-heading">
          <h2>Documentation</h2>
          <a href="./docs/">Open index</a>
        </div>
        <div class="grid docs-grid">
${docsLinks}
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

function docPageHtml(page, pages) {
  const currentDir = path.posix.dirname(page.outputRelativePath);
  const rootHref = relativeHref(currentDir, "index.html");
  const siteRootHref = relativeHref(path.posix.join("docs", currentDir), "index.html");
  const nav = pages.map((item) => {
    const href = relativeHref(currentDir, item.outputRelativePath);
    const current = item.outputRelativePath === page.outputRelativePath ? " aria-current=\"page\"" : "";
    return `<a href="${escapeAttribute(href)}"${current}>${escapeHtml(item.title)}</a>`;
  }).join("\n          ");
  const content = markdownToHtml(page.source, page.sourceRelativePath, page.outputRelativePath);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(page.title)} | Ferrum2D Docs</title>
    <style>${siteCss()}</style>
  </head>
  <body>
    <div class="docs-layout">
      <aside class="docs-nav" aria-label="Docs navigation">
        <a class="brand" href="${escapeAttribute(rootHref)}">Ferrum2D Docs</a>
        <nav>${nav}
        </nav>
      </aside>
      <main class="docs-content">
        <div class="docs-topbar">
          <a href="${escapeAttribute(siteRootHref)}">Pages home</a>
          <a href="${escapeAttribute(rootHref)}">Docs index</a>
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
      const id = slugify(stripInlineMarkdown(title));
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
  return `<table>\n  <thead><tr>${header.map((cell) => `<th>${parseInline(cell, sourceRelativePath, outputRelativePath)}</th>`).join("")}</tr></thead>\n  <tbody>\n${rows.map((row) => `    <tr>${row.map((cell) => `<td>${parseInline(cell, sourceRelativePath, outputRelativePath)}</td>`).join("")}</tr>`).join("\n")}\n  </tbody>\n</table>`;
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

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "section";
}

function siteCss() {
  return `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 24px; }
.button { display: inline-flex; align-items: center; min-height: 42px; padding: 0 14px; border: 1px solid #9fb3c2; border-radius: 8px; color: #1e2933; font-weight: 700; text-decoration: none; background: #ffffff; }
.button.primary { border-color: #0f6f72; color: #ffffff; background: #0f6f72; }
.preview { width: 100%; border: 1px solid #cad6e0; border-radius: 8px; background: #16202a; box-shadow: 0 14px 40px rgba(32, 43, 54, 0.16); }
.section { margin-top: 34px; }
.section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
h2 { margin: 0; color: #14212b; font-size: 1.35rem; letter-spacing: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; }
.tile { display: grid; gap: 10px; min-height: 124px; padding: 18px; border: 1px solid #d3dee8; border-radius: 8px; background: #ffffff; color: inherit; text-decoration: none; }
.tile:focus-visible, .tile:hover { border-color: #0f6f72; outline: 3px solid rgba(15, 111, 114, 0.16); }
.tile-title { color: #14212b; font-size: 1.04rem; font-weight: 800; }
.tile-description { color: #526575; line-height: 1.5; }
.docs-layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
.docs-nav { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 22px 18px; border-right: 1px solid #d9e2ec; background: #eef3f8; }
.brand { display: block; margin-bottom: 18px; color: #14212b; font-size: 1.08rem; font-weight: 900; text-decoration: none; }
.docs-nav nav { display: grid; gap: 4px; }
.docs-nav nav a { display: block; padding: 8px 10px; border-radius: 8px; color: #394b59; text-decoration: none; line-height: 1.35; }
.docs-nav nav a:hover, .docs-nav nav a[aria-current="page"] { background: #ffffff; color: #0f6f72; }
.docs-content { min-width: 0; padding: 22px min(64px, 6vw) 64px; }
.docs-topbar { display: flex; gap: 14px; justify-content: flex-end; margin-bottom: 20px; font-size: 0.92rem; }
article { max-width: 920px; }
article h1 { font-size: clamp(2rem, 5vw, 3.6rem); line-height: 1; }
article h2 { margin-top: 34px; padding-top: 18px; border-top: 1px solid #d9e2ec; }
article h3, article h4, article h5, article h6 { margin-top: 26px; color: #14212b; letter-spacing: 0; }
article p, article li { color: #2f3f4c; line-height: 1.72; }
article li + li { margin-top: 4px; }
article code { border-radius: 5px; padding: 0.12em 0.34em; background: #e8eef4; color: #99430d; font-size: 0.92em; }
pre { overflow: auto; padding: 16px; border-radius: 8px; background: #18232e; color: #e7eff7; }
pre code { padding: 0; background: transparent; color: inherit; }
table { width: 100%; border-collapse: collapse; margin: 18px 0; background: #ffffff; }
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
