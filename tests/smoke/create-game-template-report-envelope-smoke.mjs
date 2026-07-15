#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { missingExpectedPublicEntryPoints } from "../../scripts/package/create-game-template-contracts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const templatesRoot = path.join(repoRoot, "packages/create-game/templates");
const sharedTemplateRoot = path.join(templatesRoot, "_shared");
const templateManifestPath = path.join(templatesRoot, "manifest.json");
const authoringViewerRoot = path.join(repoRoot, "packages/ferrum-authoring-viewer");
const ferrumWebRoot = path.join(repoRoot, "packages/ferrum-web");
const configuredCommandTimeoutMs = Number(process.env.FERRUM_TEMPLATE_REPORT_TIMEOUT_MS ?? 60000);
const commandTimeoutMs = Number.isFinite(configuredCommandTimeoutMs) && configuredCommandTimeoutMs > 0
  ? configuredCommandTimeoutMs
  : 60000;

let tempRoot;

try {
  const templates = await readTemplateCatalog();
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum-create-game-template-reports-"));
  await assertDeployReadinessReportContracts(tempRoot);

  const summaries = [];
  for (const template of templates) {
    const templateName = template.id;
    const projectRoot = path.join(tempRoot, templateName);
    await cp(sharedTemplateRoot, projectRoot, { recursive: true });
    await cp(path.join(templatesRoot, templateName), projectRoot, { recursive: true });
    await normalizePackageJson(projectRoot, templateName);
    if (await needsFerrumWebRuntime(projectRoot) || await exists(path.join(projectRoot, "scripts/ferrum-assets.mjs"))) {
      await linkFerrumWeb(projectRoot);
    }

    const assetReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-assets.mjs", "report"],
      "ferrum2d.consumer.asset-pipeline.report",
    );
    assertConsumerAssetReport(assetReport, template);

    const assetValidateReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-assets.mjs", "validate"],
      "ferrum2d.consumer.asset-pipeline.report",
    );
    assertConsumerAssetValidateReport(assetValidateReport, template);

    const projectReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-harness.mjs", "report"],
      "ferrum2d.consumer.project.report",
    );
    assertConsumerProjectReport(projectReport, template);

    const authoringReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-harness.mjs", "authoring-report"],
      "ferrum2d.consumer.gameplay-authoring.report",
    );
    assertConsumerAuthoringReport(authoringReport, template);

    const replayReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-harness.mjs", "replay-report"],
      "ferrum2d.consumer.gameplay-replay.report",
    );
    assertConsumerReplayReport(replayReport, template);

    if (!template.gameplayReplay.configured) {
      const replayUpdateReport = await runJsonReportAllowFailure(
        projectRoot,
        ["scripts/ferrum-harness.mjs", "update-replay-fixture"],
        "ferrum2d.consumer.gameplay-replay.report",
      );
      assertConsumerReplayUpdateNotConfiguredReport(replayUpdateReport, templateName);
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-replay.fixture.json")),
        `${templateName} gameplay replay update must not create fixture while not configured`,
      );
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-replay.coverage-tags.json")),
        `${templateName} gameplay replay update must not create coverage tags while not configured`,
      );
    }

    const runtimeReplayReport = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-runtime-replay.mjs", "report"],
      "ferrum2d.consumer.runtime-gameplay-replay.report",
    );
    assertConsumerRuntimeReplayReport(runtimeReplayReport, template);

    const runtimeReplayRecipe = await runJsonReport(
      projectRoot,
      ["scripts/ferrum-runtime-replay.mjs", "recipe"],
      "ferrum2d.consumer.runtime-gameplay-replay.recipe",
    );
    assertConsumerRuntimeReplayRecipe(runtimeReplayRecipe, template);

    if (template.runtimeGameplayReplay.configured) {
      const runtimeReplayUpdateReport = await runJsonReport(
        projectRoot,
        ["scripts/ferrum-runtime-replay.mjs", "update-fixture"],
        "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report",
      );
      assertConsumerRuntimeReplayFixtureUpdateReport(runtimeReplayUpdateReport, template);
      assert(await exists(path.join(projectRoot, template.runtimeGameplayReplay.fixturePath)), `${templateName} runtime replay update must keep fixture present`);
      assert(await exists(path.join(projectRoot, template.runtimeGameplayReplay.coverageTagDefinitionsPath)), `${templateName} runtime replay update must keep coverage tags present`);
    } else {
      const runtimeReplayUpdateReport = await runJsonReportAllowFailure(
        projectRoot,
        ["scripts/ferrum-runtime-replay.mjs", "update-fixture"],
        "ferrum2d.consumer.runtime-gameplay-replay.report",
      );
      assertConsumerRuntimeReplayUpdateNotConfiguredReport(runtimeReplayUpdateReport, templateName);
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-runtime-replay.fixture.json")),
        `${templateName} runtime replay update must not create fixture while not configured`,
      );
      assert(
        !await exists(path.join(projectRoot, "public/gameplay-runtime-replay.coverage-tags.json")),
        `${templateName} runtime replay update must not create coverage tags while not configured`,
      );
    }

    summaries.push({
      template: templateName,
      replayCatalogConfigured: template.gameplayReplay.configured,
      projectStatus: projectReport.ok ? "validated" : "invalid",
      assetStatus: assetReport.assetPipeline.textureAtlas.status,
      assetValidated: assetValidateReport.assetPipeline.validation.validated,
      authoringStatus: authoringReport.gameplayAuthoring.status,
      replayStatus: replayReport.gameplayReplay.status,
      replayConfigured: replayReport.gameplayReplay.configured,
      runtimeReplayStatus: runtimeReplayReport.runtimeGameplayReplay.status,
      runtimeReplayConfigured: runtimeReplayReport.runtimeGameplayReplay.configured,
      runtimeReplayRecipe: runtimeReplayRecipe.status,
    });
  }

  console.log("create-game template report envelope smoke ok");
  console.log(JSON.stringify({ templates: summaries }, null, 2));
} finally {
  if (tempRoot !== undefined) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function assertDeployReadinessReportContracts(root) {
  const projectRoot = path.join(root, "deploy-readiness-contract");
  const scriptPath = path.join(projectRoot, "scripts/ferrum-deploy.mjs");
  const distRoot = path.join(projectRoot, "dist");
  await mkdir(path.dirname(scriptPath), { recursive: true });
  await mkdir(distRoot, { recursive: true });
  await cp(path.join(sharedTemplateRoot, "scripts/ferrum-deploy.mjs"), scriptPath);
  await writeFile(path.join(projectRoot, "scripts/preview-fixture.mjs"), previewFixtureSource());
  await writeFile(path.join(projectRoot, "preview-mime.txt"), "application/wasm\n");
  await writeFile(path.join(projectRoot, "preview-mode.txt"), "serve\n");
  await writeFile(path.join(projectRoot, "package.json"), `${JSON.stringify({
    name: "ferrum-deploy-readiness-contract",
    private: true,
    packageManager: "pnpm@10.8.0",
    scripts: {
      build: "node --version",
      preview: "node scripts/preview-fixture.mjs",
    },
  }, null, 2)}\n`);
  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><link rel="stylesheet" href="./style.css"><a href="./client-route">Credits</a><script type="module" src="./app.js"></script>\n',
  );
  await writeFile(path.join(distRoot, "style.css"), "body { margin: 0; }\n");
  await writeFile(path.join(distRoot, "game.json"), "{}\n");
  await writeFile(path.join(distRoot, "engine.wasm"), new Uint8Array([0, 97, 115, 109]));
  await writeFile(
    path.join(distRoot, "app.js"),
    'void fetch("./game.json");\nvoid new URL("./engine.wasm", import.meta.url);\nvoid new URL("./client-route.json", window.location.href);\n',
  );

  const ready = await runJsonReport(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assert.equal(ready.ok, true, "deploy readiness positive fixture must pass");
  assert.equal(
    ready.deployment?.checks?.smokeBasePath,
    "/__ferrum2d_deploy_smoke__/",
    "deploy readiness must serve the fixture from a non-root base path",
  );
  assert.equal(ready.deployment?.checks?.previewHttp, true, "deploy readiness must probe the configured preview server");

  await writeFile(path.join(projectRoot, "preview-mime.txt"), "application/octet-stream\n");
  const invalidMime = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(invalidMime, "FERRUM_DEPLOY_MIME_MISMATCH");

  await writeFile(path.join(projectRoot, "preview-mime.txt"), "application/wasm\n");
  await writeFile(
    path.join(distRoot, "app.js"),
    'void fetch("/game.json");\nvoid new URL("./engine.wasm", import.meta.url);\n',
  );
  const absoluteRuntimeAsset = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(absoluteRuntimeAsset, "FERRUM_DEPLOY_ABSOLUTE_ASSET_PATH");

  await writeFile(
    path.join(distRoot, "app.js"),
    'void fetch("./game.json");\nvoid new URL("./engine.wasm", import.meta.url);\n',
  );
  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><base href="/"><link rel="stylesheet" href="./style.css"><script type="module" src="./app.js"></script>\n',
  );
  const unsupportedHtmlBase = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(unsupportedHtmlBase, "FERRUM_DEPLOY_HTML_BASE_UNSUPPORTED");

  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><link rel="stylesheet" href="./style.css"><a href="./client-route">Credits</a><script type="module" src="./app.js"></script>\n',
  );
  await mkdir(path.join(distRoot, "admin"), { recursive: true });
  await writeFile(path.join(distRoot, "admin/index.html"), "<!doctype html><title>Admin</title>\n");
  const ambiguousFetchBase = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(ambiguousFetchBase, "FERRUM_DEPLOY_FETCH_BASE_AMBIGUOUS");
  await rm(path.join(distRoot, "admin"), { recursive: true, force: true });

  await writeFile(
    path.join(distRoot, "app.js"),
    'void fetch("./game.json");\nvoid new URL("./missing.wasm", import.meta.url);\nvoid new URL("./client-route.json", window.location.href);\n',
  );
  const missingModuleAsset = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(missingModuleAsset, "FERRUM_DEPLOY_REFERENCED_ASSET_MISSING");

  await writeFile(
    path.join(distRoot, "app.js"),
    'void fetch("./game.json");\nvoid new URL("./engine.wasm", import.meta.url);\n',
  );
  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><link rel="stylesheet" href="./missing.css"><a href="./client-route">Credits</a><script type="module" src="./app.js"></script>\n',
  );
  const missingHtmlAsset = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
  );
  assertDeployDiagnostic(missingHtmlAsset, "FERRUM_DEPLOY_REFERENCED_ASSET_MISSING");

  await writeFile(
    path.join(distRoot, "index.html"),
    '<!doctype html><link rel="stylesheet" href="./style.css"><a href="./client-route">Credits</a><script type="module" src="./app.js"></script>\n',
  );
  await writeFile(path.join(projectRoot, "preview-mode.txt"), "hang-index\n");
  const hangingIndex = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
    {
      env: { FERRUM_DEPLOY_PREVIEW_TIMEOUT_MS: "250" },
      timeoutMs: 5_000,
    },
  );
  assertDeployDiagnostic(hangingIndex, "FERRUM_DEPLOY_PREVIEW_TIMEOUT");

  await writeFile(path.join(projectRoot, "preview-mode.txt"), "hang-wasm\n");
  const hangingWasm = await runJsonReportAllowFailure(
    projectRoot,
    ["scripts/ferrum-deploy.mjs", "report"],
    "ferrum2d.consumer.deploy-readiness.report",
    {
      env: { FERRUM_DEPLOY_PREVIEW_TIMEOUT_MS: "250" },
      timeoutMs: 5_000,
    },
  );
  assertDeployDiagnostic(hangingWasm, "FERRUM_DEPLOY_PREVIEW_TIMEOUT");
}

