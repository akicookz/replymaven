import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import type { Conversation, Message } from "@/lib/inbox/types";
import Composer from "./Composer";
import FocusView from "./FocusView";

interface RenderResult {
  dom: JSDOM;
  root: Root;
}

const rendered: RenderResult[] = [];

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderNode(node: ReactNode): Promise<RenderResult> {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    { url: "http://localhost/app/projects/project-1/conversations" },
  );
  const elementPrototype = dom.window.HTMLElement.prototype as
    typeof dom.window.HTMLElement.prototype & {
      attachEvent?: (name: string, listener: EventListener) => void;
      detachEvent?: (name: string, listener: EventListener) => void;
    };
  elementPrototype.attachEvent = function attachEvent(name, listener): void {
    this.addEventListener(name.replace(/^on/, ""), listener);
  };
  elementPrototype.detachEvent = function detachEvent(name, listener): void {
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
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
    await flush();
  });
  const result = { dom, root };
  rendered.push(result);
  return result;
}

function composerBaseProps() {
  return {
    draft: "",
    setDraft: () => undefined,
    onSend: () => undefined,
    onResolve: () => undefined,
    convId: "conversation-1",
  };
}

interface TestKeyboardEvent {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  nativeEvent: { isComposing: boolean };
  preventDefault(): void;
}

function invokeTextareaKeyDown(
  textarea: HTMLTextAreaElement,
  event: TestKeyboardEvent,
): void {
  const propsKey = Object.keys(textarea).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!propsKey) throw new Error("React textarea props were not attached");
  const props = Reflect.get(textarea, propsKey) as {
    onKeyDown?: (keyboardEvent: TestKeyboardEvent) => void;
  };
  props.onKeyDown?.(event);
}

function shiftTabEvent(onPreventDefault: () => void): TestKeyboardEvent {
  return {
    key: "Tab",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    nativeEvent: { isComposing: false },
    preventDefault: onPreventDefault,
  };
}

function makeConversation(archivedAt: string | null): Conversation {
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
    archivedAt,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

const agentMessage: Message = {
  id: "message-1",
  role: "agent",
  content: "A public reply",
  createdAt: "2026-08-09T00:00:00.000Z",
};

afterEach(async () => {
  for (const result of rendered.splice(0)) {
    await act(async () => result.root.unmount());
    result.dom.window.close();
  }
});

describe("Composer contracts", () => {
  test("legacy onCompose never exposes Sidechat copy or captures empty Shift+Tab", async () => {
    let composeCalls = 0;
    const { dom } = await renderNode(
      <Composer
        {...composerBaseProps()}
        onCompose={() => {
          composeCalls += 1;
        }}
        composing={false}
      />,
    );
    expect(dom.window.document.body.textContent).toContain("Compose");
    expect(dom.window.document.body.textContent).not.toContain("Start sidechat");
    expect(dom.window.document.body.textContent).not.toContain("Open sidechat");

    const textarea = dom.window.document.querySelector("textarea")!;
    let prevented = false;
    invokeTextareaKeyDown(textarea, shiftTabEvent(() => {
      prevented = true;
    }));
    expect(composeCalls).toBe(0);
    expect(prevented).toBe(false);
  });

  test("filled legacy mode leaves Shift+Tab untouched while Compose remains clickable", async () => {
    let composeCalls = 0;
    const { dom } = await renderNode(
      <Composer
        {...composerBaseProps()}
        draft="Investigate this first"
        onCompose={() => {
          composeCalls += 1;
        }}
        composing={false}
      />,
    );
    const textarea = dom.window.document.querySelector("textarea")!;
    let prevented = false;
    invokeTextareaKeyDown(textarea, shiftTabEvent(() => {
      prevented = true;
    }));
    expect(composeCalls).toBe(0);
    expect(prevented).toBe(false);

    const composeButton = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Compose"));
    expect(composeButton).toBeDefined();
    await act(async () => composeButton?.click());
    expect(composeCalls).toBe(1);
  });

  test("real public mode renders Start/Open and accepts empty unmodified Shift+Tab", async () => {
    let sidechatCalls = 0;
    const { dom } = await renderNode(
      <Composer
        {...composerBaseProps()}
        mode={{
          kind: "public",
          onStartSidechat: () => {
            sidechatCalls += 1;
          },
          sidechatExists: false,
          sidechatStatus: "idle",
        }}
      />,
    );
    expect(dom.window.document.body.textContent).toContain("Start sidechat");
    expect(dom.window.document.body.textContent).not.toContain("Compose");

    const textarea = dom.window.document.querySelector("textarea")!;
    let prevented = false;
    invokeTextareaKeyDown(textarea, shiftTabEvent(() => {
      prevented = true;
    }));
    expect(sidechatCalls).toBe(1);
    expect(prevented).toBe(true);
  });

  test("uses wrapping narrow-layout groups and non-shrinking 40px targets", async () => {
    const { dom } = await renderNode(
      <Composer
        {...composerBaseProps()}
        mode={{
          kind: "public",
          onStartSidechat: () => undefined,
          sidechatExists: true,
          sidechatStatus: "ready",
        }}
      />,
    );
    const row = dom.window.document.querySelector<HTMLElement>(
      "[data-composer-action-row]",
    );
    const actions = dom.window.document.querySelector<HTMLElement>(
      "[data-composer-actions]",
    );
    expect(row?.classList.contains("flex-wrap")).toBe(true);
    expect(actions?.classList.contains("flex-wrap")).toBe(true);
    expect(actions?.classList.contains("max-w-full")).toBe(true);

    const buttons = Array.from(
      dom.window.document.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.classList.contains("shrink-0")))
      .toBe(true);
    const sidechatButton = buttons.find((button) =>
      button.textContent?.includes("Open sidechat"),
    );
    expect(sidechatButton?.classList.contains("whitespace-nowrap")).toBe(true);
  });
});

describe("archived FocusView", () => {
  test("keeps the transcript read-only and hides the composer", async () => {
    let deleteCalls = 0;
    const { dom } = await renderNode(
      <FocusView
        conversation={makeConversation("2026-08-09T01:00:00.000Z")}
        messages={[agentMessage]}
        index={0}
        total={1}
        onExit={() => undefined}
        onSend={() => undefined}
        onResolve={() => undefined}
        onDeleteMessage={() => {
          deleteCalls += 1;
        }}
        draft=""
        setDraft={() => undefined}
        onCompose={() => undefined}
        composing={false}
      />,
    );
    expect(dom.window.document.querySelector("textarea")).toBeNull();
    expect(
      dom.window.document.querySelector('[aria-label="Delete message"]'),
    ).toBeNull();
    expect(deleteCalls).toBe(0);
  });
});
