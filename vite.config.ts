import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
  },
  build: {
    target: "esnext",
    outDir: "dist",
    // fontkit is one 756 kB upstream module, loaded only when PDF export is requested.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "fontkit", test: /node_modules[\\/]@pdf-lib[\\/]fontkit/ },
            { name: "pdf-lib", test: /node_modules[\\/]pdf-lib/ },
          ],
        },
      },
    },
  },
});
