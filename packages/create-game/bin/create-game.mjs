#!/usr/bin/env node
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGithubRelease } from "./github-release.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(packageRoot, "templates");
const sharedTemplateRoot = path.join(templatesRoot, "_shared");
const defaultTemplate = "minimal";
const defaultFerrumVersion = "^0.1.0";
const defaultAuthoringViewerVersion = "^0.1.0";
const SCENE_AUTHORING_FORMAT = "ferrum2d.consumer.scene-authoring";

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.listTemplates) {
    await printTemplateList({ json: options.json });
    process.exit(0);
  }

  if (options.json) {
    throw new Error("--json can only be used with --list-templates.");
  }

  if (!options.projectDir) {
    console.error("Missing project directory.");
    printHelp();
    process.exit(1);
  }

  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const release = resolveGithubRelease(options, packageJson);
  await createGameProject({ ...options, release });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    authoringViewerVersion: undefined,
    ferrumVersion: undefined,
    githubRelease: undefined,
    githubRepository: undefined,
    force: false,
    help: false,
    json: false,
    listTemplates: false,
    projectDir: undefined,
    template: defaultTemplate,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--list-templates") {
      parsed.listTemplates = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--github-release" || arg.startsWith("--github-release=")) {
      parsed.githubRelease = arg.includes("=") ? arg.slice("--github-release=".length) : requireValue(args, index, arg);
      if (arg === "--github-release") index += 1;
      continue;
    }
    if (arg === "--github-repository" || arg.startsWith("--github-repository=")) {
      parsed.githubRepository = arg.includes("=") ? arg.slice("--github-repository=".length) : requireValue(args, index, arg);
      if (arg === "--github-repository") index += 1;
      continue;
    }
    if (arg === "--template") {
      parsed.template = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--template=")) {
      parsed.template = arg.slice("--template=".length);
      continue;
    }
    if (arg === "--ferrum-version") {
      parsed.ferrumVersion = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ferrum-version=")) {
      parsed.ferrumVersion = arg.slice("--ferrum-version=".length);
      continue;
    }
    if (arg === "--authoring-viewer-version") {
      parsed.authoringViewerVersion = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--authoring-viewer-version=")) {
      parsed.authoringViewerVersion = arg.slice("--authoring-viewer-version=".length);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (parsed.projectDir !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    parsed.projectDir = arg;
  }

  return parsed;
}

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${optionName}.`);
  }
  return value;
}

async function createGameProject({ authoringViewerVersion, ferrumVersion, force, projectDir, template, release }) {
  const catalog = await loadTemplateCatalog();
  const templateIds = catalog.templates.map((entry) => entry.id);
  const templateEntry = catalog.templates.find((entry) => entry.id === template);
  if (!templateEntry) {
    throw new Error(`Unknown template '${template}'. Available templates: ${templateIds.join(", ")}.`);
  }
  const templateRoot = path.resolve(templatesRoot, templateEntry.id);
  assertInsideDirectory(
    templatesRoot,
    templateRoot,
    `Template '${templateEntry.id}' resolves outside the templates directory.`,
  );
  await requireDirectory(
    templateRoot,
    `Template '${templateEntry.id}' is listed in manifest but its directory is missing.`,
  );

  const targetRoot = path.resolve(process.cwd(), projectDir);
  const targetName = path.basename(targetRoot);
  const packageName = toPackageName(targetName);
  const projectTitle = toTitle(targetName);

  await assertWritableTarget(targetRoot, force);
  await requireDirectory(
    sharedTemplateRoot,
    "Shared create-game template scaffold is missing.",
  );
  const replacements = {
    __FERRUM_AUTHORING_VIEWER_VERSION__: release?.viewer ?? authoringViewerVersion ?? defaultAuthoringViewerVersion,
    __FERRUM_WEB_VERSION__: release?.runtime ?? ferrumVersion ?? defaultFerrumVersion,
    __PROJECT_NAME__: packageName,
    __PROJECT_TITLE__: projectTitle,
  };
  await copyTemplate(sharedTemplateRoot, targetRoot, replacements);
  await copyTemplate(templateRoot, targetRoot, replacements);

  if (release) {
    const manifestPath = path.join(targetRoot, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.ferrumGithubRelease = { repository: release.repository, version: release.version, tag: release.tag };
    manifest.scripts["ferrum:agents"] = `npx --yes --allow-remote=root --package=${release.agents} ferrum2d-agents init --tools codex,claude,gemini`;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    // npm 12 requires explicit permission for direct URL dependencies. Preserve
    // an existing project's policy even when --force was used for the template.
    try {
      await writeFile(path.join(targetRoot, ".npmrc"), "# Ferrum2D GitHub Release direct dependencies\nallow-remote=root\n", { flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await writeFile(path.join(targetRoot, "FERRUM_INSTALL.md"), `# Ferrum2D 설치 정보\n\n` +
      `GitHub Release: https://github.com/${release.repository}/releases/tag/${release.tag}\n\n` +
      `엔진과 authoring viewer는 ${release.version} 릴리스 URL에 고정되어 있다.\n` +
      `Node.js 22 권장. npm install 후 npm run dev로 개발한다. Rust 빌드는 필요 없다.\n\n` +
      `AI 개발 도구 지침 설치(선택): npm run ferrum:agents\n` +
      `이 명령은 명시적으로 실행했을 때만 agent/skill 파일을 생성한다.\n\n` +
      `package-lock.json을 버전 관리에 포함하고 재설치에는 npm ci를 사용한다.\n` +
      `새 .npmrc는 npm 12의 직접 URL 의존성 설치를 위해 allow-remote=root를 설정한다. 기존 .npmrc는 보존한다.\n` +
      `EALLOWREMOTE 오류가 나면 프로젝트 정책을 확인하고 npm install --allow-remote=root로 실행한다.\n` +
      `릴리스 파일이 없거나 접근할 수 없으면 URL과 GitHub Release 공개 상태를 확인한다.\n`);
  }

  console.log(`Created Ferrum2D game project at ${targetRoot}`);
  console.log("");
  console.log(process.platform === "win32" ? "Next steps (PowerShell):" : "Next steps:");
  console.log(`  ${formatDirectoryCommand(targetRoot)}`);
  console.log("  npm install");
  console.log("  npm run dev");
  console.log("");
  console.log("For AI-assisted game development:");
  console.log(release ? "  npm run ferrum:agents" : "  npx @ferrum2d/agents init --tools codex,claude,gemini");
}

