import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReleaseCommand } from "../../scripts/package/release-command.mjs";

export const placementRegressionFixture = fileURLToPath(new URL("../fixtures/placement.scene-authoring.json", import.meta.url));
export const placementSpatialRegressionFixture = fileURLToPath(new URL("../fixtures/placement.hd2d.scene-authoring.json", import.meta.url));
const app = fileURLToPath(new URL("../../apps/placement-viewer/", import.meta.url));
const builds = new Map();

/** Private, disposable regression assets. Never modify the production dist or public directory. */
export function preparePlacementTestBuild(dist, { save = false } = {}) {
  const key = path.resolve(dist) + ":" + save;
  if (!builds.has(key)) builds.set(key, create(dist, save));
  return builds.get(key);
}
async function create(dist, save) {
  await readFile(path.join(dist, "index.html")); // A missing production build must still fail the gate.
  const root = await mkdtemp(path.join(tmpdir(), "ferrum-placement-regression-"));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  process.once("exit", cleanup);
  try {
    await runReleaseCommand("pnpm", ["exec", "vite", "build", "--base=./", "--mode", "test", "--outDir", root], {
      cwd: app, timeoutMs: 120_000,
      env: { ...process.env, VITE_FERRUM_PLACEMENT_VIEWER_SAVE: String(save) },
    });
    const catalog = JSON.parse(await readFile(path.join(root, "placement-scenes.json"), "utf8"));
    for (const [source, relativePath, mode] of [
      [placementRegressionFixture, "placement.scene-authoring.json", "2d"],
      [placementSpatialRegressionFixture, "placement.hd2d.scene-authoring.json", "hd2d"],
    ]) {
      await cp(source, path.join(root, relativePath));
      catalog.scenes.push({ relativePath, mode });
    }
    catalog.scenes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
    await writeFile(path.join(root, "placement-scenes.json"), JSON.stringify(catalog));
    return root;
  } catch (error) { process.off("exit", cleanup); await rm(root, { recursive: true, force: true }); throw error; }
}
