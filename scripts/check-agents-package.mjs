#!/usr/bin/env node
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assert,
  assertFilesAllowlist,
  assertSemverPackage,
  checkPackedTarball,
  readJson,
  requireFile,
  run,
  runNodeCheck,
} from "./package-check-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(repoRoot, "packages/agents");
const templatesRoot = path.join(packageRoot, "templates");
const packageJson = await readJson(path.join(packageRoot, "package.json"));
const expectPublishable = process.argv.includes("--expect-publishable");
const verifyPack = process.argv.includes("--verify-pack");
const packageLabel = "@ferrum2d/agents";
const expectedFiles = ["LICENSE", "README.md", "bin", "templates"];
const skills = [
  "ferrum-consumer-project",
  "ferrum-consumer-game-spec",
  "ferrum-consumer-asset-pipeline",
  "ferrum-consumer-gameplay",
  "ferrum-consumer-playtest",
  "ferrum-consumer-build",
];
const agents = [
  "consumer-project-agent",
  "consumer-game-spec-agent",
  "consumer-asset-agent",
  "consumer-gameplay-agent",
  "consumer-playtest-agent",
  "consumer-build-agent",
];
const geminiCommands = [
  "project",
  "game-spec",
  "assets",
  "gameplay",
  "playtest",
  "build",
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/bin/ferrum2d-agents.mjs",
  "package/templates/shared/.agents/harness/ferrum-game-development.md",
  ...skills.map((skill) => `package/templates/shared/.agents/skills/${skill}/SKILL.md`),
  "package/templates/codex/.codex/config.toml",
  ...agents.map((agent) => `package/templates/codex/.codex/agents/${agent}.toml`),
  ...agents.map((agent) => `package/templates/claude/.claude/agents/${agent}.md`),
  ...skills.map((skill) => `package/templates/claude/.claude/skills/${skill}/SKILL.md`),
  ...geminiCommands.map((command) => `package/templates/gemini/.gemini/commands/ferrum/${command}.toml`),
];

assert(packageJson.name === packageLabel, "agents package name must stay @ferrum2d/agents");
assertSemverPackage(packageJson, { expectPublishable, packageLabel });
assert(packageJson.type === "module", "agents package type must be module");
assert(packageJson.license === "MIT OR Apache-2.0", "agents package license must stay MIT OR Apache-2.0");
assert(packageJson.bin?.["ferrum2d-agents"] === "./bin/ferrum2d-agents.mjs", "agents bin must point to ./bin/ferrum2d-agents.mjs");
assert(packageJson.engines?.node === ">=18.17", "agents Node engine must stay >=18.17");
assert(packageJson.publishConfig?.access === "public", "agents publishConfig.access must be public");
assert(packageJson.publishConfig?.tag === "beta", "agents publishConfig.tag must be beta");
assertFilesAllowlist(packageJson, expectedFiles, packageLabel);

await requireFile(path.join(packageRoot, "LICENSE"), repoRoot);
await requireFile(path.join(packageRoot, "README.md"), repoRoot);
await requireFile(path.join(packageRoot, "bin/ferrum2d-agents.mjs"), repoRoot);
await runNodeCheck(path.join(packageRoot, "bin/ferrum2d-agents.mjs"), repoRoot);
await checkTemplates();
await checkInstallerOutput();
if (verifyPack) {
  await checkPackedTarball({
    packageRoot,
    requiredFiles: requiredPackedFiles,
    forbiddenPrefixes: [
      "package/node_modules/",
      "package/dist/",
      "package/test/",
      "package/templates/gemini/.gemini/agents/",
      "package/templates/gemini/.gemini/skills/",
    ],
  });
}

console.log("packages/agents package check ok");

