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
}

const MAX_COMPILED_FAQ_CHARS = 12_000;
const COMPILED_FAQ_CACHE_TTL_SECONDS = 300;
const COMPILED_FAQ_CACHE_VERSION = "v1";

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

    const nextLength = totalChars === 0 ? section.length : totalChars + 2 + section.length;
    if (nextLength > MAX_COMPILED_FAQ_CHARS) {
      break;
    }

    sections.push(section);
    totalChars = nextLength;
  }

  return sections.join("\n\n");
}

export interface FaqMatchResult {
  question: string;
  answer: string;
  score: number;
}

const FAQ_MATCH_THRESHOLD = 0.75;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
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
      const score = jaccardSimilarity(userTokens, questionTokens);
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
      return `${resource.id}:${safeTimestamp}`;
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
    if (cached !== null) {
      return cached;
    }
  } catch {
    // KV read failures should never block the turn — fall through to build.
  }

  const compiled = buildCompiledFaqContext(faqResources);

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

  return compiled;
}
