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
import { animatedGif, animatedApng } from "./sprite-normal-media-fixtures.mjs";
import { installSpatialGpuTarget } from "./spatial-webgpu-capture.mjs";

const integration = process.argv.includes("--integration");
const bindingMode = integration || process.argv.includes("--bindings");
const generator = await installedTool(),
  artifacts = resolve(
    repositoryRoot,
    `artifacts/sprite-normal-authoring/${integration ? "phase-6" : bindingMode ? "phase-3" : "phase-2"}`,
  );
await mkdir(artifacts, { recursive: true });
const root = await mkdtemp(resolve(artifacts, "run-"));
const started = performance.now();
for (const [name, data] of [
  ["gif.gif", animatedGif()],
  ["apng.apng", animatedApng()],
])
  await writeFile(resolve(root, name), data);
async function generate(name, inputs, extra = {}) {
  const file = resolve(root, name + ".json");
  await writeFile(
    file,
    JSON.stringify({
      format: "ferrum2d.sprite-normals.config",
      version: 1,
      inputs,
      outputDir: name,
      ...extra,
    }),
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/tools/generate-sprite-normals.mjs", "--config", file],
    { cwd: repositoryRoot, timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}
const report = await generate("animations", ["gif.gif", "apng.apng"], {
    animation: { loop: false },
  }),
  output = resolve(root, "animations");
const media = [];
for (const [index, kind] of ["gif", "apng"].entries()) {
  const result = report.results[index],
    rawColor = decodePng(await readFile(resolve(output, result.color))),
    rawNormal = decodePng(await readFile(resolve(output, result.normal)));
  const metadata = JSON.parse(await readFile(resolve(output, result.frames))),
    descriptor = JSON.parse(
      await readFile(resolve(output, result.ferrumAnimation.descriptor)),
    );
  const {
    frame_width: fw,
    frame_height: fh,
    columns,
    frame_count: count,
  } = metadata.animation;
  const at = (frame, x, y) => [
    ...rawColor.pixels.slice(
      ((Math.floor(frame / columns) * fh + y) * rawColor.width +
        (frame % columns) * fw +
        x) *
        4,
      ((Math.floor(frame / columns) * fh + y) * rawColor.width +
        (frame % columns) * fw +
        x) *
        4 +
        4,
    ),
  ];
  if (kind === "gif") {
    assert.equal(count, 4);
    assert.deepEqual(metadata.animation.delays_ms, [
      [50, 1],
      [90, 1],
      [120, 1],
      [60, 1],
    ]);
    assert.deepEqual(at(1, 4, 4), [30, 200, 60, 255]);
    assert.deepEqual(at(2, 4, 4), [200, 40, 20, 255]);
    assert.deepEqual(at(2, 10, 10), [40, 70, 220, 255]);
    assert.equal(at(3, 10, 10)[3], 0);
    assert.equal(at(0, 0, 0)[3], 0);
    assert.deepEqual(descriptor.timing.repeats, [5, 9, 12, 6]);
  } else {
    assert.equal(count, 3);
    assert.deepEqual(at(1, 4, 3), [50, 100, 200, 255]);
    assert.deepEqual(at(2, 4, 3), [200, 100, 50, 255]);
    const blended = at(2, 2, 2);
    assert(
      Math.abs(blended[0] - 125) <= 1 &&
        Math.abs(blended[2] - 125) <= 1 &&
        Math.abs(blended[3] - 255) <= 1,
    );
    const delays = metadata.animation.delays_ms.map(([n, d]) => n / d);
    assert(Math.abs(delays[0] - 1000 / 12) < 1e-10);
    assert.equal(delays[1], 50);
    assert(Math.abs(delays[2] - 1000 / 30) < 1e-10);
    assert.deepEqual(descriptor.timing.repeats, [5, 3, 2]);
    for (let y = fh; y < rawColor.height; y++)
      for (let x = fw; x < rawColor.width; x++)
        assert.equal(rawColor.pixels[(y * rawColor.width + x) * 4 + 3], 0);
  }
  const packedColor = decodePng(
      await readFile(resolve(output, result.ferrumAnimation.color)),
    ),
    packedNormal = decodePng(
      await readFile(resolve(output, result.ferrumAnimation.normal)),
    );
  const standalone = [];
  for (let frame = 0; frame < count; frame++) {
    const pixels = new Uint8Array(fw * fh * 4),
      placement = descriptor.atlas.placements.find(
        (p) => p.name === `frame-${String(frame).padStart(3, "0")}`,
      );
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const source =
            ((Math.floor(frame / columns) * fh + y) * rawColor.width +
              (frame % columns) * fw +
              x) *
            4,
          target =
            ((placement.y + y) * packedColor.width + placement.x + x) * 4;
        pixels.set(
          rawColor.pixels.subarray(source, source + 4),
          (y * fw + x) * 4,
        );
        assert.deepEqual(
          packedColor.pixels.slice(target, target + 4),
          rawColor.pixels.slice(source, source + 4),
        );
        assert.deepEqual(
          packedNormal.pixels.slice(target, target + 4),
          rawNormal.pixels.slice(source, source + 4),
        );
        assert.equal(rawColor.pixels[source + 3], rawNormal.pixels[source + 3]);
      }
    const path = `${kind}-frame-${frame}.png`;
    await writeFile(resolve(root, path), encodePngRgba(fw, fh, pixels));
    standalone.push(path);
  }
  const isolated = await generate(`${kind}-isolated`, standalone);
  for (const [frame, single] of isolated.results.entries()) {
    const normal = decodePng(
      await readFile(resolve(root, `${kind}-isolated`, single.normal)),
    );
    for (let y = 0; y < fh; y++)
      for (let x = 0; x < fw; x++) {
        const source =
            ((Math.floor(frame / columns) * fh + y) * rawNormal.width +
              (frame % columns) * fw +
              x) *
            4,
          p = (y * fw + x) * 4;
        assert.deepEqual(
          normal.pixels.slice(p, p + 4),
          rawNormal.pixels.slice(source, source + 4),
        );
      }
  }
  assert.equal(
    sha256(
      await readFile(resolve(root, kind === "gif" ? "gif.gif" : "apng.apng")),
    ),
    result.input.sha256,
  );
  for (const artifact of result.outputs)
    assert.equal(
      sha256(await readFile(resolve(output, artifact.path))),
      artifact.sha256,
    );
  media.push({
    kind,
    result,
    descriptor,
    compositing: true,
    decodedAlphaPreserved: true,
    compositingToleranceBytes: kind === "apng" ? 1 : 0,
    framesIsolated: true,
    sharedLayout: true,
    sourceHashUnchanged: true,
  });
}
// PNG sheet export uses the same adapter; source frame sizes and default 100ms delays survive.
const sheet = await generate("sheet", ["gif-frame-0.png"], {
  settings: { frameSize: { width: 8, height: 16 } },
  animation: { loop: true, padding: 0, powerOfTwo: false },
});
const sheetDescriptor = JSON.parse(
  await readFile(
    resolve(root, "sheet", sheet.results[0].ferrumAnimation.descriptor),
  ),
);
assert.equal(sheetDescriptor.animationSet.clips[0].frames.length, 2);
assert.equal(sheetDescriptor.animationSet.clips[0].fps, 10);
assert.equal(sheetDescriptor.animationSet.clips[0].loop, true);
assert(
  !(await readdir(output)).some((name) => name.startsWith(".normal-stage-")),
);
if (bindingMode && !integration) {
  const reportPath = resolve(
      root,
      "gif-isolated/normal-generation.report.json",
    ),
    single = JSON.parse(await readFile(reportPath, "utf8"));
  media.push({
    kind: "png",
    result: single.results[0],
    resultIndex: 0,
    reportPath,
    colorPath: single.results[0].input.path,
    normalPath: resolve(root, "gif-isolated", single.results[0].normal),
  });
}

let active;
const probeExport = integration
  ? "probeNormalIntegration"
  : bindingMode
    ? "probeNormalBinding"
    : "probeNormalAnimation";
const html = `<!doctype html><html><head><style>html,body{margin:0}canvas{width:480px;height:360px;display:block}</style><script type="importmap">{"imports":{"@ferrum2d/ferrum-web/core":"/engine/dist/core.js","@ferrum2d/ferrum-web/authoring":"/engine/dist/authoring.js"}}</script></head><body><canvas></canvas><script type="module">import {${probeExport}} from '/probe.mjs';try{window.probeReport=await ${probeExport}()}catch(error){window.probeError=error.stack}</script></body></html>`;
const server = createServer((request, response) => {
  void (async () => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(html);
      return;
    }
    if (bindingMode && pathname === "/context.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          resultIndex: active.resultIndex ?? media.indexOf(active),
          animated: !!active.descriptor,
        }),
      );
      return;
    }
    let file;
    if (bindingMode && pathname === "/report.json")
      file =
        active.reportPath ?? resolve(output, "normal-generation.report.json");
    else if (pathname === "/animation.json")
      file = resolve(output, active.result.ferrumAnimation.descriptor);
    else if (pathname === "/color.png")
      file =
        active.colorPath ??
        resolve(output, active.result.ferrumAnimation.color);
    else if (pathname === "/normal.png")
      file =
        active.normalPath ??
        resolve(output, active.result.ferrumAnimation.normal);
    else if (pathname === "/probe.mjs")
      file = resolve(
        repositoryRoot,
        `tests/smoke/sprite-normal-${integration ? "integration" : bindingMode ? "binding" : "animation"}-browser-fixture.mjs`,
      );
    else if (
      [
        "/sprite-normal-binding-browser-fixture.mjs",
        "/spatial-webgpu-browser-fixture.mjs",
      ].includes(pathname)
    )
      file = resolve(repositoryRoot, "tests/smoke", pathname.slice(1));
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
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".png": "image/png",
      }[extname(file)] ?? "application/octet-stream",
    );
    response.end(await readFile(file));
  })().catch((error) => response.writeHead(500).end(error.message));
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
      ...(integration
        ? ["--enable-unsafe-webgpu", "--use-vulkan=swiftshader"]
        : []),
    ],
  });
  for (const entry of media) {
    active = entry;
    entry.integrationCases = integration ? [] : undefined;
    for (const deviceScaleFactor of integration ? [1, 2] : [1]) {
      const page = await browser.newPage({ deviceScaleFactor }),
        errors = [];
      if (integration) await page.addInitScript(installSpatialGpuTarget);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.exposeFunction("saveAnimationScreenshot", async (name, data) =>
        writeFile(
          resolve(
            root,
            entry.kind +
              (integration ? "-dpr" + deviceScaleFactor : "") +
              "-" +
              name +
              ".png",
          ),
          Buffer.from(data.split(",")[1], "base64"),
        ),
      );
      if (bindingMode)
        await page.exposeFunction("saveNormalBindingArtifacts", async (data) =>
          writeFile(
            resolve(root, entry.kind + "-authoring.json"),
            JSON.stringify(data, null, 2) + "\n",
          ),
        );
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.waitForFunction(
        () => globalThis.probeReport || globalThis.probeError,
        undefined,
        { timeout: integration ? 120000 : 30000 },
      );
      const probe = await page.evaluate(() => ({
        report: globalThis.probeReport,
        error: globalThis.probeError,
      }));
      assert.equal(probe.error, undefined);
      assert.deepEqual(errors, []);
      if (integration) {
        if (process.env.FERRUM_REQUIRE_WEBGPU === "1")
          assert.equal(
            probe.report.webgpu.available,
            true,
            "This run requires a native WebGPU adapter",
          );
        entry.integrationCases.push({ deviceScaleFactor, ...probe.report });
      }
      if (!integration) entry.renderer = probe.report;
      await page.close();
    }
  }
  const verification = {
    ok: true,
    generator: generator.manifest,
    run: root,
    media: media.map(({ descriptor, result, ...entry }) => ({
      ...entry,
      descriptor: result.ferrumAnimation?.descriptor,
      timing: descriptor?.timing,
    })),
    pngSheetExport: true,
    elapsedMs: performance.now() - started,
    scope: integration
      ? "Generated GIF/APNG paired atlases through real native 2D/HD-2D, frame/flip/rotation/DPR matrix, available WebGPU and forced WebGL2 fallback. WebGPU uses the existing offscreen capture target; no native canvas presentation claim."
      : bindingMode
        ? "Generated paired assets through stable references, deterministic patch/handoff, document round-trip, changed runtime IDs and preflight preservation. Worker and Assets generation UI are later phases."
        : "Pinned GIF/APNG compositing, exact rational timing, shared paired packing and real native WebGL2 playback; Worker/UI are later phases",
  };
  await writeFile(
    resolve(
      artifacts,
      integration ? "renderer-verification.json" : "verification.json",
    ),
    JSON.stringify(verification, null, 2) + "\n",
  );
  console.log(JSON.stringify(verification, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
