export function buildRetrievalQueries(
  rawMessage: string,
  reformulatedQuery: string,
  plannedQueries: string[] = [],
): string[] {
  const queries: string[] = [];

  for (const candidate of [rawMessage, reformulatedQuery, ...plannedQueries]) {
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
