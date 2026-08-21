import { describe, expect, test } from "bun:test";
import { isBotNameLocked, ProjectService } from "./project-service";
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

describe("bot name lock", () => {
  test("locks a stored name and leaves an empty name writable", () => {
    expect(isBotNameLocked("Maven")).toBe(true);
    expect(isBotNameLocked("  Luna  ")).toBe(true);
    expect(isBotNameLocked("")).toBe(false);
    expect(isBotNameLocked(null)).toBe(false);
  });

  test("updateSettings drops a botName change after the first set", async () => {
    let written: Record<string, unknown> | null = null;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ botName: "Maven" }],
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          written = values;
          return { where: async () => undefined };
        },
      }),
    };

    await new ProjectService(db as never).updateSettings("project-1", {
      botName: "Luna",
      agentName: "an engineer",
    });

    expect(written).toEqual({ agentName: "an engineer" });
  });

  test("updateSettings keeps the first botName write", async () => {
    let written: Record<string, unknown> | null = null;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ botName: null }],
          }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          written = values;
          return { where: async () => undefined };
        },
      }),
    };

    await new ProjectService(db as never).updateSettings("project-1", {
      botName: "Maven",
    });

    expect(written).toEqual({ botName: "Maven" });
  });
});

describe("project deletion", () => {
  test("keeps ownership verification inside ProjectService", async () => {
    const deletedProjects: string[] = [];
    const db = {
      delete: () => ({
        where: async () => {
          deletedProjects.push("project-1");
        },
      }),
    };
    const service = new ProjectService(db as never);
    service.getProjectById = async () => ({
      id: "project-1",
      userId: "owner-1",
    } as never);

    await expect(service.deleteProject("project-1", "owner-2")).resolves.toBe(false);
    expect(deletedProjects).toEqual([]);
  });
});
