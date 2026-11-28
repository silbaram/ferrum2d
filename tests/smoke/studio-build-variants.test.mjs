import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertStudioDemoWithExamples,
  assertStudioFrontendWithoutExamples,
  studioExamplesRoot,
} from "../../scripts/validate/check-studio-build-variants.mjs";
import { studioExamplesEnabled } from "../../apps/studio/server/exampleContent.mjs";

const emptyCatalog = { version: 1, scenes: [], truncated: false, diagnostics: [] };
const demoCatalog = { version: 1, scenes: [
  { relativePath: "placement.garden.scene-authoring.json", mode: "2d" },
  { relativePath: "placement.village.scene-authoring.json", mode: "hd2d" },
], truncated: false, diagnostics: [] };

async function build(catalog, examples = false) {
  const root = await mkdtemp(path.join(tmpdir(), "ferrum-studio-variant-"));
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>Studio</title>");
  await writeFile(path.join(root, "placement-scenes.json"), JSON.stringify(catalog));
  if (examples) await cp(studioExamplesRoot, root, { recursive: true });
  return root;
}

test("only the dev server, the web demo and regression builds include examples", () => {
  assert.equal(studioExamplesEnabled({ command: "build", mode: "production" }), false);
  assert.equal(studioExamplesEnabled({ command: "build", mode: "demo" }), true);
  assert.equal(studioExamplesEnabled({ command: "build", mode: "test" }), true);
  assert.equal(studioExamplesEnabled({ command: "serve", mode: "development" }), true);
});

test("the product check rejects any shipped example file, folder or listed scene", async () => {
  const roots = [];
  try {
    const clean = await build(emptyCatalog); roots.push(clean);
    await assertStudioFrontendWithoutExamples(clean);

    const scene = await build(emptyCatalog); roots.push(scene);
    await writeFile(path.join(scene, "placement.village.scene-authoring.json"), "{}");
    await assert.rejects(assertStudioFrontendWithoutExamples(scene), /contains example files: placement\.village/);

    const folder = await build(emptyCatalog); roots.push(folder);
    await mkdir(path.join(folder, "assets/rpg-village"), { recursive: true });
    await assert.rejects(assertStudioFrontendWithoutExamples(folder), /example folder assets\/rpg-village/);

    const listed = await build(demoCatalog); roots.push(listed);
    await assert.rejects(assertStudioFrontendWithoutExamples(listed), /lists project scenes/);
  } finally {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
  }
});

test("the demo check requires every example file unchanged and both example scenes listed", async () => {
  const roots = [];
  try {
    const demo = await build(demoCatalog, true); roots.push(demo);
    await assertStudioDemoWithExamples(demo);

    const missing = await build(demoCatalog, true); roots.push(missing);
    await rm(path.join(missing, "assets/lantern-garden/manifest.json"));
    await assert.rejects(assertStudioDemoWithExamples(missing), /missing example file assets\/lantern-garden\/manifest\.json/);

    const changed = await build(demoCatalog, true); roots.push(changed);
    await writeFile(path.join(changed, "placement.garden.scene-authoring.json"), "{}");
    await assert.rejects(assertStudioDemoWithExamples(changed), /changed example file placement\.garden/);

    const unlisted = await build(emptyCatalog, true); roots.push(unlisted);
    await assert.rejects(assertStudioDemoWithExamples(unlisted), /lists \[\]/);
  } finally {
    await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })));
  }
});
