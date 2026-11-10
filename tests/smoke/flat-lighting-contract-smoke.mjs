import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright-core";
import { installSpatialGpuTarget } from "./spatial-webgpu-capture.mjs";

const root = resolve("."), parent = resolve("artifacts/flat-lighting-contract");
await mkdir(parent, { recursive: true }); const run = await mkdtemp(resolve(parent, "run-"));
let reference, proposedLitReference;
const html = `<!doctype html><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/packages/ferrum-web/dist/core.js"}}</script><script type="module">import{probeFlatLightingContract}from"/tests/smoke/flat-lighting-contract-fixture.mjs";window.probeFlatLightingContract=probeFlatLightingContract;</script>`;
const server = createServer((req, res) => void (async () => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/favicon.ico") { res.writeHead(204).end(); return; }
  if (url.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
  const path = resolve(root, "." + decodeURIComponent(url.pathname));
  if (!path.startsWith(root + sep) || !/\.(?:m?js|wasm)$/.test(path)) { res.writeHead(403).end(); return; }
  const content = await readFile(path); res.setHeader("Content-Type", path.endsWith(".wasm") ? "application/wasm" : "application/javascript"); res.end(content);
})().catch(() => res.writeHead(404).end()));

function checkReferenceVectors() {
  assert.equal(reference.status, "design-reference-only");
  assert.equal(reference.implementedRendererProfile, "legacy-overlay");
  assert.equal(reference.workingSpace, "linear-rgb");
  assert.equal(reference.output, "srgb8");
  assert.deepEqual(reference.vectors.map(v => v.id), ["black", "grey", "white", "blocked-red-visible-blue", "excluded-receiver", "cutout-hole"]);
  const decode = x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4;
  const encode = x => x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055;
  for (const v of reference.vectors) {
    // A design-vector consistency check, explicitly separate from real GPU acceptance.
    const rgb = v.albedoSrgb8.map((b, i) => {
      const illumination = v.ambient[i] + v.lights.reduce((sum, light) => sum + light.rgb[i] * light.energy * light.visibility[i], 0);
      return Math.round(255 * encode(Math.min(1, decode(b / 255) * (v.receiveLighting === false ? 1 : illumination))));
    });
    assert.deepEqual(v.coverage === 0 ? [0, 0, 0, 0] : [...rgb, 255], v.expectedSrgb8, v.id);
  }
  return { status: reference.status, count: reference.vectors.length, renderedByEngine: false, vectors: reference.vectors };
}

const receiverIds = ["black", "grey", "white", "empty", "cutout-hole", "opaque-green", "half-alpha"];
const states = ["disabled", "ambient", "ambient-sun", "red-blue", "red-blocked-blue-retained", "blue-only", "half-shadow", "duplicate-half-shadow", "warm-shadow", "pre-hud", "post-hud", "disabled-restored"];

function assertCleanup(result) {
  assert.equal(result.cleanup.rendererCreated, true);
  assert.equal(result.cleanup.rendererDestroyed, true);
  assert.equal(result.cleanup.targetDisposed, true);
  assert.equal(result.cleanup.canvasRemoved, true);
  assert.deepEqual(result.cleanup.errors, []);
  for (const key of ["textureCount", "bufferCount", "programCount", "renderTargetCount"]) assert.equal(result.afterDestroy[key], 0, key);
}
function assertSuccess(result) {
  assert.equal(result.ok, true, JSON.stringify(result.failure ?? result.cleanup));
  assert.deepEqual(result.receiverIds, receiverIds);
  assert.deepEqual(result.results.map(r => r.name), states);
  for (const r of result.results) {
    assert.equal(r.rgba.length, receiverIds.length);
    assert(r.rgba.every(pixel => pixel.length === 4 && pixel.every(x => Number.isInteger(x) && x >= 0 && x <= 255)));
  }
  assertCleanup(result);
}
function compareLegacy(gl, gpu) {
  assertSuccess(gl); assertSuccess(gpu);
  return gl.results.map((a, i) => {
    const b = gpu.results[i]; assert.equal(a.name, b.name);
    const difference = Math.max(...a.rgba.flatMap((pixel, j) => j === 6 ? [] : pixel.slice(0, 3).map((x, k) => Math.abs(x - b.rgba[j][k]))));
    assert(difference <= 3, `${gl.dpr}/${a.name} GL/GPU RGB difference ${difference}`);
    // Normalize the documented upload difference, rather than skipping lit half-alpha pixels.
    assert.deepEqual(a.legacyUploadDeltaRgb, b.legacyUploadDeltaRgb);
    assert(a.rgba[6][2] < 254 && b.rgba[6][2] < 254, "Upload-delta fixture must stay below saturation");
    const observed = b.rgba[6].slice(0, 3).map((x, k) => x - a.rgba[6][k]);
    const partialDifference = Math.max(...observed.map((x, k) => Math.abs(x - a.legacyUploadDeltaRgb[k])));
    assert(partialDifference <= 3, `partial upload-normalized ${a.name}: ${observed} != ${a.legacyUploadDeltaRgb}`);
    return { dpr: gl.dpr, state: a.name, samples: receiverIds.length - 1, rgbTolerance: 3, maxDifference: difference,
      partialAlpha: { sample: 6, expectedUploadDeltaRgb: a.legacyUploadDeltaRgb, observedUploadDeltaRgb: observed, maxDifference: partialDifference } };
  });
}

