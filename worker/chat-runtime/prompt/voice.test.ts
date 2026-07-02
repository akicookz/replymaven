import { describe, expect, test } from "bun:test";
import { buildVoiceContract, resolveToneInstruction } from "./voice";

const settings = {
  toneOfVoice: "friendly",
  customTonePrompt: null,
  botName: "Ava",
};

describe("buildVoiceContract", () => {
  test("frames the bot as company staff speaking as 'we'", () => {
    const contract = buildVoiceContract(settings, "Acme");
    expect(contract).toContain("You are Ava and you work at Acme");
    expect(contract).toContain('say "we", "us", and "our"');
    expect(contract).toContain("third person");
  });

  test("bans essay register", () => {
    const contract = buildVoiceContract(settings, "Acme");
    expect(contract).toContain("live chat");
    expect(contract).toContain("em dashes");
    expect(contract).toContain("Match the visitor's language");
  });

  test("anchors register between hospitality script and curtness", () => {
    const contract = buildVoiceContract(settings, "Acme");
    expect(contract).toContain("no service-counter script");
    expect(contract).toContain("How can we help you today?");
    expect(contract).toContain("no curtness");
    expect(contract).toContain("What can I help you with?");
  });

  test("includes the configured tone", () => {
    expect(buildVoiceContract(settings, "Acme")).toContain(
      resolveToneInstruction(settings),
    );
  });

  test("omits the name sentence when no bot name is configured", () => {
    const contract = buildVoiceContract(
      { ...settings, botName: null },
      "Acme",
    );
    expect(contract).toContain("You work at Acme.");
    expect(contract).not.toContain("You are  and");
  });
});
