import { type PlannerNextAction } from "../types";
import { type HandoffSopDecision } from "../workflows/classify-handoff-sop";

export interface PromoteActionInput {
  action: PlannerNextAction;
  handoffSopDecision: HandoffSopDecision | null | undefined;
  missingContactFields: Array<"name" | "email">;
  contactDeclined: boolean;
}

export interface PromoteActionResult {
  action: PlannerNextAction;
  promoted: boolean;
  promotionNote: string | null;
}

const HANDOFF_ORIENTED_ACTIONS = new Set<PlannerNextAction["type"]>([
  "offer_handoff",
  "collect_contact",
  "create_inquiry",
  "ask_user",
]);

export function promoteActionForHandoffOverride(
  input: PromoteActionInput,
): PromoteActionResult {
  const { action, handoffSopDecision, missingContactFields, contactDeclined } =
    input;

  if (!handoffSopDecision?.shouldOverride) {
    return { action, promoted: false, promotionNote: null };
  }

  if (HANDOFF_ORIENTED_ACTIONS.has(action.type)) {
    return { action, promoted: false, promotionNote: null };
  }

  const baseReason = `hard-promoted by handoff-sop override (${handoffSopDecision.trigger})`;

  if (missingContactFields.length > 0 && !contactDeclined) {
    return {
      action: {
        type: "collect_contact",
        reason: baseReason,
        missingFields: missingContactFields,
      },
      promoted: true,
      promotionNote: baseReason,
    };
  }

  return {
    action: {
      type: "create_inquiry",
      reason: baseReason,
    },
    promoted: true,
    promotionNote: baseReason,
  };
}
