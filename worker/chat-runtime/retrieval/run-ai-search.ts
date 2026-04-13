import { type SourceReference, ResourceService } from "../../services/resource-service";
import { logInfo, logWarn } from "../../observability";
import { type AppEnv } from "../../types";
import { buildRagContext, prepareRagChunks } from "./build-rag-context";
import { mergeRetrievedSearchChunks } from "./merge-search-chunks";
import { type GroundingConfidence, type RetrievedSearchChunk } from "../types";

export interface RetrievalResult {
  ragContext: string;
  faqContext: string;
  knowledgeBaseContext: string;
  sourceReferences: SourceReference[];
  groundingConfidence: GroundingConfidence;
  topScore: number;
  unresolvedKeys: string[];
  droppedCrossTenant: number;
  retrievalAttempted: boolean;
  broaderSearchAttempted: boolean;
}

type SearchRetrievalType = "hybrid" | "vector";
type SearchResponseKind = "result_chunks" | "chunks" | "data" | "unknown";

interface SearchPassResult {
  results: RetrievedSearchChunk[][];
  retrievalType: SearchRetrievalType;
}

interface NormalizedSearchResponse {
  chunks: RetrievedSearchChunk[];
  responseKind: SearchResponseKind;
  success: boolean | null;
  topLevelKeys: string[];
  resultKeys: string[];
  rawChunkCount: number;
  rawDataCount: number;
}

function isHybridRetrievalUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message.includes("retrieval_type 'hybrid' is not available") &&
    error.message.includes("keyword indexing is disabled")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeChunkArray(chunks: unknown[]): RetrievedSearchChunk[] {
  return chunks.flatMap((chunk) => {
    if (!isRecord(chunk)) {
      return [];
    }

    const item = isRecord(chunk.item) ? chunk.item : null;

    return [
      {
        item:
          item && typeof item.key === "string"
            ? { key: item.key }
            : undefined,
        score: typeof chunk.score === "number" ? chunk.score : undefined,
        text: typeof chunk.text === "string" ? chunk.text : undefined,
      },
    ];
  });
}

function normalizeDataArray(data: unknown[]): RetrievedSearchChunk[] {
  return data.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }

    const filename =
      typeof entry.filename === "string" ? entry.filename : undefined;
    const score = typeof entry.score === "number" ? entry.score : undefined;
    const content = Array.isArray(entry.content) ? entry.content : [];

    return content.flatMap((part) => {
      if (!isRecord(part) || typeof part.text !== "string") {
        return [];
      }

      return [
        {
          item: filename ? { key: filename } : undefined,
          score,
          text: part.text,
        },
      ];
    });
  });
}

function normalizeSearchResponse(response: unknown): NormalizedSearchResponse {
  if (!isRecord(response)) {
    return {
      chunks: [],
      responseKind: "unknown",
      success: null,
      topLevelKeys: [],
      resultKeys: [],
      rawChunkCount: 0,
      rawDataCount: 0,
    };
  }

  const topLevelKeys = Object.keys(response).sort();
  const success = typeof response.success === "boolean" ? response.success : null;
  const result = isRecord(response.result) ? response.result : null;
  const resultKeys = result ? Object.keys(result).sort() : [];

  if (result && Array.isArray(result.chunks)) {
    return {
      chunks: normalizeChunkArray(result.chunks),
      responseKind: "result_chunks",
      success,
      topLevelKeys,
      resultKeys,
      rawChunkCount: result.chunks.length,
      rawDataCount: 0,
    };
  }

  if (Array.isArray(response.chunks)) {
    return {
      chunks: normalizeChunkArray(response.chunks),
      responseKind: "chunks",
      success,
      topLevelKeys,
      resultKeys,
      rawChunkCount: response.chunks.length,
      rawDataCount: 0,
    };
  }

  if (Array.isArray(response.data)) {
    return {
      chunks: normalizeDataArray(response.data),
      responseKind: "data",
      success,
      topLevelKeys,
      resultKeys,
      rawChunkCount: 0,
      rawDataCount: response.data.length,
    };
  }

  return {
    chunks: [],
    responseKind: "unknown",
    success,
    topLevelKeys,
    resultKeys,
    rawChunkCount: 0,
    rawDataCount: 0,
  };
}

