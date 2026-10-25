import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  parseNormalConfig,
  generateSpriteNormals,
} from "../../scripts/tools/generate-sprite-normals.mjs";
import {
  binaryName,
  installedTool,
  sha256,
  tool,
} from "../../scripts/tools/sprite-normals-tool.mjs";
import { encodePngRgba } from "../../scripts/tools/pack-textures.mjs";

const config = {
  format: "ferrum2d.sprite-normals.config",
  version: 1,
  inputs: ["sprite.png"],
  outputDir: "normals",
};
const png = encodePngRgba(1, 1, Uint8Array.from([128, 128, 255, 255]));
async function fixture(t, value = config) {
  const root = await mkdtemp(resolve(tmpdir(), "ferrum-normals-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = resolve(root, "job.json"),
    output = resolve(root, value.outputDir);
  await writeFile(file, JSON.stringify(value));
  for (const name of value.inputs) await writeFile(resolve(root, name), png);
  return { root, file, output };
}
function fake(execute) {
  return {
    installedTool: async () => ({
      binary: "/test-generator",
      manifest: { ...tool, binarySha256: "fixture" },
    }),
    execute,
  };
}
const generatedDir = (args) => args[args.indexOf("--output-dir") + 1];

test("config resolves relative paths and rejects unsupported fields and non-finite settings", () => {
  const parsed = parseNormalConfig(config, "/project/jobs/normals.json");
  assert.deepEqual(parsed.inputs, ["/project/jobs/sprite.png"]);
  assert.equal(parsed.outputDir, "/project/jobs/normals");
  for (const invalid of [
    { ...config, version: 2 },
    { ...config, force: true },
    { ...config, inputs: [] },
    { ...config, inputs: ["one/Hero.png", "two/hero.png"] },
    { ...config, settings: null },
    ...[null, NaN, Infinity, -1, 9].map((normalStrength) => ({
      ...config,
      settings: { normalStrength },
    })),
    { ...config, settings: { frameSize: { width: 0, height: 32 } } },
    {
      ...config,
      settings: { frameSize: { width: 32, height: 32, columns: 2 } },
    },
  ])
    assert.throws(() => parseNormalConfig(invalid, "/project/job.json"), {
      code: "FERRUM_NORMAL_CONFIG_INVALID",
    });
});

test("tool loader rejects missing installation, wrong provenance and changed binary", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ferrum-normals-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(installedTool(root), {
    code: "FERRUM_NORMAL_TOOL_MISSING",
  });
  await mkdir(resolve(root, "bin"));
  await writeFile(resolve(root, "bin", binaryName), "binary");
  const manifest = {
    ...tool,
    platform: process.platform,
    arch: process.arch,
    binarySha256: sha256(Buffer.from("binary")),
  };
  await writeFile(resolve(root, "installation.json"), JSON.stringify(manifest));
  assert.equal((await installedTool(root)).manifest.revision, tool.revision);
  await writeFile(
    resolve(root, "installation.json"),
    JSON.stringify({ ...manifest, version: "wrong" }),
  );
  await assert.rejects(installedTool(root), {
    code: "FERRUM_NORMAL_TOOL_MISMATCH",
  });
  await writeFile(resolve(root, "installation.json"), JSON.stringify(manifest));
  await writeFile(resolve(root, "bin", binaryName), "changed");
  await assert.rejects(installedTool(root), {
    code: "FERRUM_NORMAL_TOOL_MISMATCH",
  });
  await writeFile(
    resolve(root, "installation.json"),
    JSON.stringify({ ...manifest, revision: "wrong" }),
  );
  await assert.rejects(installedTool(root), {
    code: "FERRUM_NORMAL_TOOL_MISMATCH",
  });
});

test("generation consumes owned snapshots and publishes provenance plus outputs before report", async (t) => {
  const job = await fixture(t, {
    ...config,
    inputs: ["sprite space.png"],
    settings: { normalStrength: 2 },
  });
  const source = resolve(job.root, "sprite space.png");
  const result = await generateSpriteNormals(
    job.file,
    fake(async (binary, args) => {
      assert.equal(binary, "/test-generator");
      assert.notEqual(args[0], source);
      assert.deepEqual(await readFile(args[0]), png);
      assert.equal(args[args.indexOf("--normal-format") + 1], "opengl");
      assert.equal(args[args.indexOf("--normal-strength") + 1], "2");
      await writeFile(resolve(generatedDir(args), "sprite space_n.png"), png);
    }),
  );
  assert.equal(result.format, "ferrum2d.sprite-normals.report");
  assert.equal(result.results[0].input.sha256, sha256(png));
  assert.equal(result.results[0].outputs[0].sha256, sha256(png));
  assert.equal(result.colorSpace, "none");
  assert.equal(result.generator.revision, tool.revision);
  assert.deepEqual(await readFile(source), png);
  assert.deepEqual((await readdir(job.output)).sort(), [
    "normal-generation.report.json",
    "sprite space_n.png",
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(result.reportPath, "utf8")).results,
    result.results,
  );
});

test("existing output and symlink are rejected before invoking generator", async (t) => {
  const { symlink } = await import("node:fs/promises");
  const job = await fixture(t);
  await mkdir(job.output);
  const target = resolve(job.output, "sprite_n.png");
  await symlink(resolve(job.root, "sprite.png"), target);
  await assert.rejects(
    generateSpriteNormals(
      job.file,
      fake(() => assert.fail("Generator must not run")),
    ),
    { code: "FERRUM_NORMAL_OUTPUT_EXISTS" },
  );
  assert.deepEqual(await readFile(resolve(job.root, "sprite.png")), png);
  await rm(target);
  await writeFile(
    resolve(job.output, "normal-generation.report.json"),
    "existing report",
  );
  await assert.rejects(
    generateSpriteNormals(
      job.file,
      fake(() => assert.fail("Generator must not run")),
    ),
    { code: "FERRUM_NORMAL_OUTPUT_EXISTS" },
  );
});

test("partial generator failure leaves no published files or temporary stage", async (t) => {
  const job = await fixture(t);
  await assert.rejects(
    generateSpriteNormals(
      job.file,
      fake(async (_, args) => {
        await writeFile(resolve(generatedDir(args), "sprite_n.png"), png);
        throw Object.assign(new Error("failed"), { stderr: "decode rejected" });
      }),
    ),
    { code: "FERRUM_NORMAL_GENERATION_FAILED" },
  );
  assert.deepEqual(await readdir(job.output), []);
});

test("invalid or missing sidecars cannot produce a successful report", async (t) => {
  for (const mode of ["invalid png", "missing sidecar", "unexpected file"]) {
    const job = await fixture(t);
    await assert.rejects(
      generateSpriteNormals(
        job.file,
        fake(async (_, args) => {
          const directory = generatedDir(args);
          await writeFile(
            resolve(directory, "sprite_n.png"),
            mode === "invalid png" ? "invalid" : png,
          );
          if (mode === "missing sidecar")
            await writeFile(resolve(directory, "sprite_n.color.png"), png);
          if (mode === "unexpected file")
            await writeFile(resolve(directory, "unexpected.png"), png);
        }),
      ),
      { code: "FERRUM_NORMAL_OUTPUT_INVALID" },
    );
    assert.deepEqual(await readdir(job.output), []);
  }
});

test("source changes during generation are detected and external edits are preserved", async (t) => {
  const job = await fixture(t);
  await assert.rejects(
    generateSpriteNormals(
      job.file,
      fake(async (_, args) => {
        await writeFile(resolve(job.root, "sprite.png"), "external edit");
        await writeFile(resolve(generatedDir(args), "sprite_n.png"), png);
      }),
    ),
    { code: "FERRUM_NORMAL_SOURCE_CHANGED" },
  );
  assert.equal(
    await readFile(resolve(job.root, "sprite.png"), "utf8"),
    "external edit",
  );
  assert.deepEqual(await readdir(job.output), []);
});

test("publish race preserves the competing file and rolls back only this job's files", async (t) => {
  const job = await fixture(t, { ...config, inputs: ["a.png", "b.png"] });
  await assert.rejects(
    generateSpriteNormals(
      job.file,
      fake(async (_, args) => {
        for (const name of ["a_n.png", "b_n.png"])
          await writeFile(resolve(generatedDir(args), name), png);
        await writeFile(resolve(job.output, "b_n.png"), "competing writer");
      }),
    ),
    { code: "EEXIST" },
  );
  assert.deepEqual(await readdir(job.output), ["b_n.png"]);
  assert.equal(
    await readFile(resolve(job.output, "b_n.png"), "utf8"),
    "competing writer",
  );
});

test("oversized or fractional PNG frame grids are rejected before generation", async (t) => {
  for (const [width, height, frameSize] of [
    [17, 17, { width: 1, height: 1 }],
    [3, 3, { width: 2, height: 2 }],
  ]) {
    const job = await fixture(t, { ...config, settings: { frameSize } });
    await writeFile(
      resolve(job.root, "sprite.png"),
      encodePngRgba(width, height, new Uint8Array(width * height * 4)),
    );
    await assert.rejects(
      generateSpriteNormals(
        job.file,
        fake(() => assert.fail("Generator must not run")),
      ),
      { code: "FERRUM_NORMAL_INPUT_INVALID" },
    );
    assert.deepEqual(await readdir(job.output), []);
  }
});
