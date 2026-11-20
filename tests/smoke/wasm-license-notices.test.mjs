import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalDependencyPackages, renderWasmLicenseNotices } from "../../scripts/package/wasm-license-notices.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mit = await readFile(path.join(repo, "scripts/package/wasm-license-sources/profiling/LICENSE-MIT"));
const apache = await readFile(path.join(repo, "scripts/package/wasm-license-sources/profiling/LICENSE-APACHE"));
const sha = value => createHash("sha256").update(value).digest("hex");
const registry = "registry+https://github.com/rust-lang/crates.io-index";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ferrum-wasm-notices-"));
  try {
    await mkdir(path.join(root, "scripts/package/wasm-license-sources"), { recursive: true });
    await writeFile(path.join(root, "scripts/package/wasm-license-sources/provenance.json"), JSON.stringify({ version: 1, sources: [] }));
    const directory = path.join(root, "cache/demo");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "LICENSE-MIT"), mit);
    const pkg = { id: "demo-id", name: "demo", version: "1.0.0", source: registry, license: "MIT", license_file: null, manifest_path: path.join(directory, "Cargo.toml") };
    const metadata = { packages: [{ id: "root", name: "ferrum-core" }, pkg],
      resolve: { root: "root", nodes: [{ id: "root", deps: [{ pkg: pkg.id, dep_kinds: [{ kind: null }] }] }, { id: pkg.id, deps: [] }] } };
    await run({ root, directory, pkg, metadata });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("normal closure excludes root/build/dev and conservatively keeps normally reached proc-macro dependencies", () => {
  const packages = ["root", "runtime", "macro", "host-helper", "dev", "build"].map(id => ({ id, name: id === "root" ? "ferrum-core" : id, version: "1.0.0" }));
  const dep = (pkg, kind = null) => ({ pkg, dep_kinds: [{ kind }] });
  const metadata = { packages, resolve: { root: "root", nodes: [
    { id: "root", deps: [dep("runtime"), dep("dev", "dev"), dep("build", "build")] },
    { id: "runtime", deps: [dep("macro")] }, { id: "macro", deps: [dep("host-helper")] },
    ...["host-helper", "dev", "build"].map(id => ({ id, deps: [] })),
  ] } };
  assert.deepEqual(normalDependencyPackages(metadata).map(pkg => pkg.name), ["host-helper", "macro", "runtime"]);
});

test("notice rendering preserves original expression and text with deterministic paths and no timestamps", async () => {
  await fixture(async ({ root, directory, pkg, metadata }) => {
    pkg.license = "MIT/Apache-2.0";
    await writeFile(path.join(directory, "LICENSE-APACHE"), apache);
    await writeFile(path.join(directory, "NOTICE"), "An upstream attribution\r\n");
    const first = await renderWasmLicenseNotices(metadata, root);
    metadata.packages.reverse(); metadata.resolve.nodes.reverse();
    assert(first.equals(await renderWasmLicenseNotices(metadata, root)));
    const text = first.toString();
    assert(text.includes("License expression: MIT/Apache-2.0\n"));
    assert(text.includes(mit.toString()) && text.includes(apache.toString()));
    assert(text.includes("An upstream attribution\n"));
    assert(text.includes(sha(Buffer.from("An upstream attribution\r\n"))));
    assert(!text.includes("\r"), "canonical notice line endings survive Git checkout");
    assert(!text.includes(root)); assert(!/Generated (?:at|on):/.test(text));
    assert(text.indexOf("BEGIN LICENSE-APACHE") < text.indexOf("BEGIN LICENSE-MIT"));
  });
});

