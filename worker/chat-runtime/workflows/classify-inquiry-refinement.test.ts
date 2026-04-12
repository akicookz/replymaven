import { describe, expect, test } from "bun:test";
import {
  classifyInquiryRefinement,
  type InquiryFieldSpec,
} from "./classify-inquiry-refinement";

const DEFAULT_FIELDS: InquiryFieldSpec[] = [
  { label: "Name", type: "text", required: true },
  { label: "Email", type: "email", required: true },
  { label: "Phone", type: "tel", required: false },
  { label: "Topic", type: "textarea", required: false },
];

describe("classifyInquiryRefinement", () => {
  test("returns no refinement when no existing inquiry", () => {
    const decision = classifyInquiryRefinement({
      message: "my email is alice@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: false,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("no_existing_inquiry");
  });

  test("returns no refinement for empty message", () => {
    const decision = classifyInquiryRefinement({
      message: "   ",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Name: "Alice" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("empty_message");
  });

  test("detects email refinement", () => {
    const decision = classifyInquiryRefinement({
      message: "my email is alice@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Name: "Alice" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("email");
    expect(decision.extracted.Email).toBe("alice@example.com");
  });

  test("skips email refinement when value matches existing", () => {
    const decision = classifyInquiryRefinement({
      message: "alice@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Email: "alice@example.com" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("detects phone refinement with international format", () => {
    const decision = classifyInquiryRefinement({
      message: "you can reach me at +1 555 123 4567",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("phone");
    expect(decision.extracted.Phone).toBeDefined();
  });

  test("detects phone refinement with dashes", () => {
    const decision = classifyInquiryRefinement({
      message: "555-123-4567",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("phone");
  });

  test("ignores too-short numeric sequences as phone", () => {
    const decision = classifyInquiryRefinement({
      message: "I have 5 items",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Topic: "shipping question" },
      hasExistingInquiry: true,
    });
    expect(decision.signals).not.toContain("phone");
  });

  test("detects name refinement from 'my name is' pattern", () => {
    const decision = classifyInquiryRefinement({
      message: "my name is Bob Smith",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Name).toBe("Bob Smith");
  });

  test("detects name refinement from 'I am' pattern", () => {
    const decision = classifyInquiryRefinement({
      message: "I am Carol",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Name).toBe("Carol");
  });

  test("skips name refinement when value matches existing", () => {
    const decision = classifyInquiryRefinement({
      message: "my name is Dave",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Name: "Dave" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("detects multiple signals in one message", () => {
    const decision = classifyInquiryRefinement({
      message: "I'm Eve and my email is eve@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("email");
    expect(decision.signals).toContain("name");
    expect(decision.extracted.Email).toBe("eve@example.com");
    expect(decision.extracted.Name).toBe("Eve");
  });

  test("detects freeform topic when no structured signal and long enough", () => {
    const decision = classifyInquiryRefinement({
      message: "I need help with a broken widget on my pricing page",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Name: "Frank", Email: "frank@example.com" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.signals).toContain("freeform");
    expect(decision.extracted.Topic).toBeDefined();
  });

  test("does not detect freeform for short messages", () => {
    const decision = classifyInquiryRefinement({
      message: "ok",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Name: "Frank" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("skips freeform when no topic-like field exists", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
    ];
    const decision = classifyInquiryRefinement({
      message: "this is a longer sentence with several words",
      inquiryFields: fields,
      existingData: { Name: "Grace", Email: "grace@example.com" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
  });

  test("matches custom field labels via fuzzy label matching", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Full Name", type: "text", required: true },
      { label: "Work Email", type: "email", required: true },
      { label: "Mobile Number", type: "tel", required: false },
    ];
    const decision = classifyInquiryRefinement({
      message: "my email is heidi@example.com and my number is +44 20 7946 0958",
      inquiryFields: fields,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.extracted["Work Email"]).toBe("heidi@example.com");
    expect(decision.extracted["Mobile Number"]).toBeDefined();
  });

  test("falls back to 'email' field key when no email-like label exists", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Name", type: "text", required: true },
    ];
    const decision = classifyInquiryRefinement({
      message: "ivan@example.com",
      inquiryFields: fields,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(true);
    expect(decision.extracted.email).toBe("ivan@example.com");
  });

  test("returns no refinement when all values already present and match", () => {
    const decision = classifyInquiryRefinement({
      message: "jane@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: { Email: "jane@example.com" },
      hasExistingInquiry: true,
    });
    expect(decision.isRefinement).toBe(false);
    expect(decision.reason).toBe("no_refinement_signal_detected");
  });

  test("reason string encodes detected signals", () => {
    const decision = classifyInquiryRefinement({
      message: "my name is Kate, email kate@example.com",
      inquiryFields: DEFAULT_FIELDS,
      existingData: {},
      hasExistingInquiry: true,
    });
    expect(decision.reason).toContain("refinement_detected");
    expect(decision.reason).toContain("email");
    expect(decision.reason).toContain("name");
  });
});
