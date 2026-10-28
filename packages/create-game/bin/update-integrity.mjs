import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const text = bytes => new TextDecoder("utf8", { fatal: true }).decode(bytes).replace(/\0.*$/su, "");
const fail = message => { throw new Error(`Invalid release archive: ${message}`); };

/** Read hashes, never extract an archive. Links and paths outside package/ are not supported. */
export function packageFileHashes(bytes, expected) {
  const tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }), files = new Map();
  let offset = 0, longPath, paxPath;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512); offset += 512;
    if (header.every(byte => byte === 0)) break;
    const octal = field => {
      const value = text(field).trim();
      if (!/^[0-7]+$/u.test(value)) fail("invalid numeric header");
      return parseInt(value, 8);
    };
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== octal(header.subarray(148, 156))) fail("header checksum mismatch");
    const size = octal(header.subarray(124, 136));
    if (size > 64 * 1024 * 1024 || offset + size > tar.length) fail("file byte limit");
    const body = tar.subarray(offset, offset + size); offset += Math.ceil(size / 512) * 512;
    const kind = String.fromCharCode(header[156]);
    const prefix = text(header.subarray(345, 500)), name = text(header.subarray(0, 100));
    if (kind === "L") { longPath = text(body); continue; }
    if (kind === "x" || kind === "g") {
      let cursor = 0;
      while (cursor < body.length) {
        const space = body.indexOf(32, cursor), length = Number(text(body.subarray(cursor, space)));
        if (space < cursor || !Number.isSafeInteger(length) || length <= space - cursor + 1 || cursor + length > body.length) fail("invalid PAX record");
        const record = text(body.subarray(space + 1, cursor + length)).replace(/\n$/u, ""), equal = record.indexOf("=");
        if (equal < 1) fail("invalid PAX key");
        if (record.slice(0, equal) === "path") {
          if (kind === "g") fail("global PAX path");
          paxPath = record.slice(equal + 1);
        }
        if (record.slice(0, equal) === "linkpath") fail("PAX link");
        cursor += length;
      }
      continue;
    }
    const full = paxPath ?? longPath ?? (prefix ? prefix + "/" + name : name);
    paxPath = longPath = undefined;
    if (!full.startsWith("package/") || /[\\\u0000-\u001f]/u.test(full) || full.replace(/\/$/u, "").split("/").some(part => !part || part === ".." || part === ".")) fail("unsafe file path");
    if (kind === "5") continue;
    if (kind !== "0" && kind !== "\0") fail("unsupported entry type");
    const relative = full.slice(8);
    if (!relative || relative.length > 2048 || files.has(relative) || files.size >= 16_384) fail("invalid or duplicate file");
    files.set(relative, sha256(body));
    if (relative === "package.json" && expected) {
      const metadata = JSON.parse(text(body));
      if (metadata.name !== expected.name || metadata.version !== expected.version) fail("package identity mismatch");
    }
  }
  if (!files.has("package.json")) fail("package.json is missing");
  return files;
}

/** Detect changed remote assets or package-manager substitutions without executing package code. */
export async function verifyInstalledPackage(directory, files) {
  const root = await realpath(directory);
  for (const [relative, digest] of files) {
    const file = path.join(root, relative), canonical = await realpath(file);
    const inside = path.relative(root, canonical);
    const stat = await lstat(file);
    if (!inside || inside.startsWith(".." + path.sep) || inside === ".." || path.isAbsolute(inside) || !stat.isFile() || stat.size > 64 * 1024 * 1024)
      throw new Error("Installed package path changed: " + relative);
    if (sha256(await readFile(file)) !== digest) throw new Error("Installed package differs from verified release: " + relative);
  }
}
