interface LogContext {
  [key: string]: unknown;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function buildPayload(
  level: "info" | "warn" | "error",
  event: string,
  context: LogContext,
  error?: unknown,
): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
    ...(error !== undefined ? { error: serializeError(error) } : {}),
  });
}

export function logInfo(event: string, context: LogContext = {}): void {
  console.log(buildPayload("info", event, context));
}

export function logWarn(event: string, context: LogContext = {}): void {
  console.warn(buildPayload("warn", event, context));
}

export function logError(
  event: string,
  error: unknown,
  context: LogContext = {},
): void {
  console.error(buildPayload("error", event, context, error));
}
