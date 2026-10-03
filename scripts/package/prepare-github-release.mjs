#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { githubRelease } from "../../packages/create-game/bin/github-release.mjs";
import { run } from "./package-check-helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packages = ["ferrum-web", "ferrum-authoring-viewer", "create-game", "agents"];
const packageNames = ["@ferrum2d/ferrum-web", "@ferrum2d/authoring-viewer", "@ferrum2d/create-game", "@ferrum2d/agents"];

export async function prepareGithubRelease(options) {
  const release = githubRelease(options.version, options.repository);
  const output = path.resolve(options.output ?? path.join(repoRoot, "artifacts/github-release", release.tag));
  const metadata = await Promise.all(packages.map(async (directory) =>
    JSON.parse(await readFile(path.join(repoRoot, "packages", directory, "package.json"), "utf8"))));
  const baseVersion = release.version.split("-beta.")[0];
  for (const [index, manifest] of metadata.entries()) {
    if (manifest.name !== packageNames[index] || manifest.version.split("-")[0] !== baseVersion || manifest.private !== true) {
      throw new Error(`${packages[index]} must have its expected name, base version ${baseVersion}, and private: true.`);
    }
  }
  try {
    await readdir(output);
    throw new Error(`Output already exists; use a new directory: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  if (!options.skipBuild) {
    await required(pnpm, ["build:wasm"], repoRoot);
    await required(pnpm, ["--filter", "@ferrum2d/ferrum-web", "build"], repoRoot);
    await required(pnpm, ["--filter", "@ferrum2d/authoring-viewer", "build"], repoRoot);
  }
  if (!options.skipPackageCheck) await required(pnpm, ["package:check"], repoRoot);

  const temp = await mkdtemp(path.join(os.tmpdir(), "ferrum-github-release-"));
  try {
    const bundle = path.join(temp, "bundle");
    await mkdir(bundle);
    const assets = [];
    for (const [index, directory] of packages.entries()) {
      const source = path.join(repoRoot, "packages", directory);
      const stage = path.join(temp, directory);
      const manifest = structuredClone(metadata[index]);
      await mkdir(stage);
      // Copy only the existing package allowlist, never an entire workspace.
      for (const entry of manifest.files) {
        if (entry.includes("*") || entry.split(/[\\/]/).includes("..") || path.isAbsolute(entry)) {
          throw new Error(`Unsupported package allowlist path: ${entry}`);
        }
        await cp(path.join(source, entry), path.join(stage, entry), { recursive: true });
      }
      manifest.version = release.version;
      if (directory === "create-game") {
        manifest.ferrumGithubRelease = { repository: release.repository, version: release.version, tag: release.tag };
      }
      await writeFile(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      await required(pnpm, ["pack", "--pack-destination", bundle], stage);
      const file = `${manifest.name.replace(/^@/, "").replace("/", "-")}-${release.version}.tgz`;
      const bytes = await readFile(path.join(bundle, file));
      assets.push({
        package: manifest.name, version: release.version, file,
        url: `${release.baseUrl}/${file}`, bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    const commit = (await required("git", ["rev-parse", "HEAD"], repoRoot)).stdout.trim();
    const dirty = (await required("git", ["status", "--porcelain", "--untracked-files=normal"], repoRoot)).stdout.length > 0;
    const report = {
      format: "ferrum2d.github-release.bundle", version: 1,
      release: { repository: release.repository, version: release.version, tag: release.tag },
      source: { commit, dirty },
      checks: { build: !options.skipBuild, packageCheck: !options.skipPackageCheck },
      published: false, assets,
    };
    await writeFile(path.join(bundle, "release-manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(bundle, "SHA256SUMS"), assets.map((asset) => `${asset.sha256}  ${asset.file}\n`).join(""));
    await writeFile(path.join(bundle, "INSTALL.md"), installGuide(release));
    // Reserve the final directory exclusively. Never overwrite an older candidate.
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output);
    await cp(bundle, output, { recursive: true });
    return { output, report };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function installGuide(release) {
  return `# Ferrum2D ${release.version}\n\n` +
    `아래 명령은 ${release.tag} GitHub Release에 이 묶음의 모든 .tgz 파일을 공개한 뒤 사용할 수 있다.\n` +
    `이 파일과 로컬 묶음 생성만으로 GitHub에 배포되지는 않는다.\n\n` +
    `## 게임 개발 시작\n\nNode.js 22 권장. Rust나 wasm-pack 설치는 필요 없다.\n\n` +
    `\`\`\`bash\nnpx --yes --allow-remote=root ${release.generator} my-game --template topdown\ncd my-game\nnpm install\nnpm run dev\n\`\`\`\n\n` +
    `템플릿: minimal, topdown, platformer, breakout. 엔진과 viewer는 같은 릴리스 URL에 고정된다.\n` +
    `일반 개발 도구(Vite/TypeScript)는 npm 레지스트리에서 설치한다. package-lock.json을 커밋하고 재설치는 npm ci를 사용한다.\n\n` +
    `npm 12의 외부 URL 설치 정책에 맞춰 생성 프로젝트 .npmrc에 allow-remote=root를 기록한다. 기존 .npmrc는 덮어쓰지 않는다.\n\n` +
    `## AI 개발 지침 설치(선택)\n\n\`\`\`bash\nnpm run ferrum:agents\n\`\`\`\n\n` +
    `## 게임 검증과 빌드\n\n\`\`\`bash\nnpm run ferrum:check\nnpm run ferrum:deploy-report\nnpm run preview\n\`\`\`\n\n` +
    `이전 버전 게임을 업데이트할 때는 package.json의 엔진/viewer URL과 ferrum:agents URL을 같은 릴리스로 함께 변경하고 npm install 및 ferrum:check를 실행한다.\n` +
    `GitHub에서 자동 생성하는 Source code.zip은 설치용 패키지가 아니다.\n`;
}

async function required(command, args, cwd) {
  const result = await run(command, args, cwd);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--skip-package-check") options.skipPackageCheck = true;
    else if (["--version", "--repository", "--output"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--help")) {
    console.log("Usage: pnpm release:github:prepare -- --version x.y.z-beta.N [--repository owner/repo] [--output directory] [--skip-build] [--skip-package-check]\nCreates local assets only; does not publish, tag, or modify source package versions.");
  } else {
    try {
      const result = await prepareGithubRelease(parseArgs(process.argv.slice(2)));
      console.log(`GitHub Release assets prepared (not published): ${result.output}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
