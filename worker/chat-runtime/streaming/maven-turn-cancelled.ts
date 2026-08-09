export class MavenTurnCancelled extends Error {
  constructor() {
    super("The Maven turn was cancelled.");
    this.name = "MavenTurnCancelled";
  }
}

export function throwIfMavenTurnCancelled(
  abortSignal: AbortSignal | undefined,
): void {
  if (abortSignal?.aborted) throw new MavenTurnCancelled();
}
