import { describe, expect, test } from "bun:test";
import { ProjectService } from "./project-service";
import { RESERVED_INBOUND_LOCAL_PARTS } from "./email-service";

function serviceWithExistingSlugs(existing: Set<string>): ProjectService {
  const service = new ProjectService({} as never);
  service.getProjectBySlugPublic = async (slug: string) =>
    existing.has(slug) ? ({ slug } as never) : null;
  return service;
}

describe("generateUniqueSlug", () => {
  test.each([...RESERVED_INBOUND_LOCAL_PARTS])(
    "never assigns the reserved platform alias %s",
    async (reserved) => {
      expect(await serviceWithExistingSlugs(new Set()).generateUniqueSlug("u1", reserved))
        .toBe(`${reserved}-2`);
    },
  );

  test("suffixes past both reserved words and existing rows", async () => {
    const service = serviceWithExistingSlugs(new Set(["support-2", "support-3"]));
    expect(await service.generateUniqueSlug("u1", "support")).toBe("support-4");
  });
});
