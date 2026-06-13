#!/usr/bin/env node
import { readFileSync } from "node:fs";

const rootPackageJson = JSON.parse(readFileSync("package.json", "utf8"));
const runtimePackageJson = JSON.parse(readFileSync("packages/ferrum-web/package.json", "utf8"));
const changelog = readFileSync("CHANGELOG.md", "utf8");
const npmReleaseDoc = readFileSync("docs/development/operations/npm-release.md", "utf8");
const releaseNotesTemplate = readFileSync("docs/development/operations/release-notes-template.md", "utf8");
const releaseReadinessScript = readFileSync("scripts/package/check-release-readiness.mjs", "utf8");
const packageCheckScript = readFileSync("scripts/package/check-package-files.mjs", "utf8");

const args = parseArgs(process.argv.slice(2));
const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;
const stableVersionPattern = /^\d+\.\d+\.\d+$/;
const baseVersion = stableVersionPattern.test(runtimePackageJson.version)
  ? runtimePackageJson.version
  : baseVersionFromBeta(runtimePackageJson.version);
const candidateVersion = args.version ?? `${baseVersion}-beta.0`;
const candidateTag = args.tag ?? `ferrum-web-v${candidateVersion}`;

const errors = [
  ...checkPackageMetadata(),
  ...checkCandidateMetadata(),
  ...checkChangelog(),
  ...checkDocsAndScripts(),
];

if (errors.length > 0) {
  console.error("release candidate check failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("release candidate check ok");
console.log(JSON.stringify({
  packageName: runtimePackageJson.name,
  currentRootVersion: rootPackageJson.version,
  currentPackageVersion: runtimePackageJson.version,
  candidateVersion,
  expectedTag: candidateTag,
  private: runtimePackageJson.private,
  publishConfig: runtimePackageJson.publishConfig,
}, null, 2));

function parseArgs(argv) {
  const parsed = { tag: undefined, version: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--version" || arg === "--tag") {
      const value = argv[index + 1];
      assert(value !== undefined && !value.startsWith("--"), `${arg} requires a value`);
      if (arg === "--version") {
        parsed.version = value;
      } else {
        parsed.tag = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function checkPackageMetadata() {
  const errors = [];
  if (runtimePackageJson.name !== "@ferrum2d/ferrum-web") {
    errors.push("packages/ferrum-web package name must stay @ferrum2d/ferrum-web.");
  }
  if (!stableVersionPattern.test(runtimePackageJson.version) && !betaVersionPattern.test(runtimePackageJson.version)) {
    errors.push("packages/ferrum-web version must be stable semver or beta semver.");
  }
  if (!stableVersionPattern.test(rootPackageJson.version) && !betaVersionPattern.test(rootPackageJson.version)) {
    errors.push("root package version must be stable semver or beta semver.");
  }
  if (baseVersionFromBeta(rootPackageJson.version) !== baseVersion) {
    errors.push(`root package version ${rootPackageJson.version} must match ferrum-web base version ${baseVersion}.`);
  }
  if (runtimePackageJson.private !== true) {
    errors.push("packages/ferrum-web private must remain true until explicit publish approval.");
  }
  if (runtimePackageJson.publishConfig?.access !== "public") {
    errors.push("packages/ferrum-web publishConfig.access must be public.");
  }
  if (runtimePackageJson.publishConfig?.tag !== "beta") {
    errors.push("packages/ferrum-web publishConfig.tag must be beta.");
  }
  return errors;
}

function checkCandidateMetadata() {
  const errors = [];
  if (!betaVersionPattern.test(candidateVersion)) {
    errors.push(`candidate version must match x.y.z-beta.N, got ${candidateVersion}.`);
  }
  if (candidateTag !== `ferrum-web-v${candidateVersion}`) {
    errors.push(`candidate tag must be ferrum-web-v${candidateVersion}, got ${candidateTag}.`);
  }
  if (!candidateVersion.startsWith(`${baseVersion}-beta.`)) {
    errors.push(`candidate version ${candidateVersion} must use current base version ${baseVersion}.`);
  }
  return errors;
}

function checkChangelog() {
  const errors = [];
  if (!/^# CHANGELOG\n/m.test(changelog)) {
    errors.push("CHANGELOG.md must start with # CHANGELOG.");
  }
  if (!/^## Unreleased$/m.test(changelog)) {
    errors.push("CHANGELOG.md must keep an Unreleased section for pre-release staging.");
  }
  if (!/^### (Added|Changed|Fixed|Removed|Known Limitations)$/m.test(changelog)) {
    errors.push("CHANGELOG.md Unreleased section must contain release-note category headings.");
  }
  for (const heading of changelog.matchAll(/^## (.+)$/gm)) {
    const value = heading[1];
    if (value === "Unreleased") {
      continue;
    }
    if (!/^(\d+\.\d+\.\d+(?:-beta\.\d+)?) - \d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`CHANGELOG.md release heading must be '## version - YYYY-MM-DD': ${value}.`);
    }
  }
  return errors;
}

function checkDocsAndScripts() {
  const errors = [];
  for (const snippet of [
    "pnpm release:candidate-check",
    "pnpm release:publish-check",
    "private: true",
    "private: false",
    "ferrum-web-vx.y.z-beta.N",
  ]) {
    if (!npmReleaseDoc.includes(snippet)) {
      errors.push(`npm release doc is missing '${snippet}'.`);
    }
  }
  for (const snippet of ["x.y.z-beta.N", "ferrum-web-vx.y.z-beta.N", "Verification"]) {
    if (!releaseNotesTemplate.includes(snippet)) {
      errors.push(`release notes template is missing '${snippet}'.`);
    }
  }
  for (const snippet of ["--expect-publishable", "--version", "--tag"]) {
    if (!releaseReadinessScript.includes(snippet)) {
      errors.push(`check-release-readiness.mjs is missing '${snippet}'.`);
    }
  }
  for (const snippet of ["--expect-publishable", "publishable beta package must set private to false"]) {
    if (!packageCheckScript.includes(snippet)) {
      errors.push(`check-package-files.mjs is missing '${snippet}'.`);
    }
  }
  return errors;
}

function baseVersionFromBeta(version) {
  return version.replace(/-beta\.\d+$/u, "");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[release candidate check] ${message}`);
  }
}
