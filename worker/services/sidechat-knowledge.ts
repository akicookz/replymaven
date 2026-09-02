import type { ResourceRow } from "../db/schema";
import {
  FAQ_DESCRIPTION_MAX_CHARS,
  getFaqSetTotalLength,
  isFaqPairOverLimit,
  isFaqSetOverLimit,
} from "../../shared/faq-limits";
import type { KnowledgeChangePreview } from "../../shared/knowledge-change";
import { type FaqPair, ResourceService } from "./resource-service";
import { triggerAutoRagSync } from "./autorag-sync";
import type { AppEnv } from "../types";

const MAX_QUERY_CHARS = 200;
const MAX_LIST = 30;
const MAX_READ_CHARS = 12_000;
const MAX_DIFF_CHARS = 12_000;

export interface KnowledgeCandidate {
  id: string;
  title: string;
  url: string | null;
  type: "webpage" | "pdf" | "faq";
  status: ResourceRow["status"];
  lastIndexedAt: number | null;
}

export interface KnowledgeReadResult {
  resource: KnowledgeCandidate;
  content: string | null;
  pairs: Array<{ index: number; question: string; answer: string }> | null;
}

export type KnowledgeChangeWrite =
  | {
      action: "create_faq";
      title: string;
      description: string | null;
      pairs: FaqPair[];
      reason: string | null;
    }
  | {
      action: "update_faq";
      resourceId: string;
      pairIndex: number;
      pair: FaqPair;
      title: string | null;
      description: string | null;
      reason: string | null;
    }
  | {
      action: "create_webpage";
      title: string;
      url: string;
      reason: string | null;
    }
  | {
      action: "reindex";
      resourceId: string;
      reason: string | null;
    };

export type KnowledgePrepareResult =
  | { status: "ready"; preview: KnowledgeChangePreview; write: KnowledgeChangeWrite }
  | { status: "ambiguous"; candidates: KnowledgeCandidate[]; error: string }
  | { status: "failed"; error: string };

const MAX_FAQ_PAIRS = 50;

export function formatFaqPair(pair: FaqPair): string {
  return `## Q: ${pair.question}\n\n${pair.answer}`;
}

export function formatFaqMarkdown(
  title: string,
  pairs: FaqPair[],
): string {
  const sections = pairs.map((pair) => formatFaqPair(pair));
  return `# FAQ: ${title}\n\n${sections.join("\n\n---\n\n")}`;
}

