import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Use task-scoped source bundles: no stale package dist or shared build outputs.
const require = createRequire(new URL("../../apps/studio/package.json", import.meta.url));
const { build } = createRequire(require.resolve("vite"))("esbuild");
const root = fileURLToPath(new URL("../../", import.meta.url));
const source = (name) => fileURLToPath(new URL(`../../packages/ferrum-web/src/${name}.ts`, import.meta.url));
const authoring = [
  ["resolveSceneCompositionSpec", "sceneComposition"],
  ["resolveDataSceneComponentsSpec", "dataSceneComponents"],
  ["resolveDataSceneSpatialSpec", "dataSceneSpatial"],
  ["createScenePlacementViewer", "scenePlacementViewer"],
  ["resolveSceneAuthoringDocument", "sceneAuthoringDocument"],
  ["mergeScenePlacementPatch", "scenePlacementPatch"],
  ["instantiateSceneFragment", "sceneComposition"],
  ["resolveDataSceneInstanceComponents", "dataSceneComponents"],
].map(([name, path]) => `export {${name}} from ${JSON.stringify(source(path))};`).join("\n");
const core = [
  ["UNIFIED_PHYSICS_STATE_LAYOUT", "unifiedPhysics"],
  ["UNIFIED_PHYSICS_CHARACTER_LAYOUT", "unifiedPhysicsCharacters"],
].map(([name, path]) => `export {${name}} from ${JSON.stringify(source(path))};`).join("\n");

export async function studioSourceModule(contents) {
  const output = await build({
    stdin: { contents, resolveDir: root, loader: "ts" },
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{ name: "studio-test-source-imports", setup(plugin) {
      plugin.onResolve({ filter: /^@ferrum2d\/ferrum-web\/(authoring|core)$/ }, ({ path }) => ({ path, namespace: "source-api" }));
      plugin.onLoad({ filter: /.*/, namespace: "source-api" }, ({ path }) => ({ contents: path.endsWith("/authoring") ? authoring : core, resolveDir: root, loader: "ts" }));
      plugin.onResolve({ filter: /^@ferrum2d\/studio-kit$/ }, () => ({ path: fileURLToPath(new URL("../../packages/ferrum-studio-kit/src/index.ts", import.meta.url)) }));
    } }],
  });
  const code = output.outputFiles[0].text, hash = createHash("sha256").update(code).digest("hex");
  const directory = new URL("../../artifacts/physics-3d/aggregate-authoring/studio/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const path = new URL(`source-${hash}.mjs`, directory);
  await writeFile(path, code);
  return import(path.href);
}
