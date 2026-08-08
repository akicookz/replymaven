import {
  emitCompletedEvent,
  emitSseEvent,
  type WidgetCompletedPayload,
} from "../streaming/map-agent-events-to-sse";

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
  persist: () => Promise<Message | null>;
  getConversationStatusAfterFailure: () => Promise<
    WidgetCompletedPayload["conversationStatus"]
  >;
  onPersisted?: (message: Message) => void;
}): Promise<Message | null> {
  const message = await options.persist();
  if (!message) {
    const conversationStatus =
      await options.getConversationStatusAfterFailure();
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

  options.onPersisted?.(message);
  if (options.streamProtocolVersion === 1) {
    emitSseEvent(options.controller, options.encoder, {
      finalText: options.finalText,
    });
  }

  return message;
}
