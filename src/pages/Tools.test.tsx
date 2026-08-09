import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { JSDOM } from "jsdom";
import { ToolsPanel } from "./Tools";

interface RenderResult {
  dom: JSDOM;
  root: Root;
  queryClient: QueryClient;
  requests: CapturedRequest[];
}

interface CapturedRequest {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

const rendered: RenderResult[] = [];

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForText(dom: JSDOM, text: string): Promise<HTMLElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
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
  throw new Error(
    `Could not find ${text}. Body: ${dom.window.document.body.textContent}`,
  );
}

async function waitForRequest(
  requests: CapturedRequest[],
  method: string,
): Promise<CapturedRequest> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const request = requests.find((candidate) => candidate.method === method);
    if (request) {
      await act(flush);
      return request;
    }
    await act(flush);
  }
  throw new Error(`Could not find a ${method} request`);
}

function findPresetExpander(dom: JSDOM, label: string): HTMLButtonElement | null {
  const labelNode = Array.from(
    dom.window.document.querySelectorAll<HTMLElement>("*"),
  ).find(
    (node) =>
      node.children.length === 0 && node.textContent?.trim() === label,
  );
  return labelNode?.closest<HTMLButtonElement>('button[aria-expanded]') ?? null;
}

async function expandPreset(dom: JSDOM, label: string): Promise<void> {
  const title = await waitForText(dom, label);
  const expander = title.closest("button") ?? title.parentElement?.parentElement?.parentElement;
  await act(async () => expander?.click());
}

async function setFieldValue(
  dom: JSDOM,
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const prototype =
    field instanceof dom.window.HTMLTextAreaElement
      ? dom.window.HTMLTextAreaElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  await act(async () => {
    field.focus();
    setter?.call(field, value);
    const propertyChange = new dom.window.Event("propertychange", {
      bubbles: true,
    });
    Object.defineProperty(propertyChange, "propertyName", { value: "value" });
    field.dispatchEvent(propertyChange);
    await flush();
  });
}

function makePresetTool(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: "preset-1",
    name: "send_to_slack",
    displayName: "Send to Slack",
    description: "Post to Slack.",
    endpoint: "https://hooks.slack.com/services/test",
    method: "POST",
    headers: null,
    parameters: [],
    responseMapping: null,
    enabled: true,
    timeout: 10000,
    sortOrder: 0,
    allowedChannels: ["public"],
    access: "read",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    ...overrides,
  };
}

async function renderTools(tools: Record<string, unknown>[] = []): Promise<RenderResult> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/app/projects/project-1/actions-tools",
  });
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
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const requests: CapturedRequest[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    if (method !== "GET") requests.push({ url, method, body });
    if (method === "GET" && url.endsWith("/tools")) {
      return Response.json(tools);
    }
    if (method === "PATCH" && url.includes("/tools/")) {
      return Response.json({ ok: true });
    }
    if (url.endsWith("/telegram")) {
      return Response.json({ telegramBotToken: null, telegramChatId: null });
    }
    return Response.json({ error: "Unexpected request" }, { status: 500 });
  }) as typeof fetch;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToolsPanel projectId="project-1" embedded />
      </QueryClientProvider>,
    );
    await flush();
  });
  const result = { dom, root, queryClient, requests };
  rendered.push(result);
  return result;
}

afterEach(async () => {
  for (const result of rendered.splice(0)) {
    await act(async () => result.root.unmount());
    result.queryClient.clear();
    result.dom.window.close();
  }
});

