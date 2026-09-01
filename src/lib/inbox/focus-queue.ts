import type { Conversation, LastMessagePreview } from "./types";

export type FocusCardSnapshot = Pick<
  Conversation,
  | "id"
  | "visitorName"
  | "visitorEmail"
  | "status"
  | "closeReason"
  | "priority"
  | "snoozedUntil"
  | "archivedAt"
  | "visitorBlocked"
  | "metadata"
  | "lastMessage"
>;

export interface FocusQueueSnapshot {
  orderedIds: string[];
  cards: Record<string, FocusCardSnapshot>;
  currentIndex: number;
  knownTotal: number;
  hasMore: boolean;
  completedCount: number;
}

export type FocusDepartureAction =
  | "resolve"
  | "reopen"
  | "snooze"
  | "unsnooze"
  | "spam"
  | "unflag"
  | "block"
  | "unblock"
  | "archive"
  | "unarchive"
  | "external";

export type FocusMutationState = "pending" | "succeeded" | "failed";
export type FocusMotionState = "pending" | "finished";
export type FocusRollbackMotion = "reverse-in-place" | "slide-back";

export interface FocusDeparture {
  transactionId: string;
  action: FocusDepartureAction;
  before: FocusQueueSnapshot;
  after: FocusQueueSnapshot;
  departing: FocusCardSnapshot;
  next: FocusCardSnapshot | null;
  mutation: FocusMutationState;
  motion: FocusMotionState;
  canRollBack: boolean;
}

export type FocusQueueState =
  | { kind: "inactive" }
  | {
      kind: "loading";
      selectedId: string | null;
      knownTotal: number;
      hasMore: boolean;
      refillFailed: boolean;
      reducedMotion: boolean;
    }
  | { kind: "reviewing"; queue: FocusQueueSnapshot; reducedMotion: boolean }
  | {
      kind: "departing";
      queue: FocusQueueSnapshot;
      departure: FocusDeparture;
      reducedMotion: boolean;
    }
  | {
      kind: "rolling-back";
      queue: FocusQueueSnapshot;
      departure: FocusDeparture;
      rollbackMotion: FocusRollbackMotion;
      reducedMotion: boolean;
    }
  | {
      kind: "checking-queue";
      completedCount: number;
      knownTotal: number;
      hasMore: boolean;
      refillFailed: boolean;
      reducedMotion: boolean;
    }
  | {
      kind: "all-done";
      completedCount: number;
      newArrivalCount: number;
      reducedMotion: boolean;
    };

export type FocusQueueEvent =
  | {
      type: "ENTER";
      visible: FocusCardSnapshot[];
      selectedId: string | null;
      knownTotal: number;
      hasMore: boolean;
      reducedMotion?: boolean;
    }
  | { type: "EXIT" }
  | { type: "MOVE"; direction: "next" | "previous" }
  | {
      type: "VISIBLE_LIST_SYNC";
      visible: FocusCardSnapshot[];
      knownTotal: number;
      hasMore: boolean;
    }
  | {
      type: "DEPARTURE_STARTED";
      transactionId: string;
      action: FocusDepartureAction;
      reducedMotion?: boolean;
    }
  | { type: "MUTATION_SUCCEEDED"; transactionId: string }
  | { type: "MUTATION_FAILED"; transactionId: string }
  | { type: "MOTION_FINISHED"; transactionId: string }
  | { type: "ROLLBACK_MOTION_FINISHED"; transactionId: string }
  | {
      type: "QUEUE_REFILL_RETURNED";
      visible: FocusCardSnapshot[];
      knownTotal: number;
      hasMore: boolean;
    }
  | { type: "QUEUE_REFILL_FAILED" }
  | {
      type: "CURRENT_TICKET_LEFT";
      transactionId: string;
      visible: FocusCardSnapshot[];
      knownTotal: number;
      hasMore: boolean;
    }
  | {
      type: "CONTINUE";
      visible: FocusCardSnapshot[];
      selectedId?: string | null;
      knownTotal: number;
      hasMore: boolean;
    };

