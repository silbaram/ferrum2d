import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { validateViewerUpdater } from "./viewer-updater.mjs";

export const viewerPlatforms = {
  linux: { name: "linux", bundle: "deb", extension: "deb" },
  win32: { name: "windows", bundle: "nsis", extension: "exe" },
  darwin: { name: "macos", bundle: "dmg", extension: "dmg" },
};
export const viewerManifestName = (os, arch) => `viewer-manifest-${os}-${arch}.json`;
export const nativeChecks = ["native project/file picker", "scene save within selected project", "ferrum-asset image rendering", "handoff synchronization", "nonblank interactive canvas evidence"];
const enginePackages = ["ferrum-web", "authoring-viewer", "create-game", "agents"];
const canonicalRelease = value => {
  const release = githubRelease(value?.version, value?.repository);
  if (value?.tag !== release.tag) throw new Error("Release tag/version mismatch");
  return { repository: release.repository, version: release.version, tag: release.tag };
};
export const releaseIdentity = release => ({ repository: release.repository, version: release.version, tag: release.tag });
export const readJson = async file => JSON.parse(await readFile(file, "utf8"));
export function requireSource(source) {
  if (!source || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.commit) || typeof source.dirty !== "boolean")
    throw new Error("A source commit and explicit dirty flag are required");
  return source;
}
export function safeLeaf(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/.test(name)) throw new Error(`Invalid asset filename: ${name}`);
  return name;
}
export async function requireNewOutput(output) {
  try { await lstat(output); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  throw new Error(`Output already exists; use a new directory: ${output}`);
}
export async function fileRecord(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.size <= 0) throw new Error(`Asset must be a nonempty regular file: ${file}`);
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  const after = await lstat(file);
  if (!after.isFile() || before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || bytes !== after.size)
    throw new Error(`Asset changed while hashing: ${file}`);
  return { file: path.basename(file), bytes, sha256: hash.digest("hex") };
}
export async function verifyAsset(root, asset) {
  safeLeaf(asset?.file);
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid asset size or SHA-256");
  const actual = await fileRecord(path.join(root, asset.file));
  if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) throw new Error(`Corrupt release asset: ${asset.file}`);
  return actual;
}
export async function writeNewBundle(stage, output, manifestName) {
  // Reserve exclusively and write the success manifest last. A failed copy is never a valid bundle.
  await requireNewOutput(output); await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
  for (const entry of (await readdir(stage)).filter(name => name !== manifestName)) {
    await fileRecord(path.join(stage, entry));
    await copyFile(path.join(stage, entry), path.join(output, safeLeaf(entry)), constants.COPYFILE_EXCL);
  }
  await copyFile(path.join(stage, manifestName), path.join(output, manifestName), constants.COPYFILE_EXCL);
}
export async function validateEngineBundle(root) {
  const manifest = await readJson(path.join(root, "release-manifest.json"));
  if (manifest.format !== "ferrum2d.github-release.bundle" || manifest.version !== 1 || manifest.published !== false)
    throw new Error("Expected an unpublished engine release bundle v1");
  const release = canonicalRelease(manifest.release); requireSource(manifest.source);
  if (typeof manifest.checks?.build !== "boolean" || typeof manifest.checks?.packageCheck !== "boolean" || manifest.assets?.length !== 4)
    throw new Error("Engine build/package checks and four package assets are required");
  const expected = new Map(enginePackages.map(name => [`ferrum2d-${name}-${release.version}.tgz`, `@ferrum2d/${name}`]));
  for (const asset of manifest.assets) {
    if (!expected.has(asset.file) || expected.get(asset.file) !== asset.package ||
        asset.version !== release.version || asset.url !== `${githubRelease(release.version, release.repository).baseUrl}/${asset.file}`)
      throw new Error("Unexpected or duplicate engine package");
    expected.delete(asset.file);
    await verifyAsset(root, asset);
  }
  const sums = manifest.assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join("");
  if (await readFile(path.join(root, "SHA256SUMS"), "utf8") !== sums) throw new Error("Engine checksum file mismatch");
  await fileRecord(path.join(root, "INSTALL.md"));
  return manifest;
}
export async function validateViewerBundle(root, manifestFile) {
  const manifest = await readJson(path.join(root, safeLeaf(manifestFile)));
  if (manifest.format !== "ferrum2d.viewer-release.bundle" || manifest.version !== 1 || manifest.published !== false)
    throw new Error("Expected an unpublished viewer release bundle v1");
  const release = canonicalRelease(manifest.release); requireSource(manifest.source);
  const platform = Object.values(viewerPlatforms).find(item => item.name === manifest.platform?.os);
  if (!platform || !["x64", "arm64"].includes(manifest.platform.arch) || manifest.platform.bundle !== platform.bundle ||
      manifestFile !== viewerManifestName(platform.name, manifest.platform.arch)) throw new Error("Invalid viewer platform identity");
  const expectedTarget = { "linux-x64": "x86_64-unknown-linux-gnu", "linux-arm64": "aarch64-unknown-linux-gnu", "windows-x64": "x86_64-pc-windows-msvc", "windows-arm64": "aarch64-pc-windows-msvc", "macos-x64": "x86_64-apple-darwin", "macos-arm64": "aarch64-apple-darwin" };
  if (manifest.platform.target !== expectedTarget[`${platform.name}-${manifest.platform.arch}`]) throw new Error("Viewer Rust target/platform mismatch");
  if (manifest.checks?.nativeBuild !== true || manifest.checks?.frontendWasm !== true || manifest.checks?.iconGeneration !== true ||
      manifest.checks?.nativeGui !== "not-run" || manifest.checks?.signing !== "not-verified" || manifest.manualReleaseGate?.required !== true ||
      JSON.stringify(manifest.manualReleaseGate.checks) !== JSON.stringify(nativeChecks)) throw new Error("Viewer build evidence and manual native release gate are required");
  if (manifest.runtime?.releaseVersion !== release.version || manifest.runtime?.package !== "@ferrum2d/ferrum-web" || !/^[a-f0-9]{64}$/.test(manifest.runtime?.wasmSha256))
    throw new Error("Viewer embedded runtime identity is required");
  const asset = manifest.assets?.[0];
  if (manifest.assets?.length !== 1 || asset.file !== `ferrum2d-placement-viewer-${release.version}-${platform.name}-${manifest.platform.arch}.${platform.extension}` ||
      asset.url !== `${githubRelease(release.version, release.repository).baseUrl}/${asset.file}`) throw new Error("Unexpected viewer installer asset");
  await verifyAsset(root, asset);
  const install = `VIEWER_INSTALL-${platform.name}-${manifest.platform.arch}.md`;
  const sums = `VIEWER_SHA256SUMS-${platform.name}-${manifest.platform.arch}`;
  if (await readFile(path.join(root, sums), "utf8") !== `${asset.sha256}  ${asset.file}\n`) throw new Error("Viewer checksum file mismatch");
  await fileRecord(path.join(root, install));
  const updates = await validateViewerUpdater(root, manifest, verifyAsset);
  return { manifest, files: [...new Set([asset.file, manifestFile, install, sums, ...updates])] };
}

