import { describe, expect, test } from "bun:test";

const LEGACY_ALLOWLIST = new Set([
  "worker/db/schema.ts",
  "worker/db/index.ts",
  "worker/conversations/legacy-conversation-reader.ts",
  "worker/conversations/legacy-conversation-store-fixture.ts",
  "worker/migrations/conversation-runtime-backfill.ts",
]);

function isProductionSource(path: string): boolean {
  return (
    (path.startsWith("worker/") || path.startsWith("shared/")) &&
    path.endsWith(".ts") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".integration.test.ts") &&
    !path.includes("/db/drizzle/") &&
    !path.endsWith("worker-configuration.d.ts")
  );
}

function importsLegacyConversationSymbol(source: string): boolean {
  const imports = source.matchAll(/import\s*{([\s\S]*?)}\s*from\s*["'][^"']*["'];?/g);
  for (const match of imports) {
    const names = match[1]
      .split(",")
      .map((name) => name.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0]);
    if (
      names.some((name) =>
        ["conversations", "messages", "ConversationRow", "MessageRow"].includes(
          name,
        ),
      )
    ) {
      return true;
    }
  }
  return false;
}

function findViolation(source: string): string | null {
  if (/new\s+ChatService\s*\(/.test(source)) return "new ChatService(";
  if (importsLegacyConversationSymbol(source)) {
    return "legacy conversation/message symbol import";
  }
  return null;
}

describe("public conversation storage boundary", () => {
  test("keeps legacy D1 access behind the adapter", async () => {
    const glob = new Bun.Glob("{worker,shared}/**/*.ts");
    const violations: string[] = [];

    for await (const path of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
      if (!isProductionSource(path) || LEGACY_ALLOWLIST.has(path)) continue;
      const source = await Bun.file(path).text();
      const violation = findViolation(source);
      if (violation) violations.push(`${path}: ${violation}`);
    }

    expect(violations.sort()).toEqual([]);
  });
});