export type FocusRenderPhase = FocusQueueState["kind"];
export type FocusMotion = "none" | "slide-left" | "slide-back";
export type FocusStackDepth = 0 | 1 | 2;

export interface FocusProgress {
  position: number;
  total: number;
}

export interface FocusViewModel {
  phase: FocusRenderPhase;
  currentCard: FocusCardSnapshot | null;
  nextCard: FocusCardSnapshot | null;
  stackDepth: FocusStackDepth;
  progress: FocusProgress | null;
  motion: FocusMotion;
  newArrivalCount: number;
}

export const INITIAL_FOCUS_QUEUE_STATE: FocusQueueState = { kind: "inactive" };

export function createFocusCardSnapshot(
  conversation: Conversation,
): FocusCardSnapshot {
  return {
    id: conversation.id,
    visitorName: conversation.visitorName,
    visitorEmail: conversation.visitorEmail,
    status: conversation.status,
    closeReason: conversation.closeReason,
    priority: conversation.priority,
    snoozedUntil: conversation.snoozedUntil,
    archivedAt: conversation.archivedAt,
    visitorBlocked: conversation.visitorBlocked,
    metadata: conversation.metadata,
    lastMessage: copyLastMessage(conversation.lastMessage),
  };
}

export function focusStackDepth(
  loadedTicketsAfterCurrent: number,
  hasMore: boolean,
): FocusStackDepth {
  const extra = hasMore ? 1 : 0;
  const depth = Math.min(2, Math.max(0, loadedTicketsAfterCurrent) + extra);
  if (depth <= 0) return 0;
  if (depth === 1) return 1;
  return 2;
}

export function focusProgressFromQueue(queue: FocusQueueSnapshot): FocusProgress {
  const remaining = Math.max(
    queue.knownTotal,
    queue.orderedIds.length + (queue.hasMore ? 1 : 0),
  );
  const position = queue.completedCount + 1;
  const total = Math.max(position, queue.completedCount + remaining);
  return { position, total };
}

export function currentFocusConversationId(
  state: FocusQueueState,
): string | null {
  if (state.kind === "inactive") return null;
  if (state.kind === "loading") return state.selectedId;
  if (state.kind === "reviewing") {
    return state.queue.orderedIds[state.queue.currentIndex] ?? null;
  }
  if (state.kind === "departing" || state.kind === "rolling-back") {
    return state.departure.departing.id;
  }
  return null;
}

export function selectFocusDetailIfCurrent<
  T extends { conversation: { id: string } },
>(state: FocusQueueState, detail: T | null | undefined): T | null {
  const currentId = currentFocusConversationId(state);
  if (currentId == null || detail == null) return null;
  if (detail.conversation.id !== currentId) return null;
  return detail;
}

export function selectFocusViewModel(state: FocusQueueState): FocusViewModel {
  if (state.kind === "inactive") {
    return hiddenViewModel("inactive");
  }
  if (state.kind === "loading") {
    return hiddenViewModel("loading");
  }
  if (state.kind === "checking-queue") {
    return hiddenViewModel("checking-queue");
  }
  if (state.kind === "all-done") {
    return {
      phase: "all-done",
      currentCard: null,
      nextCard: null,
      stackDepth: 0,
      progress: null,
      motion: "none",
      newArrivalCount: state.newArrivalCount,
    };
  }
  if (state.kind === "reviewing") {
    return {
      phase: "reviewing",
      currentCard: cardAt(state.queue, state.queue.currentIndex),
      nextCard: cardAt(state.queue, state.queue.currentIndex + 1),
      stackDepth: stackDepthFromQueue(state.queue),
      progress: visibleProgress(state.queue),
      motion: "none",
      newArrivalCount: 0,
    };
  }
  if (state.kind === "departing") {
    return {
      phase: "departing",
      currentCard: state.departure.departing,
      nextCard: state.departure.next,
      stackDepth: stackDepthFromQueue(state.departure.before),
      progress: visibleProgress(state.departure.before),
      motion: state.reducedMotion ? "none" : "slide-left",
      newArrivalCount: 0,
    };
  }
  return {
    phase: "rolling-back",
    currentCard: state.departure.departing,
    nextCard: state.departure.next,
    stackDepth: stackDepthFromQueue(state.departure.before),
    progress: null,
    motion: "slide-back",
    newArrivalCount: 0,
  };
}

