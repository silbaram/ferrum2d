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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = path.join(repoRoot, "packages/agents");
const templatesRoot = path.join(packageRoot, "templates");
const packageJson = await readJson(path.join(packageRoot, "package.json"));
const expectPublishable = process.argv.includes("--expect-publishable");
const verifyPack = process.argv.includes("--verify-pack");
const packageLabel = "@ferrum2d/agents";
const expectedFiles = ["LICENSE", "README.md", "bin", "templates"];
const skills = [
  "ferrum-consumer-project",
  "ferrum-consumer-architecture",
  "ferrum-consumer-game-spec",
  "ferrum-consumer-asset-pipeline",
  "ferrum-consumer-gameplay",
  "ferrum-consumer-playtest",
  "ferrum-consumer-build",
];
const agents = [
  "consumer-project-agent",
  "consumer-architecture-agent",
  "consumer-game-spec-agent",
  "consumer-asset-agent",
  "consumer-gameplay-agent",
  "consumer-playtest-agent",
  "consumer-build-agent",
];
const geminiCommands = [
  "project",
  "architecture",
  "game-spec",
  "assets",
  "gameplay",
  "playtest",
  "build",
];
const agentSkillMap = new Map([
  ["consumer-project-agent", "ferrum-consumer-project"],
  ["consumer-architecture-agent", "ferrum-consumer-architecture"],
  ["consumer-game-spec-agent", "ferrum-consumer-game-spec"],
  ["consumer-asset-agent", "ferrum-consumer-asset-pipeline"],
  ["consumer-gameplay-agent", "ferrum-consumer-gameplay"],
  ["consumer-playtest-agent", "ferrum-consumer-playtest"],
  ["consumer-build-agent", "ferrum-consumer-build"],
]);
const codexAgentNameMap = new Map([
  ["consumer-project-agent", "consumer_project_agent"],
  ["consumer-architecture-agent", "consumer_architecture_agent"],
  ["consumer-game-spec-agent", "consumer_game_spec_agent"],
  ["consumer-asset-agent", "consumer_asset_agent"],
  ["consumer-gameplay-agent", "consumer_gameplay_agent"],
  ["consumer-playtest-agent", "consumer_playtest_agent"],
  ["consumer-build-agent", "consumer_build_agent"],
]);
const geminiCommandSkillMap = new Map([
  ["project", "ferrum-consumer-project"],
  ["architecture", "ferrum-consumer-architecture"],
  ["game-spec", "ferrum-consumer-game-spec"],
  ["assets", "ferrum-consumer-asset-pipeline"],
  ["gameplay", "ferrum-consumer-gameplay"],
  ["playtest", "ferrum-consumer-playtest"],
  ["build", "ferrum-consumer-build"],
]);
const expectedTemplateFiles = [
  "shared/.agents/harness/ferrum-game-development.md",
  "shared/.agents/harness/ferrum-runtime-replay.md",
  ...skills.map((skill) => `shared/.agents/skills/${skill}/SKILL.md`),
  "codex/.codex/config.toml",
  ...agents.map((agent) => `codex/.codex/agents/${agent}.toml`),
  ...agents.map((agent) => `claude/.claude/agents/${agent}.md`),
  ...skills.map((skill) => `claude/.claude/skills/${skill}/SKILL.md`),
  ...geminiCommands.map((command) => `gemini/.gemini/commands/ferrum/${command}.toml`),
];
const requiredPackedFiles = [
  "package/package.json",
  "package/LICENSE",
  "package/README.md",
  "package/bin/ferrum2d-agents.mjs",
  "package/templates/shared/.agents/harness/ferrum-game-development.md",
  "package/templates/shared/.agents/harness/ferrum-runtime-replay.md",
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
const packageReadmeFile = path.join(packageRoot, "README.md");
await requireFile(packageReadmeFile, repoRoot);
const packageReadmeSource = await readFile(packageReadmeFile, "utf8");
assert(
  packageReadmeSource.includes(".agents/harness/ferrum-runtime-replay.md"),
  "agents README must document installed runtime replay harness",
);
assert(
  packageReadmeSource.includes("createGameplayReplayRun") &&
    packageReadmeSource.includes("compareGameplayReplayRuns") &&
    packageReadmeSource.includes("hashGameStateSnapshot"),
  "agents README must document public gameplay replay helpers",
);
assertConsumerProjectileWeaponAuthoringContract(packageReadmeSource, packageReadmeFile);
assertConsumerRuntimeApplyContract(packageReadmeSource, packageReadmeFile);
assertConsumerAssetPipelineContract(packageReadmeSource, packageReadmeFile);
assertConsumerPlacementAuthoringContract(packageReadmeSource, packageReadmeFile);
assertCreateGameTemplateCatalogDiscovery(packageReadmeSource, packageReadmeFile);
assertForbiddenPublicImportBoundary(packageReadmeSource, packageReadmeFile);
assertNoForbiddenImportExamples(packageReadmeSource, packageReadmeFile);
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
      "package/templates/shared/.agents/skills/engine-",
      "package/templates/shared/.agents/skills/ferrum-engine-",
      "package/templates/shared/.agents/skills/ferrum-package-",
      "package/templates/shared/.agents/skills/ferrum-release-",
      "package/templates/shared/.agents/skills/ferrum-pages-",
      "package/templates/codex/.codex/agents/engine-",
      "package/templates/codex/.codex/agents/release-",
      "package/templates/codex/.codex/agents/package-",
      "package/templates/codex/.codex/agents/pages-",
      "package/templates/claude/.claude/agents/engine-",
      "package/templates/claude/.claude/agents/release-",
      "package/templates/claude/.claude/agents/package-",
      "package/templates/claude/.claude/agents/pages-",
      "package/templates/gemini/.gemini/agents/",
      "package/templates/gemini/.gemini/skills/",
    ],
  });
}

