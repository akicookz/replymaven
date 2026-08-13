export interface WidgetIdentityRuntimeState {
  config: unknown;
  conversationId: string | null;
  conversationStatus: string | null;
  visitorInfo: Record<string, string>;
  customMetadata: Record<string, string>;
  pageContext: Record<string, string>;
  messages: unknown[];
  renderedMessageIds: string[];
  newestResponseId: string | null;
  agentConnected: boolean;
  agentSessionExpiresAt: number;
  heartbeat: boolean;
  messageDraft: string;
  inlineDraft: string;
  formDrafts: string[];
  pendingAttachment: boolean;
  inputDisabled: boolean;
}

export interface WidgetIdentitySessionToken {
  generation: number;
  signal: AbortSignal;
}

export class WidgetIdentitySessionGuard {
  private generation = 0;
  private controller = new AbortController();
  private signedIdentifyTail: Promise<void> = Promise.resolve();

  capture(): WidgetIdentitySessionToken {
    return {
      generation: this.generation,
      signal: this.controller.signal,
    };
  }

  rotate(): void {
    this.controller.abort();
    this.generation += 1;
    this.controller = new AbortController();
  }

  isCurrent(session: WidgetIdentitySessionToken): boolean {
    return (
      session.generation === this.generation &&
      session.signal === this.controller.signal &&
      !session.signal.aborted
    );
  }

  enqueueSignedIdentify(task: () => Promise<void>): Promise<void> {
    const request = this.signedIdentifyTail.then(task);
    this.signedIdentifyTail = request.catch(() => undefined);
    return request;
  }
}

export interface CustomerIdentityResetPlan {
  storageKeysToRemove: string[];
  nextState: WidgetIdentityRuntimeState & { visitorId: string };
}

export function isSignedIdentityInput(
  input: unknown,
): input is { token: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  return (
    typeof value.token === "string" &&
    value.token.trim().length > 0 &&
    Object.keys(value).every((key) => key === "token")
  );
}

export function planCustomerIdentityReset(input: {
  projectSlug: string;
  currentVisitorId: string;
  nextUuid: string;
  state: WidgetIdentityRuntimeState;
}): CustomerIdentityResetPlan {
  const prefix = `rm_${input.projectSlug}`;
  return {
    storageKeysToRemove: [
      `${prefix}_conversation_id`,
      `${prefix}_last_seen_response_id`,
      `${prefix}_dismissed_intro_id`,
      `${prefix}_greetings_dismissed`,
      `${prefix}_${input.currentVisitorId}_last_seen_response_id`,
      `${prefix}_${input.currentVisitorId}_dismissed_intro_id`,
    ],
    nextState: {
      config: input.state.config,
      visitorId: `v_${input.nextUuid}`,
      conversationId: null,
      conversationStatus: null,
      visitorInfo: {},
      customMetadata: {},
      pageContext: {},
      messages: [],
      renderedMessageIds: [],
      newestResponseId: null,
      agentConnected: false,
      agentSessionExpiresAt: 0,
      heartbeat: false,
      messageDraft: "",
      inlineDraft: "",
      formDrafts: [],
      pendingAttachment: false,
      inputDisabled: false,
    },
  };
}
