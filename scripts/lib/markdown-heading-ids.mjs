const headingPattern = /^(#{1,6})\s+(.+)$/gmu;

export function markdownHeadingIds(source) {
  const ids = new Set();
  const slugCounts = new Map();
  for (const match of source.matchAll(headingPattern)) {
    ids.add(githubHeadingId(stripInlineMarkdown(match[2].trim()), slugCounts));
  }
  return ids;
}

export function githubHeadingId(value, slugCounts = new Map()) {
  const baseSlug = githubSlug(value) || "section";
  const count = slugCounts.get(baseSlug) ?? 0;
  slugCounts.set(baseSlug, count + 1);
  return count === 0 ? baseSlug : `${baseSlug}-${count}`;
}

export function stripInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[*_~]/gu, "");
}

function githubSlug(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/gu, "")
    .replace(/[\p{P}\p{S}]/gu, (match) => match === "-" ? "-" : "")
    .trim()
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
