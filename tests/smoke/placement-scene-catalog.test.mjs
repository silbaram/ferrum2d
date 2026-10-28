import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { scanPlacementScenes } from "../../apps/placement-viewer/server/sceneCatalog.mjs";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url));
const ts = require("typescript");
const code = ts.transpileModule(await readFile(new URL("../../apps/placement-viewer/src/placementSceneCatalog.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { folderSceneCatalog, safeSceneRelativePath, hostedSceneCatalog } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const doc = JSON.stringify({ format: "ferrum2d.consumer.scene-authoring", version: 1 });

test("fixed-root index finds nested generic JSON scenes, rejects symlinks, reports invalid known files and bounded reads", async () => {
  const root = await mkdtemp(join(tmpdir(), "ferrum-scenes-"));
  try {
    await mkdir(join(root, "levels")); await mkdir(join(root, "assets"));
    await writeFile(join(root, "levels/cave.json"), doc);
    await writeFile(join(root, "assets/skip.scene-authoring.json"), doc);
    await writeFile(join(root, "broken.scene-authoring.json"), "{");
    await writeFile(join(root, "game.json"), "{}");
    await writeFile(join(root, "room#1.json"), doc);
    await writeFile(join(root, "big.scene-authoring.json"), " ".repeat(2 * 1024 * 1024 + 1));
    await symlink(root, join(root, "loop"));
    await symlink(join(root, "levels/cave.json"), join(root, "linked.scene-authoring.json"));
    const value = await scanPlacementScenes(root);
    assert.deepEqual(value.scenes.map(e => [e.relativePath, e.mode]), [
      ["big.scene-authoring.json", "invalid"], ["broken.scene-authoring.json", "invalid"], ["levels/cave.json", "2d"],
    ]);
    assert.equal(value.truncated, true);
    assert.equal("document" in value.scenes[2], false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("scene count budget truncates a catalog without emitting more than 256 entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ferrum-scene-limit-"));
  try {
    await Promise.all(Array.from({ length: 257 }, (_, i) => writeFile(join(root, `room-${String(i).padStart(3, "0")}.json`), doc)));
    const value = await scanPlacementScenes(root);
    assert.equal(value.scenes.length, 256); assert.equal(value.truncated, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unreadable children retain normal scenes and report bounded diagnostics; explicit root errors reject", async context => {
  if (process.platform === "win32" || process.getuid?.() === 0) { context.skip("POSIX permission fixture requires an unprivileged Unix user"); return; }
  const root = await mkdtemp(join(tmpdir(), "ferrum-scene-unreadable-"));
  const blocked = join(root, "z-private");
  try {
    await writeFile(join(root, "a.scene-authoring.json"), doc);
    await mkdir(blocked); await writeFile(join(blocked, "room.json"), doc); await chmod(blocked, 0);
    const value = await scanPlacementScenes(root);
    assert.deepEqual(value.scenes.map(e => e.relativePath), ["a.scene-authoring.json"]);
    assert.deepEqual(value.diagnostics, [{ relativePath: "z-private", code: "EACCES" }]);
    assert.equal(value.truncated, false);
    await assert.rejects(scanPlacementScenes(blocked), { code: "EACCES" });
    const decoded = await (async () => {
      const original = globalThis.fetch;
      try { globalThis.fetch = async () => new Response(JSON.stringify(value)); return await hostedSceneCatalog(new URL("https://example.test/editor/")); }
      finally { globalThis.fetch = original; }
    })();
    assert.deepEqual(decoded.diagnostics, value.diagnostics);
  } finally { await chmod(blocked, 0o700); await rm(root, { recursive: true, force: true }); }
});

test("catalog paths reject escapes, absolute URLs, encoded separators and ambiguous fragments", () => {
  for (const path of ["../scene.json", "/scene.json", "levels/../scene.json", "a\\scene.json", "https://evil/scene.json", "x%2fscene.json", "scene.json?x", "./scene.json", "a//scene.json", "a\u0000.json"]) assert.equal(safeSceneRelativePath(path), false, path);
  assert.equal(safeSceneRelativePath("levels/지하 동굴.json"), true);
});

test("folder snapshots skip unrelated JSON/assets, retain diagnostics and lazy read-only file identity", async () => {
  const file = (path, source) => ({ name: path.split("/").pop(), webkitRelativePath: path, size: Buffer.byteLength(source), text: async () => source });
  const value = await folderSceneCatalog([
    file("game/public/town.json", doc), file("game/public/assets/skip.json", doc),
    file("game/node_modules/skip.json", doc), file("game/public/game.json", "{}"),
    file("game/public/broken.scene-authoring.json", "{"),
  ], "selection-1");
  assert.equal(value.folderSnapshot, true); assert.equal(value.label, "game");
  assert.equal(value.scenes.length, 2);
  assert.match(value.scenes[1].id, /^folder:selection-1:/);
  assert.deepEqual(await value.scenes[1].read(), JSON.parse(doc));
  assert.equal(value.scenes[0].mode, "invalid");
});

test("hosted manifest resolves relative to deployment base and refuses duplicate or escaping entries", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ version: 1, scenes: [{ relativePath: "levels/a b.json", mode: "2d" }], truncated: false }));
    const result = await hostedSceneCatalog(new URL("https://example.test/editor/"));
    assert.equal(result.scenes[0].id, "https://example.test/editor/levels/a%20b.json");
    globalThis.fetch = async () => new Response(JSON.stringify({ version: 1, scenes: [{ relativePath: "../bad.json", mode: "2d" }] }));
    await assert.rejects(hostedSceneCatalog(new URL("https://example.test/editor/")), /Invalid scene catalog entry/);
  } finally { globalThis.fetch = original; }
});