function previewFixtureSource() {
  return `import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
if (process.argv.includes("--")) {
  throw new Error("preview arguments must not include an extra script separator");
}
const host = argument("--host", "127.0.0.1");
const port = Number(argument("--port", "4173"));
const wasmMime = (await readFile("preview-mime.txt", "utf8")).trim();
const mode = (await readFile("preview-mode.txt", "utf8")).trim();
const distRoot = path.resolve("dist");

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", \`http://\${host}\`).pathname);
    if ((mode === "hang-index" && pathname === "/") || (mode === "hang-wasm" && pathname.endsWith(".wasm"))) {
      return;
    }
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\\/+/, "");
    const filePath = path.resolve(distRoot, relative);
    const inside = path.relative(distRoot, filePath);
    if (inside.startsWith("..") || path.isAbsolute(inside)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const body = await readFile(filePath);
    const contentType = filePath.endsWith(".wasm")
      ? wasmMime
      : filePath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    response.end(body);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500).end("Not Found");
  }
}).listen(port, host);
`;
}

function assertDeployDiagnostic(report, code) {
  assert.equal(report.ok, false, `${code} deploy readiness fixture must be invalid`);
  assert.equal(report.deployment?.status, "invalid", `${code} deploy readiness status must be invalid`);
  assert(
    report.deployment?.reports?.some((entry) => entry.code === code),
    `deploy readiness report must include ${code}`,
  );
}

