import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "path";

function logTestWidgetUrl(): Plugin {
  let logged = false;
  return {
    name: "log-test-widget-url",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        if (logged) return;
        logged = true;
        setTimeout(() => {
          const base =
            server.resolvedUrls?.local?.[0] ?? "http://localhost:5173/";
          const testWidgetUrl = `${base.replace(/\/$/, "")}/test-widget.html`;
          server.config.logger.info(
            `\n  \x1b[36m➜\x1b[0m  \x1b[1mTest widget page:\x1b[0m ${testWidgetUrl}\n`,
          );
        }, 0);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare(), tailwindcss(), logTestWidgetUrl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ["recharts"],
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
        },
      },
    },
  },
});
