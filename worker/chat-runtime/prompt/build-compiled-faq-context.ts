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
  precision: number;
  recall: number;
  margin: number;
  authoritative: boolean;
  matchKind: "exact" | "lexical";
}

type ScoredFaqPair = Omit<FaqMatchResult, "margin" | "authoritative">;

const FAQ_HINT_THRESHOLD = 0.35;
const FAQ_AUTHORITATIVE_F1 = 0.82;
const FAQ_AUTHORITATIVE_COVERAGE = 0.8;
const FAQ_AUTHORITATIVE_MARGIN = 0.15;
const MULTI_INTENT_RE = /\b(and|also|plus|another|as well as|but)\b|[?][^?]+[?]/i;

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

function normalizeFaqText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalizeFaqText(text)
      .split(" ")
      .filter((token) => token.length > 1 && !FAQ_STOPWORDS.has(token)),
  );
}

function scoreFaqPair(
  userMessage: string,
  question: string,
): ScoredFaqPair | null {
  const normalizedUser = normalizeFaqText(userMessage);
  const normalizedQuestion = normalizeFaqText(question);
  if (normalizedUser === normalizedQuestion) {
    return {
      question,
      answer: "",
      score: 1,
      precision: 1,
      recall: 1,
      matchKind: "exact",
    };
  }

  const userTokens = tokenize(userMessage);
  const questionTokens = tokenize(question);
  if (userTokens.size < 2 || questionTokens.size < 2) return null;

  let overlap = 0;
  for (const token of userTokens) {
    if (questionTokens.has(token)) overlap += 1;
  }

  const precision = overlap / userTokens.size;
  const recall = overlap / questionTokens.size;
  const score =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  return {
    question,
    answer: "",
    score,
    precision,
    recall,
    matchKind: "lexical",
  };
}

export function findBestFaqMatch(
  faqResources: FaqLikeResource[],
  userMessage: string,
): FaqMatchResult | null {
  const candidates: ScoredFaqPair[] = [];

  for (const resource of faqResources) {
    const pairs = parseFaqPairs(resource.content);
    for (const pair of pairs) {
      const scored = scoreFaqPair(userMessage, pair.question);
      if (scored && scored.score >= FAQ_HINT_THRESHOLD) {
        candidates.push({ ...scored, answer: pair.answer });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best) return null;

  const runnerUp = candidates[1];
  const margin = runnerUp ? best.score - runnerUp.score : best.score;
  const hasConflictingExactAnswer =
    best.matchKind === "exact" &&
    candidates.slice(1).some(
      (candidate) =>
        candidate.matchKind === "exact" &&
        normalizeFaqText(candidate.answer) !== normalizeFaqText(best.answer),
    );
  const authoritative =
    (best.matchKind === "exact" && !hasConflictingExactAnswer) ||
    (!MULTI_INTENT_RE.test(userMessage) &&
      best.score >= FAQ_AUTHORITATIVE_F1 &&
      best.precision >= FAQ_AUTHORITATIVE_COVERAGE &&
      best.recall >= FAQ_AUTHORITATIVE_COVERAGE &&
      margin >= FAQ_AUTHORITATIVE_MARGIN);

  return { ...best, margin, authoritative };
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
