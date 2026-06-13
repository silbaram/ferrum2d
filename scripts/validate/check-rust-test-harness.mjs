#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TEST_ROOT = resolve(REPO_ROOT, "crates/ferrum-core/src");
const FORBIDDEN_WORLD_STORAGE =
  /\b(?:[A-Za-z_][A-Za-z0-9_]*\.)*world\.(sprites|transforms|velocities|rotations|angular_velocities|colliders|circle_colliders|oriented_box_colliders|capsule_colliders|convex_polygon_colliders|collision_filters|alive)\b/g;

const files = await collectExternalRustTestFiles(TEST_ROOT);
const violations = [];
for (const filePath of files) {
  const source = await readFile(filePath, "utf8");
  violations.push(...findForbiddenStorageAccess(filePath, source));
}

if (violations.length > 0) {
  console.error(
    "[rust test harness] direct World storage access is forbidden in external Rust tests; use World accessors instead.",
  );
  for (const violation of violations) {
    console.error(
      `${relative(REPO_ROOT, violation.filePath)}:${violation.line}:${violation.column}: ${violation.match}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("rust test harness guard ok");
}

async function collectExternalRustTestFiles(directory) {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectExternalRustTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".rs")) {
      const relativePath = relative(REPO_ROOT, entryPath);
      if (isExternalRustTestFile(relativePath)) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

function isExternalRustTestFile(relativePath) {
  return relativePath.endsWith("/tests.rs") || relativePath.includes("/tests/");
}

function findForbiddenStorageAccess(filePath, source) {
  const violations = [];
  const lines = source.split("\n");
  for (const [lineIndex, line] of lines.entries()) {
    FORBIDDEN_WORLD_STORAGE.lastIndex = 0;
    for (const match of line.matchAll(FORBIDDEN_WORLD_STORAGE)) {
      violations.push({
        filePath,
        line: lineIndex + 1,
        column: match.index + 1,
        match: match[0],
      });
    }
  }
  return violations;
}