export function reduceFocusQueue(
  state: FocusQueueState,
  event: FocusQueueEvent,
): FocusQueueState {
  switch (event.type) {
    case "ENTER":
      return beginSession({
        visible: event.visible,
        selectedId: event.selectedId,
        knownTotal: event.knownTotal,
        hasMore: event.hasMore,
        reducedMotion: event.reducedMotion === true,
      });
    case "EXIT":
      return INITIAL_FOCUS_QUEUE_STATE;
    case "MOVE":
      return reduceMove(state, event.direction);
    case "VISIBLE_LIST_SYNC":
      return reduceVisibleList(
        state,
        event.visible,
        event.knownTotal,
        event.hasMore,
      );
    case "DEPARTURE_STARTED":
      return reduceDepartureStarted(state, event);
    case "MUTATION_SUCCEEDED":
      return reduceMutationSucceeded(state, event.transactionId);
    case "MUTATION_FAILED":
      return reduceMutationFailed(state, event.transactionId);
    case "MOTION_FINISHED":
      return reduceMotionFinished(state, event.transactionId);
    case "ROLLBACK_MOTION_FINISHED":
      return reduceRollbackMotionFinished(state, event.transactionId);
    case "QUEUE_REFILL_RETURNED":
      return reduceQueueRefillReturned(
        state,
        event.visible,
        event.knownTotal,
        event.hasMore,
      );
    case "QUEUE_REFILL_FAILED":
      return reduceQueueRefillFailed(state);
    case "CURRENT_TICKET_LEFT":
      return reduceCurrentTicketLeft(state, event);
    case "CONTINUE":
      return reduceContinue(state, event);
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

function beginSession(input: {
  visible: FocusCardSnapshot[];
  selectedId: string | null;
  knownTotal: number;
  hasMore: boolean;
  reducedMotion: boolean;
}): FocusQueueState {
  if (input.visible.length > 0) {
    const selectedInQueue =
      input.selectedId != null &&
      input.visible.some((card) => card.id === input.selectedId);
    const selectedId = selectedInQueue
      ? input.selectedId
      : (input.visible[0]?.id ?? null);
    return {
      kind: "reviewing",
      queue: queueFromVisible({
        visible: input.visible,
        currentId: selectedId,
        knownTotal: input.knownTotal,
        hasMore: input.hasMore,
        completedCount: 0,
      }),
      reducedMotion: input.reducedMotion,
    };
  }
  if (!input.hasMore && input.knownTotal <= 0) {
    return {
      kind: "all-done",
      completedCount: 0,
      newArrivalCount: 0,
      reducedMotion: input.reducedMotion,
    };
  }
  return {
    kind: "loading",
    selectedId: input.selectedId,
    knownTotal: Math.max(0, input.knownTotal),
    hasMore: input.hasMore,
    refillFailed: false,
    reducedMotion: input.reducedMotion,
  };
}

function reduceMove(
  state: FocusQueueState,
  direction: "next" | "previous",
): FocusQueueState {
  if (state.kind !== "reviewing") return state;
  const delta = direction === "next" ? 1 : -1;
  const nextIndex = state.queue.currentIndex + delta;
  if (nextIndex < 0 || nextIndex >= state.queue.orderedIds.length) {
    return state;
  }
  return {
    kind: "reviewing",
    queue: { ...state.queue, currentIndex: nextIndex },
    reducedMotion: state.reducedMotion,
  };
}

function reduceVisibleList(
  state: FocusQueueState,
  visible: FocusCardSnapshot[],
  knownTotal: number,
  hasMore: boolean,
): FocusQueueState {
  if (state.kind === "all-done") {
    return {
      ...state,
      newArrivalCount: Math.max(0, Math.max(knownTotal, visible.length)),
    };
  }
  if (state.kind === "loading" || state.kind === "checking-queue") {
    return applyAuthoritativeList(state, visible, knownTotal, hasMore);
  }
  if (state.kind === "reviewing") {
    return syncReviewing(state, visible, knownTotal, hasMore);
  }
  if (state.kind === "departing") {
    const departure = reconcileDeparture(
      state.departure,
      visible,
      knownTotal,
      hasMore,
    );
    return { ...state, departure };
  }
  return state;
}

function reduceQueueRefillReturned(
  state: FocusQueueState,
  visible: FocusCardSnapshot[],
  knownTotal: number,
  hasMore: boolean,
): FocusQueueState {
  if (state.kind === "loading" || state.kind === "checking-queue") {
    return applyAuthoritativeList(state, visible, knownTotal, hasMore);
  }
  if (state.kind === "reviewing") {
    return syncReviewing(state, visible, knownTotal, hasMore);
  }
  return state;
}

function reduceQueueRefillFailed(state: FocusQueueState): FocusQueueState {
  if (state.kind === "loading" || state.kind === "checking-queue") {
    return { ...state, refillFailed: true };
  }
  return state;
}

function applyAuthoritativeList(
  state: Extract<FocusQueueState, { kind: "loading" | "checking-queue" }>,
  visible: FocusCardSnapshot[],
  knownTotal: number,
  hasMore: boolean,
): FocusQueueState {
  const completedCount =
    state.kind === "checking-queue" ? state.completedCount : 0;
  const selectedId = state.kind === "loading" ? state.selectedId : null;
  if (visible.length > 0) {
    const selectedInQueue =
      selectedId != null && visible.some((card) => card.id === selectedId);
    const currentId = selectedInQueue ? selectedId : (visible[0]?.id ?? null);
    return {
      kind: "reviewing",
      queue: queueFromVisible({
        visible,
        currentId,
        knownTotal,
        hasMore,
        completedCount,
      }),
      reducedMotion: state.reducedMotion,
    };
  }
  if (!hasMore && knownTotal <= 0) {
    return {
      kind: "all-done",
      completedCount,
      newArrivalCount: 0,
      reducedMotion: state.reducedMotion,
    };
  }
  if (state.kind === "loading") {
    return {
      kind: "loading",
      selectedId,
      knownTotal: Math.max(0, knownTotal),
      hasMore,
      refillFailed: false,
      reducedMotion: state.reducedMotion,
    };
  }
  return {
    kind: "checking-queue",
    completedCount,
    knownTotal: Math.max(0, knownTotal),
    hasMore,
    refillFailed: false,
    reducedMotion: state.reducedMotion,
  };
}

function syncReviewing(
  state: Extract<FocusQueueState, { kind: "reviewing" }>,
  visible: FocusCardSnapshot[],
  knownTotal: number,
  hasMore: boolean,
): FocusQueueState {
  const currentId = state.queue.orderedIds[state.queue.currentIndex] ?? null;
  const currentStillVisible =
    currentId != null && visible.some((card) => card.id === currentId);
  if (currentId != null && !currentStillVisible) {
    return launchDeparture({
      queue: state.queue,
      reducedMotion: state.reducedMotion,
      transactionId: `external:${currentId}`,
      action: "external",
      canRollBack: false,
      mutation: "succeeded",
      visible,
      knownTotal,
      hasMore,
    });
  }
  return {
    kind: "reviewing",
    queue: queueFromVisible({
      visible,
      currentId,
      knownTotal,
      hasMore,
      completedCount: state.queue.completedCount,
    }),
    reducedMotion: state.reducedMotion,
  };
}

function reduceDepartureStarted(
  state: FocusQueueState,
  event: Extract<FocusQueueEvent, { type: "DEPARTURE_STARTED" }>,
): FocusQueueState {
  if (state.kind !== "reviewing") return state;
  return launchDeparture({
    queue: state.queue,
    reducedMotion: state.reducedMotion || event.reducedMotion === true,
    transactionId: event.transactionId,
    action: event.action,
    canRollBack: true,
    mutation: "pending",
    visible: null,
    knownTotal: state.queue.knownTotal,
    hasMore: state.queue.hasMore,
  });
}

function reduceCurrentTicketLeft(
  state: FocusQueueState,
  event: Extract<FocusQueueEvent, { type: "CURRENT_TICKET_LEFT" }>,
): FocusQueueState {
  if (state.kind !== "reviewing") return state;
  return launchDeparture({
    queue: state.queue,
    reducedMotion: state.reducedMotion,
    transactionId: event.transactionId,
    action: "external",
    canRollBack: false,
    mutation: "succeeded",
    visible: event.visible,
    knownTotal: event.knownTotal,
    hasMore: event.hasMore,
  });
}

function launchDeparture(input: {
  queue: FocusQueueSnapshot;
  reducedMotion: boolean;
  transactionId: string;
  action: FocusDepartureAction;
  canRollBack: boolean;
  mutation: FocusMutationState;
  visible: FocusCardSnapshot[] | null;
  knownTotal: number;
  hasMore: boolean;
}): FocusQueueState {
  const before = copyQueue(input.queue);
  const departing = cardAt(before, before.currentIndex);
  if (!departing) {
    return { kind: "reviewing", queue: before, reducedMotion: input.reducedMotion };
  }

  const built = buildAfterQueue(before);
  let departure: FocusDeparture = {
    transactionId: input.transactionId,
    action: input.action,
    before,
    after: built.after,
    departing: copyCard(departing),
    next: built.next ? copyCard(built.next) : null,
    mutation: input.mutation,
    motion: input.reducedMotion ? "finished" : "pending",
    canRollBack: input.canRollBack,
  };
  if (input.visible) {
    departure = reconcileDeparture(
      departure,
      input.visible,
      input.knownTotal,
      input.hasMore,
    );
  }
  const committed = commitIfReady(departure, input.reducedMotion);
  if (committed) return committed;
  return {
    kind: "departing",
    queue: before,
    departure,
    reducedMotion: input.reducedMotion,
  };
}

function reduceMutationSucceeded(
  state: FocusQueueState,
  transactionId: string,
): FocusQueueState {
  if (state.kind !== "departing") return state;
  if (state.departure.transactionId !== transactionId) return state;
  const departure: FocusDeparture = {
    ...state.departure,
    mutation: "succeeded",
  };
  const committed = commitIfReady(departure, state.reducedMotion);
  if (committed) return committed;
  return { ...state, departure };
}

function reduceMotionFinished(
  state: FocusQueueState,
  transactionId: string,
): FocusQueueState {
  if (state.kind !== "departing") return state;
  if (state.departure.transactionId !== transactionId) return state;
  const departure: FocusDeparture = {
    ...state.departure,
    motion: "finished",
  };
  const committed = commitIfReady(departure, state.reducedMotion);
  if (committed) return committed;
  return { ...state, departure };
}

function reduceMutationFailed(
  state: FocusQueueState,
  transactionId: string,
): FocusQueueState {
  if (state.kind !== "departing") return state;
  if (state.departure.transactionId !== transactionId) return state;
  if (!state.departure.canRollBack) return state;
  const before = copyQueue(state.departure.before);
  if (state.reducedMotion) {
    return {
      kind: "reviewing",
      queue: before,
      reducedMotion: true,
    };
  }
  const rollbackMotion: FocusRollbackMotion =
    state.departure.motion === "finished" ? "slide-back" : "reverse-in-place";
  return {
    kind: "rolling-back",
    queue: before,
    departure: {
      ...state.departure,
      mutation: "failed",
    },
    rollbackMotion,
    reducedMotion: false,
  };
}

function reduceRollbackMotionFinished(
  state: FocusQueueState,
  transactionId: string,
): FocusQueueState {
  if (state.kind !== "rolling-back") return state;
  if (state.departure.transactionId !== transactionId) return state;
  return {
    kind: "reviewing",
    queue: copyQueue(state.departure.before),
    reducedMotion: state.reducedMotion,
  };
}

function reduceContinue(
  state: FocusQueueState,
  event: Extract<FocusQueueEvent, { type: "CONTINUE" }>,
): FocusQueueState {
  if (state.kind !== "all-done") return state;
  return beginSession({
    visible: event.visible,
    selectedId: event.selectedId ?? null,
    knownTotal: event.knownTotal,
    hasMore: event.hasMore,
    reducedMotion: state.reducedMotion,
  });
}

function commitIfReady(
  departure: FocusDeparture,
  reducedMotion: boolean,
): FocusQueueState | null {
  if (departure.mutation !== "succeeded") return null;
  if (departure.motion !== "finished") return null;
  const after = copyQueue(departure.after);
  if (after.orderedIds.length > 0) {
    return { kind: "reviewing", queue: after, reducedMotion };
  }
  return {
    kind: "checking-queue",
    completedCount: after.completedCount,
    knownTotal: after.knownTotal,
    hasMore: after.hasMore,
    refillFailed: false,
    reducedMotion,
  };
}

function buildAfterQueue(before: FocusQueueSnapshot): {
  after: FocusQueueSnapshot;
  next: FocusCardSnapshot | null;
} {
  const afterIds = before.orderedIds.filter(
    (_, index) => index !== before.currentIndex,
  );
  const nextIndex = indexAfterRemoval(afterIds, before.currentIndex);
  const cards: Record<string, FocusCardSnapshot> = {};
  for (const id of afterIds) {
    const card = before.cards[id];
    if (card) cards[id] = copyCard(card);
  }
  const next = cardAt(
    { ...before, orderedIds: afterIds, cards, currentIndex: nextIndex },
    nextIndex,
  );
  return {
    after: {
      orderedIds: afterIds,
      cards,
      currentIndex: next ? nextIndex : 0,
      knownTotal: Math.max(0, before.knownTotal - 1),
      hasMore: before.hasMore,
      completedCount: before.completedCount + 1,
    },
    next,
  };
}

function indexAfterRemoval(afterIds: string[], removedIndex: number): number {
  if (afterIds.length === 0) return 0;
  if (removedIndex < afterIds.length) return removedIndex;
  return afterIds.length - 1;
}

function reconcileDeparture(
  departure: FocusDeparture,
  visible: FocusCardSnapshot[],
  knownTotal: number,
  hasMore: boolean,
): FocusDeparture {
  const departingId = departure.departing.id;
  const pinnedNextId = departure.next?.id ?? null;
  const visibleCards = new Map<string, FocusCardSnapshot>();
  for (const card of visible) {
    visibleCards.set(card.id, copyCard(card));
  }
  const nextStillVisible =
    pinnedNextId != null && visibleCards.has(pinnedNextId);

  const afterIds: string[] = [];
  const seen = new Set<string>();
  for (const id of departure.after.orderedIds) {
    if (id === departingId) continue;
    if (id === pinnedNextId) {
      if (nextStillVisible) {
        afterIds.push(id);
        seen.add(id);
      }
      continue;
    }
    if (visibleCards.has(id)) {
      afterIds.push(id);
      seen.add(id);
    }
  }
  for (const card of visible) {
    if (card.id === departingId) continue;
    if (seen.has(card.id)) continue;
    afterIds.push(card.id);
    seen.add(card.id);
  }

  const cards: Record<string, FocusCardSnapshot> = {};
  for (const id of afterIds) {
    if (id === pinnedNextId && departure.next && nextStillVisible) {
      cards[id] = copyCard(departure.next);
      continue;
    }
    const fromVisible = visibleCards.get(id);
    if (fromVisible) {
      cards[id] = fromVisible;
      continue;
    }
    const fromAfter = departure.after.cards[id];
    if (fromAfter) cards[id] = copyCard(fromAfter);
  }

  let next = departure.next;
  let currentIndex = 0;
  if (pinnedNextId != null && nextStillVisible) {
    next = departure.next ? copyCard(departure.next) : null;
    const pinnedIndex = afterIds.indexOf(pinnedNextId);
    currentIndex = pinnedIndex >= 0 ? pinnedIndex : 0;
  } else if (pinnedNextId != null && !nextStillVisible) {
    const replacementIndex = indexAfterRemoval(
      afterIds,
      departure.after.currentIndex,
    );
    const replacementId = afterIds[replacementIndex];
    next =
      replacementId && cards[replacementId]
        ? copyCard(cards[replacementId])
        : null;
    currentIndex = next && replacementId ? afterIds.indexOf(replacementId) : 0;
  } else {
    next = null;
    currentIndex = 0;
  }

  return {
    ...departure,
    next,
    after: {
      orderedIds: afterIds,
      cards,
      currentIndex,
      knownTotal: Math.max(0, knownTotal),
      hasMore,
      completedCount: departure.after.completedCount,
    },
  };
}

function queueFromVisible(input: {
  visible: FocusCardSnapshot[];
  currentId: string | null;
  knownTotal: number;
  hasMore: boolean;
  completedCount: number;
}): FocusQueueSnapshot {
  const orderedIds: string[] = [];
  const cards: Record<string, FocusCardSnapshot> = {};
  for (const card of input.visible) {
    orderedIds.push(card.id);
    cards[card.id] = copyCard(card);
  }
  let currentIndex = 0;
  if (input.currentId != null) {
    const index = orderedIds.indexOf(input.currentId);
    if (index >= 0) currentIndex = index;
  }
  return {
    orderedIds,
    cards,
    currentIndex,
    knownTotal: Math.max(0, input.knownTotal),
    hasMore: input.hasMore,
    completedCount: input.completedCount,
  };
}

function copyQueue(queue: FocusQueueSnapshot): FocusQueueSnapshot {
  const cards: Record<string, FocusCardSnapshot> = {};
  for (const id of Object.keys(queue.cards)) {
    const card = queue.cards[id];
    if (card) cards[id] = copyCard(card);
  }
  return {
    orderedIds: [...queue.orderedIds],
    cards,
    currentIndex: queue.currentIndex,
    knownTotal: queue.knownTotal,
    hasMore: queue.hasMore,
    completedCount: queue.completedCount,
  };
}

function copyCard(card: FocusCardSnapshot): FocusCardSnapshot {
  return {
    id: card.id,
    visitorName: card.visitorName,
    visitorEmail: card.visitorEmail,
    status: card.status,
    closeReason: card.closeReason,
    priority: card.priority,
    snoozedUntil: card.snoozedUntil,
    archivedAt: card.archivedAt,
    visitorBlocked: card.visitorBlocked,
    metadata: card.metadata,
    lastMessage: copyLastMessage(card.lastMessage),
  };
}

function copyLastMessage(
  lastMessage: LastMessagePreview | null | undefined,
): LastMessagePreview | null | undefined {
  if (lastMessage == null) return lastMessage;
  return { ...lastMessage };
}

function cardAt(
  queue: FocusQueueSnapshot,
  index: number,
): FocusCardSnapshot | null {
  const id = queue.orderedIds[index];
  if (id == null) return null;
  const card = queue.cards[id];
  return card ? copyCard(card) : null;
}

function stackDepthFromQueue(queue: FocusQueueSnapshot): FocusStackDepth {
  const loadedTicketsAfterCurrent = Math.max(
    0,
    queue.orderedIds.length - queue.currentIndex - 1,
  );
  return focusStackDepth(loadedTicketsAfterCurrent, queue.hasMore);
}

function visibleProgress(queue: FocusQueueSnapshot): FocusProgress | null {
  const progress = focusProgressFromQueue(queue);
  if (progress.position < 1) return null;
  return progress;
}

function hiddenViewModel(
  phase: Extract<FocusRenderPhase, "inactive" | "loading" | "checking-queue">,
): FocusViewModel {
  return {
    phase,
    currentCard: null,
    nextCard: null,
    stackDepth: 0,
    progress: null,
    motion: "none",
    newArrivalCount: 0,
  };
}
