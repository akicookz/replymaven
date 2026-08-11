import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import McpConnections from "./McpConnections";

interface CapturedRequest {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

interface Rendered {
  dom: JSDOM;
  root: Root;
  client: QueryClient;
  requests: CapturedRequest[];
}

const rendered: Rendered[] = [];

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForText(dom: JSDOM, text: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const element = Array.from(
      dom.window.document.querySelectorAll<HTMLElement>("*"),
    ).find(
      (node) =>
        node.textContent?.trim() === text &&
        (node.matches("button") || node.children.length === 0),
    );
    if (element) return element;
    await act(flush);
  }
  throw new Error(`Could not find ${text}`);
}

async function setInput(
  dom: JSDOM,
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const prototype = input instanceof dom.window.HTMLTextAreaElement
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    input.focus();
    setter?.call(input, value);
    const propertyChange = new dom.window.Event("propertychange", {
      bubbles: true,
    });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    input.dispatchEvent(propertyChange);
    await flush();
  });
}

async function waitForRequest(
  requests: CapturedRequest[],
  method: string,
): Promise<CapturedRequest> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const request = requests.find((candidate) => candidate.method === method);
    if (request) return request;
    await act(flush);
  }
  throw new Error(`Could not find ${method} request`);
}

const presets = [
  {
    key: "posthog",
    label: "PostHog",
    url: "https://mcp.posthog.com/mcp",
    auth: ["oauth", "bearer"],
    icon: "/integrations/posthog.svg",
  },
  {
    key: "stripe",
    label: "Stripe",
    url: "https://mcp.stripe.com",
    auth: ["oauth", "bearer"],
    icon: "/integrations/stripe.svg",
  },
  {
    key: "slack",
    label: "Slack",
    url: "https://mcp.slack.com/mcp",
    auth: ["bearer"],
    icon: "/integrations/slack.svg",
  },
  {
    key: "attio",
    label: "Attio",
    url: "https://mcp.attio.com/mcp",
    auth: ["oauth"],
    icon: "/integrations/attio.svg",
  },
  {
    key: "linear",
    label: "Linear",
    url: "https://mcp.linear.app/mcp",
    auth: ["oauth", "bearer"],
    icon: "/integrations/linear.svg",
  },
];

function responseData(canManage = true) {
  return {
    canManage,
    presets,
    connections: [
      {
        id: "mcp-example-123",
        name: "Example MCP",
        presetKey: null,
        url: "https://mcp.example.com/",
        authMode: "none",
        state: "ready",
        tools: [
          {
            connectionId: "mcp-example-123",
            toolName: "find_customer",
            exposedName: "tool_mcpexample123_find_customer",
            displayName: "Find customer",
            description: "Find a customer",
            inputSchema: { type: "object" },
            catalogFingerprint: "a".repeat(64),
            audience: "sidechat",
            access: "read",
            enabled: false,
          },
        ],
      },
    ],
  };
}

async function renderConnections(canManage = true): Promise<Rendered> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "https://app.test/app/projects/project-1/quick-actions?tab=tools" },
  );
  const elementPrototype = dom.window.HTMLElement.prototype as typeof dom.window.HTMLElement.prototype & {
    attachEvent?: (name: string, listener: EventListener) => void;
    detachEvent?: (name: string, listener: EventListener) => void;
  };
  elementPrototype.attachEvent = function attachEvent(
    name: string,
    listener: EventListener,
  ): void {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  elementPrototype.detachEvent = function detachEvent(
    name: string,
    listener: EventListener,
  ): void {
    this.removeEventListener(name.replace(/^on/, ""), listener);
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string"
      ? JSON.parse(init.body) as Record<string, unknown>
      : null;
    if (method !== "GET") requests.push({ url, method, body });
    if (method === "GET") return Response.json(responseData(canManage));
    if (method === "POST" && url.endsWith("/connections")) {
      return Response.json(
        {
          connection: {
            id: "mcp-stripe",
            name: "Stripe",
            presetKey: "stripe",
            url: "https://mcp.stripe.com/",
            authMode: "bearer",
            state: "ready",
            tools: [],
          },
        },
        { status: 201 },
      );
    }
    if (method === "PATCH") {
      return Response.json({ connection: responseData().connections[0] });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ error: "Unexpected" }, { status: 500 });
  }) as typeof fetch;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <McpConnections projectId="project-1" />
      </QueryClientProvider>,
    );
    await flush();
  });
  const result = { dom, root, client, requests };
  rendered.push(result);
  return result;
}

