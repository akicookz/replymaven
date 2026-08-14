/* eslint-disable react-refresh/only-export-components */
import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { FileUIPart, UIMessage } from "ai";
import type {
  PublicChatChildState,
  PublicChatSessionResponse,
} from "../shared/public-chat-agent";
import type { PublicMessageRecord } from "../shared/maven-conversation";
import { adaptWidgetPublicMessages } from "./public-message-adapter";

export interface WidgetPublicSendInput {
  id: string;
  content: string;
  imageUrls: string[];
  pageContext: Record<string, string>;
}

export type WidgetActivityPhase =
  | "thinking"
  | "retrieval"
  | "tool"
  | "verify"
  | "compose";

export interface WidgetChatActivity {
  status: "submitted" | "streaming" | "ready" | "error";
  isServerStreaming: boolean;
  isRecovering: boolean;
  error: Error | undefined;
  statusPhase?: WidgetActivityPhase;
}

export interface WidgetAgentChatClient {
  connect(session: PublicChatSessionResponse): void;
  disconnect(): void;
  send(input: WidgetPublicSendInput): Promise<void>;
  stop(): void;
  messages(): PublicMessageRecord[];
  onMessages(listener: (messages: PublicMessageRecord[]) => void): () => void;
  onActivity(listener: (activity: WidgetChatActivity) => void): () => void;
  onConversationState(
    listener: (state: PublicChatChildState) => void,
  ): () => void;
}

interface NativeChatControls {
  send(input: WidgetPublicSendInput): Promise<void>;
  stop(): void;
}

interface WidgetAgentBridgeProps {
  session: PublicChatSessionResponse;
  conversationId: string;
  onControls(controls: NativeChatControls): void;
  onMessages(messages: PublicMessageRecord[]): void;
  onActivity(activity: WidgetChatActivity): void;
  onConversationState(state: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ACTIVITY_PHASES: ReadonlySet<WidgetActivityPhase> = new Set([
  "thinking",
  "retrieval",
  "tool",
  "verify",
  "compose",
]);

function readPublicActivityPhase(value: unknown): WidgetActivityPhase | null {
  if (!isRecord(value) || value.type !== "data-public-activity") return null;
  if (!isRecord(value.data) || typeof value.data.phase !== "string") return null;
  return ACTIVITY_PHASES.has(value.data.phase as WidgetActivityPhase)
    ? value.data.phase as WidgetActivityPhase
    : null;
}

function readPublicChatChildState(value: unknown): PublicChatChildState | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 5 ||
    !keys.every((key) =>
      key === "status" || key === "visitorPresence" ||
      key === "visitorLastOnlineAt" || key === "archived" ||
      key === "revision"
    ) ||
    (value.status !== "active" && value.status !== "waiting_agent" &&
      value.status !== "agent_replied" && value.status !== "closed") ||
    (value.visitorPresence !== "active" &&
      value.visitorPresence !== "background") ||
    (value.visitorLastOnlineAt !== null &&
      (typeof value.visitorLastOnlineAt !== "number" ||
        !Number.isFinite(value.visitorLastOnlineAt))) ||
    typeof value.archived !== "boolean" ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  ) return null;
  return value as unknown as PublicChatChildState;
}

function normalizeConnectionError(value: unknown): Error | undefined {
  if (value instanceof Error) return value;
  if (!value) return undefined;
  return new Error("The chat connection closed");
}

const SOCKET_OPEN_TIMEOUT_MS = 10_000;

interface SocketLike {
  readyState?: number;
  addEventListener?(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

// Submitting while the socket is still connecting flushes the request in the
// same batch as useAgentChat's stream-resume probe. The server then treats the
// brand-new turn as a resumable stream awaiting a replay ACK that the
// submitting client never sends, so every chunk is buffered server-side and
// the client only receives an empty final frame. Waiting for the open event
// keeps the probe ahead of the submit in the socket's send order.
function waitForOpenSocket(socket: SocketLike): Promise<void> {
  if (
    socket.readyState === undefined ||
    socket.readyState === WebSocket.OPEN ||
    !socket.addEventListener
  ) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("The chat connection did not open in time"));
    }, SOCKET_OPEN_TIMEOUT_MS);
    function cleanup(): void {
      clearTimeout(timer);
      socket.removeEventListener?.("open", onOpen);
      socket.removeEventListener?.("close", onClose);
    }
    function onOpen(): void {
      cleanup();
      resolve();
    }
    function onClose(): void {
      cleanup();
      reject(new Error("The chat connection closed before opening"));
    }
    socket.addEventListener?.("open", onOpen);
    socket.addEventListener?.("close", onClose);
  });
}

function buildMessage(input: WidgetPublicSendInput): UIMessage {
  const parts: UIMessage["parts"] = [];
  if (input.content) parts.push({ type: "text", text: input.content });
  for (const url of input.imageUrls) {
    const file: FileUIPart = { type: "file", mediaType: "image/*", url };
    parts.push(file);
  }
  return {
    id: input.id,
    role: "user",
    parts,
  };
}

