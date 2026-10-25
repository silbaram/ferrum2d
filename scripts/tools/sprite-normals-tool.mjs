import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const tool = JSON.parse(
  await readFile(
    new URL("./sprite-normals-tool.json", import.meta.url),
    "utf8",
  ),
);
export const toolRoot = resolve(
  repositoryRoot,
  "artifacts/tools/sprite-normals",
  tool.revision,
  `${process.platform}-${process.arch}`,
);
export const binaryName =
  tool.name + (process.platform === "win32" ? ".exe" : "");
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export const execute = promisify(execFile);

export class SpriteNormalsError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.code = code;
  }
}

/** Only the explicitly installed, revision-pinned CLI may be used by generation jobs. */
export async function installedTool(directory = toolRoot) {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "installation.json"), "utf8"),
    );
    const binary = resolve(directory, "bin", binaryName);
    if (
      Object.entries(tool).some(([key, value]) => manifest[key] !== value) ||
      manifest.platform !== process.platform ||
      manifest.arch !== process.arch ||
      manifest.binarySha256 !== sha256(await readFile(binary))
    )
      throw new Error("Installed generator provenance or binary hash differs");
    if (!(await stat(binary)).isFile())
      throw new Error("Generator is not a file");
    return { binary, manifest };
  } catch (error) {
    throw new SpriteNormalsError(
      error.code === "ENOENT"
        ? "FERRUM_NORMAL_TOOL_MISSING"
        : "FERRUM_NORMAL_TOOL_MISMATCH",
      `${error.message}. Run pnpm normals:install; use a fresh managed cache if it is damaged.`,
      { cause: error },
    );
  }
}

export function printFailure(error) {
  process.stderr.write(
    JSON.stringify({
      format: "ferrum2d.sprite-normals.error",
      version: 1,
      ok: false,
      code:
        typeof error.code === "string" ? error.code : "FERRUM_NORMAL_FAILED",
      message: error.message,
    }) + "\n",
  );
  process.exitCode = 1;
}