export async function assembleDistribution({ engine, viewers, output }) {
  if (!engine || !Array.isArray(viewers) || viewers.length === 0) throw new Error("Assembly requires an engine bundle and at least one viewer bundle");
  await requireNewOutput(output);
  const engineManifest = await validateEngineBundle(engine);
  const release = canonicalRelease(engineManifest.release);
  const inputs = engineManifest.assets.map(asset => ({ root: engine, file: asset.file }));
  inputs.push(...["release-manifest.json", "SHA256SUMS", "INSTALL.md"].map(file => ({ root: engine, file })));
  const platforms = new Set(), viewerManifests = [];
  for (const root of viewers) {
    const names = (await readdir(root)).filter(name => /^viewer-manifest-[a-z]+-(?:x64|arm64)\.json$/.test(name));
    if (names.length !== 1) throw new Error(`Expected one viewer manifest in ${root}`);
    const { manifest, files } = await validateViewerBundle(root, names[0]);
    if (JSON.stringify(canonicalRelease(manifest.release)) !== JSON.stringify(release) || manifest.source.commit !== engineManifest.source.commit)
      throw new Error("Engine and viewer release/version/source commit must match");
    const key = `${manifest.platform.os}-${manifest.platform.arch}`;
    if (platforms.has(key)) throw new Error(`Duplicate viewer platform: ${key}`);
    platforms.add(key); viewerManifests.push({ manifest, file: names[0] });
    inputs.push(...files.map(file => ({ root, file })));
  }
  // All validation happens before reserving the output, preserving previous candidates.
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
  const records = [];
  for (const input of inputs) {
    const record = await fileRecord(path.join(input.root, input.file));
    await copyFile(path.join(input.root, input.file), path.join(output, input.file), constants.COPYFILE_EXCL);
    await verifyAsset(output, record); records.push(record);
  }
  const install = "DISTRIBUTION_INSTALL.md";
  await writeFile(path.join(output, install), distributionGuide(release, viewerManifests.map(item => item.manifest)), { flag: "wx" });
  records.push(await fileRecord(path.join(output, install)));
  const manifest = {
    format: "ferrum2d.release.distribution", version: 1, release,
    source: { commit: engineManifest.source.commit, dirty: engineManifest.source.dirty || viewerManifests.some(item => item.manifest.source.dirty) },
    published: false, engineManifest: "release-manifest.json", viewerManifests: viewerManifests.map(item => item.file),
    manualReleaseGate: { required: true, checks: nativeChecks }, files: records,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  // Checksum protects the manifest too, but does not represent a cryptographic signature.
  const manifestRecord = { file: "distribution-manifest.json", sha256: createHash("sha256").update(text).digest("hex") };
  await writeFile(path.join(output, "DISTRIBUTION_SHA256SUMS"), [...records, manifestRecord].map(item => `${item.sha256}  ${item.file}\n`).join(""), { flag: "wx" });
  await writeFile(path.join(output, "distribution-manifest.json"), text, { flag: "wx" });
  await verifyDistribution(output);
  return { output, manifest };
}

export async function verifyDistribution(root) {
  const manifest = await readJson(path.join(root, "distribution-manifest.json"));
  if (manifest.format !== "ferrum2d.release.distribution" || manifest.version !== 1 || manifest.published !== false || manifest.engineManifest !== "release-manifest.json" ||
      !Array.isArray(manifest.viewerManifests) || !manifest.viewerManifests.length || !Array.isArray(manifest.files)) throw new Error("Invalid distribution manifest");
  const release = canonicalRelease(manifest.release); requireSource(manifest.source);
  const engine = await validateEngineBundle(root), viewers = [], platforms = new Set();
  if (JSON.stringify(canonicalRelease(engine.release)) !== JSON.stringify(release) || engine.source.commit !== manifest.source.commit)
    throw new Error("Distribution engine identity mismatch");
  const expected = new Set([...engine.assets.map(item => item.file), "release-manifest.json", "SHA256SUMS", "INSTALL.md", "DISTRIBUTION_INSTALL.md"]);
  for (const file of manifest.viewerManifests) {
    const { manifest: viewer, files } = await validateViewerBundle(root, file);
    const key = `${viewer.platform.os}-${viewer.platform.arch}`;
    if (platforms.has(key) || JSON.stringify(canonicalRelease(viewer.release)) !== JSON.stringify(release) || viewer.source.commit !== manifest.source.commit)
      throw new Error("Distribution viewer identity mismatch or duplicate platform");
    platforms.add(key); viewers.push(viewer); files.forEach(name => expected.add(name));
  }
  if (manifest.source.dirty !== (engine.source.dirty || viewers.some(viewer => viewer.source.dirty)) ||
      manifest.manualReleaseGate?.required !== true || JSON.stringify(manifest.manualReleaseGate.checks) !== JSON.stringify(nativeChecks)) throw new Error("Distribution provenance/gate mismatch");
  for (const asset of manifest.files) {
    if (!expected.delete(asset.file)) throw new Error("Unexpected or duplicate distribution file");
    await verifyAsset(root, asset);
  }
  if (expected.size) throw new Error("Distribution file inventory is incomplete");
  const self = await fileRecord(path.join(root, "distribution-manifest.json"));
  const sums = [...manifest.files, self].map(item => `${item.sha256}  ${item.file}\n`).join("");
  if (await readFile(path.join(root, "DISTRIBUTION_SHA256SUMS"), "utf8") !== sums) throw new Error("Distribution checksum file mismatch");
  return manifest;
}

function distributionGuide(release, viewers) {
  const runtime = githubRelease(release.version, release.repository).runtime;
  return `# Ferrum2D ${release.version} 엔진·뷰어 배포\n\n로컬 준비 결과이며 아직 공개하지 않았다.\n\n` +
    `## 엔진 SDK\n\nGitHub Release 공개 후 게임 프로젝트에서 실행한다.\n\n\`\`\`bash\npnpm add "${runtime}"\n\`\`\`\n\n` +
    `## 전체 뷰어 앱\n\n` + viewers.map(viewer => `- ${viewer.platform.os}/${viewer.platform.arch}: ${viewer.assets[0].file}`).join("\n") +
    `\n\nOS에 맞는 설치 파일을 사용한 뒤 속성 → 문서 → 프로젝트 열기로 public/scene-authoring.json과 public/assets를 연다.\n` +
    `뷰어에는 같은 릴리스의 미리보기용 엔진이 포함된다. SDK/Node/Rust를 별도로 설치할 필요가 없다.\n` +
    `authoring-viewer.tgz는 공통 helper이며 전체 뷰어 앱이 아니다. 게임의 임의 main.ts/HUD는 해당 프로젝트에서 실행한다.\n\n` +
    `## 공개 전 확인\n\n원본 커밋·버전·체크섬과 각 OS의 실제 설치/프로젝트 열기/저장/재열기 및 서명 상태를 확인한다.\n` +
    `준비 스크립트는 OS GUI 검증·서명을 증명하지 않으며 Git tag/Release/npm 공개도 수행하지 않는다.\n`;
}
