import { describe, expect, test } from "bun:test";
import {
  buildBotResolvedNotificationText,
  buildEscalationNotificationText,
} from "./telegram-service";

describe("Telegram conversation notifications", () => {
  test("puts a visible conversation id in the initial escalation message", () => {
    const text = buildEscalationNotificationText({
      visitorName: "Akbar",
      visitorEmail: "akbar@example.com",
      summary: "Checkout returns error 500",
      conversationUrl: "https://replymaven.com/app/conversations/conv-123",
      conversationId: "conv-123",
      isUpdate: false,
    });

    expect(text).toContain("<b>Conversation:</b> <code>conv-123</code>");
  });

  test("escapes names in the bot-resolved thread update", () => {
    expect(
      buildBotResolvedNotificationText("Maven <AI>", "conv-123"),
    ).toBe(
      "<b>Maven &lt;AI&gt; resolved this before a teammate joined.</b>\n\n<b>Conversation:</b> <code>conv-123</code>",
    );
  });
});
