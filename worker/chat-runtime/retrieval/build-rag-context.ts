import { type SourceReference } from "../../services/resource-service";
import {
  type PreparedRagChunk,
  type RagContextResult,
  type RetrievedSearchChunk,
} from "../types";

const RAG_MAX_CONTEXT_CHARS = 16_000;
const RAG_MAX_CHUNKS = 10;
const RAG_MAX_CHUNKS_PER_SOURCE = 3;
const RAG_MAX_CHUNK_CHARS = 1_800;
const RAG_HARD_MIN_SCORE = 0.2;
const RAG_PREFERRED_MIN_SCORE = 0.25;

export function prepareRagChunks(
  chunks: RetrievedSearchChunk[],
  projectId: string,
): { chunks: PreparedRagChunk[]; droppedCrossTenant: number } {
  const projectPrefix = `${projectId}/`;
  const normalized: PreparedRagChunk[] = [];

  for (const chunk of chunks) {
    const key = chunk.item?.key;
    const text = (chunk.text ?? "").trim();
    if (!key || !text) continue;

    normalized.push({
      key,
      score: chunk.score ?? 0,
      text,
    });
  }

  const tenantChunks = normalized.filter((chunk) =>
    chunk.key.startsWith(projectPrefix),
  );
  const droppedCrossTenant = normalized.length - tenantChunks.length;

  const nonPdfChunks = tenantChunks.filter((chunk) => !chunk.key.endsWith(".pdf"));
  const preferredChunks = nonPdfChunks.length > 0 ? nonPdfChunks : tenantChunks;
  preferredChunks.sort((a, b) => b.score - a.score);

  return { chunks: preferredChunks, droppedCrossTenant };
}

export function getSourceReferenceDedupKey(source: SourceReference): string {
  if (source.type === "webpage" && source.url) {
    return `webpage:${source.url}`;
  }

  return `${source.type}:${source.title}`;
}

export function buildRagContext(
  chunks: PreparedRagChunk[],
  sourceReferenceMap: Map<string, SourceReference>,
): RagContextResult {
  const selected: Array<{ key: string; score: number; text: string }> = [];
  const sourceCounts = new Map<string, number>();
  const seenText = new Set<string>();
  const selectedSources: SourceReference[] = [];
  const seenSourceKeys = new Set<string>();
  const unresolvedKeys = new Set<string>();
  let contextChars = 0;

  for (const chunk of chunks) {
    if (selected.length >= RAG_MAX_CHUNKS) break;
    if (chunk.score < RAG_HARD_MIN_SCORE) continue;
    if (selected.length >= 4 && chunk.score < RAG_PREFERRED_MIN_SCORE) continue;

    const perSource = sourceCounts.get(chunk.key) ?? 0;
    if (perSource >= RAG_MAX_CHUNKS_PER_SOURCE) continue;

    const normalizedPrefix = chunk.text.slice(0, 220).toLowerCase();
    const dedupeKey = `${chunk.key}:${normalizedPrefix}`;
    if (seenText.has(dedupeKey)) continue;

    const clippedText =
      chunk.text.length > RAG_MAX_CHUNK_CHARS
        ? `${chunk.text.slice(0, RAG_MAX_CHUNK_CHARS)}...`
        : chunk.text;

    if (contextChars >= RAG_MAX_CONTEXT_CHARS) break;
    let finalText = clippedText;
    if (contextChars + finalText.length > RAG_MAX_CONTEXT_CHARS) {
      const remaining = RAG_MAX_CONTEXT_CHARS - contextChars;
      if (remaining < 250) break;
      finalText = `${finalText.slice(0, remaining)}...`;
    }

    selected.push({
      key: chunk.key,
      score: chunk.score,
      text: finalText,
    });
    sourceCounts.set(chunk.key, perSource + 1);
    seenText.add(dedupeKey);
    contextChars += finalText.length;

    const sourceReference = sourceReferenceMap.get(chunk.key);
    if (!sourceReference) {
      unresolvedKeys.add(chunk.key);
      continue;
    }

    const sourceDedupKey = getSourceReferenceDedupKey(sourceReference);
    if (seenSourceKeys.has(sourceDedupKey)) continue;

    seenSourceKeys.add(sourceDedupKey);
    selectedSources.push(sourceReference);
  }

  if (selected.length === 0) {
    return {
      context: "",
      topScore: 0,
      selectedChunkCount: 0,
      sources: [],
      unresolvedKeys: [],
    };
  }

  const context = selected
    .map((chunk) => {
      const relevance = (chunk.score * 100).toFixed(0);
      return `<source file="${chunk.key}" relevance="${relevance}%">\n${chunk.text}\n</source>`;
    })
    .join("\n\n");

  return {
    context,
    topScore: selected[0]?.score ?? 0,
    selectedChunkCount: selected.length,
    sources: selectedSources,
    unresolvedKeys: [...unresolvedKeys],
  };
}
