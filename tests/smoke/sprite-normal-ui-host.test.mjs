import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { placementNormalGeneratorPlugin } from "../../apps/placement-viewer/server/normalGenerator.mjs";

function host(validate) {
  let handler;
  const plugin = placementNormalGeneratorPlugin({ validate });
  const server = {
    middlewares: {
      use(prefix, callback) {
        assert.equal(prefix, "/__ferrum-normal-generator");
        handler = callback;
      },
    },
  };
  assert.equal(plugin.configureServer(server), undefined);
  assert.equal(plugin.configurePreviewServer(server), undefined);
  return (url, method = "GET") =>
    new Promise((resolve) => {
      const headers = {};
      const response = {
        statusCode: 200,
        setHeader(key, value) {
          headers[key] = value;
        },
        end(body) {
          resolve({ status: this.statusCode, headers, body: body?.toString() });
        },
      };
      handler({ url, method }, response);
    });
}
test("optional UI host exposes only verified bundle files without writes", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ferrum-normal-ui-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    "manifest.json",
    "spritefusion_sprite_normals.js",
    "spritefusion_sprite_normals_bg.wasm",
    "LICENSE",
  ];
  for (const name of [...files, "private.txt"])
    await writeFile(resolve(root, name), "fixture:" + name);
  const request = host(async () => ({ root, manifestSha256: "a".repeat(64) }));
  const config = await request("/config.json");
  assert.equal(config.status, 200);
  assert.deepEqual(JSON.parse(config.body), {
    manifestUrl: "/__ferrum-normal-generator/manifest.json",
    manifestSha256: "a".repeat(64),
  });
  for (const name of files) {
    const response = await request("/" + name + "?cache=off");
    assert.equal(response.status, 200);
    assert.equal(response.body, "fixture:" + name);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  for (const path of [
    "/private.txt",
    "/../private.txt",
    "/%2e%2e/private.txt",
    "/source/Cargo.toml",
  ])
    assert.equal((await request(path)).status, 404);
  assert.deepEqual(
    (await readdir(root)).sort(),
    [...files, "private.txt"].sort(),
  );
  assert.equal(
    await readFile(resolve(root, "private.txt"), "utf8"),
    "fixture:private.txt",
  );
});
test("non-read requests cannot invoke generator validation or writes", async () => {
  const request = host(async () => {
    throw new Error("must not run");
  });
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    assert.equal((await request("/config.json", method)).status, 405);
});
test("missing or invalid optional bundle stays unavailable without exposing paths", async () => {
  const request = host(async () => {
    throw new Error("/private/build/path: checksum differs");
  });
  const response = await request("/config.json");
  assert.equal(response.status, 503);
  assert.equal(response.body, "Normal generator unavailable");
});
