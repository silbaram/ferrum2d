import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const docsDir = path.join(repoRoot, "docs");
const distPagesDir = path.join(repoRoot, "dist-pages");
const shouldCheckDistPages = process.argv.includes("--dist-pages");

const requiredDistPages = [
  "index.html",
  "docs/index.html",
  "docs/engine/showcase-hub.html",
  "docs/engine/developer-quickstart.html",
  "docs/engine/user-guide.html",
  "docs/engine/public-api.html",
  "docs/engine/public-api/core.html",
  "docs/engine/public-api/authoring.html",
  "docs/engine/public-api/starter-scenes.html",
  "docs/engine/public-api/labs.html",
  "docs/engine/public-api/quality.html",
  "docs/engine/data-scene-authoring.html",
  "docs/examples/topdown-shooter/game-spec.html",
  "docs/development/quality/smoke-check.html",
  "docs/development/operations/npm-release.html",
  "docs/development/operations/demo-deploy.html",
  "starter-runtime/index.html",
  "topdown-shooter/index.html",
  "placement-viewer/index.html",
  "physics-sandbox/index.html",
  "breakout/index.html",
  "platformer/index.html",
];

const externalProtocol = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu;

const markdownResult = checkMarkdownLinks();
const distResult = shouldCheckDistPages ? checkDistPagesArtifact() : null;

if (markdownResult.errors.length > 0 || (distResult && distResult.errors.length > 0)) {
  for (const error of [...markdownResult.errors, ...(distResult?.errors ?? [])]) {
    console.error(error);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  docsFiles: markdownResult.docsFiles,
  markdownLinks: markdownResult.links,
  distPages: distResult
    ? {
        requiredFiles: requiredDistPages.length,
        htmlFiles: distResult.htmlFiles,
        htmlLinks: distResult.links,
      }
    : "skipped",
}, null, 2));

function checkMarkdownLinks() {
  const docsFiles = collectFiles(docsDir)
    .filter((filePath) => filePath.endsWith(".md"))
    .sort();
  const headingIdsByFile = new Map();
  for (const filePath of docsFiles) {
    headingIdsByFile.set(filePath, markdownHeadingIds(readFileSync(filePath, "utf8")));
  }

  const errors = [];
  let links = 0;

  for (const filePath of docsFiles) {
    const source = stripFencedCode(readFileSync(filePath, "utf8"));
    const sourceDir = path.dirname(filePath);
    for (const link of markdownLinks(source)) {
      if (shouldSkipHref(link.href)) {
        continue;
      }
      links += 1;
      const { targetPath, hash } = splitHref(link.href);
      const targetFile = targetPath
        ? path.resolve(sourceDir, targetPath)
        : filePath;
      const displaySource = toPosix(path.relative(repoRoot, filePath));

      if (targetPath && !existsSync(targetFile)) {
        errors.push(`${displaySource}: missing linked file "${link.href}"`);
        continue;
      }
      if (hash && targetFile.endsWith(".md")) {
        const ids = headingIdsByFile.get(targetFile);
        if (!ids) {
          errors.push(`${displaySource}: cannot check heading for non-doc link "${link.href}"`);
          continue;
        }
        const id = decodeURIComponent(hash);
        if (!ids.has(id)) {
          errors.push(`${displaySource}: missing heading "#${id}" in "${link.href}"`);
        }
      }
    }
  }

  return { docsFiles: docsFiles.length, links, errors };
}

function checkDistPagesArtifact() {
  const errors = [];
  for (const requiredPath of requiredDistPages) {
    const targetPath = path.join(distPagesDir, requiredPath);
    if (!existsSync(targetPath)) {
      errors.push(`dist-pages: missing required artifact "${requiredPath}"`);
    }
  }

  if (errors.length > 0) {
    return { htmlFiles: 0, links: 0, errors };
  }

  const htmlFiles = collectFiles(distPagesDir)
    .filter((filePath) => filePath.endsWith(".html"))
    .sort();
  const idsByFile = new Map();
  for (const filePath of htmlFiles) {
    idsByFile.set(filePath, htmlIds(readFileSync(filePath, "utf8")));
  }

  let links = 0;
  for (const filePath of htmlFiles) {
    const source = readFileSync(filePath, "utf8");
    const sourceDir = path.dirname(filePath);
    for (const href of htmlLocalHrefs(source)) {
      if (shouldSkipHref(href)) {
        continue;
      }
      links += 1;
      const { targetPath, hash } = splitHref(href);
      const targetFile = targetPath
        ? resolveHtmlTarget(sourceDir, targetPath)
        : filePath;
      const displaySource = toPosix(path.relative(repoRoot, filePath));

      if (!targetFile || !existsSync(targetFile)) {
        errors.push(`${displaySource}: missing linked artifact "${href}"`);
        continue;
      }
      if (hash && targetFile.endsWith(".html")) {
        const ids = idsByFile.get(targetFile);
        const id = decodeURIComponent(hash);
        if (!ids?.has(id)) {
          errors.push(`${displaySource}: missing html id "#${id}" in "${href}"`);
        }
      }
    }
  }

  return { htmlFiles: htmlFiles.length, links, errors };
}

function markdownLinks(source) {
  const links = [];
  const pattern = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
  for (const match of source.matchAll(pattern)) {
    links.push({ label: match[1], href: match[2] });
  }
  return links;
}

function htmlLocalHrefs(source) {
  const links = [];
  const pattern = /\b(?:href|src)="([^"]+)"/gu;
  for (const match of source.matchAll(pattern)) {
    links.push(match[1]);
  }
  return links;
}

function shouldSkipHref(href) {
  return href === ""
    || externalProtocol.test(href)
    || href.startsWith("mailto:")
    || href.startsWith("data:")
    || href.startsWith("javascript:");
}

function splitHref(href) {
  const [pathAndQuery, rawHash = ""] = href.split("#");
  const [targetPath = ""] = pathAndQuery.split("?");
  return {
    targetPath: decodeURIComponent(targetPath),
    hash: rawHash,
  };
}

function resolveHtmlTarget(sourceDir, targetPath) {
  const resolved = path.resolve(sourceDir, targetPath);
  if (!resolved.startsWith(distPagesDir)) {
    return null;
  }
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return path.join(resolved, "index.html");
  }
  if (targetPath.endsWith("/")) {
    return path.join(resolved, "index.html");
  }
  return resolved;
}

function markdownHeadingIds(source) {
  const ids = new Set();
  const headingPattern = /^(#{1,6})\s+(.+)$/gmu;
  for (const match of source.matchAll(headingPattern)) {
    ids.add(slugify(stripInlineMarkdown(match[2].trim())));
  }
  return ids;
}

function htmlIds(source) {
  const ids = new Set();
  const idPattern = /\bid="([^"]+)"/gu;
  for (const match of source.matchAll(idPattern)) {
    ids.add(match[1]);
  }
  return ids;
}

function stripFencedCode(source) {
  return source.replace(/```[\s\S]*?```/gu, "");
}

function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_~]/gu, "");
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "section";
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

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}