async function readTemplateCatalog() {
  const manifest = JSON.parse(await readFile(templateManifestPath, "utf8"));
  assert.equal(manifest.format, "ferrum-create-game-template-catalog", "template manifest format is invalid");
  assert.equal(manifest.version, 1, "template manifest version is invalid");
  assert(Array.isArray(manifest.templates), "template manifest templates must be an array");
  assert(manifest.templates.length > 0, "template manifest must include at least one template");
  assert(await exists(path.join(sharedTemplateRoot, "scripts/ferrum-assets.mjs")), "_shared must include scripts/ferrum-assets.mjs");
  assert(
    await exists(path.join(sharedTemplateRoot, "public/assets/texture-atlas.input.json")),
    "_shared must include public/assets/texture-atlas.input.json",
  );
  assert(
    await exists(path.join(sharedTemplateRoot, "public/assets/audio.manifest.json")),
    "_shared must include public/assets/audio.manifest.json",
  );
  assert(
    await exists(path.join(sharedTemplateRoot, "public/assets/localization.manifest.json")),
    "_shared must include public/assets/localization.manifest.json",
  );
  for (const entry of manifest.templates) {
    const templateName = entry.id;
    assert.equal(typeof templateName, "string", "template id must be a string");
    assert(templateName.length > 0, "template id must not be empty");
    assertTemplateSceneAuthoringCatalog(entry, templateName);
    assertTemplateReplayCatalog(entry, templateName);
    assertTemplateRuntimeReplayCatalog(entry, templateName);
    assert(await exists(path.join(templatesRoot, templateName, "scripts/ferrum-harness.mjs")), `${templateName} must include scripts/ferrum-harness.mjs`);
    assert(await exists(path.join(templatesRoot, templateName, "scripts/ferrum-runtime-replay.mjs")), `${templateName} must include scripts/ferrum-runtime-replay.mjs`);
  }
  return manifest.templates;
}

async function assertTemplateSceneAuthoringCatalog(template, templateName) {
  assert.equal(typeof template.sceneAuthoring?.configured, "boolean", `${templateName} sceneAuthoring.configured must be a boolean`);
  if (template.sceneAuthoring.configured) {
    assert.equal(template.sceneAuthoring.fixturePath, "public/scene-authoring.json", `${templateName} scene authoring fixture path is invalid`);
    assert.equal(
      template.sceneAuthoring.format,
      "ferrum2d.consumer.scene-authoring",
      `${templateName} scene authoring format is invalid`,
    );
    assert(await exists(path.join(templatesRoot, templateName, template.sceneAuthoring.fixturePath)), `${templateName} must include ${template.sceneAuthoring.fixturePath}`);
  } else {
    assert.equal(typeof template.sceneAuthoring.reason, "string", `${templateName} scene authoring reason must be a string`);
    assert(template.sceneAuthoring.reason.length > 0, `${templateName} scene authoring reason must not be empty`);
  }
}

function assertTemplateRuntimeReplayCatalog(template, templateName) {
  assert.equal(typeof template.runtimeGameplayReplay?.configured, "boolean", `${templateName} runtimeGameplayReplay.configured must be a boolean`);
  if (template.runtimeGameplayReplay.configured) {
    assert.equal(template.runtimeGameplayReplay.scenario, "project-runtime", `${templateName} runtime replay scenario is invalid`);
    assert.equal(template.runtimeGameplayReplay.fixturePath, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
    assert.equal(
      template.runtimeGameplayReplay.coverageTagDefinitionsPath,
      "public/gameplay-runtime-replay.coverage-tags.json",
      `${templateName} runtime replay coverage path is invalid`,
    );
  } else {
    assert.equal(typeof template.runtimeGameplayReplay.reason, "string", `${templateName} runtime replay reason must be a string`);
    assert(template.runtimeGameplayReplay.reason.length > 0, `${templateName} runtime replay reason must not be empty`);
  }
}

async function normalizePackageJson(projectRoot, templateName) {
  const file = path.join(projectRoot, "package.json");
  const packageJson = JSON.parse(await readFile(file, "utf8"));
  packageJson.name = templateName;
  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    "@ferrum2d/authoring-viewer": "0.0.0-smoke",
    "@ferrum2d/ferrum-web": "0.0.0-smoke",
  };
  await writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function needsFerrumWebRuntime(projectRoot) {
  return await exists(path.join(projectRoot, "public/game.json"))
    || await exists(path.join(projectRoot, "public/gameplay-replay.fixture.json"));
}

async function linkFerrumWeb(projectRoot) {
  const scopeRoot = path.join(projectRoot, "node_modules/@ferrum2d");
  await mkdir(scopeRoot, { recursive: true });
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(authoringViewerRoot, path.join(scopeRoot, "authoring-viewer"), linkType);
  await symlink(ferrumWebRoot, path.join(scopeRoot, "ferrum-web"), linkType);
}

async function runJsonReport(projectRoot, args, expectedFormat) {
  const result = await runHarness(projectRoot, args);
  assert.equal(
    result.code,
    0,
    `${formatCommand(process.execPath, args)} must pass\n${result.stdout}\n${result.stderr}`.trim(),
  );
  return parseJsonReport(result.stdout, expectedFormat, formatCommand(process.execPath, args));
}

async function runJsonReportAllowFailure(projectRoot, args, expectedFormat, options) {
  const result = await runHarness(projectRoot, args, options);
  assert.notEqual(
    result.code,
    0,
    `${formatCommand(process.execPath, args)} must fail for the expected negative path`,
  );
  return parseJsonReport(result.stdout, expectedFormat, formatCommand(process.execPath, args));
}

function runHarness(projectRoot, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutMs = options.timeoutMs ?? commandTimeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
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
      clearTimeout(timer);
      if (timedOut) {
        stderr += `\nCommand timed out after ${timeoutMs}ms.`;
      }
      if (stderr.trim().length > 0) {
        process.stderr.write(stderr);
      }
      resolve({ code: timedOut ? 1 : code, stdout, stderr });
    });
  });
}

