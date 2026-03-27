export function buildRetrievalQueries(
  rawMessage: string,
  reformulatedQuery: string,
): string[] {
  const queries: string[] = [];

  for (const candidate of [rawMessage, reformulatedQuery]) {
    const normalized = candidate.trim();
    if (!normalized) continue;
    if (
      queries.some((existing) => existing.toLowerCase() === normalized.toLowerCase())
    ) {
      continue;
    }
    queries.push(normalized);
  }

  return queries;
}
