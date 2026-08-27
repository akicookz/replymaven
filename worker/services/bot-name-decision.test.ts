import { describe, expect, test } from "bun:test";
import {
  clearHumanCommandClock,
  confirmBotNameDecision,
  mergePublicMetadata,
  parseBotNameDecision,
  preserveReservedPublicMetadata,
  readTelegramCommandClaim,
  resolveBanReason,
  telegramCommandClaimPatch,
} from "./bot-name-decision";

describe("parseBotNameDecision", () => {
  test("accepts a complete valid object and ignores unknown keys", () => {
    expect(parseBotNameDecision({
      ownership: "ai",
      instructions: "set",
      speak: "now",
      effect: "none",
      reason: null,
      extra: true,
    })).toEqual({
      ownership: "ai",
      instructions: "set",
      speak: "now",
      effect: "none",
      investigate: "none",
      email: "none",
      reason: null,
    });
  });

  test("rejects missing fields and unknown enums", () => {
    expect(parseBotNameDecision({
      ownership: "ai",
      instructions: "set",
      speak: "now",
    })).toBeNull();
    expect(parseBotNameDecision({
      ownership: "bot",
      instructions: "set",
      speak: "silent",
      effect: "none",
      reason: null,
    })).toBeNull();
    expect(parseBotNameDecision("take over")).toBeNull();
  });

  test("treats a missing email key as none", () => {
    expect(parseBotNameDecision({
      ownership: "human",
      instructions: "keep",
      speak: "silent",
      effect: "none",
      reason: null,
    })?.email).toBe("none");
  });

  test("rejects an invalid email value", () => {
    expect(parseBotNameDecision({
      ownership: "human",
      instructions: "keep",
      speak: "silent",
      effect: "none",
      email: "maybe",
      reason: null,
    })).toBeNull();
  });

  test("treats a missing investigate key as none", () => {
    expect(parseBotNameDecision({
      ownership: "human",
      instructions: "set",
      speak: "silent",
      effect: "none",
      reason: null,
    })?.investigate).toBe("none");
  });

  test("rejects an invalid investigate value", () => {
    expect(parseBotNameDecision({
      ownership: "human",
      instructions: "set",
      speak: "silent",
      effect: "none",
      investigate: "maybe",
      reason: null,
    })).toBeNull();
  });

  test("keeps a blank ban reason for the worker to fill from raw text", () => {
    expect(parseBotNameDecision({
      ownership: "human",
      instructions: "keep",
      speak: "silent",
      effect: "ban",
      reason: "  ",
    })).toEqual({
      ownership: "human",
      instructions: "keep",
      speak: "silent",
      effect: "ban",
      investigate: "none",
      email: "none",
      reason: null,
    });
  });
});

describe("resolveBanReason", () => {
  test("uses the model reason when present, otherwise the raw agent text", () => {
    expect(resolveBanReason("spam", "ban them")).toBe("spam");
    expect(resolveBanReason(null, "ban them")).toBe("ban them");
  });
});

describe("confirmBotNameDecision", () => {
  test("names the applied outcome", () => {
    expect(confirmBotNameDecision({
      effect: "close",
    })).toBe("Conversation closed.");
    expect(confirmBotNameDecision({
      effect: "ban",
      reason: "spam",
    })).toBe("Visitor banned and conversation closed. Reason: spam");
    expect(confirmBotNameDecision({
      effect: "none",
      spoke: true,
    })).toBe("Bot responded.");
    expect(confirmBotNameDecision({
      effect: "none",
      handedToAi: true,
      spoke: false,
    })).toBe("Bot resumed.");
    expect(confirmBotNameDecision({
      effect: "none",
      handedToAi: false,
      storedInstructions: true,
      spoke: false,
    })).toBe("Instructions saved.");
    expect(confirmBotNameDecision({
      effect: "none",
      handedToAi: false,
      storedInstructions: false,
      spoke: false,
    })).toBe("Bot stayed quiet.");
    expect(confirmBotNameDecision({
      effect: "none",
      investigated: true,
    })).toBe("Maven is looking into that.");
    expect(confirmBotNameDecision({
      effect: "none",
      investigateBusy: true,
    })).toBe("Maven is already working on this.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailed: true,
    })).toBe("Emailed to visitor.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailReason: "no_visitor_email",
    })).toBe("No visitor email address.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailReason: "no_reply",
    })).toBe("No agent reply to email.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailReason: "already_emailed",
    })).toBe("That reply was already emailed.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailReason: "conflict",
    })).toBe("Conversation changed. Try again.");
    expect(confirmBotNameDecision({
      effect: "none",
      emailReason: "failed",
    })).toBe("Could not send the email.");
  });
});

describe("mergePublicMetadata", () => {
  test("patches instruction and activity keys without dropping others", () => {
    expect(mergePublicMetadata(
      { timezone: "Asia/Seoul", agentHandbackInstructions: "old" },
      { agentHandbackInstructions: "new", lastHumanCommandAt: 9 },
    )).toEqual({
      timezone: "Asia/Seoul",
      agentHandbackInstructions: "new",
      lastHumanCommandAt: 9,
    });
  });
});

describe("preserveReservedPublicMetadata", () => {
  test("keeps omitted command keys from the current record", () => {
    expect(preserveReservedPublicMetadata(
      { device: "iphone" },
      {
        timezone: "UTC",
        agentHandbackInstructions: "stay quiet",
        lastHumanCommandAt: 40,
        lastTelegramCommandId: "telegram:1",
        lastTelegramCommandConfirm: "Bot resumed.",
        lastSidechatTurnOrigin: "telegram",
      },
    )).toEqual({
      device: "iphone",
      agentHandbackInstructions: "stay quiet",
      lastHumanCommandAt: 40,
      lastTelegramCommandId: "telegram:1",
      lastTelegramCommandConfirm: "Bot resumed.",
      lastSidechatTurnOrigin: "telegram",
    });
  });

  test("lets an explicit reserved key overwrite the stored value", () => {
    expect(preserveReservedPublicMetadata(
      { agentHandbackInstructions: null },
      { agentHandbackInstructions: "stay quiet", lastHumanCommandAt: 40 },
    )).toEqual({
      agentHandbackInstructions: null,
      lastHumanCommandAt: 40,
    });
  });
});

describe("clearHumanCommandClock", () => {
  test("drops lastHumanCommandAt and leaves other keys", () => {
    expect(clearHumanCommandClock({
      timezone: "UTC",
      lastHumanCommandAt: 40,
    })).toEqual({ timezone: "UTC" });
  });
});

describe("telegram command claim", () => {
  test("returns the stored confirmation for the same command id", () => {
    expect(readTelegramCommandClaim({
      lastTelegramCommandId: "telegram:9",
      lastTelegramCommandConfirm: "Bot resumed.",
    }, "telegram:9")).toBe("Bot resumed.");
    expect(readTelegramCommandClaim({
      lastTelegramCommandId: "telegram:8",
    }, "telegram:9")).toBeNull();
  });

  test("writes the claim keys for a later retry", () => {
    expect(telegramCommandClaimPatch("telegram:9", "Bot resumed.")).toEqual({
      lastTelegramCommandId: "telegram:9",
      lastTelegramCommandConfirm: "Bot resumed.",
    });
  });
});
