import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  ],
  test: {
    globals: true,
    include: ["worker/agents/**/*.integration.test.ts"],
    testTimeout: 15_000,
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["sanitize-html"],
        },
      },
    },
  },
});