test("missing expressions, unknown identifiers, missing documents and incomplete Unicode coverage fail", async () => {
  await fixture(async ({ root, directory, pkg, metadata }) => {
    for (const license of [null, "", "Unknown-9.0", "MIT OR", "MIT Apache-2.0"]) {
      pkg.license = license;
      await assert.rejects(renderWasmLicenseNotices(metadata, root), /license/);
    }
    pkg.license = "(MIT OR Apache-2.0) AND Unicode-3.0";
    await writeFile(path.join(directory, "LICENSE-APACHE"), apache);
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /missing upstream document for Unicode-3.0/);
    await writeFile(path.join(directory, "LICENSE-UNICODE"), "UNICODE LICENSE V3\nA fixture source document.\n");
    assert((await renderWasmLicenseNotices(metadata, root)).includes(Buffer.from("UNICODE LICENSE V3")));
    await rm(path.join(directory, "LICENSE-APACHE")); await rm(path.join(directory, "LICENSE-UNICODE"));
    pkg.license = "MIT"; await rm(path.join(directory, "LICENSE-MIT"));
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /upstream license documents are missing/);
  });
});

test("supplements must match Cargo upstream revision, source URL and exact bytes", async () => {
  await fixture(async ({ root, directory, pkg, metadata }) => {
    await rm(path.join(directory, "LICENSE-MIT"));
    const revision = "1".repeat(40), repository = "https://github.com/example/demo";
    pkg.repository = repository;
    await writeFile(path.join(directory, ".cargo_vcs_info.json"), JSON.stringify({ git: { sha1: revision } }));
    const sources = path.join(root, "scripts/package/wasm-license-sources");
    await writeFile(path.join(sources, "LICENSE-MIT"), mit);
    const source = { packages: ["demo@1.0.0"], repository, revision,
      files: [{ file: "LICENSE-MIT", upstreamFile: "LICENSE-MIT", source: `https://raw.githubusercontent.com/example/demo/${revision}/LICENSE-MIT`, sha256: sha(mit) }] };
    const save = () => writeFile(path.join(sources, "provenance.json"), JSON.stringify({ version: 1, sources: [source] }));
    await save(); const text = (await renderWasmLicenseNotices(metadata, root)).toString();
    assert(text.includes(source.files[0].source) && text.includes(mit.toString()));
    source.revision = "2".repeat(40); await save();
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /upstream revision/);
    source.revision = revision; source.files[0].sha256 = "0".repeat(64); await save();
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /hash\/origin mismatch/);
    source.files[0].sha256 = sha(mit); source.files[0].source = "https://example.invalid/LICENSE"; await save();
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /hash\/origin mismatch/);
  });
});

test("vendored modification record and upstream license retain separate ownership", async () => {
  await fixture(async ({ root, pkg, metadata }) => {
    const directory = path.join(root, "crates/ferrum-core/vendor/demo");
    await mkdir(directory, { recursive: true });
    pkg.manifest_path = path.join(directory, "Cargo.toml"); pkg.source = null; pkg.license = "Apache-2.0";
    await writeFile(path.join(directory, "LICENSE"), apache);
    await writeFile(path.join(directory, "UPSTREAM.json"), JSON.stringify({ crate: "demo", version: "1.0.0", license: "Apache-2.0", source: "https://crates.io/api/v1/crates/demo/1.0.0/download", crateSha256: "a".repeat(64) }));
    await writeFile(path.join(directory, "FERRUM-PATCHES.md"), "# Recorded modifications\nChanged src/example.rs.\n");
    const text = (await renderWasmLicenseNotices(metadata, root)).toString();
    assert(text.includes("License expression: Apache-2.0\n"));
    assert(text.includes("Changed src/example.rs.") && text.includes(apache.toString()));
    assert(!text.includes("License expression: MIT OR Apache-2.0"));
  });
});

test("declared and symlinked documents cannot escape their package", async () => {
  await fixture(async ({ root, directory, pkg, metadata }) => {
    pkg.license_file = "../../private-license";
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /must stay inside/);
    pkg.license_file = null;
    await writeFile(path.join(root, "private-license"), "private fixture");
    await symlink(path.join(root, "private-license"), path.join(directory, "LICENSE-LINK"));
    pkg.license_file = "LICENSE-LINK";
    await assert.rejects(renderWasmLicenseNotices(metadata, root), /escapes its package/);
  });
});