console.log("packages/agents package check ok");

async function checkTemplates() {
  await assertTemplateFileAllowlist();
  const gameDevelopmentHarnessFile = path.join(templatesRoot, "shared/.agents/harness/ferrum-game-development.md");
  const runtimeReplayHarnessFile = path.join(templatesRoot, "shared/.agents/harness/ferrum-runtime-replay.md");
  await requireFile(gameDevelopmentHarnessFile, repoRoot);
  await requireFile(runtimeReplayHarnessFile, repoRoot);

  const gameDevelopmentHarnessSource = await readFile(gameDevelopmentHarnessFile, "utf8");
  assert(
    gameDevelopmentHarnessSource.includes(".agents/harness/ferrum-runtime-replay.md"),
    "game development harness must point to project-specific runtime replay harness",
  );
  assertConsumerProjectileWeaponAuthoringContract(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertConsumerRuntimeApplyContract(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertConsumerAssetPipelineContract(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertConsumerPlacementAuthoringContract(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertCreateGameTemplateCatalogDiscovery(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertConsumerArchitectureContract(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertForbiddenPublicImportBoundary(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);
  assertNoForbiddenImportExamples(gameDevelopmentHarnessSource, gameDevelopmentHarnessFile);

  const runtimeReplayHarnessSource = await readFile(runtimeReplayHarnessFile, "utf8");
  assertRuntimeReplayHarnessContract(runtimeReplayHarnessSource, runtimeReplayHarnessFile);

  for (const skill of skills) {
    const sharedFile = path.join(templatesRoot, `shared/.agents/skills/${skill}/SKILL.md`);
    const sharedSource = await readFile(sharedFile, "utf8");
    assertFrontmatterField(sharedSource, "name", skill, sharedFile);
    assertFrontmatterExists(sharedSource, "description", sharedFile);
    assert(sharedSource.includes("Do not use"), `${path.relative(repoRoot, sharedFile)} must define hard boundaries`);
    if (skill === "ferrum-consumer-project") {
      assertCreateGameTemplateCatalogDiscovery(sharedSource, sharedFile);
    }
    if (skill === "ferrum-consumer-game-spec") {
      assertConsumerProjectileWeaponAuthoringContract(sharedSource, sharedFile);
      assert(
        sharedSource.includes("npm run ferrum:authoring-report") &&
          sharedSource.includes("npm run ferrum:replay-report"),
        `${path.relative(repoRoot, sharedFile)} must require authoring and replay report checks for data-driven gameplay`,
      );
    }
    if (skill === "ferrum-consumer-asset-pipeline") {
      assertConsumerAssetPipelineContract(sharedSource, sharedFile);
      assertForbiddenPublicImportBoundary(sharedSource, sharedFile);
      assertNoForbiddenImportExamples(sharedSource, sharedFile);
    }
    if (skill === "ferrum-consumer-architecture") {
      assertConsumerArchitectureContract(sharedSource, sharedFile);
      assertForbiddenPublicImportBoundary(sharedSource, sharedFile);
      assertNoForbiddenImportExamples(sharedSource, sharedFile);
    }
    if (skill === "ferrum-consumer-gameplay") {
      assert(
        sharedSource.includes(".agents/harness/ferrum-runtime-replay.md"),
        `${path.relative(repoRoot, sharedFile)} must point to project-specific runtime replay harness`,
      );
      assert(
        sharedSource.includes("createGameplayReplayRun") &&
          sharedSource.includes("compareGameplayReplayRuns") &&
          sharedSource.includes("hashGameStateSnapshot"),
        `${path.relative(repoRoot, sharedFile)} must name public gameplay replay helpers`,
      );
      assertConsumerProjectileWeaponAuthoringContract(sharedSource, sharedFile);
      assertConsumerRuntimeApplyContract(sharedSource, sharedFile);
      assertConsumerPlacementAuthoringContract(sharedSource, sharedFile);
      assertForbiddenPublicImportBoundary(sharedSource, sharedFile);
      assertNoForbiddenImportExamples(sharedSource, sharedFile);
    }

    const claudeSkillFile = path.join(templatesRoot, `claude/.claude/skills/${skill}/SKILL.md`);
    const claudeSkillSource = await readFile(claudeSkillFile, "utf8");
    assertFrontmatterField(claudeSkillSource, "name", skill, claudeSkillFile);
    assert(claudeSkillSource.includes(`.agents/skills/${skill}/SKILL.md`), `${path.relative(repoRoot, claudeSkillFile)} must point to canonical skill`);
  }

  for (const agent of agents) {
    const expectedSkill = agentSkillMap.get(agent);
    const expectedCodexName = codexAgentNameMap.get(agent);
    assert(expectedSkill !== undefined, `missing expected skill mapping for ${agent}`);
    assert(expectedCodexName !== undefined, `missing expected Codex name mapping for ${agent}`);
    const codexFile = path.join(templatesRoot, `codex/.codex/agents/${agent}.toml`);
    const codexSource = await readFile(codexFile, "utf8");
    assert(
      new RegExp(`^name\\s*=\\s*"${escapeRegExp(expectedCodexName)}"$`, "m").test(codexSource),
      `${path.relative(repoRoot, codexFile)} must define Codex name ${expectedCodexName}`,
    );
    assert(/^description\s*=\s*"/m.test(codexSource), `${path.relative(repoRoot, codexFile)} must define Codex description`);
    assert(/^developer_instructions\s*=\s*"""/m.test(codexSource), `${path.relative(repoRoot, codexFile)} must define Codex instructions`);
    assert(codexSource.includes(`Use the ${expectedSkill} skill.`), `${path.relative(repoRoot, codexFile)} must reference ${expectedSkill}`);
    assert(codexSource.includes("Do not"), `${path.relative(repoRoot, codexFile)} must include boundaries`);

    const claudeFile = path.join(templatesRoot, `claude/.claude/agents/${agent}.md`);
    const claudeSource = await readFile(claudeFile, "utf8");
    assertFrontmatterField(claudeSource, "name", agent, claudeFile);
    assertFrontmatterExists(claudeSource, "description", claudeFile);
    const skillRefs = [...frontmatter(claudeSource, claudeFile).matchAll(/^\s*-\s+(ferrum-consumer-[a-z-]+)$/gm)].map((match) => match[1]);
    assert(skillRefs.length === 1, `${path.relative(repoRoot, claudeFile)} must reference exactly one skill`);
    assert(skills.includes(skillRefs[0]), `${path.relative(repoRoot, claudeFile)} references unknown skill ${skillRefs[0]}`);
    assert(skillRefs[0] === expectedSkill, `${path.relative(repoRoot, claudeFile)} must reference ${expectedSkill}`);

  }

  const codexConfigFile = path.join(templatesRoot, "codex/.codex/config.toml");
  const codexConfigSource = await readFile(codexConfigFile, "utf8");
  assert(codexConfigSource.includes("[agents]"), "Codex template config must define [agents]");
  assert(codexConfigSource.includes("max_depth = 1"), "Codex template config must limit subagent depth");

  for (const command of geminiCommands) {
    const expectedSkill = geminiCommandSkillMap.get(command);
    assert(expectedSkill !== undefined, `missing expected Gemini skill mapping for ${command}`);
    const geminiFile = path.join(templatesRoot, `gemini/.gemini/commands/ferrum/${command}.toml`);
    const geminiSource = await readFile(geminiFile, "utf8");
    assert(/^description\s*=\s*"/m.test(geminiSource), `${path.relative(repoRoot, geminiFile)} must define Gemini command description`);
    assert(/^prompt\s*=\s*"""/m.test(geminiSource), `${path.relative(repoRoot, geminiFile)} must define Gemini command prompt`);
    assert(
      geminiSource.includes(`.agents/skills/${expectedSkill}/SKILL.md`),
      `${path.relative(repoRoot, geminiFile)} must reference canonical ${expectedSkill} skill`,
    );
    assert(geminiSource.includes(".agents/harness/ferrum-game-development.md"), `${path.relative(repoRoot, geminiFile)} must reference shared harness`);
  }

  const geminiAgentsPath = path.join(templatesRoot, "gemini/.gemini/agents");
  assert(!await hasFiles(geminiAgentsPath), "Gemini template must not include unsupported .gemini/agents files");

  const geminiSkillsPath = path.join(templatesRoot, "gemini/.gemini/skills");
  assert(!await hasFiles(geminiSkillsPath), "Gemini template must not include .gemini/skills wrappers");
}

async function assertTemplateFileAllowlist() {
  const actualFiles = new Set(await listFilesRecursive(templatesRoot));
  const expectedFiles = new Set(expectedTemplateFiles);
  for (const expectedFile of expectedFiles) {
    assert(actualFiles.has(expectedFile), `agents template is missing expected consumer file ${expectedFile}`);
  }
  for (const actualFile of actualFiles) {
    assert(expectedFiles.has(actualFile), `agents template must not include non-consumer file ${actualFile}`);
    assert(!actualFile.includes("engine-"), `agents template must not include engine agent or skill file ${actualFile}`);
    assert(!actualFile.includes("release"), `agents template must not include release agent or skill file ${actualFile}`);
    assert(!actualFile.includes("package-qa"), `agents template must not include package QA agent or skill file ${actualFile}`);
    assert(!actualFile.includes("pages-deploy"), `agents template must not include pages deploy agent or skill file ${actualFile}`);
  }
}

async function listFilesRecursive(directoryPath, basePath = directoryPath) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath, basePath));
    } else if (entry.isFile()) {
      files.push(path.relative(basePath, entryPath).split(path.sep).join("/"));
    }
  }
  return files.sort();
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
    await requireFile(path.join(targetRoot, ".agents/harness/ferrum-runtime-replay.md"), repoRoot);
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

function assertRuntimeReplayHarnessContract(source, filePath) {
  assert(
    source.includes("Project-Specific Runtime Replay") || source.includes("Consumer Runtime Replay Harness"),
    `${path.relative(repoRoot, filePath)} must describe project-specific runtime replay`,
  );
  assert(
    source.includes("createGameplayReplayRun") &&
      source.includes("compareGameplayReplayRuns") &&
      source.includes("hashGameStateSnapshot"),
    `${path.relative(repoRoot, filePath)} must name public gameplay replay helpers`,
  );
  assert(
    source.includes("coverageTagDefinitions") &&
      source.includes("coverageTagGroups") &&
      source.includes("deprecatedCoverageTags"),
    `${path.relative(repoRoot, filePath)} must describe consumer replay coverage registry shape`,
  );
  assert(
    source.includes("FERRUM_CONSUMER_RUNTIME_REPLAY_MISMATCH") &&
      source.includes("FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED") &&
      source.includes("patchCandidate") &&
      source.includes("ferrum:update-runtime-replay-fixture"),
    `${path.relative(repoRoot, filePath)} must describe mismatch diagnostics and explicit fixture updates`,
  );
  assert(
    source.includes("runtimeGameplayReplay.snapshots.N.snapshot") &&
      source.includes("format") &&
      source.includes("version") &&
      source.includes("ok") &&
      source.includes("reports[]") &&
      source.includes("runtimeGameplayReplay.status") &&
      source.includes("comparison") &&
      source.includes("expected") &&
      source.includes("actual") &&
      source.includes("suggestion"),
    `${path.relative(repoRoot, filePath)} must require machine-actionable replay diff reports and report envelope fields`,
  );
  assert(
    source.includes("Do not update a fixture to hide an unexplained regression"),
    `${path.relative(repoRoot, filePath)} must forbid unexplained fixture updates`,
  );
  assertForbiddenPublicImportBoundary(source, filePath);
  assertNoForbiddenImportExamples(source, filePath);
}

function assertConsumerProjectileWeaponAuthoringContract(source, filePath) {
  assert(
    source.includes("ProjectileDefinition") &&
      source.includes("WeaponDefinition") &&
      source.includes("compileWeaponProfiles") &&
      source.includes("behaviorRecipeCommandsForEntity"),
    `${path.relative(repoRoot, filePath)} must document projectile/weapon authoring helpers`,
  );
}

function assertConsumerRuntimeApplyContract(source, filePath) {
  assert(
    source.includes("applyGameplayBehaviorCommands") &&
      source.includes("setInputActionBinding") &&
      source.includes("builtInShooterPlayerHandle"),
    `${path.relative(repoRoot, filePath)} must document public runtime apply helpers for compiled behavior commands`,
  );
}

function assertConsumerPlacementAuthoringContract(source, filePath) {
  assert(
    source.includes("placementAuthoring") &&
      source.includes("instanceId") &&
      source.includes("previewScenePlacementBindingMigration") &&
      source.includes("behaviorRecipes"),
    `${path.relative(repoRoot, filePath)} must document placement-driven behavior authoring workflow`,
  );
}

function assertConsumerAssetPipelineContract(source, filePath) {
  assert(
    source.includes("import -> validate -> Game Spec") &&
      source.includes("packTextureAtlas") &&
      source.includes("textureAtlasDocumentToShooterAtlas") &&
      source.includes("importAsepriteAtlas") &&
      source.includes("importTiledGameSpec") &&
      source.includes("importLDtkGameSpec") &&
      source.includes("AudioAssetLoader") &&
      source.includes("LocalizationBundle") &&
      source.includes("npm run ferrum:validate"),
    `${path.relative(repoRoot, filePath)} must document consumer asset import, validation, and Game Spec update workflow`,
  );
}

function assertCreateGameTemplateCatalogDiscovery(source, filePath) {
  assert(
    source.includes("npx @ferrum2d/create-game --list-templates --json") &&
      source.includes("sceneAuthoring") &&
      source.includes("gameplayReplay") &&
      source.includes("runtimeGameplayReplay"),
    `${path.relative(repoRoot, filePath)} must document machine-readable create-game template catalog discovery`,
  );
}

function assertConsumerArchitectureContract(source, filePath) {
  assert(
    source.includes("src/main.ts") &&
      source.includes("bootstrap") &&
      source.includes("src/runtime/") &&
      source.includes("src/game/") &&
      source.includes("src/assets/") &&
      source.includes("src/ui/") &&
      source.includes("src/dev/") &&
      source.includes("tests/playtest/"),
    `${path.relative(repoRoot, filePath)} must document consumer architecture module boundaries`,
  );
}

function assertForbiddenPublicImportBoundary(source, filePath) {
  assert(
    source.includes("@ferrum2d/ferrum-web") &&
      source.includes("@ferrum2d/ferrum-web/dist/*") &&
      source.includes("@ferrum2d/ferrum-web/pkg/*") &&
      source.includes("@ferrum2d/ferrum-web/src/*"),
    `${path.relative(repoRoot, filePath)} must document public entrypoint and forbidden internal imports`,
  );
}

function assertNoForbiddenImportExamples(source, filePath) {
  const forbiddenImport = /\bfrom\s+["']@ferrum2d\/ferrum-web\/(?:dist|pkg|src)(?:\/[^"']*)?["']/;
  assert(
    !forbiddenImport.test(source),
    `${path.relative(repoRoot, filePath)} must not include import examples from ferrum-web internals`,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
