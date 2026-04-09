/**
 * Query deduplication utilities to prevent redundant searches
 */

/**
 * Normalize a query for comparison
 */
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize whitespace
    .split(' ')
    .filter(word => word.length > 2) // Remove short words
    .sort() // Sort for consistent comparison
    .join(' ');
}

/**
 * Calculate simple token-based similarity between two queries
 * Returns a score between 0 and 1
 */
export function calculateQuerySimilarity(query1: string, query2: string): number {
  const normalized1 = normalizeQuery(query1);
  const normalized2 = normalizeQuery(query2);

  // Exact match after normalization
  if (normalized1 === normalized2) {
    return 1.0;
  }

  const tokens1 = new Set(normalized1.split(' '));
  const tokens2 = new Set(normalized2.split(' '));

  // Calculate Jaccard similarity
  const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
  const union = new Set([...tokens1, ...tokens2]);

  if (union.size === 0) {
    return 0;
  }

  return intersection.size / union.size;
}

/**
 * Check if a query is semantically duplicate based on previous searches
 */
export function isDuplicateQuery(
  newQuery: string,
  previousQueries: string[],
  threshold: number = 0.8
): boolean {
  const normalizedNew = normalizeQuery(newQuery);

  for (const prevQuery of previousQueries) {
    const normalizedPrev = normalizeQuery(prevQuery);

    // Exact match
    if (normalizedNew === normalizedPrev) {
      return true;
    }

    // Semantic similarity check
    const similarity = calculateQuerySimilarity(newQuery, prevQuery);
    if (similarity >= threshold) {
      return true;
    }

    // Check for substring containment (one query contains the other)
    if (normalizedNew.includes(normalizedPrev) || normalizedPrev.includes(normalizedNew)) {
      // If one is significantly longer, it might be a refinement
      const lengthRatio = Math.min(normalizedNew.length, normalizedPrev.length) /
                         Math.max(normalizedNew.length, normalizedPrev.length);
      if (lengthRatio > 0.7) {
        return true; // Too similar
      }
    }
  }

  return false;
}

/**
 * Get semantic group for a query to track search patterns
 */
export function getQuerySemanticGroup(query: string): string {
  const normalized = normalizeQuery(query);
  const tokens = normalized.split(' ');

  // Identify key concept tokens (nouns, verbs)
  const keyTokens = tokens
    .filter(token => token.length > 4) // Focus on meaningful words
    .slice(0, 3) // Take top 3 key tokens
    .sort()
    .join('_');

  return keyTokens || 'general';
}

/**
 * Check if we've exhausted search patterns for a semantic group
 */
export function hasExhaustedSearchPatterns(
  semanticGroup: string,
  searchedGroups: string[],
  maxAttemptsPerGroup: number = 3
): boolean {
  const groupCount = searchedGroups.filter(group => group === semanticGroup).length;
  return groupCount >= maxAttemptsPerGroup;
}

/**
 * Generate alternative search queries based on the original
 */
export function generateAlternativeQueries(
  originalQuery: string,
  attemptNumber: number
): string[] {
  const alternatives: string[] = [];

  switch (attemptNumber) {
    case 1:
      // Try synonyms and related terms
      alternatives.push(
        originalQuery.replace(/configure/gi, 'setup'),
        originalQuery.replace(/error/gi, 'issue'),
        originalQuery.replace(/not working/gi, 'broken'),
        originalQuery.replace(/can't/gi, 'cannot'),
        originalQuery.replace(/doesn't/gi, 'does not')
      );
      break;

    case 2:
      // Try broader category search
      const words = originalQuery.split(' ');
      if (words.length > 3) {
        // Remove specific details, keep core concepts
        alternatives.push(
          words.slice(0, Math.ceil(words.length / 2)).join(' '),
          words.filter((_, i) => i % 2 === 0).join(' ') // Every other word
        );
      }
      // Add category-based search
      if (originalQuery.includes('error') || originalQuery.includes('issue')) {
        alternatives.push('troubleshooting guide');
      }
      if (originalQuery.includes('setup') || originalQuery.includes('configure')) {
        alternatives.push('getting started guide');
      }
      break;

    case 3:
      // Try FAQ-style queries
      alternatives.push(
        `how to ${originalQuery}`,
        `what is ${originalQuery}`,
        `why does ${originalQuery}`,
        `FAQ ${originalQuery}`
      );
      break;
  }

  // Filter out duplicates and empty strings
  return alternatives
    .filter(q => q && q.trim() !== originalQuery)
    .map(q => q.trim());
}