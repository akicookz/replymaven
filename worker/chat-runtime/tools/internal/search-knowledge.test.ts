import { describe, expect, test } from "bun:test";
import { type AppEnv } from "../../../types";
import { type SourceReference } from "../../../services/resource-service";
import { type MavenTurnContext } from "../../types";
import { createSearchKnowledgeTool } from "./search-knowledge";

type RetrievalType = "hybrid" | "vector";

interface SearchRequest {
  ai_search_options: {
    retrieval: {
      filters: {
        folder: {
          $gte: string;
        };
      };
      retrieval_type: RetrievalType;
    };
  };
}

interface SearchChunk {
  item: { key: string };
  score: number;
  text: string;
}

interface FakeAiSearch {
  binding: AppEnv["AI"];
  projectPrefixes: string[];
}

interface SearchKnowledgeResult {
  found: boolean;
  context: string;
  sources: SourceReference[];
  topScore: number;
}

function createContext(
  channel: MavenTurnContext["channel"],
  projectId: string,
): MavenTurnContext {
  return {
    channel,
    projectId,
    conversationId: "conversation-1",
    actorUserId: null,
    customerId: null,
    ownership: {
      status: "active",
      chatState: null,
    },
  };
}

function createFakeAiSearch(options: {
  chunks?: SearchChunk[];
  unavailable?: boolean;
  providerMetadata?: unknown;
} = {}): FakeAiSearch {
  const projectPrefixes: string[] = [];
  const binding = {
    aiSearch() {
      return {
        get() {
          return {
            async search(request: SearchRequest) {
              projectPrefixes.push(
                request.ai_search_options.retrieval.filters.folder.$gte,
              );
              if (options.unavailable) {
                throw new Error("AI Search is unavailable");
              }
              return {
                success: true,
                result: { chunks: options.chunks ?? [] },
                providerMetadata: options.providerMetadata,
              };
            },
          };
        },
      };
    },
  } as unknown as AppEnv["AI"];

  return { binding, projectPrefixes };
}

