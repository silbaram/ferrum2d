#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const REPORT_FORMAT = "ferrum2d.consumer.deploy-readiness.report";
const REPORT_VERSION = 1;
const OUTPUT_DIRECTORY = "dist";
const HOST = "127.0.0.1";
const DEPLOYMENT_SMOKE_BASE_PATH = "/__ferrum2d_deploy_smoke__/";
const REQUIRED_WASM_MIME = "application/wasm";
const PREVIEW_START_TIMEOUT_MS = configuredTimeout(
  process.env.FERRUM_DEPLOY_PREVIEW_TIMEOUT_MS,
  15_000,
);
const PREVIEW_STOP_TIMEOUT_MS = 3_000;
const HTML_ASSET_ATTRIBUTES = new Map([
  ["audio", new Set(["src"])],
  ["embed", new Set(["src"])],
  ["iframe", new Set(["src"])],
  ["image", new Set(["href", "src"])],
  ["img", new Set(["src"])],
  ["input", new Set(["src"])],
  ["link", new Set(["href"])],
  ["object", new Set(["data"])],
  ["script", new Set(["src"])],
  ["source", new Set(["src"])],
  ["track", new Set(["src"])],
  ["use", new Set(["href"])],
  ["video", new Set(["poster", "src"])],
]);
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".webp", "image/webp"],
]);

const command = process.argv[2] ?? "report";
if (command !== "report") {
  console.error(`Unknown Ferrum2D deploy command: ${command}`);
  process.exit(1);
}

const root = process.cwd();
const state = {
  build: false,
  indexHtml: false,
  relativeAssetReferences: false,
  referencedFiles: false,
  httpServe: false,
  previewHttp: false,
  wasmMime: false,
};
const reports = [];
let inspection;

try {
  await runBuild(root);
  state.build = true;
  inspection = await inspectDeploymentOutput(root, state);
} catch (error) {
  reports.push(deploymentDiagnostic(error));
}

const ok = reports.length === 0 && Object.values(state).every(Boolean);
const report = {
  format: REPORT_FORMAT,
  version: REPORT_VERSION,
  ok,
  deployment: {
    status: ok ? "ready" : "invalid",
    target: "static-web",
    outputDirectory: OUTPUT_DIRECTORY,
    basePath: "relative",
    fileProtocolSupported: false,
    recommendedProtocol: "http(s)",
    commands: {
      build: "npm run build",
      preview: "npm run preview",
      readiness: "npm run ferrum:deploy-report",
    },
    checks: {
      ...state,
      htmlFiles: inspection?.htmlFiles ?? [],
      referencedAssetCount: inspection?.referencedAssetCount ?? 0,
      servedFileCount: inspection?.servedFileCount ?? 0,
      wasmFiles: inspection?.wasmFiles ?? [],
      smokeBasePath: DEPLOYMENT_SMOKE_BASE_PATH,
    },
    reports,
  },
  recommendedCommands: [
    "npm run ferrum:deploy-report",
    "npm run preview",
  ],
  errors: reports.map((entry) => entry.message),
};

console.log(JSON.stringify(report, null, 2));
if (!ok) {
  process.exitCode = 1;
}

