import { betterAuth } from "better-auth";
import {
  withCloudflare,
  type CloudflareGeolocation,
} from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./db";
import { Resend } from "resend";
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
        user: {
          changeEmail: {
            enabled: true,
            sendChangeEmailVerification: async ({ user, newEmail, url }) => {
              const resend = new Resend(env.RESEND_API_KEY);
              await resend.emails.send({
                from: "ReplyMaven <noreply@updates.replymaven.com>",
                to: newEmail,
                subject: "Verify your new email address",
                html: `
                  <h2>Confirm your email change</h2>
                  <p>Hi ${user.name},</p>
                  <p>You requested to change your ReplyMaven email to <strong>${newEmail}</strong>.</p>
                  <p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Verify new email</a></p>
                  <p>If you didn't request this, you can safely ignore this email.</p>
                `,
              });
            },
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
