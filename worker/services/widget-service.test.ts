import { describe, expect, test } from "bun:test";
import { parseInquiryData } from "./widget-service";

describe("parseInquiryData", () => {
  test("parses a valid JSON object with string values", () => {
    const raw = JSON.stringify({ name: "Alice", email: "alice@example.com" });
    expect(parseInquiryData(raw)).toEqual({
      name: "Alice",
      email: "alice@example.com",
    });
  });

  test("returns empty object for malformed JSON", () => {
    expect(parseInquiryData("{not valid json")).toEqual({});
  });

  test("returns empty object for empty string", () => {
    expect(parseInquiryData("")).toEqual({});
  });

  test("returns empty object when JSON is an array", () => {
    expect(parseInquiryData(JSON.stringify(["a", "b"]))).toEqual({});
  });

  test("returns empty object when JSON is null", () => {
    expect(parseInquiryData("null")).toEqual({});
  });

  test("returns empty object when JSON is a primitive", () => {
    expect(parseInquiryData('"just a string"')).toEqual({});
    expect(parseInquiryData("42")).toEqual({});
  });

  test("coerces non-string values to strings", () => {
    const raw = JSON.stringify({
      name: "Bob",
      age: 30,
      active: true,
    });
    expect(parseInquiryData(raw)).toEqual({
      name: "Bob",
      age: "30",
      active: "true",
    });
  });

  test("skips null and undefined values", () => {
    const raw = JSON.stringify({
      name: "Carol",
      email: null,
    });
    expect(parseInquiryData(raw)).toEqual({
      name: "Carol",
    });
  });

  test("handles empty object", () => {
    expect(parseInquiryData("{}")).toEqual({});
  });

  test("coerces nested objects via String() conversion", () => {
    const raw = JSON.stringify({
      name: "Dave",
      meta: { nested: "value" },
    });
    const result = parseInquiryData(raw);
    expect(result.name).toBe("Dave");
    expect(typeof result.meta).toBe("string");
  });
});

describe("createInquiry append-mode merge semantics", () => {
  test("append mode merges existing data with new values overriding", () => {
    const existingRaw = JSON.stringify({
      name: "Eve",
      email: "eve@example.com",
      phone: "555-1234",
    });
    const newData = {
      email: "eve+new@example.com",
      company: "Acme Corp",
    };

    const merged = { ...parseInquiryData(existingRaw), ...newData };

    expect(merged).toEqual({
      name: "Eve",
      email: "eve+new@example.com",
      phone: "555-1234",
      company: "Acme Corp",
    });
  });

  test("non-append mode replaces data wholesale", () => {
    const newData = {
      email: "frank@example.com",
    };

    const replaced = newData;

    expect(replaced).toEqual({
      email: "frank@example.com",
    });
  });

  test("append mode preserves prior fields when new data is empty", () => {
    const existingRaw = JSON.stringify({
      name: "Grace",
      email: "grace@example.com",
    });
    const newData = {};

    const merged = { ...parseInquiryData(existingRaw), ...newData };

    expect(merged).toEqual({
      name: "Grace",
      email: "grace@example.com",
    });
  });

  test("append mode on corrupted existing data falls back to new data only", () => {
    const existingRaw = "{corrupted";
    const newData = {
      name: "Heidi",
    };

    const merged = { ...parseInquiryData(existingRaw), ...newData };

    expect(merged).toEqual({
      name: "Heidi",
    });
  });
});
