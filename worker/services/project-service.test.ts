import { describe, expect, test } from "bun:test";
import { ProjectService } from "./project-service";
import { RESERVED_INBOUND_LOCAL_PARTS } from "./email-service";
import { decrypt } from "./encryption-service";

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

describe("customer identity secret rotation", () => {
  test("stores only encrypted random material and returns plaintext once", async () => {
    let stored: Record<string, unknown> | null = null;
    const db = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          stored = values;
          return { where: async () => undefined };
        },
      }),
    };
    const encryptionKey = "22".repeat(32);

    const result = await new ProjectService(db as never).rotateCustomerIdentitySecret(
      "project-1",
      encryptionKey,
    );
    const encryptedSecret = stored?.customerIdentitySecret;

    expect(result.configured).toBe(true);
    expect(result.secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(encryptedSecret).toBeString();
    expect(encryptedSecret).not.toBe(result.secret);
    expect(await decrypt(String(encryptedSecret), encryptionKey)).toBe(
      result.secret,
    );
    expect(Object.keys(stored ?? {})).toEqual(["customerIdentitySecret"]);
  });
});
