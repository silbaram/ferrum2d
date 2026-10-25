import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
// Keep the optional CLI module outside Vite's config bundle (including its shebang).
const validatorUrl = new URL(
  "../../../scripts/tools/build-sprite-normals-wasm.mjs",
  import.meta.url,
).href;

const prefix = "/__ferrum-normal-generator";
const allowed = new Map([
  ["manifest.json", "application/json"],
  ["spritefusion_sprite_normals.js", "text/javascript"],
  ["spritefusion_sprite_normals_bg.wasm", "application/wasm"],
  ["LICENSE", "text/plain"],
]);
/** Read-only optional tooling route. It never installs, builds or writes generator assets. */
export function placementNormalGeneratorPlugin({ validate } = {}) {
  const configure = (server) => {
    server.middlewares.use(prefix, (request, response) => {
      void (async () => {
        response.setHeader("cache-control", "no-store");
        if (request.method !== "GET") {
          response.statusCode = 405;
          response.end();
          return;
        }
        try {
          const validateBundle =
            validate ??
            (await import(validatorUrl)).validateSpriteNormalWasmBundle;
          const bundle = await validateBundle(),
            name = request.url?.split("?")[0]?.slice(1);
          if (name === "config.json") {
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                manifestUrl: prefix + "/manifest.json",
                manifestSha256: bundle.manifestSha256,
              }),
            );
          } else if (allowed.has(name)) {
            response.setHeader("content-type", allowed.get(name));
            response.end(await readFile(resolve(bundle.root, name)));
          } else {
            response.statusCode = 404;
            response.end();
          }
        } catch {
          response.statusCode = 503;
          response.end("Normal generator unavailable");
        }
      })();
    });
  };
  return {
    name: "ferrum-optional-normal-generator",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