function parseJsonReport(stdout, expectedFormat, commandLabel) {
  const marker = `{\n  "format": "${expectedFormat}"`;
  const start = stdout.indexOf(marker);
  assert(start >= 0, `command did not emit ${expectedFormat} JSON report: ${commandLabel}`);
  const end = findJsonObjectEnd(stdout, start);
  assert(end >= 0, `command emitted an incomplete ${expectedFormat} JSON report: ${commandLabel}`);
  try {
    return JSON.parse(stdout.slice(start, end));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to parse ${expectedFormat} JSON report from ${commandLabel}: ${message}`);
  }
}

function findJsonObjectEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

function assertConsumerAssetReport(report, template) {
  const pipeline = assertConsumerAssetPipelineBase(report, template);
  assert.equal(pipeline.validation?.validated, false, `${template.id} asset report must not mark validation as executed`);
  assert.equal(pipeline.validation?.publicEntryPoints, undefined, `${template.id} asset report must not require public package imports`);
}

function assertConsumerAssetValidateReport(report, template) {
  const pipeline = assertConsumerAssetPipelineBase(report, template);
  assert.equal(pipeline.validation?.validated, true, `${template.id} asset validate report must mark validation as executed`);
  const missing = missingExpectedPublicEntryPoints(pipeline.validation?.publicEntryPoints);
  assert.equal(missing.length, 0, `${template.id} asset validate report public entrypoints are invalid: missing ${missing.join(", ")}`);
}

function assertConsumerAssetPipelineBase(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.asset-pipeline.report", `${templateName} asset report format is invalid`);
  assert.equal(report.version, 1, `${templateName} asset report version is invalid`);
  assert.equal(report.ok, true, `${templateName} asset report must be ok for generated templates`);
  const pipeline = report.assetPipeline;
  assert(pipeline !== null && typeof pipeline === "object" && !Array.isArray(pipeline), `${templateName} assetPipeline must be an object`);
  assert.equal(pipeline.textureAtlas?.configured, true, `${templateName} texture atlas scaffold must be configured`);
  assert.equal(pipeline.textureAtlas?.status, "scaffold", `${templateName} texture atlas scaffold status is invalid`);
  assert.equal(pipeline.textureAtlas?.input, "public/assets/texture-atlas.input.json", `${templateName} texture atlas input path is invalid`);
  assert.equal(pipeline.textureAtlas?.outputJson, "public/assets/atlas.json", `${templateName} texture atlas output path is invalid`);
  assert.equal(pipeline.textureAtlas?.packed, false, `${templateName} asset report must not pack textures`);
  assert.equal(pipeline.textureAtlas?.spriteCount, 0, `${templateName} texture atlas scaffold must start without sprites`);
  assert.equal(pipeline.textureAtlas?.packedFrameCount, 0, `${templateName} texture atlas scaffold must start without packed frames`);
  assert.equal(pipeline.audio?.configured, true, `${templateName} audio manifest scaffold must be configured`);
  assert.equal(pipeline.audio?.status, "scaffold", `${templateName} audio manifest scaffold status is invalid`);
  assert.equal(pipeline.audio?.input, "public/assets/audio.manifest.json", `${templateName} audio manifest path is invalid`);
  assert.equal(pipeline.audio?.soundCount, 0, `${templateName} audio manifest scaffold must start without sounds`);
  assert.deepEqual(pipeline.audio?.sounds, [], `${templateName} audio manifest scaffold sounds must be empty`);
  assert.equal(pipeline.localization?.configured, true, `${templateName} localization manifest scaffold must be configured`);
  assert.equal(pipeline.localization?.status, "scaffold", `${templateName} localization scaffold status is invalid`);
  assert.equal(pipeline.localization?.input, "public/assets/localization.manifest.json", `${templateName} localization manifest path is invalid`);
  assert.equal(pipeline.localization?.gameSpec, "public/game.json", `${templateName} localization gameSpec path is invalid`);
  assert.equal(pipeline.localization?.source, "gameSpec.content.localization", `${templateName} localization source is invalid`);
  assert.equal(pipeline.localization?.gameSpecContentPresent, false, `${templateName} localization scaffold must not include Game Spec content`);
  assert.equal(pipeline.localization?.documentCount, 0, `${templateName} localization scaffold must start without documents`);
  assert.deepEqual(pipeline.localization?.documents, [], `${templateName} localization scaffold documents must be empty`);
  assert.equal(pipeline.gameSpec?.path, "public/game.json", `${templateName} Game Spec path is invalid`);
  assert.equal(pipeline.gameSpec?.present, templateName === "topdown", `${templateName} Game Spec presence is invalid`);
  assert.equal(pipeline.gameSpec?.localizationConfigured, false, `${templateName} Game Spec localization scaffold state is invalid`);
  assert.deepEqual(pipeline.reports, [], `${templateName} asset scaffold reports must be empty`);
  return pipeline;
}

function assertConsumerProjectReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.project.report", `${templateName} project report format is invalid`);
  assert.equal(report.version, 1, `${templateName} project report version is invalid`);
  assert.equal(report.ok, true, `${templateName} project report must be ok for generated templates`);
  assert.equal(report.project?.packageName, templateName, `${templateName} project report packageName is invalid`);
  assert(report.project?.authoringViewer !== undefined && report.project.authoringViewer !== null, `${templateName} project report must include authoring-viewer dependency`);
  assert(report.project?.ferrumWeb !== undefined && report.project.ferrumWeb !== null, `${templateName} project report must include ferrum-web dependency`);
  assert.equal(report.project?.files?.main, true, `${templateName} project report must confirm src/main.ts`);
  assert(Array.isArray(report.project?.checks?.internalImports), `${templateName} project report internalImports must be an array`);
  assert.equal(report.project.checks.internalImports.length, 0, `${templateName} project report must not include internal imports`);
  assert(Array.isArray(report.project?.checks?.rootAggregateImports), `${templateName} project report rootAggregateImports must be an array`);
  assert.equal(report.project.checks.rootAggregateImports.length, 0, `${templateName} project report must not include root aggregate imports`);
  assert.equal(report.project?.deployment?.target, "static-web", `${templateName} project report deployment target is invalid`);
  assert.equal(report.project?.deployment?.outputDirectory, "dist", `${templateName} project report deployment output is invalid`);
  assert.equal(report.project?.deployment?.basePath, "relative", `${templateName} project report deployment base path is invalid`);
  assert.equal(report.project?.deployment?.fileProtocolSupported, false, `${templateName} project report must reject file protocol deployment`);
  assert.equal(report.project?.deployment?.scripts?.readiness, "node scripts/ferrum-deploy.mjs report", `${templateName} project report deploy readiness script is invalid`);
  if (templateName === "topdown") {
    assert.equal(report.project.files.gameSpec, "public/game.json", "topdown project report must identify public/game.json");
    assert.equal(report.project.checks.gameSpec?.ok, true, "topdown project report must validate Game Spec");
  } else {
    assert.equal(report.project.checks.gameSpec?.ok, null, `${templateName} project report must mark missing Game Spec as a structured skip`);
  }
  if (template.sceneAuthoring.configured) {
    assert.equal(report.project.files.sceneAuthoring, template.sceneAuthoring.fixturePath, `${templateName} project report sceneAuthoring path is invalid`);
    assert.equal(report.project.checks.sceneAuthoring?.ok, true, `${templateName} project report must validate scene authoring`);
  }
  for (const command of [
    "npm run ferrum:report",
    "npm run ferrum:validate",
    "npm run ferrum:placement-viewer",
    "npm run ferrum:authoring-report",
    "npm run ferrum:replay-report",
    "npm run ferrum:runtime-replay-report",
    "npm run ferrum:smoke",
    "npm run ferrum:deploy-report",
    "npm run build",
    "npm run preview",
  ]) {
    assert(report.recommendedCommands?.includes(command), `${templateName} project report recommendedCommands must include ${command}`);
  }
  assert.deepEqual(report.reports, [], `${templateName} project report reports must be empty`);
  assert.deepEqual(report.errors, [], `${templateName} project report errors must be empty`);
}

function assertConsumerAuthoringReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.gameplay-authoring.report", `${templateName} authoring report format is invalid`);
  assert.equal(report.version, 1, `${templateName} authoring report version is invalid`);
  assert.equal(report.ok, true, `${templateName} authoring report must be ok for a generated template`);
  assert.equal(report.gameplayAuthoring?.packageName, templateName, `${templateName} authoring report packageName is invalid`);
  assert(Array.isArray(report.gameplayAuthoring?.diagnostics), `${templateName} authoring report diagnostics must be an array`);
  assert(Array.isArray(report.gameplayAuthoring?.reports), `${templateName} authoring report reports must be an array`);
  assertMachineActionableReports(report.gameplayAuthoring.reports, `${templateName} authoring report gameplayAuthoring.reports`);
  if (templateName === "topdown") {
    assert.equal(report.gameplayAuthoring.status, "validated", "topdown authoring report must validate public/game.json");
    assert.equal(report.gameplayAuthoring.gameSpec?.ok, true, "topdown authoring report must include a valid Game Spec result");
    assert.equal(report.gameplayAuthoring.gameSpec?.file, "public/game.json", "topdown authoring report must identify public/game.json");
  } else {
    assert.equal(report.gameplayAuthoring.gameSpec?.ok, null, `${templateName} authoring report must mark missing Game Spec as a structured skip`);
  }
  if (template.sceneAuthoring.configured) {
    assert.equal(report.gameplayAuthoring.status, "validated", `${templateName} authoring report must validate scene authoring data`);
    assert.equal(report.gameplayAuthoring.sceneAuthoring?.ok, true, `${templateName} authoring report scene authoring must be valid`);
    assert.equal(report.gameplayAuthoring.sceneAuthoring?.file, template.sceneAuthoring.fixturePath, `${templateName} authoring report scene authoring file is invalid`);
    assertSceneRuntimeEntityHandles(
      report.gameplayAuthoring.sceneAuthoring?.summary?.runtimeEntityHandles,
      `${templateName} authoring report sceneAuthoring.summary.runtimeEntityHandles`,
    );
    assertScenePlacementAuthoringSummary(
      report.gameplayAuthoring.sceneAuthoring?.summary?.placementAuthoring,
      `${templateName} authoring report sceneAuthoring.summary.placementAuthoring`,
    );
    assertSceneRuntimeEntityHandles(
      report.gameplayAuthoring.authoringSurface?.sceneComposition?.runtimeEntityHandles,
      `${templateName} authoring report authoringSurface.sceneComposition.runtimeEntityHandles`,
    );
  } else if (templateName !== "topdown") {
    assert.equal(report.gameplayAuthoring.status, "not-configured", `${templateName} authoring report must be not-configured`);
  }
}

function assertSceneRuntimeEntityHandles(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(value.length > 0, `${label} must not be empty`);
  const instanceIds = new Set();
  for (const [index, entry] of value.entries()) {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${label}[${index}] must be an object`);
    assertNonEmptyString(entry.instanceId, `${label}[${index}].instanceId`);
    assertNonEmptyString(entry.runtimeEntity, `${label}[${index}].runtimeEntity`);
    assert(Number.isInteger(entry.entityId) && entry.entityId > 0, `${label}[${index}].entityId must be a positive integer`);
    assert(Number.isInteger(entry.entityGeneration) && entry.entityGeneration >= 0, `${label}[${index}].entityGeneration must be a non-negative integer`);
    assert(!instanceIds.has(entry.instanceId), `${label}[${index}].instanceId must be unique`);
    instanceIds.add(entry.instanceId);
  }
}

