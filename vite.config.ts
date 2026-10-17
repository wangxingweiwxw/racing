import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: { target: "es2022", chunkSizeWarningLimit: 1200, rolldownOptions: { input: { racing: "index.html", openracing: "openracing/index.html" } } },
});
