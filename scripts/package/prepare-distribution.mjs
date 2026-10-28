#!/usr/bin/env node
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { prepareGithubRelease } from "./prepare-github-release.mjs";
import { checkViewerPrerequisites, prepareViewerRelease, repositoryRoot, viewerReleasePlan } from "./prepare-viewer-release.mjs";
import { assembleDistribution, releaseIdentity, requireNewOutput, verifyDistribution } from "./release-distribution.mjs";
import { updaterSettings } from "./viewer-updater.mjs";

export function parseDistributionArgs(argv) {
  const args = argv.filter(arg => arg !== "--"), command = args.shift() ?? "prepare";
  if (["--help", "-h"].includes(command)) return { help: true };
  if (!["prepare", "assemble", "verify"].includes(command)) throw new Error(`Unknown command: ${command}`);
  const options = { command }, allowed = {
    prepare: ["version", "repository", "output", "component", "plan", "no-sign", "with-updater", "skip-engine-build", "skip-engine-package-check"],
    assemble: ["engine", "viewer", "output"], verify: ["bundle"],
  }[command];
  const flags = new Set(["plan", "no-sign", "with-updater", "skip-engine-build", "skip-engine-package-check"]), seen = new Set();
  while (args.length) {
    const arg = args.shift();
    if (["--help", "-h"].includes(arg)) return { help: true };
    const key = arg.startsWith("--") ? arg.slice(2) : "";
    if (!allowed.includes(key) || (seen.has(key) && key !== "viewer")) throw new Error(`Unknown or duplicate option: ${arg}`);
    seen.add(key);
    const value = flags.has(key) ? true : args.shift();
    if (value === undefined || value === "" || (typeof value === "string" && value.startsWith("--"))) throw new Error(`Missing value for ${arg}`);
    const name = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === "viewer") (options.viewers ??= []).push(value); else options[name] = value;
  }
  if (command === "prepare") {
    if (!options.version) throw new Error("--version x.y.z-beta.N is required");
    githubRelease(options.version, options.repository);
    options.component ??= "all";
    if (!["engine", "viewer", "all"].includes(options.component)) throw new Error("--component must be engine, viewer or all");
    if (options.component === "viewer" && (options.skipEngineBuild || options.skipEnginePackageCheck)) throw new Error("Engine skip options require component engine or all");
    if (options.component === "engine" && options.noSign) throw new Error("--no-sign requires component viewer or all");
    if (options.component === "engine" && options.withUpdater) throw new Error("--with-updater requires component viewer or all");
    if (options.withUpdater && options.noSign) throw new Error("--with-updater cannot be combined with --no-sign");
  } else if (command === "assemble" && (!options.engine || !options.viewers?.length || !options.output)) {
    throw new Error("assemble requires --engine, one or more --viewer, and --output");
  } else if (command === "verify" && !options.bundle) throw new Error("verify requires --bundle");
  return options;
}

export async function prepareDistribution(options, context = {}) {
  const root = context.root ?? repositoryRoot, release = githubRelease(options.version, options.repository);
  const component = options.component ?? "all";
  if (!["engine", "viewer", "all"].includes(component)) throw new Error("Invalid distribution component");
  const viewer = component !== "engine" ? await viewerReleasePlan(options, context) : undefined;
  const output = path.resolve(options.output ?? path.join(root, "artifacts/distribution", release.tag,
    component === "viewer" ? `viewer-${viewer.platform}-${viewer.arch}` : component));
  if (options.plan) return { release: releaseIdentity(release), component, output, published: false,
    engine: component !== "viewer" ? { build: !options.skipEngineBuild, packageCheck: !options.skipEnginePackageCheck, packages: 4 } : undefined,
    viewer };
  if (viewer?.updater) updaterSettings(true);
  await requireNewOutput(output);
  if (component === "viewer") return prepareViewerRelease({ ...options, output }, context);
  if (component === "all") await checkViewerPrerequisites(context);
  const engineOptions = { version: release.version, repository: release.repository,
    skipBuild: Boolean(options.skipEngineBuild), skipPackageCheck: Boolean(options.skipEnginePackageCheck) };
  if (component === "engine") return prepareGithubRelease({ ...engineOptions, output });
  const stage = await mkdtemp(path.join(os.tmpdir(), "ferrum-distribution-"));
  try {
    const engine = path.join(stage, "engine"), native = path.join(stage, "viewer");
    await prepareGithubRelease({ ...engineOptions, output: engine });
    await prepareViewerRelease({ ...options, output: native, reuseRuntimeBuild: !engineOptions.skipBuild }, context);
    return await assembleDistribution({ engine, viewers: [native], output });
  } finally { await rm(stage, { recursive: true, force: true }); }
}

export const distributionHelp = `Ferrum2D engine SDK / desktop viewer release preparation (no publishing)

prepare --version x.y.z-beta.N [--component engine|viewer|all] [--repository owner/repo]
        [--output NEW_DIR] [--plan] [--no-sign] [--with-updater]
        [--skip-engine-build] [--skip-engine-package-check]
assemble --engine ENGINE_DIR --viewer VIEWER_DIR [--viewer OTHER_OS_DIR] --output NEW_DIR
verify --bundle DISTRIBUTION_DIR

Viewer installers are built on the native OS: Windows .exe, Linux .deb, macOS .dmg.
--with-updater also builds signed updater artifacts (Linux AppImage) and per-platform metadata.
Requires FERRUM_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY; OS code-signing is separate.
--plan only prints the plan. Existing outputs are never overwritten.
Engine skip flags record omitted checks. Native GUI/signing require separate review.
No tag, GitHub Release, upload, or npm publication is performed.
`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseDistributionArgs(process.argv.slice(2));
    const result = options.help ? distributionHelp : options.command === "assemble" ? await assembleDistribution(options)
      : options.command === "verify" ? await verifyDistribution(path.resolve(options.bundle)) : await prepareDistribution(options);
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (error) { console.error(`Distribution preparation failed: ${error.message}`); process.exitCode = 1; }
}
