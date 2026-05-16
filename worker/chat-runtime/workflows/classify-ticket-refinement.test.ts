import { describe, expect, test } from "bun:test";
import {
  classifyTicketRefinement,
  type TicketFieldSpec,
} from "./classify-ticket-refinement";

const DEFAULT_FIELDS: TicketFieldSpec[] = [
  { label: "Name", type: "text", required: true },
  { label: "Email", type: "email", required: true },
  { label: "Phone", type: "tel", required: false },
  { label: "Topic", type: "textarea", required: false },
];

describe("classifyTicketRefinement", () => {
  test("returns no refinement when no existing ticket", () => {
    const decision = classifyTicketRefinement({
      message: "my email is alice@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: false,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("no_existing_ticket");
  });

  test("returns no refinement for empty message", () => {
    const decision = classifyTicketRefinement({
      message: "   ",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Name: "Alice" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("empty_message");
  });

  test("detects email refinement", () => {
    const decision = classifyTicketRefinement({
      message: "my email is alice@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Name: "Alice" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("email");
    expect(decision.extracted.Email).toBe("alice@example.com");
  });

  test("skips email refinement when value matches existing", () => {
    const decision = classifyTicketRefinement({
      message: "alice@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Email: "alice@example.com" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("detects phone refinement with international format", () => {
    const decision = classifyTicketRefinement({
      message: "you can reach me at +1 555 123 4567",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("phone");
    expect(decision.extracted.Phone).toBeDefined();
  });

  test("detects phone refinement with dashes", () => {
    const decision = classifyTicketRefinement({
      message: "555-123-4567",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("phone");
  });

  test("ignores too-short numeric sequences as phone", () => {
    const decision = classifyTicketRefinement({
      message: "I have 5 items",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Topic: "shipping question" },
      hasExistingTicket: true,
    });
    expect(decision.signals).not.toContain("phone");
  });

  test("detects name refinement from 'my name is' pattern", () => {
    const decision = classifyTicketRefinement({
      message: "my name is Bob Smith",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Name).toBe("Bob Smith");
  });

  test("detects name refinement from 'I am' pattern", () => {
    const decision = classifyTicketRefinement({
      message: "I am Carol",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Name).toBe("Carol");
  });

  test("skips name refinement when value matches existing", () => {
    const decision = classifyTicketRefinement({
      message: "my name is Dave",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Name: "Dave" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("detects multiple signals in one message", () => {
    const decision = classifyTicketRefinement({
      message: "I'm Eve and my email is eve@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("email");
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Email).toBe("eve@example.com");
    expect(decision.extracted.Name).toBe("Eve");
  });

  test("detects freeform topic when no structured signal and long enough", () => {
    const decision = classifyTicketRefinement({
      message: "I need help with a broken widget on my pricing page",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Name: "Frank", Email: "frank@example.com" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("freeform");
    expect(decision.extracted.Topic).toBeDefined();
  });

  test("does not detect freeform for short messages", () => {
    const decision = classifyTicketRefinement({
      message: "ok",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Name: "Frank" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("skips freeform when no topic-like field exists", () => {
    const fields: TicketFieldSpec[] = [
      { label: "Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
    ];
    const decision = classifyTicketRefinement({
      message: "this is a longer sentence with several words",
      ticketFields: fields,
      existingData: { Name: "Grace", Email: "grace@example.com" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("matches custom field labels via fuzzy label matching", () => {
    const fields: TicketFieldSpec[] = [
      { label: "Full Name", type: "text", required: true },
      { label: "Work Email", type: "email", required: true },
      { label: "Mobile Number", type: "tel", required: false },
    ];
    const decision = classifyTicketRefinement({
      message: "my email is heidi@example.com and my number is +44 20 7946 0958",
      ticketFields: fields,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.extracted["Work Email"]).toBe("heidi@example.com");
    expect(decision.extracted["Mobile Number"]).toBeDefined();
  });

  test("falls back to 'email' field key when no email-like label exists", () => {
    const fields: TicketFieldSpec[] = [
      { label: "Name", type: "text", required: true },
    ];
    const decision = classifyTicketRefinement({
      message: "ivan@example.com",
      ticketFields: fields,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.extracted.email).toBe("ivan@example.com");
  });

  test("returns no refinement when all values already present and match", () => {
    const decision = classifyTicketRefinement({
      message: "jane@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: { Email: "jane@example.com" },
      hasExistingTicket: true,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("no_refinement_signal_detected");
  });

  test("reason string encodes detected signals", () => {
    const decision = classifyTicketRefinement({
      message: "my name is Kate, email kate@example.com",
      ticketFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingTicket: true,
    });
    expect(decision.reason).toContain("refinement_detected");
    expect(decision.reason).toContain("email");
    expect(decision.reason).toContain("name");
  });
});
