import { savePlacementDocument } from "./server/sceneDocumentStore.mjs";
import { placementNormalGeneratorPlugin } from "./server/normalGenerator.mjs";
import { placementSceneCatalogPlugin } from "./server/sceneCatalog.mjs";
import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

const HANDOFF_ENDPOINT = "/__ferrum-placement-handoff";
const SAVE_ENDPOINT = "/__ferrum-placement-save";
const HANDOFF_FILE = fileURLToPath(new URL(".ferrum-placement-handoff.json", import.meta.url));
const SCENE_DOCUMENT_FILE = fileURLToPath(new URL("public/placement.garden.scene-authoring.json", import.meta.url));
const MAX_HANDOFF_BYTES = 256 * 1024;
const MAX_SAVE_BYTES = 2 * 1024 * 1024;

export default defineConfig({
  define: {
    __FERRUM_VIEWER_SOURCE_VERSION__: JSON.stringify(JSON.parse(await readFile(new URL("../../packages/ferrum-web/package.json", import.meta.url), "utf8")).version),
  },
  plugins: [placementAgentHandoffPlugin(), placementNormalGeneratorPlugin(), placementSceneCatalogPlugin(fileURLToPath(new URL("public/", import.meta.url)))],
  server: {
    watch: {
      // Reopen only after a confirmed save; filesystem HMR must not discard a draft.
      ignored: ["**/.ferrum-placement-handoff.json", "**/.ferrum-scene-save-*.tmp", "**/public/**/*.json"],
    },
  },
});

function placementAgentHandoffPlugin(): Plugin {
  return {
    name: "ferrum-placement-agent-handoff",
    configureServer(server) {
      server.middlewares.use(HANDOFF_ENDPOINT, (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
          if (body.length > MAX_HANDOFF_BYTES) {
            response.statusCode = 413;
            response.end("placement handoff payload too large");
            request.destroy();
          }
        });
        request.on("end", () => {
          void writePlacementHandoff(body, response);
        });
        request.on("error", () => {
          response.statusCode = 400;
          response.end("invalid placement handoff request");
        });
      });
      server.middlewares.use(SAVE_ENDPOINT, (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body, "utf8") > MAX_SAVE_BYTES) {
            response.statusCode = 413;
            response.end("placement save payload too large");
            request.destroy();
          }
        });
        request.on("end", () => {
          void writeSceneDocument(body, response);
        });
        request.on("error", () => {
          response.statusCode = 400;
          response.end("invalid placement save request");
        });
      });
    },
  };
}

async function writePlacementHandoff(
  body: string,
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  },
): Promise<void> {
  try {
    const handoff = JSON.parse(body) as unknown;
    await writeFile(HANDOFF_FILE, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
    response.statusCode = 204;
    response.end();
  } catch {
    response.statusCode = 400;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end("invalid placement handoff json");
  }
}

async function writeSceneDocument(
  body: string,
  response: {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string): void;
  },
): Promise<void> {
  try {
    const request = JSON.parse(body);
    const result = await savePlacementDocument(SCENE_DOCUMENT_FILE, request.document, request.expectedDocument);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.statusCode = (error as { code?: string }).code === "PLACEMENT_DOCUMENT_CONFLICT" ? 409 : 400;
    response.setHeader("content-type", "text/plain; charset=utf-8");
    response.end(error instanceof Error ? error.message : "invalid placement scene document json");
  }
}
