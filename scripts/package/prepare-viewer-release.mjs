import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRelease, DEFAULT_GITHUB_REPOSITORY } from "../../packages/create-game/bin/github-release.mjs";
import { runReleaseCommand } from "./release-command.mjs";
import { stageViewerUpdater, updaterSettings } from "./viewer-updater.mjs";
import { fileRecord, nativeChecks, readJson, releaseIdentity, requireNewOutput, requireSource, viewerManifestName, viewerPlatforms, writeNewBundle } from "./release-distribution.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const targets = {
  "x86_64-unknown-linux-gnu": { os: "linux", arch: "x64" }, "aarch64-unknown-linux-gnu": { os: "linux", arch: "arm64" },
  "x86_64-pc-windows-msvc": { os: "windows", arch: "x64" }, "aarch64-pc-windows-msvc": { os: "windows", arch: "arm64" },
  "x86_64-apple-darwin": { os: "macos", arch: "x64" }, "aarch64-apple-darwin": { os: "macos", arch: "arm64" },
};

export async function sourceIdentity(root = repositoryRoot, run = runReleaseCommand) {
  const commit = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  const dirty = (await run("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root })).stdout.length > 0;
  return requireSource({ commit, dirty });
}

export async function viewerReleasePlan(options, { root = repositoryRoot, platform = process.platform, arch = process.arch } = {}) {
  if (options.withUpdater && options.noSign) throw Error("--with-updater cannot be combined with --no-sign (Tauri skips updater signing too)");
  const release = githubRelease(options.version, options.repository), native = viewerPlatforms[platform];
  if (options.withUpdater && release.repository !== DEFAULT_GITHUB_REPOSITORY) throw Error("The desktop updater uses the official Ferrum2D repository; fork builds require their own updater configuration");
  if (!native || !["x64", "arm64"].includes(arch)) throw new Error("Viewer release preparation requires a native Windows/Linux/macOS x64 or arm64 host");
  const base = release.version.split("-beta.")[0], desktop = path.join(root, "apps/placement-viewer-desktop");
  for (const [file, expected] of [["packages/ferrum-web/package.json", "@ferrum2d/ferrum-web"], ["apps/placement-viewer-desktop/package.json", "@ferrum2d/placement-viewer-desktop"]]) {
    const metadata = await readJson(path.join(root, file));
    if (metadata.name !== expected || metadata.private !== true || metadata.version.split("-")[0] !== base)
      throw new Error(`${file} must retain its name, private: true and base version ${base}`);
  }
  const config = await readJson(path.join(desktop, "src-tauri/tauri.conf.json"));
  const cargo = await readFile(path.join(desktop, "src-tauri/Cargo.toml"), "utf8");
  if (config.version.split("-")[0] !== base || cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1].split("-")[0] !== base)
    throw new Error("Desktop Tauri/Cargo base version must match the engine");
  return { release: releaseIdentity(release), platform: native.name, arch, bundle: native.bundle,
    output: path.resolve(options.output ?? path.join(root, "artifacts/distribution", release.tag, `viewer-${native.name}-${arch}`)),
    prerequisites: platform === "linux" ? ["Rust native toolchain", "pkg-config", "GTK 3", "WebKitGTK 4.1", "Tauri Linux build libraries"] : ["Rust native toolchain", "Tauri platform build prerequisites"],
    signing: options.noSign ? "disabled" : "platform configuration; not verified by this script",
    updater: Boolean(options.withUpdater),
    published: false, manualReleaseGate: { required: true, checks: nativeChecks } };
}

export async function checkViewerPrerequisites({ root = repositoryRoot, platform = process.platform, run = runReleaseCommand } = {}) {
  if (platform === "linux") {
    try { await run("pkg-config", ["--exists", "gtk+-3.0", "webkit2gtk-4.1"], { cwd: root }); }
    catch (error) { throw new Error(`Viewer Linux build prerequisites are missing. Install pkg-config, libwebkit2gtk-4.1-dev, libxdo-dev, libssl-dev, libayatana-appindicator3-dev and librsvg2-dev.\n${error.message}`); }
  }
  const rust = await run("rustc", ["-vV"], { cwd: root });
  const target = rust.stdout.match(/^host:\s*(\S+)$/m)?.[1], identity = targets[target];
  if (!identity || identity.os !== viewerPlatforms[platform]?.name) throw new Error("Viewer build requires a supported native Rust host; cross compilation is not supported");
  return { target, identity };
}

/** Builds the current host only. Test context substitutes commands, never a CLI cross-OS override. */
export async function prepareViewerRelease(options, { root = repositoryRoot, platform = process.platform, arch = process.arch, run = runReleaseCommand } = {}) {
  const plan = await viewerReleasePlan(options, { root, platform, arch });
  if (options.plan) return plan;
  const updater = updaterSettings(options.withUpdater);
  await requireNewOutput(plan.output);
  const desktop = path.join(root, "apps/placement-viewer-desktop"), native = viewerPlatforms[platform];
  const invoke = (command, args, extra = {}) => run(command, args, { cwd: root, timeoutMs: 1_800_000, onOutput: options.quiet ? undefined : text => process.stdout.write(text), ...extra });
  const { target, identity } = await checkViewerPrerequisites({ root, platform, run });
  const source = await sourceIdentity(root, run);
  const cargo = JSON.parse((await invoke("cargo", ["metadata", "--manifest-path", path.join(desktop, "src-tauri/Cargo.toml"), "--no-deps", "--locked", "--format-version", "1"], { onOutput: undefined })).stdout);
  if (typeof cargo.target_directory !== "string" || !path.isAbsolute(cargo.target_directory)) throw new Error("Invalid Cargo target directory");
  const bundleRoot = path.join(cargo.target_directory, target, "release/bundle", native.bundle);
  const previous = new Map();
  for (const file of await installerFiles(bundleRoot, native.extension, plan.release.version)) previous.set(file, (await lstat(file)).mtimeMs);
  const temp = await mkdtemp(path.join(os.tmpdir(), "ferrum-viewer-release-"));
  try {
    if (!options.reuseRuntimeBuild) {
      await invoke("pnpm", ["build:wasm"]);
      await invoke("pnpm", ["--filter", "@ferrum2d/ferrum-web", "build"]);
    }
    const runtime = await fileRecord(path.join(root, "packages/ferrum-web/pkg/ferrum_core_bg.wasm"));
    const icons = path.join(temp, "icons");
    await invoke("pnpm", ["--filter", "@ferrum2d/placement-viewer-desktop", "exec", "tauri", "icon", path.join(desktop, "app-icon.svg"), "--output", icons]);
    const iconFiles = ["32x32.png", "128x128.png", "128x128@2x.png", "icon.ico", "icon.icns"].map(file => path.join(icons, file));
    for (const file of iconFiles) await fileRecord(file);
    const config = { version: plan.release.version, bundle: { icon: iconFiles, createUpdaterArtifacts: Boolean(updater) },
      ...(updater ? { plugins: { updater: { pubkey: updater.publicKey, endpoints: [] } } } : {}) };
    await writeFile(path.join(temp, "release-config.json"), JSON.stringify(config));
    const started = Date.now();
    // Cached signatures must never be mistaken for output from this invocation.
    if (updater) {
      const directory = path.join(cargo.target_directory, target, "release/bundle", platform === "linux" ? "appimage" : platform === "darwin" ? "macos" : "nsis");
      for (const entry of await readdir(directory).catch(error => { if (error.code === "ENOENT") return []; throw error; })) {
        if (entry.endsWith(".sig")) await rm(path.join(directory, entry));
      }
    }
    await invoke("pnpm", ["--filter", "@ferrum2d/placement-viewer-desktop", "exec", "tauri", "build", "--target", target,
      "--bundles", updater && platform === "linux" ? "deb,appimage" : updater && platform === "darwin" ? "dmg,app" : native.bundle,
      "--ci", "--config", JSON.stringify(config), ...(options.noSign ? ["--no-sign"] : []), "--", "--locked"],
      { env: { ...process.env, VITE_FERRUM_RELEASE_VERSION: plan.release.version } });
    const installers = await installerFiles(bundleRoot, native.extension, plan.release.version);
    if (installers.length !== 1) throw new Error(`Expected exactly one ${plan.release.version} ${native.bundle} installer, found ${installers.length}`);
    const stamp = await lstat(installers[0]);
    if (stamp.mtimeMs < started - 1000 || previous.get(installers[0]) === stamp.mtimeMs) throw new Error("Installer was not produced by this build; refusing stale output");
    const frontend = path.join(root, "apps/placement-viewer/dist");
    await fileRecord(path.join(frontend, "index.html"));
    const wasm = await filesWithExtension(frontend, "wasm");
    if (!(await Promise.all(wasm.map(fileRecord))).some(file => file.sha256 === runtime.sha256)) throw new Error("Packaged frontend does not contain the current engine Wasm");
    const after = await sourceIdentity(root, run);
    if (after.commit !== source.commit || after.dirty !== source.dirty) throw new Error("Source identity changed during the viewer build; prepare again from one source tree");
    const stage = path.join(temp, "bundle"); await mkdir(stage);
    const file = `ferrum2d-placement-viewer-${plan.release.version}-${identity.os}-${identity.arch}.${native.extension}`;
    const original = await fileRecord(installers[0]);
    await copyFile(installers[0], path.join(stage, file));
    const asset = await fileRecord(path.join(stage, file));
    if (asset.sha256 !== original.sha256) throw new Error("Installer changed during staging");
    const updateAssets = updater ? await stageViewerUpdater({ bundleRoot: path.join(cargo.target_directory, target, "release/bundle"),
      stage, release: plan.release, platform: identity, started, fileRecord }) : undefined;
    const manifest = { format: "ferrum2d.viewer-release.bundle", version: 1, release: plan.release, source, published: false,
      platform: { ...identity, target, bundle: native.bundle },
      runtime: { package: "@ferrum2d/ferrum-web", releaseVersion: plan.release.version, wasmSha256: runtime.sha256 },
      checks: { nativeBuild: true, frontendWasm: true, iconGeneration: true, nativeGui: "not-run", signing: "not-verified" },
      signingRequested: options.noSign ? false : "platform-default", manualReleaseGate: plan.manualReleaseGate,
      assets: [{ ...asset, url: `${githubRelease(plan.release.version, plan.release.repository).baseUrl}/${file}` }],
      ...(updateAssets ? { updater: updateAssets } : {}) };
    const manifestName = viewerManifestName(identity.os, identity.arch);
    await writeFile(path.join(stage, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(stage, `VIEWER_SHA256SUMS-${identity.os}-${identity.arch}`), `${asset.sha256}  ${file}\n`);
    await writeFile(path.join(stage, `VIEWER_INSTALL-${identity.os}-${identity.arch}.md`),
      `# Ferrum2D Viewer ${plan.release.version}\n\n${file}\n\n${identity.os}/${identity.arch}용 설치 파일이다. 속성 → 문서 → 프로젝트 열기로 게임 폴더를 연다.\n` +
      `public/scene-authoring.json과 public/assets를 사용한다. 미리보기 엔진을 내장하며 SDK/Node/Rust 별도 설치가 필요하지 않다.\n` +
      `실제 설치·파일 선택·저장/재열기·렌더링 및 서명 상태는 공개 전에 확인해야 한다. 이 묶음은 아직 공개되지 않았다.\n`);
    await writeNewBundle(stage, plan.output, manifestName);
    return { output: plan.output, manifest };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function filesWithExtension(root, extension) {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => { if (error.code === "ENOENT") return []; throw error; });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not supported in build output: ${entry.name}`);
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesWithExtension(file, extension));
    else if (entry.isFile() && entry.name.endsWith(`.${extension}`)) result.push(file);
  }
  return result.sort();
}
async function installerFiles(root, extension, version) {
  // Match a version field, not beta.10 or a suffix of 10.1.0-beta.1.
  const field = new RegExp(`(?:^|[_-])${version.replaceAll(".", "\\.")}(?=[_.-])`);
  return (await filesWithExtension(root, extension)).filter(file => field.test(path.basename(file)));
}