/** Corrupt real readback in a separate DPR1 GL context; never change the renderer under test. */
async function faultProbe(page, kind) {
  return page.evaluate(async kind => {
    const prototype = WebGL2RenderingContext.prototype, original = prototype.readPixels;
    let reads = 0, hits = 0;
    prototype.readPixels = function (...args) {
      const selected = args[2] === 96 && args[3] === 64 && args[6] instanceof Uint8Array;
      if (selected) reads++;
      if (selected && kind === "readback" && reads === 2) { hits++; throw Error("Expected injected readback failure"); }
      const result = Reflect.apply(original, this, args);
      if (selected) {
        const bytes = args[6];
        if (kind === "hud-alpha") {
          const i = ((64 - 1 - 8) * 96 + 80) * 4;
          if (bytes[i] === 32 && bytes[i + 1] === 96 && bytes[i + 2] === 160) { bytes[i + 3] = 0; hits++; }
        }
        if ((kind === "partial-sun" && reads === 3) || (kind === "partial-point" && reads === 4)) {
          bytes[((64 - 1 - 44) * 96 + 42) * 4 + 2] -= 16; hits++;
        }
      }
      return result;
    };
    try { return { kind, result: await window.probeFlatLightingContract("webgl2"), reads, hits, remainingCanvases: document.querySelectorAll("canvas").length }; }
    finally { prototype.readPixels = original; }
  }, kind);
}

let browser; const results = [], parity = [], faultChecks = [];
const save = async report => { const text = JSON.stringify(report, null, 2) + "\n"; await writeFile(resolve(run, "verification.json"), text); await writeFile(resolve(parent, "verification.json"), text); };
try {
  reference = JSON.parse(await readFile(new URL("./flat-lighting-reference-vectors.json", import.meta.url), "utf8"));
  proposedLitReference = checkReferenceVectors();
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  const options = { headless: true, args: ["--no-sandbox", "--enable-unsafe-webgpu", "--use-vulkan=swiftshader"] };
  browser = await chromium.launch(process.env.FERRUM_BROWSER_EXECUTABLE ? { ...options, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE } : options);
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: dpr });
    try {
      await page.addInitScript(installSpatialGpuTarget);
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(() => window.probeFlatLightingContract, undefined, { timeout: 15000 });
      for (const [backend, mode] of [["webgl2", "legacy"], ["webgpu", "legacy"], ["webgl2", "linear-srgb"]]) {
        const result = await page.evaluate(([backend, mode]) => window.probeFlatLightingContract(backend, mode), [backend, mode]);
        results.push(result); assertSuccess(result);
        assert.deepEqual(errors, []);
      }
      const [gl, gpu] = results.filter(row => row.dpr === dpr && row.colorManagement === "legacy");
      parity.push(...compareLegacy(gl, gpu));
      if (dpr === 1) for (const kind of ["readback", "hud-alpha", "partial-sun", "partial-point"]) {
        const fault = await faultProbe(page, kind); faultChecks.push(fault);
        assert.equal(fault.hits, 1); assert.equal(fault.remainingCanvases, 0); assertCleanup(fault.result);
        if (kind === "partial-point") {
          assertSuccess(fault.result);
          assert.throws(() => compareLegacy(fault.result, gpu), /partial upload-normalized red-blue/);
          fault.rejectedBy = "upload-normalized-parity";
        } else {
          assert.equal(fault.result.ok, false);
          const messages = { readback: /Expected injected readback failure/, "hud-alpha": /HUD RGBA/, "partial-sun": /Half-alpha ambient-sun/ };
          assert.match(fault.result.failure.message, messages[kind]);
          const counts = { readback: 1, "hud-alpha": 11, "partial-sun": 3 };
          assert.equal(fault.result.results.length, counts[kind], "Failure lost completed measurements");
          fault.rejectedBy = "probe-assertion";
        }
        assert.deepEqual(errors, []);
        fault.verified = true;
      }
    } finally { await page.close(); }
  }
  assert.equal(results.length, 6);
  assert.equal(faultChecks.length, 4); assert(faultChecks.every(fault => fault.verified));
  await save({ ok: true, run, browser: browser.version(), adapter: "software WebGPU offscreen target; no hardware performance/presentation claim", implementedProfile: "legacy-overlay", proposedLitReference, results, parity, faultChecks });
  console.log(`Flat lighting contract passed: ${results.length} backend/color-space/DPR combinations, ${parity.length} real GL/GPU state comparisons, ${reference.vectors.length} reference-only vectors. ${run}`);
} catch (error) {
  await save({ ok: false, run, results, parity, faultChecks, proposedLitReference, error: String(error?.stack ?? error) }); throw error;
} finally { await browser?.close(); if (server.listening) await new Promise(done => server.close(done)); }
