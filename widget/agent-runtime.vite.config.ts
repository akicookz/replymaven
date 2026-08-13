import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, "agent-runtime-entry.ts"),
      name: "ReplyMavenAgentRuntime",
      formats: ["iife"],
      fileName: () => "widget-agent-runtime.js",
    },
    outDir: path.resolve(__dirname, "../dist-widget"),
    emptyOutDir: false,
    minify: "esbuild",
    rollupOptions: {
      treeshake: {
        moduleSideEffects: false,
      },
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
