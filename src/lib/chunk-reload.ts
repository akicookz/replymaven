// Recovery for stale lazy-loaded chunks after a deploy.
//
// The dashboard is a Vite SPA whose routes are code-split (e.g. the Help
// Article editor is `React.lazy(() => import("@/components/help-article-editor"))`).
// Each deploy regenerates the content-hash in every chunk filename and the old
// files are dropped from Cloudflare Assets. A tab that loaded before a deploy
// still references the old filenames, so navigating to a lazy route requests a
// now-404'd chunk and the browser throws:
//
//   Failed to fetch dynamically imported module: .../assets/help-article-editor-XXXX.js
//
// Vite fires a cancelable `vite:preloadError` window event for exactly this.
// Reloading the page pulls a fresh index.html + chunk manifest and recovers.

const RELOAD_KEY = "rm:chunk-reload-at";

// Only reload once per window. If a preload error fires again within this span
// the chunk is genuinely gone (not just stale), so we stop reloading and let
// the error surface instead of trapping the user in a refresh loop.
const RELOAD_WINDOW_MS = 10_000;

export interface ReloadDecisionDeps {
  now: number;
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
}

/**
 * Decide whether to reload the page in response to a failed dynamic import.
 *
 * Returns true the first time (recording the attempt) and false if another
 * failure arrives within RELOAD_WINDOW_MS of the last reload.
 */
export function shouldReloadForChunkError({
  now,
  read,
  write,
}: ReloadDecisionDeps): boolean {
  const last = Number(read(RELOAD_KEY) ?? 0);
  if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) {
    return false;
  }
  write(RELOAD_KEY, String(now));
  return true;
}

/**
 * Wire the `vite:preloadError` handler to the given window. Extracted so the
 * decision logic stays unit-testable without a DOM.
 */
export function installChunkReloadHandler(win: Window = window): void {
  win.addEventListener("vite:preloadError", (event) => {
    const deps: ReloadDecisionDeps = {
      now: Date.now(),
      read: (key) => {
        try {
          return win.sessionStorage.getItem(key);
        } catch {
          return null;
        }
      },
      write: (key, value) => {
        try {
          win.sessionStorage.setItem(key, value);
        } catch {
          /* sessionStorage unavailable (private mode / blocked) — ignore */
        }
      },
    };

    if (shouldReloadForChunkError(deps)) {
      // Prevent Vite from re-throwing; we recover by reloading instead.
      event.preventDefault();
      win.location.reload();
    }
    // Otherwise let Vite throw so the ErrorBoundary can show a recoverable UI.
  });
}
