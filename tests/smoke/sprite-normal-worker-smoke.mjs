import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import {
  decodePng,
  encodePngRgba,
} from "../../scripts/tools/pack-textures.mjs";
import { generateSpriteNormals } from "../../scripts/tools/generate-sprite-normals.mjs";
import {
  repositoryRoot,
  sha256,
} from "../../scripts/tools/sprite-normals-tool.mjs";
import {
  validateSpriteNormalWasmBundle,
  wasmMemoryLimits,
} from "../../scripts/tools/build-sprite-normals-wasm.mjs";
import { animatedGif, animatedApng } from "./sprite-normal-media-fixtures.mjs";

const bundle = await validateSpriteNormalWasmBundle(),
  artifacts = resolve(
    repositoryRoot,
    "artifacts/sprite-normal-authoring/phase-4",
  );
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(resolve(artifacts, "run-"));
function sphere(width, height = width) {
  const p = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(
        (x - width / 2) / (width / 2),
        (y - height / 2) / (height / 2),
      );
      p.set(
        [170, 170, 170, d < 0.94 ? 255 : d < 1 ? 128 : 0],
        (y * width + x) * 4,
      );
    }
  return encodePngRgba(width, height, p);
}
const sprite = sphere(32),
  spritePixels = decodePng(sprite).pixels,
  sheetPixels = new Uint8Array(64 * 32 * 4);
for (let y = 0; y < 32; y++)
  for (let i = 0; i < 2; i++)
    sheetPixels.set(
      spritePixels.subarray(y * 128, (y + 1) * 128),
      (y * 64 + i * 32) * 4,
    );
const cases = [
  {
    name: "sprite.png",
    bytes: sprite,
    settings: {
      normalStrength: 2.3,
      detailStrength: 2.5,
      detailScale: 1.8,
      shapeStrength: 0.8,
      shapeRadius: 8,
      shapeSoftness: 2.25,
      alphaThreshold: 0.6,
    },
  },
  {
    name: "sheet.png",
    bytes: encodePngRgba(64, 32, sheetPixels),
    settings: { frameSize: { width: 32, height: 32 } },
    animation: { loop: true },
  },
  { name: "anim.gif", bytes: animatedGif(), animation: { loop: false } },
  { name: "anim.apng", bytes: animatedApng(), animation: { loop: true } },
];
const references = [];
for (const [i, entry] of cases.entries()) {
  await writeFile(resolve(root, entry.name), entry.bytes);
  const file = resolve(root, `job-${i}.json`);
  await writeFile(
    file,
    JSON.stringify({
      format: "ferrum2d.sprite-normals.config",
      version: 1,
      inputs: [entry.name],
      outputDir: `reference-${i}`,
      settings: entry.settings,
      ...(entry.animation
        ? { animation: { ...entry.animation, padding: 0, powerOfTwo: false } }
        : {}),
    }),
  );
  const report = await generateSpriteNormals(file),
    result = report.results[0],
    dir = resolve(root, `reference-${i}`);
  references.push({
    entry,
    normal: decodePng(await readFile(resolve(dir, result.normal))),
    color: decodePng(
      await readFile(result.frames ? resolve(dir, result.color) : result.color),
    ),
    ...(result.ferrumAnimation
      ? {
          descriptor: JSON.parse(
            await readFile(resolve(dir, result.ferrumAnimation.descriptor)),
          ),
        }
      : {}),
  });
}
await writeFile(resolve(root, "heavy.png"), sphere(1024));
const gif = animatedGif();
await writeFile(
  resolve(root, "too-many.gif"),
  Buffer.concat([
    gif.subarray(0, 25),
    ...Array(65).fill(gif.subarray(25, -1)),
    Buffer.from([0x3b]),
  ]),
);
const routes = new Map(),
  requests = {};
for (const [i, entry] of cases.entries())
  routes.set(`/inputs/${i}`, resolve(root, entry.name));
