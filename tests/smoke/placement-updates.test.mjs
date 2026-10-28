import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../apps/placement-viewer/package.json", import.meta.url)), ts = require("typescript");
const code = ts.transpileModule(await readFile(new URL("../../apps/placement-viewer/src/placementReleaseVersions.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { compareUpdateVersions, fetchUpdateReleases, safeReleasePage, updateReleases } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));
const row = n => ({ draft: false, tag_name: `ferrum-web-v0.1.0-beta.${n}`, assets: [{ name: "viewer-updater-linux-x64.json", state: "uploaded" }] });
test("viewer release comparison matches semantic beta order and filters malformed/draft releases", () => {
  assert(compareUpdateVersions("0.1.0-beta.10", "0.1.0-beta.9") > 0);
  assert(compareUpdateVersions("0.1.0-beta.10", "0.1.0") < 0);
  assert.deepEqual(updateReleases([row(9), { ...row(99), draft: true }, row(10), { ...row(88), assets: {} }]).map(r => r.version), ["0.1.0-beta.10", "0.1.0-beta.9"]);
  for (const value of ["0.1.0-beta.01", "1.0", "1.0.0+build", "1.0.0-beta.9007199254740992"]) assert.throws(() => compareUpdateVersions(value, value));
});
test("release links reject scripts, userinfo, query strings and arbitrary download paths", () => {
  assert.equal(safeReleasePage("https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.10"), "https://github.com/silbaram/ferrum2d/releases/tag/ferrum-web-v0.1.0-beta.10");
  for (const value of ["javascript:alert(1)", "https://github.com:444/a/b/releases/tag/ferrum-web-v0.1.0-beta.10", "https://github.com@evil.test/a/b/releases/tag/ferrum-web-v0.1.0-beta.10", "https://github.com/a/b/releases/tag/ferrum-web-v0.1.0-beta.10?go=evil", "https://github.com/a/b/releases/download/x/a.exe"]) assert.throws(() => safeReleasePage(value));
});
test("browser lookup scans later pages and surfaces offline/HTTP/oversized failures", async () => {
  const original = globalThis.fetch; let pages = 0;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify(++pages === 1 ? Array.from({ length: 100 }, () => row(9)) : [row(10)]));
    assert.equal((await fetchUpdateReleases(new AbortController().signal))[0].version, "0.1.0-beta.10"); assert.equal(pages, 2);
    globalThis.fetch = async () => new Response("rate limit", { status: 403 }); await assert.rejects(fetchUpdateReleases(new AbortController().signal), /HTTP 403/);
    globalThis.fetch = async () => { throw Error("offline"); }; await assert.rejects(fetchUpdateReleases(new AbortController().signal), /offline/);
    globalThis.fetch = async () => new Response(" ".repeat(2 * 1024 * 1024 + 1)); await assert.rejects(fetchUpdateReleases(new AbortController().signal), /too large/);
  } finally { globalThis.fetch = original; }
});
