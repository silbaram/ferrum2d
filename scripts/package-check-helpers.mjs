import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export function assert(condition, message) {
  if (!condition) {
    throw new Error(`[package check] ${message}`);
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function requireFile(filePath, repoRoot) {
  const stats = await stat(filePath).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new Error(`[package check] required file is missing: ${path.relative(repoRoot, filePath)}`);
    }
    throw error;
  });
  assert(stats.isFile(), `required path must be a file: ${path.relative(repoRoot, filePath)}`);
}

export function assertSemverPackage(packageJson, { expectPublishable, packageLabel }) {
  const stableVersionPattern = /^\d+\.\d+\.\d+$/;
  const betaVersionPattern = /^\d+\.\d+\.\d+-beta\.\d+$/;
  assert(
    stableVersionPattern.test(packageJson.version) || betaVersionPattern.test(packageJson.version),
    `${packageLabel} version must use semver or semver beta prerelease format`,
  );
  if (expectPublishable) {
    assert(packageJson.private === false, `${packageLabel} publishable package must set private to false`);
    assert(betaVersionPattern.test(packageJson.version), `${packageLabel} publishable version must match x.y.z-beta.N`);
    return;
  }
  assert(packageJson.private === true, `${packageLabel} package must remain private until an explicit publish decision is made`);
}

export function assertFilesAllowlist(packageJson, expectedFiles, packageLabel) {
  assert(Array.isArray(packageJson.files), `${packageLabel} files must be an array`);
  assert(
    packageJson.files.length === expectedFiles.length,
    `${packageLabel} files allowlist length must be ${expectedFiles.length}, got ${packageJson.files.length}`,
  );
  for (const expectedFile of expectedFiles) {
    assert(packageJson.files.includes(expectedFile), `${packageLabel} files must include ${expectedFile}`);
  }
}

export async function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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

export async function runNodeCheck(scriptPath, repoRoot) {
  const result = await run(process.execPath, ["--check", scriptPath], repoRoot);
  assert(
    result.code === 0,
    `node --check failed for ${path.relative(repoRoot, scriptPath)}\n${result.stdout}\n${result.stderr}`.trim(),
  );
}

export async function checkPackedTarball({ packageRoot, requiredFiles, forbiddenPrefixes = [], forbiddenFiles = [] }) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ferrum2d-pack-"));
  try {
    await runPnpmPack(packageRoot, tempDir);
    const entries = await readdir(tempDir);
    const tarballs = entries.filter((entry) => entry.endsWith(".tgz"));
    assert(tarballs.length === 1, `expected exactly one packed tarball, found ${tarballs.length}`);

    const tarballPath = path.join(tempDir, tarballs[0]);
    const packedFiles = new Set(await listTarGzEntries(tarballPath));
    for (const requiredFile of requiredFiles) {
      assert(packedFiles.has(requiredFile), `packed tarball is missing ${requiredFile}`);
    }
    for (const packedFile of packedFiles) {
      for (const forbiddenPrefix of forbiddenPrefixes) {
        assert(!packedFile.startsWith(forbiddenPrefix), `packed tarball must not include ${packedFile}`);
      }
      assert(!forbiddenFiles.includes(packedFile), `packed tarball must not include ${packedFile}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runPnpmPack(packageRoot, destination) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await run(command, ["pack", "--pack-destination", destination], packageRoot);
  assert(
    result.code === 0,
    `pnpm pack failed with exit code ${result.code}\n${result.stdout}\n${result.stderr}`.trim(),
  );
}

async function listTarGzEntries(tarballPath) {
  const archive = await gunzipAsync(await readFile(tarballPath));
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (isEmptyTarBlock(header)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const sizeText = readTarString(header, 124, 12).trim();
    const size = sizeText.length > 0 ? Number.parseInt(sizeText, 8) : 0;
    const entryPath = prefix ? `${prefix}/${name}` : name;
    if (entryPath) {
      entries.push(entryPath);
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function isEmptyTarBlock(block) {
  return block.every((byte) => byte === 0);
}

function readTarString(block, start, length) {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  const content = end === -1 ? bytes : bytes.subarray(0, end);
  return new TextDecoder().decode(content);
}
