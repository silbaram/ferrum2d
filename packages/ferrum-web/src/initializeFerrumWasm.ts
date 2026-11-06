import init from "../pkg/ferrum_core.js";

let initialization: Promise<void> | undefined;

/** Initialize native state helpers without creating a game world or renderer.
 * Normal createEngine/createFerrumRuntime startup also initializes this module.
 * A host can supply bytes/a compiled module for headless or custom asset loading.
 * Repeated calls reuse the initialized module; this does not reload native state.
 */
export async function initializeFerrumWasm(module?: BufferSource | WebAssembly.Module): Promise<void> {
  initialization ??= (async () => {
    await (module === undefined ? init() : init({ module_or_path: module }));
  })().catch((error: unknown) => {
    initialization = undefined;
    throw error;
  });
  await initialization;
}
