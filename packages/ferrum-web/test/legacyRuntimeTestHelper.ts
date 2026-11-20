import { createEngine } from "../src/core.js";

/** Existing JSON save/progress and legacy-controller regressions deliberately
 * select the real legacy backend. Native/default/file tests use createEngine
 * directly and must never be routed through this compatibility fixture.
 */
export async function createLegacyEngine(...args: Parameters<typeof createEngine>): ReturnType<typeof createEngine> {
  const [onFrame, inputProvider, assetHost, viewportProvider, options] = args;
  const engine = await createEngine(onFrame, inputProvider, assetHost, viewportProvider, {
    ...options,
    physicsBackend: "legacy",
  });
  if (engine.physicsBackend() !== "legacy") {
    engine.destroy();
    throw new Error("Legacy JSON/controller fixture did not select the actual legacy backend.");
  }
  return engine;
}
