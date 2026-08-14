import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import type {
  PublicChatChildState,
  PublicChatSessionResponse,
} from "../../shared/public-chat-agent";
import { adaptPublicMessages } from "@/lib/inbox/public-message-adapter";

const MINIMUM_SESSION_REFRESH_MS = 5_000;

interface UsePublicChatSessionOptions {
  projectId: string | undefined;
  conversationId: string | null;
  enabled: boolean;
}

interface UsePublicChatAgentOptions {
  session: PublicChatSessionResponse;
  conversationId: string;
}

export interface PublicChatAgentController {
  messages: ReturnType<typeof adaptPublicMessages>;
  nativeMessages: UIMessage[];
  state: PublicChatChildState | undefined;
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  isServerStreaming: boolean;
  isRecovering: boolean;
}

interface PublicChatOptions {
  resume: true;
  cancelOnClientAbort: false;
  syncMessagesToServer: false;
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function fetchPublicChatSession(
  projectId: string,
  conversationId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicChatSessionResponse> {
  const response = await fetcher(
    `/api/projects/${encoded(projectId)}/conversations/${encoded(conversationId)}/agent-session`,
    { method: "POST" },
  );
  return readJsonResponse<PublicChatSessionResponse>(response);
}

// Refresh at half the remaining lifetime so a fresh token always lands well
// before expiry; an established socket keeps working through refreshes.
export function publicChatSessionRefreshInterval(
  session: { expiresAt: number },
  now = Date.now(),
): number {
  return Math.max(
    MINIMUM_SESSION_REFRESH_MS,
    Math.floor((session.expiresAt * 1_000 - now) / 2),
  );
}

export function usePublicChatSession(
  options: UsePublicChatSessionOptions,
): UseQueryResult<PublicChatSessionResponse, Error> {
  return useQuery({
    queryKey: ["public-chat-session", options.projectId, options.conversationId],
    queryFn: () =>
      fetchPublicChatSession(options.projectId!, options.conversationId!),
    enabled: options.enabled && Boolean(
      options.projectId && options.conversationId,
    ),
    retry: 1,
    staleTime: 0,
    refetchInterval(query) {
      const current = query.state.data;
      return current ? publicChatSessionRefreshInterval(current) : 30_000;
    },
    refetchIntervalInBackground: true,
  });
}

export function buildPublicChatAgentConnectionOptions(
  session: PublicChatSessionResponse,
) {
  return {
    host: session.host,
    agent: session.parentAgent,
    name: session.parentName,
    sub: [{ agent: session.childAgent, name: session.childName }],
    query: { token: session.token },
    queryDeps: [session.token],
  };
}

export function buildPublicChatOptions(): PublicChatOptions {
  return {
    resume: true,
    cancelOnClientAbort: false,
    syncMessagesToServer: false,
  };
}

export function usePublicChatAgent(
  options: UsePublicChatAgentOptions,
): PublicChatAgentController {
  const agent = useAgent<PublicChatChildState>(
    buildPublicChatAgentConnectionOptions(options.session),
  );
  const chat = useAgentChat({
    agent,
    ...buildPublicChatOptions(),
  });
  const messages = useMemo(
    () => adaptPublicMessages(
      chat.messages,
      options.session.parentName,
      options.conversationId,
    ),
    [chat.messages, options.conversationId, options.session.parentName],
  );
  return {
    messages,
    nativeMessages: chat.messages,
    state: agent.state,
    status: chat.status,
    error: chat.error,
    isStreaming: chat.isStreaming,
    isServerStreaming: chat.isServerStreaming,
    isRecovering: chat.isRecovering,
  };
}