async function searchWithRetrievalType(options: {
  env: Pick<AppEnv, "AI">;
  projectId: string;
  queries: string[];
  matchThreshold: number;
  maxResults: number;
  retrievalType: SearchRetrievalType;
}): Promise<RetrievedSearchChunk[][]> {
  return Promise.all(
    options.queries.map(async (query, index) => {
      const response = await options.env.AI.aiSearch()
        .get("supportbot")
        .search({
          messages: [{ role: "user", content: query }],
          ai_search_options: {
            retrieval: {
              retrieval_type: options.retrievalType,
              // The generated Worker typings still expose the legacy filter shape.
              filters: {
                folder: {
                  $eq: `${options.projectId}/`,
                },
              } as never,
              max_num_results: options.maxResults,
              match_threshold: options.matchThreshold,
            },
            query_rewrite: {
              enabled: false,
            },
            reranking: {
              enabled: true,
              model: "@cf/baai/bge-reranker-base",
            },
          },
        });

      const normalized = normalizeSearchResponse(response);

      logInfo("ai_search.search_response_received", {
        projectId: options.projectId,
        queryIndex: index,
        retrievalType: options.retrievalType,
        matchThreshold: options.matchThreshold,
        maxResults: options.maxResults,
        filterFolder: `${options.projectId}/`,
        responseKind: normalized.responseKind,
        success: normalized.success,
        topLevelKeys: normalized.topLevelKeys,
        resultKeys: normalized.resultKeys,
        rawChunkCount: normalized.rawChunkCount,
        rawDataCount: normalized.rawDataCount,
        normalizedChunkCount: normalized.chunks.length,
      });

      if (normalized.responseKind === "unknown") {
        logWarn("ai_search.search_response_unrecognized", {
          projectId: options.projectId,
          queryIndex: index,
          retrievalType: options.retrievalType,
          topLevelKeys: normalized.topLevelKeys,
          resultKeys: normalized.resultKeys,
        });
      } else if (normalized.chunks.length === 0) {
        logWarn("ai_search.search_returned_no_chunks", {
          projectId: options.projectId,
          queryIndex: index,
          retrievalType: options.retrievalType,
          responseKind: normalized.responseKind,
          success: normalized.success,
          filterFolder: `${options.projectId}/`,
        });
      }

      return normalized.chunks;
    }),
  );
}

async function executeSearchPass(options: {
  env: Pick<AppEnv, "AI">;
  projectId: string;
  queries: string[];
  matchThreshold: number;
  maxResults: number;
  retrievalType: SearchRetrievalType;
}): Promise<SearchPassResult> {
  try {
    return {
      results: await searchWithRetrievalType(options),
      retrievalType: options.retrievalType,
    };
  } catch (error) {
    if (
      options.retrievalType === "hybrid" &&
      isHybridRetrievalUnavailableError(error)
    ) {
      logWarn("ai_search.retrieval_type_fallback", {
        projectId: options.projectId,
        attemptedRetrievalType: "hybrid",
        fallbackRetrievalType: "vector",
        queryCount: options.queries.length,
        matchThreshold: options.matchThreshold,
        maxResults: options.maxResults,
      });

      const results = await searchWithRetrievalType({
        ...options,
        retrievalType: "vector",
      });

      logInfo("ai_search.retrieval_type_fallback_succeeded", {
        projectId: options.projectId,
        activeRetrievalType: "vector",
        queryCount: options.queries.length,
      });

      return {
        results,
        retrievalType: "vector",
      };
    }

    throw error;
  }
}

