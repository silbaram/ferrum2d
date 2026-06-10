#!/usr/bin/env node
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const createGamePackageRoot = path.join(repoRoot, "packages/create-game");
const createGameCliPath = path.join(repoRoot, "packages/create-game/bin/create-game.mjs");
const manifestPath = path.join(repoRoot, "packages/create-game/templates/manifest.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const jsonResult = await runNode([createGameCliPath, "--list-templates", "--json"]);
assert.equal(jsonResult.code, 0, `create-game --list-templates --json must pass\n${jsonResult.stderr}`);
const report = JSON.parse(jsonResult.stdout);

assert.equal(report.format, "ferrum-create-game-template-list", "template catalog format is invalid");
assert.equal(report.version, 1, "template catalog version is invalid");
assert.equal(report.defaultTemplate, manifest.defaultTemplate, "template catalog defaultTemplate must match manifest");
assert(Array.isArray(report.templates), "template catalog templates must be an array");
assert.equal(report.templates.length, manifest.templates.length, "template catalog template count must match manifest");

for (const template of manifest.templates) {
  const listed = report.templates.find((candidate) => candidate.id === template.id);
  assert(listed !== undefined, `template catalog must include ${template.id}`);
  assert.equal(listed.name, template.name, `${template.id} name must match manifest`);
  assert.equal(listed.description, template.description, `${template.id} description must match manifest`);
  assert.equal(listed.genre, template.genre, `${template.id} genre must match manifest`);
  assert.deepEqual(listed.tags, template.tags, `${template.id} tags must match manifest`);
  assert.deepEqual(listed.sceneAuthoring, template.sceneAuthoring, `${template.id} sceneAuthoring must match manifest`);
  assert.deepEqual(listed.gameplayReplay, template.gameplayReplay, `${template.id} gameplayReplay must match manifest`);
  assert.deepEqual(
    listed.runtimeGameplayReplay,
    template.runtimeGameplayReplay,
    `${template.id} runtimeGameplayReplay must match manifest`,
  );
}

const humanResult = await runNode([createGameCliPath, "--list-templates"]);
assert.equal(humanResult.code, 0, `create-game --list-templates must pass\n${humanResult.stderr}`);
assert(humanResult.stdout.includes("Available Ferrum2D templates:"), "human template list must keep its heading");
assert(!humanResult.stdout.trimStart().startsWith("{"), "human template list must not emit JSON by default");

const misplacedJsonResult = await runNode([createGameCliPath, "--json", "sample-game"]);
assert.notEqual(misplacedJsonResult.code, 0, "create-game --json without --list-templates must fail");
assert(
  misplacedJsonResult.stderr.includes("--json can only be used with --list-templates"),
  "create-game --json misuse must explain the required --list-templates pairing",
);

await assertInvalidCatalogFailsBeforeJsonOutput(manifest);

console.log("create-game template catalog smoke ok");

async function assertInvalidCatalogFailsBeforeJsonOutput(validManifest) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ferrum-create-game-invalid-catalog-"));
  try {
    const packageCopyRoot = path.join(tempRoot, "create-game");
    await cp(createGamePackageRoot, packageCopyRoot, { recursive: true });
    const copiedManifestPath = path.join(packageCopyRoot, "templates/manifest.json");
    const invalidManifest = structuredClone(validManifest);
    invalidManifest.templates[0] = {
      ...invalidManifest.templates[0],
      sceneAuthoring: {
        configured: true,
        fixturePath: "public/scene-authoring.json",
        format: "invalid.scene-authoring",
      },
    };
    await writeFile(copiedManifestPath, `${JSON.stringify(invalidManifest, null, 2)}\n`);

    const result = await runNode([path.join(packageCopyRoot, "bin/create-game.mjs"), "--list-templates", "--json"], {
      cwd: tempRoot,
    });
    assert.notEqual(result.code, 0, "create-game --list-templates --json must fail when the manifest is invalid");
    assert(
      result.stderr.includes("sceneAuthoring.format must be ferrum2d.consumer.scene-authoring"),
      `invalid manifest error must point at the sceneAuthoring format contract\n${result.stdout}\n${result.stderr}`.trim(),
    );
    assert(!result.stdout.trimStart().startsWith("{"), "invalid manifest must not emit a JSON catalog");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function runNode(args, { cwd = repoRoot } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
