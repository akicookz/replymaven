import { describe, expect, test } from "bun:test";
import { ProjectService } from "./project-service";
import { RESERVED_INBOUND_LOCAL_PARTS } from "./email-service";

// generateUniqueSlug's DB lookups go through getProjectBySlugPublic, so a
// per-instance stub lets us exercise the reserved-word and collision logic
// without a real D1 binding.
function serviceWithExistingSlugs(existing: Set<string>): ProjectService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = new ProjectService({} as any);
  svc.getProjectBySlugPublic = async (slug: string) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    existing.has(slug) ? ({ slug } as any) : null;
  return svc;
}

describe("generateUniqueSlug", () => {
  test("passes through a free, unreserved slug", async () => {
    const svc = serviceWithExistingSlugs(new Set());
    expect(await svc.generateUniqueSlug("u1", "acme")).toBe("acme");
  });

  test.each([...RESERVED_INBOUND_LOCAL_PARTS])(
    "never assigns the reserved platform alias %s",
    async (reserved) => {
      const svc = serviceWithExistingSlugs(new Set());
      const slug = await svc.generateUniqueSlug("u1", reserved);
      expect(slug).not.toBe(reserved);
      expect(slug).toBe(`${reserved}-2`);
    },
  );

  test("suffixes past both reserved words and existing rows", async () => {
    const svc = serviceWithExistingSlugs(new Set(["support-2", "support-3"]));
    expect(await svc.generateUniqueSlug("u1", "support")).toBe("support-4");
  });

  test("still de-dupes ordinary collisions", async () => {
    const svc = serviceWithExistingSlugs(new Set(["acme"]));
    expect(await svc.generateUniqueSlug("u1", "acme")).toBe("acme-2");
  });
});
