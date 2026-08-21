import { describe, expect, test } from "bun:test";
import type { HelpCategoryRow } from "../db/schema";
import type { HelpArticleNav } from "../services/helpdesk-service";
import type { AppEnv } from "../types";
import {
  encodeHelpExplainEvent,
  isHybridRetrievalUnavailableError,
  parseHelpExplainSourceBlock,
  startHelpExplainSource,
  transformHelpExplainStream,
} from "./help-search-explain";

const PROJECT_ID = "proj-1";

const guides = {
  id: "cat-guides",
  name: "Guides",
  slug: "guides",
} as HelpCategoryRow;

const install = {
  id: "art-install",
  projectId: PROJECT_ID,
  categoryId: "cat-guides",
  title: "Install the chat widget",
  slug: "install-the-chat-widget",
  excerpt: "Add the embed script to your site.",
} as HelpArticleNav;

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    chunks.push(read.value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

describe("parseHelpExplainSourceBlock", () => {
  test("reads the chunks event and token deltas", () => {
    expect(
      parseHelpExplainSourceBlock(
        "chunks",
        '[{"item":{"key":"proj-1/articles/art-install.md"},"score":0.8}]',
      ),
    ).toEqual({
      kind: "chunks",
      chunks: [
        { item: { key: "proj-1/articles/art-install.md" }, score: 0.8 },
      ],
    });
    expect(
      parseHelpExplainSourceBlock(
        null,
        JSON.stringify({
          choices: [{ delta: { content: "Add the script" } }],
        }),
      ),
    ).toEqual({ kind: "token", text: "Add the script" });
    expect(parseHelpExplainSourceBlock(null, "[DONE]")).toEqual({
      kind: "done",
    });
  });
});

describe("transformHelpExplainStream", () => {
  test("emits resolved articles, tokens, then done", async () => {
    const source = streamOf(
      [
        'event: chunks\ndata: [{"item":{"key":"proj-1/articles/art-install.md"},"score":0.8}]\n\n',
        'data: {"choices":[{"delta":{"content":"Add "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"the script."}}]}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    );
    const out = await readAll(
      transformHelpExplainStream({
        source,
        articles: [install],
        categories: [guides],
        projectId: PROJECT_ID,
        projectSlug: "acme",
        customUrl: null,
      }),
    );
    expect(out).toContain("event: articles");
    expect(out).toContain("art-install");
    expect(out).toContain("Add ");
    expect(out).toContain("the script.");
    expect(out).toContain("event: done");
  });
});

describe("startHelpExplainSource", () => {
  test("retries vector when hybrid keyword indexing is off", async function () {
    const retrievalTypes: string[] = [];
    const ai = {
      aiSearch() {
        return {
          get() {
            return {
              async chatCompletions(input: {
                ai_search_options: {
                  retrieval: { retrieval_type: string };
                };
              }) {
                const retrievalType =
                  input.ai_search_options.retrieval.retrieval_type;
                retrievalTypes.push(retrievalType);
                if (retrievalType === "hybrid") {
                  throw new Error(
                    "retrieval_type 'hybrid' is not available because keyword indexing is disabled",
                  );
                }
                return streamOf("data: [DONE]\n\n");
              },
            };
          },
        };
      },
    };

    const stream = await startHelpExplainSource(
      ai as unknown as AppEnv["AI"],
      PROJECT_ID,
      "widget",
    );
    expect(retrievalTypes).toEqual(["hybrid", "vector"]);
    expect(await readAll(stream)).toContain("[DONE]");
  });
});

describe("isHybridRetrievalUnavailableError", () => {
  test("matches the AutoRAG hybrid-disabled message", () => {
    expect(
      isHybridRetrievalUnavailableError(
        new Error(
          "retrieval_type 'hybrid' is not available because keyword indexing is disabled",
        ),
      ),
    ).toBe(true);
    expect(isHybridRetrievalUnavailableError(new Error("timeout"))).toBe(
      false,
    );
  });
});

describe("encodeHelpExplainEvent", () => {
  test("writes one SSE block", () => {
    expect(
      new TextDecoder().decode(encodeHelpExplainEvent("token", { text: "Hi" })),
    ).toBe('event: token\ndata: {"text":"Hi"}\n\n');
  });
});
