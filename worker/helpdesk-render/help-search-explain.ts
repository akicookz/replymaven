import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { AppEnv } from "../types";
import {
  helpArticlesFolderFilter,
  resolveHelpSearchResults,
  toHelpSearchResultCards,
} from "./help-search";

export const HELP_EXPLAIN_SYSTEM_PROMPT =
  "Answer using only the retrieved help articles. Be brief and concrete. If the articles do not contain the answer, say so in one sentence.";

interface SupportbotSearch {
  chatCompletions(input: {
    messages: Array<{ role: "system" | "user"; content: string }>;
    stream: true;
    ai_search_options: {
      retrieval: {
        retrieval_type: "hybrid" | "vector";
        filters: unknown;
        max_num_results: number;
        match_threshold: number;
      };
      query_rewrite: { enabled: boolean };
    };
  }): Promise<ReadableStream<Uint8Array> | Response>;
}

export function isHybridRetrievalUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("retrieval_type 'hybrid' is not available") &&
    error.message.includes("keyword indexing is disabled")
  );
}

export function encodeHelpExplainEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export function parseHelpExplainSourceBlock(
  eventName: string | null,
  data: string,
): { kind: "chunks"; chunks: unknown } | { kind: "token"; text: string } | { kind: "done" } | null {
  const trimmed = data.trim();
  if (trimmed === "[DONE]") return { kind: "done" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (eventName === "chunks") {
    return { kind: "chunks", chunks: parsed };
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const choice = first as Record<string, unknown>;
  const delta =
    typeof choice.delta === "object" && choice.delta !== null
      ? (choice.delta as Record<string, unknown>)
      : null;
  if (typeof delta?.content !== "string" || delta.content.length === 0) {
    return null;
  }
  return { kind: "token", text: delta.content };
}

export function transformHelpExplainStream(options: {
  source: ReadableStream<Uint8Array>;
  articles: HelpArticleNav[];
  categories: HelpCategoryRow[];
  projectId: string;
  projectSlug: string;
  customUrl: string | null;
}): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";
  let sentArticles = false;
  const reader = options.source.getReader();

  function emitArticles(chunks: unknown): Uint8Array | null {
    if (sentArticles) return null;
    const results = resolveHelpSearchResults(
      chunks,
      options.articles,
      options.categories,
      options.projectId,
    );
    sentArticles = true;
    return encodeHelpExplainEvent(
      "articles",
      toHelpSearchResultCards(results, options.projectSlug, options.customUrl),
    );
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const read = await reader.read();
      if (read.done) {
        if (buffer.trim()) {
          flushBlock(buffer, controller, emitArticles);
        }
        controller.enqueue(encodeHelpExplainEvent("done", {}));
        controller.close();
        return;
      }

      buffer += decoder.decode(read.value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        flushBlock(block, controller, emitArticles);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function startHelpExplainSource(
  ai: AppEnv["AI"],
  projectId: string,
  query: string,
): Promise<ReadableStream<Uint8Array>> {
  const binding = ai as unknown as {
    aiSearch?: () => { get: (name: string) => SupportbotSearch };
  };
  const instance = binding.aiSearch?.().get("supportbot");
  if (!instance) {
    throw new Error("AI Search binding is missing");
  }
  const search = instance;

  async function start(
    retrievalType: "hybrid" | "vector",
  ): Promise<ReadableStream<Uint8Array>> {
    const raw = await search.chatCompletions({
      messages: [
        { role: "system", content: HELP_EXPLAIN_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      stream: true,
      ai_search_options: {
        retrieval: {
          retrieval_type: retrievalType,
          filters: {
            folder: helpArticlesFolderFilter(projectId),
          } as never,
          max_num_results: 8,
          match_threshold: 0.2,
        },
        query_rewrite: { enabled: false },
      },
    });
    const stream = raw instanceof Response ? raw.body : raw;
    if (!stream) {
      throw new Error("help explain stream missing");
    }
    return stream;
  }

  try {
    return await start("hybrid");
  } catch (error) {
    if (!isHybridRetrievalUnavailableError(error)) throw error;
    return start("vector");
  }
}

function flushBlock(
  block: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  emitArticles: (chunks: unknown) => Uint8Array | null,
): void {
  const parsed = parseSseBlock(block);
  if (!parsed) return;
  const event = parseHelpExplainSourceBlock(parsed.eventName, parsed.data);
  if (!event) return;
  if (event.kind === "chunks") {
    const encoded = emitArticles(event.chunks);
    if (encoded) controller.enqueue(encoded);
    return;
  }
  if (event.kind === "token") {
    controller.enqueue(encodeHelpExplainEvent("token", { text: event.text }));
  }
}

function parseSseBlock(
  block: string,
): { eventName: string | null; data: string } | null {
  let eventName: string | null = null;
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { eventName, data: dataLines.join("\n") };
}
