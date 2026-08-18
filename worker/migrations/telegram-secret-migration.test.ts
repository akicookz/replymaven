import { describe, expect, test } from "bun:test";
import { isEncrypted } from "../services/encryption-service";
import {
  deriveTelegramWebhookSecret,
  encryptTelegramToken,
  resolveTelegramToken,
} from "../services/telegram-secrets";
import { migrateTelegramSecrets } from "./telegram-secret-migration";

const encryptionKey = "c".repeat(64);
const token = "8154237761:AAHkq2Vv0y0Zm7Q1x9rTuWbN3sLpQ4dFgHi";

function deps(
  rows: Array<{ projectId: string; telegramBotToken: string | null }>,
  overrides: Partial<{
    registerWebhook: (input: {
      projectId: string;
      storedBotToken: string;
      secret: string;
    }) => Promise<boolean>;
    limit: number;
  }> = {},
) {
  const stored: Array<{ projectId: string; encrypted: string }> = [];
  const registered: Array<{ projectId: string; secret: string }> = [];
  return {
    stored,
    registered,
    options: {
      encryptionKey,
      listProjects: async () => rows,
      storeToken: async (projectId: string, encrypted: string) => {
        stored.push({ projectId, encrypted });
      },
      registerWebhook: overrides.registerWebhook ??
        (async (input: {
          projectId: string;
          storedBotToken: string;
          secret: string;
        }) => {
          registered.push({
            projectId: input.projectId,
            secret: input.secret,
          });
          return true;
        }),
      ...(overrides.limit === undefined ? {} : { limit: overrides.limit }),
    },
  };
}

describe("telegram secret migration", () => {
  test("encrypts a plaintext row and keeps the token readable", async () => {
    const harness = deps([{ projectId: "project-1", telegramBotToken: token }]);
    const result = await migrateTelegramSecrets(harness.options);

    expect(result).toMatchObject({ scanned: 1, encrypted: 1, failed: 0 });
    expect(harness.stored).toHaveLength(1);
    const written = harness.stored[0]!.encrypted;
    expect(isEncrypted(written)).toBe(true);
    expect(await resolveTelegramToken(written, encryptionKey)).toBe(token);
  });

  test("leaves an already encrypted row alone but still arms the webhook", async () => {
    const encrypted = await encryptTelegramToken(token, encryptionKey);
    const harness = deps([
      { projectId: "project-1", telegramBotToken: encrypted },
    ]);

    const result = await migrateTelegramSecrets(harness.options);

    expect(result).toMatchObject({ scanned: 1, encrypted: 0, registered: 1 });
    expect(harness.stored).toHaveLength(0);
    expect(harness.registered[0]).toEqual({
      projectId: "project-1",
      secret: await deriveTelegramWebhookSecret("project-1", encryptionKey),
    });
  });

  test("skips empty rows and counts a failing registration", async () => {
    const harness = deps(
      [
        { projectId: "project-1", telegramBotToken: null },
        { projectId: "project-2", telegramBotToken: token },
      ],
      {
        registerWebhook: async () => {
          throw new Error("Telegram unavailable");
        },
      },
    );

    const result = await migrateTelegramSecrets(harness.options);

    expect(result).toMatchObject({
      scanned: 1,
      encrypted: 1,
      registered: 0,
      failed: 1,
    });
  });

  test("stops at the batch limit", async () => {
    const harness = deps(
      Array.from({ length: 5 }, (_, index) => ({
        projectId: `project-${index}`,
        telegramBotToken: token,
      })),
      { limit: 2 },
    );

    const result = await migrateTelegramSecrets(harness.options);

    expect(result.scanned).toBe(2);
    expect(harness.registered).toHaveLength(2);
  });
});
