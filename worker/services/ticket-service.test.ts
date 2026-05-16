import { describe, expect, test } from "bun:test";
import { parseTicketData, buildTicketTitle } from "./ticket-service";

describe("parseTicketData", () => {
  test("parses a valid JSON object with string values", () => {
    const raw = JSON.stringify({ name: "Alice", email: "alice@example.com" });
    expect(parseTicketData(raw)).toEqual({
      name: "Alice",
      email: "alice@example.com",
    });
  });

  test("returns empty object for malformed JSON", () => {
    expect(parseTicketData("{not valid json")).toEqual({});
  });

  test("returns empty object for empty string", () => {
    expect(parseTicketData("")).toEqual({});
  });

  test("returns empty object when JSON is an array", () => {
    expect(parseTicketData(JSON.stringify(["a", "b"]))).toEqual({});
  });

  test("returns empty object when JSON is null", () => {
    expect(parseTicketData("null")).toEqual({});
  });

  test("returns empty object when JSON is a primitive", () => {
    expect(parseTicketData('"just a string"')).toEqual({});
    expect(parseTicketData("42")).toEqual({});
  });

  test("coerces non-string values to strings", () => {
    const raw = JSON.stringify({
      name: "Bob",
      age: 30,
      active: true,
    });
    expect(parseTicketData(raw)).toEqual({
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
    expect(parseTicketData(raw)).toEqual({
      name: "Carol",
    });
  });

  test("handles empty object", () => {
    expect(parseTicketData("{}")).toEqual({});
  });

  test("coerces nested objects via String() conversion", () => {
    const raw = JSON.stringify({
      name: "Dave",
      meta: { nested: "value" },
    });
    const result = parseTicketData(raw);
    expect(result.name).toBe("Dave");
    expect(typeof result.meta).toBe("string");
  });
});

describe("createTicket append-mode merge semantics", () => {
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

    const merged = { ...parseTicketData(existingRaw), ...newData };

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

    const merged = { ...parseTicketData(existingRaw), ...newData };

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

    const merged = { ...parseTicketData(existingRaw), ...newData };

    expect(merged).toEqual({
      name: "Heidi",
    });
  });
});

describe("buildTicketTitle", () => {
  test("name + email returns 'name <email>'", () => {
    expect(
      buildTicketTitle({ visitorName: "Ivy", visitorEmail: "ivy@x.com" }),
    ).toBe("Ivy <ivy@x.com>");
  });

  test("name only", () => {
    expect(buildTicketTitle({ visitorName: "Jack" })).toBe("Jack");
  });

  test("email only", () => {
    expect(buildTicketTitle({ visitorEmail: "kim@x.com" })).toBe("kim@x.com");
  });

  test("visitorId fallback", () => {
    expect(buildTicketTitle({ visitorId: "abc123" })).toBe("Visitor abc123");
  });

  test("no info → default 'Ticket'", () => {
    expect(buildTicketTitle({})).toBe("Ticket");
  });
});
