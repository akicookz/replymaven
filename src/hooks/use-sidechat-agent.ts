import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useAgent } from "agents/react";
import { useAgentChat } from "@cloudflare/ai-chat/react";
import type { UIMessage } from "ai";
import type {
  MavenProjectState,
  SidechatSessionResponse,
  SidechatSummarySessionResponse,
} from "../../shared/sidechat-agent";
import {
  adaptSidechatMessages,
  readSafeSidechatDataPart,
  type SafeSidechatDataPart,
} from "@/lib/inbox/sidechat-message-adapter";
import { shouldClearAcceptedPublicDraft } from "@/lib/inbox/sidechat";

const MINIMUM_SESSION_REFRESH_MS = 5_000;

export interface PendingSidechatTransfer {
  conversationId: string;
  messageId: string;
  textSnapshot: string;
  submitted?: boolean;
}

interface InitialSidechatSubmissionOptions {
  session: SidechatSessionResponse;
  messageId: string;
  publicTextSnapshot: string;
}

interface AcceptedSidechatTransferOptions {
  transfer: PendingSidechatTransfer | null;
  acceptedMessageId: string;
  selectedConversationId: string | null;
  currentPublicDraft: string;
}

interface AcceptedSidechatTransferResult {
  nextDraft: string;
  transfer: PendingSidechatTransfer | null;
}

type FailedSidechatRetryPlan =
  | {
      kind: "resubmit";
      messageId: string;
      text: string;
    }
  | {
      kind: "regenerate";
      acceptedMessageId?: string;
    };

interface UseSidechatSessionOptions {
  projectId: string | undefined;
  conversationId: string | null;
  enabled: boolean;
}

interface UseSidechatAgentOptions {
  session: SidechatSessionResponse;
  conversationId: string;
  onTurnAccepted?: (messageId: string) => void;
  onSafeActivity?: (
    activity: Extract<SafeSidechatDataPart, { type: "safe-activity" }>,
  ) => void;
}

export interface SidechatAgentController {
  messages: ReturnType<typeof adaptSidechatMessages>;
  nativeMessages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error: Error | undefined;
  isStreaming: boolean;
  isServerStreaming: boolean;
  isRecovering: boolean;
  acceptedMessageIds: ReadonlySet<string>;
  send(text: string, messageId?: string): Promise<string>;
  stop(): Promise<void>;
  retry(): Promise<void>;
  approve(
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once" | "deny",
  ): Promise<void>;
}

interface SidechatChatOptions {
  resume: true;
  cancelOnClientAbort: false;
  body(): { token: string };
  onData(value: unknown): void;
}

type NativeSidechatUiStatus =
  | "submitted"
  | "streaming"
  | "ready"
  | "error";

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

export async function fetchSidechatSession(
  projectId: string,
  conversationId: string,
  fetcher: typeof fetch = fetch,
): Promise<SidechatSessionResponse> {
  const response = await fetcher(
    `/api/projects/${encoded(projectId)}/conversations/${encoded(conversationId)}/sidechat/session`,
    { method: "POST" },
  );
  return readJsonResponse<SidechatSessionResponse>(response);
}

