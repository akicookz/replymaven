import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import type { Conversation, Message } from "@/lib/inbox/types";
import SidechatPane from "./SidechatPane";

interface RenderResult {
  dom: JSDOM;
  root: Root;
}

const rendered: RenderResult[] = [];

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderPane(options?: {
  open?: boolean;
  archived?: boolean;
  messages?: Message[];
  onAddToReply?: (draft: string) => void;
  onClose?: () => void;
}) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/app/projects/project-1/conversations" },
  );
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
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <SidechatPane
          open={options?.open ?? true}
          conversation={makeConversation(options?.archived ?? false)}
          customerFirstName="Ada"
          messages={options?.messages ?? []}
          draft=""
          setDraft={() => undefined}
          onAddToReply={options?.onAddToReply ?? (() => undefined)}
          onClose={options?.onClose ?? (() => undefined)}
        />
      </MemoryRouter>,
    );
    await flush();
  });
  const result = { dom, root };
  rendered.push(result);
  return result;
}

function makeConversation(archived: boolean): Conversation {
  return {
    id: "conversation-1",
    customerId: null,
    visitorId: "visitor-1",
    visitorName: "Ada Lovelace",
    visitorEmail: "ada@example.com",
    status: "active",
    closeReason: null,
    metadata: null,
    visitorLastSeenAt: null,
    visitorPresence: null,
    visitorLastOnlineAt: null,
    archivedAt: archived ? "2026-08-09T01:00:00.000Z" : null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

afterEach(async () => {
  for (const result of rendered.splice(0)) {
    await act(async () => result.root.unmount());
    result.dom.window.close();
  }
});

describe("SidechatPane layout", () => {
  test("uses one shared thread and composer inside the exact responsive pane", async () => {
    const { dom } = await renderPane();
    const pane = dom.window.document.querySelector<HTMLElement>(
      "[data-sidechat-pane]",
    );
    expect(pane).not.toBeNull();
    expect(pane?.classList.contains("w-full")).toBe(true);
    expect(pane?.classList.contains("md:w-[min(380px,42vw)]")).toBe(true);
    expect(pane?.classList.contains("min-[1536px]:w-[400px]")).toBe(true);
    expect(pane?.className).toContain("transition-[width,opacity,transform]");
    expect(pane?.className).toContain("duration-200");
    expect(pane?.className).toContain("motion-reduce:transition-none");
    expect(pane?.className).not.toContain("transition-all");

    expect(dom.window.document.querySelectorAll("[data-chat-thread]")).toHaveLength(1);
    expect(dom.window.document.querySelectorAll("textarea")).toHaveLength(1);
    expect(
      dom.window.document.querySelector("textarea")?.getAttribute("placeholder"),
    ).toBe("Ask Maven…");
    expect(dom.window.document.body.textContent).toContain("Sidechat");
    expect(dom.window.document.body.textContent).toContain(
      "Private · Maven has Ada's context",
    );
    expect(dom.window.document.body.textContent).not.toContain("Resolve");
    expect(dom.window.document.querySelector('[aria-label="Attach images"]')).toBeNull();
  });

  test("renders 40px Back and Close text targets without decorative pane icons", async () => {
    const { dom } = await renderPane();
    const controls = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>(
        "[data-sidechat-dismiss]",
      ),
    );
    expect(controls).toHaveLength(2);
    expect(controls.map((button) => button.textContent)).toEqual([
      "Back",
      "Close",
    ]);
    expect(controls.every((button) => button.classList.contains("min-h-10")))
      .toBe(true);
    expect(controls.every((button) => button.classList.contains("min-w-10")))
      .toBe(true);
    expect(controls.every((button) => button.querySelector("svg") === null))
      .toBe(true);
  });

  test("keeps a transitionable shell mounted while open state interpolates", async () => {
    const { dom, root } = await renderPane({ open: false });
    const pane = dom.window.document.querySelector<HTMLElement>(
      "[data-sidechat-pane]",
    )!;
    expect(pane.getAttribute("aria-hidden")).toBe("true");
    expect(pane.hasAttribute("inert")).toBe(true);
    expect(pane.classList.contains("w-0")).toBe(true);
    expect(pane.classList.contains("opacity-0")).toBe(true);
    expect(pane.classList.contains("translate-x-3")).toBe(true);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <SidechatPane
            open
            conversation={makeConversation(false)}
            customerFirstName="Ada"
            messages={[]}
            draft=""
            setDraft={() => undefined}
            onAddToReply={() => undefined}
            onClose={() => undefined}
          />
        </MemoryRouter>,
      );
      await flush();
    });
    const openedPane = dom.window.document.querySelector<HTMLElement>(
      "[data-sidechat-pane]",
    )!;
    expect(openedPane).toBe(pane);
    expect(openedPane.getAttribute("aria-hidden")).toBe("false");
    expect(openedPane.hasAttribute("inert")).toBe(false);
    expect(openedPane.classList.contains("w-full")).toBe(true);
    expect(openedPane.classList.contains("opacity-100")).toBe(true);
    expect(openedPane.classList.contains("translate-x-0")).toBe(true);
  });

  test("shows the disconnected runtime state without inventing activity", async () => {
    const { dom } = await renderPane();
    expect(dom.window.document.querySelector(
      "[data-sidechat-runtime-unavailable]",
    )?.textContent).toContain("runtime is not connected");
    expect(dom.window.document.body.textContent).not.toContain("Searching");
    expect(dom.window.document.querySelector("textarea")?.disabled).toBe(true);
  });

  test("forwards the exact reply draft without closing or sending", async () => {
    const replyDraft: Message = {
      id: "sidechat-draft-1",
      role: "bot",
      content: "Rendered explanation",
      presentationAction: {
        type: "add_to_reply",
        draft: "Exact visitor-ready draft.\nKeep this line.",
      },
      senderName: "Maven",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    let addedDraft: string | null = null;
    let closeCalls = 0;
    const { dom } = await renderPane({
      messages: [replyDraft],
      onAddToReply: (value) => {
        addedDraft = value;
      },
      onClose: () => {
        closeCalls += 1;
      },
    });
    const button = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((candidate) => candidate.textContent === "Add to reply");
    expect(button).toBeDefined();

    await act(async () => button?.click());

    expect(addedDraft).toBe("Exact visitor-ready draft.\nKeep this line.");
    expect(closeCalls).toBe(0);
    expect(dom.window.document.querySelector("[data-sidechat-pane]")).not
      .toBeNull();
    expect(dom.window.document.querySelector("textarea")).not.toBeNull();
  });

  test("keeps archived private history readable with no composer, retry, or Add to reply", async () => {
    const replyDraft: Message = {
      id: "sidechat-draft-1",
      role: "bot",
      content: "Exact customer-facing draft",
      presentationAction: {
        type: "add_to_reply",
        draft: "Exact customer-facing draft",
      },
      senderName: "Maven",
      createdAt: "2026-08-09T00:00:00.000Z",
    };
    const { dom } = await renderPane({
      archived: true,
      messages: [replyDraft],
    });

    expect(dom.window.document.body.textContent).toContain(
      "Exact customer-facing draft",
    );
    expect(dom.window.document.querySelector("textarea")).toBeNull();
    expect(dom.window.document.body.textContent).not.toContain("Retry");
    expect(dom.window.document.body.textContent).not.toContain("Add to reply");
  });
});
