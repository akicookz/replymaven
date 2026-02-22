import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "index.ts"),
      name: "ReplyMaven",
      formats: ["iife"],
      fileName: () => "widget-embed.js",
    },
    outDir: path.resolve(__dirname, "../dist-widget"),
    emptyOutDir: true,
    minify: "esbuild",
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
