import { describe, expect, test } from "bun:test";
import type { ToolRow } from "../db";
import {
  handleCreateToolRequest,
  handleListToolsRequest,
  handleUpdateToolRequest,
  type ToolRouteService,
} from "./tool-handlers";

type ToolCreateInput = Parameters<ToolRouteService["createTool"]>[0];
type ToolUpdateInput = Parameters<ToolRouteService["updateTool"]>[2];

const createdAt = new Date("2026-08-09T00:00:00.000Z");

function makeTool(overrides: Partial<ToolRow> = {}): ToolRow {
  return {
    id: "tool-1",
    projectId: "project-1",
    name: "existing_tool",
    displayName: "Existing tool",
    description: "Original description.",
    endpoint: "https://api.example.com/original",
    method: "POST",
    headers: null,
    parameters: "[]",
    responseMapping: null,
    enabled: true,
    timeout: 10000,
    sortOrder: 0,
    allowedChannels: '["public"]',
    access: "read",
    schemaFingerprint:
      "6c904d27f4429c6e778af4ef785d02cd65088921abccec2c202771037e5a229d",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

class MemoryToolService implements ToolRouteService {
  tools: ToolRow[];
  createCalls: ToolCreateInput[] = [];
  updateCalls: ToolUpdateInput[] = [];

  constructor(tools: ToolRow[] = []) {
    this.tools = [...tools];
  }

  async getToolCount(projectId: string): Promise<number> {
    return this.tools.filter((tool) => tool.projectId === projectId).length;
  }

  async getToolByName(name: string, projectId: string): Promise<ToolRow | null> {
    return (
      this.tools.find(
        (tool) => tool.projectId === projectId && tool.name === name,
      ) ?? null
    );
  }

  async getToolById(id: string, projectId: string): Promise<ToolRow | null> {
    return (
      this.tools.find(
        (tool) => tool.projectId === projectId && tool.id === id,
      ) ?? null
    );
  }

  async createTool(input: ToolCreateInput): Promise<ToolRow> {
    this.createCalls.push(input);
    const tool = makeTool({
      ...input,
      id: `tool-${this.tools.length + 1}`,
      allowedChannels: JSON.stringify(input.allowedChannels ?? ["public"]),
      access: input.access ?? "read",
      schemaFingerprint: input.schemaFingerprint ?? "legacy-v1",
    });
    this.tools.push(tool);
    return tool;
  }

  async updateTool(
    id: string,
    projectId: string,
    updates: ToolUpdateInput,
  ): Promise<ToolRow | null> {
    this.updateCalls.push(updates);
    const index = this.tools.findIndex(
      (tool) => tool.id === id && tool.projectId === projectId,
    );
    if (index === -1) return null;
    const current = this.tools[index];
    const updated = makeTool({
      ...current,
      ...updates,
      allowedChannels:
        updates.allowedChannels === undefined
          ? current.allowedChannels
          : JSON.stringify(updates.allowedChannels),
      updatedAt: new Date("2026-08-09T00:01:00.000Z"),
    });
    this.tools[index] = updated;
    return updated;
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const noHeaders = async (): Promise<Record<string, string> | null> => null;
const storeHeaders = async (
  headers: Record<string, string>,
): Promise<string> => JSON.stringify(headers);

describe("tool route boundary", () => {
  test("lists parsed policy and fails closed per malformed legacy row", async () => {
    const response = await handleListToolsRequest({
      tools: [
        makeTool({
          id: "valid",
          allowedChannels: '["public","sidechat"]',
          access: "write",
        }),
        makeTool({ id: "malformed", allowedChannels: "not-json" }),
      ],
      maskStoredHeaders: noHeaders,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "valid",
        allowedChannels: ["public", "sidechat"],
        access: "write",
        parameters: [],
      }),
      expect.objectContaining({
        id: "malformed",
        allowedChannels: [],
        access: "read",
      }),
    ]);
  });

  test.each([
    ["owner", ["public"], "read"],
    ["owner", ["sidechat"], "write"],
    ["admin", ["public", "sidechat"], "read"],
    ["admin", ["public", "sidechat"], "write"],
  ] as const)(
    "%s can create a tool with %j and %s access",
    async (role, allowedChannels, access) => {
      const service = new MemoryToolService();
      const response = await handleCreateToolRequest({
        projectId: "project-1",
        role,
        body: {
          name: "lookup_order",
          displayName: "Look up order",
          description: "Look up order.",
          endpoint: "https://api.example.com/orders",
          allowedChannels,
          access,
        },
        toolService: service,
        encryptHeaders: storeHeaders,
        maskStoredHeaders: noHeaders,
      });

      expect(response.status).toBe(201);
      expect(await readJson(response)).toMatchObject({
        allowedChannels: [...allowedChannels],
        access,
        schemaFingerprint:
          "1955b3922d0660d466108ccba398884dc1862487d0233dd1f4d6e00873a38b7f",
      });
      expect(service.createCalls).toHaveLength(1);
      expect(service.createCalls[0]).toMatchObject({
        allowedChannels: [...allowedChannels],
        access,
        schemaFingerprint:
          "1955b3922d0660d466108ccba398884dc1862487d0233dd1f4d6e00873a38b7f",
      });
    },
  );

  test("member creation keeps public/read defaults but rejects explicit policy", async () => {
    const service = new MemoryToolService();
    const base = {
      name: "lookup_order",
      displayName: "Look up order",
      description: "Look up order.",
      endpoint: "https://api.example.com/orders",
    };
    const defaultResponse = await handleCreateToolRequest({
      projectId: "project-1",
      role: "member",
      body: base,
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const forbiddenResponse = await handleCreateToolRequest({
      projectId: "project-1",
      role: "member",
      body: {
        ...base,
        name: "member_sidechat",
        allowedChannels: ["public", "sidechat"],
        access: "write",
      },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const explicitDefaults = await handleCreateToolRequest({
      projectId: "project-1",
      role: "member",
      body: {
        ...base,
        name: "member_default_tool",
        allowedChannels: ["public"],
        access: "read",
      },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(defaultResponse.status).toBe(201);
    expect(await readJson(defaultResponse)).toMatchObject({
      allowedChannels: ["public"],
      access: "read",
    });
    expect(forbiddenResponse.status).toBe(403);
    expect(explicitDefaults.status).toBe(201);
    expect(service.createCalls).toHaveLength(2);
  });

  test.each([
    { label: "empty", value: [] },
    { label: "duplicate", value: ["public", "public"] },
    { label: "unknown", value: ["unknown"] },
    { label: "non-array", value: "not-an-array" },
  ])("rejects $label audience before storage", async ({ value }) => {
    const service = new MemoryToolService();
    const response = await handleCreateToolRequest({
      projectId: "project-1",
      role: "owner",
      body: {
        name: "lookup_order",
        displayName: "Look up order",
        description: "Look up order.",
        endpoint: "https://api.example.com/orders",
        allowedChannels: value,
      },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(response.status).toBe(400);
    expect(service.createCalls).toHaveLength(0);
  });

  test.each([
    { label: "empty", value: [] },
    { label: "duplicate", value: ["sidechat", "sidechat"] },
    { label: "unknown", value: ["internal"] },
    { label: "non-array", value: { public: true } },
  ])("rejects $label audience before an update", async ({ value }) => {
    const original = makeTool();
    const service = new MemoryToolService([original]);
    const response = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "owner",
      body: { allowedChannels: value },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(response.status).toBe(400);
    expect(service.updateCalls).toHaveLength(0);
  });

  test("owner and admin can update audience/access while member policy is preserved", async () => {
    const original = makeTool();
    const ownerService = new MemoryToolService([original]);
    const owner = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "owner",
      body: { allowedChannels: ["sidechat"], access: "write" },
      toolService: ownerService,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const admin = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "admin",
      body: { allowedChannels: ["public", "sidechat"], access: "read" },
      toolService: ownerService,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const member = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "member",
      body: { displayName: "Member-renamed tool" },
      toolService: ownerService,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const memberWithUnchangedPolicy = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "member",
      body: {
        displayName: "Member-renamed again",
        allowedChannels: ["public", "sidechat"],
        access: "read",
      },
      toolService: ownerService,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const forbidden = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "member",
      body: { allowedChannels: ["public"], access: "read" },
      toolService: ownerService,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(await readJson(owner)).toMatchObject({
      allowedChannels: ["sidechat"],
      access: "write",
    });
    expect(await readJson(admin)).toMatchObject({
      allowedChannels: ["public", "sidechat"],
      access: "read",
    });
    expect(await readJson(member)).toMatchObject({
      displayName: "Member-renamed tool",
      allowedChannels: ["public", "sidechat"],
      access: "read",
    });
    expect(memberWithUnchangedPolicy.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(ownerService.updateCalls).toHaveLength(4);
    expect(ownerService.updateCalls[2]).not.toHaveProperty("allowedChannels");
    expect(ownerService.updateCalls[2]).not.toHaveProperty("access");
    expect(ownerService.updateCalls[3]).not.toHaveProperty("allowedChannels");
    expect(ownerService.updateCalls[3]).not.toHaveProperty("access");
  });

  test.each([
    {
      label: "HTTP Lookup",
      tool: makeTool({
        name: "check_order_status",
        headers: "encrypted-lookup-credentials",
      }),
      stored: "encrypted-lookup-credentials",
    },
    {
      label: "GitHub preset",
      tool: makeTool({
        name: "create_github_issue",
        headers: "encrypted-github-credentials",
      }),
      stored: "encrypted-github-credentials",
    },
  ])(
    "$label policy-only PATCH preserves authoritative credentials without encryption",
    async ({ tool, stored }) => {
      const service = new MemoryToolService([tool]);
      let encryptionCalls = 0;
      const response = await handleUpdateToolRequest({
        projectId: "project-1",
        toolId: tool.id,
        role: "owner",
        body: {
          allowedChannels: ["public", "sidechat"],
          access: "write",
        },
        toolService: service,
        encryptHeaders: async () => {
          encryptionCalls += 1;
          return "unexpected";
        },
        maskStoredHeaders: async (headers) =>
          headers ? { Authorization: "••••••••" } : null,
      });

      expect(response.status).toBe(200);
      expect(encryptionCalls).toBe(0);
      expect(service.updateCalls[0]).not.toHaveProperty("headers");
      expect(service.tools[0]?.headers).toBe(stored);
      expect(await readJson(response)).toMatchObject({
        headers: { Authorization: "••••••••" },
      });
    },
  );

  test("an explicit credential replacement is encrypted and persisted", async () => {
    const original = makeTool({ headers: "encrypted-original" });
    const service = new MemoryToolService([original]);
    const encryptedInputs: Record<string, string>[] = [];
    const response = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "owner",
      body: { headers: { Authorization: "Bearer replacement" } },
      toolService: service,
      encryptHeaders: async (headers) => {
        encryptedInputs.push(headers);
        return "encrypted-replacement";
      },
      maskStoredHeaders: async (headers) =>
        headers ? { Authorization: "••••••••" } : null,
    });

    expect(response.status).toBe(200);
    expect(encryptedInputs).toEqual([
      { Authorization: "Bearer replacement" },
    ]);
    expect(service.updateCalls[0]).toMatchObject({
      headers: "encrypted-replacement",
    });
    expect(service.tools[0]?.headers).toBe("encrypted-replacement");
  });

  test("recomputes fingerprints only for model-facing contract changes", async () => {
    const original = makeTool();
    const service = new MemoryToolService([original]);
    const endpointOnly = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "owner",
      body: {
        endpoint: "https://api.example.com/new",
        timeout: 20000,
        enabled: false,
        allowedChannels: ["public", "sidechat"],
        access: "write",
      },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });
    const description = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: original.id,
      role: "owner",
      body: { description: "Changed description." },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(await readJson(endpointOnly)).toMatchObject({
      schemaFingerprint: original.schemaFingerprint,
    });
    expect(await readJson(description)).toMatchObject({
      schemaFingerprint:
        "07308eb782c7d2e1a1dbfdb3428e6ad4f7859656591701bd1343b2fb068baa85",
    });
    expect(service.updateCalls[0]).not.toHaveProperty("schemaFingerprint");
    expect(service.updateCalls[1]).toMatchObject({
      schemaFingerprint:
        "07308eb782c7d2e1a1dbfdb3428e6ad4f7859656591701bd1343b2fb068baa85",
    });
  });

  test.each([
    {
      label: "custom tool",
      tool: makeTool({
        schemaFingerprint: "legacy-v1",
        parameters: JSON.stringify([
          {
            name: "order_id",
            type: "string",
            description: "Order ID",
            required: true,
          },
        ]),
      }),
      body: {
        displayName: "Existing tool",
        description: "Original description.",
        endpoint: "https://api.example.com/original",
        method: "POST",
        headers: null,
        parameters: [
          {
            required: true,
            description: "Order ID",
            type: "string",
            name: "order_id",
          },
        ],
        responseMapping: null,
        enabled: true,
        timeout: 10000,
        allowedChannels: ["public"],
        access: "read",
      },
    },
    {
      label: "preset tool",
      tool: makeTool({
        name: "create_github_issue",
        displayName: "Create GitHub Issue",
        description: "Create a GitHub issue.",
        endpoint: "https://api.github.com/repos/acme/app/issues",
        schemaFingerprint: "legacy-v1",
        parameters: JSON.stringify([
          {
            name: "title",
            type: "string",
            description: "Issue title",
            required: true,
          },
        ]),
      }),
      body: {
        displayName: "Create GitHub Issue",
        description: "Create a GitHub issue.",
        endpoint: "https://api.github.com/repos/acme/app/issues",
        method: "POST",
        parameters: [
          {
            name: "title",
            description: "Issue title",
            required: true,
            type: "string",
          },
        ],
        responseMapping: null,
        enabled: true,
        timeout: 10000,
        allowedChannels: ["public", "sidechat"],
        access: "write",
      },
    },
  ] as const)(
    "preserves a $label fingerprint when a full PATCH repeats its authoritative contract",
    async ({ tool, body }) => {
      const service = new MemoryToolService([tool]);
      const response = await handleUpdateToolRequest({
        projectId: "project-1",
        toolId: tool.id,
        role: "owner",
        body,
        toolService: service,
        encryptHeaders: storeHeaders,
        maskStoredHeaders: noHeaders,
      });

      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        schemaFingerprint: "legacy-v1",
      });
      expect(service.updateCalls[0]).not.toHaveProperty("schemaFingerprint");
    },
  );

  test("parameter changes replace the canonical fingerprint", async () => {
    const service = new MemoryToolService([
      makeTool({
        name: "lookup_order",
        description: "Look up current order.",
      }),
    ]);
    const response = await handleUpdateToolRequest({
      projectId: "project-1",
      toolId: "tool-1",
      role: "owner",
      body: {
        parameters: [
          {
            name: "order_id",
            type: "string",
            description: "Order ID",
            required: true,
          },
        ],
      },
      toolService: service,
      encryptHeaders: storeHeaders,
      maskStoredHeaders: noHeaders,
    });

    expect(await readJson(response)).toMatchObject({
      schemaFingerprint:
        "768fc226a8697296f55bc29925c4150acb09f8c966e472269589e4a6a154cfcd",
    });
  });
});
