import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import {
  decodePng,
  encodePngRgba,
} from "../../scripts/tools/pack-textures.mjs";

const require = createRequire(
  new URL("../../apps/placement-viewer/package.json", import.meta.url),
);
const ts = require("typescript");
const source = await readFile(
  new URL(
    "../../apps/placement-viewer/src/placementAsepriteNormalPng.ts",
    import.meta.url,
  ),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { readAsepriteNormalPixels: read, writeAsepriteNormalPixels: write } =
  await import(
    "data:text/javascript;base64," + Buffer.from(compiled).toString("base64")
  );
const pixels = new Uint8Array([
  128, 128, 255, 0, 50, 100, 150, 1, 1, 2, 3, 255, 4, 5, 6, 64, 200, 150, 100,
  127, 255, 254, 253, 128,
]);
// Fixed externally encoded fixtures exercise each PNG filter, including alpha 0/1/64/127/128.
const fixtures = [
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGNoaPjPYJQyjZGRifk/Awsrm8OJaSn1///9bQAAcHEKPKKHxZsAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGNsaPjPsOnJdMbz83L/MbKwsjkcmRhnb54xkxEAmvEKgp7j/ckAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGNqaPjPYJQyjZGRifk/U0sru8M0o3N1//78agQAemULDydOSQ4AAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGNuaPjP8ElFnPHFhR3/mY8cbXdYmyQWP3vTqYMAqAQNT67GKs4AAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAI0lEQVR4nGNpaPjPsOnJdMbz83L/sbS0sjscmRhnbz7rVyMAqMgMnI4EkRQAAAAASUVORK5CYII=",
];
const buffer = (bytes) => new Uint8Array(bytes).buffer;
for (const [filter, fixture] of fixtures.entries())
  test(`normal PNG filter ${filter} preserves every numeric RGBA byte`, async () => {
    const file = Buffer.from(fixture, "base64");
    assert.deepEqual(decodePng(file).pixels, pixels);
    assert.deepEqual(
      await read(buffer(file), 3, 2, new AbortController().signal),
      pixels,
    );
  });
test("normal PNG writing preserves transparent numeric RGB in an independent decoder", async () => {
  const bytes = await write(3, 2, pixels, new AbortController().signal);
  assert.deepEqual(decodePng(Buffer.from(bytes)).pixels, pixels);
});
test("normal PNG corruption, dimensions and truncation are rejected", async () => {
  const file = Buffer.from(fixtures[0], "base64"),
    bad = Buffer.from(file);
  bad[bad.length - 1] ^= 1;
  for (const value of [
    bad,
    file.subarray(0, file.length - 4),
    Buffer.from([0, 1, 2]),
  ])
    await assert.rejects(
      read(buffer(value), 3, 2, new AbortController().signal),
      /Invalid RGBA8/,
    );
  await assert.rejects(
    read(buffer(file), 4, 2, new AbortController().signal),
    /Invalid RGBA8/,
  );
  await assert.rejects(
    write(4096, 4096, pixels, new AbortController().signal),
    /Invalid RGBA8/,
  );
  await assert.rejects(
    write(3, 2, new Uint8Array(23), new AbortController().signal),
    /Invalid RGBA8/,
  );
});
test("normal PNG processing follows cancellation before allocating output", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    read(buffer(encodePngRgba(3, 2, pixels)), 3, 2, controller.signal),
    { name: "AbortError" },
  );
  await assert.rejects(write(3, 2, pixels, controller.signal), {
    name: "AbortError",
  });
});
