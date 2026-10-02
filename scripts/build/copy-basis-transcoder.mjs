import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../packages/ferrum-web");
const source = path.join(root, "vendor/basis");
const destination = path.join(root, "dist/vendor/basis");
const provenance = JSON.parse(await readFile(path.join(source, "provenance.json"), "utf8"));
await mkdir(destination, { recursive: true });
for (const [name, expected] of Object.entries(provenance.sha256)) {
  const data = await readFile(path.join(source, name));
  if (createHash("sha256").update(data).digest("hex") !== expected) throw new Error(`Basis vendor checksum mismatch: ${name}`);
  await copyFile(path.join(source, name), path.join(destination, name));
}
await copyFile(path.join(source, "provenance.json"), path.join(destination, "provenance.json"));
