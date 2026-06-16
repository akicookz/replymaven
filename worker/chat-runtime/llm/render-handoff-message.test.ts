import { describe, expect, test } from "bun:test";
import { type LanguageModel } from "ai";
import {
  fallbackRenderHandoffMessage,
  isRenderedHandoffMessageValid,
  renderHandoffMessage,
} from "./render-handoff-message";
import { type HandoffRenderDirective } from "../types";

const settings = {
  toneOfVoice: "friendly",
  customTonePrompt: null,
  botName: "Maven",
} as const;

describe("fallbackRenderHandoffMessage - byte-identical legacy parity", () => {
  test("collect_contact name + email", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "collect_contact",
        missingFields: ["name", "email"],
        agentLabel: "the team",
      }),
    ).toBe(
      "I can forward this to the team. Before I do, could you share your name and email so they can follow up directly? If you'd rather keep it in chat, just say that.",
    );
  });

  test("collect_contact name only", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "collect_contact",
        missingFields: ["name"],
        agentLabel: "the team",
      }),
    ).toBe(
      "I can forward this to the team. Before I do, could you share your name so they know who to follow up with? If you'd rather keep it in chat, just say that.",
    );
  });

  test("collect_contact email only", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "collect_contact",
        missingFields: ["email"],
        agentLabel: "the team",
      }),
    ).toBe(
      "I can forward this to the team. Before I do, could you share your email so they can follow up directly? If you'd rather keep it in chat, just say that.",
    );
  });

  test("offer_handoff without issue context", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "offer_handoff",
        hasIssueContext: false,
        agentLabel: "the team",
      }),
    ).toBe(
      "Sure — I can help get this to the team. Before I forward it, could you tell me a bit about what you need help with so the team gets the right context?",
    );
  });

  test("offer_handoff with issue context", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "offer_handoff",
        hasIssueContext: true,
        agentLabel: "the team",
      }),
    ).toBe(
      "I can forward this to the team for a deeper look. If you'd like me to do that, reply yes and I'll collect anything still missing before sending it over.",
    );
  });

  test("ticket_created variants", () => {
    expect(
      fallbackRenderHandoffMessage({
        kind: "ticket_created",
        variant: "appended",
        agentLabel: "a team member",
      }),
    ).toBe(
      "I've added those details to your existing request. a team member will follow up shortly!",
    );
    expect(
      fallbackRenderHandoffMessage({
        kind: "ticket_created",
        variant: "created",
        agentLabel: "a team member",
      }),
    ).toBe("I've forwarded this to the team. a team member will follow up shortly!");
    expect(
      fallbackRenderHandoffMessage({
        kind: "ticket_created",
        variant: "already_forwarded",
        agentLabel: "a team member",
      }),
    ).toBe(
      "I've already forwarded this conversation to the team. a team member will continue the follow-up there.",
    );
  });
});

describe("isRenderedHandoffMessageValid - guardrails (language-agnostic)", () => {
  const collectBoth: HandoffRenderDirective = {
    kind: "collect_contact",
    missingFields: ["name", "email"],
    agentLabel: "the team",
  };

  test("accepts a contact request that asks for both fields and offers opt-out", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: true,
          asksForEmail: true,
          offersToStayInChat: true,
          claimsAlreadyForwarded: false,
        },
        collectBoth,
      ),
    ).toBe(true);
  });

  test("rejects when the requested email field is not asked for", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: true,
          asksForEmail: false,
          offersToStayInChat: true,
          claimsAlreadyForwarded: false,
        },
        collectBoth,
      ),
    ).toBe(false);
  });

  test("rejects when the opt-out is not offered", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: true,
          asksForEmail: true,
          offersToStayInChat: false,
          claimsAlreadyForwarded: false,
        },
        collectBoth,
      ),
    ).toBe(false);
  });

  test("rejects a premature 'already forwarded' claim", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: true,
          asksForEmail: true,
          offersToStayInChat: true,
          claimsAlreadyForwarded: true,
        },
        collectBoth,
      ),
    ).toBe(false);
  });

  test("email-only directive does not require asking for a name", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: false,
          asksForEmail: true,
          offersToStayInChat: true,
          claimsAlreadyForwarded: false,
        },
        { kind: "collect_contact", missingFields: ["email"], agentLabel: "the team" },
      ),
    ).toBe(true);
  });

  test("offer_handoff rejects asking for contact details too early", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: false,
          asksForEmail: true,
          offersToStayInChat: false,
          claimsAlreadyForwarded: false,
        },
        { kind: "offer_handoff", hasIssueContext: true, agentLabel: "the team" },
      ),
    ).toBe(false);
  });

  test("offer_handoff accepts an offer that doesn't ask for PII or claim a forward", () => {
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: false,
          asksForEmail: false,
          offersToStayInChat: false,
          claimsAlreadyForwarded: false,
        },
        { kind: "offer_handoff", hasIssueContext: true, agentLabel: "the team" },
      ),
    ).toBe(true);
  });

  test("ticket_created allows the forward claim but rejects re-asking for contact", () => {
    const created: HandoffRenderDirective = {
      kind: "ticket_created",
      variant: "created",
      agentLabel: "a team member",
    };
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: false,
          asksForEmail: false,
          offersToStayInChat: false,
          claimsAlreadyForwarded: true,
        },
        created,
      ),
    ).toBe(true);
    expect(
      isRenderedHandoffMessageValid(
        {
          asksForName: false,
          asksForEmail: true,
          offersToStayInChat: false,
          claimsAlreadyForwarded: true,
        },
        created,
      ),
    ).toBe(false);
  });
});

describe("renderHandoffMessage - model failure handling", () => {
  const directive: HandoffRenderDirective = {
    kind: "collect_contact",
    missingFields: ["name", "email"],
    agentLabel: "the team",
  };
  const unusableModel = {} as unknown as LanguageModel;

  test("falls back to deterministic wording when the model is unusable", async () => {
    const result = await renderHandoffMessage(unusableModel, {
      directive,
      settings,
      conversationHistory: [],
    });
    expect(result).toBe(fallbackRenderHandoffMessage(directive));
  });

  test("throws when throwOnModelError is true and the model fails", async () => {
    let threw = false;
    try {
      await renderHandoffMessage(
        unusableModel,
        { directive, settings, conversationHistory: [] },
        { throwOnModelError: true },
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
