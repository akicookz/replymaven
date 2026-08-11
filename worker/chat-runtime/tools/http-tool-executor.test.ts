import { afterEach, describe, expect, mock, test } from "bun:test";
import type { SupportToolDefinition } from "../types";
import { executeHttpTool, executeHttpToolRequest } from "./http-tool-executor";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function definition(overrides: Partial<SupportToolDefinition> = {}): SupportToolDefinition {
  return {
    name: "lookup",
    displayName: "Lookup",
    description: "Look up a record",
    endpoint: "https://api.example.com/lookup",
    method: "POST",
    headers: null,
    parameters: "[]",
    responseMapping: null,
    enabled: true,
    timeout: 10_000,
    ...overrides,
  };
}

describe("executeHttpToolRequest", () => {
  test("preserves the public executeHttpTool result shape", async () => {
    globalThis.fetch = mock(async () =>
      Response.json({ account: { id: "account-1" } }, { status: 201 }));
    const tool = definition();

    const lowLevel = await executeHttpToolRequest(
      { tool, params: { accountId: "account-1" } },
      {},
    );
    const legacy = await executeHttpTool(tool, { accountId: "account-1" });

    expect(lowLevel).toEqual(legacy);
    expect(lowLevel).toEqual({
      success: true,
      httpStatus: 201,
      data: { account: { id: "account-1" } },
    });
  });

  test("propagates caller abort to the outbound fetch", async () => {
    let receivedSignal: AbortSignal | undefined;
    globalThis.fetch = mock(async (_input, init) => {
      receivedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    const controller = new AbortController();
    const execution = executeHttpToolRequest(
      { tool: definition(), params: {} },
      { abortSignal: controller.signal },
    );
    await Promise.resolve();
    controller.abort();

    expect(await execution).toEqual({ error: "Tool execution cancelled by caller" });
    expect(receivedSignal?.aborted).toBe(true);
  });

  test("rejects non-HTTP and private IPv6 endpoints before fetch", async () => {
    const fetchMock = mock(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchMock;

    expect(await executeHttpToolRequest(
      { tool: definition({ endpoint: "file:///etc/passwd" }), params: {} },
      {},
    )).toMatchObject({ error: expect.stringContaining("not allowed") });
    expect(await executeHttpToolRequest(
      { tool: definition({ endpoint: "http://[fd00::1]/secret" }), params: {} },
      {},
    )).toMatchObject({ error: expect.stringContaining("not allowed") });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("bounds response bytes before returning text", async () => {
    let cancelCount = 0;
    const encoder = new TextEncoder();
    globalThis.fetch = mock(async () =>
      new Response(new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(encoder.encode("x".repeat(20_000)));
        },
        cancel() {
          cancelCount += 1;
        },
      }), { status: 200 }));

    const output = await executeHttpToolRequest(
      { tool: definition(), params: {} },
      {},
    ) as { data: string };

    expect(output.data.length).toBeLessThanOrEqual(10_240 + 30);
    expect(output.data).toEndWith("...(response truncated)");
    expect(cancelCount).toBe(1);
  });

  test("times out a hanging fetch with the existing safe error", async () => {
    globalThis.fetch = mock(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        (init?.signal as AbortSignal).addEventListener("abort", () => {
          reject(new DOMException("Timed out", "AbortError"));
        });
      }));

    expect(await executeHttpToolRequest(
      { tool: definition({ timeout: 5 }), params: {} },
      {},
    )).toEqual({ error: "Tool execution timed out after 5ms" });
  });
});
