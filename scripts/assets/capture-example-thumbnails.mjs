// Capture gallery thumbnails from the real production example suite (dist-pages).
// Run after `pnpm --filter "./examples/*" build && pnpm build:pages`.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { EXAMPLE_THUMBNAIL_DIR, exampleThumbnailEntries } from "../../examples/shared/gallery/thumbnailNames.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const site = resolve(root, "dist-pages");
const output = resolve(root, EXAMPLE_THUMBNAIL_DIR);
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7).split(",");
const WIDTH = 640, HEIGHT = 400, QUALITY = 0.8;

if (!existsSync(resolve(site, "index.html"))) throw Error("Missing dist-pages. Run pnpm build:pages first.");
const [catalog, features, physics] = await Promise.all([
  "examples/shared/exampleCatalog.json", "examples/shared/featureCatalog.json", "examples/shared/physicsExamples.json",
].map(async path => JSON.parse(await readFile(resolve(root, path), "utf8"))));
const entries = exampleThumbnailEntries({ catalog, features, physics })
  .filter(entry => !only || only.some(name => entry.name.startsWith(name)));

const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
  ".glb": "model/gltf-binary", ".ktx2": "image/ktx2", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
const server = createServer(async (req, res) => {
  try {
    const relative = decodeURIComponent(new URL(req.url, "http://localhost").pathname).slice(1);
    const file = resolve(site, !relative || relative.endsWith("/") ? relative + "index.html" : relative);
    if (!file.startsWith(site + sep)) throw Error("outside site");
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
const origin = `http://127.0.0.1:${server.address().port}/`;

// The example has drawn at least one real frame before it is captured.
async function ready(page) {
  await page.waitForFunction(() => {
    const lab = window.ferrumFeatureLab?.snapshot?.();
    if (lab) return lab.nativeState === 1 && lab.commands > 0;
    const sandbox = window.ferrumPhysicsSandboxSmokeFrame;
    if (sandbox) return sandbox.frameCount > 30;
    const pixel = window.ferrumPixelShowcase?.snapshot?.();
    if (pixel) return pixel.commands > 0;
    return (window.ferrumEngine?.entityCount?.() ?? 0) > 0 || document.querySelector("canvas") !== null;
  }, undefined, { timeout: 30000 });
  await page.waitForTimeout(1200);
}

let browser;
const failures = [];
try {
  await mkdir(output, { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.FERRUM_BROWSER_EXECUTABLE,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const scaler = await browser.newPage();
  for (const entry of entries) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(new URL(entry.path, origin).href);
      await ready(page);
      const canvas = page.locator("canvas").first();
      const png = await canvas.screenshot({ type: "png" });
      // Center-crop to the 16:10 card frame and encode a small JPEG.
      const dataUrl = await scaler.evaluate(async ({ source, width, height, quality }) => {
        const image = new Image(); image.src = source; await image.decode();
        const scale = Math.max(width / image.width, height / image.height);
        const canvas = Object.assign(document.createElement("canvas"), { width, height });
        const context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(image, (width - image.width * scale) / 2, (height - image.height * scale) / 2, image.width * scale, image.height * scale);
        return canvas.toDataURL("image/jpeg", quality);
      }, { source: `data:image/png;base64,${png.toString("base64")}`, width: WIDTH, height: HEIGHT, quality: QUALITY });
      await writeFile(resolve(output, entry.name), Buffer.from(dataUrl.split(",")[1], "base64"));
      if (errors.length) failures.push(`${entry.name}: ${errors[0]}`);
      console.log(`captured ${entry.name}`);
    } catch (error) {
      failures.push(`${entry.name}: ${error.message.split("\n")[0]}`);
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  server.close();
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`Captured ${entries.length} thumbnails into ${EXAMPLE_THUMBNAIL_DIR}`);
