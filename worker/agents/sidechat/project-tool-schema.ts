import { Validator, type Schema } from "@cfworker/json-schema";
import type { JSONSchema7 } from "json-schema";

const MAX_SCHEMA_CHARS = 64_000;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 2_000;
const MAX_GUIDE_FIELDS = 300;
const MAX_DESCRIPTION = 500;
const MAX_ALLOWED_VALUES = 30;

export type NormalizedProjectToolInputSchema =
  | { ok: true; schema: JSONSchema7 }
  | { ok: false; errorCode: "invalid_tool_schema" };

export type ProjectToolInputValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errorCode: "invalid_tool_input" };

export interface SidechatArgumentField {
  path: string;
  required: boolean;
  types: string[];
  description?: string;
  allowedValues?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveLocalRef(
  root: JSONSchema7,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return null;
  let current: unknown = root;
  for (const encodedSegment of reference.slice(2).split("/")) {
    if (!isRecord(current)) return null;
    const segment = encodedSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    current = current[segment];
  }
  return current;
}

function isSupportedDraft(value: unknown): boolean {
  if (value === undefined) return true;
  return value === "http://json-schema.org/draft-07/schema#" ||
    value === "https://json-schema.org/draft-07/schema#";
}

function validateSchemaGraph(root: JSONSchema7): boolean {
  const activeObjects = new Set<object>();
  let nodes = 0;

  function visit(
    value: unknown,
    depth: number,
    activeRefs: ReadonlySet<string>,
  ): boolean {
    if (depth > MAX_SCHEMA_DEPTH) return false;
    if (value === null || typeof value !== "object") return true;
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES || activeObjects.has(value)) return false;
    activeObjects.add(value);
    try {
      if (Array.isArray(value)) {
        return value.every((item) => visit(item, depth + 1, activeRefs));
      }
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === "string") {
        if (!record.$ref.startsWith("#/") || activeRefs.has(record.$ref)) {
          return false;
        }
        const target = resolveLocalRef(root, record.$ref);
        if (
          target === null ||
          (typeof target !== "boolean" && !isRecord(target))
        ) {
          return false;
        }
        const nextRefs = new Set(activeRefs);
        nextRefs.add(record.$ref);
        if (!visit(target, depth + 1, nextRefs)) return false;
      }
      return Object.entries(record).every(([key, item]) =>
        key === "$ref" || visit(item, depth + 1, activeRefs)
      );
    } finally {
      activeObjects.delete(value);
    }
  }

  return visit(root, 0, new Set());
}

export function normalizeProjectToolInputSchema(
  value: unknown,
): NormalizedProjectToolInputSchema {
  if (!isRecord(value) || !isSupportedDraft(value.$schema)) {
    return { ok: false, errorCode: "invalid_tool_schema" };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, errorCode: "invalid_tool_schema" };
  }
  if (
    serialized.length > MAX_SCHEMA_CHARS ||
    !validateSchemaGraph(value)
  ) {
    return { ok: false, errorCode: "invalid_tool_schema" };
  }
  return {
    ok: true,
    schema: JSON.parse(serialized) as JSONSchema7,
  };
}

export function validateProjectToolInput(
  schema: JSONSchema7,
  input: unknown,
): ProjectToolInputValidation {
  if (!isRecord(input)) {
    return { ok: false, errorCode: "invalid_tool_input" };
  }
  try {
    const validatorSchema: Schema = JSON.parse(JSON.stringify(schema));
    const result = new Validator(validatorSchema, "7").validate(input);
    if (!result.valid) {
      return { ok: false, errorCode: "invalid_tool_input" };
    }
    return { ok: true, value: input };
  } catch {
    return { ok: false, errorCode: "invalid_tool_input" };
  }
}

function alternatives(schema: JSONSchema7): JSONSchema7[] {
  return [schema.allOf, schema.anyOf, schema.oneOf]
    .flatMap((value) => Array.isArray(value) ? value : [])
    .filter((value): value is JSONSchema7 => isRecord(value));
}

