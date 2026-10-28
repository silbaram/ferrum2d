import { copyFile, lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";

export function updaterTarget(os, arch) {
  if (!["linux", "windows", "macos"].includes(os) || !["x64", "arm64"].includes(arch)) throw Error("Unsupported updater platform");
  return `${os === "macos" ? "darwin" : os}-${arch === "x64" ? "x86_64" : "aarch64"}`;
}
export const updaterMetadataName = (os, arch) => `viewer-updater-${os}-${arch}.json`;
export function updaterSettings(enabled, env = process.env) {
  if (!enabled) return undefined;
  const publicKey = env.FERRUM_UPDATER_PUBLIC_KEY?.trim();
  if (!publicKey || !env.TAURI_SIGNING_PRIVATE_KEY) throw Error("--with-updater requires FERRUM_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY");
  // Tauri's public key is a base64-encoded minisign public-key document.
  const decoded = Buffer.from(publicKey, "base64").toString("utf8");
  if (!/^untrusted comment: [^\n]+\r?\n[A-Za-z0-9+/=]+\s*$/u.test(decoded)) throw Error("Invalid updater public key");
  return { publicKey };
}

/** Stage only signatures and artifacts emitted by this build. OS code-signing remains a separate gate. */
export async function stageViewerUpdater({ bundleRoot, stage, release, platform, started, fileRecord }) {
  const extension = platform.os === "linux" ? "AppImage" : platform.os === "windows" ? "exe" : "app.tar.gz";
  const subdir = platform.os === "linux" ? "appimage" : platform.os === "windows" ? "nsis" : "macos";
  const directory = path.join(bundleRoot, subdir);
  const names = await readdir(directory);
  const artifacts = [];
  for (const name of names.filter(name => name.endsWith(`.${extension}.sig`))) {
    const artifact = path.join(directory, name.slice(0, -4)), signature = path.join(directory, name);
    // mtime alone cannot associate a stale signature with a freshly replaced artifact.
    for (const file of [artifact, signature]) if (!(await lstat(file)).isFile() || (await lstat(file)).mtimeMs < started - 1000) throw Error("Updater artifact/signature was not produced by this build");
    artifacts.push({ artifact, signature });
  }
  if (artifacts.length !== 1) throw Error("Expected exactly one freshly signed updater artifact");
  const { artifact, signature } = artifacts[0];
  const baseUrl = githubRelease(release.version, release.repository).baseUrl;
  const file = `ferrum2d-placement-viewer-${release.version}-${platform.os}-${platform.arch}.${extension}`;
  const signatureText = (await readFile(signature, "utf8")).trim();
  if (!signatureText || signatureText.length > 16384 || !/^[A-Za-z0-9+/=]+$/u.test(signatureText)) throw Error("Invalid updater signature");
  await copyFile(artifact, path.join(stage, file));
  const record = await fileRecord(path.join(stage, file));
  if (record.sha256 !== (await fileRecord(artifact)).sha256) throw Error("Updater artifact changed during staging");
  await writeFile(path.join(stage, file + ".sig"), signatureText + "\n");
  const metadata = updaterMetadataName(platform.os, platform.arch);
  await writeFile(path.join(stage, metadata), JSON.stringify({ version: release.version,
    platforms: { [updaterTarget(platform.os, platform.arch)]: { url: baseUrl + "/" + file, signature: signatureText } } }, null, 2) + "\n");
  return { artifact: { ...record, url: baseUrl + "/" + file }, signature: await fileRecord(path.join(stage, file + ".sig")), metadata: await fileRecord(path.join(stage, metadata)) };
}

export async function validateViewerUpdater(root, manifest, verifyAsset) {
  const update = manifest.updater;
  if (!update) return [];
  const { os, arch } = manifest.platform, release = githubRelease(manifest.release.version, manifest.release.repository);
  const extension = os === "linux" ? "AppImage" : os === "windows" ? "exe" : "app.tar.gz";
  const file = `ferrum2d-placement-viewer-${release.version}-${os}-${arch}.${extension}`;
  if (update.artifact?.file !== file || update.artifact?.url !== release.baseUrl + "/" + file || update.signature?.file !== file + ".sig" || update.metadata?.file !== updaterMetadataName(os, arch)) throw Error("Invalid updater file identity");
  for (const record of [update.artifact, update.signature, update.metadata]) await verifyAsset(root, record);
  const metadata = JSON.parse(await readFile(path.join(root, update.metadata.file), "utf8"));
  const signature = (await readFile(path.join(root, update.signature.file), "utf8")).trim();
  const expected = { version: release.version, platforms: { [updaterTarget(os, arch)]: { url: update.artifact.url, signature } } };
  if (!signature || signature.length > 16384 || !/^[A-Za-z0-9+/=]+$/u.test(signature) || JSON.stringify(metadata) !== JSON.stringify(expected)) throw Error("Updater metadata/signature mismatch");
  return [file, update.signature.file, update.metadata.file];
}