async function inspectDeploymentOutput(projectRoot, checks) {
  const distRoot = path.join(projectRoot, OUTPUT_DIRECTORY);
  await requireDirectory(distRoot, "FERRUM_DEPLOY_DIST_MISSING", OUTPUT_DIRECTORY, "Production build did not create dist/.");
  const files = await listFiles(distRoot);
  const relativeFiles = files.map((file) => toPosixPath(path.relative(distRoot, file))).sort();
  const fileSet = new Set(relativeFiles);
  const htmlFiles = relativeFiles.filter((file) => file.endsWith(".html"));
  const htmlDirectories = new Set(htmlFiles.map((file) => path.posix.dirname(file)));
  if (!fileSet.has("index.html")) {
    throw deployError("FERRUM_DEPLOY_INDEX_MISSING", "dist/index.html", "Production build must emit dist/index.html.");
  }
  checks.indexHtml = true;

  const referencedAssets = new Set();
  for (const htmlFile of htmlFiles) {
    const htmlPath = path.join(distRoot, htmlFile);
    const html = await readFile(htmlPath, "utf8");
    assertNoHtmlBaseElement(html, `${OUTPUT_DIRECTORY}/${htmlFile}`);
    for (const reference of htmlAssetReferences(html)) {
      validateAssetReference({
        distRoot,
        fileSet,
        reference,
        referenceBasePath: htmlPath,
        reportPath: `${OUTPUT_DIRECTORY}/${htmlFile}`,
        referencedAssets,
      });
    }
  }

  const indexHtmlPath = path.join(distRoot, "index.html");
  for (const relativeFile of relativeFiles) {
    const filePath = path.join(distRoot, relativeFile);
    if (relativeFile.endsWith(".js") || relativeFile.endsWith(".mjs")) {
      const source = await readFile(filePath, "utf8");
      for (const entry of javascriptAssetReferences(source)) {
        if (
          entry.kind === "fetch" &&
          htmlDirectories.size > 1 &&
          isDocumentRelativeReference(entry.reference)
        ) {
          throw deployError(
            "FERRUM_DEPLOY_FETCH_BASE_AMBIGUOUS",
            `${OUTPUT_DIRECTORY}/${relativeFile}`,
            `Literal fetch reference ${JSON.stringify(entry.reference)} cannot be resolved because HTML entries span multiple directories. Keep HTML entries in one directory or use an explicit deployment-safe asset URL strategy.`,
          );
        }
        validateAssetReference({
          distRoot,
          fileSet,
          reference: entry.reference,
          referenceBasePath: entry.kind === "fetch" ? indexHtmlPath : filePath,
          reportPath: `${OUTPUT_DIRECTORY}/${relativeFile}`,
          referencedAssets,
        });
      }
    } else if (relativeFile.endsWith(".css")) {
      const source = await readFile(filePath, "utf8");
      for (const reference of cssAssetReferences(source)) {
        validateAssetReference({
          distRoot,
          fileSet,
          reference,
          referenceBasePath: filePath,
          reportPath: `${OUTPUT_DIRECTORY}/${relativeFile}`,
          referencedAssets,
        });
      }
    }
  }
  checks.relativeAssetReferences = true;
  checks.referencedFiles = true;

  const wasmFiles = relativeFiles.filter((file) => file.endsWith(".wasm"));
  if (wasmFiles.length === 0) {
    throw deployError("FERRUM_DEPLOY_WASM_MISSING", OUTPUT_DIRECTORY, "Production build must include at least one Wasm file.");
  }

  const server = await serveStaticDirectory(distRoot, DEPLOYMENT_SMOKE_BASE_PATH);
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw deployError("FERRUM_DEPLOY_SERVER_BIND_FAILED", OUTPUT_DIRECTORY, "Local deployment smoke server did not bind to a TCP port.");
    }
    const baseUrl = `http://${HOST}:${address.port}`;
    for (const file of relativeFiles) {
      const response = await fetch(`${baseUrl}${DEPLOYMENT_SMOKE_BASE_PATH}${encodePath(file)}`);
      if (!response.ok) {
        throw deployError(
          "FERRUM_DEPLOY_HTTP_ASSET_FAILED",
          `${OUTPUT_DIRECTORY}/${file}`,
          `Local HTTP smoke returned ${response.status} for ${file}.`,
        );
      }
      await response.arrayBuffer();
    }
    checks.httpServe = true;
  } finally {
    await closeServer(server);
  }

  await inspectPreviewServer(projectRoot, wasmFiles, checks);

  return {
    htmlFiles,
    referencedAssetCount: referencedAssets.size,
    servedFileCount: relativeFiles.length,
    wasmFiles,
  };
}

