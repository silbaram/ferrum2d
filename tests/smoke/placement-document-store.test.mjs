import { deepEqual, equal, rejects } from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { savePlacementDocument } from "../../apps/placement-viewer/server/sceneDocumentStore.mjs";

const source = { format: "ferrum2d.consumer.scene-authoring", version: 1, sceneComposition: { initialFragment: "main", fragments: { main: { instances: [] } } } };

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "ferrum-checked-save-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "scene.json");
  await writeFile(file, JSON.stringify(source));
  return { file, directory };
}

test("checked save replaces matching JSON and removes its temporary file", async t => {
  const { file, directory } = await fixture(t);
  await chmod(file, 0o600);
  const document = { ...source, metadata: { author: "editor" } };
  deepEqual(await savePlacementDocument(file, document, structuredClone(source)), { saved: true, document });
  deepEqual(JSON.parse(await readFile(file, "utf8")), document);
  deepEqual(await readdir(directory), ["scene.json"]);
  if (process.platform !== "win32") equal((await stat(file)).mode & 0o777, 0o600);
});

test("checked save preserves an external edit and rejects a stale retry", async t => {
  const { file, directory } = await fixture(t);
  const external = { ...source, metadata: { author: "agent" } };
  const bytes = `${JSON.stringify(external, null, 4)}\n`;
  await writeFile(file, bytes);
  await rejects(savePlacementDocument(file, source, source), { code: "PLACEMENT_DOCUMENT_CONFLICT" });
  equal(await readFile(file, "utf8"), bytes);
  deepEqual(await readdir(directory), ["scene.json"]);
});

test("checked save serializes competing requests so only one shared baseline succeeds", async t => {
  const { file, directory } = await fixture(t);
  const first = { ...source, metadata: { writer: 1 } };
  const second = { ...source, metadata: { writer: 2 } };
  const results = await Promise.allSettled([
    savePlacementDocument(file, first, source), savePlacementDocument(file, second, source),
  ]);
  equal(results[0].status, "fulfilled");
  equal(results[1].status, "rejected");
  equal(results[1].reason.code, "PLACEMENT_DOCUMENT_CONFLICT");
  deepEqual(JSON.parse(await readFile(file, "utf8")), first);
  // A rejected request must not poison this file's queue.
  await savePlacementDocument(file, second, first);
  deepEqual(JSON.parse(await readFile(file, "utf8")), second);
  deepEqual(await readdir(directory), ["scene.json"]);
});

test("checked save compares JSON meaning rather than whitespace and key order", async t => {
  const { file } = await fixture(t);
  await writeFile(file, JSON.stringify({ sceneComposition: source.sceneComposition, version: 1, format: source.format }, null, 4));
  await savePlacementDocument(file, source, source);
});

test("checked save rejects missing baseline or malformed documents without writing", async t => {
  const { file } = await fixture(t);
  const bytes = await readFile(file, "utf8");
  await rejects(savePlacementDocument(file, source, undefined), /invalid placement/);
  await rejects(savePlacementDocument(file, { ...source, sceneComposition: [] }, source), /invalid placement/);
  equal(await readFile(file, "utf8"), bytes);
});