function formatDirectoryCommand(targetRoot) {
  const relativePath = path.relative(process.cwd(), targetRoot);
  let directory = !relativePath ? "."
    : relativePath === ".." || relativePath.startsWith(`..${path.sep}`) ? targetRoot : relativePath;
  if (process.platform === "win32") {
    return `Set-Location -LiteralPath '${directory.replace(/'/g, "''")}'`;
  }
  if (directory.startsWith("-")) directory = `./${directory}`;
  return `cd '${directory.replace(/'/g, "'\\''")}'`;
}

async function loadTemplateCatalog() {
  const source = await readFile(path.join(templatesRoot, "manifest.json"), "utf8");
  const catalog = JSON.parse(source);
  assertPlainObject(catalog, "Invalid template manifest: manifest must be an object.");
  if (catalog.format !== "ferrum-create-game-template-catalog") {
    throw new Error("Invalid template manifest: format must be ferrum-create-game-template-catalog.");
  }
  if (catalog.version !== 1) {
    throw new Error("Invalid template manifest: version must be 1.");
  }
  if (!Array.isArray(catalog.templates)) {
    throw new Error("Invalid template manifest: templates must be an array.");
  }
  const ids = new Set();
  for (const template of catalog.templates) {
    assertPlainObject(template, "Invalid template manifest: template entries must be objects.");
    if (typeof template.id !== "string" || !/^[a-z0-9-]+$/.test(template.id)) {
      throw new Error("Invalid template manifest: template ids must use lowercase letters, numbers, and hyphens.");
    }
    if (ids.has(template.id)) {
      throw new Error(`Invalid template manifest: duplicate template id '${template.id}'.`);
    }
    assertNonEmptyString(template.description, `Invalid template manifest: template '${template.id}' description must be a non-empty string.`);
    validateTemplateSceneAuthoringCatalog(template);
    await validateTemplateSceneAuthoringFixture(template);
    validateTemplateReplayCatalog(template, "gameplayReplay", "public/gameplay-replay.fixture.json", "public/gameplay-replay.coverage-tags.json");
    validateTemplateReplayCatalog(
      template,
      "runtimeGameplayReplay",
      "public/gameplay-runtime-replay.fixture.json",
      "public/gameplay-runtime-replay.coverage-tags.json",
    );
    ids.add(template.id);
  }
  if (typeof catalog.defaultTemplate !== "string" || !ids.has(catalog.defaultTemplate)) {
    throw new Error("Invalid template manifest: defaultTemplate must reference a listed template id.");
  }
  return catalog;
}

