import { describe, expect, test } from "bun:test";
import { type AppEnv } from "../../types";
import { runAiSearch } from "./run-ai-search";

type RetrievalType = "hybrid" | "vector";

interface SearchRequest {
  ai_search_options: {
    retrieval: {
      retrieval_type: RetrievalType;
      filters: {
        folder: {
          $gte: string;
        };
      };
    };
  };
}

interface RecordedSearch {
  projectPrefix: string;
  retrievalType: RetrievalType;
}

interface FakeAiSearch {
  binding: AppEnv["AI"];
  searches: RecordedSearch[];
}

interface MemoryKv {
  namespace: KVNamespace;
  values: Map<string, string>;
}

function createFakeAiSearch(
  hybridUnavailableProjectPrefixes: Set<string> = new Set(),
): FakeAiSearch {
  const searches: RecordedSearch[] = [];
  const binding = {
    aiSearch() {
      return {
        get() {
          return {
            async search(request: SearchRequest) {
              const retrieval = request.ai_search_options.retrieval;
              const projectPrefix = retrieval.filters.folder.$gte;
              searches.push({
                projectPrefix,
                retrievalType: retrieval.retrieval_type,
              });
              if (
                retrieval.retrieval_type === "hybrid" &&
                hybridUnavailableProjectPrefixes.has(projectPrefix)
              ) {
                throw new Error(
                  "retrieval_type 'hybrid' is not available because keyword indexing is disabled",
                );
              }
              return { success: true, result: { chunks: [] } };
            },
          };
        },
      };
    },
  } as unknown as AppEnv["AI"];

  return { binding, searches };
}

function createMemoryKv(initialValues: Record<string, string> = {}): MemoryKv {
  const values = new Map(Object.entries(initialValues));
  const namespace = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;

  return { namespace, values };
}

async function searchProject(options: {
  ai: AppEnv["AI"];
  kv: KVNamespace;
  projectId: string;
  runtimeState: { hybridUnavailableProjects: Set<string> };
}): Promise<void> {
  await runAiSearch({
    env: {
      AI: options.ai,
      UPLOADS: {} as R2Bucket,
      CONVERSATIONS_CACHE: options.kv,
    },
    db: {} as never,
    projectId: options.projectId,
    queries: ["pricing"],
    allowBroaderRetry: false,
    runtimeState: options.runtimeState,
  });
}

describe("runAiSearch hybrid fallback", () => {
  test("an unavailable hybrid search retries vector, persists the marker, and leaves another project on hybrid", async () => {
    const unavailableProjectId = "project-boundary-unavailable";
    const unaffectedProjectId = "project-boundary-unaffected";
    const ai = createFakeAiSearch(new Set([`${unavailableProjectId}/`]));
    const kv = createMemoryKv();
    const runtimeState = { hybridUnavailableProjects: new Set<string>() };

    await searchProject({
      ai: ai.binding,
      kv: kv.namespace,
      projectId: unavailableProjectId,
      runtimeState,
    });
    await searchProject({
      ai: ai.binding,
      kv: kv.namespace,
      projectId: unaffectedProjectId,
      runtimeState,
    });

    expect(ai.searches).toEqual([
      {
        projectPrefix: `${unavailableProjectId}/`,
        retrievalType: "hybrid",
      },
      {
        projectPrefix: `${unavailableProjectId}/`,
        retrievalType: "vector",
      },
      {
        projectPrefix: `${unaffectedProjectId}/`,
        retrievalType: "hybrid",
      },
    ]);
    expect(
      kv.values.get(`hybrid_unavailable:${unavailableProjectId}`),
    ).toBe("1");
    expect(
      kv.values.has(`hybrid_unavailable:${unaffectedProjectId}`),
    ).toBe(false);
  });

  test("a cold project marker starts the search with vector retrieval", async () => {
    const projectId = "project-boundary-cold-marker";
    const ai = createFakeAiSearch();
    const kv = createMemoryKv({
      [`hybrid_unavailable:${projectId}`]: "1",
    });
    const runtimeState = { hybridUnavailableProjects: new Set<string>() };

    await searchProject({
      ai: ai.binding,
      kv: kv.namespace,
      projectId,
      runtimeState,
    });

    expect(ai.searches).toEqual([
      { projectPrefix: `${projectId}/`, retrievalType: "vector" },
    ]);
  });
});
