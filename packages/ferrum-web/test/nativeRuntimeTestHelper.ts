// Use the real generated native module, never a TypeScript simulation fallback.
import { readFile } from "node:fs/promises";
import { initSync } from "../pkg/ferrum_core.js";

initSync({ module: await readFile(new URL("../pkg/ferrum_core_bg.wasm", import.meta.url)) });
