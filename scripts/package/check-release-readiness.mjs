#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJsonPath = path.join(repoRoot, "packages/ferrum-web/package.json");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/package/check-release-readiness.mjs [--expect-publishable] [--version x.y.z-beta.N] [--tag ferrum-web-vx.y.z-beta.N]\n\nChecks Ferrum2D release metadata, changelog structure, and ferrum-web tag naming.`);
  process.exit(0);
}

const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const changelog = await readTextFile(changelogPath);
const stableVersionPattern = /^\d+\.\d+\.\d+$/;
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;
const envTag = releaseTagFromEnv();
const activeTag = args.tag ?? envTag;
const isReleaseTagCheck = activeTag !== undefined;
const expectPublishable = args.expectPublishable || isReleaseTagCheck;
const releaseVersion = args.version
  ?? versionFromTag(activeTag)
  ?? (expectPublishable || betaVersionPattern.test(packageJson.version) ? packageJson.version : undefined);
const expectedTag = releaseVersion === undefined ? null : `ferrum-web-v${releaseVersion}`;

assert(packageJson.name === "@ferrum2d/ferrum-web", "package name must stay @ferrum2d/ferrum-web");
assert(
  stableVersionPattern.test(packageJson.version) || betaVersionPattern.test(packageJson.version),
  "package version must use semver or semver beta prerelease format",
);
assert(packageJson.publishConfig?.access === "public", "publishConfig.access must be public for scoped beta releases");
assert(packageJson.publishConfig?.tag === "beta", "publishConfig.tag must be beta so prereleases do not land on latest");
assert(/^# CHANGELOG\n/m.test(changelog), "CHANGELOG.md must start with # CHANGELOG");
assert(/^## Unreleased$/m.test(changelog), "CHANGELOG.md must keep an Unreleased section");
checkChangelogHeadings(changelog);

if (releaseVersion !== undefined || expectPublishable) {
  assert(releaseVersion !== undefined, "release version is required for publishable release metadata");
  assert(betaVersionPattern.test(releaseVersion), "release version must match x.y.z-beta.N");
  assert(
    packageJson.version === releaseVersion,
    `packages/ferrum-web version ${packageJson.version} must match release version ${releaseVersion}`,
  );
  assert(
    hasChangelogSection(changelog, releaseVersion),
    `CHANGELOG.md must contain a release section for ${releaseVersion}`,
  );
}

if (activeTag !== undefined) {
  assert(activeTag.startsWith("ferrum-web-v"), `release tag must start with ferrum-web-v, got ${activeTag}`);
  assert(activeTag === expectedTag, `release tag must be ${expectedTag}, got ${activeTag}`);
}

if (expectPublishable) {
  assert(packageJson.private === false, "publishable release metadata must set packages/ferrum-web private to false");
}

console.log("release readiness check ok");
console.log(JSON.stringify({
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  expectedTag,
  checkedTag: activeTag ?? null,
  expectPublishable,
}, null, 2));

function parseArgs(argv) {
  const parsed = {
    expectPublishable: false,
    help: false,
    tag: undefined,
    version: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--expect-publishable") {
      parsed.expectPublishable = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--tag" || arg === "--version") {
      const value = argv[index + 1];
      assert(value !== undefined && !value.startsWith("--"), `${arg} requires a value`);
      if (arg === "--tag") {
        parsed.tag = value;
      } else {
        parsed.version = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function releaseTagFromEnv() {
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  const ref = process.env.GITHUB_REF;
  const prefix = "refs/tags/";
  if (ref?.startsWith(prefix)) {
    return ref.slice(prefix.length);
  }
  return undefined;
}

function versionFromTag(tag) {
  const prefix = "ferrum-web-v";
  if (tag?.startsWith(prefix)) {
    return tag.slice(prefix.length);
  }
  return undefined;
}

function checkChangelogHeadings(source) {
  const versions = new Set();
  const headingPattern = /^## (.+)$/gm;
  for (const match of source.matchAll(headingPattern)) {
    const heading = match[1];
    if (heading === "Unreleased") {
      continue;
    }
    const versionMatch = /^(\d+\.\d+\.\d+(?:-beta\.\d+)?) - (\d{4}-\d{2}-\d{2})$/.exec(heading);
    assert(versionMatch !== null, `CHANGELOG.md release heading must be '## version - YYYY-MM-DD': ${heading}`);
    const [, version, date] = versionMatch;
    assert(!versions.has(version), `CHANGELOG.md has duplicate release section for ${version}`);
    assert(isValidIsoDate(date), `CHANGELOG.md release date is invalid: ${date}`);
    versions.add(version);
  }
}

function hasChangelogSection(source, version) {
  const pattern = new RegExp(`^## ${escapeRegExp(version)} - \\d{4}-\\d{2}-\\d{2}$`, "m");
  return pattern.test(source);
}

function isValidIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readTextFile(path) {
  return normalizeLineEndings(await readFile(path, "utf8"));
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/gu, "\n");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[release check] ${message}`);
  }
}
