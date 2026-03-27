import { type RetrievedSearchChunk } from "../types";

export function mergeRetrievedSearchChunks(
  chunkGroups: RetrievedSearchChunk[][],
): RetrievedSearchChunk[] {
  const merged = new Map<string, RetrievedSearchChunk>();

  for (const chunks of chunkGroups) {
    for (const chunk of chunks) {
      const key = chunk.item?.key;
      const text = (chunk.text ?? "").trim();
      if (!key || !text) continue;

      const normalizedPrefix = text.slice(0, 220).toLowerCase();
      const dedupeKey = `${key}:${normalizedPrefix}`;
      const existing = merged.get(dedupeKey);

      if (!existing || (chunk.score ?? 0) > (existing.score ?? 0)) {
        merged.set(dedupeKey, {
          item: { key },
          score: chunk.score ?? 0,
          text,
        });
      }
    }
  }

  return [...merged.values()];
}
