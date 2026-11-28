import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Build modes that ship the bundled example scenes. The product build (the default) never does. */
const EXAMPLE_MODES = new Set(["demo", "test"]);

/**
 * Example scenes ship with the dev server, the web demo (`--mode demo`) and regression builds
 * (`--mode test`). Installed desktop Studio uses the default production build and has none.
 */
export function studioExamplesEnabled({ command, mode }) {
  return command === "serve" || EXAMPLE_MODES.has(mode);
}

const TYPES = {
  ".json": "application/json",
  ".png": "image/png",
  ".glb": "model/gltf-binary",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

/** Every regular file below root as a URL path, in a stable order. Symlinks are not followed. */
export async function listExampleFiles(root) {
  const files = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  await visit(root);
  return files;
}

/** Serve example files from root in development and emit them into the build output when enabled. */
export function placementExampleContentPlugin(root, enabled) {
  return {
    name: "ferrum-placement-example-content",
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" && request.method !== "HEAD") { next(); return; }
        let relative;
        try { relative = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname).slice(1); }
        catch { next(); return; }
        const file = path.resolve(root, relative);
        if (!relative || !file.startsWith(root + path.sep)) { next(); return; }
        void stat(file).then(async info => {
          if (!info.isFile()) { next(); return; }
          response.setHeader("Content-Type", TYPES[path.extname(file)] ?? "application/octet-stream");
          response.setHeader("Cache-Control", "no-store");
          response.end(request.method === "HEAD" ? undefined : await readFile(file));
        }, () => next());
      });
    },
    async generateBundle() {
      if (!enabled) return;
      for (const fileName of await listExampleFiles(root))
        this.emitFile({ type: "asset", fileName, source: await readFile(path.join(root, fileName)) });
    },
  };
}
