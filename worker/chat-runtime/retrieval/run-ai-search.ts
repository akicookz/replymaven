import { type SourceReference, ResourceService } from "../../services/resource-service";
import { type AppEnv } from "../../types";
import { buildRagContext, prepareRagChunks } from "./build-rag-context";
import { mergeRetrievedSearchChunks } from "./merge-search-chunks";
import { type GroundingConfidence } from "../types";

export interface RetrievalResult {
  ragContext: string;
  sourceReferences: SourceReference[];
  groundingConfidence: GroundingConfidence;
  unresolvedKeys: string[];
  droppedCrossTenant: number;
  retrievalAttempted: boolean;
  broaderSearchAttempted: boolean;
}

async function executeSearchPass(options: {
  env: Pick<AppEnv, "AI">;
  projectId: string;
  queries: string[];
  matchThreshold: number;
  maxResults: number;
}) {
  return Promise.all(
    options.queries.map((query) =>
      options.env.AI.aiSearch()
        .get("supportbot")
        .search({
          messages: [{ role: "user", content: query }],
          ai_search_options: {
            retrieval: {
              retrieval_type: "hybrid",
              filters: {
                type: "eq",
                key: "folder",
                value: `${options.projectId}/`,
              },
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
        }),
    ),
  );
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
      sourceReferences: [],
      groundingConfidence: "none",
      unresolvedKeys: [],
      droppedCrossTenant: 0,
      retrievalAttempted: false,
      broaderSearchAttempted: false,
    };
  }

  let broaderSearchAttempted = false;
  let searchResults = await executeSearchPass({
    env: options.env,
    projectId: options.projectId,
    queries: options.queries,
    matchThreshold: 0.2,
    maxResults: 12,
  });

  const mergedChunks = mergeRetrievedSearchChunks(
    searchResults.map((result) => result?.chunks ?? []),
  );
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
    searchResults = await executeSearchPass({
      env: options.env,
      projectId: options.projectId,
      queries: broaderQueries,
      matchThreshold: 0.1,
      maxResults: 18,
    });

    const broaderMergedChunks = mergeRetrievedSearchChunks(
      searchResults.map((result) => result?.chunks ?? []),
    );
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
      sourceReferences: [],
      groundingConfidence: "none",
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
    sourceReferences: ragSelection.sources,
    groundingConfidence: ragConfident ? "high" : "low",
    unresolvedKeys: ragSelection.unresolvedKeys,
    droppedCrossTenant: prepared.droppedCrossTenant,
    retrievalAttempted: true,
    broaderSearchAttempted,
  };
}
