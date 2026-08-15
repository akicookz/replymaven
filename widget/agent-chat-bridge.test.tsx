import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, useEffect } from "react";
import { JSDOM } from "jsdom";
import type { UIMessage } from "ai";
import type {
  PublicChatChildState,
  PublicChatSessionResponse,
} from "../shared/public-chat-agent";

interface MockAgentContract {
  state: unknown;
  connectionError: Error | null;
}

interface MockChatContract {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  isServerStreaming: boolean;
  isRecovering: boolean;
  sendMessage: ReturnType<typeof mock>;
  stop: ReturnType<typeof mock>;
}

let agentContract: MockAgentContract;
let chatContract: MockChatContract;
let capturedAgentOptions: Array<Record<string, unknown>> = [];
let capturedChatOptions: Array<Record<string, unknown>> = [];
let agentUnmounts = 0;

mock.module("agents/react", () => ({
  useAgent(options: Record<string, unknown>) {
    capturedAgentOptions.push(options);
    useEffect(() => () => {
      agentUnmounts += 1;
    }, []);
    return {
      ...agentContract,
      agent: "MavenChatAgent",
      name: "pub_conversation-1",
      path: [],
      getHttpUrl() {
        return "https://api.replymaven.test/agents/maven-chat-agent/pub_conversation-1";
      },
      addEventListener() {},
      removeEventListener() {},
      send() {},
    };
  },
}));

mock.module("@cloudflare/ai-chat/react", () => ({
  useAgentChat(options: Record<string, unknown>) {
    capturedChatOptions.push(options);
    return chatContract;
  },
}));

const {
  createWidgetAgentChatClient,
} = await import("./agent-chat-bridge");

function session(
  overrides: Partial<PublicChatSessionResponse> = {},
): PublicChatSessionResponse {
  return {
    host: "https://api.replymaven.test",
    parentAgent: "MavenProjectAgent",
    parentName: "project-1",
    childAgent: "MavenChatAgent",
    childName: "pub_conversation-1",
    token: "signed-token-1",
    expiresAt: 2_000,
    ...overrides,
  };
}

function childState(
  overrides: Partial<PublicChatChildState> = {},
): PublicChatChildState {
  return {
    status: "active",
    visitorPresence: "active",
    visitorLastOnlineAt: 1_700_000_000_000,
    archived: false,
    revision: 3,
    ...overrides,
  };
}

function publicMessage(
  id: string,
  author: "visitor" | "bot" | "agent" = "bot",
  content = "Hello",
): UIMessage {
  const role = author === "visitor" ? "user" : "assistant";
  return {
    id,
    role,
    metadata: {
      v: 1,
      channel: "public",
      projectId: "project-1",
      conversationId: "conversation-1",
      author,
      senderName: author === "agent" ? "Ada" : null,
      senderAvatar: null,
      userId: null,
      imageUrls: [],
      sources: [],
      createdAt: 1_700_000_000_000,
      deliveredAt: null,
      readAt: null,
      emailedAt: null,
      systemKind: null,
    },
    parts: content ? [{ type: "text", text: content }] : [],
  };
}