function WidgetAgentBridge(props: WidgetAgentBridgeProps) {
  const {
    conversationId,
    onActivity,
    onControls,
    onConversationState,
    onMessages,
    session,
  } = props;
  const agent = useAgent<PublicChatChildState>({
    host: session.host,
    agent: session.parentAgent,
    name: session.parentName,
    sub: [{
      agent: session.childAgent,
      name: session.childName,
    }],
    query: { token: session.token },
    queryDeps: [session.token],
    onStateUpdate: onConversationState,
  });
  const [statusPhase, setStatusPhase] = useState<
    WidgetActivityPhase | undefined
  >(undefined);
  const onData = useCallback((value: unknown) => {
    const phase = readPublicActivityPhase(value);
    if (phase) setStatusPhase(phase);
  }, []);
  const chat = useAgentChat({
    agent,
    resume: true,
    cancelOnClientAbort: false,
    syncMessagesToServer: false,
    body: () => ({ token: session.token }),
    onData,
  });
  const {
    error,
    isRecovering,
    isServerStreaming,
    messages,
    sendMessage,
    status,
    stop,
  } = chat;

  const socketRef = useRef<SocketLike>(agent);
  socketRef.current = agent;

  useLayoutEffect(() => {
    onControls({
      async send(input: WidgetPublicSendInput): Promise<void> {
        await waitForOpenSocket(socketRef.current);
        await sendMessage(buildMessage(input), {
          body: {
            token: session.token,
            attachmentUrls: [...input.imageUrls],
            pageContext: { ...input.pageContext },
          },
        });
      },
      stop(): void {
        void stop();
      },
    });
  }, [onControls, sendMessage, session.token, stop]);

  useEffect(() => {
    const connectionError = normalizeConnectionError(agent.connectionError);
    const active = status === "submitted" || status === "streaming" ||
      isServerStreaming;
    if (!active && statusPhase !== undefined) setStatusPhase(undefined);
    onActivity({
      status: connectionError ? "error" : status,
      isServerStreaming,
      isRecovering,
      error: error ?? connectionError,
      ...(active && statusPhase ? { statusPhase } : {}),
    });
  }, [
    agent.connectionError,
    error,
    isRecovering,
    isServerStreaming,
    onActivity,
    status,
    statusPhase,
  ]);

  useEffect(() => {
    onMessages(adaptWidgetPublicMessages(
      messages,
      session.parentName,
      conversationId,
    ));
  }, [
    conversationId,
    messages,
    onMessages,
    session.parentName,
  ]);

  useEffect(() => {
    onConversationState(agent.state);
  }, [agent.state, onConversationState]);

  return null;
}

export function createWidgetAgentChatClient(): WidgetAgentChatClient {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let controls: NativeChatControls | null = null;
  let currentMessages: PublicMessageRecord[] = [];
  let currentActivity: WidgetChatActivity = {
    status: "ready",
    isServerStreaming: false,
    isRecovering: false,
    error: undefined,
  };
  let generation = 0;
  let readyPromise = Promise.resolve();
  let resolveReady: (() => void) | null = null;
  const messageListeners = new Set<(
    messages: PublicMessageRecord[],
  ) => void>();
  const activityListeners = new Set<(
    activity: WidgetChatActivity,
  ) => void>();
  const stateListeners = new Set<(
    state: PublicChatChildState,
  ) => void>();

  function publishMessages(messages: PublicMessageRecord[]): void {
    currentMessages = structuredClone(messages);
    for (const listener of messageListeners) {
      listener(structuredClone(currentMessages));
    }
  }

  function publishActivity(activity: WidgetChatActivity): void {
    currentActivity = activity;
    for (const listener of activityListeners) listener(currentActivity);
  }

  function publishConversationState(value: unknown): void {
    const state = readPublicChatChildState(value);
    if (!state) return;
    for (const listener of stateListeners) listener(structuredClone(state));
  }

  function ensureRoot(): Root {
    if (root) return root;
    container = document.createElement("div");
    container.hidden = true;
    container.dataset.replymavenAgentBridge = "";
    document.body.appendChild(container);
    root = createRoot(container);
    return root;
  }

  function connect(session: PublicChatSessionResponse): void {
    generation += 1;
    const renderGeneration = generation;
    controls = null;
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const bridgeRoot = ensureRoot();
    bridgeRoot.render(
      <Suspense fallback={null}>
        <WidgetAgentBridge
          session={session}
          conversationId={session.childName.slice(4)}
          onControls={(nextControls) => {
            if (generation !== renderGeneration) return;
            controls = nextControls;
            resolveReady?.();
            resolveReady = null;
          }}
          onMessages={publishMessages}
          onActivity={publishActivity}
          onConversationState={publishConversationState}
        />
      </Suspense>,
    );
  }

  function disconnect(): void {
    generation += 1;
    resolveReady?.();
    resolveReady = null;
    controls = null;
    if (root) root.unmount();
    root = null;
    container?.remove();
    container = null;
    publishMessages([]);
    publishActivity({
      status: "ready",
      isServerStreaming: false,
      isRecovering: false,
      error: undefined,
    });
  }

  async function send(input: WidgetPublicSendInput): Promise<void> {
    await readyPromise;
    if (!controls) throw new Error("The chat Agent is not connected");
    await controls.send(input);
  }

  function stop(): void {
    controls?.stop();
  }

  function messages(): PublicMessageRecord[] {
    return structuredClone(currentMessages);
  }

  function onMessages(
    listener: (messages: PublicMessageRecord[]) => void,
  ): () => void {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
  }

  function onActivity(
    listener: (activity: WidgetChatActivity) => void,
  ): () => void {
    activityListeners.add(listener);
    listener(currentActivity);
    return () => activityListeners.delete(listener);
  }

  function onConversationState(
    listener: (state: PublicChatChildState) => void,
  ): () => void {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  }

  return {
    connect,
    disconnect,
    send,
    stop,
    messages,
    onMessages,
    onActivity,
    onConversationState,
  };
}
