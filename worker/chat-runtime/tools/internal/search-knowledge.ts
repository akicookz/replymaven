import { type DrizzleD1Database } from "drizzle-orm/d1";
import { z } from "zod";
import { type SourceReference } from "../../../services/resource-service";
import { type AppEnv } from "../../../types";
import { getSourceReferenceDedupKey } from "../../retrieval/build-rag-context";
import { runAiSearch } from "../../retrieval/run-ai-search";
import { type MavenToolDefinition, type MavenTurnContext } from "../../types";

const SEARCH_KNOWLEDGE_MAX_QUERY_CHARS = 220;
const SEARCH_KNOWLEDGE_MAX_CONTEXT_CHARS = 12_000;
const SEARCH_KNOWLEDGE_MAX_SOURCES = 5;

export interface SearchKnowledgeInput {
  query: string;
}

export interface SearchKnowledgeResult {
  found: boolean;
  context: string;
  sources: SourceReference[];
  topScore: number;
}

const searchKnowledgeInputSchema = z
  .object({
    query: z.string().trim().min(1).max(SEARCH_KNOWLEDGE_MAX_QUERY_CHARS),
  })
  .strict();

function createEmptySearchKnowledgeResult(): SearchKnowledgeResult {
  return {
    found: false,
    context: "",
    sources: [],
    topScore: 0,
  };
}

function trimContext(context: string): string {
  return context.length > SEARCH_KNOWLEDGE_MAX_CONTEXT_CHARS
    ? context.slice(0, SEARCH_KNOWLEDGE_MAX_CONTEXT_CHARS)
    : context;
}

function selectSafeSources(sources: SourceReference[]): SourceReference[] {
  const sourceMap = new Map<string, SourceReference>();

  for (const source of sources) {
    if (
      (source.type !== "webpage" && source.type !== "pdf" && source.type !== "faq") ||
      !source.title.trim()
    ) {
      continue;
    }

    const safeSource: SourceReference = {
      title: source.title,
      url: source.url,
      type: source.type,
    };
    const dedupKey = getSourceReferenceDedupKey(safeSource);
    if (!sourceMap.has(dedupKey)) {
      sourceMap.set(dedupKey, safeSource);
    }
    if (sourceMap.size >= SEARCH_KNOWLEDGE_MAX_SOURCES) break;
  }

  return [...sourceMap.values()];
}

function createCapability(projectId: string): MavenToolDefinition["capability"] {
  return {
    id: "internal-search-knowledge",
    projectId,
    connectionId: null,
    modelName: "search_knowledge",
    displayName: "Search knowledge",
    source: "internal",
    allowedChannels: ["public", "sidechat"],
    access: "read",
    enabled: true,
    schemaFingerprint: "internal-search-knowledge-v1",
  };
}

export function createSearchKnowledgeTool(dependencies: {
  env: AppEnv;
  db: DrizzleD1Database<Record<string, unknown>>;
  context: MavenTurnContext;
  collectSources(sources: SourceReference[]): void;
}): MavenToolDefinition {
  const capability = createCapability(dependencies.context.projectId);

  return {
    capability,
    description:
      "Search the project's knowledge base for documented facts needed to answer the visitor.",
    inputSchema: searchKnowledgeInputSchema,
    async execute(input) {
      const parsedInput = searchKnowledgeInputSchema.safeParse(input);
      if (!parsedInput.success) return createEmptySearchKnowledgeResult();

      try {
        const retrieval = await runAiSearch({
          env: dependencies.env,
          db: dependencies.db,
          projectId: dependencies.context.projectId,
          queries: [parsedInput.data.query],
          allowBroaderRetry: false,
        });
        const context = trimContext(retrieval.ragContext);
        if (!context.trim()) return createEmptySearchKnowledgeResult();

        const sources = selectSafeSources(retrieval.sourceReferences);
        dependencies.collectSources(sources);

        return {
          found: true,
          context,
          sources,
          topScore: Number.isFinite(retrieval.topScore)
            ? retrieval.topScore
            : 0,
        };
      } catch {
        return createEmptySearchKnowledgeResult();
      }
    },
    async reauthorize() {
      return capability;
    },
  };
}
