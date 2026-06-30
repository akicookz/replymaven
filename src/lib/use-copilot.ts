import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface CopilotMessage {
  id: string;
  role: "agent" | "copilot";
  content: string;
  sources: string | null;
  agentUserId: string | null;
  autoSuggest: boolean;
  createdAt: string;
  _streaming?: boolean;
  _toolCalls?: Array<{
    name: string;
    args: unknown;
    success?: boolean;
    output?: unknown;
    errorMessage?: string;
  }>;
}

export interface CopilotSourceRef {
  title: string;
  url?: string | null;
  type?: "webpage" | "pdf" | "faq";
}

interface SsePayload {
  text?: string;
  finalText?: string;
  done?: boolean;
  messageId?: string;
  sources?: CopilotSourceRef[];
  status?: { phase?: string; message?: string };
  toolCall?: { name: string; args?: unknown };
  toolResult?: { name: string; success?: boolean; output?: unknown; errorMessage?: string };
  error?: string;
}

const COPILOT_QUERY_KEY = (convId: string) => ["copilot-thread", convId];

export function useCopilotThread(
  projectId: string,
  conversationId: string | null,
) {
  return useQuery<CopilotMessage[]>({
    queryKey: COPILOT_QUERY_KEY(conversationId ?? ""),
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/conversations/${conversationId}/copilot/messages`,
      );
      if (!res.ok) throw new Error("Failed to load Copilot thread");
      return res.json();
    },
    enabled: !!conversationId && !!projectId,
  });
}

interface SendOptions {
  endpoint: "messages" | "auto-suggest";
  content?: string;
  // Auto-suggest only: force a fresh draft, replacing any prior auto-suggestion
  // (the "Rewrite" action). Without it the endpoint is one-shot (409 if a
  // thread already exists).
  regenerate?: boolean;
}

export function useCopilotSender(
  projectId: string,
  conversationId: string,
) {
  const queryClient = useQueryClient();
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (options: SendOptions) => {
      if (isStreaming) return;
      setError(null);
      setIsStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const optimisticAgentId = `optimistic-agent-${Date.now()}`;
      const streamingCopilotId = `streaming-copilot-${Date.now()}`;
      const queryKey = COPILOT_QUERY_KEY(conversationId);

      // Optimistic inserts: agent question (skipped for auto-suggest) +
      // a placeholder copilot row that accumulates streamed text.
      queryClient.setQueryData<CopilotMessage[] | undefined>(queryKey, (old) => {
        // Regenerating drops the stale auto-suggestion(s) optimistically so the
        // chip shows only the new draft as it streams (the server deletes them
        // too). Agent↔Copilot Q&A rows are kept.
        const base = (old ?? []).filter(
          (m) => !(options.regenerate && m.autoSuggest),
        );
        const next: CopilotMessage[] = [...base];
        if (options.endpoint === "messages" && options.content) {
          next.push({
            id: optimisticAgentId,
            role: "agent",
            content: options.content,
            sources: null,
            agentUserId: null,
            autoSuggest: false,
            createdAt: new Date().toISOString(),
          });
        }
        next.push({
          id: streamingCopilotId,
          role: "copilot",
          content: "",
          sources: null,
          agentUserId: null,
          autoSuggest: options.endpoint === "auto-suggest",
          createdAt: new Date().toISOString(),
          _streaming: true,
          _toolCalls: [],
        });
        return next;
      });

      try {
        const url =
          options.endpoint === "auto-suggest"
            ? `/api/projects/${projectId}/conversations/${conversationId}/copilot/auto-suggest`
            : `/api/projects/${projectId}/conversations/${conversationId}/copilot/messages`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body:
            options.endpoint === "messages"
              ? JSON.stringify({ content: options.content })
              : JSON.stringify({ regenerate: !!options.regenerate }),
          signal: controller.signal,
        });

        if (!res.ok) {
          // 409 = thread already exists for auto-suggest. Refetch and bail.
          if (res.status === 409) {
            queryClient.invalidateQueries({ queryKey });
            return;
          }
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Copilot request failed (${res.status})`);
        }
        if (!res.body) throw new Error("Copilot stream returned no body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        function patchStreaming(mut: (m: CopilotMessage) => CopilotMessage) {
          queryClient.setQueryData<CopilotMessage[] | undefined>(
            queryKey,
            (old) => {
              if (!old) return old;
              return old.map((m) =>
                m.id === streamingCopilotId ? mut(m) : m,
              );
            },
          );
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let payload: SsePayload;
            try {
              payload = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (payload.text) {
              patchStreaming((m) => ({ ...m, content: m.content + payload.text }));
            }
            if (payload.finalText) {
              patchStreaming((m) => ({ ...m, content: payload.finalText! }));
            }
            if (payload.toolCall) {
              patchStreaming((m) => ({
                ...m,
                _toolCalls: [
                  ...(m._toolCalls ?? []),
                  { name: payload.toolCall!.name, args: payload.toolCall!.args },
                ],
              }));
            }
            if (payload.toolResult) {
              patchStreaming((m) => {
                const calls = [...(m._toolCalls ?? [])];
                for (let i = calls.length - 1; i >= 0; i--) {
                  if (
                    calls[i].name === payload.toolResult!.name &&
                    calls[i].success === undefined
                  ) {
                    calls[i] = {
                      ...calls[i],
                      success: payload.toolResult!.success,
                      output: payload.toolResult!.output,
                      errorMessage: payload.toolResult!.errorMessage,
                    };
                    break;
                  }
                }
                return { ...m, _toolCalls: calls };
              });
            }
            if (payload.done) {
              patchStreaming((m) => ({
                ...m,
                id: payload.messageId ?? m.id,
                sources: payload.sources
                  ? JSON.stringify(payload.sources)
                  : m.sources,
                _streaming: false,
              }));
            }
            if (payload.error) {
              setError(payload.error);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // cancelled
        } else {
          const msg = err instanceof Error ? err.message : "Copilot failed";
          setError(msg);
          // Mark streaming row as errored so UI can surface it.
          queryClient.setQueryData<CopilotMessage[] | undefined>(queryKey, (old) => {
            if (!old) return old;
            return old.map((m) =>
              m.id === streamingCopilotId
                ? { ...m, content: m.content || msg, _streaming: false }
                : m,
            );
          });
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [conversationId, isStreaming, projectId, queryClient],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, cancel, isStreaming, error };
}
