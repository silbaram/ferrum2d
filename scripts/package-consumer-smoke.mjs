#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = {
  ferrumWeb: path.join(repoRoot, "packages/ferrum-web"),
  createGame: path.join(repoRoot, "packages/create-game"),
  agents: path.join(repoRoot, "packages/agents"),
};
const repoPackageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
const packageManager = repoPackageJson.packageManager ?? "pnpm@10.8.0";

const options = parseArgs(process.argv.slice(2));
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const installArgs = [
  "install",
  "--ignore-scripts",
  "--frozen-lockfile=false",
  ...(options.offline ? ["--offline"] : []),
];

let tempRoot;
let failed = false;

if (options.help) {
  printHelp();
  process.exit(0);
}

const templateNames = await resolveTemplateMatrix(options.templates);

try {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-consumer-smoke-"));
  const tarballRoot = path.join(tempRoot, "tarballs");
  const toolConsumerRoot = path.join(tempRoot, "tool-consumer");
  const generatedGamesRoot = path.join(tempRoot, "sample-games");

  if (!options.skipBuild) {
    await runRequired(pnpm, ["build:wasm"], repoRoot);
    await runRequired(pnpm, ["--filter", "@ferrum2d/ferrum-web", "build"], repoRoot);
  }

  if (!options.skipPackageCheck) {
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/check-package-files.mjs"),
      "--require-wasm-pkg",
      "--verify-pack",
    ], repoRoot);
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/check-create-game-package.mjs"),
      "--verify-pack",
    ], repoRoot);
    await runRequired(process.execPath, [
      path.join(repoRoot, "scripts/check-agents-package.mjs"),
      "--verify-pack",
    ], repoRoot);
  }

  await mkdir(tarballRoot, { recursive: true });
  const ferrumWebTarball = await packPackage(packageRoots.ferrumWeb, tarballRoot);
  const createGameTarball = await packPackage(packageRoots.createGame, tarballRoot);
  const agentsTarball = await packPackage(packageRoots.agents, tarballRoot);

  await writeToolConsumerPackage(toolConsumerRoot, {
    createGameTarball,
    agentsTarball,
  });
  await runRequired(pnpm, installArgs, toolConsumerRoot);

  for (const templateName of templateNames) {
    await runGeneratedGameConsumer({
      ferrumWebTarball,
      generatedGamesRoot,
      templateName,
      toolConsumerRoot,
    });
  }

  console.log("package consumer smoke ok");
  console.log(JSON.stringify({
    ferrumWebTarball: path.basename(ferrumWebTarball),
    createGameTarball: path.basename(createGameTarball),
    agentsTarball: path.basename(agentsTarball),
    templates: templateNames,
    installMode: options.offline ? "offline" : "online",
    artifactDir: options.artifactDir,
    tempRoot: options.keepTemp ? tempRoot : undefined,
  }, null, 2));
} catch (error) {
  failed = true;
  await preserveFailureArtifacts(error);
  throw error;
} finally {
  if (tempRoot && !options.keepTemp) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(args) {
  const parsed = {
    help: false,
    keepTemp: false,
    offline: false,
    skipBuild: false,
    skipPackageCheck: false,
    templates: undefined,
    artifactDir: process.env.FERRUM_CONSUMER_SMOKE_ARTIFACT_DIR,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--keep-temp") {
      parsed.keepTemp = true;
    } else if (arg === "--offline") {
      parsed.offline = true;
    } else if (arg === "--no-offline") {
      parsed.offline = false;
    } else if (arg === "--skip-build") {
      parsed.skipBuild = true;
    } else if (arg === "--skip-package-check") {
      parsed.skipPackageCheck = true;
    } else if (arg.startsWith("--templates=")) {
      parsed.templates = parseTemplateList(arg.slice("--templates=".length));
    } else if (arg === "--templates") {
      const next = args[index + 1];
      assert(next, "--templates requires a comma-separated template list");
      parsed.templates = parseTemplateList(next);
      index += 1;
    } else if (arg.startsWith("--artifact-dir=")) {
      parsed.artifactDir = arg.slice("--artifact-dir=".length);
    } else if (arg === "--artifact-dir") {
      const next = args[index + 1];
      assert(next, "--artifact-dir requires a path");
      parsed.artifactDir = next;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function parseTemplateList(value) {
  const templates = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  assert(templates.length > 0, "--templates must include at least one template name");
  return [...new Set(templates)];
}

async function resolveTemplateMatrix(requestedTemplates) {
  const availableTemplates = await listCreateGameTemplates();
  assert(availableTemplates.length > 0, "create-game package must include at least one template");
  if (requestedTemplates === undefined) {
    return availableTemplates;
  }

  const unknown = requestedTemplates.filter((templateName) => !availableTemplates.includes(templateName));
  assert(
    unknown.length === 0,
    `unknown create-game template(s): ${unknown.join(", ")}. Available: ${availableTemplates.join(", ")}`,
  );
  return requestedTemplates;
}

async function listCreateGameTemplates() {
  const entries = await readdir(path.join(packageRoots.createGame, "templates"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function runGeneratedGameConsumer({
  ferrumWebTarball,
  generatedGamesRoot,
  templateName,
  toolConsumerRoot,
}) {
  const generatedGameRoot = path.join(generatedGamesRoot, templateName);
  await runRequired(pnpm, [
    "exec",
    "create-ferrum2d-game",
    generatedGameRoot,
    "--template",
    templateName,
    "--ferrum-version",
    fileDependency(ferrumWebTarball),
  ], toolConsumerRoot);
  await pinGeneratedPackageManager(generatedGameRoot);

  await runRequired(pnpm, [
    "exec",
    "ferrum2d-agents",
    "init",
    "--target",
    generatedGameRoot,
    "--tools",
    "codex,claude,gemini",
    "--dry-run",
  ], toolConsumerRoot);
  await assertMissing(path.join(generatedGameRoot, ".agents"), "agents dry-run must not create .agents");
  await assertMissing(path.join(generatedGameRoot, ".codex"), "agents dry-run must not create .codex");
  await assertMissing(path.join(generatedGameRoot, ".claude"), "agents dry-run must not create .claude");
  await assertMissing(path.join(generatedGameRoot, ".gemini"), "agents dry-run must not create .gemini");

  await runRequired(pnpm, installArgs, generatedGameRoot);
  await writePublicImportSmoke(generatedGameRoot);
  await writePublicTypesSmoke(generatedGameRoot);
  await runRequired(process.execPath, ["scripts/package-import-smoke.mjs"], generatedGameRoot);
  await runRequired(pnpm, [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "ESNext",
    "--moduleResolution",
    "Bundler",
    "--lib",
    "ESNext,DOM",
    "scripts/package-type-smoke.ts",
  ], generatedGameRoot);
  await runRequired(pnpm, ["run", "ferrum:validate"], generatedGameRoot);
  await runRequired(pnpm, ["run", "build"], generatedGameRoot);
  await requireFile(
    path.join(generatedGameRoot, "dist/index.html"),
    `generated ${templateName} game build must emit dist/index.html`,
  );
}

async function packPackage(packageRoot, destination) {
  const before = new Set(await listTarballs(destination));
  await runRequired(pnpm, ["pack", "--pack-destination", destination], packageRoot);
  const after = await listTarballs(destination);
  const created = after.filter((entry) => !before.has(entry));
  assert(created.length === 1, `expected one new tarball from ${path.relative(repoRoot, packageRoot)}, found ${created.length}`);
  return path.join(destination, created[0]);
}

async function listTarballs(directory) {
  const entries = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.endsWith(".tgz")).sort();
}

async function writeToolConsumerPackage(targetRoot, { createGameTarball, agentsTarball }) {
  await mkdir(targetRoot, { recursive: true });
  await writeJson(path.join(targetRoot, "package.json"), {
    name: "ferrum2d-package-tool-consumer",
    private: true,
    packageManager,
    type: "module",
    devDependencies: {
      "@ferrum2d/create-game": fileDependency(createGameTarball),
      "@ferrum2d/agents": fileDependency(agentsTarball),
    },
  });
}

async function pinGeneratedPackageManager(targetRoot) {
  const packageJsonPath = path.join(targetRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.packageManager ??= packageManager;
  await writeJson(packageJsonPath, packageJson);
}

async function writePublicImportSmoke(targetRoot) {
  await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
  await writeFile(path.join(targetRoot, "scripts/package-import-smoke.mjs"), `import {
  AnimationTimelinePlayer,
  AudioManager,
  CameraRigController,
  CutsceneSequencePlayer,
  DialogueSession,
  LevelChunkStreamer,
  LocalizationBundle,
  QuestLog,
  RuntimeProfiler,
  ScreenFadeTransition,
  SCREENSHOT_CAPTURE_SUMMARY_FORMAT,
  TEXTURE_ATLAS_PACK_FORMAT,
  PARTICLE_VFX_PRESETS,
  SPRITE_MATERIAL_PRESETS,
  assetManifestFingerprint,
  applyPhysicsSceneProfile,
  applyAccessibilityToCameraRigSpec,
  behaviorRecipeCommandsForEntity,
  buildDebugGizmoLineBuffer,
  captureDialogueQuestState,
  resolveCutsceneSequenceSpec,
  createHudOverlayState,
  dialogueNodeToUiOverlayState,
  instantiateSceneFragment,
  createAssetPreloadCachePolicy,
  createFerrumRuntime,
  diagnosticReport,
  particleVfxPreset,
  resolveAnimationTimelineSpec,
  resolveAccessibilityOptions,
  resolveBehaviorRecipeDocument,
  resolveDialogueGraph,
  resolveFontLoadingPolicy,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
  resolveQuestDocument,
  resolvePostProcessPasses,
  resolveAccessibilityHudTheme,
  resolveHudTheme,
  summarizeScreenshotPixels,
  compareScreenshotSummaries,
  resolveSceneCompositionSpec,
  resolveSpriteMaterialPreset,
  resolveShooterGameSpec,
  packTextureAtlas,
  textureAtlasDocumentToShooterAtlas,
} from "@ferrum2d/ferrum-web";

if (typeof createFerrumRuntime !== "function") {
  throw new Error("createFerrumRuntime must be exported from the public entrypoint.");
}
if (typeof resolveAnimationTimelineSpec !== "function") {
  throw new Error("resolveAnimationTimelineSpec must be exported from the public entrypoint.");
}
if (typeof AnimationTimelinePlayer !== "function") {
  throw new Error("AnimationTimelinePlayer must be exported from the public entrypoint.");
}
const animationTimeline = resolveAnimationTimelineSpec({
  states: {
    idle: { frameCount: 1 },
  },
});
if (AnimationTimelinePlayer.create(animationTimeline).currentState() !== "idle") {
  throw new Error("AnimationTimelinePlayer must resolve and play public animation timeline specs.");
}
if (typeof resolveSceneCompositionSpec !== "function") {
  throw new Error("resolveSceneCompositionSpec must be exported from the public entrypoint.");
}
if (typeof instantiateSceneFragment !== "function") {
  throw new Error("instantiateSceneFragment must be exported from the public entrypoint.");
}
const sceneComposition = resolveSceneCompositionSpec({
  prefabs: { marker: { props: { kind: "marker" } } },
  fragments: { main: { instances: [{ id: "spawn", prefab: "marker" }] } },
});
if (instantiateSceneFragment(sceneComposition)[0]?.id !== "spawn") {
  throw new Error("scene composition helpers must resolve public prefab fragments.");
}
if (typeof resolveBehaviorRecipeDocument !== "function") {
  throw new Error("resolveBehaviorRecipeDocument must be exported from the public entrypoint.");
}
if (typeof behaviorRecipeCommandsForEntity !== "function") {
  throw new Error("behaviorRecipeCommandsForEntity must be exported from the public entrypoint.");
}
const behaviorRecipes = resolveBehaviorRecipeDocument({
  entities: {
    enemy: { recipes: [{ kind: "health", max: 2 }] },
  },
});
if (behaviorRecipeCommandsForEntity(behaviorRecipes, "enemy")[0]?.type !== "configureHealth") {
  throw new Error("behavior recipe helpers must emit public runtime adapter commands.");
}
if (typeof resolveHudTheme !== "function") {
  throw new Error("resolveHudTheme must be exported from the public entrypoint.");
}
if (typeof createHudOverlayState !== "function") {
  throw new Error("createHudOverlayState must be exported from the public entrypoint.");
}
if (createHudOverlayState([{ type: "meter", id: "hp", value: 1, max: 2 }]).panels?.[0]?.lines?.[0]?.value !== "50%") {
  throw new Error("HUD toolkit helpers must create public overlay state presets.");
}
if (resolveHudTheme("high-contrast").panelBorder !== "#ffffff") {
  throw new Error("HUD toolkit theme presets must resolve from the public entrypoint.");
}
if (typeof resolveShooterGameSpec !== "function") {
  throw new Error("resolveShooterGameSpec must be exported from the public entrypoint.");
}
if (typeof RuntimeProfiler !== "function") {
  throw new Error("RuntimeProfiler must be exported from the public entrypoint.");
}
if (typeof AudioManager !== "function") {
  throw new Error("AudioManager must be exported from the public entrypoint.");
}
if (typeof CameraRigController !== "function") {
  throw new Error("CameraRigController must be exported from the public entrypoint.");
}
if (typeof ScreenFadeTransition !== "function") {
  throw new Error("ScreenFadeTransition must be exported from the public entrypoint.");
}
if (typeof resolvePostProcessPasses !== "function") {
  throw new Error("resolvePostProcessPasses must be exported from the public entrypoint.");
}
if (new CameraRigController({ x: 1 }).snapshot().x !== 1) {
  throw new Error("CameraRigController must expose public camera rig snapshots.");
}
if (ScreenFadeTransition.create({ durationSeconds: 1 }).update(0.5).opacity !== 0.5) {
  throw new Error("ScreenFadeTransition must expose public fade transition state.");
}
if (resolvePostProcessPasses({ opacity: 0.25 })[0]?.color?.[3] !== 0.25) {
  throw new Error("resolvePostProcessPasses must resolve public fullscreen fade passes.");
}
if (typeof resolveCutsceneSequenceSpec !== "function") {
  throw new Error("resolveCutsceneSequenceSpec must be exported from the public entrypoint.");
}
if (typeof CutsceneSequencePlayer !== "function") {
  throw new Error("CutsceneSequencePlayer must be exported from the public entrypoint.");
}
const cutscene = resolveCutsceneSequenceSpec({
  commands: [
    { kind: "wait", durationSeconds: 0.1 },
    { kind: "camera", target: { x: 8, y: 4 } },
    { kind: "audio", sound: "ding" },
    { kind: "dialogue", text: "Ready" },
  ],
});
if (CutsceneSequencePlayer.create(cutscene).update(0).events[0]?.command.kind !== "wait") {
  throw new Error("CutsceneSequencePlayer must emit public sequence command events.");
}
if (typeof resolveLevelChunkManifest !== "function") {
  throw new Error("resolveLevelChunkManifest must be exported from the public entrypoint.");
}
if (typeof resolveLevelStreamingPlan !== "function") {
  throw new Error("resolveLevelStreamingPlan must be exported from the public entrypoint.");
}
if (typeof LevelChunkStreamer !== "function") {
  throw new Error("LevelChunkStreamer must be exported from the public entrypoint.");
}
const levelManifest = resolveLevelChunkManifest({
  chunks: [
    { id: "0,0", chunkX: 0, chunkY: 0, tilemap: { url: "/chunks/0-0.json" } },
  ],
});
const levelPlan = resolveLevelStreamingPlan(levelManifest, { x: 0, y: 0, width: 16, height: 16 });
if (levelPlan.activeChunkIds[0] !== "0,0" || LevelChunkStreamer.create(levelManifest).plan({ x: 0, y: 0, width: 16, height: 16 }).loadChunkIds[0] !== "0,0") {
  throw new Error("level streaming helpers must expose public chunk planning.");
}
if (typeof buildDebugGizmoLineBuffer !== "function") {
  throw new Error("buildDebugGizmoLineBuffer must be exported from the public entrypoint.");
}
const debugGizmos = buildDebugGizmoLineBuffer({
  paths: [{ id: "route", points: [{ x: 0, y: 0 }, { x: 16, y: 0 }] }],
  spawns: [{ id: "spawn", x: 8, y: 8 }],
});
if (debugGizmos.bufferView.lineCount !== debugGizmos.lines.length || debugGizmos.lines[0]?.category !== "path") {
  throw new Error("debug gizmo helpers must produce public debug line buffers.");
}
if (typeof resolveAccessibilityOptions !== "function" || typeof applyAccessibilityToCameraRigSpec !== "function") {
  throw new Error("accessibility helpers must be exported from the public entrypoint.");
}
const accessibilityOptions = resolveAccessibilityOptions({
  reducedMotion: "system",
  contrastPalette: "high-contrast",
}, { environment: { prefersReducedMotion: true } });
if (!accessibilityOptions.reducedMotion || resolveAccessibilityHudTheme(accessibilityOptions).panelBackground !== "#000000") {
  throw new Error("accessibility helpers must resolve reduced motion and contrast palette.");
}
if (applyAccessibilityToCameraRigSpec({ smoothTimeSeconds: 0.5 }, accessibilityOptions).smoothTimeSeconds !== 0) {
  throw new Error("accessibility helpers must reduce camera motion.");
}
if (SCREENSHOT_CAPTURE_SUMMARY_FORMAT !== "ferrum-screenshot-capture-summary") {
  throw new Error("screenshot capture summary format must be exported from the public entrypoint.");
}
const screenshotSummary = summarizeScreenshotPixels(new Uint8Array([255, 255, 255, 255]), 1, 1);
if (!compareScreenshotSummaries(screenshotSummary, screenshotSummary, { maxAverageColorDelta: 0 }).passed) {
  throw new Error("screenshot capture helpers must compare screenshot summaries.");
}
if (typeof LocalizationBundle !== "function") {
  throw new Error("LocalizationBundle must be exported from the public entrypoint.");
}
if (typeof resolveFontLoadingPolicy !== "function") {
  throw new Error("resolveFontLoadingPolicy must be exported from the public entrypoint.");
}
const localization = LocalizationBundle.create({
  defaultLocale: "en",
  locales: {
    en: { strings: { greeting: "Hello, {name}" } },
  },
});
if (localization.t("greeting", { values: { name: "Ferrum" } }) !== "Hello, Ferrum") {
  throw new Error("LocalizationBundle must resolve public string tables.");
}
if (resolveFontLoadingPolicy({ defaultFamily: "Ferrum UI" }).cssFontFamily.includes("Ferrum UI") !== true) {
  throw new Error("resolveFontLoadingPolicy must resolve public font loading policy.");
}
if (typeof DialogueSession !== "function" || typeof QuestLog !== "function") {
  throw new Error("DialogueSession and QuestLog must be exported from the public entrypoint.");
}
const questDocument = resolveQuestDocument({
  quests: { tutorial: { title: "Tutorial" } },
});
const dialogueGraph = resolveDialogueGraph({
  initialNode: "start",
  nodes: {
    start: { text: "Ready?", choices: [{ id: "yes", label: "Yes", to: "done" }] },
    done: { text: "Done", end: true },
  },
});
const questLog = QuestLog.create(questDocument);
const dialogue = DialogueSession.create(dialogueGraph, questLog);
if (dialogueNodeToUiOverlayState(dialogue).dialog?.actions?.[0]?.id !== "yes") {
  throw new Error("dialogueNodeToUiOverlayState must expose public dialogue choices.");
}
dialogue.choose("yes");
if (captureDialogueQuestState(dialogue, questLog).dialogue?.nodeId !== "done") {
  throw new Error("captureDialogueQuestState must capture public dialogue state.");
}
const physicsSceneEngine = {
  configurePhysicsRuntime: (spec) => spec,
  configureAutoRigidBodyStep: (options) => {
    globalThis.__ferrumPhysicsSceneAutoStep = options;
  },
  spawnRigidBody: () => ({ entityId: 1, entityGeneration: 1 }),
  despawnPhysicsEntity: () => true,
  clearPhysicsJoint: () => true,
};
const physicsScene = applyPhysicsSceneProfile(physicsSceneEngine, {
  physics: {
    mode: "rigid",
    bodies: {
      crate: { type: "dynamic", collider: { shape: "box", size: [8, 8] } },
    },
  },
});
if (!physicsScene.autoStep || physicsScene.bodyCount !== 1 || typeof globalThis.__ferrumPhysicsSceneAutoStep !== "object") {
  throw new Error("applyPhysicsSceneProfile must expose public generic physics scene integration.");
}
physicsScene.clear();
if (typeof assetManifestFingerprint !== "function") {
  throw new Error("assetManifestFingerprint must be exported from the public entrypoint.");
}
if (typeof createAssetPreloadCachePolicy !== "function") {
  throw new Error("createAssetPreloadCachePolicy must be exported from the public entrypoint.");
}
if (typeof resolveSpriteMaterialPreset !== "function") {
  throw new Error("resolveSpriteMaterialPreset must be exported from the public entrypoint.");
}
if (SPRITE_MATERIAL_PRESETS.outline?.blendMode !== "alpha") {
  throw new Error("SPRITE_MATERIAL_PRESETS must expose the built-in outline preset.");
}
if (resolveSpriteMaterialPreset("additive").blendMode !== "additive") {
  throw new Error("resolveSpriteMaterialPreset must resolve built-in additive material.");
}
if (PARTICLE_VFX_PRESETS["motion-trail"]?.emitter?.mode !== "trail") {
  throw new Error("PARTICLE_VFX_PRESETS must expose the built-in motion trail preset.");
}
if (particleVfxPreset("hit-spark", 0).emitter?.mode !== "burst") {
  throw new Error("particleVfxPreset must resolve built-in VFX presets.");
}
if (!createAssetPreloadCachePolicy({ json: { game: "/game.json" } }).version?.startsWith("assets-")) {
  throw new Error("createAssetPreloadCachePolicy must derive manifest-scoped versions.");
}
if (TEXTURE_ATLAS_PACK_FORMAT !== "ferrum-texture-atlas-pack") {
  throw new Error("TEXTURE_ATLAS_PACK_FORMAT must be exported from the public entrypoint.");
}
const packedAtlas = packTextureAtlas([
  { name: "hero", source: "hero.png", width: 16, height: 16 },
], { texture: "packed", padding: 1 });
if (packedAtlas.frames.hero?.texture !== "packed" || packedAtlas.placements[0]?.source !== "hero.png") {
  throw new Error("packTextureAtlas must emit public deterministic atlas frame metadata.");
}
if (textureAtlasDocumentToShooterAtlas(packedAtlas).frames?.hero?.texture !== "packed") {
  throw new Error("textureAtlasDocumentToShooterAtlas must convert atlas pack documents.");
}
if (diagnosticReport(new Error("smoke")).code !== "FERRUM_UNKNOWN") {
  throw new Error("diagnosticReport must keep the public error contract.");
}

for (const internalSubpath of [
  "dist/index.js",
  "pkg/ferrum_core.js",
  "src/index.js",
]) {
  let blocked = false;
  try {
    await import(\`@ferrum2d/ferrum-web/\${internalSubpath}\`);
  } catch (error) {
    blocked = error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED";
  }
  if (!blocked) {
    throw new Error(\`Internal import must be blocked by package exports: \${internalSubpath}\`);
  }
}

console.log("public import smoke ok");
`);
}

async function writePublicTypesSmoke(targetRoot) {
  await mkdir(path.join(targetRoot, "scripts"), { recursive: true });
  await writeFile(path.join(targetRoot, "scripts/package-type-smoke.ts"), `import {
  createAssetPreloadCachePolicy,
  createFerrumRuntime,
  resolveShooterGameSpec,
  type AssetPreloadCachePolicy,
  type FerrumRuntime,
  type ShooterGameSpec,
} from "@ferrum2d/ferrum-web";

const spec: ShooterGameSpec = {
  world: { width: 960, height: 540 },
  player: { speed: 210 },
  enemies: { speed: 64, spawnInterval: 2.5 },
  weapons: { bulletSpeed: 520, cooldown: 0.18, damage: 1 },
};
const resolved = resolveShooterGameSpec(spec);
const policy: AssetPreloadCachePolicy = createAssetPreloadCachePolicy({
  json: { game: "/game.json" },
});
const runtimeFactory: typeof createFerrumRuntime = createFerrumRuntime;
declare const runtime: FerrumRuntime;
runtime.engine.setGameSpec(spec);
void policy;
void resolved;
void runtimeFactory;
`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fileDependency(filePath) {
  return `file:${filePath}`;
}

async function runRequired(command, args, cwd) {
  console.log(`$ ${formatCommand(command, args)} (${path.relative(repoRoot, cwd) || "."})`);
  const result = await run(command, args, cwd);
  assert(
    result.code === 0,
    `command failed with exit code ${result.code}: ${formatCommand(command, args)}\n${result.stdout}\n${result.stderr}`.trim(),
  );
  if (result.stdout.trim().length > 0) {
    console.log(result.stdout.trim());
  }
  if (result.stderr.trim().length > 0) {
    console.error(result.stderr.trim());
  }
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function requireFile(filePath, message) {
  const stats = await stat(filePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(message);
    }
    throw error;
  });
  assert(stats.isFile(), message);
}

async function assertMissing(filePath, message) {
  try {
    await stat(filePath);
    throw new Error(message);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
}

async function preserveFailureArtifacts(error) {
  if (!failed || !tempRoot || !options.artifactDir) {
    return;
  }

  const artifactRoot = path.resolve(repoRoot, options.artifactDir);
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeJson(path.join(artifactRoot, "consumer-smoke-report.json"), {
    status: "failed",
    timestamp: new Date().toISOString(),
    tempRoot,
    installMode: options.offline ? "offline" : "online",
    templates: templateNames,
    error: describeError(error),
  });
  await copyIfExists(path.join(tempRoot, "tarballs"), path.join(artifactRoot, "tarballs"));
  await copyTreeIfExists(path.join(tempRoot, "tool-consumer"), path.join(artifactRoot, "tool-consumer"));
  await copyTreeIfExists(path.join(tempRoot, "sample-games"), path.join(artifactRoot, "sample-games"));
}

async function copyIfExists(source, target) {
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function copyTreeIfExists(source, target) {
  try {
    await stat(source);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const relative = path.relative(source, entry);
      return !relative.split(path.sep).some((part) => (
        part === "node_modules"
        || part === "dist"
        || part === ".pnpm"
      ));
    },
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[consumer smoke] ${message}`);
  }
}

function describeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => part.includes(" ") ? JSON.stringify(part) : part).join(" ");
}

function printHelp() {
  console.log(`Usage:
  pnpm package:consumer-smoke [options]

Options:
  --skip-build            Reuse existing ferrum-web dist/pkg artifacts
  --skip-package-check    Skip package allowlist and pack checks before consumer smoke
  --offline               Require all non-local dependencies to already be in the pnpm store
  --templates <names>     Comma-separated create-game templates to test. Default: every template
  --artifact-dir <path>   Copy failure diagnostics and light project snapshots to this directory
  --keep-temp             Keep the temporary consumer project for inspection
  -h, --help              Show this help
`);
}
