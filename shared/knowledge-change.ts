export const KNOWLEDGE_CHANGE_ACTIONS = [
  "create_faq",
  "update_faq",
  "create_webpage",
  "reindex",
] as const;

export type KnowledgeChangeAction = (typeof KNOWLEDGE_CHANGE_ACTIONS)[number];

export type KnowledgeChangeType = "faq" | "webpage";

export interface KnowledgeChangePreview {
  action: KnowledgeChangeAction;
  title: string;
  url: string | null;
  type: KnowledgeChangeType;
  resourceId: string | null;
  pairIndex: number | null;
  pairQuestion: string | null;
  before: string;
  after: string;
  reason: string | null;
}

export function knowledgeChangeHeading(action: KnowledgeChangeAction): string {
  if (action === "create_faq") return "Add FAQ";
  if (action === "update_faq") return "Update FAQ";
  if (action === "create_webpage") return "Add webpage";
  return "Reindex";
}

export function isKnowledgeChangeAction(
  value: unknown,
): value is KnowledgeChangeAction {
  return (
    value === "create_faq" ||
    value === "update_faq" ||
    value === "create_webpage" ||
    value === "reindex"
  );
}