async function inspectPreviewServer(projectRoot, wasmFiles, checks) {
  const port = await availablePort();
  const preview = await startPreviewServer(projectRoot, port);
  const previewBaseUrl = `http://${HOST}:${port}`;
  try {
    await waitForPreviewReady(preview, `${previewBaseUrl}/`);
    checks.previewHttp = true;
    for (const file of wasmFiles) {
      let response;
      try {
        response = await fetchResponse(
          `${previewBaseUrl}/${encodePath(file)}`,
          PREVIEW_START_TIMEOUT_MS,
        );
      } catch (error) {
        const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
        throw deployError(
          timedOut ? "FERRUM_DEPLOY_PREVIEW_TIMEOUT" : "FERRUM_DEPLOY_PREVIEW_HTTP_FAILED",
          `${OUTPUT_DIRECTORY}/${file}`,
          timedOut
            ? `Configured preview server did not return ${file} within ${PREVIEW_START_TIMEOUT_MS}ms.`
            : `Configured preview server request failed for ${file}: ${errorMessage(error)}.`,
        );
      }
      if (!response.ok) {
        throw deployError(
          "FERRUM_DEPLOY_PREVIEW_HTTP_FAILED",
          `${OUTPUT_DIRECTORY}/${file}`,
          `Configured preview server returned ${response.status} for ${file}.`,
        );
      }
      const actualMime = response.headers.get("content-type")?.split(";")[0] ?? "";
      if (actualMime !== REQUIRED_WASM_MIME) {
        throw deployError(
          "FERRUM_DEPLOY_MIME_MISMATCH",
          `${OUTPUT_DIRECTORY}/${file}`,
          `Expected ${REQUIRED_WASM_MIME} but the configured preview server returned ${actualMime || "no content-type"}.`,
        );
      }
    }
    checks.wasmMime = true;
  } finally {
    await stopPreviewServer(preview);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  await closeServer(server);
  if (!address || typeof address === "string") {
    throw deployError("FERRUM_DEPLOY_PREVIEW_PORT_FAILED", "package.json.scripts.preview", "Could not reserve a local preview port.");
  }
  return address.port;
}

async function startPreviewServer(projectRoot, port) {
  const manager = packageManager();
  const previewArgs = ["--host", HOST, "--port", String(port), "--strictPort"];
  const args = manager.kind === "yarn"
    ? ["preview", ...previewArgs]
    : manager.kind === "pnpm"
      ? ["run", "preview", ...previewArgs]
      : ["run", "preview", "--", ...previewArgs];
  const child = spawn(manager.command, args, {
    cwd: projectRoot,
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = [];
  let exitState;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exitState = { code, signal };
      resolve(exitState);
    });
  });
  child.stdout?.on("data", (chunk) => appendPreviewOutput(output, chunk));
  child.stderr?.on("data", (chunk) => appendPreviewOutput(output, chunk));
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => {
      reject(deployError("FERRUM_DEPLOY_PREVIEW_START_FAILED", "package.json.scripts.preview", error.message));
    });
  });
  return {
    child,
    exitPromise,
    exitState: () => exitState,
    output,
  };
}

async function waitForPreviewReady(preview, url) {
  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    const exited = preview.exitState();
    if (exited !== undefined) {
      throw deployError(
        "FERRUM_DEPLOY_PREVIEW_EXITED",
        "package.json.scripts.preview",
        `Configured preview server exited before becoming ready (${previewExitLabel(exited)}).${previewOutputSuffix(preview.output)}`,
      );
    }
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetchResponse(url, remainingMs);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    const retryDelayMs = Math.min(100, Math.max(0, deadline - Date.now()));
    if (retryDelayMs > 0) await delay(retryDelayMs);
  }
  throw deployError(
    "FERRUM_DEPLOY_PREVIEW_TIMEOUT",
    "package.json.scripts.preview",
    `Configured preview server did not become ready within ${PREVIEW_START_TIMEOUT_MS}ms${lastError ? `: ${lastError.message}` : "."}${previewOutputSuffix(preview.output)}`,
  );
}

