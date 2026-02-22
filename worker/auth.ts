import { betterAuth } from "better-auth";
import {
  withCloudflare,
  type CloudflareGeolocation,
} from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./db";
import { type AppEnv } from "./types";

export function createAuth(
  env: AppEnv,
  cf?: CfProperties,
) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    ...withCloudflare(
      {
        autoDetectIpAddress: true,
        geolocationTracking: true,
        cf: (cf as CloudflareGeolocation) || ({} as CloudflareGeolocation),
        d1: {
          db: db as any,
          options: {
            usePlural: true,
            debugLogs: false,
          },
        },
      },
      {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
          },
          github: {
            clientId: env.GITHUB_CLIENT_ID,
            clientSecret: env.GITHUB_CLIENT_SECRET,
          },
        },
        rateLimit: {
          enabled: true,
          window: 60,
          max: 200,
        },
        secret: env.BETTER_AUTH_SECRET,
        baseURL: env.BETTER_AUTH_URL,
      },
    ),
  });
}
