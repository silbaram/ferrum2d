import { opendir, open, realpath, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const FORMAT = "ferrum2d.consumer.scene-authoring";
const MAX_FILE = 2 * 1024 * 1024;
const ignored = new Set(["assets", "node_modules", "dist", "target"]);

/** Read-only, fixed-root index. Never follows symlinks or reads document bodies into the response. */
export async function scanPlacementScenes(root) {
  const scenes = [];
  const diagnostics = [];
  let visited = 0, candidates = 0, bytes = 0, truncated = false;
  function unreadable(filePath, error) {
    if (diagnostics.length >= 32) { truncated = true; return; }
    diagnostics.push({ relativePath: path.relative(root, filePath).split(path.sep).join("/").slice(0, 1024), code: String(error.code ?? "IO").slice(0, 64) });
  }
  async function visit(directory, depth) {
    if (depth > 8) { truncated = true; return; }
    const entries = [];
    let handle;
    try { handle = await opendir(directory); }
    catch (error) { if (depth === 0) throw error; unreadable(directory, error); return; }
    try {
      for await (const entry of handle) {
        if (++visited > 4096) { truncated = true; break; }
        entries.push(entry);
      }
    } catch (error) { unreadable(directory, error); }
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (visited > 4096 || candidates >= 512 || scenes.length >= 256 || bytes >= 32 * 1024 * 1024) {
        truncated = true; break;
      }
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && ignored.has(entry.name)) continue;
      if (/[\\\u0000-\u001f?#%:]/u.test(entry.name) || entry.name.length > 255) { truncated = true; continue; }
      const filePath = path.join(directory, entry.name);
      let canonical;
      try { canonical = await realpath(filePath); }
      catch (error) { unreadable(filePath, error); continue; }
      const relative = path.relative(root, canonical);
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) { truncated = true; continue; }
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) await visit(filePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      candidates++;
      const relativePath = path.relative(root, filePath).split(path.sep).join("/");
      if (relativePath.length > 1024) { truncated = true; continue; }
      const known = /(?:^|\.)scene-authoring\.json$/u.test(entry.name);
      let mode = "invalid", diagnostic, recognized = false;
      try {
        const file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let source;
        try {
          const stat = await file.stat();
          if (stat.size > MAX_FILE || bytes + stat.size > 32 * 1024 * 1024) {
            truncated = true; throw new Error("Document exceeds catalog read budget");
          }
          const buffer = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE + 1));
          const read = await file.read(buffer, 0, buffer.length, 0);
          bytes += read.bytesRead;
          if (read.bytesRead > MAX_FILE) throw new Error("Document exceeds 2 MiB");
          source = buffer.subarray(0, read.bytesRead).toString("utf8");
        } finally { await file.close(); }
        const value = JSON.parse(source);
        recognized = value?.format === FORMAT;
        if (value?.format !== FORMAT) { if (!known) continue; throw new Error("Not a Scene Authoring document"); }
        if (value.version !== 1) throw new Error("Unsupported Scene Authoring version");
        mode = value.spatial ? "hd2d" : "2d";
      } catch (error) {
        if (error.code) unreadable(filePath, error);
        if (!known && !recognized) continue;
        diagnostic = error instanceof Error ? error.message : String(error);
      }
      scenes.push({ relativePath, mode, ...(diagnostic ? { diagnostic } : {}) });
    }
  }
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error("Scene catalog root must not be a symlink");
    root = await realpath(root);
  }
  catch (error) {
    if (error.code === "ENOENT") return { version: 1, scenes, truncated, diagnostics };
    throw error;
  }
  await visit(root, 0);
  scenes.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  return { version: 1, scenes, truncated, diagnostics };
}

export function placementSceneCatalogPlugin(root) {
  return {
    name: "ferrum-placement-scene-catalog",
    configureServer(server) {
      server.middlewares.use("/placement-scenes.json", (request, response, next) => {
        if (request.method !== "GET") { next(); return; }
        void scanPlacementScenes(root).then(catalog => {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          response.end(JSON.stringify(catalog));
        }).catch(() => { response.statusCode = 500; response.end("Scene catalog unavailable"); });
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "placement-scenes.json", source: JSON.stringify(await scanPlacementScenes(root)) });
    },
  };
}
