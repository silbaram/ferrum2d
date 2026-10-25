import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright-core";
import {
  decodePng,
  encodePngRgba,
} from "../../scripts/tools/pack-textures.mjs";
import {
  execute,
  installedTool,
  repositoryRoot,
  sha256,
} from "../../scripts/tools/sprite-normals-tool.mjs";

const generator = await installedTool();
const artifacts = resolve(
  repositoryRoot,
  process.env.FERRUM_NORMAL_ARTIFACT_DIR ??
    "artifacts/sprite-normal-authoring/phase-1",
);
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(resolve(artifacts, "run-"));
const pixels = new Uint8Array(32 * 32 * 4);
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++) {
    const radius = Math.hypot(x - 15.5, y - 15.5),
      index = (y * 32 + x) * 4;
    pixels.set(
      [170, 170, 170, radius <= 16 ? (radius > 15.2 ? 128 : 255) : 0],
      index,
    );
  }
const sprite = resolve(root, "sphere.png"),
  sheet = resolve(root, "sheet.png");
await writeFile(sprite, encodePngRgba(32, 32, pixels));
const sheetPixels = new Uint8Array(64 * 32 * 4);
for (let y = 0; y < 32; y++)
  for (let frame = 0; frame < 2; frame++)
    sheetPixels.set(
      pixels.subarray(y * 128, (y + 1) * 128),
      (y * 64 + frame * 32) * 4,
    );
await writeFile(sheet, encodePngRgba(64, 32, sheetPixels));
const player = resolve(
  repositoryRoot,
  "examples/topdown-shooter/public/assets/player.png",
);
const originals = new Map(
  await Promise.all(
    [sprite, sheet, player].map(async (file) => [
      file,
      sha256(await readFile(file)),
    ]),
  ),
);
async function generate(name, inputs, settings = {}) {
  const file = resolve(root, name + ".json");
  await writeFile(
    file,
    JSON.stringify({
      format: "ferrum2d.sprite-normals.config",
      version: 1,
      inputs,
      outputDir: name,
      settings,
    }),
  );
  const result = await execute(
    process.execPath,
    ["scripts/tools/generate-sprite-normals.mjs", "--config", file],
    { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.generator.binarySha256, generator.manifest.binarySha256);
  assert.equal(report.normalFormat, "opengl");
  return report;
}
const started = performance.now();
const batch = await generate("batch", [sprite, player]);
const neutral = await generate("neutral", [sprite], { normalStrength: 0 });
const frames = await generate("frames", [sheet], {
  frameSize: { width: 32, height: 32 },
});
const normalPath = resolve(root, "batch", batch.results[0].normal);
const normal = decodePng(await readFile(normalPath)),
  blank = decodePng(
    await readFile(resolve(root, "neutral", neutral.results[0].normal)),
  );
const atlas = decodePng(
  await readFile(resolve(root, "frames", frames.results[0].normal)),
);
assert.equal(normal.width, 32);
assert.equal(normal.height, 32);
let nonFlat = 0;
for (let i = 0; i < pixels.length; i += 4) {
  assert.equal(normal.pixels[i + 3], pixels[i + 3]);
  assert.deepEqual([...blank.pixels.subarray(i, i + 3)], [128, 128, 255]);
  if (
    pixels[i + 3] &&
    (Math.abs(normal.pixels[i] - 128) > 5 ||
      Math.abs(normal.pixels[i + 1] - 128) > 5)
  )
    nonFlat++;
}
assert(nonFlat > 100, "Actual generator produced no surface relief");
for (let y = 0; y < 32; y++)
  for (let frame = 0; frame < 2; frame++)
    assert.deepEqual(
      [
        ...atlas.pixels.subarray(
          (y * 64 + frame * 32) * 4,
          (y * 64 + frame * 32 + 32) * 4,
        ),
      ],
      [...normal.pixels.subarray(y * 128, (y + 1) * 128)],
    );
const metadata = JSON.parse(
  await readFile(resolve(root, "frames", frames.results[0].frames), "utf8"),
);
assert.equal(metadata.animation.frame_count, 2);
assert.equal(metadata.animation.columns, 2);
assert.deepEqual(metadata.animation.delays_ms, [
  [100, 1],
  [100, 1],
]);
for (const result of batch.results) {
  const source = decodePng(await readFile(result.input.path)),
    mapped = decodePng(await readFile(resolve(root, "batch", result.normal)));
  assert.equal(source.width, mapped.width);
  assert.equal(source.height, mapped.height);
  for (let i = 3; i < source.pixels.length; i += 4)
    assert.equal(source.pixels[i], mapped.pixels[i]);
}
for (const [path, hash] of originals)
  assert.equal(sha256(await readFile(path)), hash);
const repeat = await execute(
  process.execPath,
  [
    "scripts/tools/generate-sprite-normals.mjs",
    "--config",
    resolve(root, "batch.json"),
  ],
  { cwd: repositoryRoot },
).then(
  () => assert.fail("Existing job outputs were overwritten"),
  (error) => JSON.parse(error.stderr),
);
assert.equal(repeat.code, "FERRUM_NORMAL_OUTPUT_EXISTS");
assert(
  !(await readdir(resolve(root, "batch"))).some((name) =>
    name.startsWith(".normal-stage-"),
  ),
);

const html = `<!doctype html><html><head><style>html,body{margin:0}canvas{width:480px;height:360px;display:block}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/engine/dist/core.js","@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js"}}</script></head><body><canvas></canvas><script type="module">import {probeGeneratedNormals} from '/probe.mjs';try{window.normalProbeReport=await probeGeneratedNormals()}catch(error){window.normalProbeError=error.stack}</script></body></html>`;
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }
    let file;
    if (pathname === "/color.png") file = sprite;
    else if (pathname === "/normal.png") file = normalPath;
    else if (pathname === "/probe.mjs")
      file = resolve(
        repositoryRoot,
        "tests/smoke/sprite-normals-browser-fixture.mjs",
      );
    else if (pathname.startsWith("/engine/")) {
      const base = resolve(repositoryRoot, "packages/ferrum-web");
      file = resolve(base, "." + decodeURIComponent(pathname.slice(7)));
      if (!file.startsWith(base + sep)) {
        response.writeHead(403).end();
        return;
      }
    } else {
      response.writeHead(404).end();
      return;
    }
    response.setHeader(
      "Content-Type",
      {
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".png": "image/png",
      }[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  })().catch((error) => {
    response.writeHead(500).end(error.message);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.exposeFunction("saveNormalScreenshot", async (name, data) =>
    writeFile(
      resolve(root, name + ".png"),
      Buffer.from(data.split(",")[1], "base64"),
    ),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(
    () => globalThis.normalProbeReport || globalThis.normalProbeError,
    undefined,
    { timeout: 30_000 },
  );
  const probe = await page.evaluate(() => ({
    report: globalThis.normalProbeReport,
    error: globalThis.normalProbeError,
  }));
  assert.equal(probe.error, undefined);
  assert.deepEqual(errors, []);
  const report = {
    ok: true,
    generator: generator.manifest,
    run: root,
    nonFlatPixels: nonFlat,
    alphaPreserved: true,
    sheetFramesIsolated: true,
    sourceHashesUnchanged: true,
    overwriteRejected: true,
    renderer: probe.report,
    elapsedMs: performance.now() - started,
    scope:
      "PNG/batch/uniform-sheet CLI and WebGL2 integration; GIF/APNG conversion, WebGPU and Assets UI are outside this PNG probe",
  };
  await writeFile(
    resolve(artifacts, "verification.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