function clipText(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…` : value;
}

function toEpoch(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : value;
}

function isManageableResource(resource: ResourceRow): boolean {
  return resource.sourceArticleId == null;
}

function toCandidate(resource: ResourceRow): KnowledgeCandidate {
  return {
    id: resource.id,
    title: resource.title,
    url: resource.url,
    type: resource.type,
    status: resource.status,
    lastIndexedAt: toEpoch(resource.lastIndexedAt),
  };
}

function normalizeQuery(value: string | null | undefined): string {
  return value?.trim().slice(0, MAX_QUERY_CHARS).toLowerCase() ?? "";
}

function matchesQuery(resource: ResourceRow, query: string): boolean {
  if (!query) return true;
  const title = resource.title.toLowerCase();
  const url = resource.url?.toLowerCase() ?? "";
  return title.includes(query) || url.includes(query);
}

export async function listKnowledgeResources(
  service: ResourceService,
  projectId: string,
  query: string | null,
): Promise<KnowledgeCandidate[]> {
  const needle = normalizeQuery(query);
  const resources = await service.getResourcesByProject(projectId);
  return resources
    .filter((resource) => isManageableResource(resource) && matchesQuery(resource, needle))
    .sort((left, right) => {
      const leftAt = toEpoch(left.updatedAt) ?? 0;
      const rightAt = toEpoch(right.updatedAt) ?? 0;
      return rightAt - leftAt;
    })
    .slice(0, MAX_LIST)
    .map(toCandidate);
}

export async function findKnowledgeResources(
  service: ResourceService,
  projectId: string,
  locator: {
    resourceId?: string | null;
    title?: string | null;
    url?: string | null;
  },
): Promise<ResourceRow[]> {
  const resources = (await service.getResourcesByProject(projectId))
    .filter(isManageableResource);
  if (locator.resourceId) {
    return resources.filter((resource) => resource.id === locator.resourceId);
  }
  const url = locator.url?.trim() ?? "";
  if (url) {
    const exact = resources.filter((resource) => resource.url === url);
    if (exact.length > 0) return exact;
  }
  const title = locator.title?.trim().toLowerCase() ?? "";
  if (title) {
    const exact = resources.filter(
      (resource) => resource.title.toLowerCase() === title,
    );
    if (exact.length > 0) return exact;
    return resources.filter((resource) =>
      resource.title.toLowerCase().includes(title),
    );
  }
  return [];
}

export async function readKnowledgeResource(
  service: ResourceService,
  projectId: string,
  locator: {
    resourceId?: string | null;
    title?: string | null;
    url?: string | null;
  },
): Promise<
  | { status: "ready"; result: KnowledgeReadResult }
  | { status: "ambiguous"; candidates: KnowledgeCandidate[] }
  | { status: "failed"; error: string }
> {
  const matches = await findKnowledgeResources(service, projectId, locator);
  if (matches.length === 0) {
    return { status: "failed", error: "No matching knowledge resource." };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches.map(toCandidate) };
  }
  const resource = matches[0]!;
  const content = await service.getResourceContent(resource.id, projectId);
  const raw = content?.content ?? null;
  return {
    status: "ready",
    result: {
      resource: toCandidate(resource),
      content: raw == null ? null : clipText(raw, MAX_READ_CHARS),
      pairs: content?.pairs?.map((pair, index) => ({
        index,
        question: pair.question,
        answer: pair.answer,
      })) ?? null,
    },
  };
}

function isStoredFaqPairs(value: unknown): value is FaqPair[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) =>
      item !== null &&
      typeof item === "object" &&
      typeof (item as FaqPair).question === "string" &&
      typeof (item as FaqPair).answer === "string"
    );
}

function parsePair(question: unknown, answer: unknown): FaqPair | null {
  if (typeof question !== "string" || typeof answer !== "string") return null;
  const pair = { question: question.trim(), answer: answer.trim() };
  if (!pair.question || !pair.answer || isFaqPairOverLimit(pair)) return null;
  return pair;
}

function parsePairIndex(value: unknown, maxInclusive: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > maxInclusive) return null;
  return value;
}

function replaceFaqPair(
  current: FaqPair[],
  index: number,
  pair: FaqPair,
): FaqPair[] | null {
  if (index < 0 || index > current.length) return null;
  if (index === current.length && current.length >= MAX_FAQ_PAIRS) return null;
  const next = current.slice();
  if (index === current.length) next.push(pair);
  else next[index] = pair;
  if (isFaqSetOverLimit(next)) return null;
  return next;
}

function parsePairs(value: unknown): FaqPair[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FAQ_PAIRS) {
    return null;
  }
  const pairs: FaqPair[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof (item as FaqPair).question !== "string" ||
      typeof (item as FaqPair).answer !== "string"
    ) {
      return null;
    }
    const pair = {
      question: (item as FaqPair).question.trim(),
      answer: (item as FaqPair).answer.trim(),
    };
    if (!pair.question || !pair.answer || isFaqPairOverLimit(pair)) return null;
    pairs.push(pair);
  }
  if (isFaqSetOverLimit(pairs) || getFaqSetTotalLength(pairs) === 0) return null;
  return pairs;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function parseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function prepareKnowledgeChange(
  service: ResourceService,
  projectId: string,
  input: Record<string, unknown>,
): Promise<KnowledgePrepareResult> {
  const action = input.action;
  const reason = optionalText(input.reason, 500);
  if (action === "create_faq") {
    const title = optionalText(input.title, 200);
    const pair = parsePair(input.question, input.answer);
    const description = optionalText(input.description, FAQ_DESCRIPTION_MAX_CHARS);
    if (!title || !pair) {
      return { status: "failed", error: "create_faq needs a title, question, and answer." };
    }
    const after = clipText(formatFaqPair(pair), MAX_DIFF_CHARS);
    return {
      status: "ready",
      preview: {
        action,
        title,
        url: null,
        type: "faq",
        resourceId: null,
        pairIndex: 0,
        pairQuestion: pair.question,
        before: "",
        after,
        reason,
      },
      write: { action, title, description, pairs: [pair], reason },
    };
  }

  if (action === "create_webpage") {
    const title = optionalText(input.title, 200);
    const url = parseUrl(input.url);
    if (!title || !url) {
      return { status: "failed", error: "create_webpage needs a title and http(s) URL." };
    }
    return {
      status: "ready",
      preview: {
        action,
        title,
        url,
        type: "webpage",
        resourceId: null,
        pairIndex: null,
        pairQuestion: null,
        before: "",
        after: `${title}\n${url}`,
        reason,
      },
      write: { action, title, url, reason },
    };
  }

  if (action === "update_faq") {
    const pair = parsePair(input.question, input.answer);
    if (!pair) {
      return { status: "failed", error: "update_faq needs a question and answer." };
    }
    const matches = await findKnowledgeResources(service, projectId, {
      resourceId: optionalText(input.resourceId, 80),
      title: optionalText(input.title, 200),
      url: optionalText(input.url, 2_048),
    });
    const faqs = matches.filter((resource) => resource.type === "faq");
    if (faqs.length === 0) {
      return { status: "failed", error: "No matching FAQ resource." };
    }
    if (faqs.length > 1) {
      return {
        status: "ambiguous",
        candidates: faqs.map(toCandidate),
        error: "Several FAQ resources match. Pass resourceId or a more specific title.",
      };
    }
    const resource = faqs[0]!;
    const current = await service.getResourceContent(resource.id, projectId);
    if (!current || !isStoredFaqPairs(current.pairs)) {
      return {
        status: "failed",
        error: "This FAQ is stored as plain text. Update it from the dashboard first.",
      };
    }
    const pairIndex = parsePairIndex(input.pairIndex, current.pairs.length);
    if (pairIndex === null) {
      return {
        status: "failed",
        error: `update_faq needs pairIndex from 0 to ${current.pairs.length}. ${current.pairs.length} appends a pair.`,
      };
    }
    const next = replaceFaqPair(current.pairs, pairIndex, pair);
    if (!next) {
      return { status: "failed", error: "This pair change exceeds the FAQ size limit." };
    }
    const currentPair = current.pairs[pairIndex] ?? null;
    const title = optionalText(input.nextTitle, 200) ?? resource.title;
    const description = optionalText(input.description, FAQ_DESCRIPTION_MAX_CHARS) ??
      resource.description;
    return {
      status: "ready",
      preview: {
        action,
        title,
        url: null,
        type: "faq",
        resourceId: resource.id,
        pairIndex,
        pairQuestion: pair.question,
        before: clipText(currentPair ? formatFaqPair(currentPair) : "", MAX_DIFF_CHARS),
        after: clipText(formatFaqPair(pair), MAX_DIFF_CHARS),
        reason,
      },
      write: {
        action,
        resourceId: resource.id,
        pairIndex,
        pair,
        title,
        description,
        reason,
      },
    };
  }

  if (action === "reindex") {
    const matches = await findKnowledgeResources(service, projectId, {
      resourceId: optionalText(input.resourceId, 80),
      title: optionalText(input.title, 200),
      url: optionalText(input.url, 2_048),
    });
    const eligible = matches.filter((resource) => resource.type !== "pdf");
    if (eligible.length === 0) {
      return { status: "failed", error: "No matching webpage or FAQ to reindex." };
    }
    if (eligible.length > 1) {
      return {
        status: "ambiguous",
        candidates: eligible.map(toCandidate),
        error: "Several resources match. Pass resourceId or a more specific title.",
      };
    }
    const resource = eligible[0]!;
    const label = resource.url
      ? `${resource.title}\n${resource.url}`
      : resource.title;
    return {
      status: "ready",
      preview: {
        action,
        title: resource.title,
        url: resource.url,
        type: resource.type === "faq" ? "faq" : "webpage",
        resourceId: resource.id,
        pairIndex: null,
        pairQuestion: null,
        before: label,
        after: `${label}\n\nReindex this source.`,
        reason,
      },
      write: { action, resourceId: resource.id, reason },
    };
  }

  return {
    status: "failed",
    error: "action must be create_faq, update_faq, create_webpage, or reindex.",
  };
}

export async function applyKnowledgeChange(
  service: ResourceService,
  env: AppEnv,
  projectId: string,
  write: KnowledgeChangeWrite,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<{ ok: true; resourceId: string } | { ok: false; error: string }> {
  if (write.action === "create_faq") {
    const resource = await service.createResource({
      projectId,
      type: "faq",
      title: write.title,
      description: write.description,
      content: JSON.stringify(write.pairs),
    });
    waitUntil((async () => {
      await service.ingestFaqFromPairs(
        projectId,
        resource.id,
        resource.title,
        write.pairs,
      );
      await triggerAutoRagSync(env, "sidechat.resource.create.faq");
    })());
    return { ok: true, resourceId: resource.id };
  }

  if (write.action === "update_faq") {
    const current = await service.getResourceContent(write.resourceId, projectId);
    if (!current || !isStoredFaqPairs(current.pairs)) {
      return { ok: false, error: "FAQ update failed." };
    }
    const next = replaceFaqPair(current.pairs, write.pairIndex, write.pair);
    if (!next) return { ok: false, error: "FAQ pair index is out of range." };
    const updated = await service.updateFaqResource(
      write.resourceId,
      projectId,
      write.title ?? undefined,
      next,
      write.description,
    );
    if (!updated) return { ok: false, error: "FAQ update failed." };
    waitUntil(triggerAutoRagSync(env, "sidechat.resource.update.faq"));
    return { ok: true, resourceId: updated.id };
  }

  if (write.action === "create_webpage") {
    const resource = await service.createResource({
      projectId,
      type: "webpage",
      title: write.title,
      url: write.url,
    });
    waitUntil((async () => {
      await service.ingestWebpage(
        projectId,
        resource.id,
        write.url,
        resource.title,
        env.CRAWL_QUEUE,
        env.CF_ACCOUNT_ID,
        env.BROWSER_RENDERING_API_TOKEN,
      );
      await triggerAutoRagSync(env, "sidechat.resource.create.webpage");
    })());
    return { ok: true, resourceId: resource.id };
  }

  const resource = await service.getResourceById(write.resourceId, projectId);
  if (!resource || resource.sourceArticleId) {
    return { ok: false, error: "Resource not found." };
  }
  if (resource.type === "pdf") {
    return { ok: false, error: "PDF reindex is not supported." };
  }
  await service.updateResourceStatus(resource.id, projectId, "pending");
  if (resource.type === "webpage") {
    if (!resource.url) return { ok: false, error: "Webpage is missing a URL." };
    waitUntil((async () => {
      await service.ingestWebpage(
        projectId,
        resource.id,
        resource.url ?? "",
        resource.title,
        env.CRAWL_QUEUE,
        env.CF_ACCOUNT_ID,
        env.BROWSER_RENDERING_API_TOKEN,
      );
      await triggerAutoRagSync(env, "sidechat.resource.reindex.webpage");
    })());
  } else {
    waitUntil((async () => {
      await service.ingestFaq(
        projectId,
        resource.id,
        resource.title,
        resource.content ?? "",
      );
      await triggerAutoRagSync(env, "sidechat.resource.reindex.faq");
    })());
  }
  return { ok: true, resourceId: resource.id };
}

export function parseKnowledgeChangeWrite(
  value: unknown,
): KnowledgeChangeWrite | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const write = value as Record<string, unknown>;
  const reason = optionalText(write.reason, 500);
  if (write.action === "create_faq") {
    const title = optionalText(write.title, 200);
    const pairs = parsePairs(write.pairs);
    if (!title || !pairs) return null;
    return {
      action: "create_faq",
      title,
      description: optionalText(write.description, FAQ_DESCRIPTION_MAX_CHARS),
      pairs,
      reason,
    };
  }
  if (write.action === "update_faq") {
    const resourceId = optionalText(write.resourceId, 80);
    const rawPair = write.pair;
    if (!rawPair || typeof rawPair !== "object" || Array.isArray(rawPair)) {
      return null;
    }
    const pairRecord = rawPair as Record<string, unknown>;
    const pair = parsePair(pairRecord.question, pairRecord.answer);
    const pairIndex = parsePairIndex(write.pairIndex, MAX_FAQ_PAIRS);
    if (!resourceId || !pair || pairIndex === null) return null;
    return {
      action: "update_faq",
      resourceId,
      pairIndex,
      pair,
      title: optionalText(write.title, 200),
      description: optionalText(write.description, FAQ_DESCRIPTION_MAX_CHARS),
      reason,
    };
  }
  if (write.action === "create_webpage") {
    const title = optionalText(write.title, 200);
    const url = parseUrl(write.url);
    if (!title || !url) return null;
    return { action: "create_webpage", title, url, reason };
  }
  if (write.action === "reindex") {
    const resourceId = optionalText(write.resourceId, 80);
    if (!resourceId) return null;
    return { action: "reindex", resourceId, reason };
  }
  return null;
}
