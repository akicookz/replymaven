/**
 * Conflict resolution module for handling conflicts between tier-1 sources
 */

export interface ConflictResolution {
  sourceType: 'guideline' | 'faq' | 'knowledge_base';
  confidence: number;
  reason: string;
  content: string;
}

export interface SourceContent {
  guideline: string | null;
  faq: string | null;
  knowledgeBase: string | null;
}

/**
 * Resolve conflicts between different tier sources
 * Priority: Guidelines > FAQs > Knowledge Base
 */
export function resolveSourceConflict(sources: SourceContent): ConflictResolution | null {
  // Check guidelines first (highest priority)
  if (sources.guideline && sources.guideline.trim()) {
    return {
      sourceType: 'guideline',
      confidence: 1.0,
      reason: 'Guidelines are tier-1 sources with highest priority',
      content: sources.guideline,
    };
  }

  // Check FAQs second (tier-1 but lower than guidelines)
  if (sources.faq && sources.faq.trim()) {
    return {
      sourceType: 'faq',
      confidence: 0.95,
      reason: 'FAQs are tier-1 sources, second in priority',
      content: sources.faq,
    };
  }

  // Knowledge base is lowest tier
  if (sources.knowledgeBase && sources.knowledgeBase.trim()) {
    return {
      sourceType: 'knowledge_base',
      confidence: 0.7,
      reason: 'Knowledge base is a lower-tier source',
      content: sources.knowledgeBase,
    };
  }

  return null;
}

/**
 * Merge complementary information from different tiers
 * Only merges if there's no conflict
 */
export function mergeComplementaryInfo(sources: SourceContent): {
  merged: string;
  sourcesUsed: string[];
  hasConflict: boolean;
} {
  const availableSources: { type: string; content: string }[] = [];

  if (sources.guideline && sources.guideline.trim()) {
    availableSources.push({ type: 'guideline', content: sources.guideline });
  }
  if (sources.faq && sources.faq.trim()) {
    availableSources.push({ type: 'faq', content: sources.faq });
  }
  if (sources.knowledgeBase && sources.knowledgeBase.trim()) {
    availableSources.push({ type: 'knowledge_base', content: sources.knowledgeBase });
  }

  if (availableSources.length === 0) {
    return { merged: '', sourcesUsed: [], hasConflict: false };
  }

  if (availableSources.length === 1) {
    return {
      merged: availableSources[0].content,
      sourcesUsed: [availableSources[0].type],
      hasConflict: false,
    };
  }

  // Check for conflicts between tier-1 sources
  const hasGuidelineAndFaq =
    availableSources.some(s => s.type === 'guideline') &&
    availableSources.some(s => s.type === 'faq');

  if (hasGuidelineAndFaq) {
    // Potential conflict between tier-1 sources
    // Use resolution priority: guideline wins
    const guideline = availableSources.find(s => s.type === 'guideline');
    return {
      merged: guideline!.content,
      sourcesUsed: ['guideline'],
      hasConflict: true,
    };
  }

  // No conflict, merge complementary information
  const merged = availableSources
    .map(s => s.content)
    .join('\n\n');

  return {
    merged,
    sourcesUsed: availableSources.map(s => s.type),
    hasConflict: false,
  };
}

/**
 * Assess specificity of a rule or answer
 * More specific rules override general ones
 */
export function assessSpecificity(content: string, userQuery: string): number {
  const contentLower = content.toLowerCase();
  const queryLower = userQuery.toLowerCase();

  let specificity = 0;

  // Check for exact phrase matches
  if (contentLower.includes(queryLower)) {
    specificity += 10;
  }

  // Check for key terms from the query
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 3);
  const matchingTerms = queryTerms.filter(term => contentLower.includes(term));
  specificity += matchingTerms.length * 2;

  // Check for specific patterns that indicate targeted rules
  if (/\b(specifically|exactly|precisely|only when|must always)\b/i.test(content)) {
    specificity += 3;
  }

  // Check for conditional statements (more specific)
  if (/\b(if|when|unless|except|but only)\b/i.test(content)) {
    specificity += 2;
  }

  return specificity;
}

/**
 * Resolve conflicts between tier-1 sources with equal priority
 * Uses specificity and relevance to determine which source wins
 */
export function resolveTier1Conflict(
  guideline: string | null,
  faq: string | null,
  userQuery: string
): ConflictResolution {
  if (!guideline && !faq) {
    throw new Error('No tier-1 sources provided for conflict resolution');
  }

  if (!guideline) {
    return {
      sourceType: 'faq',
      confidence: 0.95,
      reason: 'Only FAQ available',
      content: faq!,
    };
  }

  if (!faq) {
    return {
      sourceType: 'guideline',
      confidence: 1.0,
      reason: 'Only guideline available',
      content: guideline,
    };
  }

  // Both available - check specificity
  const guidelineSpecificity = assessSpecificity(guideline, userQuery);
  const faqSpecificity = assessSpecificity(faq, userQuery);

  if (guidelineSpecificity > faqSpecificity) {
    return {
      sourceType: 'guideline',
      confidence: 1.0,
      reason: 'Guideline is more specific to the query',
      content: guideline,
    };
  }

  if (faqSpecificity > guidelineSpecificity) {
    return {
      sourceType: 'faq',
      confidence: 0.95,
      reason: 'FAQ is more specific to the query',
      content: faq,
    };
  }

  // Equal specificity - guidelines win by default priority
  return {
    sourceType: 'guideline',
    confidence: 1.0,
    reason: 'Guidelines take precedence when specificity is equal',
    content: guideline,
  };
}