async function flushReact(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://embedder.example/docs",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  agentContract = { state: childState(), connectionError: null };
  chatContract = {
    messages: [publicMessage("initial")],
    status: "ready",
    error: undefined,
    isStreaming: false,
    isServerStreaming: false,
    isRecovering: false,
    sendMessage: mock(async () => {}),
    stop: mock(async () => {}),
  };
  capturedAgentOptions = [];
  capturedChatOptions = [];
  agentUnmounts = 0;
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("widget native Agent chat bridge", () => {
  test("establishes the exact nested session and rerenders refreshed tokens", async () => {
    const client = createWidgetAgentChatClient();
    const messages: string[][] = [];
    const unsubscribe = client.onMessages((records) => {
      messages.push(records.map((record) => record.id));
    });

    await act(async () => client.connect(session()));
    await flushReact();

    expect(capturedAgentOptions.at(-1)).toMatchObject({
      host: "https://api.replymaven.test",
      agent: "MavenProjectAgent",
      name: "project-1",
      sub: [{ agent: "MavenChatAgent", name: "pub_conversation-1" }],
      query: { token: "signed-token-1" },
      queryDeps: ["signed-token-1"],
    });
    expect(capturedChatOptions.at(-1)).toMatchObject({
      resume: true,
      cancelOnClientAbort: false,
      syncMessagesToServer: false,
    });
    const firstBody = capturedChatOptions.at(-1)?.body as () => {
      token: string;
    };
    expect(firstBody()).toEqual({ token: "signed-token-1" });
    expect(messages.at(-1)).toEqual(["initial"]);

    chatContract.messages = [
      publicMessage("initial"),
      publicMessage("human", "agent", "I can help"),
    ];
    agentContract.state = childState({ status: "agent_replied", revision: 4 });
    await act(async () => {
      client.connect(session({ token: "signed-token-2" }));
    });
    await flushReact();

    expect(capturedAgentOptions.at(-1)).toMatchObject({
      query: { token: "signed-token-2" },
      queryDeps: ["signed-token-2"],
    });
    const refreshedBody = capturedChatOptions.at(-1)?.body as () => {
      token: string;
    };
    expect(refreshedBody()).toEqual({ token: "signed-token-2" });
    expect(client.messages().map((record) => record.id)).toEqual([
      "initial",
      "human",
    ]);

    unsubscribe();
    await act(async () => client.disconnect());
  });

  test("forwards native activity, recovery, state, deletion, and empty human completions", async () => {
    const client = createWidgetAgentChatClient();
    const activities: Array<{
      status: string;
      isServerStreaming: boolean;
      isRecovering: boolean;
      error: Error | undefined;
    }> = [];
    const states: PublicChatChildState[] = [];
    const messageSnapshots: string[][] = [];
    client.onActivity((activity) => activities.push(activity));
    client.onConversationState((state) => states.push(state));
    client.onMessages((messages) => {
      messageSnapshots.push(messages.map((message) => message.id));
    });

    await act(async () => client.connect(session()));
    await flushReact();

    chatContract.status = "streaming";
    chatContract.isStreaming = true;
    chatContract.isServerStreaming = true;
    chatContract.isRecovering = true;
    chatContract.messages = [publicMessage("initial", "visitor", "Question")];
    agentContract.state = childState({ status: "waiting_agent", revision: 4 });
    await act(async () => client.connect(session({ token: "refresh-1" })));
    await flushReact();

    expect(activities.at(-1)).toMatchObject({
      status: "streaming",
      isServerStreaming: true,
      isRecovering: true,
    });
    expect(states.at(-1)).toEqual(childState({
      status: "waiting_agent",
      revision: 4,
    }));
    expect(messageSnapshots.at(-1)).toEqual(["initial"]);

    // A human-owned turn completes without an assistant message. The native
    // transcript remains authoritative and the promise still resolves.
    chatContract.status = "ready";
    chatContract.isStreaming = false;
    chatContract.isServerStreaming = false;
    chatContract.isRecovering = false;
    await client.send({
      id: "visitor-2",
      content: "Any update?",
      imageUrls: ["https://api.replymaven.test/api/uploads/image.png"],
      pageContext: { pageTitle: "Docs" },
    });
    // send resolves on enqueue; the outbox attempt delivers asynchronously.
    await flushReact();
    expect(chatContract.sendMessage).toHaveBeenCalledWith(
      {
        id: "visitor-2",
        role: "user",
        parts: [
          { type: "text", text: "Any update?" },
          {
            type: "file",
            mediaType: "image/*",
            url: "https://api.replymaven.test/api/uploads/image.png",
          },
        ],
      },
      {
        body: {
          token: "refresh-1",
          attachmentUrls: [
            "https://api.replymaven.test/api/uploads/image.png",
          ],
          pageContext: { pageTitle: "Docs" },
        },
      },
    );

    // Full-list replacement removes messages without any protocol parsing.
    chatContract.messages = [];
    await act(async () => client.connect(session({ token: "refresh-2" })));
    await flushReact();
    expect(messageSnapshots.at(-1)).toEqual([]);

    // Unexpected child state is not forwarded to the DOM controller.
    agentContract.state = { ...childState(), privateSecret: "must-not-leak" };
    await act(async () => client.connect(session({ token: "refresh-3" })));
    await flushReact();
    expect(states.at(-1)).toEqual(childState({
      status: "waiting_agent",
      revision: 4,
    }));

    await act(async () => client.disconnect());
  });

  test("handles terminal errors, stop, listener cleanup, identity reset, and unmount", async () => {
    const client = createWidgetAgentChatClient();
    const seen: string[][] = [];
    const unsubscribe = client.onMessages((messages) => {
      seen.push(messages.map((message) => message.id));
    });
    await act(async () => client.connect(session()));
    await flushReact();
    unsubscribe();

    const terminal = Object.assign(new Error("Session expired"), {
      code: 4401,
    });
    agentContract.connectionError = terminal;
    chatContract.messages = [
      publicMessage("initial"),
      publicMessage("server-push", "agent"),
    ];
    await act(async () => client.connect(session({ token: "expired" })));
    await flushReact();

    expect(seen).toEqual([["initial"]]);
    const errors: Error[] = [];
    client.onActivity((activity) => {
      if (activity.error) errors.push(activity.error);
    });
    await act(async () => client.connect(session({ token: "expired-2" })));
    await flushReact();
    expect(errors.at(-1)).toBe(terminal);

    client.stop();
    expect(chatContract.stop).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-replymaven-agent-bridge]")).not.toBeNull();

    await act(async () => client.disconnect());
    expect(client.messages()).toEqual([]);
    expect(document.querySelector("[data-replymaven-agent-bridge]")).toBeNull();
    expect(agentUnmounts).toBe(1);
  });
});
