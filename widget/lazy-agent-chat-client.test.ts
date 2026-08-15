import { beforeEach, describe, expect, mock, test } from "bun:test";
import { JSDOM } from "jsdom";
import type { PublicChatSessionResponse } from "../shared/public-chat-agent";
import type { PublicMessageRecord } from "../shared/maven-conversation";
import type {
  WidgetAgentChatClient,
  WidgetChatActivity,
} from "./agent-chat-bridge";
import { createLazyWidgetAgentChatClient } from "./lazy-agent-chat-client";

function session(): PublicChatSessionResponse {
  return {
    host: "https://api.replymaven.test",
    parentAgent: "MavenProjectAgent",
    parentName: "project-1",
    childAgent: "MavenChatAgent",
    childName: "pub_conversation-1",
    token: "signed-token",
    expiresAt: 2_000,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://embedder.example/docs",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Event: dom.window.Event,
  });
  delete window.__ReplyMavenAgentRuntime;
});

describe("lazy widget Agent runtime", () => {
  test("loads once on first connect and forwards the public client contract", async () => {
    const connect = mock(() => {});
    const disconnect = mock(() => {});
    const send = mock(async () => {});
    const retry = mock(() => {});
    const stop = mock(() => {});
    let emitMessages: ((messages: PublicMessageRecord[]) => void) | null = null;
    let emitActivity: ((activity: WidgetChatActivity) => void) | null = null;
    const delegate: WidgetAgentChatClient = {
      connect,
      disconnect,
      send,
      retry,
      stop,
      messages: () => [],
      onMessages(listener) {
        emitMessages = listener;
        return () => {};
      },
      onActivity(listener) {
        emitActivity = listener;
        return () => {};
      },
      onOutbox() {
        return () => {};
      },
      onConversationState() {
        return () => {};
      },
    };
    const client = createLazyWidgetAgentChatClient(
      "https://widget.replymaven.test/widget-agent-runtime.js",
    );
    const messageSnapshots: PublicMessageRecord[][] = [];
    const activities: WidgetChatActivity[] = [];
    client.onMessages((messages) => messageSnapshots.push(messages));
    client.onActivity((activity) => activities.push(activity));

    client.connect(session());
    const script = document.querySelector<HTMLScriptElement>(
      "script[data-replymaven-agent-runtime]",
    );
    expect(script?.src).toBe(
      "https://widget.replymaven.test/widget-agent-runtime.js",
    );
    expect(script?.hasAttribute("crossorigin")).toBe(false);
    expect(document.querySelectorAll(
      "script[data-replymaven-agent-runtime]",
    )).toHaveLength(1);

    window.__ReplyMavenAgentRuntime = {
      createWidgetAgentChatClient() {
        return delegate;
      },
    };
    script?.dispatchEvent(new Event("load"));
    await flushPromises();
    expect(connect).toHaveBeenCalledWith(session());

    const activity: WidgetChatActivity = {
      status: "streaming",
      isServerStreaming: true,
      isRecovering: false,
      error: undefined,
    };
    emitMessages?.([]);
    emitActivity?.(activity);
    expect(messageSnapshots).toEqual([[]]);
    expect(activities).toEqual([activity]);

    const input = {
      id: "visitor-1",
      content: "Hello",
      imageUrls: [],
      pageContext: {},
    };
    await client.send(input);
    client.stop();
    client.disconnect();
    expect(send).toHaveBeenCalledWith(input);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  test("removes a failed runtime script so a later connection can retry", async () => {
    const client = createLazyWidgetAgentChatClient(
      "https://widget.replymaven.test/widget-agent-runtime.js",
    );
    const activities: WidgetChatActivity[] = [];
    client.onActivity((activity) => activities.push(activity));

    client.connect(session());
    const failedScript = document.querySelector<HTMLScriptElement>(
      "script[data-replymaven-agent-runtime]",
    );
    failedScript?.dispatchEvent(new Event("error"));
    await flushPromises();

    expect(failedScript?.isConnected).toBe(false);
    expect(activities.at(-1)?.status).toBe("error");

    client.connect(session());
    const retryScript = document.querySelector<HTMLScriptElement>(
      "script[data-replymaven-agent-runtime]",
    );
    expect(retryScript).not.toBe(failedScript);
    expect(retryScript?.src).toBe(
      "https://widget.replymaven.test/widget-agent-runtime.js",
    );
  });
});
