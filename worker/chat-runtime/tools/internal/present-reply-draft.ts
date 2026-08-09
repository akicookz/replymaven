import { z } from "zod";
import { type MavenToolDefinition, type MavenTurnContext } from "../../types";

const PRESENT_REPLY_DRAFT_MAX_CHARS = 5_000;

export interface PresentReplyDraftInput {
  draft: string;
}

export interface PresentReplyDraftResult {
  accepted: true;
}

const presentReplyDraftInputSchema = z
  .object({
    draft: z.string().min(1).max(PRESENT_REPLY_DRAFT_MAX_CHARS),
  })
  .strict();

function createCapability(projectId: string): MavenToolDefinition["capability"] {
  return {
    id: "internal-present-reply-draft",
    projectId,
    connectionId: null,
    modelName: "present_reply_draft",
    displayName: "Present reply draft",
    source: "internal",
    allowedChannels: ["sidechat"],
    access: "read",
    enabled: true,
    schemaFingerprint: "internal-present-reply-draft-v1",
  };
}

export function createPresentReplyDraftTool(dependencies: {
  context: MavenTurnContext;
  recordDraft(draft: string): void;
}): MavenToolDefinition {
  const capability = createCapability(dependencies.context.projectId);

  return {
    capability,
    description:
      "Present the exact visitor-facing reply draft to the human support agent without sending it.",
    inputSchema: presentReplyDraftInputSchema,
    async execute(input): Promise<PresentReplyDraftResult> {
      const parsedInput = presentReplyDraftInputSchema.parse(input);
      dependencies.recordDraft(parsedInput.draft);
      return { accepted: true };
    },
    async reauthorize() {
      return capability;
    },
  };
}
