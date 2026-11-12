import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Preserve the wasm-bindgen module URL so Vite can serve its sibling Wasm file.
    exclude: ["@ferrum2d/ferrum-web"],
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        placementViewer: fileURLToPath(new URL("studio.html", import.meta.url)),
      },
    },
  },
});