function inferredType(value: unknown): string | null {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  const type = typeof value;
  if (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    type === "object"
  ) {
    return type;
  }
  return null;
}

function schemaTypes(schema: JSONSchema7): string[] {
  let values: string[] = [];
  if (Array.isArray(schema.type)) {
    values = schema.type;
  } else if (typeof schema.type === "string") {
    values = [schema.type];
  } else if (schema.const !== undefined) {
    const type = inferredType(schema.const);
    if (type) values = [type];
  }
  for (const alternative of alternatives(schema)) {
    values.push(...schemaTypes(alternative));
  }
  return [...new Set(values)];
}

function schemaAllowedValues(schema: JSONSchema7): string[] | undefined {
  const candidates: unknown[] = [];
  if (Array.isArray(schema.enum)) candidates.push(...schema.enum);
  if (schema.const !== undefined) candidates.push(schema.const);
  for (const alternative of alternatives(schema)) {
    if (Array.isArray(alternative.enum)) candidates.push(...alternative.enum);
    if (alternative.const !== undefined) candidates.push(alternative.const);
  }
  if (candidates.length === 0) return undefined;
  return [...new Set(candidates.map((value) => JSON.stringify(value)))]
    .slice(0, MAX_ALLOWED_VALUES);
}

interface GuideState {
  path: string;
  required: boolean;
  schema: JSONSchema7;
}

function collectFields(
  root: JSONSchema7,
  state: GuideState,
  output: SidechatArgumentField[],
  activeRefs: ReadonlySet<string>,
  depth: number,
): void {
  if (depth > MAX_SCHEMA_DEPTH || output.length >= MAX_GUIDE_FIELDS) return;
  let schema = state.schema;
  let nextRefs = activeRefs;
  if (typeof schema.$ref === "string") {
    const reference = schema.$ref;
    if (activeRefs.has(reference)) return;
    const resolved = resolveLocalRef(root, reference);
    if (!isRecord(resolved)) return;
    schema = resolved as JSONSchema7;
    const resolvedRefs = new Set(activeRefs);
    resolvedRefs.add(reference);
    nextRefs = resolvedRefs;
  }

  if (state.path) {
    const allowedValues = schemaAllowedValues(schema);
    const types = schemaTypes(schema);
    output.push({
      path: state.path,
      required: state.required,
      types: types.length > 0 ? types : ["unknown"],
      ...(typeof schema.description === "string"
        ? { description: schema.description.slice(0, MAX_DESCRIPTION) }
        : {}),
      ...(allowedValues ? { allowedValues } : {}),
    });
  }

  for (const variant of [schema, ...alternatives(schema)]) {
    let resolved = variant;
    if (typeof variant.$ref === "string") {
      const target = resolveLocalRef(root, variant.$ref);
      if (!isRecord(target)) continue;
      resolved = target as JSONSchema7;
    }
    const required = new Set(
      Array.isArray(resolved.required) ? resolved.required : [],
    );
    if (isRecord(resolved.properties)) {
      for (const [name, property] of Object.entries(resolved.properties)) {
        if (!isRecord(property)) continue;
        collectFields(root, {
          path: state.path ? `${state.path}.${name}` : name,
          required: required.has(name),
          schema: property as JSONSchema7,
        }, output, nextRefs, depth + 1);
      }
    }
    if (isRecord(resolved.items) && state.path) {
      collectFields(root, {
        path: `${state.path}[]`,
        required: state.required,
        schema: resolved.items as JSONSchema7,
      }, output, nextRefs, depth + 1);
    }
  }
}

export function buildProjectToolArgumentFields(
  schema: JSONSchema7,
): SidechatArgumentField[] {
  const fields: SidechatArgumentField[] = [];
  collectFields(
    schema,
    { path: "", required: true, schema },
    fields,
    new Set(),
    0,
  );
  return fields;
}
