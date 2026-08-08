import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm/utils";
import { getTableConfig } from "drizzle-orm/sqlite-core/utils";
import { tools } from "./schema";

describe("Maven HTTP tool audience persistence", () => {
  test("stores authoritative audiences, access mode, and schema fingerprints", () => {
    const columns = getTableColumns(tools);
    const indexes = getTableConfig(tools).indexes;

    expect(columns.allowedChannels.name).toBe("allowed_channels");
    expect(columns.allowedChannels.default).toBe('["public"]');
    expect(columns.access.name).toBe("access");
    expect(columns.access.default).toBe("read");
    expect(columns.schemaFingerprint.name).toBe("schema_fingerprint");
    expect(columns.schemaFingerprint.default).toBe("legacy-v1");
    const projectEnabledIndex = indexes.find(
      (index) => index.config.name === "idx_tools_project_enabled",
    );

    expect(projectEnabledIndex?.config.columns.map((column) => column.name)).toEqual([
      "project_id",
      "enabled",
    ]);
  });
});
