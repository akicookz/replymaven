import { describe, expect, test } from "bun:test";
import { resolveTelegramChatBinding } from "./telegram-chat-binding";

describe("telegram chat binding", () => {
  test("binds the first chat a verified update arrives from", () => {
    expect(resolveTelegramChatBinding({
      storedChatId: null,
      trusted: true,
      chat: { id: -1001234567890, type: "supergroup" },
    })).toEqual({ action: "bind", chatId: "-1001234567890" });
  });

  test("never rebinds a project that already has a chat", () => {
    expect(resolveTelegramChatBinding({
      storedChatId: "-1001234567890",
      trusted: true,
      chat: { id: -100999, type: "supergroup" },
    })).toEqual({ action: "skip" });
  });

  test("refuses to bind from an unverified update", () => {
    // Without the webhook secret the update could come from anyone, and a
    // forged bind would point every notification at the forger's chat.
    expect(resolveTelegramChatBinding({
      storedChatId: null,
      trusted: false,
      chat: { id: -100999, type: "supergroup" },
    })).toEqual({ action: "skip" });
  });

  test("skips updates that carry no usable chat id", () => {
    for (
      const chat of [
        undefined,
        null,
        {},
        { id: Number.NaN, type: "group" },
        { id: "-100999" as unknown as number, type: "group" },
      ]
    ) {
      expect(resolveTelegramChatBinding({
        storedChatId: null,
        trusted: true,
        chat: chat as { id?: number; type?: string } | null | undefined,
      })).toEqual({ action: "skip" });
    }
  });
});