async function stopPreviewServer(preview) {
  if (preview.exitState() !== undefined) return;
  terminatePreviewProcess(preview.child, "SIGTERM");
  await Promise.race([
    preview.exitPromise,
    delay(PREVIEW_STOP_TIMEOUT_MS, undefined, { ref: false }),
  ]);
  if (preview.exitState() !== undefined) return;
  terminatePreviewProcess(preview.child, "SIGKILL");
  await Promise.race([
    preview.exitPromise,
    delay(1_000, undefined, { ref: false }),
  ]);
}

async function fetchResponse(url, timeoutMs) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs))),
  });
  await response.arrayBuffer();
  return response;
}

function terminatePreviewProcess(child, signal) {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        shell: false,
        stdio: "ignore",
      });
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    child.kill(signal);
  }
}

function appendPreviewOutput(output, chunk) {
  output.push(String(chunk));
  while (output.join("").length > 8_000) output.shift();
}

function previewExitLabel(exitState) {
  return exitState.signal ? `signal ${exitState.signal}` : `exit code ${exitState.code}`;
}

function previewOutputSuffix(output) {
  const text = output.join("").trim();
  return text.length > 0 ? `\n${text}` : "";
}

function htmlAssetReferences(html) {
  const references = [];
  for (const tagMatch of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/giu)) {
    const allowedAttributes = HTML_ASSET_ATTRIBUTES.get(tagMatch[1].toLowerCase());
    if (allowedAttributes === undefined) continue;
    for (const attributeMatch of tagMatch[2].matchAll(/\b([a-z][\w:-]*)\s*=\s*["']([^"']+)["']/giu)) {
      if (!allowedAttributes.has(attributeMatch[1].toLowerCase())) continue;
      const reference = attributeMatch[2].trim();
      if (reference.length > 0) references.push(reference);
    }
  }
  return references;
}

function assertNoHtmlBaseElement(html, reportPath) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/gu, "");
  if (/<base\b[^>]*>/iu.test(withoutComments)) {
    throw deployError(
      "FERRUM_DEPLOY_HTML_BASE_UNSUPPORTED",
      reportPath,
      "Static deployment readiness does not support HTML <base> elements. Use document-relative asset references instead.",
    );
  }
}