export async function runAiSearch(options: {
  env: Pick<AppEnv, "AI" | "UPLOADS">;
  db: import("drizzle-orm/d1").DrizzleD1Database<Record<string, unknown>>;
  projectId: string;
  queries: string[];
  broaderQueries?: string[];
  allowBroaderRetry?: boolean;
}): Promise<RetrievalResult> {
  if (options.queries.length === 0) {
    return {
      ragContext: "",
      faqContext: "",
      knowledgeBaseContext: "",
      sourceReferences: [],
      groundingConfidence: "none",
      unresolvedKeys: [],
      droppedCrossTenant: 0,
      retrievalAttempted: false,
      broaderSearchAttempted: false,
    };
  }

  let broaderSearchAttempted = false;
  let activeRetrievalType: SearchRetrievalType = "hybrid";
  let searchPass = await executeSearchPass({
    env: options.env,
    projectId: options.projectId,
    queries: options.queries,
    matchThreshold: 0.2,
    maxResults: 12,
    retrievalType: activeRetrievalType,
  });
  let searchResults = searchPass.results;
  activeRetrievalType = searchPass.retrievalType;

  const mergedChunks = mergeRetrievedSearchChunks(searchResults);
  let prepared = prepareRagChunks(mergedChunks, options.projectId);
  const resourceService = new ResourceService(options.db, options.env.UPLOADS);
  let sourceReferenceMap = await resourceService.resolveSourceReferenceMap(
    options.projectId,
    prepared.chunks.map((chunk) => chunk.key),
  );
  let ragSelection = buildRagContext(prepared.chunks, sourceReferenceMap);

  if (!ragSelection.context && options.allowBroaderRetry !== false) {
    const broaderQueries =
      options.broaderQueries && options.broaderQueries.length > 0
        ? options.broaderQueries
        : options.queries;

    broaderSearchAttempted = true;
    searchPass = await executeSearchPass({
      env: options.env,
      projectId: options.projectId,
      queries: broaderQueries,
      matchThreshold: 0.1,
      maxResults: 18,
      retrievalType: activeRetrievalType,
    });
    searchResults = searchPass.results;
    activeRetrievalType = searchPass.retrievalType;

    const broaderMergedChunks = mergeRetrievedSearchChunks(searchResults);
    prepared = prepareRagChunks(broaderMergedChunks, options.projectId);
    sourceReferenceMap = await resourceService.resolveSourceReferenceMap(
      options.projectId,
      prepared.chunks.map((chunk) => chunk.key),
    );
    ragSelection = buildRagContext(prepared.chunks, sourceReferenceMap);
  }

  if (!ragSelection.context) {
    return {
      ragContext: "",
      faqContext: "",
      knowledgeBaseContext: "",
      sourceReferences: [],
      groundingConfidence: "none",
      topScore: 0,
      unresolvedKeys: [],
      droppedCrossTenant: prepared.droppedCrossTenant,
      retrievalAttempted: true,
      broaderSearchAttempted,
    };
  }

  const ragConfident =
    ragSelection.topScore >= 0.6 && ragSelection.selectedChunkCount >= 2;

  const ragContext = ragConfident
    ? ragSelection.context
    : `NOTE: The following knowledge base results may not be directly relevant to the visitor's question. Only use them if they genuinely answer what the visitor asked. If none are relevant, tell the visitor you don't have that information.\n\n${ragSelection.context}`;

  return {
    ragContext,
    faqContext: ragSelection.faqContext,
    knowledgeBaseContext: ragSelection.knowledgeBaseContext,
    sourceReferences: ragSelection.sources,
    groundingConfidence: ragConfident ? "high" : "low",
    topScore: ragSelection.topScore,
    unresolvedKeys: ragSelection.unresolvedKeys,
    droppedCrossTenant: prepared.droppedCrossTenant,
    retrievalAttempted: true,
    broaderSearchAttempted,
  };
}
