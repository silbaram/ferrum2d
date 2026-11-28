#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listExampleFiles } from "../../apps/studio/server/exampleContent.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const studioExamplesRoot = path.join(repositoryRoot, "apps/studio/examples");
const exampleScenes = ["placement.garden.scene-authoring.json", "placement.village.scene-authoring.json"];

function catalog(dir) {
  return JSON.parse(readFileSync(path.join(dir, "placement-scenes.json"), "utf8"));
}

/**
 * The product build (installed desktop Studio and its release assets) must not ship any bundled
 * example scene or asset, and its project scene list must be empty.
 */
export async function assertStudioFrontendWithoutExamples(dir) {
  if (!existsSync(path.join(dir, "index.html"))) throw new Error(`Missing Studio build ${path.join(dir, "index.html")}`);
  const shipped = (await listExampleFiles(studioExamplesRoot)).filter(file => existsSync(path.join(dir, file)));
  if (shipped.length) throw new Error(`Studio product build contains example files: ${shipped.slice(0, 8).join(", ")}`);
  for (const folder of ["assets/lantern-garden", "assets/rpg-village"])
    if (existsSync(path.join(dir, folder))) throw new Error(`Studio product build contains example folder ${folder}`);
  const scenes = catalog(dir).scenes;
  if (!Array.isArray(scenes) || scenes.length !== 0)
    throw new Error(`Studio product build lists project scenes: ${JSON.stringify(scenes)}`);
}

/** The web demo build ships every example file unchanged and lists exactly the two example scenes. */
export async function assertStudioDemoWithExamples(dir) {
  if (!existsSync(path.join(dir, "index.html"))) throw new Error(`Missing Studio demo build ${path.join(dir, "index.html")}`);
  for (const file of await listExampleFiles(studioExamplesRoot)) {
    const built = path.join(dir, file);
    if (!existsSync(built)) throw new Error(`Studio demo build is missing example file ${file}`);
    if (!readFileSync(built).equals(readFileSync(path.join(studioExamplesRoot, file))))
      throw new Error(`Studio demo build changed example file ${file}`);
  }
  const listed = catalog(dir).scenes.map(scene => scene.relativePath).sort();
  if (JSON.stringify(listed) !== JSON.stringify(exampleScenes))
    throw new Error(`Studio demo build lists ${JSON.stringify(listed)}, expected ${JSON.stringify(exampleScenes)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [product, demo] = process.argv.slice(2);
  if (!product || !demo) {
    console.error("Usage: node scripts/validate/check-studio-build-variants.mjs <product-dist> <demo-dist>");
    process.exit(2);
  }
  try {
    await assertStudioFrontendWithoutExamples(path.resolve(product));
    await assertStudioDemoWithExamples(path.resolve(demo));
    const files = (await listExampleFiles(studioExamplesRoot)).length;
    console.log(JSON.stringify({ product: "no examples", demo: `${files} example files`, scenes: exampleScenes }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