function javascriptAssetReferences(source) {
  return [
    ...literalCallReferences(source, /\bfetch\s*\(\s*["']([^"']+)["']/giu, "fetch"),
    ...literalCallReferences(
      source,
      /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/giu,
      "module-url",
    ),
  ];
}

function literalCallReferences(source, pattern, kind) {
  return [...source.matchAll(pattern)]
    .map((match) => ({ kind, reference: match[1].trim() }))
    .filter((entry) => entry.reference.length > 0);
}

function cssAssetReferences(source) {
  return [...source.matchAll(/\burl\s*\(\s*(?:["']([^"']+)["']|([^\s)'";]+))\s*\)/giu)]
    .map((match) => (match[1] ?? match[2] ?? "").trim())
    .filter(Boolean);
}

function validateAssetReference({
  distRoot,
  fileSet,
  reference,
  referenceBasePath,
  reportPath,
  referencedAssets,
}) {
  if (isExternalReference(reference)) return;
  if (reference.startsWith("/")) {
    throw deployError(
      "FERRUM_DEPLOY_ABSOLUTE_ASSET_PATH",
      reportPath,
      `Static deployment requires a relative asset path, found ${JSON.stringify(reference)}.`,
    );
  }
  const resolved = resolveAssetReference(distRoot, referenceBasePath, reference);
  const relative = toPosixPath(path.relative(distRoot, resolved));
  if (!fileSet.has(relative)) {
    throw deployError(
      "FERRUM_DEPLOY_REFERENCED_ASSET_MISSING",
      `${OUTPUT_DIRECTORY}/${relative}`,
      `Built output references a missing asset: ${reference}.`,
    );
  }
  referencedAssets.add(relative);
}

function isExternalReference(reference) {
  return reference.startsWith("#") ||
    reference.startsWith("//") ||
    reference.startsWith("blob:") ||
    reference.startsWith("data:") ||
    reference.startsWith("http://") ||
    reference.startsWith("https://") ||
    reference.startsWith("mailto:");
}

function isDocumentRelativeReference(reference) {
  return !isExternalReference(reference) && !reference.startsWith("/");
}

function resolveAssetReference(distRoot, htmlPath, reference) {
  const withoutQuery = reference.split(/[?#]/u, 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    throw deployError("FERRUM_DEPLOY_ASSET_PATH_INVALID", toPosixPath(path.relative(distRoot, htmlPath)), `Asset reference is not valid URI data: ${reference}.`);
  }
  const resolved = path.resolve(path.dirname(htmlPath), decoded);
  const relative = path.relative(distRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw deployError("FERRUM_DEPLOY_ASSET_PATH_ESCAPE", toPosixPath(relative), `Asset reference escapes dist/: ${reference}.`);
  }
  return resolved;
}

async function listFiles(directory) {
  const output = [];
  await walk(directory, output);
  return output;
}

async function walk(directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, output);
    } else if (entry.isFile()) {
      output.push(entryPath);
    }
  }
}

async function serveStaticDirectory(rootDirectory, basePath) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${HOST}`);
      const pathname = decodeURIComponent(url.pathname);
      if (!pathname.startsWith(basePath)) {
        response.writeHead(404).end("Not Found");
        return;
      }
      const mountedPath = pathname.slice(basePath.length);
      const relative = mountedPath.length === 0 ? "index.html" : mountedPath.replace(/^\/+/, "");
      const filePath = path.resolve(rootDirectory, relative);
      const inside = path.relative(rootDirectory, filePath);
      if (inside.startsWith("..") || path.isAbsolute(inside)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      response.writeHead(200, { "Content-Type": mimeType(filePath) });
      response.end(body);
    } catch (error) {
      const statusCode = error?.code === "ENOENT" ? 404 : 500;
      response.writeHead(statusCode).end(statusCode === 404 ? "Not Found" : "Internal Server Error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function runBuild(projectRoot) {
  const manager = packageManager();
  const args = manager.kind === "yarn" ? ["build"] : ["run", "build"];
  await new Promise((resolve, reject) => {
    const child = spawn(manager.command, args, {
      cwd: projectRoot,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", (error) => reject(deployError("FERRUM_DEPLOY_BUILD_START_FAILED", "package.json.scripts.build", error.message)));
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(deployError("FERRUM_DEPLOY_BUILD_FAILED", "package.json.scripts.build", `Production build failed with exit code ${code}.`));
      }
    });
  });
}

async function requireDirectory(directoryPath, code, reportPath, message) {
  try {
    const stats = await stat(directoryPath);
    if (!stats.isDirectory()) throw deployError(code, reportPath, message);
  } catch (error) {
    if (error?.code === "ENOENT") throw deployError(code, reportPath, message);
    throw error;
  }
}

function packageManager() {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm")) {
    return { kind: "pnpm", command: process.platform === "win32" ? "pnpm.cmd" : "pnpm" };
  }
  if (userAgent.startsWith("yarn")) {
    return { kind: "yarn", command: process.platform === "win32" ? "yarn.cmd" : "yarn" };
  }
  return { kind: "npm", command: process.platform === "win32" ? "npm.cmd" : "npm" };
}

function configuredTimeout(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function mimeType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function encodePath(file) {
  return file.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function toPosixPath(file) {
  return file.split(path.sep).join("/");
}

function deployError(code, reportPath, message) {
  const error = new Error(message);
  error.deployCode = code;
  error.deployPath = reportPath;
  return error;
}

function deploymentDiagnostic(error) {
  return {
    kind: "deploy-readiness",
    code: error?.deployCode ?? "FERRUM_DEPLOY_UNKNOWN",
    path: error?.deployPath ?? OUTPUT_DIRECTORY,
    message: error instanceof Error ? error.message : String(error),
    suggestion: "Run npm run build, serve dist/ over HTTP(S), and fix the reported path before deploying.",
  };
}
