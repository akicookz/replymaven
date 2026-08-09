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

async function renderTools(tools: Record<string, unknown>[] = []): Promise<RenderResult> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/app/projects/project-1/actions-tools",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    Event: dom.window.Event,
    CustomEvent: dom.window.CustomEvent,
    getComputedStyle: dom.window.getComputedStyle,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/tools")) return Response.json(tools);
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
  const result = { dom, root, queryClient };
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
    const presetTool = {
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
      allowedChannels: ["public", "sidechat"],
      access: "write",
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    };
    const { dom } = await renderTools([presetTool]);
    const title = await waitForText(dom, "Send to Slack");
    const row = title.parentElement?.parentElement?.parentElement;
    await act(async () => row?.click());

    const sidechatSwitch = dom.window.document.querySelector<HTMLElement>(
      '[aria-label="Available in sidechat"]',
    );
    expect(sidechatSwitch?.getAttribute("aria-checked")).toBe("true");
    expect(dom.window.document.body.textContent).toContain(
      "Choose whether this tool only reads data or can change it.",
    );
    expect(dom.window.document.body.textContent).toContain("Write");
  });
});
