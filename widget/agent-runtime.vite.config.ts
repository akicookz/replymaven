import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  // The repo's public/ dir must not be copied into dist-widget: it contains
  // the previously deployed widget bundles, which would overwrite the fresh
  // build output and then ship stale code via widget:upload.
  publicDir: false,
  // The widget builds are not covered by tsconfig.app.json, so set the JSX
  // runtime explicitly; the classic transform would reference a global React.
  esbuild: {
    jsx: "automatic",
  },
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
