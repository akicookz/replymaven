import type { PublicConversationStatus } from "../../shared/maven-conversation";
import {
  confirmBotNameDecision,
  mergePublicMetadata,
  readTelegramCommandClaim,
  resolveBanReason,
  telegramCommandClaimPatch,
  type BotNameDecision,
} from "./bot-name-decision";

export interface BotNameOwnershipSnapshot {
  status: PublicConversationStatus
  chatState: string | null
}

export interface ApplyBotNameCommandDeps {
  transitionChatOwnership(event: "ai_handed_back"): Promise<BotNameOwnershipSnapshot | null>
  takeHumanOwnership(): Promise<BotNameOwnershipSnapshot | null>
  updateConversation(input: { metadata: string }): Promise<void>
  updateConversationStatus(
    status: "closed",
    closeReason: "resolved" | "spam",
  ): Promise<void>
  closeOpenConversationsAsSpam(): Promise<void>
  banVisitor(reason: string): Promise<void>
  generateDirectedResponse(instruction: string): Promise<string | null>
  addPublicBotMessage(input: {
    content: string
    expected: BotNameOwnershipSnapshot
  }): Promise<boolean>
}

interface ApplyBotNameCommandInput {
  rawAgentText: string
  decision: BotNameDecision | null
  metadata: Record<string, unknown>
  now: number
  commandId?: string
  deps: ApplyBotNameCommandDeps
}

export async function applyBotNameCommand(
  input: ApplyBotNameCommandInput,
): Promise<{ confirmation: string }> {
  const { rawAgentText, metadata, now, commandId, deps } = input;
  if (commandId) {
    const replayed = readTelegramCommandClaim(metadata, commandId);
    if (replayed) return { confirmation: replayed };
  }

  if (!input.decision) {
    await deps.takeHumanOwnership();
    const confirmation = confirmBotNameDecision({
      effect: "none",
      storedInstructions: true,
    });
    await writeMetadata(deps, metadata, {
      agentHandbackInstructions: rawAgentText,
      lastHumanCommandAt: now,
    }, commandId, confirmation);
    return { confirmation };
  }

  const decision = input.decision;
  if (decision.effect === "close") {
    await deps.updateConversationStatus("closed", "resolved");
    const confirmation = confirmBotNameDecision({ effect: "close" });
    await writeClaim(deps, metadata, commandId, confirmation);
    return { confirmation };
  }
  if (decision.effect === "ban") {
    const reason = resolveBanReason(decision.reason, rawAgentText);
    await deps.banVisitor(reason);
    await deps.updateConversationStatus("closed", "spam");
    await deps.closeOpenConversationsAsSpam();
    const confirmation = confirmBotNameDecision({ effect: "ban", reason });
    await writeClaim(deps, metadata, commandId, confirmation);
    return { confirmation };
  }

  let snapshot: BotNameOwnershipSnapshot | null = null;
  if (decision.ownership === "ai") {
    snapshot = await deps.transitionChatOwnership("ai_handed_back");
  } else {
    snapshot = await deps.takeHumanOwnership();
  }

  const instructionPatch: Record<string, unknown> = {
    lastHumanCommandAt: now,
  };
  if (decision.instructions === "set") {
    instructionPatch.agentHandbackInstructions = rawAgentText;
  } else if (decision.instructions === "clear") {
    instructionPatch.agentHandbackInstructions = null;
  }

  let spoke = false;
  let confirmation = confirmBotNameDecision({
    effect: "none",
    handedToAi: decision.ownership === "ai",
    storedInstructions: decision.instructions === "set",
    spoke,
  });
  if (decision.speak === "now") {
    if (!snapshot) {
      confirmation = "Bot response canceled because the conversation changed.";
    } else {
      const content = await deps.generateDirectedResponse(rawAgentText);
      if (!content) {
        confirmation = "Bot could not respond.";
      } else {
        spoke = await deps.addPublicBotMessage({
          content,
          expected: snapshot,
        });
        confirmation = spoke
          ? confirmBotNameDecision({
            effect: "none",
            handedToAi: decision.ownership === "ai",
            storedInstructions: decision.instructions === "set",
            spoke: true,
          })
          : "Bot response canceled because the conversation changed.";
      }
    }
  }

  await writeMetadata(deps, metadata, instructionPatch, commandId, confirmation);
  return { confirmation };
}

async function writeClaim(
  deps: ApplyBotNameCommandDeps,
  metadata: Record<string, unknown>,
  commandId: string | undefined,
  confirmation: string,
): Promise<void> {
  if (!commandId) return;
  await writeMetadata(deps, metadata, {}, commandId, confirmation);
}

async function writeMetadata(
  deps: ApplyBotNameCommandDeps,
  metadata: Record<string, unknown>,
  patch: Record<string, unknown>,
  commandId: string | undefined,
  confirmation: string,
): Promise<void> {
  const claimed = commandId
    ? telegramCommandClaimPatch(commandId, confirmation)
    : {};
  await deps.updateConversation({
    metadata: JSON.stringify(mergePublicMetadata(metadata, {
      ...patch,
      ...claimed,
    })),
  });
}
