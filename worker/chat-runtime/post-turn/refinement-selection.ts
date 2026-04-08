import { type FaqPair } from "../../services/resource-service";

export interface RefinementConversationMessage {
  role: string;
  content: string;
}

export interface RefinementFaqCandidate {
  id: string;
  title: string;
  pairs: FaqPair[];
}

export interface RefinementSopCandidate {
  id: string;
  condition: string;
  instruction: string;
}

export interface RefinementPdfCandidate {
  id: string;
  title: string;
  content: string | null;
}

export interface RefinementWebpageCandidate {
  pageId: string;
  resourceId: string;
  resourceTitle: string;
  pageTitle: string | null;
  url: string;
}

export interface RefinementPendingSuggestion {
  id: string;
  type: string;
  summary: string;
}

export interface RefinementShortlist {
  faqCandidates: RefinementFaqCandidate[];
  sopCandidates: RefinementSopCandidate[];
  pdfCandidates: RefinementPdfCandidate[];
  webpageCandidates: RefinementWebpageCandidate[];
  pendingSuggestions: RefinementPendingSuggestion[];
  conversationQuery: string;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "our",
  "the",
  "their",
  "them",
  "this",
  "to",
  "we",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
]);

export function selectRefinementShortlist(options: {
  messages: RefinementConversationMessage[];
  faqs: RefinementFaqCandidate[];
  sops: RefinementSopCandidate[];
  pdfs: RefinementPdfCandidate[];
  webpages: RefinementWebpageCandidate[];
  pendingSuggestions: RefinementPendingSuggestion[];
}): RefinementShortlist {
  const conversationQuery = buildConversationQuery(options.messages);
  const queryTokens = tokenizeText(conversationQuery);

  return {
    faqCandidates: rankCandidates(
      options.faqs,
      (faq) =>
        `${faq.title}\n${faq.pairs
          .map((pair) => `${pair.question}\n${pair.answer}`)
          .join("\n")}`,
      queryTokens,
      3,
    ),
    sopCandidates: rankCandidates(
      options.sops,
      (sop) => `${sop.condition}\n${sop.instruction}`,
      queryTokens,
      3,
    ),
    pdfCandidates: rankCandidates(
      options.pdfs,
      (pdf) => `${pdf.title}\n${pdf.content ?? ""}`,
      queryTokens,
      3,
    ),
    webpageCandidates: rankCandidates(
      options.webpages,
      (page) =>
        `${page.resourceTitle}\n${page.pageTitle ?? ""}\n${page.url}`,
      queryTokens,
      5,
    ),
    pendingSuggestions: rankCandidates(
      options.pendingSuggestions,
      (suggestion) => `${suggestion.type}\n${suggestion.summary}`,
      queryTokens,
      3,
    ),
    conversationQuery,
  };
}

export function buildRelevantContentSnippet(
  content: string,
  queryText: string,
  maxChars = 2500,
): string {
  if (!content.trim()) return "";

  const queryTokens = tokenizeText(queryText);
  if (queryTokens.length === 0) {
    return clipText(content, maxChars);
  }

  const chunks = content
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  if (chunks.length <= 1) {
    return clipText(content, maxChars);
  }

  const ranked = chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: scoreText(chunk, queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index);

  if (ranked.length === 0) {
    return clipText(content, maxChars);
  }

  return clipText(
    ranked.map((entry) => entry.chunk).join("\n\n"),
    maxChars,
  );
}

export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConversationQuery(
  messages: RefinementConversationMessage[],
): string {
  return messages
    .slice(-12)
    .map((message) => message.content)
    .join(" ");
}

function tokenizeText(text: string): string[] {
  const tokens = normalizeSearchText(text).split(" ");
  return Array.from(
    new Set(
      tokens.filter(
        (token) => token.length >= 3 && !STOP_WORDS.has(token),
      ),
    ),
  );
}

function rankCandidates<T>(
  items: T[],
  getText: (item: T) => string,
  queryTokens: string[],
  limit: number,
): T[] {
  if (queryTokens.length === 0) {
    return items.slice(0, limit);
  }

  const ranked = items
    .map((item) => ({
      item,
      score: scoreText(getText(item), queryTokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit).map((entry) => entry.item);
}

function scoreText(text: string, queryTokens: string[]): number {
  const normalized = normalizeSearchText(text);
  if (!normalized) return 0;

  const candidateTokens = new Set(normalized.split(" "));
  let score = 0;

  for (const token of queryTokens) {
    if (candidateTokens.has(token)) {
      score += 2;
      continue;
    }

    if (normalized.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