export async function fetchSidechatSummarySession(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<SidechatSummarySessionResponse> {
  const response = await fetcher(
    `/api/projects/${encoded(projectId)}/sidechat/summaries`,
  );
  return readJsonResponse<SidechatSummarySessionResponse>(response);
}

// Refresh at half the remaining lifetime so a fresh token always lands well
// before expiry. A stale token only matters on the next socket (re)connect;
// the mounted pane and its open socket keep working through refreshes.
export function sidechatSessionRefreshInterval(
  session: { expiresAt: number },
  now = Date.now(),
): number {
  return Math.max(
    MINIMUM_SESSION_REFRESH_MS,
    Math.floor((session.expiresAt * 1_000 - now) / 2),
  );
}

export function useSidechatSession(
  options: UseSidechatSessionOptions,
): UseQueryResult<SidechatSessionResponse, Error> {
  return useQuery({
    queryKey: [
      "sidechat-session",
      options.projectId,
      options.conversationId,
    ],
    queryFn: () =>
      fetchSidechatSession(options.projectId!, options.conversationId!),
    enabled: options.enabled && Boolean(
      options.projectId && options.conversationId,
    ),
    retry: 1,
    staleTime: 0,
    refetchInterval(query) {
      const current = query.state.data;
      return current ? sidechatSessionRefreshInterval(current) : 30_000;
    },
    refetchIntervalInBackground: true,
  });
}

export function useSidechatSummarySession(
  projectId: string | undefined,
): UseQueryResult<SidechatSummarySessionResponse, Error> {
  return useQuery({
    queryKey: ["sidechat-summaries", projectId],
    queryFn: () => fetchSidechatSummarySession(projectId!),
    enabled: Boolean(projectId),
    retry: 1,
    staleTime: 0,
    refetchInterval(query) {
      const current = query.state.data;
      return current ? sidechatSessionRefreshInterval(current) : 30_000;
    },
    refetchIntervalInBackground: true,
  });
}

export function buildSidechatAgentConnectionOptions(
  session: SidechatSessionResponse,
) {
  return {
    agent: session.parentAgent,
    name: session.parentName,
    sub: [{ agent: session.childAgent, name: session.childName }],
    query: { token: session.token },
    queryDeps: [session.token],
  };
}

export function buildSidechatChatOptions(
  token: string,
  onData: (value: unknown) => void,
): SidechatChatOptions {
  return {
    resume: true,
    cancelOnClientAbort: false,
    body: () => ({ token }),
    onData,
  };
}

export function buildSidechatSendBody(
  token: string,
  submittedMessageId: string,
): { token: string; submittedMessageId: string } {
  return { token, submittedMessageId };
}

export function buildSidechatSendRequest(
  token: string,
  text: string,
  messageId: string,
): {
  message: {
    id: string;
    role: "user";
    parts: [{ type: "text"; text: string }];
  };
  options: { body: { token: string; submittedMessageId: string } };
} {
  return {
    message: {
      id: messageId,
      role: "user",
      parts: [{ type: "text", text }],
    },
    options: {
      body: buildSidechatSendBody(token, messageId),
    },
  };
}

export function deriveNativeSidechatUiStatus(options: {
  status: NativeSidechatUiStatus;
  isServerStreaming: boolean;
  isRecovering: boolean;
}): NativeSidechatUiStatus {
  if (options.status === "error") return "error";
  return options.status === "streaming" ||
      options.status === "submitted" ||
      options.isServerStreaming ||
      options.isRecovering
    ? "streaming"
    : "ready";
}

// Only a draft the user actually typed in the public composer is carried
// into a fresh Sidechat. An empty open never auto-sends anything: an
// unprompted message would send Maven into unrequested tool use.
export function planInitialSidechatSubmission(
  options: InitialSidechatSubmissionOptions,
): { messageId: string; text: string } | null {
  if (!options.session.created) return null;
  const captured = options.publicTextSnapshot.trim();
  if (!captured) return null;
  return {
    messageId: options.messageId,
    text: captured,
  };
}

export function reduceAcceptedSidechatTransfer(
  options: AcceptedSidechatTransferOptions,
): AcceptedSidechatTransferResult {
  const { transfer } = options;
  if (!transfer || transfer.messageId !== options.acceptedMessageId) {
    return { nextDraft: options.currentPublicDraft, transfer };
  }
  const shouldClear = shouldClearAcceptedPublicDraft({
    transferConversationId: transfer.conversationId,
    selectedConversationId: options.selectedConversationId,
    capturedText: transfer.textSnapshot,
    currentText: options.currentPublicDraft,
  });
  return {
    nextDraft: shouldClear ? "" : options.currentPublicDraft,
    transfer: null,
  };
}

export function planFailedSidechatRetry(options: {
  transfer: PendingSidechatTransfer | null;
  persistedMessageIds: ReadonlySet<string>;
}): FailedSidechatRetryPlan {
  const { transfer } = options;
  if (!transfer) return { kind: "regenerate" };
  if (options.persistedMessageIds.has(transfer.messageId)) {
    return {
      kind: "regenerate",
      acceptedMessageId: transfer.messageId,
    };
  }
  const text = transfer.textSnapshot.trim();
  if (!text) return { kind: "regenerate" };
  return {
    kind: "resubmit",
    messageId: transfer.messageId,
    text,
  };
}

interface SubmitSidechatApprovalOptions {
  mode: "always" | "once" | "deny";
  projectId: string;
  conversationId: string;
  approvalId: string;
  toolCallId: string;
  approveNative(approvalId: string, approved: boolean): Promise<void>;
  fetcher?: typeof fetch;
}

export async function submitSidechatApproval(
  options: SubmitSidechatApprovalOptions,
): Promise<void> {
  if (options.mode === "always") {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(
      `/api/projects/${encoded(options.projectId)}` +
        `/conversations/${encoded(options.conversationId)}` +
        `/sidechat/approvals/${encoded(options.approvalId)}/always`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCallId: options.toolCallId }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? `Request failed (${response.status})`);
    }
  }
  await options.approveNative(options.approvalId, options.mode !== "deny");
}