function createSourceResolvingDb(
  rows: Array<{
    r2Key: string;
    type: "webpage" | "pdf" | "faq";
    title: string;
    url: string | null;
  }>,
): never {
  let selectCount = 0;

  function createQuery(result: unknown[]): {
    from(): ReturnType<typeof createQuery>;
    leftJoin(): ReturnType<typeof createQuery>;
    where(): ReturnType<typeof createQuery>;
    limit(): Promise<unknown[]>;
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  } {
    return {
      from() {
        return createQuery(result);
      },
      leftJoin() {
        return createQuery(result);
      },
      where() {
        return createQuery(result);
      },
      async limit() {
        return result;
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };
  }

  return {
    select() {
      selectCount += 1;
      return createQuery(
        selectCount === 1
          ? [{ slug: null, helpCustomUrl: null }]
          : rows,
      );
    },
  } as never;
}

function getInputSchema(definition: ReturnType<typeof createSearchKnowledgeTool>): {
  safeParse(input: unknown): { success: boolean };
} {
  return definition.inputSchema as {
    safeParse(input: unknown): { success: boolean };
  };
}

describe("createSearchKnowledgeTool", () => {
  test("uses only a bounded query and trusted project identity for both Maven channels", async () => {
    const publicSearch = createFakeAiSearch();
    const sidechatSearch = createFakeAiSearch();
    const publicTool = createSearchKnowledgeTool({
      env: {
        AI: publicSearch.binding,
        UPLOADS: {} as R2Bucket,
      } as AppEnv,
      db: {} as never,
      context: createContext("public", "public-project"),
      collectSources() {},
    });
    const sidechatTool = createSearchKnowledgeTool({
      env: {
        AI: sidechatSearch.binding,
        UPLOADS: {} as R2Bucket,
      } as AppEnv,
      db: {} as never,
      context: createContext("sidechat", "sidechat-project"),
      collectSources() {},
    });

    expect(publicTool.capability.allowedChannels).toEqual([
      "public",
      "sidechat",
    ]);
    expect(sidechatTool.capability.allowedChannels).toEqual([
      "public",
      "sidechat",
    ]);
    expect(getInputSchema(publicTool).safeParse({ query: "pricing" }).success).toBe(
      true,
    );
    expect(
      getInputSchema(publicTool).safeParse({
        query: "x".repeat(221),
      }).success,
    ).toBe(false);
    expect(
      getInputSchema(publicTool).safeParse({
        query: "pricing",
        projectId: "untrusted-project",
      }).success,
    ).toBe(false);

    await publicTool.execute({ query: "pricing" }, {});
    await sidechatTool.execute({ query: "pricing" }, {});

    expect(publicSearch.projectPrefixes).toEqual(["public-project/"]);
    expect(sidechatSearch.projectPrefixes).toEqual(["sidechat-project/"]);
  });

  test("returns bounded normalized context and safe deduplicated sources", async () => {
    const projectId = "project-knowledge";
    const chunks: SearchChunk[] = Array.from({ length: 6 }, (_, index) => ({
      item: { key: `${projectId}/article-${index}.md` },
      score: 0.9 - index * 0.01,
      text: `Article ${index}: ${"evidence ".repeat(500)}`,
    }));
    const search = createFakeAiSearch({
      chunks,
      providerMetadata: { privateProviderId: "do-not-return" },
    });
    const collected = new Map<string, SourceReference>();
    const tool = createSearchKnowledgeTool({
      env: {
        AI: search.binding,
        UPLOADS: {} as R2Bucket,
      } as AppEnv,
      db: createSourceResolvingDb(
        chunks.map((chunk, index) => ({
          r2Key: chunk.item.key,
          type: "webpage" as const,
          title: `Article ${index}`,
          url: `https://example.com/article-${index}`,
        })),
      ),
      context: createContext("public", projectId),
      collectSources(sources) {
        for (const source of sources) {
          collected.set(`${source.type}:${source.url ?? source.title}`, source);
        }
      },
    });

    const result = (await tool.execute(
      { query: "How does billing work?" },
      {},
    )) as SearchKnowledgeResult;

    expect(Object.keys(result).sort()).toEqual([
      "context",
      "found",
      "sources",
      "topScore",
    ]);
    expect(result.found).toBe(true);
    expect(result.context.length).toBeLessThanOrEqual(12_000);
    expect(result.sources).toHaveLength(5);
    expect(result.sources.every((source) => {
      return Object.keys(source).sort().join(",") === "title,type,url";
    })).toBe(true);
    expect([...collected.values()]).toEqual(result.sources);
    expect(JSON.stringify(result)).not.toContain("privateProviderId");
  });

  test("normalizes empty and unavailable searches to the same safe result shape", async () => {
    const emptySearch = createFakeAiSearch();
    const unavailableSearch = createFakeAiSearch({ unavailable: true });
    const emptyTool = createSearchKnowledgeTool({
      env: { AI: emptySearch.binding, UPLOADS: {} as R2Bucket } as AppEnv,
      db: {} as never,
      context: createContext("public", "empty-project"),
      collectSources() {},
    });
    const unavailableTool = createSearchKnowledgeTool({
      env: {
        AI: unavailableSearch.binding,
        UPLOADS: {} as R2Bucket,
      } as AppEnv,
      db: {} as never,
      context: createContext("sidechat", "unavailable-project"),
      collectSources() {},
    });

    const expected = {
      found: false,
      context: "",
      sources: [],
      topScore: 0,
    };

    await expect(emptyTool.execute({ query: "pricing" }, {})).resolves.toEqual(
      expected,
    );
    await expect(
      unavailableTool.execute({ query: "pricing" }, {}),
    ).resolves.toEqual(expected);
  });
});
