import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { assertNativeWasmSourceIdentity } from "../../scripts/package/native-wasm-source-identity.mjs";
import { runReleaseCommand } from "./github-release-command.mjs";

const probes = new Map([
  ["limits", async () => (await import("./native-file-limit-acceptance.mjs")).probeNativeFileLimitAcceptance],
  ["rotation", async () => (await import("./native-rotation-acceptance.mjs")).probeNativeRotationAcceptance],
  ["terrain", async () => (await import("./native-terrain-resource-acceptance.mjs")).probeNativeTerrainResourceAcceptance],
]);
const args = process.argv.slice(2).filter(arg => arg !== "--");
const selected = args.length ? args : [...probes.keys()];
assert(selected.every(name => probes.has(name)) && new Set(selected).size === selected.length,
  "Expected optional, distinct probes: limits rotation terrain");

const root = fileURLToPath(new URL("../../", import.meta.url));
const base = resolve(root, "artifacts/physics-3d/sdk-integration-acceptance");
await mkdir(base, { recursive: true });
const run = await mkdtemp(resolve(base, "run-"));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { status: "running", probes: {} };
const reportPath = resolve(run, "report.json");
let browser, server;

try {
  const identity = await assertNativeWasmSourceIdentity(root);
  const sdk = resolve(root, "packages/ferrum-web");
  await runReleaseCommand("pnpm", ["pack", "--pack-destination", run], { cwd: sdk });
  const archives = (await readdir(run)).filter(f => f.endsWith(".tgz"));
  assert.equal(archives.length, 1);
  await runReleaseCommand("tar", ["-xzf", archives[0]], { cwd: run });
  const pkg = resolve(run, "package");
  const wasmPath = "/pkg/ferrum_core_bg.wasm";
  const wasm = await readFile(resolve(pkg, "." + wasmPath));
  assert.equal(sha(wasm), identity.wasmSha256, "Packed Wasm differs from the current build");
  Object.assign(report, {
    tarballSha256: sha(await readFile(resolve(run, archives[0]))),
    wasmSha256: sha(wasm), sourceFingerprint: identity.compiledFingerprint,
  });

  const manifest = JSON.parse(await readFile(resolve(pkg, "package.json"), "utf8"));
  const imports = Object.fromEntries(Object.entries(manifest.exports).map(([key, value]) =>
    [manifest.name + key.slice(1), value.import.slice(1)]));
  const html = '<!doctype html><meta charset="utf-8"><script type="importmap">' +
    JSON.stringify({ imports }) + "</script>";
  server = createServer((request, response) => {
    const handle = async () => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/") return response.writeHead(200, { "Content-Type": "text/html" }).end(html);
      if (pathname === wasmPath) return response.writeHead(200, { "Content-Type": "application/wasm" }).end(wasm);
      const file = resolve(pkg, "." + pathname);
      if (!file.startsWith(pkg + sep) || !file.endsWith(".js")) return response.writeHead(404).end();
      const js = await readFile(file);
      response.writeHead(200, { "Content-Type": "text/javascript" }).end(js);
    };
    handle().catch(() => response.writeHead(404).end());
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const options = { args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.FERRUM_BROWSER_EXECUTABLE) {
    browser = await chromium.launch({ ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE });
  } else {
    try { browser = await chromium.launch({ ...options, channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }); }
    catch (error) {
      if (process.env.FERRUM_BROWSER_CHANNEL) throw error;
      browser = await chromium.launch({ ...options, channel: "chromium" });
    }
  }
  report.browser = browser.version();
  for (const name of selected) {
    const page = await browser.newPage();
    const errors = [];
    let loadedWasm = false;
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => {
      if (response.ok() && response.url() === origin + wasmPath) loadedWasm = true;
    });
    try {
      await page.goto(origin);
      const probe = await probes.get(name)();
      const observations = await probe(page, origin + wasmPath);
      assert(loadedWasm, "Browser did not load the packed Wasm");
      assert.deepEqual(errors, []);
      report.probes[name] = { status: "passed", observations };
    } catch (error) {
      report.probes[name] = { status: "failed", error: String(error.stack ?? error), pageErrors: errors };
      console.error(name, error.message);
    } finally {
      await page.close();
    }
  }
  assert(Object.values(report.probes).every(entry => entry.status === "passed"), "SDK integration probe failed");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(done => server.close(done));
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(report.status, reportPath);
}
