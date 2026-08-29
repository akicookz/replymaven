import { describe, expect, test } from "bun:test";
import type { JSONSchema7 } from "json-schema";
import {
  buildProjectToolArgumentFields,
  normalizeProjectToolInputSchema,
  validateProjectToolInput,
} from "./project-tool-schema";

function schema(): JSONSchema7 {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    type: "object",
    additionalProperties: false,
    required: ["customer", "mode"],
    properties: {
      customer: { $ref: "#/$defs/customer" },
      mode: {
        oneOf: [
          { const: "lookup" },
          { const: "update" },
        ],
      },
      tags: {
        type: "array",
        items: { type: "string", enum: ["vip", "trial"] },
      },
    },
    $defs: {
      customer: {
        allOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id"],
            properties: {
              id: { type: "string" },
              tier: {
                anyOf: [
                  { type: "integer", enum: [1, 2] },
                  { type: "null" },
                ],
              },
            },
          },
        ],
      },
    },
  };
}

describe("project tool schema boundary", () => {
  test("normalizes one schema for both validation and argument guidance", () => {
    const normalized = normalizeProjectToolInputSchema(schema());
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error("Expected a normalized schema");

    expect(validateProjectToolInput(normalized.schema, {
      customer: { id: "cus_1", tier: 2 },
      mode: "update",
      tags: ["vip"],
    })).toEqual({
      ok: true,
      value: {
        customer: { id: "cus_1", tier: 2 },
        mode: "update",
        tags: ["vip"],
      },
    });

    expect(buildProjectToolArgumentFields(normalized.schema)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "customer.id",
          required: true,
          types: ["string"],
        }),
        expect.objectContaining({
          path: "customer.tier",
          types: ["integer", "null"],
          allowedValues: ["1", "2"],
        }),
        expect.objectContaining({
          path: "mode",
          required: true,
          allowedValues: ['"lookup"', '"update"'],
        }),
        expect.objectContaining({
          path: "tags[]",
          types: ["string"],
          allowedValues: ['"vip"', '"trial"'],
        }),
      ]),
    );
  });

  test("rejects nested required, enum, and extra-property failures safely", () => {
    const normalized = normalizeProjectToolInputSchema(schema());
    if (!normalized.ok) throw new Error("Expected a normalized schema");

    for (const value of [
      { customer: {}, mode: "lookup" },
      { customer: { id: "cus_1", tier: 9 }, mode: "lookup" },
      { customer: { id: "cus_1", secret: "must-not-leak" }, mode: "lookup" },
      { customer: { id: "cus_1" }, mode: "delete" },
    ]) {
      const result = validateProjectToolInput(normalized.schema, value);
      expect(result).toEqual({
        ok: false,
        errorCode: "invalid_tool_input",
      });
      expect(JSON.stringify(result)).not.toContain("must-not-leak");
      expect(JSON.stringify(result)).not.toContain("cus_1");
    }
  });

  test("rejects unsafe or unsupported schema graphs", () => {
    const cyclic: JSONSchema7 = {
      type: "object",
      properties: {
        node: { $ref: "#/$defs/node" },
      },
      $defs: {
        node: {
          type: "object",
          properties: {
            child: { $ref: "#/$defs/node" },
          },
        },
      },
    };

    for (const unsafe of [
      { $schema: "https://json-schema.org/draft/2020-12/schema" },
      { $ref: "https://schemas.example.com/customer.json" },
      cyclic,
      {
        type: "object",
        description: "x".repeat(100_000),
      },
    ] satisfies JSONSchema7[]) {
      expect(normalizeProjectToolInputSchema(unsafe)).toEqual({
        ok: false,
        errorCode: "invalid_tool_schema",
      });
    }
  });
});
