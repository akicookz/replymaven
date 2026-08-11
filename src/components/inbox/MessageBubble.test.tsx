import { afterEach, describe, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import type { Conversation, Message } from "@/lib/inbox/types";
import MessageBubble from "./MessageBubble";

const roots: Root[] = [];

function conversation(): Conversation {
  return {
    id: "conversation-1",
    customerId: null,
    visitorId: "visitor-1",
    visitorName: "Ada",
    visitorEmail: null,
    status: "active",
    closeReason: null,
    metadata: null,
    visitorLastSeenAt: null,
    visitorPresence: null,
    visitorLastOnlineAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function approvalMessage(canAlwaysAllow: boolean): Message {
  return {
    id: "approval-message",
    role: "bot",
    content:
      "Run this write action?\n\nThis **can change data in the connected service** and may not be reversible.",
    createdAt: new Date(0).toISOString(),
    presentationAction: {
      type: "approval",
      approvalId: "approval-1",
      toolCallId: "call-1",
      canAlwaysAllow,
    },
  };
}

async function renderApproval(canAlwaysAllow: boolean) {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const onApprovalAction = mock(() => undefined);
  const root = createRoot(dom.window.document.getElementById("root")!);
  roots.push(root);
  await act(async () => {
    root.render(
      <MessageBubble
        perspective="sidechat"
        conversation={conversation()}
        message={approvalMessage(canAlwaysAllow)}
        onApprovalAction={onApprovalAction}
      />,
    );
  });
  return { dom, onApprovalAction };
}

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await act(async () => root.unmount());
  }
});

describe("Sidechat approval bubble", () => {
  test("uses the normal bubble and shows only compact Always allow and Allow once", async () => {
    const { dom, onApprovalAction } = await renderApproval(true);
    const buttons = [...dom.window.document.querySelectorAll("button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Always allow",
      "Allow once",
    ]);
    expect(dom.window.document.body.textContent).not.toContain("Not now");
    expect(dom.window.document.body.textContent).not.toContain("Verified");
    expect(dom.window.document.body.textContent).not.toContain("Alert");
    expect(buttons.every((button) => button.className.includes("min-h-10"))).toBe(true);
    expect(buttons[1]?.querySelector("span")?.className).toContain("rounded-[8px]");

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onApprovalAction.mock.calls).toEqual([
      ["approval-message", "always"],
      ["approval-message", "once"],
    ]);
  });

  test("keeps Allow once available while hiding Always allow for a member", async () => {
    const { dom } = await renderApproval(false);
    expect([...dom.window.document.querySelectorAll("button")].map(
      (button) => button.textContent?.trim(),
    )).toEqual(["Allow once"]);
  });
});
