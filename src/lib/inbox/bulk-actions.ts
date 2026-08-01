import type { BulkConversationAction } from "./types";

const BULK_REQUEST_LIMIT = 100;

export interface BulkConversationResult {
  updatedIds: string[];
  skippedIds: string[];
}

export interface BulkConversationExecutionResult extends BulkConversationResult {
  failedIds: string[];
}

interface ExecuteBulkConversationActionInput {
  conversationIds: string[];
  action: BulkConversationAction;
  request: (
    conversationIds: string[],
    action: BulkConversationAction,
  ) => Promise<BulkConversationResult>;
}

export async function executeBulkConversationAction({
  conversationIds,
  action,
  request,
}: ExecuteBulkConversationActionInput): Promise<BulkConversationExecutionResult> {
  const result: BulkConversationExecutionResult = {
    updatedIds: [],
    skippedIds: [],
    failedIds: [],
  };

  for (let index = 0; index < conversationIds.length; index += BULK_REQUEST_LIMIT) {
    const chunk = conversationIds.slice(index, index + BULK_REQUEST_LIMIT);
    try {
      const chunkResult = await request(chunk, action);
      result.updatedIds.push(...chunkResult.updatedIds);
      result.skippedIds.push(...chunkResult.skippedIds);
    } catch {
      result.failedIds.push(...chunk);
    }
  }

  return result;
}
