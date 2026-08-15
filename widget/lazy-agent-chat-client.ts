import type { PublicChatChildState } from "../shared/public-chat-agent";
import type { PublicMessageRecord } from "../shared/maven-conversation";
import type {
  WidgetAgentChatClient,
  WidgetChatActivity,
  WidgetOutboxEntry,
  WidgetPublicSendInput,
} from "./agent-chat-bridge";

export interface ReplyMavenAgentRuntime {
  createWidgetAgentChatClient(): WidgetAgentChatClient;
}

declare global {
  interface Window {
    __ReplyMavenAgentRuntime?: ReplyMavenAgentRuntime;
  }
}

const RUNTIME_SCRIPT_ATTRIBUTE = "data-replymaven-agent-runtime";

function loadAgentRuntime(url: string): Promise<ReplyMavenAgentRuntime> {
  if (window.__ReplyMavenAgentRuntime) {
    return Promise.resolve(window.__ReplyMavenAgentRuntime);
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[${RUNTIME_SCRIPT_ATTRIBUTE}]`,
    );
    const script = existing ?? document.createElement("script");

    function finish(): void {
      if (window.__ReplyMavenAgentRuntime) {
        resolve(window.__ReplyMavenAgentRuntime);
      } else {
        script.remove();
        reject(new Error("ReplyMaven Agent runtime did not initialize"));
      }
    }

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("ReplyMaven Agent runtime failed to load"));
    }, { once: true });
    if (!existing) {
      script.src = url;
      script.async = true;
      script.setAttribute(RUNTIME_SCRIPT_ATTRIBUTE, "");
      document.head.appendChild(script);
    }
  });
}

export function createLazyWidgetAgentChatClient(
  runtimeUrl: string,
): WidgetAgentChatClient {
  let delegate: WidgetAgentChatClient | null = null;
  let loadPromise: Promise<WidgetAgentChatClient> | null = null;
  let connectGeneration = 0;
  const messageListeners = new Set<(
    messages: PublicMessageRecord[],
  ) => void>();
  const activityListeners = new Set<(
    activity: WidgetChatActivity,
  ) => void>();
  const stateListeners = new Set<(
    state: PublicChatChildState,
  ) => void>();
  const outboxListeners = new Set<(
    entries: WidgetOutboxEntry[],
  ) => void>();

  async function loadClient(): Promise<WidgetAgentChatClient> {
    if (delegate) return delegate;
    if (!loadPromise) {
      loadPromise = loadAgentRuntime(runtimeUrl).then((runtime) => {
        delegate = runtime.createWidgetAgentChatClient();
        delegate.onMessages((messages) => {
          for (const listener of messageListeners) listener(messages);
        });
        delegate.onActivity((activity) => {
          for (const listener of activityListeners) listener(activity);
        });
        // A cached pre-outbox runtime (R2 caches for 600s) lacks onOutbox;
        // feature-detect so a version-skewed load degrades instead of
        // throwing and killing the chat.
        if (typeof delegate.onOutbox === "function") {
          delegate.onOutbox((entries) => {
            for (const listener of outboxListeners) listener(entries);
          });
        }
        delegate.onConversationState((state) => {
          for (const listener of stateListeners) listener(state);
        });
        return delegate;
      }).catch((error) => {
        loadPromise = null;
        throw error;
      });
    }
    return loadPromise;
  }

  function connect(
    session: Parameters<WidgetAgentChatClient["connect"]>[0],
  ): void {
    connectGeneration += 1;
    const generation = connectGeneration;
    void loadClient().then((client) => {
      if (generation === connectGeneration) client.connect(session);
    }).catch((error) => {
      const normalized = error instanceof Error
        ? error
        : new Error("ReplyMaven Agent runtime failed");
      for (const listener of activityListeners) {
        listener({
          status: "error",
          isServerStreaming: false,
          isRecovering: false,
          error: normalized,
        });
      }
    });
  }

  function disconnect(): void {
    connectGeneration += 1;
    delegate?.disconnect();
  }

  function emitOutbox(entries: WidgetOutboxEntry[]): void {
    for (const listener of outboxListeners) listener(entries);
  }

  async function send(input: WidgetPublicSendInput): Promise<void> {
    const client = await loadClient();
    if (typeof client.onOutbox !== "function") {
      // Old runtime: send resolves on completion and reports no outbox
      // transitions, so synthesize them from the promise outcome to keep the
      // status line honest.
      try {
        await client.send(input);
        emitOutbox([{ id: input.id, state: "delivered", attempts: 1 }]);
      } catch (error) {
        emitOutbox([{ id: input.id, state: "undeliverable", attempts: 1 }]);
        throw error;
      }
      return;
    }
    await client.send(input);
  }

  function retry(messageId: string): void {
    void loadClient().then((client) => {
      if (typeof client.retry === "function") client.retry(messageId);
    }).catch(() => undefined);
  }

  function stop(): void {
    delegate?.stop();
  }

  function messages(): PublicMessageRecord[] {
    return delegate?.messages() ?? [];
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
    return () => activityListeners.delete(listener);
  }

  function onOutbox(
    listener: (entries: WidgetOutboxEntry[]) => void,
  ): () => void {
    outboxListeners.add(listener);
    return () => outboxListeners.delete(listener);
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
    retry,
    stop,
    messages,
    onMessages,
    onActivity,
    onOutbox,
    onConversationState,
  };
}
