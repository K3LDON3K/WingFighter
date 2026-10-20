import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        zvuky: resolve(__dirname, "zvuky/index.html"),
      },
    },
  },
});
