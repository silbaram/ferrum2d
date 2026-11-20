#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WASM_NOTICE_FILE = "THIRD_PARTY_NOTICES.txt";
const target = "wasm32-unknown-unknown";
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = value => createHash("sha256").update(value).digest("hex");
const fail = message => { throw new Error(`[wasm notices] ${message}`); };

export async function buildWasmLicenseNotices(repoRoot = defaultRoot) {
  let metadata;
  try {
    const result = await execute("cargo", ["metadata", "--format-version", "1", "--locked", "--offline",
      "--filter-platform", target, "--manifest-path", "crates/ferrum-core/Cargo.toml"],
    { cwd: repoRoot, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" });
    metadata = JSON.parse(result.stdout);
  } catch {
    fail("offline Cargo metadata failed; make the locked dependency sources available before generating notices");
  }
  return renderWasmLicenseNotices(metadata, repoRoot);
}

export function normalDependencyPackages(metadata) {
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map((metadata.resolve?.nodes ?? []).map(node => [node.id, node]));
  const root = metadata.resolve?.root;
  if (!root || packages.get(root)?.name !== "ferrum-core" || !nodes.has(root)) fail("missing ferrum-core metadata root");
  const seen = new Set(), pending = [root];
  while (pending.length) {
    const id = pending.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.get(id);
    if (!node || !packages.has(id)) fail("incomplete dependency metadata");
    for (const dependency of node.deps) {
      if (dependency.dep_kinds.some(kind => kind.kind === null)) pending.push(dependency.pkg);
    }
  }
  seen.delete(root);
  return [...seen].map(id => packages.get(id)).sort((a, b) => compare(a.name, b.name) || compare(a.version, b.version));
}

function licenseIds(expression, label) {
  if (typeof expression !== "string" || !expression.trim()) fail(`${label}: missing license expression`);
  const tokens = expression.match(/[A-Za-z0-9.+-]+|[()/]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s/g, "")) fail(`${label}: unrecognized license expression`);
  const identifiers = new Set();
  let term = true, depth = 0;
  for (const token of tokens) {
    if (token === "(") { if (!term) fail(`${label}: invalid license expression`); depth++; }
    else if (token === ")") { if (term || --depth < 0) fail(`${label}: invalid license expression`); }
    else if (["AND", "OR", "/"].includes(token)) { if (term) fail(`${label}: invalid license expression`); term = true; }
    else {
      if (!term || !Object.hasOwn(licenseMarkers, token)) fail(`${label}: unrecognized license identifier ${token}`);
      identifiers.add(token); term = false;
    }
  }
  if (term || depth !== 0) fail(`${label}: invalid license expression`);
  return identifiers;
}

// Coverage checks identify copied source documents; they do not choose an OR
// alternative or evaluate legal compatibility. Preserve the original expression.
const licenseMarkers = {
  MIT: /permission is hereby granted/i,
  "Apache-2.0": /apache license[\s\S]*version 2\.0/i,
  Zlib: /origin of this software must not be misrepresented/i,
  Unlicense: /free and unencumbered software released into the public domain/i,
  "Unicode-3.0": /UNICODE LICENSE V3/i,
};

async function sourceFile(root, relative, label) {
  const candidate = path.resolve(root, relative);
  const location = path.relative(root, candidate);
  if (!location || location.startsWith("..") || path.isAbsolute(location)) fail(`${label}: source document must stay inside its package`);
  let resolved;
  try { resolved = await realpath(candidate); }
  catch { fail(`${label}: missing source document ${relative}`); }
  const realRelative = path.relative(await realpath(root), resolved);
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) fail(`${label}: source document escapes its package`);
  let bytes;
  try { bytes = await readFile(resolved); } catch { fail(`${label}: unreadable source document ${relative}`); }
  const text = bytes.toString("utf8");
  if (!text.trim() || text.includes("\0") || !Buffer.from(text, "utf8").equals(bytes)) fail(`${label}: source document is not nonempty UTF-8 text`);
  return { file: location.split(path.sep).join("/"), text, sha256: sha256(bytes) };
}

async function localDocuments(directory, label, declared) {
  const names = new Set();
  const visit = async (relative = "", licenseDirectory = false) => {
    for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((a, b) => compare(a.name, b.name))) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory() && !["target", ".git"].includes(entry.name))
        await visit(file, licenseDirectory || /^licen[cs]es?$/i.test(entry.name));
      else if (entry.isFile() && (licenseDirectory || /^(?:licen[cs]e|copying|copyright|notice|unlicense)(?:$|[._-])/i.test(entry.name))) names.add(file);
    }
  };
  await visit();
  if (declared) names.add(declared);
  return Promise.all([...names].sort(compare).map(name => sourceFile(directory, name, label)));
}

function documentBlock(document) {
  const text = document.text.replace(/\r\n?/g, "\n");
  return `\n----- BEGIN ${document.file} (original-source SHA-256 ${document.sha256}) -----\n${text}${text.endsWith("\n") ? "" : "\n"}----- END ${document.file} -----\n`;
}

