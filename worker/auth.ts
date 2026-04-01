import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins/email-otp";
import {
  withCloudflare,
  type CloudflareGeolocation,
} from "better-auth-cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { schema } from "./db";
import { Resend } from "resend";
import { type AppEnv } from "./types";
import { buildOtpEmailHtml } from "./services/email-service";

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
        plugins: [
          emailOTP({
            otpLength: 6,
            expiresIn: 600,
            allowedAttempts: 5,
            sendVerificationOTP: async ({ email, otp }) => {
              const resend = new Resend(env.RESEND_API_KEY);
              await resend.emails.send({
                from: "ReplyMaven <noreply@updates.replymaven.com>",
                to: email,
                subject: `${otp} is your ReplyMaven verification code`,
                html: buildOtpEmailHtml(otp),
              });
            },
          }),
        ],
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
