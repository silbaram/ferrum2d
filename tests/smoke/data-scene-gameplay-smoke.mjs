import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, rename, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runReleaseCommand } from "./github-release-command.mjs";

const root = resolve(".");
await mkdir(resolve(root, "artifacts"), { recursive: true });
const output = await mkdtemp(resolve(root, "artifacts/data-scene-gameplay-consumer-"));
await runReleaseCommand("pnpm", ["pack", "--pack-destination", output], { cwd: resolve(root, "packages/ferrum-web") });
const tgz = (await readdir(output)).find(name => name.endsWith(".tgz"));
assert(tgz);
await runReleaseCommand("tar", ["-xzf", resolve(output, tgz), "-C", output]);
await mkdir(resolve(output, "node_modules/@ferrum2d"), { recursive: true });
await rename(resolve(output, "package"), resolve(output, "node_modules/@ferrum2d/ferrum-web"));
await copyFile(resolve(root, "tests/smoke/data-scene-gameplay-probe.mjs"), resolve(output, "probe.mjs"));
await runReleaseCommand(process.execPath, ["probe.mjs"], { cwd: output });
console.log(await readFile(resolve(output, "result.json"), "utf8"));
console.log(`Consumer evidence: ${output}`);
