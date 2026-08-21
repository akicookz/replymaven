import { describe, expect, test } from "bun:test";
import { looksLikeAgentBotNameCommand } from "./bot-name-command";

describe("looksLikeAgentBotNameCommand", () => {
  test("matches a bare @BotName mention", () => {
    expect(looksLikeAgentBotNameCommand("@Maven", "Maven")).toBe(true);
    expect(looksLikeAgentBotNameCommand("@Maven this is yours", "Maven")).toBe(
      true,
    );
    expect(looksLikeAgentBotNameCommand("@Maven, take this", "Maven")).toBe(
      true,
    );
  });

  test("ignores ordinary replies and a missing bot name", () => {
    expect(looksLikeAgentBotNameCommand("Hi Maven", "Maven")).toBe(false);
    expect(looksLikeAgentBotNameCommand("@Luna", "Maven")).toBe(false);
    expect(looksLikeAgentBotNameCommand("@Maven", null)).toBe(false);
  });
});