function assertScenePlacementAuthoringSummary(value, label) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.equal(value.workflow, "human-placement-agent-behavior", `${label}.workflow is invalid`);
  assert.equal(value.placementOwner, "sceneComposition.fragments[].instances[]", `${label}.placementOwner is invalid`);
  assert.equal(
    value.behaviorOwner,
    "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities",
    `${label}.behaviorOwner is invalid`,
  );
  assertNonEmptyString(value.fragment, `${label}.fragment`);
  assert(Number.isInteger(value.instanceCount) && value.instanceCount > 0, `${label}.instanceCount must be positive`);
  assert(Array.isArray(value.instances), `${label}.instances must be an array`);
  assert.equal(value.instances.length, value.instanceCount, `${label}.instances length must match instanceCount`);
  for (const [index, entry] of value.instances.entries()) {
    assertNonEmptyString(entry.instanceId, `${label}.instances[${index}].instanceId`);
    assertNonEmptyString(entry.prefab, `${label}.instances[${index}].prefab`);
    assert(entry.role === "actor" || entry.role === "worldObject", `${label}.instances[${index}].role is invalid`);
    assert(Array.isArray(entry.behaviorProfiles), `${label}.instances[${index}].behaviorProfiles must be an array`);
    assert(Number.isInteger(entry.behaviorBindingCount), `${label}.instances[${index}].behaviorBindingCount must be an integer`);
    assert(Array.isArray(entry.behaviorBindings), `${label}.instances[${index}].behaviorBindings must be an array`);
    assert.equal(
      entry.behaviorBindings.length,
      entry.behaviorBindingCount,
      `${label}.instances[${index}].behaviorBindings length must match behaviorBindingCount`,
    );
    assert.deepEqual(
      entry.behaviorBindings.map((binding) => binding.recipeId),
      entry.behaviorProfiles,
      `${label}.instances[${index}].behaviorBindings recipe ids must match behaviorProfiles`,
    );
    for (const [bindingIndex, binding] of entry.behaviorBindings.entries()) {
      assertNonEmptyString(binding.recipeId, `${label}.instances[${index}].behaviorBindings[${bindingIndex}].recipeId`);
      assertNonEmptyString(binding.bindingPath, `${label}.instances[${index}].behaviorBindings[${bindingIndex}].bindingPath`);
      assertNonEmptyString(binding.behaviorRecipePath, `${label}.instances[${index}].behaviorBindings[${bindingIndex}].behaviorRecipePath`);
      assert.equal(binding.target?.kind, "instance", `${label}.instances[${index}].behaviorBindings[${bindingIndex}].target.kind is invalid`);
      assert.equal(
        binding.target?.instanceId,
        entry.instanceId,
        `${label}.instances[${index}].behaviorBindings[${bindingIndex}].target.instanceId must match the placement instance`,
      );
      assert.equal(
        binding.target?.prefab,
        entry.prefab,
        `${label}.instances[${index}].behaviorBindings[${bindingIndex}].target.prefab must match the placement instance`,
      );
      assert(Number.isInteger(binding.commandCount), `${label}.instances[${index}].behaviorBindings[${bindingIndex}].commandCount must be an integer`);
      assert(Array.isArray(binding.commandTypes), `${label}.instances[${index}].behaviorBindings[${bindingIndex}].commandTypes must be an array`);
    }
    assert(Number.isInteger(entry.behaviorCommandCount), `${label}.instances[${index}].behaviorCommandCount must be an integer`);
    assert(Array.isArray(entry.behaviorCommandTypes), `${label}.instances[${index}].behaviorCommandTypes must be an array`);
    if (entry.entity !== null) {
      assert(Number.isInteger(entry.entity?.entityId), `${label}.instances[${index}].entity.entityId must be an integer`);
      assert(Number.isInteger(entry.entity?.entityGeneration), `${label}.instances[${index}].entity.entityGeneration must be an integer`);
    }
  }
}

function assertConsumerReplayReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.gameplay-replay.report", `${templateName} replay report format is invalid`);
  assert.equal(report.version, 1, `${templateName} replay report version is invalid`);
  assert.equal(report.ok, true, `${templateName} replay report must be ok for default templates`);
  assert.equal(report.gameplayReplay?.packageName, templateName, `${templateName} replay report packageName is invalid`);
  assert(Array.isArray(report.gameplayReplay?.reports), `${templateName} replay report reports must be an array`);
  assertMachineActionableReports(report.gameplayReplay.reports, `${templateName} replay report gameplayReplay.reports`);
  assert.equal(
    report.gameplayReplay?.configured,
    template.gameplayReplay.configured,
    `${templateName} replay report configured must match template manifest`,
  );
  if (template.gameplayReplay.configured) {
    assert.equal(report.gameplayReplay?.status, "validated", `${templateName} replay report must validate its replay fixture`);
    assert.equal(report.gameplayReplay?.scenario, template.gameplayReplay.scenario, "topdown replay report scenario is invalid");
    assert.equal(report.gameplayReplay?.fixture, template.gameplayReplay.fixturePath, `${templateName} replay report fixture path is invalid`);
    assert.equal(
      report.gameplayReplay?.coverageTagDefinitionsPath,
      template.gameplayReplay.coverageTagDefinitionsPath,
      `${templateName} replay report coverage vocabulary path is invalid`,
    );
    assertCoverageRegistryReport(report.gameplayReplay, templateName);
    assert.equal(report.gameplayReplay?.comparison?.passed, true, `${templateName} replay comparison must pass`);
    assert.equal(typeof report.gameplayReplay?.expectedHash, "string", `${templateName} replay report must include expectedHash`);
    assert.equal(report.gameplayReplay?.expectedHash, report.gameplayReplay?.actualHash, `${templateName} replay expectedHash and actualHash must match`);
  } else {
    assert.equal(report.gameplayReplay?.status, "not-configured", `${templateName} replay report must be not-configured`);
    assert.equal(report.gameplayReplay?.reason, "This template does not include a deterministic gameplay replay manifest.", `${templateName} replay report reason is invalid`);
    assert.equal(
      report.gameplayReplay?.reports?.[0]?.code,
      "FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED",
      `${templateName} replay report must include the not-configured diagnostic code`,
    );
  }
}

function assertConsumerRuntimeReplayReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay report format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay report version is invalid`);
  assert.equal(report.ok, true, `${templateName} runtime replay report must be ok`);
  assert.equal(report.runtimeGameplayReplay?.configured, template.runtimeGameplayReplay.configured, `${templateName} runtime replay configured flag is invalid`);
  assert.equal(report.runtimeGameplayReplay?.status, template.runtimeGameplayReplay.configured ? "validated" : "not-configured", `${templateName} runtime replay status is invalid`);
  assert.equal(report.runtimeGameplayReplay?.scenario, "project-runtime", `${templateName} runtime replay scenario is invalid`);
  assert.equal(report.runtimeGameplayReplay?.fixture, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay fixture path is invalid`);
  assert.equal(
    report.runtimeGameplayReplay?.coverageTagDefinitionsPath,
    "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay coverage path is invalid`,
  );
  assert.deepEqual(report.runtimeGameplayReplay?.coverageTags, ["project-runtime"], `${templateName} runtime replay coverage tags are invalid`);
  assert.equal(report.runtimeGameplayReplay?.recipe?.template, templateName, `${templateName} runtime replay report recipe template is invalid`);
  if (template.runtimeGameplayReplay.configured) {
    assert.deepEqual(report.runtimeGameplayReplay?.reports, [], `${templateName} runtime replay reports must be empty after validation`);
    assert.equal(report.runtimeGameplayReplay?.comparison?.passed, true, `${templateName} runtime replay comparison must pass`);
    assert.equal(report.runtimeGameplayReplay?.expectedHash, report.runtimeGameplayReplay?.actualHash, `${templateName} runtime replay hash must match`);
  } else {
    assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay reports`);
    assert.equal(
      report.runtimeGameplayReplay?.reports?.[0]?.code,
      "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
      `${templateName} runtime replay must include not-configured diagnostic code`,
    );
  }
}

function assertConsumerRuntimeReplayRecipe(recipe, template) {
  const templateName = template.id;
  assert.equal(recipe.format, "ferrum2d.consumer.runtime-gameplay-replay.recipe", `${templateName} runtime replay recipe format is invalid`);
  assert.equal(recipe.version, 1, `${templateName} runtime replay recipe version is invalid`);
  assert.equal(recipe.template, templateName, `${templateName} runtime replay recipe template is invalid`);
  assert.equal(recipe.scenario, "project-runtime", `${templateName} runtime replay recipe scenario is invalid`);
  assert.equal(recipe.status, template.runtimeGameplayReplay.configured ? "configured" : "scaffold", `${templateName} runtime replay recipe status is invalid`);
  assert.equal(recipe.fixture, "public/gameplay-runtime-replay.fixture.json", `${templateName} runtime replay recipe fixture path is invalid`);
  assert.equal(
    recipe.coverageTagDefinitionsPath,
    "public/gameplay-runtime-replay.coverage-tags.json",
    `${templateName} runtime replay recipe coverage path is invalid`,
  );
  assert.deepEqual(recipe.coverageTags, ["project-runtime"], `${templateName} runtime replay recipe coverage tags are invalid`);
  assert.equal(recipe.deterministicRun?.fixedDelta, 1 / 60, `${templateName} runtime replay recipe fixedDelta is invalid`);
  assert.equal(typeof recipe.deterministicRun?.seed, "string", `${templateName} runtime replay recipe seed must be a string`);
  assertRuntimeReplayInputSequence(recipe.deterministicRun?.inputSequence, `${templateName} runtime replay recipe inputSequence`);
  assert(Array.isArray(recipe.deterministicRun?.captureFrames), `${templateName} runtime replay recipe captureFrames must be an array`);
  assert(recipe.deterministicRun.captureFrames.length > 0, `${templateName} runtime replay recipe captureFrames must not be empty`);
  assertStringArray(recipe.canonicalState?.required, `${templateName} runtime replay recipe canonicalState.required`);
  assertStringArray(recipe.canonicalState?.excluded, `${templateName} runtime replay recipe canonicalState.excluded`);
  assertStringArray(recipe.implementationSteps, `${templateName} runtime replay recipe implementationSteps`);
  assert(recipe.canonicalState.excluded.includes("render commands"), `${templateName} runtime replay recipe must exclude render commands`);
  assert(recipe.canonicalState.excluded.includes("audio playback"), `${templateName} runtime replay recipe must exclude audio playback`);
}

function assertConsumerRuntimeReplayFixtureUpdateReport(report, template) {
  const templateName = template.id;
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.fixture-update-report", `${templateName} runtime replay update format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay update version is invalid`);
  assert.equal(report.ok, true, `${templateName} runtime replay update must pass when configured`);
  assert.equal(report.runtimeGameplayReplayFixture?.fixture, template.runtimeGameplayReplay.fixturePath, `${templateName} runtime replay update fixture path is invalid`);
  assert.equal(report.runtimeGameplayReplayFixture?.scenario, template.runtimeGameplayReplay.scenario, `${templateName} runtime replay update scenario is invalid`);
  assert.equal(
    report.runtimeGameplayReplayFixture?.coverageTagDefinitionsPath,
    template.runtimeGameplayReplay.coverageTagDefinitionsPath,
    `${templateName} runtime replay update coverage path is invalid`,
  );
  assert.deepEqual(report.runtimeGameplayReplayFixture?.coverageTags, ["project-runtime"], `${templateName} runtime replay update coverage tags are invalid`);
  assert.equal(typeof report.runtimeGameplayReplayFixture?.replayHash, "string", `${templateName} runtime replay update replayHash must be a string`);
  assert(report.runtimeGameplayReplayFixture.replayHash.length > 0, `${templateName} runtime replay update replayHash must not be empty`);
  assert(report.runtimeGameplayReplayFixture?.snapshotCount > 0, `${templateName} runtime replay update snapshotCount must be positive`);
}

function assertConsumerRuntimeReplayUpdateNotConfiguredReport(report, templateName) {
  assert.equal(report.format, "ferrum2d.consumer.runtime-gameplay-replay.report", `${templateName} runtime replay update report format is invalid`);
  assert.equal(report.version, 1, `${templateName} runtime replay update report version is invalid`);
  assert.equal(report.ok, false, `${templateName} runtime replay update report must be ok=false while scaffold is not configured`);
  assert.equal(report.runtimeGameplayReplay?.configured, false, `${templateName} runtime replay update must keep configured=false`);
  assert.equal(report.runtimeGameplayReplay?.status, "not-configured", `${templateName} runtime replay update status must be not-configured`);
  assert.equal(report.runtimeGameplayReplay?.updateAttempted, true, `${templateName} runtime replay update report must mark updateAttempted`);
  assert.equal(report.runtimeGameplayReplay?.recipe?.template, templateName, `${templateName} runtime replay update report recipe template is invalid`);
  assertMachineActionableReports(report.runtimeGameplayReplay?.reports, `${templateName} runtime replay update reports`);
  assert.equal(
    report.runtimeGameplayReplay?.reports?.[0]?.code,
    "FERRUM_CONSUMER_RUNTIME_REPLAY_NOT_CONFIGURED",
    `${templateName} runtime replay update must include not-configured diagnostic code`,
  );
}

function assertConsumerReplayUpdateNotConfiguredReport(report, templateName) {
  assert.equal(report.format, "ferrum2d.consumer.gameplay-replay.report", `${templateName} replay update report format is invalid`);
  assert.equal(report.version, 1, `${templateName} replay update report version is invalid`);
  assert.equal(report.ok, false, `${templateName} replay update report must be ok=false while not configured`);
  assert.equal(report.gameplayReplay?.packageName, templateName, `${templateName} replay update packageName is invalid`);
  assert.equal(report.gameplayReplay?.configured, false, `${templateName} replay update must keep configured=false`);
  assert.equal(report.gameplayReplay?.status, "not-configured", `${templateName} replay update status must be not-configured`);
  assert.equal(report.gameplayReplay?.fixture, "public/gameplay-replay.fixture.json", `${templateName} replay update fixture path is invalid`);
  assert.equal(report.gameplayReplay?.updateAttempted, true, `${templateName} replay update report must mark updateAttempted`);
  assertMachineActionableReports(report.gameplayReplay?.reports, `${templateName} replay update reports`);
  assert.equal(
    report.gameplayReplay?.reports?.[0]?.code,
    "FERRUM_CONSUMER_REPLAY_NOT_CONFIGURED",
    `${templateName} replay update must include not-configured diagnostic code`,
  );
}

function assertCoverageRegistryReport(gameplayReplay, templateName) {
  assert(
    gameplayReplay?.coverageTagDefinitions !== null
      && typeof gameplayReplay?.coverageTagDefinitions === "object"
      && !Array.isArray(gameplayReplay?.coverageTagDefinitions),
    `${templateName} replay report coverage definitions must be an object`,
  );
  assert(Object.keys(gameplayReplay.coverageTagDefinitions).length > 0, `${templateName} replay report coverage definitions must not be empty`);
  assert(
    gameplayReplay?.coverageTagGroups !== null
      && typeof gameplayReplay?.coverageTagGroups === "object"
      && !Array.isArray(gameplayReplay?.coverageTagGroups),
    `${templateName} replay report coverage groups must be an object`,
  );
  assert.deepEqual(gameplayReplay?.deprecatedCoverageTags, {}, `${templateName} replay report deprecated coverage tags are invalid`);
}

function assertTemplateReplayCatalog(template, templateName) {
  const replay = template.gameplayReplay;
  assert(replay !== null && typeof replay === "object" && !Array.isArray(replay), `${templateName} gameplayReplay manifest entry must be an object`);
  assert.equal(typeof replay.configured, "boolean", `${templateName} gameplayReplay.configured must be boolean`);
  if (replay.configured) {
    assertNonEmptyString(replay.scenario, `${templateName} gameplayReplay.scenario`);
    assertNonEmptyString(replay.fixturePath, `${templateName} gameplayReplay.fixturePath`);
    assertNonEmptyString(replay.coverageTagDefinitionsPath, `${templateName} gameplayReplay.coverageTagDefinitionsPath`);
  } else {
    assertNonEmptyString(replay.reason, `${templateName} gameplayReplay.reason`);
  }
}

function assertMachineActionableReports(reports, label) {
  assert(Array.isArray(reports), `${label} must be an array`);
  for (const [index, report] of reports.entries()) {
    assertMachineActionableReport(report, `${label}[${index}]`);
  }
}

function assertMachineActionableReport(report, label) {
  assertNonEmptyString(report?.kind, `${label}.kind`);
  assertNonEmptyString(report?.code, `${label}.code`);
  assertNonEmptyString(report?.path, `${label}.path`);
  assertNonEmptyString(report?.message, `${label}.message`);
  assertNonEmptyString(report?.suggestion, `${label}.suggestion`);
}

function assertNonEmptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert(value.length > 0, `${label} must not be empty`);
}

function assertStringArray(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(value.length > 0, `${label} must not be empty`);
  for (const [index, item] of value.entries()) {
    assertNonEmptyString(item, `${label}[${index}]`);
  }
}

function assertRuntimeReplayInputSequence(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  for (const [index, entry] of value.entries()) {
    assert(entry !== null && typeof entry === "object" && !Array.isArray(entry), `${label}[${index}] must be an object`);
    assert(Number.isInteger(entry.frame) && entry.frame >= 0, `${label}[${index}].frame must be a non-negative integer`);
    assert(entry.action === "press" || entry.action === "release", `${label}[${index}].action must be press or release`);
    assertNonEmptyString(entry.control, `${label}[${index}].control`);
    for (const key of Object.keys(entry)) {
      assert(key === "frame" || key === "action" || key === "control", `${label}[${index}] has unsupported field ${key}`);
    }
  }
}

function formatCommand(command, args) {
  return [command, ...args].join(" ");
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
