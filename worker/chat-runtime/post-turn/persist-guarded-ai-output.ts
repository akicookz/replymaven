import {
  emitCompletedEvent,
  emitSseEvent,
  type WidgetCompletedPayload,
} from "../streaming/map-agent-events-to-sse";
import { throwIfMavenTurnCancelled } from "../streaming/maven-turn-cancelled";

interface PersistedAiMessage {
  id: string;
}

export async function persistGuardedAiOutput<
  Message extends PersistedAiMessage,
>(options: {
  controller: ReadableStreamDefaultController;
  encoder: TextEncoder;
  streamProtocolVersion: 1 | 2;
  finalText: string;
  abortSignal: AbortSignal | undefined;
  persist: () => Promise<Message | null>;
  getConversationStatusAfterFailure: () => Promise<
    WidgetCompletedPayload["conversationStatus"]
  >;
  onPersisted?: (message: Message) => void;
}): Promise<Message | null> {
  throwIfMavenTurnCancelled(options.abortSignal);
  const message = await options.persist();
  throwIfMavenTurnCancelled(options.abortSignal);
  if (!message) {
    const conversationStatus =
      await options.getConversationStatusAfterFailure();
    throwIfMavenTurnCancelled(options.abortSignal);
    if (options.streamProtocolVersion === 2) {
      emitCompletedEvent(options.controller, options.encoder, {
        protocolVersion: 2,
        messageId: null,
        finalText: "",
        conversationStatus,
      });
    } else {
      emitSseEvent(options.controller, options.encoder, { done: true });
    }
    return null;
  }

  throwIfMavenTurnCancelled(options.abortSignal);
  options.onPersisted?.(message);
  throwIfMavenTurnCancelled(options.abortSignal);
  if (options.streamProtocolVersion === 1) {
    emitSseEvent(options.controller, options.encoder, {
      finalText: options.finalText,
    });
  }

  return message;
}
