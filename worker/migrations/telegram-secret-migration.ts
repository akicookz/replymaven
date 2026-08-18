import { isEncrypted } from "../services/encryption-service";
import {
  deriveTelegramWebhookSecret,
  encryptTelegramToken,
} from "../services/telegram-secrets";

export interface TelegramSecretMigrationOptions {
  encryptionKey: string;
  listProjects(): Promise<
    Array<{ projectId: string; telegramBotToken: string | null }>
  >;
  storeToken(projectId: string, encrypted: string): Promise<void>;
  registerWebhook(input: {
    projectId: string;
    storedBotToken: string;
    secret: string;
  }): Promise<boolean>;
  limit?: number;
  onFailure?(projectId: string, error: unknown): void;
}

export interface TelegramSecretMigrationResult {
  scanned: number;
  encrypted: number;
  registered: number;
  failed: number;
}

// Converges two things every run: tokens written before encryption existed, and
// webhooks registered before the secret existed. Re-registering is also the
// repair path if a stolen token was used to point a bot's webhook elsewhere.
export async function migrateTelegramSecrets(
  options: TelegramSecretMigrationOptions,
): Promise<TelegramSecretMigrationResult> {
  const result: TelegramSecretMigrationResult = {
    scanned: 0,
    encrypted: 0,
    registered: 0,
    failed: 0,
  };
  const limit = options.limit ?? 200;

  for (const row of await options.listProjects()) {
    if (!row.telegramBotToken) continue;
    if (result.scanned >= limit) break;
    result.scanned += 1;
    try {
      let stored = row.telegramBotToken;
      if (!isEncrypted(stored)) {
        stored = await encryptTelegramToken(stored, options.encryptionKey);
        await options.storeToken(row.projectId, stored);
        result.encrypted += 1;
      }
      const registered = await options.registerWebhook({
        projectId: row.projectId,
        storedBotToken: stored,
        secret: await deriveTelegramWebhookSecret(
          row.projectId,
          options.encryptionKey,
        ),
      });
      if (registered) result.registered += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      options.onFailure?.(row.projectId, error);
    }
  }

  return result;
}