describe("Tools HTTP policy controls", () => {
  test("new custom tools start visitor-only/read and keep one audience enabled", async () => {
    const { dom } = await renderTools();
    const addTool = await waitForText(dom, "Add Tool");
    await act(async () => {
      addTool.click();
    });

    expect(dom.window.document.body.textContent).toContain("Available to visitors");
    expect(dom.window.document.body.textContent).toContain("Available in sidechat");
    expect(dom.window.document.body.textContent).toContain(
      "Maven can use this while helping your team.",
    );
    expect(dom.window.document.body.textContent).toContain(
      "At least one audience must stay enabled.",
    );

    const publicSwitch = dom.window.document.querySelector<HTMLElement>(
      '[aria-label="Available to visitors"]',
    );
    const sidechatSwitch = dom.window.document.querySelector<HTMLElement>(
      '[aria-label="Available in sidechat"]',
    );
    expect(publicSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(publicSwitch?.hasAttribute("disabled")).toBe(true);
    expect(sidechatSwitch?.getAttribute("aria-checked")).toBe("false");

    const endpoint = dom.window.document.querySelector<HTMLInputElement>(
      'input[placeholder="https://api.example.com/orders/status"]',
    );
    expect(endpoint?.parentElement?.classList.contains("flex-wrap")).toBe(true);
    expect(endpoint?.classList.contains("w-full")).toBe(true);

    await act(async () => sidechatSwitch?.click());
    expect(sidechatSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(publicSwitch?.hasAttribute("disabled")).toBe(false);
    await act(async () => publicSwitch?.click());
    expect(publicSwitch?.getAttribute("aria-checked")).toBe("false");
  });

  test("expanded presets expose the same policy and preserve configured values", async () => {
    const presetTool = makePresetTool({
      allowedChannels: ["public", "sidechat"],
      access: "write",
    });
    const { dom } = await renderTools([presetTool]);
    await expandPreset(dom, "Send to Slack");

    const sidechatSwitch = dom.window.document.querySelector<HTMLElement>(
      '[aria-label="Available in sidechat"]',
    );
    expect(sidechatSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(dom.window.document.body.textContent).toContain(
      "Choose whether this tool only reads data or can change it.",
    );
    expect(dom.window.document.body.textContent).toContain("Write");
  });

  test("configured and unconfigured presets use focusable native expander buttons", async () => {
    const configuredLookup = makePresetTool({
      name: "check_order_status",
      displayName: "Check Order Status",
      description: "Look up an order.",
      endpoint: "https://api.example.com/orders",
      method: "GET",
    });
    const { dom } = await renderTools([configuredLookup]);

    await waitForText(dom, "HTTP Lookup");
    const configured = findPresetExpander(dom, "HTTP Lookup");
    expect(configured).not.toBeNull();
    expect(configured?.getAttribute("aria-expanded")).toBe("false");
    configured?.focus();
    expect(dom.window.document.activeElement).toBe(configured);
    await act(async () => configured?.click());
    expect(configured?.getAttribute("aria-expanded")).toBe("true");
    expect(
      dom.window.document.getElementById(
        configured?.getAttribute("aria-controls") ?? "missing",
      )?.textContent,
    ).toContain("Available in sidechat");

    const unconfigured = findPresetExpander(dom, "Create GitHub Issue");
    expect(unconfigured).not.toBeNull();
    unconfigured?.focus();
    expect(dom.window.document.activeElement).toBe(unconfigured);
    await act(async () => unconfigured?.click());
    expect(unconfigured?.getAttribute("aria-expanded")).toBe("true");
  });

  test.each([
    {
      label: "HTTP Lookup",
      tool: makePresetTool({
        name: "check_order_status",
        displayName: "Check Order Status",
        description: "Look up an order.",
        endpoint: "https://api.example.com/orders",
        method: "GET",
        headers: {
          Authorization: "••••••••",
          "X-API-Key": "••••••••",
        },
      }),
    },
    {
      label: "Create GitHub Issue",
      tool: makePresetTool({
        name: "create_github_issue",
        displayName: "Create GitHub Issue",
        description: "Create a GitHub issue.",
        endpoint: "https://api.github.com/repos/acme/app/issues",
        headers: {
          Authorization: "••••••••",
          Accept: "••••••••",
          "User-Agent": "••••••••",
        },
      }),
    },
  ])(
    "$label policy-only save omits masked headers",
    async ({ label, tool }) => {
      const { dom, requests } = await renderTools([tool]);
      await expandPreset(dom, label);
      const sidechatSwitch = dom.window.document.querySelector<HTMLElement>(
        '[aria-label="Available in sidechat"]',
      );
      await act(async () => sidechatSwitch?.click());
      const update = await waitForText(dom, "Update");
      await act(async () => update.click());

      const request = await waitForRequest(requests, "PATCH");
      expect(request.body).toMatchObject({
        allowedChannels: ["public", "sidechat"],
      });
      expect(request.body).not.toHaveProperty("headers");
    },
  );

  test("configured HTTP Lookup keeps masked headers out of the editable field", async () => {
    const lookup = makePresetTool({
      name: "check_order_status",
      displayName: "Check Order Status",
      description: "Look up an order.",
      endpoint: "https://api.example.com/orders",
      method: "GET",
      headers: {
        Authorization: "••••••••",
        "X-API-Key": "••••••••",
      },
    });
    const { dom } = await renderTools([lookup]);
    await expandPreset(dom, "HTTP Lookup");
    const headers = dom.window.document.querySelector<HTMLTextAreaElement>(
      "textarea",
    );

    expect(headers?.value).toBe("");
    expect(headers?.placeholder).toBe("Leave blank to keep the current headers");
  });

  test("configured preset credentials can still be explicitly replaced", async () => {
    const lookup = makePresetTool({
      name: "check_order_status",
      displayName: "Check Order Status",
      description: "Look up an order.",
      endpoint: "https://api.example.com/orders",
      method: "GET",
      headers: { Authorization: "••••••••" },
    });
    const { dom, requests } = await renderTools([lookup]);
    await expandPreset(dom, "HTTP Lookup");
    const headers = dom.window.document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Leave blank to keep the current headers"]',
    );
    expect(headers).not.toBeNull();
    await setFieldValue(dom, headers!, "Authorization: Bearer replacement");
    expect(headers?.value).toBe("Authorization: Bearer replacement");
    const update = await waitForText(dom, "Update");
    await act(async () => update.click());

    const request = await waitForRequest(requests, "PATCH");
    expect(request.body).toMatchObject({
      headers: { Authorization: "Bearer replacement" },
    });
  });

  test("configured GitHub credentials can still be explicitly replaced", async () => {
    const github = makePresetTool({
      name: "create_github_issue",
      displayName: "Create GitHub Issue",
      description: "Create a GitHub issue.",
      endpoint: "https://api.github.com/repos/acme/app/issues",
      headers: {
        Authorization: "••••••••",
        Accept: "••••••••",
        "User-Agent": "••••••••",
      },
    });
    const { dom, requests } = await renderTools([github]);
    await expandPreset(dom, "Create GitHub Issue");
    const token = dom.window.document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(token).not.toBeNull();
    await setFieldValue(dom, token!, "github_pat_replacement");
    const update = await waitForText(dom, "Update");
    await act(async () => update.click());

    const request = await waitForRequest(requests, "PATCH");
    expect(request.body).toMatchObject({
      headers: {
        Authorization: "Bearer github_pat_replacement",
        Accept: "application/vnd.github+json",
        "User-Agent": "ReplyMaven-Bot",
      },
    });
  });
});
