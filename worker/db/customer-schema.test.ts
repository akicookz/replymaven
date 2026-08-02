import { describe, expect, test } from "bun:test";
import {
  getTableConfig,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import * as dbSchema from "./schema";

function getConfig(exportName: string) {
  const table = (dbSchema as Record<string, SQLiteTable | undefined>)[
    exportName
  ];
  expect(table).toBeDefined();
  if (!table) return null;
  return getTableConfig(table);
}

describe("customer database schema", () => {
  test("exports customers and narrow visitor continuity mappings", () => {
    const customerConfig = getConfig("customers");
    const visitorConfig = getConfig("customerVisitors");
    const moduleExports = dbSchema as Record<string, unknown>;

    expect(customerConfig?.columns.map((column) => column.name)).toEqual([
      "id",
      "project_id",
      "external_id",
      "name",
      "email",
      "phone",
      "custom_fields",
      "first_seen_at",
      "last_seen_at",
      "created_at",
      "updated_at",
    ]);
    expect(visitorConfig?.columns.map((column) => column.name)).toEqual([
      "id",
      "project_id",
      "customer_id",
      "visitor_id",
      "linked_by",
      "created_at",
    ]);
    expect(moduleExports.customerIdentities).toBeUndefined();
    expect(moduleExports.customerInteractions).toBeUndefined();
    expect(moduleExports.customerMemory).toBeUndefined();
  });

  test("enforces direct customer and visitor uniqueness within a project", () => {
    const customerConfig = getConfig("customers");
    const visitorConfig = getConfig("customerVisitors");

    expect(customerConfig?.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "idx_customers_project_external_id",
        "idx_customers_project_email",
      ]),
    );
    expect(
      visitorConfig?.indexes.find(
        (index) => index.config.name === "idx_customer_visitors_project_visitor",
      )?.config.unique,
    ).toBe(true);
    expect(visitorConfig?.indexes.map((index) => index.config.name)).toContain(
      "idx_customer_visitors_customer",
    );
  });

  test("adds an encrypted project secret and nullable conversation customer link", () => {
    const settingsConfig = getTableConfig(dbSchema.projectSettings);
    const conversationConfig = getTableConfig(dbSchema.conversations);

    expect(settingsConfig.columns.map((column) => column.name)).toContain(
      "customer_identity_secret",
    );
    expect(conversationConfig.columns.map((column) => column.name)).toContain(
      "customer_id",
    );
    expect(conversationConfig.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "idx_conversations_project_customer",
        "idx_conversations_project_customer_activity",
      ]),
    );
  });
});