afterEach(async () => {
  for (const item of rendered.splice(0)) {
    await act(async () => item.root.unmount());
    item.client.clear();
    item.dom.window.close();
  }
});

describe("native MCP connection settings", () => {
  test("renders five presentation presets and generic discovered tools", async () => {
    const { dom } = await renderConnections();
    await waitForText(dom, "PostHog");

    for (const preset of presets) {
      expect(dom.window.document.body.textContent).toContain(preset.label);
    }
    expect(dom.window.document.body.textContent).toContain("Example MCP");
    const example = await waitForText(dom, "Example MCP");
    await act(async () => example.closest("button")?.click());
    expect(dom.window.document.body.textContent).toContain("Find customer");
    expect(dom.window.document.body.textContent).not.toContain("billing summary");
    expect(dom.window.document.body.textContent).not.toContain("refund payment");
  });

  test("connects a preset with a write-only credential field", async () => {
    const { dom, requests } = await renderConnections();
    const stripe = await waitForText(dom, "Stripe");
    await act(async () => stripe.closest("button")?.click());
    const bearer = await waitForText(dom, "Bearer token");
    await act(async () => bearer.closest("button")?.click());
    const token = dom.window.document.querySelector<HTMLInputElement>(
      'input[aria-label="Stripe bearer token"]',
    );
    if (!token) throw new Error("Missing bearer token input");
    await setInput(dom, token, "rk_live_private");
    expect(token.value).toBe("rk_live_private");
    const connect = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "Connect Stripe");
    if (!connect) throw new Error("Missing Connect Stripe button");
    expect(connect.hasAttribute("disabled")).toBe(false);
    await act(async () => {
      connect.click();
      await flush();
    });

    await waitForRequest(requests, "POST");

    expect(requests).toContainEqual({
      url: "/api/projects/project-1/sidechat/mcp/connections",
      method: "POST",
      body: {
        presetKey: "stripe",
        authMode: "bearer",
        bearerToken: "rk_live_private",
      },
    });
    expect(dom.window.document.body.textContent).not.toContain("rk_live_private");
  });

  test("saves exact disabled-by-default tool policy", async () => {
    const { dom, requests } = await renderConnections();
    const example = await waitForText(dom, "Example MCP");
    await act(async () => example.closest("button")?.click());
    const enable = dom.window.document.querySelector<HTMLElement>(
      '[aria-label="Enable Find customer"]',
    );
    expect(enable?.getAttribute("aria-checked")).toBe("false");
    expect(enable?.className).toContain("after:size-10");
    await act(async () => enable?.click());
    const save = await waitForText(dom, "Save tools");
    await act(async () => {
      save.click();
      await flush();
    });

    expect(requests).toContainEqual({
      url: "/api/projects/project-1/sidechat/mcp/connections/mcp-example-123/tools",
      method: "PATCH",
      body: {
        tools: [
          {
            toolName: "find_customer",
            catalogFingerprint: "a".repeat(64),
            enabled: true,
            access: "read",
          },
        ],
      },
    });
  });

  test("renders project members read-only", async () => {
    const { dom } = await renderConnections(false);
    await waitForText(
      dom,
      "Only project owners and admins can change MCP connections.",
    );
    expect(dom.window.document.body.textContent).toContain(
      "Only project owners and admins can change MCP connections.",
    );
    expect(dom.window.document.querySelector("button[aria-label^='Enable']")).toBeNull();
  });
});
