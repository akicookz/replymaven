import { describe, expect, test } from "bun:test";
import { buildDynamicFormData, parseTelegramThreadId } from "./team-request";
import { type InquiryFieldSpec } from "../types";

describe("buildDynamicFormData", () => {
  test("backwards-compat: no inquiryFields falls back to Name/Email/Message shape", () => {
    const result = buildDynamicFormData({
      inquiryFields: null,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Alice",
      email: "alice@example.com",
      summary: "Need help with pricing",
    });

    expect(result).toEqual({
      Name: "Alice",
      Email: "alice@example.com",
      Message: "Need help with pricing",
    });
  });

  test("backwards-compat: merges existingInquiry and extractedRefinementData on top of fallback shape", () => {
    const result = buildDynamicFormData({
      inquiryFields: [],
      existingInquiry: { Company: "Acme" },
      extractedRefinementData: { Phone: "555-1234" },
      visitorName: "Alice",
      email: "alice@example.com",
      summary: "Need help",
    });

    expect(result).toEqual({
      Name: "Alice",
      Email: "alice@example.com",
      Message: "Need help",
      Company: "Acme",
      Phone: "555-1234",
    });
  });

  test("backwards-compat: formats missing visitor name as 'Not provided'", () => {
    const result = buildDynamicFormData({
      inquiryFields: null,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: null,
      email: "alice@example.com",
      summary: "Hi",
    });

    expect(result.Name).toBe("Not provided");
  });

  test("backwards-compat: trims whitespace-only visitor name to 'Not provided'", () => {
    const result = buildDynamicFormData({
      inquiryFields: null,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "   ",
      email: "alice@example.com",
      summary: "Hi",
    });

    expect(result.Name).toBe("Not provided");
  });

  test("dynamic fields: uses label verbatim and heuristic-maps Name/Email/Message", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
      { label: "Message", type: "textarea", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Bob",
      email: "bob@example.com",
      summary: "Please contact me",
    });

    expect(result).toEqual({
      Name: "Bob",
      Email: "bob@example.com",
      Message: "Please contact me",
    });
  });

  test("dynamic fields: extracted refinement value wins over existing value", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Phone", type: "tel", required: true },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: { Phone: "555-OLD" },
      extractedRefinementData: { Phone: "555-NEW" },
      visitorName: "Bob",
      email: "bob@example.com",
      summary: "Hi",
    });

    expect(result.Phone).toBe("555-NEW");
  });

  test("dynamic fields: existing value wins when no extracted value present", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Company", type: "text", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: { Company: "Acme Corp" },
      extractedRefinementData: {},
      visitorName: "Bob",
      email: "bob@example.com",
      summary: "Hi",
    });

    expect(result.Company).toBe("Acme Corp");
  });

  test("dynamic fields: falls back to 'Not provided' when no data matches", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Project Budget", type: "text", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Bob",
      email: "bob@example.com",
      summary: "Hi",
    });

    expect(result["Project Budget"]).toBe("Not provided");
  });

  test("dynamic fields: heuristic matches 'Full Name' to visitor name", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Full Name", type: "text", required: true },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Charlie",
      email: "c@example.com",
      summary: "Hi",
    });

    expect(result["Full Name"]).toBe("Charlie");
  });

  test("dynamic fields: heuristic matches 'Work Email' to email", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Work Email", type: "email", required: true },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Charlie",
      email: "work@example.com",
      summary: "Hi",
    });

    expect(result["Work Email"]).toBe("work@example.com");
  });

  test("dynamic fields: heuristic matches 'Details' to summary", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Details", type: "textarea", required: true },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Charlie",
      email: "c@example.com",
      summary: "I need a refund",
    });

    expect(result.Details).toBe("I need a refund");
  });

  test("dynamic fields: heuristic matches 'Description' to summary", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Description", type: "textarea", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Charlie",
      email: "c@example.com",
      summary: "Summary text",
    });

    expect(result.Description).toBe("Summary text");
  });

  test("dynamic fields: heuristic matches 'Summary' to summary", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Summary", type: "textarea", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: null,
      extractedRefinementData: null,
      visitorName: "Charlie",
      email: "c@example.com",
      summary: "Summary text",
    });

    expect(result.Summary).toBe("Summary text");
  });

  test("dynamic fields: whitespace-only extracted value is ignored and falls through to existing", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Company", type: "text", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: { Company: "Acme" },
      extractedRefinementData: { Company: "   " },
      visitorName: "Bob",
      email: "bob@example.com",
      summary: "Hi",
    });

    expect(result.Company).toBe("Acme");
  });

  test("dynamic fields: mixed scenario with some matched and some unmatched labels", () => {
    const fields: InquiryFieldSpec[] = [
      { label: "Name", type: "text", required: true },
      { label: "Email", type: "email", required: true },
      { label: "Company", type: "text", required: false },
      { label: "Budget", type: "text", required: false },
    ];

    const result = buildDynamicFormData({
      inquiryFields: fields,
      existingInquiry: { Company: "Acme" },
      extractedRefinementData: { Budget: "$10k" },
      visitorName: "Dave",
      email: "dave@acme.com",
      summary: "Evaluating options",
    });

    expect(result).toEqual({
      Name: "Dave",
      Email: "dave@acme.com",
      Company: "Acme",
      Budget: "$10k",
    });
  });
});

describe("parseTelegramThreadId", () => {
  test("parses a positive numeric string", () => {
    expect(parseTelegramThreadId("12345")).toBe(12345);
  });

  test("trims surrounding whitespace before parsing", () => {
    expect(parseTelegramThreadId("  12345  ")).toBe(12345);
  });

  test("returns undefined for null", () => {
    expect(parseTelegramThreadId(null)).toBeUndefined();
  });

  test("returns undefined for undefined", () => {
    expect(parseTelegramThreadId(undefined)).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseTelegramThreadId("")).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", () => {
    expect(parseTelegramThreadId("   ")).toBeUndefined();
  });

  test("returns undefined for non-numeric string", () => {
    expect(parseTelegramThreadId("abc")).toBeUndefined();
  });

  test("returns undefined for negative number", () => {
    expect(parseTelegramThreadId("-1")).toBeUndefined();
  });

  test("returns undefined for zero", () => {
    expect(parseTelegramThreadId("0")).toBeUndefined();
  });

  test("parses leading-digit strings via parseInt (e.g. '123abc' → 123)", () => {
    expect(parseTelegramThreadId("123abc")).toBe(123);
  });
});