export async function renderWasmLicenseNotices(metadata, repoRoot = defaultRoot) {
  const packages = normalDependencyPackages(metadata);
  const supplementRoot = path.join(repoRoot, "scripts/package/wasm-license-sources");
  const provenance = JSON.parse(await readFile(path.join(supplementRoot, "provenance.json"), "utf8"));
  if (provenance.version !== 1 || !Array.isArray(provenance.sources)) fail("unknown supplemental source format");
  const supplements = new Map();
  for (const source of provenance.sources) for (const label of source.packages) {
    if (supplements.has(label)) fail(`${label}: duplicate supplemental source`);
    supplements.set(label, source);
  }
  const sections = [
    "Ferrum2D Wasm dependency notices\n",
    "Generated by scripts/package/wasm-license-notices.mjs; do not edit manually.\n",
    `Target: ${target}\nDependency packages: ${packages.length}\n`,
    "Inventory: locked offline Cargo metadata, transitive normal-dependency edges, ferrum-core excluded.\n",
    "This conservative inventory includes normally reached proc-macro/host dependencies; it is not proof that every package is linked into the Wasm binary.\n",
    "Original license expressions and all discovered upstream license/copyright/notice documents are retained without selecting license alternatives.\n",
    "Source text uses canonical LF line endings here; each original-source hash identifies the unmodified upstream file bytes.\n",
    "Ferrum2D's own license is in LICENSE. Basis notices remain in dist/vendor/basis; font/asset distributions have separate notices.\n",
    "This document records source material, not a legal compatibility assessment.\n",
  ];
  for (const pkg of packages) {
    const label = `${pkg.name}@${pkg.version}`, ids = licenseIds(pkg.license, label);
    const directory = path.dirname(pkg.manifest_path);
    const documents = await localDocuments(directory, label, pkg.license_file);
    sections.push(`\n${"=".repeat(72)}\n${label}\nLicense expression: ${pkg.license}\n`);
    if (pkg.source === "registry+https://github.com/rust-lang/crates.io-index") {
      sections.push(`Source: https://crates.io/crates/${pkg.name}/${pkg.version}\n`);
    } else if (pkg.source === null) {
      const expected = path.join(repoRoot, "crates/ferrum-core/vendor", pkg.name);
      if (path.resolve(directory) !== path.resolve(expected)) fail(`${label}: unidentified local dependency`);
      const origin = JSON.parse(await readFile(path.join(directory, "UPSTREAM.json"), "utf8"));
      if (origin.crate !== pkg.name || origin.version !== pkg.version || origin.license !== pkg.license
        || !/^https:\/\/crates\.io\/api\/v1\/crates\//.test(origin.source) || !/^[a-f0-9]{64}$/.test(origin.crateSha256)) fail(`${label}: invalid vendored provenance`);
      sections.push(`Vendored upstream: ${origin.source}\nUpstream archive SHA-256: ${origin.crateSha256}\n`);
      const changes = await sourceFile(directory, "FERRUM-PATCHES.md", label);
      sections.push("Ferrum2D modifies this vendored source. The recorded changes below do not replace its upstream license.\n", documentBlock(changes));
    } else fail(`${label}: unidentified dependency source`);
    if (!documents.length) {
      const supplement = supplements.get(label);
      if (!supplement) fail(`${label}: upstream license documents are missing; add a pinned source supplement`);
      const vcs = JSON.parse(await readFile(path.join(directory, ".cargo_vcs_info.json"), "utf8"));
      if (vcs.git?.sha1 !== supplement.revision || pkg.repository?.replace(/\.git$/, "") !== supplement.repository) fail(`${label}: supplemental source does not match Cargo upstream revision`);
      for (const file of supplement.files) {
        const document = await sourceFile(supplementRoot, file.file, label);
        if (document.sha256 !== file.sha256 || file.source !== `${supplement.repository.replace("https://github.com/", "https://raw.githubusercontent.com/")}/${supplement.revision}/${file.upstreamFile}`) fail(`${label}: supplemental source hash/origin mismatch`);
        sections.push(`Supplemental upstream document: ${file.source}\n`);
        documents.push({ ...document, file: file.upstreamFile });
      }
    }
    const text = documents.map(document => document.text).join("\n");
    for (const id of ids) if (!licenseMarkers[id].test(text)) fail(`${label}: missing upstream document for ${id}`);
    for (const document of documents.sort((a, b) => compare(a.file, b.file))) sections.push(documentBlock(document));
  }
  return Buffer.from(sections.join(""), "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== "--check")) fail("usage: node scripts/package/wasm-license-notices.mjs [--check]");
    const expected = await buildWasmLicenseNotices();
    const output = path.join(defaultRoot, "packages/ferrum-web", WASM_NOTICE_FILE);
    if (args.includes("--check")) {
      let current;
      try { current = await readFile(output); } catch { fail(`${WASM_NOTICE_FILE} is missing; regenerate it`); }
      if (!current.equals(expected)) fail(`${WASM_NOTICE_FILE} is stale; run node scripts/package/wasm-license-notices.mjs`);
      console.log(`${WASM_NOTICE_FILE} matches locked upstream source documents`);
    } else {
      await writeFile(output, expected);
      console.log(`Generated packages/ferrum-web/${WASM_NOTICE_FILE} (${expected.length} bytes)`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
