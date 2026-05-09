import { logInfo, logWarn } from "../observability";

const AUTORAG_INSTANCE = "supportbot";

interface AutoRagSyncEnv {
  CF_ACCOUNT_ID: string;
  AUTORAG_API_TOKEN: string;
}

/**
 * Trigger an AutoRAG re-index of the configured instance. Cloudflare's
 * dashboard auto-sync is on a 6-hour cadence; this helper forces an immediate
 * sync so newly written or deleted R2 content is reflected in retrieval
 * within seconds rather than hours.
 *
 * Idempotent on Cloudflare's side — concurrent calls coalesce. Designed to
 * be invoked via `c.executionCtx.waitUntil(...)` so it never blocks the
 * user-facing response.
 */
export async function triggerAutoRagSync(
  env: AutoRagSyncEnv,
  reason: string,
): Promise<void> {
  if (!env.AUTORAG_API_TOKEN) {
    logWarn("autorag_sync.skipped_missing_token", { reason });
    return;
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/autorag/rags/${AUTORAG_INSTANCE}/sync`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AUTORAG_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logWarn("autorag_sync.failed", {
        reason,
        status: res.status,
        body: text.slice(0, 500),
      });
      return;
    }

    logInfo("autorag_sync.triggered", { reason });
  } catch (err) {
    logWarn("autorag_sync.error", {
      reason,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