async function checkTemplates() {
  await requireFile(path.join(templatesRoot, "shared/.agents/harness/ferrum-game-development.md"), repoRoot);

  for (const skill of skills) {
    const sharedFile = path.join(templatesRoot, `shared/.agents/skills/${skill}/SKILL.md`);
    const sharedSource = await readFile(sharedFile, "utf8");
    assertFrontmatterField(sharedSource, "name", skill, sharedFile);
    assertFrontmatterExists(sharedSource, "description", sharedFile);
    assert(sharedSource.includes("Do not use"), `${path.relative(repoRoot, sharedFile)} must define hard boundaries`);

    const claudeSkillFile = path.join(templatesRoot, `claude/.claude/skills/${skill}/SKILL.md`);
    const claudeSkillSource = await readFile(claudeSkillFile, "utf8");
    assertFrontmatterField(claudeSkillSource, "name", skill, claudeSkillFile);
    assert(claudeSkillSource.includes(`.agents/skills/${skill}/SKILL.md`), `${path.relative(repoRoot, claudeSkillFile)} must point to canonical skill`);
  }

  for (const agent of agents) {
    const codexFile = path.join(templatesRoot, `codex/.codex/agents/${agent}.toml`);
    const codexSource = await readFile(codexFile, "utf8");
    assert(/^name\s*=\s*"consumer_[a-z_]+"/m.test(codexSource), `${path.relative(repoRoot, codexFile)} must define Codex name`);
    assert(/^description\s*=\s*"/m.test(codexSource), `${path.relative(repoRoot, codexFile)} must define Codex description`);
    assert(/^developer_instructions\s*=\s*"""/m.test(codexSource), `${path.relative(repoRoot, codexFile)} must define Codex instructions`);
    assert(codexSource.includes("Do not"), `${path.relative(repoRoot, codexFile)} must include boundaries`);

    const claudeFile = path.join(templatesRoot, `claude/.claude/agents/${agent}.md`);
    const claudeSource = await readFile(claudeFile, "utf8");
    assertFrontmatterField(claudeSource, "name", agent, claudeFile);
    assertFrontmatterExists(claudeSource, "description", claudeFile);
    const skillRefs = [...frontmatter(claudeSource, claudeFile).matchAll(/^\s*-\s+(ferrum-consumer-[a-z-]+)$/gm)].map((match) => match[1]);
    assert(skillRefs.length === 1, `${path.relative(repoRoot, claudeFile)} must reference exactly one skill`);
    assert(skills.includes(skillRefs[0]), `${path.relative(repoRoot, claudeFile)} references unknown skill ${skillRefs[0]}`);

  }

  const codexConfigFile = path.join(templatesRoot, "codex/.codex/config.toml");
  const codexConfigSource = await readFile(codexConfigFile, "utf8");
  assert(codexConfigSource.includes("[agents]"), "Codex template config must define [agents]");
  assert(codexConfigSource.includes("max_depth = 1"), "Codex template config must limit subagent depth");

  for (const command of geminiCommands) {
    const geminiFile = path.join(templatesRoot, `gemini/.gemini/commands/ferrum/${command}.toml`);
    const geminiSource = await readFile(geminiFile, "utf8");
    assert(/^description\s*=\s*"/m.test(geminiSource), `${path.relative(repoRoot, geminiFile)} must define Gemini command description`);
    assert(/^prompt\s*=\s*"""/m.test(geminiSource), `${path.relative(repoRoot, geminiFile)} must define Gemini command prompt`);
    assert(geminiSource.includes(".agents/skills/ferrum-consumer-"), `${path.relative(repoRoot, geminiFile)} must reference canonical .agents skill`);
    assert(geminiSource.includes(".agents/harness/ferrum-game-development.md"), `${path.relative(repoRoot, geminiFile)} must reference shared harness`);
  }

  const geminiAgentsPath = path.join(templatesRoot, "gemini/.gemini/agents");
  assert(!await hasFiles(geminiAgentsPath), "Gemini template must not include unsupported .gemini/agents files");

  const geminiSkillsPath = path.join(templatesRoot, "gemini/.gemini/skills");
  assert(!await hasFiles(geminiSkillsPath), "Gemini template must not include .gemini/skills wrappers");
}

async function checkInstallerOutput() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-agents-check-"));
  try {
    const targetRoot = path.join(tempDir, "consumer-game");
    const cliPath = path.join(packageRoot, "bin/ferrum2d-agents.mjs");
    const result = await run(process.execPath, [cliPath, "init", "--target", targetRoot, "--tools", "codex,claude,gemini"], repoRoot);
    assert(
      result.code === 0,
      `agents CLI failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
    );

    for (const skill of skills) {
      await requireFile(path.join(targetRoot, `.agents/skills/${skill}/SKILL.md`), repoRoot);
      await requireFile(path.join(targetRoot, `.claude/skills/${skill}/SKILL.md`), repoRoot);
    }
    await requireFile(path.join(targetRoot, ".agents/harness/ferrum-game-development.md"), repoRoot);
    for (const agent of agents) {
      await requireFile(path.join(targetRoot, `.codex/agents/${agent}.toml`), repoRoot);
      await requireFile(path.join(targetRoot, `.claude/agents/${agent}.md`), repoRoot);
    }
    await requireFile(path.join(targetRoot, ".codex/config.toml"), repoRoot);
    for (const command of geminiCommands) {
      await requireFile(path.join(targetRoot, `.gemini/commands/ferrum/${command}.toml`), repoRoot);
    }
    await requireFile(path.join(targetRoot, "AGENTS.md"), repoRoot);
    await requireFile(path.join(targetRoot, "CLAUDE.md"), repoRoot);
    await requireFile(path.join(targetRoot, "GEMINI.md"), repoRoot);
    assert(!await exists(path.join(targetRoot, ".gemini/agents")), "installed output must not create unsupported .gemini/agents");
    assert(!await exists(path.join(targetRoot, ".gemini/skills")), "installed output must not create .gemini/skills wrappers");

    const dryRunTarget = path.join(tempDir, "dry-run-game");
    const dryRun = await run(process.execPath, [cliPath, "init", "--target", dryRunTarget, "--tools", "codex", "--dry-run"], repoRoot);
    assert(dryRun.code === 0, `agents dry-run failed with exit code ${dryRun.code}`);
    assert(!await exists(dryRunTarget), "agents dry-run must not create the target directory");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function assertFrontmatterField(source, name, expected, filePath) {
  const value = frontmatterField(source, name, filePath);
  assert(value === expected, `${path.relative(repoRoot, filePath)} ${name} must be ${expected}, got ${value}`);
}

function assertFrontmatterExists(source, name, filePath) {
  frontmatterField(source, name, filePath);
}

function frontmatterField(source, name, filePath) {
  const body = frontmatter(source, filePath);
  const match = body.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
  assert(match !== null, `${path.relative(repoRoot, filePath)} frontmatter must include ${name}`);
  return match[1].trim();
}

function frontmatter(source, filePath) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  assert(match !== null, `${path.relative(repoRoot, filePath)} must start with YAML frontmatter`);
  return match[1];
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function hasFiles(directoryPath) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isFile()) return true;
      if (entry.isDirectory() && await hasFiles(entryPath)) return true;
    }
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