function validateTemplateSceneAuthoringCatalog(template) {
  const sceneAuthoring = template.sceneAuthoring;
  assertPlainObject(sceneAuthoring, `Invalid template manifest: template '${template.id}' sceneAuthoring must be an object.`);
  if (typeof sceneAuthoring.configured !== "boolean") {
    throw new Error(`Invalid template manifest: template '${template.id}' sceneAuthoring.configured must be a boolean.`);
  }
  if (sceneAuthoring.configured) {
    assertNonEmptyString(
      sceneAuthoring.fixturePath,
      `Invalid template manifest: template '${template.id}' sceneAuthoring.fixturePath must be a non-empty string.`,
    );
    if (sceneAuthoring.fixturePath !== "public/scene-authoring.json") {
      throw new Error(`Invalid template manifest: template '${template.id}' sceneAuthoring.fixturePath must be public/scene-authoring.json.`);
    }
    if (sceneAuthoring.format !== SCENE_AUTHORING_FORMAT) {
      throw new Error(`Invalid template manifest: template '${template.id}' sceneAuthoring.format must be ${SCENE_AUTHORING_FORMAT}.`);
    }
  } else {
    assertNonEmptyString(
      sceneAuthoring.reason,
      `Invalid template manifest: template '${template.id}' sceneAuthoring.reason must be a non-empty string.`,
    );
    if (sceneAuthoring.fixturePath !== undefined || sceneAuthoring.format !== undefined) {
      throw new Error(`Invalid template manifest: template '${template.id}' unconfigured sceneAuthoring must not include fixturePath or format.`);
    }
  }
}

