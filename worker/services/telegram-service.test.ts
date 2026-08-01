import { describe, expect, test } from "bun:test";
import { buildBotResolvedNotificationText } from "./telegram-service";

describe("Telegram conversation notifications", () => {
  test("escapes names in the bot-resolved thread update", () => {
    expect(buildBotResolvedNotificationText("Maven <AI>", "conv-123")).toContain(
      "Maven &lt;AI&gt;",
    );
  });
});