export function useSidechatParentState(
  session: SidechatSummarySessionResponse,
): MavenProjectState | undefined {
  const agent = useAgent<MavenProjectState>({
    agent: session.parentAgent,
    name: session.parentName,
    query: { token: session.token },
    queryDeps: [session.token],
  });
  return agent.state;
}

export function useSidechatAgent(
  options: UseSidechatAgentOptions,
): SidechatAgentController {
  const [acceptedMessageIds, setAcceptedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const agent = useAgent(
    buildSidechatAgentConnectionOptions(options.session),
  );
  const { onSafeActivity, onTurnAccepted } = options;
  const onData = useCallback((value: unknown) => {
    const parsed = readSafeSidechatDataPart(value);
    if (!parsed) return;
    if (parsed.type === "turn-accepted") {
      setAcceptedMessageIds((current) => {
        if (current.has(parsed.messageId)) return current;
        const next = new Set(current);
        next.add(parsed.messageId);
        return next;
      });
      onTurnAccepted?.(parsed.messageId);
      return;
    }
    onSafeActivity?.(parsed);
  }, [onSafeActivity, onTurnAccepted]);
  const chatContract = buildSidechatChatOptions(options.session.token, onData);
  const chatOptions = {
    agent,
    resume: chatContract.resume,
    cancelOnClientAbort: chatContract.cancelOnClientAbort,
    body: chatContract.body,
    onData: chatContract.onData,
    autoContinueAfterToolResult: true,
  } as Parameters<typeof useAgentChat>[0];
  const chat = useAgentChat(chatOptions);
  const {
    addToolApprovalResponse,
    regenerate,
    sendMessage,
    stop,
  } = chat;
  // Fallback clock for messages without a persisted createdAt; captured once
  // so re-renders never shift the displayed times.
  const fallbackNow = useRef(Date.now());
  const messages = useMemo(
    () => adaptSidechatMessages(chat.messages, {
      canAlwaysAllow: options.session.canAlwaysAllow,
      now: fallbackNow.current,
    }),
    [chat.messages, options.session.canAlwaysAllow],
  );

  const send = useCallback(async (text: string, messageId?: string) => {
    const id = messageId ?? crypto.randomUUID();
    const request = buildSidechatSendRequest(options.session.token, text, id);
    await sendMessage(request.message, request.options);
    return id;
  }, [options.session.token, sendMessage]);

  const retry = useCallback(async () => {
    await stop();
    await regenerate({ body: { token: options.session.token } });
  }, [options.session.token, regenerate, stop]);

  const approve = useCallback(async (
    approvalId: string,
    toolCallId: string,
    mode: "always" | "once" | "deny",
  ) => {
    await submitSidechatApproval({
      mode,
      projectId: options.session.parentName,
      conversationId: options.conversationId,
      approvalId,
      toolCallId,
      approveNative: async (id, approved) => {
        await addToolApprovalResponse({ id, approved });
      },
    });
  }, [
    addToolApprovalResponse,
    options.conversationId,
    options.session.parentName,
  ]);

  return {
    messages,
    nativeMessages: chat.messages,
    status: chat.status,
    error: chat.error,
    isStreaming: chat.isStreaming,
    isServerStreaming: chat.isServerStreaming,
    isRecovering: chat.isRecovering,
    acceptedMessageIds,
    send,
    stop,
    retry,
    approve,
  };
}