async function validateTemplateSceneAuthoringFixture(template) {
  const sceneAuthoring = template.sceneAuthoring;
  if (!sceneAuthoring.configured) {
    return;
  }
  const fixturePath = path.join(templatesRoot, template.id, sceneAuthoring.fixturePath);
  assertInsideDirectory(
    path.join(templatesRoot, template.id),
    fixturePath,
    `Invalid template manifest: template '${template.id}' sceneAuthoring.fixturePath resolves outside the template directory.`,
  );
  let fixture;
  try {
    fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid template manifest: template '${template.id}' scene authoring fixture is unreadable: ${detail}`);
  }
  assertPlainObject(fixture, `Invalid template manifest: template '${template.id}' scene authoring fixture must be an object.`);
  if (fixture.format !== SCENE_AUTHORING_FORMAT) {
    throw new Error(`Invalid template manifest: template '${template.id}' scene authoring fixture format must be ${SCENE_AUTHORING_FORMAT}.`);
  }
  if (fixture.version !== 1) {
    throw new Error(`Invalid template manifest: template '${template.id}' scene authoring fixture version must be 1.`);
  }
  assertPlainObject(
    fixture.sceneComposition,
    `Invalid template manifest: template '${template.id}' scene authoring fixture sceneComposition must be an object.`,
  );
  assertPlainObject(
    fixture.behaviorRecipes,
    `Invalid template manifest: template '${template.id}' scene authoring fixture behaviorRecipes must be an object.`,
  );
}

function validateTemplateReplayCatalog(template, key, expectedFixturePath, expectedCoveragePath) {
  const replay = template[key];
  assertPlainObject(replay, `Invalid template manifest: template '${template.id}' ${key} must be an object.`);
  if (typeof replay.configured !== "boolean") {
    throw new Error(`Invalid template manifest: template '${template.id}' ${key}.configured must be a boolean.`);
  }
  if (replay.configured) {
    assertNonEmptyString(replay.scenario, `Invalid template manifest: template '${template.id}' ${key}.scenario must be a non-empty string.`);
    if (replay.fixturePath !== expectedFixturePath) {
      throw new Error(`Invalid template manifest: template '${template.id}' ${key}.fixturePath must be ${expectedFixturePath}.`);
    }
    if (replay.coverageTagDefinitionsPath !== expectedCoveragePath) {
      throw new Error(`Invalid template manifest: template '${template.id}' ${key}.coverageTagDefinitionsPath must be ${expectedCoveragePath}.`);
    }
  } else {
    assertNonEmptyString(replay.reason, `Invalid template manifest: template '${template.id}' ${key}.reason must be a non-empty string.`);
    if (replay.scenario !== undefined || replay.fixturePath !== undefined || replay.coverageTagDefinitionsPath !== undefined) {
      throw new Error(`Invalid template manifest: template '${template.id}' unconfigured ${key} must not include scenario, fixturePath, or coverageTagDefinitionsPath.`);
    }
  }
}

function assertPlainObject(value, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertNonEmptyString(value, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(message);
  }
}

async function printTemplateList({ json = false } = {}) {
  const catalog = await loadTemplateCatalog();
  if (json) {
    console.log(JSON.stringify(templateCatalogListReport(catalog), null, 2));
    return;
  }
  console.log("Available Ferrum2D templates:");
  for (const template of catalog.templates) {
    const recommended = template.id === catalog.defaultTemplate ? " (default)" : "";
    console.log(`  ${template.id}${recommended} - ${template.description}`);
  }
}

function templateCatalogListReport(catalog) {
  return {
    format: "ferrum-create-game-template-list",
    version: 1,
    defaultTemplate: catalog.defaultTemplate,
    templates: catalog.templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      genre: template.genre,
      tags: template.tags,
      sceneAuthoring: template.sceneAuthoring,
      gameplayReplay: template.gameplayReplay,
      runtimeGameplayReplay: template.runtimeGameplayReplay,
    })),
  };
}

async function requireDirectory(directoryPath, message) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) {
      throw new Error(message);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  }
}

function assertInsideDirectory(parentDirectory, childPath, message) {
  const relative = path.relative(parentDirectory, childPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
}

async function assertWritableTarget(targetRoot, force) {
  try {
    const stats = await stat(targetRoot);
    if (!stats.isDirectory()) {
      throw new Error(`Target exists and is not a directory: ${targetRoot}`);
    }
    const entries = await readdir(targetRoot);
    if (entries.length > 0 && !force) {
      throw new Error(`Target directory is not empty: ${targetRoot}. Pass --force to write into it.`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      await mkdir(targetRoot, { recursive: true });
      return;
    }
    throw error;
  }
}

async function copyTemplate(sourceRoot, targetRoot, replacements) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  await mkdir(targetRoot, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(sourcePath, targetPath, replacements);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const source = await readFile(sourcePath, "utf8");
    await writeFile(targetPath, replaceAll(source, replacements));
  }
}

function replaceAll(source, replacements) {
  let output = source;
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value);
  }
  return output;
}

function toPackageName(name) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+/, "")
    .replace(/[._-]+$/, "")
    .replace(/-{2,}/g, "-");
  return slug || "ferrum2d-game";
}

function toTitle(name) {
  const words = toPackageName(name).split(/[-_]+/).filter(Boolean);
  if (words.length === 0) return "Ferrum2D Game";
  return words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function printHelp() {
  console.log(`Usage:
  npm create @ferrum2d/game my-game
  npx @ferrum2d/create-game my-game [options]

Options:
  --template <name>          Template to use. Default: minimal
  --github-release <version-or-tag>
                             Pin dependencies to an exact GitHub beta release.
                             Release-built generators select their own release automatically.
  --github-repository <owner/repo>
                             GitHub repository. Default: silbaram/ferrum2d
  --list-templates           Print available templates
  --json                     With --list-templates, print a machine-readable template catalog
  --ferrum-version <range>   @ferrum2d/ferrum-web dependency range. Default: ^0.1.0
  --authoring-viewer-version <range>
                             @ferrum2d/authoring-viewer dependency range. Default: ^0.1.0
  --force                    Allow writing into a non-empty target directory
  -h, --help                 Show this help

GitHub Releases: run npx --yes --allow-remote=root <create-game .tgz asset URL> my-game.
Local/source generators retain registry defaults unless --github-release is supplied.
`);
}
