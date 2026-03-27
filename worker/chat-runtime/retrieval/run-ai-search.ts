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
}

export async function runAiSearch(options: {
  env: Pick<AppEnv, "AI" | "UPLOADS">;
  db: import("drizzle-orm/d1").DrizzleD1Database<Record<string, unknown>>;
  projectId: string;
  queries: string[];
}): Promise<RetrievalResult> {
  const searchResults = await Promise.all(
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
              max_num_results: 12,
              match_threshold: 0.2,
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

  const mergedChunks = mergeRetrievedSearchChunks(
    searchResults.map((result) => result?.chunks ?? []),
  );
  const prepared = prepareRagChunks(mergedChunks, options.projectId);

  const resourceService = new ResourceService(options.db, options.env.UPLOADS);
  const sourceReferenceMap = await resourceService.resolveSourceReferenceMap(
    options.projectId,
    prepared.chunks.map((chunk) => chunk.key),
  );
  const ragSelection = buildRagContext(prepared.chunks, sourceReferenceMap);

  if (!ragSelection.context) {
    return {
      ragContext: "",
      sourceReferences: [],
      groundingConfidence: "none",
      unresolvedKeys: [],
      droppedCrossTenant: prepared.droppedCrossTenant,
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
  };
}