routes.set("/heavy.png", resolve(root, "heavy.png"));
routes.set("/too-many.gif", resolve(root, "too-many.gif"));
const config = {
  source: {
    manifestUrl: "/generator/manifest.json",
    manifestSha256: bundle.manifestSha256,
  },
  cases: cases.map(({ bytes, ...entry }, i) => ({
    ...entry,
    url: `/inputs/${i}`,
  })),
};
const html = `<!doctype html><html><head><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js","@ferrum2d/ferrum-web/core":"/engine/dist/core.js"}}</script><style>html,body{margin:0}canvas{width:480px;height:360px}</style></head><body><canvas></canvas><script type="module">import {probeNormalWorker} from '/probe.mjs';try{window.workerReport=await probeNormalWorker()}catch(error){window.workerError=error.stack}</script></body></html>`;
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    requests[pathname] = (requests[pathname] ?? 0) + 1;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }
    if (pathname === "/config.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(config));
      return;
    }
    let file = routes.get(pathname);
    if (pathname === "/probe.mjs")
      file = resolve(
        repositoryRoot,
        "tests/smoke/sprite-normal-worker-browser-fixture.mjs",
      );
    else if (pathname.startsWith("/engine/")) {
      const base = resolve(repositoryRoot, "packages/ferrum-web");
      file = resolve(base, "." + decodeURIComponent(pathname.slice(7)));
      if (!file.startsWith(base + sep)) {
        response.writeHead(403).end();
        return;
      }
    } else if (
      pathname.startsWith("/generator/") ||
      pathname.startsWith("/corrupt/")
    ) {
      const base = bundle.root;
      file = resolve(base, "." + pathname.slice(pathname.indexOf("/", 1)));
      if (!file.startsWith(base + sep)) {
        response.writeHead(403).end();
        return;
      }
    }
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      {
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".png": "image/png",
      }[extname(file)] ?? "application/octet-stream",
    );
    const bytes = await readFile(file);
    if (pathname.startsWith("/corrupt/") && pathname.endsWith(".wasm"))
      bytes[0] ^= 1;
    response.end(bytes);
  })().catch((error) => response.writeHead(500).end(error.message));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
const comparisons = [];
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.FERRUM_BROWSER_EXECUTABLE
      ? { executablePath: process.env.FERRUM_BROWSER_EXECUTABLE }
      : { channel: process.env.FERRUM_BROWSER_CHANNEL ?? "chrome" }),
    args: [
      "--no-sandbox",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
    ],
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("recordWorkerOutput", async (index, data) => {
    const reference = references[index],
      normalBytes = Buffer.from(data.normal),
      colorBytes = Buffer.from(data.color),
      normal = decodePng(normalBytes),
      color = decodePng(colorBytes);
    assert.equal(normal.width, reference.normal.width);
    assert.equal(normal.height, reference.normal.height);
    assert.deepEqual(color.pixels, reference.color.pixels);
    let maxDelta = 0,
      differentChannels = 0;
    for (let i = 0; i < normal.pixels.length; i++) {
      const delta = Math.abs(normal.pixels[i] - reference.normal.pixels[i]);
      if (i % 4 === 3)
        assert.equal(delta, 0, "Alpha changed between CLI and Wasm");
      maxDelta = Math.max(maxDelta, delta);
      if (delta) differentChannels++;
    }
    assert(maxDelta <= 1, `CLI/Wasm normal difference ${maxDelta}`);
    if (reference.descriptor)
      assert.deepEqual(data.descriptor.timing, reference.descriptor.timing);
    assert.equal(
      sha256(normalBytes),
      data.report.results[0].outputs.find(
        (o) => o.path === data.report.results[0].normal,
      ).sha256,
    );
    await writeFile(resolve(root, `worker-${index}.normal.png`), normalBytes);
    await writeFile(resolve(root, `worker-${index}.color.png`), colorBytes);
    await writeFile(
      resolve(root, `worker-${index}.json`),
      JSON.stringify(
        {
          metadata: data.metadata,
          report: data.report,
          descriptor: data.descriptor,
          binding: data.binding,
        },
        null,
        2,
      ) + "\n",
    );
    comparisons.push({
      name: reference.entry.name,
      maxDelta,
      differentChannels,
      colorExact: true,
      alphaExact: true,
      timingMatches: reference.descriptor ? true : null,
    });
  });
  await page.exposeFunction("saveWorkerScreenshot", async (name, data) => {
    assert(["normal-lit", "flat"].includes(name));
    await writeFile(
      resolve(root, name + ".png"),
      Buffer.from(data.split(",")[1], "base64"),
    );
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(
    () => globalThis.workerReport || globalThis.workerError,
    undefined,
    { timeout: 120000 },
  );
  const probe = await page.evaluate(() => ({
    report: globalThis.workerReport,
    error: globalThis.workerError,
  }));
  assert.equal(probe.error, undefined);
  assert.deepEqual(errors, []);
  assert.equal(comparisons.length, cases.length);
  const verification = {
    ok: true,
    run: root,
    bundle: bundle.manifest,
    manifestSha256: bundle.manifestSha256,
    memory: wasmMemoryLimits(
      await readFile(resolve(bundle.root, bundle.manifest.wasm.path)),
    ),
    comparisons,
    worker: probe.report,
    requests,
    scope:
      "Actual pinned generator Wasm in module Workers, CLI pixel/timing parity, owned/free/cache/lifecycle limits and existing native normal lighting. Assets generation UI is phase 5.",
  };
  await writeFile(
    resolve(artifacts, "verification.json"),
    JSON.stringify(verification, null, 2) + "\n",
  );
  console.log(JSON.stringify(verification, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
