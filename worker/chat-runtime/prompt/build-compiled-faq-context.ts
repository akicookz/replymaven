interface FaqLikeResource {
  title: string;
  content: string | null;
}

interface FaqPair {
  question?: string;
  answer?: string;
}

export interface FaqCacheFingerprintResource {
  id: string;
  updatedAt: Date;
  content: string | null;
}

const MAX_COMPILED_FAQ_CHARS = 40_000;
const COMPILED_FAQ_CACHE_TTL_SECONDS = 300;
// Bump the version whenever the cache shape or build logic changes so stale
// entries from prior code paths (including any that cached empty/poisoned
// results) become unreachable instead of served.
const COMPILED_FAQ_CACHE_VERSION = "v2";

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseFaqPairs(content: string | null): Array<{ question: string; answer: string }> {
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as FaqPair[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((pair) => {
      const question =
        typeof pair.question === "string" ? normalizeWhitespace(pair.question) : "";
      const answer =
        typeof pair.answer === "string" ? normalizeWhitespace(pair.answer) : "";

      if (!question || !answer) {
        return [];
      }

      return [{ question, answer }];
    });
  } catch {
    return [];
  }
}

function formatFaqSection(
  resource: FaqLikeResource,
  seenEntries: Set<string>,
): string | null {
  const pairs = parseFaqPairs(resource.content);
  if (pairs.length > 0) {
    const lines = pairs.flatMap((pair) => {
      const dedupeKey = `${pair.question}::${pair.answer}`;
      if (seenEntries.has(dedupeKey)) {
        return [];
      }

      seenEntries.add(dedupeKey);
      return [`- Q: ${pair.question}\n  A: ${pair.answer}`];
    });

    if (lines.length === 0) {
      return null;
    }

    return `FAQ: ${resource.title}\n${lines.join("\n")}`;
  }

  const rawContent = normalizeWhitespace(resource.content ?? "");
  if (!rawContent) {
    return null;
  }

  const dedupeKey = `${resource.title}::${rawContent}`;
  if (seenEntries.has(dedupeKey)) {
    return null;
  }

  seenEntries.add(dedupeKey);
  return `FAQ: ${resource.title}\n${rawContent}`;
}

export function buildCompiledFaqContext(
  faqResources: FaqLikeResource[],
): string {
  const sections: string[] = [];
  const seenEntries = new Set<string>();
  let totalChars = 0;

  for (const resource of faqResources) {
    const section = formatFaqSection(resource, seenEntries);
    if (!section) {
      continue;
    }

    const separator = totalChars === 0 ? 0 : 2;
    const remaining = MAX_COMPILED_FAQ_CHARS - totalChars - separator;
    if (remaining <= 0) {
      break;
    }

    if (section.length <= remaining) {
      sections.push(section);
      totalChars += separator + section.length;
      continue;
    }

    // Section is larger than the remaining budget. Truncate it instead of
    // dropping the entire FAQ silently — a partial list is always more
    // useful than nothing. Requires enough headroom for meaningful content
    // plus the truncation marker; if not, stop cleanly.
    const TRUNCATION_MARKER = "\n[...truncated]";
    const minimumUsefulBody = 64;
    if (remaining < TRUNCATION_MARKER.length + minimumUsefulBody) {
      break;
    }
    const truncated = `${section.slice(0, remaining - TRUNCATION_MARKER.length).trimEnd()}${TRUNCATION_MARKER}`;
    sections.push(truncated);
    break;
  }

  return sections.join("\n\n");
}

export interface FaqMatchResult {
  question: string;
  answer: string;
  score: number;
}

const FAQ_MATCH_THRESHOLD = 0.35;

const FAQ_STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "doing", "have", "has", "had", "having",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "they", "them",
  "it", "its", "this", "that", "these", "those",
  "to", "of", "in", "on", "at", "by", "for", "with", "from", "as",
  "how", "what", "when", "where", "who", "why", "which",
  "can", "could", "would", "should", "will", "shall", "may", "might",
  "and", "or", "but", "if", "so", "than", "then",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((token) => token.length > 1 && !FAQ_STOPWORDS.has(token)),
  );
}

function overlapSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  // Normalize by the smaller set so short visitor questions still score high
  // when most of their content tokens match a longer FAQ question.
  return intersection / Math.min(a.size, b.size);
}

export function findBestFaqMatch(
  faqResources: FaqLikeResource[],
  userMessage: string,
): FaqMatchResult | null {
  const userTokens = tokenize(userMessage);
  if (userTokens.size < 2) return null;

  let bestMatch: FaqMatchResult | null = null;

  for (const resource of faqResources) {
    const pairs = parseFaqPairs(resource.content);
    for (const pair of pairs) {
      const questionTokens = tokenize(pair.question);
      const score = overlapSimilarity(userTokens, questionTokens);
      if (score >= FAQ_MATCH_THRESHOLD && (bestMatch === null || score > bestMatch.score)) {
        bestMatch = { question: pair.question, answer: pair.answer, score };
      }
    }
  }

  return bestMatch;
}

function computeFaqFingerprint(
  fingerprintResources: FaqCacheFingerprintResource[],
): string {
  if (fingerprintResources.length === 0) {
    return "empty";
  }

  const parts = [...fingerprintResources]
    .map((resource) => {
      const timestamp =
        resource.updatedAt instanceof Date
          ? resource.updatedAt.getTime()
          : Number(new Date(resource.updatedAt as unknown as string).getTime());
      const safeTimestamp = Number.isFinite(timestamp) ? timestamp : 0;
      const contentHash = fnv1aHash(resource.content ?? "");
      return `${resource.id}:${safeTimestamp}:${contentHash}`;
    })
    .sort();
  return parts.join("|");
}

export function buildCompiledFaqCacheKey(
  projectId: string,
  fingerprintResources: FaqCacheFingerprintResource[],
): string {
  return `faq:${COMPILED_FAQ_CACHE_VERSION}:${projectId}:${computeFaqFingerprint(fingerprintResources)}`;
}

export async function getOrBuildCompiledFaqContext(params: {
  kv: KVNamespace;
  projectId: string;
  fingerprintResources: FaqCacheFingerprintResource[];
  faqResources: FaqLikeResource[];
  executionCtx?: ExecutionContext;
}): Promise<string> {
  const { kv, projectId, fingerprintResources, faqResources, executionCtx } =
    params;
  const cacheKey = buildCompiledFaqCacheKey(projectId, fingerprintResources);

  try {
    const cached = await kv.get(cacheKey);
    // Only trust non-empty cache values; an empty string indicates a prior
    // build ran before FAQ content was ready and poisoned the cache.
    if (cached !== null && cached.length > 0) {
      return cached;
    }
  } catch {
    // KV read failures should never block the turn — fall through to build.
  }

  const compiled = buildCompiledFaqContext(faqResources);

  if (compiled.length > 0) {
    const kvPut = kv
      .put(cacheKey, compiled, {
        expirationTtl: COMPILED_FAQ_CACHE_TTL_SECONDS,
      })
      .catch(() => {
        // Cache write failures are non-fatal.
      });
    if (executionCtx) {
      executionCtx.waitUntil(kvPut);
    } else {
      await kvPut;
    }
  }

  return compiled;
}
