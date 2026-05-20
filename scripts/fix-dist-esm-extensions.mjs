#!/usr/bin/env node
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const targetRoot = path.resolve(process.cwd(), process.argv[2] ?? "packages/ferrum-web/dist");
const files = await collectFiles(targetRoot);

for (const filePath of files) {
  const original = await readFile(filePath, "utf8");
  const rewritten = rewriteModuleSpecifiers(original, filePath);
  if (rewritten !== original) {
    await writeFile(filePath, rewritten);
  }
}

async function collectFiles(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry);
    const entryStat = await stat(entryPath);
    if (entryStat.isDirectory()) {
      files.push(...await collectFiles(entryPath));
      continue;
    }
    if (entryPath.endsWith(".js") || entryPath.endsWith(".d.ts")) {
      files.push(entryPath);
    }
  }
  return files;
}

function rewriteModuleSpecifiers(source, filePath) {
  const fromPattern = /(\bfrom\s+["'])(\.{1,2}\/[^"']+)(["'])/g;
  const importPattern = /(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g;
  return source
    .replace(fromPattern, (_match, prefix, specifier, suffix) => {
      return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
    })
    .replace(importPattern, (_match, prefix, specifier, suffix) => {
      return `${prefix}${normalizeSpecifier(filePath, specifier)}${suffix}`;
    });
}

function normalizeSpecifier(filePath, specifier) {
  if (hasExplicitExtension(specifier)) {
    return specifier;
  }

  const withJs = `${specifier}.js`;
  const resolvedPath = path.resolve(path.dirname(filePath), withJs);
  const relativeToRoot = path.relative(path.dirname(filePath), resolvedPath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    return withJs;
  }
  return withJs;
}

function hasExplicitExtension(specifier) {
  const baseName = path.basename(specifier);
  return path.extname(baseName).length > 0;
}
