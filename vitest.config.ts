import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      additionalExports: {
        MavenChatAgent: "DurableObject",
      },
      miniflare: {
        bindings: {
          SIDECHAT_TOKEN_SECRET:
            "native-sidechat-workerd-test-secret-32-bytes",
          STRIPE_SECRET_KEY: "sk_test_native_agents",
          PUBLIC_CONVERSATION_STORE:
            process.env.PUBLIC_CONVERSATION_STORE === "agent"
              ? "agent"
              : "legacy",
        },
      },
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
    }),
  ],
  test: {
    globals: true,
    include: ["worker/agents/**/*.integration.test.ts"],
    testTimeout: 30_000,
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
